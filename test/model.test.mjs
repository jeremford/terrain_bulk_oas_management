import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemberRows, isComplete, selfFromProfiles } from '../src/core/model.js';

const statements = [
  { id: 'match_strike_fdc180' },
  { id: 'buddy_system_460b19' },
];

test('flags leaders by unit duty or leaders patrol, not youth patrol leaders', () => {
  const rows = buildMemberRows({
    roster: [
      // duty alone, patrol name alone, or both — each identifies a leader
      { id: 'l1', first_name: 'A', last_name: 'Leader', unit: { section: 'cub', duty: 'adult_leader' } },
      { id: 'l2', first_name: 'B', last_name: 'Leader', unit: { section: 'cub', duty: 'member' }, patrol: { name: 'Cub Leaders', duty: 'member' } },
      { id: 'l3', first_name: 'C', last_name: 'Leader', unit: { section: 'cub', duty: 'adult_leader' }, patrol: { name: 'Cub Leaders', duty: 'member' } },
      // youth: patrol leader duty in an ordinary patrol is not an adult leader
      { id: 'y1', first_name: 'D', last_name: 'Cub', unit: { section: 'cub', duty: 'member', unit_council: true }, patrol: { name: 'Red', duty: 'patrol_leader' } },
      { id: 'y2', first_name: 'E', last_name: 'Cub', unit: { section: 'cub', duty: 'member' } },
    ],
    achievements: [],
    templateVersion: 1,
  });

  const leaders = Object.fromEntries(rows.map(r => [r.memberId, r.isLeader]));
  assert.deepEqual(leaders, { l1: true, l2: true, l3: true, y1: false, y2: false });
});

test('rows built without a roster are never treated as leaders', () => {
  const rows = buildMemberRows({
    roster: [],
    achievements: [{ member: { id: 'm1', first_name: 'A', last_name: 'B' }, achievement: { id: 'a1' } }],
    templateVersion: 1,
  });
  assert.equal(rows[0].isLeader, false);
});

test('locked records count as complete', () => {
  for (const status of ['pending_review', 'finalised', 'awarded']) {
    assert.equal(isComplete({ status, answers: {} }, statements), true, status);
  }
});

test('a draft with every statement verified counts as complete', () => {
  const member = {
    status: 'draft_review',
    answers: { match_strike_fdc180: true, buddy_system_460b19: true },
  };
  assert.equal(isComplete(member, statements), true);
});

test('partially verified and untouched records are not complete', () => {
  assert.equal(isComplete({ status: 'draft_review', answers: { match_strike_fdc180: true } }, statements), false);
  assert.equal(isComplete({ status: 'not started', answers: {} }, statements), false);
});

test('an empty statement list never marks an unlocked record complete', () => {
  assert.equal(isComplete({ status: 'draft_review', answers: {} }, []), false);
});

test('finds the signed-in member id in /profiles, null when absent', () => {
  assert.equal(selfFromProfiles({ profiles: [{ member: { id: 'me-1' } }] }), 'me-1');
  assert.equal(selfFromProfiles({ profiles: [] }), null);
  assert.equal(selfFromProfiles(undefined), null);
});
