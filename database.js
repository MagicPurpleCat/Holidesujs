// База данных: встроенный node:sqlite (DatabaseSync), Node 22.5+.

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

function resolveDbPath() {
  return process.env.HOLIDESU_DB_PATH || path.join(dataDir, 'holidesu.db');
}

let db;

// ══════════════════════════════════════════════════════════════════
// КЭШ П  ГОТОВЛЕННЫХ ЗАПРОСОВ (Prepare Cache)
// ══════════════════════════════════════════════════════════════════
// Все db.prepare() кэшируются здесь, чтобы не создавать
// новый объект Statement при каждом вызове функции.
// Это даёт прирост производительности ~10x.
// ══════════════════════════════════════════════════════════════════
const stmtCache = new Map();

/**
 * Получает кэшированный подготовленный запрос.
 * Если запрос не кэширован — создаёт и кэширует.
 * @param {string} sql — SQL-запрос
 * @returns {import('better-sqlite3').Statement}
 */
function prepare(sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql);
}

/**
 * Initializes the SQLite database and creates all required tables.
 * Call this once on bot startup before any commands are used.
 */
export function initDatabase() {
  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('[DB] Created data directory.');
  }

  db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrent read performance
  // (node:sqlite не имеет метода .pragma — PRAGMA выполняется через exec)
  db.exec('PRAGMA journal_mode = WAL;');

  // ВАЖНО: node:sqlite включает проверку внешних ключей (foreign_keys=ON)
  // по умолчанию, а better-sqlite3 — нет (было OFF). Чтобы поведение
  // совпало с прежним и не ломать вставки, где родительская запись
  // (например, users) ещё не создана, отключаем проверку FK.
  db.exec('PRAGMA foreign_keys = OFF;');

  // ─── Core economy tables ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      total_xp INTEGER NOT NULL DEFAULT 0,
      is_infinite_balance INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_voice_farm TEXT DEFAULT NULL,
      total_voice_minutes INTEGER NOT NULL DEFAULT 0,
      last_voice_reset_time TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      item_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('role', 'boost', 'cosmetic')),
      role_id TEXT DEFAULT NULL,
      duration_hours INTEGER DEFAULT NULL,
      stock INTEGER DEFAULT -1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (item_id) REFERENCES shop_items(item_id)
    );

    CREATE TABLE IF NOT EXISTS voice_farm_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      earned INTEGER NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Tables for future modules (stubs) ─────────────────────────
  db.exec(`

    -- Casino: tracks gambling stats and cooldowns
    CREATE TABLE IF NOT EXISTS casino_stats (
      user_id TEXT PRIMARY KEY,
      total_bet INTEGER NOT NULL DEFAULT 0,
      total_won INTEGER NOT NULL DEFAULT 0,
      total_lost INTEGER NOT NULL DEFAULT 0,
      last_daily TEXT DEFAULT NULL,
      last_slot_spin TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    -- Verification: stores verification status and linked accounts
    CREATE TABLE IF NOT EXISTS verification (
      user_id TEXT PRIMARY KEY,
      verified INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT DEFAULT NULL,
      verified_by TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    -- Clans: guild-based groups with shared banks and wars
    CREATE TABLE IF NOT EXISTS clans (
      clan_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      bank_balance INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, name),
      UNIQUE(guild_id, tag),
      FOREIGN KEY (owner_id) REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS clan_members (
      clan_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'officer', 'leader')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (clan_id, user_id),
      FOREIGN KEY (clan_id) REFERENCES clans(clan_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    -- Moderation: logs warns, mutes, kicks for mod panel
    CREATE TABLE IF NOT EXISTS moderation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK(action IN ('warn', 'mute', 'kick', 'ban', 'unmute', 'unban')),
      moderator_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      duration_seconds INTEGER DEFAULT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Relationships table (брак/отношения) ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'married' CHECK(status IN ('married', 'divorced', 'engaged')),
      married_at TEXT NOT NULL DEFAULT (datetime('now')),
      divorced_at TEXT DEFAULT NULL,
      FOREIGN KEY (user1_id) REFERENCES users(user_id),
      FOREIGN KEY (user2_id) REFERENCES users(user_id)
    );
  `);

  // ─── User activity table (активность для динамических ролей) ───────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activity (
      user_id TEXT PRIMARY KEY,
      messages_count INTEGER NOT NULL DEFAULT 0,
      voice_minutes_total INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT DEFAULT NULL,
      last_voice_join_at TEXT DEFAULT NULL,
      rank_title TEXT NOT NULL DEFAULT 'Новичок',
      rank_role_id TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  // ─── User settings table (приватность и настройки) ─────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      allow_marriage_requests INTEGER NOT NULL DEFAULT 1,
      show_relationship INTEGER NOT NULL DEFAULT 1,
      allow_dm_notifications INTEGER NOT NULL DEFAULT 1,
      allow_profile_mentions INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  // ─── Channel permissions table (настройка ролей и прав) ────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      required_role_id TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'view' CHECK(action_type IN ('view', 'send', 'read_history', 'all')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Punishments table (история наказаний, расширенная) ────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS punishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('warn', 'mute', 'kick', 'ban', 'unmute', 'unban', 'timeout')),
      reason TEXT DEFAULT '',
      duration_seconds INTEGER DEFAULT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  // ─── Добавляем колонки gender, relationship_status, relationship_partner_id, total_messages в users ──
  const usersTableInfo = db.prepare("PRAGMA table_info('users')").all();
  if (!usersTableInfo.some(col => col.name === 'gender')) {
    db.exec("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT NULL CHECK(gender IN ('male', 'female', 'other'))");
    console.log('[DB] Added column gender to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'relationship_status')) {
    db.exec("ALTER TABLE users ADD COLUMN relationship_status TEXT DEFAULT 'single' CHECK(relationship_status IN ('single', 'married', 'engaged', 'divorced'))");
    console.log('[DB] Added column relationship_status to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'relationship_partner_id')) {
    db.exec("ALTER TABLE users ADD COLUMN relationship_partner_id TEXT DEFAULT NULL");
    console.log('[DB] Added column relationship_partner_id to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'total_messages')) {
    db.exec("ALTER TABLE users ADD COLUMN total_messages INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added column total_messages to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'total_reactions_received')) {
    db.exec("ALTER TABLE users ADD COLUMN total_reactions_received INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added column total_reactions_received to users table.');
  }
  // Колонки профиля: раньше были только в migrations/add-profile-settings.sql.
  if (!usersTableInfo.some(col => col.name === 'personal_note')) {
    db.exec("ALTER TABLE users ADD COLUMN personal_note TEXT DEFAULT NULL");
    console.log('[DB] Added column personal_note to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'status_text')) {
    db.exec("ALTER TABLE users ADD COLUMN status_text TEXT DEFAULT NULL");
    console.log('[DB] Added column status_text to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'custom_background_id')) {
    db.exec("ALTER TABLE users ADD COLUMN custom_background_id TEXT DEFAULT NULL");
    console.log('[DB] Added column custom_background_id to users table.');
  }
  if (!usersTableInfo.some(col => col.name === 'show_gender')) {
    db.exec("ALTER TABLE users ADD COLUMN show_gender INTEGER NOT NULL DEFAULT 1");
    console.log('[DB] Added column show_gender to users table.');
  }

  // ─── Active boosts table (активные бусты) ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_boosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      boost_type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      xp_multiplier REAL NOT NULL DEFAULT 1.0,
      coin_multiplier REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  // ─── Custom roles table (магазин ролей) ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_role_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      color_hex TEXT NOT NULL DEFAULT '#5865F2',
      price INTEGER NOT NULL DEFAULT 5000,
      is_for_sale INTEGER NOT NULL DEFAULT 0,
      current_holders INTEGER NOT NULL DEFAULT 0,
      max_holders INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (creator_id) REFERENCES users(user_id)
    );
  `);

  // ─── Voice channels (Join-to-Create, БЕЗ текстового канала) ──────
  // ВНИМАНИЕ: таблица была изменена — убрано поле text_channel_id.
  // Если у вас старая таблица, выполните в SQLite:
  //   CREATE TABLE IF NOT EXISTS user_voice_channels_new (
  //     id INTEGER PRIMARY KEY AUTOINCREMENT,
  //     owner_id TEXT NOT NULL,
  //     voice_channel_id TEXT NOT NULL UNIQUE,
  //     is_locked INTEGER NOT NULL DEFAULT 0,
  //     created_at TEXT NOT NULL DEFAULT (datetime('now')),
  //     FOREIGN KEY (owner_id) REFERENCES users(user_id)
  //   );
  //   INSERT INTO user_voice_channels_new SELECT id, owner_id, voice_channel_id, is_locked, created_at FROM user_voice_channels;
  //   DROP TABLE user_voice_channels;
  //   ALTER TABLE user_voice_channels_new RENAME TO user_voice_channels;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_voice_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      voice_channel_id TEXT NOT NULL UNIQUE,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(user_id)
    );
  `);

// ─── Voice panel messages (персистентность ID сообщения панели) ─
  // Сохраняет ID сообщения голосовой панели, чтобы при перезапуске
  // бот обновлял существующее сообщение, а не создавал новое.
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_panel_messages (
      guild_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Server config (настройки сервера через /setup) ──────────────
  // ВАЖНО: таблица `server_config` (без "s") используется модулем
  // voicePanel.js при инициализации голосовой панели для каждого сервера.
  // Раньше она создавалась только при вызове /setup — из-за этого при
  // старте бота возникала ошибка "no such table: server_config".
  // Теперь создаём её автоматически, чтобы она всегда существовала.
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_config (
      guild_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      admin_roles TEXT NOT NULL DEFAULT '[]',
      channels TEXT NOT NULL DEFAULT '{}',
      setup_date TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT DEFAULT ''
    );
  `);

  // ─── Verification attempts (капча) ───────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      captcha_code TEXT NOT NULL,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

// ─── Bot permissions table (owner=3, admin=2, moderator=1) ──────
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_permissions (
      user_id TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1 CHECK(level IN (1, 2, 3)),
      granted_by TEXT DEFAULT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  // ─── Guild log config table (настройки логирования сервера) ─────
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_log_config (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT DEFAULT NULL,
      level TEXT NOT NULL DEFAULT 'all' CHECK(level IN ('all', 'important', 'moderation', 'off')),
      role_view_all TEXT DEFAULT NULL,
      role_view_important TEXT DEFAULT NULL,
      role_view_moderation TEXT DEFAULT NULL,
      channel_all TEXT DEFAULT NULL,
      channel_important TEXT DEFAULT NULL,
      channel_moderation TEXT DEFAULT NULL,
      ping_role_all TEXT DEFAULT NULL,
      ping_role_important TEXT DEFAULT NULL,
      ping_role_moderation TEXT DEFAULT NULL,
      ping_target INTEGER NOT NULL DEFAULT 1,
      ping_actor INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Log events table (история событий логов) ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'all',
      target_id TEXT DEFAULT NULL,
      target_name TEXT DEFAULT NULL,
      actor_id TEXT DEFAULT NULL,
      details TEXT DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Добавляем колонку is_verified в users (если нет) ────────────
  const tableInfo = db.prepare("PRAGMA table_info('users')").all();
  const hasIsVerified = tableInfo.some(col => col.name === 'is_verified');
  if (!hasIsVerified) {
    db.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added column is_verified to users table.');
  }

  // ─── Добавляем колонку total_activity_score в users (если нет) ───
  const hasTotalActivityScore = tableInfo.some(col => col.name === 'total_activity_score');
  if (!hasTotalActivityScore) {
    db.exec("ALTER TABLE users ADD COLUMN total_activity_score REAL NOT NULL DEFAULT 0.0");
    console.log('[DB] Added column total_activity_score to users table.');
  }

  // ─── Колонки ping для guild_log_config (если нет) ──────────────
  const logConfigInfo = db.prepare("PRAGMA table_info('guild_log_config')").all();
  const hasPingRoleAll = logConfigInfo.some(col => col.name === 'ping_role_all');
  if (!hasPingRoleAll) {
    db.exec("ALTER TABLE guild_log_config ADD COLUMN ping_role_all TEXT DEFAULT NULL");
    console.log('[DB] Added column ping_role_all to guild_log_config.');
  }
  const hasPingRoleImportant = logConfigInfo.some(col => col.name === 'ping_role_important');
  if (!hasPingRoleImportant) {
    db.exec("ALTER TABLE guild_log_config ADD COLUMN ping_role_important TEXT DEFAULT NULL");
    console.log('[DB] Added column ping_role_important to guild_log_config.');
  }
  const hasPingRoleModeration = logConfigInfo.some(col => col.name === 'ping_role_moderation');
  if (!hasPingRoleModeration) {
    db.exec("ALTER TABLE guild_log_config ADD COLUMN ping_role_moderation TEXT DEFAULT NULL");
    console.log('[DB] Added column ping_role_moderation to guild_log_config.');
  }
  const hasPingTarget = logConfigInfo.some(col => col.name === 'ping_target');
  if (!hasPingTarget) {
    db.exec("ALTER TABLE guild_log_config ADD COLUMN ping_target INTEGER NOT NULL DEFAULT 1");
    console.log('[DB] Added column ping_target to guild_log_config.');
  }
  const hasPingActor = logConfigInfo.some(col => col.name === 'ping_actor');
  if (!hasPingActor) {
    db.exec("ALTER TABLE guild_log_config ADD COLUMN ping_actor INTEGER NOT NULL DEFAULT 1");
    console.log('[DB] Added column ping_actor to guild_log_config.');
  }

  // ─── Добавляем колонку is_infinite_balance в users (если нет) ────
  // Исправляет ошибку: SqliteError: no such column: is_infinite_balance
  const hasInfiniteBalance = tableInfo.some(col => col.name === 'is_infinite_balance');
  if (!hasInfiniteBalance) {
    db.exec("ALTER TABLE users ADD COLUMN is_infinite_balance INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added column is_infinite_balance to users table.');
  }

  // ─── Добавляем колонку total_xp в users (если нет) ─────────────────
  // Исправляет ошибку: SqliteError: no such column: total_xp
  const hasTotalXp = tableInfo.some(col => col.name === 'total_xp');
  if (!hasTotalXp) {
    db.exec("ALTER TABLE users ADD COLUMN total_xp INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added column total_xp to users table.');
  }

  // ─── Добавляем колонку last_voice_reset_time в users (если нет) ───
  const hasLastVoiceReset = tableInfo.some(col => col.name === 'last_voice_reset_time');
  if (!hasLastVoiceReset) {
    db.exec("ALTER TABLE users ADD COLUMN last_voice_reset_time TEXT DEFAULT NULL");
    console.log('[DB] Added column last_voice_reset_time to users table.');
  }

  const serverConfigInfo = db.prepare("PRAGMA table_info('server_config')").all();
  if (!serverConfigInfo.some((col) => col.name === 'features')) {
    db.exec("ALTER TABLE server_config ADD COLUMN features TEXT NOT NULL DEFAULT '{}'");
    console.log('[DB] Added column features to server_config.');
  }
  if (!serverConfigInfo.some((col) => col.name === 'prefix')) {
    db.exec("ALTER TABLE server_config ADD COLUMN prefix TEXT NOT NULL DEFAULT '/'");
    console.log('[DB] Added column prefix to server_config.');
  }

  migrateClansGuildScope();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ephemeral_state (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL DEFAULT '{}',
      expires_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS db_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('[DB] Database initialized successfully.');
  return db;
}

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function migrateClansGuildScope() {
  if (!tableExists('clans')) return;
  const info = db.prepare("PRAGMA table_info('clans')").all();
  if (info.some((col) => col.name === 'guild_id')) return;

  db.exec(`
    CREATE TABLE clans_guilded (
      clan_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      bank_balance INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, name),
      UNIQUE(guild_id, tag)
    );
    INSERT INTO clans_guilded (clan_id, guild_id, name, tag, owner_id, bank_balance, level, xp, created_at)
    SELECT clan_id, '', name, tag, owner_id, bank_balance, level, xp, created_at FROM clans;
    DROP TABLE clans;
    ALTER TABLE clans_guilded RENAME TO clans;
  `);
  stmtCache.clear();
  console.log('[DB] Migrated clans to guild-scoped unique tags.');
}

/**
 * Returns the database instance. Throws if not initialized.
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/**
 * Gracefully closes the database connection.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    stmtCache.clear();
    console.log('[DB] Connection closed.');
  }
}

export function runInTransaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function setEphemeral(key, payload, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  getDb().prepare(`
    INSERT INTO ephemeral_state (key, payload, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
  `).run(key, JSON.stringify(payload ?? {}), expiresAt);
}

export function getEphemeral(key) {
  const dbh = getDb();
  dbh.prepare('DELETE FROM ephemeral_state WHERE expires_at <= ?').run(Date.now());
  const row = dbh.prepare('SELECT payload, expires_at FROM ephemeral_state WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export function deleteEphemeral(key) {
  getDb().prepare('DELETE FROM ephemeral_state WHERE key = ?').run(key);
}

export function logPunishment({
  userId,
  moderatorId,
  action,
  reason = '',
  durationSeconds = null,
  expiresAtSql = null,
}) {
  const dbh = getDb();
  ensureUser(userId);
  if (expiresAtSql && durationSeconds != null) {
    dbh.prepare(`
      INSERT INTO punishments (user_id, moderator_id, action, reason, duration_seconds, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', ?))
    `).run(userId, moderatorId, action, reason, durationSeconds, expiresAtSql);
  } else {
    dbh.prepare(`
      INSERT INTO punishments (user_id, moderator_id, action, reason, duration_seconds)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, moderatorId, action, reason, durationSeconds);
  }

  const logAction = action === 'timeout' ? 'mute' : action;
  if (['warn', 'mute', 'kick', 'ban', 'unmute', 'unban'].includes(logAction)) {
    dbh.prepare(`
      INSERT INTO moderation_log (action, moderator_id, target_id, reason, duration_seconds)
      VALUES (?, ?, ?, ?, ?)
    `).run(logAction, moderatorId, userId, reason, durationSeconds);
  }
}

// ─── Helper functions ─────────────────────────────────────────────

/**
 * Ensures a user row exists. Creates one with defaults if missing.
 */
export function ensureUser(userId) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (user_id, balance, xp, level)
    VALUES (?, 100, 0, 1)
  `);
  stmt.run(userId);
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

/**
 * Atomically adds coins to a user's balance.
 */
export function addCoins(userId, amount) {
  ensureUser(userId);
  db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, userId);
}

/**
 * Atomically removes coins. Returns false if insufficient balance.
 */
export function removeCoins(userId, amount) {
  ensureUser(userId);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return false;
  const user = db.prepare('SELECT is_infinite_balance FROM users WHERE user_id = ?').get(userId);
  if (user?.is_infinite_balance) return true;
  const result = db.prepare(
    'UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?',
  ).run(n, userId, n);
  return result.changes > 0;
}

/**
 * Returns the full user profile or null.
 */
export function getUser(userId) {
  ensureUser(userId);
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

/**
 * Добавляет XP и обрабатывает повышение уровня (в том числе сразу на несколько).
 * @returns {{ oldLevel: number, newLevel: number } | null} — null, если уровень не изменился
 */
export function addXp(userId, amount) {
  ensureUser(userId);
  const user = db.prepare('SELECT xp, level, total_xp FROM users WHERE user_id = ?').get(userId);
  const oldLevel = user.level;
  let currentXp = user.xp + amount;
  let currentLevel = user.level;

  db.prepare('UPDATE users SET total_xp = total_xp + ? WHERE user_id = ?').run(amount, userId);

  while (currentLevel < 100) {
    const xpForNextLevel = currentLevel * 100;
    if (currentXp < xpForNextLevel) break;
    currentXp -= xpForNextLevel;
    currentLevel++;
  }

  db.prepare('UPDATE users SET xp = ?, level = ? WHERE user_id = ?').run(currentXp, currentLevel, userId);

  if (currentLevel === oldLevel) return null;
  return { oldLevel, newLevel: currentLevel };
}

/**
 * Снимает XP и обрабатывает понижение уровня.
 * Возвращает новый уровень если понижен, иначе null.
 * Вычитает из total_xp (но не ниже 0).
 */
export function removeXp(userId, amount) {
  ensureUser(userId);
  const user = db.prepare('SELECT xp, level, total_xp FROM users WHERE user_id = ?').get(userId);

  // Уменьшаем total_xp (не ниже 0)
  const newTotalXp = Math.max(0, user.total_xp - amount);
  db.prepare('UPDATE users SET total_xp = ? WHERE user_id = ?').run(newTotalXp, userId);

  let currentXp = user.xp - amount;
  let currentLevel = user.level;

  // Если XP стал отрицательным — понижаем уровень
  while (currentXp < 0 && currentLevel > 1) {
    currentLevel--;
    const xpForPrevLevel = currentLevel * 100;
    currentXp = xpForPrevLevel + currentXp; // currentXp отрицательный, добавляем XP предыдущего уровня
  }

  // Не даём уйти ниже 1 уровня и 0 XP
  if (currentLevel < 1) currentLevel = 1;
  if (currentXp < 0) currentXp = 0;

  db.prepare('UPDATE users SET xp = ?, level = ? WHERE user_id = ?').run(currentXp, currentLevel, userId);

  if (currentLevel !== user.level) return currentLevel;
  return null;
}

