import {
  SlashCommandBuilder,
} from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';
import { brandEmbed, COLOR, guildFooter } from '../utils/ui.js';

const STAFF_CMDS = new Set(['mod', 'history', 'логи', 'панель', 'setup', 'фичи', 'welcome-preview', 'self-roles']);

function buildHelpEmbed(userLevel, guild, commandNames = []) {
  const publicCmds = commandNames
    .filter((n) => !STAFF_CMDS.has(n) && n !== 'help')
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const staffCmds = commandNames
    .filter((n) => STAFF_CMDS.has(n))
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const fmt = (names) => names.map((n) => `\`/${n}\``).join(' · ') || '—';

  const embed = brandEmbed({
    color: COLOR.accent,
    title: `Holidesu · ${guild.name}`,
    description:
      'Валюта сервера — **⚡HLD**. Пиши `/` и начни имя команды.\n' +
      'Бот работает **на одном сервере** (`GUILD_ID`).',
    footer: guildFooter({ guild }, 'помощь'),
    thumbnail: guild.iconURL({ size: 128 }),
  }).addFields(
    {
      name: 'Команды',
      value: fmt(publicCmds).slice(0, 1020),
      inline: false,
    },
    {
      name: 'Голос и чат',
      value:
        'Зайди в канал создания комнаты → `/room-settings`.\n' +
        'Фарм ⚡HLD — в войсе **не в соло**, без mute. После ~20 мин тишины ставка падает.',
      inline: false,
    },
  );

  if (userLevel >= 1 && staffCmds.length) {
    embed.addFields({
      name: 'Персонал',
      value: fmt(staffCmds).slice(0, 1020),
      inline: false,
    });
  }

  return embed;
}

async function runHelp(interaction) {
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  const names = interaction.client?.commands
    ? [...interaction.client.commands.keys()]
    : [];
  await interaction.reply({
    embeds: [buildHelpEmbed(userLevel, interaction.guild, names)],
  });
}

const helpAlias = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Справочник команд Holidesu'),
  execute: runHelp,
};

export default {
  data: new SlashCommandBuilder()
    .setName('помощь')
    .setDescription('Справочник команд Holidesu'),
  execute: runHelp,
};

export { helpAlias };
