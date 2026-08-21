import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getDb, gid, getEphemeral, setEphemeral, deleteEphemeral } from '../../database.js';
import { brandEmbed, COLOR, guildFooter } from '../../utils/ui.js';
import { MR, PROPOSAL_TTL_MS, proposalKey } from './ids.js';

export function navFooter(interaction, section) {
  return guildFooter(interaction, `брак · ${section}`);
}

export function backCloseRow(backId = MR.home) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(MR.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
  );
}

export function resultView(interaction, {
  title,
  description,
  color = COLOR.success,
  section = 'брак',
  backNav = MR.home,
} = {}) {
  return {
    content: null,
    embeds: [
      brandEmbed({
        color,
        title,
        description,
        footer: navFooter(interaction, section),
      }),
    ],
    components: [backCloseRow(backNav)],
  };
}

export function denyView(interaction, text, backNav = MR.home) {
  return resultView(interaction, {
    title: 'Не получилось',
    description: text,
    color: COLOR.danger,
    section: 'ошибка',
    backNav,
  });
}

export function mark(ok) {
  return ok ? '●' : '○';
}

/** Настройки приватности брака (user_settings). */
export function getOrCreateUserSettings(userId) {
  const db = getDb();
  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }
  return settings;
}

export function getMarriagePrivacy(userId) {
  const s = getOrCreateUserSettings(userId);
  return {
    allowProposals: Boolean(s.allow_marriage_requests),
    showInProfile: Boolean(s.show_relationship),
  };
}

export function toggleMarriagePrivacy(userId, field) {
  const map = {
    proposals: 'allow_marriage_requests',
    profile: 'show_relationship',
  };
  const col = map[field];
  if (!col) return getMarriagePrivacy(userId);
  getOrCreateUserSettings(userId);
  const db = getDb();
  const row = db.prepare(`SELECT ${col} AS v FROM user_settings WHERE user_id = ?`).get(userId);
  const next = row?.v ? 0 : 1;
  db.prepare(`UPDATE user_settings SET ${col} = ? WHERE user_id = ?`).run(next, userId);
  return getMarriagePrivacy(userId);
}

export function getMarriageStatus(userId, guildId) {
  const db = getDb();
  const g = gid(guildId);
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, userId);
  const pending = findActiveProposalInvolvingUser(guildId, userId);
  const record = getMarriageRecord(guildId, userId);

  return {
    user,
    pending,
    record,
    partnerId: user?.relationship_partner_id || null,
    married: user?.relationship_status === 'married' && Boolean(user.relationship_partner_id),
  };
}

export function getMarriageRecord(guildId, userId) {
  const db = getDb();
  const g = gid(guildId);
  return db.prepare(`
    SELECT * FROM relationships
    WHERE guild_id = ? AND status = 'married'
      AND (user1_id = ? OR user2_id = ?)
    ORDER BY married_at DESC
    LIMIT 1
  `).get(g, userId, userId);
}

export function listMarriageHistory(guildId, userId, limit = 8) {
  const db = getDb();
  const g = gid(guildId);
  return db.prepare(`
    SELECT * FROM relationships
    WHERE guild_id = ? AND (user1_id = ? OR user2_id = ?)
    ORDER BY COALESCE(divorced_at, married_at) DESC
    LIMIT ?
  `).all(g, userId, userId, limit);
}

function parseProposalKey(key) {
  const parts = String(key || '').split(':');
  if (parts.length < 4 || parts[0] !== 'marry') return null;
  return { guildId: parts[1], proposerId: parts[2], targetId: parts[3] };
}

export function findActiveProposalInvolvingUser(guildId, userId) {
  const db = getDb();
  const now = Date.now();
  db.prepare('DELETE FROM ephemeral_state WHERE expires_at <= ?').run(now);
  const rows = db.prepare(
    'SELECT key, payload, expires_at FROM ephemeral_state WHERE expires_at > ? AND key LIKE ?',
  ).all(now, `marry:${guildId}:%`);

  for (const row of rows) {
    const parsed = parseProposalKey(row.key);
    if (!parsed) continue;
    if (parsed.proposerId !== userId && parsed.targetId !== userId) continue;
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch {
      payload = {};
    }
    return { ...parsed, key: row.key, payload, expiresAt: row.expires_at };
  }
  return null;
}

export function getActiveProposal(guildId, proposerId, targetId) {
  const key = proposalKey(guildId, proposerId, targetId);
  const payload = getEphemeral(key);
  if (!payload) return null;
  return { key, guildId, proposerId, targetId, payload };
}

export function storeProposal(guildId, proposerId, targetId, extra = {}) {
  const key = proposalKey(guildId, proposerId, targetId);
  setEphemeral(key, { proposerId, targetId, ...extra }, PROPOSAL_TTL_MS);
  return key;
}

export function clearProposal(guildId, proposerId, targetId) {
  deleteEphemeral(proposalKey(guildId, proposerId, targetId));
}

export function marriedAtUnix(record) {
  if (!record?.married_at) return null;
  const raw = record.married_at;
  const ts = Date.parse(raw.includes('Z') || raw.includes('+') ? raw : `${raw}Z`);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

export function daysTogether(record) {
  const unix = marriedAtUnix(record);
  if (!unix) return null;
  return Math.max(0, Math.floor((Date.now() / 1000 - unix) / 86400));
}

export function ephemeralPayload(view) {
  return { ...view, flags: MessageFlags.Ephemeral };
}
