import { getDb } from '../database.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const DEFAULT_FEATURES = Object.freeze({
  economy: true,
  leveling: true,
  moderation: true,
  voiceFarming: true,
  marriages: true,
  activityRoles: true,
  welcomeNPC: true,
  clans: true,
  reputation: true,
  dailyQuests: true,
  tickets: true,
  giveaways: true,
});

const DEFAULT_LEVEL_ROLES = {};

const FALLBACK_EXTRA_VERIFY_ROLES = [];

export const FALLBACK_OWNER_ID = process.env.OWNER_ID || '';
export const FALLBACK_TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID || '';
export const FALLBACK_VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID || '';
export const FALLBACK_VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '';

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function envList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readLegacyFeatures(guildId) {
  try {
    const row = getDb().prepare('SELECT features, admin_roles, log_channel_id, prefix FROM server_configs WHERE guild_id = ?').get(guildId);
    if (!row) return null;
    return {
      features: parseJson(row.features, {}),
      adminRoles: parseJson(row.admin_roles, []),
      logChannelId: row.log_channel_id || '',
      prefix: row.prefix || '/',
    };
  } catch {
    return null;
  }
}

export function clearGuildConfigCache(guildId) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

/**
 * Создаёт пустую запись server_config, если её ещё нет (новый сервер).
 */
export function initGuildConfig(guildId) {
  if (!guildId) return getGuildConfig(guildId);
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO server_config (guild_id, owner_id, admin_roles, channels, features, note, status)
      VALUES (?, ?, '[]', '{}', '{}', '', 'active')
    `).run(guildId, FALLBACK_OWNER_ID);
  } catch (err) {
    console.error('[CONFIG] initGuildConfig:', err.message);
  }
  clearGuildConfigCache(guildId);
  return getGuildConfig(guildId);
}

/**
 * Только предупреждает в лог. Фичи сами не выключает.
 */
export function suggestScaleOptimizations(guildId, memberCount) {
  const count = Number(memberCount) || 0;
  if (count > 20000) {
    console.warn(
      `[CONFIG] Сервер ${guildId}: ${count} участников. Рекомендуется вручную отключить welcomeNPC, activityRoles и voiceFarming в features.`,
    );
  } else if (count > 5000) {
    console.warn(
      `[CONFIG] Сервер ${guildId}: ${count} участников. Рекомендуется вручную отключить welcomeNPC и activityRoles.`,
    );
  }
}

export function isFeatureEnabled(guildId, feature) {
  const features = getGuildConfig(guildId).features || {};
  return features[feature] !== false;
}

export function commandFeatureKey(commandName) {
  const critical = new Set(['setup', 'панель', 'verify', 'help', 'помощь', 'settings', 'логи', 'фичи', 'welcome-preview', 'self-roles']);
  if (critical.has(commandName)) return null;

  const map = {
    economy: ['баланс', 'shop', 'топ', 'rank', 'casino', 'role', 'pay', 'work', 'cosmetics', 'косметика'],
    leveling: ['profile', 'rank'],
    moderation: ['mod', 'history'],
    marriages: ['marry'],
    clans: ['clan'],
    reputation: ['реп', 'rep'],
    voiceFarming: ['room-settings'],
    dailyQuests: ['квесты', 'сезон'],
    tickets: ['ticket'],
    giveaways: ['giveaway'],
  };

  for (const [feature, names] of Object.entries(map)) {
    if (names.includes(commandName)) return feature;
  }
  return null;
}

/**
 * Единый конфиг сервера: /setup (server_config) + фичи + запасные ID.
 */
export function getGuildConfig(guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  let row = null;
  try {
    if (guildId) {
      row = getDb().prepare('SELECT * FROM server_config WHERE guild_id = ?').get(guildId);
    }
  } catch {
    row = null;
  }

  const legacy = guildId ? readLegacyFeatures(guildId) : null;
  const channels = parseJson(row?.channels, {});
  const adminRoles = parseJson(row?.admin_roles, legacy?.adminRoles || []);
  const storedFeatures = parseJson(row?.features, {});
  const extraFromChannels = Array.isArray(channels.extra_verify_roles)
    ? channels.extra_verify_roles
    : null;
  const extraFromEnv = envList('EXTRA_VERIFY_ROLES');

  const data = {
    guildId: guildId || '',
    prefix: row?.prefix || legacy?.prefix || '/',
    ownerId: row?.owner_id || FALLBACK_OWNER_ID,
    adminRoles: Array.isArray(adminRoles) ? adminRoles : [],
    triggerChannelId: (channels.trigger || '').trim() || (FALLBACK_TRIGGER_CHANNEL_ID || '').trim(),
    voiceCategoryId: (channels.voice_category || '').trim() || (FALLBACK_VOICE_CATEGORY_ID || '').trim(),
    statsMembersVoiceChannelId: channels.stats_members_voice || '',
    statsBotsVoiceChannelId: channels.stats_bots_voice || '',
    voicePanelChannelId: channels.voice_panel || '',
    welcomeChannelId: channels.welcome || channels.cmd || '',
    cmdChannelId: channels.cmd || '',
    mainChannelId: channels.cmd || '',
    logChannelId: channels.log || legacy?.logChannelId || '',
    modChannelId: channels.mod || '',
    ticketCategoryId: channels.ticket_category || '',
    seasonRoleId: channels.season_role || '',
    verifiedRoleId: channels.verified_role || FALLBACK_VERIFIED_ROLE_ID,
    extraVerifyRoles: extraFromChannels?.length
      ? extraFromChannels
      : extraFromEnv.length
        ? extraFromEnv
        : FALLBACK_EXTRA_VERIFY_ROLES,
    levelRoles: channels.level_roles && typeof channels.level_roles === 'object'
      ? channels.level_roles
      : DEFAULT_LEVEL_ROLES,
    features: { ...DEFAULT_FEATURES, ...(legacy?.features || {}), ...storedFeatures },
  };

  if (guildId) {
    cache.set(guildId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return data;
}

export function getTriggerChannelId(guildId) {
  return getGuildConfig(guildId).triggerChannelId;
}

export function getVerifiedRoleId(guildId) {
  return getGuildConfig(guildId).verifiedRoleId;
}

export function getExtraVerifyRoles(guildId) {
  return getGuildConfig(guildId).extraVerifyRoles;
}

export function setGuildFeature(guildId, feature, enabled) {
  if (!guildId || !Object.prototype.hasOwnProperty.call(DEFAULT_FEATURES, feature)) {
    return false;
  }
  initGuildConfig(guildId);
  const current = getGuildConfig(guildId).features || {};
  const features = { ...current, [feature]: Boolean(enabled) };
  getDb().prepare('UPDATE server_config SET features = ? WHERE guild_id = ?')
    .run(JSON.stringify(features), guildId);
  clearGuildConfigCache(guildId);
  return true;
}

/** Сырой объект channels из server_config. */
export function getGuildChannelsRaw(guildId) {
  if (!guildId) return {};
  try {
    const row = getDb().prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(guildId);
    return parseJson(row?.channels, {});
  } catch {
    return {};
  }
}

/** Частичное обновление channels (merge). */
export function patchGuildChannels(guildId, patch = {}) {
  if (!guildId || !patch || typeof patch !== 'object') return false;
  initGuildConfig(guildId);
  const current = getGuildChannelsRaw(guildId);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  getDb().prepare('UPDATE server_config SET channels = ?, setup_date = datetime(\'now\'), status = \'active\' WHERE guild_id = ?')
    .run(JSON.stringify(next), guildId);
  clearGuildConfigCache(guildId);

  if (patch.log) {
    queueMicrotask(() => {
      import('../modules/logger.js').then(async ({ getLogConfig, setLogChannel }) => {
        try {
          const { getDb } = await import('../database.js');
          getDb(); // throws if closed
          const lg = getLogConfig(guildId);
          if (!lg?.channel_id && !lg?.channel_all) {
            setLogChannel(guildId, patch.log);
          }
        } catch {
          /* db may be closed in tests */
        }
      }).catch(() => {});
    });
  }

  return true;
}

/** Владелец, админ-роли, примечание. */
export function setGuildMeta(guildId, { ownerId, adminRoles, note } = {}) {
  if (!guildId) return false;
  initGuildConfig(guildId);
  const row = getDb().prepare('SELECT owner_id, admin_roles, note FROM server_config WHERE guild_id = ?').get(guildId);
  const nextOwner = ownerId != null ? String(ownerId) : (row?.owner_id || FALLBACK_OWNER_ID);
  const nextRoles = adminRoles != null
    ? JSON.stringify(Array.isArray(adminRoles) ? adminRoles : [])
    : (row?.admin_roles || '[]');
  const nextNote = note != null ? String(note) : (row?.note || '');
  getDb().prepare(`
    UPDATE server_config
    SET owner_id = ?, admin_roles = ?, note = ?, setup_date = datetime('now'), status = 'active'
    WHERE guild_id = ?
  `).run(nextOwner, nextRoles, nextNote, guildId);
  clearGuildConfigCache(guildId);
  return true;
}

/** Чеклист готовности конфига для UI. */
export function getSetupChecklist(guildId) {
  const cfg = getGuildConfig(guildId);
  const items = [
    { key: 'owner', label: 'Владелец', ok: Boolean(cfg.ownerId), value: cfg.ownerId ? `<@${cfg.ownerId}>` : '—' },
    { key: 'admins', label: 'Админ-роли', ok: (cfg.adminRoles || []).length > 0, value: (cfg.adminRoles || []).length ? `${cfg.adminRoles.length} рол.` : '—' },
    { key: 'log', label: 'Канал логов', ok: Boolean(cfg.logChannelId), value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '—' },
    { key: 'cmd', label: 'Канал команд', ok: Boolean(cfg.cmdChannelId), value: cfg.cmdChannelId ? `<#${cfg.cmdChannelId}>` : '—' },
    { key: 'mod', label: 'Канал модерации', ok: Boolean(cfg.modChannelId), value: cfg.modChannelId ? `<#${cfg.modChannelId}>` : '—' },
    { key: 'welcome', label: 'Приветствия', ok: Boolean(cfg.welcomeChannelId), value: cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : '—' },
    { key: 'voice_panel', label: 'Голосовая панель', ok: Boolean(cfg.voicePanelChannelId), value: cfg.voicePanelChannelId ? `<#${cfg.voicePanelChannelId}>` : '—' },
    { key: 'trigger', label: 'Триггер комнат', ok: Boolean(cfg.triggerChannelId), value: cfg.triggerChannelId ? `<#${cfg.triggerChannelId}>` : '—' },
    { key: 'voice_category', label: 'Категория комнат', ok: Boolean(cfg.voiceCategoryId), value: cfg.voiceCategoryId ? `<#${cfg.voiceCategoryId}>` : '—' },
    { key: 'ticket_category', label: 'Категория тикетов', ok: Boolean(cfg.ticketCategoryId), value: cfg.ticketCategoryId ? `<#${cfg.ticketCategoryId}>` : '—' },
    { key: 'verified_role', label: 'Роль верификации', ok: Boolean(cfg.verifiedRoleId), value: cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : '—' },
    { key: 'season_role', label: 'Роль сезона', ok: Boolean(cfg.seasonRoleId), value: cfg.seasonRoleId ? `<@&${cfg.seasonRoleId}>` : '—' },
  ];
  const required = items.filter((i) => ['owner', 'admins', 'log', 'cmd', 'mod'].includes(i.key));
  const ready = required.every((i) => i.ok);
  return { items, ready, requiredOk: required.filter((i) => i.ok).length, requiredTotal: required.length };
}

/** Описание полей каналов для UI setup. */
export const SETUP_CHANNEL_FIELDS = Object.freeze([
  { key: 'log', label: 'Логи', emoji: '📋', types: 'text', required: true },
  { key: 'cmd', label: 'Команды', emoji: '💬', types: 'text', required: true },
  { key: 'mod', label: 'Модерация', emoji: '🛡', types: 'text', required: true },
  { key: 'welcome', label: 'Приветствия', emoji: '👋', types: 'text', required: false },
  { key: 'voice_panel', label: 'Голосовая панель', emoji: '🎙', types: 'text', required: false },
  { key: 'trigger', label: 'Триггер комнат', emoji: '➕', types: 'voice', required: false },
  { key: 'voice_category', label: 'Категория комнат', emoji: '📁', types: 'category', required: false },
  { key: 'ticket_category', label: 'Категория тикетов', emoji: '🎫', types: 'category', required: false },
]);

export function triggerChannelMention(guildId) {
  const id = getTriggerChannelId(guildId);
  return id ? `<#${id}>` : 'канал создания комнаты';
}

export { DEFAULT_LEVEL_ROLES, DEFAULT_FEATURES };
