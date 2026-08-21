import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(os.tmpdir(), `holidesu-setup-${process.pid}-${Date.now()}.db`);
process.env.HOLIDESU_DB_PATH = tmpDb;

const { initDatabase, closeDatabase, getDb } = await import('../database.js');
const {
  SETUP_CHANNEL_FIELDS,
  getSetupChecklist,
  patchGuildChannels,
  setGuildMeta,
  getGuildConfig,
  clearGuildConfigCache,
} = await import('../utils/guildConfig.js');
const { SU } = await import('../modules/setup/ids.js');

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

test('SETUP_CHANNEL_FIELDS содержит обязательные каналы', () => {
  const keys = SETUP_CHANNEL_FIELDS.map((f) => f.key);
  assert.ok(keys.includes('log'));
  assert.ok(keys.includes('cmd'));
  assert.ok(keys.includes('mod'));
  assert.ok(SU.home.startsWith('su:'));
});

test('patchGuildChannels и setGuildMeta обновляют конфиг', () => {
  const g = 'g-setup-test';
  getDb().prepare(`
    INSERT INTO server_config (guild_id, owner_id, admin_roles, channels, features, note, status)
    VALUES (?, '', '[]', '{}', '{}', '', 'active')
  `).run(g);

  setGuildMeta(g, { ownerId: '111111111111111111', adminRoles: ['r1'], note: 'test' });
  patchGuildChannels(g, { log: 'c-log', cmd: 'c-cmd', mod: 'c-mod' });
  clearGuildConfigCache(g);

  const cfg = getGuildConfig(g);
  assert.equal(cfg.ownerId, '111111111111111111');
  assert.deepEqual(cfg.adminRoles, ['r1']);
  assert.equal(cfg.logChannelId, 'c-log');

  const list = getSetupChecklist(g);
  assert.equal(list.ready, true);
});
