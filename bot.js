import 'dotenv/config';
import {
  Collection,
  ActivityType,
} from 'discord.js';
import { initDatabase, closeDatabase } from './database.js';
import { initializeOwnerRights } from './modules/ownerInit.js';
import { UniversalShardManager } from './src/core/shard-manager.js';
import { FALLBACK_OWNER_ID, getGuildConfig, getTriggerChannelId } from './utils/guildConfig.js';
import { logInfo, logErr, logFatal } from './utils/botLog.js';
import { enforceSingleGuild, isPrimaryGuild } from './utils/singleGuild.js';
import { registerInteractionHandler } from './handlers/interactions.js';
import { registerGuildEvents, startVoiceFarmLoop, restoreVoiceFarmSessions } from './handlers/guildEvents.js';
import { startDbBackupLoop } from './modules/dbBackup.js';
import { initVoicePanel, startPanelAutoUpdate } from './modules/voicePanel.js';
import { startGiveawayLoop } from './commands/giveaway.js';
import { startBlackjackSweepLoop } from './commands/casino.js';
import { startSeasonLoop } from './modules/seasons.js';
import { startServerStatsDailyLoop } from './modules/serverStatsDaily.js';
import { initServerVoiceStats } from './modules/serverVoiceStats.js';
import { initSelfRolesForGuild } from './modules/selfRolesPanel.js';
import { allCommands } from './commands/index.js';
import { setAchievementNotifyClient } from './modules/progress.js';

initDatabase();

async function setupShard(shardId, client) {
  logInfo(shardId, 'SETUP', 'Настройка шарда...');

  if (!client) {
    logErr(shardId, 'SETUP', 'client is null/undefined');
    return;
  }

  client.commands = new Collection();
  for (const cmd of allCommands) {
    if (cmd && cmd.data && cmd.data.name) {
      client.commands.set(cmd.data.name, cmd);
    } else {
      logErr(shardId, 'SETUP', 'Команда без data.name, пропускаем.');
    }
  }

  registerInteractionHandler(client, shardId);
  registerGuildEvents(client, shardId);

  logInfo(shardId, 'SETUP', `Настройка завершена. Команд: ${client.commands.size}.`);
}

const token = process.env.DISCORD_TOKEN;
if (!token || token.length < 10) {
  logFatal('MAIN', 'DISCORD_TOKEN не указан или некорректен в .env файле.');
  process.exit(1);
}

const shardManager = new UniversalShardManager(token);

shardManager.start(
  async (shardId, client) => {
    try {
      await setupShard(shardId, client);
      await enforceSingleGuild(client, shardId);
      setAchievementNotifyClient(client);

      if (client.user) {
        await client.user.setActivity('⚡HLD фарм | /помощь', { type: ActivityType.Playing });
      }

      initializeOwnerRights(client, FALLBACK_OWNER_ID);
      for (const guild of client.guilds.cache.values()) {
        if (!isPrimaryGuild(guild.id)) continue;
        const cfg = getGuildConfig(guild.id);
        if (cfg.ownerId) initializeOwnerRights(client, cfg.ownerId, guild.id);
      }

      for (const [, guild] of client.guilds.cache) {
        if (!isPrimaryGuild(guild.id)) continue;

        const triggerId = getTriggerChannelId(guild.id);
        if (!triggerId) {
          logErr(
            shardId,
            'JTC',
            `Сервер ${guild.name} (${guild.id}): канал-триггер не настроен — приватные комнаты не создаются. Запустите /setup (шаг 7) или задайте TRIGGER_CHANNEL_ID в .env`,
          );
        }

        setImmediate(() => {
          initVoicePanel(guild).catch((err) => logErr(shardId, 'VOICE_PANEL', `Ошибка инициализации для ${guild.id}: ${err.message}`));
          initSelfRolesForGuild(guild).catch((err) => logErr(shardId, 'SELF_ROLES', `${guild.id}: ${err.message}`));
        });
      }

      startPanelAutoUpdate(client);

      startGiveawayLoop(client);
      startBlackjackSweepLoop();
      startSeasonLoop(client);
      startServerStatsDailyLoop(client);
      initServerVoiceStats(client);

      const restoredFarmers = await restoreVoiceFarmSessions(client);
      if (restoredFarmers > 0) {
        logInfo(shardId, 'FARM', `Восстановлено voice-сессий: ${restoredFarmers}`);
      }

      logInfo(shardId, 'MAIN', `Полностью готов. Серверов: ${client.guilds.cache.size} (односерверный режим).`);
    } catch (err) {
      logErr(shardId, 'MAIN', `Ошибка при инициализации: ${err.message}`);
    }
  },
).catch((err) => {
  logFatal('MAIN', `Не удалось запустить менеджер шардов: ${err.message}`);
  process.exit(1);
});

startVoiceFarmLoop();
startDbBackupLoop();

process.on('uncaughtException', (error) => {
  logFatal('PROCESS', `uncaughtException: ${error.message}`);
  if (error.stack) console.error(error.stack);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || reason || 'Unknown';
  logFatal('PROCESS', `unhandledRejection: ${msg}`);
  if (reason?.stack) console.error(reason.stack);
});

process.on('SIGINT', async () => {
  console.log('\n[BOT] Shutting down...');
  await shardManager.shutdown().catch(() => {});
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[BOT] SIGTERM received, shutting down...');
  await shardManager.shutdown().catch(() => {});
  closeDatabase();
  process.exit(0);
});
