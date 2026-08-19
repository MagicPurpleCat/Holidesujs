// === Команды /marry и /divorce ===
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getDb, ensureUser, getEphemeral, deleteEphemeral } from '../database.js';
import {
  divorceUser,
  findActiveProposalInvolvingUser,
  storeProposal,
  proposalKey,
  buildProposalEmbed,
  buildExpiredProposalEmbed,
  getMarriageStatus,
  PROPOSAL_TTL_MS,
} from '../modules/relationships.js';
import { getOrCreateFamilyBank } from '../modules/progress.js';
import { COLOR, fmtHld, guildFooter } from '../utils/ui.js';

async function ensureTargetSettings(db, targetId) {
  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(targetId);
  if (!settings) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(targetId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(targetId);
  }
  return settings;
}

async function showMarriageStatus(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const status = getMarriageStatus(userId, guildId);

  if (status.married && status.partnerId) {
    const bank = getOrCreateFamilyBank(guildId, userId, status.partnerId);
    const marriedAt = status.record?.married_at
      ? `<t:${Math.floor(new Date(`${status.record.married_at}Z`).getTime() / 1000)}:D>`
      : 'неизвестно';

    const embed = new EmbedBuilder()
      .setColor(COLOR.pink)
      .setTitle('💞 Твой брак')
      .setDescription(`Партнёр: <@${status.partnerId}>`)
      .addFields(
        { name: 'Свадьба', value: marriedAt, inline: true },
        { name: 'Семейный счёт', value: fmtHld(bank.balance), inline: true },
        { name: 'Бонус', value: 'Вместе в войсе **+15%**', inline: false },
      )
      .setFooter({ text: guildFooter(interaction, 'развод — /divorce') });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (status.pending) {
    const { proposerId, targetId } = status.pending;
    const isTarget = targetId === userId;
    const embed = new EmbedBuilder()
      .setColor(COLOR.wait)
      .setTitle('⏳ Активное предложение')
      .setDescription(
        isTarget
          ? `<@${proposerId}> ждёт твоего ответа в канале с кнопками.`
          : `Ты предложил(а) пожениться с <@${targetId}>. Ждём ответа.`,
      )
      .setFooter({ text: guildFooter(interaction, `истекает через ${PROPOSAL_TTL_MS / 1000} сек`) });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    content: '💍 Ты не в браке. Предложение: `/marry` + выбери пользователя.',
    flags: MessageFlags.Ephemeral,
  });
}

async function createProposal(interaction, target) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const db = getDb();

  if (target.id === userId) {
    return interaction.reply({
      content: '❌ Нельзя жениться на самом себе.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (target.bot) {
    return interaction.reply({
      content: '❌ Нельзя жениться на боте.',
      flags: MessageFlags.Ephemeral,
    });
  }

  ensureUser(userId, guildId);
  ensureUser(target.id, guildId);

  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  const targetUser = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, target.id);

  if (user.relationship_status === 'married') {
    return interaction.reply({
      content: '❌ Ты уже в браке. Сначала `/divorce`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (targetUser.relationship_status === 'married') {
    return interaction.reply({
      content: '❌ Этот пользователь уже в браке.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const targetSettings = await ensureTargetSettings(db, target.id);
  if (targetSettings && !targetSettings.allow_marriage_requests) {
    return interaction.reply({
      content: '❌ Пользователь запретил брачные предложения в `/settings`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = findActiveProposalInvolvingUser(guildId, userId);
  if (existing) {
    const waitingOn = existing.proposerId === userId
      ? `<@${existing.targetId}>`
      : `<@${existing.proposerId}>`;
    return interaction.reply({
      content: `❌ У тебя уже есть активное предложение с ${waitingOn}. Дождись ответа или истечения таймера.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const pendingToTarget = findActiveProposalInvolvingUser(guildId, target.id);
  if (pendingToTarget && pendingToTarget.proposerId !== userId) {
    return interaction.reply({
      content: '❌ У этого пользователя уже есть другое активное предложение.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const expiresAt = Date.now() + PROPOSAL_TTL_MS;
  const embed = buildProposalEmbed(interaction.user, target, expiresAt);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`marry_accept_${userId}_${target.id}`)
      .setLabel('💞 Принять')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`marry_reject_${userId}_${target.id}`)
      .setLabel('💔 Отклонить')
      .setStyle(ButtonStyle.Danger),
  );

  const reply = await interaction.reply({
    content: `<@${target.id}>`,
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  storeProposal(guildId, userId, target.id, {
    messageId: reply.id,
    channelId: reply.channelId,
  });

  const key = proposalKey(guildId, userId, target.id);
  setTimeout(async () => {
    try {
      if (!getEphemeral(key)) return;
      deleteEphemeral(key);
      if (!reply.editable) return;
      await reply.edit({ embeds: [buildExpiredProposalEmbed()], components: [] }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, PROPOSAL_TTL_MS);
}

export default {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Брак на сервере — предложение или статус')
    .addUserOption((opt) =>
      opt
        .setName('пользователь')
        .setDescription('Кому предложить (оставь пустым — показать статус)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Брак доступен только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const target = interaction.options.getUser('пользователь');
      if (!target) return showMarriageStatus(interaction);
      return createProposal(interaction, target);
    } catch (error) {
      console.error('[MARRY] Ошибка:', error);
      return interaction.reply({
        content: '❌ Не удалось создать предложение.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

export const divorceAlias = {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Расторгнуть брак и разделить семейный счёт'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = divorceUser(interaction.user.id, interaction.guildId);
    if (!result.success) {
      const msg = result.reason === 'not_married'
        ? '❌ Ты не в браке.'
        : '❌ Не удалось расторгнуть брак.';
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    const mention = result.partnerId ? `<@${result.partnerId}>` : 'партнёра';
    const splitText = result.split?.each
      ? `\n\nСемейный счёт поделён: по **${result.split.each.toLocaleString('ru-RU')}** ⚡HLD каждому.`
      : '';

    const embed = new EmbedBuilder()
      .setColor(COLOR.dark)
      .setTitle('💔 Брак расторгнут')
      .setDescription(`<@${interaction.user.id}> разводится с ${mention}.${splitText}`)
      .setFooter({ text: guildFooter(interaction, 'marry') });

    await interaction.reply({ embeds: [embed] });
  },
};
