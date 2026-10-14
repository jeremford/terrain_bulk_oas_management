/**
 * Renders oas-statements.json (from `npm run export`) as a readable Markdown
 * document: stream -> stage -> group -> statements in syllabus order, with
 * guidance quoted under each statement. Ids are omitted on purpose.
 *
 * Usage:
 *   node scripts/statements-to-md.mjs [in.json] [out.md]
 * Defaults: oas-statements.json -> oas-statements.md
 */

import { readFile, writeFile } from 'node:fs/promises';

const inFile = process.argv[2] ?? 'oas-statements.json';
const outFile = process.argv[3] ?? 'oas-statements.md';

const data = JSON.parse(await readFile(inFile, 'utf8'));
const title = s => s[0].toUpperCase() + s.slice(1);
// Template group titles carry a trailing ">" ("Plan>"); drop it for prose.
const groupName = g => g.replace(/>\s*$/, '').trim() || 'General';

const lines = [
  '# Outdoor Adventure Skills — statements and guidance',
  '',
  `All "I statements" for stages ${data.stages.join(', ')} of every OAS stream, with the`,
  'assessment guidance Terrain shows behind its info icon. Generated from the public',
  `syllabus templates at templates.terrain.scouts.com.au on ${data.generated_at.slice(0, 10)};`,
  'regenerate with `npm run export` then `node scripts/statements-to-md.mjs`.',
  'The syllabus text belongs to Scouts Australia. See `docs/STATEMENTS.md`.',
  '',
];

for (const stream of data.streams) {
  const inStream = data.statements.filter(s => s.stream === stream);
  if (!inStream.length) continue;
  lines.push(`## ${title(stream)}`, '');

  for (const stage of data.stages) {
    const inStage = inStream.filter(s => s.stage === stage).sort((a, b) => a.order - b.order);
    if (!inStage.length) continue;
    lines.push(`### Stage ${stage}`, '');

    let currentGroup = null;
    for (const s of inStage) {
      if (groupName(s.group) !== currentGroup) {
        currentGroup = groupName(s.group);
        lines.push(`#### ${currentGroup}`, '');
      }
      lines.push(`- **${s.statement.trim()}**`);
      const guidance = s.guidance.trim();
      if (guidance) for (const g of guidance.split('\n')) lines.push(`  > ${g.trim()}`);
      lines.push('');
    }
  }
}

await writeFile(outFile, lines.join('\n'));
console.error(`Wrote ${outFile} (${data.statement_count} statements)`);
