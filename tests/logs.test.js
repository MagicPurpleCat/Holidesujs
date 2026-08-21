import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(os.tmpdir(), `holidesu-logs-${process.pid}-${Date.now()}.db`);
process.env.HOLIDESU_DB_PATH = tmpDb;

const { initDatabase, closeDatabase } = await import('../database.js');
const {
  saveLogConfig,
  getLogConfig,
  getLogChecklist,
  levelLabel,
  LOG_LEVELS,
} = await import('../modules/logger.js');
const { LG } = await import('../modules/logs/ids.js');

before(() => initDatabase());
after(() => {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = tmpDb + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('константы логов', () => {
  assert.ok(LG.home.startsWith('lg:'));
  assert.equal(levelLabel('all'), 'Все события');
  assert.ok(LOG_LEVELS.moderation);
});

test('getLogChecklist отражает конфиг', () => {
  const g = 'g-logs-test';
  saveLogConfig(g, {
    channelId: 'c1',
    channelAll: 'c-all',
    channelImportant: 'c-imp',
    channelModeration: 'c-mod',
    level: LOG_LEVELS.all,
    pingTarget: 0,
    pingActor: 0,
  });
  const cfg = getLogConfig(g);
  assert.equal(cfg.channel_all, 'c-all');
  const list = getLogChecklist(g);
  assert.equal(list.ready, true);
  assert.equal(list.level, 'all');
});
