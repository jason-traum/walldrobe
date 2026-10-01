// The image model's input and output, the same in the browser and in Node:
// a photo in, one label per small patch of it out (ADE20K's 150 kinds of thing:
// wall, ceiling, floor, painting, television, lamp, sofa...). Pure: no DOM, no
// network. The model itself runs in web/segment.js (browser) and
// tools/segment.mjs (Node).

// SegFormer B2, trained on ADE20K, quantized (about 29 MB). NVIDIA's license
// allows non-commercial use; fine for the free beta, to be replaced before
// Walldrobe charges anyone (DECISIONS 2026-10-01).
export const MODEL = {
  url: 'https://huggingface.co/Xenova/segformer-b2-finetuned-ade-512-512/resolve/main/onnx/model_quantized.onnx',
  bytes: 28939869,
  long: 512,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
};

// The photo resized (its shape kept, sides a multiple of 32) and normalized,
// channels first, for the model. img: { data (RGBA), width, height }.
export function prepare(img, long = MODEL.long) {
  const s = long / Math.max(img.width, img.height);
  const w = Math.max(32, Math.round((img.width * s) / 32) * 32), h = Math.max(32, Math.round((img.height * s) / 32) * 32);
  const out = new Float32Array(3 * w * h);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Average the block of photo pixels this one covers.
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < Math.min(img.height, y1); yy++) for (let xx = x0; xx < Math.min(img.width, x1); xx++) {
        const o = (yy * img.width + xx) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
      }
      const i = y * w + x;
      out[i] = (r / n / 255 - MODEL.mean[0]) / MODEL.std[0];
      out[w * h + i] = (g / n / 255 - MODEL.mean[1]) / MODEL.std[1];
      out[2 * w * h + i] = (b / n / 255 - MODEL.mean[2]) / MODEL.std[2];
    }
  }
  return { data: out, w, h };
}

// The most likely label for each patch, from the model's logits [1, C, h, w].
export function labelsFrom(logits, C, h, w) {
  const labels = new Uint8Array(h * w);
  for (let i = 0; i < h * w; i++) {
    let best = 0, bv = -Infinity;
    for (let c = 0; c < C; c++) { const v = logits[c * h * w + i]; if (v > bv) { bv = v; best = c; } }
    labels[i] = best;
  }
  return { w, h, labels };
}

// A label map kept with the wall (in the draft) as text.
export function packLabels(seg) {
  let s = '';
  for (let i = 0; i < seg.labels.length; i += 4096) s += String.fromCharCode(...seg.labels.subarray(i, i + 4096));
  return { w: seg.w, h: seg.h, b64: btoa(s) };
}
export function unpackLabels(p) {
  if (!p || !p.b64) return null;
  const s = atob(p.b64), labels = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) labels[i] = s.charCodeAt(i);
  return { w: p.w, h: p.h, labels };
}
