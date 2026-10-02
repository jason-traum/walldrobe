// Free-form layouts. No set places and no set shapes: look at all the open wall
// (the wall less a buffer around the TV, lamps, windows and doors, the space over
// furniture, the ceiling and the ends), then hang it the way a person would. Put
// one piece in a good open spot, then add pieces next to the ones already up, the
// same gap apart and lined up with them where they can be. Sometimes that is one
// group, sometimes two that answer each other across a window or the TV.
// Every candidate is judged as a picture: does it use the right amount of the wall
// for how full the person wants it, does each group read as one shape, do its
// edges line up, does it sit at eye level and relate to the furniture, and does
// the wall balance. Then the best few get a repair pass before art goes in.
// Pure: seeded randomness only, same input, same output.

import { RULES } from './constants.js';
import { overlaps, expand, q, EPS, ANCHORS, SCREENS, FURNITURE, cmpStr, clamp01 } from './geometry.js';

const G = RULES.gap;
// Stepping the count from a layout on screen: frames already shown stay where they are.
const BASE_KEEP = 0.3;
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

// ---------- The open wall ----------

const blockedAt = (regions, x, y) => regions.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);

// The open wall: where a frame may go, and how much of it there is.
export function openSpace(wall, regions) {
  const s = { x0: RULES.edge, x1: wall.width - RULES.edge, y0: RULES.flowLow, y1: wall.height - RULES.ceilingHard, regions };
  return { ...s, area: openIn(s, { x: s.x0, y: s.y0, w: s.x1 - s.x0, h: s.y1 - s.y0 }) };
}

// Open area inside a box, on a 2 in grid.
function openIn(space, b) {
  const step = 2;
  let cells = 0;
  const x0 = Math.max(space.x0, b.x), x1 = Math.min(space.x1, b.x + b.w);
  const y0 = Math.max(space.y0, b.y), y1 = Math.min(space.y1, b.y + b.h);
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (!blockedAt(space.regions, x, y)) cells++;
  return cells * step * step;
}

function fits(r, space, placed, clear = RULES.gapMin) {
  if (r.x < space.x0 - EPS || r.x + r.w > space.x1 + EPS || r.y < space.y0 - EPS || r.y + r.h > space.y1 + EPS) return false;
  for (const b of space.regions) if (overlaps(r, b)) return false;
  for (const p of placed) if (overlaps(r, expand(p, (p.keepOff || clear) - EPS))) return false;
  return true;
}

// ---------- Judging a shape (before any art goes in) ----------

const TARGETS = RULES.fullness;
const boxOf = (fs) => {
  const x0 = Math.min(...fs.map((p) => p.x)), x1 = Math.max(...fs.map((p) => p.x + p.w));
  const y0 = Math.min(...fs.map((p) => p.y)), y1 = Math.max(...fs.map((p) => p.y + p.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const groupsOf = (frames) => {
  const m = new Map();
  for (const f of frames) { const g = f.g || 0; if (!m.has(g)) m.set(g, []); m.get(g).push(f); }
  return [...m.values()];
};

// How much of a frame's side another frame shares across one gap.
function touch(a, b) {
  const near = RULES.gapMax + 1;
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (hGap >= -EPS && hGap <= near && vGap < 0) return (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / a.h;
  if (vGap >= -EPS && vGap <= near && hGap < 0) return (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / a.w;
  return 0;
}

// Lines a frame shares with others in its group: edges and middles, within half an inch.
function sharesLine(f, others) {
  const xs = [f.x, f.x + f.w, f.x + f.w / 2], ys = [f.y, f.y + f.h, f.y + f.h / 2];
  let sx = false, sy = false;
  for (const o of others) {
    if (o === f) continue;
    const ox = [o.x, o.x + o.w, o.x + o.w / 2], oy = [o.y, o.y + o.h, o.y + o.h / 2];
    if (xs.some((v) => ox.some((u) => Math.abs(u - v) <= 0.5))) sx = true;
    if (ys.some((v) => oy.some((u) => Math.abs(u - v) <= 0.5))) sy = true;
  }
  return { sx, sy };
}

// A few strong lines: edges or middles that three or more frames (or half the
// group) share. A layout reads as intentional when most frames sit on one.
function legibility(g) {
  if (g.length === 2) { const s = sharesLine(g[0], g); return s.sx || s.sy ? 1 : 0.5; }
  const need = Math.max(3, Math.ceil(g.length / 2));
  const lines = new Map();
  const addLine = (k, f) => { if (!lines.has(k)) lines.set(k, new Set()); lines.get(k).add(f); };
  for (const f of g) {
    for (const v of [f.x, f.x + f.w, f.x + f.w / 2]) addLine(`x${Math.round(v * 2)}`, f);
    for (const v of [f.y, f.y + f.h, f.y + f.h / 2]) addLine(`y${Math.round(v * 2)}`, f);
  }
  const on = new Set();
  for (const set of lines.values()) if (set.size >= Math.min(need, g.length)) for (const f of set) on.add(f);
  return on.size / g.length;
}

/**
 * How good a set of frames is as a picture on this wall, from 0 to 1.
 * frames: [{x, y, w, h, g}] (g = which group), ctx: { space, wall, obstacles, fullness }.
 */
export function shapeScore(frames, ctx) {
  if (!frames.length) return { score: 0, parts: {} };
  const area = sum(frames.map((f) => f.w * f.h));
  const target = TARGETS[ctx.fullness] || TARGETS.balanced;
  // Fullness: as much art as the person asked for, marked down for too little and too much.
  const cov = area / Math.max(1, ctx.space.area);
  const z = Math.log(Math.max(cov, 1e-3) / target) / 0.45;
  const density = Math.exp(-z * z / 2);

  const groups = groupsOf(frames);
  let cohesion = 0, lines = 0, ears = 0, room = 0;
  const anchors = (ctx.obstacles || []).filter((o) => (SCREENS.has(o.kind) && o.w >= 20) || (ANCHORS.has(o.kind) && o.w >= RULES.minAnchorWidth));
  for (const g of groups) {
    const ga = sum(g.map((f) => f.w * f.h));
    const b = boxOf(g);
    // A group reads as one shape when art fills most of the open wall inside its outline.
    // What's blocked inside it (a TV it wraps) doesn't count against it.
    const open = Math.max(ga, openIn(ctx.space, b));
    const fill = ga / open;
    cohesion += ga * clamp01((fill - 0.3) / 0.45);
    if (g.length > 1) {
      lines += ga * legibility(g);
      // A small frame hanging off the group by a corner reads as an afterthought.
      const n = g.filter((f) => g.length >= 3 && Math.max(0, ...g.filter((o) => o !== f).map((o) => touch(f, o))) < 0.35).length;
      ears += ga * (1 - n / g.length);
    } else { lines += ga; ears += ga; }
    // Relation to the room: centered on the TV or furniture it sits over or wraps,
    // or sharing a line with it when beside it; on bare wall, near the middle.
    const gcx = b.x + b.w / 2;
    let rel = null;
    for (const a of anchors) {
      const overX = b.x < a.x + a.w - EPS && a.x < b.x + b.w - EPS;
      if (overX && b.y + b.h > a.y + a.h) {
        const v = 1 - Math.min(1, Math.abs(gcx - (a.x + a.w / 2)) / Math.max(12, a.w / 2));
        rel = Math.max(rel ?? 0, v);
      } else if (!overX && b.y < a.y + a.h + 24 && b.y + b.h > a.y) {
        const top = a.y + a.h;
        const shared = [b.y + b.h, b.y, b.y + b.h / 2].some((v) => Math.abs(v - top) <= 1 || Math.abs(v - (a.y + a.h / 2)) <= 1);
        rel = Math.max(rel ?? 0, shared ? 1 : 0.6);
      }
    }
    if (rel === null) rel = Math.max(0.55, 1 - Math.abs(gcx - ctx.wall.width / 2) / (ctx.wall.width / 2));
    room += ga * rel;
  }
  cohesion /= area; lines /= area; ears /= area; room /= area;

  // Eye level: the art's center of mass near 60 in.
  const cy = sum(frames.map((f) => (f.y + f.h / 2) * f.w * f.h)) / area;
  const eye = clamp01(1 - Math.max(0, Math.abs(cy - RULES.centerline - 3) - 7) / 18);

  // The whole wall balances: art plus the heavy things on it, left to right.
  let m = 0, mx = 0;
  const add = (r, k) => { const a = r.w * Math.min(r.h, 48) * k; m += a; mx += a * (r.x + r.w / 2); };
  for (const f of frames) add(f, 1);
  for (const o of ctx.obstacles || []) add(o, SCREENS.has(o.kind) ? 0.8 : FURNITURE.has(o.kind) ? 0.35 : o.kind === 'lamp' ? 0.3 : 0.15);
  const balance = clamp01(1 - Math.abs(mx / m - ctx.wall.width / 2) / (0.32 * ctx.wall.width));

  // Two groups should answer each other: a shared top, bottom or middle line, and repeated sizes.
  let pair = 1;
  if (groups.length >= 2) {
    const [A, B] = [...groups].sort((a, c) => sum(c.map((f) => f.w * f.h)) - sum(a.map((f) => f.w * f.h)));
    const a = boxOf(A), b = boxOf(B);
    const lined = [[a.y, b.y], [a.y + a.h, b.y + b.h], [a.y + a.h / 2, b.y + b.h / 2]].some(([u, v]) => Math.abs(u - v) <= 1);
    const sizes = new Set(A.map((f) => sizeKey(f.w, f.h)));
    const repeat = B.some((f) => sizes.has(sizeKey(f.w, f.h)));
    pair = (lined ? 0.7 : 0.3) + (repeat ? 0.3 : 0);
    if (groups.length > 2) pair *= 0.6;
  }

  const parts = { density, cohesion, lines, ears, eye, room, balance, pair };
  const score = 0.24 * density + 0.18 * cohesion + 0.13 * lines + 0.1 * ears + 0.13 * eye
    + (groups.length > 1 ? 0.07 * room + 0.07 * pair : 0.14 * room) + 0.08 * balance;
  return { score, parts };
}

// ---------- Where to start ----------

// Starting spots: centered over the TV or furniture, plus one spot in each pocket of
// open wall big enough for a mid-size frame, nearest eye level.
function seedsFor(obstacles, space, probe, blockers) {
  const out = [];
  const add = (s) => { if (!out.some((o) => Math.hypot(o.cx - s.cx, o.y - s.y) < 10)) out.push(s); };
  const anchors = obstacles.filter((o) => (SCREENS.has(o.kind) && o.w >= 20) || (ANCHORS.has(o.kind) && o.w >= RULES.minAnchorWidth))
    .sort((a, b) => b.w - a.w || cmpStr(a.id, b.id));
  for (const a of anchors.slice(0, 2)) {
    // Over its middle, at the lowest height a frame fits (a TV on a stand pushes it up).
    const cx = a.x + a.w / 2;
    for (let y = a.y + a.h + RULES.blockerClear; y < space.y1 - probe[1]; y += 1) {
      if (fits({ x: q(cx - probe[0] / 2), y: q(y), w: probe[0], h: probe[1] }, space, blockers)) { add({ cx, y: q(y), by: 'bottom', size: 1e9 }); break; }
    }
  }
  // Pockets: where the probe frame fits, on a 3 in grid, joined up.
  const [pw, ph] = probe;
  const step = 3, cols = Math.max(1, Math.floor((space.x1 - space.x0 - pw) / step) + 1), rows = Math.max(1, Math.floor((space.y1 - space.y0 - ph) / step) + 1);
  const ok = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (fits({ x: space.x0 + i * step, y: space.y0 + j * step, w: pw, h: ph }, space, blockers)) ok[j * cols + i] = 1;
  }
  const seen = new Uint8Array(cols * rows);
  const pockets = [];
  for (let k = 0; k < ok.length; k++) {
    if (!ok[k] || seen[k]) continue;
    const cells = [], stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const i = c % cols, j = (c - i) / cols;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (ok[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    const pts = cells.map((c) => { const i = c % cols, j = (c - i) / cols; return { cx: space.x0 + i * step + pw / 2, cy: space.y0 + j * step + ph / 2 }; });
    // A big pocket (the open U around a TV) gets several spots, spread apart, near eye level.
    const band = pts.filter((p) => Math.abs(p.cy - 60) <= 14);
    const use = band.length ? band : pts;
    const mx = sum(use.map((p) => p.cx)) / use.length;
    const picks = [use.reduce((b, p) => (Math.hypot(p.cx - mx, (p.cy - 60) * 1.5) < Math.hypot(b.cx - mx, (b.cy - 60) * 1.5) ? p : b), use[0])];
    const spread = Math.min(4, Math.max(1, Math.round(Math.sqrt(cells.length) / 4)));
    while (picks.length < spread) {
      const far = use.reduce((b, p) => { const d = Math.min(...picks.map((k) => Math.hypot(p.cx - k.cx, (p.cy - k.cy) * 0.6))); return d > b.d ? { p, d } : b; }, { p: null, d: 0 });
      if (!far.p || far.d < 24) break;
      picks.push(far.p);
    }
    for (const b of picks) pockets.push({ cx: b.cx, y: b.cy, by: 'center', size: cells.length / picks.length });
  }
  pockets.sort((a, b) => b.size - a.size || a.cx - b.cx);
  for (const p of pockets) add(p);
  return out.slice(0, 6);
}

// The first piece: at the seed if it fits there, else the nearest spot that does.
function placeFirst(seed, w, h, space, placed) {
  const y0 = seed.by === 'bottom' ? seed.y : seed.by === 'top' ? seed.y - h : seed.y - h / 2;
  const x0 = seed.cx - w / 2;
  for (let d = 0; d <= 30; d += 1) {
    const tries = d === 0 ? [[0, 0]] : seed.by === 'top' ? [[-d, 0], [d, 0]] : [[0, d], [-d, 0], [d, 0], [0, -d], [-d, d], [d, d]];
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
    big: all.filter((s) => long(s) >= 30),
    mid: all.filter((s) => long(s) >= 18 && long(s) < 30),
    small: all.filter((s) => long(s) < 18),
  };
}

// The kinds of run: which sizes go up in what order. Neat runs keep one or two
// frame sizes and line up on edges, so they come out as rows and grids that bend
// around what's on the wall.
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

// One run: grow a group from a seed. Returns a snapshot after every frame.
// others: frames of another group already up (kept well clear, lined up with).
function grow({ seed, plan, growth, rand, cls, avail, used0, space, pinnedRects, own, cap, others = [], g = 0, minFirst = 0, start = [] }) {
  const used = new Map(used0 || []);
  const room = (s) => (avail.get(sizeKey(s[0], s[1])) || 0) - (used.get(sizeKey(s[0], s[1])) || 0) > 0;
  const pickFrom = (list) => { const l = list.filter(room); return l[Math.floor(rand() * Math.min(3, l.length))]; };
  const neatSizes = plan.neat ? plan.order.map((c) => (cls[c].length ? cls[c] : cls.mid.length ? cls.mid : cls.small)).map(pickFrom) : null;
  const apart = others.map((o) => ({ ...o, keepOff: RULES.groupApart }));
  const placed = start.map((f) => ({ ...f, g }));
  for (const f of placed) if (!f.fixed) used.set(sizeKey(f.w, f.h), (used.get(sizeKey(f.w, f.h)) || 0) + 1);
  const queue = own.filter((p) => !placed.some((f) => f.fixed === p));
  const snaps = [];
  for (let k = placed.length; k < cap; k++) {
    const mine = queue[0] || null;
    let want;
    if (mine) want = [[mine.w, mine.h]];
    else if (plan.neat) want = [neatSizes[k % neatSizes.length], ...neatSizes].filter(Boolean).filter(room);
    else {
      const c = plan.order[(k - own.length + plan.order.length * 8) % plan.order.length];
      const order = c === 'big' ? ['big', 'mid', 'small'] : c === 'mid' ? ['mid', 'small'] : ['small', 'mid'];
      want = order.flatMap((o) => [...cls[o].filter(room)].sort(() => rand() - 0.5).slice(0, 3));
    }
    if (!want.length) break;
    let best = null;
    for (const [w, h] of want) {
      const block = [...pinnedRects, ...apart];
      if (!placed.length) {
        const r = placeFirst(seed, w, h, space, block);
        if (r && r.w * r.h >= minFirst) { best = { r }; break; }
        continue;
      }
      const all = [...placed, ...pinnedRects];
      const A = sum(placed.map((p) => p.w * p.h));
      const cx = sum(placed.map((p) => (p.x + p.w / 2) * p.w * p.h)) / A;
      const cy = sum(placed.map((p) => (p.y + p.h / 2) * p.w * p.h)) / A;
      for (const r of spotsBeside(all, w, h, plan.neat)) {
        if (!fits(r, space, [...all, ...apart])) continue;
        const dx = (r.x + w / 2 - cx) / 24, dy = (r.y + h / 2 - cy) / 24;
        const eye = Math.max(0, Math.abs(r.y + h / 2 - RULES.centerline - 3) - 8) / 30;
        const v = -Math.hypot(growth.bx * dx, growth.by * dy) + 0.35 * lined(r, [...all, ...others]) - eye + 0.25 * rand();
        if (!best || v > best.v + EPS) best = { r, v };
      }
      if (best) break; // the size asked for fits somewhere: take its best spot
    }
    if (!best) {
      if (mine && mine.keep === 'must') return { snaps: [], used }; // a piece that must be in doesn't fit: this run is out
      if (mine) { queue.shift(); continue; }
      break;
    }
    placed.push({ ...best.r, g, fixed: mine });
    if (mine) queue.shift();
    else used.set(sizeKey(best.r.w, best.r.h), (used.get(sizeKey(best.r.w, best.r.h)) || 0) + 1);
    if (queue.some((p) => p.keep === 'must')) continue;
    snaps.push(placed.slice());
  }
  return { snaps, used };
}

// ---------- Repair ----------

// Small changes to a promising shape, kept when the picture scores higher: drop a
// piece, shift the whole group, move the piece that's least attached, or change a
// frame to another size that fits the same corner.
function repair(frames, ctx, opts) {
  let cur = frames, curS = shapeScore(cur, ctx).score;
  const { space, pinnedRects, sizesOf, pieces } = opts;
  const valid = (fs) => fs.every((f, i) => fits(f, space, [...pinnedRects, ...fs.filter((_, j) => j !== i)]));
  const tryIt = (fs) => {
    if (!valid(fs)) return false;
    const s = shapeScore(fs, ctx).score;
    if (s > curS + 0.003) { cur = fs; curS = s; return true; }
    return false;
  };
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    if (!pieces && cur.length > 2) {
      for (let i = 0; i < cur.length; i++) if (!cur[i].fixed && tryIt(cur.filter((_, j) => j !== i))) { changed = true; break; }
    }
    for (const g of new Set(cur.map((f) => f.g || 0))) {
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
        if (tryIt(cur.map((f) => ((f.g || 0) === g && !f.pinned ? { ...f, x: q(f.x + dx), y: q(f.y + dy) } : f)))) { changed = true; break; }
      }
    }
    // The least attached piece goes to its best spot beside the rest.
    const loose = cur.filter((f) => !f.fixed).map((f) => ({ f, t: Math.max(0, ...cur.filter((o) => o !== f && (o.g || 0) === (f.g || 0)).map((o) => touch(f, o))) }))
      .sort((a, b) => a.t - b.t)[0];
    if (loose && loose.t < 0.5 && cur.length > 2) {
      const rest = cur.filter((f) => f !== loose.f);
      let best = null;
      for (const r of spotsBeside(rest.filter((f) => (f.g || 0) === (loose.f.g || 0)), loose.f.w, loose.f.h, false)) {
        const fs = [...rest, { ...loose.f, x: r.x, y: r.y }];
        if (!valid(fs)) continue;
        const s = shapeScore(fs, ctx).score;
        if (!best || s > best.s) best = { fs, s };
      }
      if (best && best.s > curS + 0.003) { cur = best.fs; curS = best.s; changed = true; }
    }
    for (let i = 0; i < cur.length; i++) {
      const f = cur[i];
      if (f.fixed) continue;
      for (const [w, h] of sizesOf(f)) {
        if (w === f.w && h === f.h) continue;
        const swapped = { ...f, w, h, x: q(f.x + (f.w - w) / 2), y: q(f.y + (f.h - h) / 2) };
        if (tryIt(cur.map((o, j) => (j === i ? swapped : o)))) { changed = true; break; }
      }
    }
    if (!changed) break;
  }
  return { frames: cur, score: curS };
}

// ---------- Putting it together ----------

/**
 * Free-form structures for one set of pieces the person owns.
 * @returns {{ structures: object[], counts: Set<number> }}
 */
export function flowStructures({ wall, obstacles, space, pinned = [], fixed, hung = [], sizes, avail, pieces = null, style = null, fullness = 'balanced', base = null, most = RULES.flowMax, keepTop = 6 }) {
  const counts = new Set();
  if (space.area < 150) return { structures: [], counts };
  const cls = classes(sizes.filter(([w, h]) => avail.has(sizeKey(w, h))));
  if (!cls.big.length && !cls.mid.length && !cls.small.length && !fixed.length) return { structures: [], counts };
  const ctx = { space, wall, obstacles, fullness };
  const pinnedRects = pinned.map((p) => ({ x: p.at.x, y: p.at.y, w: p.w, h: p.h, pinned: true, g: 0 }));
  const probe = cls.mid[cls.mid.length - 1] || cls.small[0] || cls.big[cls.big.length - 1] || [fixed[0].w, fixed[0].h];
  const seeds = seedsFor(obstacles, space, probe, pinnedRects);
  if (!seeds.length) return { structures: [], counts };
  const plans = PLANS.filter((p) => !style || (style === 'structured' ? p.neat : !p.neat));
  // Grow past the count asked for, so the count control knows every count that fits.
  const cap = Math.max(most, pieces || 0);
  // Pieces that must be in, in more than one order: biggest first, then smallest first.
  const ownBig = [...fixed].sort((a, b) => b.w * b.h - a.w * a.h || cmpStr(a.id, b.id));
  const orders = ownBig.filter((p) => p.keep === 'must').length > 1 ? [ownBig, [...ownBig].reverse()] : [ownBig];

  const snaps = [];
  let run = 0;
  const keep = (frames, plan) => {
    const all = [...frames, ...pinnedRects.filter(() => false)];
    snaps.push({ frames: all, plan });
  };
  // One group, from each seed.
  for (const seed of seeds) for (const plan of plans) for (const growth of GROWTH) for (const own of orders) {
    const r = grow({ seed, plan, growth, rand: rng(1013 + 7919 * run++), cls, avail, space, pinnedRects, own, cap });
    for (const s of r.snaps) if (s.length >= 2 || s.some((f) => f.fixed) || pinnedRects.length) keep(s, plan);
  }
  // Two groups that answer each other: a small group from one pocket, then a second
  // from another pocket at least a frame apart, starting on the first one's top line.
  const pockets = seeds.filter((s) => s.by === 'center');
  const pairs = [];
  for (let i = 0; i < seeds.length; i++) for (let j = 0; j < seeds.length; j++) {
    if (i !== j && Math.abs(seeds[i].cx - seeds[j].cx) >= 30 && pairs.length < 4) pairs.push([seeds[i], seeds[j]]);
  }
  if (pockets.length && cap >= 2) {
    for (const [s1, s2] of pairs) for (const plan of plans.filter((p) => ['hero', 'mixed', 'even', 'pair'].includes(p.name))) {
      const a = grow({ seed: s1, plan, growth: GROWTH[0], rand: rng(4099 + 131 * run++), cls, avail, space, pinnedRects, own: ownBig, cap: Math.min(4, cap - 1) });
      for (const A of a.snaps.filter((s) => s.length >= 1 && s.length <= 4)) {
        const ab = boxOf(A);
        for (const by of ['top', 'bottom']) {
          const seed = { cx: s2.cx, y: by === 'top' ? ab.y + ab.h : ab.y, by };
          const used = new Map();
          for (const f of A) if (!f.fixed) used.set(sizeKey(f.w, f.h), (used.get(sizeKey(f.w, f.h)) || 0) + 1);
          const left = ownBig.filter((p) => !A.some((f) => f.fixed === p));
          const b = grow({ seed, plan, growth: GROWTH[1], rand: rng(8191 + 17 * run++), cls, avail, used0: used, space, pinnedRects, own: left, cap: Math.min(5, cap - A.length), others: A, g: 1 });
          for (const B of b.snaps) if (A.length + B.length >= 2) keep([...A, ...B], plan);
        }
      }
    }
  }
  // Stepping the count from a layout on screen: grow on from the frames it has.
  if (base && base.length) {
    const start = base.map((b) => ({ x: q(b.x), y: q(b.y), w: b.w, h: b.h, fixed: ownBig.find((p) => Math.abs(p.w - b.w) < 0.01 && Math.abs(p.h - b.h) < 0.01) || null }));
    for (const plan of plans) for (const growth of GROWTH) {
      const r = grow({ seed: seeds[0], plan, growth, rand: rng(2357 + 7 * run++), cls, avail, space, pinnedRects, own: ownBig, cap, start });
      for (const s of r.snaps) keep(s, plan);
    }
  }
  // As it is: the person's pieces where they hang now, nothing new.
  if (hung.length && !pieces) keep(hung.map((p) => ({ x: p.at.x, y: p.at.y, w: p.w, h: p.h, g: 0, fixed: p })), { name: 'asis', neat: false });

  for (const s of snaps) counts.add(s.frames.length);
  const pool = pieces ? snaps.filter((s) => s.frames.length === pieces) : snaps;
  // A layout that keeps the frames already shown, when the person steps the count.
  const baseSet = base && base.length ? new Set(base.map((b) => `${q(b.x)},${q(b.y)},${b.w}x${b.h}`)) : null;
  for (const s of pool) {
    const j = shapeScore([...s.frames, ...pinnedRects], ctx);
    s.pre = j.score;
    if (baseSet) s.pre += BASE_KEEP * s.frames.filter((f) => baseSet.has(`${q(f.x)},${q(f.y)},${f.w}x${f.h}`)).length / baseSet.size;
    s.groups = new Set(s.frames.map((f) => f.g || 0)).size;
  }
  pool.sort((a, b) => b.pre - a.pre);

  // Shortlist with range: the best of each kind (one group or two, neat or loose,
  // light, right or full, which parts of the wall, how much of their own art).
  const target = TARGETS[fullness] || TARGETS.balanced;
  const kind = (s) => {
    const area = sum(s.frames.map((f) => f.w * f.h));
    const cov = area / space.area;
    const band = cov < 0.75 * target ? 'light' : cov > 1.35 * target ? 'full' : 'right';
    const thirds = [0, 1, 2].filter((t) => sum(s.frames.filter((f) => Math.floor(3 * (f.x + f.w / 2) / wall.width) === t).map((f) => f.w * f.h)) >= 0.2 * area).join('');
    const own = s.frames.filter((f) => f.fixed).length;
    return `${s.plan.name === 'asis' ? 'asis' : s.groups}|${s.plan.neat}|${pieces ? s.frames.length : band}|${thirds}|${own}`;
  };
  const seen = new Set(), sig = new Set(), short = [];
  // Two shapes within a couple of inches of each other are the same shape.
  const shapeSig = (s) => s.frames.map((f) => `${Math.round(f.x / 3)},${Math.round(f.y / 3)},${Math.round(f.w / 3)}x${Math.round(f.h / 3)}`).sort().join(';');
  for (const s of pool) {
    const k = kind(s), g = shapeSig(s);
    if (seen.has(k) || sig.has(g)) continue;
    seen.add(k); sig.add(g); short.push(s);
    if (short.length >= keepTop * 3) break;
  }
  // Repair the best few, then keep the best.
  const sizesOf = (f) => {
    const l = Math.max(f.w, f.h);
    const c = l >= 30 ? cls.big : l >= 18 ? cls.mid : cls.small;
    return c.filter(([w, h]) => (avail.get(sizeKey(w, h)) || 0) > 0).slice(0, 6);
  };
  for (const s of short.slice(0, keepTop * 2)) {
    if (s.plan.name === 'asis') continue;
    const r = repair(s.frames, ctx, { space, pinnedRects, sizesOf, pieces });
    if (!baseSet && r.score > s.pre + EPS) { s.frames = r.frames; s.pre = r.score; }
  }
  short.sort((a, b) => b.pre - a.pre);
  const top = short.slice(0, keepTop + 2);
  // Leaving it as it is always stays an option.
  const asis = snaps.find((s) => s.plan.name === 'asis');
  if (asis && !top.includes(asis) && !pieces) { asis.pre ??= shapeScore([...asis.frames, ...pinnedRects], ctx).score; top.push(asis); }

  const structures = top.map((s) => {
    const b = boxOf(s.frames);
    const ordered = [...s.frames].sort((a, c) => c.w * c.h - a.w * a.h || a.x - c.x || a.y - c.y);
    return {
      family: 'flow', variant: s.plan.name === 'asis' ? 'asis' : s.plan.neat ? 'neat' : 'loose', W: b.w, H: b.h, at: { x: b.x, y: b.y },
      slots: ordered.map((p) => ({ w: p.w, h: p.h, dx: q(p.x - b.x), dy: q(p.y - b.y), fixed: p.fixed || null, row: null, role: null, g: p.g || 0 })),
      meta: { ragged: 0, gaps: [G], rows: null, groups: s.groups },
      pre: s.pre,
    };
  });
  return { structures, counts };
}
