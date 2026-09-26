// The sine scroller along the bottom of the page, and the morph that turns
// its letters into the chat.
//
// The scroller is a stream: pieces of text are laid end to end and slide left.
// When the text changes, the new text enters at the right edge, the way a
// cracktro switched messages. Letters bend along the wave column by column.

import { CELL, graphemes } from './font.js';
import { PALETTE_INDEX as P, RASTER } from './gl.js';
import { random } from './effects.js';

export const SCALE = 2; // font pixels to virtual pixels, in the scroller
const WAVELENGTH = 150; // virtual pixels
const AMPLITUDE = 5.5; // virtual pixels
const SPEED = 2.3; // radians a second

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Strip {
  constructor(gfx) {
    this.gfx = gfx;
    this.pieces = []; // { x, width, glyphs: [{ ch, entry, dx, index }], role, key }
    this.segments = [];
    this.offset = 0; // the stream position at the left edge, in virtual pixels
    this.speed = 78; // virtual pixels a second
    this.time = 0;
    this.hover = { x: -1, amount: 0 };
    this.width = 0; // visible width in virtual pixels
    this.calm = false; // reduced motion: still text, no wave
  }

  // segments: [{ text, role: 'message' | 'decor', key }]. With now, the new text
  // enters at the right edge right away instead of after the current loop;
  // with drop, the letters on screen fall out of the band to make room; with
  // reset, the band starts empty.
  setText(segments, { now = false, drop = false, reset = false } = {}) {
    const same = segments.length === this.segments.length && segments.every((s, i) => s.text === this.segments[i].text && s.key === this.segments[i].key);
    this.segments = segments;
    const edge = this.offset + this.width;
    if (reset) {
      this.pieces = [];
      this.falling = [];
      this.calmKey = null;
      this.#cut = edge;
      return;
    }
    if (same || !now) return;
    if (drop && !this.calm) {
      for (const piece of this.pieces) {
        for (const glyph of piece.glyphs) {
          const xv = piece.x + glyph.dx - this.offset;
          if (xv < -30 || xv > this.width + 10) continue;
          this.falling.push({ glyph, xv, vy: -30 - Math.random() * 60, vx: -this.speed * 0.6, y: 0, delay: (xv / this.width) * 0.25 });
        }
      }
      this.pieces = [];
      this.#cut = edge;
      return;
    }
    // Letters already on screen scroll on; the rest of their text goes.
    for (const piece of this.pieces) piece.glyphs = piece.glyphs.filter((g) => piece.x + g.dx < edge + 4);
    this.pieces = this.pieces.filter((p) => p.glyphs.length);
    const last = this.pieces.at(-1);
    if (last) last.width = last.glyphs.at(-1).dx + last.glyphs.at(-1).entry.advance * SCALE;
    this.#cut = Math.max(edge, last ? last.x + last.width : edge) + 8;
  }

  falling = []; // letters dropping out of the band

  #cut = null; // where the next piece has to start at the earliest

  #append(x) {
    const gfx = this.gfx;
    for (const segment of this.segments) {
      const glyphs = [];
      let dx = 0;
      let index = 0;
      for (const ch of graphemes(segment.text.replace(/\s+/g, ' '))) {
        const entry = gfx.glyph(ch, true);
        glyphs.push({ ch, entry, dx, index: index++ });
        dx += entry.advance * SCALE;
      }
      this.pieces.push({ x, width: dx, glyphs, role: segment.role, key: segment.key });
      x += dx;
    }
    return x;
  }

  update(dt, width) {
    this.width = width;
    this.time += dt;
    if (this.calm) {
      // Still text from the left edge, rebuilt when the words change.
      const key = this.segments.map((s) => s.text).join('');
      if (this.calmKey !== key) {
        this.calmKey = key;
        this.pieces = [];
        this.offset = -12;
        this.#append(0);
      }
      return;
    }
    this.calmKey = null;
    this.offset += this.speed * dt;
    for (const f of this.falling) {
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.vy += 260 * dt;
      f.y += f.vy * dt;
      f.xv += f.vx * dt;
    }
    this.falling = this.falling.filter((f) => f.y < 90);
    this.pieces = this.pieces.filter((p) => p.x + p.width > this.offset - 40);
    if (!this.segments.length) return;
    let end = this.pieces.length ? this.pieces.at(-1).x + this.pieces.at(-1).width : this.offset + width;
    if (this.#cut !== null) {
      end = Math.max(end, this.#cut);
      this.#cut = null;
    }
    let guard = 0;
    while (end < this.offset + width + 60 && guard++ < 20) {
      const next = this.#append(end);
      if (next === end) break;
      end = next;
    }
    this.hover.amount += ((this.hover.x >= 0 ? 1 : 0) - this.hover.amount) * Math.min(1, dt * 8);
  }

  // Where each column of a glyph is: (device pixels) and the wave's lift.
  #columnY(xv, midV) {
    const wave = this.calm ? 0 : AMPLITUDE * Math.sin((xv / WAVELENGTH) * Math.PI * 2 - this.time * SPEED);
    let lift = 0;
    if (this.hover.amount > 0.01 && this.hover.x >= 0) {
      const d = (xv - this.hover.x) / 34;
      lift = 7 * Math.exp(-d * d) * this.hover.amount * (0.8 + 0.2 * Math.sin(this.time * 9));
    }
    return Math.round(midV - 5.5 * SCALE + wave - lift);
  }

  // Calls fn(glyph, piece, columns) for every glyph near the visible part (and
  // every glyph of the pieces called whole): columns are [{ c, x, y }], the
  // top left of each column of font pixels, in device pixels.
  #layout(rect, fn, margin = 0, whole = null) {
    const px = this.gfx.px;
    const midV = rect.h / px / 2;
    for (const piece of this.pieces) {
      for (const glyph of piece.glyphs) {
        const xv = piece.x + glyph.dx - this.offset;
        const w = glyph.entry.w * glyph.entry.texel;
        if (piece.key !== whole && (xv + w * SCALE < -margin || xv > this.width + margin)) continue;
        const columns = [];
        for (let c = 0; c < w; c++) {
          const cx = xv + c * SCALE;
          columns.push({ c, x: rect.x + cx * px, y: rect.y + this.#columnY(cx, midV) * px });
        }
        fn(glyph, piece, columns);
      }
    }
  }

  draw(rect, alpha = 1) {
    if (alpha <= 0) return;
    const gfx = this.gfx;
    const fp = SCALE * gfx.px; // device pixels per font pixel
    const shadows = [];
    this.#layout(rect, (glyph, piece, columns) => shadows.push([glyph, columns]));
    // Shadows first, so no letter's shadow falls on its neighbour.
    for (const [glyph, columns] of shadows) {
      for (const { c, x, y } of columns) gfx.glyphColumn(glyph.entry, c, x + gfx.px * 2, y + gfx.px * 2, fp, P.shadow, 0.75 * alpha);
    }
    for (const [glyph, columns] of shadows) {
      for (const { c, x, y } of columns) gfx.glyphColumn(glyph.entry, c, x, y, fp, P.raster, alpha, 0, RASTER);
    }
    // Letters making room for a new message.
    const midV = rect.h / gfx.px / 2;
    for (const f of this.falling) {
      const w = f.glyph.entry.w * f.glyph.entry.texel;
      for (let c = 0; c < w; c++) {
        const cx = f.xv + c * SCALE;
        const y = rect.y + (this.#columnY(cx, midV) + Math.round(f.y)) * gfx.px;
        gfx.glyphColumn(f.glyph.entry, c, rect.x + cx * gfx.px, y, fp, P.raster, alpha * Math.max(0, 1 - f.y / 80), 0, RASTER);
      }
    }
  }

  // Every lit font pixel of the letters near the screen, for the morph, and of
  // the whole message that is about to land in the chat.
  snapshot(rect, messageKey = null) {
    const gfx = this.gfx;
    const fp = SCALE * gfx.px;
    const glyphs = [];
    this.#layout(rect, (glyph, piece, columns) => {
      const pixels = [];
      for (const [x, y] of gfx.pixels(glyph.entry)) {
        const col = columns[Math.min(columns.length - 1, Math.floor(x))];
        if (col) pixels.push([col.x, col.y + y * fp]);
      }
      glyphs.push({ ch: glyph.ch, index: glyph.index, piece, pixels, size: fp });
    }, 200, messageKey);
    return glyphs;
  }
}

// The transformation: the scroller's letters burst into pixels; the message's
// pixels fly to the same letters in the chat and land as text, the rest fall
// away like sparks.
export class Morph {
  // targets: [{ index, x, y, size, palette }] — a glyph cell's top left and its
  // font pixel size, keyed by the grapheme index in the message. impact: the
  // point where something hit the scroller, for the letters to fly away from.
  constructor(gfx, source, targets, messageKey, start, impact = null) {
    this.gfx = gfx;
    this.start = start;
    this.particles = [];
    const rnd = random(Math.floor(start * 1000));
    const byIndex = new Map(targets.map((t) => [t.index, t]));
    const message = source.filter((g) => g.piece.key === messageKey);
    // The copy of the message nearest the middle of the screen is the one that flies.
    const copies = [...new Set(message.map((g) => g.piece))];
    const middle = gfx.width / 2;
    const centre = (piece) => {
      const own = message.filter((g) => g.piece === piece && g.pixels.length);
      return own.length ? own.reduce((s, g) => s + g.pixels[0][0], 0) / own.length : Infinity;
    };
    const chosen = copies.sort((a, b) => Math.abs(centre(a) - middle) - Math.abs(centre(b) - middle))[0];
    const count = Math.max(1, targets.length);
    let latest = 0;
    for (const glyph of source) {
      const target = glyph.piece === chosen ? byIndex.get(glyph.index) : null;
      if (target) {
        const lit = this.gfx.pixels(target.entry);
        const from = glyph.pixels;
        const n = Math.max(from.length, lit.length);
        if (!n) continue;
        const delay = 0.06 + (target.order / count) * 0.42 + rnd() * 0.05;
        for (let k = 0; k < n; k++) {
          const [sx, sy] = from.length ? from[Math.floor((k * from.length) / n)] : [target.x, target.y];
          const [lx, ly] = lit.length ? lit[Math.floor((k * lit.length) / n)] : [0, 5];
          const tx = target.x + lx * target.size;
          const ty = target.y + ly * target.size;
          // A burst outwards first, then the pull home.
          const angle = impact ? Math.atan2(sy - impact.y, sx - impact.x) + (rnd() - 0.5) * 1.4 : rnd() * Math.PI * 2;
          const burst = (18 + rnd() * 46) * gfx.px * (impact ? 1.6 : 1);
          const duration = 0.62 + rnd() * 0.2;
          latest = Math.max(latest, delay + duration);
          this.particles.push({
            kind: 1, sx, sy, s0: glyph.size, tx, ty, s1: target.size,
            cx: sx + Math.cos(angle) * burst + (tx - sx) * 0.25, cy: sy + Math.sin(angle) * burst - burst * 0.6 + (ty - sy) * 0.2,
            delay, duration, palette: target.palette, row: (ly + 0.5) / CELL,
          });
        }
      } else {
        for (const [sx, sy] of glyph.pixels) {
          if (rnd() < 0.35) continue;
          // Sparks go up, or away from what hit the scroller (and a little up).
          const away = impact ? Math.atan2(sy - impact.y, sx - impact.x) : -Math.PI / 2;
          const up = impact ? Math.atan2(Math.sin(away) * 0.6 - 0.4, Math.cos(away) * 0.6) : away;
          const angle = up + (rnd() - 0.5) * (impact ? 1.2 : 2.4);
          const near = impact ? Math.max(0, 1 - Math.hypot(sx - impact.x, sy - impact.y) / (240 * gfx.px)) : 0;
          const speed = (40 + rnd() * 160 + near * 320) * gfx.px;
          this.particles.push({
            kind: 0, sx, sy, s0: glyph.size, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            delay: rnd() * 0.12, duration: 0.55 + rnd() * 0.45,
          });
        }
      }
    }
    this.end = Math.max(latest, 1);
  }

  // Draws the particles; finished is true once every letter has landed.
  draw(now, alpha = 1) {
    const gfx = this.gfx;
    const t = now - this.start;
    this.finished = t >= this.end;
    const gravity = 420 * gfx.px;
    const px = gfx.px;
    for (const p of this.particles) {
      const u = (t - p.delay) / p.duration;
      if (p.kind === 0) {
        if (u >= 1) continue;
        const k = Math.max(0, t - p.delay);
        const x = p.sx + p.vx * k;
        const y = p.sy + p.vy * k + 0.5 * gravity * k * k;
        const size = Math.max(px, p.s0 * (1 - Math.max(0, u) * 0.6));
        gfx.rect(Math.round(x), Math.round(y), size, size, P.raster, alpha * (1 - Math.max(0, u)) ** 1.5, 0, RASTER);
        continue;
      }
      const e = u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      const a = (1 - e) * (1 - e);
      const b = 2 * e * (1 - e);
      const c = e * e;
      const x = a * p.sx + b * p.cx + c * p.tx;
      const y = a * p.sy + b * p.cy + c * p.ty;
      const size = p.s0 + (p.s1 - p.s0) * smooth(0.55, 1, e);
      if (e < 0.55) gfx.rect(Math.round(x), Math.round(y), size, size, P.raster, alpha, 0, RASTER);
      else gfx.rect(Math.round(x), Math.round(y), size, size, p.palette, alpha, p.row);
    }
  }
}
