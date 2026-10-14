/**
 * Exports every OAS statement ("I can…") for the given streams and stages to a
 * single flat JSON file — one row per statement, ready for a spreadsheet or an
 * LLM to consume without unpacking nested structure.
 *
 * Templates are public JSON on templates.terrain.scouts.com.au: no login, no
 * token, no member data involved. Output format: docs/STATEMENTS.md.
 *
 * Usage:
 *   node scripts/export-statements.mjs                  # stages 1-3, all streams -> oas-statements.json
 *   node scripts/export-statements.mjs --stages 1,2     # override stages
 *   node scripts/export-statements.mjs --streams bushcraft,camping
 *   node scripts/export-statements.mjs --out my.json
 */

import { writeFile } from 'node:fs/promises';
import { fetchTemplate, parseStatements } from '../src/core/template.js';

// Matches the stream list the app offers.
const ALL_STREAMS = [
  'bushcraft', 'bushwalking', 'camping', 'alpine', 'aquatics',
  'boating', 'cycling', 'paddling', 'vertical',
];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const streams = arg('--streams', ALL_STREAMS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const stages = arg('--stages', '1,2,3').split(',').map(s => Number(s.trim())).filter(Boolean);
const outFile = arg('--out', 'oas-statements.json');

const statements = [];
const missing = [];

for (const stream of streams) {
  // Stages of one stream in parallel; streams sequential to stay gentle.
  const results = await Promise.all(stages.map(async stage => {
    try {
      const template = await fetchTemplate(stream, stage);
      return { stage, template };
    } catch (err) {
      missing.push({ stream, stage, error: err.message });
      return null;
    }
  }));

  for (const { stage, template } of results.filter(Boolean)) {
    parseStatements(template).forEach((s, index) => {
      statements.push({
        stream,
        stage,
        template_version: template.version,
        group: s.group,
        order: index + 1,          // position within the stage, for stable sorting
        id: s.id,
        statement: s.label,
        guidance: s.dialogText,
        verifiable: s.verifiable,
      });
    });
  }
  console.error(`${stream}: ${statements.filter(s => s.stream === stream).length} statements`);
}

const output = {
  generated_at: new Date().toISOString(),
  source: 'https://templates.terrain.scouts.com.au (public OAS templates, latest versions)',
  streams,
  stages,
  statement_count: statements.length,
  // One flat row per statement: stream, stage, template_version, group, order,
  // id, statement, guidance, verifiable. Column-shaped on purpose - each row is
  // one spreadsheet line.
  statements,
};

await writeFile(outFile, JSON.stringify(output, null, 2) + '\n');
console.error(`\nWrote ${statements.length} statements to ${outFile}`);
if (missing.length) {
  console.error('Skipped (no template found):');
  for (const m of missing) console.error(`  ${m.stream}/${m.stage} — ${m.error}`);
}
