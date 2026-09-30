// Invariants on 300 seeded random walls: whatever comes back must be hangable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../engine/index.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { rng, assertLayoutValid } from './helpers.js';

const catalog = testCatalog();
const taste = testTaste(catalog);
const KINDS = ['couch', 'bed', 'console', 'dresser'];
const KEEPS = ['must', 'happy', 'dontcare'];

function randomWall(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const int = (lo, hi) => Math.round(lo + r() * (hi - lo));
  const width = int(40, 200);
  const height = int(84, 120);
  const obstacles = [];
  if (r() < 0.7) {
    const w = Math.min(width - 8, int(30, 96));
    obstacles.push({ id: 'furn', kind: pick(KINDS), x: int(2, width - w - 2), y: 0, w, h: int(18, 44) });
  }
  for (let i = 0; i < int(0, 2); i++) {
    const w = int(16, 40);
    obstacles.push({ id: `win${i}`, kind: pick(['window', 'door', 'tv', 'shelf']), x: int(0, Math.max(0, width - w)), y: int(0, 40), w, h: int(20, 60) });
  }
  for (let i = 0; i < int(0, 2); i++) obstacles.push({ id: `out${i}`, kind: pick(['outlet', 'switch']), x: int(2, width - 5), y: int(10, 50), w: 3, h: 5 });
  const owned = [];
  for (let i = 0; i < int(0, 3); i++) {
    owned.push({ id: `own${i}`, title: `piece ${i}`, w: int(8, 30), h: int(8, 36), keep: pick(KEEPS), palette: [{ hex: pick(['#1F2FA8', '#111111', '#C2362B', '#E3B23C']), weight: 1 }] });
  }
  return { wall: { width, height }, obstacles, owned };
}

test('300 random walls: every returned layout passes every hard rule', () => {
  let withLayouts = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const w = randomWall(seed);
    const input = { ...w, catalog, taste };
    const r = layout(input);
    if (r.layouts.length) withLayouts++;
    else assert.ok(r.problems.length > 0, `seed ${seed}: no layout and no reason`);
    for (const L of r.layouts) {
      try { assertLayoutValid(input, L); } catch (e) { e.message = `seed ${seed}: ${e.message}`; throw e; }
    }
  }
  assert.ok(withLayouts >= 200, `${withLayouts} of 300 walls got a layout`);
});

test('random walls are deterministic', () => {
  for (const seed of [7, 42, 99, 250]) {
    const input = { ...randomWall(seed), catalog, taste };
    assert.deepEqual(layout(input), layout(input));
  }
});
