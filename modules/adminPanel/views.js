import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { getDb } from '../../database.js';
import { levelName } from '../../utils/permissions.js';
import { brandEmbed, COLOR, fmtNum } from '../../utils/ui.js';
import { DEFAULT_FEATURES, getGuildConfig } from '../../utils/guildConfig.js';
import { AP, userSelectId } from './ids.js';
import { backCloseRow, navFooter } from './helpers.js';

export function gatherServerStats(guildId) {
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE guild_id = ?').get(guildId)?.cnt || 0;
  const verifiedUsers = db.prepare(
    'SELECT COUNT(*) as cnt FROM users WHERE is_verified = 1 AND guild_id = ?',
  ).get(guildId)?.cnt || 0;
  const totalBalance = db.prepare(
    'SELECT SUM(balance) as total FROM users WHERE is_infinite_balance = 0 AND guild_id = ?',
  ).get(guildId)?.total || 0;
  const topLevel = db.prepare(
    'SELECT MAX(level) as max FROM users WHERE guild_id = ?',
  ).get(guildId)?.max || 1;
  const totalVoiceMinutes = db.prepare(
    'SELECT SUM(total_voice_minutes) as total FROM users WHERE guild_id = ?',
  ).get(guildId)?.total || 0;
  const totalMessages = db.prepare(
    'SELECT SUM(total_messages) as total FROM users WHERE guild_id = ?',
  ).get(guildId)?.total || 0;
  const activeRooms = db.prepare(
    'SELECT COUNT(*) as cnt FROM user_voice_channels',
  ).get()?.cnt || 0;
  const staffCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM bot_permissions WHERE level >= 1',
  ).get()?.cnt || 0;

  return {
    totalUsers,
    verifiedUsers,
    totalBalance,
    topLevel,
    totalVoiceMinutes,
    totalMessages,
    activeRooms,
    staffCount,
  };
}

export function buildHomeView(interaction, userLevel) {
  const stats = gatherServerStats(interaction.guildId);
  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Панель управления Holidesu',
    description:
      `Твой уровень: **${levelName(userLevel)}**\n` +
      'Выбери раздел. Все действия остаются в этом сообщении.',
    footer: navFooter(interaction, 'главная'),
    thumbnail: interaction.guild?.iconURL?.({ size: 128 }) || undefined,
  }).addFields(
    { name: 'Участники', value: `**${fmtNum(stats.totalUsers)}**`, inline: true },
    { name: 'Верифицированы', value: `**${fmtNum(stats.verifiedUsers)}**`, inline: true },
    { name: 'Персонал', value: `**${fmtNum(stats.staffCount)}**`, inline: true },
    { name: 'Сумма ⚡HLD', value: `**${fmtNum(stats.totalBalance)}**`, inline: true },
    { name: 'Макс. уровень', value: `**${stats.topLevel}**`, inline: true },
    { name: 'Комнаты', value: `**${fmtNum(stats.activeRooms)}**`, inline: true },
    { name: 'Голос (мин)', value: `**${fmtNum(stats.totalVoiceMinutes)}**`, inline: true },
    { name: 'Сообщения', value: `**${fmtNum(stats.totalMessages)}**`, inline: true },
  );

  const navButtons = [];
  if (userLevel >= 2) {
    navButtons.push(
      new ButtonBuilder().setCustomId(AP.nav.users).setLabel('Пользователи').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(AP.nav.econ).setLabel('Экономика').setStyle(ButtonStyle.Success),
    );
  }
  if (userLevel >= 1) {
    navButtons.push(
      new ButtonBuilder().setCustomId(AP.nav.mod).setLabel('Модерация').setStyle(ButtonStyle.Danger),
    );
  }
  if (userLevel >= 2) {
    navButtons.push(
      new ButtonBuilder().setCustomId(AP.nav.server).setLabel('Сервер').setStyle(ButtonStyle.Secondary),
    );
  }
  if (userLevel >= 1) {
    navButtons.push(
      new ButtonBuilder().setCustomId(AP.nav.stats).setLabel('Аналитика').setStyle(ButtonStyle.Secondary),
    );
  }

  const rows = [];
  if (navButtons.length) {
    // Discord: max 5 buttons per row
    for (let i = 0; i < navButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(...navButtons.slice(i, i + 5)));
    }
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(AP.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
    ),
  );

  return { embeds: [embed], components: rows };
}

export function buildUsersSection(interaction) {
  const embed = brandEmbed({
    color: COLOR.accent,
    title: 'Пользователи',
    description: 'Верификация, права персонала и карточка участника. Сначала выбери человека.',
    footer: navFooter(interaction, 'пользователи'),
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.verifyGive).setLabel('Выдать верификацию').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(AP.pick.verifyTake).setLabel('Снять верификацию').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(AP.pick.lookup).setLabel('Карточка').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.grant).setLabel('Выдать права').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ap:revoke_open').setLabel('Снять права').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(AP.pick.deleteUser).setLabel('Удалить данные').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, backCloseRow(AP.home)] };
}

export function buildEconSection(interaction) {
  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Экономика',
    description: 'Начисление и списание ⚡HLD / XP. Выбери действие — затем участника.',
    footer: navFooter(interaction, 'экономика'),
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.addBalance).setLabel('+ Баланс').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(AP.pick.removeBalance).setLabel('− Баланс').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(AP.pick.setInfinite).setLabel('∞ Баланс').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(AP.pick.clearInfinite).setLabel('Снять ∞').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.addXp).setLabel('+ XP').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(AP.pick.removeXp).setLabel('− XP').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, backCloseRow(AP.home)] };
}

export function buildModSection(interaction) {
  const embed = brandEmbed({
    color: COLOR.danger,
    title: 'Модерация',
    description: 'Warn · Mute · Kick · Ban. Выбери действие — затем участника и причину.',
    footer: navFooter(interaction, 'модерация'),
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.warn).setLabel('Warn').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(AP.pick.mute).setLabel('Mute').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(AP.pick.kick).setLabel('Kick').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(AP.pick.ban).setLabel('Ban').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.pick.warns).setLabel('Список warns').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, backCloseRow(AP.home)] };
}

export function buildServerSection(interaction) {
  const features = getGuildConfig(interaction.guildId).features || {};
  const lines = Object.keys(DEFAULT_FEATURES).map((key) => {
    const on = features[key] !== false;
    return `${on ? '●' : '○'} **${key}**`;
  });

  const embed = brandEmbed({
    color: COLOR.purple,
    title: 'Сервер',
    description: 'Конфиг сервера и модули. Открой `/setup` или нажми кнопку ниже. Фичу можно переключить в списке.',
    footer: navFooter(interaction, 'сервер'),
  }).addFields({
    name: 'Модули',
    value: lines.join('\n').slice(0, 1020),
  });

  const featureSelect = new StringSelectMenuBuilder()
    .setCustomId(AP.featureSelect)
    .setPlaceholder('Включить / выключить модуль…')
    .addOptions(
      Object.keys(DEFAULT_FEATURES).slice(0, 25).map((key) => {
        const on = features[key] !== false;
        return new StringSelectMenuOptionBuilder()
          .setLabel(key)
          .setDescription(on ? 'Сейчас включено — нажми чтобы выключить' : 'Сейчас выключено — нажми чтобы включить')
          .setValue(key);
      }),
    );

  const row1 = new ActionRowBuilder().addComponents(featureSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.setup).setLabel('Открыть /setup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(AP.logs).setLabel('Открыть /логи').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, backCloseRow(AP.home)] };
}

export function buildStatsSection(interaction) {
  const embed = brandEmbed({
    color: COLOR.aqua,
    title: 'Аналитика',
    description: 'Сводка сервера, топ активности и последние наказания.',
    footer: navFooter(interaction, 'аналитика'),
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AP.statsDetail).setLabel('Сводка').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(AP.statsTop).setLabel('Топ активности').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(AP.statsPunish).setLabel('Наказания').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row, backCloseRow(AP.home)] };
}

const PICK_LABELS = {
  verify_give: 'Выбери, кому выдать верификацию',
  verify_take: 'Выбери, у кого снять верификацию',
  grant: 'Выбери, кому выдать права',
  delete: 'Выбери пользователя для удаления данных',
  lookup: 'Выбери пользователя для карточки',
  add_balance: 'Кому начислить ⚡HLD',
  remove_balance: 'У кого списать ⚡HLD',
  set_infinite: 'Кому выдать ∞ баланс',
  clear_infinite: 'У кого снять ∞ баланс',
  add_xp: 'Кому начислить XP',
  remove_xp: 'У кого снять XP',
  warn: 'Кому выдать предупреждение',
  mute: 'Кого замутить',
  kick: 'Кого кикнуть',
  ban: 'Кого забанить',
  warns: 'Чьи предупреждения показать',
};

const PICK_BACK = {
  verify_give: AP.nav.users,
  verify_take: AP.nav.users,
  grant: AP.nav.users,
  delete: AP.nav.users,
  lookup: AP.nav.users,
  add_balance: AP.nav.econ,
  remove_balance: AP.nav.econ,
  set_infinite: AP.nav.econ,
  clear_infinite: AP.nav.econ,
  add_xp: AP.nav.econ,
  remove_xp: AP.nav.econ,
  warn: AP.nav.mod,
  mute: AP.nav.mod,
  kick: AP.nav.mod,
  ban: AP.nav.mod,
  warns: AP.nav.mod,
};

export function buildUserPickView(interaction, action) {
  const embed = brandEmbed({
    color: COLOR.wait,
    title: 'Выбор участника',
    description: PICK_LABELS[action] || 'Выбери участника',
    footer: navFooter(interaction, 'выбор'),
  });

  const select = new UserSelectMenuBuilder()
    .setCustomId(userSelectId(action))
    .setPlaceholder('Участник…')
    .setMinValues(1)
    .setMaxValues(1);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      backCloseRow(PICK_BACK[action] || AP.home),
    ],
  };
}

export function buildGrantLevelView(interaction, targetId) {
  const embed = brandEmbed({
    color: COLOR.success,
    title: 'Уровень прав',
    description: `Кому: <@${targetId}>\nВыбери уровень (Owner выдать нельзя).`,
    footer: navFooter(interaction, 'права'),
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${AP.grantLevelPrefix}${targetId}`)
    .setPlaceholder('Уровень…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Moderator').setValue('1').setDescription('Модерация'),
      new StringSelectMenuOptionBuilder().setLabel('Admin').setValue('2').setDescription('Админ (только Owner)'),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      backCloseRow(AP.nav.users),
    ],
  };
}

export function buildRevokeView(interaction, permUsers) {
  const embed = brandEmbed({
    color: COLOR.danger,
    title: 'Снять права',
    description: 'Выбери сотрудника. Нельзя снять права у себя или у равного/выше.',
    footer: navFooter(interaction, 'права'),
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(AP.revokeSelect)
    .setPlaceholder('Сотрудник…');

  for (const pu of permUsers.slice(0, 25)) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${pu.label} (${levelName(pu.level)})`.slice(0, 100))
        .setValue(pu.user_id)
        .setDescription(`ID ${pu.user_id}`.slice(0, 100)),
    );
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      backCloseRow(AP.nav.users),
    ],
  };
}

export function buildStatsDetailView(interaction) {
  const s = gatherServerStats(interaction.guildId);
  const embed = brandEmbed({
    color: COLOR.aqua,
    title: 'Сводка сервера',
    footer: navFooter(interaction, 'сводка'),
  }).addFields(
    { name: 'Участники в БД', value: fmtNum(s.totalUsers), inline: true },
    { name: 'Верифицированы', value: fmtNum(s.verifiedUsers), inline: true },
    { name: 'Персонал', value: fmtNum(s.staffCount), inline: true },
    { name: 'Сумма ⚡HLD', value: fmtNum(s.totalBalance), inline: true },
    { name: 'Макс. уровень', value: String(s.topLevel), inline: true },
    { name: 'Активные комнаты', value: fmtNum(s.activeRooms), inline: true },
    { name: 'Минут в голосе', value: fmtNum(s.totalVoiceMinutes), inline: true },
    { name: 'Сообщений', value: fmtNum(s.totalMessages), inline: true },
  );
  return { embeds: [embed], components: [backCloseRow(AP.nav.stats)] };
}

export function buildTopView(interaction) {
  const topUsers = getDb()
    .prepare(
      `SELECT user_id, balance, level, total_xp, total_voice_minutes,
              ROUND((balance * 0.3) + (total_xp * 0.7) + (total_voice_minutes * 0.1), 2) as score
       FROM users
       WHERE is_infinite_balance = 0 AND guild_id = ?
       ORDER BY score DESC
       LIMIT 10`,
    )
    .all(interaction.guildId);

  const lines = topUsers.length
    ? topUsers.map(
      (u, i) =>
        `**${i + 1}.** <@${u.user_id}> — **${u.score}** · ${fmtNum(u.balance)} ⚡HLD · Lv.${u.level}`,
    ).join('\n')
    : 'Нет данных.';

  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Топ активности',
    description: lines,
    footer: navFooter(interaction, 'топ'),
  });
  return { embeds: [embed], components: [backCloseRow(AP.nav.stats)] };
}

export function buildPunishmentsView(interaction) {
  const rows = getDb().prepare(`
    SELECT id, user_id, moderator_id, action, reason, created_at
    FROM punishments
    WHERE guild_id = ? OR guild_id = ''
    ORDER BY created_at DESC
    LIMIT 10
  `).all(interaction.guildId);

  const embed = brandEmbed({
    color: COLOR.danger,
    title: 'Последние наказания',
    description: rows.length ? undefined : 'Пока пусто.',
    footer: navFooter(interaction, 'наказания'),
  });

  for (const p of rows) {
    embed.addFields({
      name: `#${p.id} · ${p.action} · ${p.created_at || '—'}`,
      value: `<@${p.user_id}> · мод <@${p.moderator_id}>\n${(p.reason || 'без причины').slice(0, 200)}`,
      inline: false,
    });
  }

  return { embeds: [embed], components: [backCloseRow(AP.nav.stats)] };
}

export function buildLookupView(interaction, targetId, userRow) {
  const embed = brandEmbed({
    color: COLOR.accent,
    title: 'Карточка пользователя',
    description: `<@${targetId}>`,
    footer: navFooter(interaction, 'карточка'),
  }).addFields(
    { name: 'Баланс', value: `${fmtNum(userRow?.balance || 0)} ⚡HLD`, inline: true },
    { name: 'Уровень', value: String(userRow?.level || 1), inline: true },
    { name: 'XP', value: fmtNum(userRow?.xp || userRow?.total_xp || 0), inline: true },
    { name: 'Верификация', value: userRow?.is_verified ? 'Да' : 'Нет', inline: true },
    { name: '∞ баланс', value: userRow?.is_infinite_balance ? 'Да' : 'Нет', inline: true },
    { name: 'Голос (мин)', value: fmtNum(userRow?.total_voice_minutes || 0), inline: true },
    { name: 'Сообщения', value: fmtNum(userRow?.total_messages || 0), inline: true },
  );
  return { embeds: [embed], components: [backCloseRow(AP.nav.users)] };
}

/** @deprecated alias for slash command compatibility */
export function buildAdminPanel(userLevel, interaction) {
  if (interaction) return buildHomeView(interaction, userLevel);
  // fallback without interaction context
  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Панель управления Holidesu',
    description: `Твой уровень: **${levelName(userLevel)}**`,
    footer: 'Holidesu · панель',
  });
  return { embed, components: [] };
}
