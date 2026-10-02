// Wall photos: from four corner taps and one real measurement to a flat picture
// of the wall at true scale. The math here is pure (numbers and pixel arrays in,
// numbers and pixel arrays out) so it runs in Node tests; the canvas helpers at
// the bottom are the only browser parts. Photos never leave the device.

// ---------- Homography ----------

// Solve a small linear system by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// The 3 x 3 projective map (row major, h33 = 1) taking src[i] to dst[i], four points each.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function apply(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// ---------- Corners ----------

// Corners come as [top left, top right, bottom right, bottom left]. They must
// make a convex shape, go clockwise and stay inside the photo.
export function cornerProblem(c, w, h) {
  if (c.some(([x, y]) => x < -1 || y < -1 || x > w + 1 || y > h + 1)) return 'Keep every corner on the photo.';
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const turns = [0, 1, 2, 3].map((i) => cross(c[i], c[(i + 1) % 4], c[(i + 2) % 4]));
  // Image y points down, so clockwise on screen is a positive cross product here.
  if (!turns.every((t) => t > 0)) return 'Corners should go clockwise from the top left, without crossing.';
  const area = Math.abs(turns.reduce((s, _, i) => s + (c[i][0] * c[(i + 1) % 4][1] - c[(i + 1) % 4][0] * c[i][1]), 0)) / 2;
  if (area < 0.04 * w * h) return 'The wall should fill more of the photo. Drag the corners out to its edges.';
  return null;
}

// ---------- Width over height from one photo ----------

// The real width over height of a rectangle seen in perspective, from its four
// corners, estimating the camera's focal length (Zhang and He, whiteboard
// scanning, 2007). Assumes the photo's center is the camera's center.
export function aspectFromCorners(c, w, h) {
  const [tl, tr, br, bl] = c.map(([x, y]) => [x - w / 2, y - h / 2, 1]);
  const m1 = tl, m2 = tr, m3 = bl, m4 = br;
  const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(crossV(m1, m4), m3) / dot(crossV(m2, m4), m3);
  const k3 = dot(crossV(m1, m4), m2) / dot(crossV(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  const diag = Math.hypot(w, h);
  // A phone's main camera sees about 0.62 of the photo's diagonal as its focal
  // length (26 mm equivalent). Use the measured one only when it's believable,
  // since with one vanishing point (a wall shot from the side) it can't be measured.
  let f2 = n2[2] * n3[2] !== 0 ? -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]) : NaN;
  const measured = f2 > 0 && Math.sqrt(f2) > 0.35 * diag && Math.sqrt(f2) < 2.5 * diag;
  if (!measured) f2 = (0.62 * diag) ** 2;
  const len = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  return { aspect: Math.sqrt(len(n2) / len(n3)), focal: measured ? Math.sqrt(f2) : null };
}

// ---------- Flattening ----------

// Pixels of the wall seen straight on: outW x outH, sampled from the photo with
// bilinear filtering. src: { data (RGBA), width, height }.
// Parts of the wall outside the photo (above its top edge, say) get `fill`, an RGB triple.
export function flatten(src, corners, outW, outH, fill = null) {
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width: sw, height: sh } = src;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [u, v] = apply(H, x + 0.5, y + 0.5);
      if (fill && (u < 0 || v < 0 || u > sw || v > sh)) {
        const o = (y * outW + x) * 4;
        out[o] = fill[0]; out[o + 1] = fill[1]; out[o + 2] = fill[2]; out[o + 3] = 255;
        continue;
      }
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(u - 0.5)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(v - 0.5)));
      const fx = Math.max(0, Math.min(1, u - 0.5 - x0)), fy = Math.max(0, Math.min(1, v - 0.5 - y0));
      const o = (y * outW + x) * 4;
      for (let k = 0; k < 3; k++) {
        const a = data[(y0 * sw + x0) * 4 + k], b = data[(y0 * sw + x0 + 1) * 4 + k];
        const c = data[((y0 + 1) * sw + x0) * 4 + k], d = data[((y0 + 1) * sw + x0 + 1) * 4 + k];
        out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

// ---------- Pieces already on the wall ----------

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

// Cover a rectangle (pixels, top-left origin) with the wall color around it, so a
// piece that moves in the new layout doesn't also show where it used to hang.
export function paintOut(img, r, ring = 6) {
  const { data, width, height } = img;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w)), y1 = Math.min(height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return img;
  // The wall just outside each edge, sampled along the whole edge (a median across
  // the ring, smoothed along it), so the light falloff across the patch matches
  // the wall around it instead of reading as a flat sticker.
  const px = (x, y, k) => data[(y * width + x) * 4 + k];
  const strip = (n, at) => {
    const out = [];
    for (let i = 0; i < n; i++) { const v = at(i); out.push(v); }
    return out;
  };
  const sampleAlong = (len, pick) => {
    // pick(i) -> list of [x, y] pixels across the ring at position i
    const raw = strip(len, (i) => {
      const pts = pick(i).filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height);
      if (!pts.length) return null;
      return [0, 1, 2].map((k) => med(pts.map(([x, y]) => px(x, y, k))));
    });
    if (raw.every((v) => !v)) return null;
    // Fill gaps, then a box blur along the edge.
    let last = raw.find(Boolean);
    const filled = raw.map((v) => (v ? (last = v) : last));
    const R = Math.max(2, Math.round(len / 20));
    return filled.map((_, i) => {
      const lo = Math.max(0, i - R), hi = Math.min(len - 1, i + R);
      const acc = [0, 0, 0];
      for (let j = lo; j <= hi; j++) for (let k = 0; k < 3; k++) acc[k] += filled[j][k];
      return acc.map((a) => a / (hi - lo + 1));
    });
  };
  const W = x1 - x0, H = y1 - y0;
  const ringPts = (fixed, along, horiz, dir) => { const out = []; for (let d = 1; d <= ring; d++) out.push(horiz ? [along, fixed + dir * d] : [fixed + dir * d, along]); return out; };
  const top = y0 > 0 ? sampleAlong(W, (i) => ringPts(y0 - 1, x0 + i, true, -1).map(([x, y]) => [x, y + 1])) : null;
  const bottom = y1 < height ? sampleAlong(W, (i) => ringPts(y1, x0 + i, true, 1).map(([x, y]) => [x, y - 1])) : null;
  const left = x0 > 0 ? sampleAlong(H, (i) => ringPts(x0 - 1, y0 + i, false, -1).map(([x, y]) => [x + 1, y])) : null;
  const right = x1 < width ? sampleAlong(H, (i) => ringPts(x1, y0 + i, false, 1).map(([x, y]) => [x - 1, y])) : null;
  if (!top && !bottom && !left && !right) return img;
  for (let y = y0; y < y1; y++) {
    const j = y - y0;
    for (let x = x0; x < x1; x++) {
      const i = x - x0;
      // Nearer edges count for more.
      const parts = [];
      if (top) parts.push([1 / (j + 1), top[i]]);
      if (bottom) parts.push([1 / (H - j), bottom[i]]);
      if (left) parts.push([1 / (i + 1), left[j]]);
      if (right) parts.push([1 / (W - i), right[j]]);
      const wsum = parts.reduce((s, [w]) => s + w, 0);
      const o = (y * width + x) * 4;
      const n = (((x * 73856093) ^ (y * 19349663)) & 3) - 1.5;
      for (let k = 0; k < 3; k++) data[o + k] = parts.reduce((s, [w, c]) => s + w * c[k], 0) / wsum + n;
    }
  }
  return img;
}

// Up to k colors of a picture as [{ hex, weight }], by k-means on its pixels.
export function palette(img, k = 5) {
  const { data } = img;
  const n = data.length / 4;
  const step = Math.max(1, Math.floor(n / 4000));
  const px = [];
  for (let i = 0; i < n; i += step) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  if (!px.length) return [];
  // Start from spread-out pixels, in a fixed order so the result is repeatable.
  let cs = [px[0]];
  while (cs.length < Math.min(k, px.length)) {
    let best = null, bd = -1;
    for (const p of px) {
      const d = Math.min(...cs.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2));
      if (d > bd) { bd = d; best = p; }
    }
    if (bd <= 0) break;
    cs.push(best);
  }
  let counts = [];
  for (let it = 0; it < 10; it++) {
    const sums = cs.map(() => [0, 0, 0]);
    counts = cs.map(() => 0);
    for (const p of px) {
      let j = 0, bd = Infinity;
      cs.forEach((c, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; j = i; } });
      counts[j]++; sums[j][0] += p[0]; sums[j][1] += p[1]; sums[j][2] += p[2];
    }
    cs = cs.map((c, i) => (counts[i] ? sums[i].map((s) => s / counts[i]) : c));
  }
  const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return cs.map((c, i) => ({ hex: hex(c), weight: counts[i] / px.length })).filter((c) => c.weight >= 0.03).sort((a, b) => b.weight - a.weight);
}

export function crop(img, r) {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const w = Math.max(1, Math.min(img.width - x0, Math.round(r.w))), h = Math.max(1, Math.min(img.height - y0, Math.round(r.h)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { data: out, width: w, height: h };
}

// How dark and how sharp a photo is, 0 to 1, for "hard to see the corners".
export function photoQuality(img) {
  const { data, width, height } = img;
  let sum = 0, edges = 0, n = 0;
  for (let y = 1; y < height - 1; y += 3) for (let x = 1; x < width - 1; x += 3) {
    const o = (y * width + x) * 4;
    const l = 0.3 * data[o] + 0.59 * data[o + 1] + 0.11 * data[o + 2];
    const r = 0.3 * data[o + 4] + 0.59 * data[o + 5] + 0.11 * data[o + 6];
    const d = 0.3 * data[o + width * 4] + 0.59 * data[o + width * 4 + 1] + 0.11 * data[o + width * 4 + 2];
    sum += l; edges += Math.abs(l - r) + Math.abs(l - d); n++;
  }
  return { brightness: sum / n / 255, sharpness: Math.min(1, edges / n / 40) };
}

// ---------- Browser helpers ----------

export const PX_PER_IN = 8; // flattened walls are drawn at 8 pixels an inch

// Load a File into image pixels, scaled so the long side is at most `max` px.
export function loadFile(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ ...cx.getImageData(0, 0, w, h), width: w, height: h, url: cv.toDataURL('image/jpeg', 0.8) });
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file won\'t open. Use a JPG, PNG or HEIC under 20 MB.')); };
    im.src = url;
  });
}

// Pixels to a JPEG data URL.
export function toDataUrl(img, quality = 0.8) {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return cv.toDataURL('image/jpeg', quality);
}

// A data URL back to pixels.
export function fromDataUrl(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
      resolve({ data: cx.getImageData(0, 0, cv.width, cv.height).data, width: cv.width, height: cv.height });
    };
    im.onerror = reject;
    im.src = url;
  });
}
