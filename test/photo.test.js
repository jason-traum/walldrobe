// Wall photo math: homography, the width over height estimate, flattening,
// painting out a piece and reading a palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, apply, aspectFromCorners, cornerProblem, flatten, paintOut, palette, crop } from '../web/photo.js';

// Project a W x H rectangle standing in front of a camera, turned by yaw and pitch.
function shoot(W, H, { f = 1300, yaw = 0, pitch = 0, dist = 260, w = 1600, h = 1200, dx = 0, dy = 0 } = {}) {
  const pts = [[-W / 2, H / 2], [W / 2, H / 2], [W / 2, -H / 2], [-W / 2, -H / 2]];
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return pts.map(([X, Y]) => {
    let x = X * cy, z = X * sy, y = Y;
    const y2 = y * cp - z * sp; z = y * sp + z * cp; y = y2;
    x += dx; y += dy; z += dist;
    return [w / 2 + (f * x) / z, h / 2 - (f * y) / z];
  });
}

test('the homography maps the four corners exactly', () => {
  const src = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const dst = [[10, 20], [300, 40], [280, 260], [30, 200]];
  const H = homography(src, dst);
  src.forEach((p, i) => { const [u, v] = apply(H, ...p); assert.ok(Math.hypot(u - dst[i][0], v - dst[i][1]) < 1e-6); });
});

test('width over height comes back from a photo taken at an angle', () => {
  for (const [W, H] of [[132, 96], [60, 96], [120, 96]]) {
    for (const view of [{ yaw: 0.35 }, { yaw: -0.5, pitch: 0.15 }, { pitch: 0.3, yaw: 0.2 }, { yaw: 0.6, dx: 20 }, { yaw: 0.3, f: 1100 }, { pitch: 0.25, f: 1600 }]) {
      const c = shoot(W, H, view);
      assert.equal(cornerProblem(c, 1600, 1200), null, JSON.stringify(view));
      const { aspect } = aspectFromCorners(c, 1600, 1200);
      assert.ok(Math.abs(aspect / (W / H) - 1) < 0.04, `${W}x${H} ${JSON.stringify(view)}: ${aspect} vs ${W / H}`);
    }
  }
});

test('a straight-on photo gives the plain ratio', () => {
  const { aspect } = aspectFromCorners(shoot(132, 96), 1600, 1200);
  assert.ok(Math.abs(aspect - 132 / 96) < 0.01);
});

test('crossed or tiny corners are caught in plain words', () => {
  assert.match(cornerProblem([[0, 0], [100, 100], [100, 0], [0, 100]], 1000, 1000), /clockwise/);
  assert.match(cornerProblem([[0, 0], [10, 0], [10, 10], [0, 10]], 1000, 1000), /fill more/);
  assert.match(cornerProblem([[-50, 0], [900, 0], [900, 900], [0, 900]], 1000, 1000), /on the photo/);
});

test('flattening a photo of a checkerboard wall gives straight squares', () => {
  const w = 400, h = 300, data = new Uint8ClampedArray(w * h * 4);
  const corners = [[60, 40], [340, 70], [330, 250], [70, 270]];
  const Hinv = homography(corners, [[0, 0], [8, 0], [8, 6], [0, 6]]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [u, v] = apply(Hinv, x, y);
    const on = (Math.floor(u) + Math.floor(v)) % 2 === 0 ? 230 : 20;
    data.set([on, on, on, 255], (y * w + x) * 4);
  }
  const flat = flatten({ data, width: w, height: h }, corners, 80, 60);
  const at = (x, y) => flat.data[(y * 80 + x) * 4];
  // Centers of the squares land where they should.
  for (const [x, y, light] of [[5, 5, true], [15, 5, false], [15, 15, true], [75, 55, true], [65, 55, false]]) assert.equal(at(x, y) > 128, light, `${x},${y}`);
});

test('painting out a piece leaves the wall color, and palettes find the main colors', () => {
  const w = 40, h = 30, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([220, 210, 200, 255], i * 4);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 25; x++) data.set([30, 50, 170, 255], (y * w + x) * 4);
  const img = { data, width: w, height: h };
  const pal = palette(crop(img, { x: 8, y: 8, w: 19, h: 14 }), 3);
  assert.ok(pal[0].hex.toLowerCase().startsWith('#1') || pal[0].hex.toLowerCase().startsWith('#2'), pal[0].hex);
  paintOut(img, { x: 10, y: 10, w: 15, h: 10 });
  const o = (15 * w + 15) * 4;
  assert.ok(Math.abs(data[o] - 220) < 8 && Math.abs(data[o + 2] - 200) < 8);
});

test('findArtBox finds a piece on a plain wall, and the whole photo when nothing stands out', async () => {
  const { findArtBox } = await import('../web/photo.js');
  const W = 120, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 230; data[i * 4 + 1] = 228; data[i * 4 + 2] = 220; data[i * 4 + 3] = 255; }
  for (let y = 20; y < 80; y++) for (let x = 30; x < 78; x++) { const o = (y * W + x) * 4; data[o] = 40; data[o + 1] = 60; data[o + 2] = 90; }
  const b = findArtBox({ data, width: W, height: H });
  assert.deepEqual(b, { x: 30, y: 20, w: 48, h: 60 });
  const plain = new Uint8ClampedArray(W * H * 4).fill(200);
  const p = findArtBox({ data: plain, width: W, height: H });
  assert.ok(p.w > W * 0.9 && p.h > H * 0.9);
});

test('wallTone takes part of a warm cast out of a white wall, and less out of a colored one', async () => {
  const { wallTone } = await import('../web/photo.js');
  const make = (r, g, b) => { const W = 40, H = 30, data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; } return { data, width: W, height: H }; };
  const warm = wallTone(make(220, 200, 165));
  assert.ok(warm.r < 1 && warm.b > 1, JSON.stringify(warm));
  assert.ok(warm.lift >= 1 && warm.lift <= 1.2);
  const sage = wallTone(make(120, 160, 110));
  assert.ok(Math.abs(sage.g - 1) < Math.abs(1 - (120 + 160 + 110) / 3 / 160) * 0.5, JSON.stringify(sage));
});
