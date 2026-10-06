// Furniture side by side against the wall is boxed piece by piece, so art can go over
// the low one. Real photos (Unsplash, credited in test/fixtures/bench/truth.json),
// read the way the site reads them, with the image model's labels saved beside them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPng } from './png.js';
import { readWall, suggestWall, hiddenFromFor, splitByTops } from '../web/detect.js';
import { flatten, aspectFromCorners, homography, apply } from '../web/photo.js';
import { unpackLabels } from '../web/segcore.js';

const dir = new URL('./fixtures/bench/', import.meta.url);
const truth = JSON.parse(readFileSync(new URL('truth.json', dir), 'utf8'));
const FURN = new Set(['couch', 'headboard', 'dresser', 'shelf', 'console', 'furniture']);

function read(id) {
  const img = readPng(new URL(`${id}.png`, dir));
  const seg = unpackLabels(JSON.parse(readFileSync(new URL(`${id}.labels.json`, dir), 'utf8')));
  const { corners, seenBottom } = suggestWall(img, seg);
  const { aspect } = aspectFromCorners(corners, img.width, img.height);
  const W = 600, H = Math.round(W / aspect);
  const toPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
  const r = readWall(flatten(img, corners, W, H), { hiddenFrom: hiddenFromFor(corners, seenBottom, W, H), labels: { seg, toPhoto, photoW: img.width, photoH: img.height } });
  return r.items.filter((it) => FURN.has(it.kind)).map((it) => {
    const a = apply(toPhoto, it.x, it.y + it.h), b = apply(toPhoto, it.x + it.w, it.y + it.h);
    return { kind: it.kind, x0: Math.min(a[0], b[0]) / img.width, x1: Math.max(a[0], b[0]) / img.width };
  });
}
const span = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
const pieces = (id) => truth.find((t) => t.file.startsWith(id)).pieces;

for (const id of ['08', '09']) {
  test(`photo ${id}: two pieces side by side are two boxes, not one`, () => {
    const boxes = read(id);
    for (const p of pieces(id).filter((x) => x.kind !== 'chair')) {
      const best = Math.max(0, ...boxes.map((b) => span(p, b) / Math.max(p.x1 - p.x0, b.x1 - b.x0)));
      assert.ok(best >= 0.6, `${p.kind} ${p.x0}-${p.x1}: best overlap ${best.toFixed(2)} in ${JSON.stringify(boxes)}`);
    }
  });
}

for (const id of ['04', '16']) {
  test(`photo ${id}: one couch or bed stays one box, dips in its top and all`, () => {
    const boxes = read(id);
    const main = pieces(id).find((x) => x.kind === 'couch' || x.kind === 'headboard');
    const over = boxes.filter((b) => span(main, b) / (b.x1 - b.x0) >= 0.5);
    assert.equal(over.length, 1, JSON.stringify(boxes));
    assert.ok(span(main, over[0]) / (main.x1 - main.x0) >= 0.85);
  });
}

test('the top line splits at a step that holds, not at a narrow bump or a dip', () => {
  const run = (pairs) => pairs.flatMap(([v, n]) => Array(n).fill(v));
  // a tall bookcase (top at row 2) beside a couch (top at row 20), 40 rows tall
  assert.deepEqual(splitByTops(run([[2, 30], [20, 50]]), 40), [[0, 29], [30, 79]]);
  // a couch's arms are lower, and narrow: one piece
  assert.deepEqual(splitByTops(run([[24, 6], [18, 70], [24, 6]]), 40), [[0, 81]]);
  // a dip between back cushions: one piece
  assert.deepEqual(splitByTops(run([[18, 30], [30, 20], [18, 30]]), 40), [[0, 79]]);
  // three pieces stepping down
  assert.equal(splitByTops(run([[2, 30], [14, 30], [26, 30]]), 40).length, 3);
});

test('a photo with a second wall past the side offers it, read on its own; one without offers nothing', async () => {
  const { otherWalls } = await import('../web/detect.js');
  const img = readPng(new URL('11.png', dir));
  const seg = unpackLabels(JSON.parse(readFileSync(new URL('11.labels.json', dir), 'utf8')));
  const others = otherWalls(img, seg, suggestWall(img, seg));
  assert.equal(others.length, 1);
  assert.equal(others[0].side, 'right');
  const x0 = Math.min(others[0].corners[0][0], others[0].corners[3][0]) / img.width;
  assert.ok(x0 > 0.6, `the right wall starts at ${x0.toFixed(2)} of the photo`);
  const liv = readPng(new URL('./fixtures/living_room.png', import.meta.url));
  const lseg = unpackLabels(JSON.parse(readFileSync(new URL('./fixtures/living_room.labels.json', import.meta.url), 'utf8')));
  assert.deepEqual(otherWalls(liv, lseg, suggestWall(liv, lseg)), []);
});
