import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildOutstanding } from '../src/core/outstanding.js';
import { outstandingToPdf } from '../src/core/outstanding-pdf.js';

const statements = [
  { id: 's1', label: 'I can pack for a night away', group: 'Plan' },
  { id: 's2', label: 'I can read a forecast', group: 'Plan' },
  { id: 's3', label: 'I can light a fire safely', group: 'Do' },
  { id: 's4', label: 'My logbook is up to date', group: 'Review' },
];
const member = (name, status, ...done) => ({ name, status, answers: Object.fromEntries(done.map(id => [id, true])) });
const members = [
  member('Zoe', 'draft_review', 's1', 's2', 's3'),
  member('Aiden', 'draft_review', 's2'),
  member('Mia', 'not started', 's2'),
  member('Oscar', 'pending_review'),            // locked: nothing to chase even though answers are empty
  member('Ruby', 'draft_review', 's1', 's2', 's3', 's4'),
];

test('lists each statement with the members who lack a tick, sorted, dropping settled statements', () => {
  const out = buildOutstanding(members, statements);
  assert.equal(out.total, 5);
  assert.equal(out.outstanding, 3);
  assert.deepEqual(out.groups.map(g => g.title), ['Plan', 'Do', 'Review']);
  assert.deepEqual(out.groups[0].statements.map(s => [s.label, s.names]), [
    ['I can pack for a night away', ['Aiden', 'Mia']],
  ]);                                            // s2 is ticked by everyone open, so it is gone
  assert.deepEqual(out.groups[1].statements[0].names, ['Aiden', 'Mia']);
  assert.deepEqual(out.groups[2].statements[0].names, ['Aiden', 'Mia', 'Zoe']);
});

test('locked members never appear, and a fully ticked grid yields no groups', () => {
  const out = buildOutstanding([member('Oscar', 'awarded'), member('Ruby', 'draft_review', 's1', 's2', 's3', 's4')], statements);
  assert.deepEqual(out, { total: 2, outstanding: 0, groups: [] });
});

test('consecutive statements share a group heading; a group that recurs later gets a fresh one', () => {
  const out = buildOutstanding([member('Mia', 'not started')], [
    { id: 'a', label: 'A', group: 'Plan' }, { id: 'b', label: 'B', group: 'Plan' },
    { id: 'c', label: 'C', group: 'Do' }, { id: 'd', label: 'D', group: 'Plan' },
  ]);
  assert.deepEqual(out.groups.map(g => [g.title, g.statements.length]), [['Plan', 2], ['Do', 1], ['Plan', 1]]);
});

const latin = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
const content = bytes => [...latin(bytes).matchAll(/stream\n([\s\S]*?)\nendstream/g)]
  .map(m => inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')).join('\n');
const measure = (t, { size }) => t.length * size * 0.5;

test('outstanding PDF names the stage, lists statements with counts and names, and omits settled ones', async () => {
  const bytes = await outstandingToPdf(buildOutstanding(members, statements),
    { unitName: 'Test Unit', stream: 'bushcraft', stage: '2', generatedAt: new Date('2026-10-15T19:00:00'), measure });
  const text = latin(bytes);
  const ops = content(bytes);
  assert.ok(bytes.length < 10_000, `pdf is ${bytes.length} bytes`);
  assert.equal([...text.matchAll(/\/Type \/Page\b/g)].length, 1);
  assert.match(ops, /\(Bushcraft Stage 2 \\227 outstanding by statement\) Tj/);
  assert.match(ops, /\(3 of 5 members have something outstanding\./);
  assert.match(ops, /\(PLAN\) Tj/);
  assert.match(ops, /\(I can pack for a night away\) Tj/);
  assert.match(ops, /\(2 to go\) Tj/);
  assert.match(ops, /\(Aiden \\267 Mia \\267 Zoe\) Tj/);
  assert.doesNotMatch(ops, /read a forecast/);
  assert.doesNotMatch(ops, /Oscar|Ruby/);
});

test('a long run of names wraps and a long list of statements flows onto further pages', async () => {
  const many = Array.from({ length: 40 }, (_, i) => member(`Member Number ${i}`, 'draft_review'));
  const lots = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, label: `I can do thing number ${i} well`, group: i < 15 ? 'Plan' : 'Do' }));
  const bytes = await outstandingToPdf(buildOutstanding(many, lots),
    { unitName: 'U', stream: 'camping', stage: '1', generatedAt: new Date(), measure });
  const pages = [...latin(bytes).matchAll(/\/Type \/Page\b/g)].length;
  assert.ok(pages > 1, `only ${pages} page`);
  assert.match(content(bytes), /\(40 to go\) Tj/);
});
