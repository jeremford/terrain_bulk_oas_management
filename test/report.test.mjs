import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, stageProgress, normaliseRecords, templateKey, describeStage, summaryColumns, summaryCell, recordFilter } from '../src/core/report.js';

const stmts = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}_${i}`, label: `I can ${prefix} ${i}`, group: 'G' }));
const ticked = (statements, n) => Object.fromEntries(statements.slice(0, n).map(s => [s.id, true]));
const record = (stream, stage, status, answers = {}, version = 1) =>
  ({ achievement_meta: { stream, stage, branch: stream }, status, answers, version, id: `${stream}${stage}` });

const BC1 = stmts('bc1', 10), BC2 = stmts('bc2', 12), BC3 = stmts('bc3', 8), CA1 = stmts('ca1', 6);
const templates = new Map([
  [templateKey('bushcraft', 1, 1), BC1],
  [templateKey('bushcraft', 2, 1), BC2],
  [templateKey('bushcraft', 3, 1), BC3],
  [templateKey('camping', 1, 1), CA1],
]);
const roster = [
  { id: 'k', first_name: 'Kay', last_name: 'Cub', unit: { duty: 'member' } },
  { id: 'l', first_name: 'Lee', last_name: 'Leader', unit: { duty: 'adult_leader' } },
  { id: 'n', first_name: 'Nat', last_name: 'New', unit: { duty: 'member' } },
];

test('stageProgress lists the unticked statements and classifies the stage', () => {
  const p = stageProgress({ stream: 'bushcraft', stage: 2, status: 'draft_review', answers: ticked(BC2, 11) }, BC2);
  assert.equal(p.state, 'in_progress');
  assert.equal(p.total, 12);
  assert.equal(p.done, 11);
  assert.deepEqual(p.missing.map(m => m.id), ['bc2_11']);

  assert.equal(stageProgress({ stream: 'bushcraft', stage: 1, status: 'draft_review', answers: ticked(BC1, 10) }, BC1).state, 'complete');
  assert.equal(stageProgress({ stream: 'bushcraft', stage: 1, status: 'pending_review', answers: {} }, BC1).state, 'submitted');
  assert.equal(stageProgress({ stream: 'bushcraft', stage: 1, status: 'awarded', answers: {} }, BC1).state, 'awarded');
  assert.equal(stageProgress({ stream: 'bushcraft', stage: 1, status: 'draft_review', answers: {} }, null).state, 'unknown');
});

test('a complete higher stage is marked as waiting on the lowest open stage below it', () => {
  const records = new Map([['k', { results: [
    record('bushcraft', 1, 'awarded'),
    record('bushcraft', 2, 'draft_review', ticked(BC2, 11)),
    record('bushcraft', 3, 'draft_review', ticked(BC3, 8)),
  ] }]]);
  const [kay] = buildReport({ roster: roster.slice(0, 1), records, templates });

  const [bc] = kay.streams;
  assert.equal(bc.stream, 'bushcraft');
  assert.deepEqual(bc.stages.map(s => [s.stage, s.state, s.blockedBy]), [
    [1, 'awarded', null],
    [2, 'in_progress', null],
    [3, 'complete', 2],
  ]);
  assert.deepEqual(kay.awarded, [{ stream: 'bushcraft', stage: 1 }]);
  assert.deepEqual(kay.callouts, [{ stream: 'bushcraft', stage: 2, remaining: 1, logbookOnly: false, releases: [3] }]);
  assert.equal(describeStage(bc.stages[2]), '3 complete, waiting on 2');
});

test('callouts only fire for nearly-done stages or ones holding up higher stages', () => {
  const records = new Map([['k', { results: [
    record('bushcraft', 1, 'draft_review', ticked(BC1, 2)),   // 8 to go, nothing above: no callout
    record('camping', 1, 'draft_review', ticked(CA1, 4)),     // 2 to go: callout
  ] }]]);
  const [kay] = buildReport({ roster: roster.slice(0, 1), records, templates });
  assert.deepEqual(kay.callouts, [{ stream: 'camping', stage: 1, remaining: 2, logbookOnly: false, releases: [] }]);
});

test('streams follow the app order, stages ascend, settled streams drop out of the detail', () => {
  const records = new Map([['k', { results: [
    record('camping', 1, 'draft_review'),
    record('bushcraft', 3, 'draft_review'),
    record('bushcraft', 1, 'awarded'),
    record('bushcraft', 2, 'awarded'),
  ] }]]);
  const [kay] = buildReport({ roster: roster.slice(0, 1), records, templates });
  assert.deepEqual(kay.streams.map(s => [s.stream, s.stages.map(st => st.stage)]), [
    ['bushcraft', [1, 2, 3]],
    ['camping', [1]],
  ]);

  const settledOnly = new Map([['k', { results: [record('bushcraft', 1, 'awarded'), record('camping', 1, 'pending_review')] }]]);
  const [k2] = buildReport({ roster: roster.slice(0, 1), records: settledOnly, templates });
  assert.deepEqual(k2.streams, []);
  assert.deepEqual(k2.awarded, [{ stream: 'bushcraft', stage: 1 }]);
  assert.deepEqual(k2.submitted, [{ stream: 'camping', stage: 1 }]);
});

test('leaders are excluded by default and members with no records still appear', () => {
  const report = buildReport({ roster, records: new Map(), templates });
  assert.deepEqual(report.map(m => m.name), ['Kay Cub', 'Nat New']);
  assert.deepEqual(report[1], { memberId: 'n', name: 'Nat New', awarded: [], submitted: [], callouts: [], streams: [], cells: [] });
  assert.equal(buildReport({ roster, records: new Map(), templates, includeLeaders: true }).length, 3);
});

test('a record whose pinned template is missing falls back to latest, then to unknown', () => {
  const withLatest = new Map([[templateKey('bushcraft', 1, undefined), BC1]]);
  const records = new Map([['k', { results: [record('bushcraft', 1, 'draft_review', {}, 7)] }]]);
  assert.equal(buildReport({ roster: roster.slice(0, 1), records, templates: withLatest })[0].streams[0].stages[0].state, 'in_progress');
  assert.equal(buildReport({ roster: roster.slice(0, 1), records, templates: new Map() })[0].streams[0].stages[0].state, 'unknown');
});

test('normaliseRecords accepts bare records, wrapped records, and a results envelope', () => {
  const bare = record('bushcraft', '2', 'draft_review');
  assert.equal(normaliseRecords([bare])[0].stage, 2);
  assert.equal(normaliseRecords([{ achievement: bare, member: { id: 'x' } }])[0].stream, 'bushcraft');
  assert.equal(normaliseRecords({ results: [bare, { id: 'junk' }] }).length, 1);
  assert.deepEqual(normaliseRecords(undefined), []);
});

test('a stage with only the logbook checkbox left is flagged, since no attestation is outstanding', () => {
  const statements = [...stmts('x', 3), { id: 'logbook_up_to_date', label: 'My logbook is up to date.', group: 'G', verifiable: false }];
  const answers = ticked(statements, 3);
  const p = stageProgress({ stream: 'camping', stage: 1, status: 'draft_review', answers }, statements);
  assert.equal(p.state, 'in_progress');
  assert.equal(p.logbookOnly, true);
  assert.deepEqual(summaryCell(p), { kind: 'logbook', mark: 'log' });

  const p2 = stageProgress({ stream: 'camping', stage: 1, status: 'draft_review', answers: ticked(statements, 2) }, statements);
  assert.equal(p2.logbookOnly, false);
  assert.deepEqual(summaryCell(p2), { kind: 'open', mark: '2 / 4' });
});

test('summary cells and columns cover every stage, settled or not', () => {
  const records = new Map([['k', { results: [
    record('bushcraft', 1, 'awarded'),
    record('bushcraft', 2, 'pending_review', ticked(BC2, 12)),
    record('bushcraft', 3, 'draft_review', ticked(BC3, 8)),
    record('camping', 1, 'draft_review', ticked(CA1, 1)),
  ] }]]);
  const report = buildReport({ roster: roster.slice(0, 1), records, templates });
  assert.deepEqual(summaryColumns(report), { streams: ['bushcraft', 'camping'], stages: [1, 2, 3] });
  const cells = Object.fromEntries(report[0].cells.map(c => [`${c.stream}${c.stage}`, summaryCell(c)]));
  assert.deepEqual(cells, {
    bushcraft1: { kind: 'awarded', mark: '✓' },
    bushcraft2: { kind: 'complete', mark: '✓' },
    bushcraft3: { kind: 'complete', mark: '✓' },
    camping1: { kind: 'open', mark: '5 / 6' },
  });
  assert.equal(summaryCell(undefined), null);
  assert.deepEqual(summaryColumns([]), { streams: [], stages: [1, 2, 3] });
});

test('include restricts the report to the chosen streams and stages', () => {
  const records = new Map([['k', { results: [
    record('bushcraft', 1, 'awarded'),
    record('bushcraft', 2, 'draft_review', ticked(BC2, 11)),
    record('bushcraft', 3, 'draft_review', ticked(BC3, 8)),
    record('camping', 1, 'draft_review', ticked(CA1, 1)),
  ] }]]);
  const only = buildReport({ roster: roster.slice(0, 1), records, templates, include: { streams: ['bushcraft'], stages: [1, 2] } });
  assert.deepEqual(only[0].cells.map(c => `${c.stream}${c.stage}`), ['bushcraft1', 'bushcraft2']);
  assert.deepEqual(only[0].callouts, [{ stream: 'bushcraft', stage: 2, remaining: 1, logbookOnly: false, releases: [] }]);
  assert.deepEqual(summaryColumns(only, [1, 2]), { streams: ['bushcraft'], stages: [1, 2] });
  assert.deepEqual(summaryColumns(only, ['3', 1, '1']), { streams: ['bushcraft'], stages: [1, 3] });

  const all = buildReport({ roster: roster.slice(0, 1), records, templates, include: {} });
  assert.equal(all[0].cells.length, 4);
  assert.equal([{ stream: 'x', stage: 2 }].filter(recordFilter({ stages: ['2'] })).length, 1);
});
