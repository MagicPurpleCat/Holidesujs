import { getDb, ensureUser } from '../database.js';

/**
 * Инициализация прав владельца при старте бота.
 * Проверяет, есть ли OWNER_ID в таблице bot_permissions.
 * Если нет — создаёт запись с уровнем 3 (Owner).
 * Если есть — выводит текущий уровень.
 *
 * @param {import('discord.js').Client} client - экземпляр бота
 * @param {string} OWNER_ID - Discord ID владельца
 */
export function initializeOwnerRights(client, OWNER_ID, guildId = '') {
  if (!OWNER_ID) return;
  const db = getDb();

  // Гарантируем, что владелец существует в таблице users — это нужно,
  // потому что bot_permissions имеет FOREIGN KEY (user_id) REFERENCES users.
  // Даже при foreign_keys=OFF это корректно и защищает данные.
  ensureUser(OWNER_ID, guildId);

  // Проверяем, есть ли владелец в таблице прав
  const ownerPerm = db
    .prepare('SELECT level FROM bot_permissions WHERE user_id = ?')
    .get(OWNER_ID);

  if (!ownerPerm) {
    db.prepare(
      'INSERT INTO bot_permissions (user_id, level, granted_by) VALUES (?, 3, ?)'
    ).run(OWNER_ID, OWNER_ID);

    console.log(`✅ Владелец (ID: ${OWNER_ID}) успешно зарегистрирован как Owner`);
  } else if (ownerPerm.level < 3) {
    db.prepare('UPDATE bot_permissions SET level = 3, granted_by = ? WHERE user_id = ?')
      .run(OWNER_ID, OWNER_ID);
    console.log(`✅ Владелец (ID: ${OWNER_ID}) повышен до Owner (было ${ownerPerm.level})`);
  } else {
    // Владелец уже есть — просто информируем
    const levelLabel = ownerPerm.level === 3
      ? '👑 Owner'
      : ownerPerm.level === 2
        ? '🛠 Admin'
        : '🛡 Mod';

    console.log(`👤 Владелец уже имеет права уровня ${ownerPerm.level} (${levelLabel})`);
  }
}

