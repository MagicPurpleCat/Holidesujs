import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import { brandEmbed, COLOR } from '../../utils/ui.js';
import {
  getGuildConfig,
  getSetupChecklist,
  SETUP_CHANNEL_FIELDS,
} from '../../utils/guildConfig.js';
import { SU } from './ids.js';
import { navFooter, backCloseRow, mark } from './helpers.js';

function panel(embeds, components) {
  return { content: null, embeds: Array.isArray(embeds) ? embeds : [embeds], components };
}

function channelTypesFor(field) {
  if (field.types === 'voice') return [ChannelType.GuildVoice];
  if (field.types === 'category') return [ChannelType.GuildCategory];
  return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
}

export function buildHomeView(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const checklist = getSetupChecklist(interaction.guildId);
  const lines = checklist.items.map((i) => `${mark(i.ok)} **${i.label}** — ${i.value}`).join('\n');

  const embed = brandEmbed({
    color: checklist.ready ? COLOR.success : COLOR.wait,
    title: '🛠 Настройка сервера',
    description:
      (checklist.ready
        ? 'Обязательные поля заполнены. Можно править по разделам.\n'
        : `Готовность: **${checklist.requiredOk}/${checklist.requiredTotal}** обязательных.\n`) +
      `Владелец: ${cfg.ownerId ? `<@${cfg.ownerId}>` : '—'}` +
      (cfg.note ? `\nЗаметка: ${cfg.note}` : ''),
    footer: navFooter(interaction, 'главная'),
  }).addFields({ name: 'Статус', value: lines.slice(0, 1020) });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SU.nav.channels).setLabel('Каналы').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(SU.nav.roles).setLabel('Роли').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(SU.nav.owner).setLabel('Владелец').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SU.wizardStart).setLabel('Мастер с нуля').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(SU.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
    ),
  ]);
}

export function buildChannelsView(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const map = {
    log: cfg.logChannelId,
    cmd: cfg.cmdChannelId,
    mod: cfg.modChannelId,
    welcome: cfg.welcomeChannelId,
    voice_panel: cfg.voicePanelChannelId,
    trigger: cfg.triggerChannelId,
    voice_category: cfg.voiceCategoryId,
    ticket_category: cfg.ticketCategoryId,
  };

  const lines = SETUP_CHANNEL_FIELDS.map((f) => {
    const id = map[f.key];
    return `${mark(Boolean(id))} ${f.emoji} **${f.label}**${f.required ? ' *' : ''} — ${id ? `<#${id}>` : 'не задан'}`;
  }).join('\n');

  const embed = brandEmbed({
    color: COLOR.aqua,
    title: 'Каналы',
    description: `${lines}\n\n_* обязательные_`,
    footer: navFooter(interaction, 'каналы'),
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(SU.channelPick)
    .setPlaceholder('Какой канал изменить…')
    .addOptions(
      SETUP_CHANNEL_FIELDS.map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${f.label}${f.required ? ' (обяз.)' : ''}`.slice(0, 100))
          .setDescription((map[f.key] ? `Сейчас: #${map[f.key]}` : 'Не задан').slice(0, 100))
          .setValue(f.key)
          .setEmoji(f.emoji),
      ),
    );

  return panel(embed, [
    new ActionRowBuilder().addComponents(select),
    backCloseRow(SU.home),
  ]);
}

export function buildChannelSetView(interaction, fieldKey) {
  const field = SETUP_CHANNEL_FIELDS.find((f) => f.key === fieldKey);
  if (!field) return buildChannelsView(interaction);

  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`${SU.channelSetPrefix}${field.key}`)
    .setPlaceholder(`${field.label}…`)
    .setChannelTypes(...channelTypesFor(field))
    .setMinValues(1)
    .setMaxValues(1);

  const rows = [new ActionRowBuilder().addComponents(select)];
  if (!field.required) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${SU.channelClearPrefix}${field.key}`)
        .setLabel('Очистить')
        .setStyle(ButtonStyle.Secondary),
    ));
  }
  rows.push(backCloseRow(SU.nav.channels));

  const embed = brandEmbed({
    color: COLOR.wait,
    title: `${field.emoji} ${field.label}`,
    description: field.required
      ? 'Выбери канал (обязательное поле).'
      : 'Выбери канал или очисти значение.',
    footer: navFooter(interaction, 'каналы'),
  });

  return panel(embed, rows);
}

export function buildRolesView(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const adminMentions = (cfg.adminRoles || [])
    .map((id) => `<@&${id}>`)
    .join(', ') || '—';

  const embed = brandEmbed({
    color: COLOR.purple,
    title: 'Роли',
    description:
      `Админ-роли: ${adminMentions}\n` +
      `Верификация: ${cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : '—'}\n` +
      `Победитель сезона: ${cfg.seasonRoleId ? `<@&${cfg.seasonRoleId}>` : '—'}`,
    footer: navFooter(interaction, 'роли'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(SU.rolesAdmin)
        .setPlaceholder('Админ-роли (несколько)…')
        .setMinValues(1)
        .setMaxValues(25),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(SU.rolesVerified)
        .setPlaceholder('Роль верификации…')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(SU.rolesSeason)
        .setPlaceholder('Роль победителя сезона…')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    backCloseRow(SU.home),
  ]);
}

export function buildOwnerView(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const embed = brandEmbed({
    color: COLOR.gold,
    title: 'Владелец и заметка',
    description:
      `Владелец: ${cfg.ownerId ? `<@${cfg.ownerId}>` : '—'}\n` +
      `Заметка: ${cfg.note || '—'}`,
    footer: navFooter(interaction, 'владелец'),
  });

  return panel(embed, [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(SU.ownerUser)
        .setPlaceholder('Выбрать владельца…')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SU.ownerPick).setLabel('Владелец + заметка (модалка)').setStyle(ButtonStyle.Primary),
    ),
    backCloseRow(SU.home),
  ]);
}

export function buildWizardStepView(interaction, {
  title,
  description,
  components,
  step,
  total,
}) {
  const embed = brandEmbed({
    color: COLOR.accent,
    title,
    description,
    footer: navFooter(interaction, `мастер ${step}/${total}`),
  });
  return panel(embed, components);
}
