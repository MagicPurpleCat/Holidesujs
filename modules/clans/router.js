import { MessageFlags } from 'discord.js';
import { CL } from './ids.js';
import {
  buildHomeView,
  buildMembersView,
  buildBankView,
  buildShopView,
  buildWarView,
  buildManageView,
  buildLeaveConfirmView,
  buildTopView,
  buildUserPickView,
} from './views.js';
import {
  showCreateModal,
  showDepositModal,
  showWarTagModal,
  createClan,
  deposit,
  sendInvite,
  acceptInvite,
  rejectInvite,
  leaveClan,
  kickMember,
  setMemberRole,
  buyShopItem,
  compareClans,
  challengeWar,
  handleClanWarButton,
} from './actions.js';

function payload(view) {
  return {
    content: view.content ?? null,
    embeds: view.embeds || [],
    components: view.components || [],
  };
}

/**
 * Кнопки / select / user-select кланового хаба (cl:…).
 * @returns {Promise<boolean>}
 */
export async function handleClanPanelInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('cl:') && !id.startsWith('clan_war_')) return false;

  if (id.startsWith('clan_war_')) {
    return handleClanWarButton(interaction);
  }

  if (id.startsWith(CL.inviteAcceptPrefix)) {
    await acceptInvite(interaction, id.slice(CL.inviteAcceptPrefix.length));
    return true;
  }
  if (id.startsWith(CL.inviteRejectPrefix)) {
    await rejectInvite(interaction, id.slice(CL.inviteRejectPrefix.length));
    return true;
  }

  if (interaction.isUserSelectMenu?.()) {
    const target = interaction.users?.first?.() || null;
    const targetId = interaction.values?.[0];
    if (id === CL.inviteUser) {
      await sendInvite(interaction, target);
      return true;
    }
    if (id === CL.kickUser) {
      await kickMember(interaction, targetId);
      return true;
    }
    if (id === CL.promoteUser) {
      await setMemberRole(interaction, targetId, 'officer');
      return true;
    }
    if (id === CL.demoteUser) {
      await setMemberRole(interaction, targetId, 'member');
      return true;
    }
    return false;
  }

  if (interaction.isStringSelectMenu?.()) {
    if (id === CL.warSelect) {
      await compareClans(interaction, interaction.values?.[0], { byId: true });
      return true;
    }
    return false;
  }

  if (interaction.isButton?.()) {
    if (id === CL.close) {
      await interaction.update({ content: 'Клан-меню закрыто.', embeds: [], components: [] });
      return true;
    }
    if (id === CL.home) {
      await interaction.update(payload(buildHomeView(interaction)));
      return true;
    }
    if (id === CL.nav.members) {
      await interaction.update(payload(buildMembersView(interaction)));
      return true;
    }
    if (id === CL.nav.bank) {
      await interaction.update(payload(buildBankView(interaction)));
      return true;
    }
    if (id === CL.nav.shop) {
      await interaction.update(payload(buildShopView(interaction)));
      return true;
    }
    if (id === CL.nav.war) {
      await interaction.update(payload(buildWarView(interaction)));
      return true;
    }
    if (id === CL.nav.manage) {
      await interaction.update(payload(buildManageView(interaction)));
      return true;
    }
    if (id === CL.nav.top || id === CL.nav.browse) {
      await interaction.update(payload(buildTopView(interaction)));
      return true;
    }
    if (id === CL.create) {
      await showCreateModal(interaction);
      return true;
    }
    if (id === CL.deposit) {
      await showDepositModal(interaction);
      return true;
    }
    if (id === CL.leave) {
      await interaction.update(payload(buildLeaveConfirmView(interaction)));
      return true;
    }
    if (id === CL.leaveConfirm) {
      await leaveClan(interaction);
      return true;
    }
    if (id === CL.invitePick) {
      await interaction.update(payload(buildUserPickView(
        interaction,
        CL.inviteUser,
        'Пригласить в клан',
        'Выбери пользователя на сервере.',
      )));
      return true;
    }
    if (id === CL.kickPick) {
      await interaction.update(payload(buildUserPickView(
        interaction,
        CL.kickUser,
        'Исключить',
        'Кого исключить из клана?',
      )));
      return true;
    }
    if (id === CL.promotePick) {
      await interaction.update(payload(buildUserPickView(
        interaction,
        CL.promoteUser,
        'Повысить до офицера',
        'Кого назначить офицером?',
      )));
      return true;
    }
    if (id === CL.demotePick) {
      await interaction.update(payload(buildUserPickView(
        interaction,
        CL.demoteUser,
        'Понизить до участника',
        'Кого понизить?',
      )));
      return true;
    }
    if (id.startsWith(CL.shopPrefix)) {
      await buyShopItem(interaction, id.slice(CL.shopPrefix.length));
      return true;
    }
    if (id === CL.warCompare) {
      await showWarTagModal(interaction, false);
      return true;
    }
    if (id === CL.warChallenge) {
      await showWarTagModal(interaction, true);
      return true;
    }
  }

  return false;
}

export async function handleClanModal(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('cl:modal:')) return false;

  if (id === CL.modalCreate) {
    await createClan(
      interaction,
      interaction.fields.getTextInputValue('name'),
      interaction.fields.getTextInputValue('tag'),
    );
    return true;
  }
  if (id === CL.modalDeposit) {
    await deposit(interaction, interaction.fields.getTextInputValue('amount'));
    return true;
  }
  if (id === CL.modalWar) {
    await compareClans(interaction, interaction.fields.getTextInputValue('tag'));
    return true;
  }
  if (id === `${CL.modalWar}:stake`) {
    const tag = interaction.fields.getTextInputValue('tag');
    const stake = interaction.fields.getTextInputValue('stake');
    const { getDb } = await import('../../database.js');
    const { findClanByTag } = await import('./helpers.js');
    const opp = findClanByTag(getDb(), tag, interaction.guildId);
    if (!opp) {
      await interaction.reply({ content: '❌ Клан не найден.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await challengeWar(interaction, opp.clan_id, stake);
    return true;
  }
  if (id.startsWith(CL.modalWarStake)) {
    const oppId = id.slice(CL.modalWarStake.length);
    await challengeWar(interaction, oppId, interaction.fields.getTextInputValue('stake'));
    return true;
  }

  return false;
}

export { handleClanWarButton };
