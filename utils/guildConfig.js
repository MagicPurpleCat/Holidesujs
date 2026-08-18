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
});

const DEFAULT_LEVEL_ROLES = {
  1: '1528817262189084733',
  5: '1528817857385992393',
  10: '1528817949299966012',
  15: '1528817970044731562',
  20: '1528817991498596565',
  25: '1528818952921415861',
  30: '1528818708452085781',
  35: '1528818735006220379',
  40: '1528818758485803308',
  45: '1528818770439573706',
  50: '1528818785018974378',
  60: '1528818799820673034',
  70: '1528818815084007607',
  80: '1528818827616325803',
  90: '1528818842544115832',
  100: '1528818859824644290',
};

const FALLBACK_EXTRA_VERIFY_ROLES = [
  '1528870376250277990',
  '1528870899342774343',
  '1528873884042920099',
];

export const FALLBACK_OWNER_ID = process.env.OWNER_ID || '852817382342656053';
export const FALLBACK_TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID || '1518101144818290824';
export const FALLBACK_VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID || '1518101144818290823';
export const FALLBACK_VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1528219597923291208';

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
  const critical = new Set(['setup', 'панель', 'verify', 'help', 'помощь', 'settings', 'логи']);
  if (critical.has(commandName)) return null;

  const map = {
    economy: ['баланс', 'shop', 'топ', 'rank', 'casino', 'role'],
    leveling: ['profile', 'rank'],
    moderation: ['mod', 'history'],
    marriages: ['marry', 'divorce'],
    clans: ['clan'],
    reputation: ['реп', 'rep'],
    voiceFarming: ['room-settings'],
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
    triggerChannelId: channels.trigger || FALLBACK_TRIGGER_CHANNEL_ID,
    voiceCategoryId: channels.voice_category || FALLBACK_VOICE_CATEGORY_ID,
    voicePanelChannelId: channels.voice_panel || '',
    welcomeChannelId: channels.welcome || channels.cmd || '',
    cmdChannelId: channels.cmd || '',
    mainChannelId: channels.cmd || '',
    logChannelId: channels.log || legacy?.logChannelId || '',
    modChannelId: channels.mod || '',
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

export function triggerChannelMention(guildId) {
  const id = getTriggerChannelId(guildId);
  return id ? `<#${id}>` : 'канал создания комнаты';
}

export { DEFAULT_LEVEL_ROLES, DEFAULT_FEATURES };
