// Reading a wall photo: a made-up straight-on photo with a TV on a stand, a lamp
// and a framed print, on a wall that gets darker toward one side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWall, guessWidth } from '../web/detect.js';

function scene() {
  const w = 800, h = 600, data = new Uint8ClampedArray(w * h * 4);
  const put = (x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * w + x) * 4); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = 1 - 0.12 * (x / w); data.set([228 * k, 220 * k, 205 * k, 255], (y * w + x) * 4); }
  put(0, 560, w, h, [120, 88, 60]);             // wood floor
  put(250, 470, 570, 560, [40, 40, 42]);        // stand
  put(270, 300, 550, 455, [12, 12, 14]);        // TV, not touching the stand
  put(690, 220, 720, 560, [60, 60, 60]);        // lamp pole
  put(670, 200, 740, 250, [245, 240, 230]);     // lamp shade (about wall color)
  put(70, 120, 190, 290, [25, 25, 25]);         // frame
  put(80, 130, 180, 280, [250, 250, 248]);      // mat
  put(95, 150, 165, 260, [40, 70, 180]);        // the print
  return { data, width: w, height: h };
}

test('it finds the floor, the TV, the stand, the lamp and the print', () => {
  const r = readWall(scene());
  assert.ok(Math.abs(r.floorY - 560) < 12, `floor at ${r.floorY}`);
  const kinds = r.items.map((i) => i.kind).sort();
  assert.ok(kinds.includes('tv') && kinds.includes('furniture') && kinds.includes('lamp') && kinds.includes('art'), kinds.join());
  const tv = r.items.find((i) => i.kind === 'tv');
  assert.ok(Math.abs(tv.x - 270) < 8 && Math.abs(tv.w - 280) < 12, JSON.stringify(tv));
  const art = r.items.find((i) => i.kind === 'art');
  assert.ok(Math.abs(art.x - 70) < 8 && Math.abs(art.w - 120) < 12 && Math.abs(art.h - 170) < 12, JSON.stringify(art));
  const g = guessWidth(r.items, 800);
  assert.equal(g.from, 'tv');
  assert.ok(Math.abs(g.inches - (800 / 280) * 48.5) < 6);
});

test('a bare wall finds nothing and guesses about 10 ft', () => {
  const w = 400, h = 300, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([230, 228, 222, 255], i * 4);
  const r = readWall({ data, width: w, height: h });
  assert.equal(r.items.length, 0);
  assert.equal(guessWidth(r.items, w).inches, 120);
});
