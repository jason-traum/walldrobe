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
