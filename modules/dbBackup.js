import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const KEEP = 7;

function backupNow() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const db = getDb();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `holidesu-${stamp}.db`);

    if (typeof db.backup === 'function') {
      db.backup(dest);
    } else {
      const src = process.env.HOLIDESU_DB_PATH || path.join(__dirname, '..', 'data', 'holidesu.db');
      if (!fs.existsSync(src)) return null;
      fs.copyFileSync(src, dest);
    }

    db.prepare('INSERT INTO db_backups (path) VALUES (?)').run(dest);
    pruneOldBackups();
    console.log(`[BACKUP] Сохранена копия: ${dest}`);
    return dest;
  } catch (err) {
    console.error('[BACKUP] Ошибка:', err.message);
    return null;
  }
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const file of files.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, file.name));
  }
}

let backupLoopStarted = false;

export function startDbBackupLoop() {
  if (backupLoopStarted) return;
  backupLoopStarted = true;
  backupNow();
  setInterval(backupNow, INTERVAL_MS);
}

export { backupNow };
