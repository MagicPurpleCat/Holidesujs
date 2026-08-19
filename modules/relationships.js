// === Модуль брака и развода (по серверам) ===
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, gid, ensureUser, setEphemeral, getEphemeral, deleteEphemeral, runInTransaction } from '../database.js';
import { unlockAchievement, getOrCreateFamilyBank, splitFamilyBank, familyPair } from './progress.js';
import { COLOR, fmtHld, guildFooter } from '../utils/ui.js';

export const PROPOSAL_TTL_MS = 60_000;

export function proposalKey(guildId, proposerId, targetId) {
  return `marry:${guildId}:${proposerId}:${targetId}`;
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
  const prefix = `marry:${guildId}:`;
  const rows = db.prepare(
    'SELECT key, payload FROM ephemeral_state WHERE expires_at > ? AND key LIKE ?',
  ).all(now, `${prefix}%`);

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
    return { ...parsed, key: row.key, payload };
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

export function buildProposalEmbed(proposer, target, expiresAt) {
  const unix = Math.floor(expiresAt / 1000);
  return new EmbedBuilder()
    .setColor(COLOR.pink)
    .setAuthor({
      name: proposer.displayName || proposer.username,
      iconURL: proposer.displayAvatarURL({ size: 128 }),
    })
    .setTitle('💍 Предложение руки и сердца')
    .setDescription(
      `**${proposer.displayName || proposer.username}** предлагает пожениться с **${target.displayName || target.username}**.\n\n` +
      `Ответить может только <@${target.id}>.\n` +
      `Истекает <t:${unix}:R> (<t:${unix}:t>).`,
    )
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Holidesu · marry' });
}

export function buildExpiredProposalEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR.dark)
    .setTitle('⏰ Предложение истекло')
    .setDescription('Время вышло. Можно отправить новое предложение через `/marry`.');
}

export function buildWeddingEmbed(proposerId, targetId, guildName) {
  return new EmbedBuilder()
    .setColor(COLOR.pink)
    .setTitle('💞 Свадьба состоялась!')
    .setDescription(
      `<@${proposerId}> и <@${targetId}> теперь в браке на **${guildName}**!\n\n` +
      '💕 Открыт семейный счёт — `/семья банк`\n' +
      '🎤 Вместе в войсе фарм **+15%**',
    )
    .setFooter({ text: `${guildName} · Holidesu` });
}

function recordMarriage(guildId, proposerId, targetId) {
  const db = getDb();
  const g = gid(guildId);
  const [user1Id, user2Id] = familyPair(proposerId, targetId);

  runInTransaction(() => {
    db.prepare(`
      UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(targetId, g, proposerId);
    db.prepare(`
      UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(proposerId, g, targetId);

    db.prepare(`
      INSERT INTO relationships (guild_id, user1_id, user2_id, status, married_at)
      VALUES (?, ?, ?, 'married', datetime('now'))
    `).run(g, user1Id, user2Id);

    getOrCreateFamilyBank(guildId, proposerId, targetId);
  });

  unlockAchievement(proposerId, guildId, 'first_marriage');
  unlockAchievement(targetId, guildId, 'first_marriage');
}

export async function handleMarryButton(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('marry_')) return false;

  try {
    const parts = customId.split('_');
    const action = parts[1];
    const proposerId = parts[2];
    const targetId = parts[3];
    const guildId = interaction.guildId;

    if (!guildId || !proposerId || !targetId || !['accept', 'reject'].includes(action)) {
      await interaction.reply({
        content: '❌ Некорректное предложение.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.user.id !== targetId) {
      await interaction.reply({
        content: '❌ Только тот, кому сделали предложение, может ответить.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const proposal = getActiveProposal(guildId, proposerId, targetId);
    if (!proposal) {
      await interaction.update({
        embeds: [buildExpiredProposalEmbed()],
        components: [],
      }).catch(async () => {
        await interaction.reply({
          content: '⏰ Это предложение уже истекло или было отменено.',
          flags: MessageFlags.Ephemeral,
        });
      });
      return true;
    }

    const db = getDb();
    const g = gid(guildId);
    ensureUser(proposerId, guildId);
    ensureUser(targetId, guildId);

    const proposer = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, proposerId);
    const target = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, targetId);

    if (proposer?.relationship_status === 'married' || target?.relationship_status === 'married') {
      clearProposal(guildId, proposerId, targetId);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR.dark)
            .setTitle('💔 Предложение недействительно')
            .setDescription('Один из участников уже состоит в браке.'),
        ],
        components: [],
      });
      return true;
    }

    clearProposal(guildId, proposerId, targetId);

    if (action === 'accept') {
      recordMarriage(guildId, proposerId, targetId);
      const embed = buildWeddingEmbed(proposerId, targetId, interaction.guild?.name || 'сервер');
      await interaction.update({ embeds: [embed], components: [] });
      return true;
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR.danger)
      .setTitle('💔 Предложение отклонено')
      .setDescription(
        `<@${targetId}> отклонил(а) предложение <@${proposerId}>.\n\n` +
        'Можно попробовать снова позже.',
      )
      .setFooter({ text: guildFooter(interaction, 'marry') });

    await interaction.update({ embeds: [embed], components: [] });
    return true;
  } catch (error) {
    console.error('[RELATIONSHIPS] Ошибка кнопки:', error);
    await interaction.reply({
      content: '❌ Не удалось обработать ответ. Попробуй ещё раз.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
}

export function divorceUser(userId, guildId = '') {
  try {
    const db = getDb();
    const g = gid(guildId);
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, userId);
    if (!user || user.relationship_status !== 'married') {
      return { success: false, reason: 'not_married' };
    }

    const partnerId = user.relationship_partner_id;
    let split = { each: 0, leftover: 0 };
    if (partnerId) split = splitFamilyBank(guildId, userId, partnerId);

    const [user1Id, user2Id] = familyPair(userId, partnerId || userId);

    runInTransaction(() => {
      db.prepare(`
        UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL
        WHERE guild_id = ? AND user_id = ?
      `).run(g, userId);
      if (partnerId) {
        db.prepare(`
          UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL
          WHERE guild_id = ? AND user_id = ?
        `).run(g, partnerId);
      }

      db.prepare(`
        UPDATE relationships SET status = 'divorced', divorced_at = datetime('now')
        WHERE guild_id = ? AND user1_id = ? AND user2_id = ? AND status = 'married'
      `).run(g, user1Id, user2Id);
    });

    return { success: true, partnerId, split };
  } catch (error) {
    console.error('[RELATIONSHIPS] Ошибка развода:', error);
    return { success: false, reason: 'error' };
  }
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
