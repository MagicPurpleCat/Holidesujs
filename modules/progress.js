import { getDb, gid, ensureUser, addCoins, getUser } from '../database.js';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_TIERS,
  ACHIEVEMENT_TOTAL,
  ACHIEVEMENT_CATEGORIES,
  listAchievementKeys,
} from './achievementsCatalog.js';
import { getGuildConfig } from '../utils/guildConfig.js';

export {
  ACHIEVEMENTS,
  ACHIEVEMENT_TIERS,
  ACHIEVEMENT_TOTAL,
  ACHIEVEMENT_CATEGORIES,
  listAchievementKeys,
};

/** @type {import('discord.js').Client | null} */
let achievementNotifyClient = null;

export function setAchievementNotifyClient(client) {
  achievementNotifyClient = client || null;
}

async function notifyAchievementUnlock(userId, guildId, key) {
  const ach = ACHIEVEMENTS[key];
  const client = achievementNotifyClient;
  if (!ach || !client) return;

  const text =
    `🏅 **Достижение открыто:** ${ach.emoji || '🏅'} **${ach.name}**` +
    (ach.description ? `\n_${ach.description}_` : '');

  let dmOk = false;
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      await user.send({ content: text });
      dmOk = true;
    }
  } catch {
    dmOk = false;
  }
  if (dmOk) return;

  try {
    const cfg = getGuildConfig(guildId);
    const channelId = cfg?.cmdChannelId;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send({ content: `<@${userId}> ${text}` }).catch(() => null);
    }
  } catch {
    /* ignore */
  }
}

export const QUEST_GOALS = Object.freeze({
  messages: 15,
  voice_minutes: 10,
  casino_bets: 1,
});
export const QUEST_BASE_REWARD = 150;
export const QUEST_STREAK_BONUS = 20;

export function utcDayKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function familyPair(id1, id2) {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

export function bumpQuest(userId, guildId, field, amount = 1) {
  if (!userId || !guildId) return;
  if (!['messages', 'voice_minutes', 'casino_bets'].includes(field)) return;
  ensureUser(userId, guildId);
  const day = utcDayKey();
  const g = gid(guildId);
  const db = getDb();
  db.prepare(`
    INSERT INTO daily_quests (guild_id, user_id, day_key, ${field})
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, day_key) DO UPDATE SET
      ${field} = ${field} + excluded.${field}
  `).run(g, userId, day, amount);
}

export function getTodayQuest(userId, guildId) {
  ensureUser(userId, guildId);
  const day = utcDayKey();
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM daily_quests WHERE guild_id = ? AND user_id = ? AND day_key = ?',
  ).get(gid(guildId), userId, day);
  return row || {
    guild_id: guildId,
    user_id: userId,
    day_key: day,
    messages: 0,
    voice_minutes: 0,
    casino_bets: 0,
    claimed: 0,
  };
}

export function questComplete(row) {
  return row.messages >= QUEST_GOALS.messages
    && row.voice_minutes >= QUEST_GOALS.voice_minutes
    && row.casino_bets >= QUEST_GOALS.casino_bets;
}

export function claimDailyQuest(userId, guildId) {
  const row = getTodayQuest(userId, guildId);
  if (row.claimed) return { ok: false, reason: 'already' };
  if (!questComplete(row)) return { ok: false, reason: 'incomplete' };

  const db = getDb();
  const g = gid(guildId);
  const day = utcDayKey();
  const streakRow = db.prepare(
    'SELECT * FROM daily_streaks WHERE guild_id = ? AND user_id = ?',
  ).get(g, userId);
  const yesterday = utcDayKey(new Date(Date.now() - 86400000));
  let streak = 1;
  if (streakRow?.last_claim_day === yesterday) streak = (streakRow.streak || 0) + 1;
  else if (streakRow?.last_claim_day === day) streak = streakRow.streak || 1;

  const reward = QUEST_BASE_REWARD + Math.min(7, streak) * QUEST_STREAK_BONUS;
  db.prepare(`
    INSERT INTO daily_quests (guild_id, user_id, day_key, claimed)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(guild_id, user_id, day_key) DO UPDATE SET claimed = 1
  `).run(g, userId, day);
  db.prepare(`
    INSERT INTO daily_streaks (guild_id, user_id, streak, last_claim_day)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET streak = excluded.streak, last_claim_day = excluded.last_claim_day
  `).run(g, userId, streak, day);
  addCoins(userId, reward, g);
  unlockAchievement(userId, guildId, 'quest_first');
  checkEconomyAchievements(userId, guildId);
  return { ok: true, reward, streak };
}

export function bumpSeasonCounter(userId, guildId, field, amount = 1) {
  if (!['season_messages', 'season_voice'].includes(field)) return;
  ensureUser(userId, guildId);
  getDb().prepare(`UPDATE users SET ${field} = COALESCE(${field}, 0) + ? WHERE guild_id = ? AND user_id = ?`)
    .run(amount, gid(guildId), userId);
}

export function getMemberClanRow(userId, guildId) {
  const db = getDb();
  return db.prepare(`
    SELECT c.*, m.role AS member_role
    FROM clan_members m
    JOIN clans c ON c.clan_id = m.clan_id
    WHERE m.user_id = ? AND c.guild_id = ?
  `).get(userId, guildId);
}

export function getFarmMultiplier(member) {
  let mult = 1;
  try {
    const guildId = member.guild?.id;
    const userId = member.id;
    if (!guildId) return 1;
    const user = getUser(userId, guildId);
    const partnerId = user?.relationship_status === 'married' ? user.relationship_partner_id : null;
    if (partnerId && member.voice?.channel) {
      const partnerHere = member.voice.channel.members.has(partnerId);
      if (partnerHere) mult += 0.15;
    }
    const clan = getMemberClanRow(userId, guildId);
    if (clan?.farm_boost_until) {
      const until = new Date(clan.farm_boost_until + (clan.farm_boost_until.includes('Z') ? '' : 'Z')).getTime();
      if (Number.isFinite(until) && until > Date.now()) mult += 0.2;
    }
  } catch {
    /* ignore */
  }
  return Math.max(1, mult);
}

export function getOrCreateFamilyBank(guildId, id1, id2) {
  const [a, b] = familyPair(id1, id2);
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO family_bank (guild_id, user_a, user_b, balance) VALUES (?, ?, ?, 0)
  `).run(gid(guildId), a, b);
  return db.prepare(
    'SELECT * FROM family_bank WHERE guild_id = ? AND user_a = ? AND user_b = ?',
  ).get(gid(guildId), a, b);
}

export function splitFamilyBank(guildId, id1, id2) {
  const [a, b] = familyPair(id1, id2);
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM family_bank WHERE guild_id = ? AND user_a = ? AND user_b = ?',
  ).get(gid(guildId), a, b);
  if (!row || !row.balance) return { each: 0 };
  const each = Math.floor(row.balance / 2);
  const rest = row.balance - each * 2;
  db.prepare('DELETE FROM family_bank WHERE guild_id = ? AND user_a = ? AND user_b = ?')
    .run(gid(guildId), a, b);
  if (each > 0) {
    addCoins(a, each, guildId);
    addCoins(b, each + rest, guildId);
  }
  return { each, leftover: rest };
}

export function unlockAchievement(userId, guildId, key) {
  if (!ACHIEVEMENTS[key] || !userId || !guildId) return false;
  const g = gid(guildId);
  const db = getDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO achievements (guild_id, user_id, key) VALUES (?, ?, ?)
  `).run(g, userId, key);
  if (result.changes > 0) {
    db.prepare(`
      INSERT INTO achievement_progress (guild_id, user_id, key, progress, unlocked, meta, last_updated)
      VALUES (?, ?, ?, ?, 1, '{}', datetime('now'))
      ON CONFLICT(guild_id, user_id, key) DO UPDATE SET
        unlocked = 1,
        progress = MAX(achievement_progress.progress, excluded.progress),
        last_updated = datetime('now')
    `).run(g, userId, key, ACHIEVEMENTS[key].target || 1);
    setImmediate(() => {
      notifyAchievementUnlock(userId, guildId, key).catch(() => {});
    });
  }
  return result.changes > 0;
}

export function listAchievements(userId, guildId) {
  return getDb().prepare(
    'SELECT key, unlocked_at FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY unlocked_at',
  ).all(gid(guildId), userId);
}

/** Старый API — экономика больше не выдаёт tier-достижения. */
export function checkEconomyAchievements(_userId, _guildId) {
  /* no-op: достижения выдаёт modules/achievementsTracker.js */
}

export const COSMETICS = Object.freeze({
  frame_gold: { name: 'Золотая рамка', type: 'frame', price: 2500, color: '#FFD700' },
  frame_neon: { name: 'Неоновая рамка', type: 'frame', price: 2500, color: '#33E1C4' },
  frame_crimson: { name: 'Алая рамка', type: 'frame', price: 2500, color: '#E74C3C' },
  bg_sunset: { name: 'Фон «Закат»', type: 'background', price: 3000, from: '#3a1c71', to: '#d76d77' },
  bg_matrix: { name: 'Фон «Матрица»', type: 'background', price: 3000, from: '#0f2027', to: '#2c7744' },
  bg_valentine: { name: 'Фон «Валентин»', type: 'background', price: 3000, from: '#4a001f', to: '#ff4d6d' },
});

export function ownsCosmetic(userId, guildId, itemId) {
  return Boolean(getDb().prepare(
    'SELECT 1 FROM user_cosmetics WHERE guild_id = ? AND user_id = ? AND item_id = ?',
  ).get(gid(guildId), userId, itemId));
}

export function grantCosmetic(userId, guildId, itemId) {
  getDb().prepare(`
    INSERT OR IGNORE INTO user_cosmetics (guild_id, user_id, item_id) VALUES (?, ?, ?)
  `).run(gid(guildId), userId, itemId);
}

export function listOwnedCosmetics(userId, guildId) {
  return getDb().prepare(
    'SELECT item_id FROM user_cosmetics WHERE guild_id = ? AND user_id = ?',
  ).all(gid(guildId), userId).map((r) => r.item_id);
}

export function seasonScore(u) {
  return (u.season_xp || 0) * 0.1
    + (u.season_messages || 0) * 0.5
    + (u.season_voice || 0) * 0.3;
}

export function getSeasonTop(guildId, limit = 10) {
  const users = getDb().prepare(`
    SELECT user_id, season_xp, season_messages, season_voice, is_infinite_balance
    FROM users WHERE guild_id = ? AND is_infinite_balance = 0
  `).all(gid(guildId));
  users.sort((a, b) => seasonScore(b) - seasonScore(a));
  return users.slice(0, limit);
}

export function resetSeasonCounters(guildId) {
  getDb().prepare(
    'UPDATE users SET season_xp = 0, season_messages = 0, season_voice = 0 WHERE guild_id = ?',
  ).run(gid(guildId));
}
