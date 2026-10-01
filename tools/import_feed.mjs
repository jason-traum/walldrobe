// Bring a shop's affiliate feed into the catalog.
//
//   node tools/import_feed.mjs <feed.csv|feed.tsv> --merchant minted [--limit 200] [--map title=product name,url=buy link]
//
// Writes tools/feeds/<merchant>.tsv. Then run tools/analyze.py: it measures each
// image's colors and shape, and keeps the piece hidden until it has looked-at
// tags in tools/tags.json. Nothing from a feed shows on the site unlooked.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, readFeed, toTsv } from './feed.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const merchant = (opt('merchant', '') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
if (!file || !merchant) {
  console.error('Usage: node tools/import_feed.mjs <feed.csv> --merchant <name> [--limit N] [--map field=column,...]');
  process.exit(1);
}
const overrides = Object.fromEntries((opt('map', '') || '').split(',').filter(Boolean).map((kv) => kv.split('=').map((s) => s.trim().toLowerCase())));
const rows = parseCsv(readFileSync(file, 'utf8'));
const { picks, dropped } = readFeed(rows, { merchant, overrides, limit: Number(opt('limit', Infinity)) });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'tools', 'feeds'), { recursive: true });
const out = join(root, 'tools', 'feeds', `${merchant}.tsv`);
writeFileSync(out, toTsv(picks, merchant));

const cats = {};
for (const p of picks) cats[p.category] = (cats[p.category] || 0) + 1;
const noSize = picks.filter((p) => !p.offers.some((o) => o.w)).length;
console.log(`${rows.length} rows, ${picks.length} pieces kept, written to ${out}`);
console.log('Dropped:', dropped);
console.log('By category:', cats);
if (noSize) console.log(`${noSize} pieces have no size we could read; they use standard sizes for their shape and link to the product page.`);
