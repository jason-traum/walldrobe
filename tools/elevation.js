// Dev tool, not the product UI: draws each sample wall's top layouts as a flat
// elevation with measurements, so a person can check them by eye.
// Usage: node tools/elevation.js [outDir]

import { writeFileSync, mkdirSync } from 'node:fs';
import { layout } from '../engine/index.js';
import { normalizePalette, dominant } from '../engine/color.js';
import { SAMPLE_WALLS } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';

const S = 5; // pixels per inch
const PAD = 40;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function wallSvg(w, L, title) {
  const W = w.wall.width * S, H = w.wall.height * S;
  const Y = (y) => PAD + H - y * S;
  const X = (x) => PAD + x * S;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W + PAD * 2}" height="${H + PAD * 2 + 60}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(`<text x="${PAD}" y="24" font-size="15" fill="#111">${esc(title)}</text>`);
  out.push(`<rect x="${PAD}" y="${PAD}" width="${W}" height="${H}" fill="#f1f1ef" stroke="#999"/>`);
  for (const o of w.obstacles) {
    out.push(`<rect x="${X(o.x)}" y="${Y(o.y + o.h)}" width="${o.w * S}" height="${o.h * S}" fill="#d4d4d0" stroke="#8a8a86"/>`);
    out.push(`<text x="${X(o.x) + 4}" y="${Y(o.y + o.h) + 14}" font-size="11" fill="#555">${esc(o.kind)}</text>`);
  }
  // Centerline at 57 in
  out.push(`<line x1="${PAD}" x2="${PAD + W}" y1="${Y(57)}" y2="${Y(57)}" stroke="#c33" stroke-dasharray="6 5" stroke-width="1"/>`);
  out.push(`<text x="${PAD + W - 70}" y="${Y(57) - 4}" font-size="10" fill="#c33">57 in</text>`);
  if (L) {
    const pals = new Map([...w.catalog, ...w.owned].map((p) => [p.id, normalizePalette(p.palette)]));
    for (const p of L.pieces) {
      const d = dominant(pals.get(p.ref.id) || []);
      const fill = d ? d.hex : '#bbbbbb';
      out.push(`<rect x="${X(p.x)}" y="${Y(p.y + p.h)}" width="${p.w * S}" height="${p.h * S}" fill="#222" />`);
      out.push(`<rect x="${X(p.x) + 5}" y="${Y(p.y + p.h) + 5}" width="${p.w * S - 10}" height="${p.h * S - 10}" fill="${fill}" stroke="${p.ref.source === 'owned' ? '#f5c518' : 'none'}" stroke-width="${p.ref.source === 'owned' ? 3 : 0}"/>`);
      out.push(`<text x="${X(p.cx)}" y="${Y(p.cy) + 4}" font-size="11" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${p.w}x${p.h}</text>`);
      out.push(`<circle cx="${X(p.nail.x)}" cy="${Y(p.nail.y)}" r="2.5" fill="#c33"/>`);
    }
    const g = L.group;
    out.push(`<line x1="${X(g.x)}" x2="${X(g.x + g.w)}" y1="${Y(g.y) + 14}" y2="${Y(g.y) + 14}" stroke="#333"/>`);
    out.push(`<text x="${X(g.x + g.w / 2)}" y="${Y(g.y) + 28}" font-size="11" text-anchor="middle" fill="#333">${g.w} in wide, bottom at ${g.y} in</text>`);
    out.push(`<text x="${PAD}" y="${PAD + H + 26}" font-size="12" fill="#111">${esc(`#${L.rank} ${L.family}${L.variant ? ` (${L.variant})` : ''}, score ${L.score}: ${L.summary}`)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

const outDir = process.argv[2] || 'out';
mkdirSync(outDir, { recursive: true });
const catalog = testCatalog();
const taste = testTaste(catalog);
for (const w of SAMPLE_WALLS) {
  const r = layout({ ...w, catalog, taste });
  const slug = w.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
  r.layouts.forEach((L) => writeFileSync(`${outDir}/${slug}-${L.rank}.svg`, wallSvg({ ...w, catalog }, L, `${w.name}${w.placeholder ? ' (placeholder measurements)' : ''}`)));
  if (!r.layouts.length) writeFileSync(`${outDir}/${slug}-none.svg`, wallSvg({ ...w, catalog }, null, `${w.name}: ${r.problems.map((p) => p.message).join(' ')}`));
}
console.log(`Wrote elevations to ${outDir}/`);
