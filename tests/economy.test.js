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

test('ежедневные квесты выдают награду один раз', async () => {
  const { bumpQuest, claimDailyQuest, utcDayKey } = await import('../modules/progress.js');
  const g = 'g-quest';
  const u = 'u-quest';
  ensureUser(u, g);
  bumpQuest(u, g, 'messages', 15);
  bumpQuest(u, g, 'voice_minutes', 10);
  bumpQuest(u, g, 'casino_bets', 1);
  const first = claimDailyQuest(u, g);
  assert.equal(first.ok, true);
  assert.ok(first.reward >= 150);
  const second = claimDailyQuest(u, g);
  assert.equal(second.ok, false);
  const row = getDb().prepare(
    'SELECT claimed FROM daily_quests WHERE guild_id = ? AND user_id = ? AND day_key = ?',
  ).get(g, u, utcDayKey());
  assert.equal(row.claimed, 1);
});

test('семейный банк делится пополам', async () => {
  const { getOrCreateFamilyBank, splitFamilyBank } = await import('../modules/progress.js');
  const g = 'g-fam';
  ensureUser('a-fam', g);
  ensureUser('b-fam', g);
  getOrCreateFamilyBank(g, 'a-fam', 'b-fam');
  getDb().prepare('UPDATE family_bank SET balance = 100 WHERE guild_id = ?').run(g);
  const beforeA = getUser('a-fam', g).balance;
  const beforeB = getUser('b-fam', g).balance;
  const result = splitFamilyBank(g, 'a-fam', 'b-fam');
  assert.equal(result.each, 50);
  assert.equal(getUser('a-fam', g).balance, beforeA + 50);
  assert.equal(getUser('b-fam', g).balance, beforeB + 50);
});

test('брак записывается по серверу и развод делит семейный банк', async () => {
  const { storeProposal, getActiveProposal, clearProposal, divorceUser, getMarriageRecord } = await import('../modules/relationships.js');
  const { getOrCreateFamilyBank } = await import('../modules/progress.js');
  const g = 'g-marry';
  const a = 'u-m-a';
  const b = 'u-m-b';
  ensureUser(a, g);
  ensureUser(b, g);

  storeProposal(g, a, b, { messageId: '1' });
  assert.ok(getActiveProposal(g, a, b));
  clearProposal(g, a, b);
  assert.equal(getActiveProposal(g, a, b), null);

  getDb().prepare(`
    UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
    WHERE guild_id = ? AND user_id = ?
  `).run(b, g, a);
  getDb().prepare(`
    UPDATE users SET relationship_status = 'married', relationship_partner_id = ?
    WHERE guild_id = ? AND user_id = ?
  `).run(a, g, b);
  getDb().prepare(`
    INSERT INTO relationships (guild_id, user1_id, user2_id, status) VALUES (?, ?, ?, 'married')
  `).run(g, a, b);

  getOrCreateFamilyBank(g, a, b);
  getDb().prepare('UPDATE family_bank SET balance = 200 WHERE guild_id = ?').run(g);

  const result = divorceUser(a, g);
  assert.equal(result.success, true);
  assert.equal(result.split.each, 100);
  assert.equal(getUser(a, g).relationship_status, 'divorced');
  assert.equal(getUser(b, g).relationship_status, 'divorced');
  assert.equal(getMarriageRecord(g, a), undefined);
});

test('каталог содержит ровно 1000 достижений', async () => {
  const { ACHIEVEMENT_TOTAL } = await import('../modules/progress.js');
  assert.equal(ACHIEVEMENT_TOTAL, 1000);
});

test('достижения и косметика пишутся один раз', async () => {
  const { unlockAchievement, grantCosmetic, ownsCosmetic, listAchievements, checkEconomyAchievements } = await import('../modules/progress.js');
  const g = 'g-ach';
  const u = 'u-ach';
  ensureUser(u, g);
  assert.equal(unlockAchievement(u, g, 'rich_10k'), true);
  assert.equal(unlockAchievement(u, g, 'rich_10k'), false);
  assert.equal(listAchievements(u, g).length, 1);
  grantCosmetic(u, g, 'frame_gold');
  grantCosmetic(u, g, 'frame_gold');
  assert.equal(ownsCosmetic(u, g, 'frame_gold'), true);

  getDb().prepare('UPDATE users SET total_messages = ?, total_reactions_received = ?, level = ? WHERE guild_id = ? AND user_id = ?')
    .run(1000, 50, 25, g, u);
  checkEconomyAchievements(u, g);
  const keys = listAchievements(u, g).map((a) => a.key);
  assert.ok(keys.includes('messages_1k'));
  assert.ok(keys.includes('reputation_50'));
  assert.ok(keys.includes('level_25'));
});

test('overallScore нормализует метрики в диапазон 0..10000', async () => {
  const { overallScore, OVERALL_MAX } = await import('../modules/score.js');
  assert.equal(overallScore({}), 0);

  const mid = overallScore({
    total_xp: 25_000,
    balance: 50_000,
    total_messages: 5_000,
    total_voice_minutes: 2_500,
    total_reactions_received: 250,
  });
  assert.ok(mid >= 4_000 && mid <= 6_000, `ожидали ~5000, получили ${mid}`);

  const max = overallScore({
    total_xp: 999_999,
    balance: 999_999,
    total_messages: 999_999,
    total_voice_minutes: 999_999,
    total_reactions_received: 999_999,
  });
  assert.equal(max, OVERALL_MAX);
});

test('сезонный рейтинг считает XP, сообщения и голос', async () => {
  const { getSeasonTop, seasonScore, resetSeasonCounters } = await import('../modules/progress.js');
  const g = 'g-season';
  ensureUser('u-s1', g);
  ensureUser('u-s2', g);
  getDb().prepare(
    'UPDATE users SET season_xp = ?, season_messages = ?, season_voice = ? WHERE guild_id = ? AND user_id = ?',
  ).run(100, 10, 20, g, 'u-s1');
  getDb().prepare(
    'UPDATE users SET season_xp = ?, season_messages = ?, season_voice = ? WHERE guild_id = ? AND user_id = ?',
  ).run(10, 2, 1, g, 'u-s2');
  const top = getSeasonTop(g, 10);
  assert.equal(top[0].user_id, 'u-s1');
  assert.ok(seasonScore(top[0]) > seasonScore(top[1]));
  resetSeasonCounters(g);
  const after = getSeasonTop(g, 10);
  assert.equal(seasonScore(after[0] || {}), 0);
});

test('work не платит дважды подряд', async () => {
  const { claimWork } = await import('../commands/work.js');
  const g = 'g-work';
  const u = 'u-work';
  ensureUser(u, g);
  const first = claimWork(u, g);
  assert.ok(first.pay >= 40 && first.pay <= 150);
  assert.throws(
    () => claimWork(u, g),
    (err) => err.message === 'COOLDOWN',
  );
});

test('истёкший блэкджек возвращает ставку', async () => {
  const { sweepExpiredBlackjackStates } = await import('../commands/casino.js');
  const g = 'g-bj';
  const u = 'u-bj';
  ensureUser(u, g);
  removeCoins(u, 100, g);
  assert.equal(getUser(u, g).balance, 0);

  getDb().prepare(`
    INSERT INTO ephemeral_state (key, payload, expires_at)
    VALUES (?, ?, ?)
  `).run(
    `bj:${g}:${u}`,
    JSON.stringify({ bet: 100, userId: u, guildId: g }),
    Date.now() - 1000,
  );

  assert.equal(sweepExpiredBlackjackStates(), 1);
  assert.equal(getUser(u, g).balance, 100);
});

test('отмена розыгрыша возвращает платный вход', () => {
  const g = 'g-gw';
  ensureUser('u-gw1', g);
  ensureUser('u-gw2', g);
  removeCoins('u-gw1', 50, g);
  removeCoins('u-gw2', 50, g);
  assert.equal(getUser('u-gw1', g).balance, 50);
  assert.equal(getUser('u-gw2', g).balance, 50);

  const db = getDb();
  const cost = 50;
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO giveaways (guild_id, channel_id, host_id, prize, cost, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'running')
  `).run(g, 'ch-gw', 'host-gw', 'Тест', cost, Date.now() + 60_000);

  db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, 'u-gw1');
  db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, 'u-gw2');

  runInTransaction(() => {
    const gw = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
    const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id);
    for (const entry of entries) {
      addCoins(entry.user_id, gw.cost, g);
    }
    db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(id);
    db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE id = ?").run(id);
  });

  assert.equal(getUser('u-gw1', g).balance, 100);
  assert.equal(getUser('u-gw2', g).balance, 100);
  const row = db.prepare('SELECT status FROM giveaways WHERE id = ?').get(id);
  assert.equal(row.status, 'cancelled');
});
