// Reading a wall photo. First a made-up flattened wall (a TV on a stand, a lamp
// and a framed print), then a real photo: Jason's living room, with a ceiling,
// a soffit, side walls and a table in front, read the way the site reads it:
// find the wall's corners, flatten it, then read what's on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWall, guessWidth, suggestWall, tvDepthFactor, hiddenFromFor } from '../web/detect.js';
import { flatten, aspectFromCorners, homography, apply } from '../web/photo.js';
import { readPng } from './png.js';

// A flattened wall: the wall fills the image and the floor is its bottom edge.
function scene() {
  const w = 800, h = 560, data = new Uint8ClampedArray(w * h * 4);
  const put = (x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * w + x) * 4); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = 1 - 0.12 * (x / w); data.set([228 * k, 220 * k, 205 * k, 255], (y * w + x) * 4); }
  put(250, 470, 570, 560, [40, 40, 42]);        // stand
  put(270, 300, 550, 455, [12, 12, 14]);        // TV, not touching the stand
  put(690, 220, 720, 560, [60, 60, 60]);        // lamp pole
  put(670, 200, 740, 250, [190, 180, 160]);     // lamp shade, close to the wall's color
  put(70, 120, 190, 290, [25, 25, 25]);         // frame
  put(80, 130, 180, 280, [250, 250, 248]);      // mat
  put(95, 150, 165, 260, [40, 70, 180]);        // the print
  return { data, width: w, height: h };
}

test('on a flattened wall it finds the TV, the stand, the lamp with its shade and the print', () => {
  const r = readWall(scene());
  const kinds = r.items.map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['art', 'furniture', 'lamp', 'tv'], kinds.join());
  const tv = r.items.find((i) => i.kind === 'tv');
  assert.ok(Math.abs(tv.x - 270) < 8 && Math.abs(tv.w - 280) < 12 && Math.abs(tv.h - 155) < 12, JSON.stringify(tv));
  assert.ok(tv.alone, 'a TV with wall on every side is on its own');
  const art = r.items.find((i) => i.kind === 'art');
  assert.ok(Math.abs(art.x - 70) < 8 && Math.abs(art.w - 120) < 12 && Math.abs(art.h - 170) < 12, JSON.stringify(art));
  const lamp = r.items.find((i) => i.kind === 'lamp');
  assert.ok(lamp.x < 680 && lamp.x + lamp.w > 730 && lamp.y < 212, `the lamp box takes in the shade: ${JSON.stringify(lamp)}`);
  const g = guessWidth(r.items, 800);
  assert.equal(g.from, 'tv');
  assert.ok(Math.abs(g.inches - (800 / 280) * 48.5) < 6);
  assert.ok(Math.abs(guessWidth(r.items, 800, 65).inches - (800 / 280) * 57.25) < 7, 'a 65 in TV scales the wall up');
});

test('a TV joined to a dark cabinet is not used for the scale, so there is no width guess', () => {
  const sc = scene();
  const put = (x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sc.data.set([...rgb, 255], (y * sc.width + x) * 4); };
  put(200, 300, 620, 560, [14, 14, 16]); // one dark block from the TV's top to the floor, wider than the screen
  const r = readWall(sc);
  assert.equal(guessWidth(r.items, 800), null);
});

test('a bare wall finds nothing and makes no width guess', () => {
  const w = 400, h = 300, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([230, 228, 222, 255], i * 4);
  const r = readWall({ data, width: w, height: h });
  assert.equal(r.items.length, 0);
  assert.equal(guessWidth(r.items, w), null);
});

// ---------- The living room photo ----------

// Set by hand on the fixture (450 x 600). REAL is the wall: under the soffit,
// between the side walls, down to the floor at the bottom of the baseboard. The
// floor shows only at the right corner; on the left it's behind the basket and
// the table, so it's taken along the slope of the TV's bottom edge.
const REAL = [[28.5, 172], [373, 161], [388, 422], [36, 438]];
// FRAME is where the boxes below were measured: the same wall down to the top
// of the baseboard. Boxes are compared in it, as fractions of its width (x) and
// height from the top (y); what stands on the floor runs to its bottom or past.
const FRAME = [[28.5, 172], [373, 161], [387, 411], [36, 421]];
const EXPECT = {
  art: [[0.053, 0.128, 0.243, 0.506], [0.047, 0.543, 0.267, 0.752]], // Yves Klein print, smiley print
  tv: [0.345, 0.422, 0.795, 0.794],
  furniture: [0.235, 0.777, 0.952, 1], // the TV stand
  lamp: [0.867, 0.232, 1, 1], // floor lamp, shade included (it runs past the wall's right edge)
};
const living = () => readPng(new URL('./fixtures/living_room.png', import.meta.url));

test('living room: the suggested corners are close to the real ones, with the hidden floor found from the TV stand', () => {
  const img = living();
  const f = suggestWall(img);
  assert.ok(f.ceiling && f.sides[0] && f.sides[1], JSON.stringify(f));
  assert.equal(f.floor, false, 'the floor is behind the table, so it was not seen');
  assert.equal(f.floorFrom, 'stand');
  f.corners.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - REAL[i][0]) < 0.03 * img.width && Math.abs(y - REAL[i][1]) < 0.03 * img.height, `corner ${i}: ${Math.round(x)}, ${Math.round(y)} vs ${REAL[i]}`);
  });
});

function readLiving() {
  const img = living();
  const { corners, seenBottom } = suggestWall(img);
  const { aspect } = aspectFromCorners(corners, img.width, img.height);
  const W = 600, H = Math.round(W / aspect);
  return { img, corners, W, H, aspect, r: readWall(flatten(img, corners, W, H), { hiddenFrom: hiddenFromFor(corners, seenBottom, W, H) }) };
}

test('living room: reading the flattened wall finds two prints, the TV, its stand and the lamp', () => {
  const { corners, W, H, r } = readLiving();
  // Detected boxes go back into the photo, then into the hand-set frame, so the
  // check doesn't depend on exactly where the suggested corners landed.
  const toPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
  const toFrame = homography(FRAME, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const box = (it) => {
    const pts = [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]].map(([x, y]) => apply(toFrame, ...apply(toPhoto, x, y)));
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  };
  const kinds = r.items.map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['art', 'art', 'furniture', 'lamp', 'tv'], kinds.join());
  // Each edge within 5% of the wall.
  const near = (got, want, what) => got.forEach((v, k) => assert.ok(Math.abs(Math.min(1, Math.max(0, v)) - want[k]) < 0.05, `${what} edge ${k}: ${v.toFixed(3)} vs ${want[k]}`));
  const arts = r.items.filter((i) => i.kind === 'art').map(box).sort((a, b) => a[1] - b[1]);
  near(arts[0], EXPECT.art[0], 'Yves Klein print');
  near(arts[1], EXPECT.art[1], 'smiley print');
  near(box(r.items.find((i) => i.kind === 'tv')), EXPECT.tv, 'TV');
  near(box(r.items.find((i) => i.kind === 'furniture')), EXPECT.furniture, 'TV stand');
  near(box(r.items.find((i) => i.kind === 'lamp')), EXPECT.lamp, 'lamp');
});

test('living room: the 55 in TV on its stand sizes the wall at about 10 ft by 7 ft 6 in', () => {
  const { img, corners, W, H, aspect, r } = readLiving();
  const tv = r.items.find((i) => i.kind === 'tv');
  assert.ok(tv.alone && tv.onStand, JSON.stringify(tv));
  // How wide the TV is in the photo, for how far away it is.
  const toPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
  const a = apply(toPhoto, tv.x, tv.y + tv.h / 2), b = apply(toPhoto, tv.x + tv.w, tv.y + tv.h / 2);
  const depth = tvDepthFactor(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(img.width, img.height), 55);
  assert.ok(depth > 1.05 && depth < 1.12, `a TV about 12 ft away and a foot out from the wall: ${depth}`);
  const g = guessWidth(r.items, W, 55, depth);
  const tall = g.inches / aspect;
  assert.ok(g.inches >= 112 && g.inches <= 126, `width ${g.inches} in`);
  assert.ok(tall >= 84 && tall <= 96, `height ${tall.toFixed(0)} in`);
});
