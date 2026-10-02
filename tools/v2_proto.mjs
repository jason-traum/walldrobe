// v2 prototype: the feed and an open wall in the painter's tape direction, as two
// static pages, built from the real engine on the sample living room with
// Jason's two prints added and the long-title fixture on one new piece.
// Usage: node tools/v2_proto.mjs   -> web/v2/proto-feed.html, web/v2/proto-wall.html
// Serve the repo root and open /web/v2/proto-feed.html.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../engine/index.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { fitTaste, scoreTaste } from '../engine/taste.js';
import { WALLS, SAMPLE_PICKS } from '../demo/samples.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogRaw = JSON.parse(readFileSync(join(root, 'demo/catalog.json'), 'utf8'));
const CATALOG = activeRecords(catalogRaw.items).map((r) => ({ ...toCandidate(r), aspect: r.image.aspect }));
const byId = new Map(CATALOG.map((c) => [c.id, c]));
const LONG = 'Portrait of a Woman in a Striped Dress Seated Beside a Window, 1887';

const living = WALLS.find((w) => w.key === 'living');
const owned = [
  { id: 'blue', title: 'blue print', w: 23, h: 32, keep: 'happy', palette: [{ hex: '#2C2C8C', weight: 0.8 }, { hex: '#F2F2F2', weight: 0.2 }], color: '#2C2C8C' },
  { id: 'smiley', title: 'smiley print', w: 26, h: 18, keep: 'happy', palette: [{ hex: '#C8A040', weight: 0.6 }, { hex: '#4A4038', weight: 0.4 }], color: '#C8A040' },
];
const shop = CATALOG.filter((c) => c.offers.length);
const firstOf = (cat, n = 0) => CATALOG.filter((c) => c.record.category === cat)[n];
const picks = SAMPLE_PICKS.map(([w, l], i) => ({ winner: firstOf(w, i % 2), loser: firstOf(l, i % 2) })).filter((p) => p.winner && p.loser);
const taste = scoreTaste(fitTaste(picks), shop);
const r = layout({ wall: living.wall, obstacles: living.obstacles, owned, catalog: shop, taste, room: living.room, count: 9, prefs: { fullness: 'full' } });
const walls = r.layouts;
if (!walls.length) { console.error(r.problems); process.exit(1); }
// The long-title fixture on the first new piece of the first wall.
const first = walls[0].pieces.find((p) => p.ref.source === 'catalog');
if (first) first.title = LONG;
console.log(`${walls.length} walls`);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inches = (v) => { const whole = Math.floor(v + 1e-9), frac = Math.round((v - whole) * 4); const f = ['', '¼', '½', '¾'][frac] || ''; return `${frac === 4 ? whole + 1 : whole}${frac === 4 ? '' : f} in`; };
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const imgSrc = (c) => (c.image.startsWith('http') ? c.image : `/demo/${c.image}`);

// ---- tape ----
// A strip of tape from (x1,y1) to (x2,y2), `w` wide, torn at both ends, a hair off square.
let seedN = 7;
const rnd = () => { seedN = (seedN * 9301 + 49297) % 233280; return seedN / 233280; };
function strip(x1, y1, x2, y2, w, k) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const h = w / 2;
  const torn = (sx, sy, dir) => {
    // Six short jags across the end, each 0.1 to 0.25 in deep along the strip.
    const pts = []; const n = 4;
    for (let i = 0; i <= n; i++) {
      const t = -h + (w * i) / n;
      const d = (i === 0 || i === n) ? 0 : (0.15 + rnd() * 0.35) * dir;
      pts.push([sx + nx * t + ux * d, sy + ny * t + uy * d]);
    }
    return pts;
  };
  const a = torn(x1, y1, 1), b = torn(x2, y2, -1).reverse();
  const d = [...a, ...b].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rot = ((k % 2 ? 1 : -1) * (0.3 + rnd() * 0.9)).toFixed(2);
  return `<path d="${d}" class="tape" transform="rotate(${rot} ${cx} ${cy})"/>`;
}
const TAPE_W = 1.41, LAP = 1.5;
function tapeRect(x, y, w, h, k) {
  // y is SVG y (top). Horizontal strips run past the corners, verticals tuck under.
  return [
    strip(x - LAP, y, x + w + LAP, y, TAPE_W, k),
    strip(x - LAP, y + h, x + w + LAP, y + h, TAPE_W, k + 1),
    strip(x, y - LAP, x, y + h + LAP, TAPE_W, k + 2),
    strip(x + w, y - LAP, x + w, y + h + LAP, TAPE_W, k + 3),
  ].join('');
}

// ---- wall drawing ----
function furniture(o, H) {
  const y = H - o.y - o.h, base = `x="${o.x}" y="${y}" width="${o.w}" height="${o.h}"`;
  if (o.kind === 'couch') { const arm = Math.min(7, o.w * 0.09); return `<g class="furn"><rect ${base} rx="3"/><rect x="${o.x}" y="${y + o.h * 0.35}" width="${arm}" height="${o.h * 0.65}" rx="2" class="furn-dark"/><rect x="${o.x + o.w - arm}" y="${y + o.h * 0.35}" width="${arm}" height="${o.h * 0.65}" rx="2" class="furn-dark"/><line x1="${o.x + arm}" x2="${o.x + o.w - arm}" y1="${y + o.h * 0.62}" y2="${y + o.h * 0.62}" class="seam"/></g>`; }
  if (o.kind === 'window') return `<g class="window"><rect ${base}/><line x1="${o.x + o.w / 2}" x2="${o.x + o.w / 2}" y1="${y}" y2="${y + o.h}"/><line x1="${o.x}" x2="${o.x + o.w}" y1="${y + o.h / 2}" y2="${y + o.h / 2}"/></g>`;
  if (o.kind === 'outlet' || o.kind === 'switch') return `<rect ${base} rx="0.4" class="fixture"/>`;
  return `<rect ${base} class="furn"/>`;
}
function piece(p, H, k) {
  const y = H - p.y - p.h;
  const own = p.ref.source === 'catalog' ? null : owned.find((o) => o.id === p.ref.id);
  if (own) {
    return `<g class="art own" data-id="${esc(p.ref.id)}"><rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame"/><rect x="${p.x + 0.75}" y="${y + 0.75}" width="${p.w - 1.5}" height="${p.h - 1.5}" fill="${own.color}"/></g>`;
  }
  const c = byId.get(p.ref.id);
  const m = 1.2; // mat under the tape
  return `<g class="art new" data-id="${esc(p.ref.id)}"><rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="mat"/><image href="${imgSrc(c)}" x="${p.x + m}" y="${y + m}" width="${p.w - 2 * m}" height="${p.h - 2 * m}" preserveAspectRatio="xMidYMid slice"/>${tapeRect(p.x, y, p.w, p.h, k * 4)}</g>`;
}
function wallSvg(L, { label } = {}) {
  const W = living.wall.width, H = living.wall.height, pad = 2;
  const arts = L.pieces.map((p, i) => piece(p, H, i)).join('');
  return `<svg viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}" role="img" aria-label="${esc(label)}">
    <rect x="0" y="0" width="${W}" height="${H}" class="wall"/><rect x="0" y="${H - 4}" width="${W}" height="4" class="base"/>
    ${living.obstacles.map((o) => furniture(o, H)).join('')}
    ${arts}
  </svg>`;
}

// ---- words ----
function who(L) {
  const own = L.pieces.filter((p) => p.ref.source === 'owned').length, fresh = L.pieces.length - own;
  const yours = own === 0 ? '' : own === owned.length ? `Both of yours` : own === 1 ? 'One of yours' : `${own} of yours`;
  const news = fresh === 0 ? 'nothing new' : fresh === 1 ? 'one new' : `${['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][fresh] || fresh} new`;
  return yours ? `${yours}, ${news}.` : `${news[0].toUpperCase()}${news.slice(1)}.`;
}
function shape(L) {
  const s = (L.summary || '').replace(/\.$/, '');
  // Engine summaries read "A free-form gallery wall of 6, 77 in across, with 6 new pieces." Keep the middle.
  const m = s.match(/^(?:A |An )?(.*?)(?:, with .*)?$/);
  let t = m ? m[1] : s;
  t = t.replace(/^free-form gallery wall of \d+/, 'A loose gallery wall').replace(/^(\d+) pieces lined up/, 'Lined up').replace(/^One statement piece/, 'One big piece');
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}
const cost = (L) => L.pieces.reduce((s, p) => s + (p.price || 0), 0);
const costLine = (L) => { const n = L.pieces.filter((p) => p.ref.source === 'catalog').length, c = cost(L); return n ? `${money(c)} for ${n} new print${n === 1 ? '' : 's'}` : 'Nothing to buy'; };

// ---- pages ----
const head = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://api.fontshare.com"><link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap">
<link rel="stylesheet" href="v2.css"></head><body>`;
const foot = `</body></html>`;

const header = (left, right) => `<header class="top"><div class="left">${left}</div><div class="right">${right}</div></header>`;

function feedPage() {
  const items = walls.map((L, i) => `<article class="entry" id="w${i + 1}">
    <div class="drawing">${wallSvg(L, { label: `Wall ${i + 1} of ${walls.length}` })}<span class="chip">Sample wall</span></div>
    <p class="count">${i + 1} of ${walls.length}</p>
    <p class="why">${esc(who(L))} ${esc(shape(L))}</p>
    <p class="cost">${esc(costLine(L))}</p>
    <div class="acts"><a class="btn" href="proto-wall.html">Get this wall</a><button type="button" class="btn quiet">Save</button></div>
  </article>`).join('');
  return `${head('Your wall · Walldrobe')}${header('<a class="wordmark" href="#">Walldrobe</a>', '<button type="button" class="btn quiet small">Change</button>')}
  <main class="feed">${items}</main>${foot}`;
}

function wallPage() {
  const L = walls[0];
  const rows = [...L.pieces].sort((a, b) => (b.ref.source === 'owned') - (a.ref.source === 'owned') || b.w * b.h - a.w * a.h).map((p, i) => {
    const own = p.ref.source !== 'catalog';
    const c = own ? null : byId.get(p.ref.id);
    const thumb = own
      ? `<span class="thumb" style="aspect-ratio:${p.w}/${p.h};background:${owned.find((o) => o.id === p.ref.id).color}"></span>`
      : `<span class="thumb" style="aspect-ratio:${c.aspect}"><img src="${imgSrc(c)}" alt=""></span>`;
    const meta = own ? `${p.w} x ${p.h} in. Yours.` : `${p.w} x ${p.h} in, ${money(p.price)} at ${esc(c.source)}`;
    const reason = (p.reason || '').replace('close to what you picked in the quiz', 'a good fit for the room');
    const saved = i === 2;
    return `<li class="row">${thumb}<div class="text"><p class="name">${esc(own ? `Your ${p.title}` : p.title)}</p><p class="meta">${meta}</p><p class="reason">${esc(reason)}</p></div>
      ${own ? '<span class="tick" aria-label="Yours">✓</span>' : `<button type="button" class="heart${saved ? ' on' : ''}" aria-pressed="${saved}" aria-label="Save">${saved ? '♥' : '♡'}</button>`}</li>`;
  }).join('');
  return `${head('Wall 1 of 9 · Walldrobe')}${header('<a class="back" href="proto-feed.html">‹ 1 of 9</a>', '<button type="button" class="btn quiet small">Change</button>')}
  <main class="open">
    <div class="drawing pinned">${wallSvg(L, { label: 'Wall 1 of 9' })}<span class="chip">Sample wall</span></div>
    <p class="why">${esc(who(L))} ${esc(shape(L))}</p>
    <p class="cost">${esc(costLine(L))}</p>
    <h2>In this wall</h2>
    <ul class="rows">${rows}</ul>
    <div class="acts sticky"><button type="button" class="btn">Get this wall · ${money(cost(L))}</button><button type="button" class="btn quiet">Save</button></div>
  </main>${foot}`;
}

const css = `
:root { color-scheme: light dark;
  --canvas:#F4F4F2; --surface:#FFFFFF; --ink:#1A1B1A; --pencil:#585C5F; --hairline:#D9DBD8;
  --tape:#1B62AC; --tape-strip:#2F7FD0; --tape-soft:#D6E6F7; --on-tape:#FFFFFF; --marker:#9C3A66; --marker-soft:#F3E2EA; --error:#A12A14;
  --wall:#E7E6E2; --frame:#1B1B1B; --mat:#FBFBF9; --furn:#B9B8B4; --furn-dark:#9D9C98; --glass:#D7DEE4;
  --r-control:6px; --r-sheet:10px; --shadow:0 8px 24px rgba(20,24,28,.12); --ease:cubic-bezier(.23,1,.32,1); }
@media (prefers-color-scheme: dark) { :root { --canvas:#1C1D1C; --surface:#242624; --ink:#ECEDEB; --pencil:#A9ADB1; --hairline:#343635; --tape:#7FB3EC; --tape-soft:#203247; --on-tape:#0E1A28; --marker:#E08DB4; --marker-soft:#3A2430; --error:#FF9C85; } }
* { box-sizing:border-box; }
html, body { background:var(--canvas); margin:0; }
body { color:var(--ink); font: 400 15px/22px Switzer, -apple-system, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing:antialiased; -webkit-text-size-adjust:100%; padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); }
p { margin:0; text-wrap:pretty; }
.top { display:flex; align-items:center; justify-content:space-between; padding: 12px 16px; max-width: 1200px; margin: 0 auto; }
.wordmark { color:var(--ink); text-decoration:none; font-weight:600; font-size:18px; }
.back { color:var(--ink); text-decoration:none; font-weight:500; font-size:16px; padding: 8px 0; }
.btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding: 0 16px; border-radius:var(--r-control); background:var(--tape); color:var(--on-tape); font: 600 16px/20px inherit; font-family:inherit; border:0; text-decoration:none; cursor:pointer; touch-action:manipulation; transition: transform 120ms var(--ease); }
.btn:active { transform:scale(.97); }
.btn.quiet { background:var(--surface); color:var(--ink); border:1px solid var(--hairline); }
.btn.small { min-height:40px; font-size:15px; }
:focus-visible { outline:2px solid var(--tape); outline-offset:2px; }
.feed { display:grid; gap:48px; padding: 4px 16px 48px; max-width:760px; margin:0 auto; }
.entry { display:grid; gap:8px; }
.drawing { position:relative; }
.drawing svg { display:block; width:100%; height:auto; }
.chip { position:absolute; top:10px; left:10px; background:var(--surface); color:var(--pencil); font-size:13px; line-height:18px; padding: 3px 8px; border-radius:999px; }
.count { color:var(--pencil); font-weight:500; font-size:14px; line-height:20px; margin-top:24px; font-variant-numeric:tabular-nums; }
.why { font-size:18px; line-height:24px; font-weight:500; text-wrap:balance; max-width:34em; }
.cost { color:var(--pencil); font-size:14px; line-height:20px; font-variant-numeric:tabular-nums; }
.acts { display:flex; gap:8px; margin-top:8px; }
.open { display:grid; gap:8px; padding: 4px 16px 96px; max-width:760px; margin:0 auto; }
.open .why { margin-top:24px; }
h2 { font-size:16px; line-height:22px; font-weight:600; margin: 32px 0 0; }
.rows { list-style:none; margin:0; padding:0; background:var(--surface); border-radius:var(--r-sheet); }
.row { display:grid; grid-template-columns: 56px 1fr auto; gap: 12px; padding: 12px 12px; align-items:start; border-top:1px solid var(--hairline); }
.row:first-child { border-top:0; }
.thumb { display:block; width:56px; overflow:hidden; border-radius:3px; background:var(--wall); }
.thumb img { display:block; width:100%; height:100%; object-fit:cover; }
.name { font-weight:500; font-size:16px; line-height:22px; }
.meta { color:var(--pencil); font-size:14px; line-height:20px; font-variant-numeric:tabular-nums; }
.reason { font-size:15px; line-height:22px; margin-top:2px; }
.heart { width:44px; height:44px; border:0; background:transparent; color:var(--marker); font-size:22px; border-radius:50%; cursor:pointer; margin: -4px -8px 0 0; }
.heart.on { background:var(--marker-soft); }
.tick { width:44px; height:44px; display:grid; place-items:center; color:var(--marker); font-weight:600; margin: -4px -8px 0 0; }
.sticky { position:sticky; bottom:0; padding: 12px 0 max(12px, env(safe-area-inset-bottom)); background:linear-gradient(to top, var(--canvas) 70%, transparent); }
/* the wall */
.wall { fill:var(--wall); } .base { fill:#CFCDC8; }
.furn rect, rect.furn { fill:var(--furn); } .furn-dark { fill:var(--furn-dark); } .seam { stroke:var(--furn-dark); stroke-width:.4; }
.window rect { fill:var(--glass); } .window line { stroke:#FFFFFF; stroke-width:1.2; }
.fixture { fill:#F6F6F4; stroke:#C9C8C4; stroke-width:.3; }
.frame { fill:var(--frame); } .mat { fill:var(--mat); }
.tape { fill:var(--tape-strip); fill-opacity:.88; }
.mark { fill:var(--marker); }
@media (min-width: 900px) { .feed { max-width: 760px; } .top { padding: 16px 32px; } }
@media (prefers-reduced-motion: reduce) { .btn { transition:none; } }
`;

mkdirSync(join(root, 'web/v2'), { recursive: true });
writeFileSync(join(root, 'web/v2/v2.css'), css);
writeFileSync(join(root, 'web/v2/proto-feed.html'), feedPage());
writeFileSync(join(root, 'web/v2/proto-wall.html'), wallPage());
console.log('wrote web/v2/proto-feed.html, proto-wall.html');
