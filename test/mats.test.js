// Mats follow design principles: structured walls all the same, loose walls mixed with care.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignMats, matScore } from '../engine/mats.js';

const piece = (id, w, h, x, can = { mat: { w: w - 3, h: h - 4 }, plain: true }) => ({ ref: { id }, w, h, x, y: 50, frame: { can } });
const row = [piece('a', 11, 14, 0), piece('b', 11, 14, 14), piece('c', 16, 20, 28), piece('d', 11, 14, 47)];

test('a structured wall is all matted or all plain', () => {
  for (const level of ['none', 'few', 'some', 'most', 'all']) {
    const m = assignMats(row, { family: 'grid', level });
    assert.equal(new Set(m.values()).size, 1, level);
  }
  assert.equal(assignMats(row, { family: 'line', level: 'most' }).get('a'), true);
  assert.equal(assignMats(row, { family: 'line', level: 'few' }).get('a'), false);
});

test('a loose wall mixes, smallest sizes first, same sizes matching', () => {
  const m = assignMats(row, { family: 'salon', level: 'most' });
  assert.equal(m.get('a'), true);
  assert.equal(m.get('a'), m.get('b'));
  assert.equal(m.get('b'), m.get('d'));
  assert.equal(m.get('c'), false);
});

test('none and all mean none and all', () => {
  assert.ok([...assignMats(row, { family: 'salon', level: 'none' }).values()].every((v) => !v));
  assert.ok([...assignMats(row, { family: 'salon', level: 'all' }).values()].every(Boolean));
});

test('a piece with only one easy way takes it', () => {
  const ps = [...row, piece('shop', 20, 28, 70, { mat: null, plain: true }), piece('m', 16, 20, 95, { mat: { w: 12, h: 16 }, plain: false })];
  const m = assignMats(ps, { family: 'salon', level: 'all' });
  assert.equal(m.get('shop'), false);
  assert.equal(assignMats(ps, { family: 'salon', level: 'none' }).get('m'), true);
});

test('no single odd one out on a loose wall', () => {
  const five = [piece('a', 8, 10, 0), piece('b', 11, 14, 12), piece('c', 11, 14, 26), piece('d', 16, 20, 40), piece('e', 16, 20, 60)];
  const m = assignMats(five, { family: 'salon', level: 'few' });
  const on = [...m.values()].filter(Boolean).length;
  assert.ok(on === 0 || on >= 2, `${on} matted`);
});

test('the score likes a uniform grid and a balanced mix', () => {
  const grid = assignMats(row, { family: 'grid', level: 'some' });
  assert.equal(matScore(row, grid, { family: 'grid', level: 'none' }) > matScore(row, new Map([['a', true], ['b', false], ['c', true], ['d', false]]), { family: 'grid', level: 'none' }), true);
  const left = new Map([['a', true], ['b', true], ['c', false], ['d', false]]);
  const spread = new Map([['a', true], ['b', false], ['c', false], ['d', true]]);
  const lone = [piece('a', 11, 14, 0), piece('b', 11, 14, 14), piece('c', 11, 14, 28), piece('d', 11, 14, 42)];
  assert.ok(matScore(lone, spread, { family: 'salon', level: 'some' }) > matScore(lone, left, { family: 'salon', level: 'some' }));
});

test('a statement piece goes without a mat unless you pick All; the pieces beside it match', () => {
  const wall = [piece('big', 24, 30, 20), piece('l1', 11, 14, 0), piece('r1', 11, 14, 50)];
  for (const level of ['few', 'some', 'most']) {
    const m = assignMats(wall, { family: 'statement', level });
    assert.equal(m.get('big'), false, level);
    assert.equal(m.get('l1'), m.get('r1'), level);
  }
  assert.equal(assignMats(wall, { family: 'statement', level: 'most' }).get('l1'), true);
  assert.equal(assignMats(wall, { family: 'statement', level: 'all' }).get('big'), true);
  assert.equal(assignMats([piece('solo', 24, 30, 0)], { family: 'statement', level: 'most' }).get('solo'), false);
  const plain = new Map([['big', false], ['l1', true], ['r1', true]]);
  const matted = new Map([['big', true], ['l1', true], ['r1', true]]);
  assert.ok(matScore(wall, plain, { family: 'statement', level: 'most' }) > matScore(wall, matted, { family: 'statement', level: 'most' }));
});

test('a big frame goes without a mat on a structured wall unless you pick All', () => {
  const two = [piece('a', 24, 36, 0), piece('b', 24, 36, 30)];
  assert.ok([...assignMats(two, { family: 'line', level: 'most' }).values()].every((v) => !v));
  assert.ok([...assignMats(two, { family: 'line', level: 'all' }).values()].every(Boolean));
});

test('a print with its own white border counts as matted and never gets a second mat', async () => {
  const { assignMats } = await import('../engine/mats.js');
  const ps = [
    { id: 'a', x: 0, y: 0, w: 9.5, h: 11.5, frame: { w: 8, h: 10, margin: 1 } },
    { id: 'b', x: 12, y: 0, w: 9.5, h: 11.5, frame: { w: 8, h: 10, can: { mat: { w: 5, h: 7 }, plain: true } } },
  ];
  const m = assignMats(ps, { family: 'grid', level: 'all' });
  assert.equal(m.get('a'), true);
  assert.equal(m.get('b'), true);
});

test('a shop size with a printed border is the paper, and never hangs matted a frame up', async () => {
  const { toCandidate } = await import('../engine/catalog.js');
  const { readFileSync } = await import('node:fs');
  const real = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items.find((x) => x.id.startsWith('s6-'));
  const r = { ...real, sizes: [{ w: 12, h: 18, price: 50, margin: 1 }], offers: [{ ...real.offers[0], w: 12, h: 18, price: 50, margin: 1 }] };
  const c = toCandidate(r);
  assert.deepEqual(c.sizes, [{ w: 12, h: 18, price: 50, margin: 1 }]);
});
