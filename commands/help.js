import {
  SlashCommandBuilder,
} from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';
import { brandEmbed, COLOR, guildFooter } from '../utils/ui.js';

function buildHelpEmbed(userLevel, guild) {
  const embed = brandEmbed({
    color: COLOR.accent,
    title: `Holidesu · ${guild.name}`,
    description:
      'Валюта сервера — **⚡HLD**. Пиши `/` и начни имя команды.\n' +
      'Баланс, уровень и брак считаются **отдельно на каждом сервере**.',
    footer: guildFooter({ guild }, 'помощь'),
    thumbnail: guild.iconURL({ size: 128 }),
  }).addFields(
    {
      name: 'Экономика',
      value:
        '`/баланс` `/pay` `/work` `/квесты` `/сезон`\n' +
        '`/cosmetics` `/shop` `/profile` `/rank` `/топ` `/settings`',
      inline: false,
    },
    {
      name: 'Игры и люди',
      value:
        '`/casino` daily · slot · coinflip · blackjack\n' +
        '`/marry` `/divorce` `/семья` `/реп` `/meme-gen`\n' +
        '`/clan` create · shop · wars · bank',
      inline: false,
    },
    {
      name: 'Голос и чат',
      value:
        'Зайди в канал создания комнаты → `/room-settings`.\n' +
        'Фарм ⚡HLD — в войсе **не в соло**. Сообщения дают XP раз в 5 сек.',
      inline: false,
    },
    {
      name: 'Поддержка',
      value: '`/verify`  ·  `/ticket setup`  ·  `/ticket close`  ·  `/giveaway start`',
      inline: false,
    },
  );

  if (userLevel >= 1) {
    const lines = [
      '`/mod` warn · mute · unmute · kick · ban · unban · warns',
      '`/history` `/логи` `/панель`',
    ];
    if (userLevel >= 2) {
      lines.push('`/setup` мастер сервера  ·  `/фичи` модули бота');
    }
    embed.addFields({ name: 'Персонал', value: lines.join('\n'), inline: false });
  }

  return embed;
}

async function runHelp(interaction) {
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  await interaction.reply({
    embeds: [buildHelpEmbed(userLevel, interaction.guild)],
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
