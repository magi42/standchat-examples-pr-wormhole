// The industrial scenes: from the first steam engines to the heat of 2026.
// Steam and coal (1712–1900), the furnace (choice 2), the Grid (1950–1988, the
// great acceleration), the warning (1988, choice 3) and the heat (1988–2026).
//
// Smoke, fire, water, ice and cloud are fragment shaders; silhouettes, streaks
// of light and the grid's machinery are canvas 2D. Every shader has a plainer 2D
// fallback for browsers without WebGL 2. Every frame is a pure function of `f`.

// ---------------------------------------------------------------------------
// Shared helpers

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, k) => a + (b - a) * k;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (a, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const fract = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;

// Machine time: advances one unit per beat, moving during the first `k` of the
// beat and resting for the rest. Things in the Grid step with the music.
function stepBeat(beat, k = 0.5) {
  const b = Math.floor(beat);
  const x = clamp((beat - b) / k);
  return b + 1 - (1 - x) ** 3;
}

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw?.(c.getContext('2d'), w, h);
  return c;
}

// Common GLSL: hashes, value noise, fbm, Voronoi cells, a fire ramp, a centered
// coordinate (frame height 1, y up) and the film look used across HOLOCENE.
const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uT;
uniform float uK;
uniform vec4 uA;
uniform vec4 uB;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return v / 0.97;
}
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return v / 0.875;
}
// Voronoi: distance to the cell's centre, distance to its nearest edge, its id.
// The centre itself is left in gCell.
vec2 gCell;
vec3 cells(vec2 x) {
  vec2 n = floor(x), f = fract(x), mg = vec2(0), mr = vec2(0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j), r = g + hash2(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  // The edge pass looks at the 3x3 around the nearest centre, not 5x5: a few
  // rare cells come out slightly wrong, for well under half the cost.
  float ed = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = mg + vec2(i, j), r = g + hash2(n + g) - f;
    if (dot(mr - r, mr - r) > 1e-5) ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  gCell = n + mg + hash2(n + mg);
  return vec3(sqrt(md), ed, hash(n + mg));
}
vec3 fireRamp(float x) { x = max(x, 0.0); return vec3(1.5 * x, 1.25 * x * x, 0.9 * x * x * x * x); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec2 centered() { return (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0); }
vec3 film(vec3 c) {
  c = max(c, 0.0);
  c = c / (1.0 + 0.12 * c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c += vec3(-0.012, 0.004, 0.016) * (1.0 - smoothstep(0.0, 0.35, l));
  c += vec3(0.03, 0.008, -0.03) * smoothstep(0.45, 1.0, l);
  return pow(max(c, 0.0), vec3(1.1)) + (hash(gl_FragCoord.xy) - 0.5) / 160.0;
}
`;
const frag = (body) => PRELUDE + body;

// Runs a shader over the whole frame. Returns false without WebGL 2, so the
// caller can paint its fallback.
function shade(ctx, f, p, source, uniforms = {}) {
  const program = p.shader(source);
  const out = program && p.runShader(program, { uT: f.t, ...uniforms });
  if (!out) return false;
  ctx.drawImage(out, 0, 0, f.w, f.h);
  return true;
}

// The plain fallback: a vertical gradient from `stops` (top to bottom).
function gradient(ctx, f, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, f.h);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, f.h);
}

// The viewer's answer as an amount in 0..1, or null. film.js passes
// params.amounts; the dev harness may only have choices (1, 0, -1), which map
// to 0, 0.5 and 1.
function amountOf(params, key) {
  const a = params.amounts?.[key];
  if (a !== null && a !== undefined) return clamp(a);
  const c = params.choices?.[key];
  return c === null || c === undefined ? null : (1 - c) / 2;
}

// Maps the shaders' centered coordinates (frame height 1, y up) to pixels.
const frameMap = (f) => [(x) => f.w / 2 + x * f.h, (y) => f.h / 2 - y * f.h];

// Sprites, drawn once: puffs of smoke and steam, a soft light, a bottle, TV test cards.
const SPRITES = {};
// A billow of overlapping soft blobs, lit from above.
function puff([r, g, b], alpha) {
  return makeCanvas(128, 128, (c) => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, d = rnd() * 28, s = 16 + rnd() * 22;
      const x = 64 + Math.cos(a) * d * 1.2, y = 64 + Math.sin(a) * d * 0.7;
      const k = 0.75 + (64 - y) / 110;
      const gr = c.createRadialGradient(x, y, 0, x, y, s);
      gr.addColorStop(0, `rgba(${r * k | 0},${g * k | 0},${b * k | 0},${alpha})`);
      gr.addColorStop(1, `rgba(${r * k | 0},${g * k | 0},${b * k | 0},0)`);
      c.fillStyle = gr;
      c.fillRect(0, 0, 128, 128);
    }
  });
}
function makeSprites() {
  if (SPRITES.puff) return;
  SPRITES.steam = puff([255, 226, 196], 0.55);
  SPRITES.puff = puff([46, 38, 34], 0.7);
  SPRITES.glow = makeCanvas(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  // A plain glass bottle, lit from the left by a fluorescent tube.
  SPRITES.bottle = makeCanvas(48, 128, (g) => {
    const body = g.createLinearGradient(6, 0, 42, 0);
    body.addColorStop(0, 'rgba(120,170,160,0.9)');
    body.addColorStop(0.18, 'rgba(230,250,240,0.95)');
    body.addColorStop(0.35, 'rgba(60,110,100,0.85)');
    body.addColorStop(1, 'rgba(20,40,38,0.9)');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(18, 4); g.lineTo(30, 4); g.lineTo(30, 30);
    g.quadraticCurveTo(42, 44, 42, 60); g.lineTo(42, 120); g.quadraticCurveTo(42, 126, 36, 126);
    g.lineTo(12, 126); g.quadraticCurveTo(6, 126, 6, 120); g.lineTo(6, 60); g.quadraticCurveTo(6, 44, 18, 30);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(200,120,40,0.55)'; // what it holds
    g.fillRect(8, 70, 32, 54);
  });
  // Test cards for the wall of screens. Nothing here is anybody's pattern.
  SPRITES.bars = makeCanvas(56, 40, (g) => {
    const cols = ['#bfbfbf', '#bfbf2a', '#2abfbf', '#2abf2a', '#bf2abf', '#bf2a2a', '#2a2abf'];
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 8, 0, 8, 30); });
    g.fillStyle = '#111'; g.fillRect(0, 30, 56, 10);
    g.fillStyle = '#ddd'; g.fillRect(8, 32, 10, 6);
  });
  SPRITES.rings = makeCanvas(80, 60, (g) => {
    g.fillStyle = '#3a3a44'; g.fillRect(0, 0, 80, 60);
    g.strokeStyle = '#c8c8d0'; g.lineWidth = 1;
    for (let x = 0; x <= 80; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 60); g.stroke(); }
    for (let y = 0; y <= 60; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(80, y); g.stroke(); }
    g.lineWidth = 2;
    for (const r of [10, 20, 28]) { g.beginPath(); g.arc(40, 30, r, 0, TAU); g.stroke(); }
  });
  SPRITES.snow = makeCanvas(96, 144, (g) => {
    const img = g.createImageData(96, 144);
    let seed = 3;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = 40 + (seed % 150);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  // A CRT's glass: dark corners, scanlines, a reflection of the room.
  SPRITES.glass = makeCanvas(96, 72, (g) => {
    const v = g.createRadialGradient(48, 36, 10, 48, 36, 58);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = v; g.fillRect(0, 0, 96, 72);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < 72; y += 3) g.fillRect(0, y, 96, 1);
    const hl = g.createLinearGradient(0, 0, 40, 30);
    hl.addColorStop(0, 'rgba(255,255,255,0.12)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.fillRect(0, 0, 96, 72);
    // The bezel's rounded corners, so screens need no clipping.
    g.fillStyle = '#1a1a1d';
    g.beginPath();
    g.rect(0, 0, 96, 72);
    g.roundRect(0, 0, 96, 72, 7);
    g.fill('evenodd');
  });
}

// ---------------------------------------------------------------------------
// Steam, 1712–1900: smokestacks against a sulphur sky.

// The sky, the plumes of up to eight stacks, a train's trail and the plain.
// uA: soot (0..1), wind, smoke ceiling, horizon. uB: sun x, y, radius.
// uC: train x, stack top, speed (0 = none), plume spread. uD/uE, uF/uG: stack x / top.
const SMOKE = frag(`
uniform vec4 uC, uD, uE, uF, uG;
float plume(vec2 p, float x, float top, float wind, float spread) {
  float h = p.y - top;
  if (h < -0.004) return 0.0;
  h = max(h, 0.0);
  float v = fract(sin(x * 91.7) * 437.5);
  float cx = x + wind * pow(h, 1.35) * (0.8 + 0.8 * v) + (noise(vec2(x * 13.0, h * 3.0 - uT * 0.4)) - 0.5) * h * 0.6;
  float w = 0.012 + spread * h * (0.7 + 0.6 * v);
  float d = (p.x - cx) / w;
  return exp(-d * d * 1.3) * smoothstep(0.0, 0.025, h + 0.004) * (1.4 - 0.6 * smoothstep(0.1, 0.8, h));
}
void main() {
  vec2 p = centered();
  float soot = uA.x, wind = uA.y, y = p.y - uA.w;
  float sd = length(p - uB.xy);
  // Sky: sulphur at the horizon, burnt orange, brown overhead.
  vec3 sky = mix(vec3(1.0, 0.76, 0.36), vec3(0.86, 0.4, 0.13), smoothstep(0.0, 0.3, y));
  sky = mix(sky, vec3(0.2, 0.09, 0.05), smoothstep(0.2, 0.85, y));
  sky *= 1.0 - soot * 0.3;
  sky += vec3(1.0, 0.6, 0.25) * (exp(-sd * 4.0) * 0.55 + exp(-sd * 14.0) * 0.5);
  sky = mix(sky, vec3(1.25, 1.05, 0.75), smoothstep(uB.z, uB.z * 0.92, sd));
  // Where the smoke is: plumes, a train's trail, the ceiling it all becomes.
  float m = 0.0, spread = uC.w > 0.0 ? uC.w : 0.2;
  for (int i = 0; i < 4; i++) m += plume(p, uD[i], uE[i], wind, spread) + plume(p, uF[i], uG[i], wind, spread);
  if (uC.z > 0.0) {
    float age = (p.x - uC.x) / uC.z;
    if (age > 0.0) {
      float cy = uC.y + 0.04 * sqrt(age) + 0.012 * age;
      float w = 0.006 + 0.028 * sqrt(age);
      float d = (p.y - cy) / w;
      m += exp(-d * d) * exp(-age * 0.1) * smoothstep(0.0, 0.01, p.x - uC.x) * 1.3;
    }
  }
  m += uA.z * smoothstep(0.0, 0.45, p.y + 0.1);
  // What the smoke looks like: one wind field, rising and drifting.
  vec2 q = p * 3.4 - vec2(wind * uT * 0.45, uT * 0.5);
  vec2 wv = vec2(fbm3(q * 0.7 + uT * 0.06), fbm3(q * 0.7 + vec2(5.2, 1.3)));
  float n = fbm(q + 1.7 * wv);
  // Billows: brighter where the smoke thins towards the light, darker in its folds.
  float lit = clamp((fbm3(q * 0.6 + wv) - fbm3(q * 0.6 + wv + vec2(0.12, -0.16))) * 5.0 + 0.5, 0.0, 1.0);
  float dens = smoothstep(0.12, 0.8, m * (0.2 + 1.3 * n));
  vec3 smoke = mix(vec3(0.5, 0.4, 0.33), vec3(0.07, 0.055, 0.05), clamp(0.3 + soot * 0.45 + (0.55 - n) * 0.8 - lit * 0.5, 0.0, 1.0));
  smoke += sky * 0.15 + vec3(0.8, 0.4, 0.1) * exp(-sd * 3.0) * lit * 0.5;
  vec3 c = mix(sky, smoke, dens * (0.82 + 0.15 * soot));
  // The plain under the haze.
  if (y < 0.0) {
    float z = 1.0 / max(-y, 0.002);
    float g = fbm3(vec2(p.x * z * 0.5, z * 0.6));
    vec3 ground = mix(vec3(0.07, 0.045, 0.03), vec3(0.15, 0.09, 0.045), g);
    ground = mix(ground, sky * 0.75, exp(y * 45.0));
    c = ground;
  }
  outColor = vec4(film(c), 1.0);
}`);

// The furnace door, open. uA.x: breath of the fire.
const FURNACE = frag(`
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = centered();
  vec2 c = p - vec2(0.0, 0.06);
  float d = sdBox(c, vec2(0.25, 0.15), 0.08);
  float t = uT * 0.7;
  // Riveted iron plates.
  vec2 g = p * 2.6 + vec2(0.5, 0.35);
  vec2 fg = abs(fract(g) - 0.5);
  float seam = smoothstep(0.47, 0.49, max(fg.x, fg.y));
  vec2 rv = fract(p * 20.8) - 0.5;
  float rivet = smoothstep(0.2, 0.1, length(rv)) * step(0.455, max(fg.x, fg.y));
  vec3 wall = vec3(0.06, 0.042, 0.034) * (0.55 + 0.8 * fbm(p * 7.0)) * (1.0 - 0.6 * seam);
  float glow = exp(-max(d, 0.0) * 7.0) * (0.85 + 0.15 * uA.x);
  float below = smoothstep(0.1, -0.3, c.y);
  wall += vec3(0.9, 0.32, 0.07) * glow * (0.35 + 0.45 * below) + vec3(1.0, 0.6, 0.3) * rivet * glow * 0.5;
  // The door frame: thick iron, its inner edge lit by the fire.
  float frame = smoothstep(0.045, 0.04, d) * step(0.0, d);
  vec3 col = mix(wall, vec3(0.1, 0.05, 0.03) + vec3(1.0, 0.45, 0.12) * smoothstep(0.04, 0.0, d) * 0.9, frame);
  // Inside: flames rising off a bed of coal, in slow motion.
  if (d < 0.0) {
    float n = fbm(vec2(c.x * 5.0, c.y * 3.5 - t * 1.5) + 0.7 * fbm3(c * 4.0 + vec2(0.0, -t * 0.4)));
    float hgt = c.y + 0.15;
    float heat = 1.35 - hgt * 3.4 + (n - 0.5) * 1.9 + 0.1 * uA.x;
    vec3 fire = fireRamp(heat * 0.85);
    vec3 cl = cells(c * vec2(14.0, 18.0) + 3.0);
    float bed = smoothstep(-0.06, -0.1, c.y + 0.02 * sin(c.x * 30.0));
    vec3 coal = fireRamp(0.55 + 0.5 * smoothstep(0.12, 0.0, cl.y) - 0.3 * cl.x + 0.2 * noise(c * 20.0 + t));
    fire = mix(fire, coal, bed);
    col = fire * smoothstep(0.0, -0.035, d) + vec3(0.25, 0.08, 0.02) * smoothstep(-0.035, 0.0, d);
  }
  outColor = vec4(film(col), 1.0);
}`);

// Each stack: [x, top, width] in centered coordinates.
const STACKS = [[-0.78, 0.02, 0.03], [-0.42, 0.21, 0.044], [-0.17, 0.33, 0.052], [0.05, 0.13, 0.04], [0.23, 0.27, 0.048], [0.5, 0.06, 0.036], [0.76, 0.19, 0.042]];
const TOWN = [[-0.95, -0.06], [-0.7, 0.02], [-0.46, -0.03], [-0.28, 0.07], [-0.08, -0.01], [0.14, 0.05], [0.38, -0.04], [0.66, 0.03]];

function smokeSky(ctx, f, p, soot, o) {
  const s = [...(o.stacks || [])];
  while (s.length < 8) s.push([99, 99]);
  const ok = shade(ctx, f, p, SMOKE, {
    uT: f.t * (f.reduced ? 0.4 : 1),
    uA: [soot, o.wind, o.ceiling, o.horizon ?? -0.6],
    uB: [o.sun[0], o.sun[1], o.sun[2], 0],
    uC: [...(o.train || [0, 0, 0]), o.spread || 0],
    uD: s.slice(0, 4).map((a) => a[0]), uE: s.slice(0, 4).map((a) => a[1]),
    uF: s.slice(4, 8).map((a) => a[0]), uG: s.slice(4, 8).map((a) => a[1]),
  });
  if (ok) return;
  gradient(ctx, f, ['#3a1c0e', '#a24a18', '#e8a048']);
  const y = f.h / 2 - (o.horizon ?? -0.6) * f.h;
  ctx.fillStyle = '#140c07';
  ctx.fillRect(0, y, f.w, f.h - y);
}

// A tapered brick stack with a lip and two iron bands.
function drawStack(ctx, X, Y, h, x, top, base, wt, color) {
  const wb = wt * 1.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X(x - wb / 2), Y(base));
  ctx.lineTo(X(x - wt / 2), Y(top));
  ctx.lineTo(X(x + wt / 2), Y(top));
  ctx.lineTo(X(x + wb / 2), Y(base));
  ctx.fill();
  ctx.fillRect(X(x - wt * 0.68), Y(top), wt * 1.36 * h, wt * 0.3 * h);
  ctx.fillRect(X(x - wt * 0.6), Y(top - wt * 0.9), wt * 1.2 * h, wt * 0.15 * h);
}

// Shot 1: tall stacks from the ground, plumes bending in the wind.
function stacksShot(ctx, f, p, soot) {
  const [X, Y] = frameMap(f);
  smokeSky(ctx, f, p, soot, { stacks: STACKS, wind: 0.7, ceiling: 0.15 + 0.5 * soot, sun: [0.12, -0.14, 0.05] });
  for (const [x, top, wt] of STACKS) drawStack(ctx, X, Y, f.h, x, top, -0.5, wt, '#0d0806');
  // Works at the stacks' feet: sheds, a gantry, a boiler house.
  ctx.fillStyle = '#0a0604';
  ctx.beginPath();
  ctx.moveTo(0, f.h);
  let x = -1.2;
  for (let i = 0; x < 1.2; i++) {
    const wd = 0.08 + hash(i, 3) * 0.14, ht = -0.42 + hash(i, 5) * 0.1;
    ctx.lineTo(X(x), Y(ht));
    if (hash(i, 9) > 0.5) ctx.lineTo(X(x + wd / 2), Y(ht + 0.035));
    ctx.lineTo(X(x + wd), Y(ht));
    x += wd;
  }
  ctx.lineTo(f.w, f.h);
  ctx.fill();
}

// Shot 2: a train crosses the plain towards a low sun, trailing smoke.
function trainShot(ctx, f, p, soot) {
  const [X, Y] = frameMap(f);
  const hor = -0.1, u = 1.5;
  const speed = 0.11;
  const lx = 0.3 - speed * f.shotT * (f.reduced ? 0.5 : 1);
  const b = hor + 0.004, top = b + 0.034 * u;
  const works = [[-0.9, hor + 0.03], [-0.84, hor + 0.024]];
  smokeSky(ctx, f, p, soot, { wind: 0.3, ceiling: 0.08 + 0.3 * soot, horizon: hor, sun: [-0.3, -0.06, 0.045], train: [lx + 0.006 * u, top, speed], stacks: works, spread: 0.07 });
  const k = f.h;
  ctx.fillStyle = '#0b0705';
  ctx.fillRect(0, Y(hor + 0.003), f.w, 0.005 * k); // the embankment
  for (const [x, t] of works) drawStack(ctx, X, Y, k, x, t, hor, 0.006, '#2a160c');
  // The locomotive, its tender and seven wagons, drawn in train units of u.
  const r = (x, y, wd, ht) => ctx.fillRect(X(lx + x * u), Y(b + (y + ht) * u), wd * u * k, ht * u * k);
  r(-0.012, 0.008, 0.044, 0.016); // boiler
  r(0.03, 0.004, 0.02, 0.028); // cab
  r(0.001, 0.02, 0.008, 0.014); // chimney
  r(0.003, 0.024, 0.012, 0.004); // its lip
  r(0.012, 0.022, 0.006, 0.004); // dome
  r(-0.014, 0.0, 0.066, 0.009); // frame and wheels
  r(0.054, 0.0, 0.03, 0.02); // tender
  for (let i = 0; i < 7; i++) r(0.088 + i * 0.036, 0.0, 0.033, i % 3 ? 0.019 : 0.023);
  ctx.beginPath();
  ctx.moveTo(X(lx - 0.024 * u), Y(b)); ctx.lineTo(X(lx - 0.012 * u), Y(b + 0.01 * u)); ctx.lineTo(X(lx - 0.012 * u), Y(b));
  ctx.fill();
  // The headlamp.
  ctx.globalCompositeOperation = 'lighter';
  const s = 0.05 * k * u;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(SPRITES.glow, X(lx - 0.014 * u) - s / 3, Y(b + 0.018 * u) - s / 3, s / 1.5, s / 1.5);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// Shot 3: the furnace mouth.
function furnaceShot(ctx, f, p) {
  const breath = 0.5 + 0.5 * Math.cos((f.beat % 4) / 4 * TAU);
  if (shade(ctx, f, p, FURNACE, { uA: [breath, 0, 0, 0] })) return;
  const [X, Y] = frameMap(f);
  ctx.fillStyle = '#120906';
  ctx.fillRect(0, 0, f.w, f.h);
  const g = ctx.createRadialGradient(X(0), Y(0.04), 0, X(0), Y(0.04), f.h * 0.3);
  g.addColorStop(0, '#fff0b0');
  g.addColorStop(0.5, '#f07020');
  g.addColorStop(1, '#3a1206');
  ctx.fillStyle = g;
  ctx.fillRect(X(-0.25), Y(0.21), 0.5 * f.h, 0.3 * f.h);
}

// Shot 4: rows of sawtooth roofs; every chimney puffs on the beat.
function roofsShot(ctx, f, p, soot) {
  const [X, Y] = frameMap(f);
  const k = f.h;
  smokeSky(ctx, f, p, soot, { wind: 0.5, ceiling: 0.05 + 0.2 * soot, horizon: -0.06, sun: [0.3, 0.03, 0.045] });
  // Rows from far to near: base, tooth width, roof colour (hazier when far), glass.
  const rows = [
    [-0.08, 0.07, '#5e3824', '#e8a060'], [-0.2, 0.12, '#3a2214', '#d08848'], [-0.34, 0.19, '#22140c', '#c07a3c'], [-0.54, 0.3, '#100907', '#a86430'],
  ];
  rows.forEach(([base, tw, color, glass], r) => {
    // Smoke lying in the yards between the rows, so each row stands clear of the next.
    if (r) {
      const fog = ctx.createLinearGradient(0, Y(base + tw * 0.9), 0, Y(base + tw * 0.2));
      fog.addColorStop(0, 'rgba(150,80,36,0)');
      fog.addColorStop(1, `rgba(150,80,36,${0.5 - r * 0.08})`);
      ctx.fillStyle = fog;
      ctx.fillRect(0, Y(base + tw * 0.9), f.w, (tw * 0.7) * k + 1);
    }
    const th = tw * 0.55;
    const x0 = -1.2 - fract(r * 0.37) * tw;
    const n = Math.ceil(2.4 / tw) + 1;
    // Puffs first, so the row's own roofs hide the chimney mouths' base.
    const chimneys = [];
    for (let i = 0; i < n; i++) if ((i + r) % (r === 1 ? 3 : 4) === 1) chimneys.push(i);
    for (const i of chimneys) {
      const cx = x0 + i * tw + tw * 0.55, ct = base + th * 2.4;
      for (let a = 0; a < 5; a++) {
        const born = Math.floor(f.beat) - a;
        if ((born + i + r) % 2) continue;
        const age = f.beat - born;
        // A column of separate puffs, one per two beats, rising and swelling.
        const size = tw * (0.35 + 0.8 * (1 - Math.exp(-age * 3)) + 0.3 * age) * (0.8 + 0.4 * soot);
        const alpha = clamp(age * 8) * (1 - age / 5) ** 1.5;
        const px = cx + age * age * tw * 0.06, py = ct + tw * 0.15 + age * tw * 0.75;
        // White steam early in the century, coal smoke later.
        for (const [sprite, amount] of [[SPRITES.steam, 1 - soot * 0.8], [SPRITES.puff, soot]]) {
          ctx.globalAlpha = alpha * amount;
          ctx.drawImage(sprite, X(px) - size * k / 2, Y(py) - size * k / 2, size * k, size * k);
        }
      }
    }
    ctx.globalAlpha = 1;
    // The roofs: a glazed north light, then the long slope, darker towards the gutter.
    const shadeRoof = ctx.createLinearGradient(0, Y(base + th), 0, Y(base));
    shadeRoof.addColorStop(0, color);
    shadeRoof.addColorStop(1, '#070403');
    ctx.fillStyle = shadeRoof;
    ctx.beginPath();
    ctx.moveTo(X(x0), f.h);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * tw;
      ctx.lineTo(X(x), Y(base));
      ctx.lineTo(X(x + tw * 0.14), Y(base + th));
    }
    ctx.lineTo(X(x0 + n * tw), f.h);
    ctx.fill();
    for (const i of chimneys) {
      const cx = x0 + i * tw + tw * 0.55;
      ctx.fillRect(X(cx - tw * 0.09), Y(base + th * 2.4), tw * 0.18 * k, th * 2.4 * k);
      ctx.fillRect(X(cx - tw * 0.12), Y(base + th * 2.4), tw * 0.24 * k, th * 0.2 * k);
    }
    // The north lights: glazing up each steep face, lit from inside the works,
    // cut into panes by glazing bars.
    const pane = ctx.createLinearGradient(0, Y(base + th), 0, Y(base));
    pane.addColorStop(0, glass);
    pane.addColorStop(1, 'rgba(60,24,8,0.2)');
    ctx.fillStyle = pane;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * tw;
      ctx.moveTo(X(x + tw * 0.02), Y(base + th * 0.12));
      ctx.lineTo(X(x + tw * 0.125), Y(base + th * 0.9));
      ctx.lineTo(X(x + tw * 0.2), Y(base + th * 0.84));
      ctx.lineTo(X(x + tw * 0.1), Y(base + th * 0.08));
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, tw * k * 0.012);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * tw;
      for (let q = 1; q < 5; q++) {
        const u = q / 5;
        ctx.moveTo(X(x + tw * (0.02 + 0.105 * u)), Y(base + th * (0.12 + 0.78 * u)));
        ctx.lineTo(X(x + tw * (0.1 + 0.1 * u)), Y(base + th * (0.08 + 0.76 * u)));
      }
    }
    ctx.stroke();
    // The low sun behind catches every ridge.
    ctx.strokeStyle = `rgba(255,170,90,${0.5 - r * 0.08})`;
    ctx.lineWidth = Math.max(1, tw * k * 0.01);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * tw;
      ctx.moveTo(X(x + tw * 0.14), Y(base + th));
      ctx.lineTo(X(x + tw * 0.6), Y(base + th * 0.52));
    }
    ctx.stroke();
  });
}

// Shot 5: under the truss of an iron bridge, a panel passing on every beat.
function bridgeShot(ctx, f, p, soot) {
  const { w, h } = f;
  smokeSky(ctx, f, p, soot, { wind: 0.2, ceiling: 0.2 + 0.4 * soot, horizon: -0.03, sun: [0, 0.0, 0.035] });
  const F = h * 0.85, cx = w / 2, cy = h / 2;
  const W = 0.8, top = 1.05, deck = -0.42;
  const travel = stepBeat(f.beat, 0.55) * (f.reduced ? 0.5 : 1);
  const base = Math.floor(travel), off = travel - base;
  const P = (x, y, z) => [cx + (F * x) / z, cy - (F * y) / z];
  const line = (a, b) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); };
  ctx.lineCap = 'square';
  for (let i = 40; i >= 0; i--) {
    const z0 = i + 1 - off, z1 = z0 + 1;
    if (z0 < 0.2) continue;
    // Far members sink into the haze.
    const haze = clamp((z0 - 1) / 26);
    ctx.strokeStyle = `rgb(${mix(12, 150, haze)},${mix(8, 78, haze)},${mix(6, 36, haze)})`;
    ctx.lineWidth = Math.max(0.8, (F * 0.05) / z0);
    ctx.beginPath();
    const odd = (i + base) % 2 ? 1 : -1;
    for (const s of [-1, 1]) {
      line(P(s * W, deck, z0), P(s * W, top, z0)); // post
      line(P(s * W, deck, odd > 0 ? z0 : z1), P(s * W, top, odd > 0 ? z1 : z0)); // diagonal
      line(P(s * W, top - 0.25, z0), P(s * W * 0.72, top, z0)); // knee brace
      line(P(s * W, top, z0), P(-s * W, top, z1)); // overhead cross bracing
    }
    line(P(-W, top, z0), P(W, top, z0)); // strut
    ctx.stroke();
    // Sleepers under the rails.
    ctx.lineWidth = Math.max(0.6, (F * 0.02) / z0);
    ctx.beginPath();
    for (let q = 0; q < 4; q++) line(P(-0.4, deck, z0 + q / 4), P(0.4, deck, z0 + q / 4));
    ctx.stroke();
  }
  // Chords and rails run to the vanishing point, tapering.
  ctx.fillStyle = '#0c0806';
  for (const [x, y, wd] of [[-W, top, 0.07], [W, top, 0.07], [-W, deck, 0.07], [W, deck, 0.07], [-0.22, deck, 0.012], [0.22, deck, 0.012]]) {
    const a = P(x, y, 0.3), d = (F * wd) / 0.3;
    const horiz = Math.abs(y) > Math.abs(x) * 0.9;
    ctx.beginPath();
    if (horiz) { ctx.moveTo(a[0] - d, a[1]); ctx.lineTo(a[0] + d, a[1]); } else { ctx.moveTo(a[0], a[1] - d); ctx.lineTo(a[0], a[1] + d); }
    ctx.lineTo(cx, cy);
    ctx.fill();
  }
}

// Shot 6: the whole town from the hill, its smoke becoming the sky.
function townShot(ctx, f, p, soot) {
  const [X, Y] = frameMap(f);
  const k = f.h;
  const hor = -0.16;
  smokeSky(ctx, f, p, soot, { stacks: TOWN, spread: 0.1, wind: 0.55, ceiling: 0.45 + 0.45 * soot, horizon: hor - 0.02, sun: [-0.22, -0.03, 0.04] });
  // Mills and their stacks on the valley floor.
  ctx.fillStyle = '#1e1009';
  for (const [x, top] of TOWN) drawStack(ctx, X, Y, k, x, top, hor, 0.016, '#1e1009');
  ctx.beginPath();
  ctx.moveTo(0, f.h);
  for (let x = -1.2, i = 0; x < 1.2; i++) {
    const wd = 0.03 + hash(i, 1) * 0.06, ht = hor + 0.01 + hash(i, 2) * 0.035;
    ctx.lineTo(X(x), Y(ht)); ctx.lineTo(X(x + wd), Y(ht));
    x += wd;
  }
  ctx.lineTo(f.w, f.h);
  ctx.fill();
  // Terraced houses down the hill, chimney pots, a few lit windows.
  for (let r = 0; r < 3; r++) {
    const base = hor - 0.1 - r * 0.12, sw = 0.08 + r * 0.04;
    ctx.fillStyle = ['#140a06', '#0e0704', '#080403'][r];
    ctx.beginPath();
    ctx.moveTo(0, f.h);
    for (let x = -1.2 - r * 0.013, i = 0; x < 1.2; i++, x += sw) {
      ctx.lineTo(X(x), Y(base));
      ctx.lineTo(X(x + sw / 2), Y(base + sw * 0.45));
      ctx.lineTo(X(x + sw), Y(base));
    }
    ctx.lineTo(f.w, f.h);
    ctx.fill();
    for (let x = -1.2 - r * 0.013, i = 0; x < 1.2; i++, x += sw) {
      if (hash(i, r) > 0.4) ctx.fillRect(X(x + sw * 0.72), Y(base + sw * 0.4), sw * 0.08 * k, sw * 0.3 * k);
    }
    ctx.fillStyle = '#d88a3a';
    for (let x = -1.2 - r * 0.013, i = 0; x < 1.2; i++, x += sw) {
      if (hash(i, r + 7) > 0.8) ctx.fillRect(X(x + sw * 0.3), Y(base - sw * 0.3), sw * 0.12 * k, sw * 0.16 * k);
    }
  }
}

const steam = {
  id: 'steam',
  init: makeSprites,
  render(ctx, f, p) {
    makeSprites();
    // Smoke thickens and darkens as the century goes on.
    const soot = clamp(0.2 + 0.8 * f.progress);
    const shots = [stacksShot, trainShot, furnaceShot, roofsShot, bridgeShot, townShot];
    shots[f.shot % shots.length](ctx, f, p, soot);
  },
};

// ---------------------------------------------------------------------------
// Coal, 1900: the furnace, close. Choice 2.
// uA.x: roar, uA.y: calm. Both follow the share of the coal the viewer chose
// to burn: 0.3 or less is calm, 1 is a roar, and anything between is a mix.

const COAL = frag(`
void main() {
  vec2 p = centered();
  float roar = uA.x, calm = uA.y;
  float t = uT * 0.3;
  float surface = 0.03 * (fbm3(vec2(p.x * 2.5, 1.0)) - 0.5) + 0.035 * noise(vec2(p.x * 11.0, 2.0)) + 0.015 * noise(vec2(p.x * 31.0, 4.0)) - 0.03;
  float h = p.y - surface;
  vec3 col = vec3(0.012, 0.006, 0.004);
  // Flames, slow: taller and hungrier when roaring, low and steady when calm.
  float fh = 0.22 * (1.0 + 1.3 * roar - 0.45 * calm);
  float n = fbm(vec2(p.x * 3.2, h * 2.4 - t * (1.6 + roar)) + 0.8 * fbm3(vec2(p.x * 2.0, h * 1.5 - t * 0.7)));
  // Calm: separate small tongues, each one swaying on its own, blue at the root.
  float sway = p.x * 22.0 + 7.0 * fbm3(vec2(p.x * 1.3, t * 0.15)) + 1.6 * fbm3(vec2(p.x * 3.0, h * 4.0 - t * 1.2));
  float tongue = pow(0.5 + 0.5 * sin(sway), 2.0) * (0.3 + 1.2 * noise(vec2(floor(sway / 6.2832) * 1.7, t * 0.5)));
  fh *= mix(1.0, 0.35 + 1.1 * tongue, calm);
  float flame = clamp(1.0 - h / fh + (n - 0.5) * (1.8 - 0.6 * calm), 0.0, 1.4);
  col += fireRamp(flame * (0.85 - 0.1 * roar)) * smoothstep(-0.01, 0.02, h);
  col += vec3(0.08, 0.16, 0.5) * calm * smoothstep(0.0, 0.01, h) * exp(-h * 40.0) * (0.4 + tongue);
  // Smoke rolling over the flames, then soot.
  float sm = fbm(p * 2.5 - vec2(t * 0.3, t * 1.4)) * smoothstep(0.02, 0.4, h);
  col = mix(col, vec3(0.035, 0.026, 0.022), clamp(sm * (0.3 + 1.1 * roar) * (1.0 - 0.7 * calm), 0.0, 1.0));
  // The bed of coal: glossy black lumps, glowing where they touch near the top.
  if (h < 0.0) {
    float depth = clamp(-h / 0.3, 0.0, 1.0);
    vec2 q = vec2(p.x, p.y * 1.5) * mix(8.0, 5.5, depth);
    q += 0.35 * vec2(fbm3(q * 0.7), fbm3(q * 0.7 + 5.0));
    vec3 cl = cells(q);
    float life = noise(vec2(cl.z * 40.0, t * (0.6 - 0.35 * calm)));
    float hot = exp(-depth * 3.5) * (0.5 + 0.5 * life) * (1.0 + 0.35 * roar - 0.1 * calm);
    // Crevices between lumps: dark, and glowing only in places, slowly shifting.
    float crev = smoothstep(0.08, 0.0, cl.y);
    float seam = crev * hot * smoothstep(0.35, 0.75, noise(q * 2.2 + vec2(t * 0.4, -t * 0.25)));
    float crack = smoothstep(0.025, 0.0, abs(fbm3(q * 1.3 + cl.z * 9.0) - 0.5)) * smoothstep(0.5, 0.85, life) * hot;
    float dome = clamp(1.0 - cl.x * 1.3, 0.0, 1.0);
    vec3 lump = vec3(0.025, 0.022, 0.024) * (0.4 + dome);
    // Firelight glancing off the glossy tops, and a cold sheen deeper down.
    lump += vec3(0.9, 0.4, 0.12) * pow(dome, 4.0) * smoothstep(0.0, 0.5, cl.y) * exp(-depth * 4.0) * 0.5;
    lump += vec3(0.06, 0.07, 0.09) * pow(dome, 6.0) * (1.0 - depth) * 0.6;
    lump += fireRamp(0.45 * hot + 0.2 * fbm3(q * 3.0 + t)) * hot * 0.5 * smoothstep(0.1, 0.0, cl.y + 0.02);
    col = lump * (1.0 - 0.8 * crev) + fireRamp(seam * 1.25) + fireRamp(crack * 0.9) * 0.7;
    col *= mix(1.0, 0.25, smoothstep(0.05, 0.3, -h));
  }
  // A haze of heat in the air; clearer when calm, sooty when roaring.
  col += vec3(0.2, 0.06, 0.01) * exp(-abs(h) * 4.0) * (0.6 + 0.8 * roar - 0.4 * calm);
  col *= 1.0 - 0.45 * roar * smoothstep(0.2, 0.9, length(p * vec2(0.8, 1.2)));
  outColor = vec4(film(col), 1.0);
}`);

const coal = {
  id: 'coal',
  render(ctx, f, p) {
    const pr = f.params;
    const amount = amountOf(pr, 'coal');
    const e = pr.answered && amount !== null ? smoothstep(0, 8, f.beat - (pr.answeredBeat || 0)) : 0;
    const r = clamp((amount - 0.3) / 0.7);
    const roar = e * r, calm = e * (1 - r);
    if (shade(ctx, f, p, COAL, { uT: f.t * (f.reduced ? 0.5 : 1), uA: [roar, calm, 0, 0] })) return;
    gradient(ctx, f, ['#050302', roar > 0.5 ? '#6a2008' : '#8a3a0c', '#e07a20', '#2a0c04', '#060302']);
  },
};

// ---------------------------------------------------------------------------
// The Grid, 1950–1988. Night, time-lapse, everything moving on the beat. Eight
// compositions, mirrored on alternate cycles as the cuts get faster. Nothing
// flashes: each shot keeps a steady average brightness, lights move rather
// than blink.

// The city from high above: two families of streets running to the horizon.
function cityShot(ctx, f, o) {
  const { w, h } = f;
  const hy = h * 0.2;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#05060c');
  sky.addColorStop(0.2, '#2a1a22');
  sky.addColorStop(0.24, '#0c0a0e');
  sky.addColorStop(1, '#040408');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const F = o.S * 1.1, H = 3, ang = 0.55 + o.cycle * 0.2;
  const cam = stepBeat(f.beat, 0.5) * 0.5 * o.speed;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const toCam = (u, v) => [ca * u - sa * v, sa * u + ca * v - cam];
  const proj = ([x, z]) => [w / 2 + (F * x) / z, hy + (F * H) / z];
  // A segment on the ground, clipped to the near plane.
  const seg = (a, b) => {
    let A = toCam(...a), B = toCam(...b);
    const near = 0.5;
    if (A[1] < near && B[1] < near) return;
    if (A[1] < near) { const t = (near - A[1]) / (B[1] - A[1]); A = [A[0] + (B[0] - A[0]) * t, near]; }
    if (B[1] < near) { const t = (near - B[1]) / (A[1] - B[1]); B = [B[0] + (A[0] - B[0]) * t, near]; }
    const pa = proj(A), pb = proj(B);
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
  };
  const R = 60;
  ctx.globalCompositeOperation = 'lighter';
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? 'rgba(255,170,80,0.6)' : 'rgba(240,140,60,0.32)';
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.beginPath();
    for (let i = -R; i <= R; i++) {
      if ((i % 5 === 0) !== major) continue;
      seg([i, -R], [i, R]);
      seg([-R, i], [R, i]);
    }
    ctx.stroke();
  }
  // Lights inside the nearer blocks.
  for (const [color, seed] of [['rgba(255,214,160,0.75)', 0], ['rgba(200,235,255,0.6)', 70]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const cu = sa * (cam + 15), cv = ca * (cam + 15);
    for (let u = Math.floor(cu) - 22; u < cu + 22; u++) for (let v = Math.floor(cv) - 22; v < cv + 22; v++) {
      // Skip blocks outside the view before placing their lights.
      const cc = toCam(u + 0.5, v + 0.5);
      if (cc[1] < 2.8 || cc[1] > 34.8 || Math.abs(cc[0]) > (cc[1] * w) / (2 * F) + 1) continue;
      for (let j = 0; j < 5; j++) {
        const c = toCam(u + 0.12 + hash(u, v + j * 50 + seed) * 0.76, v + 0.12 + hash(v, u + j * 30 + seed) * 0.76);
        if (c[1] < 3.5 || c[1] > 34) continue;
        const [x, y] = proj(c);
        if (x < 0 || x > w || y > h) continue;
        const s = Math.max(1.2, 12 / c[1]);
        ctx.rect(x, y, s, s);
      }
    }
    ctx.fill();
  }
  // Pulses along the avenues: convoys of headlights, one block per beat.
  const flow = stepBeat(f.beat, 0.6) * 0.5 * o.speed;
  for (const [color, dir] of [['rgba(255,250,235,0.9)', 1], ['rgba(255,70,50,0.85)', -1]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = -R; i <= R; i += 5) {
      for (let n = -12; n < 12; n++) {
        const v = n * 5 + fract((flow * dir + hash(i) * 5) / 5) * 5 + (dir > 0 ? 0 : 2.5);
        const lane = dir * 0.1;
        if ((i / 5 + n) % 2) seg([i + lane, v], [i + lane, v + 1.2]);
        else seg([v, i + lane], [v + 1.2, i + lane]);
      }
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const haze = ctx.createLinearGradient(0, hy - h * 0.05, 0, hy + h * 0.12);
  haze.addColorStop(0, 'rgba(40,24,30,0)');
  haze.addColorStop(0.35, 'rgba(70,42,40,0.8)');
  haze.addColorStop(1, 'rgba(20,14,20,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, hy - h * 0.05, w, h * 0.17);
}

// The interchange from straight above, a long exposure: every lane a faint
// river of light, cars as streaks of different lengths, four cloverleaf loops
// tangent to the highways, sodium lamps along the edges.
function freewayShot(ctx, f, o) {
  const { w, h } = f;
  const S = o.S;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  // The camera turns slowly over the shot, as if the aircraft were circling.
  ctx.rotate(-0.22 + o.cycle * 0.35 + f.shotBeat * 0.004);
  const L = 1.2 * Math.hypot(w, h);
  // Blocks around, dim, and the roads' concrete.
  ctx.strokeStyle = 'rgba(210,130,60,0.12)';
  ctx.lineWidth = Math.max(1, S * 0.002);
  ctx.beginPath();
  for (let i = -14; i <= 14; i++) {
    if (!i) continue;
    const x = i * 0.13 * S + (hash(i, 4) - 0.5) * 0.03 * S;
    ctx.moveTo(x, -L); ctx.lineTo(x, L);
    ctx.moveTo(-L, x); ctx.lineTo(L, x);
  }
  ctx.stroke();
  // Lit windows and yard lights in the blocks, avoiding the highways.
  ctx.fillStyle = 'rgba(255,200,140,0.4)';
  ctx.beginPath();
  for (let i = 0; i < 900; i++) {
    const x = (hash(i, 1) - 0.5) * 2 * L, y = (hash(i, 2) - 0.5) * 2 * L;
    if (Math.abs(x) < 0.12 * S || Math.abs(y) < 0.12 * S) continue;
    const q = 1 + hash(i, 3) * 2;
    ctx.rect(x, y, q, q);
  }
  ctx.fill();
  const R = 0.12 * S; // loop radius
  const road = 0.09 * S; // half width of a highway
  const c = R + road + 0.01 * S; // loop centres sit so each loop meets both highways
  ctx.strokeStyle = '#141519';
  ctx.lineWidth = road * 2;
  ctx.beginPath();
  ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.moveTo(0, -L); ctx.lineTo(0, L);
  ctx.stroke();
  ctx.lineWidth = 0.035 * S;
  ctx.beginPath();
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.moveTo(sx * c + R, sy * c);
    ctx.arc(sx * c, sy * c, R, 0, TAU);
  }
  ctx.stroke();
  // Lanes: four each way on each highway, and the loops.
  const lanes = [];
  for (let i = 0; i < 4; i++) {
    const off = (0.014 + i * 0.019) * S;
    lanes.push({ dir: 1, pt: (s) => [(-1 + 2 * s) * L, off] }, { dir: -1, pt: (s) => [(1 - 2 * s) * L, -off] });
    lanes.push({ dir: 1, pt: (s) => [-off, (-1 + 2 * s) * L] }, { dir: -1, pt: (s) => [off, (1 - 2 * s) * L] });
  }
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    lanes.push({ dir: sx * sy, loop: true, pt: (s) => [sx * c + Math.cos(s * TAU * sx * sy) * R, sy * c + Math.sin(s * TAU * sx * sy) * R] });
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  // Sodium lamps along the highway edges.
  ctx.fillStyle = 'rgba(255,150,60,0.55)';
  ctx.beginPath();
  for (let k = -40; k <= 40; k++) {
    const a = k * 0.06 * S, b = road + 0.006 * S, q = Math.max(1.5, S * 0.004);
    if (Math.abs(a) < c + R) continue;
    for (const sgn of [-1, 1]) { ctx.rect(a - q / 2, sgn * b - q / 2, q, q); ctx.rect(sgn * b - q / 2, a - q / 2, q, q); }
  }
  ctx.fill();
  // The long exposure: every lane a faint continuous line.
  for (const white of [true, false]) {
    ctx.strokeStyle = white ? 'rgba(255,240,215,0.1)' : 'rgba(255,60,40,0.12)';
    ctx.lineWidth = Math.max(1, S * 0.006);
    ctx.beginPath();
    lanes.forEach((lane) => {
      if ((lane.dir > 0) !== white) return;
      const steps = lane.loop ? 40 : 1;
      let [x, y] = lane.pt(0);
      ctx.moveTo(x, y);
      for (let q = 1; q <= steps; q++) { [x, y] = lane.pt(q / steps); ctx.lineTo(x, y); }
    });
    ctx.stroke();
  }
  // Cars: continuous flow plus a surge on every beat. Streaks lengthen with
  // tempo; each car has its own place, speed and length, so no lane is a dash pattern.
  const move = (0.5 * f.beat + 0.5 * stepBeat(f.beat, 0.5)) * 0.022 * o.speed;
  const len = 0.012 + 0.04 * (o.speed - 1);
  for (const [white, lw, alpha] of [[true, 6, 0.1], [true, 1.8, 0.85], [false, 6, 0.12], [false, 1.8, 0.85]]) {
    ctx.strokeStyle = white ? `rgba(255,246,228,${alpha})` : `rgba(255,56,40,${alpha})`;
    ctx.lineWidth = lw * Math.max(0.6, S / 700);
    ctx.beginPath();
    lanes.forEach((lane, li) => {
      if ((lane.dir > 0) !== white) return;
      const n = lane.loop ? 6 : 26;
      for (let i = 0; i < n; i++) {
        const sp = (lane.loop ? 4.5 : 1) * (0.85 + 0.3 * hash(li, i + 50));
        const s = fract(hash(li, i) + move * sp);
        const ln = len * (0.5 + 1.3 * hash(i, li + 9)) * (lane.loop ? 5 : 1);
        const steps = lane.loop ? 6 : 1;
        let [x, y] = lane.pt(s);
        ctx.moveTo(x, y);
        for (let q = 1; q <= steps; q++) {
          [x, y] = lane.pt(s - (ln * q) / steps);
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
  }
  ctx.restore();
}

// A tower's face, looking up: windows switching in patterns, on the beat.
function facadeShot(ctx, f, o) {
  const { w, h } = f;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#04050c');
  sky.addColorStop(1, '#141626');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const B = Math.floor(f.beat);
  const kind = (Math.floor(f.beat / 4) + o.cycle) % 4;
  const lit = (c, r, b) => {
    if (kind === 0) return (c + r + b) % 6 < 3;
    if (kind === 1) return (Math.abs(c - 11) + r + 2 * b) % 8 < 4;
    if (kind === 2) return hash(c * 3 + b, r) < 0.5;
    return (r + b * 3) % 12 < 6 !== (c % 2 === 0);
  };
  // The fade between patterns: short, so a window turns rather than flashes.
  const blend = smoothstep(0, 0.25, f.beat - B);
  const towers = [[0, 1, 1], [-0.68, 0.75, 0.6], [0.68, 0.75, 0.6], [-1.3, 0.75, 0.45], [1.3, 0.75, 0.45]];
  const buckets = new Map();
  const add = (key, x, y, ww, hh) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(x, y, ww, hh);
  };
  for (const [tx, scale, bright] of towers) {
    const cx = w / 2 + tx * o.S * 0.9;
    const wb = o.S * 0.62 * scale, wt = o.S * 0.44 * scale;
    if (cx + wb / 2 < 0 || cx - wb / 2 > w) continue; // off the frame
    const C = 22, R = 56;
    ctx.fillStyle = '#0b0c12';
    ctx.beginPath();
    ctx.moveTo(cx - wb / 2 - 4, h); ctx.lineTo(cx - wt / 2 - 4, -2); ctx.lineTo(cx + wt / 2 + 4, -2); ctx.lineTo(cx + wb / 2 + 4, h);
    ctx.fill();
    for (let r = 0; r < R; r++) {
      const v0 = (r / R) ** 0.8, v1 = ((r + 1) / R) ** 0.8;
      const y0 = h - v0 * h, y1 = h - v1 * h;
      const wd = mix(wb, wt, (v0 + v1) / 2);
      for (let c = 0; c < C; c++) {
        const on = mix(lit(c, r, B - 1) ? 1 : 0, lit(c, r, B) ? 1 : 0, blend);
        const level = Math.round((0.12 + 0.88 * on) * bright * 4);
        const warm = hash(c + tx * 10, r) > 0.35 ? 'w' : 'c';
        const x = cx - wd / 2 + (c + 0.2) * (wd / C);
        add(warm + level, x, y1 + (y0 - y1) * 0.25, (wd / C) * 0.62, (y0 - y1) * 0.6);
      }
    }
  }
  for (const [key, rects] of buckets) {
    const lv = Number(key.slice(1)) / 4;
    ctx.fillStyle = key[0] === 'w' ? `rgba(255,196,120,${lv * 0.85})` : `rgba(190,235,230,${lv * 0.75})`;
    ctx.beginPath();
    for (let i = 0; i < rects.length; i += 4) ctx.rect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
    ctx.fill();
  }
}

// A crossing from above: crowds wait, surge across, and wait again.
function crowdShot(ctx, f, o) {
  const { w, h } = f;
  // On a narrow frame, pull back so both kerbs and their crowds stay in shot.
  const S = Math.min(o.S, w * 0.75);
  ctx.fillStyle = '#1c1b1a';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const road = 0.24 * S;
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(cx - road, 0, road * 2, h);
  ctx.fillStyle = '#3e3d3a';
  for (let i = -7; i <= 7; i++) ctx.fillRect(cx + (i * road) / 7.5 - road / 34, cy - 0.3 * S, road / 17, 0.6 * S);
  ctx.fillStyle = '#3a3935';
  ctx.fillRect(cx - road - S * 0.01, 0, S * 0.01, h);
  ctx.fillRect(cx + road, 0, S * 0.01, h);
  // One bar per crossing. Each person: wait at the kerb, cross, walk away.
  const bars = f.beat / 4;
  const coats = ['#b8b0a0', '#7a7a82', '#c0a878', '#54565c', '#a04a38', '#d8d0c0', '#5a6a80'];
  const dots = new Map();
  const trails = [];
  for (let B = Math.floor(bars) - 1; B <= Math.floor(bars) + 1; B++) {
    const tau = bars - B;
    for (let i = 0; i < 300; i++) {
      const side = i % 2 ? 1 : -1;
      const r1 = hash(B * 1.3 + i, 1), r2 = hash(B + i * 0.7, 2), r3 = hash(i, B * 0.3 + 3);
      const y = cy + (r1 - 0.5) * 0.56 * S + (r3 - 0.5) * 0.06 * S;
      const queue = road + (0.015 + r2 * 0.2) * S;
      const t0 = 0.08 + r2 * 0.18, t1 = t0 + 0.38 + r3 * 0.15;
      let x, alpha = 1, vx = 0;
      if (tau < 0) {
        // Arriving at the kerb in the bar before.
        const a = smoothstep(-0.6, -0.1, tau + r3 * 0.1);
        x = side * mix(queue + 0.5 * S, queue, a);
        alpha = smoothstep(-0.65, -0.45, tau);
        vx = -side * (a > 0 && a < 1 ? 1 : 0);
      } else if (tau < t1) {
        const a = smoothstep(t0, t1, tau);
        x = side * mix(queue, -queue - r1 * 0.05 * S, a);
        vx = -side * (a > 0 && a < 1 ? 1.6 : 0);
      } else {
        const a = tau - t1;
        x = -side * (queue + r1 * 0.05 * S + a * 0.6 * S);
        alpha = 1 - smoothstep(0.2, 0.5, a);
        vx = -side;
      }
      if (alpha <= 0.02) continue;
      const px = cx + x, key = coats[(i + B * 3) % coats.length];
      if (!dots.has(key)) dots.set(key, []);
      dots.get(key).push(px, y, alpha);
      if (vx) trails.push(px, y, px + vx * 0.02 * S, y);
    }
  }
  // Streams along the pavements, a stride per beat.
  const walk = stepBeat(f.beat, 0.6);
  for (let i = 0; i < 220; i++) {
    const side = i % 2 ? 1 : -1, dir = hash(i, 8) > 0.5 ? 1 : -1;
    const x = cx + side * (road + (0.26 + hash(i, 5) * 0.5) * S);
    const y = fract(hash(i, 6) + dir * walk * (0.012 + hash(i, 7) * 0.01)) * (h + 20) - 10;
    const key = coats[i % coats.length];
    if (!dots.has(key)) dots.set(key, []);
    dots.get(key).push(x, y, 1);
    trails.push(x, y, x, y - dir * 0.02 * S);
  }
  ctx.strokeStyle = 'rgba(180,170,150,0.22)';
  ctx.lineWidth = S * 0.01;
  ctx.beginPath();
  for (let i = 0; i < trails.length; i += 4) { ctx.moveTo(trails[i], trails[i + 1]); ctx.lineTo(trails[i + 2], trails[i + 3]); }
  ctx.stroke();
  const r = Math.max(1.2, S * 0.0075);
  for (const [color, list] of dots) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 3) {
      if (list[i + 2] < 0.5) continue;
      ctx.moveTo(list[i] + r, list[i + 1]);
      ctx.arc(list[i], list[i + 1], r, 0, TAU);
    }
    ctx.fill();
  }
}

// Two belts of identical bottles; they advance one place per beat and the
// capper comes down while they rest.
function assemblyShot(ctx, f, o) {
  const { w, h } = f;
  const S = o.S;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0c1414');
  bg.addColorStop(1, '#040606');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const step = stepBeat(f.beat, 0.45);
  const pitch = 0.13 * S;
  const bw = pitch * 0.5, bh = bw * 2.66;
  const press = smoothstep(0.5, 0.62, f.beatPhase) * (1 - smoothstep(0.85, 1, f.beatPhase));
  // Fluorescent tubes overhead.
  ctx.fillStyle = 'rgba(190,230,220,0.45)';
  for (let x = 0; x < w / (0.5 * S) + 1; x++) ctx.fillRect(x * 0.5 * S + 0.05 * S, h * 0.05, 0.34 * S, 0.008 * S);
  [[0.46, 0], [0.9, -2]].forEach(([row, slot]) => {
    const by = h * row;
    const x0 = ((w / 2) % pitch) - pitch;
    const pressX = x0 + Math.round((w / 2 - x0) / pitch + slot) * pitch;
    // Belt and rollers.
    ctx.fillStyle = '#1c2222';
    ctx.fillRect(0, by, w, 0.022 * S);
    ctx.fillStyle = '#394242';
    for (let x = -1; x < w / (0.065 * S) + 1; x++) ctx.fillRect((x + fract(step * 2)) * 0.065 * S, by + 0.026 * S, 0.014 * S, 0.014 * S);
    for (let k = -1; k * pitch + x0 < w + pitch; k++) {
      const x = x0 + (k + fract(step)) * pitch;
      ctx.drawImage(SPRITES.bottle, x - bw / 2, by - bh, bw, bh);
      // Capped once it has been under the press.
      if (x > pressX + 1 || (Math.abs(x - pressX) < 1 && f.beatPhase > 0.6)) {
        ctx.fillStyle = '#c8d0d0';
        ctx.fillRect(x - bw * 0.2, by - bh - bw * 0.1, bw * 0.4, bw * 0.18);
      }
      ctx.globalAlpha = 0.12;
      ctx.drawImage(SPRITES.bottle, x - bw / 2, by + 0.024 * S, bw, bh * 0.3);
      ctx.globalAlpha = 1;
    }
    // The capping head.
    const drop = press * bw * 0.55;
    ctx.fillStyle = '#20282a';
    ctx.fillRect(pressX - bw * 0.14, 0, bw * 0.28, by - bh - bw * 1.2 + drop);
    ctx.fillStyle = '#4a5456';
    ctx.fillRect(pressX - bw * 0.5, by - bh - bw * 1.25 + drop, bw, bw * 0.9);
    ctx.fillStyle = 'rgba(200,240,230,0.5)';
    ctx.fillRect(pressX - bw * 0.5, by - bh - bw * 1.25 + drop, bw, bw * 0.08);
  });
}

// A wall of television sets. Half of them change picture every other beat.
function screensShot(ctx, f, o) {
  const { w, h } = f;
  const S = o.S;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, w, h);
  const cw = 0.2 * S, ch = cw * 0.8;
  const cols = Math.ceil(w / cw) + 1, rows = Math.ceil(h / ch) + 1;
  const ox = (w - cols * cw) / 2, oy = (h - rows * ch) / 2;
  const B = Math.floor(f.beat);
  const fields = ['#3a6a7a', '#7a4a2a', '#5a2a4a', '#2a4a3a', '#6a6a30'];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = ox + c * cw, y = oy + r * ch;
    ctx.fillStyle = '#1a1a1d';
    ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    const sx = x + cw * 0.08, sy = y + ch * 0.09, sw = cw * 0.84, sh = ch * 0.8;
    // Checkerboard halves take turns, so no more than half the wall changes at once.
    const half = (c + r) % 2;
    const epoch = Math.floor((B + half) / 2);
    const kind = Math.floor(hash(c * 7 + o.cycle, r * 5 + epoch * 3) * 5);
    if (kind === 0) ctx.drawImage(SPRITES.bars, sx, sy, sw, sh);
    else if (kind === 1) ctx.drawImage(SPRITES.rings, sx, sy, sw, sh);
    else if (kind === 2) {
      // Snow, drifting slowly rather than flickering.
      const yy = (f.beat * 6 + c * 13) % 72;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(SPRITES.snow, 0, yy, 96, 72, sx, sy, sw, sh);
    } else {
      ctx.fillStyle = fields[(c + r + epoch) % fields.length];
      ctx.fillRect(sx, sy, sw, sh);
      if (kind === 4) {
        // A rolling bar.
        const by = sy + fract(f.beat * 0.25 + c * 0.3) * sh * 1.4 - sh * 0.2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(sx, by, sw, sh * 0.2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(SPRITES.glass, sx, sy, sw, sh);
  }
  // Keep the wall as dim as the night shots around it.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, w, h);
}

// Long exposure at the airport: landing lights sliding down the glide path, one
// plane a bar, the earlier ones' trails still on the film.
function landingShot(ctx, f, o) {
  const { w, h } = f;
  const S = o.S;
  const hy = h * 0.66;
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#04060e');
  sky.addColorStop(0.75, '#141a30');
  sky.addColorStop(1, '#3a2632');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hy);
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, hy, w, h - hy);
  // City lights along the horizon; steady red lamps on masts.
  ctx.fillStyle = 'rgba(255,190,120,0.7)';
  ctx.beginPath();
  for (let i = 0; i < 260; i++) {
    const x = hash(i, 1) * w, y = hy - hash(i, 2) ** 3 * h * 0.03 + h * 0.004;
    ctx.rect(x, y, 1.5, 1.5);
  }
  ctx.fill();
  // The runway, seen from its side: two rows of lights receding.
  const touch = w / 2 + 0.25 * S;
  ctx.fillStyle = 'rgba(255,235,190,0.9)';
  ctx.beginPath();
  for (let i = 0; i < 60; i++) {
    const u = i / 60;
    const x = mix(-0.2 * w, w * 1.2, u);
    ctx.rect(x, hy + h * 0.035, 2, 2);
    ctx.rect(x, hy + h * 0.075, 3, 3);
  }
  ctx.fill();
  // The approach lights: a soft pulse runs towards the runway on each beat.
  ctx.globalCompositeOperation = 'lighter';
  const run = f.beatPhase;
  for (let i = 0; i < 10; i++) {
    const x = touch - (0.55 - i * 0.05) * S * 1.6;
    const g = 0.035 * S * (1 + 1.4 * Math.exp(-(((i / 9) - run) ** 2) * 60));
    ctx.globalAlpha = 0.5;
    ctx.drawImage(SPRITES.glow, x - g / 2, hy + h * 0.055 - g / 2, g, g);
  }
  // Planes: entering top left, touching down, rolling out to the right.
  const halves = f.beat / 2;
  for (let n = Math.floor(halves) - 12; n <= Math.floor(halves); n++) {
    const age = (halves - n) / 2;
    const lean = (hash(n, 4) - 0.5) * 0.4 * S;
    const start = [touch - 1.3 * S, hy - 0.62 * S + lean];
    const end = [touch, hy + h * 0.055];
    const at = (u) => (u <= 1 ? [mix(start[0], end[0], u), mix(start[1], end[1], u) - Math.sin(u * Math.PI) * 0.03 * S] : [end[0] + (u - 1) * 0.9 * S, end[1]]);
    const u = Math.min(age / 2.5, 1.6);
    const fade = 1 - smoothstep(3, 6, age);
    for (const [color, dy, lw] of [['255,248,230', 0, 2.4], ['255,60,50', -3, 1], ['60,255,140', 3, 1]]) {
      ctx.strokeStyle = `rgba(${color},${0.55 * fade})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let q = 0; q <= 24; q++) {
        const [x, y] = at((u * q) / 24);
        q ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy);
      }
      ctx.stroke();
    }
    if (u < 1.6) {
      const [x, y] = at(u);
      const g = 0.09 * S * fade;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(SPRITES.glow, x - g / 2, y - g / 2, g, g);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Escalators in a station: silhouettes carried up and down, a step per beat.
function escalatorShot(ctx, f, o) {
  const { w, h } = f;
  const S = o.S;
  const wall = ctx.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, '#2a2014');
  wall.addColorStop(1, '#0c0804');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const a = -0.5;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const band = 0.2 * S;
  const step = stepBeat(f.beat, 0.5);
  const Lh = 1.6 * Math.max(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  for (let e = -3; e <= 3; e++) {
    const up = e % 2 === 0 ? 1 : -1;
    const ox = nx * e * band * 1.35, oy = ny * e * band * 1.35;
    const P = (s, q) => [ox + dx * s + nx * q, oy + dy * s + ny * q];
    // The steps, lit warm from the balustrades.
    const glow = ctx.createLinearGradient(...P(0, -band / 2), ...P(0, band / 2));
    glow.addColorStop(0, '#5e4c32');
    glow.addColorStop(1, '#1a130a');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(...P(-Lh, -band / 2)); ctx.lineTo(...P(Lh, -band / 2)); ctx.lineTo(...P(Lh, band / 2)); ctx.lineTo(...P(-Lh, band / 2));
    ctx.fill();
    const sp = 0.03 * S;
    const moved = fract(step * up * 1.5) * sp;
    ctx.strokeStyle = 'rgba(60,44,24,0.5)';
    ctx.lineWidth = Math.max(1, S * 0.003);
    ctx.beginPath();
    for (let s = -Lh; s < Lh; s += sp) { ctx.moveTo(...P(s + moved, -band * 0.42)); ctx.lineTo(...P(s + moved, band * 0.42)); }
    ctx.stroke();
    // Handrails: dark rubber on bright glass.
    ctx.strokeStyle = '#fff2d8';
    ctx.lineWidth = 0.012 * S;
    ctx.beginPath();
    for (const q of [-band / 2, band / 2]) { ctx.moveTo(...P(-Lh, q)); ctx.lineTo(...P(Lh, q)); }
    ctx.stroke();
    ctx.strokeStyle = '#140c06';
    ctx.lineWidth = 0.006 * S;
    ctx.stroke();
    // Riders, upright on their steps, moving with them. Time-lapse smears each
    // one along the stair, so every figure trails fainter copies of itself.
    const gap = 2 * sp;
    const riders = [];
    SPRITES.riders ||= riderSprites();
    for (let i = -60; i < 60; i++) {
      const id = i - Math.floor(step * up * 0.375);
      if (hash(id, e) < 0.18) continue;
      const s = (i + fract(step * up * 0.375)) * gap * 2;
      const [x, y] = P(s, (hash(id, e + 3) - 0.3) * band * 0.3);
      if (x < -w / 2 - 40 || x > w / 2 + 40 || y < -h / 2 - 80 || y > h / 2 + 80) continue;
      riders.push([x, y, 0.019 * S * (0.85 + hash(id, e + 5) * 0.3), hash(id, e + 6), hash(id, e + 7), hash(id, e + 8)]);
    }
    const run = stepBeat(f.beat, 0.5) - Math.floor(stepBeat(f.beat, 0.5));
    for (const [k, alpha] of [[5, 0.1], [4, 0.14], [3, 0.2], [2, 0.28], [1, 0.4], [0, 1]]) {
      const back = k * gap * 0.3 * up * (1.2 - run * 0.6);
      ctx.globalAlpha = alpha;
      for (const [x, y, hs, a, b, c] of riders) {
        const set = SPRITES.riders[k ? 1 : 0];
        const sprite = set[Math.floor(a * set.length)];
        const sw = hs * 4.2 * (0.9 + 0.2 * b), sh = sw * 2.5;
        ctx.drawImage(sprite, x - dx * back - sw / 2, y - dy * back - sh * 0.86, sw, sh);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Riders for the escalators: a few silhouettes, soft-edged, backlit from the
// right by the balustrade lights. Drawn once.
function riderSprites() {
  const shapes = [
    // [head, shoulders, hips, coat length, extra: 0 none, 1 bag, 2 hat, 3 hood]
    [0.19, 0.34, 0.26, 0.98, 1], [0.18, 0.38, 0.3, 0.8, 0], [0.2, 0.3, 0.24, 0.95, 2], [0.19, 0.36, 0.3, 0.9, 3],
    [0.18, 0.32, 0.22, 0.7, 0], [0.2, 0.4, 0.32, 1.0, 1],
  ];
  // Each rider twice: with the rim of light, and plain for the time-lapse smear.
  return [true, false].map((rim) => shapes.map(([hd, sh, hp, coat, extra], n) => makeCanvas(48, 120, (g, W, H) => {
    const body = (c, ox) => {
      c.beginPath();
      const x = W / 2 + ox, top = H * 0.25;
      c.ellipse(x + (n % 2 ? 1 : -1), top - hd * W * 0.9, hd * W, hd * W * 1.2, 0, 0, TAU);
      c.moveTo(x - hd * W * 0.5, top);
      c.quadraticCurveTo(x - sh * W, top + 2, x - sh * W, top + H * 0.12);
      c.lineTo(x - hp * W, top + H * 0.62 * coat);
      c.lineTo(x - hp * W * 0.6, H * 0.98);
      c.lineTo(x + hp * W * 0.6, H * 0.98);
      c.lineTo(x + hp * W, top + H * 0.62 * coat);
      c.lineTo(x + sh * W, top + H * 0.12);
      c.quadraticCurveTo(x + sh * W, top + 2, x + hd * W * 0.5, top);
      c.closePath();
      c.fill();
      if (extra === 1) c.fillRect(x + sh * W - 2, top + H * 0.25, W * 0.2, H * 0.2);
      if (extra === 2) c.fillRect(x - hd * W * 1.5, top - hd * W * 1.6, hd * W * 3, 3);
      if (extra === 3) { c.beginPath(); c.ellipse(x, top - hd * W * 0.6, hd * W * 1.3, hd * W * 1.4, 0, 0, TAU); c.fill(); }
    };
    g.filter = 'blur(1px)';
    g.fillStyle = 'rgba(255,196,130,0.85)';
    if (rim) body(g, 1.6);
    g.fillStyle = '#0c0805';
    body(g, 0);
  })));
}

const GRID_SHOTS = [cityShot, freewayShot, facadeShot, crowdShot, assemblyShot, screensShot, landingShot, escalatorShot];

const grid = {
  id: 'grid',
  init: makeSprites,
  render(ctx, f) {
    makeSprites();
    const cycle = Math.floor(f.shot / GRID_SHOTS.length);
    const o = { cycle, S: Math.min(f.h, f.w / 0.8), speed: f.bpm / 120 };
    // Reduced motion: half the machine speed.
    if (f.reduced) f = { ...f, beat: f.beat * 0.5, beatPhase: fract(f.beat * 0.5) };
    ctx.save();
    if (cycle % 2) {
      ctx.translate(f.w, 0);
      ctx.scale(-1, 1);
    }
    GRID_SHOTS[f.shot % GRID_SHOTS.length](ctx, f, o);
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// The warning, 1988. The measured curve of CO2, one thin line in the dark.

// Monthly CO2 at Mauna Loa, smoothed to a curve: 315 ppm in 1958, 351 in 1988,
// 431 in 2026, with the seasonal sawtooth (slow rise to May, fast fall to
// September, about 6 ppm peak to trough).
const trend = (y) => 315 + 0.8 * (y - 1958) + 0.0133 * (y - 1958) ** 2;
function season(y) {
  const x = fract(y - 0.72);
  return x < 0.62 ? -Math.cos((Math.PI * x) / 0.62) : Math.cos((Math.PI * (x - 0.62)) / 0.38);
}
// What followed 1988 if the world waited `delay` (0..1) before acting: the
// real track for delay × 40 years, then a projection that slows, flattens
// and turns down. A delay of 1 never bends.
function bendYear(delay) {
  return delay >= 0.99 ? Infinity : 1988 + 40 * delay;
}
function projected(y, yb) {
  if (y <= yb) return trend(y);
  const slope = 0.8 + 0.0266 * (yb - 1958);
  const d = y - yb;
  return trend(yb) + slope * 9 * (1 - Math.exp(-d / 9)) - 0.012 * Math.max(0, d - 12) ** 2;
}

const warning = {
  id: 'warning',
  render(ctx, f) {
    const { w, h } = f;
    ctx.fillStyle = '#030304';
    ctx.fillRect(0, 0, w, h);
    const pr = f.params;
    const delay = amountOf(pr, 'warning');
    const e = pr.answered && delay !== null ? smoothstep(0, 8, f.beat - (pr.answeredBeat || 0)) : 0;
    const yb = bendYear(delay ?? 0.5);
    const end = Number.isFinite(yb) ? Math.max(2036, Math.round(yb) + 22) : 2050;
    let top = 0;
    // Room for the projection and for the faint real track it is compared with.
    for (let y = 1988; y <= end; y += 1) top = Math.max(top, projected(y, yb) + 3, y <= 2026 ? trend(y) + 3 : 0);
    top = Math.ceil(top / 10) * 10 + 10;
    // The frame widens to take in the future once there is an answer.
    const x1 = mix(1990, end + 1, e), yMax = mix(362, top, e), yMin = mix(306, 300, e);
    const pw = Math.min(w * 0.8, h * 1.4);
    const L = (w - pw) / 2, R = L + pw, T = h * 0.12, B = h * 0.58;
    const X = (yr) => L + ((yr - 1958) / (x1 - 1958)) * (R - L);
    const Y = (ppm) => B - ((ppm - yMin) / (yMax - yMin)) * (B - T);
    const u = h / 700;
    // Axis and labels, dim.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    ctx.moveTo(L, B + 24 * u); ctx.lineTo(R, B + 24 * u);
    // Once the frame has widened to take in the future, its last year is marked too.
    const ticks = e > 0.5 ? [1958, 1988, end] : [1958, 1988];
    for (const yr of ticks) { ctx.moveTo(X(yr), B + 24 * u); ctx.lineTo(X(yr), B + 30 * u); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    // Labels at least 11 CSS pixels tall, however the canvas is scaled to the screen.
    const cssPx = ctx.canvas.clientHeight ? h / ctx.canvas.clientHeight : 1;
    ctx.font = `300 ${Math.round(Math.max(11 * cssPx, 12 * u))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('1958', X(1958), B + 36 * u);
    ctx.fillText('1988', X(1988), B + 36 * u);
    if (e > 0.5) {
      ctx.globalAlpha = smoothstep(0.5, 1, e);
      ctx.fillText(String(end), X(end), B + 36 * u);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ppm', L, Y(yMax) + 12 * u);
    // The measured curve draws itself over six beats, then rests at 1988.
    const draw = f.reduced ? 1 : 1 - (1 - clamp(f.beat / 6)) ** 2;
    const head = 1958 + 30 * draw + (end - 1988) * e;
    // The seasonal wiggle fades out of the projection: it is an estimate, smooth.
    const curve = (y, real = false) =>
      (real ? trend(y) : projected(y, yb)) + 3 * season(y) * (real || y <= yb ? 1 : Math.exp(-(y - yb) / 5));
    const stroke = (from, to, dotted, alpha = 1, real = false) => {
      if (to <= from) return;
      ctx.setLineDash(dotted ? [2 * u, 5 * u] : []);
      ctx.beginPath();
      for (let y = from; y <= to + 1e-6; y = Math.min(to, y + 1 / 24) + (y >= to ? 1 : 0)) {
        const px = X(y), py = Y(curve(y, real));
        y === from ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      for (const [lw, a] of [[5 * u, 0.08], [1.4 * u, 0.92]]) {
        ctx.lineWidth = Math.max(1, lw);
        ctx.strokeStyle = `rgba(245,244,238,${a * alpha})`;
        ctx.stroke();
      }
    };
    ctx.lineJoin = 'round';
    // The real record up to the bend (or to 2026), then the projection, dotted.
    const solidEnd = Math.min(yb, 2026);
    stroke(1958, Math.min(head, solidEnd), false);
    stroke(solidEnd, head, true);
    // Where the world actually went, faint, for comparison.
    if (e > 0 && yb < 2026) stroke(yb, Math.min(head, 2026), false, 0.22, true);
    ctx.setLineDash([]);
    // The bend, labelled: what the delay meant.
    if (e > 0 && yb >= 1990 && head > yb) {
      const bx = X(yb), by = Y(projected(yb, yb));
      ctx.globalAlpha = 0.8 * smoothstep(yb, yb + 3, head);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      ctx.moveTo(bx, by - 10 * u); ctx.lineTo(bx, by - 18 * u);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(Math.round(yb)), bx, by - 22 * u);
      ctx.globalAlpha = 1;
    }
    // The bright point at the head, breathing slowly.
    const breath = 0.8 + 0.2 * Math.cos((f.beat / 8) * TAU);
    const hx = X(head), hy = Y(curve(head));
    const g = 34 * u * breath;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(SPRITES.glow, hx - g / 2, hy - g / 2, g, g);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx, hy, 2.2 * u + 0.5, 0, TAU);
    ctx.fill();
  },
};
warning.init = makeSprites;

// ---------------------------------------------------------------------------
// Heat, 1988–2026: fire, melt, storm, flood. uK: how hot it has become.

// A fire front on a ridge at night; the smoke above it lit orange.
const WILDFIRE = frag(`
void main() {
  vec2 p = centered();
  float t = uT, k = uK;
  float ridge = -0.04 + 0.16 * (fbm3(vec2(p.x * 1.3 + 4.0, 0.5)) - 0.5) - 0.1 * p.x;
  float h = p.y - ridge;
  // Smoke lit orange from below, rolling up and away.
  vec2 q = p * vec2(1.8, 2.4) - vec2(t * 0.2, t * 0.16);
  float n = fbm(q + fbm3(q * 0.8 + t * 0.05));
  float lit = exp(-max(h, 0.0) * (3.8 - k));
  vec3 col = mix(vec3(0.02, 0.012, 0.02), vec3(0.09, 0.03, 0.025), smoothstep(0.5, -0.2, p.y));
  vec3 smoke = mix(vec3(0.05, 0.028, 0.025), vec3(1.0, 0.38, 0.08), lit * (0.35 + 0.65 * n) * (0.75 + 0.4 * k));
  col = mix(col, smoke, smoothstep(0.2, 0.8, n + 0.3 * lit));
  // The front: flames along the crest, taller as it gets hotter.
  float fh = (0.05 + 0.08 * k) * (0.35 + 1.3 * noise(vec2(p.x * 5.0, t * 0.4)));
  float fn = fbm(vec2(p.x * 10.0, h * 6.0 - t * 2.8));
  float fl = clamp(1.0 - h / fh + (fn - 0.5) * 1.4, 0.0, 1.2) * step(-0.005, h);
  col += fireRamp(fl * 1.1) * smoothstep(0.0, 0.3, fl);
  // Pines on the crest, black against the fire.
  float cw = 0.016, cx = floor(p.x / cw);
  float th = (0.02 + 0.045 * hash(vec2(cx, 3.0))) * step(0.25, hash(vec2(cx, 7.0)));
  float fx = abs(fract(p.x / cw) - 0.5) * 2.0;
  float tree = step(0.0, h + 0.01) * step(fx, (1.0 - (h + 0.004) / max(th, 1e-3)) * 0.9) * step(fx, 0.9 - 0.5 * step(0.5, fract(h * 90.0)) * 0.3);
  if (h < 0.0 || tree > 0.5) {
    // The burnt slope below: black, a scatter of embers still glowing.
    float e = noise(p * 70.0 + 3.0) * noise(p * 23.0);
    col = vec3(0.01, 0.007, 0.008) + vec3(1.0, 0.3, 0.05) * smoothstep(0.45, 0.62, e) * exp(min(h, 0.0) * 5.0) * (0.6 + 0.4 * sin(t * 1.3 + p.x * 40.0));
    col += vec3(1.0, 0.35, 0.05) * exp(min(h, 0.0) * 60.0) * 0.35 * (1.0 - tree);
  }
  outColor = vec4(film(col), 1.0);
}`);

// A tidewater glacier's face; a slab tilts away and sinks in slow motion.
// uA.x: fall (0..1).
const GLACIER = frag(`
float topAt(float x) { return 0.15 + 0.06 * fbm3(vec2(x * 3.0, 0.0)) + 0.02 * noise(vec2(x * 26.0, 1.0)); }
vec3 ice(vec2 q, float fresh) {
  float s = fbm(vec2(q.x * 16.0, q.y * 2.2));
  float cr = smoothstep(0.55, 0.75, fbm3(vec2(q.x * 8.0, q.y * 1.1 + 3.0)));
  vec3 c = mix(vec3(0.86, 0.9, 0.93), vec3(0.34, 0.56, 0.7), s * 0.7 + cr * 0.5);
  c = mix(c, vec3(0.16, 0.48, 0.72), fresh);
  c *= 0.8 + 0.3 * smoothstep(-0.16, 0.2, q.y);
  return c;
}
void main() {
  vec2 p = centered();
  float fall = uA.x, water = -0.16;
  vec3 col = mix(vec3(0.66, 0.68, 0.68), vec3(0.28, 0.33, 0.4), smoothstep(-0.1, 0.5, p.y));
  col *= 0.9 + 0.15 * fbm3(p * vec2(2.0, 5.0) + vec2(uT * 0.05, 0.0));
  float x0 = -0.14, x1 = 0.09;
  // The slab: rotate about its seaward foot and sink.
  vec2 piv = vec2(x1, water - 0.1);
  float a = fall * 0.32;
  vec2 r = rot(-a) * (p - piv - vec2(0.0, -fall * fall * 0.22)) + piv;
  bool inSlab = r.x > x0 && r.x < x1 && r.y < topAt(r.x) && p.y > water;
  if (p.y > water && p.y < topAt(p.x)) {
    float scar = step(x0, p.x) * step(p.x, x1) * smoothstep(0.0, 0.15, fall);
    col = ice(p, scar * 0.8) * (1.0 - 0.25 * scar);
    col *= 0.85 + 0.15 * smoothstep(0.02, 0.0, abs(p.x - x0)) * (1.0 - fall);
  }
  if (inSlab) col = ice(r, 0.0) * (1.0 - 0.2 * fall);
  // The sea: dark, with the spray and the swell of the fall.
  if (p.y < water) {
    float z = 1.0 / (water - p.y + 0.02);
    float wv = fbm3(vec2(p.x * z * 0.5, z * 1.5 - uT * 0.3));
    col = mix(vec3(0.04, 0.09, 0.11), vec3(0.3, 0.38, 0.42), wv * 0.5 + 0.25 * exp((p.y - water) * 20.0));
    float floe = smoothstep(0.62, 0.66, fbm(vec2(p.x * z, z * 3.0)));
    col = mix(col, vec3(0.78, 0.84, 0.88), floe * 0.8);
  }
  float sp = smoothstep(0.1, 0.6, fall) * (1.0 - 0.4 * smoothstep(0.8, 1.0, fall));
  vec2 sq = (p - vec2(-0.02, water)) / vec2(0.3 + 0.2 * fall, 0.08 + 0.22 * sp);
  float spray = smoothstep(1.0, 0.2, length(sq) + 0.5 * fbm(p * 9.0 - vec2(0.0, uT * 0.6))) * sp;
  col = mix(col, vec3(0.9, 0.93, 0.95), spray);
  outColor = vec4(film(col), 1.0);
}`);

// A hurricane from orbit: spiral bands turning over the dark sea.
const HURRICANE = frag(`
void main() {
  vec2 p = centered();
  vec2 d = p - vec2(0.03, -0.03);
  float r = length(d), th = atan(d.y, d.x), t = uT;
  vec3 col = mix(vec3(0.02, 0.09, 0.2), vec3(0.04, 0.16, 0.3), fbm3(p * 3.0));
  // Land in one corner.
  float land = smoothstep(0.52, 0.56, fbm3(p * 2.0 + vec2(4.0, 1.0)) + 0.4 * (p.x - 0.4));
  col = mix(col, vec3(0.2, 0.18, 0.1) * (0.7 + 0.5 * fbm(p * 12.0)), land);
  // Spiral bands: the inner ones turn faster. Arms wind in counterclockwise.
  float spin = t * (0.15 + 0.3 / (1.0 + r * 8.0));
  vec2 q = rot(spin - 2.2 * log(r + 0.03)) * d;
  float n = fbm(q * vec2(9.0, 3.0) + 3.0);
  float arms = 0.5 + 0.5 * sin(3.0 * (th - spin) + 9.0 * log(r + 0.02) + (n - 0.5) * 3.0);
  float size = 0.34 + 0.08 * uK;
  float cloud = smoothstep(0.4, 0.8, arms * 0.7 + n * 0.55 - 0.35 * r / size + 0.2) * smoothstep(size * 1.5, size * 0.6, r);
  cloud = max(cloud, smoothstep(0.2, 0.07, r) * (0.8 + 0.2 * n));
  cloud += smoothstep(0.62, 0.8, fbm(p * 6.0 + 9.0)) * 0.5 * smoothstep(size, size * 1.6, r);
  cloud *= smoothstep(0.018, 0.04, r);
  float wall = exp(-pow((r - 0.045) / 0.015, 2.0));
  vec3 cc = vec3(0.9, 0.93, 0.97) * (0.7 + 0.35 * n + 0.2 * wall);
  col = mix(col, cc, clamp(cloud, 0.0, 1.0));
  // The limb of the Earth and a thin blue air.
  float e = length(p - vec2(-0.3, -2.1)) - 2.48;
  col = mix(col, vec3(0.3, 0.55, 0.95), smoothstep(-0.03, 0.0, e) * 0.6);
  col = mix(col, vec3(0.0, 0.0, 0.01), smoothstep(0.0, 0.03, e));
  col *= 0.7 + 0.4 * smoothstep(0.7, -0.4, p.x + p.y);
  outColor = vec4(film(col), 1.0);
}`);

// Floodwater over a town's roofs, from above. uA.x: water level (0..1).
const FLOOD = frag(`
void main() {
  vec2 p = centered();
  vec2 q = rot(0.42) * p * 4.2 + vec2(uT * 0.02, 0.3);
  float L = uA.x;
  // Brown water, flowing fast, with the grey sky in it: streaks of current
  // and foam drawn out along the streets, a sheen where the sky reflects.
  float fl = fbm3(q * vec2(0.6, 2.5) - vec2(uT * 0.25, 0.0));
  float streak = fbm3(q * vec2(0.35, 7.0) - vec2(uT * 0.6, 0.0));
  vec3 col = mix(vec3(0.19, 0.16, 0.11), vec3(0.34, 0.3, 0.24), fl);
  col = mix(col, vec3(0.52, 0.54, 0.54), smoothstep(0.6, 0.8, streak) * 0.45);
  col += vec3(0.1, 0.11, 0.12) * smoothstep(0.3, 0.8, fbm3(p * 1.5 + vec2(uT * 0.03, 0.0)));
  vec2 b = floor(q), f = fract(q);
  vec2 inner = (f - 0.1) / 0.8;
  if (min(inner.x, inner.y) > 0.0 && max(inner.x, inner.y) < 1.0) {
    vec2 hq = inner * 2.0, hi = floor(hq), hf = fract(hq);
    vec2 id = b * 2.0 + hi;
    float hs = hash(id), along = step(0.5, hash(id + 5.0));
    vec2 lo = vec2(0.07, 0.1) + 0.06 * hash2(id + 2.0);
    if (hs > 0.08 && hf.x > lo.x && hf.x < 1.0 - lo.x && hf.y > lo.y && hf.y < 1.0 - lo.y) {
      vec2 u = (hf - lo) / (1.0 - 2.0 * lo);
      float across = mix(u.x, u.y, along);
      float H = 0.55 + 0.4 * hash(id + 9.0);
      float height = H * (0.62 + 0.38 * (1.0 - abs(2.0 * across - 1.0)));
      vec3 tile = mix(vec3(0.46, 0.22, 0.15), vec3(0.3, 0.3, 0.32), step(0.5, hash(id + 3.0)));
      tile *= across < 0.5 ? 1.1 : 0.7;
      tile *= 0.85 + 0.15 * step(0.5, fract((along > 0.5 ? u.x : u.y) * 14.0));
      float above = height - L;
      col = above > 0.0 ? tile : mix(col, tile * 0.6 + vec3(0.1, 0.08, 0.05), 0.5 * exp(above * 20.0));
      col = mix(col, vec3(0.75, 0.72, 0.65), smoothstep(0.03, 0.0, abs(above)) * 0.8);
    } else {
      // Trees in the yards: already under.
      float tr = smoothstep(0.35, 0.3, length(hf - hash2(id + 7.0)));
      col = mix(col, vec3(0.1, 0.14, 0.08), tr * 0.35);
    }
  }
  col *= 0.85 + 0.15 * smoothstep(-0.6, 0.5, p.y);
  outColor = vec4(film(col), 1.0);
}`);

// A cracked lakebed under a blazing sun; the air shimmers.
const LAKEBED = frag(`
void main() {
  vec2 p = centered();
  float t = uT, hor = 0.02;
  float shimmer = (noise(vec2(p.x * 26.0, p.y * 180.0 - t * 5.0)) - 0.5) * 0.006 * exp(-abs(p.y - hor) * 18.0);
  p.x += shimmer;
  vec2 sun = vec2(0.08, 0.24);
  float sd = length(p - sun);
  vec3 sky = mix(vec3(0.95, 0.84, 0.64), vec3(0.42, 0.44, 0.46), smoothstep(0.0, 0.5, p.y - hor));
  sky += vec3(1.0, 0.8, 0.5) * exp(-sd * 3.5) * (0.5 + 0.4 * uK) + vec3(1.0) * smoothstep(0.075, 0.065, sd);
  vec3 col = sky;
  float dy = hor - p.y + shimmer * 3.0;
  if (dy > 0.0) {
    float z = 0.22 / dy;
    vec2 g = vec2(p.x * z, z) * 2.2;
    vec3 cl = cells(g);
    float aa = fwidth(cl.y) * 1.2;
    float crack = smoothstep(0.035 + aa, 0.035 - aa, cl.y);
    vec3 clay = mix(vec3(0.66, 0.52, 0.36), vec3(0.82, 0.69, 0.5), cl.z) * (0.85 + 0.25 * fbm3(g * 3.0));
    clay *= 1.0 + 0.18 * smoothstep(0.12, 0.04, cl.y);
    vec3 ground = mix(clay, vec3(0.2, 0.12, 0.07), crack);
    ground = mix(ground, sky * 0.95, exp(-z * 0.12) * 0.8);
    // Mirage: the sky's reflection on a pool of heat at the horizon.
    float mir = smoothstep(0.035, 0.0, dy) * (0.6 + 0.4 * noise(vec2(p.x * 20.0, t)));
    col = mix(ground, mix(vec3(0.95, 0.86, 0.68), vec3(0.8, 0.74, 0.6), dy * 30.0), mir);
  }
  outColor = vec4(film(col), 1.0);
}`);

// A sea of smoke over a city at sunset; the sun a red disk.
const SMOG = frag(`
float skyline(float x, float w, float seed, float lo, float hi) {
  // Lots of uneven width; a few towers with a narrower crown.
  float u = x / w + 0.6 * noise(vec2(x * 7.0, seed)), b = floor(u);
  float r = hash(vec2(b, seed)), crown = step(0.8, r) * step(0.3, abs(fract(u) - 0.5));
  return lo + pow(r, 2.0) * (hi - lo) + step(0.93, r) * 0.08 - crown * 0.03;
}
void main() {
  vec2 p = centered();
  float t = uT;
  vec3 col = mix(vec3(0.72, 0.3, 0.1), vec3(0.12, 0.05, 0.04), smoothstep(-0.1, 0.5, p.y));
  float bands = fbm(vec2(p.x * 1.2 - t * 0.06, p.y * 7.0));
  col *= 0.7 + 0.5 * bands;
  vec2 sun = vec2(0.12, 0.1);
  float sd = length(p - sun);
  col = mix(col, vec3(0.95, 0.2, 0.07) * (0.8 + 0.3 * bands), smoothstep(0.085, 0.08, sd));
  col += vec3(0.5, 0.12, 0.03) * exp(-sd * 6.0) * 0.6;
  float far = skyline(p.x + 0.7, 0.025, 1.0, -0.1, 0.03);
  if (p.y < far) col = mix(vec3(0.26, 0.1, 0.06), col, 0.45);
  float near = skyline(p.x, 0.04, 2.0, -0.2, 0.08);
  if (p.y < near) {
    col = vec3(0.04, 0.02, 0.02);
    vec2 wq = vec2(p.x / 0.008, p.y / 0.012);
    col += vec3(0.5, 0.3, 0.12) * step(0.88, hash(floor(wq))) * step(0.3, fract(wq.x)) * step(0.3, fract(wq.y)) * 0.5;
  }
  // The sea of smoke, rolling slowly through the streets.
  float sm = fbm(vec2(p.x * 2.0 - t * 0.1, p.y * 5.0 + t * 0.02));
  float layer = smoothstep(-0.02, -0.2, p.y + 0.08 * (sm - 0.5)) * (0.75 + 0.25 * uK);
  col = mix(col, vec3(0.5, 0.2, 0.08) * (0.55 + 0.6 * sm), clamp(layer, 0.0, 1.0));
  outColor = vec4(film(col), 1.0);
}`);

// Sea ice from the air: plates parting over black water. uA.x: gap.
const SEA_ICE = frag(`
void main() {
  vec2 p = centered();
  float t = uT;
  vec2 q = rot(0.03 * t) * p * 3.2 / (1.0 + 0.03 * t) + vec2(3.1, 1.7);
  q += 0.25 * vec2(fbm3(q * 1.5), fbm3(q * 1.5 + 4.0));
  vec3 cl = cells(q);
  vec3 col = vec3(0.02, 0.07, 0.1) + vec3(0.03, 0.06, 0.07) * fbm3(q * 4.0);
  float gap = uA.x * (0.3 + 1.1 * hash(vec2(cl.z * 91.0, 1.0)));
  float edge = cl.y - gap;
  if (edge < 0.02) {
    // Brash ice and slush in the leads.
    float bits = noise(q * 11.0) * noise(q * 23.0 + 5.0);
    col = mix(col, vec3(0.5, 0.58, 0.62), smoothstep(0.3, 0.4, bits) * 0.7);
  }
  if (edge > 0.0) {
    // Overcast light: the snow grey-blue rather than white.
    vec3 snow = vec3(0.66, 0.72, 0.77) * (0.84 + 0.22 * fbm3(q * 2.5 + cl.z * 10.0));
    snow -= vec3(0.16, 0.1, 0.06) * smoothstep(0.03, 0.0, abs(fbm3(q * 1.7 + cl.z * 5.0) - 0.5));
    // Meltwater pools, spreading as it warms.
    float pond = smoothstep(0.7 - 0.06 * uK - 0.4 * uA.x, 0.73 - 0.06 * uK - 0.4 * uA.x, fbm3(q * 3.0 + cl.z * 7.0));
    snow = mix(snow, vec3(0.16, 0.45, 0.56), pond * 0.9);
    col = mix(vec3(0.22, 0.44, 0.5), snow, smoothstep(0.0, 0.02, edge));
  }
  outColor = vec4(film(col), 1.0);
}`);

// A reef, bleaching: colour drains to white as the front passes. uA.x: bleach.
// Three banks, nearest first so the nearer ones hide the rest (and the loop can
// stop early). Each bank is a row of colonies: brain-coral domes, staghorn
// thickets, table corals on stems. No Voronoi, a few fbm3 per bank.
const REEF = frag(`
vec3 PALETTE[5] = vec3[5](vec3(0.9, 0.45, 0.3), vec3(0.52, 0.32, 0.6), vec3(0.3, 0.6, 0.45), vec3(0.88, 0.7, 0.3), vec3(0.8, 0.4, 0.52));
void main() {
  vec2 p = centered();
  float t = uT;
  vec3 water = mix(vec3(0.02, 0.16, 0.26), vec3(0.08, 0.4, 0.52), smoothstep(-0.4, 0.5, p.y));
  float rays = fbm3(vec2(p.x * 5.0 + p.y * 1.8, t * 0.15));
  water += vec3(0.1, 0.18, 0.18) * smoothstep(0.55, 0.85, rays) * smoothstep(-0.3, 0.5, p.y);
  vec3 col = vec3(0.0);
  float left = 1.0; // how much of the pixel is still uncovered, front to back
  for (int i = 0; i < 3; i++) {
    float fi = float(i), sc = 4.5 + 3.5 * fi;
    float ground = -0.44 + 0.17 * fi + 0.05 * (fbm3(vec2(p.x * 1.5 + fi * 7.0, fi)) - 0.5);
    float y = (p.y - ground) * sc;
    if (y > 2.2) continue;
    vec2 q = vec2(p.x * sc + fi * 13.0, y);
    float cell = floor(q.x), u = fract(q.x) - 0.5;
    float id = hash(vec2(cell, fi + 2.0)), hh = hash(vec2(cell, fi + 5.0));
    float H = 0.6 + 0.9 * hh;
    float inside = 0.0, shade = 0.0, tex = 0.5;
    bool bed = y < 0.0;
    if (bed) {
      inside = 1.0; shade = 0.3 + 0.25 * smoothstep(-0.6, 0.0, y); tex = fbm3(q * vec2(3.0, 5.0));
    } else if (id < 0.5) {
      // A brain or boulder coral: a dome with meandering grooves.
      float w = 0.47 + 0.03 * hh;
      float top = w * (0.8 + 0.5 * hh) * sqrt(max(0.0, 1.0 - pow(u / w, 2.0)));
      inside = step(y, top);
      shade = 0.35 + 0.8 * clamp(y / max(top, 0.01), 0.0, 1.0) * (1.0 - 0.6 * abs(u / w));
      tex = 0.5 + 0.5 * sin(fbm3(q * 2.5 + id * 20.0) * 30.0);
    } else if (id < 0.88) {
      // Staghorn: a thicket of antler-like fingers of different heights.
      float fx = u * 4.5 + 0.35 * sin(y * 2.5 + id * 9.0) + 0.25 * y * sign(u);
      float fh = H * (0.6 + 0.6 * hash(vec2(floor(fx), cell)));
      float v = abs(fract(fx) - 0.5);
      inside = step(v, 0.3 * (1.0 - 0.45 * y / fh)) * step(y, fh) * step(abs(u), 0.5);
      shade = 0.4 + 0.7 * (y / fh) * (1.0 - v * 2.5);
      tex = noise(q * vec2(20.0, 8.0));
    } else {
      // A table coral: a flat plate on a short stem.
      float ht = 0.35 + H * 0.35, plate = y - ht;
      inside = max(step(abs(plate), 0.1) * step(abs(u), 0.5 - 0.6 * max(plate, 0.0)), step(abs(u), 0.12 - 0.05 * y) * step(y, ht));
      shade = mix(0.35, 1.1, step(ht, y)) * (0.8 + 0.4 * smoothstep(-0.08, 0.08, y - ht));
      tex = noise(q * vec2(30.0, 4.0));
    }
    if (inside < 0.5) continue;
    vec3 live = bed ? vec3(0.34, 0.3, 0.24) : PALETTE[int(id * 17.0) % 5];
    float bi = bed ? noise(vec2(p.x * 3.0, fi)) : id;
    float bl = smoothstep(bi * 0.7, bi * 0.7 + 0.2, uA.x * 1.15) * (bed ? 0.5 : 1.0);
    vec3 c = mix(live * (0.6 + 0.5 * tex), vec3(0.95, 0.95, 0.92) * (0.75 + 0.3 * tex), bl);
    c *= shade * (0.85 + 0.35 * pow(abs(sin(fbm3(q * 0.4 + vec2(t * 0.15, -t * 0.1)) * 14.0)), 10.0));
    c = mix(c, water, 0.25 + 0.25 * fi);
    col += left * c;
    left = 0.0;
    break;
  }
  col += left * water;
  outColor = vec4(film(col), 1.0);
}`);

// Embers streaming off the fire front.
function embers(ctx, f, k) {
  const [X, Y] = frameMap(f);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 220; i++) {
    const life = 2.5 + hash(i, 1) * 2;
    const age = fract((f.shotT * (f.reduced ? 0.4 : 1)) / life + hash(i, 2)) * life;
    const x0 = (hash(i, 3) - 0.5) * 2.2;
    const y0 = -0.04 - 0.1 * x0;
    const x = x0 + age * (0.08 + 0.05 * hash(i, 4)) + 0.02 * Math.sin(age * 2 + i);
    const y = y0 + age * (0.06 + 0.08 * hash(i, 5) * (0.6 + k));
    const a = (1 - age / life) * clamp(age * 4);
    ctx.fillStyle = `rgba(255,${120 + (hash(i, 6) * 80) | 0},40,${a * 0.9})`;
    const s = Math.max(1, f.h * 0.0025 * (0.6 + hash(i, 7)));
    ctx.fillRect(X(x), Y(y), s, s);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Specks drifting in the water over the reef.
function marineSnow(ctx, f) {
  ctx.fillStyle = 'rgba(220,240,240,0.35)';
  for (let i = 0; i < 90; i++) {
    const x = fract(hash(i, 1) + f.shotT * 0.01 * (hash(i, 2) - 0.3)) * f.w;
    const y = fract(hash(i, 3) + f.shotT * 0.02 * hash(i, 4)) * f.h;
    const s = 1 + hash(i, 5) * 1.5;
    ctx.fillRect(x, y, s, s);
  }
}

const HEAT_SHOTS = [
  { src: WILDFIRE, fallback: ['#050204', '#3a1206', '#e06010', '#050202'], after: embers },
  { src: GLACIER, fallback: ['#4a5460', '#a8b0b4', '#dfe8ee', '#0a1a20'], a: (s) => smoothstep(0.1, 0.95, s) },
  { src: HURRICANE, fallback: ['#000002', '#0a1a30', '#c8ccd4', '#0a1a30'] },
  { src: FLOOD, fallback: ['#3a3024', '#5a4a38', '#3a3024'], a: (s, k) => mix(0.36, 0.7 + 0.12 * k, s) },
  { src: LAKEBED, fallback: ['#6a6a6a', '#f0d8a0', '#b08a5a', '#8a6a44'] },
  { src: SMOG, fallback: ['#1e0806', '#8a2a0c', '#3a1a0c', '#140806'] },
  { src: SEA_ICE, fallback: ['#0a141a', '#c8d4da', '#0a141a'], a: (s) => mix(0.004, 0.06, s) },
  { src: REEF, fallback: ['#14506a', '#0a3040', '#a0907a'], a: (s) => mix(0.05, 1.0, s), after: marineSnow },
];

const heat = {
  id: 'heat',
  render(ctx, f, p) {
    const temp = f.params.temp ?? 0.5;
    // A little hotter, a little hazier, for a viewer who chose to burn more coal.
    const k = clamp(0.3 + 0.45 * f.progress + 0.3 * (temp - 0.5) + 0.1 * ((amountOf(f.params, 'coal') ?? 0.5) - 0.5));
    const shot = HEAT_SHOTS[f.shot % HEAT_SHOTS.length];
    // Through the shot, 0..1 over its two bars.
    const s = clamp(f.shotBeat / 8);
    const slow = f.reduced ? 0.4 : 1;
    const a = shot.a ? shot.a(s, k) : 0;
    if (!shade(ctx, f, p, shot.src, { uT: f.shotT * slow, uK: k, uA: [a, 0, 0, 0] })) gradient(ctx, f, shot.fallback);
    shot.after?.(ctx, f, k);
  },
};

export default [steam, coal, grid, warning, heat];
