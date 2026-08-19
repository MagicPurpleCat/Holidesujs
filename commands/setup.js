// ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: /setup — Мастер настройки сервера
// ══════════════════════════════════════════════════════════════════
// Позволяет администратору в интерактивном режиме настроить:
//   • ID владельца сервера
//   • Роли администраторов (multi-select)
//   • Каналы: #логи, #команды, #модерация, голосовая панель, триггер, категория, welcome
//
// Данные сохраняются в таблицу `server_config` (SQLite, better-sqlite3).
// Весь процесс — это последовательность шагов (wizard):
//   Step 1: Modal (ID владельца + примечание)
//   Step 2: SelectMenu (роли админов)
//   Step 3: ChannelSelect (канал логов)
//   Step 4: ChannelSelect (канал команд)
//   Step 5: ChannelSelect (канал модерации)
//   Step 6: ChannelSelect (канал голосовой панели)
//   Step 7: ChannelSelect (голосовой канал-триггер JTC)
//   Step 8: ChannelSelect (категория приватных комнат)
//   Step 9: ChannelSelect (канал приветствий)
//   Step 10: Финализация + сохранение в БД
//
// Таймаут: 2 минуты бездействия → процесс закрывается.
// ══════════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getDb } from '../database.js';
import { clearGuildConfigCache } from '../utils/guildConfig.js';

// ══════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ══════════════════════════════════════════════════════════════════

const TABLE_NAME = 'server_config';
const TIMEOUT_MS = 2 * 60 * 1000; // 2 минуты таймаут

// SQL-запросы (кэшируются через db.prepare при первом вызове)
const SQL_CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    guild_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    admin_roles TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '{}',
    setup_date TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT DEFAULT ''
  )
`;

const SQL_GET_CONFIG = `SELECT * FROM ${TABLE_NAME} WHERE guild_id = ?`;
const SQL_UPSERT_CONFIG = `
  INSERT INTO ${TABLE_NAME} (guild_id, owner_id, admin_roles, channels, note, status)
  VALUES (?, ?, ?, ?, ?, 'active')
  ON CONFLICT(guild_id) DO UPDATE SET
    owner_id = excluded.owner_id,
    admin_roles = excluded.admin_roles,
    channels = excluded.channels,
    note = excluded.note,
    setup_date = datetime('now'),
    status = 'active'
`;

// ══════════════════════════════════════════════════════════════════
// ПРОВЕРКА И СОЗДАНИЕ ТАБЛИЦЫ
// ══════════════════════════════════════════════════════════════════

/**
 * Проверяет наличие таблицы server_config в БД.
 * Если таблицы нет — создаёт её.
 * Безопасно вызывать多次 — второй вызов ничего не изменит.
 */
export function checkAndCreateTable() {
  const db = getDb();
  db.exec(SQL_CREATE_TABLE);
  console.log('[SETUP] Таблица server_config проверена/создана.');
}

// ══════════════════════════════════════════════════════════════════
// WIZARD: УПРАВЛЕНИЕ СОСТОЯНИЕМ ШАГОВ
// ══════════════════════════════════════════════════════════════════

/**
 * Хранилище активных сессий настройки.
 * Ключ: `${guildId}:${userId}`
 * Значение: объект состояния SetupWizard
 */
const activeWizards = new Map();

/**
 * Класс SetupWizard — управляет состоянием мастера настройки.
 *
 * Поля состояния:
 *   guildId      — ID сервера
 *   userId       — ID пользователя, запустившего мастер
 *   ownerId      — ID владельца (из Modal)
 *   note         — примечание (из Modal, опционально)
 *   selectedRoles — массив ID выбранных ролей админов
 *   channels     — объект { log: null, cmd: null, mod: null }
 *   step         — текущий шаг (1-6)
 *   message      — последнее сообщение бота (для редактирования/удаления)
 *   timeout      — ID таймера setTimeout
 */
class SetupWizard {
  constructor(guildId, userId) {
    this.guildId = guildId;
    this.userId = userId;
    this.ownerId = null;
    this.note = '';
this.selectedRoles = [];
    this.channels = {
      log: null,
      cmd: null,
      mod: null,
      voice_panel: null,
      trigger: null,
      voice_category: null,
      welcome: null,
    };
    this.step = 1;
    this.message = null;
    this.timeout = null;
  }

  /** Сбросить таймер бездействия */
  resetTimeout(interaction) {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.handleTimeout(interaction);
    }, TIMEOUT_MS);
  }

  /** Обработчик таймаута — завершает процесс с сообщением об истечении времени */
  async handleTimeout(interaction) {
    try {
      const content = { content: '⏳ **Время на настройку истекло.** Пожалуйста, начните заново с команды `/setup`.', components: [], embeds: [] };
      if (this.message) {
        await this.message.edit(content).catch(() => {});
      } else if (interaction) {
        await interaction.editReply(content).catch(() => {});
      }
    } catch (e) {
      console.error('[SETUP] Ошибка при обработке таймаута:', e.message);
    }
    activeWizards.delete(`${this.guildId}:${this.userId}`);
  }

  /** Очистить таймер и удалить сессию */
  destroy() {
    if (this.timeout) clearTimeout(this.timeout);
    activeWizards.delete(`${this.guildId}:${this.userId}`);
  }

  /** Проверить, что взаимодействие принадлежит текущей сессии */
  isOwner(interaction) {
    return interaction.guildId === this.guildId && interaction.user.id === this.userId;
  }
}

// ══════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Получить активный мастер настройки для пользователя на сервере.
 * @param {string} guildId
 * @param {string} userId
 * @returns {SetupWizard|null}
 */
function getWizard(guildId, userId) {
  return activeWizards.get(`${guildId}:${userId}`) || null;
}

/**
 * Создать новую сессию мастера.
 * Если сессия уже существует — удаляем старую (таймаут чистится).
 */
function createWizard(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const existing = activeWizards.get(key);
  if (existing) existing.destroy();
  const wizard = new SetupWizard(guildId, userId);
  activeWizards.set(key, wizard);
  return wizard;
}

// ══════════════════════════════════════════════════════════════════
// ШАГ 1: ОТКРЫТИЕ MODAL (вызывается из execute)
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт и отправляет Modal для ввода ID владельца и примечания.
 * Экспортируется для вызова из админ-панели (admin_panel.js).
 *
 * @param {import('discord.js').CommandInteraction|import('discord.js').ButtonInteraction} interaction
 */
export async function showSetupModal(interaction) {
  // Создаём мастер-сессию
  const wizard = createWizard(interaction.guildId, interaction.user.id);
  wizard.resetTimeout(interaction);

  // Создаём Modal
  const modal = new ModalBuilder()
    .setCustomId('setup_modal')
    .setTitle('🛠 Настройка сервера');

  // Поле 1: ID владельца (по умолчанию — ID автора команды)
  const ownerIdInput = new TextInputBuilder()
    .setCustomId('setup_owner_id')
    .setLabel('ID Владельца')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Введите Discord ID владельца сервера')
    .setValue(interaction.user.id) // По умолчанию подставляем ID вызвавшего команду
    .setRequired(true)
    .setMaxLength(20);

  // Поле 2: Примечание (опционально)
  const noteInput = new TextInputBuilder()
    .setCustomId('setup_note')
    .setLabel('Примечание / Название проекта')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Например: "Основной сервер клана"')
    .setRequired(false)
    .setMaxLength(100);

  // Добавляем поля в Modal
  modal.addComponents(
    new ActionRowBuilder().addComponents(ownerIdInput),
    new ActionRowBuilder().addComponents(noteInput),
  );

  // Показываем Modal (ответ ephemeral, чтобы окно было доступно)
  await interaction.showModal(modal);
  // Важно: после showModal мы НЕ делаем reply — Discord ждёт submission
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК ШАГА 2: ВЫБОР РОЛЕЙ АДМИНОВ
// ══════════════════════════════════════════════════════════════════

/**
 * Отправляет сообщение с multi-select меню для выбора ролей администраторов.
 *
 * @param {import('discord.js').CommandInteraction|import('discord.js').ModalSubmitInteraction} interaction
 * @param {SetupWizard} wizard
 */
async function stepSelectRoles(interaction, wizard) {
  wizard.step = 2;

  // Получаем все роли сервера, исключая @everyone
  const roles = interaction.guild.roles.cache.filter(r => r.id !== interaction.guild.id);

  // Если ролей нет (маловероятно) — пишем ошибку
  if (roles.size === 0) {
    return interaction.reply({
      content: '❌ На сервере нет ролей для выбора.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ИСПРАВЛЕНО (v2): Discord API ограничивает:
  //   1. max_values — максимум 25
  //   2. Количество опций в addOptions() — максимум 25
  // Преобразуем Collection в массив, сортируем по позиции (высшие роли первыми),
  // и берём только первые 25.
  const MAX_SELECT_OPTIONS = 25;
  const rolesArray = Array.from(roles.values());
  const topRoles = rolesArray
    .sort((a, b) => b.position - a.position) // Высшие роли — первыми
    .slice(0, MAX_SELECT_OPTIONS);           // Только первые 25

  const maxValues = Math.min(topRoles.length, MAX_SELECT_OPTIONS);

  // Создаём SelectMenu для ролей (multi-select)
  // ВАЖНО: добавляем опции ЧЕРЕЗ СПРЕД-ОПЕРАТОР, по одной, чтобы
  // не превысить лимит Discord API в 25 опций.
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_select_roles')
    .setPlaceholder('Выберите роли администраторов...')
    .setMinValues(1) // Минимум 1 роль обязательна
    .setMaxValues(maxValues);

  // Добавляем опции по одной (через .addOptions с распаковкой массива)
  selectMenu.addOptions(
    ...topRoles.map(role => ({
      label: role.name,
      value: role.id,
      description: `Участников: ${role.members.size}`,
    }))
  );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👮 Шаг 2: Выбор ролей администраторов')
    .setDescription(
      'Выберите **минимум 1 роль**, которая будет считаться администраторской.\n' +
      'Бот будет использовать эти роли для проверки прав.' +
      (rolesArray.length > MAX_SELECT_OPTIONS
        ? `\n\n⚠️ Показаны только первые ${MAX_SELECT_OPTIONS} ролей (из ${rolesArray.length}).`
        : '')
    )
    .setFooter({ text: 'У вас есть 2 минуты, чтобы сделать выбор.' })

  // Если это первый шаг после Modal — используем reply
  // Иначе — editReply (для последующих шагов)
  if (interaction.isModalSubmit()) {
    // После Modal ответ НЕ должен быть ephemeral, чтобы компоненты работали
    await interaction.reply({ embeds: [embed], components: [row] });
    wizard.message = await interaction.fetchReply();
  } else {
    await interaction.update({ embeds: [embed], components: [row] });
    wizard.message = interaction.message;
  }

  wizard.resetTimeout(interaction);
}

// ══════════════════════════════════════════════════════════════════
// ШАГИ 3-6: ВЫБОР КАНАЛОВ
// ══════════════════════════════════════════════════════════════════

/**
 * Отправляет сообщение с ChannelSelect для выбора канала определённого типа.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {SetupWizard} wizard
 * @param {string} channelKey — ключ в wizard.channels
 * @param {string} label — подпись для SelectMenu
 * @param {string} embedTitle — заголовок Embed
 * @param {string} embedDesc — описание Embed
 */
async function stepSelectChannel(interaction, wizard, channelKey, label, embedTitle, embedDesc) {
  const stepMap = {
    log: 3,
    cmd: 4,
    mod: 5,
    voice_panel: 6,
    trigger: 7,
    voice_category: 8,
    welcome: 9,
  };
  wizard.step = stepMap[channelKey] || 3;

  const typeMap = {
    trigger: [ChannelType.GuildVoice],
    voice_category: [ChannelType.GuildCategory],
    welcome: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    voice_panel: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  };
  const channelTypes = typeMap[channelKey] || [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
  ];

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup_channel_${channelKey}`)
    .setPlaceholder(label)
    .setChannelTypes(...channelTypes)
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(channelSelect);

  const progressFields = [
    { name: '📋 Канал логов', value: wizard.channels.log ? `<#${wizard.channels.log}>` : '❌ Не выбран', inline: true },
    { name: '💬 Канал команд', value: wizard.channels.cmd ? `<#${wizard.channels.cmd}>` : '❌ Не выбран', inline: true },
    { name: '🛡️ Канал модерации', value: wizard.channels.mod ? `<#${wizard.channels.mod}>` : '❌ Не выбран', inline: true },
    { name: '🎙 Голосовая панель', value: wizard.channels.voice_panel ? `<#${wizard.channels.voice_panel}>` : '❌ Не выбран', inline: true },
    { name: '➕ Канал создания комнат', value: wizard.channels.trigger ? `<#${wizard.channels.trigger}>` : '❌ Не выбран', inline: true },
    { name: '📁 Категория комнат', value: wizard.channels.voice_category ? `<#${wizard.channels.voice_category}>` : '❌ Не выбрана', inline: true },
    { name: '👋 Канал приветствий', value: wizard.channels.welcome ? `<#${wizard.channels.welcome}>` : '❌ Не выбран', inline: true },
  ];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(embedTitle)
    .setDescription(embedDesc)
    .addFields(progressFields)
    .setFooter({ text: `Шаг ${wizard.step} из 10 | У вас есть 2 минуты` })

  // Используем editReply, так как предыдущий ответ уже был
  await interaction.update({ embeds: [embed], components: [row] });
  wizard.message = interaction.message;
  wizard.resetTimeout(interaction);
}

// ══════════════════════════════════════════════════════════════════
// ШАГ 6: ФИНАЛИЗАЦИЯ И СОХРАНЕНИЕ В БД
// ══════════════════════════════════════════════════════════════════

/**
 * Финализирует настройку, валидирует данные, сохраняет в БД
 * и отправляет красивое Embed-сообщение с результатом.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {SetupWizard} wizard
 */
async function stepFinalize(interaction, wizard) {
  wizard.step = 10;

  // ─── Валидация ──────────────────────────────────────────────
  if (!wizard.channels.log || !wizard.channels.cmd || !wizard.channels.mod) {
    return interaction.update({
      content: '❌ **Ошибка:** Не все каналы выбраны. Пожалуйста, начните заново с `/setup`.',
      components: [],
      embeds: [],
    });
  }

  // Проверяем, что выбрана хотя бы одна роль
  if (!wizard.selectedRoles || wizard.selectedRoles.length === 0) {
    return interaction.update({
      content: '❌ **Ошибка:** Не выбрано ни одной роли администратора. Пожалуйста, начните заново с `/setup`.',
      components: [],
      embeds: [],
    });
  }

  // ─── Сохранение в БД ────────────────────────────────────────
  try {
    const db = getDb();

    // Сериализуем массивы и объекты в JSON для хранения в SQLite
    // better-sqlite3 хранит TEXT, поэтому JSON.stringify обязателен
    const existing = db.prepare(SQL_GET_CONFIG).get(wizard.guildId);
    let prevChannels = {};
    try {
      prevChannels = existing?.channels ? JSON.parse(existing.channels) : {};
    } catch {
      prevChannels = {};
    }

    const adminRolesJson = JSON.stringify(wizard.selectedRoles);
    const channelsJson = JSON.stringify({
      ...prevChannels,
      log: wizard.channels.log,
      cmd: wizard.channels.cmd,
      mod: wizard.channels.mod,
      voice_panel: wizard.channels.voice_panel || prevChannels.voice_panel || null,
      trigger: wizard.channels.trigger || prevChannels.trigger || null,
      voice_category: wizard.channels.voice_category || prevChannels.voice_category || null,
      welcome: wizard.channels.welcome || prevChannels.welcome || null,
    });

    // UPSERT: если запись для guild_id уже есть — обновляем, иначе вставляем
    db.prepare(SQL_UPSERT_CONFIG).run(
      wizard.guildId,
      wizard.ownerId,
      adminRolesJson,
      channelsJson,
      wizard.note,
    );

    clearGuildConfigCache(wizard.guildId);
    console.log(`[SETUP] Конфигурация сохранена для сервера ${wizard.guildId}`);
  } catch (err) {
    console.error('[SETUP] Ошибка сохранения в БД:', err.message);
    return interaction.update({
      content: `❌ **Ошибка при сохранении:** ${err.message}`,
      components: [],
      embeds: [],
    });
  }

  // ─── Успешный ответ: Embed с деталями ───────────────────────
  // Получаем объекты ролей и каналов для красивого отображения
  const logChannel = interaction.guild.channels.cache.get(wizard.channels.log);
  const cmdChannel = interaction.guild.channels.cache.get(wizard.channels.cmd);
  const modChannel = interaction.guild.channels.cache.get(wizard.channels.mod);
  const voicePanelChannel = wizard.channels.voice_panel ? interaction.guild.channels.cache.get(wizard.channels.voice_panel) : null;
  const triggerChannel = wizard.channels.trigger ? interaction.guild.channels.cache.get(wizard.channels.trigger) : null;
  const voiceCategory = wizard.channels.voice_category ? interaction.guild.channels.cache.get(wizard.channels.voice_category) : null;
  const welcomeChannel = wizard.channels.welcome ? interaction.guild.channels.cache.get(wizard.channels.welcome) : null;

  const roleMentions = wizard.selectedRoles
    .map(id => interaction.guild.roles.cache.get(id))
    .filter(Boolean)
    .map(role => role.toString())
    .join(', ');

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71) // Зелёный — успех
    .setTitle('✅ Сервер успешно настроен!')
    .setDescription('Конфигурация сервера сохранена. Ниже приведены установленные параметры.')
    .addFields(
      { name: '👑 Владелец', value: `<@${wizard.ownerId}>`, inline: true },
      { name: '🆔 ID владельца', value: `\`${wizard.ownerId}\``, inline: true },
      { name: '📝 Примечание', value: wizard.note || '—', inline: true },
      { name: '\u200B', value: '\u200B', inline: false }, // Пустой разделитель
      { name: '👮 Роли администраторов', value: roleMentions || 'Не указаны', inline: false },
      { name: '\u200B', value: '\u200B', inline: false },
{ name: '📋 Канал логов', value: logChannel ? logChannel.toString() : '❌ Не указан', inline: true },
      { name: '💬 Канал команд', value: cmdChannel ? cmdChannel.toString() : '❌ Не указан', inline: true },
      { name: '🛡️ Канал модерации', value: modChannel ? modChannel.toString() : '❌ Не указан', inline: true },
      { name: '🎤 Канал голосовой панели', value: voicePanelChannel ? voicePanelChannel.toString() : '❌ Не указан', inline: true },
      { name: '➕ Канал создания комнат', value: triggerChannel ? triggerChannel.toString() : '❌ Не указан', inline: true },
      { name: '📁 Категория комнат', value: voiceCategory ? voiceCategory.toString() : '❌ Не указана', inline: true },
      { name: '👋 Канал приветствий', value: welcomeChannel ? welcomeChannel.toString() : '❌ Не указан', inline: true },
    )
    .setFooter({ text: `Сервер: ${interaction.guild.name} | ${new Date().toLocaleString('ru-RU')}` })

  // Убираем все компоненты и показываем финальный Embed
  await interaction.update({ embeds: [embed], components: [] });

  // Очищаем сессию мастера
  wizard.destroy();
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК ВЗАИМОДЕЙСТВИЙ (ModalSubmit, SelectMenu, ChannelSelect)
// ══════════════════════════════════════════════════════════════════

/**
 * Главный обработчик для всех шагов мастера настройки.
 * Вызывается из index.js в events.InteractionCreate.
 *
 * Возвращает true, если взаимодействие было обработано (принадлежит мастеру),
 * и false — если это не наше взаимодействие.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleSetupInteraction(interaction) {
  try {
    // ─── Шаг 1: Modal Submit ───────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'setup_modal') {
      const wizard = getWizard(interaction.guildId, interaction.user.id);
      if (!wizard) {
        await interaction.reply({
          content: '❌ **Сессия настройки устарела.** Пожалуйста, начните заново с команды `/setup`.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      // Валидация: ID владельца должно быть числом
      const rawOwnerId = interaction.fields.getTextInputValue('setup_owner_id').trim();
      if (!/^\d{17,20}$/.test(rawOwnerId)) {
        await interaction.reply({
          content: '❌ **Ошибка:** ID владельца должен быть числом (17-20 цифр). Пожалуйста, начните заново с `/setup`.',
          flags: MessageFlags.Ephemeral,
        });
        wizard.destroy();
        return true;
      }

      wizard.ownerId = rawOwnerId;
      wizard.note = interaction.fields.getTextInputValue('setup_note').trim() || '';

      // Переходим к шагу 2: выбор ролей
      await stepSelectRoles(interaction, wizard);
      return true;
    }

    // ─── Шаг 2: SelectMenu с ролями ───────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'setup_select_roles') {
      const wizard = getWizard(interaction.guildId, interaction.user.id);
      if (!wizard) {
        await interaction.reply({
          content: '❌ **Сессия настройки устарела.** Пожалуйста, начните заново с команды `/setup`.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      // Сохраняем выбранные роли
      wizard.selectedRoles = interaction.values;

      // Переходим к шагу 3: выбор канала логов
      await stepSelectChannel(
        interaction,
        wizard,
        'log',
        'Выберите канал для логов...',
        '📋 Шаг 3: Выбор канала логов',
        'Выберите канал, куда бот будет отправлять логи всех действий.\nЭто могут быть действия модерации, экономики и т.д.',
      );
      return true;
    }

    // ─── Шаги 3-5: ChannelSelect ──────────────────────────────
    if (interaction.isChannelSelectMenu && interaction.isChannelSelectMenu() && interaction.customId.startsWith('setup_channel_')) {
      const wizard = getWizard(interaction.guildId, interaction.user.id);
      if (!wizard) {
        await interaction.reply({
          content: '❌ **Сессия настройки устарела.** Пожалуйста, начните заново с команды `/setup`.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      // Определяем, какой канал выбран: log, cmd или mod
      const channelKey = interaction.customId.replace('setup_channel_', '');
      const selectedChannelId = interaction.values[0];

      // Сохраняем выбранный канал
      wizard.channels[channelKey] = selectedChannelId;

      // Определяем следующий шаг
      const nextSteps = {
        log: { key: 'cmd', label: 'Выберите канал для команд...', title: '💬 Шаг 4: Выбор канала команд', desc: 'Выберите канал, в котором бот будет отвечать на команды и публиковать системные сообщения.' },
        cmd: { key: 'mod', label: 'Выберите канал для модерации...', title: '🛡️ Шаг 5: Выбор канала модерации', desc: 'Выберите канал для уведомлений о модерации: предупреждения, муты, баны.' },
        mod: { key: 'voice_panel', label: 'Выберите канал для голосовой панели...', title: '🎤 Шаг 6: Выбор канала голосовой панели', desc: 'Выберите канал, в котором будет размещена панель управления голосовыми комнатами.' },
        voice_panel: { key: 'trigger', label: 'Выберите канал создания комнат...', title: '➕ Шаг 7: Канал-триггер комнат', desc: 'Выберите голосовой канал, зайдя в который пользователь автоматически получит приватную комнату.' },
        trigger: { key: 'voice_category', label: 'Выберите категорию для комнат...', title: '📁 Шаг 8: Категория приватных комнат', desc: 'Выберите категорию, внутри которой бот будет создавать приватные голосовые комнаты.' },
        welcome: null,
        voice_category: { key: 'welcome', label: 'Выберите канал приветствий...', title: '👋 Шаг 9: Канал приветствий', desc: 'Выберите текстовый канал, куда бот отправит приветствие, если у новичка закрыты личные сообщения.' },
      };

      const nextStep = nextSteps[channelKey];

      if (nextStep) {
        // Есть ещё каналы для выбора
        await stepSelectChannel(
          interaction,
          wizard,
          nextStep.key,
          nextStep.label,
          nextStep.title,
          nextStep.desc,
        );
      } else {
        // Все каналы выбраны — финализируем
        await stepFinalize(interaction, wizard);
      }

      return true;
    }

    return false; // Не наше взаимодействие
  } catch (error) {
    console.error('[SETUP] Ошибка в handleSetupInteraction:', error.message);
    console.error('[SETUP] Stack:', error.stack);
    // Пытаемся уведомить пользователя об ошибке
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: '❌ Произошла ошибка в процессе настройки. Пожалуйста, начните заново с `/setup`.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: '❌ Произошла ошибка в процессе настройки. Пожалуйста, начните заново с `/setup`.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    } catch (_) {}

    // Очищаем сессию при ошибке
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const wiz = activeWizards.get(key);
    if (wiz) wiz.destroy();

    return true;
  }
}

// ══════════════════════════════════════════════════════════════════
// ЭКСПОРТ КОМАНДЫ
// ══════════════════════════════════════════════════════════════════

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Мастер: владелец, админы, каналы сервера')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Только с правами ManageGuild
    .setDMPermission(false), // Запрещаем в ЛС — команда только для серверов

  async execute(interaction) {
    // ─── Проверка: команда должна быть вызвана на сервере ────
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Эта команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ─── Проверка прав: только ManageGuild ───────────────────
    // Проверка через PermissionFlagsBits — стандартный способ discord.js v14
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ **У вас нет прав для настройки сервера.**\nНеобходимо право "Управлять сервером" (ManageGuild).',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ─── Убедимся, что таблица существует ────────────────────
    checkAndCreateTable();

    // ─── Открываем Modal (Шаг 1) ─────────────────────────────
    await showSetupModal(interaction);
  },
};
