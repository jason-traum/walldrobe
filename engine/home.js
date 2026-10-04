// A whole home: which of your pieces goes on which wall, before any wall is laid out.
// Pure and deterministic.
//
// How a stylist does it, simply:
//  - The biggest piece goes to the main wall (the first one listed), where it's seen first.
//  - Then each piece, biggest first, goes where it fits and where there's the most room
//    left, leaning toward a wall whose pieces it already sits well with in color, and
//    toward a wall whose color lean (warm or cool) it matches.
//  - A piece too big for every wall stays unplaced and is said so.
//  - Every wall's own preferences (structured or loose, warm or cool) stay its own; this
//    only splits up what you have. New art fills the gaps afterwards, wall by wall.

import { normalizePalette, paletteSimilarity } from './color.js';
import { axesOf } from './taste.js';

// The share of a wall's art zone your pieces may take before new art gets no room,
// and the biggest a piece can be for a wall: most of its width, about half its height.
export const HOME = Object.freeze({ fill: 0.3, maxW: 0.8, maxH: 0.55, room: 1, color: 0.6, tone: 0.4 });

const zoneArea = (w) => Math.max(1, w.width * Math.min(w.height, 96) - (w.obstacles || [])
  .filter((o) => o.kind !== 'edge')
  .reduce((s, o) => s + o.w * Math.min(o.h, w.height), 0) * 0.5);
const fits = (p, w) => p.w <= w.width * HOME.maxW && p.h <= w.height * HOME.maxH;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {{ id: string, width: number, height: number, obstacles?: object[], tone?: 'warm'|'cool'|null }[]} walls main wall first
 * @param {{ id: string, w: number, h: number, palette?: {hex: string, weight: number}[] }[]} pieces as they hang (framed size)
 * @returns {{ byWall: Object<string, string[]>, unplaced: string[] }}
 */
export function assignHome(walls, pieces) {
  const byWall = Object.fromEntries(walls.map((w) => [w.id, []]));
  const unplaced = [];
  if (!walls.length) return { byWall, unplaced: pieces.map((p) => p.id) };
  const cap = new Map(walls.map((w) => [w.id, zoneArea(w) * HOME.fill]));
  const used = new Map(walls.map((w) => [w.id, 0]));
  const pals = new Map(walls.map((w) => [w.id, []]));
  const order = [...pieces].sort((a, b) => b.w * b.h - a.w * a.h || cmp(a.id, b.id));
  order.forEach((p, i) => {
    const pal = normalizePalette(p.palette || []);
    const warm = pal.length ? axesOf({ palette: p.palette }).warm : 0.5;
    let best = null;
    for (const w of walls) {
      if (!fits(p, w)) continue;
      const left = cap.get(w.id) - used.get(w.id) - p.w * p.h;
      // The first and biggest piece belongs on the main wall when it fits there.
      if (i === 0 && w === walls[0]) { best = { w, score: Infinity }; break; }
      const room = left / cap.get(w.id);
      const others = pals.get(w.id);
      const color = others.length && pal.length ? others.reduce((s, q) => s + paletteSimilarity(pal, q), 0) / others.length : 0.5;
      const tone = w.tone === 'warm' ? warm : w.tone === 'cool' ? 1 - warm : 0.5;
      const score = HOME.room * room + HOME.color * color + HOME.tone * tone;
      if (!best || score > best.score + 1e-12) best = { w, score };
    }
    if (!best) { unplaced.push(p.id); return; }
    byWall[best.w.id].push(p.id);
    used.set(best.w.id, used.get(best.w.id) + p.w * p.h);
    if (pal.length) pals.get(best.w.id).push(pal);
  });
  return { byWall, unplaced };
}
