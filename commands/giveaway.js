import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getDb, removeCoins, addCoins, runInTransaction } from '../database.js';
import { getUserLevel } from '../utils/permissions.js';
import { COLOR, fmtHld, fmtNum, replyFail } from '../utils/ui.js';

function canHost(interaction) {
  return Boolean(
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages)
    || getUserLevel(interaction.user.id, interaction.guild) >= 1,
  );
}

function joinButton(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_join:${id}`)
      .setLabel('Участвовать')
      .setStyle(ButtonStyle.Success),
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Розыгрыш приза. Можно взять вход в ⚡HLD')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Запустить розыгрыш')
        .addStringOption((opt) =>
          opt.setName('приз').setDescription('Что разыгрываем').setRequired(true).setMaxLength(200)
        )
        .addIntegerOption((opt) =>
          opt.setName('минуты').setDescription('Длительность').setRequired(true).setMinValue(1).setMaxValue(10080)
        )
        .addIntegerOption((opt) =>
          opt.setName('ставка').setDescription('Цена участия в ⚡HLD (0 = бесплатно)').setRequired(false).setMinValue(0)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Отменить розыгрыш и вернуть платный вход')
        .addIntegerOption((opt) =>
          opt.setName('id').setDescription('ID розыгрыша из футера embed').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'cancel') {
      return cancelGiveaway(interaction);
    }
    if (!canHost(interaction)) {
      return replyFail(interaction, 'Нужны права модератора.');
    }
    const prize = interaction.options.getString('приз');
    const minutes = interaction.options.getInteger('минуты');
    const cost = interaction.options.getInteger('ставка') || 0;
    const endsAt = Date.now() + minutes * 60 * 1000;
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO giveaways (guild_id, channel_id, host_id, prize, cost, ends_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'running')
    `).run(interaction.guildId, interaction.channelId, interaction.user.id, prize, cost, endsAt);
    const id = Number(result.lastInsertRowid);

    const embed = buildGiveawayEmbed({
      id, prize, cost, endsAt, hostId: interaction.user.id, entries: 0,
    });
    const msg = await interaction.reply({
      embeds: [embed],
      components: [joinButton(id)],
      fetchReply: true,
    });
    db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, id);
  },
};

function buildGiveawayEmbed({ id, prize, cost, endsAt, hostId, entries, winnerId }) {
  const embed = new EmbedBuilder()
    .setColor(winnerId ? COLOR.success : COLOR.gold)
    .setTitle(winnerId ? 'Розыгрыш завершён' : 'Розыгрыш')
    .setDescription(`**${prize}**`)
    .addFields(
      { name: 'Организатор', value: `<@${hostId}>`, inline: true },
      { name: 'Вход', value: cost > 0 ? fmtHld(cost) : 'Бесплатно', inline: true },
      { name: 'Участников', value: `**${fmtNum(entries)}**`, inline: true },
    );
  if (winnerId) {
    embed.addFields({ name: 'Победитель', value: `<@${winnerId}>`, inline: false });
    embed.setFooter({ text: 'Holidesu' });
  } else {
    embed.setFooter({ text: `Holidesu · #${id} · конец` });
    embed.addFields({
      name: 'До конца',
      value: `<t:${Math.floor(endsAt / 1000)}:R>`,
      inline: true,
    });
  }
  return embed;
}

async function cancelGiveaway(interaction) {
  if (!canHost(interaction)) {
    return replyFail(interaction, 'Нужны права модератора.');
  }

  const id = interaction.options.getInteger('id');
  const db = getDb();
  const gw = db.prepare("SELECT * FROM giveaways WHERE id = ? AND guild_id = ? AND status = 'running'").get(id, interaction.guildId);
  if (!gw) {
    return replyFail(interaction, 'Розыгрыш не найден или уже завершён.');
  }

  const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id);
  let refunded = 0;

  runInTransaction(() => {
    if (gw.cost > 0) {
      for (const entry of entries) {
        addCoins(entry.user_id, gw.cost, interaction.guildId);
        refunded += 1;
      }
    }
    db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(id);
    db.prepare("UPDATE giveaways SET status = 'cancelled', winner_id = NULL WHERE id = ?").run(id);
  });

  const embed = buildGiveawayEmbed({
    id: gw.id,
    prize: gw.prize,
    cost: gw.cost,
    endsAt: gw.ends_at,
    hostId: gw.host_id,
    entries: 0,
  })
    .setColor(COLOR.danger)
    .setTitle('Розыгрыш отменён')
    .setDescription(`**${gw.prize}**\n\nОрганизатор: <@${interaction.user.id}>`)
    .setFooter({ text: `Holidesu · #${id} · отменён` });

  if (gw.message_id) {
    try {
      const channel = await interaction.client.channels.fetch(gw.channel_id).catch(() => null);
      const msg = channel ? await channel.messages.fetch(gw.message_id).catch(() => null) : null;
      if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  const refundText = gw.cost > 0
    ? ` Возвращено **${refunded}** участникам по ${fmtHld(gw.cost)}.`
    : '';

  await interaction.reply({
    content: `✅ Розыгрыш **#${id}** отменён.${refundText}`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleGiveawayButton(interaction) {
  if (!interaction.customId.startsWith('giveaway_join:')) return false;
  const id = Number(interaction.customId.split(':')[1]);
  const db = getDb();
  const gw = db.prepare("SELECT * FROM giveaways WHERE id = ? AND status = 'running'").get(id);
  if (!gw) {
    await interaction.reply({ content: '❌ Розыгрыш уже завершён.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (gw.ends_at <= Date.now()) {
    await interaction.reply({ content: '❌ Время вышло.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const exists = db.prepare(
    'SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
  ).get(id, interaction.user.id);
  if (exists) {
    await interaction.reply({ content: '✅ Ты уже участвуешь.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (gw.cost > 0 && !removeCoins(interaction.user.id, gw.cost, interaction.guildId)) {
    await interaction.reply({
      content: `❌ Нужно **${gw.cost} ⚡HLD** для участия.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, interaction.user.id);
  const entries = db.prepare('SELECT COUNT(*) AS cnt FROM giveaway_entries WHERE giveaway_id = ?').get(id).cnt;
  const embed = buildGiveawayEmbed({
    id: gw.id,
    prize: gw.prize,
    cost: gw.cost,
    endsAt: gw.ends_at,
    hostId: gw.host_id,
    entries,
  });
  await interaction.update({ embeds: [embed], components: [joinButton(id)] }).catch(async () => {
    await interaction.reply({ content: '✅ Ты в розыгрыше!', flags: MessageFlags.Ephemeral });
  });
  return true;
}

export async function tickGiveaways(client) {
  const db = getDb();
  const due = db.prepare("SELECT * FROM giveaways WHERE status = 'running' AND ends_at <= ?").all(Date.now());
  for (const gw of due) {
    const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(gw.id);
    const winnerId = entries.length
      ? entries[Math.floor(Math.random() * entries.length)].user_id
      : null;
    db.prepare("UPDATE giveaways SET status = 'ended', winner_id = ? WHERE id = ?").run(winnerId, gw.id);
    const embed = buildGiveawayEmbed({
      id: gw.id,
      prize: gw.prize,
      cost: gw.cost,
      endsAt: gw.ends_at,
      hostId: gw.host_id,
      entries: entries.length,
      winnerId,
    });
    try {
      const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
      if (!channel) continue;
      if (gw.message_id) {
        const msg = await channel.messages.fetch(gw.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      }
      await channel.send({
        content: winnerId
          ? `🎉 Победитель: <@${winnerId}> — **${gw.prize}**`
          : `🎉 Розыгрыш **${gw.prize}** завершён без участников.`,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

let giveawayLoopStarted = false;
export function startGiveawayLoop(client) {
  if (giveawayLoopStarted) return;
  giveawayLoopStarted = true;
  setInterval(() => {
    tickGiveaways(client).catch(() => {});
  }, 20_000);
}
