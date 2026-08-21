/**
 * /marry — единая панель брака Holidesu.
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ensureUser } from '../database.js';
import { buildHomeView } from '../modules/marriage/views.js';

export {
  handleMarryButton,
  handleMarriagePanelInteraction,
  handleMarriageModal,
} from '../modules/marriage/router.js';

export default {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Брак: предложение, семейный банк, развод'),

  async execute(interaction) {
    try {
      if (!interaction.guild) {
        return interaction.reply({
          content: '❌ Брак доступен только на сервере.',
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
      console.error('[MARRY]', error);
      const payload = { content: '❌ Ошибка меню брака.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
