import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToLab, deltaE2000, paletteSimilarity, normalizePalette, colorName, hueFamilyCount } from '../engine/color.js';

const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('CIEDE2000 matches Sharma reference pairs', () => {
  close(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]), 2.0425);
  close(deltaE2000([50, 0, 0], [50, -1, 2]), 2.3669);
  close(deltaE2000([50, 2.5, 0], [73, 25, -18]), 27.1492);
  close(deltaE2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514]), 0.9082);
});

test('hex to Lab: white, black, and a known red', () => {
  const [L, a, b] = hexToLab('#FFFFFF');
  close(L, 100, 0.01); close(a, 0, 0.01); close(b, 0, 0.01);
  close(hexToLab('#000000')[0], 0, 0.01);
  const red = hexToLab('#FF0000');
  close(red[0], 53.24, 0.05); close(red[1], 80.09, 0.1); close(red[2], 67.2, 0.1);
});

test('bad hex throws a plain error', () => {
  assert.throws(() => hexToLab('blue'), /Not a hex color/);
});

test('palette similarity: identical is 1, opposite is low, empty is neutral', () => {
  const blue = normalizePalette([{ hex: '#1F2FA8', weight: 1 }]);
  const orange = normalizePalette([{ hex: '#F28C28', weight: 1 }]);
  close(paletteSimilarity(blue, blue), 1);
  assert.ok(paletteSimilarity(blue, orange) < 0.3);
  assert.equal(paletteSimilarity([], blue), 0.5);
});

test('color names people would say', () => {
  const name = (hex) => colorName(hexToLab(hex));
  assert.equal(name('#1F2FA8'), 'blue');
  assert.equal(name('#111111'), 'black');
  assert.equal(name('#F4F4F4'), 'white');
  assert.equal(name('#C2362B'), 'red');
  assert.equal(name('#2F5D3A'), 'green');
  assert.equal(name('#E3B23C'), 'yellow');
  assert.equal(name('#F2B8C6'), 'pink');
  assert.equal(name('#8B5A2B'), 'brown');
});

test('hue families ignore neutrals', () => {
  const p = (hex) => normalizePalette([{ hex, weight: 1 }]);
  assert.equal(hueFamilyCount([p('#111111'), p('#F2F2F2'), p('#8A8A8A')]), 0);
  assert.equal(hueFamilyCount([p('#1F2FA8'), p('#C2362B'), p('#2F5D3A')]), 3);
});
