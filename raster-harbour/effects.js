// The classics: starfields, copper bars and a glenz vector object. Each one
// draws itself with sprites or chunky polygons through gl.js.

import { PALETTE_INDEX as P } from './gl.js';

// A seeded random, so every visit has the same sky.
export function random(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A copper bar: one palette step per virtual scanline.
export function copperBar(gfx, x, y, w, h, palette = P.bar, alpha = 1) {
  gfx.rect(x, y, w, h, palette, alpha, -Math.max(1, Math.round(h / gfx.px)));
}

// Flying through space: stars come at you from the middle of the rect.
export class Starfield {
  constructor(count = 420, seed = 7) {
    const rnd = random(seed);
    this.rnd = rnd;
    this.stars = Array.from({ length: count }, () => ({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: 0.05 + rnd() * 0.95, pz: 0 }));
    for (const s of this.stars) s.pz = s.z;
  }

  update(dt, speed) {
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= dt * speed;
      if (s.z <= 0.04) {
        s.x = this.rnd() * 2 - 1;
        s.y = this.rnd() * 2 - 1;
        s.z = s.pz = 1;
      }
    }
  }

  // warp 0–1 stretches stars into streaks.
  draw(gfx, rect, alpha = 1, warp = 0) {
    if (alpha <= 0) return;
    const px = gfx.px;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const f = Math.max(rect.w, rect.h) * 0.5;
    for (const s of this.stars) {
      const x = cx + (s.x / s.z) * f * 0.5;
      const y = cy + (s.y / s.z) * f * 0.5;
      if (x < rect.x || y < rect.y || x >= rect.x + rect.w - px || y >= rect.y + rect.h - px) continue;
      const near = 1 - s.z;
      const bright = Math.min(1, near * near * 1.6 + 0.08);
      const size = near > 0.8 ? 2 * px : px;
      const sx = Math.floor(x / px) * px;
      const sy = Math.floor(y / px) * px;
      gfx.rect(sx, sy, size, size, P.star, alpha, bright);
      if (warp > 0.02) {
        // A streak back towards where the star was.
        const tx = cx + (s.x / Math.min(1, s.z + 0.25 * warp)) * f * 0.5;
        const ty = cy + (s.y / Math.min(1, s.z + 0.25 * warp)) * f * 0.5;
        const steps = Math.min(24, Math.ceil(Math.hypot(x - tx, y - ty) / px));
        for (let i = 1; i < steps; i++) {
          const k = i / steps;
          gfx.rect(Math.floor((x + (tx - x) * k) / px) * px, Math.floor((y + (ty - y) * k) / px) * px, px, px, P.star, alpha * (1 - k) * warp, bright * (1 - k));
        }
      }
    }
  }
}

// Stars in layers that slide left, the cracktro sky.
export class Parallax {
  constructor(count = 90, seed = 3) {
    const rnd = random(seed);
    this.stars = Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), layer: 1 + Math.floor(rnd() * 3) }));
    this.offset = 0;
  }

  update(dt, speed) {
    this.offset += dt * speed;
  }

  draw(gfx, rect, alpha = 1) {
    if (alpha <= 0) return;
    const px = gfx.px;
    for (const s of this.stars) {
      const w = rect.w + px * 4;
      let x = (s.x * w - this.offset * s.layer * s.layer * 0.35) % w;
      if (x < 0) x += w;
      const sx = rect.x + Math.floor(x / px) * px - px * 2;
      const sy = rect.y + Math.floor((s.y * (rect.h - px)) / px) * px;
      if (sx < rect.x || sx > rect.x + rect.w - px) continue;
      gfx.rect(sx, sy, px, px, P.star, alpha, 0.2 + s.layer * 0.25);
    }
  }
}

// Glenz vectors: a see-through polyhedron in two alternating colours, back
// faces showing through the front ones. Here a cube with a pyramid on every
// face (a tetrakis hexahedron): 24 triangles, checkered.
const K = 2.05; // how far the face centres stick out: a spiky crystal
const FACES = [];
for (const axis of [0, 1, 2]) {
  for (const sign of [-1, 1]) {
    const centre = [0, 0, 0];
    centre[axis] = sign * K;
    // The face's four corners, in order around it.
    const [a, b] = [0, 1, 2].filter((i) => i !== axis);
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const p = [0, 0, 0];
      p[axis] = sign;
      p[a] = u;
      p[b] = v;
      return p;
    });
    for (let i = 0; i < 4; i++) {
      const tri = [centre, ring[i], ring[(i + 1) % 4]];
      // Wind every triangle outwards.
      const n = normal(tri);
      const outward = n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] > 0;
      FACES.push({ tri: outward ? tri : [tri[0], tri[2], tri[1]], tone: (i + axis + (sign > 0 ? 1 : 0)) % 2 });
    }
  }
}

function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

// The checker's two colours, for faces towards you and for the ones behind.
const TONES = {
  front: [[1, 0.97, 0.9], [1, 0.5, 0.16]],
  back: [[0.62, 0.36, 0.3], [0.5, 0.12, 0.06]],
};

export class Glenz {
  constructor() {
    this.a = 0.4; // rotation angles
    this.b = 0.9;
    this.c = 0;
  }

  update(dt, spin = 1) {
    this.a += dt * 0.9 * spin;
    this.b += dt * 0.63 * spin;
    this.c += dt * 0.31 * spin;
  }

  // Pushes the triangles; call gfx.flushPolygons() after. lean: { a, b }
  // turns it a little on top of its spin, towards something it looks at.
  draw(gfx, cx, cy, radius, alpha = 1, lean = null) {
    if (alpha <= 0 || radius <= 0) return;
    const a = this.a + (lean?.a ?? 0);
    const b = this.b + (lean?.b ?? 0);
    const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(this.c), Math.cos(this.c)];
    const rotate = ([x, y, z]) => {
      // Around y, then x, then z.
      const x1 = x * ca + z * sa;
      const z1 = -x * sa + z * ca;
      const y1 = y * cb - z1 * sb;
      const z2 = y * sb + z1 * cb;
      return [x1 * cc - y1 * sc, x1 * sc + y1 * cc, z2];
    };
    const light = [0.4, 0.62, 0.68]; // travelling down and away: lit from the top left
    const drawn = FACES.map(({ tri, tone }) => {
      const r = tri.map(rotate);
      const n = normal(r);
      const project = ([x, y, z]) => {
        const s = 3.6 / (3.6 + z * 0.7);
        return [cx + x * radius * s * 0.48, cy + y * radius * s * 0.48];
      };
      return { p: r.map(project), front: n[2] < 0, depth: (r[0][2] + r[1][2] + r[2][2]) / 3, n, tone };
    });
    // Back faces first, far to near, then the front ones.
    drawn.sort((p, q) => (p.front - q.front) || q.depth - p.depth);
    for (const face of drawn) {
      const lit = 0.62 + 0.38 * Math.max(0, -(face.n[0] * light[0] + face.n[1] * light[1] + face.n[2] * light[2]));
      const [r, g, b] = TONES[face.front ? 'front' : 'back'][face.tone];
      const a = (face.front ? 0.5 : 0.85) * alpha;
      const [p0, p1, p2] = face.p;
      gfx.triangle(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], [r * lit * a, g * lit * a, b * lit * a, a]);
    }
  }
}
