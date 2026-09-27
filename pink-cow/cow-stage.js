// The cow's stage: a transparent full-viewport canvas with an invisible floor
// along the bottom of the screen. The page stays interactive underneath; the
// only interactive parts are the HTML elements laid over the cow. This module
// also holds the paper chat card that unfolds out of the cow, and the layout
// that decides where the HTML chat card lands.

import * as THREE from 'three';

import { BODY_PIVOT_Y, buildCow, COW_LENGTH, PALETTE, spotIconPolygons, VIEW_SIDE } from './cow-model.js';
import { CowMotion, GALLOP_SPEED, WALK_SPEED } from './cow-motion.js';

// ---------------------------------------------------------------------------
// Layout shared by the HTML chat card and the stage

/** Below this viewport width the card rests on the cow instead of inside it. */
export const COMPACT_WIDTH = 640;
/** Height above the floor where the card's bottom edge meets the cow. */
const CARD_BASE_WIDE = 0.72;
const CARD_BASE_COMPACT = 1.02;
/** Corner radius and header height of the chat card, in CSS pixels. cow-chat.css matches. */
export const CARD_RADIUS = 18;
export const CARD_HEADER = 76;
const CARD_MAX_WIDTH = 410;
const CARD_MAX_HEIGHT = 600;
const CARD_MIN_HEIGHT = 320;
const COMPACT_MAX_HEIGHT = 560;

const clamp = THREE.MathUtils.clamp;

/**
 * Where the chat card sits, and how the cow is framed around it. On wide
 * screens the card is set into the cow's body, with the head, legs and tail
 * showing around it. On narrow screens it rests on the cow's back.
 */
export function chatComposition(width, height) {
  if (width < COMPACT_WIDTH) {
    const cowPixels = clamp(width * 0.62, 200, 360);
    const groundPixels = 14;
    const bottom = height - groundPixels - (CARD_BASE_COMPACT / COW_LENGTH) * cowPixels;
    const top = Math.max(12, bottom - COMPACT_MAX_HEIGHT);
    return { rect: { left: 12, top, width: width - 24, height: bottom - top }, cowPixels, groundPixels };
  }
  const cardWidth = Math.min(CARD_MAX_WIDTH, width - 48);
  const cowPixels = cardWidth * 1.62;
  const below = (CARD_BASE_WIDE / COW_LENGTH) * cowPixels;
  const margin = 18;
  const cardHeight = clamp(height - below - margin * 2, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT);
  const top = Math.max(margin, (height - cardHeight - below) / 2);
  const groundPixels = height - top - cardHeight - below;
  return {
    rect: { left: (width - cardWidth) / 2, top, width: cardWidth, height: cardHeight },
    cowPixels,
    groundPixels,
  };
}

// ---------------------------------------------------------------------------
// The paper card, folded like an accordion. Its origin is the middle of the
// top edge; strips hang below it on hinges. Unfolded and facing the camera it
// matches the HTML chat card, so the two can cross-fade.

const CARD_STRIPS = 3;

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawSpotIcon(context, x, y, size) {
  const { blob, glyph } = spotIconPolygons(x, y, size);
  const fill = (points, color) => {
    context.beginPath();
    points.forEach(([px, py], index) => (index === 0 ? context.moveTo(px, py) : context.lineTo(px, py)));
    context.closePath();
    context.fillStyle = color;
    context.fill();
  };
  fill(blob, PALETTE.spot);
  for (const points of glyph) fill(points, PALETTE.glyph);
}

function wrap(context, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draw the chat card as the HTML card first renders it, so the unfolding
 * paper card and the live card can cross-fade without a visible jump. The
 * metrics mirror cow-chat.css. `scale` is the texture's pixels per CSS pixel.
 * `face` is { title, subtitle, greeting, suggestions, placeholder, footer, host }.
 */
function drawCardFace(width, height, scale, face) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.scale(scale, scale);
  context.textBaseline = 'alphabetic';
  roundedRect(context, 0, 0, width, height, CARD_RADIUS);
  context.fillStyle = '#ffffff';
  context.fill();
  context.save();
  roundedRect(context, 0, 0, width, height, CARD_RADIUS);
  context.clip();

  // Header.
  context.fillStyle = '#fff1f6';
  context.fillRect(0, 0, width, CARD_HEADER);
  context.fillStyle = '#f9d2e0';
  context.fillRect(0, CARD_HEADER - 1, width, 1);
  drawSpotIcon(context, 18, 17, 48);
  context.fillStyle = '#212121';
  context.font = '700 18px "PT Sans Caption", "PT Sans", sans-serif';
  context.fillText(face.title, 78, 36);
  context.fillStyle = '#676767';
  context.font = '400 13px "PT Sans", sans-serif';
  context.fillText(face.subtitle, 78, 57);
  context.fillStyle = 'rgba(255, 255, 255, 0.6)';
  context.beginPath();
  context.arc(width - 34, 38, 15, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#e7b3c6';
  context.lineWidth = 1.5;
  context.stroke();
  context.strokeStyle = '#8f2350';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(width - 38, 34);
  context.lineTo(width - 30, 42);
  context.moveTo(width - 30, 34);
  context.lineTo(width - 38, 42);
  context.stroke();

  // Responder row.
  const rowTop = CARD_HEADER;
  context.fillStyle = '#fbe3ec';
  context.fillRect(0, rowTop + 35, width, 1);
  context.fillStyle = '#f9d2e0';
  context.beginPath();
  context.arc(28, rowTop + 18, 10, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#212121';
  context.font = '700 12px "PT Sans", sans-serif';
  context.fillText(face.host || '', 46, rowTop + 22);

  // Greeting bubble with the real text.
  const bubbleTop = rowTop + 36 + 16;
  const bubbleMax = (width - 36) * 0.88;
  context.font = '400 14px "PT Sans", sans-serif';
  const paragraphs = face.greeting.split(/\n{2,}/).map((paragraph) => wrap(context, paragraph, bubbleMax - 28));
  const textWidth = Math.max(...paragraphs.flat().map((line) => context.measureText(line).width));
  const lineCount = paragraphs.reduce((sum, lines) => sum + lines.length, 0);
  const bubbleHeight = lineCount * 24 + (paragraphs.length - 1) * 8 + 20;
  roundedRect(context, 18, bubbleTop, Math.min(bubbleMax, textWidth + 28), bubbleHeight, 16);
  context.fillStyle = '#fff1f6';
  context.fill();
  context.fillStyle = '#212121';
  let y = bubbleTop + 10;
  paragraphs.forEach((lines, index) => {
    if (index > 0) y += 8;
    for (const line of lines) {
      context.fillText(line, 32, y + 17);
      y += 24;
    }
  });

  // Suggestion chips.
  context.font = '700 13px "PT Sans", sans-serif';
  let chipX = 18;
  let chipY = bubbleTop + bubbleHeight + 16;
  for (const suggestion of face.suggestions) {
    const chipWidth = context.measureText(suggestion).width + 26;
    if (chipX > 18 && chipX + chipWidth > width - 18) {
      chipX = 18;
      chipY += 40;
    }
    roundedRect(context, chipX, chipY, chipWidth, 32, 16);
    context.fillStyle = '#ffffff';
    context.fill();
    context.strokeStyle = '#f0b3c9';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#b3275d';
    context.fillText(suggestion, chipX + 13, chipY + 21);
    chipX += chipWidth + 8;
  }

  // Composer and footer.
  const composerTop = height - 81;
  roundedRect(context, 16, composerTop, width - 32, 49, 14);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = '#f2c4d5';
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = '#a3a3a3';
  context.font = '400 14px "PT Sans", sans-serif';
  context.fillText(face.placeholder, 30, composerTop + 30);
  roundedRect(context, width - 16 - 7 - 34, composerTop + 7.5, 34, 34, 10);
  context.fillStyle = '#f2c4d5';
  context.fill();
  context.fillStyle = '#676767';
  context.font = '400 11px "PT Sans", sans-serif';
  context.fillText(face.footer, 20, height - 13);
  context.restore();
  return canvas;
}

/** The card's reverse: the inside of the cow, in soft pink facets. */
function drawCardBack(width, height, radius) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  roundedRect(context, 0, 0, width, height, radius);
  context.clip();
  context.fillStyle = PALETTE.inner;
  context.fillRect(0, 0, width, height);
  const step = Math.max(24, Math.round(width / 6));
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      for (const triangle of [
        [[x, y], [x + step, y], [x, y + step]],
        [[x + step, y], [x + step, y + step], [x, y + step]],
      ]) {
        context.fillStyle = `hsl(340, 100%, ${88 + next() * 5}%)`;
        context.beginPath();
        triangle.forEach(([px, py], index) => (index === 0 ? context.moveTo(px, py) : context.lineTo(px, py)));
        context.closePath();
        context.fill();
      }
    }
  }
  return canvas;
}

function buildFoldingCard(face, scale) {
  const group = new THREE.Group();
  const frontTexture = new THREE.CanvasTexture(face);
  frontTexture.colorSpace = THREE.SRGBColorSpace;
  frontTexture.anisotropy = 4;
  const back = new THREE.CanvasTexture(drawCardBack(face.width, face.height, CARD_RADIUS * scale));
  back.colorSpace = THREE.SRGBColorSpace;
  const geometries = [];
  const materials = [];
  const strips = [];
  const hinges = [];

  let parent = group;
  for (let index = 0; index < CARD_STRIPS; index += 1) {
    if (index > 0) {
      const hinge = new THREE.Group();
      parent.add(hinge);
      hinges.push(hinge);
      parent = hinge;
    }
    const frontGeometry = new THREE.PlaneGeometry(1, 1);
    frontGeometry.translate(0, -0.5, 0);
    const uv = frontGeometry.getAttribute('uv');
    const top = 1 - index / CARD_STRIPS;
    const bottom = 1 - (index + 1) / CARD_STRIPS;
    for (let i = 0; i < uv.count; i += 1) uv.setY(i, uv.getY(i) > 0.5 ? top : bottom);
    const backGeometry = frontGeometry.clone();
    backGeometry.rotateY(Math.PI);
    geometries.push(frontGeometry, backGeometry);
    const frontMaterial = new THREE.MeshBasicMaterial({ map: frontTexture, alphaTest: 0.5 });
    const backMaterial = new THREE.MeshBasicMaterial({ map: back, alphaTest: 0.5 });
    materials.push(frontMaterial, backMaterial);
    const front = new THREE.Mesh(frontGeometry, frontMaterial);
    const backMesh = new THREE.Mesh(backGeometry, backMaterial);
    front.renderOrder = 2;
    backMesh.renderOrder = 2;
    parent.add(front, backMesh);
    strips.push({ front, back: backMesh });
  }
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  return {
    group,
    /** 0 = flat, 1 = folded shut, per hinge (top to bottom). */
    setFold(amounts) {
      hinges.forEach((hinge, index) => {
        // Alternate directions for a zig-zag fold; tiny offsets stop the
        // stacked strips from z-fighting. Slightly negative is a springy
        // overshoot past flat.
        const amount = clamp(amounts[index] ?? 0, -0.2, 1.2);
        const direction = index % 2 === 0 ? 1 : -1;
        hinge.rotation.x = direction * amount * (Math.PI - 0.035 * (index + 1));
      });
    },
    /** World size of the unfolded card. */
    setSize(width, height) {
      const stripHeight = height / CARD_STRIPS;
      for (const { front, back: backMesh } of strips) {
        front.scale.set(width, stripHeight, 1);
        backMesh.scale.set(width, stripHeight, 1);
      }
      for (const hinge of hinges) hinge.position.y = -stripHeight;
    },
    /** Darken strips as they turn away from the viewer. Measured against the
     *  view axis, so a card facing the camera is lit exactly white. */
    shade(camera) {
      camera.getWorldDirection(forward);
      strips.forEach(({ front, back: backMesh }, index) => {
        front.getWorldQuaternion(quaternion);
        normal.set(0, 0, 1).applyQuaternion(quaternion);
        const facing = Math.min(1, Math.abs(normal.dot(forward)));
        const light = 0.66 + 0.34 * facing;
        front.material.color.setScalar(light);
        backMesh.material.color.setScalar(light * (index % 2 === 0 ? 1 : 0.96));
      });
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      frontTexture.dispose();
      back.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// The stage

const FOV = 22;
const TILT = THREE.MathUtils.degToRad(7);
const NOSE_OFFSET = 1.65;
const RUMP_OFFSET = 1.2;
const HATCH_OPEN = 2.0;

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;
export const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const window01 = (t, start, end) => clamp((t - start) / (end - start), 0, 1);

function lerpFraming(from, to, t) {
  return {
    centerX: THREE.MathUtils.lerp(from.centerX, to.centerX, t),
    // Zoom on a log scale so the dolly feels even.
    cowPixels: Math.exp(THREE.MathUtils.lerp(Math.log(from.cowPixels), Math.log(to.cowPixels), t)),
    groundPixels: THREE.MathUtils.lerp(from.groundPixels, to.groundPixels, t),
  };
}

function contactTexture() {
  const size = 128;
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const context = element.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(74, 31, 51, 0.55)');
  gradient.addColorStop(0.55, 'rgba(74, 31, 51, 0.2)');
  gradient.addColorStop(1, 'rgba(74, 31, 51, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class CowStage {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  /** Where the walk began, in world x. The cow walks toward -x. */
  startX = 0;
  width = 1;
  height = 1;
  /** { centerX: world x at the viewport centre, cowPixels: the cow's on-screen length, groundPixels: floor height from the bottom }. */
  framing = { centerX: 0, cowPixels: 300, groundPixels: 24 };
  /** Called when the walking cow starts or stops paying attention to the visitor. */
  onAttention = null;

  #key;
  #ground;
  #contact;
  #lastFrame = null;
  /** Minimum time between rendered frames; the idle cow needs fewer. */
  #frameInterval = 0;
  #tweens = new Set();
  #frameListeners = new Set();
  #running = false;
  #disposed = false;
  #mode = 'idle'; // idle | walk | chat | leaving
  #holds = new Set();
  #pointer = null;
  #gazeAtViewer = false;
  #attentive = false;
  #hurried = false;
  #card = null;
  #chatFraming = null;
  #exitFraming = null;
  #puffs = [];
  #puffGeometry = new THREE.IcosahedronGeometry(1, 0);
  #puffMaterial = new THREE.MeshLambertMaterial({ color: '#fbeef3', emissive: '#6b4a57', transparent: true, depthWrite: false, flatShading: true });
  #box = new THREE.Box3();
  #corner = new THREE.Vector3();
  #probe = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);

  /** @param {{ canvas: HTMLCanvasElement, random?: () => number }} options */
  constructor(options) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.add(new THREE.HemisphereLight('#fff7fa', '#e8b7c8', 1.5));
    this.#key = new THREE.DirectionalLight('#ffffff', 2.1);
    this.#key.castShadow = true;
    this.#key.shadow.mapSize.set(1024, 1024);
    this.#key.shadow.bias = -0.0006;
    this.#key.shadow.normalBias = 0.02;
    const shadowCamera = this.#key.shadow.camera;
    shadowCamera.left = -2.8;
    shadowCamera.right = 2.8;
    shadowCamera.top = 2.8;
    shadowCamera.bottom = -2.8;
    shadowCamera.near = 0.5;
    shadowCamera.far = 20;
    this.scene.add(this.#key, this.#key.target);
    const rim = new THREE.DirectionalLight('#ffe2ee', 0.9);
    rim.position.set(4, 3, -6);
    this.scene.add(rim);

    this.#ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShadowMaterial({ color: '#4a1f33', opacity: 0.14 }));
    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.receiveShadow = true;
    this.scene.add(this.#ground);

    this.#contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, opacity: 0.42 }),
    );
    this.#contact.rotation.x = -Math.PI / 2;
    this.#contact.position.y = 0.002;
    this.#contact.scale.set(2.9, 1.1, 1);
    this.scene.add(this.#contact);

    this.cow = buildCow();
    this.cow.root.rotation.y = Math.PI;
    this.scene.add(this.cow.root);
    this.motion = new CowMotion(this.cow, options.random);
    this.motion.onTouchdown = (_, x) => {
      if (this.motion.gait === 'gallop' && this.motion.speed > 2) this.#spawnPuffs(x);
    };
    this.resize();
  }

  // Layout -------------------------------------------------------------------

  resize() {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    // Large screens fill a lot of pixels for one small cow; 1.5x stays crisp.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.width * this.height > 2_000_000 ? 1.5 : 2));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.#probe.aspect = this.camera.aspect;
    if (this.#mode === 'chat' && this.#chatFraming) {
      this.#chatFraming = this.#framingForChat(this.#chatFraming.centerX);
      this.applyFraming(this.#chatFraming);
    } else {
      this.applyFraming(this.walkFraming(this.framing.centerX));
    }
  }

  /** Framing used while the cow walks along the bottom of the page. */
  walkFraming(centerX = 0) {
    return {
      centerX,
      cowPixels: clamp(this.width * 0.26, 180, 370),
      groundPixels: clamp(this.height * 0.03, 12, 32),
    };
  }

  #framingForChat(centerX) {
    const { cowPixels, groundPixels } = chatComposition(this.width, this.height);
    return { centerX, cowPixels, groundPixels };
  }

  /** Distance from the camera to the cow's walking line. */
  distanceFor(framing) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return (COW_LENGTH * this.height) / (framing.cowPixels * 2 * tanHalf);
  }

  /** Half of the visible floor width at the walking line. */
  halfWidth(framing = this.framing) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return this.distanceFor(framing) * tanHalf * this.camera.aspect;
  }

  applyFraming(framing, camera = this.camera) {
    if (camera === this.camera) this.framing = framing;
    const distance = this.distanceFor(framing);
    const target = new THREE.Vector3(framing.centerX, 0.85, 0);
    camera.position.set(framing.centerX, target.y + distance * Math.sin(TILT), distance * Math.cos(TILT));
    camera.near = Math.max(0.1, distance * 0.15);
    camera.far = distance * 3;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Lens shift keeps verticals upright while the floor sits near the bottom.
    const ground = new THREE.Vector3(framing.centerX, 0, 0).project(camera);
    const wanted = -1 + (2 * framing.groundPixels) / this.height;
    camera.projectionMatrix.elements[9] += ground.y - wanted;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  // Loop ---------------------------------------------------------------------

  start() {
    if (this.#running || this.#disposed) return;
    this.#running = true;
    this.#lastFrame = null;
    this.renderer.setAnimationLoop((time) => this.#frame(time));
  }

  stop() {
    this.#running = false;
    this.renderer.setAnimationLoop(null);
  }

  onFrame(listener) {
    this.#frameListeners.add(listener);
    return () => {
      this.#frameListeners.delete(listener);
    };
  }

  /** Run `update(t)` for t from 0 to 1 over `seconds` of stage time. */
  animate(seconds, update = () => {}) {
    if (seconds <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#tweens.add({ elapsed: 0, duration: seconds, update, resolve });
    });
  }

  wait(seconds) {
    return this.animate(seconds);
  }

  #frame(time) {
    if (this.#lastFrame !== null && time - this.#lastFrame < this.#frameInterval) return;
    const elapsed = this.#lastFrame === null ? 0 : (time - this.#lastFrame) / 1000;
    this.#lastFrame = time;
    // Long gaps (a background tab) should not make the cow teleport.
    this.tick(Math.min(Math.max(elapsed, 0), 1 / 20));
  }

  /** Advance the scene by `dt` seconds and render it. */
  tick(dt) {
    for (const tween of [...this.#tweens]) {
      tween.elapsed += dt;
      const t = Math.min(1, tween.elapsed / tween.duration);
      tween.update(t);
      if (t >= 1) {
        this.#tweens.delete(tween);
        tween.resolve();
      }
    }
    this.#updateGaze();
    for (const listener of this.#frameListeners) listener(dt);
    this.motion.update(dt);
    this.cow.root.position.x = this.startX - this.motion.distance;
    this.#followCow();
    this.#updatePuffs(dt);
    if (this.#card?.group.visible) {
      this.#card.group.updateMatrixWorld(true);
      this.#card.shade(this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }

  #followCow() {
    const x = this.cow.root.position.x;
    this.#key.position.set(x - 3.2, 7.5, 5.5);
    this.#key.target.position.set(x, 0.6, 0);
    this.#ground.position.x = x;
    const lift = clamp((this.cow.body.position.y - BODY_PIVOT_Y) / 0.4, 0, 1);
    this.#contact.position.x = x + 0.05;
    this.#contact.material.opacity = 0.42 * (1 - lift * 0.6);
    this.#contact.scale.set(2.9 * (1 + lift * 0.15), 1.1 * (1 + lift * 0.15), 1);
  }

  // Geometry queries ----------------------------------------------------------

  /** World position → CSS pixels in the viewport. */
  toScreen(point, camera = this.camera) {
    const projected = point.clone().project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.width,
      y: (1 - (projected.y * 0.5 + 0.5)) * this.height,
    };
  }

  /** The cow's current on-screen bounds, for hit testing. */
  cowRect() {
    this.cow.root.updateMatrixWorld(true);
    this.#box.makeEmpty();
    this.#box.expandByObject(this.cow.body);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      this.#corner.set(
        i & 1 ? this.#box.max.x : this.#box.min.x,
        i & 2 ? this.#box.max.y : this.#box.min.y,
        i & 4 ? this.#box.max.z : this.#box.min.z,
      );
      const point = this.toScreen(this.#corner);
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  #headScreen() {
    return this.toScreen(this.cow.head.getWorldPosition(new THREE.Vector3()));
  }

  /** A point just above the cow's poll, in CSS pixels, for a speech bubble. */
  headAnchor() {
    this.cow.root.updateMatrixWorld(true);
    return this.toScreen(this.cow.head.localToWorld(new THREE.Vector3(-0.05, 0.3, 0)));
  }

  #hatchWorld() {
    this.cow.root.updateMatrixWorld(true);
    return this.cow.body.localToWorld(this.cow.hatch.center.clone());
  }

  /** World x where the cow's nose is just past the right edge. */
  entryX(framing = this.framing) {
    return framing.centerX + this.halfWidth(framing) + NOSE_OFFSET + 0.2;
  }

  /** World x where the cow's rump has cleared the left edge. */
  exitX(framing = this.framing) {
    return framing.centerX - this.halfWidth(framing) - RUMP_OFFSET - 0.8;
  }

  // Direction -----------------------------------------------------------------

  /** Pause the walk while `reason` holds (hover, keyboard focus). */
  hold(reason, on) {
    if (on) this.#holds.add(reason);
    else this.#holds.delete(reason);
  }

  /** Pointer position in CSS pixels, or null when it leaves the cow. */
  setPointer(point) {
    this.#pointer = point;
  }

  /** The visitor started chatting elsewhere: skip the pause, keep walking. */
  hurry() {
    this.#hurried = true;
    this.#holds.clear();
  }

  #updateGaze() {
    const motion = this.motion;
    if (this.#mode === 'leaving') return;
    const held = this.#holds.size > 0 && this.#mode === 'walk';
    const attentive = this.#mode === 'walk' && (held || this.#gazeAtViewer);
    if (attentive !== this.#attentive) {
      this.#attentive = attentive;
      this.onAttention?.(attentive);
    }
    if (this.#pointer && (held || this.#mode === 'chat')) {
      const head = this.#headScreen();
      const dx = this.#pointer.x - head.x;
      const dy = head.y - this.#pointer.y;
      motion.lookYaw = 1.0 + clamp(dx / 420, -0.75, 0.3);
      motion.lookPitch = clamp(dy / 520, -0.35, 0.5);
      motion.alert = 1;
    } else if (held || this.#gazeAtViewer || this.#mode === 'chat') {
      motion.lookYaw = 1.0;
      motion.lookPitch = 0.12;
      motion.alert = 1;
    } else {
      motion.lookYaw = 0;
      motion.lookPitch = 0;
      motion.alert = 0;
    }
  }

  /** Walk (or run) until the root reaches world x. Resolves early if the mode changes. */
  #travel(x, speed, stopAt, mode = this.#mode) {
    const motion = this.motion;
    motion.gait = speed > WALK_SPEED * 1.5 ? 'gallop' : 'walk';
    return new Promise((resolve) => {
      const unsubscribe = this.onFrame(() => {
        if (this.#mode !== mode) {
          unsubscribe();
          resolve();
          return;
        }
        const stop = typeof stopAt === 'function' ? stopAt() : stopAt;
        const remaining = this.cow.root.position.x - x;
        const braking = (motion.speed * motion.speed) / (2 * motion.acceleration * 1.6);
        const held = this.#holds.size > 0 && this.#mode === 'walk';
        motion.targetSpeed = held || (stop && remaining <= braking + 0.02) ? 0 : speed;
        if (remaining <= 0 || (stop && !held && motion.speed <= 0.001 && remaining < 0.35)) {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /** Put the cow off-screen right, ready to walk in. */
  placeAtEntry() {
    this.applyFraming(this.walkFraming(0));
    this.startX = this.entryX();
    this.motion.reset(0);
    this.motion.speed = WALK_SPEED;
    this.cow.root.position.x = this.startX;
  }

  /** Put the cow standing still at a fraction of the viewport (0 = left). */
  placeStanding(fraction) {
    // Standing in for the walk: hover and focus still get its attention.
    this.#mode = 'walk';
    this.applyFraming(this.walkFraming(0));
    const half = this.halfWidth();
    this.startX = this.framing.centerX - half + fraction * half * 2;
    this.motion.reset(0);
    this.motion.speed = 0;
    this.motion.targetSpeed = 0;
    this.cow.root.position.x = this.startX;
  }

  /**
   * The cow walks in from the right, stops to look at the visitor, then walks
   * off to the left. Resolves true if it left without being clicked.
   */
  async walkThrough() {
    this.#mode = 'walk';
    this.#hurried = false;
    this.placeAtEntry();
    const pauseX = this.framing.centerX - this.halfWidth() * 0.1;
    await this.#travel(pauseX, WALK_SPEED, () => !this.#hurried, 'walk');
    if (this.#mode !== 'walk') return false;
    if (!this.#hurried) await this.#lookAround();
    if (this.#mode !== 'walk') return false;
    await this.#travel(this.exitX(), WALK_SPEED, false, 'walk');
    return this.#mode === 'walk';
  }

  async #lookAround() {
    const { hatch } = this.cow;
    this.#gazeAtViewer = true;
    await this.wait(0.7);
    this.motion.chew = 1;
    // Something inside the cow knocks twice on the hatch.
    for (let knock = 0; knock < 2; knock += 1) {
      if (this.#mode !== 'walk' || this.#hurried) break;
      await this.animate(0.16, (t) => {
        hatch.door.rotation.y = VIEW_SIDE * 0.09 * Math.sin(Math.PI * t);
      });
      await this.wait(0.12);
    }
    await this.wait(this.#hurried ? 0 : 1.5);
    this.motion.chew = 0;
    this.#gazeAtViewer = false;
    await this.wait(0.35);
  }

  // Chat -----------------------------------------------------------------------

  /** Where the card sits in world space for a screen rectangle and framing. */
  #poseForRect(rect, framing) {
    this.applyFraming(framing, this.#probe);
    const camera = this.#probe;
    const elements = camera.projectionMatrix.elements;
    const depth = this.distanceFor(framing) * 0.76;
    const ndcX = ((rect.left + rect.width / 2) / this.width) * 2 - 1;
    const ndcY = 1 - (rect.top / this.height) * 2;
    const position = new THREE.Vector3(
      (ndcX * depth) / elements[0],
      ((ndcY + elements[9]) * depth) / elements[5],
      -depth,
    ).applyMatrix4(camera.matrixWorld);
    return {
      position,
      quaternion: camera.quaternion.clone(),
      scale: 1,
      width: (rect.width / this.width) * 2 * (depth / elements[0]),
      height: (rect.height / this.height) * 2 * (depth / elements[5]),
    };
  }

  #buildCard(rect, face) {
    this.#card?.dispose();
    if (this.#card) this.scene.remove(this.#card.group);
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    this.#card = buildFoldingCard(drawCardFace(rect.width, rect.height, scale, face), scale);
    this.#card.group.visible = false;
    this.scene.add(this.#card.group);
    return this.#card;
  }

  /** The folded card's pose inside the hatch. */
  #hatchPose(cardWidth, cardHeight) {
    const { size } = this.cow.hatch;
    const stripHeight = cardHeight / CARD_STRIPS;
    const scale = Math.min((0.8 * size.x) / cardWidth, (0.78 * size.y) / stripHeight);
    const position = this.#hatchWorld().add(new THREE.Vector3(0, (stripHeight * scale) / 2, 0.04));
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.1));
    return { position, quaternion, scale };
  }

  #setCardPose(pose) {
    if (!this.#card) return;
    this.#card.group.position.copy(pose.position);
    this.#card.group.quaternion.copy(pose.quaternion);
    this.#card.group.scale.setScalar(pose.scale);
  }

  #openHatch(open, seconds) {
    const { hatch } = this.cow;
    const glow = hatch.glow.material;
    hatch.portal.visible = true;
    hatch.glow.visible = true;
    const from = hatch.door.rotation.y;
    const to = open ? VIEW_SIDE * HATCH_OPEN : 0;
    const fromGlow = glow.opacity;
    return this.animate(seconds, (t) => {
      const k = open ? easeOutBack(t) : easeIn(t);
      hatch.door.rotation.y = THREE.MathUtils.lerp(from, to, k);
      glow.opacity = THREE.MathUtils.lerp(fromGlow, open ? 0.42 : 0, t);
    }).then(() => {
      if (!open) {
        hatch.portal.visible = false;
        hatch.glow.visible = false;
      }
    });
  }

  /**
   * Stop, open the hatch and unfold the chat card out of the cow. `onLanding`
   * fires just before the card settles into `rect`, so the HTML card can start
   * fading in over it; the promise resolves once it has settled.
   */
  async openChat(rect, face, onLanding) {
    this.#mode = 'chat';
    this.#hurried = false;
    const motion = this.motion;
    motion.targetSpeed = 0;
    motion.chew = 0;
    const stopping = (motion.speed * motion.speed) / (2 * motion.acceleration * 1.6);
    const target = this.#framingForChat(this.#hatchWorld().x - stopping);
    this.#chatFraming = target;
    const from = { ...this.framing };
    const camera = this.animate(0.95, (t) => this.applyFraming(lerpFraming(from, target, easeInOut(t))));

    const card = this.#buildCard(rect, face);
    const final = this.#poseForRect(rect, target);
    card.setSize(final.width, final.height);
    card.setFold([1, 1]);

    await this.wait(0.28);
    const hatch = this.#openHatch(true, 0.5);
    await this.wait(0.24);
    const start = this.#hatchPose(final.width, final.height);
    card.group.visible = true;
    this.#setCardPose(start);
    const lift = new THREE.Vector3(0, final.position.distanceTo(start.position) * 0.28, 0.6);
    const control = start.position.clone().lerp(final.position, 0.45).add(lift);
    const flourish = new THREE.Quaternion();
    const turn = new THREE.Euler();
    let landed = false;
    await this.animate(0.95, (t) => {
      if (!landed && t >= 0.8) {
        landed = true;
        onLanding?.();
      }
      const travel = easeInOut(window01(t, 0, 0.85));
      const a = start.position.clone().lerp(control, travel);
      const b = control.clone().lerp(final.position, travel);
      const quaternion = start.quaternion.clone().slerp(final.quaternion, travel);
      turn.set(0, Math.sin(Math.PI * travel) * -0.45, 0);
      quaternion.multiply(flourish.setFromEuler(turn));
      this.#setCardPose({
        position: a.lerp(b, travel),
        quaternion,
        scale: THREE.MathUtils.lerp(start.scale, 1, easeOut(window01(t, 0, 0.8))),
      });
      card.setFold([
        1 - easeOutBack(window01(t, 0.22, 0.72)),
        1 - easeOutBack(window01(t, 0.4, 0.95)),
      ]);
    });
    card.setFold([0, 0]);
    this.#setCardPose(final);
    if (!landed) onLanding?.();
    await Promise.all([camera, hatch]);
  }

  /** Hide the 3D card once the HTML card covers it; the cow idles at 30 fps. */
  hideCard() {
    if (this.#card) this.#card.group.visible = false;
    if (this.#mode === 'chat') this.#frameInterval = 1000 / 30 - 2;
  }

  /** Keep the cow framed under the card when the viewport changes. */
  refreshChatFraming() {
    if (this.#mode !== 'chat' || !this.#chatFraming) return;
    this.#chatFraming = this.#framingForChat(this.#chatFraming.centerX);
    this.applyFraming(this.#chatFraming);
  }

  /** Fold the card from `rect` back into the cow and shut the hatch. */
  async closeChat(rect, face) {
    this.#frameInterval = 0;
    if (!this.#chatFraming) this.#chatFraming = { ...this.framing };
    const card = this.#buildCard(rect, face);
    const from = this.#poseForRect(rect, this.framing);
    card.setSize(from.width, from.height);
    card.setFold([0, 0]);
    this.#setCardPose(from);
    card.group.visible = true;
    const end = this.#hatchPose(from.width, from.height);
    const control = from.position.clone().lerp(end.position, 0.5).add(new THREE.Vector3(0, 0.3, 0.5));
    await this.animate(0.72, (t) => {
      const travel = easeInOut(window01(t, 0.18, 1));
      const a = from.position.clone().lerp(control, travel);
      const b = control.clone().lerp(end.position, travel);
      this.#setCardPose({
        position: a.lerp(b, travel),
        quaternion: from.quaternion.clone().slerp(end.quaternion, travel),
        scale: THREE.MathUtils.lerp(1, end.scale, easeIn(window01(t, 0.2, 1))),
      });
      card.setFold([easeInOut(window01(t, 0.25, 0.7)), easeInOut(window01(t, 0, 0.55))]);
    });
    card.group.visible = false;
    await this.#openHatch(false, 0.26);
    await this.animate(0.2, (t) => {
      this.cow.hatch.door.rotation.y = VIEW_SIDE * 0.1 * Math.sin(Math.PI * t);
    });
    this.cow.hatch.door.rotation.y = 0;
    // Zoom back out around the cow, so it runs off from where it stands.
    const chat = { ...this.framing };
    const walk = this.walkFraming(chat.centerX);
    this.#exitFraming = walk;
    void this.animate(1.1, (t) => this.applyFraming(lerpFraming(chat, walk, easeInOut(t))));
  }

  /** A startled hop, a buck, and a gallop off the left edge. */
  async runAway() {
    this.#mode = 'leaving';
    const motion = this.motion;
    motion.lookYaw = 0;
    motion.lookPitch = 0.3;
    motion.alert = 1;
    motion.chew = 0;
    await this.animate(0.24, (t) => {
      motion.hop = Math.sin(Math.PI * t) * 0.16;
    });
    motion.lookPitch = -0.2;
    await this.animate(0.26, (t) => {
      motion.kick = easeOut(t);
    });
    motion.acceleration = 5.5;
    motion.gait = 'gallop';
    motion.targetSpeed = GALLOP_SPEED;
    void this.animate(0.35, (t) => {
      motion.kick = 1 - easeInOut(t);
    });
    void this.animate(0.45, (t) => {
      motion.tailUp = easeOut(t);
    });
    // Keep going until the rump clears the edge of the walk framing.
    await this.#travel(this.exitX(this.#exitFraming ?? this.framing) - 0.5, GALLOP_SPEED, false, 'leaving');
  }

  /** Back to a fresh walk after leaving, for stages that host the cow more than once. */
  reset() {
    this.#mode = 'idle';
    this.#hurried = false;
    this.#holds.clear();
    this.#pointer = null;
    this.#gazeAtViewer = false;
    this.#frameInterval = 0;
    this.#chatFraming = null;
    this.#exitFraming = null;
    const motion = this.motion;
    motion.gait = 'walk';
    motion.acceleration = 1.1;
    motion.targetSpeed = 0;
    motion.speed = 0;
    motion.kick = 0;
    motion.hop = 0;
    motion.tailUp = 0;
    motion.chew = 0;
    motion.alert = 0;
    motion.lookYaw = 0;
    motion.lookPitch = 0;
    this.cow.hatch.door.rotation.y = 0;
    this.cow.hatch.portal.visible = false;
    this.cow.hatch.glow.visible = false;
    this.cow.hatch.glow.material.opacity = 0;
    if (this.#card) this.#card.group.visible = false;
  }

  // Dust ------------------------------------------------------------------------

  #spawnPuffs(localX) {
    const world = this.cow.root.localToWorld(new THREE.Vector3(localX, 0.04, 0));
    for (let i = 0; i < 4; i += 1) {
      const mesh = new THREE.Mesh(this.#puffGeometry, this.#puffMaterial.clone());
      mesh.position.set(world.x + (Math.random() - 0.5) * 0.25, 0.04, (Math.random() - 0.5) * 0.5);
      mesh.scale.setScalar(0.02);
      this.scene.add(mesh);
      this.#puffs.push({
        mesh,
        age: 0,
        velocity: new THREE.Vector3(0.5 + Math.random() * 0.8, 0.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.4),
      });
    }
  }

  #updatePuffs(dt) {
    this.#puffs = this.#puffs.filter((puff) => {
      puff.age += dt;
      const life = puff.age / 0.75;
      if (life >= 1) {
        this.scene.remove(puff.mesh);
        puff.mesh.material.dispose();
        return false;
      }
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(1 - dt * 2.5);
      puff.mesh.scale.setScalar(0.02 + easeOut(life) * 0.075);
      puff.mesh.rotation.x += dt * 2;
      puff.mesh.material.opacity = 0.55 * (1 - life) * (1 - life);
      return true;
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
    this.#tweens.clear();
    this.#frameListeners.clear();
    this.#card?.dispose();
    for (const puff of this.#puffs) puff.mesh.material.dispose();
    this.#puffGeometry.dispose();
    this.#puffMaterial.dispose();
    this.cow.dispose();
    for (const object of [this.#ground, this.#contact]) {
      object.geometry.dispose();
      object.material.map?.dispose();
      object.material.dispose();
    }
    this.#key.shadow.map?.dispose();
    this.renderer.dispose();
    // The cow only visits briefly; hand the GPU context back straight away.
    this.renderer.forceContextLoss();
  }
}
