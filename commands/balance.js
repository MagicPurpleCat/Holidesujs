import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUser } from '../database.js';

export default {
  data: new SlashCommandBuilder()
    .setName('баланс')
    .setDescription('💰 Показывает твой баланс ⚡HLD')
    .addUserOption((opt) =>
      opt.setName('пользователь').setDescription('Посмотреть баланс другого пользователя').setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('пользователь') ?? interaction.user;
    const user = getUser(target.id, interaction.guildId);

    let balanceDisplay;
    if (user.is_infinite_balance) {
      balanceDisplay = `♾️ **${user.balance} ⚡HLD**`;
    } else {
      balanceDisplay = `**${user.balance} ⚡HLD**`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`💰 Баланс — ${target.displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: '⚡HLD', value: balanceDisplay, inline: true },
        { name: '🎚 Уровень', value: `${user.level}`, inline: true },
        { name: '🎙 Минут в голосе', value: `${user.total_voice_minutes}`, inline: true },
      )
      .setFooter({ text: 'Баланс считается отдельно на каждом сервере.' });

    await interaction.reply({ embeds: [embed] });
  },
};
