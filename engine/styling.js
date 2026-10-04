// How designers style a gallery wall, as a light score. Pure.
//
// From the research in design/art-metadata-research.md, the rules that hold up across
// sources and can be measured from what each piece already carries:
//  - Two busy pieces never side by side: a quiet piece gives the eye a rest between them.
//  - Visual weight balanced left and right: dark, saturated, big pieces don't all sit on one side.
//  - A color thread: one color family shows up in at least half the pieces.
//  - Mostly color or mostly black and white, not half and half.
// Real walls break these all the time and still look good (a pair of big pieces side by
// side is fine), so this only nudges the ranking: it's a small weight in judge(), never a
// rule that drops a wall.

const BUSY = 0.3;          // busyness above this reads as busy (it spans about 0 to 0.5)
const NEAR = 6;            // inches: frames this close are neighbors
const THREAD = 0.12;       // a color family at this share of a piece counts as in it
const NEUTRAL = new Set(['black', 'gray', 'white']); // every wall shares these; they're no thread
export const STYLE_PARTS = Object.freeze({ busy: 0.3, balance: 0.25, thread: 0.25, bw: 0.2 });

const gapOf = (a, b) => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));
const heft = (p) => {
  const f = p.profile;
  if (!f || !f.known) return p.w * p.h * 0.5;
  const dark = 1 - (typeof f.brightness === 'number' ? f.brightness : 0.5);
  return p.w * p.h * (0.4 + 0.4 * dark + 0.2 * (f.saturation || 0));
};

/**
 * @param {{ x: number, y: number, w: number, h: number, profile?: object }[]} P every piece on the wall
 * @returns {{ score: number, parts: { busy: number, balance: number, thread: number, bw: number } }} each 0 to 1
 */
export function stylingScore(P) {
  const parts = { busy: 1, balance: 1, thread: 1, bw: 1 };
  if (P.length < 2) return { score: 1, parts };
  // Busy neighbors.
  let pairs = 0, both = 0;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (gapOf(P[i], P[j]) > NEAR) continue;
    pairs++;
    const a = P[i].profile, b = P[j].profile;
    if (a && b && a.busy > BUSY && b.busy > BUSY) both++;
  }
  parts.busy = pairs ? 1 - both / pairs : 1;
  // Weight balance, left to right about the group's middle.
  const x0 = Math.min(...P.map((p) => p.x)), x1 = Math.max(...P.map((p) => p.x + p.w));
  const W = Math.max(1, x1 - x0), mid = (x0 + x1) / 2;
  const total = P.reduce((s, p) => s + heft(p), 0);
  const cx = P.reduce((s, p) => s + heft(p) * (p.x + p.w / 2), 0) / total;
  parts.balance = Math.max(0, 1 - (2 * Math.abs(cx - mid)) / W);
  // A color thread through the color pieces.
  const colored = P.filter((p) => p.profile && p.profile.known && !p.profile.bw && p.profile.shares);
  if (colored.length >= 2) {
    const fams = new Set(colored.flatMap((p) => Object.keys(p.profile.shares)).filter((f) => !NEUTRAL.has(f)));
    let best = 0;
    for (const f of fams) {
      // A thread needs at least two pieces to run through.
      const n = colored.filter((p) => (p.profile.shares[f] || 0) >= THREAD).length;
      if (n >= 2) best = Math.max(best, n / colored.length);
    }
    parts.thread = Math.min(1, best / 0.5);
  }
  // Mostly one kind: color or black and white.
  const known = P.filter((p) => p.profile && p.profile.known);
  if (known.length >= 2) {
    const b = known.filter((p) => p.profile.bw).length / known.length;
    parts.bw = 0.5 + 0.5 * Math.abs(2 * b - 1);
  }
  const score = Object.entries(STYLE_PARTS).reduce((s, [k, w]) => s + w * parts[k], 0);
  return { score, parts };
}
