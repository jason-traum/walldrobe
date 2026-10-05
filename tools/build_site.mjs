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
// Familjen Grotesk (Google Fonts, SIL Open Font License), self-hosted: one variable file, Latin, inlined so the page needs no font CDN.
const fontFace = `@font-face{font-family:"Familjen Grotesk";font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(root, 'web/fonts/familjen-grotesk.woff2')).toString('base64')}) format('woff2')}`;
const css = fontFace + readFileSync(join(root, 'web/site.css'), 'utf8');
const catalog = JSON.parse(readFileSync(join(root, 'demo/catalog.json'), 'utf8'));
const errors = validateCatalog(catalog.items);
if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1); }
// Only what the site shows: hidden and gone pieces stay out (see CATALOG.md, Catalog health), and fields only the pipeline uses are dropped.
const items = catalog.items.filter((it) => it.status === 'active' && !(it.health && it.health.gone)).map(({ provenance, quality, ...it }) => ({
  ...it, quality: { score: quality && quality.score },
  // A link that is the piece's page plus a variant keeps just the variant (vid), and so
  // does each frame color's link; the app puts the page back (web/main.js, CATALOG).
  offers: (it.offers || []).filter((o) => !o.gone).map(({ sku, label, vendor, ...o }) => {
    const base = `${it.source.page}?variant=`, short = (u) => (typeof u === 'string' && u.startsWith(base) ? u.slice(base.length) : u);
    const { url, currency, ...rest } = o;
    return { ...rest, ...(url && url.startsWith(base) ? { vid: short(url) } : { url }), ...(currency && currency !== 'USD' ? { currency } : {}), ...(o.colors ? { colors: Object.fromEntries(Object.entries(o.colors).map(([k, u]) => [k, short(u)])) } : {}) };
  }),
  image: { ...it.image, data: it.image.src },
}));
const json = JSON.stringify({ ...catalog, items }).replace(/</g, '\\u003c');

const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  .replace('{{CSS}}', () => css)
  .replace('{{CATALOG}}', () => json)
  .replace('{{APP}}', () => app.replace(/<\/script/gi, '<\\/script'));

// Rebuilt each time, except docs/v1, the first version of the site, kept as it was.
rmSync(join(root, 'docs/art'), { recursive: true, force: true });
rmSync(join(root, 'docs/index.html'), { force: true });
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
