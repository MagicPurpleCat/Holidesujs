/**
 * Константы и customId системы кланов (префикс cl:).
 */

export const CREATE_COST = 1000;
export const INVITE_TTL_MS = 10 * 60 * 1000;
export const WAR_TTL_MS = 10 * 60 * 1000;
export const WAR_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const MAX_CLAN_MEMBERS = 30;

export const CLAN_SHOP = Object.freeze({
  boost: { price: 5000, label: 'Буст фарма +20% на 7 дней', emoji: '🚀' },
  tag: { price: 2500, label: 'Тег клана в профиле', emoji: '🏷' },
  role: { price: 8000, label: 'Discord-роль клана', emoji: '🎭' },
});

export const CL = {
  home: 'cl:home',
  close: 'cl:close',
  nav: {
    members: 'cl:nav:members',
    bank: 'cl:nav:bank',
    shop: 'cl:nav:shop',
    war: 'cl:nav:war',
    manage: 'cl:nav:manage',
    top: 'cl:nav:top',
    browse: 'cl:nav:browse',
  },
  create: 'cl:create',
  deposit: 'cl:deposit',
  leave: 'cl:leave',
  leaveConfirm: 'cl:leave:yes',
  invitePick: 'cl:invite:pick',
  inviteUser: 'cl:invite:user',
  inviteAcceptPrefix: 'cl:inv:ok:',
  inviteRejectPrefix: 'cl:inv:no:',
  shopPrefix: 'cl:shop:',
  kickPick: 'cl:kick:pick',
  kickUser: 'cl:kick:user',
  promotePick: 'cl:promote:pick',
  promoteUser: 'cl:promote:user',
  demotePick: 'cl:demote:pick',
  demoteUser: 'cl:demote:user',
  warCompare: 'cl:war:compare',
  warChallenge: 'cl:war:challenge',
  warSelect: 'cl:war:select',
  modalCreate: 'cl:modal:create',
  modalDeposit: 'cl:modal:deposit',
  modalWar: 'cl:modal:war',
  modalWarStake: 'cl:modal:warstake:',
};

export function inviteStorageKey(guildId, userId) {
  return `clan_invite:${guildId}:${userId}`;
}

export function warPendingKey(guildId, fromId, toId) {
  return `clan_war:${guildId}:${fromId}:${toId}`;
}

export function warCdKey(guildId, clanId) {
  return `clan_war_cd:${guildId}:${clanId}`;
}
