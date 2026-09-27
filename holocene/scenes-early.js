// The early scenes: from the cave wall to the eve of steam. Titles, the void
// where Stand asks the viewer's name, the ice, the long warm Holocene, the first
// fields (choice 1) and the ages of farms and towns.
//
// Skies, clouds, fire, water and ice are fragment shaders; silhouettes and
// lights are canvas 2D on top. Every shader has a plainer 2D fallback for
// browsers without WebGL 2. Every frame is a pure function of the frame `f`.

// ---------------------------------------------------------------------------
// Shared helpers

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Common GLSL: hashes, value noise, fbm, a centered coordinate (height 1) and
// the film look: rich blacks, teal shadows, warm highlights.
const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uT;
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
vec2 centered() { return (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0); }
vec3 film(vec3 c) {
  c = max(c, 0.0);
  c = c / (1.0 + 0.12 * c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c += vec3(-0.012, 0.004, 0.016) * (1.0 - smoothstep(0.0, 0.35, l));
  c += vec3(0.03, 0.008, -0.03) * smoothstep(0.45, 1.0, l);
  return pow(max(c, 0.0), vec3(1.1));
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

// A soft round light, drawn once and reused for embers and lamps.
let glowSprite = null;
function glow() {
  if (glowSprite) return glowSprite;
  glowSprite = makeCanvas(64, 64);
  const g = glowSprite.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,240,210,1)');
  r.addColorStop(0.15, 'rgba(255,170,80,0.8)');
  r.addColorStop(0.45, 'rgba(220,90,30,0.18)');
  r.addColorStop(1, 'rgba(160,40,10,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return glowSprite;
}

// How much of the forest the viewer chose to clear in choice 1, 0..1, or null
// if not known yet. Without `amounts` (older callers) it comes from the
// choice: 1 (keep it) → 0, -1 (clear it) → 1.
function clearedAmount(f) {
  const prm = f.params || {};
  if (prm.amounts) return prm.amounts.fields ?? null;
  const c = prm.choices?.fields;
  return c === null || c === undefined ? null : (1 - c) / 2;
}

// How much forest survives into the later ages, 0..1.
function forestLeft(f) {
  return 1 - clamp(clearedAmount(f) ?? 0.4);
}

// ---------------------------------------------------------------------------
// Titles: hand stencils in firelight, a slow-motion flame, embers for the title.

// The cave wall, lit from below by a fire at uFire (centered coordinates).
const ROCK = frag(`
uniform float uLight;
uniform vec2 uFire;
float relief(vec2 p) { return fbm3(p * 1.5) * 0.7 + fbm3(p * 4.5 + 3.0) * 0.3; }
void main() {
  vec2 p = centered();
  float e = 0.004, h = relief(p);
  vec2 grad = vec2(relief(p + vec2(e, 0.0)) - h, relief(p + vec2(0.0, e)) - h) / e;
  vec3 n = normalize(vec3(-grad * 0.32, 1.0));
  vec2 d = uFire - p;
  float diffuse = max(dot(n, normalize(vec3(d, 0.45))), 0.0);
  float falloff = 1.0 / (1.0 + dot(d, d) * 1.5);
  float grit = noise(p * 90.0) * 0.5 + noise(p * 230.0) * 0.5;
  vec3 albedo = mix(vec3(0.66, 0.54, 0.42), vec3(0.86, 0.76, 0.62), fbm3(p * 3.0 + 9.0));
  albedo *= 0.68 + 0.32 * grit;
  vec3 col = albedo * vec3(1.0, 0.58, 0.28) * (0.25 + 0.95 * diffuse) * falloff * uLight * 1.5;
  outColor = vec4(film(col), 1.0);
}`);

// Fire in slow motion: domain-warped fbm rising, hottest at the bottom. Thin
// ridged sheets at the edges of the flame and dark smoke pockets inside it keep
// it from looking painted. uDim lowers the heat so only the bottom of the frame
// burns and the middle, where the title sits, stays dark.
const FLAME = frag(`
uniform float uDim;
vec3 ramp(float h) {
  vec3 c = mix(vec3(0.0), vec3(0.3, 0.03, 0.008), smoothstep(0.0, 0.25, h));
  c = mix(c, vec3(0.9, 0.28, 0.04), smoothstep(0.2, 0.6, h));
  c = mix(c, vec3(1.0, 0.62, 0.22), smoothstep(0.58, 0.95, h));
  return mix(c, vec3(1.0, 0.9, 0.7), smoothstep(1.0, 1.45, h));
}
void main() {
  vec2 p = centered();
  float t = uT * 0.11;
  vec2 q = p * vec2(1.7, 0.95) * 1.7 + vec2(0.0, -t * 1.6);
  vec2 w = vec2(fbm(q + vec2(0.0, -t)), fbm(q + vec2(5.2, 1.3 - t * 1.3)));
  float n = fbm(q * 1.3 + (w - 0.5) * 2.4 + vec2(0.0, -t * 2.2));
  // Sheets: ridges of a finer, vertically stretched noise, drawn up by the heat.
  float r = fbm3(q * vec2(2.6, 1.1) + (w - 0.5) * 3.0 + vec2(0.0, -t * 3.4));
  float sheet = 1.0 - abs(r * 2.0 - 1.0);
  float base = 1.0 - vUv.y;
  float h = n * 1.8 + base * 0.62 - 1.0;
  h += (pow(sheet, 5.0) - 0.25) * 0.35 * smoothstep(-0.2, 0.3, h);
  // Smoke pockets: slow, darker holes carried up inside the fire.
  h -= 0.28 * smoothstep(0.55, 0.8, fbm3(q * 0.8 + w + vec2(3.0, -t * 1.2))) * vUv.y;
  h -= uDim * (0.4 + 2.4 * smoothstep(0.08, 0.5, vUv.y));
  h = h * 1.45 + 0.05;
  outColor = vec4(film(ramp(h)), 1.0);
}`);

// One hand in local coordinates: palm at the origin, fingers up, wrist down.
// Fingers taper and bend a little; the palm widens to the knuckles; the thumb
// leaves low on the palm; the wrist runs out of the frame of the spray.
function handPath(g, s, spread, wobble = 0) {
  // A tapered finger from (x, y) at angle a (0 = up), with a rounded tip.
  const finger = (x, y, a, len, w0, w1, bend) => {
    const ux = Math.sin(a), uy = -Math.cos(a), nx = -uy, ny = ux;
    const b = a + bend, bx = Math.sin(b), by = -Math.cos(b);
    const mx = x + ux * len * 0.5, my = y + uy * len * 0.5;
    const tx = mx + bx * len * 0.5, ty = my + by * len * 0.5;
    g.beginPath();
    g.moveTo((x - nx * w0) * s, (y - ny * w0) * s);
    g.quadraticCurveTo((mx - nx * w0 * 0.9) * s, (my - ny * w0 * 0.9) * s, (tx - by * -w1) * s, (ty + bx * -w1) * s);
    g.arc(tx * s, ty * s, w1 * s, Math.atan2(-bx, by), Math.atan2(-bx, by) + Math.PI, false);
    g.quadraticCurveTo((mx + nx * w0 * 0.9) * s, (my + ny * w0 * 0.9) * s, (x + nx * w0) * s, (y + ny * w0) * s);
    g.closePath();
    g.fill();
  };
  // Palm and wrist.
  g.beginPath();
  g.moveTo(-0.15 * s, 0.75 * s);
  g.bezierCurveTo(-0.17 * s, 0.45 * s, -0.25 * s, 0.25 * s, -0.25 * s, -0.02 * s);
  g.quadraticCurveTo(-0.24 * s, -0.16 * s, -0.12 * s, -0.17 * s);
  g.lineTo(0.14 * s, -0.15 * s);
  g.quadraticCurveTo(0.25 * s, -0.12 * s, 0.24 * s, 0.02 * s);
  g.bezierCurveTo(0.23 * s, 0.25 * s, 0.17 * s, 0.45 * s, 0.16 * s, 0.75 * s);
  g.closePath();
  g.fill();
  // Index, middle, ring, little finger.
  const fingers = [[-0.165, -0.13, -0.95, 0.44, 0.058, 0.044], [-0.055, -0.16, -0.3, 0.52, 0.06, 0.046], [0.06, -0.15, 0.3, 0.49, 0.057, 0.044], [0.165, -0.1, 0.95, 0.37, 0.05, 0.039]];
  fingers.forEach(([x, y, k, len, w0, w1], i) => finger(x, y, k * spread + 0.05 * wobble * (i - 1.5), len, w0, w1, 0.08 * k * wobble));
  // The thumb, out from the base of the palm.
  finger(-0.2, 0.12, -1.05 - spread * 1.2, 0.4, 0.075, 0.05, 0.35);
}

// The stencil layer, multiplied over the rock: white where the rock shows,
// sprayed pigment around each hand, the hand itself left bare.
let stencilCache = null;
function stencils(p) {
  if (stencilCache) return stencilCache;
  const W = 1200, H = 800, OFF = 3000;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const r = p.rng(11);
  // x, y, size, tilt, finger spread, mirror, pigment, age (1 fresh .. 0 nearly gone).
  const hands = [
    [505, 350, 150, -0.28, 0.2, 1, '#6e1606', 1],
    [712, 296, 138, 0.22, 0.28, -1, '#7a1c08', 0.85],
    [612, 548, 122, -0.06, 0.12, 1, '#561304', 0.95],
    [398, 585, 104, -0.55, 0.24, -1, '#8a4a12', 0.55],
    [826, 540, 116, 0.5, 0.18, 1, '#6a1806', 0.7],
    [300, 330, 96, -0.9, 0.3, 1, '#7a3a10', 0.3],
    [905, 330, 92, 0.75, 0.16, -1, '#6a1a08', 0.25],
  ];
  // Each hand's spray is laid on a layer of its own first, so it can fade out
  // down the forearm before it goes on the wall.
  const layer = makeCanvas(W, H);
  const lg = layer.getContext('2d');
  hands.forEach(([x, y, s, rot, spread, mirror, color, age], k) => {
    const place = (c, dx) => {
      c.setTransform(1, 0, 0, 1, x + dx, y);
      c.rotate(rot);
      c.scale(mirror, 1);
    };
    // The spray: blurred shadows of the hand, cast from far off the canvas.
    // Dense close to the outline, thinning out, a little more to one side.
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = color;
    for (const [blur, alpha, grow, dx] of [[s * 0.7, 1, 1.7, 0.12], [s * 0.7, 1, 1.5, -0.1], [s * 0.35, 1, 1.3, -0.05], [s * 0.35, 1, 1.2, 0.05], [s * 0.12, 1, 1.1, 0], [s * 0.04, 1, 1.03, 0], [s * 0.015, 0.9, 1.01, 0]]) {
      lg.save();
      lg.shadowColor = color;
      lg.shadowBlur = blur;
      lg.shadowOffsetX = OFF;
      lg.globalAlpha = alpha * (0.35 + 0.65 * age);
      place(lg, -OFF + dx * s);
      lg.translate(0, -0.1 * s);
      lg.scale(grow, grow);
      lg.translate(0, 0.1 * s);
      handPath(lg, s, spread, k % 3 - 1);
      lg.restore();
    }
    place(lg, 0);
    lg.globalCompositeOperation = 'destination-out';
    const fade = lg.createLinearGradient(0, 0.3 * s, 0, 0.9 * s);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    lg.fillStyle = fade;
    lg.fillRect(-2 * s, 0.3 * s, 4 * s, 3 * s);
    lg.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(layer, 0, 0);
    g.fillStyle = color;
    const place0 = () => place(g, 0);
    // Droplets of pigment around it.
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 1100; i++) {
      const a = r() * TAU;
      const d = s * (0.32 + Math.abs(r() + r() + r() - 1.5) * 1.0);
      g.globalAlpha = (0.1 + r() * 0.45) * (0.3 + 0.7 * age);
      g.beginPath();
      g.arc(x + Math.cos(a) * d, y - s * 0.1 + Math.sin(a) * d * 1.25, 0.5 + r() * r() * 2.6, 0, TAU);
      g.fill();
    }
    // The hand, bare rock with a trace of overspray on it.
    g.globalAlpha = 1;
    g.fillStyle = '#fbf3ea';
    place0();
    handPath(g, s, spread, k % 3 - 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = color;
    for (let i = 0; i < 160; i++) {
      g.globalAlpha = 0.05 + r() * 0.15;
      g.fillRect(x + (r() - 0.5) * s * 0.8, y + (r() - 0.6) * s * 1.1, 1 + r() * 2, 1 + r() * 2);
    }
    // Time has worn the oldest ones away in patches.
    if (age < 0.9) {
      g.fillStyle = '#fff';
      for (let i = 0; i < 26; i++) {
        const rad = s * (0.08 + r() * 0.22);
        const gx = x + (r() - 0.5) * s * 1.6, gy = y + (r() - 0.55) * s * 1.8;
        const wear = g.createRadialGradient(gx, gy, 0, gx, gy, rad);
        wear.addColorStop(0, `rgba(255,255,255,${(1 - age) * 0.8})`);
        wear.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalAlpha = 1;
        g.fillStyle = wear;
        g.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
      }
    }
  });
  g.globalAlpha = 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  stencilCache = c;
  return c;
}

function handsShot(ctx, f, p) {
  const t = f.shotT;
  const reveal = smoothstep(0.8, 10, t);
  // Firelight breathes slowly (under 2 Hz, ±12%); none with reduced motion.
  const flicker = f.reduced ? 1 : 0.9 + 0.16 * (p.noise(t * 1.6, 3.1) - 0.5) + 0.04 * Math.sin(t * TAU * 0.7);
  const fire = [0.06 * (p.noise(t * 0.8, 7) - 0.5), -0.72];
  if (!shade(ctx, f, p, ROCK, { uLight: reveal * flicker, uFire: fire })) {
    const g = ctx.createRadialGradient(f.w / 2, f.h * 1.2, 0, f.w / 2, f.h * 1.2, f.h * 1.3);
    const k = reveal * flicker;
    g.addColorStop(0, `rgb(${210 * k},${120 * k},${60 * k})`);
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, f.h);
  }
  const s = Math.min(f.h / 760, f.w / 620);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(stencils(p), f.w / 2 - 600 * s, f.h * 0.47 - 400 * s, 1200 * s, 800 * s);
  ctx.globalCompositeOperation = 'source-over';
}

function flameShot(ctx, f, p, dim) {
  if (!shade(ctx, f, p, FLAME, { uDim: dim })) {
    gradient(ctx, f, dim ? ['#000', '#000', '#1a0602'] : ['#200502', '#a33a0a', '#ffcf80']);
  }
}

// Embers drifting up out of the dark, fading in the middle where the title sits.
function embers(ctx, f, p) {
  const r = p.rng(5);
  const sprite = glow();
  const size = Math.max(f.w, f.h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x0 = r(), speed = 0.025 + r() * 0.05, phase = r(), scale = 0.5 + r() * r() * 1.4;
    const y = 1.1 - ((f.t * speed + phase) % 1) * 1.25;
    const x = x0 + 0.03 * Math.sin(f.t * 0.4 + i) + (1.1 - y) * 0.05 * (r() - 0.5);
    const dx = (x - 0.5) * f.w / f.h, dy = y - 0.5;
    const middle = smoothstep(0.12, 0.42, Math.hypot(dx * 0.7, dy * 1.3));
    const life = Math.sin(clamp((1.1 - y) / 1.25) * Math.PI);
    ctx.globalAlpha = clamp(life * middle * (0.7 + 0.3 * Math.sin(f.t * 0.9 + i * 2.3)));
    const d = size * 0.02 * scale;
    ctx.drawImage(sprite, x * f.w - d / 2, y * f.h - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

const titles = {
  id: 'titles',
  render(ctx, f, p) {
    const shot = f.shot % 3;
    if (shot === 0) handsShot(ctx, f, p);
    else if (shot === 1) flameShot(ctx, f, p, 0);
    else {
      flameShot(ctx, f, p, 0.45);
      embers(ctx, f, p);
    }
  },
};

// ---------------------------------------------------------------------------
// The void: Earth's lit limb at the bottom of the frame, stars barely moving.

const VOID = frag(`
float stars(vec2 p, float cell, float thr) {
  vec2 g = p / cell, i = floor(g), fr = fract(g);
  float h = hash(i);
  if (h < thr) return 0.0;
  vec2 o = 0.2 + 0.6 * hash2(i + 3.1);
  float d = length(fr - o) * cell * uResolution.y;
  float b = (h - thr) / (1.0 - thr);
  return b * b * smoothstep(1.3, 0.0, d);
}
void main() {
  vec2 p = centered();
  vec2 sp = p + vec2(uT * 0.0025, uT * 0.0008);
  float s = stars(sp, 0.011, 0.94) * 1.3 + stars(sp * 1.9 + 3.0, 0.011, 0.9) * 0.45;
  vec3 col = vec3(0.004, 0.006, 0.013) + vec3(0.88, 0.92, 1.0) * s;
  float R = 2.6;
  vec2 c = vec2(0.0, -0.5 - R + 0.11);
  vec2 d2 = p - c;
  float r = length(d2), dist = r - R;
  vec3 sun = normalize(vec3(0.62, 0.3, -0.72));
  vec2 n2 = d2 / r;
  float side = smoothstep(-0.2, 0.95, dot(n2, normalize(sun.xy)));
  if (dist < 0.0) {
    vec3 n = vec3(d2 / R, sqrt(max(0.0, 1.0 - r * r / (R * R))));
    float lam = dot(n, sun);
    float cloud = fbm(d2 * vec2(9.0, 30.0) + vec2(uT * 0.003, 0.0));
    vec3 surf = mix(vec3(0.02, 0.09, 0.22), vec3(0.85, 0.88, 0.92), smoothstep(0.52, 0.78, cloud));
    col = surf * smoothstep(-0.02, 0.35, lam) * 1.1;
    col += vec3(0.15, 0.4, 0.95) * exp(dist * 70.0) * side * 0.9;
  } else {
    col *= smoothstep(0.0, 0.02, dist);
    float rim = exp(-dist * 110.0) + 0.18 * exp(-dist * 16.0);
    col += vec3(0.25, 0.55, 1.0) * rim * side;
  }
  outColor = vec4(film(col), 1.0);
}`);

const voidScene = {
  id: 'void',
  render(ctx, f, p) {
    if (shade(ctx, f, p, VOID)) return;
    ctx.fillStyle = '#010204';
    ctx.fillRect(0, 0, f.w, f.h);
    const R = f.h * 2.6;
    const g = ctx.createRadialGradient(f.w / 2, f.h * 1.11 + R, R * 0.97, f.w / 2, f.h * 1.11 + R, R * 1.02);
    g.addColorStop(0, '#000');
    g.addColorStop(0.55, '#0b2a66');
    g.addColorStop(0.62, '#6fa8ff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, f.h);
  },
};

// ---------------------------------------------------------------------------
// Ice: 20,000 years ago.

// Ice shared GLSL: diamond dust, crystals drifting in three depth layers, each
// glinting briefly as it turns. Many crystals, random phases: the frame's
// total brightness stays steady. uRate slows the glints, uGlint dims them.
const ICE_LIB = `
uniform float uRate;
uniform float uGlint;
vec3 diamondDust(vec2 p, float t, vec3 tint) {
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = 8.0 + fl * 11.0;
    vec2 q = p + vec2(t * (0.045 - fl * 0.012), -t * (0.01 + 0.006 * fl));
    vec2 g = q * scale, ip = floor(g), fr = fract(g);
    float h = hash(ip + fl * 17.0);
    if (h > 0.4) continue;
    vec2 o = 0.25 + 0.5 * hash2(ip + fl * 5.0) + 0.06 * sin(t * (0.5 + h) + vec2(h * 30.0, h * 50.0));
    vec2 dv = (fr - o) / scale * uResolution.y;
    float ph = fract(t * uRate * (0.25 + 0.5 * hash(ip + 3.0 + fl)) + h * 11.0);
    float glint = smoothstep(0.05, 0.0, abs(ph - 0.5)) * uGlint;
    float size = 0.7 + 0.45 * (2.0 - fl);
    float core = exp(-dot(dv, dv) / (size * size));
    float flare = exp(-abs(dv.y) * 2.2) * exp(-abs(dv.x) * 0.7) + exp(-abs(dv.x) * 2.2) * exp(-abs(dv.y) * 0.7);
    acc += tint * (core * (0.14 + 0.9 * glint) + flare * glint * 0.18) * (1.0 - fl * 0.25);
  }
  return acc;
}
`;

// An ice sheet to the horizon under a racing cloud deck, the sun low in a gap
// at the horizon. The snow is a height field of wind-cut ridges lit by the
// sun: gold on the faces, sky-blue in the troughs, a sheen and glitter toward
// the sun. Spindrift streams across, near streaks broad, far ones fine.
const ICE_SHEET = frag(ICE_LIB + `
float sastrugi(vec2 w) {
  vec2 q = mat2(0.94, 0.34, -0.34, 0.94) * w;
  return fbm3(q * vec2(1.6, 6.5)) * 0.75 + 0.25 * noise(q * vec2(5.0, 22.0));
}
void main() {
  vec2 p = centered();
  float t = uT;
  float hz = -0.06;
  vec2 sun = vec2(0.35 * min(1.0, uResolution.x / uResolution.y * 0.7), hz + 0.035);
  float sx = p.x - sun.x;
  vec3 gold = vec3(1.0, 0.8, 0.55), skyBlue = vec3(0.42, 0.56, 0.74);
  vec3 col;
  if (p.y > hz) {
    float y = p.y - hz;
    float z = 0.3 / (y + 0.02);
    vec2 cp = vec2(p.x * z, z);
    float d = fbm(cp * 0.6 + vec2(t * 0.25, t * 0.55));
    float d2 = fbm3(cp * 1.6 + vec2(t * 0.4, t * 0.9) + d);
    float cover = smoothstep(0.3, 0.75, d * 0.7 + d2 * 0.4);
    float dist = length((p - sun) * vec2(1.0, 1.6));
    vec3 sky = mix(vec3(0.76, 0.74, 0.7), vec3(0.2, 0.27, 0.36), smoothstep(0.0, 0.45, y));
    vec3 cloud = mix(vec3(0.58, 0.62, 0.68), vec3(0.12, 0.15, 0.2), cover);
    col = mix(sky, cloud, smoothstep(0.0, 0.1, y) * 0.92);
    // Sunlight behind the deck: glowing through thin cloud, silver on the edges.
    col += gold * exp(-dist * 3.2) * (1.0 - 0.75 * cover) * 0.7;
    float edge = smoothstep(0.15, 0.45, cover) * (1.0 - smoothstep(0.45, 0.8, cover));
    col += gold * edge * exp(-dist * 3.5) * 0.9;
    // Shafts fanning up from the sun through the gaps.
    float ang = atan(p.y - sun.y, p.x - sun.x);
    float rays = noise(vec2(ang * 9.0, t * 0.06)) * noise(vec2(ang * 23.0, 3.0 + t * 0.04));
    col += gold * rays * exp(-dist * 3.0) * (1.0 - 0.8 * cover) * 0.3 * smoothstep(0.0, 0.05, p.y - sun.y);
    // The bright gap of clear sky at the horizon, the sun in it.
    float gap = exp(-y * 40.0);
    col = mix(col, mix(vec3(0.95, 0.8, 0.6), vec3(1.0, 0.97, 0.9), exp(-abs(sx) * 6.0)), gap * 0.85);
    col += gold * (exp(-length((p - sun) * vec2(1.0, 2.5)) * 18.0) * 1.3 + exp(-dist * 9.0) * 0.4);
    // Snow blowing off the ice, a moving haze along the horizon.
    float blow = fbm3(vec2(p.x * 5.0 - t * 1.5, y * 45.0));
    col = mix(col, vec3(0.92, 0.9, 0.86) + gold * exp(-abs(sx) * 4.0) * 0.2, smoothstep(0.4, 0.8, blow) * exp(-y * 30.0) * 0.5);
  } else {
    float z = 0.3 / (hz - p.y + 0.004);
    vec2 w = vec2(p.x * z, z);
    // The surface normal from the ridges' height field, fading with distance.
    float e = 0.02, amp = 0.16 * exp(-z * 0.1);
    float h = sastrugi(w);
    vec3 n = normalize(vec3(-(sastrugi(w + vec2(e, 0.0)) - h) / e * amp, 1.0, -(sastrugi(w + vec2(0.0, e)) - h) / e * amp));
    float grain = noise(w * 70.0);
    n = normalize(n + vec3(dFdx(grain), 0.0, dFdy(grain)) * 0.6 * exp(-z * 0.5));
    vec3 L = normalize(vec3(sun.x, 0.1, 1.0));
    vec3 V = -normalize(vec3(p.x, p.y - hz, 1.0));
    float shadow = smoothstep(0.45, 0.7, fbm3(w * 0.25 + vec2(t * 0.25, t * 0.55)));
    float direct = max(dot(n, L), 0.0) * (1.0 - 0.45 * shadow);
    vec3 amb = vec3(0.6, 0.7, 0.84) * (0.55 + 0.45 * n.y) * mix(0.7, 1.0, h) * (1.0 - 0.2 * shadow);
    col = 0.92 * (gold * 1.3 * direct + amb * 0.9);
    // A sharp sheen toward the sun, and glitter: single facets flashing.
    vec3 H = normalize(L + V);
    float fres = 0.3 + 0.7 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += gold * pow(max(dot(n, H), 0.0), 90.0) * fres * 1.4 * (1.0 - shadow);
    vec2 gc = floor(gl_FragCoord.xy / 2.0);
    float gh = hash(gc);
    float ph = fract(t * uRate * (0.3 + 0.5 * hash(gc + 1.7)) + gh * 13.0);
    col += gold * step(0.992, gh) * smoothstep(0.06, 0.0, abs(ph - 0.5)) * uGlint * direct * exp(-z * 0.25) * 1.2;
    // Spindrift: broad blurred streaks near, fine ones far, racing across.
    float sn = fbm3(vec2(w.x * 0.7 - t * 3.2, z * 2.5 + w.x * 0.1));
    float sf = fbm3(vec2(w.x * 3.0 - t * 2.0, z * 14.0));
    vec3 drift = vec3(0.95, 0.96, 1.0) + gold * exp(-abs(sx) * 3.0) * 0.3;
    col += drift * (smoothstep(0.5, 0.82, sn) * 0.32 * exp(-z * 0.6) + smoothstep(0.55, 0.8, sf) * 0.3 * smoothstep(0.8, 3.0, z) * exp(-z * 0.12));
    // Depth fog: the far ice dissolves into the glare under the cloud.
    vec3 haze = mix(vec3(0.7, 0.73, 0.77), vec3(1.0, 0.9, 0.74), exp(-abs(sx) * 3.0));
    col = mix(col, haze, 1.0 - exp(-z * 0.09));
  }
  col += diamondDust(p, t, gold * 1.2) * 0.7;
  outColor = vec4(film(col * 0.92), 1.0);
}`);

// A towering ice cliff. Light enters the ice and comes back blue, deeper blue
// the thicker the ice it crossed; strata and bubbles show through, bent by
// the fluted surface; the face is wet and glossy, meltwater trickles, the top
// edge glows where the ice is thin, and the cleft glows turquoise.
const ICE_WALL = frag(ICE_LIB + `
float flutes(vec2 p) {
  return fbm(vec2(p.x * 9.0 + fbm3(p * 3.0) * 1.5, p.y * 0.9)) * 0.7 + 0.3 * (1.0 - abs(fbm3(vec2(p.x * 30.0, p.y * 2.0)) * 2.0 - 1.0));
}
void main() {
  vec2 p = centered();
  float t = uT;
  float top = 0.3 + 0.06 * fbm3(vec2(p.x * 2.0, 1.0)) + 0.035 * noise(vec2(p.x * 22.0, 3.0));
  float h = flutes(p);
  vec2 gr = vec2(dFdx(h), dFdy(h)) * uResolution.y;
  // Clouds passing, and shafts of light sweeping across with them.
  float cl = smoothstep(0.3, 0.7, fbm3(vec2(p.x * 1.2 - t * 0.5, p.y * 0.6 + t * 0.1)));
  float shaftN = noise(vec2((p.x + p.y * 0.6) * 4.0 - t * 0.35, 0.5));
  float light = 0.35 + 0.6 * cl + 0.45 * smoothstep(0.55, 0.85, shaftN);
  vec3 skyCol = vec3(0.7, 0.75, 0.8);
  vec3 col;
  if (p.y > top) {
    float c = fbm3(vec2(p.x * 2.0 - t * 0.6, p.y * 5.0));
    col = mix(vec3(0.76, 0.8, 0.84), vec3(0.38, 0.44, 0.52), smoothstep(0.35, 0.7, c));
    col += vec3(1.0, 0.95, 0.85) * exp(-length(p - vec2(-0.6, 0.55)) * 3.0) * 0.4;
  } else {
    vec3 n = normalize(vec3(-gr * 0.03, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float depth = smoothstep(top, -0.5, p.y);
    // Refraction: the inner strata seen through the surface, shifted by it.
    vec2 q = p + n.xy * 0.05;
    float band = q.y * 22.0 + fbm3(q * vec2(1.5, 3.0)) * 6.0;
    float strata = smoothstep(0.55, 0.95, noise(vec2(band, floor(band) * 3.1))) * smoothstep(0.2, 0.9, fbm3(q * vec2(0.8, 2.0) + 4.0));
    // Subsurface: red is absorbed first, then green; thick ice turns deep blue.
    float thick = 0.05 + depth * 1.4 + (1.0 - h) * 0.9 + strata * 0.45;
    vec3 sss = exp(-vec3(2.4, 0.75, 0.3) * thick);
    float diffuse = max(dot(n, L), 0.0);
    col = sss * (0.3 + 0.95 * diffuse) * light + vec3(0.0, 0.015, 0.04);
    // Air bubbles trapped in the ice, small bright rings.
    vec2 bg = q * 42.0, bi = floor(bg);
    float bh = hash(bi);
    vec2 bo = 0.3 + 0.4 * hash2(bi + 4.0);
    float br = 0.08 + 0.12 * hash(bi + 9.0);
    float ring = smoothstep(0.05, 0.0, abs(length(fract(bg) - bo) - br)) * step(bh, 0.3);
    col += vec3(0.55, 0.85, 1.0) * ring * 0.1 * (1.0 - 0.6 * depth) * light;
    // Wet gloss: a sharp highlight on the flutes, the sky reflected at grazing angles.
    float fres = pow(1.0 - n.z, 2.0) * 4.0;
    vec3 R = reflect(-L, n);
    col += vec3(1.0, 0.98, 0.95) * pow(max(R.z, 0.0), 40.0) * light * 1.3;
    col += skyCol * clamp(fres, 0.0, 1.0) * 0.35 * light;
    // Meltwater: thin wet threads, drops sliding down them.
    float mc = floor(p.x * 45.0);
    float mh = hash(vec2(mc, 9.0));
    float thread = smoothstep(0.15, 0.0, abs(fract(p.x * 45.0) - 0.5)) * step(mh, 0.1) * smoothstep(top, top - 0.05, p.y);
    float dy = fract(p.y * 2.5 + t * uRate * 0.35 * (0.5 + mh) + mh * 7.0);
    col += vec3(0.9, 0.97, 1.0) * thread * (0.06 + smoothstep(0.03, 0.0, abs(dy - 0.5)) * 0.7 * uGlint) * light;
    // The top edge: thin ice lit through, a bright crisp rim.
    float under = top - p.y;
    col = mix(col, vec3(0.9, 0.98, 1.0), smoothstep(0.012, 0.0, under) * 0.9);
    col += vec3(0.2, 0.75, 0.95) * exp(-under * 35.0) * 0.45 * light;
    // The cleft, glowing turquoise from inside, its lips lit.
    float cx = p.x - 0.14 - 0.05 * (fbm3(vec2(p.y * 5.0, 2.0)) - 0.5);
    float w = 0.016 + 0.07 * depth;
    float inside = smoothstep(w, w * 0.4, abs(cx));
    vec3 glow = mix(vec3(0.2, 0.95, 0.9), vec3(0.0, 0.12, 0.22), depth) * (0.75 + 0.5 * fbm3(vec2(p.y * 6.0, cx * 20.0)));
    col = mix(col, glow, inside);
    col += vec3(0.3, 0.9, 1.0) * smoothstep(w * 1.6, w, abs(cx)) * (1.0 - inside) * 0.35;
    // Snow at the foot of the wall.
    if (p.y < -0.36 + 0.02 * fbm3(vec2(p.x * 3.0, 0.0))) {
      float drift = fbm3(p * vec2(3.0, 20.0));
      col = mix(vec3(0.3, 0.42, 0.56), vec3(0.7, 0.78, 0.86), drift) * (0.5 + 0.5 * light);
      col += vec3(0.1, 0.35, 0.45) * exp(-abs(p.x - 0.14) * 6.0) * 0.4; // the cleft's glow on the snow
      vec2 gc = floor(gl_FragCoord.xy / 2.0);
      float ph = fract(t * uRate * 0.4 * (0.5 + hash(gc + 2.0)) + hash(gc) * 9.0);
      col += vec3(1.0) * step(0.993, hash(gc)) * smoothstep(0.06, 0.0, abs(ph - 0.5)) * uGlint * light;
    }
  }
  // Shafts of light in the air in front of the wall.
  col += vec3(0.8, 0.9, 1.0) * pow(shaftN, 4.0) * 0.1;
  col += diamondDust(p, t, vec3(0.85, 0.95, 1.0)) * 0.6;
  outColor = vec4(film(col), 1.0);
}`);

// Polar night: star trails wheeling around the pole, curtains of aurora with
// rays, green below and violet above, their light on the snow and mirrored in
// the ice; a low fog over the ground.
const POLAR = frag(ICE_LIB + `
uniform float uArc;
float trails(vec2 d, float w, float seed) {
  float r = length(d), a = atan(d.y, d.x);
  float ri = floor(r / w);
  float h = hash(vec2(ri, seed));
  if (h < 0.35) return 0.0;
  float a0 = hash(vec2(ri, seed + 7.0)) * 6.2832;
  float da = mod(a - a0, 6.2832);
  float along = smoothstep(0.0, 0.02, da) * smoothstep(uArc, uArc - 0.03, da);
  float off = abs(r - (ri + 0.5) * w);
  float px = fwidth(r) * 0.8;
  float b = pow((h - 0.35) / 0.65, 2.5);
  return along * b * smoothstep(px * 1.6, 0.0, off);
}
// Two curtains; blur 0..1 softens the rays (for glow and reflections).
vec3 aurora(vec2 p, float t, float blur) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float x = p.x + fi * 0.3;
    float base = -0.15 + fi * 0.06 + 0.06 * sin(x * 1.8 + t * 0.04 + fi * 2.0) + 0.05 * (fbm3(vec2(x * 0.9 + fi * 5.0, t * 0.02)) - 0.5);
    float above = p.y - base;
    if (above < -0.08) continue;
    float fold = (x + above * 0.15) * 34.0 * (1.0 - blur * 0.7) + 4.0 * sin(x * 3.0 + t * 0.05 + fi);
    float rays = mix(pow(fbm3(vec2(fold, t * 0.04 + fi * 3.0)), 2.0) * 2.2, 0.5, blur);
    float lower = smoothstep(-0.008 - blur * 0.04, 0.004, above);
    float dens = lower * (exp(-max(above, 0.0) * (6.0 + fi * 3.0)) * (0.18 + rays) + exp(-abs(above) * 45.0) * 0.6 * (1.0 - blur * 0.6));
    dens += exp(-abs(above) * 12.0) * 0.1;
    dens *= smoothstep(0.95, 0.2, abs(p.x + 0.05 - fi * 0.25));
    vec3 c = mix(vec3(0.1, 0.9, 0.45), vec3(0.15, 0.8, 0.65), smoothstep(0.0, 0.1, above));
    c = mix(c, vec3(0.5, 0.16, 0.6), smoothstep(0.08, 0.32, above));
    acc += c * dens * (0.3 - fi * 0.1);
  }
  return acc;
}
void main() {
  vec2 p = centered();
  float t = uT;
  float hz = -0.28 + 0.012 * fbm3(vec2(p.x * 3.0, 0.0));
  vec3 col = mix(vec3(0.02, 0.035, 0.07), vec3(0.003, 0.005, 0.015), smoothstep(hz, 0.5, p.y));
  if (p.y > hz) {
    vec2 d = p - vec2(0.12, 0.34);
    float s = trails(d, 0.0065, 1.0) + trails(d, 0.0049, 2.0) * 0.6;
    col += vec3(0.85, 0.9, 1.0) * s * 1.6;
    col += aurora(p, t, 0.0);
    float y = p.y - hz;
    if (y < 0.2) {
      vec3 fogCol = vec3(0.05, 0.09, 0.11) + aurora(vec2(p.x, hz + 0.08), t, 1.0) * 0.5;
      float fog = fbm3(vec2(p.x * 2.5 - t * 0.02, y * 14.0)) * exp(-y * 20.0);
      col = mix(col, fogCol, fog * 0.5);
    }
  } else {
    float z = 0.2 / (hz - p.y + 0.01);
    vec2 w = vec2(p.x * z, z);
    float snow = fbm3(w * vec2(2.0, 1.5));
    // Smooth ice between the snow: a dark mirror.
    float ice = smoothstep(0.38, 0.55, fbm3(w * vec2(0.5, 1.2) + 7.0));
    vec3 glow = aurora(vec2(p.x, hz + 0.06), t, 1.0);
    vec3 fogCol = vec3(0.05, 0.09, 0.11) + glow * 0.5;
    col = vec3(0.05, 0.075, 0.11) * (0.6 + 0.6 * snow) + glow * 1.8 * (0.5 + 0.5 * snow) * (1.0 - 0.5 * ice) * exp(-(hz - p.y) * 3.0);
    vec2 rp = vec2(p.x + 0.004 * sin(z * 30.0 + p.x * 20.0), hz + 0.07 + (hz - p.y) * 0.9);
    col = mix(col, vec3(0.01, 0.02, 0.035) + aurora(rp, t, 0.3) * 1.1, ice * 0.85);
    float fog = fbm3(vec2(w.x * 0.5 - t * 0.03, z * 0.7)) * exp(-(hz - p.y) * 6.0);
    col = mix(col, fogCol, fog * 0.4);
  }
  col += diamondDust(p, t, vec3(0.55, 0.95, 0.8)) * 0.3;
  outColor = vec4(film(col), 1.0);
}`);

const ice = {
  id: 'ice',
  render(ctx, f, p) {
    const shot = f.shot % 3;
    const slow = f.reduced ? 0.5 : 1;
    // Reduced motion: glints slower and dimmer.
    const dust = { uRate: f.reduced ? 0.35 : 1, uGlint: f.reduced ? 0.45 : 1 };
    if (shot === 0 && !shade(ctx, f, p, ICE_SHEET, { uT: f.t * slow, ...dust })) gradient(ctx, f, ['#39424d', '#a9b3bb', '#d6dde2', '#8f9ea9']);
    if (shot === 1 && !shade(ctx, f, p, ICE_WALL, { uT: f.t * slow, ...dust })) gradient(ctx, f, ['#b8c2cb', '#9fd0e6', '#1c4f73', '#06172a']);
    if (shot === 2 && !shade(ctx, f, p, POLAR, { uT: f.t * slow, uArc: 0.1 + f.shotT * 0.11 * slow, ...dust })) gradient(ctx, f, ['#010207', '#04101a', '#0a1420']);
  },
};

// ---------------------------------------------------------------------------
// The Holocene: mesas, a river of cloud, the sun racing, a wave.

// Desert GLSL shared by the mesas and the canyon: sandstone and sand.
const DESERT_LIB = `
// Colorado Plateau formations, foot to cap (u 0..1): mauve slope shales,
// a deep red cliff, ledgy red-brown and purple beds, a buff cap.
vec3 formation(float u) {
  vec3 c = mix(vec3(0.56, 0.3, 0.24), vec3(0.46, 0.36, 0.32), step(0.5, fract(u * 18.0)) * 0.6);
  c = mix(c, vec3(0.74, 0.3, 0.14), smoothstep(0.27, 0.32, u));
  c = mix(c, mix(vec3(0.62, 0.32, 0.2), vec3(0.55, 0.3, 0.3), 0.5 * noise(vec2(u * 30.0, 2.0))), smoothstep(0.6, 0.64, u));
  return mix(c, vec3(0.86, 0.66, 0.48), smoothstep(0.74, 0.8, u));
}
// A sandstone face at screen point p, u up the cliff (0..1). n is the face's
// normal, L the sun; key, fill (sky) and bounce (red ground) are the light.
vec3 sandstone(vec2 p, float u, float seed, vec3 n, vec3 L, vec3 key, vec3 fill, vec3 bounce) {
  float uw = u + 0.05 * (noise(vec2(p.x * 3.0 + seed * 9.0, seed)) - 0.5);
  float bn = uw * 16.0, bi = floor(bn), bf = fract(bn);
  float bh = hash(vec2(bi, seed * 13.0)), bh1 = hash(vec2(bi + 1.0, seed * 13.0));
  vec3 rock = formation(uw) * (0.84 + 0.28 * bh);
  // Vertical fluting bends the normal from side to side.
  float fx = p.x * 40.0 + seed * 7.0;
  float fl = fbm3(vec2(fx, p.y * 1.2)), fr = fbm3(vec2(fx + 0.08, p.y * 1.2));
  // Buttresses and recesses: broad facets turning toward or away from the sun.
  float bx = p.x * 7.0 + seed * 3.0;
  n = normalize(n + vec3((fl - fr) * 3.0 + (noise(vec2(bx, seed)) - noise(vec2(bx + 0.3, seed))) * 2.5, 0.0, 0.0));
  // Hard beds jut out as ledges: their tops face the sky, their overhangs
  // cast a sharp shadow on the softer bed below.
  float hard = step(0.55, bh);
  float ledge = smoothstep(0.88, 0.97, bf) * hard * step(0.3, u);
  float under = smoothstep(0.5, 0.9, bf) * step(0.55, bh1) * (1.0 - hard) * step(0.3, u);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.6), ledge * 0.6));
  vec3 c = rock * (key * max(dot(n, L), 0.0) * 1.7 + fill * (0.55 + 0.45 * n.y) + bounce * (1.0 - u));
  c *= 1.0 - 0.55 * under;
  // Desert varnish streaking down the cliff, and joints cutting it.
  float v = smoothstep(0.52, 0.78, fbm3(vec2(p.x * 110.0 + seed * 3.0, uw * 2.5)));
  c *= 1.0 - 0.5 * v * smoothstep(0.28, 0.4, u) * (1.0 - smoothstep(0.75, 0.8, u) * 0.6);
  float jx = p.x * 14.0 + 0.08 * noise(vec2(p.y * 30.0, seed)) + seed * 4.0;
  float joint = smoothstep(0.018, 0.0, abs(fract(jx) - 0.5)) * step(0.72, hash(vec2(floor(jx), seed)));
  c *= 1.0 - 0.5 * joint * step(0.32, u) * step(u, 0.78);
  return c;
}
// Scree and fallen boulders on the slopes at the foot of a cliff.
vec3 scree(vec2 p, float seed, vec3 key, vec3 fill) {
  // Rills: gullies washed down the slope, lit on one side.
  float rill = fbm3(vec2(p.x * 60.0 + seed, p.y * 5.0));
  float rl = fbm3(vec2(p.x * 60.0 + seed + 0.6, p.y * 5.0));
  vec3 c = formation(0.12 + 0.1 * noise(p * vec2(20.0, 60.0))) * (0.7 + 0.5 * rill);
  c *= key * clamp(0.75 + (rill - rl) * 4.0, 0.2, 1.4) + fill;
  vec2 g = p * vec2(55.0, 75.0) + seed * 3.0, ip = floor(g), fp = fract(g) - 0.5;
  float r = 0.16 + 0.18 * hash(ip);
  float b = step(hash(ip + 1.0), 0.1) * smoothstep(r, r - 0.06, length(fp * vec2(1.0, 1.3)));
  float lit = clamp(0.5 - fp.x * 2.0 + fp.y * 1.5, 0.0, 1.0);
  vec3 rock = formation(0.4 + 0.5 * hash(ip + 2.0)) * 0.8 * (key * (0.25 + lit) + fill * 0.7);
  float sh = step(hash(ip + 1.0), 0.1) * smoothstep(r, r - 0.06, length((fp - vec2(-0.22, 0.05)) * vec2(1.0, 1.3))) * (1.0 - b);
  return mix(c * (1.0 - 0.5 * sh), rock, b);
}
// The floor at distance z (ground coords w): dunes, ripples catching the
// grazing light, grain, scrub and stones with shadows cast to the right.
vec3 desertFloor(vec2 w, float z, vec3 key, vec3 fill) {
  float dune = fbm3(w * vec2(0.35, 0.9));
  float rip = sin((w.x * 0.45 + w.y + dune * 2.5) * 38.0) * exp(-z * 0.35);
  vec3 sand = mix(vec3(0.82, 0.52, 0.3), vec3(0.6, 0.33, 0.18), smoothstep(0.35, 0.7, dune));
  vec3 c = sand * (key * (0.75 + 0.6 * (dune - 0.5) + 0.25 * rip) + fill);
  c *= 0.93 + 0.14 * hash(floor(gl_FragCoord.xy));
  // Scrub and stones: one per cell at most, round in the ground plane (so
  // flattened by perspective), each with a shadow cast away from the sun.
  float near = smoothstep(9.0, 2.0, z);
  vec2 g = w * vec2(7.0, 5.0), ip = floor(g), fp = fract(g);
  float kind = hash(ip);
  vec2 o = 0.3 + 0.4 * hash2(ip + 3.0);
  float r = 0.1 + 0.16 * hash(ip + 5.0);
  float body = smoothstep(r, r * 0.7, length((fp - o) * vec2(1.0, 0.75)) + 0.05 * noise(fp * 12.0 + ip));
  float shade_ = smoothstep(r * 1.1, r * 0.6, length((fp - o - vec2(r * 1.3, 0.02)) * vec2(0.55, 0.75)));
  float bush = step(kind, 0.22) * near, stone = step(0.93, kind) * near;
  c *= 1.0 - 0.5 * shade_ * (1.0 - body) * (bush + stone) * clamp(key.r, 0.0, 1.0);
  vec3 scrub = vec3(0.14, 0.14, 0.07) * (0.5 + key * 0.7 * (0.6 + 0.6 * noise(fp * 20.0 + ip)));
  c = mix(c, scrub, body * bush);
  return mix(c, formation(0.5) * 0.8 * (key * (0.6 + 0.6 * (o.y - fp.y + 0.3)) + fill), body * stone);
}
`;

// Desert mesas at dawn in time-lapse: from silhouettes against the glow to
// sunlit sandstone. The sun is low on the left; its light shafts through the
// gaps between the buttes, cloud shadows race over the land, and the distant
// mesas fade blue into the air.
const MESAS = frag(DESERT_LIB + `
uniform float uSun;
const float GROUND = -0.16;
// Mesas and a butte, far to near: (center, half width, height, distance).
const vec4 M[5] = vec4[5](vec4(-0.2, 0.5, 0.1, 1.0), vec4(0.75, 0.3, 0.13, 0.8), vec4(-0.7, 0.28, 0.2, 0.45),
                          vec4(0.36, 0.16, 0.15, 0.35), vec4(-0.02, 0.06, 0.26, 0.2));
float cloudShadow(vec2 w, float t) { return smoothstep(0.44, 0.68, fbm3(w * 0.9 + vec2(t * 0.28, t * 0.05))); }
// The skyline, simplified, for the light shafts.
float skyline(float x) {
  float s = GROUND;
  for (int i = 0; i < 5; i++) {
    vec4 m = M[i];
    s = max(s, GROUND - 0.035 * (1.0 - m.w) + m.z * smoothstep(m.y + 0.03, m.y, abs(x - m.x)));
  }
  return s;
}
void main() {
  vec2 p = centered();
  float t = uT;
  float asp = uResolution.x / uResolution.y;
  // Heat shimmer along the horizon.
  p.y += 0.0012 * sin(p.x * 140.0 + t * 6.0) * exp(-abs(p.y - GROUND) * 40.0);
  float up = uSun;
  vec2 sunP = vec2(-0.5 * asp - 0.12, GROUND + 0.02 + 0.3 * up);
  vec3 L = normalize(vec3(-0.85, 0.12 + 0.5 * up, 0.5));
  vec3 sunCol = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.86, 0.68), up);
  vec3 key = sunCol * mix(0.05, 1.0, up);
  vec3 fill = mix(vec3(0.05, 0.05, 0.08), vec3(0.2, 0.26, 0.36), up);
  vec3 bounce = vec3(0.28, 0.12, 0.05) * up;
  float h = p.y - GROUND;
  float sunD = length((p - sunP) * vec2(1.0, 1.4));
  // The sky: warm dust at the horizon, deep blue overhead, the sun's glow.
  vec3 haze = mix(vec3(1.0, 0.6, 0.34), vec3(0.8, 0.76, 0.72), up);
  vec3 col = vec3(0.0);
  // Near to far: the first mesa the pixel falls on hides the rest. The loop
  // only finds it; the shading runs once, after.
  bool hit = false;
  vec4 m = vec4(0.0);
  float base = 0.0, d = 0.0, talus = 0.0, cliff = 0.0, top = 0.0;
  for (int i = 4; i >= 0; i--) {
    m = M[i];
    base = GROUND - 0.035 * (1.0 - m.w);
    if (p.y < base || p.y > base + m.z + 0.03) continue;
    // Cheap rejections before the noise: well clear of the talus, or of the
    // cliff and above the talus.
    float d0 = abs(p.x - m.x) - m.y - 0.06 * m.z;
    if (d0 > 0.03 + m.z * 0.75 || (d0 > 0.014 && p.y > base + m.z * 0.34 + 0.012)) continue;
    // The cliff line wanders: buttresses and gullies cut into each flank,
    // and a butte narrows a little towards its caprock.
    float gul = fbm3(vec2(p.y * 14.0 + m.w * 5.0, m.w * 3.0)) - 0.5;
    d = abs(p.x - m.x) - m.y * (1.0 - 0.12 * smoothstep(base, base + m.z, p.y) * step(m.y, 0.1)) + 0.12 * gul * m.z;
    talus = m.z * 0.34 * smoothstep(0.03 + m.z * 0.75, -0.01, d);
    cliff = m.z * smoothstep(0.012, -0.004, d) + 0.012 * (noise(vec2(p.x * 8.0, m.w * 9.0)) - 0.5);
    top = base + max(cliff, talus) + 0.004 * noise(vec2(p.x * 80.0, m.w));
    if (p.y > top) continue;
    hit = true;
    break;
  }
  if (hit) {
    float sh = cloudShadow(vec2(p.x * 2.5, 2.5 + p.y + m.w), t);
    vec3 k = key * (1.0 - 0.7 * sh);
    float onTalus = smoothstep(base + talus + 0.01, base + talus - 0.03, p.y);
    // The face turns sideways on the flanks: the left ones face the sun.
    float side = smoothstep(-0.03, 0.0, d) * sign(p.x - m.x);
    vec3 n = normalize(vec3(side * 1.4, 0.0, 1.0));
    vec3 rock = onTalus >= 1.0 ? vec3(0.0) : sandstone(p, (p.y - base) / m.z, m.w * 7.0, n, L, k, fill, bounce);
    if (onTalus > 0.0) rock = mix(rock, scree(p, m.w * 5.0, k, fill + bounce), onTalus);
    // Rim light along the caprock edge.
    rock += sunCol * smoothstep(0.005, 0.0, top - p.y) * step(talus + 0.02, cliff) * 0.5 * up * (1.0 - sh);
    // Aerial perspective: the far mesas paler and bluer.
    vec3 air = mix(haze, vec3(0.62, 0.68, 0.8), 0.5 * up) * mix(0.2, 0.9, up);
    col = mix(rock, air, m.w * 0.5);
  }
  if (!hit) {
    col = mix(haze, mix(vec3(0.1, 0.2, 0.38), vec3(0.08, 0.24, 0.46), up), smoothstep(0.0, 0.6, h));
    col += sunCol * (exp(-sunD * 2.2) * 0.7 + exp(-sunD * 7.0) * 0.5);
    if (h > 0.0) {
      // Cumulus in perspective, lit from the sun's side, dark underneath.
      float z = 0.22 / (h + 0.03);
      vec2 cq = vec2(p.x * z, z) * 1.1 + vec2(t * 0.28, t * 0.05);
      float d = fbm(cq);
      float dl = fbm3(cq + vec2(-0.25, 0.08));
      float cover = smoothstep(0.47, 0.7, d) * smoothstep(0.0, 0.1, h);
      float lit = clamp((d - dl) * 5.0 + 0.55, 0.0, 1.0);
      vec3 cloud = mix(vec3(0.34, 0.3, 0.36) * (0.4 + 0.6 * up), sunCol * (0.75 + 0.35 * up), lit);
      cloud += sunCol * smoothstep(0.47, 0.55, d) * (1.0 - smoothstep(0.55, 0.65, d)) * exp(-sunD * 1.5) * 0.6;
      col = mix(col, cloud, cover);
    } else {
      float z = 0.25 / (-h + 0.01);
      vec2 w = vec2(p.x * z, z);
      float sh = cloudShadow(w, t);
      col = desertFloor(w, z, key * (1.0 - 0.7 * sh), fill + bounce * 0.5);
      // Sand blowing across in thin sheets near the ground.
      float sheet = fbm3(vec2(w.x * 0.6 - t * 1.8, z * 4.0));
      col += sunCol * smoothstep(0.55, 0.8, sheet) * 0.2 * exp(-z * 0.25) * up;
      col = mix(col, haze * mix(0.2, 0.9, up), 1.0 - exp(-z * 0.11));
    }
  }
  // Dust in the air lit by the low sun, in shafts through the gaps between
  // the buttes (the shadow of the skyline, sampled toward the sun).
  vec2 dir = normalize(sunP - p);
  float vis = 0.0;
  float jitter = hash(gl_FragCoord.xy);
  for (int i = 0; i < 5; i++) {
    vec2 q = p + dir * 0.06 * (float(i) + jitter);
    vis += step(skyline(q.x), q.y);
  }
  float dust = exp(-max(h, 0.0) * 3.0) * (1.0 - 0.6 * up) * exp(-sunD * 0.9);
  col += sunCol * (vis / 5.0) * dust * 0.3;
  outColor = vec4(film(col), 1.0);
}`);

// A river of cloud in fast time-lapse over a low dark horizon.
const CLOUD_RIVER = frag(`
void main() {
  vec2 p = centered();
  float t = uT * 0.5;
  float hz = -0.34 + 0.02 * fbm(vec2(p.x * 2.5, 0.0));
  vec3 col = vec3(0.012, 0.01, 0.014);
  if (p.y > hz) {
    float h = p.y - hz;
    float z = 0.3 / (h + 0.02);
    vec2 q = vec2(p.x * z, z) * 0.5 + vec2(t * 0.3, -t);
    vec2 w = vec2(fbm(q * 0.7 + t * 0.15), fbm(q * 0.7 + vec2(4.0, t * 0.1)));
    float d = fbm(q + (w - 0.5) * 1.8);
    float cover = smoothstep(0.4, 0.68, d);
    vec3 sky = mix(vec3(0.95, 0.6, 0.36), vec3(0.05, 0.16, 0.3), smoothstep(0.0, 0.5, h));
    vec3 lit = mix(vec3(1.0, 0.78, 0.58), vec3(0.95, 0.92, 0.9), smoothstep(0.0, 0.4, h));
    vec3 cloud = mix(lit, vec3(0.14, 0.16, 0.22), smoothstep(0.5, 0.85, d));
    cloud = mix(cloud, sky, exp(-h * 9.0) * 0.8);
    col = mix(sky, cloud, cover);
  }
  outColor = vec4(film(col), 1.0);
}`);

// A canyon while the sun arcs overhead, day to dusk (uK 0..1). The sun sets
// behind the right wall, whose shadow climbs the floor and then the left wall;
// the shaded right wall glows with light bounced off the left one.
const SUN_ARC = frag(DESERT_LIB + `
uniform float uK;
uniform vec2 uSunPos;
void main() {
  vec2 p = centered();
  float k = uK;
  vec3 day = mix(vec3(0.78, 0.76, 0.7), vec3(0.1, 0.27, 0.5), smoothstep(0.1, 0.9, vUv.y));
  vec3 dusk = mix(vec3(1.0, 0.46, 0.15), vec3(0.06, 0.08, 0.2), smoothstep(0.1, 0.85, vUv.y));
  vec3 col = mix(day, dusk, smoothstep(0.3, 1.0, k));
  float sd = length(p - uSunPos);
  vec3 sunCol = mix(vec3(1.0, 0.94, 0.84), vec3(1.0, 0.55, 0.2), k);
  col += sunCol * (exp(-sd * 3.0) * 0.25 + exp(-sd * 9.0) * (0.4 + 0.4 * k));
  // High cloud racing across in time-lapse, lit by the sun near it.
  float z = 0.4 / (p.y + 0.62);
  float cl = fbm(vec2(p.x * z * 1.2 - uT * 0.35, z * 2.2 + uT * 0.05));
  float cover = smoothstep(0.52, 0.75, cl) * smoothstep(-0.2, 0.2, p.y);
  col = mix(col, mix(col * 0.75, sunCol * 1.1, exp(-sd * 3.5) * 0.8 + 0.2), cover * 0.7);
  col = mix(col, sunCol * 1.3, smoothstep(0.03, 0.025, sd));
  float asp = uResolution.x / uResolution.y;
  float floorY = -0.3;
  float rise = p.y - floorY;
  // Canyon walls opening upward, their edges broken into ledges.
  float edgeL = -0.1 * asp - 0.04 - 0.32 * rise + 0.05 * (fbm3(vec2(p.y * 7.0, 1.0)) - 0.5) - 0.02 * step(0.5, fract(p.y * 6.0 + 0.3));
  float edgeR = 0.1 * asp + 0.05 + 0.3 * rise + 0.05 * (fbm3(vec2(p.y * 7.0, 4.0)) - 0.5) + 0.015 * step(0.6, fract(p.y * 5.0));
  float topL = 0.14 + 0.03 * fbm3(vec2(p.x * 6.0, 0.0));
  float topR = 0.05 + 0.03 * fbm3(vec2(p.x * 6.0, 5.0));
  float sun = smoothstep(-0.25, 0.1, uSunPos.y);
  // One shadow edge for the floor and the left wall, climbing as the sun sinks.
  float line = mix(-0.62, 0.2, smoothstep(0.05, 0.95, k)) + 0.22 * (p.x - edgeR) + 0.03 * (fbm3(vec2(p.x * 9.0, 2.0)) - 0.5);
  float inLight = smoothstep(line - 0.004, line + 0.004, p.y) * sun;
  vec3 lit = mix(vec3(0.9, 0.5, 0.26), vec3(1.0, 0.42, 0.13), k);
  vec3 shade = mix(vec3(0.05, 0.08, 0.12), vec3(0.16, 0.07, 0.04), 0.5 * sun) * (1.2 - 0.5 * k);
  bool left = p.x < edgeL && p.y < topL;
  bool right = p.x > edgeR && p.y < topR;
  vec3 L = normalize(vec3(uSunPos.x * 1.5, max(uSunPos.y + 0.4, 0.05), 0.6));
  vec3 fill = shade * 1.3 + vec3(0.04, 0.06, 0.1) * (1.0 - k);
  if (left || right) {
    float top = left ? topL : topR;
    float u = clamp((p.y - floorY) / (top - floorY), 0.0, 1.0) * 0.66 + 0.34;
    if (left) {
      // Facing the evening sun, lit above the climbing shadow line.
      col = sandstone(p, u, 3.0, vec3(0.8, 0.0, 0.6), L, lit * inLight * 1.1, fill, vec3(0.0));
    } else {
      // Facing away: lit only at midday, then the warm bounce from across.
      float direct = 0.8 * (1.0 - smoothstep(0.1, 0.5, k)) * sun;
      vec3 bounce = vec3(0.4, 0.16, 0.07) * (1.0 - smoothstep(0.6, 1.0, k)) * smoothstep(edgeR + 0.4, edgeR, p.x);
      col = sandstone(p, u, 8.0, vec3(-0.8, 0.0, 0.6), vec3(-L.x, L.y, L.z), lit * direct, fill + bounce * 0.6, bounce);
    }
    // Scree at the foot of both walls.
    float foot = floorY + 0.06 + 0.03 * fbm3(vec2(p.x * 5.0, 3.0));
    float onScree = smoothstep(foot + 0.01, foot - 0.01, p.y) * smoothstep(0.1, 0.0, abs(p.x - (left ? edgeL : edgeR)) - 0.02);
    col = mix(col, scree(p, left ? 2.0 : 6.0, lit * (left ? inLight : 0.2), fill), onScree);
    // Rim light where the sun grazes the top edge.
    col += lit * smoothstep(0.008, 0.0, top - p.y) * 0.5 * sun * (left ? 1.0 : 1.0 - k);
  } else if (p.y < floorY + 0.02 * fbm3(vec2(p.x * 4.0, 2.0))) {
    float z = 0.3 / (floorY - p.y + 0.05);
    col = desertFloor(vec2(p.x * z, z), z, lit * inLight * mix(1.0, 1.1, k), fill);
    col = mix(col, fill * 1.5, 1.0 - exp(-z * 0.08));
  }
  // Dust in the canyon air, glowing where the light shafts through.
  col += lit * inLight * 0.08 * exp(-max(p.y - floorY, 0.0) * 2.5) * (0.5 + 0.5 * k);
  outColor = vec4(film(col), 1.0);
}`);

// A wave in extreme slow motion: the face backlit green, the lip feathering.
const WAVE = frag(`
void main() {
  vec2 p = centered();
  float t = uT * 0.1;
  float x = p.x;
  // A peak left of center, rising very slowly.
  float peak = exp(-pow(x + 0.22 - t * 0.04, 2.0) * 2.2);
  float crest = -0.04 + 0.17 * peak + 0.025 * (fbm3(vec2(x * 2.5, t * 0.5)) - 0.5) + t * 0.015;
  vec2 sun = vec2(0.3, 0.24);
  vec3 col = mix(vec3(1.0, 0.76, 0.48), vec3(0.24, 0.34, 0.42), smoothstep(0.0, 0.5, p.y));
  col += vec3(1.0, 0.72, 0.38) * exp(-length(p - sun) * 5.0) * 0.7;
  if (p.y < 0.0) col = mix(vec3(0.03, 0.12, 0.15), vec3(0.95, 0.7, 0.45), exp(p.y * 40.0) * 0.7);
  float y = p.y - crest;
  if (y < 0.0) {
    float depth = -y;
    vec3 face = mix(vec3(0.0, 0.04, 0.06), vec3(0.08, 0.46, 0.4), exp(-depth * 5.0));
    // Low sun shining through the thin water under the crest.
    face += vec3(0.85, 0.75, 0.3) * exp(-depth * 16.0) * (0.25 + 0.5 * peak);
    float streak = fbm(vec2(x * 11.0 + fbm3(p * 2.0) * 3.0, depth * 1.5 - t));
    face *= 0.7 + 0.6 * streak;
    // Foam lace: thin threads drawn up the face.
    float lace = 1.0 - abs(fbm(vec2(x * 4.0, depth * 5.0 - t * 1.5) + fbm3(p * 3.0)) * 2.0 - 1.0);
    face = mix(face, vec3(0.6, 0.78, 0.76), smoothstep(0.75, 1.0, lace) * smoothstep(0.04, 0.25, depth) * 0.3);
    // White water along the lip where it breaks.
    float lip = smoothstep(0.04, 0.0, depth) * smoothstep(0.35, 0.8, peak + 0.3 * fbm3(vec2(x * 9.0, t)));
    col = mix(face, vec3(0.96, 0.93, 0.86), lip);
  } else {
    // Spray feathering off the crest, blown back, lit gold from behind.
    float spray = fbm(vec2(x * 5.0 - y * 3.0 - t * 0.8, y * 10.0 - t * 1.2)) * exp(-y * 11.0) * (0.35 + peak);
    col = mix(col, vec3(1.0, 0.9, 0.72), smoothstep(0.3, 0.75, spray) * 0.85);
  }
  outColor = vec4(film(col), 1.0);
}`);

const holocene = {
  id: 'holocene',
  render(ctx, f, p) {
    const shot = f.shot % 4;
    const slow = f.reduced ? 0.5 : 1;
    const t = f.t * slow * (f.bpm / 84);
    if (shot === 0 && !shade(ctx, f, p, MESAS, { uT: t, uSun: 0.15 + 0.85 * smoothstep(0.5, 8, f.shotT) })) gradient(ctx, f, ['#1f4466', '#e8995a', '#6a2a14', '#3a1c0e']);
    if (shot === 1 && !shade(ctx, f, p, CLOUD_RIVER, { uT: t })) gradient(ctx, f, ['#0b2440', '#8c7a78', '#f2a060', '#050405']);
    if (shot === 2) {
      const k = clamp(f.shotT / 7);
      const a = 2.15 - k * 1.75;
      const R = 0.55 * Math.min(1.15, (f.w / f.h) * 0.9);
      const sun = [Math.cos(a) * R, -0.35 + Math.sin(a) * R * 1.2];
      if (!shade(ctx, f, p, SUN_ARC, { uK: k, uSunPos: sun })) gradient(ctx, f, ['#18223a', '#e98038', '#2a1510']);
    }
    if (shot === 3 && !shade(ctx, f, p, WAVE, { uT: t })) gradient(ctx, f, ['#c8b49a', '#1f8a78', '#021418']);
  },
};

// ---------------------------------------------------------------------------
// Fields: straight down on a primeval canopy. Choice 1 clears it or farms within it.

// Tree crowns as Voronoi domes, cloud shadows passing. uClear (0..1, the
// share of the frame) turns field cells into a patchwork, from the frame's
// edges inward; uGarden (0..1, the share of the remaining forest) opens small
// garden clearings in the canopy.
// uForest thins the canopy in the later aerials.
const CANOPY_LIB = `
vec3 crowns(vec2 p, float scale, float t) {
  vec2 g = p * scale, ip = floor(g), fp = fract(g);
  float best = 9.0; vec2 rel = vec2(0.0); float id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 n = vec2(i, j);
    vec2 h = hash2(ip + n);
    vec2 o = 0.5 + 0.38 * sin(6.2832 * h + vec2(0.0, 1.7)) + 0.03 * sin(t * 0.9 + h.x * 20.0);
    float size = 0.75 + 0.5 * hash(ip + n + 9.0);
    vec2 r = (n + o - fp) / size;
    float d = length(r);
    if (d < best) { best = d; rel = r; id = hash(ip + n + 4.0); }
  }
  float dome = sqrt(max(0.0, 1.0 - best * best));
  float lit = clamp(dot(normalize(vec3(-rel, dome + 0.001)), normalize(vec3(-0.5, 0.6, 0.62))), 0.0, 1.0);
  vec3 leaf = mix(vec3(0.07, 0.2, 0.08), vec3(0.2, 0.3, 0.1), id);
  if (id > 0.85) leaf = vec3(0.26, 0.32, 0.12);
  if (id < 0.12) leaf = vec3(0.05, 0.15, 0.12);
  vec3 c = leaf * (0.25 + 1.0 * lit) * (0.8 + 0.4 * noise(p * scale * 6.0));
  return mix(vec3(0.01, 0.03, 0.015), c, smoothstep(1.05, 0.8, best));
}
vec3 patchwork(vec2 p, out float id) {
  vec2 g = mat2(0.96, -0.28, 0.28, 0.96) * p * vec2(6.0, 4.5);
  vec2 cell = floor(g), fr = fract(g);
  // Split some fields in two, across or along.
  float split = hash(cell + 7.0);
  float half_ = split < 0.4 ? step(0.45, fr.x) : split < 0.7 ? step(0.55, fr.y) : 0.0;
  vec2 edge = min(fr, 1.0 - fr);
  if (split < 0.4) edge.x = min(edge.x, abs(fr.x - 0.45));
  else if (split < 0.7) edge.y = min(edge.y, abs(fr.y - 0.55));
  id = hash(cell + 31.0 + half_ * 13.0);
  vec3 c = id < 0.25 ? vec3(0.74, 0.56, 0.28) : id < 0.5 ? vec3(0.42, 0.5, 0.2) : id < 0.7 ? vec3(0.44, 0.3, 0.18) : id < 0.85 ? vec3(0.6, 0.58, 0.32) : vec3(0.1, 0.2, 0.08);
  float furrow = 0.86 + 0.14 * sin((hash(cell + half_) > 0.5 ? fr.x : fr.y) * 70.0);
  float hedge = smoothstep(0.025, 0.0, min(edge.x, edge.y));
  return mix(c * furrow * (0.85 + 0.3 * noise(p * 40.0)), vec3(0.06, 0.12, 0.05), hedge);
}
`;

const FIELDS = frag(CANOPY_LIB + `
uniform float uClear;
uniform float uGarden;
void main() {
  vec2 p = centered();
  float t = uT;
  vec3 col = crowns(p, 22.0, t);
  // Fields eat the forest from the frame's edges inward.
  float farmed = 0.0;
  if (uClear > 0.0) {
    vec2 g = mat2(0.96, -0.28, 0.28, 0.96) * p * vec2(6.0, 4.5);
    vec2 cc = inverse(mat2(0.96, -0.28, 0.28, 0.96)) * ((floor(g) + 0.5) / vec2(6.0, 4.5));
    vec2 uv = clamp(cc / vec2(uResolution.x / uResolution.y, 1.0) + 0.5, 0.0, 1.0);
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    // Each field's turn, 0..1, spread evenly over the frame's area so that a
    // threshold of 0.5 clears about half of it: the band within e of the
    // edges holds 1 - (1 - 2e)^2 of the area. A little jitter per field.
    float rank = 1.0 - pow(1.0 - 2.0 * edge, 2.0);
    float when = clamp(rank + 0.12 * (hash(floor(g)) - 0.5), 0.0, 1.0);
    float id;
    vec3 field = patchwork(p, id);
    // A few woodlots (8%) are spared; the others' turn is scaled to match.
    float spared = step(hash(floor(g) + 57.0), 0.08);
    farmed = step(when, uClear / 0.92) * (1.0 - spared);
    col = mix(col, field, farmed);
  }
  // Gardens: small clearings with plots, the canopy around them standing.
  if (uGarden > 0.0 && farmed < 0.5) {
    vec2 g = p * 3.5, ip = floor(g), fp = fract(g);
    float h = hash(ip + 51.0);
    vec2 c = 0.3 + 0.4 * hash2(ip + 17.0);
    vec2 d = (fp - c) * vec2(1.0, 0.8 + 0.5 * hash(ip + 2.0));
    float r = length(d) + 0.08 * (fbm3(p * 18.0) - 0.5);
    // A clearing of mean area ~0.105 per cell; open this share of cells.
    float open = step(h, uGarden / 0.105);
    float rad = (0.12 + 0.12 * hash(ip + 8.0)) * open;
    // Inside: small plots in a loose mosaic, a hut or two.
    vec2 plot = floor((fp - c) * vec2(22.0, 16.0));
    float ph = hash(plot + ip * 7.0);
    vec3 garden = ph < 0.4 ? vec3(0.55, 0.62, 0.24) : ph < 0.75 ? vec3(0.72, 0.54, 0.3) : vec3(0.42, 0.5, 0.18);
    garden *= 0.85 + 0.15 * sin((fp.x + fp.y * 0.3) * 120.0);
    garden = mix(garden, vec3(0.3, 0.22, 0.14), step(0.96, ph));
    garden *= 0.55 + 0.45 * smoothstep(rad - 0.005, rad - 0.04, r); // the trees' shade at the rim
    col = mix(col, garden, smoothstep(rad, rad - 0.012, r) * step(0.01, rad));
  }
  float shadow = smoothstep(0.5, 0.68, fbm(p * 1.4 + vec2(t * 0.06, t * 0.03)));
  col *= 1.0 - 0.45 * shadow;
  // A calmer, darker band where the question sits.
  col *= 1.0 - 0.3 * smoothstep(0.55, 0.0, length((p - vec2(0.0, -0.2)) * vec2(0.6, 1.4)));
  outColor = vec4(film(col * 1.15), 1.0);
}`);

const fields = {
  id: 'fields',
  render(ctx, f, p) {
    const prm = f.params || {};
    const k = prm.answered ? smoothstep(0, 8, f.beat - (prm.answeredBeat || 0)) : 0;
    // The share of the frame cleared so far. Up to a tenth of it is garden
    // clearings inside the forest; the rest is fields, so that the total is
    // exactly the amount: fields + gardens × (1 − fields) = cleared.
    const cleared = clamp(clearedAmount(f) ?? 0) * k;
    const garden = Math.min(cleared, 0.1);
    const clear = (cleared - garden) / (1 - garden);
    const t = f.t * (f.reduced ? 0.5 : 1);
    if (shade(ctx, f, p, FIELDS, { uT: t, uClear: clear, uGarden: garden })) return;
    ctx.fillStyle = '#16301a';
    ctx.fillRect(0, 0, f.w, f.h);
    const r = p.rng(3);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(${40 + r() * 30},${70 + r() * 40},${30 + r() * 20},0.8)`;
      ctx.beginPath();
      ctx.arc(r() * f.w, r() * f.h, f.h * (0.015 + r() * 0.02), 0, TAU);
      ctx.fill();
    }
    if (cleared) {
      // Fields in from both sides, covering the cleared share of the frame.
      ctx.fillStyle = '#9a7a44';
      ctx.fillRect(0, 0, (f.w * cleared) / 2, f.h);
      ctx.fillRect(f.w * (1 - cleared / 2), 0, f.w, f.h);
    }
  },
};

// ---------------------------------------------------------------------------
// The ages: aerials of deltas, terraces, towns at night, a windmill at dusk.

// A river delta fanning to the sea, channels glinting.
const DELTA = frag(`
uniform float uForest;
// Distributary channels fanning out from the apex: n channels across the fan.
float channel(vec2 d, float n, float w, float seed) {
  float r = length(d), a = atan(d.x, -d.y);
  a += 0.25 * (fbm3(vec2(r * 3.0, a * 2.0 + seed)) - 0.5) + 0.05 * sin(r * 12.0 + seed);
  float dist = abs(fract(a * n / 1.5 + seed * 0.37) - 0.5) / n * 1.5 * r;
  return smoothstep(w, w * 0.5, dist);
}
void main() {
  vec2 p = centered();
  float t = uT;
  vec2 d = p - vec2(-0.05, 0.62);
  float r = length(d), ang = atan(d.x, -d.y);
  float fan = smoothstep(1.1, 0.8, abs(ang));
  float coast = 0.92 + 0.08 * fbm3(vec2(ang * 3.0, 1.0)) + 0.04 * sin(ang * 9.0);
  float water = channel(d, 3.0, 0.016 * (1.0 - r * 0.4), 0.0);
  water = max(water, channel(d, 7.0, 0.008, 3.0) * smoothstep(0.35, 0.55, r));
  water = max(water, channel(d, 16.0, 0.004, 7.0) * smoothstep(0.65, 0.8, r));
  water = max(water * fan, smoothstep(0.012, 0.004, abs(d.x + 0.03 * sin(d.y * 8.0))) * step(0.0, d.y + 0.1));
  float sea = smoothstep(coast - 0.006, coast + 0.006, r);
  // Land: silt flats, marsh and forest; more forest if it was kept.
  float m = fbm(p * 5.0);
  vec3 land = mix(vec3(0.5, 0.44, 0.3), vec3(0.24, 0.32, 0.14), smoothstep(0.35, 0.65, m));
  float wood = smoothstep(0.55, 0.6, fbm3(p * 3.0 + 5.0) + (uForest - 0.5) * 0.4);
  land = mix(land, vec3(0.07, 0.15, 0.07) * (0.7 + 0.6 * noise(p * 160.0)), wood);
  land *= 0.85 + 0.25 * noise(p * 70.0);
  land = mix(land, vec3(0.62, 0.56, 0.42), smoothstep(coast - 0.04, coast, r) * 0.7);
  vec3 river = mix(vec3(0.42, 0.46, 0.42), vec3(0.3, 0.42, 0.44), r);
  float plume = fbm(p * 3.0 + vec2(0.0, t * 0.02));
  vec3 ocean = mix(vec3(0.34, 0.4, 0.34), vec3(0.02, 0.12, 0.17), smoothstep(0.0, 0.35, r - coast + 0.12 * plume));
  vec3 col = mix(land, river, water);
  col = mix(col, ocean, sea);
  // The sun's glint sliding across the water.
  float g = fract(t * 0.06) * 2.6 - 1.3;
  float glint = exp(-pow(p.x - g + p.y * 0.3, 2.0) * 30.0) * max(water, sea);
  col += vec3(1.0, 0.86, 0.62) * glint * 0.35;
  col *= 1.0 - 0.4 * smoothstep(0.5, 0.66, fbm3(p * 1.3 + vec2(t * 0.12, 0.0)));
  outColor = vec4(film(col), 1.0);
}`);

// Terraced fields from above, the seasons turning (uSeason: years).
const TERRACES = frag(CANOPY_LIB + `
uniform float uSeason;
uniform float uForest;
// Spring green, summer green, harvest gold, bare earth, around again.
vec3 season(float s) {
  s = fract(s) * 4.0;
  vec3 a = vec3(0.3, 0.55, 0.16), b = vec3(0.46, 0.6, 0.16), c = vec3(0.86, 0.66, 0.26), d = vec3(0.46, 0.3, 0.18);
  return s < 1.0 ? mix(a, b, s) : s < 2.0 ? mix(b, c, s - 1.0) : s < 3.0 ? mix(c, d, s - 2.0) : mix(d, a, s - 3.0);
}
void main() {
  vec2 p = centered();
  float h0 = fbm3(p * 1.2 + 2.0);
  float hgt = h0 + 0.15 * fbm3(p * 4.0);
  // Hillshade from the slope of the ground, lit from the upper left.
  vec2 grad = vec2(fbm3((p + vec2(0.012, 0.0)) * 1.2 + 2.0) - h0, fbm3((p + vec2(0.0, 0.012)) * 1.2 + 2.0) - h0) / 0.012;
  float relief = clamp(1.0 + dot(grad, vec2(-0.6, 0.6)) * 0.35, 0.55, 1.4);
  float band = hgt * 15.0;
  float id = floor(band), fr = fract(band);
  float plot = floor(p.x * 5.0 - p.y * 2.0 + hash(vec2(id, 1.0)) * 7.0);
  float h = hash(vec2(id, plot));
  float s = uSeason + h * 0.4 + p.y * 0.1;
  vec3 col = season(s);
  // Paddies flooded at the turn of the year, mirroring the sky.
  float wet = smoothstep(0.06, 0.0, fract(s)) + smoothstep(0.96, 1.0, fract(s));
  col = mix(col, vec3(0.6, 0.66, 0.68), wet * 0.8 * step(0.5, h));
  col *= 0.88 + 0.24 * noise(p * vec2(90.0, 30.0)) * noise(p * 400.0 + id);
  // The risers: a stone wall at the foot of each terrace, lit or shaded by
  // which way the slope faces.
  col *= relief;
  float wall = smoothstep(0.12, 0.0, fr);
  col = mix(col, vec3(0.45, 0.38, 0.3) * relief * relief * (0.8 + 0.3 * noise(p * 300.0)), wall * 0.9);
  col *= 1.0 - 0.35 * smoothstep(0.2, 0.08, fr) * (1.0 - wall);
  // Woods on the steepest ground, more of them if the forest was kept.
  float wood = smoothstep(0.74, 0.75, fbm3(p * 2.2 + 11.0) + 0.04 * noise(p * 50.0) + (uForest - 0.5) * 0.3);
  col = mix(col, crowns(p, 45.0, uT), wood);
  col *= 1.0 - 0.35 * smoothstep(0.5, 0.66, fbm3(p * 1.2 + vec2(uT * 0.15, 0.0)));
  outColor = vec4(film(col), 1.0);
}`);

// Night from above: moonlit land, a river, lamps and fires gathering into towns.
const NIGHT = frag(`
uniform float uGrow;
void main() {
  vec2 p = centered();
  float m = fbm3(p * 3.0);
  vec3 col = vec3(0.014, 0.022, 0.036) * (0.5 + 1.0 * m);
  // A river catching the moon.
  float rx = p.x - 0.22 * sin(p.y * 3.0 + 1.0) - 0.08 * fbm3(vec2(p.y * 4.0, 0.0));
  col = mix(col, vec3(0.1, 0.13, 0.18), smoothstep(0.014, 0.006, abs(rx)));
  // Towns: each is born at its own moment and spreads.
  float dens = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    vec2 c = (hash2(vec2(fi, 3.0)) - 0.5) * vec2(1.7, 0.9);
    c.x = mix(c.x, 0.22 * sin(c.y * 3.0 + 1.0), 0.5);
    float born = hash(vec2(fi, 8.0)) * 0.6;
    float g = smoothstep(born, born + 0.4, uGrow);
    float rad = (0.03 + 0.08 * hash(vec2(fi, 5.0))) * (0.3 + 0.7 * g);
    dens += g * exp(-dot(p - c, p - c) / (rad * rad));
  }
  dens += 0.12 * smoothstep(0.08, 0.02, abs(rx)) * uGrow;
  vec2 g = p / 0.007, ip = floor(g);
  vec2 o = 0.2 + 0.6 * hash2(ip + 2.0);
  float d = length(fract(g) - o) * 0.007 * uResolution.y;
  float on = step(hash(ip), dens);
  float lamp = on * (smoothstep(1.8, 0.2, d) + 0.35 * exp(-d * 0.45));
  col += vec3(1.0, 0.6, 0.26) * lamp * (0.7 + 0.6 * hash(ip + 5.0));
  col += vec3(0.6, 0.28, 0.08) * min(dens, 1.5) * 0.07;
  outColor = vec4(film(col), 1.0);
}`);

// A dusk sky with racing clouds for the windmill.
const DUSK = frag(`
void main() {
  vec2 p = centered();
  float t = uT;
  float h = vUv.y;
  vec3 col = mix(vec3(1.0, 0.52, 0.2), vec3(0.2, 0.2, 0.3), smoothstep(0.25, 0.75, h));
  col = mix(col, vec3(0.04, 0.1, 0.18), smoothstep(0.7, 1.05, h));
  vec2 sun = vec2(0.18, -0.2);
  col += vec3(1.0, 0.6, 0.25) * exp(-length((p - sun) * vec2(1.0, 2.5)) * 5.0) * 0.8;
  float z = 0.25 / (h - 0.2 + 0.03);
  vec2 q = vec2(p.x * z, z) * vec2(0.5, 1.6) + vec2(t * 0.6, t * 0.2);
  float d = fbm(q);
  float cover = smoothstep(0.45, 0.72, d) * smoothstep(0.22, 0.4, h);
  vec3 cloud = mix(vec3(0.95, 0.5, 0.28), vec3(0.18, 0.12, 0.16), smoothstep(0.3, 0.9, h) * 0.6 + smoothstep(0.55, 0.9, d) * 0.5);
  col = mix(col, cloud, cover);
  outColor = vec4(film(col), 1.0);
}`);

// Windmill, dike, trees and a distant ship: silhouettes over the dusk sky and
// its reflection in the water.
function windmillShot(ctx, f, p, t, forest) {
  const { w, h } = f;
  const water = Math.round(h * 0.72);
  const hasSky = shade(ctx, f, p, DUSK, { uT: t });
  if (!hasSky) gradient(ctx, f, ['#141a2c', '#5a3a44', '#f08a3a', '#f08a3a', '#2a1a14']);
  const u = Math.min(w, h * 1.2);
  const ink = '#080506';
  ctx.fillStyle = ctx.strokeStyle = ink;
  // Land: a low dike across the frame.
  const land = water - u * 0.014;
  ctx.fillRect(0, land, w, water - land + 1);
  // Trees along the dike, fewer if the forest was cleared: round crowns of
  // small lobes, and a few tall poplars.
  const r = p.rng(21);
  const mx = w * 0.34;
  const groves = Math.round(1 + forest * 10);
  for (let i = 0; i < groves; i++) {
    const gx = r() * w;
    const trees = 1 + Math.floor(r() * 4);
    for (let j = 0; j < trees; j++) {
      const x = gx + (r() - 0.5) * u * 0.08;
      const s = u * (0.018 + r() * 0.022);
      if (Math.abs(x - mx) < u * 0.07) continue;
      if (r() < 0.3) {
        ctx.beginPath();
        ctx.ellipse(x, land - s * 1.6, s * 0.32, s * 1.6, 0, 0, TAU);
        ctx.fill();
        continue;
      }
      for (let k = 0; k < 9; k++) {
        ctx.beginPath();
        ctx.arc(x + (r() - 0.5) * s * 1.4, land - s * (0.4 + r() * 1.1), s * (0.3 + r() * 0.35), 0, TAU);
        ctx.fill();
      }
    }
  }
  // The mill: a tapering tower with a stage, a cap, four lattice sails turning.
  const base = land, mh = u * 0.3;
  ctx.beginPath();
  ctx.moveTo(mx - u * 0.05, base);
  ctx.lineTo(mx - u * 0.03, base - mh);
  ctx.lineTo(mx + u * 0.03, base - mh);
  ctx.lineTo(mx + u * 0.05, base);
  ctx.fill();
  ctx.fillRect(mx - u * 0.065, base - mh * 0.42, u * 0.13, u * 0.006);
  ctx.beginPath();
  ctx.ellipse(mx, base - mh, u * 0.036, u * 0.03, 0, Math.PI, TAU);
  ctx.fill();
  const hx = mx, hy = base - mh + u * 0.004;
  const angle = t * 0.9 + 0.3;
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * TAU) / 4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = u * 0.19;
    ctx.lineWidth = u * 0.006;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + ca * L, hy + sa * L);
    ctx.stroke();
    // The sail's lattice: a frame on one side of the stock.
    ctx.lineWidth = u * 0.0016;
    const nx = -sa * u * 0.034, ny = ca * u * 0.034;
    ctx.beginPath();
    ctx.moveTo(hx + ca * L * 0.22 + nx, hy + sa * L * 0.22 + ny);
    ctx.lineTo(hx + ca * L + nx, hy + sa * L + ny);
    for (let k = 2; k <= 10; k++) {
      const q = k / 10;
      ctx.moveTo(hx + ca * L * q, hy + sa * L * q);
      ctx.lineTo(hx + ca * L * q + nx, hy + sa * L * q + ny);
    }
    ctx.stroke();
  }
  // The water: everything above the waterline, mirrored and darkened.
  if (hasSky) {
    const band = h - water;
    ctx.save();
    ctx.translate(0, water * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(ctx.canvas, 0, water - band, w, band, 0, water - band, w, band);
    ctx.restore();
  }
  const dark = ctx.createLinearGradient(0, water, 0, h);
  dark.addColorStop(0, 'rgba(6,10,16,0.25)');
  dark.addColorStop(1, 'rgba(4,8,14,0.7)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, water, w, h - water);
  // Ripples breaking up the reflection.
  ctx.fillStyle = 'rgba(255,190,120,0.1)';
  for (let i = 0; i < 40; i++) {
    const y = water + (h - water) * Math.pow(r(), 1.6);
    const len = u * (0.02 + r() * 0.1) * (1 + (y - water) / (h - water));
    ctx.fillRect(((r() * w + t * 4) % (w + len)) - len, y, len, 1 + (y - water) / 60);
  }
  // A tall ship far out on the water, drifting.
  ctx.fillStyle = ink;
  const sx = w * (0.84 - ((t * 0.004) % 0.2)), sy = water + u * 0.003, sh = u * 0.075;
  ctx.beginPath();
  ctx.moveTo(sx - sh * 0.55, sy - sh * 0.1);
  ctx.lineTo(sx + sh * 0.6, sy - sh * 0.12);
  ctx.lineTo(sx + sh * 0.45, sy);
  ctx.lineTo(sx - sh * 0.45, sy);
  ctx.fill();
  for (const [dx, hh] of [[-0.3, 0.8], [0.05, 1], [0.38, 0.7]]) {
    ctx.fillRect(sx + dx * sh - u * 0.001, sy - sh * hh, u * 0.002, sh * hh);
    for (const [y0, wd] of [[0.85, 0.2], [0.62, 0.27], [0.38, 0.32]]) {
      ctx.beginPath();
      ctx.ellipse(sx + dx * sh, sy - sh * hh * y0, wd * sh * 0.5, sh * hh * 0.1, 0, 0, TAU);
      ctx.fill();
    }
  }
}

const ages = {
  id: 'ages',
  render(ctx, f, p) {
    const shot = f.shot % 4;
    const forest = forestLeft(f);
    const t = f.t * (f.reduced ? 0.5 : 1) * (f.bpm / 84);
    if (shot === 0 && !shade(ctx, f, p, DELTA, { uT: t, uForest: forest })) gradient(ctx, f, ['#5a5a3a', '#2a4a30', '#0c2a33']);
    if (shot === 1 && !shade(ctx, f, p, TERRACES, { uT: t, uSeason: (f.beat / 5) * (f.reduced ? 0.5 : 1), uForest: forest })) {
      gradient(ctx, f, ['#4a6a22', '#a88a3a', '#5a3a22']);
    }
    if (shot === 2) {
      const grow = smoothstep(0.5, 0.78, f.progress);
      if (!shade(ctx, f, p, NIGHT, { uGrow: grow })) {
        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, f.w, f.h);
        const r = p.rng(9);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 200; i++) {
          const x = r() * f.w, y = r() * f.h;
          if (r() > grow) continue;
          ctx.drawImage(glow(), x - 4, y - 4, 8, 8);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (shot === 3) windmillShot(ctx, f, p, t, forest);
  },
};

export default [titles, voidScene, ice, holocene, fields, ages];
