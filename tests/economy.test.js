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

test('баланс и XP изолированы по серверам', () => {
  ensureUser('u-split', 'guild-a');
  ensureUser('u-split', 'guild-b');
  addCoins('u-split', 40, 'guild-a');
  addXp('u-split', 350, 'guild-b');
  assert.equal(getUser('u-split', 'guild-a').balance, 140);
  assert.equal(getUser('u-split', 'guild-a').level, 1);
  assert.equal(getUser('u-split', 'guild-b').balance, 100);
  assert.equal(getUser('u-split', 'guild-b').level, 3);
});

test('casino_stats хранит статистику отдельно по серверам', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO casino_stats (guild_id, user_id, total_bet, total_won, total_lost)
    VALUES (?, ?, 10, 20, 0)
  `).run('g-casino-1', 'u-casino');
  db.prepare(`
    INSERT INTO casino_stats (guild_id, user_id, total_bet, total_won, total_lost)
    VALUES (?, ?, 5, 0, 5)
  `).run('g-casino-2', 'u-casino');
  const a = db.prepare('SELECT * FROM casino_stats WHERE guild_id = ? AND user_id = ?').get('g-casino-1', 'u-casino');
  const b = db.prepare('SELECT * FROM casino_stats WHERE guild_id = ? AND user_id = ?').get('g-casino-2', 'u-casino');
  assert.equal(a.total_won, 20);
  assert.equal(b.total_lost, 5);
});

test('клановый банк списывается только у выбранного клана', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO clans (name, tag, owner_id, bank_balance, guild_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('Alpha', 'ALP', 'u-leader', 500, 'g-clan');
  db.prepare(`
    INSERT INTO clans (name, tag, owner_id, bank_balance, guild_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('Beta', 'BET', 'u-leader-2', 500, 'g-clan');
  const first = db.prepare('SELECT clan_id FROM clans WHERE tag = ? AND guild_id = ?').get('ALP', 'g-clan');
  db.prepare('UPDATE clans SET bank_balance = bank_balance - ? WHERE clan_id = ? AND bank_balance >= ?')
    .run(100, first.clan_id, 100);
  const alpha = db.prepare('SELECT bank_balance FROM clans WHERE tag = ? AND guild_id = ?').get('ALP', 'g-clan');
  const beta = db.prepare('SELECT bank_balance FROM clans WHERE tag = ? AND guild_id = ?').get('BET', 'g-clan');
  assert.equal(alpha.bank_balance, 400);
  assert.equal(beta.bank_balance, 500);
});

test('покупка в магазине не проходит без денег на этом сервере', () => {
  ensureUser('u-shop', 'g-shop');
  assert.equal(removeCoins('u-shop', 9999, 'g-shop'), false);
  assert.equal(getUser('u-shop', 'g-shop').balance, 100);
  assert.equal(removeCoins('u-shop', 30, 'g-shop'), true);
  assert.equal(getUser('u-shop', 'g-shop').balance, 70);
});
