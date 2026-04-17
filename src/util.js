// util.js — math, RNG, coordinate helpers

export const PIXELS_PER_METER = 20;
export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function expDamp(current, target, rate, dt) {
  // Framerate-independent exponential smoothing: 1 - exp(-rate * dt)
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
export function sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

export function vec(x = 0, y = 0) { return { x, y }; }
export function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function vScale(a, s) { return { x: a.x * s, y: a.y * s }; }
export function vLenSq(a) { return a.x * a.x + a.y * a.y; }
export function vLen(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
export function vDist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
export function vDistSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
export function vNorm(a) {
  const L = Math.sqrt(a.x * a.x + a.y * a.y);
  return L < 1e-9 ? { x: 0, y: 0 } : { x: a.x / L, y: a.y / L };
}
export function vDir(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.sqrt(dx * dx + dy * dy);
  return L < 1e-9 ? { x: 0, y: 0 } : { x: dx / L, y: dy / L };
}
export function angleBetween(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  const api = {
    seed,
    next() {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(lo, hi) { return lo + Math.floor(api.next() * (hi - lo + 1)); },
    pick(arr) { return arr[Math.floor(api.next() * arr.length)]; },
    chance(p) { return api.next() < p; },
    range(lo, hi) { return lo + api.next() * (hi - lo); },
  };
  return api;
}

export function worldToScreen(wx, wy, camera, canvasW, canvasH) {
  return {
    x: (wx - camera.x) * PIXELS_PER_METER + canvasW / 2,
    y: (wy - camera.y) * PIXELS_PER_METER + canvasH / 2,
  };
}
export function screenToWorld(sx, sy, camera, canvasW, canvasH) {
  return {
    x: (sx - canvasW / 2) / PIXELS_PER_METER + camera.x,
    y: (sy - canvasH / 2) / PIXELS_PER_METER + camera.y,
  };
}

let nextId = 1;
export function uid() { return nextId++; }
