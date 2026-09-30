// Color helpers: hex to CIELAB, CIEDE2000 distance, palette similarity,
// hue families and plain color names for the reasons.

export function hexToRgb(hex) {
  const raw = String(hex).trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new TypeError(`Not a hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const labCache = new Map();

export function hexToLab(hex) {
  const key = String(hex).toLowerCase();
  if (labCache.has(key)) return labCache.get(key);
  const [r, g, b] = hexToRgb(hex).map(linear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  const lab = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  labCache.set(key, lab);
  return lab;
}

export function lch([L, a, b]) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

// CIEDE2000, following Sharma, Wu and Dalal (2005).
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (b === 0 && a === 0) return 0;
    const t = Math.atan2(b, a) * deg;
    return t < 0 ? t + 360 : t;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += hbp < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1
    - 0.17 * Math.cos((hbp - 30) * rad)
    + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad)
    - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// Palette in: [{ hex, weight }]. Out: [{ hex, lab, weight }] with weights summing to 1.
export function normalizePalette(palette) {
  if (!Array.isArray(palette) || palette.length === 0) return [];
  const items = palette
    .filter((c) => c && c.hex)
    .map((c) => ({ hex: c.hex, lab: hexToLab(c.hex), weight: c.weight > 0 ? c.weight : 1 }));
  const total = items.reduce((s, c) => s + c.weight, 0);
  return items.map((c) => ({ ...c, weight: c.weight / total }));
}

// How well two palettes sit together, 0 to 1. Average distance from each color to
// the nearest color in the other palette, both ways, mapped through exp(-d / 25).
// Empty palettes are unknown, so they score a neutral 0.5.
export function paletteSimilarity(p, q) {
  if (!p.length || !q.length) return 0.5;
  const oneWay = (from, to) => from.reduce((s, c) => s + c.weight * Math.min(...to.map((d) => deltaE2000(c.lab, d.lab))), 0);
  const d = (oneWay(p, q) + oneWay(q, p)) / 2;
  return Math.exp(-d / 25);
}

// Number of distinct saturated hue families (30 degree bins) across palettes.
// Neutrals (black, white, grays, beiges) don't count.
export function hueFamilyCount(palettes) {
  const bins = new Set();
  for (const pal of palettes) {
    for (const c of pal) {
      const [, C, h] = lch(c.lab);
      if (C > 18 && c.weight >= 0.1) bins.add(Math.floor(h / 30));
    }
  }
  return bins.size;
}

// Darkness 0 (white) to 1 (black) and saturation 0 to 1, weighted over a palette.
export function tone(pal) {
  if (!pal.length) return { dark: 0.5, sat: 0.2 };
  let dark = 0, sat = 0;
  for (const c of pal) {
    const [L, C] = lch(c.lab);
    dark += c.weight * (1 - L / 100);
    sat += c.weight * Math.min(1, C / 100);
  }
  return { dark, sat };
}

// Plain color name for a Lab color, for sentences like "its blue picks up the blue".
export function colorName(lab) {
  const [L, C, h] = lch(lab);
  if (L < 18) return 'black';
  if (C < 12) return L > 88 ? 'white' : L > 62 ? 'light gray' : 'gray';
  if (h >= 345 || h < 15) return L > 70 ? 'pink' : 'red';
  if (h < 50) return L < 50 && C < 45 ? 'brown' : L > 72 ? 'pink' : 'red';
  if (h < 75) return L < 55 && C < 55 ? 'brown' : L > 82 ? 'peach' : 'orange';
  if (h < 105) return L < 45 ? 'brown' : L < 65 ? 'ochre' : 'yellow';
  if (h < 170) return 'green';
  if (h < 225) return 'teal';
  if (h < 315) return L < 22 ? 'navy' : L > 75 ? 'light blue' : 'blue';
  return L > 72 ? 'pink' : 'purple';
}

// The color a person would name first: the heaviest saturated color if it has
// real weight, otherwise the heaviest color overall.
export function dominant(pal) {
  if (!pal.length) return null;
  const sorted = [...pal].sort((a, b) => b.weight - a.weight);
  const saturated = sorted.find((c) => lch(c.lab)[1] > 18 && c.weight >= 0.15);
  return saturated || sorted[0];
}
