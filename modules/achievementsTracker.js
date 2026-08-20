/**
 * Трекинг и прогресс достижений (события Discord + фоновые проверки).
 */

import { getDb, gid, ensureUser } from '../database.js';
import {
  ACHIEVEMENTS,
  ACH_TIMEZONE,
  ACH_GENERAL_CHANNEL_ID,
  ACH_CHAT_CHANNEL_ID,
  ACH_NEWBIE_ROLE_ID,
  ACH_SECRET_PHRASE,
  ACH_EASTER_WORDS,
} from './achievementsCatalog.js';
import { unlockAchievement } from './progress.js';

const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|[0-9#*]\uFE0F?\u20E3)/u;
const HAS_EMOJI_RE = new RegExp(EMOJI_RE.source, 'gu');
const ONLY_EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|[0-9#*]\uFE0F?\u20E3|\s)+$/u;
const URL_RE = /https?:\/\/\S+|www\.\S+/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i;

/** @type {Map<string, { mutedSince: number|null, speakingAccMs: number, lastTick: number }>} */
const voiceSessions = new Map();

/** @type {Map<string, { at: number, guildId: string, userId: string }>} */
const rareGuestPending = new Map();

/** @type {Map<string, number>} */
const time333Streak = new Map();

function voiceKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function getServerDateParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ACH_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? 0 : parts.hour),
    minute: Number(parts.minute),
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isoWeekKeyServer(date = new Date()) {
  const p = getServerDateParts(date);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readMeta(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getAchievementProgress(userId, guildId, key) {
  const row = getDb().prepare(
    'SELECT progress, unlocked, meta, last_updated FROM achievement_progress WHERE guild_id = ? AND user_id = ? AND key = ?',
  ).get(gid(guildId), userId, key);
  if (!row) {
    return { progress: 0, unlocked: 0, meta: {}, last_updated: null };
  }
  return {
    progress: row.progress || 0,
    unlocked: row.unlocked || 0,
    meta: readMeta(row.meta),
    last_updated: row.last_updated,
  };
}

/**
 * Увеличивает прогресс. Не опускает значение ниже текущего.
 * @returns {boolean} true если достижение только что открыто
 */
export function bumpAchievementProgress(userId, guildId, key, amount = 1, opts = {}) {
  if (!ACHIEVEMENTS[key] || !userId || !guildId) return false;
  if (amount <= 0 && opts.setTo == null) return false;

  ensureUser(userId, guildId);
  const def = ACHIEVEMENTS[key];
  const target = def.target || 1;
  const g = gid(guildId);
  const db = getDb();
  const current = getAchievementProgress(userId, guildId, key);
  if (current.unlocked) return false;

  let next = current.progress;
  if (opts.setTo != null) {
    next = opts.force ? (Number(opts.setTo) || 0) : Math.max(next, Number(opts.setTo) || 0);
  } else {
    next += amount;
  }

  if (opts.max != null) next = Math.min(next, opts.max);

  const meta = { ...current.meta, ...(opts.meta || {}) };
  if (opts.mergeMeta) Object.assign(meta, opts.mergeMeta);

  const unlocked = next >= target ? 1 : 0;
  db.prepare(`
    INSERT INTO achievement_progress (guild_id, user_id, key, progress, unlocked, meta, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, user_id, key) DO UPDATE SET
      progress = excluded.progress,
      unlocked = MAX(achievement_progress.unlocked, excluded.unlocked),
      meta = excluded.meta,
      last_updated = datetime('now')
  `).run(g, userId, key, next, unlocked, JSON.stringify(meta));

  if (unlocked) return unlockAchievement(userId, guildId, key);
  return false;
}

function setFlag(guildId, flagKey, dayKey, value = '1') {
  getDb().prepare(`
    INSERT OR IGNORE INTO achievement_flags (guild_id, flag_key, day_key, value)
    VALUES (?, ?, ?, ?)
  `).run(gid(guildId), flagKey, dayKey, value);
}

function hasFlag(guildId, flagKey, dayKey) {
  return Boolean(
    getDb().prepare(
      'SELECT 1 FROM achievement_flags WHERE guild_id = ? AND flag_key = ? AND day_key = ?',
    ).get(gid(guildId), flagKey, dayKey),
  );
}

function bumpDailyMessages(userId, guildId, dayKey) {
  getDb().prepare(`
    INSERT INTO achievement_daily (guild_id, user_id, day_key, messages)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(guild_id, user_id, day_key) DO UPDATE SET messages = messages + 1
  `).run(gid(guildId), userId, dayKey);
}

function sumMessagesLastDays(userId, guildId, days = 7) {
  const rows = getDb().prepare(`
    SELECT day_key, messages FROM achievement_daily
    WHERE guild_id = ? AND user_id = ?
    ORDER BY day_key DESC LIMIT ?
  `).all(gid(guildId), userId, days + 2);

  const now = getServerDateParts();
  const allowed = new Set();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day - i));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    allowed.add(`${y}-${m}-${day}`);
  }
  return rows
    .filter((r) => allowed.has(r.day_key))
    .reduce((sum, r) => sum + (r.messages || 0), 0);
}

function contentHasEmoji(text) {
  return HAS_EMOJI_RE.test(text || '');
}

function contentOnlyEmoji(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/[0-9A-Za-zА-Яа-яЁё]/.test(t)) return false;
  return ONLY_EMOJI_RE.test(t);
}

function isImageAttachment(att) {
  const name = att.name || att.url || '';
  const ctype = att.contentType || '';
  return ctype.startsWith('image/') || IMAGE_EXT.test(name) || IMAGE_EXT.test(att.url || '');
}

function isVideoAttachment(att) {
  const name = att.name || att.url || '';
  const ctype = att.contentType || '';
  return ctype.startsWith('video/') || VIDEO_EXT.test(name) || VIDEO_EXT.test(att.url || '');
}

function memberDaysOnServer(member) {
  const joined = member?.joinedAt || member?.joinedTimestamp;
  if (!joined) return 0;
  const ts = joined instanceof Date ? joined.getTime() : Number(joined);
  if (!Number.isFinite(ts)) return 0;
  return Math.floor((Date.now() - ts) / 86400000);
}

function isNewbieMember(member) {
  if (!member) return false;
  if (ACH_NEWBIE_ROLE_ID && member.roles?.cache?.has(ACH_NEWBIE_ROLE_ID)) return true;
  return memberDaysOnServer(member) <= 7;
}

export async function trackMessageAchievements(message) {
  if (!message?.guild || message.author?.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;
  const content = message.content || '';
  const len = content.length;
  const parts = getServerDateParts(message.createdAt || new Date());
  const { hour, dayKey } = parts;

  bumpDailyMessages(userId, guildId, dayKey);
  const weekMsgs = sumMessagesLastDays(userId, guildId, 7);
  bumpAchievementProgress(userId, guildId, 'week_marathoner', 0, { setTo: weekMsgs });

  if (
    String(message.channelId) === String(ACH_GENERAL_CHANNEL_ID)
    && hour >= 6 && hour < 9
    && !hasFlag(guildId, `morning:${message.channelId}`, dayKey)
  ) {
    setFlag(guildId, `morning:${message.channelId}`, dayKey, userId);
    bumpAchievementProgress(userId, guildId, 'morning_herald', 1);
  }

  if (
    String(message.channelId) === String(ACH_CHAT_CHANNEL_ID)
    && hour >= 1 && hour < 4
  ) {
    bumpAchievementProgress(userId, guildId, 'night_philosopher', 1);
  }

  if (len > 0 && len <= 30) bumpAchievementProgress(userId, guildId, 'brevity_master', 1);
  if (len >= 1000) bumpAchievementProgress(userId, guildId, 'long_story', 1);

  if (len > 0 && !contentHasEmoji(content)) {
    bumpAchievementProgress(userId, guildId, 'no_emoji', 1);
  }
  if (contentOnlyEmoji(content)) {
    bumpAchievementProgress(userId, guildId, 'emoji_only', 1);
  }

  const attachments = [...(message.attachments?.values?.() || [])];
  if (attachments.some(isImageAttachment)) {
    bumpAchievementProgress(userId, guildId, 'photo_hobbyist', 1);
  }
  if (attachments.some(isVideoAttachment)) {
    bumpAchievementProgress(userId, guildId, 'video_enthusiast', 1);
  }
  if (attachments.length >= 3) {
    bumpAchievementProgress(userId, guildId, 'collage_artist', 1);
  }
  if (attachments.length === 0 && !URL_RE.test(content) && len > 0) {
    bumpAchievementProgress(userId, guildId, 'clean_text', 1);
  }

  if (message.mentions?.users?.has(userId)) {
    const selfKey = `self_praise:${dayKey}`;
    const prog = getAchievementProgress(userId, guildId, 'self_praise');
    const today = prog.meta?.day === dayKey ? (prog.meta.count || 0) : 0;
    const next = today + 1;
    bumpAchievementProgress(userId, guildId, 'self_praise', 0, {
      setTo: next,
      meta: { day: dayKey, count: next },
    });
    void selfKey;
  }

  for (const [mentionedId] of message.mentions?.users || []) {
    if (mentionedId === userId || mentionedId === message.client?.user?.id) continue;
    bumpAchievementProgress(mentionedId, guildId, 'the_one', 1);
  }

  if (message.reference?.messageId) {
    try {
      const ref = message.reference.message
        || await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (ref && !ref.author?.bot && ref.author?.id !== userId) {
        const member = await message.guild.members.fetch(ref.author.id).catch(() => null);
        if (isNewbieMember(member)) {
          bumpAchievementProgress(userId, guildId, 'newbie_helper', 1);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const lower = content.trim().toLowerCase();
  if (
    message.mentions?.has?.(message.client?.user)
    && /\bquote\b/i.test(content)
  ) {
    trackQuoteUse(userId, guildId);
  }

  if (lower && lower === ACH_SECRET_PHRASE) {
    bumpAchievementProgress(userId, guildId, 'secret_phrase', 1);
  }

  if (lower) {
    const found = getAchievementProgress(userId, guildId, 'easter_hunter').meta?.found || [];
    const foundSet = new Set(found);
    for (const word of ACH_EASTER_WORDS) {
      if (lower.includes(word) && !foundSet.has(word)) {
        foundSet.add(word);
      }
    }
    if (foundSet.size > found.length) {
      bumpAchievementProgress(userId, guildId, 'easter_hunter', 0, {
        setTo: foundSet.size,
        meta: { found: [...foundSet] },
      });
    }
  }

  // Редкий гость: фиксируем единственное сообщение в окне
  const dayMsgs = getDb().prepare(
    'SELECT messages FROM achievement_daily WHERE guild_id = ? AND user_id = ? AND day_key = ?',
  ).get(gid(guildId), userId, dayKey)?.messages || 0;

  if (dayMsgs === 1) {
    rareGuestPending.set(voiceKey(guildId, userId), {
      at: Date.now(),
      guildId,
      userId,
    });
  } else {
    rareGuestPending.delete(voiceKey(guildId, userId));
  }

  checkLoyaltyForMember(
    await message.guild.members.fetch(userId).catch(() => null),
  );
}

export function trackReactionAdd(reaction, user) {
  if (user?.bot) return;
  const message = reaction.message;
  if (!message?.guild || message.author?.bot) return;

  const guildId = message.guild.id;
  const authorId = message.author?.id;
  if (!authorId) return;

  // Любимец реакций — сумма count по всем эмодзи на сообщении
  let total = 0;
  for (const r of message.reactions.cache.values()) {
    total += r.count || 0;
  }
  getDb().prepare(`
    INSERT INTO message_reaction_stats (guild_id, message_id, author_id, total)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, message_id) DO UPDATE SET total = excluded.total
  `).run(gid(guildId), message.id, authorId, total);

  if (total >= 30) {
    bumpAchievementProgress(authorId, guildId, 'reaction_favorite', 1);
  }

  // Реакционер-универсал — уникальные эмодзи от пользователя
  if (message.author.id === user.id) return;
  const emojiId = reaction.emoji?.id
    ? `c:${reaction.emoji.id}`
    : `u:${reaction.emoji?.name || '?'}`;
  const prog = getAchievementProgress(user.id, guildId, 'reaction_universal');
  const set = new Set(prog.meta?.emojis || []);
  if (!set.has(emojiId)) {
    set.add(emojiId);
    bumpAchievementProgress(user.id, guildId, 'reaction_universal', 0, {
      setTo: set.size,
      meta: { emojis: [...set] },
    });
  }
}

function flushVoiceSession(guildId, userId, now = Date.now()) {
  const key = voiceKey(guildId, userId);
  const s = voiceSessions.get(key);
  if (!s) return;

  const dtMin = Math.max(0, (now - s.lastTick) / 60000);
  s.lastTick = now;

  if (s.mutedSince != null) {
    const mutedMin = Math.floor((now - s.mutedSince) / 60000);
    if (mutedMin > 0) {
      bumpAchievementProgress(userId, guildId, 'quiet_listener', 0, { setTo: mutedMin });
    }
  } else if (dtMin > 0) {
    const prev = getAchievementProgress(userId, guildId, 'loud_voice').progress || 0;
    bumpAchievementProgress(userId, guildId, 'loud_voice', 0, {
      setTo: Math.floor(prev + dtMin),
    });
  }
}

export function trackVoiceStateAchievements(oldState, newState) {
  const guildId = newState?.guild?.id || oldState?.guild?.id;
  const userId = newState?.id || oldState?.id;
  if (!guildId || !userId) return;
  if (newState?.member?.user?.bot) return;

  const now = Date.now();
  const key = voiceKey(guildId, userId);
  const joined = !oldState?.channelId && newState?.channelId;
  const left = oldState?.channelId && !newState?.channelId;
  const inVoice = Boolean(newState?.channelId);

  if (joined) {
    const parts = getServerDateParts();
    if (parts.hour < 8 && !hasFlag(guildId, 'voice_first', parts.dayKey)) {
      setFlag(guildId, 'voice_first', parts.dayKey, userId);
      bumpAchievementProgress(userId, guildId, 'early_bird_voice', 1);
    }
    voiceSessions.set(key, {
      mutedSince: (newState.selfMute || newState.selfDeaf) ? now : null,
      speakingAccMs: 0,
      lastTick: now,
    });
    return;
  }

  if (left) {
    flushVoiceSession(guildId, userId, now);
    voiceSessions.delete(key);
    return;
  }

  if (!inVoice) return;

  let s = voiceSessions.get(key);
  if (!s) {
    s = {
      mutedSince: (newState.selfMute || newState.selfDeaf) ? now : null,
      speakingAccMs: 0,
      lastTick: now,
    };
    voiceSessions.set(key, s);
  }

  const muted = Boolean(newState.selfMute || newState.selfDeaf);
  if (muted) {
    if (s.mutedSince == null) {
      flushVoiceSession(guildId, userId, now);
      s.mutedSince = now;
      s.lastTick = now;
    } else {
      flushVoiceSession(guildId, userId, now);
    }
  } else {
    if (s.mutedSince != null) {
      flushVoiceSession(guildId, userId, now);
      s.mutedSince = null;
      s.lastTick = now;
    } else {
      flushVoiceSession(guildId, userId, now);
    }
  }
}

export function trackRoomCreated(userId, guildId) {
  bumpAchievementProgress(userId, guildId, 'room_organizer', 1);
}

export function trackQuoteUse(userId, guildId) {
  const week = isoWeekKeyServer();
  const prog = getAchievementProgress(userId, guildId, 'quote_of_day');
  const count = prog.meta?.week === week ? (prog.meta.count || 0) : 0;
  const next = count + 1;
  bumpAchievementProgress(userId, guildId, 'quote_of_day', 0, {
    setTo: next,
    meta: { week, count: next },
  });
}

export function trackRpsResult(userId, guildId, won) {
  const prog = getAchievementProgress(userId, guildId, 'rps_streak');
  if (prog.unlocked) return;
  const streak = won ? (prog.progress || 0) + 1 : 0;
  bumpAchievementProgress(userId, guildId, 'rps_streak', 0, {
    setTo: streak,
    force: true,
  });
}

export function trackQuizCorrect(userId, guildId) {
  bumpAchievementProgress(userId, guildId, 'quiz_expert', 1);
}

export function trackLuckyRoll(userId, guildId, value, max = 100) {
  if (value === max) bumpAchievementProgress(userId, guildId, 'lucky_one', 1);
}

export function checkLoyaltyForMember(member) {
  if (!member?.guild || member.user?.bot) return;
  const days = memberDaysOnServer(member);
  const guildId = member.guild.id;
  const userId = member.id;

  if (days >= 7) bumpAchievementProgress(userId, guildId, 'week_veteran', 1);
  if (days >= 30) bumpAchievementProgress(userId, guildId, 'month_veteran', 1);

  if (days === 14) bumpAchievementProgress(userId, guildId, 'birthday_14', 1);
  if (days === 30) bumpAchievementProgress(userId, guildId, 'birthday_30', 1);
  if (days === 90) bumpAchievementProgress(userId, guildId, 'birthday_90', 1);
}

export function trackPresenceUpdate(oldPresence, newPresence) {
  const userId = newPresence?.userId || newPresence?.user?.id;
  const guildId = newPresence?.guild?.id;
  if (!userId || !guildId) return;

  const status = newPresence?.status || 'offline';
  const becameOffline = status === 'offline' || status === 'invisible';
  if (!becameOffline) return;

  const pending = rareGuestPending.get(voiceKey(guildId, userId));
  if (!pending) return;
  if (Date.now() - pending.at <= 10 * 60 * 1000) {
    bumpAchievementProgress(userId, guildId, 'rare_guest', 1);
  }
  rareGuestPending.delete(voiceKey(guildId, userId));
}

function tickVoiceSessions() {
  const now = Date.now();
  for (const key of voiceSessions.keys()) {
    const [guildId, userId] = key.split(':');
    flushVoiceSession(guildId, userId, now);
  }
}

function tickTime333(client) {
  const parts = getServerDateParts();
  const inWindow = parts.hour === 3 && parts.minute === 33;
  if (!inWindow) {
    time333Streak.clear();
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      const online = member.presence?.status
        && member.presence.status !== 'offline'
        && member.presence.status !== 'invisible';
      const inVoice = Boolean(member.voice?.channelId);
      if (!online && !inVoice) {
        time333Streak.delete(voiceKey(guild.id, member.id));
        continue;
      }
      const key = voiceKey(guild.id, member.id);
      const mins = (time333Streak.get(key) || 0) + 1;
      time333Streak.set(key, mins);
      bumpAchievementProgress(member.id, guild.id, 'time_333', 0, { setTo: mins });
    }
  }
}

async function tickLoyaltyAndSilent(client) {
  for (const guild of client.guilds.cache.values()) {
    let members;
    try {
      members = await guild.members.fetch();
    } catch {
      members = guild.members.cache;
    }

    for (const member of members.values()) {
      if (member.user?.bot) continue;
      checkLoyaltyForMember(member);

      const days = memberDaysOnServer(member);
      if (days < 1) continue;

      const joined = member.joinedAt?.getTime?.() || Number(member.joinedTimestamp);
      if (!Number.isFinite(joined)) continue;
      const hoursOnServer = (Date.now() - joined) / 3600000;
      if (hoursOnServer < 24 || hoursOnServer > 48) continue;

      const msgs = getDb().prepare(
        'SELECT COALESCE(SUM(messages), 0) AS n FROM achievement_daily WHERE guild_id = ? AND user_id = ?',
      ).get(gid(guild.id), member.id)?.n || 0;
      const userMsgs = getDb().prepare(
        'SELECT total_messages FROM users WHERE guild_id = ? AND user_id = ?',
      ).get(gid(guild.id), member.id)?.total_messages || 0;

      if (msgs === 0 && userMsgs === 0) {
        bumpAchievementProgress(member.id, guild.id, 'silent_observer', 1);
      }
    }
  }
}

let loopsStarted = false;

export function startAchievementLoops(client) {
  if (loopsStarted || !client) return;
  loopsStarted = true;

  setInterval(() => {
    try {
      tickVoiceSessions();
      tickTime333(client);
    } catch (err) {
      console.error('[ACH] tick:', err.message);
    }
  }, 60_000);

  setInterval(() => {
    tickLoyaltyAndSilent(client).catch((err) => console.error('[ACH] loyalty:', err.message));
  }, 30 * 60_000);

  setTimeout(() => {
    tickLoyaltyAndSilent(client).catch(() => {});
  }, 15_000);
}

// re-export helpers used in tests
export { getServerDateParts as utcDayKeyCompat };
