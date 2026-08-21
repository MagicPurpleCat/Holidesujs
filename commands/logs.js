/**
 * /логи — единая панель логирования Holidesu.
 */

import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildHomeView } from '../modules/logs/views.js';

export { handleLogsPanelInteraction } from '../modules/logs/router.js';

export default {
  data: new SlashCommandBuilder()
    .setName('логи')
    .setDescription('Логи сервера: каналы, уровень, пинги')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ Нужно право «Управлять сервером».',
        flags: MessageFlags.Ephemeral,
      });
    }

    const view = buildHomeView(interaction);
    return interaction.reply({
      embeds: view.embeds,
      components: view.components,
      flags: MessageFlags.Ephemeral,
    });
  },
};
