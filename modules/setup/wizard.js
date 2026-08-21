/**
 * Опциональный мастер «с нуля» — короткие шаги в ephemeral-панели.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import { setEphemeral, getEphemeral, deleteEphemeral } from '../../database.js';
import { SETUP_CHANNEL_FIELDS, setGuildMeta, patchGuildChannels } from '../../utils/guildConfig.js';
import { SU, WIZARD_TTL_MS, wizardKey } from './ids.js';
import { buildWizardStepView } from './views.js';
import { ensureStatsVoiceChannels } from './actions.js';
import { resultView, denyView } from './helpers.js';
import { COLOR } from '../../utils/ui.js';

const WIZ_ORDER = [
  'roles',
  'log',
  'cmd',
  'mod',
  'welcome',
  'voice_panel',
  'trigger',
  'voice_category',
  'ticket_category',
  'season',
];

function channelTypesFor(field) {
  if (field.types === 'voice') return [ChannelType.GuildVoice];
  if (field.types === 'category') return [ChannelType.GuildCategory];
  return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
}

function loadState(guildId, userId) {
  return getEphemeral(wizardKey(guildId, userId));
}

function saveState(guildId, userId, state) {
  setEphemeral(wizardKey(guildId, userId), state, WIZARD_TTL_MS);
}

function clearState(guildId, userId) {
  deleteEphemeral(wizardKey(guildId, userId));
}

export async function startWizard(interaction) {
  const state = {
    stepIndex: 0,
    ownerId: interaction.user.id,
    adminRoles: [],
    channels: {},
  };
  saveState(interaction.guildId, interaction.user.id, state);
  return interaction.update(renderWizardStep(interaction, state));
}

function renderWizardStep(interaction, state) {
  const stepKey = WIZ_ORDER[state.stepIndex];
  const total = WIZ_ORDER.length;
  const step = state.stepIndex + 1;

  if (stepKey === 'roles') {
    return buildWizardStepView(interaction, {
      title: 'Мастер · админ-роли',
      description: 'Выбери роли, которые считаются администраторскими для бота.',
      step,
      total,
      components: [
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(SU.wizardRoles)
            .setPlaceholder('Админ-роли…')
            .setMinValues(1)
            .setMaxValues(25),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(SU.home).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (stepKey === 'season') {
    return buildWizardStepView(interaction, {
      title: 'Мастер · роль сезона',
      description: 'Роль за 1 место недельного сезона. Можно пропустить.',
      step,
      total,
      components: [
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(SU.wizardSeason)
            .setPlaceholder('Роль победителя…')
            .setMinValues(1)
            .setMaxValues(1),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SU.wizardSkipPrefix}season`)
            .setLabel('Пропустить и сохранить')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(SU.home).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  const field = SETUP_CHANNEL_FIELDS.find((f) => f.key === stepKey);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${SU.wizardChannelPrefix}${field.key}`)
        .setPlaceholder(`${field.label}…`)
        .setChannelTypes(...channelTypesFor(field))
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];
  if (!field.required) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${SU.wizardSkipPrefix}${field.key}`)
        .setLabel('Пропустить')
        .setStyle(ButtonStyle.Secondary),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(SU.home).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
  ));

  return buildWizardStepView(interaction, {
    title: `Мастер · ${field.emoji} ${field.label}`,
    description: field.required
      ? 'Обязательный канал.'
      : 'Можно пропустить и задать позже в разделе «Каналы».',
    step,
    total,
    components: rows,
  });
}

async function advance(interaction, state) {
  state.stepIndex += 1;
  if (state.stepIndex >= WIZ_ORDER.length) {
    return finalizeWizard(interaction, state);
  }
  saveState(interaction.guildId, interaction.user.id, state);
  return interaction.update(renderWizardStep(interaction, state));
}

async function finalizeWizard(interaction, state) {
  if (!state.adminRoles?.length || !state.channels.log || !state.channels.cmd || !state.channels.mod) {
    clearState(interaction.guildId, interaction.user.id);
    return interaction.update(denyView(
      interaction,
      'Не хватает обязательных полей (админ-роли, логи, команды, модерация).',
    ));
  }

  setGuildMeta(interaction.guildId, {
    ownerId: state.ownerId,
    adminRoles: state.adminRoles,
    note: state.note || '',
  });
  patchGuildChannels(interaction.guildId, state.channels);

  if (state.channels.voice_category) {
    await ensureStatsVoiceChannels(interaction, state.channels.voice_category).catch(() => {});
  }

  clearState(interaction.guildId, interaction.user.id);
  return interaction.update(resultView(interaction, {
    title: 'Мастер завершён',
    description: 'Конфиг сохранён. Дальше можно править поля в `/setup`.',
    color: COLOR.success,
  }));
}

export async function handleWizardInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('su:wiz:')) return false;

  const state = loadState(interaction.guildId, interaction.user.id);
  if (!state && id !== SU.wizardStart) {
    await interaction.update(denyView(interaction, 'Сессия мастера истекла. Открой `/setup` снова.'));
    return true;
  }

  if (id === SU.wizardStart) {
    await startWizard(interaction);
    return true;
  }

  if (id === SU.wizardRoles && interaction.isRoleSelectMenu?.()) {
    state.adminRoles = interaction.values;
    saveState(interaction.guildId, interaction.user.id, state);
    await advance(interaction, state);
    return true;
  }

  if (id === SU.wizardSeason && interaction.isRoleSelectMenu?.()) {
    state.channels.season_role = interaction.values[0];
    saveState(interaction.guildId, interaction.user.id, state);
    await finalizeWizard(interaction, state);
    return true;
  }

  if (id.startsWith(SU.wizardChannelPrefix) && interaction.isChannelSelectMenu?.()) {
    const key = id.slice(SU.wizardChannelPrefix.length);
    state.channels[key] = interaction.values[0];
    saveState(interaction.guildId, interaction.user.id, state);
    await advance(interaction, state);
    return true;
  }

  if (id.startsWith(SU.wizardSkipPrefix) && interaction.isButton?.()) {
    const key = id.slice(SU.wizardSkipPrefix.length);
    if (key === 'season') {
      await finalizeWizard(interaction, state);
      return true;
    }
    await advance(interaction, state);
    return true;
  }

  return false;
}
