// Shared test helpers: a seeded random generator and the invariant checks every
// returned layout must pass.

import assert from 'node:assert/strict';
import { RULES } from '../engine/index.js';
import { blockedRegions, overlaps, expand } from '../engine/geometry.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-6; // positions are on the quarter inch before the checks, so no slack

export function assertLayoutValid(input, L) {
  const { wall } = input;
  const owned = input.owned || [];
  const pinned = owned.filter((p) => p.pinned);
  const regions = blockedRegions(input.obstacles || [], pinned);
  const loose = L.pieces.filter((p) => p.role !== 'pinned');

  for (const p of loose) {
    assert.ok(p.x >= RULES.edge - EPS && p.x + p.w <= wall.width - RULES.edge + EPS, `${p.ref.id} inside the wall`);
    assert.ok(p.y >= -EPS && p.y + p.h <= wall.height - RULES.ceilingHard + EPS, `${p.ref.id} below the ceiling`);
    for (const r of regions) {
      assert.ok(!overlaps(expand(p, -EPS), r), `${p.ref.id} clear of ${r.id}`);
    }
    assert.ok(typeof p.reason === 'string' && p.reason.length > 10 && p.reason.length <= 140, `${p.ref.id} has a short reason: ${p.reason}`);
    assert.ok(!/[\u2014\u2013]/.test(p.reason), `no em or en dash in: ${p.reason}`);
    assert.ok(Math.abs(p.nail.x - (p.x + p.w / 2)) <= EPS, 'nail centered');
    assert.ok(p.nail.y <= p.y + p.h + EPS && p.nail.y > p.y, 'nail under the top edge');
  }
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      const a = expand(loose[i], RULES.gapHard / 2 - EPS);
      const b = expand(loose[j], RULES.gapHard / 2 - EPS);
      assert.ok(!overlaps(a, b), `${loose[i].ref.id} and ${loose[j].ref.id} at least ${RULES.gapHard} in apart`);
    }
  }
  const ids = new Set(L.pieces.map((p) => p.ref.id));
  assert.equal(ids.size, L.pieces.length, 'no piece used twice');
  for (const p of owned.filter((o) => o.keep === 'must')) assert.ok(ids.has(p.id), `must-keep ${p.id} is on the wall`);
  for (const p of pinned) {
    const out = L.pieces.find((x) => x.ref.id === p.id);
    assert.ok(out && Math.abs(out.x - p.at.x) <= EPS && Math.abs(out.y - p.at.y) <= EPS, `pinned ${p.id} did not move`);
  }
  for (const l of L.left) assert.ok(!ids.has(l.id) && l.reason.length > 0, `left-off ${l.id} explained`);
  assert.ok(!/[\u2014\u2013]/.test(L.summary), 'no em dash in summary');
  assert.ok(L.score > 0 && L.score <= 1, 'score in range');
}
