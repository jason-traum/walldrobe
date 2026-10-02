// The wall's scale from every reference in the photo at once. Made-up flattened
// walls with the image model's labels drawn to match (a TV, a door, a couch),
// read the way the site reads them, then reconciled; and the living room fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWall, guessWidth, scaleEstimates, reconcileScale, suggestWall, tvDepthFactor, hiddenFromFor, TV_SIZES } from '../web/detect.js';
import { flatten, aspectFromCorners, homography, apply } from '../web/photo.js';
import { readPng } from './png.js';
import { readFileSync } from 'node:fs';
import { unpackLabels } from '../web/segcore.js';

// A flattened 800 x 560 wall with things drawn on it and a label map (ADE20K
// ids, at a quarter of the size) that says what each one is. The TV is 242 px
// wide: a 55 in set at 5 px an inch, so a 10 ft wall.
const ADE = { wall: 0, cabinet: 10, door: 14, painting: 22, sofa: 23, television: 89 };
function scene(parts) {
  const w = 800, h = 560, data = new Uint8ClampedArray(w * h * 4);
  const sw = 200, sh = 140, labels = new Uint8Array(sw * sh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = 1 - 0.12 * (x / w); data.set([228 * k, 220 * k, 205 * k, 255], (y * w + x) * 4); }
  const put = (x0, y0, x1, y1, rgb, id) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * w + x) * 4);
    if (id) for (let y = Math.round(y0 / 4); y < Math.round(y1 / 4); y++) for (let x = Math.round(x0 / 4); x < Math.round(x1 / 4); x++) labels[y * sw + x] = id;
  };
  const ty = parts.tvY || 300; // the TV's top; over a couch it hangs higher, clear of it
  if (parts.tv) put(270, ty, 512, ty + 136, [12, 12, 14], ADE.television);
  if (parts.print) { put(70, 120, 190, 290, [25, 25, 25], ADE.painting); put(80, 130, 180, 280, [250, 250, 248], ADE.painting); put(95, 150, 165, 260, [40, 70, 180], ADE.painting); }
  if (parts.door) put(600, 560 - parts.door, 760, 560, [120, 85, 50], ADE.door); // its height in px sets its scale
  if (parts.couch) put(20, 450, 20 + parts.couch, 560, [140, 130, 120], ADE.sofa); // its width in px sets its scale
  const img = { data, width: w, height: h };
  const seg = { w: sw, h: sh, labels };
  const toPhoto = homography([[0, 0], [w, 0], [w, h], [0, h]], [[0, 0], [w, 0], [w, h], [0, h]]);
  return { img, labels: { seg, toPhoto, photoW: w, photoH: h } };
}
const read = (parts) => { const { img, labels } = scene(parts); return readWall(img, { labels }).items; };
const noDash = (s) => assert.ok(!/[\u2014\u2013]/.test(s), `no em or en dash in: ${s}`);

test('a TV and a door that agree: the door leads, the TV counts, one sentence says they agree', () => {
  const items = read({ tv: true, print: true, door: 400 }); // 80 in at 5 px an inch
  assert.deepEqual(items.map((i) => i.kind).sort(), ['art', 'door', 'tv']);
  const est = scaleEstimates(items, { w: 800, h: 560 });
  assert.deepEqual(est.map((e) => e.from), ['door', 'tv'], 'most confident first');
  const g = guessWidth(items, 800);
  assert.equal(g.from, 'door');
  assert.equal(g.agree, true);
  assert.ok(g.spread < 1.05, `spread ${g.spread}`);
  assert.ok(Math.abs(g.inches - 160) <= 4, `width ${g.inches} in`);
  assert.equal(g.tvInches, 55);
  assert.equal(g.tvWhy, null);
  assert.equal(g.note, 'The door and the TV agree on the size.');
  assert.deepEqual(g.refs.map((r) => [r.from, r.counted]), [['door', true], ['tv', true]]);
  noDash(g.note);
});

test('a door and a couch that disagree: no agreement, and the note gives both widths in feet and inches', () => {
  const items = read({ door: 400, couch: 336 }); // door 5 px an inch, couch 4
  assert.equal(guessWidth(items, 800), null, 'no TV, so the person still measures');
  const r = reconcileScale(scaleEstimates(items, { w: 800, h: 560 }), { w: 800 });
  assert.equal(r.agree, false);
  assert.ok(r.spread > 1.2 && r.spread < 1.3, `spread ${r.spread}`);
  assert.equal(r.from, 'door');
  assert.deepEqual(r.used.map((e) => e.from), ['door', 'couch']);
  assert.equal(r.dropped.length, 0, 'with only two there is no telling which is off');
  assert.match(r.note, /^The door says 13 ft 4 in and the couch says 16 ft [78] in\. Measure to be sure\.$/);
  noDash(r.note);
  // The door counts for more, so the answer sits nearer it.
  assert.ok(800 / r.ppi > 160 && 800 / r.ppi < 180, `${800 / r.ppi} in`);
});

test('one outlier among three is left out and the note says so', () => {
  const items = read({ tv: true, tvY: 180, door: 400, couch: 546 }); // TV and door at 5 px an inch, couch at 6.5
  assert.deepEqual(items.map((i) => i.kind).sort(), ['couch', 'door', 'tv']);
  const g = guessWidth(items, 800);
  assert.equal(g.agree, true);
  assert.ok(Math.abs(g.inches - 160) <= 4, `width ${g.inches} in`);
  assert.deepEqual(g.refs.filter((r) => r.counted).map((r) => r.from), ['door', 'tv']);
  assert.deepEqual(g.refs.filter((r) => !r.counted).map((r) => [r.from, r.why]), [['couch', 'disagrees with the others']]);
  assert.equal(g.note, 'The door and the TV agree on the size. The couch disagrees and was left out.');
});

test('the TV size is picked from the list to agree with the door, and reported as tvWhy others', () => {
  const items = read({ tv: true, door: 320 }); // the door says 4 px an inch; a 55 in TV says 5, a 65 in one 4.2
  const g = guessWidth(items, 800);
  assert.equal(g.tvInches, 65);
  assert.equal(g.tvWhy, 'others');
  assert.equal(g.agree, true);
  assert.ok(Math.abs(g.inches - 200) <= 6, `width ${g.inches} in`);
  assert.equal(g.note, 'The door and the TV agree on the size, with the TV taken as 65 in.');
  // When the person picked the size, it stays, and the two just disagree.
  const picked = guessWidth(items, 800, 55, 1, { tvPicked: true });
  assert.equal(picked.tvInches, 55);
  assert.equal(picked.tvWhy, null);
  assert.equal(picked.agree, false);
  assert.equal(picked.from, 'tv', 'a size the person chose counts for the most');
  assert.match(picked.note, /^The TV says 13 ft [4-6] in and the door says 16 ft 8 in\. Measure to be sure\.$/);
});

test('when no TV size agrees with the door, the nearest is taken and they still disagree', () => {
  const items = read({ tv: true, door: 200 }); // the door says 2.5 px an inch; even a 75 in TV says 3.7
  const g = guessWidth(items, 800);
  assert.equal(g.tvInches, 75);
  assert.equal(g.tvWhy, 'others');
  assert.equal(g.agree, false);
  assert.match(g.note, /^The door says 26 ft 8 in and the TV, taken as 75 in, says 18 ft \d+ in\. Measure to be sure\.$/);
});

test('a typed width is the whole answer', () => {
  const items = read({ tv: true, door: 320 });
  const r = reconcileScale(scaleEstimates(items, { w: 800, h: 560, widthInches: 150 }), { w: 800 });
  assert.equal(r.from, 'measure');
  assert.equal(r.agree, true);
  assert.equal(r.ppi, 800 / 150);
  assert.equal(r.note, 'From your measurement.');
  assert.deepEqual(r.dropped.map((e) => e.why), ['measured instead', 'measured instead']);
});

test('an outlet plate is 4.5 in tall, tight in size but weak when small in the photo', () => {
  const plate = (h) => ({ kind: 'outlet', x: 10, y: 300, w: (h * 2.75) / 4.5, h });
  const conf = (h) => scaleEstimates([plate(h)], { w: 800 })[0].confidence;
  assert.equal(scaleEstimates([plate(90)], { w: 800 })[0].ppi, 20);
  assert.ok(conf(90) >= 0.85, `a big plate is trusted: ${conf(90)}`);
  assert.ok(conf(39) < 0.5 && conf(39) > conf(20), `under 40 px it is low: ${conf(39)}, ${conf(20)}`);
  assert.ok(conf(12) < 0.2, 'a tiny plate does not count');
  // Alongside a door it agrees with, a big plate counts; a tiny one is dropped as too small.
  const door = { kind: 'door', x: 600, y: 160, w: 160, h: 400 };
  const big = reconcileScale(scaleEstimates([door, plate(90 / 4)], { w: 800, h: 560 }), { w: 800 });
  assert.deepEqual(big.used.map((e) => e.from), ['door', 'outlet']);
  const tiny = reconcileScale(scaleEstimates([door, plate(12 / 4 * 5)], { w: 800, h: 560 }), { w: 800 });
  assert.deepEqual(tiny.used.map((e) => e.from), ['door']);
  assert.deepEqual(tiny.dropped.map((e) => [e.from, e.why]), [['outlet', 'too small to trust']]);
});

test('the ceiling counts only when asked for, at 8 ft, loosely', () => {
  const items = read({ tv: true, door: 400 });
  assert.ok(!scaleEstimates(items, { w: 800, h: 560 }).some((e) => e.from === 'ceiling'));
  const c = scaleEstimates(items, { w: 800, h: 560, ceiling: true }).find((e) => e.from === 'ceiling');
  assert.ok(c && c.inches === 96 && c.px === 560 && c.confidence < 0.5);
});

test('nothing to go on gives no scale and says to measure', () => {
  const r = reconcileScale([]);
  assert.equal(r.ppi, null);
  assert.equal(r.agree, false);
  assert.equal(r.note, 'Nothing in the photo sets the size. Measure the wall.');
});

test('any TV size in the list can be the pick; one within 15% of 55 in is left at 55', () => {
  for (const [dg, wide] of TV_SIZES) {
    const items = read({ tv: true, door: Math.round((242 / wide) * 80) }); // a door that matches this size exactly
    const g = guessWidth(items, 800);
    const within = Math.max(wide / 48.5, 48.5 / wide) <= 1.15; // 50 in is only 10% off 55 in
    assert.equal(g.tvInches, within ? 55 : dg, `${dg} in`);
    assert.equal(g.tvWhy, within ? null : 'others', `${dg} in`);
    assert.equal(g.agree, true, `${dg} in: ${g.note}`);
  }
});

// ---------- The living room fixture ----------

// Before this change the 55 in TV gave 120 in with the image model and 118 in
// without. It is the only reference on that wall, so the answer is the same.
const living = () => readPng(new URL('./fixtures/living_room.png', import.meta.url));
const livingLabels = () => unpackLabels(JSON.parse(readFileSync(new URL('./fixtures/living_room.labels.json', import.meta.url), 'utf8')));
for (const [mode, labels, want] of [['with the image model', livingLabels, 120], ['without it', () => null, 118]]) {
  test(`living room, ${mode}: the TV is the only reference, so the width is still ${want} in and the note says to measure`, () => {
    const img = living(), seg = labels();
    const { corners, seenBottom } = suggestWall(img, seg);
    const { aspect } = aspectFromCorners(corners, img.width, img.height);
    const W = 600, H = Math.round(W / aspect);
    const toPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
    const r = readWall(flatten(img, corners, W, H), { hiddenFrom: hiddenFromFor(corners, seenBottom, W, H), labels: seg ? { seg, toPhoto, photoW: img.width, photoH: img.height } : undefined });
    const tv = r.items.find((i) => i.kind === 'tv');
    const a = apply(toPhoto, tv.x, tv.y + tv.h / 2), b = apply(toPhoto, tv.x + tv.w, tv.y + tv.h / 2);
    const depth = tvDepthFactor(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(img.width, img.height), 55);
    const g = guessWidth(r.items, W, 55, depth);
    assert.equal(g.inches, want);
    assert.equal(g.from, 'tv');
    assert.equal(g.agree, true);
    assert.equal(g.refs.length, 1);
    assert.equal(g.note, 'Only the TV sets the size. Measure to be sure.');
  });
}
