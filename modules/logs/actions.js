import { MessageFlags } from 'discord.js';
import {
  setupLogChannels,
  setLogLevel,
  setLogChannel,
  patchLogConfig,
  disableLogging,
  levelLabel,
  getLogConfig,
} from '../logger.js';
import { LG } from './ids.js';
import { resultView, denyView } from './helpers.js';
import { buildPingsView } from './views.js';
import { COLOR } from '../../utils/ui.js';

export async function runQuickSetup(interaction) {
  await interaction.deferUpdate();
  try {
    const { roles, pingRoles, channels } = await setupLogChannels(interaction.guild);
    const view = resultView(interaction, {
      title: 'Логирование настроено',
      description:
        `Каналы: ${channels.all ? `<#${channels.all.id}>` : '—'}, ` +
        `${channels.important ? `<#${channels.important.id}>` : '—'}, ` +
        `${channels.moderation ? `<#${channels.moderation.id}>` : '—'}\n` +
        `Роли просмотра: ${roles.all ? `<@&${roles.all.id}>` : '—'} / ` +
        `${roles.important ? `<@&${roles.important.id}>` : '—'} / ` +
        `${roles.moderation ? `<@&${roles.moderation.id}>` : '—'}\n` +
        `Пинг-роли: ${pingRoles.all ? `<@&${pingRoles.all.id}>` : '—'} / ` +
        `${pingRoles.important ? `<@&${pingRoles.important.id}>` : '—'} / ` +
        `${pingRoles.moderation ? `<@&${pingRoles.moderation.id}>` : '—'}\n\n` +
        'Пинги людей по умолчанию выключены — включи в разделе «Пинги».',
      color: COLOR.success,
    });
    return interaction.editReply(view);
  } catch (err) {
    return interaction.editReply(denyView(interaction, `Не удалось создать каналы: ${err.message}`));
  }
}

export async function applyLevel(interaction, level) {
  try {
    setLogLevel(interaction.guildId, level);
  } catch (err) {
    return interaction.update(denyView(interaction, err.message, LG.nav.level));
  }
  return interaction.update(resultView(interaction, {
    title: 'Уровень обновлён',
    description: `Теперь: **${levelLabel(level)}**`,
    color: level === 'off' ? COLOR.danger : COLOR.success,
    backNav: LG.nav.level,
    section: 'уровень',
  }));
}

export async function applyChannel(interaction, kind, channelId) {
  if (!channelId) {
    return interaction.update(denyView(interaction, 'Канал не выбран.', LG.nav.channels));
  }

  if (kind === 'fallback') {
    setLogChannel(interaction.guildId, channelId);
  } else {
    const map = {
      all: 'channelAll',
      important: 'channelImportant',
      moderation: 'channelModeration',
    };
    const field = map[kind];
    if (!field) {
      return interaction.update(denyView(interaction, 'Неизвестный тип канала.', LG.nav.channels));
    }
    const existing = getLogConfig(interaction.guildId) || {};
    const patch = { [field]: channelId };
    if (kind === 'all' && !existing.channel_id) {
      patch.channelId = channelId;
    }
    patchLogConfig(interaction.guildId, patch);
    if (kind === 'all') {
      try {
        const { patchGuildChannels } = await import('../../utils/guildConfig.js');
        patchGuildChannels(interaction.guildId, { log: existing.channel_id || channelId });
      } catch {
        /* ignore */
      }
    }
  }

  return interaction.update(resultView(interaction, {
    title: 'Канал сохранён',
    description: `<#${channelId}>`,
    backNav: LG.nav.channels,
    section: 'каналы',
  }));
}

export async function togglePingFlag(interaction, flag) {
  const cfg = getLogConfig(interaction.guildId) || {};
  const key = flag === 'target' ? 'pingTarget' : 'pingActor';
  const current = flag === 'target' ? cfg.ping_target : cfg.ping_actor;
  patchLogConfig(interaction.guildId, { [key]: current ? 0 : 1 });
  return interaction.update(buildPingsView(interaction));
}

export async function turnOff(interaction) {
  disableLogging(interaction.guildId);
  return interaction.update(resultView(interaction, {
    title: 'Логи выключены',
    description: 'События больше не отправляются. Включить снова — раздел «Уровень».',
    color: COLOR.danger,
  }));
}

export { buildHomeView } from './views.js';
