/**
 * Совместимость: реэкспорт из modules/marriage.
 * Тесты и старые импорты продолжают работать.
 */

export {
  PROPOSAL_TTL_MS,
  proposalKey,
} from './marriage/ids.js';

export {
  findActiveProposalInvolvingUser,
  getActiveProposal,
  storeProposal,
  clearProposal,
  getMarriageRecord,
  getMarriageStatus,
} from './marriage/helpers.js';

export {
  buildProposalEmbed,
  buildExpiredProposalEmbed,
  buildWeddingEmbed,
  handleMarryButton,
  divorceUser,
} from './marriage/actions.js';
