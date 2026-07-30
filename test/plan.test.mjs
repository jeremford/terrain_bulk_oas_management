import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAnswers, buildDocument, buildPlan, describePlan, submitOnlyEntries, todayAU } from '../src/core/plan.js';

const verifier = { name: 'Jeremy Ford', contact: '0412219940' };
const date = '29/07/2026';

const existing = {
  buddy_system_460b19: true,
  buddy_system_460b19_verifierType: 'member',
  buddy_system_460b19_verifierName: 'Hilary Woodley',
  buddy_system_460b19_verifiedDate: '22/03/2026',
  file_uploader: [],
};

const statement = { id: 'match_strike_fdc180', label: 'I can strike a match.', verifiable: true };
const plainCheckbox = { id: 'logbook_up_to_date', label: 'Logbook is up to date.', verifiable: false };

test('preserves verifications recorded by other leaders', () => {
  const answers = mergeAnswers({ existing, statements: [statement], verifier, date });
  assert.equal(answers.buddy_system_460b19, true);
  assert.equal(answers.buddy_system_460b19_verifierName, 'Hilary Woodley');
  assert.equal(answers.buddy_system_460b19_verifiedDate, '22/03/2026');
});

test('does not mutate the stored record', () => {
  const before = structuredClone(existing);
  mergeAnswers({ existing, statements: [statement], verifier, date });
  assert.deepEqual(existing, before);
});

test('writes the five keys Terrain expects for a verifiable statement', () => {
  const answers = mergeAnswers({ existing: {}, statements: [statement], verifier, date });
  assert.deepEqual(answers, {
    match_strike_fdc180: true,
    match_strike_fdc180_verifierType: 'member',
    match_strike_fdc180_verifierName: 'Jeremy Ford',
    match_strike_fdc180_verifierContact: '0412219940',
    match_strike_fdc180_verifiedDate: '29/07/2026',
    file_uploader: [],
  });
});

test('plain checkboxes carry no verifier fields', () => {
  const answers = mergeAnswers({ existing: {}, statements: [plainCheckbox], verifier, date });
  assert.equal(answers.logbook_up_to_date, true);
  assert.equal(answers.logbook_up_to_date_verifierName, undefined);
});

test('new records take the current template version; existing keep their pinned one', () => {
  const context = { stream: 'bushcraft', stage: '1', section: 'cub' };

  const fresh = buildDocument({
    member: { achievementId: null, answers: {}, uploads: [] },
    statements: [statement], verifier, context, templateVersion: 2, date,
  });
  assert.equal(fresh.version, 2);
  assert.equal(fresh.last_updated, undefined);

  const pinned = buildDocument({
    member: { achievementId: 'abc', version: 1, answers: {}, uploads: [], lastUpdated: '2026-07-29T07:06:48Z' },
    statements: [statement], verifier, context, templateVersion: 2, date,
  });
  assert.equal(pinned.version, 1);
  assert.equal(pinned.last_updated, '2026-07-29T07:06:48Z');
});

test('chooses POST to create and PUT to update', () => {
  const context = { stream: 'bushcraft', stage: '1', section: 'cub' };
  const selections = new Map([
    [{ memberId: 'm1', name: 'New Cub', status: 'not started', achievementId: null, answers: {}, uploads: [] }, [statement]],
    [{ memberId: 'm2', name: 'Existing Cub', status: 'draft_review', achievementId: 'a2', version: 2, answers: existing, uploads: [] }, [statement]],
  ]);

  const plan = buildPlan({ selections, verifier, context, templateVersion: 2, date });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].method, 'POST');
  assert.equal(plan[0].path, '/members/m1/achievements');
  assert.equal(plan[1].method, 'PUT');
  assert.equal(plan[1].path, '/members/m2/achievements/a2');
});

test('members with nothing ticked produce no requests', () => {
  const selections = new Map([[{ memberId: 'm1', answers: {} }, []]]);
  const plan = buildPlan({ selections, verifier, context: { stream: 'x', stage: '1', section: 'cub' }, templateVersion: 1 });
  assert.equal(plan.length, 0);
});

test('preview shows the real achievement id in submit lines when it is known', () => {
  const context = { stream: 'bushcraft', stage: '1', section: 'cub' };
  const selections = new Map([
    [{ memberId: 'm1', name: 'New Cub', status: 'not started', achievementId: null, answers: {}, uploads: [] }, [statement]],
    [{ memberId: 'm2', name: 'Existing Cub', status: 'draft_review', achievementId: 'a2', version: 2, answers: {}, uploads: [] }, [statement]],
  ]);
  const plan = buildPlan({ selections, verifier, context, templateVersion: 2, date });

  const text = describePlan(plan, { alsoSubmit: true, unitId: 'u1', submittedBy: 'me-1' });
  assert.match(text, /assume-profiles\(m1\)/);
  assert.match(text, /POST \/members\/m1\/achievements\/\{id-from-create-response\}\/submit-on-behalf/);
  assert.match(text, /POST \/members\/m2\/achievements\/a2\/submit-on-behalf/);
  assert.match(text, /"submitted_by":"me-1"/);
  assert.doesNotMatch(text, /\{id\}/);
});

test('fully verified drafts get submit-only entries; others do not', () => {
  const statements = [statement, plainCheckbox];
  const done = { match_strike_fdc180: true, logbook_up_to_date: true };
  const members = [
    { memberId: 'm1', name: 'Done Cub', status: 'draft_review', achievementId: 'a1', answers: done },
    { memberId: 'm2', name: 'Part Cub', status: 'draft_review', achievementId: 'a2', answers: { match_strike_fdc180: true } },
    { memberId: 'm3', name: 'Locked Cub', status: 'pending_review', achievementId: 'a3', answers: done },
    { memberId: 'm4', name: 'New Cub', status: 'not started', achievementId: null, answers: {} },
  ];

  const entries = submitOnlyEntries({ members, statements, selections: new Map() });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].member.memberId, 'm1');
  assert.equal(entries[0].submitOnly, true);
  assert.equal(entries[0].path, '/members/m1/achievements/a1/submit-on-behalf');
});

test('members already being saved are not double-submitted', () => {
  const done = { match_strike_fdc180: true };
  const member = { memberId: 'm1', status: 'draft_review', achievementId: 'a1', answers: done };
  const selections = new Map([[member, [statement]]]);
  const entries = submitOnlyEntries({ members: [member], statements: [statement], selections });
  assert.equal(entries.length, 0);
});

test('submit-only entries render with the real id and submitted_by in the preview', () => {
  const entries = submitOnlyEntries({
    members: [{ memberId: 'm1', name: 'Done Cub', status: 'draft_review', achievementId: 'a1', answers: { match_strike_fdc180: true } }],
    statements: [statement],
    selections: new Map(),
  });
  const text = describePlan(entries, { alsoSubmit: true, unitId: 'u1', submittedBy: 'me-1' });
  assert.match(text, /POST \/members\/m1\/achievements\/a1\/submit-on-behalf/);
  assert.match(text, /"submitted_by":"me-1"/);
  assert.match(text, /submit only/);
});

test('dates are formatted the way Terrain stores them', () => {
  assert.equal(todayAU(new Date(2026, 6, 5)), '05/07/2026');
});
