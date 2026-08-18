  // ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: /room-settings — Панель управления приватной комнатой
// ══════════════════════════════════════════════════════════════════
//
// ГАРАНТИРОВАННОЕ ОТСЛЕЖИВАНИЕ СООБЩЕНИЯ:
//   • При создании панели сохраняем messageId в sessionCache.
//   • При нажатии кнопки сначала ищем сообщение в кэше сессии.
//   • Если нашли — редактируем его (message.edit), НЕ создаём новое.
//   • Если не нашли — пытаемся сходить в API: fetch(messageId).
//   • Если и там нет — сообщаем, что панель устарела.
//
// ЗАЩИТА ОТ ДВОЙНОГО КЛИКА:
//   • Механизм блокировки (cooldown) на 2 секунды для каждой комнаты.
//   • Флаг isProcessing блокирует обработку пока выполняется операция.
//
// ОБРАБОТКА 429 (TOO MANY REQUESTS):
//   • Экспоненциальный backoff: 1с, 2с, 4с, макс 8с.
//
// СТРУКТУРА customId:
//   room_action_{actionType}_{voiceChannelId}_{roomDbId}
//   Пример: room_action_set_private_123456789_42
//
// ТЕКСТЫ — строго на русском, с эмодзи для визуала.
//
// EMBED И КОМПОНЕНТЫ — IS_COMPONENTS_V2:
//   Все Embed создаются через new EmbedBuilder() со строгой структурой:
//   title, description, color, fields[], footer.
//   Все кнопки — через new ButtonBuilder() + ActionRowBuilder().
//   Никаких прямых JSON-объектов { type: 2 } — только конструкторы v14.
//   При message.edit() всегда передаём ПОЛНЫЙ набор компонентов.
// ══════════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { getDb } from '../database.js';
import { triggerChannelMention } from '../utils/guildConfig.js';

const ROOM_ACTIONS = 'add_member|invite|toggle_lock|toggle_hide|settings|delete|limit|rename|kick|transfer';
const PROMPT_ACTIONS = new Set(['add_member', 'invite', 'settings', 'rename', 'limit', 'kick', 'transfer', 'delete']);

// ══════════════════════════════════════════════════════════════════
// 1. ГЛОБАЛЬНОЕ ХРАНИЛИЩЕ СЕССИЙ (КЭШ СООБЩЕНИЙ)
// ══════════════════════════════════════════════════════════════════
//
// sessionCache — центральный Map для отслеживания всех активных панелей.
// Ключ: `${guildId}:${voiceChannelId}`
// Значение:
//   messageId      — ID сообщения с панелью (для message.edit)
//   channelId      — ID канала, где висит панель
//   ownerId        — ID владельца комнаты
//   voiceChannelId — ID голосового канала комнаты
//   roomDbId       — ID записи в БД (user_voice_channels.id)
//   timeoutTimer   — ID таймера для очистки (10 мин бездействия)
//   isProcessing   — флаг блокировки (защита от двойного клика)
//   cooldownTimer  — ID таймера для снятия isProcessing
// ══════════════════════════════════════════════════════════════════

const sessionCache = new Map();

// Константы
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 минут бездействия → очистка
const COOLDOWN_MS = 2000;               // 2 секунды защиты от двойного клика
const MAX_RETRY_DELAY_MS = 8000;        // Максимальная задержка при 429
const INITIAL_RETRY_DELAY_MS = 1000;    // Начальная задержка при 429

// ══════════════════════════════════════════════════════════════════
// 2. ФУНКЦИИ УПРАВЛЕНИЯ СЕССИЕЙ
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт или обновляет сессию в sessionCache.
 * Сбрасывает таймер очистки (если был) и устанавливает новый.
 *
 * @param {string} guildId — ID сервера
 * @param {string} voiceChannelId — ID голосового канала комнаты
 * @param {object} sessionData — данные сессии
 * @param {string} sessionData.messageId — ID сообщения панели
 * @param {string} sessionData.channelId — ID канала, где сообщение
 * @param {string} sessionData.ownerId — ID владельца
 * @param {number} sessionData.roomDbId — ID записи в БД
 */
function createSession(guildId, voiceChannelId, sessionData) {
  const key = `${guildId}:${voiceChannelId}`;

  // Если сессия уже есть — очищаем старый таймер
  const existing = sessionCache.get(key);
  if (existing && existing.timeoutTimer) {
    clearTimeout(existing.timeoutTimer);
  }
  if (existing && existing.cooldownTimer) {
    clearTimeout(existing.cooldownTimer);
  }

  // Устанавливаем таймер авто-очистки (10 минут бездействия)
  const timeoutTimer = setTimeout(() => {
    cleanupSession(guildId, voiceChannelId);
  }, SESSION_TTL_MS);

  // Сохраняем сессию (isProcessing: false — не заблокирована)
  sessionCache.set(key, {
    messageId: sessionData.messageId,
    channelId: sessionData.channelId,
    ownerId: sessionData.ownerId,
    voiceChannelId: voiceChannelId,
    roomDbId: sessionData.roomDbId,
    timeoutTimer,
    isProcessing: false,
    cooldownTimer: null,
  });

  return sessionCache.get(key);
}

/**
 * Очищает сессию: удаляет из кэша, сбрасывает таймеры.
 * Вызывается при таймауте, удалении комнаты или ошибке Unknown Message.
 *
 * @param {string} guildId — ID сервера
 * @param {string} voiceChannelId — ID голосового канала
 */
function cleanupSession(guildId, voiceChannelId) {
  const key = `${guildId}:${voiceChannelId}`;
  const session = sessionCache.get(key);
  if (!session) return;

  // Очищаем все таймеры
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  if (session.cooldownTimer) clearTimeout(session.cooldownTimer);

  sessionCache.delete(key);
  console.log(`[ROOM-SETTINGS] Сессия очищена: ${key}`);
}

/**
 * Сбрасывает таймер авто-очистки сессии.
 * Вызывается при каждом взаимодействии с кнопками панели.
 *
 * @param {string} key — ключ сессии `${guildId}:${voiceChannelId}`
 */
function refreshSessionTTL(key) {
  const session = sessionCache.get(key);
  if (!session) return;

  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  session.timeoutTimer = setTimeout(() => {
    cleanupSession(
      key.split(':')[0],
      key.split(':')[1],
    );
  }, SESSION_TTL_MS);
}

/**
 * Устанавливает блокировку на комнату (защита от двойного клика).
 *
 * @param {string} key — ключ сессии
 * @returns {boolean} — true если блокировка успешно установлена, false если уже заблокировано
 */
function acquireProcessingLock(key) {
  const session = sessionCache.get(key);
  if (!session) return false;
  if (session.isProcessing) return false; // Уже обрабатывается — отклоняем

  session.isProcessing = true;

  // Автоматически снимаем блокировку через COOLDOWN_MS
  session.cooldownTimer = setTimeout(() => {
    const s = sessionCache.get(key);
    if (s) {
      s.isProcessing = false;
      if (s.cooldownTimer) {
        clearTimeout(s.cooldownTimer);
        s.cooldownTimer = null;
      }
    }
  }, COOLDOWN_MS);

  return true;
}

/**
 * Снимает блокировку вручную (после успешной операции).
 *
 * @param {string} key — ключ сессии
 */
function releaseProcessingLock(key) {
  const session = sessionCache.get(key);
  if (!session) return;

  session.isProcessing = false;
  if (session.cooldownTimer) {
    clearTimeout(session.cooldownTimer);
    session.cooldownTimer = null;
  }
}

/**
 * Ищет сессию по voiceChannelId из customId.
 * Сначала — по точному ключу, затем — перебором по roomDbId.
 *
 * @param {string} guildId
 * @param {string} voiceChannelId
 * @returns {object|null}
 */
function findSession(guildId, voiceChannelId) {
  const key = `${guildId}:${voiceChannelId}`;
  return sessionCache.get(key) || null;
}

// ══════════════════════════════════════════════════════════════════
// 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Экспоненциальный backoff для обработки 429 Too Many Requests.
 * Ждёт: 1с, 2с, 4с, затем 8с (макс).
 *
 * @param {number} attempt — номер попытки (0, 1, 2...)
 * @returns {Promise<void>}
 */
function exponentialBackoff(attempt) {
  const delay = Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt),
    MAX_RETRY_DELAY_MS,
  );
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Безопасно получает голосовой канал из кэша или через API.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @returns {Promise<import('discord.js').VoiceChannel|null>}
 */
async function fetchVoiceChannelSafe(guild, channelId) {
  try {
    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || channel.type !== ChannelType.GuildVoice) return null;
    return channel;
  } catch {
    return null;
  }
}

/**
 * Безопасно получает сообщение из кэша канала или через API.
 *
 * @param {import('discord.js').TextChannel} channel
 * @param {string} messageId
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function fetchMessageSafe(channel, messageId) {
  try {
    // Сначала проверяем кэш сообщений в канале
    let message = channel.messages.cache.get(messageId);
    if (!message) {
      message = await channel.messages.fetch(messageId).catch(() => null);
    }
    return message;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 4. ПОСТРОЕНИЕ EMBED И КОМПОНЕНТОВ ПАНЕЛИ (IS_COMPONENTS_V2)
// ══════════════════════════════════════════════════════════════════
//
// ВСЕ Embed создаются через new EmbedBuilder() — строгая структура:
//   title, description, color, fields[], footer
// Никаких пустых объектов или undefined в полях.
//
// Компоненты (кнопки) — через new ButtonBuilder() + ActionRowBuilder().
// Никаких прямых JSON-объектов { type: 2 } — только конструкторы v14.
//
// При обновлении сообщения (message.edit) всегда передаём ПОЛНЫЙ
// набор компонентов заново. Discord API требует полной замены
// массива components — частичное обновление не работает.
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт главный Embed для панели управления комнатой (IS_COMPONENTS_V2).
 *
 * Спецификация:
 * - title: `[🎮 АКТИВНА] #ИмяКанала` (с эмодзи статуса)
 * - description: краткое резюме настроек или «Настройки не загружены»
 * - color: динамический — 0x00FF00 / 0xFFFF00 / 0xFF0000
 * - fields: Владелец, Лимит участников (X/20), Тип доступа
 * - footer: «Панель управления комнатой | ID: [channelId]»
 *
 * @param {object} roomData — данные комнаты (owner_id, is_locked, voice_channel_id, id, channelName, memberCount)
 * @param {string} status — статус: 'Активна' | 'В обработке' | 'Ошибка'
 * @param {string|null} lastAction — описание последнего действия (может быть null)
 * @returns {EmbedBuilder}
 */
function isChannelHidden(voiceChannel, guildId) {
  const overwrite = voiceChannel?.permissionOverwrites?.cache.get(guildId);
  return Boolean(overwrite?.deny?.has(PermissionFlagsBits.ViewChannel));
}

function enrichRoomData(room, voiceChannel) {
  return {
    ...room,
    voice_channel_id: voiceChannel?.id || room.voice_channel_id,
    channelName: voiceChannel?.name || 'Комната',
    memberCount: voiceChannel ? voiceChannel.members.filter((m) => !m.user.bot).size : 0,
    userLimit: voiceChannel?.userLimit || 0,
    is_hidden: voiceChannel ? (isChannelHidden(voiceChannel, voiceChannel.guild.id) ? 1 : 0) : 0,
  };
}

function createMainEmbed(roomData, status = 'Активна', lastAction = null) {
  try {
    if (!roomData || typeof roomData !== 'object') {
      throw new Error('roomData is null or not an object');
    }

    const statusColor = status === 'Ошибка' ? 0xED4245 : status === 'В обработке' ? 0xFEE75C : 0x57F287;
    const channelName = roomData.channelName || 'Комната';
    const currentMembers = typeof roomData.memberCount === 'number' ? roomData.memberCount : 0;
    const limit = roomData.userLimit > 0 ? String(roomData.userLimit) : '∞';
    const access = roomData.is_locked ? 'закрыта' : 'открыта';
    const visibility = roomData.is_hidden ? 'скрыта' : 'видна';

    const embed = new EmbedBuilder()
      .setTitle(`#${channelName}`)
      .setDescription(
        `\`${access}\`  ·  \`${visibility}\`  ·  \`${currentMembers}/${limit}\`` +
        (lastAction ? `\n${lastAction}` : '')
      )
      .setColor(statusColor)
      .addFields(
        { name: 'Владелец', value: roomData.owner_id ? `<@${roomData.owner_id}>` : '—', inline: true },
        { name: 'Доступ', value: roomData.is_locked ? '🔒 только свои' : '🌐 все', inline: true },
        { name: 'Канал', value: roomData.voice_channel_id ? `<#${roomData.voice_channel_id}>` : '—', inline: true },
      )
      .setFooter({ text: '🔒 👁 👥 ✏ ➕   ·   👢 👑 ⚙ 🗑' });

    return embed;
  } catch (error) {
    console.error(`[ROOM-SETTINGS] Ошибка создания Embed: ${error.message}`);
    return new EmbedBuilder()
      .setTitle('Ошибка панели')
      .setDescription('Запустите `/room-settings` заново.')
      .setColor(0xED4245);
  }
}

function roomBtn(action, vcId, dbId, { emoji, label, style, disabled }) {
  return new ButtonBuilder()
    .setCustomId(`room_action_${action}_${vcId}_${dbId}`)
    .setEmoji(emoji)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function createActionRows(roomData, { isLocked = false, isHidden = false, isProcessing = false } = {}) {
  const vcId = roomData?.voice_channel_id || 'unknown';
  const dbId = roomData?.id || '0';
  const off = isProcessing;

  const row1 = new ActionRowBuilder().addComponents(
    roomBtn('toggle_lock', vcId, dbId, {
      emoji: isLocked ? '🔓' : '🔒',
      label: isLocked ? 'Открыть' : 'Закрыть',
      style: isLocked ? ButtonStyle.Success : ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('toggle_hide', vcId, dbId, {
      emoji: isHidden ? '👁' : '🙈',
      label: isHidden ? 'Показать' : 'Скрыть',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('limit', vcId, dbId, {
      emoji: '👥',
      label: 'Лимит',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('rename', vcId, dbId, {
      emoji: '✏',
      label: 'Имя',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('invite', vcId, dbId, {
      emoji: '➕',
      label: 'Вход',
      style: ButtonStyle.Primary,
      disabled: off,
    }),
  );

  const row2 = new ActionRowBuilder().addComponents(
    roomBtn('kick', vcId, dbId, {
      emoji: '👢',
      label: 'Кик',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('transfer', vcId, dbId, {
      emoji: '👑',
      label: 'Владелец',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('settings', vcId, dbId, {
      emoji: '⚙',
      label: 'Права',
      style: ButtonStyle.Secondary,
      disabled: off,
    }),
    roomBtn('delete', vcId, dbId, {
      emoji: '🗑',
      label: 'Удалить',
      style: ButtonStyle.Danger,
      disabled: off,
    }),
  );

  return [row1, row2];
}

export function buildRoomPanel(room, voiceChannel, { lastAction = null, status = 'Активна' } = {}) {
  const roomData = enrichRoomData(room, voiceChannel);
  return {
    embeds: [createMainEmbed(roomData, status, lastAction)],
    components: createActionRows(roomData, {
      isLocked: !!roomData.is_locked,
      isHidden: !!roomData.is_hidden,
      isProcessing: false,
    }),
  };
}

async function showUserPicker(interaction, kind, room) {
  const labels = {
    invite: 'Кого пустить в комнату?',
    kick: 'Кого выгнать из комнаты?',
    transfer: 'Кому передать комнату?',
  };
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`room_user_${kind}_${room.voice_channel_id}_${room.id}`)
      .setPlaceholder('Выбери участника')
      .setMinValues(1)
      .setMaxValues(1),
  );
  await interaction.reply({
    content: labels[kind] || 'Выбери участника',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

function showTextModal(customId, title, fieldId, label, placeholder, value = '') {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const input = new TextInputBuilder()
    .setCustomId(fieldId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholder)
    .setRequired(true);
  if (value) input.setValue(String(value).slice(0, 100));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// ══════════════════════════════════════════════════════════════════
// 5. ОСНОВНОЙ ОБРАБОТЧИК КНОПОК ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════
//
// АЛГОРИТМ ПОИСКА СООБЩЕНИЯ:
// 1. Парсим customId: room_action_{actionType}_{voiceChannelId}_{roomDbId}
// 2. Ищем сессию в sessionCache по `${guildId}:${voiceChannelId}`
// 3. Если сессия найдена:
//    a. Пытаемся получить сообщение из channel.messages.cache
//    b. Если нет в кэше — делаем channel.messages.fetch(messageId)
//    c. Если сообщение найдено — используем его для message.edit()
// 4. Если сессия НЕ найдена:
//    a. Ищем комнату в БД по roomDbId
//    b. Если комната есть — создаём временную сессию
//    c. Пытаемся найти сообщение через fetch в том же канале
//    d. Если не нашли — отвечаем, что панель устарела
//
// ЗАЩИТА ОТ ДВОЙНОГО КЛИКА (cooldown):
//   • acquireProcessingLock() — атомарно устанавливает флаг
//   • Если флаг уже true — второй клик игнорируется
//   • Флаг автоматически сбрасывается через 2 секунды
//
// ОБРАБОТКА 429:
//   • В цикле до 3 попыток с exponentialBackoff()
//   • Если все попытки исчерпаны — панель помечается как "Ошибка"
// ══════════════════════════════════════════════════════════════════

/**
 * Главный диспетчер нажатий кнопок панели управления комнатой.
 * Вызывается из index.js при customId.startsWith('room_action_').
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} — true если взаимодействие обработано
 */
export async function handleRoomSettingsButtons(interaction) {
  const { customId, user, guild } = interaction;

  if (customId.startsWith('room_confirm_delete_')) {
    return handleDeleteConfirm(interaction, true);
  }
  if (customId.startsWith('room_cancel_delete_')) {
    return handleDeleteConfirm(interaction, false);
  }

  const parsed = customId.match(new RegExp(`^room_action_(${ROOM_ACTIONS})_(\\d+)_(\\d+)$`));
  if (!parsed) return false;

  const actionType = parsed[1];
  const voiceChannelId = parsed[2];
  const roomDbId = parseInt(parsed[3], 10);

  if (Number.isNaN(roomDbId)) return false;

  const sessionKey = `${guild.id}:${voiceChannelId}`;

  // ═══════════════════════════════════════════════════════════════
  // ЗАЩИТА ОТ ДВОЙНОГО КЛИКА (стр. 5 требований)
  // ═══════════════════════════════════════════════════════════════
  if (!acquireProcessingLock(sessionKey)) {
    // Если не удалось захватить блокировку — комната уже обрабатывается
    try {
      await interaction.reply({
        content: '⏳ **Подождите!** Предыдущая операция ещё выполняется. Пожалуйста, подождите 2 секунды.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // Игнорируем ошибку реплая
    }
    return true;
  }

  // Обёртка try/catch чтобы гарантированно снять блокировку
  try {
    await processButtonAction(interaction, actionType, voiceChannelId, roomDbId, sessionKey);
  } catch (error) {
    console.error(`[ROOM-SETTINGS] Необработанная ошибка: ${error.message}`);

    // Пытаемся уведомить пользователя
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: '❌ Произошла критическая ошибка. Панель может быть повреждена. Запустите `/room-settings` заново.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: '❌ Произошла критическая ошибка. Панель может быть повреждена. Запустите `/room-settings` заново.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    } catch {
      // Игнорируем
    }

    // Обновляем панель в статус "Ошибка", если можем найти сообщение
    try {
      const session = findSession(guild.id, voiceChannelId);
      if (session) {
        const channel = guild.channels.cache.get(session.channelId);
        if (channel) {
          const msg = await fetchMessageSafe(channel, session.messageId);
          if (msg) {
            const db = getDb();
            const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
            if (room) {
              const vc = await fetchVoiceChannelSafe(guild, voiceChannelId);
              // Формируем roomData для createMainEmbed и createActionRows
              const roomData = enrichRoomData(room, vc);
              const embed = createMainEmbed(
                roomData,
                'Ошибка',
                `❌ Ошибка: ${error.message.slice(0, 100)}`,
              );
              const components = createActionRows(
                roomData,
                { isLocked: !!room.is_locked, isHidden: !!roomData.is_hidden, isProcessing: false },
              );
              await msg.edit({ embeds: [embed], components }).catch(() => {});
            }
          }
        }
      }
    } catch {
      // Игнорируем
    }
  } finally {
    // ═══════════════════════════════════════════════════════════
    // Гарантированно снимаем блокировку (даже при ошибке)
    // ═══════════════════════════════════════════════════════════
    releaseProcessingLock(sessionKey);
  }

  return true;
}

/**
 * Внутренняя функция обработки действия кнопки.
 * Вынесена отдельно для чистой обработки блокировок.
 */
async function processButtonAction(interaction, actionType, voiceChannelId, roomDbId, sessionKey) {
  const { guild, user } = interaction;

  // ─── Шаг 1: Поиск комнаты в БД ──────────────────────────────
  const db = getDb();
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    // Комната удалена из БД — чистим сессию
    cleanupSession(guild.id, voiceChannelId);
    return interaction.reply({
      content: '❌ **Комната не найдена в базе данных.** Возможно, она была удалена. Запустите `/room-settings` заново.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Шаг 2: Валидация — существует ли голосовой канал ───────
  const voiceChannel = await fetchVoiceChannelSafe(guild, voiceChannelId);
  if (!voiceChannel) {
    // Канал удалён — чистим БД и сессию
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(roomDbId);
    cleanupSession(guild.id, voiceChannelId);
    return interaction.reply({
      content: '❌ **Голосовой канал не найден.** Возможно, он был удалён вручную. Запустите `/room-settings` заново.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Шаг 3: Валидация — проверка прав пользователя ──────────
  // Проверяем, что нажавший — владелец комнаты или администратор сервера
  const isOwner = room.owner_id === user.id;
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !isAdmin) {
    return interaction.reply({
      content: '❌ **Только владелец комнаты или администратор сервера** может управлять этой панелью.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Шаг 4: Поиск сообщения панели ──────────────────────────
  // Сначала ищем в кэше сессии
  let session = findSession(guild.id, voiceChannelId);
  let targetMessage = null;
  let targetChannel = null;

  if (session) {
    // Сессия найдена — пытаемся получить сообщение
    targetChannel = guild.channels.cache.get(session.channelId);
    if (targetChannel) {
      targetMessage = await fetchMessageSafe(targetChannel, session.messageId);
    }
  }

  // Если не нашли через сессию — пробуем восстановить
  if (!targetMessage) {
    // Сессия могла быть очищена по таймауту, но панель всё ещё существует.
    // Ищем сообщение бота в текущем канале (interaction.channel).
    // Это fallback: если сессия утеряна, но панель ещё висит.
    const currentChannel = interaction.channel;
    if (currentChannel) {
      // Пытаемся найти наше сообщение по ID из customId (если сохранили)
      // или ищем последнее сообщение бота с Embed
      try {
        // Смотрим последние 10 сообщений бота в канале
        const messages = await currentChannel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m =>
          m.author.id === interaction.client.user.id &&
          m.embeds.length > 0 &&
          (m.embeds[0].title?.startsWith('#') ||
            m.embeds[0].footer?.text?.includes('🔒 👁')),
        );
        if (botMessages.size > 0) {
          targetMessage = botMessages.first();
          targetChannel = currentChannel;

          // Восстанавливаем сессию
          session = createSession(guild.id, voiceChannelId, {
            messageId: targetMessage.id,
            channelId: currentChannel.id,
            ownerId: room.owner_id,
            roomDbId: roomDbId,
          });
        }
      } catch {
        // Ошибка fetch — игнорируем
      }
    }
  }

  // Если всё ещё не нашли сообщение — панель устарела
  if (!targetMessage || !targetChannel) {
    cleanupSession(guild.id, voiceChannelId);
    return interaction.reply({
      content: '❌ **Панель управления устарела.** Сообщение с панелью не найдено. Запустите `/room-settings` заново.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Обновляем TTL сессии (продлеваем на 10 минут)
  refreshSessionTTL(sessionKey);

  // Модалки нельзя показывать после deferUpdate — отвечаем сразу.
  const isPromptAction = PROMPT_ACTIONS.has(actionType);

  if (!isPromptAction) {
    try {
      await interaction.deferUpdate();
    } catch (err) {
      console.warn(`[ROOM-SETTINGS] deferUpdate не удался: ${err.message}`);
    }
  }

  // ─── Шаг 6: Выполнение действия ─────────────────────────────
  let actionResult = null;

  try {
    actionResult = await executeRoomAction(
      interaction, actionType, room, voiceChannel, guild, db,
    );
  } catch (error) {
    // Специальная обработка для 429 Too Many Requests
    if (error.code === 429 || (error.message && error.message.includes('429'))) {
      console.warn(`[ROOM-SETTINGS] 429 Too Many Requests для комнаты ${voiceChannelId}. Применяю backoff...`);

      // Пробуем с экспоненциальным backoff (до 3 попыток)
      let retrySuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await exponentialBackoff(attempt);
        try {
          actionResult = await executeRoomAction(
            interaction, actionType, room, voiceChannel, guild, db,
          );
          retrySuccess = true;
          console.log(`[ROOM-SETTINGS] Повторная попытка ${attempt + 1} успешна.`);
          break;
        } catch (retryError) {
          console.warn(`[ROOM-SETTINGS] Попытка ${attempt + 1} не удалась: ${retryError.message}`);
          if (retryError.code !== 429 && !retryError.message?.includes('429')) {
            throw retryError; // Если не 429 — пробрасываем дальше
          }
        }
      }

      if (!retrySuccess) {
        throw new Error('Rate limited (429) после 3 попыток с backoff.');
      }
    } else {
      throw error; // Любая другая ошибка — пробрасываем
    }
  }

  // После showModal взаимодействие уже закрыто — панель не трогаем.
  if (isPromptAction) return;

  // ─── Шаг 7: Обновление панели (message.edit) ────────────────
  // Определяем статус для Embed
  const embedStatus = 'Активна';
  const lastActionText = actionResult?.actionText || null;

  // Получаем актуальные данные из БД (после выполнения действия)
  const updatedRoom = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  const currentVoiceChannel = await fetchVoiceChannelSafe(guild, voiceChannelId);

  if (!currentVoiceChannel) {
    // Канал удалён в процессе — чистим сессию
    cleanupSession(guild.id, voiceChannelId);
    return interaction.followUp({
      content: '❌ **Голосовой канал был удалён** во время выполнения операции. Панель закрыта.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  // Формируем roomData для createMainEmbed и createActionRows
  const roomData = enrichRoomData(updatedRoom || room, currentVoiceChannel);

  const newEmbed = createMainEmbed(roomData, embedStatus, lastActionText);

  const newComponents = createActionRows(roomData, {
    isLocked: !!roomData.is_locked,
    isHidden: !!roomData.is_hidden,
    isProcessing: false,
  });

  // ─── Шаг 8: Редактирование сообщения с обработкой ошибок ───
  try {
    await targetMessage.edit({
      embeds: [newEmbed],
      components: newComponents,
    });
  } catch (editError) {
    // ═══════════════════════════════════════════════════════════
    // ОБРАБОТКА: Unknown Message — панель удалена
    // ═══════════════════════════════════════════════════════════
    if (editError.code === 10008) {
      console.warn(`[ROOM-SETTINGS] Сообщение панели удалено (${targetMessage.id}). Очищаем сессию.`);
      cleanupSession(guild.id, voiceChannelId);

      // Уведомляем пользователя (если interaction ещё жив)
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ **Панель управления была удалена.** Запустите `/room-settings` заново.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      } catch {
        // Игнорируем
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // ОБРАБОТКА: 429 Too Many Requests при edit
    // ═══════════════════════════════════════════════════════════
    if (editError.code === 429 || editError.message?.includes('429')) {
      console.warn(`[ROOM-SETTINGS] 429 при edit сообщения ${targetMessage.id}. Backoff...`);

      for (let attempt = 0; attempt < 3; attempt++) {
        await exponentialBackoff(attempt);
        try {
          await targetMessage.edit({
            embeds: [newEmbed],
            components: newComponents,
          });
          break; // Успешно
        } catch (retryError) {
          if (retryError.code === 10008) {
            cleanupSession(guild.id, voiceChannelId);
            return;
          }
          if (retryError.code !== 429 && !retryError.message?.includes('429')) {
            throw retryError;
          }
          // Если снова 429 — продолжаем цикл
        }
      }
    } else {
      // Любая другая ошибка — логируем, но не ломаем бота
      console.error(`[ROOM-SETTINGS] Ошибка при edit сообщения: ${editError.message}`);
    }
  }

  // ─── Шаг 9: Подтверждение пользователю ──────────────────────
  try {
    if (actionResult?.followUpText) {
      await interaction.followUp({
        content: actionResult.followUpText,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  } catch {
    // Игнорируем ошибки followUp
  }
}

// ══════════════════════════════════════════════════════════════════
// 6. ЛОГИКА ДЕЙСТВИЙ (бизнес-операции над комнатой)
// ══════════════════════════════════════════════════════════════════

/**
 * Выполняет действие над комнатой (lock/unlock, delete, settings).
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} actionType — тип действия (toggle_lock, add_member, settings, delete)
 * @param {object} room — запись из БД
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').Guild} guild
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{actionText: string, followUpText: string|null}>}
 */
async function executeRoomAction(interaction, actionType, room, voiceChannel, guild, db) {
  switch (actionType) {
    // ─── Toggle Lock: Закрыть/Открыть доступ ───────────────────
    case 'toggle_lock': {
      if (room.is_locked) {
        // Открываем доступ: сбрасываем deny Connect для @everyone
        await voiceChannel.permissionOverwrites.edit(guild.id, {
          Connect: null, // null = нейтрально (наследуется от категории)
          Speak: null,
        });
        db.prepare('UPDATE user_voice_channels SET is_locked = 0 WHERE id = ?').run(room.id);

        return {
          actionText: '✅ **Доступ изменён:** комната теперь **открыта** для всех.',
          followUpText: '🔓 Доступ открыт! Теперь все могут заходить в комнату.',
        };
      } else {
        // Закрываем доступ: @everyone — запрет Connect и Speak
        await voiceChannel.permissionOverwrites.edit(guild.id, {
          Connect: false,
          Speak: false,
        });
        // Владельцу — полный доступ
        await voiceChannel.permissionOverwrites.edit(room.owner_id, {
          Connect: true,
          Speak: true,
        });
        db.prepare('UPDATE user_voice_channels SET is_locked = 1 WHERE id = ?').run(room.id);

        return {
          actionText: '🔒 **Доступ изменён:** комната теперь **закрыта** (только владелец).',
          followUpText: '🔒 Доступ закрыт! Только вы можете заходить в комнату.',
        };
      }
    }

    case 'toggle_hide': {
      const hidden = isChannelHidden(voiceChannel, guild.id);
      if (hidden) {
        await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
        return {
          actionText: 'Комната снова **видна** в списке каналов.',
          followUpText: '👁 Канал показан.',
        };
      }
      await voiceChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
      await voiceChannel.permissionOverwrites.edit(room.owner_id, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      });
      return {
        actionText: 'Комната **скрыта** из списка каналов.',
        followUpText: '🙈 Канал скрыт. Те, кого пустили, по-прежнему видят его.',
      };
    }

    case 'invite':
    case 'add_member': {
      await showUserPicker(interaction, 'invite', room);
      return { actionText: null, followUpText: null };
    }

    case 'kick': {
      await showUserPicker(interaction, 'kick', room);
      return { actionText: null, followUpText: null };
    }

    case 'transfer': {
      await showUserPicker(interaction, 'transfer', room);
      return { actionText: null, followUpText: null };
    }

    case 'rename': {
      await interaction.showModal(
        showTextModal(
          `room_rename_modal_${room.voice_channel_id}_${room.id}`,
          'Имя комнаты',
          'room_new_name',
          'Новое название',
          voiceChannel.name.slice(0, 100),
          voiceChannel.name,
        ),
      );
      return { actionText: null, followUpText: null };
    }

    case 'limit': {
      await interaction.showModal(
        showTextModal(
          `room_limit_modal_${room.voice_channel_id}_${room.id}`,
          'Лимит участников',
          'room_new_limit',
          'Число 0–99 (0 = без лимита)',
          '0',
          String(voiceChannel.userLimit || 0),
        ),
      );
      return { actionText: null, followUpText: null };
    }

    case 'delete': {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`room_confirm_delete_${room.voice_channel_id}_${room.id}`)
          .setLabel('Удалить')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`room_cancel_delete_${room.voice_channel_id}_${room.id}`)
          .setLabel('Отмена')
          .setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: `Удалить **#${voiceChannel.name}**? Это нельзя отменить.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return { actionText: null, followUpText: null };
    }

    // ─── Settings: Открыть модалку для настройки прав ─────────
    case 'settings': {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');

      const modal = new ModalBuilder()
        .setCustomId(`room_settings_modal_${room.voice_channel_id}_${room.id}`)
        .setTitle('📋 Настройки прав участника');

      const userIdInput = new TextInputBuilder()
        .setCustomId('room_perm_target_id')
        .setLabel('ID пользователя')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ID пользователя для изменения прав')
        .setRequired(true);

      const permActionInput = new TextInputBuilder()
        .setCustomId('room_perm_action')
        .setLabel('Действие: allow / deny / remove')
        .setStyle(TextInputStyle.Short)
        .setValue('allow')
        .setPlaceholder('allow — разрешить, deny — запретить, remove — сбросить')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(userIdInput),
        new ActionRowBuilder().addComponents(permActionInput),
      );

      await interaction.showModal(modal);

      return {
        actionText: '📋 Открыто окно настройки прав.',
        followUpText: null,
      };
    }

    default:
      throw new Error(`Неизвестный тип действия: ${actionType}`);
  }
}

async function assertRoomOwner(interaction, room) {
  if (room.owner_id !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'Только владелец комнаты может это сделать.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

async function handleDeleteConfirm(interaction, confirmed) {
  const parsed = interaction.customId.match(/^room_(?:confirm|cancel)_delete_(\d+)_(\d+)$/);
  if (!parsed) return false;
  const voiceChannelId = parsed[1];
  const roomDbId = parseInt(parsed[2], 10);
  const db = getDb();
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);

  if (!room) {
    await interaction.update({ content: 'Комната уже удалена.', components: [] }).catch(() => {});
    return true;
  }
  if (!(await assertRoomOwner(interaction, room))) return true;

  if (!confirmed) {
    await interaction.update({ content: 'Удаление отменено.', components: [] });
    return true;
  }

  const voiceChannel = await fetchVoiceChannelSafe(interaction.guild, voiceChannelId);
  if (voiceChannel?.deletable) {
    await voiceChannel.delete('Комната удалена владельцем');
  }
  db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);
  cleanupSession(interaction.guild.id, voiceChannelId);
  await interaction.update({ content: 'Комната удалена.', components: [] });
  return true;
}

export async function handleRoomUserSelect(interaction) {
  const parsed = interaction.customId.match(/^room_user_(invite|kick|transfer)_(\d+)_(\d+)$/);
  if (!parsed) return false;

  const kind = parsed[1];
  const voiceChannelId = parsed[2];
  const roomDbId = parseInt(parsed[3], 10);
  const targetId = interaction.users.first()?.id;
  if (!targetId) {
    await interaction.reply({ content: 'Участник не выбран.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const { guild, user } = interaction;
  const db = getDb();
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    await interaction.reply({ content: 'Комната не найдена.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (room.owner_id !== user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Только владелец комнаты.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const voiceChannel = await fetchVoiceChannelSafe(guild, voiceChannelId);
  if (!voiceChannel) {
    await interaction.reply({ content: 'Голосовой канал не найден.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const targetMember = await guild.members.fetch(targetId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'Пользователь не на сервере.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (kind === 'invite') {
    await voiceChannel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
    });
    await interaction.update({
      content: `${targetMember} получил доступ в **#${voiceChannel.name}**.`,
      components: [],
    });
    return true;
  }

  if (kind === 'kick') {
    if (targetId === room.owner_id) {
      await interaction.reply({ content: 'Нельзя выгнать владельца.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await voiceChannel.permissionOverwrites.edit(targetId, { Connect: false, Speak: false });
    if (targetMember.voice?.channelId === voiceChannel.id) {
      await targetMember.voice.disconnect('Выгнан из комнаты').catch(() => {});
    }
    await interaction.update({
      content: `${targetMember} выгнан из комнаты.`,
      components: [],
    });
    return true;
  }

  if (kind === 'transfer') {
    if (targetId === room.owner_id) {
      await interaction.reply({ content: 'Это уже владелец.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (targetMember.user.bot) {
      await interaction.reply({ content: 'Нельзя передать комнату боту.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await voiceChannel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      ManageChannels: true,
    });
    await voiceChannel.permissionOverwrites.edit(room.owner_id, {
      ManageChannels: null,
    }).catch(() => {});
    db.prepare('UPDATE user_voice_channels SET owner_id = ? WHERE id = ?').run(targetId, room.id);
    await interaction.update({
      content: `Владелец комнаты: ${targetMember}.`,
      components: [],
    });
    return true;
  }

  return true;
}

export async function handleRoomRenameModal(interaction) {
  const parsed = interaction.customId.match(/^room_rename_modal_(\d+)_(\d+)$/);
  if (!parsed) return false;
  const voiceChannelId = parsed[1];
  const roomDbId = parseInt(parsed[2], 10);
  const name = interaction.fields.getTextInputValue('room_new_name').trim().slice(0, 100);
  if (name.length < 1) {
    await interaction.reply({ content: 'Имя не может быть пустым.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const db = getDb();
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    await interaction.reply({ content: 'Комната не найдена.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!(await assertRoomOwner(interaction, room))) return true;

  const voiceChannel = await fetchVoiceChannelSafe(interaction.guild, voiceChannelId);
  if (!voiceChannel) {
    await interaction.reply({ content: 'Канал не найден.', flags: MessageFlags.Ephemeral });
    return true;
  }
  try {
    await voiceChannel.setName(name, 'Переименовано владельцем комнаты');
  } catch (err) {
    await interaction.reply({
      content: `Не удалось переименовать. Discord ограничивает смену имени (часто 2 раза за 10 минут).\n\`${err.message}\``,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  await interaction.reply({ content: `Комната переименована в **#${name}**.`, flags: MessageFlags.Ephemeral });
  return true;
}

export async function handleRoomLimitModal(interaction) {
  const parsed = interaction.customId.match(/^room_limit_modal_(\d+)_(\d+)$/);
  if (!parsed) return false;
  const voiceChannelId = parsed[1];
  const roomDbId = parseInt(parsed[2], 10);
  const raw = interaction.fields.getTextInputValue('room_new_limit').trim();
  const limit = parseInt(raw, 10);
  if (Number.isNaN(limit) || limit < 0 || limit > 99) {
    await interaction.reply({ content: 'Укажи число от **0** до **99**. 0 — без лимита.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const db = getDb();
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    await interaction.reply({ content: 'Комната не найдена.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!(await assertRoomOwner(interaction, room))) return true;

  const voiceChannel = await fetchVoiceChannelSafe(interaction.guild, voiceChannelId);
  if (!voiceChannel) {
    await interaction.reply({ content: 'Канал не найден.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await voiceChannel.setUserLimit(limit);
  await interaction.reply({
    content: limit === 0 ? 'Лимит снят.' : `Лимит: **${limit}** участников.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

// ══════════════════════════════════════════════════════════════════
// 7. ОБРАБОТЧИКИ МОДАЛЬНЫХ ОКОН
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает модальное окно добавления участника.
 * customId: room_add_member_modal_{voiceChannelId}_{roomDbId}
 */
export async function handleRoomAddMemberModal(interaction) {
  if (!interaction.customId.startsWith('room_add_member_modal_')) return false;

  const parsed = interaction.customId.match(/^room_add_member_modal_(\d+)_(\d+)$/);
  if (!parsed) return false;
  const voiceChannelId = parsed[1];
  const roomDbId = parseInt(parsed[2], 10);
  if (Number.isNaN(roomDbId)) return false;

  const { guild, user } = interaction;
  const db = getDb();

  // Находим комнату
  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    await interaction.reply({
      content: '❌ **Комната не найдена.** Возможно, она была удалена.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Проверка прав
  if (room.owner_id !== user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ **Только владелец** может добавлять участников.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const targetId = interaction.fields.getTextInputValue('room_target_user_id').trim();

  // Валидация ID
  if (!/^\d{17,20}$/.test(targetId)) {
    await interaction.reply({
      content: '❌ **Некорректный ID.** ID должен содержать 17-20 цифр.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Ищем пользователя на сервере
  let targetMember;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    await interaction.reply({
      content: '❌ **Пользователь с таким ID не найден** на этом сервере.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Ищем голосовой канал
  const voiceChannel = await fetchVoiceChannelSafe(guild, voiceChannelId);
  if (!voiceChannel) {
    await interaction.reply({
      content: '❌ **Голосовой канал не найден.** Возможно, он был удалён.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Выдаём доступ
  try {
    await voiceChannel.permissionOverwrites.edit(targetMember.id, {
      Connect: true,
      Speak: true,
      ViewChannel: true,
    });

    await interaction.reply({
      content: `✅ **${targetMember.displayName}** получил(а) доступ к комнате!`,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  } catch (err) {
    console.error(`[ROOM-SETTINGS] Ошибка добавления участника: ${err.message}`);
    await interaction.reply({
      content: '❌ **Ошибка при добавлении участника.** Проверьте права бота.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
}

/**
 * Обрабатывает модальное окно настройки прав.
 * customId: room_settings_modal_{voiceChannelId}_{roomDbId}
 */
export async function handleRoomSettingsModal(interaction) {
  if (!interaction.customId.startsWith('room_settings_modal_')) return false;

  const parsed = interaction.customId.match(/^room_settings_modal_(\d+)_(\d+)$/);
  if (!parsed) return false;
  const voiceChannelId = parsed[1];
  const roomDbId = parseInt(parsed[2], 10);
  if (Number.isNaN(roomDbId)) return false;

  const { guild, user } = interaction;
  const db = getDb();

  const room = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
  if (!room) {
    await interaction.reply({
      content: '❌ **Комната не найдена.**',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (room.owner_id !== user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ **Только владелец** может изменять права.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const targetId = interaction.fields.getTextInputValue('room_perm_target_id').trim();
  const permAction = interaction.fields.getTextInputValue('room_perm_action').trim().toLowerCase();

  if (!/^\d{17,20}$/.test(targetId)) {
    await interaction.reply({
      content: '❌ **Некорректный ID.**',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!['allow', 'deny', 'remove'].includes(permAction)) {
    await interaction.reply({
      content: '❌ **Неверное действие.** Используйте: `allow` (разрешить), `deny` (запретить) или `remove` (сбросить).',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  let targetMember;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    await interaction.reply({
      content: '❌ **Пользователь не найден** на сервере.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const voiceChannel = await fetchVoiceChannelSafe(guild, voiceChannelId);
  if (!voiceChannel) {
    await interaction.reply({
      content: '❌ **Голосовой канал не найден.**',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    if (permAction === 'allow') {
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: true,
        Speak: true,
        ViewChannel: true,
      });
      await interaction.reply({
        content: `✅ **${targetMember.displayName}** — права выданы (разрешён вход).`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (permAction === 'deny') {
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: false,
        Speak: false,
        ViewChannel: true,
      });
      await interaction.reply({
        content: `🔒 **${targetMember.displayName}** — вход запрещён.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (permAction === 'remove') {
      await voiceChannel.permissionOverwrites.delete(targetMember.id).catch(() => {});
      await interaction.reply({
        content: `♻️ **${targetMember.displayName}** — настройки прав сброшены.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Обновляем панель, если есть сессия — используем createMainEmbed и createActionRows
    const session = findSession(guild.id, voiceChannelId);
    if (session) {
      const channel = guild.channels.cache.get(session.channelId);
      if (channel) {
        const msg = await fetchMessageSafe(channel, session.messageId);
        if (msg) {
          const updatedRoom = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(roomDbId);
          const currentVc = await fetchVoiceChannelSafe(guild, voiceChannelId);
          if (currentVc && updatedRoom) {
            const roomData = enrichRoomData(updatedRoom, currentVc);
            const embed = createMainEmbed(
              roomData,
              'Активна',
              `Права <@${targetMember.id}>: **${permAction === 'allow' ? 'разрешены' : permAction === 'deny' ? 'запрещены' : 'сброшены'}**`,
            );
            const components = createActionRows(
              roomData,
              { isLocked: !!updatedRoom.is_locked, isHidden: !!roomData.is_hidden, isProcessing: false },
            );
            await msg.edit({ embeds: [embed], components }).catch(() => {});
          }
        }
      }
    }

    return true;
  } catch (err) {
    console.error(`[ROOM-SETTINGS] Ошибка настройки прав: ${err.message}`);
    await interaction.reply({
      content: '❌ **Ошибка при изменении прав.** Проверьте права бота.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
}

// ══════════════════════════════════════════════════════════════════
// 8. ИСПОЛНЕНИЕ КОМАНДЫ /room-settings
// ══════════════════════════════════════════════════════════════════

export default {
  data: new SlashCommandBuilder()
    .setName('room-settings')
    .setDescription('🎙 Открыть панель управления вашей приватной голосовой комнатой')
    .setDMPermission(false),

  async execute(interaction) {
    // ─── Проверка: команда на сервере ─────────────────────────
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Эта команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { guild, user } = interaction;
    const db = getDb();

    // ─── Поиск комнаты пользователя ───────────────────────────
    const room = db.prepare('SELECT * FROM user_voice_channels WHERE owner_id = ?').get(user.id);

    if (!room) {
      return interaction.reply({
        content: `❌ **У вас нет активной приватной комнаты.**\n\nЗайдите в канал ${triggerChannelMention(guild.id)}, чтобы создать свою комнату.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ─── Проверка голосового канала ───────────────────────────
    const voiceChannel = await fetchVoiceChannelSafe(guild, room.voice_channel_id);
    if (!voiceChannel) {
      // Канал удалён — чистим БД
      db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);
      return interaction.reply({
        content: `❌ **Ваш голосовой канал был удалён.** Создайте новую комнату, зайдя в канал ${triggerChannelMention(guild.id)}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ─── Формируем roomData для функций построения UI ─────────
    // createMainEmbed ожидает: channelName, memberCount, owner_id, is_locked, voice_channel_id
    const panel = buildRoomPanel(room, voiceChannel);

    await interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
    });

    // ─── Получаем ID отправленного сообщения ─────────────────
    const sentMessage = await interaction.fetchReply();

    // ─── Сохраняем сессию ────────────────────────────────────
    createSession(guild.id, room.voice_channel_id, {
      messageId: sentMessage.id,
      channelId: interaction.channel.id,
      ownerId: user.id,
      roomDbId: room.id,
    });

    console.log(
      `[ROOM-SETTINGS] Панель создана для ${user.id} | Комната: ${room.voice_channel_id} | Сообщение: ${sentMessage.id}`,
    );
  },
};

