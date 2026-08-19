import { SlashCommandBuilder } from 'discord.js';
import { getDb, getUser, addCoins } from '../database.js';
import { checkEconomyAchievements } from '../modules/progress.js';
import { brandEmbed, COLOR, fmtHld, guildFooter, replyWait } from '../utils/ui.js';

const COOLDOWN_MS = 60 * 60 * 1000;
const JOBS = [
  { name: 'Доставка пиццы', line: 'Провёз пять коробок и не съел ни одной.', min: 40, max: 90 },
  { name: 'Смена на кассе', line: 'Пробил чипсы, энергетики и чью-то подписку.', min: 50, max: 110 },
  { name: 'Помощь на сервере', line: 'Починил войсовую, пока никто не видел.', min: 60, max: 130 },
  { name: 'Стрим клипов', line: 'Смонтировал хайлайты и получил донат.', min: 45, max: 120 },
  { name: 'Ночная охрана', line: 'Досмотрел до утра пустой канал AFK.', min: 70, max: 150 },
];

export default {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Подработка: 40–150 ⚡HLD раз в час'),

  async execute(interaction) {
    const user = getUser(interaction.user.id, interaction.guildId);
    if (user.last_work_at) {
      const last = new Date(user.last_work_at + (user.last_work_at.includes('Z') ? '' : 'Z')).getTime();
      const wait = COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) {
        const mins = Math.ceil(wait / 60000);
        return replyWait(interaction, `Следующая смена через **${mins} мин.**`);
      }
    }

    const job = JOBS[Math.floor(Math.random() * JOBS.length)];
    const pay = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
    addCoins(interaction.user.id, pay, interaction.guildId);
    getDb().prepare(
      "UPDATE users SET last_work_at = datetime('now') WHERE guild_id = ? AND user_id = ?",
    ).run(interaction.guildId, interaction.user.id);
    checkEconomyAchievements(interaction.user.id, interaction.guildId);
    const updated = getUser(interaction.user.id, interaction.guildId);

    const embed = brandEmbed({
      color: COLOR.gold,
      title: job.name,
      description: `${job.line}\n\nЗаработано ${fmtHld(pay)}`,
      footer: guildFooter(interaction, 'следующая смена через 1 час'),
    }).addFields({ name: 'Баланс', value: fmtHld(updated.balance), inline: true });

    await interaction.reply({ embeds: [embed] });
  },
};
