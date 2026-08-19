import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb } from '../database.js';
import { isoWeekKey, getSeasonTop, seasonScore } from '../modules/progress.js';
import { getGuildConfig, initGuildConfig, clearGuildConfigCache } from '../utils/guildConfig.js';
import { getUserLevel } from '../utils/permissions.js';
import { brandEmbed, COLOR, fmtNum, guildFooter, replyFail } from '../utils/ui.js';

function msUntilNextWeek() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (8 - day)));
  next.setUTCHours(0, 0, 0, 0);
  return Math.max(0, next.getTime() - Date.now());
}

export default {
  data: new SlashCommandBuilder()
    .setName('сезон')
    .setDescription('Недельный топ. Админ может задать роль 1 места')
    .addRoleOption((opt) =>
      opt.setName('роль_победителя').setDescription('Роль за первое место недели').setRequired(false)
    ),

  async execute(interaction) {
    const winnerRole = interaction.options.getRole('роль_победителя');
    if (winnerRole) {
      const isAdmin = Boolean(
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
        || getUserLevel(interaction.user.id, interaction.guild) >= 2,
      );
      if (!isAdmin) {
        return replyFail(interaction, 'Роль победителя задаёт только администратор.');
      }
      initGuildConfig(interaction.guildId);
      const db = getDb();
      const row = db.prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(interaction.guildId);
      let channels = {};
      try {
        channels = JSON.parse(row?.channels || '{}');
      } catch {
        channels = {};
      }
      channels.season_role = winnerRole.id;
      db.prepare('UPDATE server_config SET channels = ? WHERE guild_id = ?')
        .run(JSON.stringify(channels), interaction.guildId);
      clearGuildConfigCache(interaction.guildId);
    }

    const top = getSeasonTop(interaction.guildId, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((u, i) => {
      const place = medals[i] || `\`${i + 1}.\``;
      const score = Math.round(seasonScore(u));
      return `${place} <@${u.user_id}> — **${fmtNum(score)}** · ${fmtNum(u.season_xp)} XP · ${fmtNum(u.season_messages)} сообщ. · ${fmtNum(u.season_voice)} мин`;
    });
    const left = msUntilNextWeek();
    const hours = Math.floor(left / 3600000);
    const cfg = getGuildConfig(interaction.guildId);
    const roleLine = cfg.seasonRoleId ? `\nРоль 1 места: <@&${cfg.seasonRoleId}>` : '';

    const embed = brandEmbed({
      color: COLOR.gold,
      title: `Сезон ${isoWeekKey()}`,
      description: lines.length ? lines.join('\n') : 'Пока никто не набрал очков.',
      footer: guildFooter(interaction, `сброс ~${hours} ч · топ-3: 1500 / 1000 / 500 ⚡HLD`),
    });
    if (roleLine) {
      embed.addFields({ name: 'Награда лидера', value: roleLine.trim(), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
