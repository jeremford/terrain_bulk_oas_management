import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildOutstanding, buildOutstandingReport } from '../src/core/outstanding.js';
import { outstandingToPdf, outstandingReportToPdf } from '../src/core/outstanding-pdf.js';

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

// ---- from the progress report ----------------------------------------------

const cell = (stream, stage, state, missing = []) => ({ stream, stage, state, missing });
// Template order for the fixtures: p1 p2 p3 p4 p9 d1 d2, as the index stageProgress() attaches.
const TEMPLATE = ['p1', 'p2', 'p3', 'p4', 'p9', 'd1', 'd2'];
const miss = (...ids) => ids.map(id => ({ id, label: `I can ${id}`, group: id.startsWith('p') ? 'Plan' : 'Do', index: TEMPLATE.indexOf(id) }));
const reportFixture = [
  { name: 'Zoe', cells: [cell('camping', 1, 'in_progress', miss('p1')), cell('bushcraft', 1, 'awarded'), cell('bushcraft', 2, 'in_progress', miss('p1', 'p2', 'd1'))] },
  { name: 'Aiden', cells: [cell('bushcraft', 1, 'awarded'), cell('bushcraft', 2, 'in_progress', miss('p2'))] },
  { name: 'Mia', cells: [cell('bushcraft', 1, 'complete'), cell('bushcraft', 2, 'submitted')] },
  { name: 'Nat', cells: [] },
];

test('report inversion covers each stage in stream order, drops settled stages, and lists the unstarted', () => {
  const out = buildOutstandingReport(reportFixture);
  assert.equal(out.total, 4);
  assert.deepEqual(out.stages.map(s => `${s.stream}/${s.stage}`), ['bushcraft/2', 'camping/1']);   // bushcraft 1 has nobody outstanding
  const bc2 = out.stages[0];
  assert.equal(bc2.outstanding, 2);
  assert.deepEqual(bc2.notStarted, ['Nat']);                                 // Mia has a record, so she is started, not listed
  assert.deepEqual(bc2.groups.map(g => [g.title, g.statements.map(s => [s.id, s.names])]), [
    ['Plan', [['p1', ['Zoe']], ['p2', ['Aiden', 'Zoe']]]],
    ['Do', [['d1', ['Zoe']]]],
  ]);
  assert.deepEqual(out.stages[1].notStarted, ['Aiden', 'Mia', 'Nat']);
});

test('statements follow template order via their index, whatever subset each member is missing', () => {
  const out = buildOutstandingReport([
    { name: 'A', cells: [cell('bushcraft', 1, 'in_progress', miss('p3'))] },
    { name: 'B', cells: [cell('bushcraft', 1, 'in_progress', miss('p1', 'p2', 'p3', 'p4'))] },
    { name: 'C', cells: [cell('bushcraft', 1, 'in_progress', miss('p1', 'p9'))] },
  ]);
  assert.deepEqual(out.stages[0].groups[0].statements.map(s => s.id), ['p1', 'p2', 'p3', 'p4', 'p9']);

  // Disjoint lists that never link the groups must still not interleave them:
  // p1 d1 from one member and p2 d2 from another is Plan, Plan, Do, Do.
  const zip = buildOutstandingReport([
    { name: 'A', cells: [cell('bushcraft', 1, 'in_progress', miss('p1', 'd1'))] },
    { name: 'B', cells: [cell('bushcraft', 1, 'in_progress', miss('p2', 'd2'))] },
  ]);
  assert.deepEqual(zip.stages[0].groups.map(g => [g.title, g.statements.map(s => s.id)]), [['Plan', ['p1', 'p2']], ['Do', ['d1', 'd2']]]);

  // A missing item without an index (an older caller) sorts last, in first-appearance order.
  const legacy = buildOutstandingReport([
    { name: 'A', cells: [cell('bushcraft', 1, 'in_progress', [{ id: 'x', label: 'x', group: 'Do' }, ...miss('p1')])] },
  ]);
  assert.deepEqual(legacy.stages[0].groups.map(g => g.statements.map(s => s.id)), [['p1'], ['x']]);
});

test('report-wide outstanding PDF has a heading per stage, the names, and the not-started line', async () => {
  const bytes = await outstandingReportToPdf(buildOutstandingReport(reportFixture),
    { unitName: 'Test Unit', generatedAt: new Date('2026-10-15T19:00:00'), measure });
  const ops = content(bytes);
  assert.match(ops, /\(Outstanding by statement\) Tj/);
  assert.match(ops, /\(2 stages with something outstanding/);
  assert.match(ops, /\(Bushcraft Stage 2\) Tj/);
  assert.match(ops, /\(Camping Stage 1\) Tj/);
  assert.match(ops, /\(Aiden \\267 Zoe\) Tj/);
  assert.match(ops, /\(Not started \\\(1\\\)\) Tj[^\n]*\n[^\n]*\(Nat\) Tj/);
  assert.match(ops, /\(Not started \\\(3\\\)\) Tj[^\n]*\n[^\n]*\(Aiden \\267 Mia \\267 Nat\) Tj/);
  assert.doesNotMatch(ops, /Bushcraft Stage 1/);
  // each stream starts its own page: two streams, two pages, the second opening with Camping
  const pages = ops.split(/(?=BT 0\.455 0\.518 0\.580 rg \/F1 7\.5 Tf 1 0 0 1 40\.00 14\.00 Tm)/).filter(Boolean);
  assert.equal(pages.length, 2);
  assert.match(pages[1], /^(?:(?!Bushcraft)[\s\S])*\(Camping Stage 1\) Tj/);
  assert.match(content(await outstandingReportToPdf({ total: 3, stages: [] }, { unitName: 'U', generatedAt: new Date(), measure })), /Nothing outstanding in the selected/);
});
