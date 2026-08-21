import { LG } from './ids.js';
import {
  buildHomeView,
  buildLevelView,
  buildChannelsView,
  buildPingsView,
} from './views.js';
import {
  runQuickSetup,
  applyLevel,
  applyChannel,
  togglePingFlag,
  turnOff,
} from './actions.js';

function payload(view) {
  return {
    content: view.content ?? null,
    embeds: view.embeds || [],
    components: view.components || [],
  };
}

/**
 * Хаб /логи (lg:…).
 * @returns {Promise<boolean>}
 */
export async function handleLogsPanelInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('lg:')) return false;

  if (interaction.isStringSelectMenu?.()) {
    if (id === LG.levelSelect) {
      await applyLevel(interaction, interaction.values?.[0]);
      return true;
    }
    return false;
  }

  if (interaction.isChannelSelectMenu?.()) {
    if (id === LG.channelFallback) {
      await applyChannel(interaction, 'fallback', interaction.values?.[0]);
      return true;
    }
    if (id === LG.channelAll) {
      await applyChannel(interaction, 'all', interaction.values?.[0]);
      return true;
    }
    if (id === LG.channelImportant) {
      await applyChannel(interaction, 'important', interaction.values?.[0]);
      return true;
    }
    if (id === LG.channelModeration) {
      await applyChannel(interaction, 'moderation', interaction.values?.[0]);
      return true;
    }
    return false;
  }

  if (interaction.isButton?.()) {
    if (id === LG.close) {
      await interaction.update({ content: 'Меню логов закрыто.', embeds: [], components: [] });
      return true;
    }
    if (id === LG.home) {
      await interaction.update(payload(buildHomeView(interaction)));
      return true;
    }
    if (id === LG.nav.level) {
      await interaction.update(payload(buildLevelView(interaction)));
      return true;
    }
    if (id === LG.nav.channels) {
      await interaction.update(payload(buildChannelsView(interaction)));
      return true;
    }
    if (id === LG.nav.pings) {
      await interaction.update(payload(buildPingsView(interaction)));
      return true;
    }
    if (id === LG.quickSetup) {
      await runQuickSetup(interaction);
      return true;
    }
    if (id === LG.togglePingTarget) {
      await togglePingFlag(interaction, 'target');
      return true;
    }
    if (id === LG.togglePingActor) {
      await togglePingFlag(interaction, 'actor');
      return true;
    }
    if (id === LG.disable) {
      await turnOff(interaction);
      return true;
    }
  }

  return false;
}
