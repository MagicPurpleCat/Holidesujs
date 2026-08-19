import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getDb } from '../database.js';
import { COLOR, guildFooter } from '../utils/ui.js';
import { overallScore } from '../modules/score.js';

// ══════════════════════════════════════════════════════════════════
// КОМАНДА /ТОП — СИСТЕМА РЕЙТИНГА
// ══════════════════════════════════════════════════════════════════
//
// Показывает ТОП-10 пользователей в выбранной категории.
//
// Общий рейтинг: нормализованные метрики × веса (см. modules/score.js).
// Диапазон: 0–10 000 баллов.
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

// ─── Количество участников в топе ───────────────────────────────
const TOP_LIMIT = 10;

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

// overallScore вынесен в modules/score.js

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

function buildPodiumBlock(interaction, rows, category) {
  const medals = ['🥇', '🥈', '🥉'];
  return rows.slice(0, 3).map((u, i) => {
    const name = getDisplayName(interaction, u.user_id);
    return `${medals[i]} ${name}\n> ${formatValue(u, category)}`;
  }).join('\n\n');
}

function buildRankListBlock(interaction, rows, category) {
  return rows.slice(3).map((u, i) => {
    const pos = i + 4;
    const num = String(pos).padStart(2, ' ');
    return `\`${num}.\` ${getDisplayName(interaction, u.user_id)} — ${formatValue(u, category)}`;
  }).join('\n');
}

function buildCategoryStat(users, category) {
  if (!users.length) return 'Пока пусто';
  const values = users.map((u) => categoryValue(u, category));
  const best = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (category === 'balance') {
    return `Лучший: **${Math.round(best).toLocaleString('ru-RU')} ⚡HLD**\nСреднее: **${Math.round(avg).toLocaleString('ru-RU')} ⚡HLD**`;
  }
  if (category === 'xp') {
    return `Лучший: **${Math.round(best).toLocaleString('ru-RU')} ⚡**\nСреднее: **${Math.round(avg).toLocaleString('ru-RU')} ⚡**`;
  }
  if (category === 'messages') {
    return `Лучший: **${Math.round(best).toLocaleString('ru-RU')} 💬**\nСреднее: **${Math.round(avg).toLocaleString('ru-RU')} 💬**`;
  }
  if (category === 'reputation') {
    return `Лучший: **${Math.round(best).toLocaleString('ru-RU')} 👍**\nСреднее: **${Math.round(avg).toLocaleString('ru-RU')} 👍**`;
  }
  return `Лучший: **${Math.round(best).toLocaleString('ru-RU')}**\nСреднее: **${Math.round(avg).toLocaleString('ru-RU')}**`;
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
    SELECT user_id, balance, total_xp, total_messages, total_voice_minutes, total_reactions_received
    FROM users
    WHERE is_infinite_balance = 0 AND guild_id = ?
  `).all(interaction.guildId);

  // Сортируем по значению категории (по убыванию)
  users.sort((a, b) => categoryValue(b, category) - categoryValue(a, category));

// Топ-10
  const top10 = users.slice(0, TOP_LIMIT);
  const currentIndex = users.findIndex((u) => u.user_id === interaction.user.id);
  const currentUserRow = currentIndex >= 0 ? users[currentIndex] : null;
  const podium = buildPodiumBlock(interaction, top10, category);
  const rankList = buildRankListBlock(interaction, top10, category);

  const embed = new EmbedBuilder()
    .setColor(category === 'overall' ? COLOR.gold : COLOR.accent)
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(
      `${cat.description}\n\n` +
      `Всего участников в рейтинге: **${users.length.toLocaleString('ru-RU')}**`
    )
    .setFooter({ text: guildFooter(interaction, 'меню ниже меняет категорию') });

  if (interaction.guild?.iconURL) {
    embed.setThumbnail(interaction.guild.iconURL({ size: 256 }));
  }

  embed.addFields({
    name: 'Подиум',
    value: podium || 'Пока пусто.',
    inline: false,
  });

  if (rankList) {
    embed.addFields({
      name: 'Остальные места',
      value: rankList,
      inline: false,
    });
  }

  embed.addFields({
    name: 'Сводка',
    value: buildCategoryStat(users, category),
    inline: true,
  });

  if (currentUserRow) {
    embed.addFields({
      name: 'Твоя позиция',
      value: `**#${currentIndex + 1}** — ${formatValue(currentUserRow, category)}`,
      inline: true,
    });
  }

  return embed;
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
