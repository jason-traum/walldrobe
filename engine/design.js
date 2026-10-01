// Design checks for a whole wall: balance, a focal piece, rhythm, variety, flow
// and mirrored weight. Pieces come in with positions in inches (x, y from the
// bottom left, w, h) and a profile (see theory.js). Weights: ENGINE.md, "v2".

import { RULES } from './constants.js';
import { clamp01, EPS } from './geometry.js';

export const DESIGN_WEIGHTS = Object.freeze({ balance: 0.25, focal: 0.15, rhythm: 0.15, variety: 0.15, flow: 0.1, mirror: 0.05, distinct: 0.15 });
export const BUSY = 0.3; // busyness at or above this reads busy (about the top quarter of the catalog)

// How heavy a piece looks: its area times how heavy it looks per square inch.
export const visualWeight = (p) => p.w * p.h * (0.3 + 1.2 * p.profile.weight);

// Pairs of pieces that touch: side by side with overlapping heights, or one above
// the other with overlapping widths, within a gap and an inch.
export function neighbors(pieces) {
  const near = RULES.gapMax + 1;
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const yGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      const xOver = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOver = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if ((xGap <= near && yOver > 1) || (yGap <= near && xOver > 1)) out.push([i, j]);
    }
  }
  return out;
}

export function focalIndex(pieces) {
  let best = 0;
  pieces.forEach((p, i) => { if (visualWeight(p) > visualWeight(pieces[best]) + EPS) best = i; });
  return best;
}

export function balance(pieces, g) {
  const gcx = g.x + g.w / 2, cy = g.y + g.h / 2;
  let wsum = 0, wx = 0, wy = 0, left = 0, right = 0;
  for (const p of pieces) {
    const w = visualWeight(p);
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    wsum += w; wx += w * pcx; wy += w * pcy;
    if (pcx < gcx - EPS) left += w; else if (pcx > gcx + EPS) right += w; else { left += w / 2; right += w / 2; }
  }
  const off = wsum ? Math.abs(wx / wsum - gcx) / (g.w / 2) : 0;
  const lr = Math.max(left, right) ? Math.min(left, right) / Math.max(left, right) : 1;
  // Heavier at the bottom reads as settled; heavier at the top reads as about to tip.
  const up = wsum ? (wy / wsum - cy) / (g.h / 2) : 0;
  const low = up > 0.1 ? clamp01(1 - (up - 0.1) * 2.5) : 1;
  const score = 0.4 * clamp01(1 - off * 2) + 0.4 * (pieces.length === 1 ? 1 : lr) + 0.2 * low;
  return { score, heavier: lr < 0.8 ? (left > right ? 'left' : 'right') : null, topHeavy: low < 0.8 };
}

export function focal(pieces, g, family, fi) {
  if (family === 'grid' || pieces.length === 1) return { score: 1 };
  const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
  const f = pieces[fi];
  const dx = Math.abs(f.x + f.w / 2 - gcx) / (g.w / 2);
  const dy = Math.abs(f.y + f.h / 2 - gcy) / (g.h / 2);
  const position = clamp01(1 - 1.2 * dx - 0.4 * dy);
  if (family === 'statement') {
    const c = pieces.findIndex((p) => p.role === 'center');
    if (c < 0) return { score: position };
    return { score: c === fi ? 1 : clamp01(visualWeight(pieces[c]) / visualWeight(f)) * 0.8 };
  }
  if (family === 'line' || family === 'column') return { score: position };
  // A two-row hang wants one piece that clearly leads.
  const ws = pieces.map(visualWeight).sort((a, b) => b - a);
  const clarity = clamp01((ws[0] / ws[1] - 1) / 0.4);
  return { score: 0.65 * position + 0.35 * clarity };
}

export function rhythm(pieces, pairs) {
  const busy = (p) => p.profile.busy >= BUSY;
  const busyCount = pieces.filter(busy).length;
  if (!pairs.length) return { score: 1, busyPairs: 0, busyCount };
  const bb = pairs.filter(([i, j]) => busy(pieces[i]) && busy(pieces[j])).length;
  return { score: clamp01(1 - 1.5 * (bb / pairs.length)), busyPairs: bb, busyCount };
}

const top = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return { value: best, n };
};

export function variety(pieces, pairs, family, g) {
  const n = pieces.length;
  if (n < 2) return { score: 1, kind: 'solo' };
  const known = pieces.filter((p) => p.profile.theme);
  if (family === 'grid' || family === 'line') {
    // A series: one theme, and all in color or all black and white. One exception is
    // fine if it's the piece in the middle.
    const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
    const dist = (p) => Math.hypot(p.x + p.w / 2 - gcx, p.y + p.h / 2 - gcy);
    const middle = pieces.reduce((b, p) => (dist(p) < dist(b) - EPS ? p : b), pieces[0]);
    const judge = (list, key) => {
      if (list.length < 2) return 1;
      const t = top(list.map(key));
      const odd = list.filter((p) => key(p) !== t.value);
      if (!odd.length) return 1;
      if (odd.length === 1 && odd[0] === middle) return 0.95;
      return clamp01((t.n / list.length - 0.5) / 0.4);
    };
    // With subjects unknown (pieces you own), don't claim they read as a set.
    const theme = known.length >= 2 ? judge(known, (p) => p.profile.theme) : 0.8;
    const bw = judge(pieces.filter((p) => p.profile.known), (p) => p.profile.bw);
    return { score: 0.5 * theme + 0.5 * bw, kind: 'series' };
  }
  // A mix: no subject over half the wall, no two of the same subject side by side.
  const cats = known.map((p) => p.profile.category);
  const t = top(cats);
  const over = known.length >= 3 ? clamp01((t.n / known.length - 0.5) * 2) : 0;
  const same = pairs.filter(([i, j]) => pieces[i].profile.category && pieces[i].profile.category === pieces[j].profile.category).length;
  // A mirrored pair of flanks may match; they don't touch, so they aren't in pairs.
  const adj = pairs.length ? same / pairs.length : 0;
  return { score: 0.5 * (1 - over) + 0.5 * (1 - adj), kind: 'mix', topCategory: t.n / Math.max(1, known.length) > 0.5 ? t.value : null };
}

// Side pieces should look inward: a left piece's subject sits right of its center.
export function flow(pieces, g) {
  const gcx = g.x + g.w / 2;
  let s = 0, w = 0;
  for (const p of pieces) {
    if (!p.profile.focal) continue;
    const rel = (p.x + p.w / 2 - gcx) / (g.w / 2);
    if (Math.abs(rel) < 0.15) continue;
    const facing = (p.profile.focal.x - 0.5) * -Math.sign(rel);
    const wt = Math.abs(rel) * p.w * p.h;
    s += wt * clamp01(0.5 + facing * 2.5);
    w += wt;
  }
  return { score: w ? s / w : 1, inward: w ? s / w >= 0.7 : null };
}

// Pieces in mirrored slots (same size, mirrored across the middle) should carry similar weight.
export function mirror(pieces, g) {
  const gcx = g.x + g.w / 2;
  const used = new Set();
  const ratios = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue;
    const a = pieces[i];
    const ax = a.x + a.w / 2 - gcx;
    if (Math.abs(ax) < 1) continue;
    for (let j = i + 1; j < pieces.length; j++) {
      if (used.has(j)) continue;
      const b = pieces[j];
      const bx = b.x + b.w / 2 - gcx;
      if (Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1 && Math.abs(ax + bx) <= 1.5 && Math.abs(a.y - b.y) <= 1.5) {
        const wa = visualWeight(a), wb = visualWeight(b);
        ratios.push(Math.min(wa, wb) / Math.max(wa, wb));
        used.add(i); used.add(j);
        break;
      }
    }
  }
  return { score: ratios.length ? ratios.reduce((x, y) => x + y, 0) / ratios.length : 1, pairs: ratios.length };
}

// ---------- Look-alikes ----------

const NEUTRAL = new Set(['black', 'gray', 'white']);
function overlap(a, b, keep) {
  const A = Object.entries(a).filter(([f]) => keep(f));
  const ta = A.reduce((x, [, v]) => x + v, 0);
  const tb = Object.entries(b).filter(([f]) => keep(f)).reduce((x, [, v]) => x + v, 0);
  if (!ta || !tb) return null;
  return A.reduce((x, [f, v]) => x + Math.min(v / ta, (b[f] || 0) / tb), 0);
}

// How much two pieces look like the same picture, 0 to 1: the same subject, the
// same colors (the colorful part counts more than the white and gray around it),
// the same light, busyness and empty space, and the same style. A set can share a
// theme or a color; above about 0.85 it's two copies of one idea.
export function lookalike(a, b) {
  const cat = a.category && a.category === b.category ? 1 : a.theme && a.theme === b.theme ? 0.4 : 0;
  const all = overlap(a.shares, b.shares, () => true) ?? 0;
  const ca = a.chromatic > 0.02, cb = b.chromatic > 0.02;
  const hue = ca && cb ? overlap(a.shares, b.shares, (f) => !NEUTRAL.has(f)) : null;
  const color = hue !== null ? 0.6 * hue + 0.4 * all : ca !== cb ? 0.3 * all : all;
  const d = [Math.abs(a.busy - b.busy) * 2, Math.abs(a.negativeSpace - b.negativeSpace), Math.abs(a.brightness - b.brightness), Math.abs(a.saturation - b.saturation) * 1.5, Math.abs(a.contrast - b.contrast)];
  const comp = clamp01(1 - (d.reduce((x, y) => x + y, 0) / d.length) * 2);
  const sa = new Set(a.styles || []), sb = new Set(b.styles || []);
  const uni = new Set([...sa, ...sb]).size;
  const style = uni ? [...sa].filter((x) => sb.has(x)).length / uni : 0;
  return 0.4 * cat + 0.3 * color + 0.2 * comp + 0.1 * style;
}
export const LOOKALIKE = 0.88; // at or above this, two pieces read as the same picture
export const lookPenalty = (s) => clamp01((s - 0.8) / 0.15);

// No two pieces should look almost the same, anywhere on the wall.
export function distinct(pieces) {
  if (pieces.length < 2) return { score: 1, alike: [] };
  let pen = 0;
  const alike = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const s = lookalike(pieces[i].profile, pieces[j].profile);
      pen += lookPenalty(s);
      if (s >= LOOKALIKE) alike.push([i, j]);
    }
  }
  return { score: clamp01(1 - pen / Math.max(1, pieces.length / 2)), alike };
}

export function designScore(pieces, g, family) {
  const pairs = neighbors(pieces);
  const fi = focalIndex(pieces);
  const b = balance(pieces, g);
  const f = focal(pieces, g, family, fi);
  const r = rhythm(pieces, pairs);
  const v = variety(pieces, pairs, family, g);
  const fl = flow(pieces, g);
  const m = mirror(pieces, g);
  const dz = distinct(pieces);
  const checks = { balance: b.score, focal: f.score, rhythm: r.score, variety: v.score, flow: fl.score, mirror: m.score, distinct: dz.score };
  const W = DESIGN_WEIGHTS;
  const score = Object.keys(W).reduce((a, k) => a + W[k] * checks[k], 0);
  return { score, checks, focalIdx: fi, heavier: b.heavier, topHeavy: b.topHeavy, busyPairs: r.busyPairs, busyCount: r.busyCount, variety: v, inward: fl.inward, mirrorPairs: m.pairs, pairs, alike: dz.alike };
}
