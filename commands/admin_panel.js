/**
 * Slash /панель — хаб администрирования Holidesu.
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';
import { buildHomeView } from '../modules/adminPanel/views.js';

export {
  handleAdminPanelButtons,
  handleGrantModal,
  handleDeleteUserModal,
  handleUnverifyModal,
  handleGiveVerifyModal,
  handleEconomyModal,
  handleModerationModal,
  handleAdminPanelModal,
} from '../modules/adminPanel/router.js';

export default {
  data: new SlashCommandBuilder()
    .setName('панель')
    .setDescription('Админ-центр: экономика, права, модерация, сервер'),

  async execute(interaction) {
    const userLevel = getUserLevel(interaction.user.id, interaction.guild);

    if (userLevel < 1) {
      return interaction.reply({
        content: '❌ У тебя недостаточно прав для админ-панели.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const view = buildHomeView(interaction, userLevel);
    return interaction.reply({
      embeds: view.embeds,
      components: view.components,
      flags: MessageFlags.Ephemeral,
    });
  },
};
