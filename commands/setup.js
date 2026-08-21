/**
 * /setup — хаб настройки сервера Holidesu.
 */

import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isPrimaryGuild } from '../utils/singleGuild.js';
import { initGuildConfig } from '../utils/guildConfig.js';
import { buildHomeView } from '../modules/setup/views.js';

export {
  handleSetupInteraction,
  handleSetupPanelInteraction,
  handleSetupModal,
} from '../modules/setup/router.js';

/** Для админ-панели: открыть хаб setup (update ephemeral). */
export async function showSetupModal(interaction) {
  initGuildConfig(interaction.guildId);
  const view = buildHomeView(interaction);
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    return interaction.update({
      content: null,
      embeds: view.embeds,
      components: view.components,
    });
  }
  return interaction.reply({
    embeds: view.embeds,
    components: view.components,
    flags: MessageFlags.Ephemeral,
  });
}

export function checkAndCreateTable() {
  /* table created in database.js migrations */
}

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Настройка сервера: каналы, роли, владелец')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!isPrimaryGuild(interaction.guildId)) {
      return interaction.reply({
        content: '❌ Этот бот обслуживает только основной сервер (`GUILD_ID`).',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ Нужно право «Управлять сервером».',
        flags: MessageFlags.Ephemeral,
      });
    }

    initGuildConfig(interaction.guildId);
    const view = buildHomeView(interaction);
    return interaction.reply({
      embeds: view.embeds,
      components: view.components,
      flags: MessageFlags.Ephemeral,
    });
  },
};
