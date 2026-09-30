// Wall geometry: what's blocked, where the open stretches are, where the group goes.

import { RULES } from './constants.js';

export const ANCHORS = new Set([
  'couch', 'sofa', 'bed', 'headboard', 'console', 'dresser', 'sideboard', 'credenza', 'desk', 'bench', 'table',
]);
export const FURNITURE = new Set([...ANCHORS, 'radiator', 'furniture']);
export const FIXTURES = new Set(['outlet', 'switch']);

export const EPS = 1e-6;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v) => clamp(v, 0, 1);
export const cmpStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0); // locale-independent
export const q = (v) => Math.round(v * 4) / 4;   // quarter inch, how people measure
const qUp = (v) => Math.ceil(v * 4 - 1e-9) / 4;

export function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

export function expand(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

// Areas art may not touch. Furniture blocks its own footprint plus the minimum
// clearance above it; blockers get a margin on every side; outlets and switches
// only a small one. Unknown kinds are treated as blockers, the safe default.
export function blockedRegions(obstacles, pinned = []) {
  const regions = obstacles.map((o) => {
    if (FURNITURE.has(o.kind)) {
      return { x: o.x, y: o.y, w: o.w, h: o.h + RULES.clearanceMin, id: o.id, kind: o.kind };
    }
    const d = FIXTURES.has(o.kind) ? RULES.fixtureClear : RULES.blockerClear;
    return { ...expand(o, d), id: o.id, kind: o.kind };
  });
  for (const p of pinned) {
    regions.push({ ...expand({ x: p.at.x, y: p.at.y, w: p.w, h: p.h }, RULES.pinnedClear), id: p.id, kind: 'pinned' });
  }
  return regions;
}

// Open horizontal stretches of the wall for a band between heights y0 and y1.
export function freeIntervals(wallWidth, regions, y0, y1) {
  let ivs = [[RULES.edge, wallWidth - RULES.edge]];
  for (const r of regions) {
    if (!(r.y < y1 - EPS && r.y + r.h > y0 + EPS)) continue;
    const cut = [];
    for (const [a, b] of ivs) {
      const c0 = r.x, c1 = r.x + r.w;
      if (c1 <= a + EPS || c0 >= b - EPS) { cut.push([a, b]); continue; }
      if (c0 > a + EPS) cut.push([a, c0]);
      if (c1 < b - EPS) cut.push([c1, b]);
    }
    ivs = cut;
  }
  return ivs.filter(([a, b]) => b - a > EPS).map(([a, b]) => ({ x0: a, x1: b, w: b - a }));
}

const mid = (r) => r.x + r.w / 2;

// Where the group should go. Over the widest piece of furniture if there is one,
// otherwise centered on the widest open stretch at eye level. Returns null when
// nothing is wide enough to hang on.
export function findZone(wall, obstacles, regions) {
  const anchors = obstacles
    .filter((o) => ANCHORS.has(o.kind) && o.w >= RULES.minAnchorWidth)
    .sort((a, b) => b.w - a.w
      || Math.abs(mid(a) - wall.width / 2) - Math.abs(mid(b) - wall.width / 2)
      || cmpStr(a.id, b.id));

  for (const a of anchors) {
    const base = a.y + a.h;
    const cx = mid(a);
    const y0 = base + RULES.clearanceMin;
    const y1 = Math.min(wall.height - RULES.ceilingHard, base + 30);
    if (y1 - y0 < 8) continue;
    const iv = freeIntervals(wall.width, regions, y0, y1).find((i) => i.x0 <= cx && i.x1 >= cx);
    if (!iv || iv.w < RULES.minOpenWidth) continue;
    const maxH = wall.height - RULES.ceilingHard - y0;
    return {
      type: 'anchor', anchor: a, base, cx, refW: a.w,
      target: a.w * RULES.anchorRatio, range: RULES.anchorRange, interval: iv, maxH,
    };
  }

  const c = RULES.centerline;
  const ivs = freeIntervals(wall.width, regions, c - 12, c + 12)
    .filter((i) => i.w >= RULES.minOpenWidth)
    .sort((a, b) => b.w - a.w || Math.abs(a.x0 + a.w / 2 - wall.width / 2) - Math.abs(b.x0 + b.w / 2 - wall.width / 2));
  if (!ivs.length) return null;
  const iv = ivs[0];
  const maxH = 2 * Math.min(wall.height - RULES.ceilingHard - c, c - 6);
  if (maxH < 8) return null;
  return {
    type: 'wall', anchor: null, base: null, cx: iv.x0 + iv.w / 2, refW: iv.w,
    target: iv.w * RULES.wallRatio, range: RULES.wallRange, interval: iv, maxH,
  };
}

// Put a W x H group on the wall, on the quarter inch. Vertical position follows
// the hanging rules; horizontally it centers on the zone and slides only as far
// as a blocker forces. Over furniture it may not slide off the furniture; on a
// bare wall it stays on the open stretch it was centered on.
export function placeGroup(zone, W, H, regions, wall) {
  let y;
  if (zone.type === 'anchor') {
    const c = clamp(RULES.centerline - H / 2 - zone.base, RULES.clearanceMin, RULES.clearanceMax);
    y = qUp(zone.base + c);
  } else {
    let cy = RULES.centerline;
    if (cy + H / 2 > wall.height - RULES.ceilingSoft) cy = wall.height - RULES.ceilingSoft - H / 2;
    y = q(cy - H / 2);
    if (y < 6) return null;
  }
  if (y + H > wall.height - RULES.ceilingHard + EPS) return null;

  const maxShift = zone.type === 'anchor' ? Math.max(3, RULES.anchorShift * zone.refW) : Infinity;
  const fits = freeIntervals(wall.width, regions, y, y + H).filter((i) => i.w >= W - EPS);
  let best = null;
  for (const iv of fits) {
    if (zone.type === 'wall' && (iv.x1 < zone.interval.x0 + EPS || iv.x0 > zone.interval.x1 - EPS)) continue;
    const lo = Math.ceil(iv.x0 * 4 - 1e-9) / 4;
    const hi = Math.floor((iv.x1 - W) * 4 + 1e-9) / 4;
    if (hi < lo - EPS) continue;
    const x = clamp(q(zone.cx - W / 2), lo, hi);
    const shift = Math.abs(x + W / 2 - zone.cx);
    if (shift > maxShift + EPS) continue;
    if (zone.type === 'wall' && (x + W / 2 < zone.interval.x0 || x + W / 2 > zone.interval.x1)) continue;
    if (!best || shift < best.shift - EPS) best = { x, shift };
  }
  if (!best) return null;
  return { x: best.x, y, w: W, h: H, shift: best.shift };
}

// Hard checks on placed pieces. Returns a list of failures; empty means it passes.
export function checkPieces(pieces, regions, wall) {
  const fails = [];
  for (const p of pieces) {
    if (p.x < RULES.edge - EPS || p.x + p.w > wall.width - RULES.edge + EPS) fails.push(`${p.id} past the end of the wall`);
    if (p.y < -EPS || p.y + p.h > wall.height - RULES.ceilingHard + EPS) fails.push(`${p.id} too close to floor or ceiling`);
    for (const r of regions) if (overlaps(p, r)) fails.push(`${p.id} on ${r.id}`);
  }
  const half = RULES.gapHard / 2 - EPS;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (overlaps(expand(pieces[i], half), expand(pieces[j], half))) fails.push(`${pieces[i].id} too close to ${pieces[j].id}`);
    }
  }
  return fails;
}
