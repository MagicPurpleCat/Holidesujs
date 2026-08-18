import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_FEATURES, getGuildConfig, setGuildFeature } from '../utils/guildConfig.js';
import { getUserLevel } from '../utils/permissions.js';

const FEATURE_CHOICES = Object.keys(DEFAULT_FEATURES).map((key) => ({ name: key, value: key }));

function canManageFeatures(interaction) {
  return Boolean(
    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || getUserLevel(interaction.user.id, interaction.guild) >= 2,
  );
}

function featuresEmbed(guildId) {
  const features = getGuildConfig(guildId).features || {};
  const lines = Object.keys(DEFAULT_FEATURES).map((key) => {
    const on = features[key] !== false;
    return `${on ? '✅' : '❌'} **${key}**`;
  });
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎛 Фичи сервера')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Меняй через /фичи set' });
}

export default {
  data: new SlashCommandBuilder()
    .setName('фичи')
    .setDescription('🎛 Включить или выключить модули бота на этом сервере')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Показать состояние фич')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Включить или выключить фичу')
        .addStringOption((opt) =>
          opt
            .setName('фича')
            .setDescription('Название модуля')
            .setRequired(true)
            .addChoices(...FEATURE_CHOICES)
        )
        .addBooleanOption((opt) =>
          opt.setName('включено').setDescription('true — включить, false — выключить').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!canManageFeatures(interaction)) {
      return interaction.reply({
        content: '❌ Нужны права администратора или уровень Admin.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      return interaction.reply({
        embeds: [featuresEmbed(interaction.guildId)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const feature = interaction.options.getString('фича');
    const enabled = interaction.options.getBoolean('включено');
    const ok = setGuildFeature(interaction.guildId, feature, enabled);
    if (!ok) {
      return interaction.reply({
        content: '❌ Неизвестная фича.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `${enabled ? '✅' : '❌'} Фича **${feature}** ${enabled ? 'включена' : 'выключена'}.`,
      embeds: [featuresEmbed(interaction.guildId)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
