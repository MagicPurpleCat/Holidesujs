import { SlashCommandBuilder } from 'discord.js';
import { getDb, ensureUser, getUser, addCoins, runInTransaction, gid } from '../database.js';
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

function parseWorkTime(value) {
  if (!value) return 0;
  return new Date(value + (String(value).includes('Z') ? '' : 'Z')).getTime();
}

export function claimWork(userId, guildId) {
  const job = JOBS[Math.floor(Math.random() * JOBS.length)];
  const pay = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
  const g = gid(guildId);

  return runInTransaction(() => {
    const db = getDb();
    const row = db.prepare(
      'SELECT last_work_at, balance FROM users WHERE guild_id = ? AND user_id = ?',
    ).get(g, userId);

    if (!row) throw new Error('NO_USER');

    const last = parseWorkTime(row.last_work_at);
    if (last && Date.now() - last < COOLDOWN_MS) {
      const err = new Error('COOLDOWN');
      err.waitMs = COOLDOWN_MS - (Date.now() - last);
      throw err;
    }

    db.prepare(`
      UPDATE users
      SET last_work_at = datetime('now'), balance = balance + ?
      WHERE guild_id = ? AND user_id = ?
    `).run(pay, g, userId);

    return { job, pay, balance: (row.balance || 0) + pay };
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Подработка: 40–150 ⚡HLD раз в час'),

  async execute(interaction) {
    ensureUser(interaction.user.id, interaction.guildId);

    try {
      const result = claimWork(interaction.user.id, interaction.guildId);
      checkEconomyAchievements(interaction.user.id, interaction.guildId);

      const embed = brandEmbed({
        color: COLOR.gold,
        title: result.job.name,
        description: `${result.job.line}\n\nЗаработано ${fmtHld(result.pay)}`,
        footer: guildFooter(interaction, 'следующая смена через 1 час'),
      }).addFields({ name: 'Баланс', value: fmtHld(result.balance), inline: true });

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      if (err.message === 'COOLDOWN') {
        const mins = Math.ceil((err.waitMs || COOLDOWN_MS) / 60000);
        return replyWait(interaction, `Следующая смена через **${mins} мин.**`);
      }
      throw err;
    }
  },
};
