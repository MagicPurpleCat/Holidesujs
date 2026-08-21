import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import { brandEmbed, COLOR } from '../../utils/ui.js';
import {
  getLogConfig,
  getLogChecklist,
  levelLabel,
  LOG_LEVELS,
} from '../logger.js';
import { LG } from './ids.js';
import { navFooter, backCloseRow, mark } from './helpers.js';

function panel(embeds, components) {
  return { content: null, embeds: Array.isArray(embeds) ? embeds : [embeds], components };
}

export function buildHomeView(interaction) {
  const checklist = getLogChecklist(interaction.guildId);
  const cfg = getLogConfig(interaction.guildId);
  const lines = checklist.items.map((i) => `${mark(i.ok)} **${i.label}** — ${i.value}`).join('\n');

  const embed = brandEmbed({
    color: checklist.ready ? COLOR.success : COLOR.wait,
    title: '📜 Логи сервера',
    description: checklist.ready
      ? `Активны · уровень **${levelLabel(checklist.level)}**\n` +
        'События: сообщения, войсы, участники, каналы/роли, модерация, ошибки.'
      : 'Логи ещё не настроены или выключены.\nНажми **Быстрый setup** — создадутся 3 канала и роли.',
    footer: navFooter(interaction, 'главная'),
  }).addFields({ name: 'Статус', value: (lines || 'Нет данных').slice(0, 1020) });

  if (cfg) {
    embed.addFields({
      name: 'Куда пишутся события',
      value:
        '**все** → #логи-все\n' +
        '**важные** → #логи-все + #логи-важные\n' +
        '**модерация** → все три канала',
      inline: false,
    });
  }

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(LG.quickSetup).setLabel('Быстрый setup').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(LG.nav.level).setLabel('Уровень').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(LG.nav.channels).setLabel('Каналы').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(LG.nav.pings).setLabel('Пинги').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(LG.disable).setLabel('Выключить').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(LG.close).setLabel('Закрыть').setStyle(ButtonStyle.Secondary),
    ),
  ]);
}

export function buildLevelView(interaction) {
  const cfg = getLogConfig(interaction.guildId);
  const current = cfg?.level || 'off';

  const embed = brandEmbed({
    color: COLOR.purple,
    title: 'Уровень логирования',
    description:
      `Сейчас: **${levelLabel(current)}**\n\n` +
      '• **Все** — сообщения, войсы, ники, роли, каналы + важное + модерация\n' +
      '• **Важные** — входы/выходы и модерация\n' +
      '• **Модерация** — только баны, кики, аудит\n' +
      '• **Выкл** — ничего не пишется',
    footer: navFooter(interaction, 'уровень'),
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(LG.levelSelect)
    .setPlaceholder('Выбери уровень…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Все события').setValue(LOG_LEVELS.all).setDescription('Максимум деталей'),
      new StringSelectMenuOptionBuilder().setLabel('Важные').setValue(LOG_LEVELS.important).setDescription('Входы и модерация'),
      new StringSelectMenuOptionBuilder().setLabel('Модерация').setValue(LOG_LEVELS.moderation).setDescription('Только аудит'),
      new StringSelectMenuOptionBuilder().setLabel('Выключить').setValue(LOG_LEVELS.off).setDescription('Полный стоп'),
    );

  return panel(embed, [
    new ActionRowBuilder().addComponents(select),
    backCloseRow(LG.home),
  ]);
}

export function buildChannelsView(interaction) {
  const cfg = getLogConfig(interaction.guildId) || {};

  const embed = brandEmbed({
    color: COLOR.aqua,
    title: 'Каналы логов',
    description:
      `${mark(Boolean(cfg.channel_all))} Все: ${cfg.channel_all ? `<#${cfg.channel_all}>` : '—'}\n` +
      `${mark(Boolean(cfg.channel_important))} Важные: ${cfg.channel_important ? `<#${cfg.channel_important}>` : '—'}\n` +
      `${mark(Boolean(cfg.channel_moderation))} Модерация: ${cfg.channel_moderation ? `<#${cfg.channel_moderation}>` : '—'}\n` +
      `${mark(Boolean(cfg.channel_id))} Fallback: ${cfg.channel_id ? `<#${cfg.channel_id}>` : '—'}\n\n` +
      '_Fallback используется, если tier-каналы не заданы. Синхронизируется с `/setup` → канал логов._',
    footer: navFooter(interaction, 'каналы'),
  });

  const mk = (customId, placeholder) =>
    new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);

  return panel(embed, [
    new ActionRowBuilder().addComponents(mk(LG.channelAll, 'Канал «все»…')),
    new ActionRowBuilder().addComponents(mk(LG.channelImportant, 'Канал «важные»…')),
    new ActionRowBuilder().addComponents(mk(LG.channelModeration, 'Канал «модерация»…')),
    new ActionRowBuilder().addComponents(mk(LG.channelFallback, 'Общий / fallback…')),
    backCloseRow(LG.home),
  ]);
}

export function buildPingsView(interaction) {
  const cfg = getLogConfig(interaction.guildId) || {};
  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Пинги в логах',
    description:
      `Роль «все»: ${cfg.ping_role_all ? `<@&${cfg.ping_role_all}>` : '—'}\n` +
      `Роль «важные»: ${cfg.ping_role_important ? `<@&${cfg.ping_role_important}>` : '—'}\n` +
      `Роль «модерация»: ${cfg.ping_role_moderation ? `<@&${cfg.ping_role_moderation}>` : '—'}\n\n` +
      `Пинг цели: **${cfg.ping_target ? 'вкл' : 'выкл'}**\n` +
      `Пинг модератора: **${cfg.ping_actor ? 'вкл' : 'выкл'}**\n\n` +
      '_Роли пинга создаются в «Быстрый setup». По умолчанию пинги людей выключены._',
    footer: navFooter(interaction, 'пинги'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(LG.togglePingTarget)
        .setLabel(cfg.ping_target ? 'Выкл. пинг цели' : 'Вкл. пинг цели')
        .setStyle(cfg.ping_target ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(LG.togglePingActor)
        .setLabel(cfg.ping_actor ? 'Выкл. пинг модератора' : 'Вкл. пинг модератора')
        .setStyle(cfg.ping_actor ? ButtonStyle.Secondary : ButtonStyle.Success),
    ),
    backCloseRow(LG.home),
  ]);
}
