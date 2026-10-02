// The image model in the browser: it labels a wall photo (wall, ceiling, floor,
// painting, TV, lamp...) on the person's own phone. The photo never leaves it;
// only the model is downloaded, once (about 29 MB), then kept by the browser.
// If anything here fails, the site reads the photo without it.

import { MODEL, prepare, labelsFrom } from './segcore.js';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
const CACHE = 'walldrobe-model-v1';
let loading = null;
let watchers = []; // progress callbacks from everyone waiting on the same download
let last = null; // the last progress fraction, for a watcher that joins late

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.ort) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('The photo reader did not load.'));
    document.head.appendChild(s);
  });
}

// The model file: from the browser's cache after the first time.
async function modelBytes(onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(MODEL.url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  const r = await fetch(MODEL.url);
  if (!r.ok || !r.body) throw new Error('The photo reader did not download.');
  const total = Number(r.headers.get('content-length')) || MODEL.bytes;
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (onProgress) onProgress(Math.min(0.99, got / total));
  }
  const bytes = new Uint8Array(got);
  let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  try { if (cache) await cache.put(MODEL.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* full storage: it downloads again next time */ }
  return bytes;
}

// Whether the model is already on this device (so there's nothing to wait for).
export async function modelCached() {
  try { const c = await caches.open(CACHE); return !!(await c.match(MODEL.url)); } catch { return false; }
}

export function ready(onProgress) {
  if (onProgress) { watchers.push(onProgress); if (last != null) onProgress(last); }
  if (!loading) {
    loading = (async () => {
      await loadScript(`${ORT}ort.wasm.min.js`);
      const ort = window.ort;
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = 1; // GitHub Pages can't turn on the headers threads need
      const bytes = await modelBytes((f) => { last = f; for (const w of watchers) w(f); });
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    loading.catch(() => { loading = null; last = null; });
    loading.finally(() => { watchers = []; });
  }
  return loading;
}

// Start the download early, while the person is still picking a photo, so the
// wait comes off the first photo. Skipped when the browser says data is dear.
export function warm() {
  try { if (navigator.connection && navigator.connection.saveData) return; } catch { /* no hint */ }
  ready().catch(() => {});
}

// Labels for a photo: { w, h, labels } covering the whole photo.
export async function segment(img, onProgress) {
  const session = await ready(onProgress);
  const x = prepare(img);
  const out = await session.run({ pixel_values: new window.ort.Tensor('float32', x.data, [1, 3, x.h, x.w]) });
  const lg = out.logits;
  return labelsFrom(lg.data, lg.dims[1], lg.dims[2], lg.dims[3]);
}
