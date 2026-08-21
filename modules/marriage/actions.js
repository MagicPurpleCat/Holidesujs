import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import {
  getDb,
  gid,
  ensureUser,
  removeCoins,
  addCoins,
  runInTransaction,
  getEphemeral,
  deleteEphemeral,
} from '../../database.js';
import { brandEmbed, COLOR, fmtHld, fmtNum } from '../../utils/ui.js';
import {
  unlockAchievement,
  getOrCreateFamilyBank,
  splitFamilyBank,
  familyPair,
} from '../progress.js';
import { MR, PROPOSAL_TTL_MS, proposalKey, VOICE_BONUS_PCT } from './ids.js';
import {
  getMarriageStatus,
  findActiveProposalInvolvingUser,
  getActiveProposal,
  storeProposal,
  clearProposal,
  getMarriageRecord,
  getOrCreateUserSettings,
  denyView,
  resultView,
  navFooter,
  ephemeralPayload,
} from './helpers.js';
import { buildHomeView } from './views.js';

function ensureTargetSettings(_db, targetId) {
  return getOrCreateUserSettings(targetId);
}

export function buildProposalEmbed(proposer, target, expiresAt) {
  const unix = Math.floor(expiresAt / 1000);
  return brandEmbed({
    color: COLOR.pink,
    title: '💍 Предложение руки и сердца',
    description:
      `**${proposer.displayName || proposer.username}** предлагает пожениться с **${target.displayName || target.username}**.\n\n` +
      `Ответить может только <@${target.id}>.\n` +
      `Истекает <t:${unix}:R> (<t:${unix}:t>).`,
    footer: 'Holidesu · брак',
  }).setAuthor({
    name: proposer.displayName || proposer.username,
    iconURL: proposer.displayAvatarURL({ size: 128 }),
  }).setThumbnail(target.displayAvatarURL({ size: 256 }));
}

export function buildExpiredProposalEmbed() {
  return brandEmbed({
    color: COLOR.dark,
    title: '⏰ Предложение истекло',
    description: 'Время вышло. Новое предложение — через `/marry`.',
  });
}

export function buildWeddingEmbed(proposerId, targetId, guildName) {
  return brandEmbed({
    color: COLOR.pink,
    title: '💞 Свадьба состоялась!',
    description:
      `<@${proposerId}> и <@${targetId}> теперь в браке на **${guildName}**!\n\n` +
      '💕 Открыт семейный счёт — `/marry` → банк\n' +
      `🎤 Вместе в войсе фарм **+${VOICE_BONUS_PCT}%**`,
    footer: `${guildName} · Holidesu`,
  });
}

function recordMarriage(guildId, proposerId, targetId) {
  const db = getDb();
  const g = gid(guildId);
  const [user1Id, user2Id] = familyPair(proposerId, targetId);

  runInTransaction(() => {
    db.prepare(`
      UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(targetId, g, proposerId);
    db.prepare(`
      UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(proposerId, g, targetId);

    db.prepare(`
      INSERT INTO relationships (guild_id, user1_id, user2_id, status, married_at)
      VALUES (?, ?, ?, 'married', datetime('now'))
    `).run(g, user1Id, user2Id);

    getOrCreateFamilyBank(guildId, proposerId, targetId);
  });

  unlockAchievement(proposerId, guildId, 'first_marriage');
  unlockAchievement(targetId, guildId, 'first_marriage');
}

export function divorceUser(userId, guildId = '') {
  try {
    const db = getDb();
    const g = gid(guildId);
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, userId);
    if (!user || user.relationship_status !== 'married') {
      return { success: false, reason: 'not_married' };
    }

    const partnerId = user.relationship_partner_id;
    let split = { each: 0, leftover: 0 };
    if (partnerId) split = splitFamilyBank(guildId, userId, partnerId);

    const [user1Id, user2Id] = familyPair(userId, partnerId || userId);

    runInTransaction(() => {
      db.prepare(`
        UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL
        WHERE guild_id = ? AND user_id = ?
      `).run(g, userId);
      if (partnerId) {
        db.prepare(`
          UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL
          WHERE guild_id = ? AND user_id = ?
        `).run(g, partnerId);
      }

      db.prepare(`
        UPDATE relationships SET status = 'divorced', divorced_at = datetime('now')
        WHERE guild_id = ? AND user1_id = ? AND user2_id = ? AND status = 'married'
      `).run(g, user1Id, user2Id);
    });

    return { success: true, partnerId, split };
  } catch (error) {
    console.error('[MARRIAGE] divorce:', error);
    return { success: false, reason: 'error' };
  }
}

export function showDepositModal(interaction) {
  const modal = new ModalBuilder().setCustomId(MR.modalDeposit).setTitle('Положить на семейный счёт');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Сумма ⚡HLD')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('100'),
    ),
  );
  return interaction.showModal(modal);
}

export function showWithdrawModal(interaction) {
  const modal = new ModalBuilder().setCustomId(MR.modalWithdraw).setTitle('Снять с семейного счёта');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Сумма ⚡HLD')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('100'),
    ),
  );
  return interaction.showModal(modal);
}

export async function depositFamily(interaction, amountRaw) {
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);
  if (!status.married || !status.partnerId) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Нужен активный брак.')));
  }
  const amount = parseInt(amountRaw, 10);
  if (!Number.isInteger(amount) || amount < 1) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Сумма — целое число ≥ 1.', MR.nav.bank)));
  }

  const [a, b] = familyPair(interaction.user.id, status.partnerId);
  const db = getDb();
  const g = gid(interaction.guildId);

  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, amount, interaction.guildId)) throw new Error('NO_FUNDS');
      db.prepare(
        'UPDATE family_bank SET balance = balance + ? WHERE guild_id = ? AND user_a = ? AND user_b = ?',
      ).run(amount, g, a, b);
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply(ephemeralPayload(denyView(interaction, 'Недостаточно ⚡HLD.', MR.nav.bank)));
    }
    throw err;
  }

  const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);
  return interaction.reply(ephemeralPayload(resultView(interaction, {
    title: 'Семейный банк',
    description: `Положено ${fmtHld(amount)}\nНа счёте ${fmtHld(bank.balance)}`,
    color: COLOR.gold,
    backNav: MR.nav.bank,
    section: 'банк',
  })));
}

export async function withdrawFamily(interaction, amountRaw) {
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);
  if (!status.married || !status.partnerId) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Нужен активный брак.')));
  }
  const amount = parseInt(amountRaw, 10);
  if (!Number.isInteger(amount) || amount < 1) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Сумма — целое число ≥ 1.', MR.nav.bank)));
  }

  const [a, b] = familyPair(interaction.user.id, status.partnerId);
  const db = getDb();
  const g = gid(interaction.guildId);
  const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);

  try {
    runInTransaction(() => {
      const hold = db.prepare(
        'UPDATE family_bank SET balance = balance - ? WHERE guild_id = ? AND user_a = ? AND user_b = ? AND balance >= ?',
      ).run(amount, g, a, b, amount);
      if (hold.changes === 0) throw new Error('NO_BANK');
      addCoins(interaction.user.id, amount, interaction.guildId);
    });
  } catch (err) {
    if (err.message === 'NO_BANK') {
      return interaction.reply(ephemeralPayload(
        denyView(interaction, `На счёте только ${fmtHld(bank.balance)}.`, MR.nav.bank),
      ));
    }
    throw err;
  }

  const updated = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);
  return interaction.reply(ephemeralPayload(resultView(interaction, {
    title: 'Семейный банк',
    description: `Снято ${fmtHld(amount)}\nНа счёте ${fmtHld(updated.balance)}`,
    color: COLOR.gold,
    backNav: MR.nav.bank,
    section: 'банк',
  })));
}

export async function sendProposal(interaction, target) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const db = getDb();

  if (!target || target.bot || target.id === userId) {
    return interaction.update(denyView(interaction, 'Нельзя предложить этому пользователю.', MR.home));
  }

  ensureUser(userId, guildId);
  ensureUser(target.id, guildId);

  const g = gid(guildId);
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, userId);
  const targetUser = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, target.id);

  if (user?.relationship_status === 'married') {
    return interaction.update(denyView(interaction, 'Ты уже в браке.', MR.home));
  }
  if (targetUser?.relationship_status === 'married') {
    return interaction.update(denyView(interaction, 'Этот человек уже в браке.', MR.home));
  }

  const targetSettings = ensureTargetSettings(db, target.id);
  if (targetSettings && !targetSettings.allow_marriage_requests) {
    return interaction.update(denyView(
      interaction,
      'Пользователь запретил предложения в `/settings`.',
      MR.home,
    ));
  }

  const existing = findActiveProposalInvolvingUser(guildId, userId);
  if (existing) {
    return interaction.update(denyView(interaction, 'У тебя уже есть активное предложение.', MR.home));
  }
  const pendingToTarget = findActiveProposalInvolvingUser(guildId, target.id);
  if (pendingToTarget) {
    return interaction.update(denyView(interaction, 'У этого человека уже есть другое предложение.', MR.home));
  }

  const expiresAt = Date.now() + PROPOSAL_TTL_MS;
  const embed = buildProposalEmbed(interaction.user, target, expiresAt);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MR.acceptPrefix}${userId}:${target.id}`)
      .setLabel('Принять')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MR.rejectPrefix}${userId}:${target.id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.update(resultView(interaction, {
    title: 'Предложение отправлено',
    description: `Ждём ответ от <@${target.id}> (${Math.round(PROPOSAL_TTL_MS / 60000)} мин).`,
    color: COLOR.pink,
    section: 'предложение',
  }));

  const follow = await interaction.channel.send({
    content: `<@${target.id}>`,
    embeds: [embed],
    components: [row],
  });

  storeProposal(guildId, userId, target.id, {
    messageId: follow.id,
    channelId: follow.channelId,
  });

  const key = proposalKey(guildId, userId, target.id);
  setTimeout(async () => {
    try {
      if (!getEphemeral(key)) return;
      deleteEphemeral(key);
      if (!follow.editable) return;
      await follow.edit({ embeds: [buildExpiredProposalEmbed()], components: [] }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, PROPOSAL_TTL_MS);

  return true;
}

export async function cancelOwnProposal(interaction) {
  const pending = findActiveProposalInvolvingUser(interaction.guildId, interaction.user.id);
  if (!pending || pending.proposerId !== interaction.user.id) {
    return interaction.update(denyView(interaction, 'Нет своего активного предложения.'));
  }
  clearProposal(pending.guildId, pending.proposerId, pending.targetId);
  if (pending.payload?.channelId && pending.payload?.messageId) {
    try {
      const channel = await interaction.client.channels.fetch(pending.payload.channelId).catch(() => null);
      const msg = channel?.messages
        ? await channel.messages.fetch(pending.payload.messageId).catch(() => null)
        : null;
      if (msg?.editable) {
        await msg.edit({
          embeds: [
            brandEmbed({
              color: COLOR.dark,
              title: 'Предложение отменено',
              description: `<@${pending.proposerId}> отозвал(а) предложение.`,
            }),
          ],
          components: [],
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }
  return interaction.update(buildHomeView(interaction));
}

export async function confirmDivorce(interaction) {
  const result = divorceUser(interaction.user.id, interaction.guildId);
  if (!result.success) {
    return interaction.update(denyView(
      interaction,
      result.reason === 'not_married' ? 'Ты не в браке.' : 'Не удалось расторгнуть брак.',
    ));
  }

  const splitText = result.split?.each
    ? `\nСемейный счёт поделён: по **${fmtNum(result.split.each)}** ⚡HLD каждому.`
    : '';

  await interaction.update(resultView(interaction, {
    title: 'Брак расторгнут',
    description: `Ты развёлся(ась) с <@${result.partnerId}>.${splitText}`,
    color: COLOR.dark,
    section: 'развод',
  }));

  if (interaction.channel?.send) {
    await interaction.channel.send({
      embeds: [
        brandEmbed({
          color: COLOR.dark,
          title: '💔 Брак расторгнут',
          description: `<@${interaction.user.id}> и <@${result.partnerId}> больше не вместе.${splitText}`,
          footer: navFooter(interaction, 'развод'),
        }),
      ],
    }).catch(() => {});
  }

  return true;
}

/**
 * Кнопки принятия/отклонения (mr:ok: / mr:no: и legacy marry_accept_).
 */
export async function handleMarryButton(interaction) {
  const customId = interaction.customId || '';
  let action;
  let proposerId;
  let targetId;

  if (customId.startsWith(MR.acceptPrefix) || customId.startsWith(MR.rejectPrefix)) {
    action = customId.startsWith(MR.acceptPrefix) ? 'accept' : 'reject';
    const rest = customId.slice(action === 'accept' ? MR.acceptPrefix.length : MR.rejectPrefix.length);
    const [p, t] = rest.split(':');
    proposerId = p;
    targetId = t;
  } else if (customId.startsWith('marry_')) {
    const parts = customId.split('_');
    action = parts[1];
    proposerId = parts[2];
    targetId = parts[3];
  } else {
    return false;
  }

  try {
    const guildId = interaction.guildId;
    if (!guildId || !proposerId || !targetId || !['accept', 'reject'].includes(action)) {
      await interaction.reply({ content: '❌ Некорректное предложение.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.user.id !== targetId) {
      await interaction.reply({
        content: '❌ Только тот, кому сделали предложение, может ответить.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const proposal = getActiveProposal(guildId, proposerId, targetId);
    if (!proposal) {
      await interaction.update({
        embeds: [buildExpiredProposalEmbed()],
        components: [],
      }).catch(async () => {
        await interaction.reply({
          content: '⏰ Это предложение уже истекло или было отменено.',
          flags: MessageFlags.Ephemeral,
        });
      });
      return true;
    }

    const db = getDb();
    const g = gid(guildId);
    ensureUser(proposerId, guildId);
    ensureUser(targetId, guildId);

    const proposer = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, proposerId);
    const target = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, targetId);

    if (proposer?.relationship_status === 'married' || target?.relationship_status === 'married') {
      clearProposal(guildId, proposerId, targetId);
      await interaction.update({
        embeds: [
          brandEmbed({
            color: COLOR.dark,
            title: '💔 Предложение недействительно',
            description: 'Один из участников уже состоит в браке.',
          }),
        ],
        components: [],
      });
      return true;
    }

    clearProposal(guildId, proposerId, targetId);

    if (action === 'accept') {
      recordMarriage(guildId, proposerId, targetId);
      await interaction.update({
        embeds: [buildWeddingEmbed(proposerId, targetId, interaction.guild?.name || 'сервер')],
        components: [],
      });
      return true;
    }

    await interaction.update({
      embeds: [
        brandEmbed({
          color: COLOR.danger,
          title: '💔 Предложение отклонено',
          description:
            `<@${targetId}> отклонил(а) предложение <@${proposerId}>.\n\n` +
            'Можно попробовать снова через `/marry`.',
          footer: navFooter(interaction, 'брак'),
        }),
      ],
      components: [],
    });
    return true;
  } catch (error) {
    console.error('[MARRIAGE] button:', error);
    await interaction.reply({
      content: '❌ Не удалось обработать ответ. Попробуй ещё раз.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
}

export { getMarriageStatus, getMarriageRecord, findActiveProposalInvolvingUser, storeProposal, clearProposal, PROPOSAL_TTL_MS, proposalKey };
