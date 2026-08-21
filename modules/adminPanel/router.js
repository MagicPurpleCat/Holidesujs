import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { getUserLevel } from '../../utils/permissions.js';
import { AP, normalizeCustomId, parseUserSelectId, parseGrantLevelId, parseModalId, modalId } from './ids.js';
import { requireLevel } from './helpers.js';
import {
  buildHomeView,
  buildUsersSection,
  buildEconSection,
  buildModSection,
  buildServerSection,
  buildStatsSection,
  buildUserPickView,
  buildStatsDetailView,
  buildTopView,
  buildPunishmentsView,
  buildGrantLevelView,
} from './views.js';
import {
  openRevokeList,
  handleRevokeSelect,
  handleGrantLevel,
  giveVerify,
  takeVerify,
  lookupUser,
  clearInfinite,
  showAmountModal,
  showReasonModal,
  handleEconomyModal as runEconomyModal,
  handleDeleteModal,
  handleModAction,
  toggleFeature,
  runSetup,
  runLogs,
} from './actions.js';

const PICK_ACTIONS = new Set([
  'verify_give',
  'verify_take',
  'grant',
  'delete',
  'lookup',
  'add_balance',
  'remove_balance',
  'set_infinite',
  'clear_infinite',
  'add_xp',
  'remove_xp',
  'warn',
  'mute',
  'kick',
  'ban',
  'warns',
]);

const PICK_ID_TO_ACTION = {
  [AP.pick.verifyGive]: 'verify_give',
  [AP.pick.verifyTake]: 'verify_take',
  [AP.pick.grant]: 'grant',
  [AP.pick.deleteUser]: 'delete',
  [AP.pick.lookup]: 'lookup',
  [AP.pick.addBalance]: 'add_balance',
  [AP.pick.removeBalance]: 'remove_balance',
  [AP.pick.setInfinite]: 'set_infinite',
  [AP.pick.clearInfinite]: 'clear_infinite',
  [AP.pick.addXp]: 'add_xp',
  [AP.pick.removeXp]: 'remove_xp',
  [AP.pick.warn]: 'warn',
  [AP.pick.mute]: 'mute',
  [AP.pick.kick]: 'kick',
  [AP.pick.ban]: 'ban',
  [AP.pick.warns]: 'warns',
};

function panelPayload(view) {
  return {
    content: null,
    embeds: view.embeds || (view.embed ? [view.embed] : []),
    components: view.components || [],
  };
}

async function showHome(interaction, userLevel) {
  return interaction.update(panelPayload(buildHomeView(interaction, userLevel)));
}

/**
 * Кнопки, StringSelect, UserSelect админ-панели.
 * @returns {Promise<boolean|void>} false если не наше
 */
export async function handleAdminPanelButtons(interaction) {
  const rawId = interaction.customId || '';
  if (
    !rawId.startsWith('ap:')
    && !rawId.startsWith('ap_')
    && !rawId.startsWith('admin_')
  ) {
    return false;
  }

  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  if (userLevel < 1) {
    await requireLevel(interaction, 1);
    return true;
  }

  // UserSelect
  if (interaction.isUserSelectMenu?.()) {
    const action = parseUserSelectId(rawId);
    if (!action || !PICK_ACTIONS.has(action)) return false;
    const targetId = interaction.values?.[0];
    if (!targetId) return true;
    return handleUserPicked(interaction, action, targetId, userLevel);
  }

  // StringSelect
  if (interaction.isStringSelectMenu?.()) {
    const id = normalizeCustomId(rawId);
    if (id === AP.revokeSelect || rawId === 'ap_revoke_select') {
      return handleRevokeSelect(interaction);
    }
    if (id === AP.featureSelect) {
      return toggleFeature(interaction, interaction.values?.[0]);
    }
    const grantTarget = parseGrantLevelId(rawId);
    if (grantTarget) {
      return handleGrantLevel(interaction, grantTarget, interaction.values?.[0]);
    }
    return false;
  }

  const id = normalizeCustomId(rawId);

  if (id === AP.close) {
    return interaction.update({
      content: 'Панель закрыта.',
      embeds: [],
      components: [],
    });
  }

  if (id === AP.home) {
    return showHome(interaction, userLevel);
  }

  if (id === AP.nav.users) {
    if (!(await requireLevel(interaction, 2))) return true;
    return interaction.update(panelPayload(buildUsersSection(interaction)));
  }
  if (id === AP.nav.econ) {
    if (!(await requireLevel(interaction, 2))) return true;
    return interaction.update(panelPayload(buildEconSection(interaction)));
  }
  if (id === AP.nav.mod) {
    if (!(await requireLevel(interaction, 1))) return true;
    return interaction.update(panelPayload(buildModSection(interaction)));
  }
  if (id === AP.nav.server) {
    if (!(await requireLevel(interaction, 2))) return true;
    return interaction.update(panelPayload(buildServerSection(interaction)));
  }
  if (id === AP.nav.stats) {
    return interaction.update(panelPayload(buildStatsSection(interaction)));
  }

  if (id === AP.statsDetail) {
    return interaction.update(panelPayload(buildStatsDetailView(interaction)));
  }
  if (id === AP.statsTop) {
    return interaction.update(panelPayload(buildTopView(interaction)));
  }
  if (id === AP.statsPunish) {
    return interaction.update(panelPayload(buildPunishmentsView(interaction)));
  }

  if (id === 'ap:revoke_open') {
    return openRevokeList(interaction);
  }

  if (id === AP.setup) {
    return runSetup(interaction);
  }
  if (id === AP.logs) {
    return runLogs(interaction);
  }

  const pickAction = PICK_ID_TO_ACTION[id];
  if (pickAction) {
    const need = ['warn', 'mute', 'kick', 'ban', 'warns'].includes(pickAction) ? 1 : 2;
    if (!(await requireLevel(interaction, need))) return true;
    return interaction.update(panelPayload(buildUserPickView(interaction, pickAction)));
  }

  return false;
}

async function handleUserPicked(interaction, action, targetId, userLevel) {
  if (action === 'verify_give') return giveVerify(interaction, targetId);
  if (action === 'verify_take') return takeVerify(interaction, targetId);
  if (action === 'lookup') return lookupUser(interaction, targetId);
  if (action === 'clear_infinite') return clearInfinite(interaction, targetId);
  if (action === 'grant') {
    if (!(await requireLevel(interaction, 2))) return true;
    return interaction.update(panelPayload(buildGrantLevelView(interaction, targetId)));
  }
  if (action === 'warns') {
    // сразу показать — без модалки
    return handleModAction(interaction, 'warns', targetId, { useUpdate: true });
  }

  if (action === 'add_balance') {
    return showAmountModal(interaction, 'add_balance', targetId, 'Начислить баланс', 'Сумма ⚡HLD');
  }
  if (action === 'remove_balance') {
    return showAmountModal(interaction, 'remove_balance', targetId, 'Списать баланс', 'Сумма ⚡HLD');
  }
  if (action === 'set_infinite') {
    return showAmountModal(interaction, 'set_infinite', targetId, '∞ баланс', 'Значение баланса');
  }
  if (action === 'add_xp') {
    return showAmountModal(interaction, 'add_xp', targetId, 'Начислить XP', 'Количество XP');
  }
  if (action === 'remove_xp') {
    return showAmountModal(interaction, 'remove_xp', targetId, 'Снять XP', 'Количество XP');
  }

  if (action === 'delete') {
    const modal = new ModalBuilder()
      .setCustomId(modalId('delete', targetId))
      .setTitle('Удалить пользователя');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_reason')
          .setLabel('Причина')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
    );
    return interaction.showModal(modal);
  }

  if (action === 'warn') {
    return showReasonModal(interaction, 'warn', targetId, 'Предупреждение');
  }
  if (action === 'kick') {
    return showReasonModal(interaction, 'kick', targetId, 'Кик');
  }
  if (action === 'ban') {
    return showReasonModal(interaction, 'ban', targetId, 'Бан');
  }
  if (action === 'mute') {
    return showReasonModal(interaction, 'mute', targetId, 'Мут', [
      {
        id: 'ap_duration',
        label: 'Минуты',
        placeholder: '60',
        required: true,
      },
    ]);
  }

  return true;
}

/** Модалки новой и legacy-схемы */
export async function handleAdminPanelModal(interaction) {
  const customId = interaction.customId || '';

  // New: ap:modal:action:userId
  const parsed = parseModalId(customId);
  if (parsed) {
    const { action, targetId } = parsed;
    if (!targetId) return false;

    if (['add_balance', 'remove_balance', 'set_infinite', 'add_xp', 'remove_xp'].includes(action)) {
      const amount = parseInt(interaction.fields.getTextInputValue('ap_amount'), 10);
      return runEconomyModal(interaction, action, targetId, amount);
    }
    if (action === 'delete') {
      const reason = interaction.fields.getTextInputValue('ap_reason');
      return handleDeleteModal(interaction, targetId, reason);
    }
    if (['warn', 'kick', 'ban', 'mute'].includes(action)) {
      const reason = interaction.fields.getTextInputValue('ap_reason') || '';
      let durationMinutes;
      if (action === 'mute') {
        durationMinutes = parseInt(interaction.fields.getTextInputValue('ap_duration'), 10);
      }
      return handleModAction(interaction, action, targetId, { reason, durationMinutes });
    }
    return false;
  }

  return false;
}

// ─── Legacy modal wrappers (старые customId из открытых панелей) ──

export async function handleGrantModal(interaction) {
  if (interaction.customId !== 'ap_grant_modal') {
    return handleAdminPanelModal(interaction);
  }
  const targetId = interaction.fields.getTextInputValue('ap_target_user').trim();
  const level = interaction.fields.getTextInputValue('ap_target_level').trim();
  // emulate select flow
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fake = {
    ...interaction,
    values: [level],
    update: async (p) => interaction.editReply(p),
    reply: async (p) => interaction.editReply(p),
  };
  return handleGrantLevel(fake, targetId, level);
}

export async function handleDeleteUserModal(interaction) {
  if (interaction.customId === 'ap_delete_modal') {
    const targetId = interaction.fields.getTextInputValue('ap_delete_target').trim();
    const reason = interaction.fields.getTextInputValue('ap_delete_reason').trim();
    return handleDeleteModal(interaction, targetId, reason);
  }
  return handleAdminPanelModal(interaction);
}

export async function handleUnverifyModal(interaction) {
  if (interaction.customId === 'ap_unverify_modal') {
    const targetId = interaction.fields.getTextInputValue('ap_unverify_target').trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fakeUpdate = {
      ...interaction,
      update: (p) => interaction.editReply(p),
      reply: (p) => interaction.editReply(p),
    };
    return takeVerify(fakeUpdate, targetId);
  }
  return handleAdminPanelModal(interaction);
}

export async function handleGiveVerifyModal(interaction) {
  if (interaction.customId === 'ap_give_verify_modal') {
    const targetId = interaction.fields.getTextInputValue('ap_give_verify_target').trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fakeUpdate = {
      ...interaction,
      update: (p) => interaction.editReply(p),
      reply: (p) => interaction.editReply(p),
    };
    return giveVerify(fakeUpdate, targetId);
  }
  return handleAdminPanelModal(interaction);
}

export async function handleEconomyModalLegacy(interaction) {
  const map = {
    ap_add_balance_modal: 'add_balance',
    ap_remove_balance_modal: 'remove_balance',
    ap_set_infinite_modal: 'set_infinite',
    ap_clear_infinite_modal: 'clear_infinite',
    ap_add_xp_modal: 'add_xp',
    ap_remove_xp_modal: 'remove_xp',
  };
  const action = map[interaction.customId];
  if (!action) return handleAdminPanelModal(interaction);

  const targetId = interaction.fields.getTextInputValue('ap_econ_target').trim();
  if (action === 'clear_infinite') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fake = {
      ...interaction,
      update: (p) => interaction.editReply(p),
      reply: (p) => interaction.editReply(p),
    };
    return clearInfinite(fake, targetId);
  }
  const amount = parseInt(interaction.fields.getTextInputValue('ap_econ_amount').trim(), 10);
  return runEconomyModal(interaction, action, targetId, amount);
}

export async function handleModerationModal(interaction) {
  const map = {
    ap_warn_modal: 'warn',
    ap_mute_modal: 'mute',
    ap_kick_modal: 'kick',
    ap_ban_modal: 'ban',
    ap_warns_modal: 'warns',
  };
  const action = map[interaction.customId];
  if (!action) return handleAdminPanelModal(interaction);

  const targetId = interaction.fields.getTextInputValue('ap_mod_target').trim();
  if (action === 'warns') {
    return handleModAction(interaction, 'warns', targetId);
  }
  const reason = interaction.fields.getTextInputValue('ap_mod_reason')?.trim() || '';
  let durationMinutes;
  if (action === 'mute') {
    durationMinutes = parseInt(interaction.fields.getTextInputValue('ap_mod_duration').trim(), 10);
  }
  return handleModAction(interaction, action, targetId, { reason, durationMinutes });
}

/** Alias used by interactions.js */
export { handleEconomyModalLegacy as handleEconomyModal };
