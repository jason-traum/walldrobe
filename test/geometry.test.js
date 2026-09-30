import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedRegions, freeIntervals, findZone, placeGroup, checkPieces } from '../engine/geometry.js';
import { RULES } from '../engine/constants.js';

const wall = { width: 132, height: 96 };
const couch = { id: 'couch', kind: 'couch', x: 24, y: 0, w: 84, h: 32 };

test('furniture blocks its footprint plus the minimum clearance', () => {
  const [r] = blockedRegions([couch]);
  assert.deepEqual([r.x, r.y, r.w, r.h], [24, 0, 84, 32 + RULES.clearanceMin]);
});

test('windows get 3 in of margin, outlets 1 in', () => {
  const [win, out] = blockedRegions([
    { id: 'w', kind: 'window', x: 100, y: 30, w: 20, h: 50 },
    { id: 'o', kind: 'outlet', x: 10, y: 12, w: 3, h: 5 },
  ]);
  assert.deepEqual([win.x, win.w], [97, 26]);
  assert.deepEqual([out.x, out.w], [9, 5]);
});

test('unknown kinds are treated as blockers', () => {
  const [r] = blockedRegions([{ id: 'x', kind: 'aquarium', x: 10, y: 10, w: 10, h: 10 }]);
  assert.equal(r.x, 10 - RULES.blockerClear);
});

test('free intervals cut around blockers in the band only', () => {
  const regions = blockedRegions([{ id: 'w', kind: 'window', x: 100, y: 30, w: 20, h: 50 }]);
  assert.deepEqual(freeIntervals(132, regions, 40, 60).map((i) => [i.x0, i.x1]), [[3, 97], [123, 129]]);
  assert.deepEqual(freeIntervals(132, regions, 84, 90).map((i) => [i.x0, i.x1]), [[3, 129]]);
});

test('zone centers over the widest furniture at two thirds its width', () => {
  const z = findZone(wall, [couch], blockedRegions([couch]));
  assert.equal(z.type, 'anchor');
  assert.equal(z.cx, 66);
  assert.equal(z.target, 56);
});

test('a bare wall centers on the widest open stretch', () => {
  const obs = [{ id: 'door', kind: 'door', x: 0, y: 0, w: 36, h: 80 }];
  const z = findZone({ width: 100, height: 96 }, obs, blockedRegions(obs));
  assert.equal(z.type, 'wall');
  assert.equal(z.interval.x0, 39);
  assert.equal(z.cx, (39 + 97) / 2);
});

test('no open space returns null', () => {
  const obs = [{ id: 'tv', kind: 'tv', x: 0, y: 0, w: 60, h: 96 }];
  assert.equal(findZone({ width: 60, height: 96 }, obs, blockedRegions(obs)), null);
});

test('over furniture the bottom edge sits 6 to 10 in above it', () => {
  const regions = blockedRegions([couch]);
  const z = findZone(wall, [couch], regions);
  for (const H of [10, 20, 30, 40]) {
    const g = placeGroup(z, 50, H, regions, wall);
    const c = g.y - 32;
    assert.ok(c >= 6 && c <= 10, `clearance ${c} for height ${H}`);
  }
});

test('on a bare wall the center sits at 57 in', () => {
  const z = findZone(wall, [], []);
  const g = placeGroup(z, 40, 30, [], wall);
  assert.equal(g.y + 15, 57);
});

test('a group slides sideways only as far as a blocker forces', () => {
  const obs = [{ id: 'w', kind: 'window', x: 70, y: 30, w: 20, h: 50 }];
  const regions = blockedRegions(obs);
  const z = findZone({ width: 132, height: 96 }, obs, regions);
  const g = placeGroup(z, 30, 20, regions, { width: 132, height: 96 });
  assert.ok(g.x + 30 <= 67 || g.x >= 93, 'clear of the window');
});

test('check catches overlaps and pieces too close together', () => {
  const a = { id: 'a', x: 10, y: 40, w: 10, h: 10 };
  const b = { id: 'b', x: 21, y: 40, w: 10, h: 10 };
  assert.equal(checkPieces([a, b], [], wall).length, 1);
  assert.equal(checkPieces([a, { ...b, x: 22 }], [], wall).length, 0);
});
