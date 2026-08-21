import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { brandEmbed, COLOR, fmtHld, fmtNum } from '../../utils/ui.js';
import { CL, CREATE_COST, CLAN_SHOP, MAX_CLAN_MEMBERS } from './ids.js';
import {
  getMemberClan,
  clanPower,
  clanScore,
  listMembers,
  canLead,
  canOfficerOrLead,
  roleLabel,
  boostLine,
  backCloseRow,
  navFooter,
} from './helpers.js';
import { getDb } from '../../database.js';

function panel(embeds, components) {
  return { content: null, embeds: Array.isArray(embeds) ? embeds : [embeds], components };
}

export function buildHomeView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);

  if (!clan) {
    const top = db.prepare(
      'SELECT tag, name, bank_balance FROM clans WHERE guild_id = ? ORDER BY bank_balance DESC LIMIT 5',
    ).all(interaction.guildId);

    const topLines = top.length
      ? top.map((c, i) => `${i + 1}. **[${c.tag}] ${c.name}** — ${fmtHld(c.bank_balance)}`).join('\n')
      : '_Пока нет кланов на сервере._';

    const embed = brandEmbed({
      color: COLOR.purple,
      title: 'Кланы Holidesu',
      description:
        `Ты не в клане.\n` +
        `Создание стоит **${fmtNum(CREATE_COST)} ⚡HLD**.\n` +
        `Приглашение принимается кнопками в сообщении.`,
      footer: navFooter(interaction, 'главная'),
    }).addFields({ name: 'Топ банков', value: topLines.slice(0, 1020) });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.create).setLabel('Создать клан').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CL.nav.top).setLabel('Топ кланов').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CL.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
    );
    return panel(embed, [row]);
  }

  const power = clanPower(db, clan.clan_id, interaction.guildId);
  const members = listMembers(db, clan.clan_id);
  const myRole = roleLabel(clan.member_role);
  const roleLine = clan.discord_role_id ? `<@&${clan.discord_role_id}>` : 'нет';
  const tagLine = clan.show_tag ? 'в профиле' : 'скрыт';

  const embed = brandEmbed({
    color: COLOR.accent,
    title: `[${clan.tag}] ${clan.name}`,
    description:
      `Твоя роль: **${myRole}**\n` +
      `${boostLine(clan)}\n` +
      `Тег: **${tagLine}** · Discord-роль: ${roleLine}`,
    footer: navFooter(interaction, 'главная'),
  }).addFields(
    { name: 'Банк', value: fmtHld(clan.bank_balance), inline: true },
    { name: 'Участники', value: `**${fmtNum(power.members)}** / ${MAX_CLAN_MEMBERS}`, inline: true },
    { name: 'Сила', value: `**${fmtNum(clanScore(power))}**`, inline: true },
    { name: 'Лидер', value: `<@${clan.owner_id}>`, inline: true },
    {
      name: 'Состав',
      value: members.slice(0, 10).map((m) => {
        const mark = m.role === 'leader' ? '👑' : m.role === 'officer' ? '⭐' : '•';
        return `${mark} <@${m.user_id}>`;
      }).join('\n') + (members.length > 10 ? `\n_…ещё ${members.length - 10}_` : ''),
      inline: false,
    },
  );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CL.nav.members).setLabel('Участники').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CL.nav.bank).setLabel('Банк').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CL.nav.shop).setLabel('Магазин').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CL.nav.war).setLabel('Война').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CL.nav.manage).setLabel('Управление').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CL.nav.top).setLabel('Топ').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CL.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
  );

  return panel(embed, [row1, row2]);
}

export function buildMembersView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return buildHomeView(interaction);

  const members = listMembers(db, clan.clan_id);
  const lead = canLead(clan, interaction.user.id);
  const officer = canOfficerOrLead(clan, interaction.user.id);

  const embed = brandEmbed({
    color: COLOR.aqua,
    title: `[${clan.tag}] участники`,
    description: members.map((m) => {
      const mark = m.role === 'leader' ? '👑' : m.role === 'officer' ? '⭐' : '•';
      return `${mark} <@${m.user_id}> — ${roleLabel(m.role)}`;
    }).join('\n').slice(0, 3900) || 'Пусто',
    footer: navFooter(interaction, 'участники'),
  });

  const rows = [];
  if (officer) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.invitePick).setLabel('Пригласить').setStyle(ButtonStyle.Success),
    ));
  }
  if (lead) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.promotePick).setLabel('Повысить').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CL.demotePick).setLabel('Понизить').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CL.kickPick).setLabel('Исключить').setStyle(ButtonStyle.Danger),
    ));
  }
  rows.push(backCloseRow(CL.home));
  return panel(embed, rows);
}

export function buildUserPickView(interaction, action, title, description) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(action)
    .setPlaceholder('Участник…')
    .setMinValues(1)
    .setMaxValues(1);

  const embed = brandEmbed({
    color: COLOR.wait,
    title,
    description,
    footer: navFooter(interaction, 'выбор'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(select),
    backCloseRow(CL.nav.members),
  ]);
}

export function buildBankView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return buildHomeView(interaction);

  const top = db.prepare(
    'SELECT tag, name, bank_balance FROM clans WHERE guild_id = ? ORDER BY bank_balance DESC LIMIT 8',
  ).all(interaction.guildId);

  const embed = brandEmbed({
    color: COLOR.gold,
    title: `[${clan.tag}] банк`,
    description: `Баланс клана: ${fmtHld(clan.bank_balance)}\nЛюбой участник может пополнить.`,
    footer: navFooter(interaction, 'банк'),
  }).addFields({
    name: 'Топ банков сервера',
    value: top.map((c, i) => `${i + 1}. **[${c.tag}]** — ${fmtHld(c.bank_balance)}`).join('\n') || '—',
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CL.deposit).setLabel('Пополнить').setStyle(ButtonStyle.Success),
  );
  return panel(embed, [row, backCloseRow(CL.home)]);
}

export function buildShopView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return buildHomeView(interaction);

  const lead = canLead(clan, interaction.user.id);
  const boost = boostLine(clan);
  const lines = Object.entries(CLAN_SHOP).map(([key, spec]) => {
    let status = '';
    if (key === 'tag') status = clan.show_tag ? ' · куплено' : '';
    if (key === 'role') status = clan.discord_role_id ? ` · <@&${clan.discord_role_id}>` : '';
    if (key === 'boost') status = ` · ${boost}`;
    return `${spec.emoji} **${spec.label}** — ${fmtHld(spec.price)}${status}`;
  }).join('\n\n');

  const embed = brandEmbed({
    color: COLOR.purple,
    title: `[${clan.tag}] магазин`,
    description:
      `Банк: ${fmtHld(clan.bank_balance)}\n` +
      (lead ? 'Покупает только лидер.' : 'Покупать может только лидер.') +
      `\n\n${lines}`,
    footer: navFooter(interaction, 'магазин'),
  });

  const buttons = Object.keys(CLAN_SHOP).map((key) =>
    new ButtonBuilder()
      .setCustomId(`${CL.shopPrefix}${key}`)
      .setLabel(CLAN_SHOP[key].label.slice(0, 80))
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!lead),
  );

  return panel(embed, [
    new ActionRowBuilder().addComponents(...buttons.slice(0, 3)),
    backCloseRow(CL.home),
  ]);
}

export function buildWarView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return buildHomeView(interaction);

  const others = db.prepare(
    'SELECT clan_id, tag, name, bank_balance FROM clans WHERE guild_id = ? AND clan_id != ? ORDER BY tag LIMIT 25',
  ).all(interaction.guildId, clan.clan_id);

  const embed = brandEmbed({
    color: COLOR.danger,
    title: `[${clan.tag}] война`,
    description:
      'Список — сравнение силы с другим кланом.\n' +
      '«Вызов со ставкой» — лидер вводит тег и ставку из банка.\n' +
      'Победитель забирает обе ставки. Кулдаун — 6 часов.',
    footer: navFooter(interaction, 'война'),
  });

  const rows = [];
  if (others.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(CL.warSelect)
      .setPlaceholder('Выбери клан-соперника…')
      .addOptions(
        others.map((c) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`[${c.tag}] ${c.name}`.slice(0, 100))
            .setDescription(`Банк ${c.bank_balance} HLD`.slice(0, 100))
            .setValue(String(c.clan_id)),
        ),
      );
    rows.push(new ActionRowBuilder().addComponents(select));
  } else {
    embed.addFields({ name: 'Соперники', value: 'Других кланов пока нет.' });
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.warCompare).setLabel('Сравнить (модалка)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CL.warChallenge)
        .setLabel('Вызов со ставкой')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canLead(clan, interaction.user.id)),
    ),
  );
  rows.push(backCloseRow(CL.home));
  return panel(embed, rows);
}

export function buildManageView(interaction) {
  const db = getDb();
  const clan = getMemberClan(db, interaction.user.id, interaction.guildId);
  if (!clan) return buildHomeView(interaction);

  const embed = brandEmbed({
    color: COLOR.dark,
    title: `[${clan.tag}] управление`,
    description:
      'Выход из клана. Если ты лидер и остались участники — лидерство перейдёт офицеру или старшему.\n' +
      'Если ты последний — клан распустится.',
    footer: navFooter(interaction, 'управление'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.leave).setLabel('Покинуть клан').setStyle(ButtonStyle.Danger),
    ),
    backCloseRow(CL.home),
  ]);
}

export function buildLeaveConfirmView(interaction) {
  const embed = brandEmbed({
    color: COLOR.danger,
    title: 'Точно выйти?',
    description: 'Это действие нельзя отменить одной кнопкой «Назад».',
    footer: navFooter(interaction, 'выход'),
  });
  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CL.leaveConfirm).setLabel('Да, выйти').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CL.nav.manage).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
    ),
  ]);
}

export function buildTopView(interaction) {
  const db = getDb();
  const clans = db.prepare(`
    SELECT c.clan_id, c.tag, c.name, c.bank_balance, c.owner_id,
      (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.clan_id) AS members
    FROM clans c
    WHERE c.guild_id = ?
    ORDER BY c.bank_balance DESC
    LIMIT 15
  `).all(interaction.guildId);

  const lines = clans.length
    ? clans.map((c, i) => {
      const power = clanPower(db, c.clan_id, interaction.guildId);
      return `**${i + 1}.** \`[${c.tag}]\` **${c.name}** — банк ${fmtHld(c.bank_balance)} · ${c.members} чел. · сила **${clanScore(power)}**`;
    }).join('\n')
    : 'Кланов пока нет.';

  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Топ кланов',
    description: lines.slice(0, 4000),
    footer: navFooter(interaction, 'топ'),
  });

  return panel(embed, [backCloseRow(CL.home)]);
}

export function buildCompareEmbed(interaction, myClan, opponent, p1, p2) {
  const s1 = clanScore(p1);
  const s2 = clanScore(p2);
  let result = 'Ничья по силе';
  if (s1 > s2) result = `Сильнее **[${myClan.tag}]**`;
  if (s2 > s1) result = `Сильнее **[${opponent.tag}]**`;

  return brandEmbed({
    color: COLOR.danger,
    title: 'Сравнение силы',
    description: result,
    footer: navFooter(interaction, 'война'),
  }).addFields(
    {
      name: `[${myClan.tag}] ${myClan.name}`,
      value: `Участники **${p1.members}**\nУровни **${fmtNum(p1.levels)}**\nXP **${fmtNum(p1.xp)}**\nОчки **${s1}**`,
      inline: true,
    },
    {
      name: `[${opponent.tag}] ${opponent.name}`,
      value: `Участники **${p2.members}**\nУровни **${fmtNum(p2.levels)}**\nXP **${fmtNum(p2.xp)}**\nОчки **${s2}**`,
      inline: true,
    },
  );
}
