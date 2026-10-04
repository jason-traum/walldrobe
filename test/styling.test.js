// A stylist's rules as a light score: busy pieces apart, weight balanced, a color thread,
// mostly color or mostly black and white.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stylingScore } from '../engine/styling.js';

const prof = (o) => ({ known: true, brightness: 0.6, saturation: 0.3, busy: 0.1, bw: false, shares: { white: 0.5, blue: 0.5 }, ...o });
const at = (x, o = {}, w = 12, h = 16) => ({ x, y: 50, w, h, profile: prof(o) });

test('two busy pieces side by side score lower than a quiet one between them', () => {
  const side = stylingScore([at(0, { busy: 0.4 }), at(14, { busy: 0.4 }), at(28, { busy: 0.05 })]);
  const apart = stylingScore([at(0, { busy: 0.4 }), at(14, { busy: 0.05 }), at(28, { busy: 0.4 })]);
  assert.ok(apart.parts.busy > side.parts.busy);
  assert.ok(apart.score > side.score);
});

test('dark heavy pieces all on one side score lower for balance', () => {
  const lop = stylingScore([at(0, { brightness: 0.1 }, 20, 24), at(22, { brightness: 0.9 }), at(36, { brightness: 0.9 })]);
  const even = stylingScore([at(0, { brightness: 0.5 }), at(14, { brightness: 0.5 }, 20, 24), at(36, { brightness: 0.5 })]);
  assert.ok(even.parts.balance > lop.parts.balance);
});

test('a color shared by the pieces counts as a thread; neutrals do not', () => {
  const thread = stylingScore([at(0, { shares: { blue: 0.4, white: 0.6 } }), at(14, { shares: { blue: 0.3, yellow: 0.7 } })]);
  const none = stylingScore([at(0, { shares: { red: 0.4, white: 0.6 } }), at(14, { shares: { green: 0.5, white: 0.5 } })]);
  assert.equal(thread.parts.thread, 1);
  assert.ok(none.parts.thread < thread.parts.thread);
});

test('mostly one kind beats half black and white, half color', () => {
  const half = stylingScore([at(0, { bw: true }), at(14, { bw: false })]);
  const all = stylingScore([at(0, { bw: true }), at(14, { bw: true })]);
  assert.ok(all.parts.bw > half.parts.bw);
});

test('one piece, or unknown pieces, are never marked down', () => {
  assert.equal(stylingScore([at(0)]).score, 1);
  const s = stylingScore([{ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 10, h: 10 }]);
  assert.ok(s.score > 0.8);
});
