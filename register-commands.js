/**
 * Скрипт для глобальной регистрации Slash-команд.
 * Запускать: node register-commands.js
 * Или вызывается автоматически из start.js (при флаге --register).
 *
 * ВАЖНО: перед запуском убедись, что DISCORD_TOKEN и CLIENT_ID
 * указаны в .env файле.
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';

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

const commands = [
  balanceCmd.data.toJSON(),
  shopCmd.data.toJSON(),
  profileCmd.data.toJSON(),
  casinoCmd.data.toJSON(),
  clanCmd.data.toJSON(),
verifyCmd.data.toJSON(),
  rankCmd.data.toJSON(),
  adminPanelCmd.data.toJSON(),
  topCmd.data.toJSON(),
  helpCmd.data.toJSON(),
  helpAlias.data.toJSON(),
  marryCmd.data.toJSON(),
  roleCmd.data.toJSON(),
  historyCmd.data.toJSON(),
  settingsCmd.data.toJSON(),
  memeGenCmd.data.toJSON(),
  setupCmd.data.toJSON(),
  roomSettingsCmd.data.toJSON(),
  logsCmd.data.toJSON(),
  moderationCmd.data.toJSON(),
  divorceAlias.data.toJSON(),
  repCmd.data.toJSON(),
  repAlias.data.toJSON(),
];

/**
 * Регистрирует slash-команды.
 * @returns {Promise<{count: number, scope: string}>}
 */
export async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  if (!token || token.length < 10) {
    console.error('[REGISTER] ОШИБКА: DISCORD_TOKEN не указан или некорректен в .env.');
    return { count: 0, scope: 'error:no-token' };
  }

  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    console.error('[REGISTER] ОШИБКА: CLIENT_ID не указан в .env.');
    return { count: 0, scope: 'error:no-client-id' };
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('[REGISTER] Регистрация Slash-команд...');

    if (process.env.GUILD_ID) {
      // Guild-specific registration (быстрое обновление для тестов)
      await rest.put(
        Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`[REGISTER] Зарегистрировано ${commands.length} команд для гильдии ${process.env.GUILD_ID}`);
      return { count: commands.length, scope: `guild:${process.env.GUILD_ID}` };
    } else {
      // Глобальная регистрация (до 1 часа на распространение)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`[REGISTER] Зарегистрировано ${commands.length} глобальных команд`);
      return { count: commands.length, scope: 'global' };
    }
  } catch (error) {
    console.error('[REGISTER] Ошибка:', error);
    return { count: 0, scope: 'error' };
  }
}

// Прямой запуск: node register-commands.js
// Если модуль импортирован (например, из start.js) — не запускаем автоматически.
const isDirectRun = Boolean(process.argv[1]) && String(process.argv[1]).endsWith('register-commands.js');
if (isDirectRun) {
  registerCommands().then(() => process.exit(0));
}
