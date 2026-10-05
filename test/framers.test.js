import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAMERS, frameOptions, framePicks, framesTable, frameKey, sizesIn } from '../web/framers.js';
import { aiQuestion } from '../web/printers.js';

test('frame sizes are written short side first', () => {
  for (const f of FRAMERS) for (const k of Object.keys(f.sizes)) { const [a, b] = k.split('x').map(Number); assert.ok(a <= b, `${f.id} ${k}`); }
  assert.equal(frameKey(14, 11), '11x14');
});

test('a mat fits only when it holds the print asked for', () => {
  const rows = frameOptions([{ key: '11x14', mat: '8x10', count: 1 }]);
  const mich = rows.find((r) => r.p.id === 'michaels');
  assert.equal(mich.each[0].matOk, false); // its 11x14 mat is for 5x7
  const af = rows.find((r) => r.p.id === 'americanflat');
  assert.equal(af.each[0].matOk, true);
});

test('Framebridge is priced by the print, and every size counts', () => {
  const rows = frameOptions([{ key: '16x20', mat: '11x14', count: 2 }]);
  const fb = rows.find((r) => r.p.id === 'framebridge');
  assert.equal(fb.total, 300);
});

test('picks are different sellers that have every size', () => {
  const pk = framePicks(frameOptions([{ key: '16x20', mat: '11x14', count: 1 }, { key: '12x12', mat: '8x8', count: 1 }]));
  const ids = [pk.cheapest, pk.today, pk.better].filter(Boolean).map((r) => r.p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of [pk.cheapest, pk.today, pk.better].filter(Boolean)) assert.ok(r.all);
});

test('the question for your AI covers prints and frames', () => {
  const fn = [{ key: '11x14', mat: '8x10', count: 1 }];
  const q = aiQuestion([{ key: '8x10', count: 1 }], [], { needed: fn, table: framesTable(fn, frameOptions(fn)), checked: 'Oct 3, 2026' });
  assert.match(q, /\| Seller \| 11x14 frame, mat for 8x10/);
  assert.match(q, /printing and framing/);
  assert.ok(!q.includes(String.fromCharCode(0x2014)));
});

test('a frame color has its own prices and sizes, and keeps the mat it comes with', () => {
  const af = FRAMERS.find((f) => f.id === 'americanflat');
  assert.deepEqual(sizesIn(af, 'white')['11x14'], [15.99, '8x10']);
  assert.deepEqual(sizesIn(af, 'oak')['16x20'], [31.99]);
  assert.equal(sizesIn(af, 'brass')['12x12'], undefined);
  const black = frameOptions([{ key: '16x20', mat: null, count: 1 }]);
  const oak = frameOptions([{ key: '16x20', mat: null, count: 1 }], 'oak');
  assert.ok(oak.length < black.length, 'fewer sellers have oak');
  for (const f of FRAMERS) for (const c of Object.values(f.colors || {})) for (const k of Object.keys(c)) { const [a, b] = k.split('x').map(Number); assert.ok(a <= b, `${f.id} ${k}`); }
});

test('each frame can be priced in its own color', () => {
  const both = frameOptions([{ key: '11x14', mat: null, count: 1, look: 'black' }, { key: '11x14', mat: null, count: 1, look: 'white' }]);
  const black = frameOptions([{ key: '11x14', mat: null, count: 2 }], 'black');
  for (const r of both) {
    const b = black.find((x) => x.p.id === r.p.id);
    if (!b || !b.each[0] || r.p.id === 'framebridge') continue;
    assert.equal(r.each[0].price, b.each[0].price / 2, r.p.id);
    const w = sizesIn(r.p, 'white')['11x14'];
    assert.equal(r.each[1] ? r.each[1].price : null, w ? w[0] : null, r.p.id);
  }
  assert.match(framesTable([{ key: '11x14', mat: null, count: 1, look: 'oak' }, { key: '11x14', mat: null, count: 1, look: 'black' }], both), /11x14 oak frame/);
});
