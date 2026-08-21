/**
 * Каталог достижений Holidesu — тематические челленджи по событиям Discord.
 */

export const ACH_TIMEZONE = process.env.ACH_TIMEZONE || 'Europe/Moscow';

/** Общий / welcome-канал (для «Утреннего вестника»). */
export const ACH_GENERAL_CHANNEL_ID =
  process.env.ACH_GENERAL_CHANNEL_ID
  || process.env.MAIN_CHANNEL_ID
  || '1528102721679265973';

/** Канал «болталка» (для «Ночного философа»). */
export const ACH_CHAT_CHANNEL_ID =
  process.env.ACH_CHAT_CHANNEL_ID || ACH_GENERAL_CHANNEL_ID;

/** Роль новичка (опционально). Без роли тоже считается новичком по joinedAt ≤ 7 дней. */
export const ACH_NEWBIE_ROLE_ID = process.env.ACH_NEWBIE_ROLE_ID || '';

/** Секретная фраза (точное совпадение, без учёта регистра). */
export const ACH_SECRET_PHRASE = (process.env.ACH_SECRET_PHRASE || 'сова на скакалке').trim().toLowerCase();

/** Пасхальные слова через запятую. */
export const ACH_EASTER_WORDS = Object.freeze(
  (process.env.ACH_EASTER_WORDS || 'эхолуна,звездныйчай,тихийпорт')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * @typedef {object} AchievementDef
 * @property {string} name
 * @property {string} emoji
 * @property {string} category
 * @property {string} description
 * @property {number} [target] — цель прогресса (1 = флаг)
 */

/** @type {Record<string, AchievementDef>} */
export const ACHIEVEMENTS = Object.freeze({
  // ── Чат ──────────────────────────────────────────────────────────
  morning_herald: {
    name: 'Утренний вестник',
    emoji: '🌅',
    category: 'chat',
    description: 'Напиши первое сообщение в общем канале между 06:00 и 09:00.',
    target: 1,
  },
  night_philosopher: {
    name: 'Ночной философ',
    emoji: '🌙',
    category: 'chat',
    description: 'Напиши сообщение в «болталке» между 01:00 и 04:00.',
    target: 1,
  },
  week_marathoner: {
    name: 'Марафонец недели',
    emoji: '🏃',
    category: 'chat',
    description: 'Набери 500 сообщений за 7 дней.',
    target: 500,
  },
  brevity_master: {
    name: 'Мастер краткости',
    emoji: '✂️',
    category: 'chat',
    description: 'Напиши 10 сообщений длиной ≤ 30 символов.',
    target: 10,
  },
  long_story: {
    name: 'Длинный рассказ',
    emoji: '📜',
    category: 'chat',
    description: 'Одно сообщение длиной ≥ 1000 символов.',
    target: 1,
  },
  no_emoji: {
    name: 'Без смайликов',
    emoji: '😐',
    category: 'chat',
    description: 'Напиши 20 сообщений без эмодзи.',
    target: 20,
  },
  emoji_only: {
    name: 'Только смайлы',
    emoji: '😎',
    category: 'chat',
    description: 'Сообщение только из эмодзи (без букв и цифр).',
    target: 1,
  },
  quote_of_day: {
    name: 'Цитата дня',
    emoji: '💬',
    category: 'chat',
    description: 'Используй /quote 5 раз за неделю.',
    target: 5,
  },

  // ── Реакции и вовлечение ─────────────────────────────────────────
  reaction_favorite: {
    name: 'Любимец реакций',
    emoji: '❤️',
    category: 'engagement',
    description: 'Получи 30 реакций на одно сообщение.',
    target: 1,
  },
  reaction_universal: {
    name: 'Реакционер-универсал',
    emoji: '🎭',
    category: 'engagement',
    description: 'Поставь реакции минимум 5 разных эмодзи.',
    target: 5,
  },
  the_one: {
    name: 'Тот самый человек',
    emoji: '📣',
    category: 'engagement',
    description: 'Тебя упомянули (@) 20 раз другие участники.',
    target: 20,
  },
  self_praise: {
    name: 'Сам себя не похвалишь',
    emoji: '🪞',
    category: 'engagement',
    description: 'Упомяни себя в сообщении 3 раза за день.',
    target: 3,
  },
  newbie_helper: {
    name: 'Помощник новичка',
    emoji: '🤝',
    category: 'engagement',
    description: 'Ответь (reply) на сообщение новичка 10 раз.',
    target: 10,
  },

  // ── Голос ────────────────────────────────────────────────────────
  early_bird_voice: {
    name: 'Ранняя пташка в голосе',
    emoji: '🐦',
    category: 'voice',
    description: 'Зайди в любой голосовой канал первым в день (до 08:00).',
    target: 1,
  },
  quiet_listener: {
    name: 'Тихий слушатель',
    emoji: '🤫',
    category: 'voice',
    description: 'Проведи в войсе 2 часа подряд без микрофона.',
    target: 120,
  },
  loud_voice: {
    name: 'Громкий голос',
    emoji: '🔊',
    category: 'voice',
    description: 'Говори (не в муте) суммарно 1 час в голосовых.',
    target: 60,
  },
  room_organizer: {
    name: 'Организатор комнат',
    emoji: '🏠',
    category: 'voice',
    description: 'Создай временный голосовой канал 3 раза.',
    target: 3,
  },

  // ── Медиа ────────────────────────────────────────────────────────
  photo_hobbyist: {
    name: 'Фотограф-любитель',
    emoji: '📷',
    category: 'media',
    description: 'Отправь 15 сообщений с картинками.',
    target: 15,
  },
  video_enthusiast: {
    name: 'Видео-энтузиаст',
    emoji: '🎬',
    category: 'media',
    description: 'Отправь 5 сообщений с видеофайлами.',
    target: 5,
  },
  collage_artist: {
    name: 'Художник-коллажист',
    emoji: '🖼️',
    category: 'media',
    description: 'Отправь сообщение с 3+ вложениями сразу.',
    target: 1,
  },
  clean_text: {
    name: 'Чистый текст',
    emoji: '📝',
    category: 'media',
    description: 'Напиши 50 сообщений без вложений и ссылок.',
    target: 50,
  },

  // ── Мини-игры ────────────────────────────────────────────────────
  rps_streak: {
    name: 'Камень, ножницы, бумага: серия',
    emoji: '✊',
    category: 'games',
    description: 'Выиграй 5 игр подряд у бота.',
    target: 5,
  },
  quiz_expert: {
    name: 'Знаток викторин',
    emoji: '🧠',
    category: 'games',
    description: 'Правильно ответь на 10 вопросов викторины.',
    target: 10,
  },
  easter_hunter: {
    name: 'Охотник за пасхалками',
    emoji: '🥚',
    category: 'games',
    description: 'Найди 3 секретных слова в чатах.',
    target: 3,
  },
  lucky_one: {
    name: 'Счастливчик',
    emoji: '🍀',
    category: 'games',
    description: 'Выпади 100 из 100 в /рандом хотя бы раз.',
    target: 1,
  },

  // ── Лояльность ───────────────────────────────────────────────────
  week_veteran: {
    name: 'Ветеран недели',
    emoji: '🗓️',
    category: 'loyalty',
    description: 'Будь на сервере ≥ 7 дней.',
    target: 1,
  },
  month_veteran: {
    name: 'Старожил месяца',
    emoji: '📅',
    category: 'loyalty',
    description: 'Будь на сервере ≥ 30 дней.',
    target: 1,
  },
  birthday_14: {
    name: 'День рождения · 14 дней',
    emoji: '🎂',
    category: 'loyalty',
    description: 'Ровно 14 дней на сервере.',
    target: 1,
  },
  birthday_30: {
    name: 'День рождения · 30 дней',
    emoji: '🥳',
    category: 'loyalty',
    description: 'Ровно 30 дней на сервере.',
    target: 1,
  },
  birthday_90: {
    name: 'День рождения · 90 дней',
    emoji: '🎉',
    category: 'loyalty',
    description: 'Ровно 90 дней на сервере.',
    target: 1,
  },

  // ── Пасхалки ─────────────────────────────────────────────────────
  time_333: {
    name: '3:33',
    emoji: '🕰️',
    category: 'unique',
    description: 'Будь онлайн ровно в 03:33 минимум 5 минут.',
    target: 5,
  },
  secret_phrase: {
    name: 'Секретная фраза',
    emoji: '🔑',
    category: 'unique',
    description: 'Напиши точную фразу-пасхалку.',
    target: 1,
  },
  rare_guest: {
    name: 'Редкий гость',
    emoji: '👻',
    category: 'unique',
    description: 'Одно сообщение и уход в офлайн за 10 минут.',
    target: 1,
  },
  silent_observer: {
    name: 'Молчаливый наблюдатель',
    emoji: '👁️',
    category: 'unique',
    description: '24 часа на сервере без единого сообщения.',
    target: 1,
  },

  // ── Кланы / брак ─────────────────────────────────────────────────
  clan_founder: {
    name: 'Основатель клана',
    emoji: '🏰',
    category: 'engagement',
    description: 'Создай свой клан.',
    target: 1,
  },
  clan_war_win: {
    name: 'Победа в войне',
    emoji: '⚔️',
    category: 'engagement',
    description: 'Победи в клановой войне со ставкой.',
    target: 1,
  },
  first_marriage: {
    name: 'Первый брак',
    emoji: '💍',
    category: 'engagement',
    description: 'Поженись на сервере.',
    target: 1,
  },
});

export const ACHIEVEMENT_CATEGORIES = Object.freeze({
  all: { emoji: '🏅', label: 'Все' },
  chat: { emoji: '💬', label: 'Чат' },
  engagement: { emoji: '✨', label: 'Вовлечение' },
  voice: { emoji: '🎤', label: 'Голос' },
  media: { emoji: '📎', label: 'Медиа' },
  games: { emoji: '🎮', label: 'Мини-игры' },
  loyalty: { emoji: '⌛', label: 'Лояльность' },
  unique: { emoji: '🔮', label: 'Пасхалки' },
});

/** Совместимость со старым API (tier-прогрессии больше нет). */
export const ACHIEVEMENT_TIERS = Object.freeze({});

export const ACHIEVEMENT_TOTAL = Object.keys(ACHIEVEMENTS).length;

export function listAchievementKeys(category = 'all') {
  const keys = Object.keys(ACHIEVEMENTS);
  if (category === 'all') return keys;
  return keys.filter((key) => ACHIEVEMENTS[key].category === category);
}
