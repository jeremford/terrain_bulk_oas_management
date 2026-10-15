import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildDuplicates } from '../src/core/duplicates.js';
import { duplicatesToPdf } from '../src/core/duplicates-pdf.js';
import { templateKey } from '../src/core/report.js';

const latin = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
const content = bytes => [...latin(bytes).matchAll(/stream\n([\s\S]*?)\nendstream/g)]
  .map(m => inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')).join('\n');
const measure = (t, { size }) => t.length * size * 0.5;

const SUN = 'I can protect myself when exposed to the sun while outdoors.';
const BUDDY = 'I can explain the buddy system.';
const t = (id, label, extra = {}) => ({ id, label, group: 'Plan', ...extra });
const templates = new Map([
  [templateKey('bushcraft', 2, 1), [t('bc_sun', SUN), t('bc_x', 'I can cook a snack in a fire.'), t('bc_log', 'My logbook is up to date.', { verifiable: false })]],
  [templateKey('bushwalking', 2, undefined), [t('bw_sun', 'I can protect myself when exposed to the SUN while outdoors'), t('bw_log', 'My logbook is up to date.', { verifiable: false })]],
  [templateKey('camping', 2, undefined), [t('ca_sun', SUN), t('ca_y', 'I can pitch a tent.')]],
  [templateKey('aquatics', 1, undefined), [t('aq_buddy', BUDDY)]],
  [templateKey('boating', 1, undefined), [t('bo_buddy', BUDDY)]],
]);
const cell = (stream, stage, state, missingIds = [], version = undefined) =>
  ({ stream, stage, version, state, missing: missingIds.map(id => ({ id, label: id, group: 'Plan', index: 0 })) });
const report = [
  // ticked in bushcraft (pinned v1), missing in bushwalking, camping never started
  { name: 'Zoe', cells: [cell('bushcraft', 2, 'in_progress', ['bc_x'], 1), cell('bushwalking', 2, 'in_progress', ['bw_sun'])] },
  // awarded bushcraft counts as ticked; missing in camping
  { name: 'Aiden', cells: [cell('bushcraft', 2, 'awarded', [], 1), cell('camping', 2, 'in_progress', ['ca_sun', 'ca_y'])] },
  // ticked everywhere: not listed
  { name: 'Mia', cells: [cell('bushcraft', 2, 'in_progress', ['bc_x'], 1), cell('camping', 2, 'complete')] },
  // missing everywhere: not listed
  { name: 'Nat', cells: [cell('bushcraft', 2, 'in_progress', ['bc_sun'], 1), cell('camping', 2, 'in_progress', ['ca_sun'])] },
  // buddy ticked in aquatics, boating not started: nothing to carry across yet
  { name: 'Ollie', cells: [cell('aquatics', 1, 'in_progress', [])] },
];
const opts = { templates, streams: ['bushcraft', 'bushwalking', 'camping', 'aquatics', 'boating'], stages: [1, 2] };

test('lists members with a recurring statement ticked in one stage and missing in another they have in progress', () => {
  const out = buildDuplicates(report, opts);
  assert.equal(out.total, 5);
  assert.deepEqual(out.wordings.map(w => w.label), [SUN]);                      // buddy: nobody has it ticked and missing
  const [sun] = out.wordings;
  assert.deepEqual(sun.places, [{ stream: 'bushcraft', stage: 2 }, { stream: 'bushwalking', stage: 2 }, { stream: 'camping', stage: 2 }]);
  assert.deepEqual(sun.members, [
    { name: 'Aiden', ticked: [{ stream: 'bushcraft', stage: 2 }], missing: [{ stream: 'camping', stage: 2 }] },
    { name: 'Zoe', ticked: [{ stream: 'bushcraft', stage: 2 }], missing: [{ stream: 'bushwalking', stage: 2 }] },
  ]);
});

test('the logbook checkbox and statements unique to one stage are never duplicates', () => {
  const only = buildDuplicates([{ name: 'A', cells: [cell('bushcraft', 2, 'in_progress', ['bc_log', 'bc_x'], 1), cell('bushwalking', 2, 'awarded')] }], opts);
  assert.deepEqual(only.wordings, []);
});

test('duplicates PDF names the statement, its stages, and each member with ticked and to-tick stages', async () => {
  const bytes = await duplicatesToPdf(buildDuplicates(report, opts), { unitName: 'Test Unit', generatedAt: new Date('2026-10-15T19:00:00'), measure });
  const ops = content(bytes);
  assert.match(ops, /\(Duplicated statements \\227 ticked in one stream, not another\) Tj/);
  assert.match(ops, /\(1 statement worded the same/);
  assert.match(ops, /\(I can protect myself when exposed to the sun while outdoors\.\) Tj/);
  assert.match(ops, /\(In Bushcraft 2, Bushwalking 2, Camping 2\) Tj/);
  assert.match(ops, /\(Aiden\) Tj/);
  assert.match(ops, /\/F5 9 Tf [^\n]*\(3\) Tj/);                                  // the tick, in ZapfDingbats
  assert.match(ops, /\( Bushcraft 2 \\267 to tick: Camping 2\) Tj/);
  assert.doesNotMatch(ops, /Mia|Nat|Ollie/);
  const empty = content(await duplicatesToPdf({ total: 2, wordings: [] }, { unitName: 'U', generatedAt: new Date(), measure }));
  assert.match(empty, /No member has a recurring statement/);
});
