import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(os.tmpdir(), `holidesu-test-${process.pid}-${Date.now()}.db`);
process.env.HOLIDESU_DB_PATH = tmpDb;

const {
  initDatabase,
  closeDatabase,
  ensureUser,
  addCoins,
  removeCoins,
  addXp,
  getUser,
  getDb,
  logPunishment,
  runInTransaction,
  setEphemeral,
  getEphemeral,
} = await import('../database.js');

before(() => {
  initDatabase();
});

after(() => {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = tmpDb + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('ensureUser создаёт пользователя со 100 ⚡HLD', () => {
  const user = ensureUser('u-start');
  assert.equal(user.balance, 100);
  assert.equal(user.level, 1);
  assert.equal(user.xp, 0);
});

test('addCoins и removeCoins атомарно меняют баланс', () => {
  ensureUser('u-coins');
  addCoins('u-coins', 50);
  assert.equal(getUser('u-coins').balance, 150);
  assert.equal(removeCoins('u-coins', 40), true);
  assert.equal(getUser('u-coins').balance, 110);
  assert.equal(removeCoins('u-coins', 9999), false);
  assert.equal(getUser('u-coins').balance, 110);
});

test('runInTransaction откатывает списание при ошибке', () => {
  ensureUser('u-tx');
  const beforeBal = getUser('u-tx').balance;
  assert.throws(() => {
    runInTransaction(() => {
      const ok = removeCoins('u-tx', 10);
      assert.equal(ok, true);
      throw new Error('FORCE_ROLLBACK');
    });
  });
  assert.equal(getUser('u-tx').balance, beforeBal);
});

test('addXp повышает сразу на несколько уровней', () => {
  ensureUser('u-xp');
  const result = addXp('u-xp', 350);
  assert.ok(result);
  assert.equal(result.oldLevel, 1);
  assert.equal(result.newLevel, 3);
  const user = getUser('u-xp');
  assert.equal(user.level, 3);
  assert.equal(user.xp, 50);
});

test('logPunishment пишет в punishments и moderation_log', () => {
  logPunishment({
    userId: 'u-target',
    moderatorId: 'u-mod',
    action: 'warn',
    reason: 'тест',
  });
  const db = getDb();
  const pun = db.prepare('SELECT * FROM punishments WHERE user_id = ?').get('u-target');
  const log = db.prepare('SELECT * FROM moderation_log WHERE target_id = ?').get('u-target');
  assert.equal(pun.action, 'warn');
  assert.equal(pun.reason, 'тест');
  assert.equal(log.action, 'warn');
  assert.equal(log.moderator_id, 'u-mod');
});

test('ephemeral_state сохраняет JSON до истечения TTL', () => {
  setEphemeral('test:key', { hello: 1 }, 60_000);
  assert.deepEqual(getEphemeral('test:key'), { hello: 1 });
});
