// WebGL 2, the demo way: everything on screen is a sprite, drawn in one
// instanced call per layer. A sprite is a rectangle with a piece of the glyph
// atlas and a palette; a copper bar is a rectangle with a solid piece and a
// tall gradient. Polygons (the glenz vectors) are drawn at the chunky virtual
// resolution and scaled up, so their edges are pixels, not lines.
//
// Coordinates are device pixels from the top left of the canvas.

import { CELL } from './font.js';

// Palettes: gradient stops from top (0) to bottom (1), baked into 64 steps.
// Glyphs pick one step per font row; bars one step per virtual pixel row.
export const PALETTES = {
  // Replies: the copper of the logo. Light at the top of each letter, dark below.
  copper: [[0, '#fff8e0'], [0.2, '#fff8e0'], [0.3, '#ffe39a'], [0.45, '#ffc56a'], [0.6, '#ff9c47'], [0.72, '#f47a35'], [0.82, '#dc5a2a'], [1, '#b23f22']],
  // The visitor: cold steel blue.
  ice: [[0, '#f4feff'], [0.2, '#f4feff'], [0.3, '#c9f5ff'], [0.45, '#92e6ff'], [0.6, '#62cfff'], [0.72, '#46b2f5'], [0.82, '#3a8fe0'], [1, '#2c68c2']],
  // Notices and labels.
  dust: [[0, '#d9d4f2'], [0.3, '#c2bce6'], [0.6, '#a39ccf'], [1, '#7c74ad']],
  // Links: cyan, bright.
  link: [[0, '#eaffff'], [0.3, '#bdfbff'], [0.6, '#6af0ff'], [1, '#2fc6e8']],
  // Errors and warnings.
  alert: [[0, '#fff1f1'], [0.3, '#ffc4c4'], [0.6, '#ff8a8a'], [1, '#e8505a']],
  white: [[0, '#ffffff'], [1, '#ffffff']],
  shadow: [[0, '#05030f'], [1, '#05030f']],
  // The frame's copper bars: dark, bright, dark, one colour per scanline.
  bar: [[0, '#1a0604'], [0.12, '#5a1a0c'], [0.3, '#c2521e'], [0.42, '#ffb04a'], [0.5, '#fff4cf'], [0.58, '#ffb04a'], [0.7, '#c2521e'], [0.88, '#5a1a0c'], [1, '#1a0604']],
  barBlue: [[0, '#040616'], [0.12, '#0f1e5a'], [0.3, '#2456c2'], [0.42, '#4aa6ff'], [0.5, '#e6fbff'], [0.58, '#4aa6ff'], [0.7, '#2456c2'], [0.88, '#0f1e5a'], [1, '#040616']],
  barViolet: [[0, '#0b0414'], [0.12, '#35104f'], [0.3, '#7a2cb8'], [0.42, '#c16bff'], [0.5, '#fbe9ff'], [0.58, '#c16bff'], [0.7, '#7a2cb8'], [0.88, '#35104f'], [1, '#0b0414']],
  barGreen: [[0, '#021208'], [0.12, '#0a4a22'], [0.3, '#1c9a4a'], [0.42, '#5fe08a'], [0.5, '#effff0'], [0.58, '#5fe08a'], [0.7, '#1c9a4a'], [0.88, '#0a4a22'], [1, '#021208']],
  // The scroller's raster: the colour follows the scanline, not the letter.
  raster: [[0, '#ff4f8b'], [0.17, '#ffb04a'], [0.33, '#fff08a'], [0.5, '#7dffb0'], [0.67, '#62d4ff'], [0.83, '#9a7dff'], [1, '#ff4f8b']],
  // The frame behind the text.
  night: [[0, '#0a0b1f'], [1, '#07071a']],
  // Stars, dim to bright.
  star: [[0, '#1d2250'], [0.4, '#4d5aa8'], [0.75, '#aab8ff'], [1, '#ffffff']],
};

export const PALETTE_INDEX = Object.fromEntries(Object.keys(PALETTES).map((name, i) => [name, i]));

// Flags for sprites.
export const COLOR_TEXTURE = 1; // emoji: the atlas colour, not the palette
export const RASTER = 2; // gradient by screen row, scrolling with time

const SPRITE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aUV;
layout(location = 3) in vec4 aStyle;
uniform vec2 uView;
out vec2 vUV;
out vec2 vLocal;
flat out vec4 vStyle;
void main() {
  vec2 p = aRect.xy + aCorner * aRect.zw;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  vUV = aUV.xy + aCorner * aUV.zw;
  vLocal = aCorner;
  vStyle = aStyle;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uPalette;
uniform float uTime;
uniform float uPx;
uniform float uRasterPeriod;
uniform float uScanlines;
uniform vec2 uView;
in vec2 vUV;
in vec2 vLocal;
flat in vec4 vStyle;
out vec4 outColor;
void main() {
  vec4 tex = texelFetch(uAtlas, ivec2(floor(vUV)), 0);
  if (tex.a <= 0.0) discard;
  int flags = int(vStyle.w + 0.5);
  float t;
  if ((flags & 2) != 0) {
    // One colour per virtual scanline, cycling upwards.
    float row = floor((uView.y - gl_FragCoord.y) / uPx);
    t = fract(row / uRasterPeriod + uTime * 0.18 + vStyle.z);
  } else if (vStyle.z >= 0.0) {
    t = vStyle.z;
  } else {
    float rows = -vStyle.z;
    t = (floor(vLocal.y * rows) + 0.5) / rows;
  }
  vec3 rgb = texelFetch(uPalette, ivec2(int(t * 63.999), int(vStyle.x + 0.5)), 0).rgb;
  vec4 c;
  if ((flags & 1) != 0) c = tex; // already premultiplied
  else c = vec4(rgb * tex.a, tex.a);
  // A darker last line in every virtual row: the CRT's scanlines, fixed to the glass.
  float scan = mod(uView.y - gl_FragCoord.y, uPx) > uPx - 1.0 ? 1.0 - uScanlines : 1.0;
  outColor = vec4(c.rgb * scan, c.a) * vStyle.y;
}`;

// Polygons: position in virtual pixels, premultiplied colour.
const POLY_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform vec2 uView;
uniform float uScale;
out vec4 vColor;
void main() {
  vec2 p = aPos * uScale;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  vColor = aColor;
}`;

const POLY_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

// The low-resolution layer, scaled up with hard pixel edges.
const BLIT_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec2 uView;
uniform vec2 uSource;
uniform float uPx;
out vec2 vUV;
void main() {
  vec2 p = uRect.xy + aCorner * uRect.zw;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  vUV = p / uPx;
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uLayer;
uniform vec2 uSource;
uniform vec2 uView;
uniform float uPx;
uniform float uScanPx;
uniform float uScanlines;
uniform float uAlpha;
in vec2 vUV;
out vec4 outColor;
void main() {
  ivec2 texel = ivec2(floor(vUV));
  // The layer is rendered upside down (GL's origin is the bottom left).
  vec4 c = texelFetch(uLayer, ivec2(texel.x, int(uSource.y) - 1 - texel.y), 0);
  float scan = mod(uView.y - gl_FragCoord.y, uScanPx) > uScanPx - 1.0 ? 1.0 - uScanlines : 1.0;
  outColor = vec4(c.rgb * scan, c.a) * uAlpha;
}`;

// Full-screen effects: a rectangle, with gl_FragCoord for the maths.
const EFFECT_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec2 uView;
void main() {
  vec2 p = uRect.xy + aCorner * uRect.zw;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const FLOATS = 12; // per sprite

function compile(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// The browser draws what the pixel font doesn't have, at twice its resolution.
const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", "Noto Sans", "Hiragino Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const HI = 2; // texels per font pixel for fallback glyphs

export class Gfx {
  constructor(canvas, font) {
    this.canvas = canvas;
    this.font = font;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.width = 1;
    this.height = 1;
    this.px = 2; // device pixels per virtual pixel
    this.time = 0;
    this.scanlines = 0.14;
    this.rasterPeriod = 40; // scanlines per rainbow in the scroller's raster
    this.#atlasCanvas = document.createElement('canvas');
    this.#atlasCanvas.width = this.#atlasCanvas.height = 1024;
    this.#atlas2d = this.#atlasCanvas.getContext('2d', { willReadFrequently: true });
    this.#init();
    // ASCII up front, so there is always something to draw.
    for (let c = 32; c < 127; c++) {
      this.glyph(String.fromCharCode(c));
      this.glyph(String.fromCharCode(c), true);
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.#init();
      this.#dirty = { x0: 0, y0: 0, x1: 1024, y1: this.#shelfBottom() };
    });
  }

  #atlasCanvas;
  #atlas2d;
  #entries = new Map();
  #shelves = []; // { y, h, x }
  #dirty = null;
  #data = new Float32Array(FLOATS * 4096);
  #count = 0;
  #poly = new Float32Array(6 * 3 * 512);
  #polyCount = 0;

  #init() {
    const gl = this.gl;
    this.sprite = compile(gl, SPRITE_VS, SPRITE_FS);
    this.poly = compile(gl, POLY_VS, POLY_FS);
    this.blit = compile(gl, BLIT_VS, BLIT_FS);

    // One quad, instanced.
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.instances = gl.createBuffer();
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }

    this.polyBuffer = gl.createBuffer();
    this.polyVao = gl.createVertexArray();
    gl.bindVertexArray(this.polyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    this.blitVao = gl.createVertexArray();
    gl.bindVertexArray(this.blitVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Atlas: white glyphs, premultiplied on upload.
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.#nearest();

    // Palettes: 64 steps each, one row per palette.
    const names = Object.keys(PALETTES);
    const pixels = new Uint8Array(64 * names.length * 4);
    names.forEach((name, row) => {
      const stops = PALETTES[name].map(([t, color]) => [t, hex(color)]);
      for (let i = 0; i < 64; i++) {
        const t = i / 63;
        let k = 0;
        while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
        const [t0, c0] = stops[k];
        const [t1, c1] = stops[Math.min(k + 1, stops.length - 1)];
        const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
        for (let ch = 0; ch < 3; ch++) pixels[(row * 64 + i) * 4 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * f);
        pixels[(row * 64 + i) * 4 + 3] = 255;
      }
    });
    this.palette = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, names.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.#nearest();

    this.layer = { texture: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };

    // A solid block of white texels for bars, rectangles and particles.
    if (!this.solid) {
      this.solid = this.#allocate(8, 64);
      this.#atlas2d.fillStyle = '#fff';
      this.#atlas2d.fillRect(this.solid.x, this.solid.y, 8, 64);
      this.#markDirty(this.solid.x, this.solid.y, 8, 64);
    }
  }

  #nearest() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Sizes the drawing buffer. px: device pixels per virtual pixel.
  resize(width, height, px) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.width = width;
    this.height = height;
    this.px = px;
  }

  // -- Glyph atlas -------------------------------------------------------------

  #shelfBottom() {
    return this.#shelves.reduce((bottom, s) => Math.max(bottom, s.y + s.h), 0);
  }

  // A spot for a w × h glyph, or null when the atlas is full.
  #allocate(w, h) {
    let shelf = this.#shelves.find((s) => s.h === h && s.x + w <= 1024);
    if (!shelf) {
      const y = this.#shelfBottom();
      if (y + h > 1024) return null;
      shelf = { y, h, x: 0 };
      this.#shelves.push(shelf);
    }
    const spot = { x: shelf.x, y: shelf.y };
    shelf.x += w + 1;
    return spot;
  }

  #markDirty(x, y, w, h) {
    const d = this.#dirty ?? { x0: 1024, y0: 1024, x1: 0, y1: 0 };
    this.#dirty = { x0: Math.min(d.x0, x), y0: Math.min(d.y0, y), x1: Math.max(d.x1, x + w), y1: Math.max(d.y1, y + h) };
  }

  // A grapheme's atlas entry: { x, y, w, h } in texels, texel (font pixels per
  // texel), advance (font pixels, spacing included), color (emoji) and, for the
  // pixel font, bits: the glyph's rows, for effects that take letters apart.
  glyph(cluster, bold = false) {
    const key = (bold ? 'b' : 'r') + cluster;
    let entry = this.#entries.get(key);
    if (entry) return entry;
    let glyph = this.font.get(cluster);
    if (glyph) {
      if (bold) glyph = this.font.bold(glyph, cluster);
      const w = Math.max(1, glyph.w);
      const spot = this.#allocate(w, CELL);
      if (!spot) return this.glyph('?', bold); // the atlas is full: thousands of different characters
      const image = this.#atlas2d.createImageData(w, CELL);
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < glyph.w; x++) {
          if ((glyph.bits[y] >> x) & 1) image.data.set([255, 255, 255, 255], (y * w + x) * 4);
        }
      }
      this.#atlas2d.putImageData(image, spot.x, spot.y);
      this.#markDirty(spot.x, spot.y, w, CELL);
      entry = { ...spot, w, h: CELL, texel: 1, advance: glyph.w + 1, color: false, blank: glyph.w === 0 || cluster === ' ', bits: glyph.bits };
    } else {
      entry = this.#fallback(cluster, bold);
    }
    this.#entries.set(key, entry);
    return entry;
  }

  #fallback(cluster, bold) {
    const g = this.#atlas2d;
    const h = CELL * HI;
    g.font = `${bold ? 700 : 500} ${9.5 * HI}px ${FALLBACK_FONT}`;
    const measured = g.measureText(cluster).width;
    if (!(measured > 0.5)) return { x: 0, y: 0, w: 0, h, texel: 1 / HI, advance: 0, color: false, blank: true };
    const w = Math.min(64, Math.ceil(measured) + 1);
    const spot = this.#allocate(w, h);
    if (!spot) return this.glyph('?', bold);
    g.clearRect(spot.x, spot.y, w, h);
    g.save();
    g.beginPath();
    g.rect(spot.x, spot.y, w, h);
    g.clip();
    g.fillStyle = '#fff';
    g.textBaseline = 'alphabetic';
    g.fillText(cluster, spot.x, spot.y + 9 * HI);
    g.restore();
    const image = g.getImageData(spot.x, spot.y, w, h);
    let color = false;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, gg, b, a] = image.data.subarray(i, i + 4);
      if (a > 32 && (Math.abs(r - gg) > 24 || Math.abs(gg - b) > 24 || r < 200)) {
        color = true;
        break;
      }
    }
    this.#markDirty(spot.x, spot.y, w, h);
    // The browser's font brings its own spacing.
    return { ...spot, w, h, texel: 1 / HI, advance: Math.max(1, Math.round(measured / HI)), color, blank: false };
  }

  // The lit font pixels of a glyph, as [x, y] pairs: letters taken apart.
  pixels(entry) {
    if (entry.lit) return entry.lit;
    const lit = [];
    if (entry.bits) {
      entry.bits.forEach((row, y) => {
        for (let x = 0; x < entry.w; x++) if ((row >> x) & 1) lit.push([x, y]);
      });
    } else if (!entry.blank) {
      const k = 1 / entry.texel;
      const image = this.#atlas2d.getImageData(entry.x, entry.y, entry.w, entry.h).data;
      for (let fy = 0; fy < CELL; fy++) {
        for (let fx = 0; fx < Math.ceil(entry.w * entry.texel); fx++) {
          let sum = 0;
          for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) sum += image[((fy * k + dy) * entry.w + Math.min(entry.w - 1, fx * k + dx)) * 4 + 3] ?? 0;
          if (sum / (k * k) > 110) lit.push([fx, fy]);
        }
      }
    }
    entry.lit = lit;
    return lit;
  }

  // Advance of a grapheme in font pixels: what the layout needs.
  advance(cluster, bold = false) {
    return this.glyph(cluster, bold).advance;
  }

  #upload() {
    const d = this.#dirty;
    if (!d) return;
    this.#dirty = null;
    const gl = this.gl;
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    if (w <= 0 || h <= 0) return;
    const pixels = this.#atlas2d.getImageData(d.x0, d.y0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, d.x0, d.y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  // -- Drawing -------------------------------------------------------------------

  begin(time) {
    this.time = time;
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.#count = 0;
    this.#clip = null;
  }

  #clip = null;

  // Sprites after this are clipped to rect ({ x, y, w, h }), or not (null).
  clip(rect) {
    this.flush();
    this.#clip = rect;
  }

  #push(x, y, w, h, u, v, uw, vh, palette, alpha, gradient, flags) {
    if (this.#count * FLOATS >= this.#data.length) {
      const bigger = new Float32Array(this.#data.length * 2);
      bigger.set(this.#data);
      this.#data = bigger;
    }
    this.#data.set([x, y, w, h, u, v, uw, vh, palette, alpha, gradient, flags], this.#count * FLOATS);
    this.#count++;
  }

  // A glyph at (x, y), its cell's top left, `size` device pixels per font pixel.
  // gradient: -CELL for one palette step per font row, or a fixed 0–1.
  glyphSprite(entry, x, y, size, palette, alpha = 1, gradient = -CELL, flags = 0) {
    if (entry.blank || alpha <= 0.003) return;
    const s = size * entry.texel;
    this.#push(x, y, entry.w * s, entry.h * s, entry.x, entry.y, entry.w, entry.h, palette, alpha, gradient, flags | this.#colored(entry, palette));
  }

  // Emoji keep their own colours, except in a shadow.
  #colored(entry, palette) {
    return entry.color && palette !== PALETTE_INDEX.shadow ? COLOR_TEXTURE : 0;
  }

  // One font-pixel-wide column of a glyph: sine scrollers bend letters column
  // by column.
  glyphColumn(entry, column, x, y, size, palette, alpha = 1, gradient = -CELL, flags = 0) {
    if (entry.blank || alpha <= 0.003) return;
    const texels = 1 / entry.texel;
    this.#push(x, y, size, entry.h * entry.texel * size, entry.x + column * texels, entry.y, texels, entry.h, palette, alpha, gradient, flags | this.#colored(entry, palette));
  }

  // A rectangle. gradient: -rows for a vertical gradient in that many steps.
  rect(x, y, w, h, palette, alpha = 1, gradient = 0, flags = 0) {
    if (w <= 0 || h <= 0 || alpha <= 0.003) return;
    const s = this.solid;
    this.#push(x, y, w, h, s.x + 1, s.y + 1, 1, 1, palette, alpha, gradient, flags);
  }

  flush() {
    const gl = this.gl;
    if (!this.#count || this.lost) {
      this.#count = 0;
      return;
    }
    this.#upload();
    const { program, uniforms } = this.sprite;
    gl.useProgram(program);
    gl.uniform2f(uniforms.uView, this.width, this.height);
    gl.uniform1f(uniforms.uTime, this.time);
    gl.uniform1f(uniforms.uPx, this.px);
    gl.uniform1f(uniforms.uRasterPeriod, this.rasterPeriod);
    gl.uniform1f(uniforms.uScanlines, this.scanlines);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(uniforms.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.uniform1i(uniforms.uPalette, 1);
    this.#scissor();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.#data.subarray(0, this.#count * FLOATS), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.#count);
    gl.bindVertexArray(null);
    this.#count = 0;
  }

  #scissor() {
    const gl = this.gl;
    const c = this.#clip;
    if (!c) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    gl.enable(gl.SCISSOR_TEST);
    const x = Math.max(0, Math.floor(c.x));
    const y = Math.max(0, Math.floor(c.y));
    const w = Math.max(0, Math.min(this.width, Math.ceil(c.x + c.w)) - x);
    const h = Math.max(0, Math.min(this.height, Math.ceil(c.y + c.h)) - y);
    gl.scissor(x, this.height - y - h, w, h);
  }

  // -- Full-screen effects ------------------------------------------------------------

  // A fragment shader for effects that are computed per pixel, like a
  // checkerboard floor. It gets uTime, uView and uPx; the rest is up to it.
  effect(source) {
    return compile(this.gl, EFFECT_VS, source);
  }

  // Draws an effect over rect (device pixels). uniforms: { name: number | [numbers] }.
  drawEffect(effect, rect, uniforms = {}) {
    const gl = this.gl;
    if (this.lost) return;
    this.flush();
    gl.useProgram(effect.program);
    const u = effect.uniforms;
    gl.uniform4f(u.uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2f(u.uView, this.width, this.height);
    if (u.uTime) gl.uniform1f(u.uTime, this.time);
    if (u.uPx) gl.uniform1f(u.uPx, this.px);
    for (const [name, value] of Object.entries(uniforms)) {
      if (!u[name]) continue;
      const v = [].concat(value);
      gl[`uniform${v.length}f`](u[name], ...v);
    }
    this.#scissor();
    gl.bindVertexArray(this.blitVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // -- Chunky polygons -------------------------------------------------------------

  // A triangle in device pixels; colour premultiplied [r, g, b, a] 0–1.
  triangle(ax, ay, bx, by, cx, cy, color) {
    if (this.#polyCount * 18 >= this.#poly.length) {
      const bigger = new Float32Array(this.#poly.length * 2);
      bigger.set(this.#poly);
      this.#poly = bigger;
    }
    const s = 1 / this.px;
    const [r, g, b, a] = color;
    this.#poly.set([ax * s, ay * s, r, g, b, a, bx * s, by * s, r, g, b, a, cx * s, cy * s, r, g, b, a], this.#polyCount * 18);
    this.#polyCount++;
  }

  // Draws the triangles so far at virtual resolution (or chunk device pixels
  // per pixel), then scales them up into rect (device pixels) with hard edges.
  flushPolygons(rect, alpha = 1, chunk = this.px) {
    const gl = this.gl;
    if (!this.#polyCount || this.lost) {
      this.#polyCount = 0;
      return;
    }
    this.flush();
    const w = Math.ceil(this.width / chunk);
    const h = Math.ceil(this.height / chunk);
    const layer = this.layer;
    if (layer.w !== w || layer.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.#nearest();
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.texture, 0);
      layer.w = w;
      layer.h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { program, uniforms } = this.poly;
    gl.useProgram(program);
    gl.uniform2f(uniforms.uView, w, h);
    gl.uniform1f(uniforms.uScale, this.px / chunk);
    gl.bindVertexArray(this.polyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.#poly.subarray(0, this.#polyCount * 18), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.#polyCount * 3);
    this.#polyCount = 0;

    // The layer was drawn with y down in clip space, so row 0 is at the top of
    // the texture's last row. The blit shader flips it back.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const blit = this.blit;
    gl.useProgram(blit.program);
    gl.uniform4f(blit.uniforms.uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2f(blit.uniforms.uView, this.width, this.height);
    gl.uniform2f(blit.uniforms.uSource, w, h);
    gl.uniform1f(blit.uniforms.uPx, chunk);
    gl.uniform1f(blit.uniforms.uScanPx, this.px);
    gl.uniform1f(blit.uniforms.uScanlines, this.scanlines);
    gl.uniform1f(blit.uniforms.uAlpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.uniform1i(blit.uniforms.uLayer, 0);
    this.#scissor();
    gl.bindVertexArray(this.blitVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
