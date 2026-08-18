import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canGrant } from '../utils/permissions.js';
import { commandFeatureKey } from '../utils/guildConfig.js';

test('canGrant: владелец не может выдать уровень владельца', () => {
  assert.equal(canGrant(3, 3), false);
  assert.equal(canGrant(3, 2), true);
  assert.equal(canGrant(3, 1), true);
});

test('canGrant: админ выдаёт только модератора', () => {
  assert.equal(canGrant(2, 1), true);
  assert.equal(canGrant(2, 2), false);
  assert.equal(canGrant(2, 3), false);
});

test('canGrant: модератор никому не выдаёт права', () => {
  assert.equal(canGrant(1, 1), false);
  assert.equal(canGrant(0, 1), false);
});

test('commandFeatureKey: критические команды не гейтятся', () => {
  assert.equal(commandFeatureKey('setup'), null);
  assert.equal(commandFeatureKey('панель'), null);
  assert.equal(commandFeatureKey('help'), null);
  assert.equal(commandFeatureKey('логи'), null);
});

test('commandFeatureKey: игровые команды привязаны к фичам', () => {
  assert.equal(commandFeatureKey('clan'), 'clans');
  assert.equal(commandFeatureKey('реп'), 'reputation');
  assert.equal(commandFeatureKey('casino'), 'economy');
  assert.equal(commandFeatureKey('mod'), 'moderation');
  assert.equal(commandFeatureKey('marry'), 'marriages');
});
