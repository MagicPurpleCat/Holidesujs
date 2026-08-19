// ============================================================================
// МОДУЛЬ: SCORE (общий рейтинг)
//
// Используется:
// - /топ (категория "общий рейтинг")
// - карточка профиля (место в общем топе)
// - ежедневные снапшоты для графиков сервера
// ============================================================================

export const OVERALL_MAX = 1_000_000;

// Веса разные по метрикам, чтобы вклад активности в Discord “что-то стоило”.
export const SCORE_WEIGHTS = Object.freeze({
  xp: 0.1,
  balance: 0.1,
  messages: 0.5,
  voiceMinutes: 0.05,
  reputation: 10,
});

function n(x) {
  return Number.isFinite(Number(x)) ? Number(x) : 0;
}

/**
 * Считает сырое значение общего рейтинга.
 * @param {object} u — строка из таблицы users
 * @returns {number}
 */
export function overallRawScore(u) {
  const totalXp = n(u.total_xp);
  const balance = n(u.balance);
  const messages = n(u.total_messages);
  const voiceMinutes = n(u.total_voice_minutes);
  const reputation = n(u.total_reactions_received);

  return (
    totalXp * SCORE_WEIGHTS.xp +
    balance * SCORE_WEIGHTS.balance +
    messages * SCORE_WEIGHTS.messages +
    voiceMinutes * SCORE_WEIGHTS.voiceMinutes +
    reputation * SCORE_WEIGHTS.reputation
  );
}

/**
 * Считает общий рейтинг с капом.
 * @param {object} u — строка из таблицы users
 * @returns {number}
 */
export function overallScore(u) {
  return Math.min(OVERALL_MAX, overallRawScore(u));
}

