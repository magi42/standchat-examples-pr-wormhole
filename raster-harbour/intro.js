// The hero's invitation intro: a checkerboard floor rushing towards you, copper
// bars rolling in the sky and a glenz vector bouncing on the floor in time with
// the music. It is made of the same effects as the chat, in its own canvas
// behind the hero's words, and only runs while you can see it.
//
// The glenz notices you. It turns towards the pointer, spins when you scroll
// and takes a knock when you bat it. Click it, or keep batting it, and it dives
// into the scroller at the bottom of the page, which opens the chat.

import { PixelFont } from './font.js';
import { Gfx, PALETTE_INDEX as P } from './gl.js';
import { Parallax, Glenz, copperBar } from './effects.js';
import { music } from './music.js';

const FLOOR = `#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uPx;
uniform float uHorizon;
uniform float uShift;
uniform float uScanlines;
out vec4 outColor;
void main() {
  // Virtual pixels from the top left: the effect is as chunky as the chat.
  vec2 p = floor(vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) / uPx) + 0.5;
  float horizon = floor(uHorizon / uPx);
  float w = uView.x / uPx;
  vec3 col;
  if (p.y < horizon) {
    float t = p.y / horizon;
    col = mix(vec3(0.027, 0.027, 0.09), vec3(0.1, 0.05, 0.19), t * t);
    col += vec3(0.62, 0.24, 0.12) * exp(-(horizon - p.y) * 0.075) * 0.7;
  } else {
    // The floor: depth from how far below the horizon a row is.
    float dy = p.y - horizon;
    float f = w * 0.55;
    float z = f / dy;
    float x = (p.x - w * 0.5) / dy;
    float checker = mod(floor(x * 2.2) + floor(z * 0.55 + uShift), 2.0);
    col = mix(vec3(0.05, 0.05, 0.15), vec3(0.5, 0.2, 0.09), checker);
    // A line of light where each row of tiles begins.
    col += vec3(0.3, 0.14, 0.06) * step(fract(z * 0.55 + uShift), 0.06 * (1.0 - exp(-dy * 0.04)));
    col = mix(col, vec3(0.42, 0.18, 0.2), 1.0 - exp(-z * 0.012));
    col = mix(col, vec3(1.0, 0.72, 0.42), exp(-dy * 0.9) * 0.8);
  }
  float scan = mod(uView.y - gl_FragCoord.y, uPx) > uPx - 1.0 ? 1.0 - uScanlines : 1.0;
  outColor = vec4(col * scan, 1.0);
}`;

const BAR = (60 / 125) * 4; // a bar of the tune: one bounce
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const bounceOut = (x) => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};

const canvas = document.querySelector('.rh-intro');
const hero = canvas?.closest('[data-scroller-hero]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function start() {
  let gfx;
  try {
    gfx = new Gfx(canvas, new PixelFont());
  } catch {
    return; // No WebGL 2: the hero keeps its plain background.
  }
  const floor = gfx.effect(FLOOR);
  const sky = new Parallax(110, 21);
  const glenz = new Glenz();
  glenz.a = 0.6;
  const bars = [P.bar, P.barViolet, P.barBlue, P.bar, P.barGreen];
  let visible = true;
  let running = false;
  let last = performance.now() / 1000;
  const t0 = last;
  let shift = 0; // how far the floor has moved

  // The glenz: device pixels, relative to where it would be.
  const g = {
    phase: 0, // through its bounce, 0–1, landing at 0
    x: 0, y: 0, vx: 0, vy: 0, // knocked off its path, sprung back
    spin: 0, // extra spin from knocks and scrolling, fading
    yaw: 0, pitch: 0, // leaning towards the pointer
    near: 0, // 0–1, how close the pointer is
    away: false, // dived into the chat
    back: -1, // when it drops back in after the chat closes
    knocks: [],
    drawn: null, // { x, y, r } where it was drawn, for hits
  };
  const pointer = { x: -1, y: -1, vx: 0, vy: 0, t: 0, over: false };
  let scrollV = 0;
  let lastScroll = { y: scrollY, t: performance.now() };

  const dpr = () => Math.min(3, devicePixelRatio || 1);
  const resize = () => {
    const rect = hero.getBoundingClientRect();
    const px = Math.max(1, Math.round((innerWidth >= 900 ? 2 : 1.6) * dpr()));
    gfx.resize(rect.width * dpr(), rect.height * dpr(), px);
    if (!running) draw(performance.now() / 1000);
  };

  // -- You ------------------------------------------------------------------------

  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * dpr(), (event.clientY - rect.top) * dpr()];
  };
  const over = (x, y) => Boolean(g.drawn && !g.away && Math.hypot(x - g.drawn.x, y - g.drawn.y) < g.drawn.r * 0.8);
  // A fast swipe can jump right over it between two events: check the path.
  const crossed = (x0, y0, x1, y1) => {
    if (!g.drawn || g.away || x0 < 0) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const k = clamp(((g.drawn.x - x0) * dx + (g.drawn.y - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x0 + dx * k - g.drawn.x, y0 + dy * k - g.drawn.y) < g.drawn.r * 0.8;
  };

  hero.addEventListener('pointermove', (event) => {
    const [x, y] = local(event);
    const t = performance.now() / 1000;
    const dt = Math.max(0.008, t - pointer.t);
    if (pointer.x >= 0) {
      pointer.vx = pointer.vx * 0.5 + ((x - pointer.x) / dt) * 0.5;
      pointer.vy = pointer.vy * 0.5 + ((y - pointer.y) / dt) * 0.5;
    }
    const through = crossed(pointer.x, pointer.y, x, y);
    Object.assign(pointer, { x, y, t });
    const hit = over(x, y);
    if (through && !pointer.over) knock(t);
    pointer.over = hit;
    hero.style.cursor = hit ? 'pointer' : '';
  });
  hero.addEventListener('pointerleave', () => {
    Object.assign(pointer, { x: -1, y: -1, over: false });
    hero.style.cursor = '';
  });
  // A click on it is as clear as it gets.
  hero.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a, button, input, textarea, select, summary')) return;
    if (!getSelection()?.isCollapsed) return; // selecting text, not clicking the glenz
    const [x, y] = local(event);
    if (over(x, y)) dive();
  });

  // Batted: pushed the way the pointer went, spun by how fast. Three knocks in
  // three seconds and it takes the hint.
  function knock(t) {
    const speed = Math.hypot(pointer.vx, pointer.vy) / dpr(); // CSS pixels a second
    if (speed < 260 || reducedMotion.matches) return;
    const k = Math.min(1, speed / 1500);
    g.vx += pointer.vx * 0.3 * k;
    g.vy += pointer.vy * 0.3 * k;
    g.spin += 2 + 6 * k;
    g.knocks = g.knocks.filter((when) => t - when < 3);
    g.knocks.push(t);
    if (g.knocks.length >= 3) dive();
  }

  addEventListener('scroll', () => {
    const now = performance.now();
    const dt = Math.max(8, now - lastScroll.t) / 1000;
    scrollV = scrollV * 0.6 + ((scrollY - lastScroll.y) / dt) * 0.4;
    lastScroll = { y: scrollY, t: now };
  }, { passive: true });

  // Off it goes, into the scroller: the chat does the rest.
  function dive() {
    if (g.away || !g.drawn) return;
    const rect = canvas.getBoundingClientRect();
    const d = dpr();
    const { x, y, r } = g.drawn;
    g.away = true;
    g.knocks = [];
    hero.style.cursor = '';
    dispatchEvent(new CustomEvent('scroller-chat:open', {
      detail: { glenz: { x: rect.left + x / d, y: rect.top + y / d, r: r / d, a: glenz.a + g.yaw, b: glenz.b + g.pitch, c: glenz.c } },
    }));
  }
  // When the chat closes, the glenz drops back in from above.
  addEventListener('scroller-chat:closed', () => {
    if (!g.away) return;
    g.away = false;
    g.back = performance.now() / 1000 + 0.35;
  });

  // -- Drawing ----------------------------------------------------------------------

  function draw(now) {
    const dt = Math.min(0.05, Math.max(0, now - last));
    last = now;
    const still = reducedMotion.matches;
    const t = still ? 4 : now - t0;
    const W = gfx.width;
    const H = gfx.height;
    const px = gfx.px;
    const phone = W / dpr() < 640;
    const horizon = Math.round(H * (phone ? 0.7 : 0.64));
    const beat = still ? 0 : music.level();
    scrollV *= Math.exp(-dt * 5);
    // Scrolling speeds up the flight over the floor.
    if (!still) shift += dt * (1.6 + Math.min(5, Math.abs(scrollV) / 350));
    gfx.begin(t);
    gfx.drawEffect(floor, { x: 0, y: 0, w: W, h: H }, { uHorizon: horizon, uShift: shift, uScanlines: gfx.scanlines });
    sky.update(dt, still ? 0 : 7);
    sky.draw(gfx, { x: 0, y: 0, w: W, h: horizon - 6 * px }, 0.9);

    // Copper bars rolling around an invisible drum, the far ones behind,
    // flaring with the drums.
    const drum = bars.map((palette, i) => {
      const a = t * 1.1 + i * 0.62;
      return { palette, y: H * (phone ? 0.2 : 0.3) + Math.sin(a) * H * (phone ? 0.12 : 0.17), z: Math.cos(a) };
    }).sort((p, q) => p.z - q.z);
    for (const bar of drum) {
      const h = Math.round(11 + bar.z * 3) * px;
      copperBar(gfx, 0, Math.round(bar.y / px) * px, W, h, bar.palette, Math.min(1, 0.55 + 0.4 * (bar.z * 0.5 + 0.5) + beat * 0.3));
    }
    gfx.flush();

    // On a phone the words fill the hero, so the glenz stays out of their way.
    g.drawn = null;
    if (!phone && !g.away && now >= g.back) {
      const radius = Math.min(W * 0.1, H * 0.19);
      const restX = W * 0.74;
      const ground = horizon + (H - horizon) * 0.42;
      const pointing = pointer.x >= 0 && !still;

      // One bounce a bar, landing on the first beat when the music plays.
      g.phase += dt / BAR;
      const onBeat = music.bar();
      if (onBeat !== null) g.phase += ((((onBeat - g.phase) % 1) + 1.5) % 1 - 0.5) * Math.min(1, dt * 2.5);
      g.phase = ((g.phase % 1) + 1) % 1;

      // Knocked off course, and sprung back.
      g.vx += (-g.x * 38 - g.vx * 5) * dt;
      g.vy += (-g.y * 38 - g.vy * 5) * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.spin *= Math.exp(-dt * 1.6);

      // Close to the pointer it gets excited; it always keeps an eye on it.
      const cx0 = restX + g.x;
      const d = pointing ? Math.hypot(pointer.x - cx0, pointer.y - (ground - radius)) / radius : 99;
      g.near += (clamp(1.7 - d * 0.55, 0, 1) - g.near) * Math.min(1, dt * 5);
      const yaw = pointing ? clamp(((pointer.x - cx0) / W) * 2.4, -0.7, 0.7) : 0;
      const pitch = (pointing ? clamp(((pointer.y - ground) / H) * 1.6, -0.45, 0.45) : 0) + clamp(scrollV / 2600, -0.4, 0.4);
      g.yaw += (yaw - g.yaw) * Math.min(1, dt * 4);
      g.pitch += (pitch - g.pitch) * Math.min(1, dt * 4);

      const hop = still ? 0.5 : Math.sin(Math.PI * g.phase);
      const bounce = hop * H * 0.2 * (1 + 0.25 * g.near);
      const cx = restX + g.x + (pointing ? clamp((pointer.x - restX) / W, -0.5, 0.5) * W * 0.03 : 0);
      let cy = ground - radius * 0.9 - bounce + g.y;
      // Back from the chat: a drop from above the hero, bouncing to a stop.
      const since = now - g.back;
      if (g.back > 0 && since < 0.9 && !still) cy = -radius * 2 + (cy + radius * 2) * bounceOut(since / 0.9);
      const r = radius * (1 + 0.06 * g.near);

      // The shadow on the floor, smaller the higher it is.
      const lift = clamp((ground - radius * 0.9 - cy) / (H * 0.25), 0, 1);
      const sw = radius * (1.25 - lift * 0.45);
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        gfx.triangle(cx, ground, cx + Math.cos(a0) * sw, ground + Math.sin(a0) * sw * 0.18, cx + Math.cos(a1) * sw, ground + Math.sin(a1) * sw * 0.18, [0, 0, 0.02, 0.55 - lift * 0.3]);
      }
      glenz.update(dt, still ? 0 : 1.2 + g.near * 1.8 + g.spin + Math.min(3, Math.abs(scrollV) / 600));
      glenz.draw(gfx, cx, cy, r, 1, { a: g.yaw, b: g.pitch });
      g.drawn = { x: cx, y: cy, r };
    }
    gfx.flushPolygons({ x: 0, y: 0, w: W, h: H });
  }

  function loop() {
    if (!visible || reducedMotion.matches) {
      running = false;
      return;
    }
    running = true;
    draw(performance.now() / 1000);
    requestAnimationFrame(loop);
  }

  new ResizeObserver(resize).observe(hero);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !running) {
      last = performance.now() / 1000;
      loop();
    }
  }).observe(hero);
  reducedMotion.addEventListener('change', () => (reducedMotion.matches ? draw(performance.now() / 1000) : loop()));
  resize();
  loop();
}

if (canvas && hero) start();
