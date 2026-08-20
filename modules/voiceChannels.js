import { EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getDb } from '../database.js';
import { getGuildConfig, FALLBACK_TRIGGER_CHANNEL_ID } from '../utils/guildConfig.js';
import { publishRoomPanel, removeRoomPanelMessage } from '../commands/room-settings.js';
import { trackRoomCreated } from './achievementsTracker.js';

// ══════════════════════════════════════════════════════════════════
// АВТО-СОЗДАНИЕ ГОЛОСОВЫХ КАНАЛОВ (БЕЗ ТЕКСТОВОГО КАНАЛА)
// ══════════════════════════════════════════════════════════════════
//
// МЕХАНИКА:
// 1. Пользователь заходит в канал-триггер (TRIGGER_CHANNEL_ID).
// 2. Бот создаёт голосовой канал: "{Ник} | Приватно".
// 3. Бот телепортирует пользователя в новый голосовой канал.
// 4. Панель управления отправляется в чат созданного голосового канала.
//
// ПЕРЕДАЧА ВЛАДЕНИЯ:
// - Если владелец выходит, а в комнате есть другие — владение первому участнику.
// - Если выходят ВСЕ — канал удаляется НЕМЕДЛЕННО.
// ══════════════════════════════════════════════════════════════════

// Канал-триггер и категория берутся из /setup (server_config), затем из .env.

export function getTriggerChannelId(guildId) {
  return getGuildConfig(guildId).triggerChannelId;
}

// ══════════════════════════════════════════════════════════════════
// ПОИСК КОМНАТЫ ПО ID ВЛАДЕЛЬЦА (для кнопок из ЛС)
// ══════════════════════════════════════════════════════════════════

/**
 * Находит комнату по ID владельца.
 * Используется для обработки кнопок из ЛС, где нет текстового канала.
 * @param {string} ownerId — ID владельца
 * @returns {object|null} — запись из user_voice_channels или null
 */
function findRoomByOwner(ownerId) {
  const db = getDb();
  return db.prepare('SELECT * FROM user_voice_channels WHERE owner_id = ?').get(ownerId);
}

// ══════════════════════════════════════════════════════════════════
// СОЗДАНИЕ КОМНАТЫ
// ══════════════════════════════════════════════════════════════════

/**
 * Проверяет, существует ли канал и не удалён ли он.
 * @param {import('discord.js').Channel | null | undefined} channel
 * @returns {boolean} true если канал валиден
 */
function isChannelValid(channel) {
  if (!channel || channel.deleted || !channel.guild) {
    console.warn(`⚠️ Канал ${channel?.id || 'неизвестный'} не найден или удалён. Пропускаем операцию.`);
    return false;
  }
  return true;
}

/**
 * Безопасная отправка сообщения в ЛС. Не падает, если ЛС закрыты.
 * @param {import('discord.js').User} user
 * @param {string | object} content
 */
async function safeSendDM(user, content) {
  try {
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;
    await dmChannel.send(content);
  } catch (e) {
    if (e.code === 50007) {
      console.log(`⚠️ ЛС для ${user.id} закрыты. Не удалось отправить сообщение.`);
    } else {
      console.error(`[DM] Ошибка отправки ЛС ${user.id}:`, e.message);
    }
  }
}

/**
 * Создаёт голосовую комнату и публикует панель управления в её чате.
 * @param {GuildMember} member — пользователь, который зашёл в канал-триггер
 * @param {VoiceChannel} triggerChannel — канал-триггер
 */
export async function createVoiceRoom(member, triggerChannel) {
  const db = getDb();
  const guild = member.guild;

  // Проверяем, нет ли уже активной комнаты у пользователя
  const existingRoom = findRoomByOwner(member.id);

  if (existingRoom) {
    let existingVoice = guild.channels.cache.get(existingRoom.voice_channel_id);
    if (!existingVoice) {
      existingVoice = await guild.channels.fetch(existingRoom.voice_channel_id).catch(() => null);
    }

    if (existingVoice) {
      await member.voice.setChannel(existingVoice).catch(() => {});
      return;
    }

    // Канал удалён — чистим БД и создаём комнату заново
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(existingRoom.id);
  }

  try {
    const cfg = getGuildConfig(guild.id);
    const categoryId = cfg.voiceCategoryId || triggerChannel.parentId;
    const verifiedRoleId = cfg.verifiedRoleId;

    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.Connect],
        allow: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
          PermissionFlagsBits.MoveMembers,
        ],
      },
    ];
    if (verifiedRoleId) {
      permissionOverwrites.push({
        id: verifiedRoleId,
        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
      });
    }

    const botMember = guild.members.me;
    if (botMember) {
      permissionOverwrites.push({
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      });
    }

    const voiceChannel = await guild.channels.create({
      name: `${member.displayName} | Приватно`,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      permissionOverwrites,
    });

    // ─── Сохраняем в БД ────────────────────────────────────────
    db.prepare(`
      INSERT INTO user_voice_channels (owner_id, voice_channel_id)
      VALUES (?, ?)
    `).run(member.id, voiceChannel.id);

    trackRoomCreated(member.id, guild.id);

    const room = db.prepare('SELECT * FROM user_voice_channels WHERE voice_channel_id = ?').get(voiceChannel.id);

    // ─── Перемещаем пользователя в новую комнату ─────────────────
    await member.voice.setChannel(voiceChannel).catch((err) => {
      console.error(`[VOICE] Не удалось переместить ${member.id}: ${err.message}`);
    });

    // ─── Панель управления — в чат голосового канала ─────────────
    if (room) {
      await publishRoomPanel(guild, room, voiceChannel, { mentionOwner: true }).catch((err) => {
        console.error(`[VOICE] Не удалось опубликовать панель для ${voiceChannel.id}: ${err.message}`);
      });
    }

    console.log(
      `[VOICE] Создана комната для ${member.displayName}: голосовой=${voiceChannel.id}`
    );
  } catch (err) {
    console.error(`[VOICE] Ошибка создания комнаты для ${member.id}:`, err.message);
    // Попытка уведомить пользователя в ЛС
    await safeSendDM(member, '❌ Произошла ошибка при создании комнаты. Попробуй ещё раз.');
  }
}

// ══════════════════════════════════════════════════════════════════
// ПЕРЕДАЧА ВЛАДЕНИЯ
// ══════════════════════════════════════════════════════════════════
//
// ЛОГИКА:
// 1. Владелец выходит из голосового канала.
// 2. Если в канале остались участники — первый в списке становится новым владельцем.
// 3. Бот обновляет запись в БД и переотправляет панель в чат голосового канала.
// 4. Если в канале никого не осталось — канал удаляется НЕМЕДЛЕННО.
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает выход пользователя из комнаты.
 * @param {VoiceChannel} voiceChannel — голосовой канал комнаты
 * @param {Guild} guild — гильдия
 */
export async function handleOwnerLeave(voiceChannel, guild) {
  const db = getDb();
  const room = db
    .prepare('SELECT * FROM user_voice_channels WHERE voice_channel_id = ?')
    .get(voiceChannel.id);

  if (!room) return;

  // Проверяем, есть ли кто-то в канале (без ботов)
  const members = voiceChannel.members.filter((m) => !m.user.bot);
  const membersArray = [...members.values()];

  if (membersArray.length === 0) {
    // Никого нет — удаляем комнату НЕМЕДЛЕННО
    await deleteVoiceRoomById(voiceChannel.id, guild);
    return;
  }

  // Есть участники — передаём владение первому в списке
  const newOwner = membersArray[0];
  const oldOwnerId = room.owner_id;

  // Обновляем владельца в БД
  db.prepare('UPDATE user_voice_channels SET owner_id = ? WHERE id = ?').run(
    newOwner.id,
    room.id
  );

  try {
    // Снимаем права со старого владельца
    await voiceChannel.permissionOverwrites.delete(oldOwnerId).catch(() => {});

    // Настраиваем права для нового владельца
    await voiceChannel.permissionOverwrites.edit(newOwner.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      MuteMembers: true,
      DeafenMembers: true,
      MoveMembers: true,
    });

    // Удаляем права @everyone на Connect (если были закрыты)
    await voiceChannel.permissionOverwrites.edit(guild.id, {
      Connect: null,
    }).catch(() => {});

    // Сбрасываем флаг is_locked
    db.prepare('UPDATE user_voice_channels SET is_locked = 0 WHERE id = ?').run(room.id);

    // Пытаемся уведомить старого владельца в ЛС
    try {
      const oldOwnerMember = await guild.members.fetch(oldOwnerId).catch(() => null);
      if (oldOwnerMember) {
        const dm = await oldOwnerMember.createDM().catch(() => null);
        if (dm) {
          await dm.send({
            content: `⚙️ Владение комнатой **${voiceChannel.name}** передано пользователю **${newOwner.displayName}**.`,
          });
        }
      }
    } catch {
      // Игнорируем, если не удалось отправить ЛС старому владельцу
    }

    console.log(
      `[VOICE] Владение комнатой ${voiceChannel.id} передано от ${oldOwnerId} к ${newOwner.id}`
    );

    const updatedRoom = db.prepare('SELECT * FROM user_voice_channels WHERE id = ?').get(room.id);
    if (updatedRoom) {
      await publishRoomPanel(guild, updatedRoom, voiceChannel, { mentionOwner: true }).catch((err) => {
        console.error(`[VOICE] Не удалось обновить панель после передачи ${voiceChannel.id}: ${err.message}`);
      });
    }
  } catch (err) {
    console.error(`[VOICE] Ошибка передачи владения:`, err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// УДАЛЕНИЕ КОМНАТЫ
// ══════════════════════════════════════════════════════════════════

/**
 * Удаляет голосовой канал комнаты и запись из БД.
 * @param {string} voiceChannelIdStr — ID голосового канала
 * @param {Guild} guild — гильдия
 */
export async function deleteVoiceRoomById(voiceChannelIdStr, guild) {
  const db = getDb();
  const room = db
    .prepare('SELECT * FROM user_voice_channels WHERE voice_channel_id = ?')
    .get(voiceChannelIdStr);

  if (!room) return;

  await removeRoomPanelMessage(guild, voiceChannelIdStr).catch(() => {});

  try {
    // Удаляем голосовой канал
    const vc =
      guild.channels.cache.get(room.voice_channel_id) ||
      (await guild.channels.fetch(room.voice_channel_id).catch(() => null));
    if (vc && vc.deletable) {
      await vc.delete('Комната удалена — все вышли');
    }

    // Удаляем из БД
    db.prepare('DELETE FROM user_voice_channels WHERE voice_channel_id = ?').run(
      voiceChannelIdStr
    );

    console.log(`[VOICE] Комната ${voiceChannelIdStr} удалена.`);
  } catch (err) {
    console.error(`[VOICE] Ошибка удаления комнаты ${voiceChannelIdStr}:`, err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК КНОПОК ИЗ ЛС
// ══════════════════════════════════════════════════════════════════
//
// Все кнопки нажимаются в ЛС. Комнату ищем по owner_id.
// ══════════════════════════════════════════════════════════════════

/**
 * Главный диспетчер нажатий кнопок голосовых комнат (из ЛС).
 */
export async function handleVoiceChannelButtons(interaction) {
  const { customId, user } = interaction;
  const db = getDb();

  // Находим комнату по ID владельца (кнопка нажата в ЛС)
  const room = findRoomByOwner(user.id);

  if (!room) {
    return interaction.reply({
      content: '❌ У тебя нет активной комнаты.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ИСПРАВЛЕНИЕ: получаем guild через client. Кнопки нажимаются в ЛС, interaction.guild === null.
  const client = interaction.client;
  const guild = client.guilds.cache.get(interaction.guildId) || client.guilds.cache.first();
  if (!guild) {
    return interaction.reply({
      content: '❌ Ошибка: не удалось получить сервер.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const voiceChannel = guild.channels.cache.get(room.voice_channel_id);
  if (!voiceChannel || voiceChannel.deleted) {
    // Канал уже удалён — чистим БД
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);
    return interaction.reply({
      content: '❌ Твой голосовой канал уже удалён.',
      flags: MessageFlags.Ephemeral,
    });
  }

// ─── Закрыть / Открыть доступ ───────────────────────────────
  // ИСПРАВЛЕНИЕ: customId может быть "lock_room_{roomId}", "vc_delete_confirm", "add_member_{roomId}" и т.д.
  // Правильный способ: проверяем начало строки, а не берём первый элемент split
  if (customId.startsWith('lock_room_')) {
    if (room.is_locked) {
      // Открываем доступ
      await voiceChannel.permissionOverwrites.edit(guild.id, {
        Connect: null, // сбрасываем на нейтральное
      });
      db.prepare('UPDATE user_voice_channels SET is_locked = 0 WHERE id = ?').run(room.id);

      return interaction.reply({
        content: '🔓 Доступ открыт! Теперь все могут заходить в комнату.',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // Закрываем доступ — только владелец может говорить
      await voiceChannel.permissionOverwrites.edit(guild.id, {
        Connect: false,
        Speak: false,
      });
      // Владельцу выдаём права
      await voiceChannel.permissionOverwrites.edit(room.owner_id, {
        Connect: true,
        Speak: true,
      });
      db.prepare('UPDATE user_voice_channels SET is_locked = 1 WHERE id = ?').run(room.id);

      return interaction.reply({
        content: '🔒 Доступ закрыт! Теперь только ты можешь заходить и говорить в комнате.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

// ─── Добавить участника ─────────────────────────────────────
  // customId: "add_member_{roomId}"
  if (customId.startsWith('add_member_')) {
    const modal = new ModalBuilder()
      .setCustomId('vc_add_user_modal')
      .setTitle('👤 Добавить участника');

    const userIdInput = new TextInputBuilder()
      .setCustomId('vc_target_user_id')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя (правой кнопкой -> Копировать ID)')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    await interaction.showModal(modal);
    return;
  }

// ─── Настройки прав ─────────────────────────────────────────
  // customId: "settings_room_{roomId}"
  if (customId.startsWith('settings_room_')) {
    const modal = new ModalBuilder()
      .setCustomId('vc_permissions_modal')
      .setTitle('📋 Настройки прав');

    const userIdInput = new TextInputBuilder()
      .setCustomId('vc_perm_target')
      .setLabel('ID пользователя')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ID пользователя для изменения прав')
      .setRequired(true);

    const permInput = new TextInputBuilder()
      .setCustomId('vc_perm_level')
      .setLabel('Права: allow / deny / remove')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('allow — разрешить, deny — запретить, remove — убрать')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userIdInput),
      new ActionRowBuilder().addComponents(permInput),
    );

    await interaction.showModal(modal);
    return;
  }

// ─── Удалить канал ──────────────────────────────────────────
  // customId: "delete_room_{roomId}"
  if (customId.startsWith('delete_room_')) {
    const confirmEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🗑 Подтверждение удаления')
      .setDescription(
        '**Ты уверен?**\n\n' +
        'Комната будет удалена **навсегда**.\n' +
        'Отменить это действие невозможно.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vc_delete_confirm')
        .setLabel('✅ Да, удалить')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('vc_delete_cancel')
        .setLabel('❌ Отмена')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // ─── Подтверждение удаления ─────────────────────────────────
  if (customId === 'vc_delete_confirm') {
    await interaction.update({ content: '🗑 Удаляю комнату...', embeds: [], components: [] });

    try {
      if (voiceChannel && voiceChannel.deletable) {
        await voiceChannel.delete('Комната удалена владельцем');
      }
    } catch (err) {
      console.error(`[VOICE] Ошибка при удалении канала:`, err.message);
    }

    // Удаляем из БД
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);

    await interaction.followUp({
      content: '✅ Комната удалена.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    return;
  }

  // ─── Отмена удаления ────────────────────────────────────────
  if (customId === 'vc_delete_cancel') {
    return interaction.update({
      content: '❌ Удаление отменено.',
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК МОДАЛКИ ДОБАВЛЕНИЯ УЧАСТНИКА
// ══════════════════════════════════════════════════════════════════

/**
 * Обработчик модального окна добавления участника.
 * Комнату ищем по owner_id, так как кнопка нажата в ЛС.
 */
export async function handleAddUserModal(interaction) {
  if (interaction.customId !== 'vc_add_user_modal') return;

  const targetId = interaction.fields.getTextInputValue('vc_target_user_id').trim();
  const { user } = interaction;
  const db = getDb();

  // ИСПРАВЛЕНИЕ: получаем guild через client.guilds.cache
  const guild = interaction.guild || interaction.client.guilds.cache.get(interaction.guildId);

  // Находим комнату по ID владельца
  const room = findRoomByOwner(user.id);

  if (!room) {
    return interaction.reply({
      content: '❌ У тебя нет активной комнаты.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (room.owner_id !== user.id) {
    return interaction.reply({
      content: '❌ Только владелец может добавлять участников.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Ищем пользователя по ID
  let targetMember;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    return interaction.reply({
      content: '❌ Пользователь с таким ID не найден на сервере.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Даём доступ к голосовому каналу
  const voiceChannel = guild.channels.cache.get(room.voice_channel_id);
  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ Голосовой канал не найден. Возможно, он уже удалён.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await voiceChannel.permissionOverwrites.edit(targetMember.id, {
      Connect: true,
      Speak: true,
      ViewChannel: true,
    });

    await interaction.reply({
      content: `✅ **${targetMember.displayName}** получил доступ к комнате!`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error(`[VOICE] Ошибка добавления участника:`, err.message);
    await interaction.reply({
      content: '❌ Ошибка при добавлении участника.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК МОДАЛКИ НАСТРОЙКИ ПРАВ
// ══════════════════════════════════════════════════════════════════

/**
 * Обработчик модального окна настройки прав.
 */
export async function handlePermissionsModal(interaction) {
  if (interaction.customId !== 'vc_permissions_modal') return;

  const targetId = interaction.fields.getTextInputValue('vc_perm_target').trim();
  const permAction = interaction.fields.getTextInputValue('vc_perm_level').trim().toLowerCase();
  const { user } = interaction;
  // ИСПРАВЛЕНИЕ: получаем guild через client (в ЛС interaction.guild === null)
  const guild = interaction.guild || interaction.client.guilds.cache.get(interaction.guildId);

  const room = findRoomByOwner(user.id);
  if (!room) {
    return interaction.reply({
      content: '❌ У тебя нет активной комнаты.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (room.owner_id !== user.id) {
    return interaction.reply({
      content: '❌ Только владелец может изменять права.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const voiceChannel = guild.channels.cache.get(room.voice_channel_id);
  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ Голосовой канал не найден.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Ищем цель
  let targetMember;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    return interaction.reply({
      content: '❌ Пользователь с таким ID не найден на сервере.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (permAction === 'allow') {
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: true,
        Speak: true,
        ViewChannel: true,
      });
      await interaction.reply({
        content: `✅ **${targetMember.displayName}** — права выданы (разрешён вход).`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (permAction === 'deny') {
      await voiceChannel.permissionOverwrites.edit(targetMember.id, {
        Connect: false,
        Speak: false,
        ViewChannel: true,
      });
      await interaction.reply({
        content: `🔒 **${targetMember.displayName}** — вход запрещён.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (permAction === 'remove') {
      await voiceChannel.permissionOverwrites.delete(targetMember.id).catch(() => {});
      await interaction.reply({
        content: `♻️ **${targetMember.displayName}** — настройки прав сброшены (удалены).`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: '❌ Неверное действие. Используй: **allow** (разрешить), **deny** (запретить) или **remove** (удалить).',
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error(`[VOICE] Ошибка настройки прав:`, err.message);
    await interaction.reply({
      content: '❌ Ошибка при изменении прав.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

export { FALLBACK_TRIGGER_CHANNEL_ID as TRIGGER_CHANNEL_ID };
