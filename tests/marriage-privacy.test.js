import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(os.tmpdir(), `holidesu-mr-priv-${process.pid}-${Date.now()}.db`);
process.env.HOLIDESU_DB_PATH = tmpDb;

const { initDatabase, closeDatabase, ensureUser } = await import('../database.js');
const { getMarriagePrivacy, toggleMarriagePrivacy } = await import('../modules/marriage/helpers.js');

before(() => initDatabase());
after(() => {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = tmpDb + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('getMarriagePrivacy и toggle', () => {
  ensureUser('u-priv', 'g-priv');
  assert.equal(getMarriagePrivacy('u-priv').allowProposals, true);
  toggleMarriagePrivacy('u-priv', 'proposals');
  assert.equal(getMarriagePrivacy('u-priv').allowProposals, false);
  toggleMarriagePrivacy('u-priv', 'profile');
  assert.equal(getMarriagePrivacy('u-priv').showInProfile, false);
});
