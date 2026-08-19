// ============================================================================
// Команда: /server-stats — статистика сервера картинкой (top-10 + график роста)
// ============================================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { getDb } from '../database.js';
import { utcDayKey } from '../modules/progress.js';
import { overallScore } from '../modules/score.js';
import { generateServerStatsImage } from '../modules/canvas-server-stats.js';
import { fmtNum } from '../utils/ui.js';

async function mkUserCard(guild, id) {
  let member = guild?.members?.cache?.get(id);
  if (!member && guild?.members?.fetch) {
    member = await guild.members.fetch(id).catch(() => null);
  }
  return {
    name: member?.displayName || id,
    avatarUrl: member?.displayAvatarURL?.({ size: 128, extension: 'png' }) || null,
  };
}

async function buildTopLists({ guild, db }) {
  const guildId = guild.id;

  const baseWhere = 'WHERE is_infinite_balance = 0 AND guild_id = ?';

  const balanceTop = db.prepare(
    `SELECT user_id, balance FROM users ${baseWhere} ORDER BY balance DESC LIMIT 10`,
  ).all(guildId);

  const xpTop = db.prepare(
    `SELECT user_id, total_xp FROM users ${baseWhere} ORDER BY total_xp DESC LIMIT 10`,
  ).all(guildId);

  const messagesTop = db.prepare(
    `SELECT user_id, total_messages FROM users ${baseWhere} ORDER BY total_messages DESC LIMIT 10`,
  ).all(guildId);

  const voiceTop = db.prepare(
    `SELECT user_id, total_voice_minutes FROM users ${baseWhere} ORDER BY total_voice_minutes DESC LIMIT 10`,
  ).all(guildId);

  const reputationTop = db.prepare(
    `SELECT user_id, total_reactions_received FROM users ${baseWhere} ORDER BY total_reactions_received DESC LIMIT 10`,
  ).all(guildId);

  const allForOverall = db.prepare(
    `
      SELECT user_id, balance, total_xp, total_messages, total_voice_minutes, total_reactions_received
      FROM users
      ${baseWhere}
    `,
  ).all(guildId);

  const overallSorted = allForOverall
    .map((u) => ({ user_id: u.user_id, score: overallScore(u), balance: u.balance }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    overallTop: await Promise.all(
      overallSorted.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${Math.round(u.score).toLocaleString('ru-RU')}` };
      }),
    ),
    balanceTop: await Promise.all(
      balanceTop.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${fmtNum(u.balance)} ⚡HLD` };
      }),
    ),
    xpTop: await Promise.all(
      xpTop.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${fmtNum(u.total_xp)} ⚡` };
      }),
    ),
    messagesTop: await Promise.all(
      messagesTop.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${fmtNum(u.total_messages)} 💬` };
      }),
    ),
    voiceTop: await Promise.all(
      voiceTop.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${fmtNum(u.total_voice_minutes)} мин` };
      }),
    ),
    reputationTop: await Promise.all(
      reputationTop.map(async (u) => {
        const card = await mkUserCard(guild, u.user_id);
        return { ...card, value: `${fmtNum(u.total_reactions_received)} 👍` };
      }),
    ),
  };
}

async function buildChartPoints({ db, guildId, days }) {
  const dayTo = utcDayKey();
  const dateTo = new Date();
  const startDate = new Date(dateTo.getTime() - (days - 1) * 86400000);

  const startKey = utcDayKey(startDate);

  const rows = db.prepare(
    `
      SELECT day_key, avg_overall_score
      FROM server_stats_daily
      WHERE guild_id = ? AND day_key >= ?
      ORDER BY day_key ASC
    `,
  ).all(guildId, startKey);

  const map = new Map(rows.map((r) => [r.day_key, Number(r.avg_overall_score || 0)]));

  const points = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    const key = utcDayKey(d);
    const v = map.get(key) ?? 0;
    // label: MM-DD
    const label = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    points.push({ label, value: v });
  }
  return points;
}

export default {
  data: new SlashCommandBuilder()
    .setName('server-stats')
    .setDescription('Статистика сервера картинкой: топ-10 и рост рейтинга'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const db = getDb();
    const guild = interaction.guild;
    const guildId = guild.id;

    // summary
    const membersCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE guild_id = ? AND is_infinite_balance = 0',
    ).get(guildId).cnt;

    const voiceMinutes = db.prepare(
      'SELECT SUM(total_voice_minutes) as total FROM users WHERE guild_id = ? AND is_infinite_balance = 0',
    ).get(guildId).total || 0;

    const messagesCount = db.prepare(
      'SELECT SUM(total_messages) as total FROM users WHERE guild_id = ? AND is_infinite_balance = 0',
    ).get(guildId).total || 0;

    const overallForAvg = db.prepare(
      `
        SELECT user_id, balance, total_xp, total_messages, total_voice_minutes, total_reactions_received
        FROM users
        WHERE guild_id = ? AND is_infinite_balance = 0
      `,
    ).all(guildId);

    const avgOverall = overallForAvg.length
      ? overallForAvg.reduce((acc, u) => acc + overallScore(u), 0) / overallForAvg.length
      : 0;

    const topLists = await buildTopLists({ guild, db });
    const days = 14;
    const chartPoints = await buildChartPoints({ db, guildId, days });

    const imageBuffer = await generateServerStatsImage({
      overallTop: topLists.overallTop,
      balanceTop: topLists.balanceTop,
      xpTop: topLists.xpTop,
      messagesTop: topLists.messagesTop,
      voiceTop: topLists.voiceTop,
      reputationTop: topLists.reputationTop,
      chartPoints,
      summary: {
        guildName: guild.name,
        membersCount,
        voiceMinutes,
        messagesCount,
        avgOverall,
      },
    });

    if (!imageBuffer) {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('📊 Статистика сервера')
        .setDescription('Canvas недоступен. Показываю краткую статистику текстом.')
        .addFields(
          { name: '👥 Пользователей', value: `${membersCount}`, inline: true },
          { name: '🎙 Минут в голосе', value: `${fmtNum(voiceMinutes)}`, inline: true },
          { name: '💬 Сообщений', value: `${fmtNum(messagesCount)}`, inline: true },
          { name: '🌟 Средний рейтинг', value: `${Math.round(avgOverall).toLocaleString('ru-RU')}`, inline: true },
        );
      return interaction.editReply({ embeds: [embed] });
    }

    const attachment = new AttachmentBuilder(imageBuffer, { name: 'server-stats.png' });
    return interaction.editReply({ files: [attachment] });
  },
};

