// Where the camera stood, and what that does to things that stand out from the wall.
//
// Flattening the wall from its four corners is exact for anything flat on the wall:
// frames, outlets, windows. Furniture stands in front of it, nearer the camera, so in
// the flattened photo it looks bigger by D / (D - d), where D is how far the camera was
// from the wall and d how far the edge stands out, and it grows outward from the point
// on the wall straight in front of the camera. Kelly's 68 in couch read as 78 in.
//
// The four corners and the camera's focal length give the camera's place: its distance
// from the wall and the point straight in front of it. Each furniture box is then pulled
// back toward that point by its depth. Pure: no DOM.

import { homography } from './photo.js';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

// A phone's main camera: a focal length of about 0.62 of the photo's diagonal (26 mm).
export const PHONE_FOCAL = 0.62;

/**
 * The camera's place, in wall inches: x from the wall's left edge, y down from the top of
 * the wall in the photo, and its distance from the wall.
 * @param {number[][]} corners the wall's corners in the photo, [tl, tr, br, bl], in pixels
 * @param {number} photoW photo width in pixels
 * @param {number} photoH photo height in pixels
 * @param {number} wallW the wall's width in inches between the corners
 * @param {number} wallH the wall's height in inches between the corners
 * @param {number|null} focal focal length in pixels, if measured
 * @returns {{ distance: number, x: number, y: number } | null}
 */
export function cameraPose(corners, photoW, photoH, wallW, wallH, focal = null) {
  if (!corners || corners.length !== 4 || !(wallW > 0) || !(wallH > 0)) return null;
  const f = focal || PHONE_FOCAL * Math.hypot(photoW, photoH);
  const dst = corners.map(([x, y]) => [x - photoW / 2, y - photoH / 2]);
  const H = homography([[0, 0], [wallW, 0], [wallW, wallH], [0, wallH]], dst);
  if (!H) return null;
  // K^-1 H, with the photo's center as the camera's center.
  let m1 = [H[0] / f, H[3] / f, H[6]], m2 = [H[1] / f, H[4] / f, H[7]], m3 = [H[2] / f, H[5] / f, H[8]];
  let lam = 2 / (norm(m1) + norm(m2));
  if (!Number.isFinite(lam)) return null;
  // The wall is in front of the camera.
  if (m3[2] * lam < 0) lam = -lam;
  const r1 = m1.map((v) => v * lam), r2 = m2.map((v) => v * lam), t = m3.map((v) => v * lam);
  const r3 = cross(r1, r2);
  // Camera center in wall coordinates: -R^T t.
  const x = -dot(r1, t), y = -dot(r2, t), z = -dot(r3, t);
  const distance = Math.abs(z);
  if (!Number.isFinite(distance) || distance < 12 || distance > 1200) return null;
  return { distance, x, y };
}

// How far each kind stands out from the wall, in inches: `side`, the edge that sets its
// width in the photo (a dresser's front corners, a couch's arms), and `top`, the edge that
// sets its top when the camera is above it (the back of a dresser's top, a couch's back).
// The couch's 14 in matches Kelly's couch from a usual phone distance.
export const DEPTH = {
  couch: { side: 14, top: 6, full: 36 },
  bed: { side: 14, top: 4, full: 80 },
  dresser: { side: 18, top: 2, full: 18 },
  console: { side: 16, top: 2, full: 16 },
  sideboard: { side: 18, top: 2, full: 18 },
  credenza: { side: 18, top: 2, full: 18 },
  desk: { side: 24, top: 2, full: 24 },
  table: { side: 20, top: 2, full: 30 },
  chair: { side: 20, top: 6, full: 30 },
  bookshelf: { side: 12, top: 2, full: 12 },
  lamp: { side: 12, top: 12, full: 12 },
  plant: { side: 12, top: 12, full: 12 },
  furniture: { side: 16, top: 4, full: 18 },
};

/**
 * A box read from the photo, back to its real size where it stands out from the wall.
 * x and w are inches from the left; y and h are inches up from the floor. The bottom
 * stays on the floor.
 * @param {{ x: number, y: number, w: number, h: number, kind: string }} o
 * @param {{ distance: number, x: number, y: number }} pose from cameraPose()
 * @param {number} wallH the wall's height in inches between the corners (the floor is its bottom)
 * @returns {{ x: number, y: number, w: number, h: number, factor: number }}
 */
export function standOut(o, pose, wallH) {
  const dp = DEPTH[o.kind];
  if (!dp || !pose) return { x: o.x, y: o.y, w: o.w, h: o.h, factor: 1 };
  const D = pose.distance;
  const camX = pose.x, camUp = wallH - pose.y; // the camera's height above the floor
  const pull = (v, c, d) => c + (v - c) * Math.max(0.2, (D - Math.min(d, D * 0.8)) / D);
  const x0 = pull(o.x, camX, dp.side), x1 = pull(o.x + o.w, camX, dp.side);
  // Its top: seen from above, the edge nearest the wall; seen from below, the front edge.
  const top = o.y + o.h;
  const topD = top < camUp ? dp.top : dp.full;
  const y1 = Math.max(o.y + 1, pull(top, camUp, topD));
  return { x: x0, y: o.y, w: x1 - x0, h: y1 - o.y, factor: o.w > 0 ? (x1 - x0) / o.w : 1 };
}
