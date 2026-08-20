import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { getDb, ensureUser, removeCoins, runInTransaction, setEphemeral, getEphemeral, deleteEphemeral } from '../database.js';
import { unlockAchievement } from '../modules/progress.js';
import { COLOR, fmtHld, fmtNum } from '../utils/ui.js';

const CREATE_COST = 1000;
const INVITE_TTL_MS = 10 * 60 * 1000;
const WAR_TTL_MS = 10 * 60 * 1000;
const WAR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function inviteKey(guildId, userId) {
  return `clan_invite:${guildId}:${userId}`;
}

function getMemberClan(db, userId, guildId) {
  if (guildId) {
    return db.prepare(`
      SELECT c.*, m.role AS member_role
      FROM clan_members m
      JOIN clans c ON c.clan_id = m.clan_id
      WHERE m.user_id = ? AND c.guild_id = ?
    `).get(userId, guildId);
  }
  return db.prepare(`
    SELECT c.*, m.role AS member_role
    FROM clan_members m
    JOIN clans c ON c.clan_id = m.clan_id
    WHERE m.user_id = ?
  `).get(userId);
}

function findClanByTag(db, tag, guildId) {
  if (guildId) {
    return db.prepare('SELECT * FROM clans WHERE tag = ? COLLATE NOCASE AND guild_id = ?').get(tag, guildId);
  }
  return db.prepare('SELECT * FROM clans WHERE tag = ? COLLATE NOCASE').get(tag);
}

function clanPower(db, clanId, guildId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS members,
      COALESCE(SUM(u.level), 0) AS levels,
      COALESCE(SUM(u.total_xp), 0) AS xp
    FROM clan_members m
    JOIN users u ON u.user_id = m.user_id AND u.guild_id = ?
    WHERE m.clan_id = ?
  `).get(guildId, clanId);
  return row || { members: 0, levels: 0, xp: 0 };
}

export default {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Клан: банк, магазин, войны и инвайты')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Создать клан (1000 ⚡HLD)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Название').setRequired(true).setMaxLength(32)
        )
        .addStringOption((opt) =>
          opt.setName('tag').setDescription('Тег (2–5 символов)').setRequired(true).setMaxLength(5)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Информация о клане')
        .addStringOption((opt) =>
          opt.setName('tag').setDescription('Тег клана (свой, если не указать)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Пригласить игрока в свой клан')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Кого пригласить').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Принять приглашение в клан')
        .addStringOption((opt) =>
          opt.setName('tag').setDescription('Тег клана').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Выйти из клана')
    )
    .addSubcommand((sub) =>
      sub
        .setName('deposit')
        .setDescription('Пополнить банк клана')
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Сумма').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('bank').setDescription('Банк своего клана и топ кланов')
    )
    .addSubcommand((sub) =>
      sub
        .setName('shop')
        .setDescription('Клановый магазин за банк')
        .addStringOption((opt) =>
          opt.setName('товар')
            .setDescription('Что купить (пусто = каталог)')
            .setRequired(false)
            .addChoices(
              { name: 'Буст фарма +20% на 7 дней (5000)', value: 'boost' },
              { name: 'Тег в профиле (2500)', value: 'tag' },
              { name: 'Роль клана (8000)', value: 'role' },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('wars')
        .setDescription('Война кланов: сравнение силы или ставка из банка')
        .addStringOption((opt) =>
          opt.setName('tag').setDescription('Тег клана-соперника').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('ставка').setDescription('Ставка из банка обоих кланов (нужно подтверждение)').setRequired(false).setMinValue(1)
        )
    ),

  async execute(interaction) {
    try {
    const sub = interaction.options.getSubcommand();
      const db = getDb();
      ensureUser(interaction.user.id, interaction.guildId);

      if (sub === 'create') return handleCreate(interaction, db);
      if (sub === 'info') return handleInfo(interaction, db);
      if (sub === 'invite') return handleInvite(interaction, db);
      if (sub === 'join') return handleJoin(interaction, db);
      if (sub === 'leave') return handleLeave(interaction, db);
      if (sub === 'deposit') return handleDeposit(interaction, db);
      if (sub === 'bank') return handleBank(interaction, db);
      if (sub === 'shop') return handleClanShop(interaction, db);
      if (sub === 'wars') return handleWars(interaction, db);
    } catch (error) {
      console.error('[CLAN] Ошибка:', error);
      const payload = { content: '❌ Ошибка клановой команды.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};

async function handleCreate(interaction, db) {
  const name = interaction.options.getString('name').trim();
  const tag = interaction.options.getString('tag').trim().toUpperCase();

  if (!/^[A-Z0-9А-ЯЁ]{2,5}$/i.test(tag)) {
    return interaction.reply({
      content: '❌ Тег: 2–5 букв или цифр, без пробелов.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  if (getMemberClan(db, interaction.user.id, guildId)) {
    return interaction.reply({
      content: '❌ Ты уже состоишь в клане. Сначала выйди: `/clan leave`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (findClanByTag(db, tag, guildId)) {
      return interaction.reply({
      content: '❌ Клан с таким тегом уже существует на этом сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

  if (db.prepare('SELECT 1 FROM clans WHERE name = ? COLLATE NOCASE AND guild_id = ?').get(name, guildId)) {
      return interaction.reply({
      content: '❌ Клан с таким названием уже существует на этом сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, CREATE_COST, guildId)) {
        throw new Error('NO_FUNDS');
      }
      db.prepare(
        'INSERT INTO clans (name, tag, owner_id, bank_balance, guild_id) VALUES (?, ?, ?, 0, ?)'
      ).run(name, tag, interaction.user.id, guildId);
      const clan = findClanByTag(db, tag, guildId);
      db.prepare('INSERT INTO clan_members (clan_id, user_id, role) VALUES (?, ?, ?)')
        .run(clan.clan_id, interaction.user.id, 'leader');
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply({
        content: `❌ Создание клана стоит **${CREATE_COST} ⚡HLD**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    console.error('[CLAN] create:', err);
    return interaction.reply({
      content: `❌ Не удалось создать клан: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(`[${tag}] ${name}`)
    .setDescription(`Клан создан. Лидер <@${interaction.user.id}>\nСписано ${fmtHld(CREATE_COST)}`)
    .setFooter({ text: 'Holidesu · clan' });

  unlockAchievement(interaction.user.id, guildId, 'clan_founder');
  await interaction.reply({ embeds: [embed] });
}

async function handleInfo(interaction, db) {
  const tagOpt = interaction.options.getString('tag');
  let clan;
  if (tagOpt) {
    clan = findClanByTag(db, tagOpt.trim().toUpperCase(), interaction.guildId);
  } else {
    clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  }

  if (!clan) {
    return interaction.reply({
      content: tagOpt ? '❌ Клан не найден.' : '❌ Ты не в клане. Укажи тег или вступи в клан.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const members = db.prepare(`
    SELECT user_id, role FROM clan_members WHERE clan_id = ? ORDER BY
      CASE role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, joined_at
  `).all(clan.clan_id);
  const power = clanPower(db, clan.clan_id, interaction.guildId);
  const list = members
    .slice(0, 15)
    .map((m) => {
      const role = m.role === 'leader' ? '👑' : m.role === 'officer' ? '⭐' : '•';
      return `${role} <@${m.user_id}>`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLOR.accent)
    .setTitle(`[${clan.tag}] ${clan.name}`)
    .addFields(
      { name: 'Лидер', value: `<@${clan.owner_id}>`, inline: true },
      { name: 'Банк', value: fmtHld(clan.bank_balance), inline: true },
      { name: 'Состав', value: `**${fmtNum(power.members)}**`, inline: true },
      { name: 'Сила', value: `уровни **${fmtNum(power.levels)}** · XP **${fmtNum(power.xp)}**`, inline: true },
      { name: 'Создан', value: clan.created_at || '—', inline: true },
      { name: 'Участники', value: list || '—', inline: false },
    )
    .setFooter({ text: 'Holidesu · clan' });

  await interaction.reply({ embeds: [embed] });
}

async function handleInvite(interaction, db) {
  const target = interaction.options.getUser('user');
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) {
    return interaction.reply({ content: '❌ Ты не состоишь в клане.', flags: MessageFlags.Ephemeral });
  }
  if (clan.member_role !== 'leader' && clan.member_role !== 'officer') {
    return interaction.reply({ content: '❌ Приглашать могут лидер и офицеры.', flags: MessageFlags.Ephemeral });
  }
  if (target.bot || target.id === interaction.user.id) {
    return interaction.reply({ content: '❌ Нельзя пригласить этого пользователя.', flags: MessageFlags.Ephemeral });
  }
  if (getMemberClan(db, target.id, interaction.guildId)) {
    return interaction.reply({ content: '❌ Этот пользователь уже в клане.', flags: MessageFlags.Ephemeral });
  }

  setEphemeral(inviteKey(interaction.guildId, target.id), {
    clanId: clan.clan_id,
    tag: clan.tag,
    fromId: interaction.user.id,
  }, INVITE_TTL_MS);

  await interaction.reply({
    content: `📨 <@${target.id}>, тебя пригласили в **[${clan.tag}] ${clan.name}**.\nПрими: \`/clan join tag:${clan.tag}\` (10 минут).`,
  });
}

async function handleJoin(interaction, db) {
  const tag = interaction.options.getString('tag').trim().toUpperCase();
  if (getMemberClan(db, interaction.user.id, interaction.guildId)) {
    return interaction.reply({ content: '❌ Ты уже в клане.', flags: MessageFlags.Ephemeral });
  }

  const invite = getEphemeral(inviteKey(interaction.guildId, interaction.user.id));
  if (!invite || invite.tag !== tag) {
    return interaction.reply({
      content: '❌ Нет действующего приглашения в этот клан.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const clan = db.prepare('SELECT * FROM clans WHERE clan_id = ? AND guild_id = ?').get(invite.clanId, interaction.guildId);
  if (!clan) {
    deleteEphemeral(inviteKey(interaction.guildId, interaction.user.id));
    return interaction.reply({ content: '❌ Клан больше не существует.', flags: MessageFlags.Ephemeral });
  }

  db.prepare('INSERT INTO clan_members (clan_id, user_id, role) VALUES (?, ?, ?)')
    .run(clan.clan_id, interaction.user.id, 'member');
  deleteEphemeral(inviteKey(interaction.guildId, interaction.user.id));
  if (clan.discord_role_id) {
    await interaction.member?.roles.add(clan.discord_role_id).catch(() => {});
  }

  await interaction.reply({
    content: `✅ Ты вступил в **[${clan.tag}] ${clan.name}**.`,
  });
}

async function handleLeave(interaction, db) {
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) {
    return interaction.reply({ content: '❌ Ты не в клане.', flags: MessageFlags.Ephemeral });
  }

  if (clan.discord_role_id) {
    await interaction.member?.roles.remove(clan.discord_role_id).catch(() => {});
  }

  if (clan.member_role === 'leader' || clan.owner_id === interaction.user.id) {
    const others = db.prepare(
      'SELECT user_id, role FROM clan_members WHERE clan_id = ? AND user_id != ? ORDER BY CASE role WHEN \'officer\' THEN 0 ELSE 1 END, joined_at'
    ).all(clan.clan_id, interaction.user.id);

  db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?')
    .run(clan.clan_id, interaction.user.id);

    if (others.length === 0) {
      db.prepare('DELETE FROM clans WHERE clan_id = ?').run(clan.clan_id);
      return interaction.reply({ content: `👋 Клан **[${clan.tag}]** распущен: не осталось участников.` });
    }

    const successor = others[0];
    db.prepare('UPDATE clan_members SET role = ? WHERE clan_id = ? AND user_id = ?')
      .run('leader', clan.clan_id, successor.user_id);
    db.prepare('UPDATE clans SET owner_id = ? WHERE clan_id = ?').run(successor.user_id, clan.clan_id);
    return interaction.reply({
      content: `👋 Ты покинул **[${clan.tag}]**. Новый лидер: <@${successor.user_id}>.`,
    });
  }

  db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?')
    .run(clan.clan_id, interaction.user.id);
  await interaction.reply({ content: `👋 Ты покинул **[${clan.tag}] ${clan.name}**.` });
}

async function handleDeposit(interaction, db) {
  const amount = interaction.options.getInteger('amount');
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) {
    return interaction.reply({ content: '❌ Ты не в клане.', flags: MessageFlags.Ephemeral });
  }
  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, amount, interaction.guildId)) {
        throw new Error('NO_FUNDS');
      }
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?')
        .run(amount, clan.clan_id);
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply({ content: '❌ Недостаточно ⚡HLD.', flags: MessageFlags.Ephemeral });
    }
    throw err;
  }
  const updated = db.prepare('SELECT bank_balance FROM clans WHERE clan_id = ?').get(clan.clan_id);
  await interaction.reply({
    content: `💰 В банк **[${clan.tag}]** внесено **${amount} ⚡HLD**. Сейчас: **${updated.bank_balance} ⚡HLD**.`,
  });
}

async function handleBank(interaction, db) {
  const mine = getMemberClan(db, interaction.user.id, interaction.guildId);
  const top = db.prepare('SELECT tag, name, bank_balance FROM clans WHERE guild_id = ? ORDER BY bank_balance DESC LIMIT 5').all(interaction.guildId);
  const lines = top.length
    ? top.map((c, i) => `${i + 1}. **[${c.tag}] ${c.name}** — ${fmtHld(c.bank_balance)}`).join('\n')
    : 'Пока нет кланов.';

  const embed = new EmbedBuilder()
    .setColor(COLOR.gold)
    .setTitle('Клановые банки')
    .setDescription(lines)
    .setFooter({ text: 'Holidesu · clan bank' });

  if (mine) {
    embed.addFields({
      name: 'Твой клан',
      value: `**[${mine.tag}]** — **${mine.bank_balance} ⚡HLD**`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

const CLAN_SHOP = {
  boost: { price: 5000, label: 'Буст фарма +20% на 7 дней' },
  tag: { price: 2500, label: 'Тег клана в профиле' },
  role: { price: 8000, label: 'Discord-роль клана' },
};

async function handleClanShop(interaction, db) {
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) {
    return interaction.reply({ content: '❌ Ты не в клане.', flags: MessageFlags.Ephemeral });
  }
  const item = interaction.options.getString('товар');
  if (!item) {
    const boostUntil = clan.farm_boost_until
      ? `до ${clan.farm_boost_until}`
      : 'нет';
    const embed = new EmbedBuilder()
      .setColor(COLOR.purple)
      .setTitle(`[${clan.tag}] магазин`)
      .setDescription(
        `Банк ${fmtHld(clan.bank_balance)}\n\n` +
        `**boost** — ${CLAN_SHOP.boost.label} — ${fmtHld(CLAN_SHOP.boost.price)}\nсейчас: ${boostUntil}\n\n` +
        `**tag** — ${CLAN_SHOP.tag.label} — ${fmtHld(CLAN_SHOP.tag.price)} · ${clan.show_tag ? 'куплено' : 'нет'}\n\n` +
        `**role** — ${CLAN_SHOP.role.label} — ${fmtHld(CLAN_SHOP.role.price)}`,
      )
      .setFooter({ text: 'Holidesu · /clan shop товар:boost · только лидер' });
    return interaction.reply({ embeds: [embed] });
  }

  if (clan.owner_id !== interaction.user.id && clan.member_role !== 'leader') {
    return interaction.reply({ content: '❌ Покупать может только лидер.', flags: MessageFlags.Ephemeral });
  }
  if (item === 'tag' && clan.show_tag) {
    return interaction.reply({ content: '✅ Тег уже куплен.', flags: MessageFlags.Ephemeral });
  }
  if (item === 'role' && clan.discord_role_id) {
    return interaction.reply({
      content: `✅ Роль клана уже есть: <@&${clan.discord_role_id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // До списания: бот должен уметь создать роль и выдать её
  if (item === 'role') {
    const me = interaction.guild.members.me
      || await interaction.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '❌ У бота нет права **Manage Roles** — роль создать нельзя. Деньги не списаны.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const highest = me.roles.highest;
    if (!highest || highest.position <= 0) {
      return interaction.reply({
        content: '❌ Роль бота слишком низко в иерархии — создать клановую роль нельзя. Деньги не списаны.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const spec = CLAN_SHOP[item];
  const pay = db.prepare(
    'UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?',
  ).run(spec.price, clan.clan_id, spec.price);
  if (pay.changes === 0) {
    return interaction.reply({
      content: `❌ В банке нужно **${spec.price} ⚡HLD**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (item === 'boost') {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE clans SET farm_boost_until = ? WHERE clan_id = ?').run(until, clan.clan_id);
    return interaction.reply({ content: `🚀 Буст фарма +20% до <t:${Math.floor(Date.parse(until) / 1000)}:F>.` });
  }
  if (item === 'tag') {
    db.prepare('UPDATE clans SET show_tag = 1 WHERE clan_id = ?').run(clan.clan_id);
    return interaction.reply({ content: '🏷 Тег клана будет виден в `/profile`.' });
  }

  try {
    const role = await interaction.guild.roles.create({
      name: `[${clan.tag}] ${clan.name}`.slice(0, 100),
      mentionable: false,
      reason: 'Клановый магазин',
    });
    db.prepare('UPDATE clans SET discord_role_id = ? WHERE clan_id = ?').run(role.id, clan.clan_id);
    const members = db.prepare('SELECT user_id FROM clan_members WHERE clan_id = ?').all(clan.clan_id);
    for (const m of members) {
      const member = await interaction.guild.members.fetch(m.user_id).catch(() => null);
      if (member) await member.roles.add(role).catch(() => {});
    }
    return interaction.reply({ content: `🎭 Роль клана создана: <@&${role.id}>.` });
  } catch (err) {
    db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(spec.price, clan.clan_id);
    return interaction.reply({
      content: `❌ Не удалось создать роль: ${err.message}. Деньги возвращены в банк.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleWars(interaction, db) {
  const guildId = interaction.guildId;
  const myClan = getMemberClan(db, interaction.user.id, guildId);
  if (!myClan) {
    return interaction.reply({ content: '❌ Ты не в клане.', flags: MessageFlags.Ephemeral });
  }

  const opponentTag = (interaction.options.getString('tag') || '').trim().toUpperCase();
  const stake = interaction.options.getInteger('ставка');
  const opponent = findClanByTag(db, opponentTag, guildId);
  if (!opponent) {
    return interaction.reply({ content: '❌ Клан-соперник не найден.', flags: MessageFlags.Ephemeral });
  }
  if (opponent.clan_id === myClan.clan_id) {
    return interaction.reply({ content: '❌ Нельзя воевать со своим кланом.', flags: MessageFlags.Ephemeral });
  }

  if (!stake) {
    const p1 = clanPower(db, myClan.clan_id, guildId);
    const p2 = clanPower(db, opponent.clan_id, guildId);
    const score1 = p1.levels + Math.floor(p1.xp / 1000);
    const score2 = p2.levels + Math.floor(p2.xp / 1000);
    let result = 'Ничья';
    if (score1 > score2) result = `Сильнее **[${myClan.tag}]**`;
    if (score2 > score1) result = `Сильнее **[${opponent.tag}]**`;

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚔️ Сравнение силы кланов')
      .addFields(
        {
          name: `[${myClan.tag}] ${myClan.name}`,
          value: `Участники: **${p1.members}**\nУровни: **${p1.levels}**\nXP: **${p1.xp}**\nОчки: **${score1}**`,
          inline: true,
        },
        {
          name: `[${opponent.tag}] ${opponent.name}`,
          value: `Участники: **${p2.members}**\nУровни: **${p2.levels}**\nXP: **${p2.xp}**\nОчки: **${score2}**`,
          inline: true,
        },
        { name: 'Итог', value: `${result}\nЧтобы воевать банком, укажи **ставку**.`, inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (myClan.owner_id !== interaction.user.id && myClan.member_role !== 'leader') {
    return interaction.reply({
      content: '❌ Ставку на войну может объявить только лидер клана.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cdKey = `clan_war_cd:${guildId}:${myClan.clan_id}`;
  if (getEphemeral(cdKey)) {
    return interaction.reply({
      content: '⏰ Твой клан недавно воевал. Подождите 6 часов.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (getEphemeral(`clan_war_cd:${guildId}:${opponent.clan_id}`)) {
    return interaction.reply({
      content: '⏰ Клан-соперник недавно воевал. Подождите 6 часов.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (myClan.bank_balance < stake || opponent.bank_balance < stake) {
    return interaction.reply({
      content: `❌ У обоих кланов должно быть минимум **${stake} ⚡HLD** в банке.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const pendingKey = `clan_war:${guildId}:${myClan.clan_id}:${opponent.clan_id}`;
  setEphemeral(pendingKey, {
    fromClanId: myClan.clan_id,
    toClanId: opponent.clan_id,
    stake,
    challengerId: interaction.user.id,
  }, WAR_TTL_MS);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_war_accept:${myClan.clan_id}:${opponent.clan_id}:${stake}`)
      .setLabel('Принять войну')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`clan_war_reject:${myClan.clan_id}:${opponent.clan_id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('⚔️ Вызов на войну')
    .setDescription(
      `**[${myClan.tag}]** вызывает **[${opponent.tag}]**.\n` +
      `Ставка из банка: **${stake} ⚡HLD** с каждой стороны.\n` +
      `Победитель забирает **${stake * 2} ⚡HLD**. Ничья — ставки возвращаются.\n\n` +
      `Принять может лидер <@${opponent.owner_id}>.`
    );

  await interaction.reply({
    content: `<@${opponent.owner_id}>`,
    embeds: [embed],
    components: [row],
  });
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
  if (!defender || defender.clan_id !== toClan.clan_id || (defender.owner_id !== interaction.user.id && defender.member_role !== 'leader')) {
    await interaction.reply({ content: '❌ Принять или отклонить может только лидер вызванного клана.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const pendingKey = `clan_war:${guildId}:${fromClanId}:${toClanId}`;
  const pending = getEphemeral(pendingKey);
  if (!pending) {
    await interaction.reply({ content: '❌ Вызов истек или уже обработан.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'clan_war_reject') {
    deleteEphemeral(pendingKey);
    await interaction.update({
      content: '❌ Война отклонена.',
      embeds: [],
      components: [],
    });
    return true;
  }

  const actualStake = pending.stake || stake;
  try {
    const outcome = resolveClanWar(db, fromClan, toClan, guildId, actualStake);
    deleteEphemeral(pendingKey);
    setEphemeral(`clan_war_cd:${guildId}:${fromClan.clan_id}`, { at: Date.now() }, WAR_COOLDOWN_MS);
    setEphemeral(`clan_war_cd:${guildId}:${toClan.clan_id}`, { at: Date.now() }, WAR_COOLDOWN_MS);

    const embed = new EmbedBuilder()
      .setColor(outcome.winnerTag ? 0x2ecc71 : 0x95a5a6)
      .setTitle('⚔️ Итог войны')
      .setDescription(outcome.text)
      .addFields(
        { name: `[${fromClan.tag}]`, value: `Очки: **${outcome.score1}**`, inline: true },
        { name: `[${toClan.tag}]`, value: `Очки: **${outcome.score2}**`, inline: true },
      );
    await interaction.update({ content: null, embeds: [embed], components: [] });
    if (outcome.winnerTag) {
      const winner = outcome.winnerTag === fromClan.tag ? fromClan : toClan;
      const members = db.prepare('SELECT user_id FROM clan_members WHERE clan_id = ?').all(winner.clan_id);
      for (const m of members) unlockAchievement(m.user_id, guildId, 'clan_war_win');
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

function resolveClanWar(db, clan1, clan2, guildId, stake) {
  const p1 = clanPower(db, clan1.clan_id, guildId);
  const p2 = clanPower(db, clan2.clan_id, guildId);
  const score1 = p1.levels + Math.floor(p1.xp / 1000);
  const score2 = p2.levels + Math.floor(p2.xp / 1000);

  let winnerTag = null;
  let text = `Ничья. Ставки **${stake} ⚡HLD** возвращены в банки.`;
  runInTransaction(() => {
    const a = db.prepare('UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?')
      .run(stake, clan1.clan_id, stake);
    const b = db.prepare('UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?')
      .run(stake, clan2.clan_id, stake);
    if (a.changes === 0 || b.changes === 0) {
      throw new Error('NO_BANK');
    }
    if (score1 === score2) {
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake, clan1.clan_id);
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake, clan2.clan_id);
    } else if (score1 > score2) {
      winnerTag = clan1.tag;
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake * 2, clan1.clan_id);
      text = `Побеждает **[${clan1.tag}]**. Банк получает **${stake * 2} ⚡HLD**.`;
    } else {
      winnerTag = clan2.tag;
      db.prepare('UPDATE clans SET bank_balance = bank_balance + ? WHERE clan_id = ?').run(stake * 2, clan2.clan_id);
      text = `Побеждает **[${clan2.tag}]**. Банк получает **${stake * 2} ⚡HLD**.`;
    }
  });
  return { winnerTag, text, score1, score2 };
}
