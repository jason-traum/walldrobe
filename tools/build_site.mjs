// Build the Walldrobe site for GitHub Pages. Usage: node tools/build_site.mjs [esbuild path] [--app]
// Writes docs/index.html (the app bundled, the catalog inlined) and docs/art/ (the images).
// With --app, the app site instead: the same screens with accounts on (web/app-entry.js),
// written to docs/app/index.html and using the same docs/art/.

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../engine/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'esbuild';
const APP = process.argv.includes('--app');

const app = execFileSync(esbuild, [join(root, APP ? 'web/app-entry.js' : 'web/main.js'), '--bundle', '--format=iife', '--minify', '--target=es2020'], { encoding: 'utf8' });
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
  // From docs/app/, the free photos are one folder up.
  image: { ...it.image, data: APP && !/^https?:/.test(it.image.src) ? `../${it.image.src}` : it.image.src },
}));
// The app site's free tier doesn't say where the art comes from (DECISIONS, Oct 6), so its
// page doesn't carry it either: no artist, shop, page, license, credit, description or buy
// link. Sizes, prices and which colors a framed print comes in stay; they say nothing about
// the source. The images still load from where they live (we never re-host a shop's image).
const bare = (it) => ({
  ...it, artist: { name: '' }, source: { provider: '' }, rights: { show: true, sell: false }, description: undefined,
  offers: it.offers.map(({ url, vid, colors, ...o }) => ({ ...o, ...(colors ? { colors: Object.fromEntries(Object.keys(colors).map((k) => [k, 1])) } : {}) })),
});
const json = JSON.stringify(APP ? { schema: catalog.schema, items: items.map(bare) } : { ...catalog, items }).replace(/</g, '\\u003c');

const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  .replace('{{CSS}}', () => css)
  .replace('{{CATALOG}}', () => json)
  .replace('{{APP}}', () => app.replace(/<\/script/gi, '<\\/script'));

if (APP) {
  mkdirSync(join(root, 'docs/app'), { recursive: true });
  writeFileSync(join(root, 'docs/app/index.html'), html.replace('<title>Walldrobe</title>', '<title>Walldrobe</title>\n<meta name="robots" content="noindex">'));
  console.log(`docs/app/index.html ${(html.length / 1e6).toFixed(2)} MB`);
  process.exit(0);
}
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
