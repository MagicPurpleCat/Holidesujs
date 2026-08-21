/**
 * Константы и customId системы брака (префикс mr:).
 */

export const PROPOSAL_TTL_MS = 5 * 60 * 1000;
export const VOICE_BONUS_PCT = 15;

export const MR = {
  home: 'mr:home',
  close: 'mr:close',
  nav: {
    bank: 'mr:nav:bank',
    propose: 'mr:nav:propose',
    pending: 'mr:nav:pending',
    divorce: 'mr:nav:divorce',
    history: 'mr:nav:history',
    settings: 'mr:nav:settings',
  },
  proposePick: 'mr:propose:pick',
  proposeUser: 'mr:propose:user',
  cancelProposal: 'mr:propose:cancel',
  deposit: 'mr:bank:deposit',
  withdraw: 'mr:bank:withdraw',
  divorceConfirm: 'mr:divorce:yes',
  acceptPrefix: 'mr:ok:',
  rejectPrefix: 'mr:no:',
  modalDeposit: 'mr:modal:deposit',
  modalWithdraw: 'mr:modal:withdraw',
  set: {
    proposals: 'mr:set:proposals',
    profile: 'mr:set:profile',
  },
};

export function proposalKey(guildId, proposerId, targetId) {
  return `marry:${guildId}:${proposerId}:${targetId}`;
}
