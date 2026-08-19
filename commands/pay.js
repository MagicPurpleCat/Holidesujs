import { SlashCommandBuilder } from 'discord.js';
import { getUser, removeCoins, addCoins, runInTransaction } from '../database.js';
import { brandEmbed, COLOR, fmtHld, guildFooter, replyFail } from '../utils/ui.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Перевести ⚡HLD другому участнику')
    .addUserOption((opt) =>
      opt.setName('пользователь').setDescription('Кому отправить').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('сумма').setDescription('Сколько ⚡HLD').setRequired(true).setMinValue(1)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const amount = interaction.options.getInteger('сумма');
    const fromId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!target) return replyFail(interaction, 'Укажи пользователя.');
    if (target.bot) return replyFail(interaction, 'Ботам ⚡HLD не нужны.');
    if (target.id === fromId) return replyFail(interaction, 'Себе переводить нельзя.');

    const sender = getUser(fromId, guildId);
    if (sender.balance < amount) {
      return replyFail(interaction, `Не хватает. У тебя ${fmtHld(sender.balance)}.`);
    }

    try {
      runInTransaction(() => {
        if (!removeCoins(fromId, amount, guildId)) {
          throw new Error('NO_FUNDS');
        }
        addCoins(target.id, amount, guildId);
      });
    } catch (err) {
      if (err.message === 'NO_FUNDS') {
        return replyFail(interaction, 'Не хватает ⚡HLD.');
      }
      throw err;
    }

    const updated = getUser(fromId, guildId);
    const embed = brandEmbed({
      color: COLOR.success,
      title: 'Перевод',
      description: `<@${fromId}> → <@${target.id}>\n${fmtHld(amount)}`,
      thumbnail: target.displayAvatarURL({ size: 128 }),
      footer: guildFooter(interaction, 'pay'),
    }).addFields({ name: 'Твой баланс', value: fmtHld(updated.balance), inline: true });

    await interaction.reply({ embeds: [embed] });
  },
};
