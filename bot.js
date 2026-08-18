import 'dotenv/config';
import {
  Collection,
  ActivityType,
} from 'discord.js';
import { initDatabase, closeDatabase } from './database.js';
import { initializeOwnerRights } from './modules/ownerInit.js';
import { UniversalShardManager } from './src/core/shard-manager.js';
import { FALLBACK_OWNER_ID, getGuildConfig } from './utils/guildConfig.js';
import { logInfo, logErr, logFatal } from './utils/botLog.js';
import { registerInteractionHandler } from './handlers/interactions.js';
import { registerGuildEvents, startVoiceFarmLoop } from './handlers/guildEvents.js';
import { startDbBackupLoop } from './modules/dbBackup.js';
import { initVoicePanel, startPanelAutoUpdate } from './modules/voicePanel.js';

initDatabase();

import balanceCmd from './commands/balance.js';
import shopCmd from './commands/shop.js';
import profileCmd from './commands/profile.js';
import casinoCmd from './commands/casino.js';
import clanCmd from './commands/clan.js';
import verifyCmd from './commands/verify.js';
import rankCmd from './commands/rank.js';
import adminPanelCmd from './commands/admin_panel.js';
import topCmd from './commands/top.js';
import helpCmd, { helpAlias } from './commands/help.js';
import marryCmd, { divorceAlias } from './commands/marry.js';
import roleCmd from './commands/role.js';
import historyCmd from './commands/history.js';
import settingsCmd from './commands/settings.js';
import memeGenCmd from './commands/meme-gen.js';
import setupCmd from './commands/setup.js';
import roomSettingsCmd from './commands/room-settings.js';
import logsCmd from './commands/logs.js';
import moderationCmd from './commands/moderation.js';
import repCmd, { repAlias } from './commands/rep.js';

const allCommands = [
  balanceCmd, shopCmd, profileCmd, casinoCmd, clanCmd,
  verifyCmd, rankCmd,
  adminPanelCmd, topCmd, helpCmd, helpAlias,
  marryCmd, divorceAlias, roleCmd, historyCmd, settingsCmd,
  memeGenCmd, setupCmd, roomSettingsCmd, logsCmd,
  moderationCmd, repCmd, repAlias,
];

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

      if (client.user) {
        await client.user.setActivity('⚡HLD фарм | /помощь', { type: ActivityType.Playing });
      }

      initializeOwnerRights(client, FALLBACK_OWNER_ID);
      for (const guild of client.guilds.cache.values()) {
        const cfg = getGuildConfig(guild.id);
        if (cfg.ownerId) initializeOwnerRights(client, cfg.ownerId);
      }

      for (const [, guild] of client.guilds.cache) {
        setImmediate(() => {
          initVoicePanel(guild).catch((err) => logErr(shardId, 'VOICE_PANEL', `Ошибка инициализации для ${guild.id}: ${err.message}`));
        });
      }

      startPanelAutoUpdate(client);

      logInfo(shardId, 'MAIN', `Полностью готов. Серверов: ${client.guilds.cache.size}.`);
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
