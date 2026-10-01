// Build the Walldrobe site for GitHub Pages. Usage: node tools/build_site.mjs [esbuild path]
// Writes docs/index.html (the app bundled, the catalog inlined) and docs/art/ (the images).

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../engine/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = process.argv[2] || 'esbuild';

const app = execFileSync(esbuild, [join(root, 'web/main.js'), '--bundle', '--format=iife', '--minify', '--target=es2020'], { encoding: 'utf8' });
const css = readFileSync(join(root, 'web/site.css'), 'utf8');
const catalog = JSON.parse(readFileSync(join(root, 'demo/catalog.json'), 'utf8'));
const errors = validateCatalog(catalog.items);
if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1); }
const items = catalog.items.map((it) => ({ ...it, image: { ...it.image, data: it.image.src } }));
const json = JSON.stringify({ ...catalog, items }).replace(/</g, '\\u003c');

const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  .replace('{{CSS}}', () => css)
  .replace('{{CATALOG}}', () => json)
  .replace('{{APP}}', () => app.replace(/<\/script/gi, '<\\/script'));

rmSync(join(root, 'docs'), { recursive: true, force: true });
mkdirSync(join(root, 'docs'), { recursive: true });
cpSync(join(root, 'demo/art'), join(root, 'docs/art'), { recursive: true });
writeFileSync(join(root, 'docs/index.html'), html);
writeFileSync(join(root, 'docs/.nojekyll'), '');
console.log(`docs/index.html ${(html.length / 1e6).toFixed(2)} MB`);

// A private preview with every image inlined, as one page body: out/site-preview.html.
if (process.argv.includes('--preview')) {
  const inl = catalog.items.map((it) => ({ ...it, image: { ...it.image, data: `data:image/jpeg;base64,${readFileSync(join(root, 'demo', it.image.src)).toString('base64')}` } }));
  const j = JSON.stringify({ ...catalog, items: inl }).replace(/</g, '\\u003c');
  const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>'));
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(json, () => j);
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(join(root, 'out/site-preview.html'), `${head}\n${body}`);
  console.log(`out/site-preview.html ${((head.length + body.length) / 1e6).toFixed(2)} MB`);
}
