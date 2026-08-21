import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import {
  getGuildConfig,
  patchGuildChannels,
  setGuildMeta,
  SETUP_CHANNEL_FIELDS,
} from '../../utils/guildConfig.js';
import { COLOR } from '../../utils/ui.js';
import { SU } from './ids.js';
import { denyView, resultView } from './helpers.js';
import {
  buildHomeView,
  buildChannelsView,
  buildChannelSetView,
  buildRolesView,
  buildOwnerView,
} from './views.js';

export function showOwnerModal(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const modal = new ModalBuilder().setCustomId(SU.modalOwner).setTitle('Владелец и заметка');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('owner_id')
        .setLabel('Discord ID владельца')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setValue(cfg.ownerId || interaction.user.id),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Заметка / название проекта')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue((cfg.note || '').slice(0, 100)),
    ),
  );
  return interaction.showModal(modal);
}

export async function saveOwnerModal(interaction) {
  const ownerId = interaction.fields.getTextInputValue('owner_id').trim();
  const note = interaction.fields.getTextInputValue('note').trim();
  if (!/^\d{17,20}$/.test(ownerId)) {
    return interaction.reply({
      ...denyView(interaction, 'ID владельца: 17–20 цифр.', SU.nav.owner),
      flags: MessageFlags.Ephemeral,
    });
  }
  setGuildMeta(interaction.guildId, { ownerId, note });
  return interaction.reply({
    ...resultView(interaction, {
      title: 'Сохранено',
      description: `Владелец: <@${ownerId}>${note ? `\nЗаметка: ${note}` : ''}`,
      backNav: SU.nav.owner,
      section: 'владелец',
    }),
    flags: MessageFlags.Ephemeral,
  });
}

export async function saveOwnerUser(interaction, userId) {
  if (!userId) {
    return interaction.update(denyView(interaction, 'Пользователь не выбран.', SU.nav.owner));
  }
  setGuildMeta(interaction.guildId, { ownerId: userId });
  return interaction.update(resultView(interaction, {
    title: 'Владелец обновлён',
    description: `Теперь: <@${userId}>`,
    backNav: SU.nav.owner,
    section: 'владелец',
  }));
}

export async function saveChannel(interaction, key, channelId) {
  const field = SETUP_CHANNEL_FIELDS.find((f) => f.key === key);
  if (!field) {
    return interaction.update(denyView(interaction, 'Неизвестное поле.', SU.nav.channels));
  }
  patchGuildChannels(interaction.guildId, { [key]: channelId });
  if (key === 'voice_category' && channelId) {
    await ensureStatsVoiceChannels(interaction, channelId).catch(() => {});
  }
  return interaction.update(resultView(interaction, {
    title: 'Канал сохранён',
    description: `${field.emoji} **${field.label}** → <#${channelId}>`,
    backNav: SU.nav.channels,
    section: 'каналы',
  }));
}

export async function clearChannel(interaction, key) {
  const field = SETUP_CHANNEL_FIELDS.find((f) => f.key === key);
  if (!field || field.required) {
    return interaction.update(denyView(interaction, 'Это поле нельзя очистить.', SU.nav.channels));
  }
  patchGuildChannels(interaction.guildId, { [key]: null });
  return interaction.update(resultView(interaction, {
    title: 'Очищено',
    description: `${field.emoji} **${field.label}** сброшен.`,
    color: COLOR.wait,
    backNav: SU.nav.channels,
    section: 'каналы',
  }));
}

export async function saveAdminRoles(interaction, roleIds) {
  if (!roleIds?.length) {
    return interaction.update(denyView(interaction, 'Выбери хотя бы одну роль.', SU.nav.roles));
  }
  setGuildMeta(interaction.guildId, { adminRoles: roleIds });
  return interaction.update(resultView(interaction, {
    title: 'Админ-роли',
    description: roleIds.map((id) => `<@&${id}>`).join(', '),
    backNav: SU.nav.roles,
    section: 'роли',
  }));
}

export async function saveVerifiedRole(interaction, roleId) {
  patchGuildChannels(interaction.guildId, { verified_role: roleId });
  return interaction.update(resultView(interaction, {
    title: 'Роль верификации',
    description: `<@&${roleId}>`,
    backNav: SU.nav.roles,
    section: 'роли',
  }));
}

export async function saveSeasonRole(interaction, roleId) {
  patchGuildChannels(interaction.guildId, { season_role: roleId });
  return interaction.update(resultView(interaction, {
    title: 'Роль сезона',
    description: `<@&${roleId}>`,
    backNav: SU.nav.roles,
    section: 'роли',
  }));
}

/** Создаёт/проверяет голосовые каналы статистики в категории. */
export async function ensureStatsVoiceChannels(interaction, categoryId) {
  const guild = interaction.guild;
  const botId = interaction.client?.user?.id;
  if (!guild || !botId || !categoryId) return null;

  const cfg = getGuildConfig(interaction.guildId);
  let membersId = cfg.statsMembersVoiceChannelId || null;
  let botsId = cfg.statsBotsVoiceChannelId || null;

  const ensure = async (existingId, name) => {
    if (existingId) {
      const found = guild.channels.cache.get(existingId)
        || await guild.channels.fetch(existingId).catch(() => null);
      if (found) return existingId;
    }
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.Connect],
          allow: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: botId,
          deny: [PermissionFlagsBits.Connect],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
        },
      ],
    });
    return ch?.id || null;
  };

  membersId = await ensure(membersId, 'Люди: 0');
  botsId = await ensure(botsId, 'Боты: 0');
  patchGuildChannels(interaction.guildId, {
    stats_members_voice: membersId,
    stats_bots_voice: botsId,
  });
  return { membersId, botsId };
}

export {
  buildHomeView,
  buildChannelsView,
  buildChannelSetView,
  buildRolesView,
  buildOwnerView,
};
