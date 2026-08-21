import { MessageFlags } from 'discord.js';
import { MR } from './ids.js';
import {
  buildHomeView,
  buildBankView,
  buildProposePickView,
  buildDivorceConfirmView,
  buildHistoryView,
  buildSettingsView,
} from './views.js';
import {
  showDepositModal,
  showWithdrawModal,
  depositFamily,
  withdrawFamily,
  sendProposal,
  cancelOwnProposal,
  confirmDivorce,
  handleMarryButton,
} from './actions.js';
import { toggleMarriagePrivacy } from './helpers.js';

function payload(view) {
  return {
    content: view.content ?? null,
    embeds: view.embeds || [],
    components: view.components || [],
  };
}

/**
 * Панель брака (mr:…) + публичные кнопки предложения.
 * @returns {Promise<boolean>}
 */
export async function handleMarriagePanelInteraction(interaction) {
  const id = interaction.customId || '';

  if (
    id.startsWith(MR.acceptPrefix)
    || id.startsWith(MR.rejectPrefix)
    || id.startsWith('marry_')
  ) {
    return handleMarryButton(interaction);
  }

  if (!id.startsWith('mr:')) return false;

  if (interaction.isUserSelectMenu?.()) {
    if (id === MR.proposeUser) {
      const target = interaction.users?.first?.() || null;
      await sendProposal(interaction, target);
      return true;
    }
    return false;
  }

  if (interaction.isButton?.()) {
    if (id === MR.close) {
      await interaction.update({ content: 'Меню брака закрыто.', embeds: [], components: [] });
      return true;
    }
    if (id === MR.home) {
      await interaction.update(payload(buildHomeView(interaction)));
      return true;
    }
    if (id === MR.nav.bank) {
      await interaction.update(payload(buildBankView(interaction)));
      return true;
    }
    if (id === MR.proposePick || id === MR.nav.propose) {
      await interaction.update(payload(buildProposePickView(interaction)));
      return true;
    }
    if (id === MR.nav.divorce) {
      await interaction.update(payload(buildDivorceConfirmView(interaction)));
      return true;
    }
    if (id === MR.nav.history) {
      await interaction.update(payload(buildHistoryView(interaction)));
      return true;
    }
    if (id === MR.nav.settings) {
      await interaction.update(payload(buildSettingsView(interaction)));
      return true;
    }
    if (id === MR.set.proposals) {
      toggleMarriagePrivacy(interaction.user.id, 'proposals');
      await interaction.update(payload(buildSettingsView(interaction)));
      return true;
    }
    if (id === MR.set.profile) {
      toggleMarriagePrivacy(interaction.user.id, 'profile');
      await interaction.update(payload(buildSettingsView(interaction)));
      return true;
    }
    if (id === MR.deposit) {
      await showDepositModal(interaction);
      return true;
    }
    if (id === MR.withdraw) {
      await showWithdrawModal(interaction);
      return true;
    }
    if (id === MR.cancelProposal) {
      await cancelOwnProposal(interaction);
      return true;
    }
    if (id === MR.divorceConfirm) {
      await confirmDivorce(interaction);
      return true;
    }
  }

  return false;
}

export async function handleMarriageModal(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('mr:modal:')) return false;

  if (id === MR.modalDeposit) {
    await depositFamily(interaction, interaction.fields.getTextInputValue('amount'));
    return true;
  }
  if (id === MR.modalWithdraw) {
    await withdrawFamily(interaction, interaction.fields.getTextInputValue('amount'));
    return true;
  }
  return false;
}

export { handleMarryButton };
