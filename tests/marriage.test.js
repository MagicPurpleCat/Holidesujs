import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPOSAL_TTL_MS, MR, VOICE_BONUS_PCT } from '../modules/marriage/ids.js';
import { daysTogether, marriedAtUnix } from '../modules/marriage/helpers.js';

test('константы брака согласованы', () => {
  assert.ok(PROPOSAL_TTL_MS >= 60_000);
  assert.equal(VOICE_BONUS_PCT, 15);
  assert.ok(MR.home.startsWith('mr:'));
  assert.ok(MR.acceptPrefix.startsWith('mr:'));
  assert.ok(MR.nav.settings.startsWith('mr:'));
  assert.ok(MR.set.proposals.startsWith('mr:'));
});

test('daysTogether считает дни с даты свадьбы', () => {
  const past = new Date(Date.now() - 3 * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  const days = daysTogether({ married_at: past });
  assert.ok(days >= 2 && days <= 4);
  assert.equal(marriedAtUnix(null), null);
});
