// Reading a wall photo without asking: where the floor is, what color the wall
// is, and what's in front of it (a TV, furniture, lamps) or hanging on it (art).
// Classic image analysis, no model: anything that isn't wall-colored is found as
// a blob, and its shape and position say what it is. Pure: pixels in, boxes out,
// so it runs in Node tests. Everything is in photo pixels, top-left origin.

const SMALL = 220; // detection runs on a copy about this wide

function toLab(r, g, b) {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function shrink(img, size = SMALL, longest = false) {
  const s = Math.min(1, size / (longest ? Math.max(img.width, img.height) : img.width));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const lab = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Average the block of source pixels, so noise doesn't read as edges.
      const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.floor((x + 1) / s));
      const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.floor((y + 1) / s));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < Math.min(img.height, y1); yy += 1) for (let xx = x0; xx < Math.min(img.width, x1); xx += 1) {
        const o = (yy * img.width + xx) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
      }
      const L = toLab(r / n, g / n, b / n);
      lab.set(L, (y * w + x) * 3);
    }
  }
  return { lab, w, h, s };
}

// Fit v = p0 + p1 x + p2 y by least squares over the given points.
function plane(pts, k) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, sxv = 0, syv = 0;
  for (const p of pts) { const v = p[2 + k]; n++; sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; syy += p[1] * p[1]; sxy += p[0] * p[1]; sv += v; sxv += p[0] * v; syv += p[1] * v; }
  const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], b = [sv, sxv, syv];
  // 3 x 3 solve (Cramer's rule is fine at this size).
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return [sv / Math.max(1, n), 0, 0];
  return [0, 1, 2].map((i) => det(M.map((row, r) => row.map((v, c) => (c === i ? b[r] : v)))) / D);
}

// The wall's color, allowing for light falling off across it: the most common
// light color on the wall, then a gentle gradient fit to it.
function wallModel(S) {
  const { lab, w, h } = S;
  const bins = new Map();
  // Coarse bins, so a wall that gets darker toward one side is still one color.
  // The image is the wall itself (cut to its corners), so its most common light
  // color is the wall's, whatever hangs on it or stands in front.
  const key = (L, a, b) => `${Math.round(L / 10)},${Math.round(a / 6)},${Math.round(b / 6)}`;
  const Y0 = Math.floor(h * 0.03), Y1 = Math.floor(h * 0.97);
  for (let y = Y0; y < Y1; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3; if (lab[o] < 30) continue;
    const k = key(lab[o], lab[o + 1], lab[o + 2]);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  if (!bins.size) bins.set(key(lab[0], lab[1], lab[2]), 1);
  const top = [...bins].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  // Refine the seed to the average of the pixels in that bin.
  let sL = 0, sA = 0, sB = 0, sn = 0;
  for (let y = Y0; y < Y1; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    if (key(lab[o], lab[o + 1], lab[o + 2]) === top.join(',')) { sL += lab[o]; sA += lab[o + 1]; sB += lab[o + 2]; sn++; }
  }
  const seed = [sL / sn, sA / sn, sB / sn];
  let pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    const d = Math.hypot(lab[o] - seed[0], (lab[o + 1] - seed[1]) * 1.5, (lab[o + 2] - seed[2]) * 1.5);
    if (d < 18) pts.push([x / w, y / h, lab[o], lab[o + 1], lab[o + 2]]);
  }
  let P = [0, 1, 2].map((k) => plane(pts, k));
  // One refit on the points that really follow the gradient.
  const at = (x, y) => P.map((p) => p[0] + p[1] * x + p[2] * y);
  pts = pts.filter((p) => { const m = at(p[0], p[1]); return Math.hypot(p[2] - m[0], (p[3] - m[1]) * 1.5, (p[4] - m[2]) * 1.5) < 9; });
  if (pts.length > 50) P = [0, 1, 2].map((k) => plane(pts, k));
  return { at: (x, y) => P.map((p) => p[0] + p[1] * (x / w) + p[2] * (y / h)), seed };
}

function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = comps.length;
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack.push(i); label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w, y = (j / w) | 0;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= w * h) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        if (mask[k] && label[k] < 0) { label[k] = id; stack.push(k); }
      }
    }
    comps.push({ id, n, x0, y0, x1, y1 });
  }
  return { comps, label };
}

// Fill holes: wall color enclosed by a single blob belongs to it (a white mat
// inside a black frame is still part of the piece). Wall that several things
// happen to surround (between a lamp, a stand and the floor) stays wall.
function fillHoles(mask, w, h) {
  const out = new Uint8Array(mask);
  const fg = components(mask, w, h);
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const holes = components(inv, w, h);
  const owner = new Map();
  for (let i = 0; i < w * h; i++) {
    if (!inv[i]) continue;
    const hid = holes.label[i];
    const x = i % w;
    if (x === 0 || x === w - 1 || i < w || i >= w * (h - 1)) { owner.set(hid, -2); continue; }
    for (const k of [i - 1, i + 1, i - w, i + w]) {
      if (!mask[k]) continue;
      const f = fg.label[k];
      const cur = owner.get(hid);
      if (cur === undefined) owner.set(hid, f);
      else if (cur !== f) owner.set(hid, -2);
    }
  }
  for (let i = 0; i < w * h; i++) if (inv[i] && owner.get(holes.label[i]) >= 0) out[i] = 1;
  return out;
}

function close(mask, w, h, r = 1) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) dil[Y * w + X] = 1;
    }
  }
  const ero = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let all = 1;
    for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && !dil[Y * w + X]) { all = 0; break; }
    }
    ero[y * w + x] = all;
  }
  return ero;
}

// ---------- Finding the wall in a photo ----------

// A line v = a + b t through points [t, v], fit by least squares and then refit
// without the points far from it. `inward` says which way things in front of the
// wall push the points (+1 or -1); those are dropped more readily.
function fitEdge(pts, inward = 0) {
  let use = pts.slice();
  let a = 0, b = 0;
  for (let round = 0; round < 6; round++) {
    if (use.length < 2) break;
    let n = 0, st = 0, sv = 0, stt = 0, stv = 0;
    for (const [t, v] of use) { n++; st += t; sv += v; stt += t * t; stv += t * v; }
    const den = n * stt - st * st;
    b = Math.abs(den) < 1e-9 ? 0 : (n * stv - st * sv) / den;
    a = (sv - b * st) / n;
    const res = pts.map(([t, v]) => [t, v, v - (a + b * t)]);
    const spread = Math.max(1, res.map((r) => Math.abs(r[2])).sort((x, y) => x - y)[Math.floor(res.length * 0.5)]);
    const keep = res.filter(([, , r]) => (inward && r * inward > 0 ? Math.abs(r) < Math.max(1.5, spread * (1.5 - round * 0.2)) : Math.abs(r) < Math.max(2, spread * 2.5)));
    if (keep.length < Math.max(3, pts.length * 0.2)) break;
    use = keep.map(([t, v]) => [t, v]);
  }
  return { a, b, n: use.length };
}

// Where y = a + b x (a row line) meets x = a + b y (a column line).
function meet(row, col) {
  const y = (row.a + row.b * col.a) / (1 - row.b * col.b);
  return [col.a + col.b * y, y];
}

// Straight lines through marked points, from a Hough vote. `across` picks lines
// that run left to right (true) or top to bottom (false), each as v = a + b t
// with t along the line. Steep slopes are left out: a wall seen from the front
// has edges close to level and close to upright.
function houghLines(pts, w, h, across, keep = 12) {
  const T = across ? w : h, V = across ? h : w, mid = T / 2;
  const slopes = [];
  for (let b = -0.32; b <= 0.32 + 1e-9; b += 0.008) slopes.push(b);
  const pad = Math.ceil(0.32 * mid) + 2, rows = V + 2 * pad;
  const acc = new Uint16Array(slopes.length * rows);
  for (let i = 0; i < w * h; i++) {
    if (!pts[i]) continue;
    const x = i % w, y = (i / w) | 0, t = across ? x : y, v = across ? y : x;
    for (let k = 0; k < slopes.length; k++) {
      const a = Math.round(v - slopes[k] * (t - mid)) + pad;
      if (a >= 0 && a < rows) acc[k * rows + a]++;
    }
  }
  const out = [];
  const order = [...acc.keys()].filter((j) => acc[j] > 2).sort((p, q) => acc[q] - acc[p]);
  const ends = (o) => [o.a + o.b * T * 0.2, o.a + o.b * T * 0.8];
  for (const j of order) {
    if (out.length >= keep) break;
    const k = Math.floor(j / rows), am = (j % rows) - pad;
    const ln = { votes: acc[j], a: am - slopes[k] * mid, b: slopes[k] };
    // The same edge votes for many nearby lines: keep one per edge.
    const [e0, e1] = ends(ln);
    if (out.some((o) => { const [f0, f1] = ends(o); return Math.abs(f0 - e0) <= 4 && Math.abs(f1 - e1) <= 4; })) continue;
    out.push(ln);
  }
  return out;
}

/**
 * Find the wall a photo is of: its four corners, where it meets the ceiling,
 * the side walls and the floor. Candidate edges come from straight lines in the
 * photo; an edge counts where the wall's color is on the inside of it and
 * something different is on the outside, so the bottom of a frame or the top of
 * a soffit doesn't. The floor is mostly hidden, so it's the lowest line the wall
 * reaches. Edges that run off the photo are put at the photo's edge.
 * Returns { corners: [tl, tr, br, bl] in photo pixels, ceiling, floor, sides: [left, right] },
 * each flag true when that edge was seen in the photo.
 */
export function findWall(img, opts = {}) {
  const S = shrink(img, 320, true);
  const { lab, w, h, s } = S;
  const L = new Float32Array(w * h);
  // A light blur, so texture and noise don't read as edges.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) { t += lab[(Y * w + X) * 3]; n++; } }
    L[y * w + x] = t / n;
  }
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    gx[i] = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1]) / 4;
    gy[i] = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]) / 4;
    mag[i] = Math.hypot(gx[i], gy[i]);
  }
  // A screenshot can have black bars around the photo: they aren't part of it.
  const barRow = (y) => { for (let x = 0; x < w; x += 2) if (L[y * w + x] > 6) return false; return true; };
  const barCol = (x) => { for (let y = 0; y < h; y += 2) if (L[y * w + x] > 6) return false; return true; };
  let by0 = 0, by1 = h - 1, bx0 = 0, bx1 = w - 1;
  while (by0 < h / 3 && barRow(by0)) by0++;
  while (by1 > (h * 2) / 3 && barRow(by1)) by1--;
  while (bx0 < w / 3 && barCol(bx0)) bx0++;
  while (bx1 > (w * 2) / 3 && barCol(bx1)) bx1--;
  // The wall's color: the most common light color in the middle of the photo.
  const key = (i) => `${Math.round(lab[i * 3] / 8)},${Math.round(lab[i * 3 + 1] / 5)},${Math.round(lab[i * 3 + 2] / 5)}`;
  const win = [];
  for (let y = Math.floor(h * 0.25); y < Math.ceil(h * 0.7); y++) for (let x = Math.floor(w * 0.2); x < Math.ceil(w * 0.8); x++) if (lab[(y * w + x) * 3] > 35) win.push(y * w + x);
  const whole = { corners: [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]], ceiling: false, floor: false, sides: [false, false] };
  if (!win.length) return whole;
  const bins = new Map();
  for (const i of win) { const k = key(i); bins.set(k, (bins.get(k) || 0) + 1); }
  const topBin = [...bins].sort((p, q) => q[1] - p[1])[0][0];
  const seedPx = win.filter((i) => key(i) === topBin);
  const seed = [0, 1, 2].map((k) => seedPx.reduce((t, i) => t + lab[i * 3 + k], 0) / seedPx.length);
  const cx = seedPx.reduce((t, i) => t + (i % w), 0) / seedPx.length, cy = seedPx.reduce((t, i) => t + Math.floor(i / w), 0) / seedPx.length;
  const px = (x, y) => { const X = Math.max(0, Math.min(w - 1, Math.round(x))), Y = Math.max(0, Math.min(h - 1, Math.round(y))); return Y * w + X; };
  const col = (i) => [L[i], lab[i * 3 + 1], lab[i * 3 + 2]];
  // Wall-colored allows for light falling off across the wall; different means a clear step.
  const wallish = (c) => Math.hypot((c[0] - seed[0]) * 0.5, (c[1] - seed[1]) * 1.5, (c[2] - seed[2]) * 1.5) < 12;
  const differ = (p, q) => Math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.5, (p[2] - q[2]) * 1.5) > 7;
  const OFF = Math.max(2, Math.round(Math.max(w, h) / 110));
  // Edge points of the wall, one map per side: wall color on the inside, a clear
  // step to something else on the outside. A frame's right edge passes the left
  // test too, but only for the frame's height; the wall's own edge runs its length.
  const marks = (dx, dy) => {
    const m = new Uint8Array(w * h);
    for (let y = OFF; y < h - OFF; y++) for (let x = OFF; x < w - OFF; x++) {
      const i = y * w + x;
      if (mag[i] < 2.5) continue;
      if (dx ? Math.abs(gx[i]) < Math.abs(gy[i]) : Math.abs(gy[i]) < Math.abs(gx[i])) continue;
      const ci = col(i + (dy * w + dx) * OFF), co = col(i - (dy * w + dx) * OFF);
      if (wallish(ci) && differ(ci, co)) m[i] = 1;
    }
    return m;
  };
  // Beyond the wall's real edge there's little of the wall's color all the way to
  // the photo's edge (a soffit, the ceiling, the next wall). Beyond the bottom of a
  // frame there's the frame, and then wall again.
  const beyond = (c, side, lo, hi) => {
    let n = 0, wl = 0;
    for (let t = Math.max(0, Math.ceil(lo)); t <= Math.min(w - 1, hi); t += 2) {
      const v = c.a + c.b * t;
      if (v < 0 || v >= h) continue;
      const ci = col(px(t, v - side * OFF));
      const from = side < 0 ? 0 : Math.ceil(v + OFF), to = side < 0 ? Math.floor(v - OFF) : h - 1;
      for (let u = from; u <= to; u += 2) { n++; if (!differ(ci, col(px(t, u)))) wl++; }
    }
    return n ? wl / n : 0;
  };
  const best = (lines, side, at, mid, min, ok = () => true) => lines
    .filter((c) => (side < 0 ? c.a + c.b * at < mid - 4 : c.a + c.b * at > mid + 4) && c.votes >= min && ok(c))
    .sort((p, q) => q.votes - p.votes)[0] || null;
  const Lf = best(houghLines(marks(1, 0), w, h, false), -1, cy, cx, h * 0.16);
  const Rf = best(houghLines(marks(-1, 0), w, h, false), 1, cy, cx, h * 0.16);
  const lo = Lf ? Lf.a + Lf.b * cy : 0, hi = Rf ? Rf.a + Rf.b * cy : w - 1;
  // A ceiling or a soffit is painted, light and about the wall's tint; the bottom
  // of a row of frames is a frame (often black) or a print.
  const topMarks = marks(0, 1);
  const painted = (c) => {
    let n = 0, ok = 0;
    for (let t = Math.max(0, Math.ceil(lo)); t <= Math.min(w - 1, hi); t++) {
      const v = Math.round(c.a + c.b * t);
      if (v < OFF || v >= h - OFF || !(topMarks[v * w + t] || topMarks[Math.max(0, v - 1) * w + t] || topMarks[Math.min(h - 1, v + 1) * w + t])) continue;
      const co = col(px(t, v - OFF));
      n++; if (co[0] > 45 && Math.abs(co[1] - seed[1]) < 8 && Math.abs(co[2] - seed[2]) < 10) ok++;
    }
    return n ? ok / n : 0;
  };
  const T0 = best(houghLines(topMarks, w, h, true), -1, cx, cy, (hi - lo) * 0.55, (c) => beyond(c, -1, lo, hi) < 0.3 && painted(c) > 0.6);
  const floorLines = houghLines(marks(0, -1), w, h, true, 30);
  const top = T0 || { a: by0, b: 0 }, left = Lf || { a: bx0, b: 0 }, right = Rf || { a: bx1, b: 0 };
  // Grow the wall inside the lines found so far, then read the floor off it:
  // in each column, the lowest wall pixel. Furniture pushes that up; the floor is
  // the line along the lowest of them.
  const inside = (x, y) => y >= top.a + top.b * x + 1 && x >= left.a + left.b * y + 1 && x <= right.a + right.b * y - 1;
  const M = new Uint8Array(w * h);
  const queue = [];
  for (const i of seedPx) { if (inside(i % w, Math.floor(i / w))) { M[i] = 1; queue.push(i); } }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || M[j]) continue;
      const X = j % w, Y = (j / w) | 0;
      if (!inside(X, Y) || !wallish(col(j)) || differ(col(i), col(j))) continue;
      M[j] = 1; queue.push(j);
    }
  }
  const lows = [];
  for (let x = 0; x < w; x++) { for (let y = h - 1; y >= 0; y--) if (M[y * w + x]) { lows.push([x, y]); break; } }
  const atBottom = lows.filter(([, y]) => y >= by1 - 1).length;
  const floor = atBottom < lows.length * 0.3;
  let bottom = { a: by1, b: 0 };
  if (floor && lows.length) {
    // The lowest stretch of wall, kept about as level as the top edge.
    const rel = lows.map(([x, y]) => y - top.b * x).sort((p, q) => q - p);
    const env = { a: rel[Math.min(rel.length - 1, Math.floor(rel.length * 0.02))], b: top.b };
    // A floor line in the photo close to that is better than the estimate.
    const envAt = env.a + env.b * cx;
    const snap = floorLines.filter((c) => Math.abs(c.b - top.b) < 0.025 && c.a + c.b * cx >= envAt - 2 && c.a + c.b * cx - envAt < h * 0.035 && c.votes >= w * 0.03).sort((p, q) => q.votes - p.votes)[0];
    bottom = snap || env;
  }
  const up = (p) => [Math.max(0, Math.min(img.width, p[0] / s)), Math.max(0, Math.min(img.height, p[1] / s))];
  const corners = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)].map(up);
  if (opts.debug) opts.debug.find = { w, h, wall: marks(1, 0), M, seed, lines: { top, bottom, left, right } };
  return { corners, ceiling: !!T0, floor, sides: [!!Lf, !!Rf] };
}

// The largest rectangle of marked pixels whose width over height is in [lo, hi]
// (the histogram method, row by row). Returns { x0, y0, x1, y1 } or null.
function bestRect(mask, w, h, lo, hi, minArea) {
  const hts = new Int32Array(w);
  let best = null, bestA = minArea;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hts[x] = mask[y * w + x] ? hts[x] + 1 : 0;
    const st = [];
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hts[x] : 0;
      let start = x;
      while (st.length && st[st.length - 1][1] >= cur) {
        const [sx, sh] = st.pop();
        // Every height from this bar's down to the next one is a candidate.
        const floorH = Math.max(cur, st.length ? st[st.length - 1][1] : 0);
        const rw = x - sx;
        for (const rh of [sh, Math.max(1, floorH + 1), Math.round(rw / ((lo + hi) / 2))]) {
          if (rh < 1 || rh > sh) continue;
          const ar = rw / rh;
          if (ar >= lo && ar <= hi && rw * rh > bestA) { bestA = rw * rh; best = { x0: sx, x1: x - 1, y0: y - rh + 1, y1: y }; }
          // Too wide for its height: the best part of it is a narrower slice.
          if (ar > hi) { const ww = Math.floor(rh * hi); if (ww * rh > bestA) { bestA = ww * rh; best = { x0: sx, x1: sx + ww - 1, y0: y - rh + 1, y1: y }; } }
        }
        start = sx;
      }
      st.push([start, cur]);
    }
  }
  return best;
}

/**
 * Read a flattened wall: the photo of one wall, already cut to its four corners
 * and seen straight on, so the wall fills it and the floor is its bottom edge.
 * img: { data (RGBA), width, height }.
 * Returns { wallColor: [L, a, b], items: [{ kind, x, y, w, h, confidence, alone? }] }
 * with kinds 'art', 'tv', 'furniture' and 'lamp', in the image's pixels. A TV
 * with `alone` was found clear of everything else, so its size can set the scale.
 */
export function readWall(img, opts = {}) {
  const S = shrink(img);
  const { lab, w, h, s } = S;
  const model = wallModel(S);
  const diff = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3; const m = model.at(x, y);
    diff[y * w + x] = Math.hypot(lab[o] - m[0], (lab[o + 1] - m[1]) * 1.4, (lab[o + 2] - m[2]) * 1.4);
  }
  // The floor is the image's bottom edge: the corners put it there.
  const floorY = h - 1;
  // Everything that isn't wall.
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) fg[i] = diff[i] >= 14 ? 1 : 0;
  const solid = fillHoles(close(fg, w, h, 1), w, h);
  // Without the closing, pieces hung close together stay apart.
  const loose = fillHoles(fg, w, h);
  // A thin ring at the sides and top keeps the next wall or a soffit, if the
  // corners were set a little wide, from joining everything up.
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) solid[y * w + x] = 0;
  for (let x = 0; x < w; x++) solid[x] = 0;
  const { comps, label } = components(solid, w, h);

  // A TV is the biggest very dark rectangle about 16:9. Its stand is often dark
  // too and joined to it; the rectangle stops where the screen does.
  const darkRaw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) darkRaw[i] = lab[i * 3] < 30 ? 1 : 0;
  const dark = fillHoles(close(darkRaw, w, h, 1), w, h);
  let tv = null;
  const r = bestRect(dark, w, h, 1.25, 2.6, w * h * 0.015);
  // A framed print has a dark ring that fills in like a screen; a screen is dark through.
  const rawFill = (q) => { let n = 0; for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) n += darkRaw[y * w + x]; return n / ((q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1)); };
  if (r && r.x1 - r.x0 + 1 >= w * 0.12 && r.y1 < floorY - 2 && rawFill(r) > 0.7) {
    // Grow it back out to the screen's edges where the rectangle stopped a pixel short.
    const rowDark = (y, x0, x1) => { let n = 0; for (let x = x0; x <= x1; x++) n += dark[y * w + x]; return n / (x1 - x0 + 1); };
    const colDark = (x, y0, y1) => { let n = 0; for (let y = y0; y <= y1; y++) n += dark[y * w + x]; return n / (y1 - y0 + 1); };
    let { x0, x1, y0, y1 } = r;
    while (y0 > 0 && rowDark(y0 - 1, x0, x1) > 0.9) y0--;
    while (x0 > 0 && colDark(x0 - 1, y0, y1) > 0.9) x0--;
    while (x1 < w - 1 && colDark(x1 + 1, y0, y1) > 0.9) x1++;
    while (y1 < floorY - 1 && rowDark(y1 + 1, x0, x1) > 0.9) y1++;
    // On its own: wall, not more dark, just past its top, left and right edges.
    const clear = (vals) => vals.filter((v) => v < 0.5).length / vals.length;
    const side = (x) => { const v = []; for (let y = y0; y <= y1; y++) v.push(dark[y * w + Math.max(0, Math.min(w - 1, x))]); return v; };
    // A screen is about 16:9. Taller than that, and the rest below is its stand or
    // a soundbar (the top edge, against the wall, is the one to trust).
    const clearTop = (() => { let n = 0; for (let x = x0; x <= x1; x++) n += darkRaw[Math.max(0, y0 - 3) * w + x]; return n / (x1 - x0 + 1) < 0.35; })();
    if (clearTop && (x1 - x0 + 1) / (y1 - y0 + 1) < 1.6) y1 = Math.min(y1, y0 + Math.round((x1 - x0 + 1) / 1.74));
    const ar = (x1 - x0 + 1) / (y1 - y0 + 1);
    // A plant or a speaker touching one side doesn't change the screen's width.
    const alone = (clear(side(x0 - 2)) > 0.8 || clear(side(x1 + 2)) > 0.8) && clearTop && ar > 1.5 && ar < 2.05;
    tv = { x0, y0, x1, y1, alone };
  }

  const items = [];
  const area = w * h;
  if (tv) items.push({ kind: 'tv', box: [tv.x0, tv.y0, tv.x1, tv.y1], confidence: tv.alone ? 0.85 : 0.6, alone: tv.alone });
  // What hangs on the wall: blobs that don't reach the floor, solid and roughly rectangular.
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (c.n < area * 0.004) continue;
    const fill = c.n / (bw * bh);
    const touchesFloor = c.y1 >= floorY - Math.max(2, h * 0.03);
    const touchesEdge = c.x0 <= 1 || c.x1 >= w - 2;
    if (tv && c.x0 >= tv.x0 - 3 && c.x1 <= tv.x1 + 3 && c.y0 >= tv.y0 - 3 && c.y1 <= tv.y1 + 3) continue; // the TV itself
    if (tv && c.x0 < tv.x1 && c.x1 > tv.x0 && c.y0 < tv.y1 && c.y1 > tv.y0) continue; // joined to the TV
    if (touchesFloor || touchesEdge) continue;
    const isArt = (q, f) => f > 0.72 && (q.x1 - q.x0 + 1) / (q.y1 - q.y0 + 1) > 0.3 && (q.x1 - q.x0 + 1) / (q.y1 - q.y0 + 1) < 3.2 && q.x1 - q.x0 + 1 > w * 0.04 && q.y1 - q.y0 + 1 > h * 0.05;
    if (isArt(c, fill)) { items.push({ kind: 'art', box: [c.x0, c.y0, c.x1, c.y1], confidence: Math.min(0.95, fill) }); continue; }
    // Not one rectangle: maybe a few pieces that touched. Look again without the closing.
    const sub = new Uint8Array(w * h);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) sub[y * w + x] = label[y * w + x] === c.id ? loose[y * w + x] : 0;
    for (const p of components(sub, w, h).comps) {
      if (p.n < area * 0.004) continue;
      const f = p.n / ((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1));
      if (isArt(p, f)) items.push({ kind: 'art', box: [p.x0, p.y0, p.x1, p.y1], confidence: Math.min(0.9, f) });
    }
  }

  // What stands on the floor: follow the skyline of everything that reaches the
  // floor, column by column, and cut it where the height jumps. A long flat run
  // is furniture; a tall narrow one is a lamp or a plant.
  const sky = new Array(w).fill(floorY);
  for (let x = 0; x < w; x++) {
    let y = floorY + 1, gap = 0;
    while (y > 0 && gap <= 2) { y--; if (solid[y * w + x]) { sky[x] = y; gap = 0; } else gap++; }
    if (tv && x >= tv.x0 && x <= tv.x1 && sky[x] <= tv.y1) sky[x] = Math.min(floorY, tv.y1 + 1); // stop at the TV's bottom
  }
  const height = sky.map((y) => floorY - y);
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const smooth = height.map((_, x) => med(height.slice(Math.max(0, x - 2), x + 3)));
  const segs = [];
  let cur = null;
  const minH = h * 0.04;
  for (let x = 0; x < w; x++) {
    const v = smooth[x];
    if (v < minH) { if (cur) { segs.push(cur); cur = null; } continue; }
    if (cur) {
      const m = med(cur.hs);
      if (Math.abs(v - m) > Math.max(h * 0.05, 0.3 * m)) { segs.push(cur); cur = null; }
    }
    if (!cur) cur = { x0: x, hs: [] };
    cur.x1 = x; cur.hs.push(v);
  }
  if (cur) segs.push(cur);
  // Short slivers join the neighbor they touch.
  const kept = [];
  for (const sg of segs) {
    const width = sg.x1 - sg.x0 + 1;
    const prev = kept[kept.length - 1];
    if (width < w * 0.025 && prev && prev.x1 >= sg.x0 - 1) { prev.x1 = sg.x1; prev.hs.push(...sg.hs); continue; }
    kept.push(sg);
  }
  // A thin sliver next to something wider and about as tall is part of it (a stand's end, a leg).
  for (let i = 0; i < kept.length; i++) {
    const sg = kept[i], width = sg.x1 - sg.x0 + 1, m = med(sg.hs);
    if (width >= w * 0.06) continue;
    const nb = [kept[i - 1], kept[i + 1]].filter((n) => n && (n.x1 === sg.x0 - 1 || n.x0 === sg.x1 + 1) && n.x1 - n.x0 + 1 >= w * 0.06 && m <= med(n.hs) * 1.35);
    if (!nb.length) continue;
    const n = nb[0];
    n.x0 = Math.min(n.x0, sg.x0); n.x1 = Math.max(n.x1, sg.x1);
    kept.splice(i, 1); i--;
  }
  if (opts.debug) opts.debug.segs = kept.map((k) => [k.x0, k.x1, Math.max(...k.hs)]);
  const tops = kept.map((sg) => Math.max(...sg.hs.slice().sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(sg.hs.length * 0.85))))); // ignore a spike or two
  const kindOf = (sg, top) => ((sg.x1 - sg.x0 + 1) / top < 0.7 ? 'lamp' : 'furniture');
  const floorItems = [];
  for (let i = 0; i < kept.length; i++) {
    const sg = kept[i], top = tops[i], width = sg.x1 - sg.x0 + 1;
    // A floor lamp's pole can be a pixel or two wide here; it's still a lamp if it's tall.
    if (top < h * 0.05 || (width < w * 0.025 && top < h * 0.35)) continue;
    const kind = kindOf(sg, top);
    // Low things (a basket, a stand's foot) never reach the art, so they don't matter.
    if (kind === 'lamp' && top < h * 0.22) continue;
    if (kind === 'furniture' && top < h * 0.12) continue;
    floorItems.push({ kind, sg, top, x0: sg.x0, x1: sg.x1 });
  }
  // A vase or a plant standing on furniture moves with a hand, so it isn't marked:
  // something narrow next to furniture that rises only a little above it.
  // The furniture runs on under it.
  for (let i = 0; i < floorItems.length; i++) {
    const it = floorItems[i];
    if (it.kind !== 'lamp') continue;
    const nb = floorItems.find((f) => f.kind === 'furniture' && (f.x1 >= it.x0 - 2 && f.x0 <= it.x1 + 2));
    if (!nb || it.top - nb.top > h * 0.33) continue;
    nb.x0 = Math.min(nb.x0, it.x0); nb.x1 = Math.max(nb.x1, it.x1);
    floorItems.splice(i, 1); i--;
  }
  // Furniture also runs on behind a lamp in front of its end: follow its top edge.
  for (const f of floorItems.filter((x) => x.kind === 'furniture')) {
    const yTop = floorY - f.top;
    const solidNear = (x) => { for (let y = Math.max(0, yTop - 1); y <= Math.min(floorY, yTop + 3); y++) if (solid[y * w + x]) return true; return false; };
    while (f.x1 < w - 2 && solidNear(f.x1 + 1) && solidNear(Math.min(w - 1, f.x1 + 2))) f.x1++;
    while (f.x0 > 1 && solidNear(f.x0 - 1) && solidNear(Math.max(0, f.x0 - 2))) f.x0--;
  }
  for (const it of floorItems) {
    const box = [it.x0, floorY - it.top, it.x1, floorY];
    if (it.kind === 'lamp') {
      // The shade: often close to the wall's color, so look a little harder near
      // the top of the pole for the patch that isn't quite wall.
      const pw = it.x1 - it.x0 + 1, reach = Math.round(pw * 2.5 + w * 0.05);
      const X0 = Math.max(0, it.x0 - reach), X1 = Math.min(w - 1, it.x1 + reach), Y1 = Math.min(floorY, Math.round(box[1] + it.top * 0.45));
      const Y0 = Math.max(0, Math.round(box[1] - it.top * 0.4)); // a shade is never more than about a third of the lamp
      const seen = new Uint8Array(w * h), q = [];
      for (let x = it.x0; x <= it.x1; x++) for (let y = box[1]; y <= Math.min(floorY, box[1] + 3); y++) if (solid[y * w + x]) { seen[y * w + x] = 1; q.push(y * w + x); }
      for (let k = 0; k < q.length; k++) {
        const j = q[k], x = j % w, y = (j / w) | 0;
        for (const n of [x > X0 ? j - 1 : -1, x < X1 ? j + 1 : -1, y > Y0 ? j - w : -1, y < Y1 ? j + w : -1]) {
          if (n < 0 || seen[n] || diff[n] < 7) continue;
          seen[n] = 1; q.push(n);
        }
      }
      // A shade is a wide band; a thin strip running on up (a shadow in the corner) isn't part of it.
      // Only the lamp's upper part counts, so furniture next to its foot doesn't widen it.
      const headEnd = Math.min(floorY, Math.round(box[1] + it.top * 0.35));
      const rows = new Map();
      for (const j of q) { const y = (j / w) | 0; if (y <= headEnd && y >= 3) rows.set(y, (rows.get(y) || 0) + 1); } // not the photo's top edge
      const widest = Math.max(0, ...rows.values());
      // Walk up from the pole's top while the band stays wide; a neck means the
      // shade has ended and what's above is something else (a shadow in the corner).
      let hy0 = box[1];
      while (hy0 - 1 >= Y0 && (rows.get(hy0 - 1) || 0) >= Math.max(3, widest * 0.5)) hy0--;
      let hx0 = box[0], hx1 = box[2];
      for (const j of q) { const x = j % w, y = (j / w) | 0; if (y >= hy0 && y <= headEnd && (rows.get(y) || 0) >= widest * 0.5) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; } }
      if (hx1 - hx0 + 1 <= w * 0.3) { box[0] = hx0; box[2] = hx1; box[1] = hy0; }
    }
    items.push({ kind: it.kind, box, confidence: 0.6 });
  }

  const up = (v) => v / s;
  if (opts.debug) opts.debug.out = { w, h, wallLike: fg.map((v) => 1 - v), solid, dark, floorY, seed: model.seed };
  return {
    wallColor: model.at(w / 2, h * 0.3),
    items: items.map((it) => ({ kind: it.kind, confidence: it.confidence, ...(it.kind === 'tv' ? { alone: it.alone } : {}), x: up(it.box[0]), y: up(it.box[1]), w: up(it.box[2] - it.box[0] + 1), h: up(it.box[3] - it.box[1] + 1) })),
  };
}

// Lab back to an sRGB triple, for filling wall beyond the photo.
export function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const gam = (c) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return [gam(r), gam(g), gam(bl)];
}

// TV sizes (the diagonal, in inches) and how wide each set is, bezel included.
export const TV_SIZES = [[43, 38], [50, 44], [55, 48.5], [65, 57.25], [75, 66]];

// A first guess at the wall's width, in inches, from a TV found on its own: its
// width against the wall's. A 55 in set unless the person says otherwise. With
// no TV clear of everything else there is no honest guess, so it's null and the
// person gives one measurement.
export function guessWidth(items, wallWidthPx, tvInches = 55) {
  const tv = items.find((i) => i.kind === 'tv' && i.alone);
  if (!tv) return null;
  const set = TV_SIZES.find(([d]) => d === tvInches) || TV_SIZES[2];
  return { inches: Math.round((wallWidthPx / tv.w) * set[1]), from: 'tv', tvInches: set[0] };
}
