// Label a photo with the image model, in Node, the way the site does:
//   node tools/segment.mjs <photo.png> <out.json> [model.onnx]
// Needs onnxruntime-node (npm i -D onnxruntime-node) and the model file; without
// a path it's fetched from MODEL.url once into tools/.cache/.
// Used to make the label fixtures the tests read (test/fixtures/*.labels.json).

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from '../test/png.js';
import { MODEL, prepare, labelsFrom, packLabels } from '../web/segcore.js';

const [src, out, modelArg] = process.argv.slice(2);
if (!src || !out) { console.error('Usage: node tools/segment.mjs <photo.png> <out.json> [model.onnx]'); process.exit(1); }
const ort = await import('onnxruntime-node');
let modelPath = modelArg;
if (!modelPath) {
  const cache = join(dirname(fileURLToPath(import.meta.url)), '.cache');
  modelPath = join(cache, 'segformer-b2-ade-q8.onnx');
  if (!existsSync(modelPath)) {
    mkdirSync(cache, { recursive: true });
    const r = await fetch(MODEL.url);
    if (!r.ok) throw new Error(`Couldn't fetch the model: ${r.status}`);
    writeFileSync(modelPath, Buffer.from(await r.arrayBuffer()));
  }
}
const session = await ort.InferenceSession.create(modelPath);
const img = readPng(src);
const t0 = Date.now();
const x = prepare(img);
const res = await session.run({ pixel_values: new ort.Tensor('float32', x.data, [1, 3, x.h, x.w]) });
const lg = res.logits;
const seg = labelsFrom(lg.data, lg.dims[1], lg.dims[2], lg.dims[3]);
writeFileSync(out, JSON.stringify(packLabels(seg)));
console.log(`${src}: ${seg.w} x ${seg.h} labels in ${Date.now() - t0} ms -> ${out}`);
