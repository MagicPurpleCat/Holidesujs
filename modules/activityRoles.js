// === МОДУЛЬ: ACTIVITY ROLES (Динамические роли по активности) ===
import { getDb } from '../database.js';

// Конфигурация рангов
// ⚠️ ВСТАВЬ СЮДА ID РОЛЕЙ ДЛЯ РАНГОВ
const RANK_CONFIG = [
  { title: 'Новичок', messages: 0, color: '#95a5a6', roleId: null },
  { title: 'Активный', messages: 100, color: '#3498db', roleId: null },
  { title: 'Ветеран', messages: 500, color: '#f1c40f', roleId: null },
  { title: 'Легенда', messages: 1500, color: '#e74c3c', roleId: null },
  { title: 'Миф', messages: 5000, color: '#9b59b6', roleId: null },
];

/**
 * Обновляет счётчик сообщений пользователя и проверяет повышение ранга.
 * Вызывается из события messageCreate.
 * 
 * ИСПРАВЛЕНИЕ: функция принимает member (GuildMember), а не (userId, guild).
 * Ранее вызывалась с (message.author.id, message.guild) — что приводило к ошибке.
 * 
 * @param {import('discord.js').GuildMember} member
 */
export async function updateActivityAndCheckRank(member) {
  try {
    if (!member || member.user.bot) return;

    const db = getDb();
    const userId = member.id;

    // Исправление: НЕ обновляем total_messages здесь — это делается в index.js.
    // Обновляем ТОЛЬКО user_activity.messages_count и проверяем ранг.

    // Получаем активность из БД (она уже обновлена в index.js)
    let activity = db.prepare('SELECT * FROM user_activity WHERE user_id = ?').get(userId);

    if (!activity) {
      // Если записи нет — создаём
      db.prepare("INSERT INTO user_activity (user_id, messages_count, last_message_at) VALUES (?, 1, datetime('now'))")
        .run(userId);
      activity = db.prepare('SELECT * FROM user_activity WHERE user_id = ?').get(userId);
    }

    // Проверяем повышение ранга
    await checkRankProgress(member, db, activity);
  } catch (error) {
    console.error('[ACTIVITY] Ошибка обновления активности:', error.message);
  }
}

/**
 * Проверяет и обновляет ранг пользователя на основе активности.
 * @param {import('discord.js').GuildMember} member
 * @param {import('better-sqlite3').Database} db
 * @param {object} activity — запись из user_activity
 */
export async function checkRankProgress(member, db, activity) {
  try {
    const msgCount = activity?.messages_count || 0;
    const currentTitle = activity?.rank_title || 'Новичок';

    // Определяем наивысший доступный ранг
    let newRank = RANK_CONFIG[0];
    for (let i = RANK_CONFIG.length - 1; i >= 0; i--) {
      if (msgCount >= RANK_CONFIG[i].messages) {
        newRank = RANK_CONFIG[i];
        break;
      }
    }

    // Если ранг не изменился — выходим
    if (newRank.title === currentTitle) return;

    // Находим старую роль для удаления
    const oldRank = RANK_CONFIG.find((r) => r.title === currentTitle);
    const oldRoleId = activity?.rank_role_id || oldRank?.roleId;

    // Удаляем старую роль, если она есть
    if (oldRoleId && member.roles.cache.has(oldRoleId)) {
      try {
        await member.roles.remove(oldRoleId);
      } catch { /* ignore */ }
    }

    // Выдаём новую роль
    const newRoleId = newRank.roleId;
    if (newRoleId) {
      try {
        await member.roles.add(newRoleId);
      } catch (err) {
        console.error(`[ACTIVITY] Ошибка выдачи роли ${newRoleId}:`, err.message);
      }
    }

    // Обновляем в БД
    db.prepare(`
      UPDATE user_activity SET rank_title = ?, rank_role_id = ? WHERE user_id = ?
    `).run(newRank.title, newRoleId, member.id);

    // Отправляем уведомление в ЛС
    try {
      const dm = await member.createDM();
      await dm.send({
        content: `🎉 **Повышение ранга!**\nТвой новый ранг: **${newRank.title}**\nСообщений: **${msgCount}**\n\nПродолжай в том же духе! 💪`,
      });
    } catch { /* ЛС закрыты */ }

    console.log(`[ACTIVITY] ${member.user.tag} повышен до ранга "${newRank.title}" (${msgCount} сообщений)`);
  } catch (error) {
    console.error('[ACTIVITY] Ошибка проверки ранга:', error.message);
  }
}

export { RANK_CONFIG };

