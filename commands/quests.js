import { SlashCommandBuilder } from 'discord.js';
import {
  QUEST_GOALS,
  QUEST_BASE_REWARD,
  QUEST_STREAK_BONUS,
  getTodayQuest,
  questComplete,
  claimDailyQuest,
  utcDayKey,
} from '../modules/progress.js';
import { getDb } from '../database.js';
import { brandEmbed, COLOR, countBar, fmtHld, guildFooter, replyFail, replyDone } from '../utils/ui.js';

export default {
  data: new SlashCommandBuilder()
    .setName('квесты')
    .setDescription('Ежедневные задания, стрик и награда')
    .addSubcommand((sub) => sub.setName('статус').setDescription('Прогресс за сегодня'))
    .addSubcommand((sub) => sub.setName('забрать').setDescription('Забрать награду, если всё готово')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const row = getTodayQuest(userId, guildId);
    const streak = getDb().prepare(
      'SELECT streak FROM daily_streaks WHERE guild_id = ? AND user_id = ?',
    ).get(guildId, userId)?.streak || 0;

    if (sub === 'забрать') {
      const result = claimDailyQuest(userId, guildId);
      if (!result.ok) {
        return replyFail(
          interaction,
          result.reason === 'already'
            ? 'Награда за сегодня уже у тебя.'
            : 'Сначала закрой все три задания.',
        );
      }
      return replyDone(
        interaction,
        `${fmtHld(result.reward)}\nСтрик: **${result.streak}** дн.`,
        { title: 'Квесты сданы', ephemeral: false, footer: guildFooter(interaction, 'квесты') },
      );
    }

    const nextReward = QUEST_BASE_REWARD + Math.min(7, (streak || 0) + 1) * QUEST_STREAK_BONUS;
    const done = questComplete(row);
    const embed = brandEmbed({
      color: done ? COLOR.success : COLOR.accent,
      title: 'Ежедневные квесты',
      description: `День **${utcDayKey()}** UTC · стрик **${streak}**`,
      footer: guildFooter(interaction, 'три задания · один забор в сутки'),
    }).addFields(
      { name: 'Сообщения', value: countBar(row.messages, QUEST_GOALS.messages), inline: true },
      { name: 'Войс', value: countBar(row.voice_minutes, QUEST_GOALS.voice_minutes), inline: true },
      { name: 'Казино', value: countBar(row.casino_bets, QUEST_GOALS.casino_bets), inline: true },
      {
        name: 'Награда',
        value: row.claimed ? 'Уже получена сегодня' : `${fmtHld(nextReward)} — \`/квесты забрать\``,
        inline: false,
      },
    );
    await interaction.reply({ embeds: [embed] });
  },
};
