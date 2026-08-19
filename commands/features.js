import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_FEATURES, getGuildConfig, setGuildFeature } from '../utils/guildConfig.js';
import { getUserLevel } from '../utils/permissions.js';
import { COLOR, replyFail } from '../utils/ui.js';

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
    return `${on ? '●' : '○'}  **${key}**`;
  });
  return new EmbedBuilder()
    .setColor(COLOR.accent)
    .setTitle('Модули сервера')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Holidesu · /фичи set' });
}

export default {
  data: new SlashCommandBuilder()
    .setName('фичи')
    .setDescription('Включить или выключить модули бота')
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
      return replyFail(interaction, 'Нужны права администратора.');
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
      return replyFail(interaction, 'Неизвестная фича.');
    }

    await interaction.reply({
      content: null,
      embeds: [
        featuresEmbed(interaction.guildId).setTitle(
          enabled ? `Включено · ${feature}` : `Выключено · ${feature}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
