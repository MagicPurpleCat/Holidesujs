import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clanScore, roleLabel, canLead, canOfficerOrLead } from '../modules/clans/helpers.js';
import { CREATE_COST, CLAN_SHOP, MAX_CLAN_MEMBERS, CL } from '../modules/clans/ids.js';

test('clanScore считает уровни и XP', () => {
  assert.equal(clanScore({ levels: 10, xp: 2500 }), 12);
  assert.equal(clanScore({ levels: 0, xp: 0 }), 0);
});

test('роли клана: лидер и офицер', () => {
  const leader = { owner_id: 'u1', member_role: 'leader' };
  const officer = { owner_id: 'u1', member_role: 'officer' };
  const member = { owner_id: 'u1', member_role: 'member' };
  assert.equal(canLead(leader, 'u1'), true);
  assert.equal(canLead(officer, 'u2'), false);
  assert.equal(canOfficerOrLead(officer, 'u2'), true);
  assert.equal(canOfficerOrLead(member, 'u2'), false);
  assert.equal(roleLabel('leader').includes('Лидер'), true);
});

test('константы кланов согласованы', () => {
  assert.equal(CREATE_COST, 1000);
  assert.equal(MAX_CLAN_MEMBERS, 30);
  assert.ok(CLAN_SHOP.boost.price > 0);
  assert.ok(CL.home.startsWith('cl:'));
  assert.ok(CL.inviteAcceptPrefix.startsWith('cl:'));
});
