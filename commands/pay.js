import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUser, removeCoins, addCoins, runInTransaction } from '../database.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('💸 Перевести ⚡HLD другому участнику')
    .addUserOption((opt) =>
      opt.setName('пользователь').setDescription('Кому перевести').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('сумма').setDescription('Сколько ⚡HLD').setRequired(true).setMinValue(1)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('пользователь');
    const amount = interaction.options.getInteger('сумма');
    const fromId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!target) {
      return interaction.reply({ content: '❌ Укажи пользователя.', flags: MessageFlags.Ephemeral });
    }
    if (target.bot) {
      return interaction.reply({ content: '❌ Нельзя переводить боту.', flags: MessageFlags.Ephemeral });
    }
    if (target.id === fromId) {
      return interaction.reply({ content: '❌ Нельзя перевести деньги самому себе.', flags: MessageFlags.Ephemeral });
    }

    const sender = getUser(fromId, guildId);
    if (sender.balance < amount) {
      return interaction.reply({
        content: `❌ Недостаточно ⚡HLD. У тебя: **${sender.balance} ⚡HLD**.`,
        flags: MessageFlags.Ephemeral,
      });
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
        return interaction.reply({
          content: '❌ Недостаточно ⚡HLD.',
          flags: MessageFlags.Ephemeral,
        });
      }
      throw err;
    }

    const updated = getUser(fromId, guildId);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('💸 Перевод')
      .setDescription(`<@${fromId}> отправил **${amount} ⚡HLD** пользователю <@${target.id}>.`)
      .addFields({ name: '💳 Твой баланс', value: `**${updated.balance} ⚡HLD**`, inline: true });

    await interaction.reply({ embeds: [embed] });
  },
};
