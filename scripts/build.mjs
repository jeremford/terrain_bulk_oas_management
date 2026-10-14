/**
 * Bundles the app into a single self-contained dist/terrain-approvals.html
 * so it can be handed to a leader as one file with no web server.
 *
 * Deliberately dependency-free: the module graph is small and declared below,
 * so a topological concatenation is enough. No node_modules, nothing to audit.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order, leaves first.
const MODULES = [
  'src/auth/cognito.js',
  'src/api/terrain.js',
  'src/core/template.js',
  'src/core/model.js',
  'src/core/plan.js',
  'src/core/report.js',
  'src/core/pdf.js',
  'src/core/report-pdf.js',
  'src/ui/info.js',
  'src/ui/grid.js',
  'src/ui/report.js',
  'src/app.js',
];

const stripModuleSyntax = source => source
  .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

const read = path => readFile(resolve(root, path), 'utf8');

const [html, css, ...sources] = await Promise.all([
  read('index.html'),
  read('src/styles.css'),
  ...MODULES.map(read),
]);

const bundle = MODULES
  .map((path, i) => `/* ---- ${path} ---- */\n${stripModuleSyntax(sources[i]).trim()}`)
  .join('\n\n');

const output = html
  .replace('<link rel="stylesheet" href="src/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script type="module">\n${bundle}\n</script>`);

await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/terrain-approvals.html'), output);

console.log(`dist/terrain-approvals.html  ${(output.length / 1024).toFixed(1)} kB`);
