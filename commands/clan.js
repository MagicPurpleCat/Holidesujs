import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, ensureUser, removeCoins, runInTransaction, setEphemeral, getEphemeral, deleteEphemeral } from '../database.js';

const CREATE_COST = 1000;
const INVITE_TTL_MS = 10 * 60 * 1000;

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

function clanPower(db, clanId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS members,
      COALESCE(SUM(u.level), 0) AS levels,
      COALESCE(SUM(u.total_xp), 0) AS xp
    FROM clan_members m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.clan_id = ?
  `).get(clanId);
  return row || { members: 0, levels: 0, xp: 0 };
}

export default {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('👥 Кланы: создание, банк, инвайты')
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
        .setName('wars')
        .setDescription('Сравнить силу двух кланов')
        .addStringOption((opt) =>
          opt.setName('tag1').setDescription('Тег первого клана').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('tag2').setDescription('Тег второго клана').setRequired(true)
        )
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      const db = getDb();
      ensureUser(interaction.user.id);

      if (sub === 'create') return handleCreate(interaction, db);
      if (sub === 'info') return handleInfo(interaction, db);
      if (sub === 'invite') return handleInvite(interaction, db);
      if (sub === 'join') return handleJoin(interaction, db);
      if (sub === 'leave') return handleLeave(interaction, db);
      if (sub === 'deposit') return handleDeposit(interaction, db);
      if (sub === 'bank') return handleBank(interaction, db);
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
      if (!removeCoins(interaction.user.id, CREATE_COST)) {
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
    .setColor(0x2ecc71)
    .setTitle('👥 Клан создан')
    .setDescription(`**[${tag}] ${name}**\nЛидер: <@${interaction.user.id}>\nСписано: **${CREATE_COST} ⚡HLD**`);

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
  const power = clanPower(db, clan.clan_id);
  const list = members
    .slice(0, 15)
    .map((m) => {
      const role = m.role === 'leader' ? '👑' : m.role === 'officer' ? '⭐' : '•';
      return `${role} <@${m.user_id}>`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`[${clan.tag}] ${clan.name}`)
    .addFields(
      { name: '👑 Лидер', value: `<@${clan.owner_id}>`, inline: true },
      { name: '💰 Банк', value: `**${clan.bank_balance} ⚡HLD**`, inline: true },
      { name: '👥 Состав', value: `**${power.members}** чел.`, inline: true },
      { name: '⚔️ Сила', value: `Уровни: **${power.levels}**\nXP: **${power.xp}**`, inline: true },
      { name: '📅 Создан', value: clan.created_at || '—', inline: true },
      { name: 'Участники', value: list || '—', inline: false },
    );

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

  await interaction.reply({
    content: `✅ Ты вступил в **[${clan.tag}] ${clan.name}**.`,
  });
}

async function handleLeave(interaction, db) {
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) {
    return interaction.reply({ content: '❌ Ты не в клане.', flags: MessageFlags.Ephemeral });
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
      if (!removeCoins(interaction.user.id, amount)) {
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
    ? top.map((c, i) => `${i + 1}. **[${c.tag}] ${c.name}** — ${c.bank_balance} ⚡HLD`).join('\n')
    : 'Пока нет кланов.';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏦 Клановые банки')
    .setDescription(lines);

  if (mine) {
    embed.addFields({
      name: 'Твой клан',
      value: `**[${mine.tag}]** — **${mine.bank_balance} ⚡HLD**`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleWars(interaction, db) {
  const clan1 = findClanByTag(db, interaction.options.getString('tag1').trim().toUpperCase(), interaction.guildId);
  const clan2 = findClanByTag(db, interaction.options.getString('tag2').trim().toUpperCase(), interaction.guildId);
  if (!clan1 || !clan2) {
    return interaction.reply({ content: '❌ Один из кланов не найден.', flags: MessageFlags.Ephemeral });
  }
  if (clan1.clan_id === clan2.clan_id) {
    return interaction.reply({ content: '❌ Укажи два разных клана.', flags: MessageFlags.Ephemeral });
  }

  const p1 = clanPower(db, clan1.clan_id);
  const p2 = clanPower(db, clan2.clan_id);
  const score1 = p1.levels + Math.floor(p1.xp / 1000);
  const score2 = p2.levels + Math.floor(p2.xp / 1000);
  let result = 'Ничья';
  if (score1 > score2) result = `Побеждает **[${clan1.tag}]**`;
  if (score2 > score1) result = `Побеждает **[${clan2.tag}]**`;

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⚔️ Клановая война (сравнение силы)')
    .addFields(
      {
        name: `[${clan1.tag}] ${clan1.name}`,
        value: `Участники: **${p1.members}**\nУровни: **${p1.levels}**\nXP: **${p1.xp}**\nОчки: **${score1}**`,
        inline: true,
      },
      {
        name: `[${clan2.tag}] ${clan2.name}`,
        value: `Участники: **${p2.members}**\nУровни: **${p2.levels}**\nXP: **${p2.xp}**\nОчки: **${score2}**`,
        inline: true,
      },
      { name: 'Итог', value: result, inline: false },
    );

  await interaction.reply({ embeds: [embed] });
}
