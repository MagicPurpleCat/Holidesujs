import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { getDb } from '../database.js';
import { getGuildConfig, clearGuildConfigCache, initGuildConfig } from '../utils/guildConfig.js';
import { getUserLevel as permLevel } from '../utils/permissions.js';
import { brandEmbed, COLOR, guildFooter, replyFail, replyDone } from '../utils/ui.js';

function canManage(interaction) {
  return Boolean(
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels)
    || permLevel(interaction.user.id, interaction.guild) >= 1,
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Тикеты поддержки: панель и закрытие')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Опубликовать панель тикетов в этом канале')
        .addChannelOption((opt) =>
          opt
            .setName('категория')
            .setDescription('Куда создавать тикеты')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Закрыть текущий тикет')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      if (!canManage(interaction)) {
        return replyFail(interaction, 'Нужны права управлять каналами.');
      }
      const category = interaction.options.getChannel('категория');
      initGuildConfig(interaction.guildId);
      const db = getDb();
      const row = db.prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(interaction.guildId);
      let channels = {};
      try {
        channels = JSON.parse(row?.channels || '{}');
      } catch {
        channels = {};
      }
      channels.ticket_category = category.id;
      db.prepare('UPDATE server_config SET channels = ? WHERE guild_id = ?')
        .run(JSON.stringify(channels), interaction.guildId);
      clearGuildConfigCache(interaction.guildId);

      const embed = brandEmbed({
        color: COLOR.accent,
        title: 'Поддержка',
        description: 'Нажми кнопку — откроется приватный канал с модераторами.',
        footer: guildFooter(interaction, 'тикеты'),
      });
      const rowBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_create')
          .setLabel('Открыть тикет')
          .setStyle(ButtonStyle.Primary),
      );
      await interaction.channel.send({ embeds: [embed], components: [rowBtn] });
      return replyDone(
        interaction,
        `Панель в этом канале. Тикеты идут в **${category.name}**.`,
        { title: 'Тикеты настроены' },
      );
    }

    return handleTicketClose(interaction);
  },
};

export async function handleTicketButton(interaction) {
  if (interaction.customId !== 'ticket_create') return false;
  const guild = interaction.guild;
  const cfg = getGuildConfig(guild.id);
  const categoryId = cfg.ticketCategoryId;
  if (!categoryId) {
    await interaction.reply({
      content: '❌ Тикеты не настроены. Админ: `/ticket setup`.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'",
  ).get(guild.id, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `❌ У тебя уже есть тикет: <#${existing.channel_id}>`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  for (const roleId of cfg.adminRoles || []) {
    if (guild.roles.cache.has(roleId)) {
      overwrites.push({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: overwrites,
    reason: `Тикет от ${interaction.user.tag}`,
  });

  db.prepare(
    'INSERT INTO tickets (guild_id, channel_id, opener_id, status) VALUES (?, ?, ?, ?)',
  ).run(guild.id, channel.id, interaction.user.id, 'open');

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Закрыть тикет').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎫 Тикет открыт')
        .setDescription('Опиши проблему. Модератор закроет тикет кнопкой или `/ticket close`.'),
    ],
    components: [closeRow],
  });

  await interaction.reply({
    content: `✅ Тикет создан: ${channel}`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

export async function handleTicketClose(interaction) {
  const db = getDb();
  const ticket = db.prepare(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
  ).get(interaction.channelId);
  if (!ticket) {
    if (interaction.replied || interaction.deferred) return true;
    await interaction.reply({
      content: '❌ Это не открытый тикет.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const isOpener = ticket.opener_id === interaction.user.id;
  if (!isOpener && !canManage(interaction)) {
    await interaction.reply({ content: '❌ Закрыть может автор или модератор.', flags: MessageFlags.Ephemeral });
    return true;
  }

  db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(ticket.id);
  await interaction.reply({ content: '🔒 Тикет закрыт. Канал удалится через 5 секунд.' });
  setTimeout(() => {
    interaction.channel?.delete('Тикет закрыт').catch(() => {});
  }, 5000);
  return true;
}
