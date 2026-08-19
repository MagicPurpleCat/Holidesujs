import {
  ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getDb } from '../database.js';
import { clearGuildConfigCache, initGuildConfig } from '../utils/guildConfig.js';
import { generateSelfRolesPanelImage } from './canvas-self-roles-panel.js';
import {
  SELF_ROLE_GROUPS,
  SELF_ROLES_CHANNEL_ID,
  findRoleDef,
  buildSelfRolesGuideText,
} from './selfRolesCatalog.js';

function readSelfRolesState(guildId) {
  const row = getDb().prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(guildId);
  const channels = row?.channels ? JSON.parse(row.channels) : {};
  return channels.self_roles || null;
}

function writeSelfRolesState(guildId, state) {
  initGuildConfig(guildId);
  const row = getDb().prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(guildId);
  const channels = row?.channels ? JSON.parse(row.channels) : {};
  channels.self_roles = state;
  getDb().prepare('UPDATE server_config SET channels = ? WHERE guild_id = ?')
    .run(JSON.stringify(channels), guildId);
  clearGuildConfigCache(guildId);
}

async function ensureDiscordRole(guild, roleDef) {
  let role = guild.roles.cache.find((r) => r.name === roleDef.name);

  if (!role) {
    return guild.roles.create({
      name: roleDef.name,
      color: roleDef.color,
      mentionable: true,
      hoist: false,
      reason: 'Holidesu: роль уведомлений',
    });
  }

  const patches = {};
  if (role.color !== roleDef.color) patches.color = roleDef.color;
  if (!role.mentionable) patches.mentionable = true;
  if (Object.keys(patches).length) {
    await role.edit({ ...patches, reason: 'Holidesu: синхронизация роли уведомлений' });
  }

  return role;
}

/** Создаёт или обновляет роли на сервере и сохраняет привязки в БД. */
export async function syncSelfRoleBindings(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Боту нужно право «Управление ролями».');
  }

  await guild.roles.fetch().catch(() => null);

  const bindings = {};
  const created = [];

  for (const group of SELF_ROLE_GROUPS) {
    bindings[group.id] = {};
    for (const def of group.roles) {
      const hadRole = guild.roles.cache.some((r) => r.name === def.name);
      const role = await ensureDiscordRole(guild, def);
      bindings[group.id][def.key] = role.id;
      if (!hadRole) created.push(role);
      if (role.position >= me.roles.highest.position) {
        console.warn(`[SELF-ROLES] Роль ${role.name} выше роли бота — выдача может не работать.`);
      }
    }
  }

  const prev = readSelfRolesState(guild.id) || {};
  writeSelfRolesState(guild.id, {
    ...prev,
    channel_id: prev.channel_id || SELF_ROLES_CHANNEL_ID,
    bindings,
  });

  return { bindings, created };
}

/** При старте бота: создать роли, если на сервере есть канал панели. */
export async function initSelfRolesForGuild(guild) {
  const channel = guild.channels.cache.get(SELF_ROLES_CHANNEL_ID)
    ?? await guild.channels.fetch(SELF_ROLES_CHANNEL_ID).catch(() => null);
  if (!channel) return null;

  const result = await syncSelfRoleBindings(guild);
  console.log(`[SELF-ROLES] ${guild.name}: синхронизировано ${Object.values(result.bindings).reduce((n, m) => n + Object.keys(m).length, 0)} ролей`);
  return result;
}

function splitRoleLabel(name) {
  const space = String(name).indexOf(' ');
  if (space <= 0) return { emoji: null, label: name };
  return {
    emoji: name.slice(0, space),
    label: name.slice(space + 1).trim() || name,
  };
}

function buildSelectMenus(guildId, bindings) {
  const rows = [];
  for (const group of SELF_ROLE_GROUPS) {
    const options = group.roles.map((def) => {
      const { emoji, label } = splitRoleLabel(def.name);
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(label.slice(0, 100))
        .setDescription(def.description.slice(0, 100))
        .setValue(`${group.id}:${def.key}`);
      if (emoji) {
        opt.setEmoji({ name: emoji });
      }
      return opt;
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`self_role:${group.id}`)
      .setPlaceholder(`${group.label} — нажми, чтобы выбрать`)
      .setMinValues(0)
      .setMaxValues(group.max === 1 ? 1 : Math.min(group.roles.length, 25))
      .addOptions(options);

    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

/**
 * Публикует или обновляет панель ролей в welcome/roles канале.
 * @param {import('discord.js').Guild} guild
 * @param {string} [channelId]
 */
export async function publishSelfRolesPanel(guild, channelId = SELF_ROLES_CHANNEL_ID) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Боту нужно право «Управление ролями».');
  }

  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    throw new Error(`Канал ${channelId} не найден или не текстовый.`);
  }

  const { bindings } = await syncSelfRoleBindings(guild);

  const imageBuffer = await generateSelfRolesPanelImage({
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ extension: 'png', size: 256 }),
  });

  const files = imageBuffer
    ? [new AttachmentBuilder(imageBuffer, { name: 'self-roles.png' })]
    : [];

  const components = buildSelectMenus(guild.id, bindings);
  const prev = readSelfRolesState(guild.id);

  if (prev?.message_id) {
    try {
      const oldMsg = await channel.messages.fetch(prev.message_id);
      await oldMsg.delete().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  const guideEmbed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setDescription(buildSelfRolesGuideText())
    .setFooter({ text: 'Меню ниже · можно изменить в любой момент' });

  if (imageBuffer) {
    guideEmbed.setImage('attachment://self-roles.png');
  }

  const msg = await channel.send({
    embeds: [guideEmbed],
    files,
    components,
  });

  writeSelfRolesState(guild.id, {
    channel_id: channel.id,
    message_id: msg.id,
    bindings,
  });

  return { channel, message: msg, bindings };
}

function resolveRoleId(state, groupId, roleKey) {
  return state?.bindings?.[groupId]?.[roleKey] || null;
}

function allBoundRoleIdsInGroup(state, groupId) {
  const map = state?.bindings?.[groupId] || {};
  return Object.values(map);
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleSelfRoleSelect(interaction) {
  if (!interaction.customId?.startsWith('self_role:')) return false;

  const groupId = interaction.customId.slice('self_role:'.length);
  const group = SELF_ROLE_GROUPS.find((g) => g.id === groupId);
  if (!group) return false;

  const state = readSelfRolesState(interaction.guildId);
  if (!state?.bindings) {
    await interaction.reply({
      content: '❌ Панель ролей не настроена. Админ: `/self-roles setup`.',
      ephemeral: true,
    });
    return true;
  }

  const member = interaction.member;
  const selectedKeys = interaction.values.map((v) => v.split(':')[1]);
  const groupRoleIds = allBoundRoleIdsInGroup(state, groupId);

  try {
    // Сначала снимаем все роли группы
    const toRemove = groupRoleIds.filter((id) => member.roles.cache.has(id));
    if (toRemove.length) {
      await member.roles.remove(toRemove, 'Self-role panel: обновление выбора');
    }

    // Выдаём выбранные
    const toAdd = selectedKeys
      .map((key) => resolveRoleId(state, groupId, key))
      .filter(Boolean);

    if (toAdd.length) {
      await member.roles.add(toAdd, 'Self-role panel: выбор роли');
    }

    const labels = selectedKeys
      .map((key) => findRoleDef(groupId, key))
      .filter(Boolean);

    let text;
    if (labels.length) {
      const lines = labels.map((r) => `**${r.name}** — ${r.detail}`);
      text = `✅ **Роли обновлены**\n\n${lines.join('\n\n')}`;
    } else {
      text = '✅ Пинги отключены — лишних упоминаний не будет.';
    }

    await interaction.reply({ content: text.slice(0, 2000), ephemeral: true });
  } catch (err) {
    await interaction.reply({
      content: `❌ Не удалось изменить роли: ${err.message}`,
      ephemeral: true,
    }).catch(() => {});
  }

  return true;
}

export { SELF_ROLES_CHANNEL_ID, readSelfRolesState };
