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

function shrink(img) {
  const s = Math.min(1, SMALL / img.width);
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
// color in the middle band of the photo, then a gentle gradient fit to it.
function wallModel(S) {
  const { lab, w, h } = S;
  const bins = new Map();
  // Coarse bins, so a wall that gets darker toward one side is still one color.
  // The top third of a wall photo is almost always wall.
  const key = (L, a, b) => `${Math.round(L / 10)},${Math.round(a / 6)},${Math.round(b / 6)}`;
  for (let y = Math.floor(h * 0.03); y < Math.floor(h * 0.33); y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3; const k = key(lab[o], lab[o + 1], lab[o + 2]);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  const top = [...bins].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  // Refine the seed to the average of the pixels in that bin.
  let sL = 0, sA = 0, sB = 0, sn = 0;
  for (let y = Math.floor(h * 0.03); y < Math.floor(h * 0.33); y++) for (let x = 0; x < w; x++) {
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

/**
 * Read a photo of a wall. img: { data (RGBA), width, height }.
 * Returns { floorY, wallColor: [L, a, b], items: [{ kind, x, y, w, h, confidence }] }
 * with kinds 'art', 'tv', 'furniture' and 'lamp', in photo pixels.
 */
export function readWall(img, opts = {}) {
  const S = shrink(img);
  const { lab, w, h, s } = S;
  const model = wallModel(S);
  const diff = new Float32Array(w * h);
  const wallLike = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3; const m = model.at(x, y);
    const d = Math.hypot(lab[o] - m[0], (lab[o + 1] - m[1]) * 1.4, (lab[o + 2] - m[2]) * 1.4);
    diff[y * w + x] = d;
    wallLike[y * w + x] = d < 10 ? 1 : 0;
  }

  // The floor: in each column, the lowest wall pixel in a run of wall. Columns
  // with furniture in front stop higher up, so the floor is where most open
  // columns stop.
  const lows = [];
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = h - 1; y >= 0; y--) {
      if (wallLike[y * w + x]) { run++; if (run >= 3) { lows.push(y + 2); break; } } else run = 0;
    }
  }
  lows.sort((a, b) => a - b);
  let floorY = lows.length ? lows[Math.floor(lows.length * 0.85)] : h - 1;
  if (floorY < h * 0.45) floorY = h - 1; // no believable floor line: use the photo's bottom
  floorY = Math.min(h - 1, floorY);

  // Everything that isn't wall, above the floor.
  const fg = new Uint8Array(w * h);
  for (let y = 0; y <= floorY; y++) for (let x = 0; x < w; x++) fg[y * w + x] = diff[y * w + x] >= 14 ? 1 : 0;
  const solid = fillHoles(close(fg, w, h, 1), w, h);
  // Keep the floor row out, so everything standing on it isn't one blob with the floor,
  // and a thin ring at the photo's edge (door frames, the next wall) from joining everything up.
  for (let x = 0; x < w; x++) for (let y = floorY + 1; y < h; y++) solid[y * w + x] = 0;
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) solid[y * w + x] = 0;
  for (let x = 0; x < w; x++) for (const y of [0, 1]) solid[y * w + x] = 0;
  const { comps, label } = components(solid, w, h);

  // A TV is a big, very dark, filled rectangle, wider than tall. Its stand is often
  // dark too and joins it, so find the TV as the top block of wide dark rows.
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = lab[i * 3] < 26 && solid[i] ? 1 : 0;
  const dc = components(close(dark, w, h, 1), w, h);
  let tv = null;
  for (const c of dc.comps.sort((a, b) => b.n - a.n).slice(0, 4)) {
    const rows = [];
    for (let y = c.y0; y <= c.y1; y++) { let n = 0, lo = w, hi = -1; for (let x = c.x0; x <= c.x1; x++) if (dc.label[y * w + x] === c.id) { n++; if (x < lo) lo = x; if (x > hi) hi = x; } rows.push({ y, n, lo, hi }); }
    // The longest run of rows that share the same left and right edges and are
    // nearly solid between them: that's a screen.
    let best = null;
    const tol = Math.max(2, w * 0.03);
    for (let i = 0; i < rows.length; i++) {
      const r0 = rows[i];
      if (r0.hi - r0.lo + 1 < w * 0.14 || r0.n < 0.75 * (r0.hi - r0.lo + 1)) continue;
      // A few odd rows (a reflection, a stand leg) don't end the screen.
      let j = i, miss = 0, k = i;
      while (k + 1 < rows.length && miss <= 4) {
        const r = rows[++k];
        const ok = r.n >= 0.6 * (r0.hi - r0.lo + 1) && r.lo <= r0.lo + tol && r.hi >= r0.hi - tol && r.lo >= r0.lo - 2 * tol && r.hi <= r0.hi + 2 * tol;
        if (ok) { j = k; miss = 0; } else miss++;
      }
      if (!best || j - i > best.j - best.i) best = { i, j };
      i = j;
    }
    if (opts.debug) (opts.debug.tv = opts.debug.tv || []).push({ c: [c.x0, c.y0, c.x1, c.y1, c.n], best: best && [rows[best.i], rows[best.j]] });
    if (!best) continue;
    const block = rows.slice(best.i, best.j + 1);
    const x0 = Math.min(...block.map((r) => r.lo)), x1 = Math.max(...block.map((r) => r.hi));
    const y0 = block[0].y, y1 = block[block.length - 1].y;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const fill = block.reduce((t, r) => t + r.n, 0) / (bw * bh);
    if (bw / bh > 1.2 && bw / bh < 2.8 && fill > 0.65 && y1 < floorY - 2) { tv = { x0, y0, x1, y1 }; break; }
  }

  const items = [];
  const area = w * h;
  if (tv) items.push({ kind: 'tv', box: [tv.x0, tv.y0, tv.x1, tv.y1], confidence: 0.8 });
  // What hangs on the wall: blobs that don't reach the floor, solid and roughly rectangular.
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (c.n < area * 0.004) continue;
    const fill = c.n / (bw * bh);
    const touchesFloor = c.y1 >= floorY - Math.max(2, h * 0.03);
    const touchesEdge = c.x0 <= 2 || c.x1 >= w - 3;
    if (tv && c.x0 >= tv.x0 - 2 && c.x1 <= tv.x1 + 2 && c.y0 >= tv.y0 - 2 && c.y1 <= tv.y1 + 2) continue; // the TV itself
    if (!touchesFloor && !touchesEdge && fill > 0.72 && bw / bh > 0.3 && bw / bh < 3.2 && bw > w * 0.04 && bh > h * 0.05) {
      items.push({ kind: 'art', box: [c.x0, c.y0, c.x1, c.y1], confidence: Math.min(0.95, fill) });
    }
  }

  // What stands on the floor: follow the skyline of everything that reaches the
  // floor, column by column, and cut it where the height jumps. A long flat run
  // is furniture; a tall narrow one is a lamp or a plant.
  const sky = new Array(w).fill(floorY);
  for (let x = 0; x < w; x++) {
    let y = floorY, gap = 0;
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
  for (const sg of kept) {
    const width = sg.x1 - sg.x0 + 1;
    const top = Math.max(...sg.hs.slice().sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(sg.hs.length * 0.85)))); // ignore a spike or two
    if (width < w * 0.025 || top < h * 0.05) continue;
    const box = [sg.x0, floorY - top, sg.x1, floorY];
    const kind = width / top < 0.7 ? 'lamp' : 'furniture';
    // Low things (a basket, a stand's foot) never reach the art, so they don't matter.
    if (kind === 'lamp' && top < h * 0.22) continue;
    if (kind === 'furniture' && top < h * 0.12) continue;
    items.push({ kind, box, confidence: 0.6 });
  }

  const up = (v) => v / s;
  if (opts.debug) opts.debug.out = { w, h, wallLike, solid, dark, floorY, seed: model.seed };
  return {
    floorY: Math.round(up(floorY + 1)),
    wallColor: model.at(w / 2, h * 0.3),
    items: items.map((it) => ({ kind: it.kind, confidence: it.confidence, x: up(it.box[0]), y: up(it.box[1]), w: up(it.box[2] - it.box[0] + 1), h: up(it.box[3] - it.box[1] + 1) })),
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

// A first guess at the wall's width, in inches, from what's in front of it:
// a TV is most often a 55 in set (48 in wide), furniture wide enough to anchor
// art is most often a 72 to 84 in couch or console. Otherwise about 10 ft.
export function guessWidth(items, photoWidth) {
  const tv = items.find((i) => i.kind === 'tv');
  if (tv) return { inches: Math.round((photoWidth / tv.w) * 48.5), from: 'tv' };
  const f = items.filter((i) => i.kind === 'furniture').sort((a, b) => b.w - a.w)[0];
  if (f) return { inches: Math.round((photoWidth / f.w) * 76), from: 'furniture' };
  return { inches: 120, from: 'default' };
}
