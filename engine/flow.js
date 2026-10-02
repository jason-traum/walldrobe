// Free-form layouts. No set places and no set shapes: look at all the open wall
// (the wall less a buffer around the TV, lamps, windows and doors, the space over
// furniture, the ceiling and the ends), then hang it the way a person would. Put
// one piece in a good open spot, then add pieces next to the ones already up, the
// same gap apart and lined up with them where they can be, and keep going until
// the open wall or the count runs out. The art can wrap the TV, run wall to wall,
// climb beside a lamp or sit lopsided, wherever the space is.
// Pure: seeded randomness only, same input, same output.

import { RULES } from './constants.js';
import { overlaps, expand, q, EPS, freeIntervals, ANCHORS, SCREENS, cmpStr } from './geometry.js';

const G = RULES.gap;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const sizeKey = (w, h) => `${w}x${h}`;

// A small seeded random source (mulberry32), for variety that stays repeatable.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The open wall: where a frame may go, and how much of it there is.
export function openSpace(wall, regions) {
  const s = { x0: RULES.edge, x1: wall.width - RULES.edge, y0: RULES.flowLow, y1: wall.height - RULES.ceilingHard, regions };
  const step = 2;
  let cells = 0;
  for (let y = s.y0 + step / 2; y < s.y1; y += step) {
    for (let x = s.x0 + step / 2; x < s.x1; x += step) {
      if (!regions.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h)) cells++;
    }
  }
  return { ...s, area: cells * step * step };
}

function fits(r, space, placed) {
  if (r.x < space.x0 - EPS || r.x + r.w > space.x1 + EPS || r.y < space.y0 - EPS || r.y + r.h > space.y1 + EPS) return false;
  for (const b of space.regions) if (overlaps(r, b)) return false;
  for (const p of placed) if (overlaps(r, expand(p, RULES.gapMin - EPS))) return false;
  return true;
}

// Good spots for the first piece: centered over the TV or furniture, and the
// middle of each open stretch at and around eye level.
function seedsFor(wall, obstacles, space) {
  const out = [];
  const add = (s) => { if (!out.some((o) => Math.hypot(o.cx - s.cx, o.y - s.y) < 8)) out.push(s); };
  const anchors = obstacles.filter((o) => (SCREENS.has(o.kind) && o.w >= 20) || (ANCHORS.has(o.kind) && o.w >= RULES.minAnchorWidth))
    .sort((a, b) => b.w - a.w || cmpStr(a.id, b.id));
  for (const a of anchors.slice(0, 2)) {
    const gap = SCREENS.has(a.kind) ? RULES.blockerClear + G : RULES.clearance;
    add({ cx: a.x + a.w / 2, y: a.y + a.h + gap, by: 'bottom' });
  }
  for (const cy of [RULES.centerline, RULES.centerline - 10, RULES.centerline + 10]) {
    for (const iv of freeIntervals(wall.width, space.regions, cy - 6, cy + 6)) {
      if (iv.w >= 14) add({ cx: iv.x0 + iv.w / 2, y: cy, by: 'center' });
    }
  }
  return out.slice(0, 6);
}

// The first piece: at the seed if it fits there, else the nearest spot that does.
function placeFirst(seed, w, h, space, placed) {
  const y0 = seed.by === 'bottom' ? seed.y : seed.y - h / 2;
  const x0 = seed.cx - w / 2;
  for (let d = 0; d <= 30; d += 1) {
    const tries = d === 0 ? [[0, 0]] : [[0, d], [-d, 0], [d, 0], [0, -d], [-d, d], [d, d]];
    for (const [dx, dy] of tries) {
      const r = { x: q(x0 + dx), y: q(y0 + dy), w, h };
      if (fits(r, space, placed)) return r;
    }
  }
  return null;
}

// Where a w x h frame could go next to the ones already up: beside each, the
// gap apart, lined up with its top, bottom or middle (or its sides, above and
// below). Neat layouts line up only on edges.
function spotsBeside(placed, w, h, neat) {
  const out = [];
  for (const f of placed) {
    const ys = neat ? [f.y, f.y + f.h - h] : [f.y, f.y + f.h - h, f.y + (f.h - h) / 2];
    const xs = neat ? [f.x, f.x + f.w - w] : [f.x, f.x + f.w - w, f.x + (f.w - w) / 2];
    for (const y of ys) { out.push({ x: f.x + f.w + G, y, w, h }); out.push({ x: f.x - G - w, y, w, h }); }
    for (const x of xs) { out.push({ x, y: f.y + f.h + G, w, h }); out.push({ x, y: f.y - G - h, w, h }); }
  }
  return out.map((r) => ({ x: q(r.x), y: q(r.y), w, h }));
}

// How many of a spot's edges and middles line up with frames already up.
function lined(r, placed) {
  const xs = new Set(), ys = new Set();
  for (const p of placed) {
    for (const v of [p.x, p.x + p.w, p.x + p.w / 2]) xs.add(q(v));
    for (const v of [p.y, p.y + p.h, p.y + p.h / 2]) ys.add(q(v));
  }
  let n = 0;
  for (const v of [r.x, r.x + r.w, r.x + r.w / 2]) if (xs.has(q(v))) n++;
  for (const v of [r.y, r.y + r.h, r.y + r.h / 2]) if (ys.has(q(v))) n++;
  return Math.min(4, n);
}

// The frame sizes a run uses, by size class.
function classes(sizes) {
  const long = ([w, h]) => Math.max(w, h);
  const all = [...sizes].sort((a, b) => b[0] * b[1] - a[0] * a[1] || a[0] - b[0]);
  return {
    big: all.filter((s) => long(s) >= 24),
    mid: all.filter((s) => long(s) >= 15 && long(s) < 24),
    small: all.filter((s) => long(s) < 15),
  };
}

// The kinds of run: which sizes go up in what order, and how the group grows.
// Neat runs keep one or two frame sizes and line up on edges, so they come out
// as rows and grids that bend around what's on the wall.
const PLANS = [
  { name: 'hero', neat: false, order: ['big', 'mid', 'small', 'small', 'mid', 'small'] },
  { name: 'mixed', neat: false, order: ['mid', 'small', 'mid', 'small'] },
  { name: 'small', neat: false, order: ['small', 'small', 'mid'] },
  { name: 'even', neat: true, order: ['mid'] },
  { name: 'even-small', neat: true, order: ['small'] },
  { name: 'pair', neat: true, order: ['big', 'mid', 'mid'] },
];
// Grow evenly, mostly sideways, or mostly up and down.
const GROWTH = [{ name: 'round', bx: 1, by: 1 }, { name: 'wide', bx: 0.45, by: 2.2 }, { name: 'tall', bx: 2.2, by: 0.45 }];

/**
 * Free-form structures for one set of fixed pieces.
 * @returns {{ structures: object[], counts: Set<number> }}
 */
export function flowStructures({ wall, obstacles, space, pinned = [], fixed, sizes, avail, pieces = null, style = null, most = RULES.flowMax, keepTop = 5 }) {
  const counts = new Set();
  if (space.area < 150) return { structures: [], counts };
  const cls = classes(sizes.filter(([w, h]) => avail.has(sizeKey(w, h))));
  if (!cls.big.length && !cls.mid.length && !cls.small.length && !fixed.length) return { structures: [], counts };
  const seeds = seedsFor(wall, obstacles, space);
  if (!seeds.length) return { structures: [], counts };
  const plans = PLANS.filter((p) => !style || (style === 'structured' ? p.neat : !p.neat));
  // Pieces already hanging where they are: frames to line up with, not to move.
  const pinnedRects = pinned.map((p) => ({ x: p.at.x, y: p.at.y, w: p.w, h: p.h, pinned: true }));
  const ownFirst = [...fixed].sort((a, b) => b.w * b.h - a.w * a.h || cmpStr(a.id, b.id));
  const cap = Math.min(pieces || most, most);

  const snaps = [];
  let run = 0;
  for (const seed of seeds) {
    for (const plan of plans) {
      for (const grow of GROWTH) {
        const rand = rng(1013 + 7919 * run++);
        const used = new Map(); // size key -> how many slots, so there's art for each
        const room = (s) => (avail.get(sizeKey(s[0], s[1])) || 0) - (used.get(sizeKey(s[0], s[1])) || 0) > 0;
        // Neat runs pick their one or two sizes up front.
        const pickFrom = (list) => list.filter(room)[Math.floor(rand() * Math.min(3, list.filter(room).length))];
        const neatSizes = plan.neat ? plan.order.map((c) => cls[c].length ? cls[c] : cls.mid.length ? cls.mid : cls.small).map(pickFrom) : null;
        const placed = [];
        const slots = [];
        const queue = [...ownFirst];
        for (let k = 0; k < cap; k++) {
          const own = queue[0] || null;
          let want;
          if (own) want = [[own.w, own.h]];
          else if (plan.neat) want = [neatSizes[k % neatSizes.length], ...neatSizes].filter(Boolean).filter(room);
          else {
            const c = plan.order[(k - ownFirst.length + plan.order.length * 4) % plan.order.length];
            const order = c === 'big' ? ['big', 'mid', 'small'] : c === 'mid' ? ['mid', 'small'] : ['small', 'mid'];
            want = order.flatMap((o) => {
              const list = cls[o].filter(room);
              // A couple of sizes from the class, in a shuffled order, for variety.
              return [...list].sort(() => rand() - 0.5).slice(0, 3);
            });
          }
          if (!want.length) break;
          let best = null;
          for (const [w, h] of want) {
            if (!placed.length) {
              const r = placeFirst(seed, w, h, space, pinnedRects);
              if (r) { best = { r, v: 0 }; break; }
              continue;
            }
            const all = [...placed, ...pinnedRects];
            const A = sum(placed.map((p) => p.w * p.h));
            const cx = sum(placed.map((p) => (p.x + p.w / 2) * p.w * p.h)) / A;
            const cy = sum(placed.map((p) => (p.y + p.h / 2) * p.w * p.h)) / A;
            for (const r of spotsBeside(all, w, h, plan.neat)) {
              if (!fits(r, space, all)) continue;
              const dx = (r.x + w / 2 - cx) / 24, dy = (r.y + h / 2 - cy) / 24;
              const eye = Math.max(0, Math.abs(r.y + h / 2 - RULES.centerline - 3) - 8) / 30;
              const v = -Math.hypot(grow.bx * dx, grow.by * dy) + 0.35 * lined(r, all) - eye + 0.25 * rand();
              if (!best || v > best.v + EPS) best = { r, v };
            }
            // The size asked for fits somewhere: take its best spot before trying others.
            if (best) break;
          }
          if (!best) {
            if (own && own.keep === 'must') { slots.length = 0; break; } // a piece you keep doesn't fit: this run is out
            if (own) { queue.shift(); continue; }
            break;
          }
          placed.push(best.r);
          slots.push({ ...best.r, fixed: own });
          if (own) queue.shift();
          else used.set(sizeKey(best.r.w, best.r.h), (used.get(sizeKey(best.r.w, best.r.h)) || 0) + 1);
          // Every pieces-you-keep must be in before a snapshot counts.
          if (queue.some((p) => p.keep === 'must')) continue;
          if (slots.length >= 2 || (slots.length === 1 && slots[0].fixed)) snaps.push({ slots: slots.slice(), plan, grow, seed });
        }
      }
    }
  }

  for (const s of snaps) counts.add(s.slots.length);
  const pool = pieces ? snaps.filter((s) => s.slots.length === pieces) : snaps;
  // Judge the shapes before any art goes in: how much of the open wall they use,
  // how tight the group is, and whether it sits near eye level.
  for (const s of pool) {
    const r = s.slots;
    const x0 = Math.min(...r.map((p) => p.x)), x1 = Math.max(...r.map((p) => p.x + p.w));
    const y0 = Math.min(...r.map((p) => p.y)), y1 = Math.max(...r.map((p) => p.y + p.h));
    const area = sum(r.map((p) => p.w * p.h));
    const fill = area / ((x1 - x0) * (y1 - y0));
    const cy = sum(r.map((p) => (p.y + p.h / 2) * p.w * p.h)) / area;
    s.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    s.pre = 0.5 * Math.min(1, area / space.area / 0.3) + 0.3 * fill - Math.max(0, Math.abs(cy - RULES.centerline - 3) - 6) / 30;
  }
  pool.sort((a, b) => b.pre - a.pre);
  // Keep the best of each count and kind, then the next best, so the list has range.
  const out = [];
  const seen = new Set();
  const shape = (s) => s.slots.map((p) => `${q(p.x)},${q(p.y)},${p.w}x${p.h}`).sort().join(';');
  const take = (s) => {
    const sig = shape(s);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(s);
  };
  // With no count asked for: the best two of each size of wall (light, medium,
  // full) and each look (neat, loose), so the list has range and stays quick.
  const band = (n) => (pieces ? n : n <= 5 ? 0 : n <= 9 ? 1 : 2);
  const per = new Map();
  for (const s of pool) {
    const k = `${band(s.slots.length)}|${s.plan.neat}`;
    if ((per.get(k) || 0) >= (pieces ? keepTop : 1)) continue;
    const before = out.length;
    take(s);
    if (out.length > before) per.set(k, (per.get(k) || 0) + 1);
  }
  out.sort((a, b) => b.pre - a.pre);
  const top = out.slice(0, keepTop + 1);

  const structures = top.map((s) => {
    const b = s.box;
    const ordered = [...s.slots].sort((a, c) => c.w * c.h - a.w * a.h || a.x - c.x || a.y - c.y);
    return {
      family: 'flow', variant: s.plan.neat ? 'neat' : 'loose', W: b.w, H: b.h, at: { x: b.x, y: b.y },
      slots: ordered.map((p, i) => ({ w: p.w, h: p.h, dx: q(p.x - b.x), dy: q(p.y - b.y), fixed: p.fixed || null, row: null, role: null })),
      meta: { ragged: 0, gaps: [G], rows: null },
      pre: s.pre,
    };
  });
  return { structures, counts };
}
