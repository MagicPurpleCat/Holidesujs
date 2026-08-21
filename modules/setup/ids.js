/**
 * Константы /setup (префикс su:).
 */

export const SU = {
  home: 'su:home',
  close: 'su:close',
  nav: {
    channels: 'su:nav:channels',
    roles: 'su:nav:roles',
    owner: 'su:nav:owner',
    wizard: 'su:nav:wizard',
  },
  channelPick: 'su:ch:pick',
  channelSetPrefix: 'su:ch:set:',
  channelClearPrefix: 'su:ch:clr:',
  rolesAdmin: 'su:roles:admin',
  rolesVerified: 'su:roles:verified',
  rolesSeason: 'su:roles:season',
  ownerPick: 'su:owner:pick',
  ownerUser: 'su:owner:user',
  modalOwner: 'su:modal:owner',
  wizardStart: 'su:wiz:start',
  wizardSkipPrefix: 'su:wiz:skip:',
  wizardChannelPrefix: 'su:wiz:ch:',
  wizardRoles: 'su:wiz:roles',
  wizardSeason: 'su:wiz:season',
};

export const WIZARD_TTL_MS = 5 * 60 * 1000;

export function wizardKey(guildId, userId) {
  return `setup_wiz:${guildId}:${userId}`;
}
