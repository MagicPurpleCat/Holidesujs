import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import {
  getDb,
  removeCoins,
  runInTransaction,
  setEphemeral,
  getEphemeral,
  deleteEphemeral,
} from '../../database.js';
import { unlockAchievement } from '../progress.js';
import { brandEmbed, COLOR, fmtHld, fmtNum } from '../../utils/ui.js';
import {
  CL,
  CREATE_COST,
  CLAN_SHOP,
  INVITE_TTL_MS,
  WAR_TTL_MS,
  WAR_COOLDOWN_MS,
  MAX_CLAN_MEMBERS,
  inviteStorageKey,
  warPendingKey,
  warCdKey,
} from './ids.js';
import {
  getMemberClan,
  findClanByTag,
  clanPower,
  clanScore,
  listMembers,
  canLead,
  canOfficerOrLead,
  resultView,
  denyView,
  backCloseRow,
  navFooter,
} from './helpers.js';
import { buildCompareEmbed } from './views.js';

export function showCreateModal(interaction) {
  const modal = new ModalBuilder().setCustomId(CL.modalCreate).setTitle('Создать клан');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Название')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tag')
        .setLabel('Тег (2–5 букв/цифр)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(5),
    ),
  );
  return interaction.showModal(modal);
}

export function showDepositModal(interaction) {
  const modal = new ModalBuilder().setCustomId(CL.modalDeposit).setTitle('Пополнить банк');
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

export function showWarTagModal(interaction, withStake = false) {
  const modal = new ModalBuilder()
    .setCustomId(withStake ? CL.modalWar + ':stake' : CL.modalWar)
    .setTitle(withStake ? 'Вызов на войну' : 'Сравнить кланы');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tag')
        .setLabel('Тег соперника')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5),
    ),
  );
  if (withStake) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('stake')
          .setLabel('Ставка из банка')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('1000'),
      ),
    );
  }
  return interaction.showModal(modal);
}

export function showWarStakeModal(interaction, opponentClanId) {
  const modal = new ModalBuilder()
    .setCustomId(`${CL.modalWarStake}${opponentClanId}`)
    .setTitle('Ставка на войну');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('stake')
        .setLabel('Ставка ⚡HLD из банка')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
  );
  return interaction.showModal(modal);
}

function ephemeralPayload(view) {
  return { ...view, flags: MessageFlags.Ephemeral };
}

export async function createClan(interaction, name, tagRaw) {
  const db = getDb();
  const guildId = interaction.guildId;
  const nameTrim = String(name || '').trim();
  const tag = String(tagRaw || '').trim().toUpperCase();

  if (!nameTrim || nameTrim.length > 32) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Название: 1–32 символа.')));
  }
  if (!/^[A-Z0-9А-ЯЁ]{2,5}$/i.test(tag)) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Тег: 2–5 букв или цифр, без пробелов.')));
  }
  if (getMemberClan(db, interaction.user.id, guildId)) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Ты уже в клане.')));
  }
  if (findClanByTag(db, tag, guildId)) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Такой тег уже занят.')));
  }
  if (db.prepare('SELECT 1 FROM clans WHERE name = ? COLLATE NOCASE AND guild_id = ?').get(nameTrim, guildId)) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Такое название уже занято.')));
  }

  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, CREATE_COST, guildId)) throw new Error('NO_FUNDS');
      db.prepare(
        'INSERT INTO clans (name, tag, owner_id, bank_balance, guild_id) VALUES (?, ?, ?, 0, ?)',
      ).run(nameTrim, tag, interaction.user.id, guildId);
      const clan = findClanByTag(db, tag, guildId);
      db.prepare('INSERT INTO clan_members (clan_id, user_id, role) VALUES (?, ?, ?)')
        .run(clan.clan_id, interaction.user.id, 'leader');
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply(ephemeralPayload(denyView(interaction, `Нужно **${CREATE_COST} ⚡HLD**.`)));
    }
    console.error('[CLAN] create:', err);
    return interaction.reply(ephemeralPayload(denyView(interaction, err.message)));
  }

  unlockAchievement(interaction.user.id, guildId, 'clan_founder');
  return interaction.reply(ephemeralPayload(
    resultView(interaction, {
      title: `[${tag}] ${nameTrim}`,
      description: `Клан создан. Списано ${fmtHld(CREATE_COST)}.\nОткрой \`/clan\` для управления.`,
      color: COLOR.success,
    }),
  ));
}

export async function deposit(interaction, amount) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return interaction.reply(ephemeralPayload(denyView(interaction, 'Ты не в клане.')));
  const n = parseInt(amount, 10);
  if (!Number.isInteger(n) || n < 1) {
    return interaction.reply(ephemeralPayload(denyView(interaction, 'Сумма — целое число ≥ 1.', CL.nav.bank)));
  }

  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, n, interaction.guildId)) throw new Error('NO_FUNDS');
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?')
        .run(n, clan.clan_id);
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply(ephemeralPayload(denyView(interaction, 'Недостаточно ⚡HLD.', CL.nav.bank)));
    }
    throw err;
  }

  const updated = db.prepare('SELECT bank_balance FROM clans WHERE clan_id = ?').get(clan.clan_id);
  return interaction.reply(ephemeralPayload(
    resultView(interaction, {
      title: 'Банк пополнен',
      description: `Внесено **${fmtNum(n)} ⚡HLD**.\nСейчас в банке: ${fmtHld(updated.bank_balance)}`,
      color: COLOR.gold,
      backNav: CL.nav.bank,
      section: 'банк',
    }),
  ));
}

export async function sendInvite(interaction, targetUser) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return interaction.update(denyView(interaction, 'Ты не в клане.'));
  if (!canOfficerOrLead(clan, interaction.user.id)) {
    return interaction.update(denyView(interaction, 'Приглашать могут лидер и офицеры.', CL.nav.members));
  }
  if (!targetUser || targetUser.bot || targetUser.id === interaction.user.id) {
    return interaction.update(denyView(interaction, 'Нельзя пригласить этого пользователя.', CL.nav.members));
  }
  if (getMemberClan(db, targetUser.id, interaction.guildId)) {
    return interaction.update(denyView(interaction, 'Уже состоит в клане.', CL.nav.members));
  }
  const count = listMembers(db, clan.clan_id).length;
  if (count >= MAX_CLAN_MEMBERS) {
    return interaction.update(denyView(interaction, `Лимит состава: ${MAX_CLAN_MEMBERS}.`, CL.nav.members));
  }

  setEphemeral(inviteStorageKey(interaction.guildId, targetUser.id), {
    clanId: clan.clan_id,
    tag: clan.tag,
    fromId: interaction.user.id,
  }, INVITE_TTL_MS);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CL.inviteAcceptPrefix}${clan.clan_id}`)
      .setLabel('Принять')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CL.inviteRejectPrefix}${clan.clan_id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = brandEmbed({
    color: COLOR.aqua,
    title: 'Приглашение в клан',
    description:
      `<@${targetUser.id}>, тебя зовут в **[${clan.tag}] ${clan.name}**.\n` +
      `От: <@${interaction.user.id}>\nДействует **10 минут**.`,
    footer: navFooter(interaction, 'инвайт'),
  });

  await interaction.update(
    resultView(interaction, {
      title: 'Приглашение отправлено',
      description: `Ждём ответ от <@${targetUser.id}>.`,
      backNav: CL.nav.members,
      section: 'участники',
    }),
  );

  await interaction.followUp({
    content: `<@${targetUser.id}>`,
    embeds: [embed],
    components: [row],
  });
  return true;
}

export async function acceptInvite(interaction, clanId) {
  const db = getDb();
  const guildId = interaction.guildId;
  if (getMemberClan(db, interaction.user.id, guildId)) {
    return interaction.reply({
      content: '❌ Ты уже в клане.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const invite = getEphemeral(inviteStorageKey(guildId, interaction.user.id));
  if (!invite || Number(invite.clanId) !== Number(clanId)) {
    return interaction.reply({
      content: '❌ Это приглашение не для тебя или уже истекло.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const clan = db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?').get(clanId, guildId);
  if (!clan) {
    deleteEphemeral(inviteStorageKey(guildId, interaction.user.id));
    return interaction.update({ content: '❌ Клан больше не существует.', embeds: [], components: [] });
  }

  if (listMembers(db, clan.clan_id).length >= MAX_CLAN_MEMBERS) {
    return interaction.reply({
      content: `❌ В клане уже ${MAX_CLAN_MEMBERS} участников.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare('INSERT INTO clan_members (clan_id, user_id, role) VALUES (?, ?, ?)')
    .run(clan.clan_id, interaction.user.id, 'member');
  deleteEphemeral(inviteStorageKey(guildId, interaction.user.id));
  if (clan.discord_role_id) {
    await interaction.member?.roles.add(clan.discord_role_id).catch(() => {});
  }

  return interaction.update({
    content: null,
    embeds: [
      brandEmbed({
        color: COLOR.success,
        title: 'Добро пожаловать',
        description: `<@${interaction.user.id}> вступил в **[${clan.tag}] ${clan.name}**.`,
        footer: navFooter(interaction, 'клан'),
      }),
    ],
    components: [],
  });
}

export async function rejectInvite(interaction, clanId) {
  const invite = getEphemeral(inviteStorageKey(interaction.guildId, interaction.user.id));
  if (invite && Number(invite.clanId) === Number(clanId)) {
    deleteEphemeral(inviteStorageKey(interaction.guildId, interaction.user.id));
  }
  return interaction.update({
    content: 'Приглашение отклонено.',
    embeds: [],
    components: [],
  });
}

export async function leaveClan(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return interaction.update(denyView(interaction, 'Ты не в клане.'));

  if (clan.discord_role_id) {
    await interaction.member?.roles.remove(clan.discord_role_id).catch(() => {});
  }

  if (clan.member_role === 'leader' || clan.owner_id === interaction.user.id) {
    const others = db.prepare(`
      SELECT user_id, role FROM clan_members
      WHERE clan_id = ? AND user_id != ?
      ORDER BY CASE role WHEN 'officer' THEN 0 ELSE 1 END, joined_at
    `).all(clan.clan_id, interaction.user.id);

    db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?')
      .run(clan.clan_id, interaction.user.id);

    if (others.length === 0) {
      if (clan.discord_role_id) {
        const role = interaction.guild.roles.cache.get(clan.discord_role_id);
        if (role?.editable) await role.delete('Клан распущен').catch(() => {});
      }
      db.prepare('DELETE FROM clans WHERE clan_id = ?').run(clan.clan_id);
      return interaction.update(
        resultView(interaction, {
          title: 'Клан распущен',
          description: `**[${clan.tag}]** больше нет участников.`,
          color: COLOR.wait,
        }),
      );
    }

    const successor = others[0];
    db.prepare('UPDATE clan_members SET role = ? WHERE clan_id = ? AND user_id = ?')
      .run('leader', clan.clan_id, successor.user_id);
    db.prepare('UPDATE clans SET owner_id = ? WHERE clan_id = ?').run(successor.user_id, clan.clan_id);
    return interaction.update(
      resultView(interaction, {
        title: 'Ты вышел',
        description: `Покинул **[${clan.tag}]**. Новый лидер: <@${successor.user_id}>.`,
        color: COLOR.wait,
      }),
    );
  }

  db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?')
    .run(clan.clan_id, interaction.user.id);
  return interaction.update(
    resultView(interaction, {
      title: 'Ты вышел',
      description: `Покинул **[${clan.tag}] ${clan.name}**.`,
      color: COLOR.wait,
    }),
  );
}

export async function kickMember(interaction, targetId) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan || !canLead(clan, interaction.user.id)) {
    return interaction.update(denyView(interaction, 'Только лидер.', CL.nav.members));
  }
  if (targetId === interaction.user.id) {
    return interaction.update(denyView(interaction, 'Себя исключать нельзя — используй выход.', CL.nav.members));
  }
  const target = getMemberClan(db, targetId, interaction.guildId);
  if (!target || target.clan_id !== clan.clan_id) {
    return interaction.update(denyView(interaction, 'Этот человек не в твоём клане.', CL.nav.members));
  }
  if (target.member_role === 'leader' || target.owner_id === targetId) {
    return interaction.update(denyView(interaction, 'Нельзя исключить лидера.', CL.nav.members));
  }

  db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?').run(clan.clan_id, targetId);
  if (clan.discord_role_id) {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member) await member.roles.remove(clan.discord_role_id).catch(() => {});
  }
  return interaction.update(
    resultView(interaction, {
      title: 'Исключён',
      description: `<@${targetId}> больше не в **[${clan.tag}]**.`,
      color: COLOR.danger,
      backNav: CL.nav.members,
      section: 'участники',
    }),
  );
}

export async function setMemberRole(interaction, targetId, newRole) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan || !canLead(clan, interaction.user.id)) {
    return interaction.update(denyView(interaction, 'Только лидер.', CL.nav.members));
  }
  if (targetId === interaction.user.id) {
    return interaction.update(denyView(interaction, 'Нельзя менять свою роль так.', CL.nav.members));
  }
  const target = getMemberClan(db, targetId, interaction.guildId);
  if (!target || target.clan_id !== clan.clan_id) {
    return interaction.update(denyView(interaction, 'Не в твоём клане.', CL.nav.members));
  }
  if (target.member_role === 'leader' || target.owner_id === targetId) {
    return interaction.update(denyView(interaction, 'Роль лидера так не меняется.', CL.nav.members));
  }
  if (!['officer', 'member'].includes(newRole)) {
    return interaction.update(denyView(interaction, 'Неверная роль.', CL.nav.members));
  }

  db.prepare('UPDATE clan_members SET role = ? WHERE clan_id = ? AND user_id = ?')
    .run(newRole, clan.clan_id, targetId);

  return interaction.update(
    resultView(interaction, {
      title: newRole === 'officer' ? 'Повышение' : 'Понижение',
      description: `<@${targetId}> теперь **${newRole === 'officer' ? 'офицер' : 'участник'}**.`,
      backNav: CL.nav.members,
      section: 'участники',
    }),
  );
}

export async function buyShopItem(interaction, item) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return interaction.update(denyView(interaction, 'Ты не в клане.'));
  if (!canLead(clan, interaction.user.id)) {
    return interaction.update(denyView(interaction, 'Покупать может только лидер.', CL.nav.shop));
  }
  const spec = CLAN_SHOP[item];
  if (!spec) return interaction.update(denyView(interaction, 'Неизвестный товар.', CL.nav.shop));

  if (item === 'tag' && clan.show_tag) {
    return interaction.update(denyView(interaction, 'Тег уже куплен.', CL.nav.shop));
  }
  if (item === 'role' && clan.discord_role_id) {
    return interaction.update(denyView(interaction, `Роль уже есть: <@&${clan.discord_role_id}>.`, CL.nav.shop));
  }

  if (item === 'role') {
    const me = interaction.guild.members.me
      || await interaction.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.update(denyView(interaction, 'У бота нет Manage Roles.', CL.nav.shop));
    }
    if (!me.roles.highest || me.roles.highest.position <= 0) {
      return interaction.update(denyView(interaction, 'Роль бота слишком низко в иерархии.', CL.nav.shop));
    }
  }

  const pay = db.prepare(
    'UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?',
  ).run(spec.price, clan.clan_id, spec.price);
  if (pay.changes === 0) {
    return interaction.update(denyView(interaction, `В банке нужно **${spec.price} ⚡HLD**.`, CL.nav.shop));
  }

  if (item === 'boost') {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE clans SET farm_boost_until = ? WHERE clan_id = ?').run(until, clan.clan_id);
    return interaction.update(
      resultView(interaction, {
        title: 'Буст куплен',
        description: `+20% фарма до <t:${Math.floor(Date.parse(until) / 1000)}:F>.`,
        color: COLOR.purple,
        backNav: CL.nav.shop,
        section: 'магазин',
      }),
    );
  }
  if (item === 'tag') {
    db.prepare('UPDATE clans SET show_tag = 1 WHERE clan_id = ?').run(clan.clan_id);
    return interaction.update(
      resultView(interaction, {
        title: 'Тег куплен',
        description: 'Тег виден в `/profile`.',
        backNav: CL.nav.shop,
        section: 'магазин',
      }),
    );
  }

  try {
    const role = await interaction.guild.roles.create({
      name: `[${clan.tag}] ${clan.name}`.slice(0, 100),
      mentionable: false,
      reason: 'Клановый магазин',
    });
    db.prepare('UPDATE clans SET discord_role_id = ? WHERE clan_id = ?').run(role.id, clan.clan_id);
    for (const m of listMembers(db, clan.clan_id)) {
      const member = await interaction.guild.members.fetch(m.user_id).catch(() => null);
      if (member) await member.roles.add(role).catch(() => {});
    }
    return interaction.update(
      resultView(interaction, {
        title: 'Роль создана',
        description: `Выдана: <@&${role.id}>`,
        backNav: CL.nav.shop,
        section: 'магазин',
      }),
    );
  } catch (err) {
    db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(spec.price, clan.clan_id);
    return interaction.update(denyView(interaction, `Не удалось создать роль: ${err.message}`, CL.nav.shop));
  }
}

export async function compareClans(interaction, opponentTagOrId, { byId = false } = {}) {
  const db = getDb();
  const myClan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!myClan) {
    const view = denyView(interaction, 'Ты не в клане.');
    return interaction.replied || interaction.deferred
      ? interaction.followUp({ ...view, flags: MessageFlags.Ephemeral })
      : interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
  }

  const opponent = byId
    ? db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?').get(Number(opponentTagOrId), interaction.guildId)
    : findClanByTag(db, opponentTagOrId, interaction.guildId);

  if (!opponent) {
    return interaction.reply({
      ...denyView(interaction, 'Клан-соперник не найден.', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }
  if (opponent.clan_id === myClan.clan_id) {
    return interaction.reply({
      ...denyView(interaction, 'Нельзя сравнивать с собой.', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }

  const p1 = clanPower(db, myClan.clan_id, interaction.guildId);
  const p2 = clanPower(db, opponent.clan_id, interaction.guildId);
  const embed = buildCompareEmbed(interaction, myClan, opponent, p1, p2);
  const body = {
    embeds: [embed],
    components: [backCloseRow(CL.nav.war)],
  };

  if (interaction.isMessageComponent?.() && !interaction.replied && !interaction.deferred) {
    return interaction.update(body);
  }
  return interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
}

export async function challengeWar(interaction, opponentClanId, stake) {
  const db = getDb();
  const guildId = interaction.guildId;
  const myClan = getMemberClan(db, interaction.user.id, guildId);
  if (!myClan || !canLead(myClan, interaction.user.id)) {
    return interaction.reply({
      ...denyView(interaction, 'Только лидер объявляет войну со ставкой.', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }

  const opponent = db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?')
    .get(Number(opponentClanId), guildId);
  if (!opponent || opponent.clan_id === myClan.clan_id) {
    return interaction.reply({
      ...denyView(interaction, 'Соперник не найден.', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }

  const n = parseInt(stake, 10);
  if (!Number.isInteger(n) || n < 1) {
    return interaction.reply({
      ...denyView(interaction, 'Ставка — целое число ≥ 1.', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }
  if (getEphemeral(warCdKey(guildId, myClan.clan_id)) || getEphemeral(warCdKey(guildId, opponent.clan_id))) {
    return interaction.reply({
      ...denyView(interaction, 'Один из кланов на кулдауне войны (6 ч).', CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }
  if (myClan.bank_balance < n || opponent.bank_balance < n) {
    return interaction.reply({
      ...denyView(interaction, `У обоих банков должно быть ≥ **${n} ⚡HLD**.`, CL.nav.war),
      flags: MessageFlags.Ephemeral,
    });
  }

  const pendingKey = warPendingKey(guildId, myClan.clan_id, opponent.clan_id);
  setEphemeral(pendingKey, {
    fromClanId: myClan.clan_id,
    toClanId: opponent.clan_id,
    stake: n,
    challengerId: interaction.user.id,
  }, WAR_TTL_MS);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_war_accept:${myClan.clan_id}:${opponent.clan_id}:${n}`)
      .setLabel('Принять войну')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`clan_war_reject:${myClan.clan_id}:${opponent.clan_id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = brandEmbed({
    color: COLOR.wait,
    title: 'Вызов на войну',
    description:
      `**[${myClan.tag}]** вызывает **[${opponent.tag}]**.\n` +
      `Ставка: **${fmtNum(n)} ⚡HLD** с каждой стороны → победителю **${fmtNum(n * 2)}**.\n` +
      `Принять может лидер <@${opponent.owner_id}> (10 мин).`,
    footer: navFooter(interaction, 'война'),
  });

  await interaction.reply({
    content: `<@${opponent.owner_id}>`,
    embeds: [embed],
    components: [row],
  });
}

function resolveClanWar(db, clan1, clan2, guildId, stake) {
  const p1 = clanPower(db, clan1.clan_id, guildId);
  const p2 = clanPower(db, clan2.clan_id, guildId);
  const score1 = clanScore(p1);
  const score2 = clanScore(p2);

  let winnerTag = null;
  let text = `Ничья. Ставки **${fmtNum(stake)} ⚡HLD** возвращены.`;
  runInTransaction(() => {
    const a = db.prepare(
      'UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?',
    ).run(stake, clan1.clan_id, stake);
    const b = db.prepare(
      'UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?',
    ).run(stake, clan2.clan_id, stake);
    if (a.changes === 0 || b.changes === 0) throw new Error('NO_BANK');

    if (score1 === score2) {
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake, clan1.clan_id);
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake, clan2.clan_id);
    } else if (score1 > score2) {
      winnerTag = clan1.tag;
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake * 2, clan1.clan_id);
      text = `Побеждает **[${clan1.tag}]**. Банк получает **${fmtNum(stake * 2)} ⚡HLD**.`;
    } else {
      winnerTag = clan2.tag;
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake * 2, clan2.clan_id);
      text = `Побеждает **[${clan2.tag}]**. Банк получает **${fmtNum(stake * 2)} ⚡HLD**.`;
    }
  });
  return { winnerTag, text, score1, score2 };
}

export async function handleClanWarButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('clan_war_')) return false;

  const db = getDb();
  const guildId = interaction.guildId;
  const parts = customId.split(':');
  const action = parts[0];
  const fromClanId = Number(parts[1]);
  const toClanId = Number(parts[2]);
  const stake = Number(parts[3] || 0);

  const fromClan = db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?').get(fromClanId, guildId);
  const toClan = db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?').get(toClanId, guildId);
  if (!fromClan || !toClan) {
    await interaction.reply({ content: '❌ Клан не найден.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const defender = getMemberClan(db, interaction.user.id, guildId);
  if (!defender || defender.clan_id !== toClan.clan_id || !canLead(defender, interaction.user.id)) {
    await interaction.reply({
      content: '❌ Принять или отклонить может только лидер вызванного клана.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const pendingKey = warPendingKey(guildId, fromClanId, toClanId);
  const pending = getEphemeral(pendingKey);
  if (!pending) {
    await interaction.reply({ content: '❌ Вызов истёк или уже обработан.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'clan_war_reject') {
    deleteEphemeral(pendingKey);
    await interaction.update({ content: 'Война отклонена.', embeds: [], components: [] });
    return true;
  }

  const actualStake = pending.stake || stake;
  try {
    const outcome = resolveClanWar(db, fromClan, toClan, guildId, actualStake);
    deleteEphemeral(pendingKey);
    setEphemeral(warCdKey(guildId, fromClan.clan_id), { at: Date.now() }, WAR_COOLDOWN_MS);
    setEphemeral(warCdKey(guildId, toClan.clan_id), { at: Date.now() }, WAR_COOLDOWN_MS);

    const embed = brandEmbed({
      color: outcome.winnerTag ? COLOR.success : COLOR.wait,
      title: 'Итог войны',
      description: outcome.text,
      footer: navFooter(interaction, 'война'),
    }).addFields(
      { name: `[${fromClan.tag}]`, value: `Очки **${outcome.score1}**`, inline: true },
      { name: `[${toClan.tag}]`, value: `Очки **${outcome.score2}**`, inline: true },
    );
    await interaction.update({ content: null, embeds: [embed], components: [] });
    if (outcome.winnerTag) {
      const winner = outcome.winnerTag === fromClan.tag ? fromClan : toClan;
      for (const m of listMembers(db, winner.clan_id)) {
        unlockAchievement(m.user_id, guildId, 'clan_war_win');
      }
    }
  } catch (err) {
    if (err.message === 'NO_BANK') {
      await interaction.reply({
        content: '❌ У одного из кланов не хватает денег в банке.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    throw err;
  }
  return true;
}
