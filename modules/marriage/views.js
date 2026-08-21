import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { brandEmbed, COLOR, fmtHld, fmtNum } from '../../utils/ui.js';
import { getOrCreateFamilyBank } from '../progress.js';
import { MR, VOICE_BONUS_PCT, PROPOSAL_TTL_MS } from './ids.js';
import {
  getMarriageStatus,
  listMarriageHistory,
  marriedAtUnix,
  daysTogether,
  getMarriagePrivacy,
  navFooter,
  backCloseRow,
  mark,
} from './helpers.js';

function panel(embeds, components) {
  return { content: null, embeds: Array.isArray(embeds) ? embeds : [embeds], components };
}

function privacyHint(userId) {
  const p = getMarriagePrivacy(userId);
  return (
    `${mark(p.allowProposals)} Предложения ${p.allowProposals ? 'открыты' : 'закрыты'}` +
    ` · ${mark(p.showInProfile)} В профиле ${p.showInProfile ? 'видно' : 'скрыто'}`
  );
}

function settingsButton() {
  return new ButtonBuilder()
    .setCustomId(MR.nav.settings)
    .setLabel('Настройки')
    .setStyle(ButtonStyle.Secondary);
}

export function buildHomeView(interaction) {
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);
  const privacy = privacyHint(interaction.user.id);

  if (status.married && status.partnerId) {
    const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);
    const unix = marriedAtUnix(status.record);
    const days = daysTogether(status.record);
    const weddingLine = unix
      ? `<t:${unix}:D> · вместе **${fmtNum(days)}** дн.`
      : 'дата неизвестна';

    const embed = brandEmbed({
      color: COLOR.pink,
      title: '💞 Твой брак',
      description:
        `Партнёр: <@${status.partnerId}>\n` +
        `Свадьба: ${weddingLine}\n` +
        `В одном войсе фарм **+${VOICE_BONUS_PCT}%**\n\n` +
        privacy,
      footer: navFooter(interaction, 'главная'),
    }).addFields(
      { name: 'Семейный счёт', value: fmtHld(bank.balance), inline: true },
      { name: 'Статус', value: 'В браке', inline: true },
    );

    return panel(embed, [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MR.nav.bank).setLabel('Семейный банк').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(MR.nav.history).setLabel('История').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MR.nav.divorce).setLabel('Развод').setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder().addComponents(
        settingsButton(),
        new ButtonBuilder().setCustomId(MR.close).setLabel('Закрыть').setStyle(ButtonStyle.Secondary),
      ),
    ]);
  }

  if (status.pending) {
    const { proposerId, targetId, expiresAt } = status.pending;
    const isTarget = targetId === interaction.user.id;
    const expireUnix = expiresAt ? Math.floor(Number(expiresAt) / 1000) : null;

    const embed = brandEmbed({
      color: COLOR.wait,
      title: '⏳ Активное предложение',
      description: (isTarget
        ? `<@${proposerId}> ждёт твоего ответа в сообщении с кнопками.`
        : `Ты предложил(а) пожениться с <@${targetId}>.\nЖдём ответа в канале.`) +
        `\n\n${privacy}`,
      footer: navFooter(interaction, 'ожидание'),
    });
    if (expireUnix) {
      embed.addFields({ name: 'Истекает', value: `<t:${expireUnix}:R>`, inline: true });
    }

    const rows = [];
    if (!isTarget) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MR.cancelProposal).setLabel('Отменить предложение').setStyle(ButtonStyle.Danger),
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MR.nav.history).setLabel('История').setStyle(ButtonStyle.Secondary),
      settingsButton(),
      new ButtonBuilder().setCustomId(MR.close).setLabel('Закрыть').setStyle(ButtonStyle.Secondary),
    ));
    return panel(embed, rows);
  }

  const embed = brandEmbed({
    color: COLOR.pink,
    title: '💍 Брак Holidesu',
    description:
      'Ты свободен(на).\n' +
      'Предложи брак — приглашение появится в чате с кнопками.\n' +
      `Ответ действует **${Math.round(PROPOSAL_TTL_MS / 60000)} мин**.\n` +
      `После свадьбы — общий банк и **+${VOICE_BONUS_PCT}%** фарма в одном войсе.\n\n` +
      privacy,
    footer: navFooter(interaction, 'главная'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MR.proposePick).setLabel('Сделать предложение').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MR.nav.history).setLabel('История').setStyle(ButtonStyle.Secondary),
      settingsButton(),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MR.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
    ),
  ]);
}

export function buildSettingsView(interaction) {
  const p = getMarriagePrivacy(interaction.user.id);
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);

  let context = 'Свободен(на)';
  if (status.married) context = `В браке с <@${status.partnerId}>`;
  else if (status.pending) context = 'Есть активное предложение';

  const embed = brandEmbed({
    color: COLOR.pink,
    title: 'Настройки брака',
    description:
      `Сейчас: **${context}**\n\n` +
      `${mark(p.allowProposals)} **Предложения** — ${p.allowProposals ? 'принимаешь' : 'закрыты'}\n` +
      `_Другие не смогут отправить тебе предложение, если закрыто._\n\n` +
      `${mark(p.showInProfile)} **В профиле** — ${p.showInProfile ? 'видно всем' : 'скрыто от других'}\n` +
      `_Ты всегда видишь свой брак. Скрытие — только для чужих зрителей \`/profile\`._`,
    footer: navFooter(interaction, 'настройки'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(MR.set.proposals)
        .setLabel(p.allowProposals ? 'Закрыть предложения' : 'Открыть предложения')
        .setStyle(p.allowProposals ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(MR.set.profile)
        .setLabel(p.showInProfile ? 'Скрыть в профиле' : 'Показать в профиле')
        .setStyle(p.showInProfile ? ButtonStyle.Secondary : ButtonStyle.Primary),
    ),
    backCloseRow(MR.home),
  ]);
}

export function buildProposePickView(interaction) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(MR.proposeUser)
    .setPlaceholder('Кому предложить…')
    .setMinValues(1)
    .setMaxValues(1);

  const embed = brandEmbed({
    color: COLOR.pink,
    title: 'Сделать предложение',
    description: 'Выбери человека на сервере. Нельзя предложить боту или себе.',
    footer: navFooter(interaction, 'предложение'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(select),
    backCloseRow(MR.home),
  ]);
}

export function buildBankView(interaction) {
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);
  if (!status.married || !status.partnerId) return buildHomeView(interaction);

  const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);
  const embed = brandEmbed({
    color: COLOR.gold,
    title: '💕 Семейный банк',
    description:
      `Партнёры: <@${interaction.user.id}> + <@${status.partnerId}>\n` +
      `Баланс: ${fmtHld(bank.balance)}\n` +
      'Любой из супругов может положить или снять.',
    footer: navFooter(interaction, 'банк'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MR.deposit).setLabel('Положить').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MR.withdraw).setLabel('Снять').setStyle(ButtonStyle.Primary),
    ),
    backCloseRow(MR.home),
  ]);
}

export function buildDivorceConfirmView(interaction) {
  const status = getMarriageStatus(interaction.user.id, interaction.guildId);
  if (!status.married) return buildHomeView(interaction);

  const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, status.partnerId);
  const embed = brandEmbed({
    color: COLOR.danger,
    title: 'Развод?',
    description:
      `Партнёр: <@${status.partnerId}>\n` +
      `Семейный счёт ${fmtHld(bank.balance)} будет разделён пополам.\n` +
      'Это нельзя отменить.',
    footer: navFooter(interaction, 'развод'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MR.divorceConfirm).setLabel('Да, развестись').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MR.home).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
    ),
  ]);
}

export function buildHistoryView(interaction) {
  const rows = listMarriageHistory(interaction.guildId, interaction.user.id);
  const lines = rows.length
    ? rows.map((r) => {
      const partner = r.user1_id === interaction.user.id ? r.user2_id : r.user1_id;
      const unix = marriedAtUnix(r);
      const start = unix ? `<t:${unix}:D>` : '?';
      if (r.status === 'married') {
        return `💞 <@${partner}> — с ${start} · **в браке**`;
      }
      const divRaw = r.divorced_at;
      const divTs = divRaw
        ? Date.parse(divRaw.includes('Z') || divRaw.includes('+') ? divRaw : `${divRaw}Z`)
        : NaN;
      const end = Number.isFinite(divTs) ? `<t:${Math.floor(divTs / 1000)}:D>` : '?';
      return `💔 <@${partner}> — ${start} → ${end}`;
    }).join('\n')
    : '_Пока нет записей о браках на этом сервере._';

  const embed = brandEmbed({
    color: COLOR.dark,
    title: 'История отношений',
    description: lines.slice(0, 3900),
    footer: navFooter(interaction, 'история'),
  });

  return panel(embed, [backCloseRow(MR.home)]);
}
