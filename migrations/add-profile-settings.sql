-- ══════════════════════════════════════════════════════════════════
-- MIGRATION: add-profile-settings.sql
-- ══════════════════════════════════════════════════════════════════
-- Добавляет колонки для кастомного профиля в таблицу users.
-- Запустить ОДИН РАЗ вручную через утилиту SQLite.
--
-- Как запустить:
--   Windows: sqlite3 data/holidesu.db < migrations/add-profile-settings.sql
--   Или открыть data/holidesu.db в DB Browser for SQLite и выполнить код ниже.
-- ══════════════════════════════════════════════════════════════════

-- Колонка: ID фона из инвентаря (item_id из shop_items, где type = 'background')
ALTER TABLE users ADD COLUMN custom_background_id TEXT DEFAULT NULL;

-- Колонка: Личная заметка пользователя (до 150 символов)
ALTER TABLE users ADD COLUMN personal_note TEXT DEFAULT NULL;

-- Колонка: Показывать ли гендер на Canvas-картинке (1 = да, 0 = нет)
ALTER TABLE users ADD COLUMN show_gender INTEGER NOT NULL DEFAULT 1;

-- ══════════════════════════════════════════════════════════════════
-- Проверка: если колонки уже существуют — ошибки не будет,
-- SQLite просто проигнорирует ALTER TABLE для существующей колонки.
-- Но для надёжности используйте PRAGMA table_info('users')
-- перед выполнением, чтобы убедиться, что колонок ещё нет.
-- ══════════════════════════════════════════════════════════════════

-- Пример проверки:
-- SELECT name FROM pragma_table_info('users') WHERE name IN ('custom_background_id', 'personal_note', 'show_gender');
-- Если запрос вернул 0 строк — колонок нет, можно выполнять ALTER TABLE.

