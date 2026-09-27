// The last four scenes of HOLOCENE: now (2026, the viewer holds to slow the
// world down), the future (2026 to 2100, one of three endings), the epilogue
// (a quiet dusk under the definition card) and the end credits.
//
// Most pictures are two layers. A fragment shader paints the world far away:
// sky, sun, clouds, stars and star trails, distant mesas, a city skyline, a dust
// storm, and water that mirrors all of it. Canvas 2D then draws what stands
// close to the camera: land, roads and traffic, wind turbines, smokestacks, a
// seawall, drowned rooftops. Without WebGL 2 the sky falls back to gradients.
//
// Coordinates shared by both layers: x is measured in frame heights from the
// center of the frame (so the picture widens with the screen instead of
// stretching), y runs from 0 at the bottom to 1 at the top.

// ---------------------------------------------------------------------------
// Shaders

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// Three octaves, for detail that does not need five.
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v / 0.875;
}
`;

// The world far away, seen from the ground. Every layer is optional.
const SKY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uT;          // seconds, for the waves
uniform float uHorizon;    // height of the horizon, 0..1 from the bottom
uniform vec3 uZenith;      // sky colors, top to horizon
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec4 uSun;         // x, y, disc radius, glow strength
uniform vec3 uSunCol;
uniform vec4 uCloud;       // sideways drift, drift toward the camera, coverage, time-lapse streak
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uCloudAmt;
uniform float uStars;      // fixed stars
uniform vec4 uTrails;      // star trails: pole x, pole y, arc length (radians), strength
uniform float uRot;        // how far the sky has turned (radians)
uniform vec4 uRidge;       // distant mesas: strength, height, seed, haze
uniform vec3 uRidgeCol;
uniform float uRidgeX;     // the mesas end at this x
uniform vec4 uCity;        // skyline: strength, left x, right x, tallest tower
uniform vec3 uCityCol;
uniform float uCitySeed;
uniform vec4 uWin;         // window light color, share of windows lit
uniform vec4 uWall;        // dust storm: front x, height, strength, billow drift
uniform vec3 uWallCol;
uniform vec4 uHaze;        // color, amount
uniform vec4 uWater;       // tint, 1 = water below the horizon (0 = ground)
uniform float uWaves;
uniform vec3 uGround;
${NOISE}
const float TAU = 6.2831853;
// True while painting the water's reflection: lit windows become vertical
// streaks of light, and star trails nearly vanish, as on real water at night.
bool gRefl = false;

// One layer of star trails: concentric rings around the pole, one star per ring.
vec3 trails(vec2 p, float scale, float seed) {
  vec2 d = p - uTrails.xy;
  float r = length(d);
  float ring = floor(r * scale);
  float h = hash(vec2(ring, seed));
  if (h < 0.35) return vec3(0.0);
  float a = atan(d.y, d.x) - uRot;
  float b = hash(vec2(ring + 0.5, seed + 3.0)) * TAU;
  float dd = mod(b - a, TAU);
  float px = 1.0 / (uResolution.y * max(r, 0.002));
  float along = smoothstep(uTrails.z + 2.0 * px, uTrails.z + px, dd);
  float across = abs(fract(r * scale) - 0.5) / scale * uResolution.y;
  float line = smoothstep(1.1, 0.2, across);
  float k = hash(vec2(ring, seed + 7.0));
  vec3 tint = k < 0.3 ? vec3(0.75, 0.85, 1.0) : (k > 0.85 ? vec3(1.0, 0.8, 0.55) : vec3(0.95));
  return tint * along * line * (0.25 + 0.75 * pow(h, 3.0));
}

vec3 skyColor(vec2 p) {
  float e = clamp((p.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
  vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.32, e));
  col = mix(col, uZenith, smoothstep(0.28, 1.0, e));

  vec2 s = uSun.xy;
  float d = length(p - s);
  col += uSunCol * uSun.w * (0.45 * exp(-d * 2.5) + 0.5 * exp(-d * 10.0));
  col += uSunCol * uSun.w * 0.3 * exp(-abs(p.y - uHorizon) * 9.0 - abs(p.x - s.x) * 1.4);

  float starFade = smoothstep(0.02, 0.3, e);
  if (uStars > 0.0) {
    vec2 g = p * 95.0;
    vec2 id = floor(g);
    float h = hash(id);
    vec2 c = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
    float star = smoothstep(0.09, 0.0, length(c)) * smoothstep(0.93, 1.0, h) * 14.0 * (h - 0.92);
    col += vec3(0.85, 0.9, 1.0) * star * uStars * starFade;
  }
  if (uTrails.w > 0.0) {
    col += (trails(p, 150.0, 1.0) + trails(p, 97.0, 5.0) * 0.8) * uTrails.w * starFade * (gRefl ? 0.2 : 1.0);
  }

  col += uSunCol * smoothstep(uSun.z, uSun.z * 0.85, d) * 1.4 * step(0.001, uSun.z);

  // Clouds on a flat layer above the ground: they race toward the horizon.
  if (uCloudAmt > 0.0) {
    float ch = e + 0.04;
    vec2 cp = vec2(p.x / ch * 0.5, 0.5 / ch / (1.0 + 3.0 * uCloud.w));
    float n = fbm(cp * 1.3 + uCloud.xy);
    float cov = uCloud.z;
    float dens = smoothstep(1.0 - cov, 1.0 - cov + 0.32, n) * uCloudAmt * smoothstep(0.0, 0.05, e);
    float lit = exp(-d * 1.6);
    vec3 cc = mix(uCloudDark, uCloudLit, clamp(0.3 + 0.7 * lit - (n - 0.55) * 1.2, 0.0, 1.0));
    col = mix(col, cc, dens);
    col += uSunCol * uSun.w * dens * (1.0 - dens) * 1.6 * exp(-d * 5.0);
  }

  float y = p.y - uHorizon;

  // Distant mesas: flat tops, steep sides.
  if (uRidge.x > 0.0 && p.x < uRidgeX) {
    float n = noise(vec2(p.x * 2.4 + uRidge.z, uRidge.z));
    float top = uRidge.y * (0.2 + 0.8 * smoothstep(0.5, 0.58, n) + 0.08 * noise(vec2(p.x * 14.0, 2.0)));
    top *= smoothstep(uRidgeX, uRidgeX - 0.2, p.x);
    if (y < top) col = mix(col, mix(uRidgeCol, col, uRidge.w), uRidge.x);
  }

  // A skyline: low blocks everywhere, towers here and there, taller downtown.
  if (uCity.x > 0.0 && p.x > uCity.y && p.x < uCity.z) {
    float c1 = floor(p.x * 55.0);
    float c2 = floor(p.x * 17.0 + 0.37);
    // Taller toward the middle of the city, measured at each tower's center.
    float t = clamp(((c2 + 0.5 - 0.37) / 17.0 - uCity.y) / (uCity.z - uCity.y), 0.0, 1.0);
    float env = 0.35 + 0.65 * pow(sin(t * 3.14159), 1.5);
    float h1 = hash(vec2(c1, 11.0 + uCitySeed));
    float h2 = hash(vec2(c2, 17.0 + uCitySeed));
    float bh = max(0.08 + 0.22 * h1, step(0.45, h2) * (0.25 + 0.75 * h2 * h2) * env) * uCity.w;
    if (y < bh) {
      col = mix(col, uCityCol, uCity.x);
      vec2 wg = vec2(p.x * 190.0, y * 150.0);
      vec2 wf = fract(wg);
      float id = hash(floor(wg) + vec2(3.0, 9.0));
      float lit = step(0.3, wf.x) * step(0.35, wf.y) * step(1.0 - uWin.w, id) * step(0.006, bh - y);
      if (gRefl) lit = step(0.35, wf.x) * uWin.w * 0.9 * step(0.006, bh - y) * hash(vec2(floor(wg.x), 4.0 + uCitySeed));
      col += uWin.rgb * lit * uCity.x * (0.45 + 0.55 * hash(floor(wg) + 1.7));
    }
  }
  return col;
}

// A wall of dust rolling in from the left, over everything.
vec3 dustWall(vec3 col, vec2 p) {
  float n = fbm(vec2(p.x * 2.0 + uWall.w * 0.15, p.y * 2.2 - uWall.w * 0.06));
  float n2 = fbm(vec2(p.x * 6.0 - uWall.w * 0.2, p.y * 6.0 + uWall.w * 0.05));
  float k = uWall.x - p.x + (n - 0.5) * 0.4;
  float top = uHorizon + uWall.y * (0.5 + 0.8 * n) * smoothstep(-0.25, 0.7, k);
  float dens = smoothstep(-0.03, 0.22, k) * smoothstep(top + 0.03, top - 0.1, p.y);
  float shade = clamp(0.45 + (p.y - uHorizon) / max(uWall.y, 0.01) * 0.4 + (n2 - 0.5) * 1.1 + (n - 0.5) * 0.7, 0.2, 1.25);
  vec3 wc = uWallCol * shade + uSunCol * uSun.w * 0.25 * smoothstep(top - 0.15, top, p.y);
  return mix(col, wc, clamp(dens, 0.0, 1.0) * uWall.z);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y);
  vec3 col;
  float dy = uHorizon - p.y;
  if (dy <= 0.0) {
    col = skyColor(p);
  } else if (uWater.w > 0.0) {
    // Water: the sky mirrored, broken up by waves that shrink toward the horizon.
    float z = 1.0 / (dy + 0.004);
    vec2 wp = vec2(p.x * z, z);
    float n1 = noise(wp * vec2(2.5, 0.8) + vec2(0.0, uT * 0.5));
    float n2 = noise(wp * vec2(8.0, 2.4) - vec2(uT * 0.3, uT * 1.2));
    float wv = (n1 * 0.6 + n2 * 0.4 - 0.5) * uWaves;
    vec2 m = vec2(p.x + wv * 0.006, uHorizon + dy + wv * dy * 0.5);
    gRefl = true;
    vec3 refl = skyColor(m);
    gRefl = false;
    float fres = 0.45 + 0.5 * exp(-dy * 5.0);
    col = refl * mix(uWater.rgb, vec3(1.0), 0.25) * fres + uWater.rgb * 0.03;
    float column = exp(-abs(p.x - uSun.x) / (0.015 + dy * 0.6));
    float glint = smoothstep(0.62, 0.95, n2 * (0.5 + n1)) * column * uSun.w;
    col += uSunCol * glint * 1.2 * smoothstep(-0.05, 0.05, uSun.y - uHorizon + 0.03);
  } else {
    float z = 1.0 / (dy + 0.01);
    col = uGround * (0.75 + 0.35 * noise(vec2(p.x * z * 3.0, z * 0.6)));
  }
  if (uWall.z > 0.0) col = dustWall(col, p);
  float hz = exp(-abs(dy) * 4.5);
  col = mix(col, uHaze.rgb, uHaze.w * (0.25 + 0.75 * hz));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Straight down from a high aircraft: hills, rivers, wetlands, fields, clouds.
const AERIAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec3 uCam;         // x, y, frame height in land units
uniform float uGreen;      // how far the green reaches, 0..1
uniform float uScorch;     // how much has burned, 0..1
uniform float uWaterLvl;   // wetland water level
uniform float uPivots;     // irrigation circles: share still green
uniform float uSplit;      // 1 = the land is dry on one side
uniform float uSeason;     // -1 wet .. 1 dry
uniform float uFields;     // a patchwork of fields on the dry side, 0..1
uniform vec2 uShadow;      // cloud drift
uniform vec4 uClouds;      // cloud color, coverage
uniform float uT;
uniform vec4 uHaze;
uniform vec3 uLight;
${NOISE}
void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 s = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
  vec2 q = s * uCam.z + uCam.xy;

  // Relief: rolling hills, with valleys cut where the rivers run.
  float valley = abs(fbm(q * 0.45 + vec2(5.2, 1.3)) - 0.5);
  float trib = abs(fbm3(q * 1.3 + vec2(2.1, 7.7)) - 0.5);
  float h = fbm(q * 0.8) * 0.65 + smoothstep(0.0, 0.18, valley) * 0.25 + smoothstep(0.0, 0.1, trib) * 0.1;
  vec2 g = vec2(dFdx(h), dFdy(h)) * uResolution.y / uCam.z;
  float shade = clamp(1.0 + dot(g, vec2(-0.7, 0.7)) * 0.45, 0.6, 1.35);

  float river = smoothstep(0.011, 0.005, valley);
  float stream = smoothstep(0.006, 0.002, trib) * smoothstep(0.22, 0.06, valley);
  float wet = smoothstep(0.17, 0.0, valley) + smoothstep(0.07, 0.0, trib) * 0.35;
  float clump = fbm3(q * 4.0 + 11.0);
  float grain = noise(q * 30.0);
  float n = noise(q * 6.0);

  float dry = uSplit * smoothstep(-0.1, 0.1, s.x * 0.9 - s.y * 0.45 + (fbm3(q * 0.6 + 3.0) - 0.5) * 0.7);
  float reach = uGreen * (1.0 - 0.9 * dry);
  float veg = smoothstep(0.0, 0.1, wet * 0.9 + clump * 0.7 - 1.12 + reach * 1.15);

  vec3 earth = mix(vec3(0.60, 0.45, 0.31), vec3(0.76, 0.62, 0.45), n);
  earth = mix(earth, vec3(0.83, 0.72, 0.55), dry * 0.45);
  float season = uSeason * 0.5 + 0.5;
  vec3 leaf = mix(vec3(0.09, 0.22, 0.09), vec3(0.18, 0.33, 0.12), clump);
  leaf = mix(leaf, vec3(0.42, 0.40, 0.16), season * 0.6);
  vec3 col = mix(earth, leaf * (0.82 + 0.3 * grain), veg);

  // Farmland: rectangular fields on the dry plain, crops in different states.
  if (uFields > 0.0) {
    vec2 fq = mat2(0.97, -0.24, 0.24, 0.97) * q * vec2(1.7, 2.6);
    vec2 fc = floor(fq), ff = fract(fq);
    float fh = hash(fc + 11.0);
    vec3 crop = fh < 0.3 ? vec3(0.36, 0.44, 0.16) : fh < 0.55 ? vec3(0.72, 0.6, 0.32) : fh < 0.8 ? vec3(0.55, 0.4, 0.26) : vec3(0.8, 0.72, 0.5);
    crop *= 0.92 + 0.1 * sin((fh > 0.5 ? ff.x : ff.y) * 26.0);
    float edgeF = smoothstep(0.0, 0.025, min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)));
    float farm = uFields * smoothstep(0.15, 0.4, dry) * (1.0 - veg * 0.7) * smoothstep(0.03, 0.08, valley);
    col = mix(col, mix(vec3(0.42, 0.34, 0.24), crop, edgeF), farm);
  }
  // Center-pivot irrigation circles on the dry side.
  if (uPivots > 0.0) {
    vec2 pc = q * 1.6;
    vec2 cell = floor(pc);
    vec2 lp = fract(pc) - 0.5;
    float r = length(lp);
    float disc = smoothstep(0.46, 0.44, r) * smoothstep(0.3, 0.7, dry) * smoothstep(0.02, 0.06, valley);
    float arm = noise(vec2(atan(lp.y, lp.x) * 4.0, r * 40.0));
    vec3 green = mix(vec3(0.20, 0.38, 0.12), vec3(0.33, 0.48, 0.18), arm);
    vec3 brown = mix(vec3(0.66, 0.52, 0.35), vec3(0.74, 0.62, 0.44), arm);
    col = mix(col, hash(cell) < uPivots ? green : brown, disc);
  }

  float pond = smoothstep(uWaterLvl, uWaterLvl - 0.012, h) * smoothstep(0.2, 0.08, valley);
  float water = max(max(river, stream * 0.9) * (1.0 - dry * 0.85), pond);
  float burnt = 0.0, smoke = 0.0;
  if (uScorch > 0.0) {
    float x = uScorch * 1.6 - 0.3 - fbm3(q * 0.5 + 9.0) * 0.9;
    burnt = smoothstep(0.0, 0.04, x);
    float crack = smoothstep(0.04, 0.0, abs(noise(q * 14.0) - 0.5)) * 0.5 + smoothstep(0.03, 0.0, abs(noise(q * 40.0) - 0.5)) * 0.3;
    vec3 scorched = mix(vec3(0.46, 0.15, 0.06), vec3(0.72, 0.32, 0.13), n) * (1.0 - 0.5 * crack);
    // Where the forest stood: ash and black stumps.
    vec3 ash = mix(vec3(0.10, 0.07, 0.06), vec3(0.28, 0.22, 0.2), grain);
    scorched = mix(scorched, ash, veg * smoothstep(0.55, 0.75, grain) * 0.6);
    col = mix(col, scorched, burnt);
    water *= 1.0 - burnt * 0.9;
    // The fire front, and smoke blowing off it.
    float edge = (1.0 - smoothstep(0.0, 2.5 * fwidth(x) + 0.002, abs(x - 0.01))) * veg;
    col += vec3(1.0, 0.45, 0.12) * edge * (0.7 + 0.6 * grain);
    smoke = smoothstep(0.0, 0.04, x + 0.02) * exp(-max(x, 0.0) * 5.0) * smoothstep(0.35, 0.7, fbm(q * vec2(1.2, 3.0) + vec2(uT * 0.4, uT * 0.9)));
  }
  vec3 wcol = mix(vec3(0.07, 0.15, 0.19), vec3(0.26, 0.38, 0.42), 0.35 + 0.4 * noise(q * 2.0) + (grain - 0.5) * 0.1);
  col = mix(col, mix(wcol, vec3(0.66, 0.58, 0.45), burnt), water);

  col *= mix(shade, 1.0, water) * uLight;
  float c = fbm(q * 0.35 + uShadow);
  float cs = smoothstep(0.5, 0.58, fbm3(q * 0.35 + uShadow + vec2(0.05, -0.04)));
  col *= 1.0 - 0.5 * cs * uClouds.w;
  float cloud = smoothstep(0.5, 0.6, c) * uClouds.w;
  vec3 cc = uClouds.rgb * (0.78 + 0.35 * smoothstep(0.5, 0.75, c) + (noise(q * 5.0 + uShadow * 2.0) - 0.5) * 0.15);
  col = mix(col, cc * uLight, cloud);
  col = mix(col, vec3(0.2, 0.17, 0.15), smoke * 0.85);
  col = mix(col, uHaze.rgb, uHaze.w);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------------------
// Helpers

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const css = (c, a = 1) => `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${a})`;
const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

let skyProgram = null;
let aerialProgram = null;
function init(p) {
  skyProgram = p.shader(SKY);
  aerialProgram = p.shader(AERIAL);
}

// Every sky uniform, so a shot never inherits another shot's settings.
function skyDefaults() {
  return {
    uT: 0, uHorizon: 0.4,
    uZenith: [0.1, 0.14, 0.3], uMid: [0.3, 0.3, 0.45], uLow: [0.8, 0.55, 0.35],
    uSun: [0, 0.5, 0, 0], uSunCol: [1, 0.7, 0.4],
    uCloud: [0, 0, 0.4, 0], uCloudLit: [1, 0.95, 0.9], uCloudDark: [0.3, 0.3, 0.35], uCloudAmt: 0,
    uStars: 0, uTrails: [0, 1, 0, 0], uRot: 0,
    uRidge: [0, 0.1, 0, 0], uRidgeCol: [0, 0, 0], uRidgeX: 99,
    uCity: [0, 0, 0, 0], uCityCol: [0, 0, 0], uCitySeed: 0, uWin: [1, 0.8, 0.5, 0],
    uWall: [-9, 0, 0, 0], uWallCol: [0.6, 0.3, 0.1],
    uHaze: [0.5, 0.5, 0.5, 0], uWater: [0.6, 0.65, 0.7, 0], uWaves: 0.5, uGround: [0.04, 0.035, 0.03],
  };
}

// Frame coordinates to pixels.
const frameOf = (f) => ({
  X: (x) => f.w / 2 + x * f.h,
  Y: (y) => f.h * (1 - y),
  half: f.w / (2 * f.h), // half the frame width, in frame heights
});

function paintSky(ctx, f, p, u) {
  const out = p.runShader(skyProgram, u);
  if (out) ctx.drawImage(out, 0, 0);
  else skyFallback(ctx, f, u);
}

// Without WebGL 2: gradients and flat silhouettes in the same colors.
function skyFallback(ctx, f, u) {
  const { X, Y, half } = frameOf(f);
  const hy = Y(u.uHorizon);
  let g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, css(u.uZenith));
  g.addColorStop(0.65, css(u.uMid));
  g.addColorStop(1, css(u.uLow));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, hy + 1);
  if (u.uSun[3] > 0) {
    const sx = X(u.uSun[0]), sy = Y(u.uSun[1]);
    g = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.h * 0.5);
    g.addColorStop(0, css(u.uSunCol, 0.8 * u.uSun[3]));
    g.addColorStop(1, css(u.uSunCol, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, hy);
    if (u.uSun[2] > 0) {
      ctx.fillStyle = css(u.uSunCol);
      ctx.beginPath();
      ctx.arc(sx, sy, u.uSun[2] * f.h, 0, TAU);
      ctx.fill();
    }
  }
  if (u.uRidge[0] > 0) {
    ctx.fillStyle = css(mixc(u.uRidgeCol, u.uLow, u.uRidge[3]), u.uRidge[0]);
    ctx.beginPath();
    ctx.moveTo(0, hy);
    for (let x = -half; x <= half + 0.05; x += 0.05) ctx.lineTo(X(x), Y(u.uHorizon + u.uRidge[1] * (0.3 + 0.7 * (hash1(Math.floor(x * 3)) > 0.5))));
    ctx.lineTo(f.w, hy);
    ctx.fill();
  }
  if (u.uCity[0] > 0) {
    ctx.fillStyle = css(u.uCityCol, u.uCity[0]);
    for (let x = u.uCity[1]; x < u.uCity[2]; x += 1 / 40) {
      const bh = u.uCity[3] * (0.2 + 0.8 * hash1(Math.floor(x * 40)) ** 2);
      ctx.fillRect(X(x), Y(u.uHorizon + bh), f.h / 40 + 1, bh * f.h + 1);
    }
  }
  g = ctx.createLinearGradient(0, hy, 0, f.h);
  if (u.uWater[3] > 0) {
    g.addColorStop(0, css(mixc(u.uLow, u.uWater, 0.3)));
    g.addColorStop(1, css(mixc(u.uZenith, u.uWater, 0.2)));
  } else {
    g.addColorStop(0, css(mixc(u.uGround, u.uLow, 0.2)));
    g.addColorStop(1, css(u.uGround));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, hy, f.w, f.h - hy);
  if (u.uWall[2] > 0) {
    const fx = X(u.uWall[0]);
    g = ctx.createLinearGradient(fx - f.h * 0.4, 0, fx + f.h * 0.1, 0);
    g.addColorStop(0, css(u.uWallCol, u.uWall[2]));
    g.addColorStop(1, css(u.uWallCol, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, Y(u.uHorizon + u.uWall[1]), f.w, f.h);
  }
  if (u.uHaze[3] > 0) {
    ctx.fillStyle = css(u.uHaze, u.uHaze[3] * 0.5);
    ctx.fillRect(0, 0, f.w, f.h);
  }
}

function paintAerial(ctx, f, p, u) {
  const out = p.runShader(aerialProgram, u);
  if (out) {
    ctx.drawImage(out, 0, 0);
    return;
  }
  // Fallback: the land's main color and a few soft patches.
  const base = mixc(mixc([0.6, 0.48, 0.33], [0.18, 0.32, 0.15], u.uGreen * (1 - u.uSplit * 0.4)), [0.55, 0.2, 0.08], u.uScorch);
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, f.w, f.h);
  const r = p.rng(7);
  for (let i = 0; i < 24; i++) {
    const x = r() * f.w, y = r() * f.h, s = (0.05 + r() * 0.15) * f.h;
    ctx.fillStyle = css(mixc(base, r() < 0.5 ? [0.1, 0.2, 0.25] : [0.8, 0.7, 0.5], 0.4), 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.6, r() * 3, 0, TAU);
    ctx.fill();
  }
}

// A wind turbine standing at (x, y) pixels, `size` pixels tall.
function turbine(ctx, x, y, size, angle, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.016, y);
  ctx.lineTo(x + size * 0.016, y);
  ctx.lineTo(x + size * 0.007, y - size);
  ctx.lineTo(x - size * 0.007, y - size);
  ctx.fill();
  ctx.fillRect(x - size * 0.035, y - size - size * 0.014, size * 0.06, size * 0.028);
  const len = size * 0.48;
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * TAU) / 3;
    const cx = Math.cos(a), sx = Math.sin(a);
    const nx = -sx, ny = cx;
    const hx = x, hy = y - size;
    ctx.beginPath();
    ctx.moveTo(hx + nx * size * 0.016, hy + ny * size * 0.016);
    ctx.lineTo(hx + cx * len, hy + sx * len);
    ctx.lineTo(hx - nx * size * 0.008 + cx * len * 0.25, hy - ny * size * 0.008 + sx * len * 0.25);
    ctx.lineTo(hx - nx * size * 0.01, hy - ny * size * 0.01);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y - size, size * 0.018, 0, TAU);
  ctx.fill();
}

// A ridge line across the whole frame, as a closed silhouette down to the bottom.
function ridge(ctx, f, p, base, amp, seed, color) {
  const { X, Y, half } = frameOf(f);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, f.h);
  for (let x = -half - 0.02; x <= half + 0.04; x += 0.02) ctx.lineTo(X(x), Y(ridgeY(p, x, base, amp, seed)));
  ctx.lineTo(f.w, f.h);
  ctx.fill();
}
const ridgeY = (p, x, base, amp, seed) => base + amp * (p.noise(x * 1.3 + seed, seed) - 0.5) * 2 + amp * 0.25 * (p.noise(x * 7 + seed, 3) - 0.5);

// ---------------------------------------------------------------------------
// NOW, 2026. A city between the desert and the sea, in hyper time-lapse: the sun
// racing through days and nights, clouds pouring in, traffic in streaks. Holding
// slows everything to real time at a calm golden dusk; birds appear.

const NIGHT = { zen: [0.01, 0.012, 0.035], mid: [0.03, 0.035, 0.08], low: [0.08, 0.07, 0.11] };
const TWILIGHT = { zen: [0.1, 0.13, 0.28], mid: [0.45, 0.3, 0.42], low: [0.95, 0.52, 0.28] };
const DAY = { zen: [0.2, 0.38, 0.62], mid: [0.5, 0.62, 0.74], low: [0.8, 0.78, 0.7] };
const CALM = { zen: [0.06, 0.07, 0.25], mid: [0.33, 0.25, 0.52], low: [0.98, 0.6, 0.3] };

const palette = (a, b, t) => ({ zen: mixc(a.zen, b.zen, t), mid: mixc(a.mid, b.mid, t), low: mixc(a.low, b.low, t) });
// The picture tracks the projected 2100 warming the viewer is watching: amber
// haze around 2.7 °C, a red-brown dust haze and a bloodshot sun at 4.4 °C.
const AMBER = { zen: [0.3, 0.25, 0.25], mid: [0.7, 0.5, 0.32], low: [0.9, 0.62, 0.35] };
const RUST = { zen: [0.17, 0.06, 0.045], mid: [0.46, 0.17, 0.08], low: [0.7, 0.3, 0.12] };
const heatPalette = (heat) => (heat < 0.43 ? AMBER : palette(AMBER, RUST, smooth(0.43, 1, heat)));
const cyclePalette = (el) => (el < 0 ? palette(NIGHT, TWILIGHT, smooth(-0.35, 0, el)) : palette(TWILIGHT, DAY, smooth(0, 0.45, el)));

const now = {
  id: 'now',
  init,
  render(ctx, f, p) {
    const P = f.params || {};
    const hl = clamp01(P.holdLevel ?? 0);
    const held = clamp01(P.hold ?? 0);
    // Film time: film.js integrates it at the held speed, so nothing jumps.
    const flow = Number.isFinite(P.flow) ? P.flow : f.t;
    const rate = 1 - 0.9 * hl;
    // Projected 2100 warming, 1.4 … 4.4 °C: the main driver of haze and color.
    // (Holding drives speed.) The harness has no projection, so derive one.
    const projected = Number.isFinite(P.projected) ? P.projected : 4.4 - 3 * Math.max(held, hl);
    const heat = clamp01((projected - 1.4) / 3);
    const { X, Y, half } = frameOf(f);
    const H = 0.42;

    // The sun: a day every 2.4 seconds (slower with reduced motion). Holding
    // pulls it to one place, just above the sea, and keeps it there.
    const cycle = flow * (f.reduced ? 0.15 : 0.42) + 0.15;
    const el0 = Math.sin(cycle * TAU);
    const duskX = 0.7 * half; // off to the right, clear of the number in the middle
    const sunX = mix(-Math.cos(cycle * TAU) * (half + 0.1), duskX, hl);
    const el = mix(el0, 0.07, hl);
    const sunY = H + el * 0.5;
    const tint = heatPalette(heat);
    const pal = palette(palette(cyclePalette(el0), CALM, hl), tint, smooth(0, 0.45, heat) * 0.75);
    const day = smooth(0, 0.4, el);
    const night = 1 - smooth(-0.25, 0.05, el);
    const sunCol = mixc(mixc([1, 0.5, 0.22], [1, 0.93, 0.82], day), [1, 0.28, 0.1], smooth(0.3, 1, heat));
    const dust = mixc([0.62, 0.42, 0.26], [0.55, 0.26, 0.12], smooth(0.43, 1, heat));

    const u = skyDefaults();
    Object.assign(u, {
      uT: flow, uHorizon: H,
      uZenith: pal.zen, uMid: pal.mid, uLow: pal.low,
      uSun: [sunX, sunY, 0.022 + 0.01 * heat, smooth(-0.2, 0.05, el) * mix(1, 0.6, day) * (1 - 0.45 * heat)], uSunCol: sunCol,
      uCloud: [flow * 0.12, flow * 0.9, mix(0.6, 0.5, hl), (1 - hl) * (f.reduced ? 0.3 : 1)],
      uCloudLit: mixc(mixc(mixc(pal.low, [0.95, 0.93, 0.9], day), [1, 0.72, 0.5], hl * 0.6), dust, heat * 0.7),
      uCloudDark: mixc(pal.mid, pal.zen, 0.5).map((v) => v * 0.8),
      uCloudAmt: mix(0.95, 0.75, hl),
      uStars: night * 0.7 * (1 - hl),
      uRidge: [1, 0.07, 4.2, mix(0.55, 0.4, hl)], uRidgeX: 0.08 * half + 0.1, uRidgeCol: mixc([0.05, 0.04, 0.05], [0.45, 0.3, 0.25], day * 0.6),
      uCity: [1, -half - 0.2, 0.08 * half + 0.04, 0.2], uCityCol: mixc([0.02, 0.02, 0.03], [0.22, 0.2, 0.2], day * 0.7),
      uWin: [...mixc([0.45, 0.5, 0.55], [1, 0.78, 0.48], Math.max(1 - day, hl)), clamp01(night * 0.45 + hl * 0.3 + day * 0.12)],
      // A bank of dust along the horizon, rising with the projection.
      uWall: [half + 2, 0.05 + 0.2 * heat, 0.75 * smooth(0.25, 1, heat), flow], uWallCol: dust,
      uHaze: [...mixc(mixc([0.95, 0.65, 0.4], tint.low, smooth(0, 0.45, heat)), dust, smooth(0.43, 1, heat)), 0.04 + 0.5 * heat * (0.55 + 0.45 * day)],
      uWater: [...mixc([0.55, 0.62, 0.72], [0.6, 0.4, 0.3], heat), 1], uWaves: mix(1, 0.5, hl),
    });
    paintSky(ctx, f, p, u);

    // The land in front of the city, down to the shore.
    const coastTop = 0.08 * half + 0.06;
    const landCol = mixc(mixc(mixc([0.015, 0.015, 0.02], [0.2, 0.16, 0.12], day), [0.07, 0.045, 0.05], hl), [0.16, 0.07, 0.04], heat * 0.5);
    const landPath = new Path2D();
    landPath.moveTo(0, Y(H));
    landPath.lineTo(X(coastTop), Y(H));
    landPath.bezierCurveTo(X(coastTop + 0.12), Y(H - 0.06), X(coastTop + 0.05), Y(H - 0.25), X(coastTop + 0.35 * half + 0.2), f.h);
    landPath.lineTo(0, f.h);
    const lg = ctx.createLinearGradient(0, Y(H), 0, f.h);
    lg.addColorStop(0, css(mixc(landCol, u.uHaze, u.uHaze[3] * 0.8)));
    lg.addColorStop(0.3, css(landCol));
    lg.addColorStop(1, css(landCol.map((v) => v * 0.6)));
    ctx.fillStyle = lg;
    ctx.fill(landPath);
    // A pale line of surf along the shore, catching the sky.
    ctx.strokeStyle = css(pal.low, 0.35);
    ctx.lineWidth = Math.max(1, f.h * 0.003);
    ctx.stroke(landPath);
    // By day, the shadows of the racing clouds sweep over the land and the sea.
    if (day > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, Y(H), f.w, f.h - Y(H));
      ctx.clip();
      const rc = p.rng(77);
      for (let i = 0; i < 9; i++) {
        const z = 1.2 + rc() * 9;
        const span = 2 * half + 1.6;
        const x = ((rc() * span + (flow * (0.5 + rc() * 0.3)) / z) % span) - half - 0.8;
        const cx = X(x), cy = Y(H) + (H * f.h) / z, rad = (f.h * (0.9 + rc() * 0.9)) / z;
        ctx.setTransform(1, 0, 0, 0.3, cx, cy);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, `rgba(12,10,16,${0.4 * day * (1 - 0.6 * hl)})`);
        g.addColorStop(1, 'rgba(12,10,16,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }

    // The suburbs: streets of lights receding toward the city. By day the same
    // grid shows faintly as rooftops.
    const vis = 0.3 + 0.7 * Math.max(night, hl * 0.8);
    const farX = -0.35 * half;
    const lightsOn = Math.max(night, hl * 0.6);
    ctx.save();
    ctx.clip(landPath);
    ctx.globalCompositeOperation = lightsOn > 0.3 ? 'lighter' : 'source-over';
    const rs = p.rng(1982);
    const vx = X(farX), vy = Y(H);
    // Rows of street lights as dots, gathered into one path per color and
    // brightness (a few fills rather than hundreds of dashed strokes).
    const dots = new Map();
    const dayA = day * 0.45 * (1 - hl);
    for (let z = 1.1; z < 30; z *= 1.1) {
      const sy = vy + (H * f.h) / z;
      const dot = Math.max(1, (f.h * 0.005) / z);
      const gap = Math.max(dot + 1, (0.4 * f.h * 0.5) / z);
      for (let k = 0; k < 4; k++) {
        const x0 = X((rs() * 2 - 1) * (half + 0.05));
        const len = ((1.5 + rs() * 5) * 0.5 * f.h) / z;
        const on = rs();
        const warm = rs() < 0.8;
        const a = vis * smooth(on * 0.6, on * 0.6 + 0.2, lightsOn) * 0.8;
        if (a + dayA < 0.02) continue;
        // By day the same streets show as pale roofs and roads.
        const key = a > dayA ? `${warm ? 'w' : 'c'}${Math.round(a * 10)}` : `d${Math.round(dayA * 10)}`;
        if (!dots.has(key)) dots.set(key, []);
        const list = dots.get(key);
        for (let x = x0; x < x0 + len; x += gap) list.push(x, sy - dot / 2, a > dayA ? dot : dot * 2.5, dot);
      }
    }
    for (const [key, list] of dots) {
      const a = Number(key.slice(1)) / 10;
      ctx.fillStyle = key[0] === 'w' ? `rgba(255,165,75,${a})` : key[0] === 'c' ? `rgba(205,220,255,${a})` : `rgba(150,132,110,${a})`;
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
      ctx.fill();
    }
    // Avenues running toward the city.
    ctx.lineWidth = Math.max(1, f.h * 0.0015);
    ctx.strokeStyle = css([1, 0.62, 0.3], 0.14 * vis * lightsOn);
    ctx.beginPath();
    for (let i = -9; i <= 9; i++) {
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx + i * f.h * 0.45, vy + H * f.h);
    }
    ctx.stroke();
    ctx.restore();

    // Traffic. A highway comes out of the city toward the camera, and a shore
    // road runs along the foot of the skyline. Headlights one way, tail lights
    // the other. Streak length is how far a car moves while the shutter is open.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const shutter = 0.3 * rate;
    const ZMAX = 25;
    const nearX = -0.1 * half - 0.12;
    const road = (z, lane) => {
      const v = (1 - 1 / z) / (1 - 1 / ZMAX);
      const x = mix(nearX, farX, v) + 0.22 * Math.sin(v * Math.PI) + lane * 0.08 / z;
      return [X(x), Y(mix(-0.06, H - 0.004, v))];
    };
    const r = p.rng(2026);
    // Cars batched by color and (rounded) width: a few strokes, not 150.
    const cars = new Map();
    for (let i = 0; i < 150; i++) {
      const out = i % 2;
      const spd = 3 + r() * 4;
      const seed = r();
      const s = (seed + (flow * spd) / ZMAX) % 1;
      const z = out ? 1 + s * (ZMAX - 1) : ZMAX - s * (ZMAX - 1);
      const len = spd * shutter + 0.02;
      const lane = (out ? 1 : -1) * (0.45 + 0.3 * Math.floor(r() * 3));
      const lw = Math.max(1, Math.round((f.h * 0.012) / z * 2) / 2);
      const key = `${out}:${lw}`;
      if (!cars.has(key)) cars.set(key, new Path2D());
      const path = cars.get(key);
      for (let k = 0; k <= 10; k++) {
        const zz = Math.max(1, z - (out ? 1 : -1) * len * (k / 10));
        const [px, py] = road(zz, lane);
        if (k === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
    }
    for (const [key, path] of cars) {
      const [out, lw] = key.split(':').map(Number);
      ctx.strokeStyle = css(out ? [1, 0.2, 0.1] : [1, 0.9, 0.72], vis * (out ? 0.8 : 0.9));
      ctx.lineWidth = lw;
      ctx.stroke(path);
    }
    // Street lights along the highway.
    ctx.fillStyle = css([1, 0.7, 0.4], 0.5 * vis);
    for (let z = 1.3; z < ZMAX; z *= 1.18) {
      for (const lane of [-2.2, 2.2]) {
        const [px, py] = road(z, lane);
        const s = Math.max(1, (f.h * 0.008) / z);
        ctx.fillRect(px - s / 2, py - s * 4, s, s);
      }
    }
    // The shore road.
    const x0 = -half - 0.1, x1 = coastTop - 0.03;
    for (let i = 0; i < 40; i++) {
      const out = i % 2;
      const spd = 0.12 + r() * 0.12;
      const seed = r();
      const s = (seed + flow * spd * (out ? 1 : -1) + 10) % 1;
      const x = mix(x0, x1, s);
      const len = spd * shutter * 1.8 + 0.001;
      ctx.strokeStyle = css(out ? [1, 0.2, 0.1] : [1, 0.9, 0.72], vis * 0.8);
      ctx.lineWidth = Math.max(1, f.h * 0.0025);
      const y = Y(H - 0.009 - (out ? 0 : 0.004));
      ctx.beginPath();
      ctx.moveTo(X(x), y);
      ctx.lineTo(X(x - (out ? len : -len)), y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Birds, only visible when the world is slow enough to see them.
    if (hl > 0.02) {
      ctx.strokeStyle = css([0.05, 0.035, 0.05], smooth(0.1, 0.8, hl));
      ctx.lineWidth = Math.max(1, f.h * 0.0028);
      ctx.lineJoin = 'round';
      for (let i = 0; i < 9; i++) {
        const span = 2 * half + 0.6;
        const bx = -half - 0.3 + ((flow * 0.25 + i * 0.045 + hash1(i) * 0.08 + 0.75 * span) % span);
        const by = 0.6 + 0.04 * Math.sin(i * 1.7) + i * 0.008 + 0.01 * Math.sin(flow * 1.2 + i);
        const s = f.h * (0.012 + 0.004 * hash1(i + 9));
        const flap = Math.sin(flow * 22 + i * 1.3);
        const bxp = X(bx), byp = Y(by);
        // Fade out toward the left, where the ledger sits.
        ctx.strokeStyle = css([0.05, 0.035, 0.05], smooth(0.1, 0.8, hl) * smooth(-0.1, 0.1, bx));
        ctx.beginPath();
        ctx.moveTo(bxp - s, byp - flap * s * 0.6);
        ctx.quadraticCurveTo(bxp - s * 0.4, byp - s * 0.2, bxp, byp);
        ctx.quadraticCurveTo(bxp + s * 0.4, byp - s * 0.2, bxp + s, byp - flap * s * 0.6);
        ctx.stroke();
      }
    }

    // Quiet places for the words: darker behind the projected temperature (DOM,
    // centered a little below the middle) and in the top left for the ledger.
    ctx.save();
    ctx.setTransform(1.6, 0, 0, 1, f.w / 2, f.h * 0.56);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, f.h * 0.34);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-f.h * 0.34, -f.h * 0.34, f.h * 0.68, f.h * 0.68);
    ctx.restore();
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(f.w, f.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, f.h);
  },
};

// ---------------------------------------------------------------------------
// FUTURE, 2026 to 2100. Three shots per ending, in time-lapse: the land from
// above, a ridge on the horizon, a city by the water.

const OUTCOMES = ['better', 'middle', 'worse'];

// Five IPCC scenarios in three groups. params.severity runs 0..1 across all
// five (0 SSP1-1.9, 0.25 SSP1-2.6, 0.5 SSP2-4.5, 0.75 SSP3-7.0, 1 SSP5-8.5).
// `within` is where the scenario sits inside its group, 0..1: better goes
// from SSP1-1.9 (0) to SSP1-2.6 (1), worse from SSP3-7.0 (0) to SSP5-8.5 (1).
// The middle group has one scenario, at 0.5.
const DEFAULT_SEVERITY = { better: 0.1, middle: 0.5, worse: 0.9 };
function scenario(P) {
  const outcome = OUTCOMES.includes(P.outcome) ? P.outcome : 'middle';
  const severity = Number.isFinite(P.severity) ? clamp01(P.severity) : DEFAULT_SEVERITY[outcome];
  const within = outcome === 'better' ? clamp01(severity / 0.25) : outcome === 'worse' ? clamp01((severity - 0.75) / 0.25) : 0.5;
  return { outcome, within, amounts: P.amounts || {} };
}

const future = {
  id: 'future',
  init,
  render(ctx, f, p) {
    const P = f.params || {};
    const { outcome, within, amounts } = scenario(P);
    const shot = ((f.shot % 3) + 3) % 3;
    const t = f.shotT;
    // The years pass faster and faster: seasons that speed up through the shot.
    const seasonPhase = f.reduced ? 0 : 0.45 * t + 0.045 * t * t;
    const season = Math.sin(seasonPhase * TAU);
    if (shot === 0) land(ctx, f, p, outcome, t, season, within, amounts);
    else if (shot === 1) horizon(ctx, f, p, outcome, t, within);
    else waterfront(ctx, f, p, outcome, t, within);
  },
};

// Shot 1: the land from above. Wetlands return, fields dry out, or the forest burns.
function land(ctx, f, p, outcome, t, season, g, amounts) {
  const k = smooth(0, 13, t);
  const u = {
    uCam: [1.3 + t * 0.05, 0.4 + t * 0.07, 3.2 - t * 0.03],
    uGreen: 0.2, uScorch: 0, uWaterLvl: 0.3, uPivots: 0, uSplit: 0, uFields: 0,
    uSeason: season * 0.8, uShadow: [t * 0.1, t * 0.04], uClouds: [0.97, 0.95, 0.92, 1], uT: t,
    uHaze: [0.75, 0.85, 0.9, 0.06], uLight: [1, 0.97, 0.9],
  };
  if (outcome === 'better') {
    // SSP1-1.9 greens fully under a clear sky; SSP1-2.6 a little less, in a
    // light haze. The more forest the viewer cleared, the less of it returns.
    const cleared = clamp01(amounts.fields ?? 0);
    Object.assign(u, {
      uGreen: 0.1 + (0.9 - 0.22 * g - 0.12 * cleared) * k, uWaterLvl: 0.3 + (0.06 - 0.03 * g) * k,
      uHaze: [...mixc([0.75, 0.85, 0.9], [0.85, 0.75, 0.6], g), 0.03 + 0.14 * g],
    });
  } else if (outcome === 'middle') {
    Object.assign(u, {
      uGreen: 0.65 - 0.2 * k, uSplit: 1, uPivots: 0.8 - 0.6 * k, uWaterLvl: 0.3 - 0.04 * k, uFields: 1,
      uHaze: [0.82, 0.64, 0.44, 0.14], uLight: [1.05, 0.95, 0.82], uSeason: season * 0.4 + 0.1,
      uClouds: [0.95, 0.88, 0.78, 0.6],
    });
  } else {
    Object.assign(u, {
      // SSP3-7.0 leaves patches of forest standing; SSP5-8.5 burns nearly all.
      uGreen: 0.85, uScorch: 0.2 + (0.48 + 0.24 * g) * k, uWaterLvl: 0.3 - (0.06 + 0.06 * g) * k,
      uHaze: [0.62, 0.3, 0.16, 0.1 + (0.06 + 0.1 * g) * k], uLight: [1.1, 0.85, 0.7], uSeason: season * 0.4 + 0.4,
      uClouds: [0.8, 0.7, 0.62, 0.35],
    });
  }
  paintAerial(ctx, f, p, u);
}

// Shot 2: a ridge on the horizon. Turbines at dawn; turbines beside smokestacks
// in an amber haze; or a dust storm swallowing a skyline under a blood-orange sun.
function horizon(ctx, f, p, outcome, t, g) {
  const { X, Y, half } = frameOf(f);
  const u = skyDefaults();
  u.uT = t;
  if (outcome === 'worse') {
    const H = 0.3;
    Object.assign(u, {
      uHorizon: H,
      uZenith: [0.16, 0.05, 0.035], uMid: [0.48, 0.15, 0.06], uLow: [0.78, 0.3, 0.1],
      uSun: [0.3 * half, 0.74 - t * 0.004, 0.045, 0.55], uSunCol: [1, 0.36, 0.1],
      uCloud: [t * 0.05, t * 0.2, 0.3, 0.3], uCloudLit: [0.8, 0.35, 0.15], uCloudDark: [0.3, 0.1, 0.05], uCloudAmt: 0.5,
      uCity: [1, -half * 0.95, half * 0.95, 0.34], uCityCol: [0.07, 0.03, 0.025], uWin: [1, 0.55, 0.25, 0.05],
      // SSP3-7.0: a lower storm that stops short of the city's far side.
      // SSP5-8.5: a towering one that swallows nearly all of it.
      uWall: [mix(-half * 0.8 - 0.1, half * (0.15 + 0.55 * g), smooth(-2, 13, t)), 0.42 + 0.26 * g, 0.85 + 0.15 * g, t], uWallCol: [0.66, 0.32, 0.14],
      uHaze: [0.62, 0.27, 0.12, 0.2 + 0.14 * g], uGround: [0.14, 0.06, 0.035],
    });
    paintSky(ctx, f, p, u);
    // Dead trees on the flat in front, fogged by the dust as it arrives.
    const front = u.uWall[0];
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = -half + ((i + 0.5) / 7) * 2 * half + (hash1(i) - 0.5) * 0.1;
      const y = 0.08 + hash1(i + 3) * 0.14;
      const s = (0.2 - y * 0.6) * f.h;
      const fog = smooth(x - 0.1, x + 0.15, front);
      ctx.strokeStyle = css(mixc([0.05, 0.02, 0.015], u.uWallCol.map((v) => v * 0.7), fog));
      ctx.lineWidth = Math.max(1, s * 0.05);
      const bx = X(x), by = Y(y);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + s * 0.03, by - s);
      for (let b = 0; b < 4; b++) {
        const hy = by - s * (0.4 + b * 0.15);
        const dir = b % 2 ? 1 : -1;
        ctx.moveTo(bx + s * 0.015, hy);
        ctx.lineTo(bx + dir * s * (0.25 - b * 0.04), hy - s * 0.2);
      }
      ctx.stroke();
    }
    return;
  }

  const better = outcome === 'better';
  const H = 0.36;
  if (better) {
    Object.assign(u, {
      uHorizon: H,
      // SSP1-2.6 dulls the dawn a little: a paler zenith and a veil of haze.
      uZenith: mixc([0.12, 0.18, 0.36], [0.26, 0.26, 0.34], g * 0.6), uMid: [0.55, 0.45, 0.6], uLow: [0.98, 0.68, 0.45],
      uSun: [0.12 * half, H - 0.02 + t * 0.009, 0.022, 0.9 - 0.2 * g], uSunCol: [1, 0.72, 0.42],
      uCloud: [t * 0.03, t * 0.12, 0.45, 0.2], uCloudLit: [1, 0.72, 0.62], uCloudDark: [0.35, 0.3, 0.45], uCloudAmt: 0.85,
      uHaze: [...mixc([0.95, 0.75, 0.6], [0.9, 0.7, 0.5], g), 0.04 + 0.2 * g],
    });
  } else {
    Object.assign(u, {
      uHorizon: H,
      uZenith: [0.35, 0.3, 0.27], uMid: [0.68, 0.5, 0.32], uLow: [0.9, 0.64, 0.36],
      uSun: [-0.35 * half, 0.78, 0.018, 0.45], uSunCol: [0.85, 0.66, 0.45],
      uCloud: [t * 0.05, t * 0.2, 0.55, 0.35], uCloudLit: [0.92, 0.72, 0.5], uCloudDark: [0.5, 0.38, 0.28], uCloudAmt: 0.55,
      uHaze: [0.85, 0.62, 0.38, 0.4],
    });
  }
  paintSky(ctx, f, p, u);

  const farCol = better ? [0.32, 0.22, 0.34] : [0.5, 0.36, 0.25];
  const midCol = better ? [0.16, 0.1, 0.18] : [0.32, 0.22, 0.15];
  const nearCol = better ? [0.04, 0.03, 0.06] : [0.12, 0.08, 0.055];
  const speed = f.reduced ? 0.4 : 0.9;
  // Three ridges fading into the light, mist lying between them, and turbines
  // on the middle and near ridges.
  ridge(ctx, f, p, 0.37, 0.025, 8, css(farCol));
  const mist = (y0, y1, a) => {
    const g = ctx.createLinearGradient(0, Y(y0), 0, Y(y1));
    g.addColorStop(0, css(u.uLow, 0));
    g.addColorStop(0.7, css(u.uLow, a));
    g.addColorStop(1, css(u.uLow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, Y(y0), f.w, Y(y1) - Y(y0));
  };
  mist(0.38, 0.28, better ? 0.5 : 0.35);
  ridge(ctx, f, p, 0.315, 0.03, 5, css(midCol));
  for (let x = -half - 0.05, i = 0; x <= half + 0.05; x += 0.11, i++) {
    if (!better && x > 0.05) break;
    const y = ridgeY(p, x, 0.315, 0.03, 5) - 0.002;
    turbine(ctx, X(x), Y(y), f.h * 0.09, t * speed * 1.2 + i * 2.3, css(midCol));
  }
  mist(0.33, 0.2, better ? 0.45 : 0.3);
  ridge(ctx, f, p, 0.22, 0.045, 2, css(nearCol));

  // The near turbines; in the middle future only on the left.
  const spacing = 0.34;
  const right = better ? half + 0.1 : 0.0;
  for (let x = -Math.floor(half / spacing) * spacing - 0.12; x <= right; x += spacing) {
    const i = Math.round(x / spacing);
    const y = ridgeY(p, x, 0.22, 0.045, 2) - 0.004;
    const size = f.h * (0.25 + 0.04 * hash1(i));
    turbine(ctx, X(x), Y(y), size, t * speed + i * 1.1, css(nearCol));
  }
  if (better) return;

  // A power station on the right, its plumes blown across toward the turbines.
  const stacks = [0, 1, 2].map((s) => 0.18 * half + 0.08 + s * 0.09 * Math.max(0.7, half));
  const plantBase = ridgeY(p, stacks[1], 0.22, 0.045, 2) - 0.01;
  for (let s = 0; s < 3; s++) {
    const x = stacks[s];
    const top = plantBase + 0.22 + s * 0.025;
    for (let i = 0; i < 44; i++) {
      const a = (t * 0.2 + i / 44 + s * 0.31) % 1;
      const wob = (p.noise(i * 0.7 + s * 5, t * 0.3) - 0.5) * 0.06 * a;
      const px = x - 0.8 * a ** 1.3 + wob;
      const py = top + 0.16 * Math.sqrt(a) + wob;
      const rad = f.h * (0.014 + 0.09 * Math.sqrt(a));
      const g = ctx.createRadialGradient(X(px), Y(py), 0, X(px), Y(py), rad);
      const col = mixc([0.42, 0.36, 0.32], u.uLow, 0.5 * a);
      g.addColorStop(0, css(col, 0.3 * (1 - a) ** 1.5));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(X(px) - rad, Y(py) - rad, rad * 2, rad * 2);
    }
    ctx.fillStyle = css(nearCol);
    const sw = f.h * 0.024;
    ctx.beginPath();
    ctx.moveTo(X(x) - sw * 0.65, Y(plantBase));
    ctx.lineTo(X(x) - sw / 2, Y(top));
    ctx.lineTo(X(x) + sw / 2, Y(top));
    ctx.lineTo(X(x) + sw * 0.65, Y(plantBase));
    ctx.fill();
    ctx.fillStyle = css([0.62, 0.22, 0.12], 0.7);
    ctx.fillRect(X(x) - sw / 2, Y(top - 0.015), sw, Math.max(1, f.h * 0.005));
  }
  // The station's halls.
  ctx.fillStyle = css(nearCol);
  ctx.fillRect(X(stacks[0] - 0.07), Y(plantBase + 0.06), X(stacks[2] + 0.1) - X(stacks[0] - 0.07), f.h * 0.07);
  ctx.fillRect(X(stacks[2] + 0.02), Y(plantBase + 0.09), f.h * 0.07, f.h * 0.1);
}

// Shot 3: a city by the water. A clear night over a calm sea; a seawall holding
// back a higher sea; or a drowned grid, rooftops under a blood-orange sun.
function waterfront(ctx, f, p, outcome, t, g) {
  const { X, Y, half } = frameOf(f);
  const u = skyDefaults();
  u.uT = t;
  if (outcome === 'better') {
    const H = 0.38;
    Object.assign(u, {
      uHorizon: H,
      uZenith: [0.008, 0.012, 0.04], uMid: [0.02, 0.035, 0.09], uLow: [0.1, 0.1, 0.17],
      // SSP1-2.6: a faint glow of haze over the city washes out the fainter stars.
      uStars: 0.35 - 0.15 * g, uTrails: [0.3 * half, 0.98, 0.04 + t * 0.045, 0.95 - 0.4 * g], uRot: t * 0.045,
      uCity: [1, -half - 0.1, half + 0.1, 0.3], uCityCol: [0.015, 0.018, 0.03], uCitySeed: 5, uWin: [1, 0.8, 0.55, 0.3],
      uWater: [0.55, 0.62, 0.78, 1], uWaves: 0.25,
      uHaze: [...mixc([0.12, 0.12, 0.2], [0.24, 0.17, 0.14], g), 0.1 + 0.2 * g],
    });
    paintSky(ctx, f, p, u);
    return;
  }
  if (outcome === 'middle') {
    // The water is drawn by the shader with its horizon at the top of the
    // wall, so the city's reflection falls below the wall's.
    const H = 0.44, top = H + 0.085, seam = H + 0.05;
    const rise = smooth(0, 13, t);
    Object.assign(u, {
      uHorizon: top,
      uZenith: [0.24, 0.22, 0.24], uMid: [0.6, 0.43, 0.32], uLow: [0.88, 0.6, 0.38],
      uSun: [-0.3 * half, top + 0.1 - t * 0.005, 0.026, 0.55], uSunCol: [0.95, 0.6, 0.32],
      uCloud: [t * 0.04, t * 0.25, 0.55, 0.4], uCloudLit: [0.95, 0.68, 0.45], uCloudDark: [0.42, 0.32, 0.3], uCloudAmt: 0.6,
      uCity: [1, -half - 0.1, half + 0.1, 0.26], uCityCol: [0.15, 0.11, 0.1], uCitySeed: 3, uWin: [1, 0.75, 0.45, 0.25],
      uWater: [0.5, 0.48, 0.45, 1], uWaves: 0.7,
      uHaze: [0.8, 0.58, 0.4, 0.3],
    });
    paintSky(ctx, f, p, u);

    // The seawall: the old wall, stained, and a newer, paler course on top.
    ctx.fillStyle = css([0.25, 0.19, 0.16]);
    ctx.fillRect(0, Y(seam), f.w, Y(H) - Y(seam) + 1);
    ctx.fillStyle = css([0.52, 0.42, 0.33]);
    ctx.fillRect(0, Y(top), f.w, Y(seam) - Y(top) + 1);
    ctx.fillStyle = css([0.95, 0.74, 0.5], 0.55);
    ctx.fillRect(0, Y(top), f.w, Math.max(1, f.h * 0.003));
    ctx.fillStyle = css([0.15, 0.1, 0.08], 0.45);
    for (let x = -half; x < half + 0.1; x += 0.09) ctx.fillRect(X(x), Y(top), Math.max(1, f.h * 0.002), Y(H) - Y(top));
    // Old high-water stains on the lower wall.
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = css([0.1, 0.08, 0.07], 0.25);
      ctx.fillRect(0, Y(H + 0.012 + k * 0.011), f.w, Math.max(1, f.h * 0.004));
    }
    // The wall's reflection, its lower edge broken by the waves.
    const refl = Y(H - 0.075);
    ctx.fillStyle = css([0.24, 0.18, 0.15], 0.9);
    ctx.fillRect(0, Y(H), f.w, refl - Y(H) - f.h * 0.012);
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = css([0.24, 0.18, 0.15], 0.7 - k * 0.12);
      for (let x = -half - 0.05; x < half + 0.05; x += 0.05) {
        const wob = (p.noise(x * 20 + k * 3, t * 1.5) - 0.5) * f.h * 0.02;
        ctx.fillRect(X(x) + wob, refl - f.h * 0.012 + k * f.h * 0.005, f.h * 0.05, f.h * 0.003);
      }
    }
    // The sea against the wall, higher every year: a line of foam.
    const level = H + 0.004 + rise * 0.02;
    ctx.fillStyle = css([0.36, 0.3, 0.26]);
    ctx.fillRect(0, Y(level), f.w, Y(H) - Y(level) + 1);
    ctx.fillStyle = css([0.96, 0.86, 0.72], 0.75);
    for (let x = -half - 0.02; x < half; x += 0.012) {
      const wv = p.noise(x * 30 + t * 3, t) * 0.01;
      ctx.fillRect(X(x), Y(level + wv), f.h * 0.012 + 1, Math.max(1, f.h * 0.004));
    }
    // Spray thrown up the wall.
    for (let i = 0; i < 9; i++) {
      const a = (t * 0.45 + hash1(i) * 7) % 1;
      const x = X(-half + hash1(i + 20) * 2 * half);
      const rad = f.h * (0.02 + a * 0.05);
      const py = Y(level + 0.01 + a * 0.07);
      ctx.save();
      ctx.translate(x, py);
      ctx.scale(2.2, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, css([0.95, 0.88, 0.8], 0.4 * Math.sin(a * Math.PI)));
      g.addColorStop(1, css([0.95, 0.88, 0.8], 0));
      ctx.fillStyle = g;
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    }
    // The old promenade, under the sea: its railing and its lamps.
    const post = [0.05, 0.04, 0.035];
    for (const z of [1.8, 1.05]) {
      const water = H - 0.3 / z;
      const lw = Math.max(1.5, (f.h * 0.008) / z);
      if (z > 1.5) {
        ctx.fillStyle = css(post, 0.85);
        ctx.fillRect(0, Y(water + 0.02 / z), f.w, lw * 0.8);
        for (let x = -half - 0.2; x < half + 0.2; x += 0.12 / z) ctx.fillRect(X(x), Y(water + 0.02 / z), lw * 0.7, (0.02 / z) * f.h);
      }
      for (let i = -4; i <= 4; i++) {
        const x = (i * 0.75 + (z > 1.5 ? 0.37 : 0.1)) / z;
        if (Math.abs(x) > half + 0.1) continue;
        const lampTop = water + 0.28 / z;
        ctx.fillStyle = css(post);
        ctx.fillRect(X(x) - lw / 2, Y(lampTop), lw, Y(water) - Y(lampTop));
        ctx.fillRect(X(x) - lw / 2, Y(lampTop), (f.h * 0.05) / z, lw);
        const lx = X(x) + (f.h * 0.047) / z, ly = Y(lampTop) + lw * 2;
        const rad = (f.h * 0.08) / z;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
        g.addColorStop(0, 'rgba(255,225,170,0.95)');
        g.addColorStop(0.1, 'rgba(255,175,95,0.5)');
        g.addColorStop(1, 'rgba(255,140,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
        // The lamp's reflection, a broken column of light.
        for (let k = 0; k < 7; k++) {
          const wob = (p.noise(k * 3 + i * 7, t * 2 + z) - 0.5) * rad * 0.4;
          const ry = Y(water) + (k + 0.5) * rad * 0.25;
          ctx.fillStyle = `rgba(255,180,100,${0.4 * (1 - k / 7)})`;
          ctx.fillRect(lx - rad * 0.1 + wob, ry, rad * 0.2, rad * 0.08);
        }
        // The post's own reflection.
        ctx.fillStyle = css(post, 0.4);
        ctx.fillRect(X(x) - lw / 2, Y(water), lw, rad * 0.8);
      }
    }
    return;
  }

  // Worse: a drowned city seen from a drone, drifting slowly forward. Only the
  // rooftops stand above the water, in the grid of the streets.
  const H = 0.6;
  Object.assign(u, {
    uHorizon: H,
    uZenith: [0.14, 0.05, 0.05], uMid: [0.5, 0.16, 0.07], uLow: [0.9, 0.38, 0.12],
    // The sun where the dust storm's sun was, so the dissolve keeps one sun.
    uSun: [0.3 * half, H + 0.14 - t * 0.008, 0.055, 0.85], uSunCol: [1, 0.35, 0.08],
    uCloud: [t * 0.03, t * 0.12, 0.28, 0.3], uCloudLit: [0.9, 0.35, 0.12], uCloudDark: [0.25, 0.08, 0.05], uCloudAmt: 0.6,
    // No skyline on the horizon: its mirror image in the flood read as a glitch.
    // The drowned blocks recede into the haze instead.
    uWater: [0.7, 0.45, 0.35, 1], uWaves: 0.55,
    uHaze: [0.62, 0.25, 0.1, 0.22 + 0.14 * g],
  });
  paintSky(ctx, f, p, u);

  const hy = Y(H);
  const focal = f.h * 0.9;
  const camH = 3;
  const drift = t * 0.35;
  // SSP3-7.0: the roofs stand a little higher out of the water than in SSP5-8.5.
  const sink = t * 0.008 * (0.6 + 0.8 * g) + (g - 0.5) * 0.14;
  const pitch = 1.5, block = 1.05;
  const zNear = (camH * focal) / (f.h - hy);
  const sx = (x, z) => f.w / 2 + (x / z) * focal;
  const sy = (y, z) => hy + ((camH - y) / z) * focal;
  const fogCol = mixc(u.uLow, u.uHaze, 0.5);
  const firstRow = Math.floor(drift / pitch);
  // Far rows first, so nearer roofs cover them. Each row is drawn as a handful
  // of batched paths (its colors depend only on its distance), not per building.
  for (let row = firstRow + 22; row >= firstRow; row--) {
    const z0 = row * pitch - drift + zNear * 0.6;
    if (z0 < zNear * 0.6 || z0 > 36) continue;
    const fog = smooth(6, 34, z0);
    const roof = mixc(mixc([0.14, 0.06, 0.05], u.uMid, 0.18), fogCol, fog);
    const face = mixc([0.06, 0.025, 0.02], fogCol, fog * 0.9);
    const reach = ((half + 0.1) * f.h * (z0 + block)) / focal;
    const cols = Math.ceil(reach / pitch);
    const z1 = z0 + block;
    const refl = new Path2D(), faces = new Path2D(), windows = new Path2D(), roofs = new Path2D(), rims = new Path2D(), edges = new Path2D(), huts = new Path2D();
    const winH = Math.max(1, (0.05 * focal) / z0);
    for (let c = -cols; c <= cols; c++) {
      const id = row * 131 + c * 17;
      if (hash1(id) < 0.25) continue;
      const tall = hash1(id + 5) > 0.9;
      const top = (tall ? 0.9 + hash1(id + 6) * 1.6 : 0.08 + hash1(id + 7) * 0.3) - sink;
      if (top <= 0.02) continue;
      const x0 = c * pitch - block / 2, x1 = x0 + block;
      const a = sx(x0, z0), b = sx(x1, z0);
      // Reflection, the wall facing the camera, then the roof.
      refl.rect(a, sy(0, z0), b - a, sy(-top * 0.7, z0) - sy(0, z0));
      faces.rect(a, sy(top, z0), b - a, sy(0, z0) - sy(top, z0));
      if (tall && z0 < 16) {
        // Rows of dark windows on the taller buildings.
        for (let k = 1; k < top / 0.22; k++) windows.rect(a + (b - a) * 0.08, sy(top - k * 0.22, z0), (b - a) * 0.84, winH);
      }
      roofs.moveTo(a, sy(top, z0));
      roofs.lineTo(b, sy(top, z0));
      roofs.lineTo(sx(x1, z1), sy(top, z1));
      roofs.lineTo(sx(x0, z1), sy(top, z1));
      roofs.closePath();
      // Parapet, and the far edge catching the sun.
      rims.moveTo(sx(x0, z1), sy(top, z1));
      rims.lineTo(a, sy(top, z0));
      rims.lineTo(b, sy(top, z0));
      rims.lineTo(sx(x1, z1), sy(top, z1));
      edges.moveTo(sx(x0, z1), sy(top, z1));
      edges.lineTo(sx(x1, z1), sy(top, z1));
      // A water tank or a roof hut on some roofs.
      if (hash1(id + 9) > 0.6 && z0 < 18) {
        const cx = (x0 + x1) / 2 + (hash1(id + 3) - 0.5) * 0.5, cz = z0 + 0.3 + hash1(id + 4) * 0.4;
        const tw = ((0.12 + 0.15 * hash1(id + 2)) * focal) / cz;
        const th = 0.12 + 0.15 * hash1(id + 1);
        huts.rect(sx(cx, cz) - tw / 2, sy(top + th, cz), tw, sy(top, cz) - sy(top + th, cz));
      }
    }
    ctx.fillStyle = css(face, 0.4);
    ctx.fill(refl);
    ctx.fillStyle = css(face);
    ctx.fill(faces);
    ctx.fillStyle = css(roof, 0.35);
    ctx.fill(windows);
    ctx.fillStyle = css(roof);
    ctx.fill(roofs);
    ctx.strokeStyle = css(face);
    ctx.lineWidth = Math.max(1, (0.04 * focal) / z0);
    ctx.stroke(rims);
    ctx.fillStyle = css(face);
    ctx.fill(huts);
    ctx.strokeStyle = css(u.uSunCol, 0.45 * (1 - fog));
    ctx.lineWidth = Math.max(1, (0.025 * focal) / z1);
    ctx.stroke(edges);
  }
}
// ---------------------------------------------------------------------------
// EPILOGUE. An empty land at dusk, the first stars coming out. Dark and still
// under the definition card.

const epilogue = {
  id: 'epilogue',
  init,
  render(ctx, f, p) {
    // The coda holds the epilogue's last light: its loop would restart it.
    if (f.section === 'coda') f = { ...f, progress: 1, t: f.t + 32 };
    const P = f.params || {};
    const { outcome, within: g } = scenario(P);
    const { half } = frameOf(f);
    const H = 0.27;
    const skies = {
      better: { zen: [0.006, 0.01, 0.035], mid: [0.025, 0.04, 0.11], low: [0.12, 0.13, 0.25], sun: [0.5, 0.45, 0.6], haze: [0.1, 0.1, 0.2, 0.05] },
      middle: { zen: [0.012, 0.012, 0.035], mid: [0.055, 0.04, 0.075], low: [0.22, 0.12, 0.1], sun: [0.8, 0.45, 0.3], haze: [0.2, 0.1, 0.08, 0.08] },
      worse: { zen: [0.03, 0.01, 0.01], mid: [0.09, 0.028, 0.02], low: [0.28, 0.07, 0.035], sun: [0.8, 0.25, 0.1], haze: [0.25, 0.06, 0.03, 0.22] },
    };
    const s = skies[outcome];
    // Within a group, the harsher scenario hangs a little more haze in the dusk.
    const haze = [...s.haze.slice(0, 3), s.haze[3] + (outcome === 'middle' ? 0 : 0.08 * g)];
    const u = skyDefaults();
    Object.assign(u, {
      uT: f.t, uHorizon: H,
      uZenith: s.zen, uMid: s.mid, uLow: s.low,
      uSun: [-0.3 * half, H - 0.06 - f.progress * 0.03, 0, 0.35], uSunCol: s.sun,
      uCloud: [f.t * 0.004, f.t * 0.01, 0.3, 0], uCloudLit: s.low.map((v) => v * 1.3), uCloudDark: s.zen, uCloudAmt: 0.5,
      uStars: smooth(0.05, 0.7, f.progress) * (outcome === 'worse' ? 0.45 - 0.2 * g : 0.9 - 0.15 * g),
      uRidge: [1, 0.09, 6.3, 0.5], uRidgeCol: [0.012, 0.01, 0.014],
      uHaze: haze, uGround: [0.012, 0.01, 0.012],
    });
    paintSky(ctx, f, p, u);

    // Nearer mesas: flat tops, steep sides, black against the last light.
    const { X, Y } = frameOf(f);
    ctx.fillStyle = css([0.008, 0.007, 0.01]);
    ctx.beginPath();
    ctx.moveTo(0, f.h);
    for (let x = -half - 0.02; x <= half + 0.03; x += 0.01) {
      const n = p.noise(x * 2.8 + 2.5, 7);
      const plateau = smooth(0.6, 0.64, n);
      const y = H - 0.015 + 0.1 * plateau + 0.004 * p.noise(x * 25, 1) + 0.02 * smooth(0.45, 0.6, n);
      ctx.lineTo(X(x), Y(y));
    }
    ctx.lineTo(f.w, f.h);
    ctx.fill();

    // The evening star, first to appear.
    const star = smooth(0.05, 0.3, f.progress) * (outcome === 'worse' ? 0.35 : 0.8);
    if (star > 0) {
      const sx = X(0.22 * half), sy = Y(H + 0.3);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.h * 0.012);
      g.addColorStop(0, `rgba(255,248,230,${star})`);
      g.addColorStop(0.25, `rgba(255,240,215,${star * 0.35})`);
      g.addColorStop(1, 'rgba(255,240,215,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - f.h * 0.012, sy - f.h * 0.012, f.h * 0.024, f.h * 0.024);
    }
  },
};

// ---------------------------------------------------------------------------
// CREDITS. Near black: a faint field of stars turning slowly around the center,
// a few embers rising. Fades to black over the last two bars.

const credits = {
  id: 'credits',
  init,
  render(ctx, f, p) {
    const u = skyDefaults();
    Object.assign(u, {
      uHorizon: 0,
      uZenith: [0.006, 0.006, 0.012], uMid: [0.01, 0.009, 0.014], uLow: [0.03, 0.018, 0.015],
      uTrails: [0, 0.5, 0, 0.35], uRot: f.t * (f.reduced ? 0.004 : 0.012),
    });
    paintSky(ctx, f, p, u);
    const { X, Y, half } = frameOf(f);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const a = (f.t * (0.025 + 0.02 * hash1(i)) + hash1(i + 40)) % 1;
      const x = -half + hash1(i + 80) * 2 * half + 0.05 * Math.sin(f.t * 0.3 + i);
      const y = a * 1.1 - 0.05;
      const glow = Math.sin(a * Math.PI) * (0.25 + 0.3 * hash1(i + 7));
      const rad = f.h * 0.012;
      const g = ctx.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad);
      g.addColorStop(0, `rgba(255,150,70,${glow})`);
      g.addColorStop(0.2, `rgba(220,90,30,${glow * 0.4})`);
      g.addColorStop(1, 'rgba(200,60,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(X(x) - rad, Y(y) - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    const out = smooth(0.87, 1, f.progress);
    if (out > 0) {
      ctx.fillStyle = `rgba(0,0,0,${out})`;
      ctx.fillRect(0, 0, f.w, f.h);
    }
  },
};

export default [now, future, epilogue, credits];
