// Build the demo into one self-contained HTML file: the engine and app bundled,
// the catalog and every image inlined. Usage: node tools/build_demo.mjs [esbuild path]
// Writes out/walldrobe.html (page body, for embedding) and out/index.html (full page).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../engine/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = process.argv[2] || 'esbuild';

const app = execFileSync(esbuild, [join(root, 'demo/app.js'), '--bundle', '--format=iife', '--minify', '--target=es2020'], { encoding: 'utf8' });

const catalog = JSON.parse(readFileSync(join(root, 'demo/catalog.json'), 'utf8'));
const errors = validateCatalog(catalog.items);
if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1); }
for (const it of catalog.items) {
  const b64 = readFileSync(join(root, 'demo', it.image.src)).toString('base64');
  it.image.data = `data:image/jpeg;base64,${b64}`;
}
const json = JSON.stringify(catalog).replace(/</g, '\\u003c');

const body = readFileSync(join(root, 'demo/template.html'), 'utf8')
  .replace('{{CATALOG}}', () => json)
  .replace('{{APP}}', () => app.replace(/<\/script/gi, '<\\/script'));

mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/walldrobe.html'), body);
writeFileSync(join(root, 'out/index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${body.slice(0, body.indexOf('<div class="page">'))}
</head>
<body>
${body.slice(body.indexOf('<div class="page">'))}
</body>
</html>
`);
console.log(`out/walldrobe.html ${(body.length / 1e6).toFixed(2)} MB`);
