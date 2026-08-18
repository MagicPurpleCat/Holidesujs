// ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: VOICE PANEL — Единая панель управления голосовыми комнатами
// ══════════════════════════════════════════════════════════════════
//
// ФУНКЦИОНАЛ:
// 1. Отправляет embed + кнопки в канал, настроенный через /setup (voice_panel)
// 2. Показывает статистику: активные комнаты, пользователи в войсе
// 3. Кнопки:
//    - 🎮 Управлять комнатой (для владельцев комнат)
//    - ➕ Создать комнату (для тех, кто в войсе без комнаты)
//    - 🔒 Моя комната (DM-панель для владельцев)
// 4. Разрешает верифицированным заходить в приватные каналы
// ══════════════════════════════════════════════════════════════════

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getDb } from '../database.js';
import { getTriggerChannelId, triggerChannelMention } from '../utils/guildConfig.js';

// ══════════════════════════════════════════════════════════════════
// КЭШ СООБЩЕНИЙ ПАНЕЛИ (по серверу)
// ══════════════════════════════════════════════════════════════════
// Ключ: guildId
// Значение: { messageId, channelId }
// Сообщение также сохраняется в БД (таблица voice_panel_messages),
// чтобы при перезапуске бот обновлял существующее сообщение,
// а не создавал новое.
// ══════════════════════════════════════════════════════════════════

const panelCache = new Map();
const PANEL_UPDATE_INTERVAL = 30_000; // обновление каждые 30 секунд

// ══════════════════════════════════════════════════════════════════
// ПЕРСИСТЕНТНОСТЬ ПАНЕЛИ В БД
// ══════════════════════════════════════════════════════════════════

/**
 * Загружает сохранённое сообщение панели для сервера из БД.
 * @param {string} guildId
 * @returns {{ messageId: string, channelId: string } | null}
 */
function loadPanelFromDB(guildId) {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT message_id, channel_id FROM voice_panel_messages WHERE guild_id = ?')
      .get(guildId);
    if (row) {
      return { messageId: row.message_id, channelId: row.channel_id };
    }
  } catch (err) {
    console.error(`[VOICE_PANEL] Ошибка загрузки панели из БД для ${guildId}:`, err.message);
  }
  return null;
}

/**
 * Сохраняет ID сообщения панели в БД (UPSERT по guild_id).
 * @param {string} guildId
 * @param {string} messageId
 * @param {string} channelId
 */
function savePanelToDB(guildId, messageId, channelId) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO voice_panel_messages (guild_id, message_id, channel_id, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(guild_id) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        updated_at = datetime('now')
    `).run(guildId, messageId, channelId);
  } catch (err) {
    console.error(`[VOICE_PANEL] Ошибка сохранения панели в БД для ${guildId}:`, err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// ПОСТРОЕНИЕ EMBED ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

/**
 * Строит Embed с актуальной статистикой голосовых комнат сервера.
 * @param {import('discord.js').Guild} guild
 * @returns {EmbedBuilder}
 */
function buildVoicePanelEmbed(guild) {
  const db = getDb();
  const triggerId = getTriggerChannelId(guild.id);
  const triggerMention = triggerChannelMention(guild.id);

  const voiceChannels = guild.channels.cache.filter(
    ch => ch.type === 2 && ch.members.size > 0 && ch.id !== triggerId
  );

  const totalVoiceUsers = voiceChannels.reduce((sum, ch) => sum + ch.members.filter(m => !m.user.bot).size, 0);
  const activeRooms = db.prepare('SELECT COUNT(*) as cnt FROM user_voice_channels').get().cnt;
  const totalMembers = guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎙 Голосовая панель')
    .setDescription(
      'Управляй своими голосовыми комнатами прямо отсюда!\n\n' +
      '**Как это работает:**\n' +
      `1️⃣ Зайди в канал ${triggerMention}\n` +
      '2️⃣ Бот создаст твою приватную комнату\n' +
      '3️⃣ Управляй комнатой через кнопки ниже\n\n' +
      '**Для верифицированных:**\n' +
      '✅ Вам открыт доступ в приватные комнаты других пользователей'
    )
    .addFields(
      {
        name: '📊 Статистика сервера',
        value:
          `👥 Всего участников: **${totalMembers}**\n` +
          `🎤 Сейчас в голосе: **${totalVoiceUsers}**\n` +
          `🏠 Активных комнат: **${activeRooms}**`,
        inline: false,
      },
      {
        name: '✅ Доступные действия',
        value:
          '**🎮 Управлять комнатой** — открыть панель управления (если есть комната)\n' +
          '**➕ Создать комнату** — зайти в канал создания\n' +
          '**🔒 Моя комната** — управление через ЛС\n\n' +
          `**❓ Нет комнаты?** Зайди в канал ${triggerMention} — бот создаст её автоматически!`,
        inline: false,
      }
    )
    .setFooter({ text: 'Панель обновляется каждые 30 секунд | /room-settings' })

  return embed;
}

// ══════════════════════════════════════════════════════════════════
// ПОСТРОЕНИЕ КНОПОК ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

/**
 * Строит кнопки для голосовой панели.
 * @returns {ActionRowBuilder[]}
 */
function buildVoicePanelButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vp_manage_room')
      .setEmoji('🎮')
      .setLabel('Комната')
      .setStyle(ButtonStyle.Primary),
  );

  return [row1];
}

// ══════════════════════════════════════════════════════════════════
// ОТПРАВКА / ОБНОВЛЕНИЕ ПАНЕЛИ В КАНАЛЕ
// ══════════════════════════════════════════════════════════════════

/**
 * Отправляет или обновляет панель в указанном канале.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').TextChannel} channel
 */
export async function sendVoicePanel(guild, channel) {
  try {
    const embed = buildVoicePanelEmbed(guild);
    const components = buildVoicePanelButtons();

    const cacheKey = guild.id;
    const cached = panelCache.get(cacheKey);

    if (cached && cached.channelId === channel.id) {
      // Пытаемся обновить существующее сообщение
      try {
        const message = await channel.messages.fetch(cached.messageId).catch(() => null);
        if (message) {
          await message.edit({ embeds: [embed], components });
          return;
        }
      } catch {
        // Сообщение удалено — создаём новое
      }
    }

    // Создаём новое сообщение
    const message = await channel.send({ embeds: [embed], components });
    panelCache.set(cacheKey, {
      messageId: message.id,
      channelId: channel.id,
    });
    // Сохраняем ID сообщения в БД, чтобы после перезапуска
    // бот обновлял это же сообщение, а не создавал новое.
    savePanelToDB(cacheKey, message.id, channel.id);
  } catch (err) {
    console.error(`[VOICE_PANEL] Ошибка отправки панели в ${guild.id}:`, err.message);
  }
}

/**
 * Инициализирует или обновляет голосовую панель для сервера.
 * @param {import('discord.js').Guild} guild
 */
export async function initVoicePanel(guild) {
  if (!guild) return;

  const db = getDb();

  // Получаем конфигурацию сервера
  const config = db.prepare('SELECT channels FROM server_config WHERE guild_id = ?').get(guild.id);
  if (!config) {
    console.log(`[VOICE_PANEL] Сервер ${guild.id} не настроен. Пропускаем.`);
    return;
  }

  let channels;
  try {
    channels = JSON.parse(config.channels);
  } catch {
    console.warn(`[VOICE_PANEL] Ошибка парсинга channels для ${guild.id}`);
    return;
  }

  const voicePanelChannelId = channels?.voice_panel;
  if (!voicePanelChannelId) {
    console.log(`[VOICE_PANEL] Канал голосовой панели не настроен для ${guild.id}`);
    return;
  }

  const channel = guild.channels.cache.get(voicePanelChannelId);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[VOICE_PANEL] Канал ${voicePanelChannelId} не найден или не текстовый`);
    return;
  }

  // Загружаем сохранённое сообщение из БД (если есть) в кэш.
  // Это позволяет при перезапуске бота обновлять существующее
  // сообщение панели, а не создавать новое.
  const saved = loadPanelFromDB(guild.id);
  if (saved && !panelCache.has(guild.id)) {
    panelCache.set(guild.id, {
      messageId: saved.messageId,
      channelId: saved.channelId,
    });
    console.log(
      `[VOICE_PANEL] Сервер ${guild.id}: восстановлено сообщение панели (${saved.messageId}) из БД`
    );
  }

  await sendVoicePanel(guild, channel);
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК КНОПОК ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает нажатия кнопок голосовой панели.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleVoicePanelButtons(interaction) {
  const { customId, member, guild, user } = interaction;

  if (!customId.startsWith('vp_')) return false;

  // ─── Управлять комнатой (ephemeral — видно только вызвавшему) ─
  if (customId === 'vp_manage_room') {
    const db = getDb();
    const room = db.prepare('SELECT * FROM user_voice_channels WHERE owner_id = ?').get(user.id);

    if (!room) {
      return interaction.reply({
        content: `❌ **У тебя нет активной комнаты.**\n\nЗайди в канал ${triggerChannelMention(guild.id)}, чтобы создать свою комнату.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Находим голосовой канал
    const voiceChannel = guild.channels.cache.get(room.voice_channel_id);
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Твой голосовой канал не найден.** Возможно, он был удалён.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Строим панель управления комнатой (embed + кнопки)
    const { buildRoomPanel } = await import('../commands/room-settings.js');
    const panel = buildRoomPanel(room, voiceChannel);

    await interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════
// АВТО-ОБНОВЛЕНИЕ ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

let updateTimer = null;

/**
 * Запускает периодическое обновление всех панелей.
 * @param {import('discord.js').Client} client
 */
export function startPanelAutoUpdate(client) {
  if (updateTimer) clearInterval(updateTimer);

  updateTimer = setInterval(async () => {
    for (const [, guild] of client.guilds.cache) {
      try {
        const cached = panelCache.get(guild.id);
        if (!cached) continue;

        const channel = guild.channels.cache.get(cached.channelId);
        if (!channel || !channel.isTextBased()) continue;

        const embed = buildVoicePanelEmbed(guild);
        const components = buildVoicePanelButtons();

        try {
          const message = await channel.messages.fetch(cached.messageId).catch(() => null);
          if (message) {
            await message.edit({ embeds: [embed], components });
          } else {
            // Сообщение удалено — создаём новое и сохраняем в БД
            const newMessage = await channel.send({ embeds: [embed], components });
            panelCache.set(guild.id, {
              messageId: newMessage.id,
              channelId: channel.id,
            });
            savePanelToDB(guild.id, newMessage.id, channel.id);
          }
        } catch {
          panelCache.delete(guild.id);
        }
      } catch (err) {
        // Игнорируем ошибки отдельных серверов
      }
    }
  }, PANEL_UPDATE_INTERVAL);

  console.log('[VOICE_PANEL] Авто-обновление панели запущено (интервал: 30с)');
}

/**
 * Останавливает авто-обновление панелей.
 */
export function stopPanelAutoUpdate() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

