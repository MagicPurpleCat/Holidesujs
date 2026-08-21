import { getDb } from '../../database.js';
import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { brandEmbed, COLOR, guildFooter } from '../../utils/ui.js';
import { CL } from './ids.js';

export function getMemberClan(db, userId, guildId) {
  if (!guildId) return null;
  return db.prepare(`
    SELECT c.*, m.role AS member_role
    FROM clan_members m
    JOIN clans c ON c.clan_id = m.clan_id
    WHERE m.user_id = ? AND c.guild_id = ?
  `).get(userId, guildId);
}

export function findClanByTag(db, tag, guildId) {
  if (!guildId || !tag) return null;
  return db.prepare(
    'SELECT * FROM clans WHERE tag = ? COLLATE NOCASE AND guild_id = ?',
  ).get(String(tag).toUpperCase(), guildId);
}

export function clanPower(db, clanId, guildId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS members,
      COALESCE(SUM(u.level), 0) AS levels,
      COALESCE(SUM(u.total_xp), 0) AS xp
    FROM clan_members m
    JOIN users u ON u.user_id = m.user_id AND u.guild_id = ?
    WHERE m.clan_id = ?
  `).get(guildId, clanId);
  return row || { members: 0, levels: 0, xp: 0 };
}

export function clanScore(power) {
  return (power.levels || 0) + Math.floor((power.xp || 0) / 1000);
}

export function listMembers(db, clanId) {
  return db.prepare(`
    SELECT user_id, role, joined_at FROM clan_members WHERE clan_id = ?
    ORDER BY CASE role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, joined_at
  `).all(clanId);
}

export function isLeader(clan) {
  return Boolean(clan && (clan.member_role === 'leader' || clan.owner_id === clan.user_id));
}

export function canManageInvites(clan) {
  return Boolean(clan && (clan.member_role === 'leader' || clan.member_role === 'officer' || clan.owner_id));
}

export function canLead(clan, userId) {
  return Boolean(
    clan
    && (clan.owner_id === userId || clan.member_role === 'leader'),
  );
}

export function canOfficerOrLead(clan, userId) {
  return Boolean(
    clan
    && (clan.owner_id === userId
      || clan.member_role === 'leader'
      || clan.member_role === 'officer'),
  );
}

export function roleLabel(role) {
  if (role === 'leader') return '👑 Лидер';
  if (role === 'officer') return '⭐ Офицер';
  return 'Участник';
}

export function navFooter(interaction, section) {
  return guildFooter(interaction, `клан · ${section}`);
}

export function backCloseRow(backId = CL.home) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CL.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
  );
}

export function resultView(interaction, {
  title,
  description,
  color = COLOR.success,
  section = 'клан',
  backNav = CL.home,
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

export function denyView(interaction, text, backNav = CL.home) {
  return resultView(interaction, {
    title: 'Не получилось',
    description: text,
    color: COLOR.danger,
    section: 'ошибка',
    backNav,
  });
}

export async function safeReply(interaction, payload, { ephemeral = true } = {}) {
  const body = {
    ...payload,
    ...(ephemeral && !interaction.deferred && !interaction.replied
      ? { flags: MessageFlags.Ephemeral }
      : {}),
  };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ ...body, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply(body);
}

export function boostLine(clan) {
  if (!clan?.farm_boost_until) return 'Буст фарма: нет';
  const raw = clan.farm_boost_until;
  const ts = Date.parse(raw.includes('Z') || raw.includes('+') ? raw : `${raw}Z`);
  if (!Number.isFinite(ts) || ts < Date.now()) return 'Буст фарма: истёк';
  return `Буст фарма: до <t:${Math.floor(ts / 1000)}:f>`;
}

export function getDbSafe() {
  return getDb();
}
