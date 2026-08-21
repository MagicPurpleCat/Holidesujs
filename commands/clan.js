/**
 * /clan — единая панель кланов Holidesu.
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ensureUser } from '../database.js';
import { buildHomeView } from '../modules/clans/views.js';

export {
  handleClanWarButton,
  handleClanPanelInteraction,
  handleClanModal,
} from '../modules/clans/router.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Кланы: создать, банк, магазин, войны, управление'),

  async execute(interaction) {
    try {
      if (!interaction.guild) {
        return interaction.reply({
          content: '❌ Только на сервере.',
          flags: MessageFlags.Ephemeral,
        });
      }

      ensureUser(interaction.user.id, interaction.guildId);
      const view = buildHomeView(interaction);
      return interaction.reply({
        embeds: view.embeds,
        components: view.components,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('[CLAN]', error);
      const payload = { content: '❌ Ошибка клановой команды.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
