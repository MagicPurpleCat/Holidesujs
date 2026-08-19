import { SlashCommandBuilder } from 'discord.js';
import { getUser } from '../database.js';
import { brandEmbed, COLOR, fmtHld, fmtNum, guildFooter } from '../utils/ui.js';

export default {
  data: new SlashCommandBuilder()
    .setName('баланс')
    .setDescription('Баланс ⚡HLD, уровень и минуты в войсе')
    .addUserOption((opt) =>
      opt.setName('пользователь').setDescription('Чей баланс показать').setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('пользователь') ?? interaction.user;
    const user = getUser(target.id, interaction.guildId);
    const amount = user.is_infinite_balance ? `∞ ${fmtHld(user.balance)}` : fmtHld(user.balance);

    const embed = brandEmbed({
      color: COLOR.gold,
      title: `${target.displayName}`,
      thumbnail: target.displayAvatarURL({ size: 256 }),
      footer: guildFooter(interaction, 'баланс считается на этом сервере'),
    }).addFields(
      { name: '⚡HLD', value: amount, inline: true },
      { name: 'Уровень', value: `**${fmtNum(user.level)}**`, inline: true },
      { name: 'Войс', value: `**${fmtNum(user.total_voice_minutes)}** мин`, inline: true },
    );

    await interaction.reply({ embeds: [embed] });
  },
};
