// ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: Logger — Система логирования сервера с фильтрацией по ролям
// ══════════════════════════════════════════════════════════════════
// • Уровни логирования: all (все), important (важные), moderation (модерация), off (выкл)
// • Создаёт отдельные каналы под каждый уровень:
//     #логи-все, #логи-важные, #логи-модерация
// • Создаёт роли-фильтры:
//     📜 Логи: Все, 📜 Логи: Важные, 📜 Логи: Модерация
// • Права каналов настраиваются так, что роли определяют,
//   какие каналы видит пользователь.
// • Каждое событие отправляется в канал(ы), соответствующие своему уровню.
// ══════════════════════════════════════════════════════════════════

import {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  Colors,
} from 'discord.js';
import { getDb } from '../database.js';

// ══════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ══════════════════════════════════════════════════════════════════

// Уровни логирования (порядок от "меньше" к "больше" по важности)
export const LOG_LEVELS = {
  all: 'all',          // ВСЕ события
  important: 'important', // Важные (модерация + заход/выход)
  moderation: 'moderation', // Только модерация
  off: 'off',          // Выключено
};

// Приоритет уровней (для вычисления, какие каналы получают событие)
const LEVEL_PRIORITY = {
  moderation: 3, // наивысшая важность
  important: 2,
  all: 1,
  off: 0,
};

// Имена ролей-фильтров
export const LOG_ROLE_NAMES = {
  all: '📜 Логи: Все',
  important: '📜 Логи: Важные',
  moderation: '📜 Логи: Модерация',
};

// Имена ролей для пинга (уведомления)
export const LOG_PING_ROLE_NAMES = {
  all: '🔔 Пинг: Все',
  important: '🔔 Пинг: Важные',
  moderation: '🔔 Пинг: Модерация',
};

// Цвета для ролей пинга
const PING_ROLE_COLORS = {
  all: '#2ECC71',        // зелёный
  important: '#F39C12',  // жёлто-оранжевый
  moderation: '#E74C3C', // красный
};

// Имена каналов под каждый уровень
export const LOG_CHANNEL_NAMES = {
  all: 'логи-все',
  important: 'логи-важные',
  moderation: 'логи-модерация',
};

// Цвета для каналов/ролей
const LEVEL_COLORS = {
  all: '#5865F2',        // синий
  important: '#E67E22',  // оранжевый
  moderation: '#E74C3C', // красный
};

// Кэш конфигов (guildId -> config), чтобы не читать БД при каждом событии
const configCache = new Map();

// ══════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function log(level, module, message, ...args) {
  console.log(`[${now()}] [${level}] [LOGGER] [${module}] ${message}`, ...args);
}

/**
 * Берёт значение из camelCase или snake_case ключа.
 * Нужно, потому что SELECT * отдаёт snake_case, а saveLogConfig ждёт camelCase.
 */
function pick(data, camel, snake, fallback = null) {
  if (!data || typeof data !== 'object') return fallback;
  if (data[camel] !== undefined && data[camel] !== null) return data[camel];
  if (data[snake] !== undefined && data[snake] !== null) return data[snake];
  if (data[camel] === null || data[snake] === null) {
    if (fallback === undefined) return null;
  }
  if (Object.prototype.hasOwnProperty.call(data, camel)) return data[camel];
  if (Object.prototype.hasOwnProperty.call(data, snake)) return data[snake];
  return fallback;
}

/**
 * Получает конфиг логирования для сервера из БД.
 * @param {string} guildId
 * @returns {Object|null}
 */
export function getLogConfig(guildId) {
  if (configCache.has(guildId)) return configCache.get(guildId);
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM guild_log_config WHERE guild_id = ?').get(guildId);
    configCache.set(guildId, row || null);
    return row || null;
  } catch (err) {
    log('ERROR', 'GET_CONFIG', `Ошибка: ${err.message}`);
    return null;
  }
}

/**
 * Очищает кэш конфига для сервера.
 * @param {string} guildId
 */
export function clearLogConfigCache(guildId) {
  configCache.delete(guildId);
}

/**
 * Сохраняет конфиг логирования в БД (UPSERT).
 * @param {string} guildId
 * @param {Object} data
 */
export function saveLogConfig(guildId, data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO guild_log_config
      (guild_id, channel_id, level, role_view_all, role_view_important,
       role_view_moderation, channel_all, channel_important, channel_moderation,
       ping_role_all, ping_role_important, ping_role_moderation,
       ping_target, ping_actor, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      level = excluded.level,
      role_view_all = excluded.role_view_all,
      role_view_important = excluded.role_view_important,
      role_view_moderation = excluded.role_view_moderation,
      channel_all = excluded.channel_all,
      channel_important = excluded.channel_important,
      channel_moderation = excluded.channel_moderation,
      ping_role_all = excluded.ping_role_all,
      ping_role_important = excluded.ping_role_important,
      ping_role_moderation = excluded.ping_role_moderation,
      ping_target = excluded.ping_target,
      ping_actor = excluded.ping_actor,
      updated_at = datetime('now')
  `).run(
    guildId,
    pick(data, 'channelId', 'channel_id', null),
    pick(data, 'level', 'level', LOG_LEVELS.all),
    pick(data, 'roleViewAll', 'role_view_all', null),
    pick(data, 'roleViewImportant', 'role_view_important', null),
    pick(data, 'roleViewModeration', 'role_view_moderation', null),
    pick(data, 'channelAll', 'channel_all', null),
    pick(data, 'channelImportant', 'channel_important', null),
    pick(data, 'channelModeration', 'channel_moderation', null),
    pick(data, 'pingRoleAll', 'ping_role_all', null),
    pick(data, 'pingRoleImportant', 'ping_role_important', null),
    pick(data, 'pingRoleModeration', 'ping_role_moderation', null),
    pick(data, 'pingTarget', 'ping_target', 1),
    pick(data, 'pingActor', 'ping_actor', 1),
  );
  clearLogConfigCache(guildId);
}

/**
 * Записывает событие в историю log_events.
 * @param {string} guildId
 * @param {string} eventType
 * @param {string} level
 * @param {Object} opts
 */
function recordEvent(guildId, eventType, level, opts = {}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO log_events (guild_id, event_type, level, target_id, target_name, actor_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      guildId,
      eventType,
      level,
      opts.targetId ?? null,
      opts.targetName ?? null,
      opts.actorId ?? null,
      JSON.stringify(opts.details ?? {}),
    );
  } catch (err) {
    log('ERROR', 'RECORD_EVENT', `Ошибка записи события: ${err.message}`);
  }
}

/**
 * Проверяет, включено ли логирование для данного уровня.
 * @param {Object} config — конфиг сервера
 * @param {string} eventLevel — уровень события (all|important|moderation)
 * @returns {boolean}
 */
function shouldLog(config, eventLevel) {
  if (!config) return false;
  const hasChannel = config.channel_id || config.channel_all
    || config.channel_important || config.channel_moderation;
  if (!hasChannel) return false;
  const cfgLevel = config.level || LOG_LEVELS.all;
  if (cfgLevel === LOG_LEVELS.off) return false;
  // Событие попадает в лог, если его уровень "важнее или равен" настроенному
  return LEVEL_PRIORITY[eventLevel] >= LEVEL_PRIORITY[cfgLevel];
}

/**
 * Определяет, в какие каналы отправить событие в зависимости от его уровня.
 * Если у сервера настроен общий канал (channel_id) — используем его.
 * Если настроены отдельные каналы — маршрутизируем по уровню.
 * @param {Object} config
 * @param {string} eventLevel
 * @returns {string[]} — массив ID каналов
 */
function channelsForEvent(config, eventLevel) {
  if (!config) return [];

  // Если есть отдельные каналы — маршрутизируем
  const channels = [];
  if (config.channel_all && eventLevel === 'all') channels.push(config.channel_all);
  if (config.channel_important && (eventLevel === 'important' || eventLevel === 'all')) channels.push(config.channel_important);
  if (config.channel_moderation && (eventLevel === 'moderation' || eventLevel === 'important' || eventLevel === 'all')) channels.push(config.channel_moderation);

  // Если отдельных каналов нет, но есть общий канал — используем его
  if (channels.length === 0 && config.channel_id) {
    channels.push(config.channel_id);
  }

  // Дедупликация
  return [...new Set(channels)];
}

/**
 * Отправляет лог-событие.
 * @param {import('discord.js').Guild} guild
 * @param {string} eventLevel — all | important | moderation
 * @param {Object} options — { title, description, color, fields, targetId, targetName, actorId, eventType, details, mentions }
 */
export async function logEvent(guild, eventLevel, options = {}) {
  if (!guild) return;
  const config = getLogConfig(guild.id);
  if (!shouldLog(config, eventLevel)) return;

  const level = options.level || eventLevel;
  const channelIds = channelsForEvent(config, level);

  // Записываем в БД
  recordEvent(guild.id, options.eventType || 'generic', level, {
    targetId: options.targetId,
    targetName: options.targetName,
    actorId: options.actorId,
    details: options.details,
  });

  // Упоминания в content — Discord не пингует из тела embed.
  const pingString = config ? buildPingString(config, guild, options) : '';

  const embed = new EmbedBuilder()
    .setColor(options.color || Colors.Blurple)
    .setTitle(options.title || 'Событие')
    .setDescription(options.description || '')
    .setTimestamp()
    .setFooter({ text: `Логирование: ${levelLabel(level)}` });

  if (options.fields && Array.isArray(options.fields)) {
    embed.addFields(options.fields);
  }

  for (const channelId of channelIds) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      await channel.send({
        content: pingString || undefined,
        embeds: [embed],
        allowedMentions: { parse: ['users', 'roles'] },
      }).catch(() => {});
    } catch (err) {
      log('WARN', 'SEND', `Не удалось отправить в канал ${channelId}: ${err.message}`);
    }
  }
}

/**
 * Строит ping-строку с упоминаниями для вставки в embed description.
 * @param {Object} config — конфиг сервера
 * @param {import('discord.js').Guild} guild
 * @param {Object} options — параметры события
 * @returns {string} — строка с упоминаниями или пустая
 */
function buildPingString(config, guild, options) {
  const mentions = [];

  // 1. Пинг роли уровня (если настроена)
  const pingRoleKey = getPingRoleKey(options.eventType, options.level);
  const pingRoleId = config[`ping_role_${pingRoleKey}`];
  if (pingRoleId) {
    mentions.push(`<@&${pingRoleId}>`);
  }

  // 2. Пинг целевого пользователя (target)
  if (config.ping_target && options.targetId) {
    mentions.push(`<@${options.targetId}>`);
  }

  // 3. Пинг модератора/актора
  if (config.ping_actor && options.actorId) {
    mentions.push(`<@${options.actorId}>`);
  }

  // 4. Дополнительные упоминания из options
  if (options.mentions && Array.isArray(options.mentions)) {
    for (const mentionId of options.mentions) {
      if (mentionId && typeof mentionId === 'string') {
        mentions.push(`<@${mentionId}>`);
      }
    }
  }

  return mentions.length > 0 ? mentions.join(' ') : '';
}

/**
 * Определяет ключ роли пинга для события.
 * @param {string} eventType
 * @param {string} level
 * @returns {string}
 */
function getPingRoleKey(eventType, level) {
  // Модерационные события — пинг роли модерации
  const moderationEvents = [
    'moderation', 'member_ban', 'member_kick', 'member_mute',
    'member_warn', 'member_timeout',
  ];
  if (moderationEvents.includes(eventType)) {
    return 'moderation';
  }

  // Важные события — пинг роли важных
  const importantEvents = [
    'member_join', 'member_leave', 'member_ban', 'member_kick',
  ];
  if (importantEvents.includes(eventType)) {
    return 'important';
  }

  // По умолчанию — уровень события
  return level || 'all';
}

/**
 * Возвращает русскую подпись уровня.
 * @param {string} level
 * @returns {string}
 */
export function levelLabel(level) {
  switch (level) {
    case 'all': return 'Все события';
    case 'important': return 'Важные';
    case 'moderation': return 'Модерация';
    case 'off': return 'Выключено';
    default: return level;
  }
}

// ══════════════════════════════════════════════════════════════════
// СОЗДАНИЕ КАНАЛОВ И РОЛЕЙ ЛОГИРОВАНИЯ
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт (или находит существующие) роли-фильтры, роли пинга и каналы логов.
 * Настраивает права каналов так, чтобы видимость определялась ролями.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<Object>} — { roles: {...}, pingRoles: {...}, channels: {...} }
 */
export async function setupLogChannels(guild) {
  if (!guild) throw new Error('Guild не передан');

  // ─── 1. Создаём роли-фильтры ───────────────────────────────
  const roles = {};

  for (const [level, roleName] of Object.entries(LOG_ROLE_NAMES)) {
    let role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      try {
        role = await guild.roles.create({
          name: roleName,
          color: LEVEL_COLORS[level],
          reason: 'Создана системой логирования (роль-фильтр)',
        });
      } catch (err) {
        log('ERROR', 'CREATE_ROLE', `Не удалось создать роль ${roleName}: ${err.message}`);
        continue;
      }
    }
    roles[level] = role;
  }

  // ─── 1.1 Создаём роли для пинга ───────────────────────────
  const pingRoles = {};

  for (const [level, roleName] of Object.entries(LOG_PING_ROLE_NAMES)) {
    let role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      try {
        role = await guild.roles.create({
          name: roleName,
          color: PING_ROLE_COLORS[level],
          reason: 'Создана системой логирования (роль-пинг)',
        });
      } catch (err) {
        log('ERROR', 'CREATE_PING_ROLE', `Не удалось создать роль пинга ${roleName}: ${err.message}`);
        continue;
      }
    }
    pingRoles[level] = role;
  }

  // ─── 2. Создаём каналы под каждый уровень ──────────────────
  const channels = {};

  for (const [level, channelName] of Object.entries(LOG_CHANNEL_NAMES)) {
    let channel = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && ch.name === channelName
    );
    if (!channel) {
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          reason: 'Создан системой логирования',
          topic: `Логирование уровня: ${levelLabel(level)}`,
        });
      } catch (err) {
        log('ERROR', 'CREATE_CHANNEL', `Не удалось создать канал ${channelName}: ${err.message}`);
        continue;
      }
    }
    channels[level] = channel;
  }

  // ─── 3. Настраиваем права каналов ──────────────────────────
  await configureChannelPermissions(guild, roles, channels);

  // ─── 4. Сохраняем конфиг ───────────────────────────────────
  const config = {
    channelId: channels.all?.id || channels.important?.id || channels.moderation?.id || null,
    level: LOG_LEVELS.all,
    roleViewAll: roles.all?.id || null,
    roleViewImportant: roles.important?.id || null,
    roleViewModeration: roles.moderation?.id || null,
    channelAll: channels.all?.id || null,
    channelImportant: channels.important?.id || null,
    channelModeration: channels.moderation?.id || null,
    pingRoleAll: pingRoles.all?.id || null,
    pingRoleImportant: pingRoles.important?.id || null,
    pingRoleModeration: pingRoles.moderation?.id || null,
    pingTarget: 1,
    pingActor: 1,
  };
  saveLogConfig(guild.id, config);

  return { roles, pingRoles, channels };
}

/**
 * Настраивает права каналов логов:
 * - #логи-модерация: только роль "Логи: Модерация" (+ админы)
 * - #логи-важные: роли "Логи: Важные" и "Логи: Модерация"
 * - #логи-все: все роли логирования
 * Каналы скрыты от @everyone по умолчанию.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Object} roles
 * @param {Object} channels
 */
async function configureChannelPermissions(guild, roles, channels) {
  const everyone = guild.roles.everyone;

  const apply = (channel, visibleRoles) => {
    if (!channel) return;
    const perms = [
      // @everyone: скрыть канал
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      // Администраторам бота/сервера оставить доступ
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];
    // Добавляем видимые роли
    for (const role of visibleRoles) {
      if (role) {
        perms.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
      }
    }
    return channel.permissionOverwrites.set(perms).catch(err => {
      log('WARN', 'PERMS', `Не удалось настроить права для ${channel.name}: ${err.message}`);
    });
  };

  // #логи-модерация — только роль модерации
  await apply(channels.moderation, [roles.moderation]);

  // #логи-важные — роль важных и модерации
  await apply(channels.important, [roles.important, roles.moderation]);

  // #логи-все — все роли логирования
  await apply(channels.all, [roles.all, roles.important, roles.moderation]);
}

// ══════════════════════════════════════════════════════════════════
// УПРАВЛЕНИЕ УРОВНЕМ ЛОГИРОВАНИЯ
// ══════════════════════════════════════════════════════════════════

/**
 * Устанавливает уровень логирования для сервера.
 * @param {string} guildId
 * @param {string} level
 */
export function setLogLevel(guildId, level) {
  if (!LOG_LEVELS[level]) throw new Error(`Некорректный уровень: ${level}`);
  const existing = getLogConfig(guildId) || {};
  saveLogConfig(guildId, { ...existing, level });
}

/**
 * Устанавливает общий канал (channel_id) для логов.
 * @param {string} guildId
 * @param {string} channelId
 */
export function setLogChannel(guildId, channelId) {
  const existing = getLogConfig(guildId) || {};
  saveLogConfig(guildId, { ...existing, channelId, level: existing.level || LOG_LEVELS.all });
}

/**
 * Полностью отключает логирование на сервере.
 * @param {string} guildId
 */
export function disableLogging(guildId) {
  setLogLevel(guildId, LOG_LEVELS.off);
}

// ══════════════════════════════════════════════════════════════════
// ДЕФОЛТНЫЙ ЭКСПОРТ
// ══════════════════════════════════════════════════════════════════

export default {
  LOG_LEVELS,
  LOG_ROLE_NAMES,
  LOG_PING_ROLE_NAMES,
  LOG_CHANNEL_NAMES,
  getLogConfig,
  clearLogConfigCache,
  saveLogConfig,
  logEvent,
  logChannelSetup: setupLogChannels,
  setLogLevel,
  setLogChannel,
  disableLogging,
  levelLabel,
};
