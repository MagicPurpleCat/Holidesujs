/**
 * Holidesu — односерверный режим.
 * Бот обслуживает только GUILD_ID из .env (или единственный сервер в кэше).
 */

import { logInfo, logErr, logFatal } from './botLog.js';

export function getPrimaryGuildId() {
  return String(process.env.GUILD_ID || '').trim();
}

export function isPrimaryGuild(guildId) {
  const primary = getPrimaryGuildId();
  if (!primary) return true; // пока не задан — не режем события (fallback ниже при ready)
  return String(guildId) === primary;
}

/**
 * Резолвит основной сервер без падения процесса.
 * @param {import('discord.js').Client} [client]
 * @returns {string} guild id или ''
 */
export function resolvePrimaryGuildId(client = null) {
  const fromEnv = getPrimaryGuildId();
  if (fromEnv) return fromEnv;

  const guilds = client?.guilds?.cache ? [...client.guilds.cache.values()] : [];
  if (guilds.length === 1) {
    return guilds[0].id;
  }
  return '';
}

/**
 * Уходит со всех серверов, кроме основного.
 * Не делает process.exit — иначе контейнер уходит в restart loop.
 * @param {import('discord.js').Client} client
 * @param {string|number|null} shardId
 */
export async function enforceSingleGuild(client, shardId = null) {
  let primary = getPrimaryGuildId();

  if (!primary) {
    const guilds = [...client.guilds.cache.values()];
    if (guilds.length === 1) {
      primary = guilds[0].id;
      process.env.GUILD_ID = primary;
      logErr(
        shardId,
        'GUILD',
        `GUILD_ID не задан в env — использую единственный сервер ${guilds[0].name} (${primary}). `
          + 'Задай GUILD_ID в переменных окружения хостинга.',
      );
    } else if (guilds.length === 0) {
      logFatal(
        'GUILD',
        'GUILD_ID не задан и бот не на одном сервере. Добавь GUILD_ID в env и пригласи бота.',
      );
      return;
    } else {
      // Несколько серверов без GUILD_ID — оставляем самый «старый» по наличию в кэше (первый) и выходим с остальных
      primary = guilds[0].id;
      process.env.GUILD_ID = primary;
      logFatal(
        'GUILD',
        `GUILD_ID не задан, серверов ${guilds.length}. Временно основной: ${primary}. `
          + 'Укажи GUILD_ID явно, иначе после рестарта выбор может смениться.',
      );
    }
  }

  if (!client.guilds.cache.has(primary)) {
    logErr(
      shardId,
      'GUILD',
      `Бот не на сервере GUILD_ID=${primary}. Добавь бота на этот сервер.`,
    );
  } else {
    logInfo(shardId, 'GUILD', `Односерверный режим: ${primary}`);
  }

  const foreign = [...client.guilds.cache.values()].filter((g) => g.id !== primary);
  for (const guild of foreign) {
    logErr(
      shardId,
      'GUILD',
      `Покидаю лишний сервер ${guild.name} (${guild.id}) — разрешён только ${primary}`,
    );
    await guild.leave().catch((err) => {
      logErr(shardId, 'GUILD', `Не удалось выйти с ${guild.id}: ${err.message}`);
    });
  }
}
