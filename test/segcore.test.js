// The image model's input and output: the photo keeps its shape, sides come out
// a multiple of 32, and label maps survive being saved as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, labelsFrom, packLabels, unpackLabels, MODEL } from '../web/segcore.js';
import { groupOf, G } from '../web/detect.js';

test('a tall photo goes in tall, sides a multiple of 32, normalized', () => {
  const w = 300, h = 400, data = new Uint8ClampedArray(w * h * 4).fill(255);
  const x = prepare({ data, width: w, height: h });
  assert.equal(x.h, MODEL.long);
  assert.equal(x.w % 32, 0);
  assert.ok(Math.abs(x.w / x.h - 0.75) < 0.05);
  assert.ok(Math.abs(x.data[0] - (1 - 0.485) / 0.229) < 1e-4, 'white, normalized like ImageNet');
});

test('labels are the most likely kind per patch, and survive saving', () => {
  const C = 3, h = 2, w = 2, lg = new Float32Array(C * h * w);
  lg[0 * 4 + 0] = 5; lg[1 * 4 + 1] = 5; lg[2 * 4 + 2] = 5; lg[0 * 4 + 3] = 1;
  const seg = labelsFrom(lg, C, h, w);
  assert.deepEqual([...seg.labels], [0, 1, 2, 0]);
  assert.deepEqual([...unpackLabels(packLabels(seg)).labels], [0, 1, 2, 0]);
});

test("the model's kinds land in the right groups", () => {
  assert.equal(groupOf(0), G.WALL);
  assert.equal(groupOf(5), G.CEILING);
  assert.equal(groupOf(22), G.ART);
  assert.equal(groupOf(89), G.TV);
  assert.equal(groupOf(36), G.LAMP);
  assert.equal(groupOf(23), G.FURNITURE);
  assert.equal(groupOf(12), G.MOVES);
});
