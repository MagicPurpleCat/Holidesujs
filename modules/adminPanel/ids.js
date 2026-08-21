/**
 * Единые customId админ-панели (префикс ap:).
 * Старые ap_ / admin_ мапятся в router.
 */

export const AP = {
  home: 'ap:home',
  close: 'ap:close',
  nav: {
    users: 'ap:nav:users',
    econ: 'ap:nav:econ',
    mod: 'ap:nav:mod',
    server: 'ap:nav:server',
    stats: 'ap:nav:stats',
  },
  // Действия → экран выбора пользователя
  pick: {
    verifyGive: 'ap:pick:verify_give',
    verifyTake: 'ap:pick:verify_take',
    grant: 'ap:pick:grant',
    deleteUser: 'ap:pick:delete',
    lookup: 'ap:pick:lookup',
    addBalance: 'ap:pick:add_balance',
    removeBalance: 'ap:pick:remove_balance',
    setInfinite: 'ap:pick:set_infinite',
    clearInfinite: 'ap:pick:clear_infinite',
    addXp: 'ap:pick:add_xp',
    removeXp: 'ap:pick:remove_xp',
    warn: 'ap:pick:warn',
    mute: 'ap:pick:mute',
    kick: 'ap:pick:kick',
    ban: 'ap:pick:ban',
    warns: 'ap:pick:warns',
  },
  // UserSelect: ap:user:<action>
  userPrefix: 'ap:user:',
  // StringSelect уровней после выбора цели: ap:grant_level:<userId>
  grantLevelPrefix: 'ap:grant_level:',
  revokeSelect: 'ap:revoke_select',
  featureSelect: 'ap:feature_select',
  setup: 'ap:setup',
  logs: 'ap:logs',
  statsDetail: 'ap:stats:detail',
  statsTop: 'ap:stats:top',
  statsPunish: 'ap:stats:punish',
  // Модалки: ap:modal:<action> или ap:modal:<action>:<userId>
  modalPrefix: 'ap:modal:',
};

export const LEGACY_MAP = Object.freeze({
  ap_close: AP.close,
  ap_back: AP.home,
  ap_give_verify: AP.pick.verifyGive,
  admin_remove_verify: AP.pick.verifyTake,
  ap_unverify: AP.pick.verifyTake,
  admin_give_perm: AP.pick.grant,
  ap_grant_perms: AP.pick.grant,
  ap_revoke_perms: 'ap:revoke_open',
  ap_delete_user: AP.pick.deleteUser,
  ap_add_balance: AP.pick.addBalance,
  ap_remove_balance: AP.pick.removeBalance,
  ap_set_infinite: AP.pick.setInfinite,
  ap_clear_infinite: AP.pick.clearInfinite,
  ap_add_xp: AP.pick.addXp,
  ap_remove_xp: AP.pick.removeXp,
  ap_moderation: AP.nav.mod,
  ap_setup: AP.setup,
  admin_stats: AP.statsDetail,
  ap_server_stats: AP.statsDetail,
  ap_top_activity: AP.statsTop,
  ap_warn: AP.pick.warn,
  ap_mute: AP.pick.mute,
  ap_kick: AP.pick.kick,
  ap_ban: AP.pick.ban,
  ap_warns: AP.pick.warns,
  ap_revoke_select: AP.revokeSelect,
});

export function normalizeCustomId(customId) {
  if (!customId) return '';
  if (customId.startsWith('ap:')) return customId;
  return LEGACY_MAP[customId] || customId;
}

export function parseUserSelectId(customId) {
  if (!customId?.startsWith(AP.userPrefix)) return null;
  return customId.slice(AP.userPrefix.length);
}

export function parseGrantLevelId(customId) {
  if (!customId?.startsWith(AP.grantLevelPrefix)) return null;
  return customId.slice(AP.grantLevelPrefix.length);
}

export function parseModalId(customId) {
  if (!customId?.startsWith(AP.modalPrefix)) return null;
  const rest = customId.slice(AP.modalPrefix.length);
  const parts = rest.split(':');
  if (parts.length === 1) return { action: parts[0], targetId: null };
  if (parts.length >= 2) {
    return { action: parts[0], targetId: parts.slice(1).join(':') };
  }
  return null;
}

export function modalId(action, targetId = null) {
  return targetId ? `${AP.modalPrefix}${action}:${targetId}` : `${AP.modalPrefix}${action}`;
}

export function userSelectId(action) {
  return `${AP.userPrefix}${action}`;
}
