import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, ensureUser, getEphemeral, setEphemeral } from '../database.js';
import { checkEconomyAchievements } from '../modules/progress.js';
import { COLOR } from '../utils/ui.js';

const COOLDOWN_MS = 60 * 60 * 1000;
const DAILY_CAP = 20;

function utcDateKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

async function giveRep(interaction) {
  const target = interaction.options.getUser('пользователь') || interaction.options.getUser('user');
  const fromId = interaction.user.id;

  if (!target) {
    return interaction.reply({ content: '❌ Укажи пользователя.', flags: MessageFlags.Ephemeral });
  }
  if (target.bot) {
    return interaction.reply({ content: '❌ Нельзя выдать репутацию боту.', flags: MessageFlags.Ephemeral });
  }
  if (target.id === fromId) {
    return interaction.reply({ content: '❌ Нельзя повышать репутацию самому себе.', flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId;
  const pairKey = `rep:${guildId}:${fromId}:${target.id}`;
  const last = getEphemeral(pairKey);
  const lastAt = last?.at || 0;
  const wait = COOLDOWN_MS - (Date.now() - lastAt);
  if (wait > 0) {
    const mins = Math.ceil(wait / 60000);
    return interaction.reply({
      content: `⏰ Этому пользователю можно снова дать репутацию через **${mins} мин.**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const dayKey = `rep_daily:${guildId}:${fromId}:${utcDateKey()}`;
  const daily = getEphemeral(dayKey);
  const givenToday = daily?.count || 0;
  if (givenToday >= DAILY_CAP) {
    return interaction.reply({
      content: `❌ Лимит: не больше **${DAILY_CAP}** репутаций в сутки.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  ensureUser(fromId, interaction.guildId);
  ensureUser(target.id, interaction.guildId);
  db.prepare(`
    UPDATE users SET total_reactions_received = COALESCE(total_reactions_received, 0) + 1
    WHERE guild_id = ? AND user_id = ?
  `).run(interaction.guildId, target.id);

  setEphemeral(pairKey, { at: Date.now() }, COOLDOWN_MS);
  const dayMsLeft = (() => {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(60_000, next - now.getTime());
  })();
  setEphemeral(dayKey, { count: givenToday + 1 }, dayMsLeft);
  checkEconomyAchievements(target.id, interaction.guildId);

  const row = db.prepare('SELECT total_reactions_received FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(COLOR.aqua)
    .setTitle('Репутация')
    .setDescription(`<@${fromId}> отметил <@${target.id}>\nСейчас **${row.total_reactions_received}**`)
    .setFooter({ text: 'Holidesu · раз в час одному человеку' });

  await interaction.reply({ embeds: [embed] });
}

export default {
  data: new SlashCommandBuilder()
    .setName('реп')
    .setDescription('Плюс к репутации. Не себе, раз в час')
    .addUserOption((opt) =>
      opt.setName('пользователь').setDescription('Кому дать репутацию').setRequired(true)
    ),
  execute: giveRep,
};

export const repAlias = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Плюс к репутации. Не себе, раз в час')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Кому дать репутацию').setRequired(true)
    ),
  execute: giveRep,
};
