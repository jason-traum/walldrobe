import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRINTERS, printOptions, picks, aiQuestion, sizeKey } from '../web/printers.js';

test('sizes are written short side first', () => {
  assert.equal(sizeKey(10, 8), '8x10');
  assert.equal(sizeKey(8, 10), '8x10');
  for (const p of PRINTERS) for (const k of Object.keys(p.sizes)) { const [a, b] = k.split('x').map(Number); assert.ok(a <= b, `${p.id} ${k}`); }
});

test('services that print every size come first, cheapest first', () => {
  const rows = printOptions([{ key: '8x10', count: 2 }, { key: '24x36', count: 1 }]);
  const firstPartial = rows.findIndex((r) => !r.all);
  assert.ok(firstPartial === -1 || rows.slice(firstPartial).every((r) => !r.all));
  const full = rows.filter((r) => r.all);
  for (let i = 1; i < full.length; i++) assert.ok(full[i - 1].total <= full[i].total);
  const wm = rows.find((r) => r.p.id === 'walmart');
  assert.equal(wm.total, Math.round((2.94 * 2 + 22.86) * 100) / 100);
});

test('a service with none of the sizes is left out', () => {
  const rows = printOptions([{ key: '8x10', count: 1 }]);
  assert.ok(!rows.some((r) => r.p.id === 'printkeg'));
});

test('the picks are different services', () => {
  const pk = picks(printOptions([{ key: '11x14', count: 1 }, { key: '8x10', count: 2 }]));
  const ids = [pk.cheapest, pk.today, pk.better].filter(Boolean).map((r) => r.p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(pk.today.p.kind, 'Store');
});

test('the AI question has the table and asks for today codes, no em dashes', () => {
  const needed = [{ key: '8x10', count: 2 }];
  const q = aiQuestion(needed, printOptions(needed));
  assert.match(q, /\| Service \| 8x10 \(x2\) \| Total/);
  assert.match(q, /discount codes/);
  assert.ok(!q.includes(String.fromCharCode(0x2014)));
});
