import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PdfWriter, CHECK } from '../src/core/pdf.js';
import { reportToPdf } from '../src/core/report-pdf.js';
import { buildReport, templateKey } from '../src/core/report.js';

// Buffer's latin1 is byte-faithful ISO-8859-1. TextDecoder('latin1') is
// windows-1252 by spec, and whether Node remaps 0x80–0x9F varies by patch
// release, which corrupted the deflate streams on CI.
const latin = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

/** Inflates every FlateDecode stream so text operators can be inspected. */
async function contentText(bytes) {
  const text = latin(bytes);
  const out = [];
  for (const m of text.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    out.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
  }
  return out.join('\n');
}

test('writer emits a well-formed file whose xref offsets point at the objects', async () => {
  const doc = new PdfWriter({ title: 'T (1)' });
  const p1 = doc.addPage();
  const p2 = doc.addPage({ landscape: true });
  doc.text(p1, 40, 40, 'Hello (world) \\ ✓ naïve – ✗', { size: 10 });
  doc.rect(p2, 10, 10, 20, 20, { fill: '#ff0000' });
  doc.line(p2, 0, 0, 10, 10);
  const bytes = await doc.toBytes();
  const text = latin(bytes);

  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.equal(doc.pageCount, 2);
  assert.match(text, /\/Type \/Pages \/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(text, /\/Title <FEFF00540020002800310029>/);   // UTF-16BE with BOM

  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n/gm)].map(m => Number(m[1]));
  entries.forEach((offset, i) => assert.match(text.slice(offset, offset + 12), new RegExp(`^${i + 1} 0 obj`)));
});

test('links become annotations with a destination resolved at serialisation', async () => {
  const doc = new PdfWriter();
  const p1 = doc.addPage();
  const target = {};
  doc.link(p1, 10, 20, 100, 12, target);
  doc.link(p1, 10, 40, 100, 12, {});            // never resolved: dropped
  const p2 = doc.addPage();
  target.page = p2; target.y = 100;
  const text = latin(await doc.toBytes());
  const annots = [...text.matchAll(/\/Subtype \/Link/g)];
  assert.equal(annots.length, 1);
  // p2 is the second page object: pages start at object 9 (3 fixed + 5 fonts), each page takes two ids
  assert.match(text, /\/Rect \[10\.00 809\.89 110\.00 821\.89\] \/Border \[0 0 0\] \/Dest \[11 0 R \/XYZ null 741\.89 null\]/);
});

test('text is WinAnsi-encoded with escapes, check marks switch to ZapfDingbats, others become ?', async () => {
  const doc = new PdfWriter();
  const p = doc.addPage();
  doc.text(p, 40, 40, `a(b)c\\ ${CHECK} naïve – ✗`, { size: 10 });
  const content = await contentText(await doc.toBytes());
  assert.match(content, /\/F1 10 Tf .* \(a\\\(b\\\)c\\\\ \) Tj/);
  assert.match(content, /\/F5 10 Tf .* \(3\) Tj/);               // ✓ as ZapfDingbats a19
  assert.match(content, /\( na\\357ve \\226 \?\) Tj/);           // ï, en dash, and ✗ -> ?
});

test('width accounts for check marks and uses the injected measurer', () => {
  const doc = new PdfWriter({ measure: (t, { size }) => t.length * size });
  assert.equal(doc.width('ab', { size: 10 }), 20);
  assert.equal(doc.width(`a${CHECK}`, { size: 10 }), 10 + 7.55);
});

// ---- report layout ---------------------------------------------------------

const stmts = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}_${i}`, label: `I can do ${p} thing ${i} carefully.`, group: 'Plan', verifiable: true }));
const ticked = (s, n) => Object.fromEntries(s.slice(0, n).map(x => [x.id, true]));
const record = (stream, stage, status, answers = {}) => ({ achievement_meta: { stream, stage, branch: stream }, status, answers, version: 1, id: stream + stage });
const BC2 = stmts('bc2', 12), BC3 = stmts('bc3', 8);
const templates = new Map([[templateKey('bushcraft', 1, 1), stmts('bc1', 10)], [templateKey('bushcraft', 2, 1), BC2], [templateKey('bushcraft', 3, 1), BC3]]);
const measure = (t, { size }) => t.length * size * 0.5;

test('report PDF has a landscape summary page, portrait member pages, and the same wording as the HTML', async () => {
  const roster = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, first_name: `Kid${i}`, last_name: 'Ørsted (Jr)', unit: { duty: 'member' } }));
  const records = new Map(roster.map(m => [m.id, { results: [record('bushcraft', 1, 'awarded'), record('bushcraft', 2, 'draft_review', ticked(BC2, 11)), record('bushcraft', 3, 'draft_review', ticked(BC3, 8))] }]));
  const report = buildReport({ roster, records, templates });

  const bytes = await reportToPdf(report, { unitName: 'Test Unit', generatedAt: new Date('2026-10-13T10:00:00'), stages: [1, 2, 3], measure });
  const text = latin(bytes);
  const content = await contentText(bytes);

  assert.ok(bytes.length < 60_000, `pdf is ${bytes.length} bytes`);
  const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => Number(m[1]) > Number(m[2]) ? 'L' : 'P');
  assert.equal(boxes[0], 'L');
  const firstPortrait = boxes.indexOf('P');
  assert.ok(firstPortrait >= 1 && boxes.slice(firstPortrait).every(b => b === 'P'), boxes.join(''));
  // each member starts their own page: their name is the first text drawn on it
  const pages = content.split(/(?=BT 0\.455 0\.518 0\.580 rg \/F1 7\.5 Tf)/);   // footer is the first op on every page
  const starts = pages.map(p => p.match(/\/F2 13 Tf [^(]*\((Kid\d+)/)?.[1]).filter(Boolean);
  assert.equal(new Set(starts).size, report.length);
  assert.equal(boxes.length, 2 + report.length);   // two summary pages, then one per member

  assert.match(content, /\(Kid0 \\330rsted \\\(Jr\\\)\) Tj/);
  assert.match(content, /\(Bushcraft 2: 1 statement to go, then stages 2 and 3 can be awarded\.\) Tj/);
  assert.match(content, /\(1 \/ 12\) Tj/);
  assert.match(content, /\(Page 1\) Tj/);
  assert.match(content, /\(I can do bc2 thing 11 carefully\.\) Tj/);

  // every member links from the summary to their section, and back again
  assert.equal([...text.matchAll(/\/Subtype \/Link/g)].length, report.length * 2);
});

test('a member with nothing started still gets a section', async () => {
  const report = buildReport({ roster: [{ id: 'n', first_name: 'Nat', last_name: 'New', unit: { duty: 'member' } }], records: new Map(), templates });
  const content = await contentText(await reportToPdf(report, { unitName: 'U', generatedAt: new Date(), measure }));
  assert.match(content, /\(No stages in progress\.\) Tj/);
  assert.match(content, /\(Nothing awarded yet\.\) Tj/);
});
