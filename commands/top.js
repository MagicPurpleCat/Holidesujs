import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getDb } from '../database.js';
import { COLOR, guildFooter } from '../utils/ui.js';

// ══════════════════════════════════════════════════════════════════
// КОМАНДА /ТОП — СИСТЕМА РЕЙТИНГА
// ══════════════════════════════════════════════════════════════════
//
// Показывает ТОП-10 пользователей в выбранной категории.
//
// Общий рейтинг считается по формуле:
//   Опыт × 0.1  +  Валюта × 0.1  +  Сообщения × 0.5  +  Репутация × 10
// ПРЕДЕЛ (CAP): максимальное значение общего рейтинга — 1 000 000.
//
// Категории (переключаются select-меню):
//   • 🌟 Общий рейтинг — по формуле (с пределом 1 000 000)
//   • ⚡ Опыт   — просто топ по набранному опыту
//   • 💰 Валюта — просто топ по балансу
//   • 💬 Сообщения — просто топ по количеству сообщений
//   • 👍 Репутация — просто топ по репутации
//
// В отдельных категориях никакого расчёта нет — просто сортировка
// по количеству, которое набрал пользователь.
//
// Оформление: только красивые русские подписи и иконки.
// Никаких технических имён полей БД не выводится.
// ══════════════════════════════════════════════════════════════════

// ─── Предел общего рейтинга ──────────────────────────────────────
const OVERALL_MAX = 1_000_000;

// ─── Количество участников в топе ───────────────────────────────
const TOP_LIMIT = 10;

// ─── Веса для общего рейтинга ─────────────────────────────────────
const WEIGHTS = {
  xp: 0.1,          // опыт: 1 = 0.1
  balance: 0.1,      // валюта: 1 = 0.1
  messages: 0.5,     // сообщения: 1 = 0.5
  reputation: 10,    // репутация: 1 = 10
};

// ─── Категории рейтинга ───────────────────────────────────────────
const CATEGORIES = {
  overall: {
    label: 'Общий рейтинг',
    emoji: '🌟',
    description: 'Топ участников по общему рейтингу.',
  },
  xp: {
    label: 'Опыт',
    emoji: '⚡',
    description: 'Лидеры по количеству набранного опыта.',
  },
  balance: {
    label: 'Валюта',
    emoji: '💰',
    description: 'Лидеры по богатству в ⚡HLD.',
  },
  messages: {
    label: 'Сообщения',
    emoji: '💬',
    description: 'Самые активные участники чата.',
  },
  reputation: {
    label: 'Репутация',
    emoji: '👍',
    description: 'Пользователи с самым высоким авторитетом.',
  },
};

/**
 * Считает баллы общего рейтинга для пользователя.
 * @param {Object} u — строка из таблицы users
 * @returns {number}
 */
export function overallScore(u) {
  const raw =
    (u.total_xp || 0) * WEIGHTS.xp +
    (u.balance || 0) * WEIGHTS.balance +
    (u.total_messages || 0) * WEIGHTS.messages +
    (u.total_reactions_received || 0) * WEIGHTS.reputation;
  // Предел: общий рейтинг не может превышать 1 000 000
  return Math.min(OVERALL_MAX, raw);
}

/**
 * Возвращает числовое значение категории для сортировки.
 * Для отдельных категорий — просто количество, которое набрал пользователь.
 * @param {Object} u — строка из таблицы users
 * @param {string} category — ключ категории
 * @returns {number}
 */
function categoryValue(u, category) {
  switch (category) {
    case 'xp':
      return u.total_xp || 0;
    case 'balance':
      return u.balance || 0;
    case 'messages':
      return u.total_messages || 0;
    case 'reputation':
      return u.total_reactions_received || 0;
    case 'overall':
    default:
      return overallScore(u);
  }
}

/**
 * Возвращает красиво отформатированное значение для строки топа.
 * @param {Object} u — строка из таблицы users
 * @param {string} category — ключ категории
 */
function formatValue(u, category) {
  switch (category) {
    case 'xp':
      return `${(u.total_xp || 0).toLocaleString('ru-RU')} ⚡`;
    case 'balance':
      return `${(u.balance || 0).toLocaleString('ru-RU')} ⚡HLD`;
    case 'messages':
      return `${(u.total_messages || 0).toLocaleString('ru-RU')} 💬`;
    case 'reputation':
      return `${(u.total_reactions_received || 0).toLocaleString('ru-RU')} 👍`;
    case 'overall':
    default:
      return `${Math.round(overallScore(u)).toLocaleString('ru-RU')} баллов`;
  }
}

/**
 * Возвращает кликабельное упоминание пользователя (открывает профиль).
 * @param {import('discord.js').Interaction} interaction
 * @param {string} userId
 */
function getDisplayName(interaction, userId) {
  // Кликабельное упоминание — по нажатию открывается профиль пользователя
  const mention = `<@${userId}>`;
  try {
    const member = interaction.guild?.members.cache.get(userId);
    if (member?.displayName) {
      // Делаем имя жирным и добавляем кликабельное упоминание для профиля
      return `**${member.displayName}** (${mention})`;
    }
  } catch {}
  return `**${mention}**`;
}

/**
 * Строит embed топа-10 для выбранной категории.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} category — ключ категории
 */
function buildTopEmbed(interaction, category) {
  const db = getDb();
  const cat = CATEGORIES[category];

  // Берём всех пользователей без бесконечного баланса
  const users = db.prepare(`
    SELECT user_id, balance, total_xp, total_messages, total_reactions_received
    FROM users
    WHERE is_infinite_balance = 0 AND guild_id = ?
  `).all(interaction.guildId);

  // Сортируем по значению категории (по убыванию)
  users.sort((a, b) => categoryValue(b, category) - categoryValue(a, category));

// Топ-10
  const top10 = users.slice(0, TOP_LIMIT);

  const medals = ['🥇', '🥈', '🥉'];
  // Собираем строки топа, разделяя каждое место пустой строкой
  const lines = top10.map((u, i) => {
    const place = medals[i] || `\`${i + 1}.\``;
    const name = getDisplayName(interaction, u.user_id);
    return `${place} ${name} — ${formatValue(u, category)}`;
  }).reduce((acc, line, i) => i === 0 ? [line] : [...acc, '', line], []);

  return new EmbedBuilder()
    .setColor(COLOR.gold)
    .setTitle(`${cat.emoji}  ${cat.label}`)
    .setDescription(cat.description)
    .addFields(
      { name: `Топ-${TOP_LIMIT}`, value: lines.length ? lines.join('\n') : 'Пока пусто.', inline: false }
    )
    .setFooter({ text: guildFooter(interaction, 'меню ниже меняет категорию') });
}

/**
 * Строит select-меню выбора категории.
 * @param {string} currentCategory — текущая выбранная категория
 */
function buildCategorySelect(currentCategory) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('top_select')
    .setPlaceholder('📂 Выбери категорию рейтинга...');

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${cat.emoji} ${cat.label}`)
        .setValue(key)
        .setDescription(cat.description.replace(/\n/g, ' ').slice(0, 100))
        .setDefault(key === currentCategory)
    );
  }

  return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Обрабатывает смену категории через select-меню.
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleTopSelect(interaction) {
  if (interaction.customId !== 'top_select') return false;

  const category = interaction.values[0];
  if (!CATEGORIES[category]) return false;

  const embed = buildTopEmbed(interaction, category);
  const select = buildCategorySelect(category);

  await interaction.update({ embeds: [embed], components: [select] });
  return true;
}

export default {
  data: new SlashCommandBuilder()
    .setName('топ')
    .setDescription('Топ-10: общий рейтинг, XP, ⚡HLD, сообщения, реп')
    .addStringOption((opt) =>
      opt
        .setName('категория')
        .setDescription('Категория рейтинга (по умолчанию — общий рейтинг)')
        .setRequired(false)
        .addChoices(
          { name: '🌟 Общий рейтинг', value: 'overall' },
          { name: '⚡ Опыт', value: 'xp' },
          { name: '💰 Валюта', value: 'balance' },
          { name: '💬 Сообщения', value: 'messages' },
          { name: '👍 Репутация', value: 'reputation' },
        )
    ),

  async execute(interaction) {
    const category = interaction.options.getString('категория') || 'overall';
    const embed = buildTopEmbed(interaction, category);
    const select = buildCategorySelect(category);

    await interaction.reply({ embeds: [embed], components: [select] });
  },
};
