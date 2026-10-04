// Where the camera stood, from the wall's corners, and furniture back to its real size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraPose, standOut, DEPTH } from '../web/camera.js';
import { homography, apply } from '../web/photo.js';

// A pinhole camera at (cx, cy, -D) in wall inches (x right, y down from the wall's top,
// z into the wall), turned yaw degrees, focal f pixels, on a photoW x photoH photo.
function camera({ cx, cy, D, yaw = 0, f, photoW = 3024, photoH = 4032 }) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([x, y, z]) => {
    const X = x - cx, Y = y - cy, Z = z + D;
    const xc = c * X - s * Z, zc = s * X + c * Z;
    return [f * xc / zc + photoW / 2, f * Y / zc + photoH / 2];
  };
}

const W = 132, H = 96; // an 11 ft wall, 8 ft tall
const photoW = 4032, photoH = 3024, f = 0.62 * Math.hypot(photoW, photoH);

test('the camera\'s distance and spot come back from the wall\'s corners', () => {
  for (const [D, cx, yaw] of [[96, 66, 0], [120, 40, 12], [72, 90, -15]]) {
    const proj = camera({ cx, cy: 36, D, yaw, f, photoW, photoH });
    const corners = [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]].map(proj);
    const pose = cameraPose(corners, photoW, photoH, W, H);
    assert.ok(Math.abs(pose.distance - D) < 1, `distance ${pose.distance} vs ${D}`);
    assert.ok(Math.abs(pose.x - cx) < 1, `x ${pose.x} vs ${cx}`);
    assert.ok(Math.abs(pose.y - 36) < 1, `y ${pose.y}`);
  }
});

test('a couch read wide from the photo comes back to its real width and place', () => {
  const D = 96, cx = 50, cy = 36; // the camera 5 ft up (96 - 36 = 60 in), off to the left
  const proj = camera({ cx, cy, D, yaw: 8, f, photoW, photoH });
  const corners = [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]].map(proj);
  // The couch: 68 in wide from x = 32, its widest edges 14 in out from the wall, its back's top 34 in up, 6 in out.
  const d = DEPTH.couch;
  const toWall = homography(corners, [[0, 0], [W, 0], [W, H], [0, H]]);
  const onWall = (p) => apply(toWall, ...proj(p));
  const left = onWall([32, H - 20, -d.side])[0], right = onWall([100, H - 20, -d.side])[0];
  const topY = onWall([66, H - 34, -d.top])[1];
  const read = { kind: 'couch', x: left, y: 0, w: right - left, h: H - topY };
  assert.ok(read.w > 74, `read ${read.w}`); // the photo makes it look wider
  const pose = cameraPose(corners, photoW, photoH, W, H);
  const fixed = standOut(read, pose, H);
  assert.ok(Math.abs(fixed.w - 68) < 1, `fixed ${fixed.w}`);
  assert.ok(Math.abs(fixed.x - 32) < 1, `x ${fixed.x}`);
  assert.ok(Math.abs(fixed.y + fixed.h - 34) < 1, `top ${fixed.y + fixed.h}`);
});

test('things on the wall and unknown kinds are left alone', () => {
  const pose = { distance: 96, x: 60, y: 36 };
  const o = { kind: 'window', x: 10, y: 30, w: 30, h: 50 };
  assert.deepEqual(standOut(o, pose, 96), { x: 10, y: 30, w: 30, h: 50, factor: 1 });
});

test('a pose that makes no sense is not used', () => {
  assert.equal(cameraPose([[0, 0], [1, 0], [1, 1], [0, 1]], 4000, 3000, 132, 96), null);
});
