// collision.js — shape overlap helpers

import { angleDiff, vDistSq, vDist, vSub, TAU } from './util.js';

export function circleCircle(a, ar, b, br) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

// Is point inside a cone arc?
// cone = { origin, facing (radians), halfAngle (radians), radius }
export function pointInCone(pt, cone) {
  const dx = pt.x - cone.origin.x, dy = pt.y - cone.origin.y;
  const dsq = dx * dx + dy * dy;
  if (dsq > cone.radius * cone.radius) return false;
  const ang = Math.atan2(dy, dx);
  return Math.abs(angleDiff(ang, cone.facing)) <= cone.halfAngle;
}

// Circle body vs cone — allow body to be hit if any part intersects
export function circleCone(cPt, cR, cone) {
  const dx = cPt.x - cone.origin.x, dy = cPt.y - cone.origin.y;
  const distSq = dx * dx + dy * dy;
  if (distSq > (cone.radius + cR) * (cone.radius + cR)) return false;
  if (distSq <= cR * cR) return true; // origin inside circle
  const ang = Math.atan2(dy, dx);
  const diff = Math.abs(angleDiff(ang, cone.facing));
  if (diff <= cone.halfAngle) return true;
  // edge of cone: closest angle
  const dist = Math.sqrt(distSq);
  const overshoot = diff - cone.halfAngle;
  const lateral = Math.sin(overshoot) * dist;
  return lateral <= cR;
}

// Line segment vs circle — for beam/line attacks
export function lineCircle(p1, p2, c, r) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return circleCircle(p1, 0, c, r);
  const t = Math.max(0, Math.min(1, ((c.x - p1.x) * dx + (c.y - p1.y) * dy) / lenSq));
  const px = p1.x + t * dx, py = p1.y + t * dy;
  const ex = c.x - px, ey = c.y - py;
  return ex * ex + ey * ey <= r * r;
}

// Axis-aligned rectangle vs circle
export function circleRect(c, r, rect) {
  const rx = Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
  const ry = Math.max(rect.y, Math.min(c.y, rect.y + rect.h));
  const dx = c.x - rx, dy = c.y - ry;
  return dx * dx + dy * dy <= r * r;
}
