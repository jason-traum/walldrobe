// How well the photo reader boxes furniture that stands side by side.
//   node tools/bench_read.mjs <bench dir> [--only 01,02] [--show]
// The folder holds NN.png photos, NN.labels.json from tools/segment.mjs, and truth.json:
// [{ file: 'NN.jpg', pieces: [{ kind, x0, x1, top }] }] with x0, x1 and top as shares of
// the photo's width and height. Each photo is read the way the site reads it (corners,
// flatten, readWall with the model's labels), the furniture found is mapped back onto
// the photo, and each true piece is matched to the box that overlaps it most.
// A box that covers two true pieces is a merge: the thing this bench is for.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from '../test/png.js';
import { readWall, suggestWall, hiddenFromFor } from '../web/detect.js';
import { flatten, aspectFromCorners, homography, apply } from '../web/photo.js';
import { unpackLabels } from '../web/segcore.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const show = args.includes('--show');
const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'));
const FURN = new Set(['couch', 'headboard', 'dresser', 'shelf', 'console', 'furniture', 'desk', 'cabinet']);

export function readPhoto(png, seg) {
  const img = readPng(png);
  const { corners, seenBottom } = suggestWall(img, seg);
  const { aspect } = aspectFromCorners(corners, img.width, img.height);
  const W = 600, H = Math.round(W / aspect);
  const toPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
  const r = readWall(flatten(img, corners, W, H), { hiddenFrom: hiddenFromFor(corners, seenBottom, W, H), labels: { seg, toPhoto, photoW: img.width, photoH: img.height } });
  // Each box's bottom corners back on the photo, as shares of its width.
  const boxes = r.items.filter((it) => FURN.has(it.kind)).map((it) => {
    const a = apply(toPhoto, it.x, it.y + it.h), b = apply(toPhoto, it.x + it.w, it.y + it.h), t = apply(toPhoto, it.x + it.w / 2, it.y);
    return { kind: it.kind, x0: Math.min(a[0], b[0]) / img.width, x1: Math.max(a[0], b[0]) / img.width, top: t[1] / img.height };
  });
  return { boxes, corners, img };
}

const span = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
let found = 0, total = 0, merges = 0, extra = 0;
for (const t of truth) {
  const id = t.file.replace(/\.\w+$/, '');
  if (only && !only.has(id)) continue;
  const png = join(dir, `${id}.png`), lab = join(dir, `${id}.labels.json`);
  if (!existsSync(png) || !existsSync(lab)) continue;
  // Pieces the reader is meant to box: tall enough to matter for art (it skips low things).
  const want = t.pieces.filter((p) => !['chair', 'nightstand'].includes(p.kind));
  const { boxes } = readPhoto(png, unpackLabels(JSON.parse(readFileSync(lab, 'utf8'))));
  const hit = want.map((p) => {
    let best = null, bi = 0;
    for (const b of boxes) { const i = span(p, b) / Math.max(p.x1 - p.x0, b.x1 - b.x0); if (i > bi) { bi = i; best = b; } }
    return { p, b: best, iou: bi };
  });
  const m = boxes.filter((b) => want.filter((p) => span(p, b) / (p.x1 - p.x0) >= 0.6).length >= 2).length;
  const ok = hit.filter((h) => h.iou >= 0.6).length;
  // A box on nothing in the photo's truth (side tables and chairs count as something).
  const loose = boxes.filter((b) => !t.pieces.some((p) => span(p, b) / (b.x1 - b.x0) >= 0.3)).length;
  found += ok; total += want.length; merges += m; extra += loose;
  console.log(`${id}: ${ok}/${want.length} boxed${m ? `, ${m} merged` : ''}${loose ? `, ${loose} extra` : ''}`);
  if (show) {
    for (const h of hit) console.log(`   ${h.p.kind} ${h.p.x0.toFixed(2)}-${h.p.x1.toFixed(2)} -> ${h.b ? `${h.b.kind} ${h.b.x0.toFixed(2)}-${h.b.x1.toFixed(2)}` : 'nothing'} (${h.iou.toFixed(2)})`);
    for (const b of boxes) console.log(`   box ${b.kind} ${b.x0.toFixed(2)}-${b.x1.toFixed(2)} top ${b.top.toFixed(2)}`);
  }
}
console.log(`\n${found}/${total} pieces boxed on their own, ${merges} merged boxes, ${extra} extra boxes`);
