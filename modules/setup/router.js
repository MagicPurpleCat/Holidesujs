import { SU } from './ids.js';
import {
  buildHomeView,
  buildChannelsView,
  buildChannelSetView,
  buildRolesView,
  buildOwnerView,
} from './views.js';
import {
  showOwnerModal,
  saveOwnerModal,
  saveOwnerUser,
  saveChannel,
  clearChannel,
  saveAdminRoles,
  saveVerifiedRole,
  saveSeasonRole,
} from './actions.js';
import { handleWizardInteraction } from './wizard.js';

function payload(view) {
  return {
    content: view.content ?? null,
    embeds: view.embeds || [],
    components: view.components || [],
  };
}

/**
 * Хаб /setup (su:…) + мастер su:wiz:…
 * @returns {Promise<boolean>}
 */
export async function handleSetupPanelInteraction(interaction) {
  const id = interaction.customId || '';

  // Legacy linear wizard IDs — keep working if mid-session
  if (
    id === 'setup_modal'
    || id === 'setup_select_roles'
    || id.startsWith('setup_channel_')
    || id === 'setup_season_role'
    || id === 'setup_skip_ticket'
    || id === 'setup_skip_season'
  ) {
    const { handleLegacySetupInteraction } = await import('./legacy.js');
    return handleLegacySetupInteraction(interaction);
  }

  if (!id.startsWith('su:')) return false;

  if (id.startsWith('su:wiz:')) {
    return handleWizardInteraction(interaction);
  }

  if (interaction.isUserSelectMenu?.()) {
    if (id === SU.ownerUser) {
      await saveOwnerUser(interaction, interaction.values?.[0]);
      return true;
    }
    return false;
  }

  if (interaction.isStringSelectMenu?.()) {
    if (id === SU.channelPick) {
      const key = interaction.values?.[0];
      await interaction.update(payload(buildChannelSetView(interaction, key)));
      return true;
    }
    return false;
  }

  if (interaction.isChannelSelectMenu?.()) {
    if (id.startsWith(SU.channelSetPrefix)) {
      const key = id.slice(SU.channelSetPrefix.length);
      await saveChannel(interaction, key, interaction.values?.[0]);
      return true;
    }
    return false;
  }

  if (interaction.isRoleSelectMenu?.()) {
    if (id === SU.rolesAdmin) {
      await saveAdminRoles(interaction, interaction.values);
      return true;
    }
    if (id === SU.rolesVerified) {
      await saveVerifiedRole(interaction, interaction.values?.[0]);
      return true;
    }
    if (id === SU.rolesSeason) {
      await saveSeasonRole(interaction, interaction.values?.[0]);
      return true;
    }
    return false;
  }

  if (interaction.isButton?.()) {
    if (id === SU.close) {
      await interaction.update({ content: 'Настройка закрыта.', embeds: [], components: [] });
      return true;
    }
    if (id === SU.home) {
      await interaction.update(payload(buildHomeView(interaction)));
      return true;
    }
    if (id === SU.nav.channels) {
      await interaction.update(payload(buildChannelsView(interaction)));
      return true;
    }
    if (id === SU.nav.roles) {
      await interaction.update(payload(buildRolesView(interaction)));
      return true;
    }
    if (id === SU.nav.owner) {
      await interaction.update(payload(buildOwnerView(interaction)));
      return true;
    }
    if (id === SU.ownerPick) {
      await showOwnerModal(interaction);
      return true;
    }
    if (id.startsWith(SU.channelClearPrefix)) {
      await clearChannel(interaction, id.slice(SU.channelClearPrefix.length));
      return true;
    }
    if (id === SU.wizardStart) {
      return handleWizardInteraction(interaction);
    }
  }

  return false;
}

export async function handleSetupModal(interaction) {
  const id = interaction.customId || '';
  if (id === SU.modalOwner) {
    await saveOwnerModal(interaction);
    return true;
  }
  if (id === 'setup_modal') {
    const { handleLegacySetupInteraction } = await import('./legacy.js');
    return handleLegacySetupInteraction(interaction);
  }
  return false;
}

export { handleSetupPanelInteraction as handleSetupInteraction };
