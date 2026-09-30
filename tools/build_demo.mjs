// Build the demo. Usage: node tools/build_demo.mjs [esbuild path]
// Writes out/walldrobe.html (page body, everything inlined, for embedding) and
// out/index.html (the same as a full page). The site itself is tools/build_site.mjs.

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
const template = readFileSync(join(root, 'demo/template.html'), 'utf8');

// Image data: inlined as data URIs, or a relative path to a file next to the page.
function bodyWith(imageData) {
  const cat = { ...catalog, items: catalog.items.map((it) => ({ ...it, image: { ...it.image, data: imageData(it) } })) };
  const json = JSON.stringify(cat).replace(/</g, '\\u003c');
  return template
    .replace('{{CATALOG}}', () => json)
    .replace('{{APP}}', () => app.replace(/<\/script/gi, '<\\/script'));
}
const page = (body) => `<!doctype html>
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
`;

const inlined = bodyWith((it) => `data:image/jpeg;base64,${readFileSync(join(root, 'demo', it.image.src)).toString('base64')}`);
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/walldrobe.html'), inlined);
writeFileSync(join(root, 'out/index.html'), page(inlined));

console.log(`out/walldrobe.html ${(inlined.length / 1e6).toFixed(2)} MB`);
