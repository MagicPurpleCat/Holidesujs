// === МОДУЛЬ: ANTI-SPAM (Анти-спам с юмором) ===
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb } from '../database.js';

// Хранилище дубликатов сообщений: Map<guildId:userId, { content, count, lastWarnAt }>
const duplicateTracker = new Map();

function trackerKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

// Время сброса счётчика (5 секунд)
const RESET_INTERVAL = 5_000;

// Шутки для ответа на дубликаты
const JOKES = [
  'Эй, эхо! Ты повторяешься 🗣️',
  'Кажется, твой Ctrl+C застрял. Помочь? ⌨️',
  'Мы поняли с первого раза! И со второго тоже! 😅',
  'Ты что, винил? Заело пластинку? 💿',
  'Ой, всё! Мы запомнили! 🙈',
  'Кто-то тренирует пальцы? Макака-печатник? 🐒',
  'Этот чат — не Notepad. Текст уже сохранился! 💾',
  'Твой микрофон в чате даёт дубль! 🎤',
  'Нажми F5, может отпустит? 😂',
];

/**
 * Проверяет сообщение на дубликаты и принимает меры.
 * Возвращает true, если нужно заблокировать сообщение (удалить).
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>}
 */
export async function checkAntiSpam(message) {
  try {
    if (message.author.bot || !message.guild) return false;

    const userId = message.author.id;
    const guildId = message.guild.id;
    const key = trackerKey(guildId, userId);
    const content = message.content.toLowerCase().trim();

    // Игнорируем короткие сообщения (меньше 5 символов)
    if (content.length < 5) return false;

    const now = Date.now();
    const tracker = duplicateTracker.get(key);

    // Если нет трекера или прошло больше RESET_INTERVAL — сбрасываем
    if (!tracker || (now - tracker.lastWarnAt) > RESET_INTERVAL) {
      duplicateTracker.set(key, { content, count: 1, lastWarnAt: now });
      return false;
    }

    // Проверяем дубликат
    if (tracker.content === content) {
      tracker.count += 1;

      // Первый повтор — шутка
      if (tracker.count === 2) {
        const joke = JOKES[Math.floor(Math.random() * JOKES.length)];

        const embed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🗣️ Анти-спам система')
          .setDescription(`**${message.author.displayName}**, ${joke}`)
          .setFooter({ text: 'Повторная отправка того же сообщения будет удалена' })

        await message.reply({ embeds: [embed] });
        tracker.lastWarnAt = now;
        return false;
      }

      // Второй повтор (3-е сообщение) — удаляем + предупреждение в ЛС
      if (tracker.count >= 3) {
        // Удаляем сообщение
        await message.delete().catch(() => {});

        // Отправляем предупреждение в ЛС
        try {
          const dm = await message.author.createDM();
          await dm.send({
            content: `⚠️ **Анти-спам**\n\nТвоё сообщение было удалено на сервере **${message.guild.name}**.\n**Причина:** повторяющееся сообщение (${tracker.count} раз).\n\nПожалуйста, не спамь! 🙏`,
          });
        } catch { /* ЛС закрыты */ }

        // Сбрасываем счётчик
        duplicateTracker.delete(key);
        return true; // сообщение удалено
      }
    } else {
      // Новое сообщение — сбрасываем
      duplicateTracker.set(key, { content, count: 1, lastWarnAt: now });
    }

    return false;
  } catch (error) {
    console.error('[ANTI-SPAM] Ошибка:', error.message);
    return false;
  }
}

