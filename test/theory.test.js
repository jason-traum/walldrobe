// Color theory and design checks, one at a time, on small made-up walls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToLab, colorName, normalizePalette, lch } from '../engine/color.js';
import { familyOfLab, toWheel, wheelHist, profileFromPalette, wallColors, harmony, proportion, repetition, temperature, colorScore, FAMILIES } from '../engine/theory.js';
import { balance, rhythm, variety, flow, mirror, neighbors, designScore, visualWeight } from '../engine/design.js';

const pal = (...hexes) => normalizePalette(hexes.map((h) => (Array.isArray(h) ? { hex: h[0], weight: h[1] } : { hex: h, weight: 1 })));
const prof = (...hexes) => profileFromPalette(pal(...hexes));
const piece = (profile, x, y, w, h, extra = {}) => ({ x, y, w, h, area: w * h, profile: { ...profile, ...extra }, ...(extra.role ? { role: extra.role } : {}) });

test('color families use the same thresholds as the color names', () => {
  const fold = { 'light gray': 'gray', peach: 'orange', ochre: 'yellow', navy: 'blue', 'light blue': 'blue' };
  const hexes = ['#111111', '#F7F7F7', '#BBBBBB', '#777777', '#F2B8C6', '#C2362B', '#8B5A2B', '#F5C9A0', '#E07B22', '#B8912E', '#E3D03C', '#2F5D3A', '#1B6F73', '#0B1A5C', '#9CC5E0', '#1F2FA8', '#6A2E8C'];
  for (const h of hexes) {
    const lab = hexToLab(h);
    const name = colorName(lab);
    assert.equal(familyOfLab(lab), fold[name] || name, h);
  }
});

test('an estimated profile adds up', () => {
  const p = prof('#1F2FA8', '#F2F2F2', '#E07B22');
  const sum = Object.values(p.shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(Math.abs(p.hues.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Object.keys(p.shares).every((f) => FAMILIES.includes(f)));
  const gray = prof('#111111', '#EEEEEE');
  assert.equal(gray.chromatic, 0);
  assert.ok(gray.hues.every((v) => v === 0));
  assert.equal(gray.bw, true);
});

test('the painter\'s wheel puts complements across from each other', () => {
  const at = (hex) => toWheel(lch(hexToLab(hex))[2]);
  const gap = (a, b) => { const d = Math.abs(at(a) - at(b)) % 360; return Math.min(d, 360 - d); };
  assert.ok(gap('#1F2FA8', '#E07B22') > 160, 'blue and orange');
  assert.ok(gap('#C2362B', '#2F8D3A') > 160, 'red and green');
  assert.ok(gap('#E3D03C', '#6A2E8C') > 150, 'yellow and violet');
  assert.ok(gap('#1B6F73', '#2F8D3A') < 60, 'teal and green are neighbors');
  const h = wheelHist([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0.5, 0, 0]);
  assert.ok(Math.abs(h.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('harmony finds the scheme a designer would name', () => {
  const wall = (...ps) => wallColors(ps.map((p) => ({ profile: p, area: 100 })));
  assert.equal(harmony(wall(prof('#1F2FA8'), prof('#2A45C8'))).scheme, 'monochromatic');
  assert.equal(harmony(wall(prof('#1F2FA8'), prof('#E07B22'))).scheme, 'complementary');
  assert.equal(harmony(wall(prof('#111111', '#EEEEEE'), prof('#888888'))).scheme, 'neutral');
  assert.equal(harmony(wall(prof('#C2362B'), prof('#E3D03C'), prof('#1F2FA8'))).scheme, 'triadic');
  assert.equal(harmony(wall(prof('#C2362B'), prof('#2F8D3A'))).scheme, 'complementary');
  assert.equal(harmony(wall(prof('#1B6F73'), prof('#2F8D3A'), prof('#1F2FA8'))).scheme, 'analogous');
  // Two blues score higher than a blue with a stray green and a stray red.
  const calm = harmony(wall(prof('#1F2FA8'), prof('#2A45C8'), prof('#3A55D8')));
  const loud = harmony(wall(prof('#1F2FA8'), prof('#2F8D3A'), prof('#C2362B')));
  assert.ok(calm.score > loud.score, `${calm.score} > ${loud.score}`);
  assert.deepEqual(harmony(wall(prof('#1F2FA8'), prof('#E07B22'))).colors.sort(), ['blue', 'orange']);
});

test('proportion likes 60, 30, 10 and dislikes an even split', () => {
  const at = (shares, chromatic = 0.6) => proportion({ shares, chromatic, value: { dark: 0.2, mid: 0.5, light: 0.3 } }).score;
  assert.equal(at({ white: 0.6, blue: 0.3, orange: 0.1 }), 1);
  assert.ok(at({ white: 0.34, blue: 0.33, orange: 0.33 }) < 0.7);
  // A wall with no color is judged on dark, mid and light.
  assert.equal(proportion({ shares: { white: 1 }, chromatic: 0, value: { dark: 0.1, mid: 0.3, light: 0.6 } }).score, 1);
});

test('a color on the wall should show up twice, unless it is the focal accent', () => {
  const blue = prof(['#1F2FA8', 0.5], ['#F2F2F2', 0.5]);
  const red = prof(['#C2362B', 0.5], ['#F2F2F2', 0.5]);
  const ps = [piece(blue, 0, 0, 10, 10), piece(blue, 12, 0, 10, 10), piece(red, 24, 0, 10, 10)];
  const wc = wallColors(ps);
  assert.ok(repetition(ps, wc, 0, null).score < 1, 'a lonely red in a side piece');
  assert.equal(repetition(ps, wc, 2, null).score, 1, 'a lonely red in the focal piece is fine');
  const room = prof('#C2362B');
  assert.equal(repetition(ps, wc, 0, room).score, 1, 'the room counts as a second place');
});

test('warm and cool fight unless one leads or neutrals sit between', () => {
  const warm = prof('#E07B22'), cool = prof('#1B6F73');
  const even = [piece(warm, 0, 0, 10, 10), piece(cool, 12, 0, 10, 10)];
  const lead = [piece(warm, 0, 0, 10, 10), piece(warm, 12, 0, 10, 10), piece(warm, 24, 0, 10, 10), piece(cool, 36, 0, 4, 4)];
  assert.ok(temperature(lead, wallColors(lead)).score > temperature(even, wallColors(even)).score);
  assert.equal(temperature(lead, wallColors(lead)).lean, 'warm');
});

test('the color score stays between 0 and 1 and names its checks', () => {
  const ps = [piece(prof('#1F2FA8'), 0, 0, 16, 20), piece(prof('#E07B22'), 20, 0, 16, 20)];
  const c = colorScore(ps, 0, { profile: prof('#8D8F8E'), sim: 0.5 });
  assert.ok(c.score >= 0 && c.score <= 1);
  assert.deepEqual(Object.keys(c.checks).sort(), ['harmony', 'proportion', 'repetition', 'room', 'saturation', 'temperature', 'value']);
  assert.ok(!('room' in colorScore(ps, 0, null).checks));
});

// ---------- Design ----------

const G = (w, h) => ({ x: 0, y: 0, w, h });

test('balance: even sides beat one heavy side, and a heavy top is flagged', () => {
  const light = prof('#F2F2F2'), dark = prof('#111111');
  const even = [piece(dark, 0, 0, 16, 20), piece(dark, 20, 0, 16, 20)];
  const lopsided = [piece(dark, 0, 0, 16, 20), piece(light, 20, 0, 16, 20)];
  assert.ok(balance(even, G(36, 20)).score > balance(lopsided, G(36, 20)).score);
  assert.equal(balance(lopsided, G(36, 20)).heavier, 'left');
  const top = [piece(light, 0, 0, 16, 10), piece(dark, 0, 12, 16, 10)];
  assert.equal(balance(top, G(16, 22)).topHeavy, true);
});

test('neighbors are the pieces that touch across one gap', () => {
  const p = prof('#888888');
  const ps = [piece(p, 0, 0, 10, 10), piece(p, 12.5, 0, 10, 10), piece(p, 40, 0, 10, 10), piece(p, 0, 12.5, 10, 10)];
  assert.deepEqual(neighbors(ps), [[0, 1], [0, 3]]);
});

test('rhythm: two busy pieces side by side score lower than busy next to quiet', () => {
  const p = prof('#888888');
  const busy = (x) => piece(p, x, 0, 10, 10, { busy: 0.45 });
  const calm = (x) => piece(p, x, 0, 10, 10, { busy: 0.05 });
  const bad = [busy(0), busy(12.5), calm(25)];
  const good = [busy(0), calm(12.5), busy(25)];
  assert.ok(rhythm(good, neighbors(good)).score > rhythm(bad, neighbors(bad)).score);
});

test('variety: a grid reads as a series, a two-row hang wants a mix', () => {
  const p = prof('#1F2FA8');
  const pool = (x, y = 0) => piece(p, x, y, 10, 10, { theme: 'summer', category: 'pool' });
  const city = (x, y = 0) => piece(p, x, y, 10, 10, { theme: 'city', category: 'city' });
  const series = [pool(0), pool(12.5), pool(25), pool(0, 12.5), pool(12.5, 12.5), pool(25, 12.5)];
  const mixed = [pool(0), city(12.5), pool(25), city(0, 12.5), pool(12.5, 12.5), city(25, 12.5)];
  assert.equal(variety(series, neighbors(series), 'grid', G(35, 22.5)).score, 1);
  assert.ok(variety(mixed, neighbors(mixed), 'grid', G(35, 22.5)).score < 0.6);
  assert.ok(variety(mixed, neighbors(mixed), 'salon', G(35, 22.5)).score > variety(series, neighbors(series), 'salon', G(35, 22.5)).score);
});

test('flow: side pieces that look inward beat ones that look away', () => {
  const p = prof('#888888');
  const g = G(60, 20);
  const inward = [piece(p, 0, 0, 16, 20, { focal: { x: 0.8, y: 0.5 } }), piece(p, 44, 0, 16, 20, { focal: { x: 0.2, y: 0.5 } })];
  const outward = [piece(p, 0, 0, 16, 20, { focal: { x: 0.2, y: 0.5 } }), piece(p, 44, 0, 16, 20, { focal: { x: 0.8, y: 0.5 } })];
  assert.ok(flow(inward, g).score > 0.9 && flow(outward, g).score < 0.2);
});

test('mirror: matched flanks should carry matched weight', () => {
  const light = prof('#F2F2F2'), dark = prof('#111111');
  const g = G(60, 20);
  const same = [piece(dark, 0, 0, 16, 20), piece(dark, 44, 0, 16, 20)];
  const diff = [piece(dark, 0, 0, 16, 20), piece(light, 44, 0, 16, 20)];
  assert.equal(mirror(same, g).score, 1);
  assert.ok(mirror(diff, g).score < 0.6);
  assert.ok(visualWeight(same[0]) > visualWeight(diff[1]));
});

test('the design score stays between 0 and 1 for every family', () => {
  const p = prof('#1F2FA8', '#F2F2F2');
  const ps = [piece(p, 0, 0, 16, 20, { role: 'center' }), piece(p, 20, 0, 11, 14), piece(p, 34, 0, 11, 14)];
  for (const fam of ['statement', 'line', 'grid', 'salon']) {
    const d = designScore(ps, G(45, 20), fam);
    assert.ok(d.score >= 0 && d.score <= 1, fam);
    for (const v of Object.values(d.checks)) assert.ok(v >= 0 && v <= 1, fam);
  }
});

test('a color spread thin over many pieces is not called lonely', () => {
  const p = prof(['#2F8D3A', 0.06], ['#EEEEEE', 0.94]);
  const ps = [0, 12, 24, 36].map((x) => piece(p, x, 0, 10, 10));
  const r = repetition(ps, wallColors(ps), 0, null);
  assert.equal(r.score, 1);
  assert.equal(r.lonely.length, 0);
});

test('scheme colors are named from the art, not the room', () => {
  const ps = [piece(prof('#2F8D3A', '#EEEEEE'), 0, 0, 10, 10), piece(prof('#3F9D4A', '#EEEEEE'), 12, 0, 10, 10)];
  const c = colorScore(ps, 0, { profile: prof('#6E5A48'), sim: 0.5 });
  assert.ok(!c.schemeColors.includes('brown'), c.schemeColors.join());
});

test('pieces with unknown subjects are not called a set', () => {
  const p = profileFromPalette(pal('#1F2FA8'));
  const ps = [0, 12.5, 25].map((x) => piece(p, x, 0, 10, 10));
  assert.ok(variety(ps, neighbors(ps), 'line', G(35, 10)).score < 0.95);
});

test('look-alikes: two moon photos are the same idea, a blue vase and a red vase are a pair', async () => {
  const { readFileSync } = await import('node:fs');
  const { profileFromRecord } = await import('../engine/theory.js');
  const { lookalike, LOOKALIKE, distinct } = await import('../engine/design.js');
  const items = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
  const get = (t) => profileFromRecord(items.find((r) => r.title === t));
  assert.ok(lookalike(get('Full moon'), get('Lunar surface')) >= LOOKALIKE);
  assert.ok(lookalike(get('Blue ceramic vase'), get('Red ceramic vase')) < LOOKALIKE);
  assert.ok(lookalike(get('Full moon'), get('Blue pool')) < 0.4);
  const moons = [piece(get('Full moon'), 0, 0, 10, 10), piece(get('Lunar surface'), 12, 0, 10, 10)];
  assert.equal(distinct(moons).alike.length, 1);
  assert.ok(distinct(moons).score < 0.5);
});
