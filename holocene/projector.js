// The projector: one 2D canvas the scenes draw on, a hidden WebGL 2 canvas for
// the scenes that want fragment shaders, and the cuts and dissolves between
// shots. Film grain, vignette and the letterbox are CSS (film.css).
//
// Scenes are stateless: a frame is a pure function of its inputs, so a shot can
// be drawn again underneath the next one during a dissolve, and a paused film
// shows the same picture.
//
// A scene module's default export:
//   { id, init?(p), render(ctx, f, p) }
// where ctx is the 2D context, f the frame (below) and p the helpers:
//   p.shader(frag) → program, compiled once per source
//   p.runShader(program, uniforms) → the GL canvas at the frame's size, to drawImage
//   p.rng(seed) → a seeded random function
//   p.noise(x, y) → smooth value noise in 0..1

import { SECTIONS, shotAt } from './timeline.js';

// Pictures are drawn below screen resolution and scaled up: softer, like film,
// and cheap enough for the shader scenes on a phone.
const MAX_PIXELS = 1280 * 720;

export class Projector {
  #canvas;
  #ctx;
  #scenes = new Map();
  #buffer; // the previous shot during a dissolve
  #gl = null;
  #glCanvas = null;
  #programs = new Map();
  #quad = null;
  #helpers;

  constructor(canvas, scenes) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d', { alpha: false });
    this.#buffer = document.createElement('canvas');
    for (const scene of scenes) this.#scenes.set(scene.id, scene);
    this.#helpers = {
      shader: (frag) => this.#shader(frag),
      runShader: (program, uniforms) => this.#run(program, uniforms),
      rng,
      noise,
    };
    for (const scene of scenes) {
      try {
        scene.init?.(this.#helpers);
      } catch (error) {
        console.error(`Scene ${scene.id} failed to initialize`, error);
      }
    }
  }

  // Matches the canvas to its CSS box, within the pixel budget.
  #resize() {
    const box = this.#canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = Math.max(2, Math.round(box.width * dpr));
    let h = Math.max(2, Math.round(box.height * dpr));
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.round(w * k);
    h = Math.round(h * k);
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = this.#buffer.width = w;
      this.#canvas.height = this.#buffer.height = h;
    }
    return [w, h];
  }

  /**
   * Draws one frame.
   * @param {object} at
   * @param {string} at.section    Section name from timeline.js
   * @param {number} at.beat       Beats since the section started (float)
   * @param {number} at.time       Seconds since the section started
   * @param {number} at.bpm        Current tempo
   * @param {object} at.params     Film state: year, co2, temp, choices, hold, outcome, accent…
   * @param {boolean} at.reduced   prefers-reduced-motion: no fast cuts or flicker
   */
  draw(at) {
    const [w, h] = this.#resize();
    const section = SECTIONS[at.section];
    const scene = this.#scenes.get(section.scene);
    const beatsPerBar = section.beatsPerBar;
    const bpm = at.bpm || section.bpm;
    // Reduced motion: the grid's fast cuts become one cut every four bars.
    const shotFor = (beat) => {
      if (!(at.reduced && section.cuts === 'grid')) return shotAt(at.section, beat);
      const shot = Math.floor(beat / (beatsPerBar * 4));
      return { shot, start: shot * beatsPerBar * 4 };
    };
    const { shot, start } = shotFor(at.beat);
    const frame = (s, st) => {
      const shotBeat = at.beat - st;
      return {
        w, h,
        section: at.section,
        t: at.time,
        beat: at.beat,
        beatPhase: at.beat - Math.floor(at.beat),
        bar: Math.floor(at.beat / beatsPerBar),
        barPhase: (at.beat / beatsPerBar) % 1,
        bpm,
        progress: section.loop ? (at.beat / (section.bars * beatsPerBar)) % 1 : Math.min(1, at.beat / (section.bars * beatsPerBar)),
        shot: s,
        shotBeat,
        shotT: (shotBeat * 60) / bpm,
        params: at.params,
        reduced: at.reduced,
      };
    };

    const ctx = this.#ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!scene) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // A dissolve: the previous shot, still moving, under the new one fading in.
    // Reduced motion turns hard cuts into short dissolves and lengthens the others.
    const dissolveBeats = section.dissolve ? section.dissolve * (at.reduced ? 2 : 1) : at.reduced ? 1 : 0;
    const into = at.beat - start;
    if (shot > 0 && dissolveBeats && into < dissolveBeats) {
      const prev = shotFor(start - 0.001);
      const bctx = this.#buffer.getContext('2d', { alpha: false });
      this.#paint(scene, bctx, frame(prev.shot, prev.start));
      this.#paint(scene, ctx, frame(shot, start));
      ctx.globalAlpha = 1 - smooth(into / dissolveBeats);
      ctx.drawImage(this.#buffer, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      this.#paint(scene, ctx, frame(shot, start));
    }
  }

  #paint(scene, ctx, f) {
    ctx.save();
    try {
      scene.render(ctx, f, this.#helpers);
    } catch (error) {
      // A broken scene shows black, and the film goes on.
      if (!scene.failed) console.error(`Scene ${scene.id} failed`, error);
      scene.failed = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, f.w, f.h);
    }
    ctx.restore();
  }

  // WebGL 2: one full-frame triangle, a fragment shader per program.
  // Uniforms every program gets: uResolution (vec2), and whatever the scene passes.
  #shader(frag) {
    if (this.#programs.has(frag)) return this.#programs.get(frag);
    const gl = this.#glContext();
    if (!gl || gl.isContextLost()) return null;
    const vert = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const compile = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    let program = null;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(program, 0, 'aPos');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      program.uniforms = new Map();
    } catch (error) {
      console.error('Shader failed to compile', error);
      program = null;
    }
    this.#programs.set(frag, program);
    return program;
  }

  #glContext() {
    if (this.#gl !== null) return this.#gl || null;
    this.#glCanvas = document.createElement('canvas');
    const gl = this.#glCanvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.#gl = gl || false;
    if (!gl) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.#quad = gl.createVertexArray();
    gl.bindVertexArray(this.#quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return gl;
  }

  // Draws a program at the canvas size. Returns the GL canvas, or null without WebGL 2.
  #run(program, uniforms = {}) {
    const gl = this.#gl;
    // A lost context (a phone reclaiming the GPU) draws the scenes' 2D fallbacks.
    if (!gl || !program || gl.isContextLost()) return null;
    const { width: w, height: h } = this.#canvas;
    if (this.#glCanvas.width !== w || this.#glCanvas.height !== h) {
      this.#glCanvas.width = w;
      this.#glCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.bindVertexArray(this.#quad);
    const set = (name, value) => {
      if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program, name));
      const loc = program.uniforms.get(name);
      if (loc === null) return;
      if (typeof value === 'number' || typeof value === 'boolean') gl.uniform1f(loc, Number(value));
      else if (value.length === 2) gl.uniform2fv(loc, value);
      else if (value.length === 3) gl.uniform3fv(loc, value);
      else if (value.length === 4) gl.uniform4fv(loc, value);
    };
    set('uResolution', [w, h]);
    for (const [name, value] of Object.entries(uniforms)) set(name, value);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.#glCanvas;
  }
}

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Smooth value noise in 0..1.
export function noise(x, y = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
