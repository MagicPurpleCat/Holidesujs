// ============================================================================
// МОДУЛЬ: SCORE (общий рейтинг)
//
// Используется:
// - /топ (категория "общий рейтинг")
// - карточка профиля (место в общем топе)
// - ежедневные снапшоты для графиков сервера
// ============================================================================

/** Максимальный общий рейтинг (100% по всем метрикам). */
export const OVERALL_MAX = 10_000;

/** Доля каждой метрики в общем рейтинге (сумма = 1). */
export const SCORE_WEIGHTS = Object.freeze({
  xp: 0.20,
  balance: 0.15,
  messages: 0.30,
  voiceMinutes: 0.25,
  reputation: 0.10,
});

/**
 * Целевые значения для нормализации.
 * При достижении cap метрика даёт 100% своего веса.
 */
const SCORE_CAPS = Object.freeze({
  xp: 50_000,
  balance: 100_000,
  messages: 10_000,
  voiceMinutes: 5_000,
  reputation: 500,
});

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** Нормализует значение в диапазон 0..1 относительно cap. */
function norm(value, cap) {
  if (cap <= 0) return 0;
  return Math.min(1, n(value) / cap);
}

/**
 * Считает долю общего рейтинга (0..1).
 * @param {object} u — строка из таблицы users
 * @returns {number}
 */
export function overallRawScore(u) {
  return (
    norm(u.total_xp, SCORE_CAPS.xp) * SCORE_WEIGHTS.xp
    + norm(u.balance, SCORE_CAPS.balance) * SCORE_WEIGHTS.balance
    + norm(u.total_messages, SCORE_CAPS.messages) * SCORE_WEIGHTS.messages
    + norm(u.total_voice_minutes, SCORE_CAPS.voiceMinutes) * SCORE_WEIGHTS.voiceMinutes
    + norm(u.total_reactions_received, SCORE_CAPS.reputation) * SCORE_WEIGHTS.reputation
  );
}

/**
 * Считает общий рейтинг (0..OVERALL_MAX).
 * @param {object} u — строка из таблицы users
 * @returns {number}
 */
export function overallScore(u) {
  return Math.min(OVERALL_MAX, Math.round(overallRawScore(u) * OVERALL_MAX));
}
