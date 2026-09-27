// The oil scenes: the oil age (1900–1950), the sun on the roof (1979, choice 3)
// and the turn (1979–1988), which shows what the viewer chose: the sun spreading
// across the land, or the oil going on.
//
// Skies, seas, smoke, the gusher and the flares are one fragment shader; the
// machines, derricks, cars and hulls are canvas 2D silhouettes on top. The
// shader has a plainer 2D fallback for browsers without WebGL 2. Every frame is
// a pure function of the frame `f`.

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
// beat and resting for the rest.
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

// The viewer's answer as an amount in 0..1, or null. The dev harness may only
// have choices (1, 0, -1), which map to 0, 0.5 and 1.
function amountOf(params, key) {
  const a = params.amounts?.[key];
  if (a !== null && a !== undefined) return clamp(a);
  const c = params.choices?.[key];
  return c === null || c === undefined ? null : (1 - c) / 2;
}

// Common GLSL: hashes, value noise, fbm, a fire ramp, a centered coordinate
// (frame height 1, y up) and the film look used across HOLOCENE.
const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uT;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
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
vec3 fireRamp(float x) { x = max(x, 0.0); return vec3(1.5 * x, 1.25 * x * x, 0.9 * x * x * x * x); }
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

// Runs a shader over the whole frame. Returns false without WebGL 2, so the
// caller can paint its fallback.
function shade(ctx, f, p, source, uniforms = {}) {
  const program = p.shader(source);
  const out = program && p.runShader(program, { uT: f.t, ...uniforms });
  if (!out) return false;
  ctx.drawImage(out, 0, 0, f.w, f.h);
  return true;
}

// Maps the shader's centered coordinates (frame height 1, y up) to pixels.
const frameMap = (f) => [(x) => f.w / 2 + x * f.h, (y) => f.h / 2 - y * f.h];

// Soft lights in a few colours, drawn once.
const SPRITES = {};
function makeSprites() {
  if (SPRITES.warm) return;
  const glow = (r, g, b) => makeCanvas(64, 64, (c) => {
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.15, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
  });
  SPRITES.warm = glow(255, 236, 200);
  SPRITES.red = glow(255, 60, 40);
  SPRITES.amber = glow(255, 160, 60);
  SPRITES.white = glow(255, 255, 255);
}
function light(ctx, sprite, x, y, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// The sky shader: gradient, sun, clouds, haze, land or sea below the horizon,
// and optionally a gusher and up to three flares with their smoke.
// uA: horizon, sun x, sun y, sun radius. uB: clouds, sea (0/1), haze, smoke.
// uC: zenith colour, sun strength. uD: horizon colour, brightness of the land.
// uE: gusher x, base, top, strength (0 = none). uF: flare 1 x, y, flare 2 x, y.
// uG: flare 3 x, y, flare size, flare count.
const SKY = PRELUDE + `
uniform vec4 uA, uB, uC, uD, uE, uF, uG;
vec3 flame(vec2 p, vec2 at, float s, float t, inout float glow) {
  vec2 q = (p - at) / s;
  glow += exp(-length(q) * 0.9);
  if (q.y < -0.3 || abs(q.x) > 2.5 || q.y > 5.0) return vec3(0.0);
  float n = fbm(vec2(q.x * 1.2, q.y * 0.9 - t * 1.1) + at * 13.0);
  float lean = q.x - 0.25 * q.y;
  float shape = 1.0 - length(vec2(lean * 1.5, (q.y - 1.2) * 0.45)) + (n - 0.5) * 1.1;
  return fireRamp(clamp(shape * 1.6, 0.0, 1.3)) * smoothstep(-0.3, 0.1, q.y);
}
void main() {
  vec2 p = centered();
  float t = uT, hor = uA.x;
  float y = p.y - hor;
  vec2 sun = uA.yz;
  float sd = length(p - sun);
  vec3 zen = uC.rgb, low = uD.rgb;
  vec3 sky = mix(low, zen, pow(smoothstep(0.0, 0.7, y), 0.7));
  sky += low * exp(-sd * 4.0) * 0.6 * uC.w + vec3(1.0, 0.85, 0.6) * exp(-sd * 14.0) * 0.5 * uC.w;
  // Clouds in long bands, lit from below by the low sun.
  float cl = fbm(vec2(p.x * 1.4 - t * 0.03, y * 6.0 + 3.0));
  float band = smoothstep(0.5, 0.75, cl) * smoothstep(0.02, 0.15, y) * uB.x;
  vec3 cloudC = mix(zen * 0.7, low * 1.2 + 0.1, smoothstep(0.5, 0.0, y) * exp(-abs(p.x - sun.x) * 1.5));
  sky = mix(sky, cloudC, band);
  sky = mix(sky, vec3(1.2, 1.05, 0.85), smoothstep(uA.w, uA.w * 0.9, sd) * uC.w);
  vec3 col = sky;
  // Below the horizon: the sea, reflecting the sky, or the dark land.
  if (y < 0.0) {
    if (uB.y > 0.5) {
      float z = 1.0 / (-y + 0.01);
      float wv = fbm3(vec2(p.x * z * 0.3, z * 1.6 - t * 0.15));
      vec3 refl = mix(low, zen, smoothstep(0.0, 0.5, -y)) * 0.55;
      col = refl * (0.6 + 0.6 * wv);
      float glitter = exp(-abs(p.x - sun.x) * (6.0 + 30.0 * -y)) * smoothstep(0.55, 0.8, wv) * uC.w;
      col += vec3(1.0, 0.75, 0.45) * glitter * 0.8;
    } else {
      float z = 1.0 / (-y + 0.01);
      vec3 far = low * (0.3 + uD.w), near = mix(vec3(0.03, 0.022, 0.018), low * uD.w * 0.8, uD.w);
      col = mix(far, near, smoothstep(0.0, 0.12, -y)) * (0.8 + 0.4 * fbm3(vec2(p.x * z * 0.4, z)));
    }
  }
  // The gusher: a black column rising slowly, spreading, raining back.
  if (uE.w > 0.0) {
    float h = (p.y - uE.y) / max(uE.z - uE.y, 0.01);
    float wob = (fbm3(vec2(p.y * 6.0 - t * 0.4, 1.0)) - 0.5) * 0.02 * h;
    float w = 0.01 + 0.035 * h;
    float colm = smoothstep(w, w * 0.4, abs(p.x - uE.x - wob)) * step(0.0, h) * step(h, 1.05);
    vec2 cq = (p - vec2(uE.x, uE.z)) / vec2(0.2, 0.1);
    float n = fbm(cq * 1.5 - vec2(0.0, t * 0.3));
    float crown = smoothstep(1.0, 0.35, length(cq * vec2(1.0, 1.0 + 0.6 * step(0.0, cq.y))) + (n - 0.5) * 1.1);
    float side = abs(p.x - uE.x);
    float fallZone = smoothstep(0.22, 0.05, side) * smoothstep(uE.y, uE.y + 0.05, p.y) * step(p.y, uE.z);
    float rain = smoothstep(0.4, 0.75, fbm3(vec2(p.x * 40.0, p.y * 3.0 + t * 0.8))) * fallZone * 0.55;
    float oil = clamp(colm + crown + rain, 0.0, 1.0) * uE.w;
    vec3 oilC = vec3(0.03, 0.02, 0.015) + low * 0.25 * smoothstep(0.3, 0.9, n) * crown;
    col = mix(col, oilC, oil);
  }
  // Flares and their smoke.
  float glow = 0.0;
  vec3 fire = vec3(0.0);
  if (uG.w > 0.5) fire += flame(p, uF.xy, uG.z, t, glow);
  if (uG.w > 1.5) fire += flame(p, uF.zw, uG.z * 0.8, t + 3.0, glow);
  if (uG.w > 2.5) fire += flame(p, uG.xy, uG.z * 0.6, t + 7.0, glow);
  float sm = fbm(p * 2.2 - vec2(t * 0.06, t * 0.1)) * smoothstep(-0.1, 0.4, y);
  col = mix(col, vec3(0.05, 0.035, 0.03) + vec3(0.6, 0.25, 0.06) * min(glow, 1.0) * 0.4, clamp(sm * uB.w, 0.0, 1.0));
  col += vec3(0.5, 0.18, 0.04) * min(glow, 2.0) * 0.12;
  col += fire;
  // Haze: brown smoke thickening over everything near the horizon.
  float hz = uB.z * (0.5 + 0.5 * fbm3(vec2(p.x * 1.5 - t * 0.04, y * 4.0))) * exp(-abs(y) * 2.5);
  col = mix(col, vec3(0.4, 0.3, 0.22) * (0.5 + 0.5 * dot(low, vec3(0.4))), clamp(hz, 0.0, 0.85));
  outColor = vec4(film(col), 1.0);
}`;

// Palettes: [zenith, horizon, sun strength].
const DUSK = [[0.12, 0.07, 0.1], [0.95, 0.5, 0.18], 1];
const RED = [[0.1, 0.03, 0.05], [0.9, 0.22, 0.08], 1];
const NIGHT = [[0.01, 0.012, 0.03], [0.12, 0.06, 0.05], 0];
const DAWN = [[0.2, 0.34, 0.48], [0.98, 0.62, 0.42], 1];
const DAY = [[0.28, 0.46, 0.66], [0.9, 0.8, 0.66], 1];

// Draws the sky shader, or a gradient without WebGL 2.
function sky(ctx, f, p, o) {
  const [zen, low, sunK] = o.palette;
  const fl = o.flares || [];
  const ok = shade(ctx, f, p, SKY, {
    uT: f.t * (f.reduced ? 0.4 : 1),
    uA: [o.horizon, o.sun?.[0] ?? 0, o.sun?.[1] ?? -1, o.sun?.[2] ?? 0.04],
    uB: [o.clouds ?? 0.5, o.sea ? 1 : 0, o.haze ?? 0, o.smoke ?? 0],
    uC: [...zen, o.sun ? sunK : 0],
    uD: [...low, o.ground ?? 0],
    uE: o.gusher || [0, 0, 0, 0],
    uF: [fl[0]?.[0] ?? 0, fl[0]?.[1] ?? 0, fl[1]?.[0] ?? 0, fl[1]?.[1] ?? 0],
    uG: [fl[2]?.[0] ?? 0, fl[2]?.[1] ?? 0, o.flareSize ?? 0.03, fl.length],
  });
  if (ok) return;
  const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.round(clamp(v * k) * 255)).join(',')})`;
  const [, Y] = frameMap(f);
  const g = ctx.createLinearGradient(0, 0, 0, Y(o.horizon));
  g.addColorStop(0, rgb(zen));
  g.addColorStop(1, rgb(low));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, f.h);
  ctx.fillStyle = o.sea ? rgb(low, 0.35) : '#0a0706';
  ctx.fillRect(0, Y(o.horizon), f.w, f.h);
  if (o.sun) {
    ctx.fillStyle = 'rgba(255,230,190,0.9)';
    ctx.beginPath();
    ctx.arc(...frameMap(f).map((m, i) => m(o.sun[i])), o.sun[2] * f.h, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y] of fl) light(ctx, SPRITES.amber, frameMap(f)[0](x), Y(y + 0.03), f.h * 0.12, 0.9);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// Silhouettes

// A timber derrick: tapering legs, cross bracing, the crown block.
function derrick(ctx, X, Y, x, base, hgt, color) {
  const wb = hgt * 0.34, wt = hgt * 0.07;
  const at = (k) => [mix(wb, wt, k) / 2, base + hgt * k];
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, hgt * ctx.canvas.height * 0.012);
  ctx.beginPath();
  for (const s of [-1, 1]) { ctx.moveTo(X(x + s * wb / 2), Y(base)); ctx.lineTo(X(x + s * wt / 2), Y(base + hgt)); }
  for (let i = 0; i < 6; i++) {
    const [a0, y0] = at(i / 6), [a1, y1] = at((i + 1) / 6);
    ctx.moveTo(X(x - a0), Y(y0)); ctx.lineTo(X(x + a1), Y(y1));
    ctx.moveTo(X(x + a0), Y(y0)); ctx.lineTo(X(x - a1), Y(y1));
    ctx.moveTo(X(x - a1), Y(y1)); ctx.lineTo(X(x + a1), Y(y1));
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(X(x - wt), Y(base + hgt * 1.04), wt * 2 * ctx.canvas.height, hgt * 0.04 * ctx.canvas.height);
}

// A pumpjack: the samson post, the walking beam with its horse head, the crank.
// `nod` is the beam's angle; the crank turns with it.
function pumpjack(ctx, X, Y, x, base, s, nod, crank, color) {
  const k = ctx.canvas.height;
  const px = x, py = base + s * 0.55;
  const ca = Math.cos(nod), sa = Math.sin(nod);
  const B = (u, v) => [X(px + u * ca - v * sa), Y(py + u * sa + v * ca)];
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  // Base skid and the A-frame.
  ctx.fillRect(X(x - s * 0.7), Y(base + s * 0.04), s * 1.4 * k, s * 0.04 * k);
  ctx.lineWidth = Math.max(1, s * 0.035 * k);
  ctx.beginPath();
  ctx.moveTo(X(x - s * 0.14), Y(base)); ctx.lineTo(X(px), Y(py));
  ctx.lineTo(X(x + s * 0.14), Y(base));
  ctx.stroke();
  // The beam.
  ctx.beginPath();
  ctx.moveTo(...B(-s * 0.55, -s * 0.03)); ctx.lineTo(...B(s * 0.5, -s * 0.03));
  ctx.lineTo(...B(s * 0.5, s * 0.04)); ctx.lineTo(...B(-s * 0.55, s * 0.04));
  ctx.fill();
  // The horse head: a curved plate at the front of the beam.
  ctx.beginPath();
  ctx.moveTo(...B(s * 0.46, s * 0.1));
  ctx.quadraticCurveTo(...B(s * 0.72, s * 0.02), ...B(s * 0.62, -s * 0.2));
  ctx.lineTo(...B(s * 0.5, -s * 0.16));
  ctx.lineTo(...B(s * 0.44, -s * 0.03));
  ctx.fill();
  // The polished rod down into the well.
  const [hx, hy] = B(s * 0.66, -s * 0.12);
  ctx.lineWidth = Math.max(1, s * 0.01 * k);
  ctx.beginPath();
  ctx.moveTo(hx, hy); ctx.lineTo(hx, Y(base + s * 0.08));
  ctx.stroke();
  ctx.fillRect(hx - s * 0.03 * k, Y(base + s * 0.1), s * 0.06 * k, s * 0.1 * k);
  // Crank and counterweight, joined to the beam's tail by the pitman arm.
  const cx = x - s * 0.42, cy = base + s * 0.2;
  const wx = cx + Math.cos(crank) * s * 0.12, wy = cy + Math.sin(crank) * s * 0.12;
  ctx.beginPath();
  ctx.arc(X(wx), Y(wy), s * 0.09 * k, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.02 * k);
  ctx.beginPath();
  ctx.moveTo(X(wx), Y(wy)); ctx.lineTo(...B(-s * 0.52, 0));
  ctx.moveTo(X(cx), Y(cy)); ctx.lineTo(X(cx + s * 0.06), Y(base));
  ctx.stroke();
}

// A 1910s car body in side view: hood, tall cab, spoked wheels.
function oldCar(ctx, x, y, L, color, spokes) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.fillRect(x - L * 0.5, y - L * 0.2, L * 0.3, L * 0.16); // hood
  ctx.fillRect(x - L * 0.2, y - L * 0.42, L * 0.36, L * 0.38); // cab
  ctx.fillRect(x - L * 0.24, y - L * 0.45, L * 0.44, L * 0.04); // roof
  ctx.fillRect(x + L * 0.16, y - L * 0.22, L * 0.3, L * 0.18); // rear body
  ctx.fillRect(x - L * 0.52, y - L * 0.06, L * 1.02, L * 0.03); // running board
  ctx.lineWidth = Math.max(1, L * 0.02);
  for (const wx of [x - L * 0.36, x + L * 0.32]) {
    const r = L * 0.13;
    ctx.beginPath();
    ctx.arc(wx, y + L * 0.02, r, 0, TAU);
    for (let i = 0; i < 6; i++) {
      const a = spokes + (i * Math.PI) / 3;
      ctx.moveTo(wx, y + L * 0.02); ctx.lineTo(wx + Math.cos(a) * r, y + L * 0.02 + Math.sin(a) * r);
    }
    ctx.stroke();
  }
  // The cab's window, lit from the far side of the shop.
  ctx.fillStyle = 'rgba(255,190,110,0.35)';
  ctx.fillRect(x - L * 0.14, y - L * 0.38, L * 0.12, L * 0.14);
}

// A rounded 1950s car, side-on, `dir` 1 facing right.
function roundCar(ctx, x, y, L, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - L / 2, y - L * 0.22, L, L * 0.2, L * 0.08);
  ctx.moveTo(x - L * 0.28, y - L * 0.2);
  ctx.quadraticCurveTo(x - L * 0.12, y - L * 0.42, x + L * 0.1, y - L * 0.38);
  ctx.quadraticCurveTo(x + L * 0.26, y - L * 0.34, x + L * 0.3, y - L * 0.2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Oil, 1900–1950

// Shot 1: a field of derricks at dusk; one gusher erupts in slow motion.
function gusherShot(ctx, f, p) {
  const [X, Y] = frameMap(f);
  const hor = -0.16;
  const gx = 0.1, rise = smoothstep(0, 7, f.shotBeat * (f.reduced ? 0.6 : 1));
  sky(ctx, f, p, { palette: DUSK, horizon: hor, sun: [-0.35, -0.06, 0.04], clouds: 0.7, smoke: 0.25, gusher: [gx, hor + 0.02, hor + 0.1 + 0.3 * rise, 0.3 + 0.7 * rise] });
  // Rows of derricks, far to near.
  for (const [n, hgt, spread, base, color] of [[22, 0.05, 2.4, hor + 0.005, '#3a2014'], [11, 0.12, 2.2, hor - 0.03, '#1c0f09'], [4, 0.4, 2.2, hor - 0.2, '#0a0504']]) {
    for (let i = 0; i < n; i++) {
      const x = -spread / 2 + (i + 0.5 + (hash(i, n) - 0.5) * 0.6) * (spread / n);
      if (Math.abs(x - gx) < 0.05 && n === 11) continue;
      derrick(ctx, X, Y, x, base, hgt * (0.85 + 0.3 * hash(i, n + 1)), color);
    }
  }
  derrick(ctx, X, Y, gx, hor - 0.02, 0.13, '#1c0f09');
  // The ground in front, black.
  ctx.fillStyle = '#070403';
  ctx.fillRect(0, Y(hor - 0.2), f.w, f.h);
}

// Shot 2: pumpjacks nodding against a red sunset, every head down on the beat.
function pumpShot(ctx, f, p) {
  const [X, Y] = frameMap(f);
  const hor = -0.14;
  sky(ctx, f, p, { palette: RED, horizon: hor, sun: [0.05, -0.1, 0.07], clouds: 0.6 });
  const beat = f.beat * (f.reduced ? 0.5 : 1);
  const nod = 0.2 * Math.cos(TAU * beat), crank = TAU * beat + Math.PI;
  for (const [s, y, xs, color] of [[0.12, hor, [-1.0, -0.72, -0.44, -0.16, 0.12, 0.4, 0.68, 0.96], '#2a0c08'], [0.3, hor - 0.14, [-0.9, -0.3, 0.3, 0.9], '#060303']]) {
    for (const x of xs) pumpjack(ctx, X, Y, x, y, s, -nod, crank, color);
  }
  ctx.fillStyle = '#060303';
  ctx.fillRect(0, Y(hor - 0.14), f.w, f.h);
}

// Shot 3: the moving assembly line, identical bodies advancing one station per beat.
function lineShot(ctx, f) {
  const { w, h } = f;
  const S = Math.min(h, w / 0.8);
  ctx.fillStyle = '#0a0706';
  ctx.fillRect(0, 0, w, h);
  // Skylights in the roof, and shafts of dusty light falling from them.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = -2; i < w / (0.3 * S) + 2; i++) {
    const x = i * 0.3 * S + 0.1 * S;
    const g = ctx.createLinearGradient(x, 0, x + 0.25 * S, h * 0.8);
    g.addColorStop(0, 'rgba(255,190,110,0.16)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.08); ctx.lineTo(x + 0.08 * S, h * 0.08); ctx.lineTo(x + 0.34 * S, h * 0.85); ctx.lineTo(x + 0.18 * S, h * 0.85);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,210,150,0.5)';
    ctx.fillRect(x, h * 0.06, 0.08 * S, 0.02 * h);
  }
  ctx.globalCompositeOperation = 'source-over';
  // The far wall, lit warm, so the bodies stand out against it.
  const wall = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.75);
  wall.addColorStop(0, 'rgba(120,70,30,0)');
  wall.addColorStop(0.7, 'rgba(170,100,45,0.55)');
  wall.addColorStop(1, 'rgba(90,50,20,0.2)');
  ctx.fillStyle = wall;
  ctx.fillRect(0, h * 0.25, w, h * 0.5);
  const floor = h * 0.7, pitch = 0.38 * S, L = 0.32 * S;
  const step = stepBeat(f.beat * (f.reduced ? 0.5 : 1), 0.45);
  const off = fract(step) * pitch;
  // The track and the overhead rail with its hoists.
  ctx.fillStyle = '#1a120c';
  ctx.fillRect(0, floor + L * 0.15, w, L * 0.05);
  ctx.fillRect(0, h * 0.2, w, L * 0.04);
  for (let k = -2; k * pitch < w + pitch; k++) {
    const x = w / 2 + (k - Math.round(w / 2 / pitch)) * pitch + off + (w / 2) % pitch;
    oldCar(ctx, x, floor, L, '#050302', step * 2.5);
    ctx.strokeStyle = '#140d08';
    ctx.lineWidth = Math.max(1, S * 0.003);
    ctx.beginPath();
    ctx.moveTo(x, h * 0.21); ctx.lineTo(x, floor - L * 0.5);
    ctx.stroke();
  }
  // Workers at the fixed stations, bending to the work as each body stops.
  const bend = smoothstep(0.45, 0.7, f.beatPhase) * (1 - smoothstep(0.85, 1, f.beatPhase));
  ctx.fillStyle = '#030201';
  for (let k = -1; k * pitch < w + pitch; k++) {
    const x = (w / 2) % pitch + k * pitch + pitch * 0.5;
    const hs = S * 0.02, y = floor + L * 0.15 - hs * 6.5;
    ctx.beginPath();
    ctx.arc(x + bend * hs * 1.2, y + bend * hs * 1.5, hs, 0, TAU);
    ctx.roundRect(x - hs * 1.2, y + hs * 1.2, hs * 2.4, hs * 3, hs * 0.8);
    ctx.fill();
    ctx.fillRect(x - hs, y + hs * 4, hs * 0.8, hs * 2.5);
    ctx.fillRect(x + hs * 0.2, y + hs * 4, hs * 0.8, hs * 2.5);
  }
}

// Shot 4: a 1950s highway at dusk, rounded cars coming and going.
function highwayShot(ctx, f, p) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = 0.0;
  sky(ctx, f, p, { palette: DUSK, horizon: hor, sun: [-0.5, -0.02, 0.035], clouds: 0.5 });
  const F = h * 0.9, H = 1.2;
  const P = (x, z) => [w / 2 + (F * x) / z, Y(hor) + (F * H) / z];
  // The road, and its dashes coming at us one per beat.
  ctx.fillStyle = '#16100c';
  ctx.beginPath();
  ctx.moveTo(...P(-3, 0.5)); ctx.lineTo(...P(-3, 400)); ctx.lineTo(...P(3, 400)); ctx.lineTo(...P(3, 0.5));
  ctx.fill();
  const run = stepBeat(f.beat * (f.reduced ? 0.5 : 1), 0.6) * 4;
  ctx.fillStyle = 'rgba(230,200,140,0.55)';
  for (let i = 0; i < 40; i++) {
    const z0 = 1 + i * 4 - fract(run / 4) * 4;
    if (z0 < 0.6) continue;
    const a = P(-0.05, z0), b = P(0.05, z0 + 2);
    ctx.fillRect(Math.min(a[0], b[0]), b[1], Math.max(1, a[0] - b[0] + (F * 0.1) / z0), a[1] - b[1]);
  }
  // Telephone poles on the right, and their wires.
  ctx.strokeStyle = '#0a0706';
  ctx.beginPath();
  let last = null;
  for (let i = 12; i >= 0; i--) {
    const z = 2 + i * 6 - fract(run / 6) * 6;
    if (z < 0.8) continue;
    const [bx, by] = P(4.5, z), [tx, ty] = P(4.5, z).map((v, j) => (j ? v - (F * 6) / z : v));
    ctx.lineWidth = Math.max(1, (F * 0.12) / z);
    ctx.moveTo(bx, by); ctx.lineTo(tx, ty);
    ctx.moveTo(tx - (F * 0.6) / z, ty + (F * 0.3) / z); ctx.lineTo(tx + (F * 0.6) / z, ty + (F * 0.3) / z);
    if (last) { ctx.moveTo(last[0], last[1]); ctx.quadraticCurveTo((last[0] + tx) / 2, (last[1] + ty) / 2 + (F * 0.8) / z, tx, ty + (F * 0.3) / z); }
    last = [tx, ty + (F * 0.3) / z];
  }
  ctx.stroke();
  // Cars: oncoming on the left with headlights, going away on the right with tail lights.
  ctx.globalCompositeOperation = 'source-over';
  const cars = [];
  for (let i = 0; i < 10; i++) {
    const oncoming = i % 2 === 0;
    const phase = fract(hash(i, 3) + f.t * (0.06 + 0.02 * hash(i, 4)) * (oncoming ? 1 : -0.6));
    const z = oncoming ? 4 + 56 * (1 - phase) ** 2 : 4 + 56 * phase ** 2;
    cars.push({ z, x: oncoming ? -1.1 : 1.1, oncoming });
  }
  cars.sort((a, b) => b.z - a.z);
  for (const c of cars) {
    const [cx, cy] = P(c.x, c.z), s = F / c.z;
    ctx.fillStyle = '#050303';
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.9, cy - s * 0.75, s * 1.8, s * 0.55, s * 0.18);
    ctx.ellipse(cx, cy - s * 0.75, s * 0.6, s * 0.35, 0, Math.PI, 0);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of [-0.62, 0.62]) {
      if (c.oncoming) light(ctx, SPRITES.warm, cx + d * s, cy - s * 0.4, s * 0.9 + 3, 0.9);
      else light(ctx, SPRITES.red, cx + d * s, cy - s * 0.45, s * 0.8 + 3, 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Shot 5: a tanker's hull, huge and slow, sliding past.
function tankerShot(ctx, f, p) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = 0.08, water = -0.26, deck = 0.14;
  sky(ctx, f, p, { palette: DUSK, horizon: hor, sun: [-0.45, 0.12, 0.035], clouds: 0.4, sea: true, haze: 0.2 });
  // The stern comes in from the right and its bridge passes the middle of the frame.
  const stern = w / h / 2 + 0.25 - f.shotT * 0.15 * (f.reduced ? 0.5 : 1);
  const x0 = X(stern - 3.2), x1 = X(stern);
  // Hull: black above, red below the boot top, plate seams passing.
  const g = ctx.createLinearGradient(0, Y(deck), 0, Y(water));
  g.addColorStop(0, '#151012');
  g.addColorStop(0.75, '#0c0909');
  g.addColorStop(0.76, '#3a1410');
  g.addColorStop(1, '#2a0e0c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, Y(deck)); ctx.lineTo(x1 - h * 0.02, Y(deck));
  ctx.quadraticCurveTo(x1 + h * 0.03, Y(deck - 0.1), x1 - h * 0.01, Y(water));
  ctx.lineTo(x0, Y(water));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,150,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = stern - 3.2; x < stern; x += 0.06) { ctx.moveTo(X(x), Y(deck)); ctx.lineTo(X(x), Y(water)); }
  for (const y of [0.08, 0.0, -0.08, -0.16]) { ctx.moveTo(x0, Y(y)); ctx.lineTo(x1, Y(y)); }
  ctx.stroke();
  // Draft marks near the stern, and the rail along the deck.
  ctx.fillStyle = 'rgba(230,220,200,0.6)';
  for (let i = 0; i < 6; i++) ctx.fillRect(X(stern - 0.1), Y(water + 0.03 + i * 0.03), h * 0.012, h * 0.005);
  ctx.fillStyle = '#0e0b0b';
  ctx.fillRect(x0, Y(deck + 0.012), x1 - x0, h * 0.004);
  // The superstructure at the stern: decks of windows and a plain funnel.
  const sx = stern - 0.32;
  ctx.fillStyle = '#b8aea0';
  ctx.fillRect(X(sx), Y(deck + 0.16), h * 0.24, h * 0.16);
  ctx.fillStyle = '#8a8276';
  ctx.fillRect(X(sx - 0.02), Y(deck + 0.1), h * 0.28, h * 0.012);
  ctx.fillRect(X(sx - 0.02), Y(deck + 0.05), h * 0.28, h * 0.012);
  ctx.fillStyle = '#2a2420';
  ctx.fillRect(X(sx + 0.08), Y(deck + 0.26), h * 0.08, h * 0.1);
  ctx.fillStyle = 'rgba(255,215,150,0.8)';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) ctx.fillRect(X(sx + 0.015 + c * 0.028), Y(deck + 0.145 - r * 0.05), h * 0.012, h * 0.012);
  ctx.globalCompositeOperation = 'lighter';
  light(ctx, SPRITES.red, X(sx + 0.12), Y(deck + 0.28), h * 0.03, 0.8);
  ctx.globalCompositeOperation = 'source-over';
  // Its dark reflection and the foam along the waterline.
  ctx.fillStyle = 'rgba(10,6,6,0.55)';
  ctx.fillRect(x0, Y(water), x1 - x0, h * 0.1);
  ctx.fillStyle = 'rgba(230,220,210,0.35)';
  for (let i = 0; i < 160; i++) {
    const x = stern - 3.2 + hash(i, 1) * 3.2;
    const y = water - 0.005 - hash(i, 2) * 0.02;
    const bob = Math.sin(f.t * 0.8 + i) * 0.003;
    ctx.fillRect(X(x), Y(y + bob), h * (0.01 + hash(i, 3) * 0.03), Math.max(1, h * 0.003));
  }
}

// Shot 6: the refinery at night, flares burning over the columns.
function refineryShot(ctx, f, p) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = -0.2;
  const flares = [[-0.34, 0.27], [0.42, 0.17], [0.9, 0.12]];
  sky(ctx, f, p, { palette: [[0.01, 0.012, 0.03], [0.3, 0.1, 0.04], 0], horizon: hor, clouds: 0.3, smoke: 0.8, flares, flareSize: 0.05 });
  ctx.fillStyle = '#040303';
  // Flare stacks.
  for (const [x, y] of flares) ctx.fillRect(X(x - 0.006), Y(y), h * 0.012, Y(hor) - Y(y));
  // Distillation columns with their platforms.
  const cols = [[-0.9, 0.0, 0.06], [-0.62, 0.12, 0.05], [-0.52, 0.2, 0.06], [-0.44, 0.02, 0.08], [-0.18, 0.16, 0.05], [-0.08, 0.06, 0.07], [0.02, -0.05, 0.1], [0.1, 0.22, 0.045], [0.26, 0.1, 0.06], [0.34, -0.02, 0.09], [0.62, 0.18, 0.05], [0.75, 0.05, 0.07], [1.0, 0.08, 0.05]];
  for (const [x, top, r] of cols) {
    ctx.fillRect(X(x - r / 2), Y(top), r * h, Y(hor) - Y(top));
    ctx.beginPath();
    ctx.ellipse(X(x), Y(top), (r * h) / 2, r * h * 0.3, 0, Math.PI, 0);
    ctx.fill();
    for (let yy = hor + 0.05; yy < top; yy += 0.06) ctx.fillRect(X(x - r * 0.8), Y(yy), r * 1.6 * h, h * 0.004);
  }
  // Spherical tanks and a pipe rack along the ground.
  for (const x of [-0.9, -0.34, 0.45]) {
    ctx.beginPath();
    ctx.arc(X(x), Y(hor + 0.06), h * 0.055, 0, TAU);
    ctx.fill();
  }
  ctx.fillRect(0, Y(hor + 0.025), w, h * 0.012);
  ctx.fillRect(0, Y(hor + 0.045), w, h * 0.006);
  // Pipe runs climbing between the columns.
  ctx.strokeStyle = '#040303';
  ctx.lineWidth = Math.max(1, h * 0.004);
  ctx.beginPath();
  for (let i = 0; i + 1 < cols.length; i++) {
    const [xa, ta] = cols[i], [xb, tb] = cols[i + 1];
    const y = hor + Math.min(ta, tb) * 0.6 - hor * 0.6;
    ctx.moveTo(X(xa), Y(y)); ctx.lineTo(X(xb), Y(y));
    ctx.moveTo(X(xa), Y(y - 0.03)); ctx.lineTo(X(xb), Y(y - 0.03));
  }
  ctx.stroke();
  ctx.fillRect(0, Y(hor), w, h);
  // Steady working lights, sodium and white.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    const c = cols[i % cols.length];
    const x = c[0] + (hash(i, 1) - 0.5) * c[2] * 1.4;
    const y = hor + 0.02 + hash(i, 2) * (c[1] - hor - 0.02);
    ctx.fillStyle = hash(i, 3) > 0.3 ? 'rgba(255,190,110,0.9)' : 'rgba(220,235,255,0.9)';
    ctx.fillRect(X(x), Y(y), 2, 2);
    if (i % 5 === 0) light(ctx, SPRITES.amber, X(x), Y(y), h * 0.025, 0.4);
  }
  ctx.globalCompositeOperation = 'source-over';
}

const oil = {
  id: 'oil',
  init: makeSprites,
  render(ctx, f, p) {
    makeSprites();
    const shots = [gusherShot, pumpShot, lineShot, highwayShot, tankerShot, refineryShot];
    shots[f.shot % shots.length](ctx, f, p);
  },
};

// ---------------------------------------------------------------------------
// The sun, 1979. Choice 3: build on the sun, or go back to cheap oil.

// A row of 1970s panels on a rack, tilted to the low sun. `glint` 0..1.
function panelRow(ctx, x0, x1, base, ph, n, glint, alpha = 1) {
  const wd = (x1 - x0) / n;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * wd;
    // Dark glass holding the dawn sky, with the sun's glint sliding across.
    const g = ctx.createLinearGradient(x, base - ph, x + wd, base);
    const k = clamp(glint + i * 0.02);
    g.addColorStop(0, '#6a5a70');
    g.addColorStop(clamp(k - 0.12), '#1c2436');
    g.addColorStop(k, '#ffe2b8');
    g.addColorStop(clamp(k + 0.12), '#1c2436');
    g.addColorStop(1, '#0c1018');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + wd * 0.06, base); ctx.lineTo(x + wd * 0.18, base - ph); ctx.lineTo(x + wd * 0.98, base - ph); ctx.lineTo(x + wd * 0.94, base);
    ctx.fill();
    // The absorber tubes of a solar-thermal collector.
    ctx.strokeStyle = 'rgba(10,16,26,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < 6; k++) {
      const u = k / 6;
      ctx.moveTo(mix(x + wd * 0.06, x + wd * 0.94, u), base);
      ctx.lineTo(mix(x + wd * 0.18, x + wd * 0.98, u), base - ph);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,180,170,0.5)';
    ctx.beginPath();
    ctx.moveTo(x + wd * 0.06, base); ctx.lineTo(x + wd * 0.18, base - ph); ctx.lineTo(x + wd * 0.98, base - ph);
    ctx.stroke();
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(x + wd * 0.8, base - ph * 0.5, Math.max(1, wd * 0.03), ph * 0.5);
  }
  ctx.globalAlpha = 1;
}

// Rooftops at dawn. `spread` 0..1: panels on the neighbours' roofs; `removed`
// 0..1: our own panels taken down; `haze`: smoke over the city.
function roofScene(ctx, f, p, spread, removed, haze) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = 0.02;
  sky(ctx, f, p, { palette: DAWN, horizon: hor, sun: [0.3, 0.07, 0.035], clouds: 0.5, haze: 0.15 + 0.7 * haze, smoke: 0.4 * haze });
  // The city behind, in the morning haze: blocks and a few towers.
  for (const [seed, lo, hi, cw, color] of [[1, 0.0, 0.1, 0.035, 'rgba(110,96,108,0.6)'], [2, -0.02, 0.15, 0.055, 'rgba(52,44,52,0.9)']]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let x = -1.3, i = 0; x < 1.3; i++) {
      const wd = cw * (0.5 + hash(i, seed));
      const top = lo + hash(i, seed + 5) ** 2.5 * (hi - lo);
      ctx.rect(X(x), Y(top), wd * h + 1, Y(hor - 0.1) - Y(top));
      x += wd;
    }
    ctx.fill();
  }
  // Neighbouring roofs, receding: dark flat tops with the dawn along their edges.
  const roofs = [];
  for (let r = 0; r < 3; r++) {
    const n = 5 + r * 2;
    for (let i = 0; i < n; i++) {
      const wd = (2.6 / n) * (0.7 + 0.25 * hash(i, r + 3));
      const x = -1.3 + (i + 0.1 + 0.2 * hash(i, r)) * (2.6 / n);
      roofs.push({ x, y: hor - 0.02 - (2 - r) * 0.04 - hash(i, r + 5) * 0.015, wd, r: 2 - r, order: hash(i, r + 9) });
    }
  }
  const glint = fract(f.t * 0.03) * 1.4 - 0.2;
  for (const rf of roofs) {
    const top = Y(rf.y), wd = rf.wd * h;
    const shadeK = 16 + (2 - rf.r) * 8;
    ctx.fillStyle = `rgb(${shadeK + 10},${shadeK + 4},${shadeK + 6})`;
    ctx.fillRect(X(rf.x), top, wd, h);
    ctx.fillStyle = `rgba(255,190,140,${0.35 - rf.r * 0.08})`;
    ctx.fillRect(X(rf.x), top, wd, Math.max(1, h * 0.003));
    // Panels spread in order across the roofs as the sun is chosen.
    if (rf.order < spread) {
      const a = clamp((spread - rf.order) * 6);
      const ph = h * (0.028 - rf.r * 0.006);
      panelRow(ctx, X(rf.x) + wd * 0.08, X(rf.x) + wd * 0.92, top, ph, 5 - rf.r, glint + rf.order, a);
    }
  }
  // Our roof: the parapet, and the row of panels catching the first sun.
  const base = -0.17;
  ctx.fillStyle = '#16120f';
  ctx.fillRect(0, Y(base), w, h);
  ctx.fillStyle = '#2a211b';
  ctx.fillRect(0, Y(base), w, h * 0.012);
  const x0 = X(-0.62), x1 = X(0.62), n = 8;
  const wd = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    // Taken down one by one, from the ends inward.
    const order = (Math.abs(i - (n - 1) / 2) / ((n - 1) / 2)) * 0.85;
    const gone = clamp((removed - (0.85 - order)) * 6);
    if (gone >= 1) {
      ctx.fillStyle = '#0c0a09';
      ctx.fillRect(x0 + i * wd + wd * 0.2, Y(base) - h * 0.012, wd * 0.6, h * 0.012);
      continue;
    }
    panelRow(ctx, x0 + i * wd, x0 + (i + 1) * wd, Y(base), h * 0.13 * (1 - gone), 1, glint + i * 0.03, 1 - gone * 0.6);
  }
}

const sun = {
  id: 'sun',
  init: makeSprites,
  render(ctx, f, p) {
    makeSprites();
    const pr = f.params;
    const a = amountOf(pr, 'sun');
    const e = pr.answered && a !== null ? smoothstep(0, 8, f.beat - (pr.answeredBeat || 0)) : 0;
    const spread = e * (1 - (a ?? 0.5));
    const removed = e * clamp(((a ?? 0) - 0.4) / 0.6);
    const haze = e * (a ?? 0);
    roofScene(ctx, f, p, spread, removed, haze);
  },
};

// ---------------------------------------------------------------------------
// The turn, 1979–1988: what the viewer chose, as it spread.

// The sun: a solar field growing row by row to the horizon.
function fieldShot(ctx, f, p, o) {
  const { w, h } = f;
  const [, Y] = frameMap(f);
  const hor = 0.06;
  sky(ctx, f, p, { palette: o.late ? DUSK : DAY, horizon: hor, sun: o.late ? [0.3, 0.02, 0.04] : [-0.4, 0.3, 0.04], clouds: 0.3, haze: o.haze, ground: o.late ? 0.25 : 0.55 });
  const F = h * 0.9, H = 2.2;
  const P = (x, z) => [w / 2 + (F * x) / z, Y(hor) + (F * H) / z];
  const rows = stepBeat(f.shotBeat * (f.reduced ? 0.5 : 1), 0.5) * 6 + 4;
  const glint = fract(f.t * 0.05);
  for (let i = 40; i >= 0; i--) {
    if (i > rows) continue;
    const z = 1.6 + i * 1.3;
    const a = clamp(rows - i);
    const [lx, ly] = P(-14, z), [rx] = P(14, z), top = ly - (F * 0.3) / z;
    const g = ctx.createLinearGradient(lx, 0, rx, 0);
    g.addColorStop(0, '#1a2c48');
    g.addColorStop(clamp(glint - 0.05), '#24406a');
    g.addColorStop(clamp(glint), '#e8f0ff');
    g.addColorStop(clamp(glint + 0.05), '#24406a');
    g.addColorStop(1, '#142238');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(lx, top, rx - lx, ly - top);
    ctx.fillStyle = 'rgba(220,230,240,0.5)';
    ctx.fillRect(lx, top, rx - lx, Math.max(1, (F * 0.012) / z));
    ctx.fillStyle = 'rgba(40,30,24,0.6)';
    ctx.fillRect(lx, ly, rx - lx, Math.max(1, (F * 0.08) / z));
    ctx.globalAlpha = 1;
  }
}

// The sun: wind turbines on the ridges at dusk, more of them as the years pass.
function windShot(ctx, f, p, o) {
  const [X, Y] = frameMap(f);
  const hor = -0.08;
  sky(ctx, f, p, { palette: DUSK, horizon: hor, sun: [0.35, -0.02, 0.04], clouds: 0.4, haze: o.haze });
  const count = 6 + stepBeat(f.shotBeat * (f.reduced ? 0.5 : 1), 0.5) * 4;
  const k = f.h;
  // Rolling ridges.
  for (const [r, lift, color] of [[0, 0.06, '#2a1a20'], [1, 0.0, '#140c10']]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, f.h);
    for (let x = -1.2; x <= 1.2; x += 0.02) ctx.lineTo(X(x), Y(hor + lift + 0.04 * Math.sin(x * 3 + r * 2) - r * 0.08));
    ctx.lineTo(f.w, f.h);
    ctx.fill();
    const n = r ? 8 : 18;
    for (let i = 0; i < n; i++) {
      if (i + (r ? 0 : 3) > count * (r ? 0.8 : 1.6)) continue;
      const x = -1.1 + (i + 0.5) * (2.2 / n);
      const y = hor + lift + 0.04 * Math.sin(x * 3 + r * 2) - r * 0.08;
      const s = r ? 0.16 : 0.07;
      ctx.strokeStyle = r ? '#d8d0c8' : '#8a7a78';
      ctx.lineWidth = Math.max(1, s * k * 0.03);
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x), Y(y + s));
      const a0 = f.t * 1.3 * (f.reduced ? 0.4 : 1) + hash(i, r) * TAU;
      for (let b = 0; b < 3; b++) {
        const a = a0 + (b * TAU) / 3;
        ctx.moveTo(X(x), Y(y + s)); ctx.lineTo(X(x + Math.cos(a) * s * 0.55), Y(y + s + Math.sin(a) * s * 0.55));
      }
      ctx.stroke();
    }
  }
}

// The sun: a power tower, its field of mirrors all turned to one bright point.
function towerShot(ctx, f, p, o) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = 0.0;
  sky(ctx, f, p, { palette: DAY, horizon: hor, sun: [-0.6, 0.35, 0.04], clouds: 0.2, haze: o.haze, ground: 0.55 });
  const F = h * 0.9, H = 0.6;
  const P = (x, z) => [w / 2 + (F * x) / z, Y(hor) + (F * H) / z];
  // Mirrors in arcs around the tower, flashing back the light as they turn in.
  const turned = smoothstep(0, 8, f.shotBeat);
  for (let r = 14; r >= 1; r--) {
    for (let i = -18; i <= 18; i++) {
      const ang = (i / 18) * 1.2;
      const x = Math.sin(ang) * r * 0.9, z = 12 - Math.cos(ang) * r * 0.55;
      if (z < 1) continue;
      const [sx, sy] = P(x, z), s = F / z;
      const lit = hash(i, r) < turned ? 1 : 0.2;
      ctx.fillStyle = lit > 0.5 ? 'rgba(250,248,240,0.85)' : 'rgba(90,120,160,0.9)';
      ctx.fillRect(sx - s * 0.12, sy - s * 0.12, s * 0.24, s * 0.08);
      ctx.fillStyle = 'rgba(30,24,20,0.7)';
      ctx.fillRect(sx - s * 0.01, sy - s * 0.04, Math.max(1, s * 0.02), s * 0.04);
    }
  }
  // The tower and its receiver, glowing white-hot.
  const [tx, ty] = P(0, 12);
  const th = (F * 5) / 12;
  ctx.fillStyle = '#3a3438';
  ctx.fillRect(tx - (F * 0.2) / 12, ty - th, (F * 0.4) / 12, th);
  ctx.globalCompositeOperation = 'lighter';
  light(ctx, SPRITES.white, tx, ty - th, h * (0.06 + 0.1 * turned), 1);
  light(ctx, SPRITES.warm, tx, ty - th, h * (0.2 + 0.2 * turned), 0.5);
  ctx.globalCompositeOperation = 'source-over';
}

// The oil: platforms at sea at night, their flares burning.
function platformShot(ctx, f, p, o) {
  const [X, Y] = frameMap(f);
  const hor = -0.02;
  const flares = [[0.05, 0.3], [0.62, 0.1], [-0.72, 0.04]];
  sky(ctx, f, p, { palette: [[0.01, 0.012, 0.03], [0.22, 0.08, 0.04], 0], horizon: hor, sea: true, clouds: 0.3, smoke: 0.7, haze: o.haze, flares, flareSize: 0.04 });
  const k = f.h;
  // The flares' light lying on the water.
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y] of flares) {
    const g = ctx.createLinearGradient(0, Y(hor), 0, Y(hor - 0.4));
    g.addColorStop(0, 'rgba(255,140,50,0.35)');
    g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g;
    const wd = (0.02 + y * 0.1) * k;
    for (let i = 0; i < 14; i++) ctx.fillRect(X(x) - wd * (0.5 + hash(i, x)), Y(hor - 0.01 - i * 0.025), wd * (1 + hash(i, y) * 1.5), Math.max(1, k * 0.004));
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, top, s] of [[-0.12, 0.3, 1.6], [0.5, 0.1, 0.6], [-0.78, 0.04, 0.3]]) {
    ctx.fillStyle = '#050405';
    ctx.strokeStyle = '#050405';
    ctx.lineWidth = Math.max(1, 0.006 * s * k);
    const deck = hor + 0.06 * s;
    ctx.beginPath();
    for (const lx of [-0.12, -0.04, 0.04, 0.12]) { ctx.moveTo(X(x + lx * s), Y(hor - 0.02)); ctx.lineTo(X(x + lx * s * 0.9), Y(deck)); }
    for (const yy of [0.25, 0.6]) { ctx.moveTo(X(x - 0.12 * s), Y(mix(hor, deck, yy))); ctx.lineTo(X(x + 0.12 * s), Y(mix(hor, deck, yy))); }
    ctx.stroke();
    ctx.fillRect(X(x - 0.16 * s), Y(deck + 0.03 * s), 0.32 * s * k, 0.03 * s * k);
    ctx.fillRect(X(x - 0.1 * s), Y(deck + 0.07 * s), 0.14 * s * k, 0.04 * s * k);
    derrick(ctx, X, Y, x + 0.06 * s, deck + 0.03 * s, 0.14 * s, '#050405');
    // The flare boom reaching out.
    ctx.beginPath();
    ctx.moveTo(X(x + 0.14 * s), Y(deck + 0.03 * s)); ctx.lineTo(X(x + 0.18 * s), Y(top));
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      light(ctx, SPRITES.amber, X(x + (hash(i, s) - 0.5) * 0.3 * s), Y(deck + hash(i, s + 1) * 0.08 * s), k * 0.02 * s, 0.7);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// The oil: tankers queueing to load, a line of lights down to the horizon.
function tankersShot(ctx, f, p, o) {
  const [X, Y] = frameMap(f);
  const hor = 0.05;
  sky(ctx, f, p, { palette: RED, horizon: hor, sun: [0.5, 0.08, 0.05], sea: true, clouds: 0.5, haze: 0.2 + o.haze, flares: [[0.8, hor + 0.02]], flareSize: 0.01 });
  const k = f.h;
  for (let i = 7; i >= 0; i--) {
    const s = 0.9 / (1 + i * 0.9);
    const x = -0.6 + i * 0.2 - 0.02 * f.shotT * s, y = hor - 0.02 - 0.3 * s;
    ctx.fillStyle = '#070506';
    ctx.beginPath();
    ctx.moveTo(X(x - 0.5 * s), Y(y + 0.06 * s)); ctx.lineTo(X(x + 0.45 * s), Y(y + 0.06 * s));
    ctx.lineTo(X(x + 0.5 * s), Y(y + 0.02 * s)); ctx.lineTo(X(x + 0.47 * s), Y(y)); ctx.lineTo(X(x - 0.5 * s), Y(y));
    ctx.fill();
    ctx.fillRect(X(x + 0.3 * s), Y(y + 0.13 * s), 0.12 * s * k, 0.07 * s * k);
    ctx.fillRect(X(x + 0.34 * s), Y(y + 0.17 * s), 0.04 * s * k, 0.04 * s * k);
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 6; j++) light(ctx, SPRITES.warm, X(x - 0.45 * s + j * 0.16 * s), Y(y + 0.07 * s), k * 0.02 * s + 2, 0.7);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// The oil: a filling station at night, a line of cars waiting at the pumps.
function forecourtShot(ctx, f, p, o) {
  const { w, h } = f;
  const [X, Y] = frameMap(f);
  const hor = -0.05;
  sky(ctx, f, p, { palette: NIGHT, horizon: hor, clouds: 0.2, haze: o.haze });
  const k = h;
  const ground = -0.22;
  ctx.fillStyle = '#0c0b0c';
  ctx.fillRect(0, Y(ground), w, h);
  // The canopy, bright underneath, lighting the concrete.
  const g = ctx.createLinearGradient(0, Y(0.12), 0, Y(ground - 0.1));
  g.addColorStop(0, 'rgba(210,240,230,0.35)');
  g.addColorStop(1, 'rgba(210,240,230,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(X(-0.45), Y(0.1)); ctx.lineTo(X(0.35), Y(0.1)); ctx.lineTo(X(0.55), Y(ground - 0.12)); ctx.lineTo(X(-0.65), Y(ground - 0.12));
  ctx.fill();
  ctx.fillStyle = '#e8f4ee';
  ctx.fillRect(X(-0.45), Y(0.105), 0.8 * k, 0.012 * k);
  ctx.fillStyle = '#1a1a1c';
  ctx.fillRect(X(-0.46), Y(0.15), 0.82 * k, 0.045 * k);
  ctx.fillRect(X(-0.4), Y(0.1), 0.015 * k, Y(ground) - Y(0.1));
  ctx.fillRect(X(0.3), Y(0.1), 0.015 * k, Y(ground) - Y(0.1));
  // Pumps.
  for (const x of [-0.22, 0.08]) {
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(X(x), Y(ground + 0.1), 0.05 * k, 0.1 * k);
    ctx.fillStyle = 'rgba(255,220,160,0.7)';
    ctx.fillRect(X(x + 0.008), Y(ground + 0.085), 0.034 * k, 0.025 * k);
  }
  // A plain lit sign on a pole.
  ctx.fillStyle = '#1a1a1c';
  ctx.fillRect(X(0.72), Y(0.2), 0.01 * k, Y(ground) - Y(0.2));
  ctx.fillStyle = 'rgba(240,200,120,0.75)';
  ctx.fillRect(X(0.64), Y(0.3), 0.17 * k, 0.1 * k);
  // The queue: nose to tail out of frame, edging forward one car each bar.
  const inch = stepBeat(f.beat / 4, 0.3);
  for (let i = 0; i < 12; i++) {
    const x = -0.1 + (i - fract(inch)) * 0.36;
    if (x < -0.4) continue;
    roundCar(ctx, X(x), Y(ground), 0.34 * k, '#060506');
    ctx.globalCompositeOperation = 'lighter';
    light(ctx, SPRITES.red, X(x + 0.165), Y(ground + 0.045), k * 0.04, 0.8);
    light(ctx, SPRITES.warm, X(x - 0.165), Y(ground + 0.05), k * 0.045, 0.6);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// The last sun shot is the solar field again, at the day's end.
const CAREFUL = [fieldShot, windShot, towerShot, (ctx, f, p, o) => fieldShot(ctx, f, p, { ...o, late: true })];
const RECKLESS = [platformShot, forecourtShot, tankersShot, refineryShot];
// With n of the four shots given to the sun, these slots go to it first, so a
// middle answer alternates between the two.
const PRIORITY = [0, 2, 1, 3];

const turn = {
  id: 'turn',
  init: makeSprites,
  render(ctx, f, p) {
    makeSprites();
    const a = amountOf(f.params, 'sun') ?? 0.5;
    const k = f.shot % 4;
    const careful = PRIORITY.indexOf(k) < Math.round((1 - a) * 4);
    // The sky clears a little in the sun's shots, thickens in the oil's.
    const o = { haze: careful ? 0.05 + 0.2 * a : 0.2 + 0.4 * a };
    ctx.save();
    if (k === 3) {
      ctx.translate(f.w, 0);
      ctx.scale(-1, 1);
    }
    (careful ? CAREFUL : RECKLESS)[k](ctx, f, p, o);
    ctx.restore();
  },
};

export default [oil, sun, turn];
