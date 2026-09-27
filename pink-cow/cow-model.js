// A procedural, low-poly pink cow: no model file, every facet is built here.
// Units are metres; the cow faces +x, +y is up, and +z is the cow's left. The
// stage turns it to walk right-to-left, so the camera sees its right (-z)
// side, where the question-mark hatch sits.

import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

import { GLYPH_COLOR, questionMarkOutline, SPOT_COLOR, spotIconPolygons } from './cow-glyph.js';

export { spotIconPolygons };

export const PALETTE = {
  hide: '#f48bb2',
  hideDeep: '#e2688f',
  spot: SPOT_COLOR,
  glyph: GLYPH_COLOR,
  inner: '#ffd6e4',
  muzzle: '#ffc3d5',
  nostril: '#9f2d58',
  hoof: '#42232f',
  horn: '#fbeedd',
  hornTip: '#e1cba9',
  eye: '#1d1115',
  earInner: '#ffb1c9',
  udder: '#ffadc6',
  collar: '#1b90b3',
  bell: '#f6c510',
  bellDark: '#a57d05',
};

/** Nose-to-rump length, used for camera framing. */
export const COW_LENGTH = 2.55;
export const BODY_PIVOT_Y = 1.05;
/** The side of the cow facing the camera. */
export const VIEW_SIDE = -1;

// Cross-sections, listed from the top around the cow's left side (+z).
const TORSO_PROFILE = [
  [0.42, 1], [0.86, 0.84], [1, 0.55], [1, -0.45], [0.84, -0.8], [0.36, -1],
  [-0.36, -1], [-0.84, -0.8], [-1, -0.45], [-1, 0.55], [-0.86, 0.84], [-0.42, 1],
];
const NECK_PROFILE = [
  [0.5, 1], [1, 0.42], [1, -0.4], [0.5, -1], [-0.5, -1], [-1, -0.4], [-1, 0.42], [-0.5, 1],
];
const HEAD_PROFILE = [
  [0.62, 1], [1, 0.4], [0.94, -0.55], [0.5, -1], [-0.5, -1], [-0.94, -0.55], [-1, 0.4], [-0.62, 1],
];
const LIMB_SIDES = 6;

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ring of points around the x axis at `x`, spanning top to bottom and ±halfWidth. */
function ring(profile, x, top, bottom, halfWidth) {
  const center = (top + bottom) / 2;
  return profile.map(([nz, ny]) => new THREE.Vector3(
    x,
    ny >= 0 ? center + ny * (top - center) : center + ny * (center - bottom),
    nz * halfWidth,
  ));
}

/** A ring of points around the y axis, for limbs hanging from a joint. */
function limbRing(y, depth, width, offsetX = 0) {
  const points = [];
  for (let i = 0; i < LIMB_SIDES; i += 1) {
    const angle = (i / LIMB_SIDES) * Math.PI * 2 + Math.PI / LIMB_SIDES;
    points.push(new THREE.Vector3(offsetX + Math.cos(angle) * depth, y, Math.sin(angle) * width));
  }
  return points;
}

/** Skin consecutive rings into a closed, outward-facing surface. */
function loft(rings, caps = {}) {
  const count = rings[0].length;
  const positions = [];
  const indices = [];
  for (const points of rings) for (const point of points) positions.push(point.x, point.y, point.z);
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < count; i += 1) {
      const a = r * count + i;
      const b = r * count + ((i + 1) % count);
      const c = (r + 1) * count + i;
      const d = (r + 1) * count + ((i + 1) % count);
      indices.push(a, b, c, b, d, c);
    }
  }
  const addCap = (ringIndex, flip) => {
    const points = rings[ringIndex];
    const centre = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
    const centreIndex = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    for (let i = 0; i < count; i += 1) {
      const a = ringIndex * count + i;
      const b = ringIndex * count + ((i + 1) % count);
      if (flip) indices.push(centreIndex, b, a);
      else indices.push(centreIndex, a, b);
    }
  };
  if (caps.start !== false) addCap(0, true);
  if (caps.end !== false) addCap(rings.length - 1, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  orientOutward(geometry, rings);
  geometry.computeVertexNormals();
  return geometry;
}

// Ring order decides which way triangles face. Check one side quad against
// the ring's centre and flip everything if it points inward.
function orientOutward(geometry, rings) {
  const index = geometry.getIndex();
  if (!index) return;
  const middle = Math.floor((rings.length - 1) / 2);
  const ringPoints = rings[middle];
  const centre = ringPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(ringPoints.length);
  const next = rings[middle + 1];
  const [a, b] = ringPoints;
  const c = next[0];
  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (normal.dot(new THREE.Vector3().subVectors(a, centre)) >= 0) return;
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

/** Unindex a geometry and give each face a slightly different tint. */
function facetColors(geometry, color, variation, seed) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const next = random(seed);
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const tint = new THREE.Color();
  for (let face = 0; face < count / 3; face += 1) {
    const shift = (next() - 0.5) * 2 * variation;
    tint.setHSL(hsl.h + shift * 0.02, hsl.s, THREE.MathUtils.clamp(hsl.l + shift, 0, 1));
    for (let v = 0; v < 3; v += 1) tint.toArray(colors, (face * 3 + v) * 3);
  }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}

/** A tapered prism from `from` to `to`. */
function segmentBetween(from, to, radiusFrom, radiusTo, sides) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radiusTo, radiusFrom, length, sides, 1);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(from.x, from.y, from.z);
  return geometry;
}

// ---------------------------------------------------------------------------
// Textures

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  return { element, context };
}

/** An irregular, straight-edged cow spot inside a unit square. */
function spotOutline(seed, vertices, roughness) {
  const next = random(seed);
  const points = [];
  for (let i = 0; i < vertices; i += 1) {
    const angle = (i / vertices) * Math.PI * 2 + (next() - 0.5) * 0.35;
    const radius = 1 - next() * roughness;
    points.push([0.5 + Math.cos(angle) * radius * 0.5, 0.5 + Math.sin(angle) * radius * 0.5]);
  }
  return points;
}

function tracePolygon(context, points, map) {
  context.beginPath();
  points.forEach((point, index) => {
    const [x, y] = map(point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

const HATCH_SPOT = spotOutline(11, 13, 0.16);

function hatchTexture(kind, width, height) {
  const { element, context } = canvas(width, height);
  const toCanvas = ([x, y]) => [x * width, (1 - y) * height];
  tracePolygon(context, HATCH_SPOT, toCanvas);
  if (kind === 'outer') {
    context.fillStyle = PALETTE.spot;
    context.fill();
    const { hook, dot } = questionMarkOutline();
    const glyphHeight = height * 0.78;
    const glyph = ([x, y]) => [width * 0.5 + x * glyphHeight, height * 0.9 - y * glyphHeight];
    context.fillStyle = PALETTE.glyph;
    tracePolygon(context, hook, glyph);
    context.fill();
    tracePolygon(context, dot, glyph);
    context.fill();
  } else if (kind === 'inner') {
    context.fillStyle = PALETTE.inner;
    context.fill();
    context.lineWidth = Math.max(4, width * 0.02);
    context.strokeStyle = '#f3b3c8';
    context.stroke();
  } else {
    const gradient = context.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.5);
    gradient.addColorStop(0, '#fff8dc');
    gradient.addColorStop(0.45, '#ffd98a');
    gradient.addColorStop(0.8, '#ff9cc0');
    gradient.addColorStop(1, '#e0537f');
    context.fillStyle = gradient;
    context.fill();
  }
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function spotTexture(seed) {
  const size = 128;
  const { element, context } = canvas(size, size);
  tracePolygon(context, spotOutline(seed, 9, 0.28), ([x, y]) => [x * size, (1 - y) * size]);
  context.fillStyle = PALETTE.hideDeep;
  context.fill();
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const size = 128;
  const { element, context } = canvas(size, size);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 244, 214, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 214, 160, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 150, 190, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// Assembly

/**
 * Build the cow. Returns its scene graph plus the parts the animation moves:
 * body, neck, head, jaw, ears, eyes, tail segments, bell, the hatch and the
 * legs, each with its bones, hoof, bone lengths and resting root position.
 */
export function buildCow() {
  const disposables = [];
  const track = (item) => {
    disposables.push(item);
    return item;
  };

  const lambert = (color, options = {}) => track(new THREE.MeshLambertMaterial({ color, flatShading: true, ...options }));
  const hideMaterial = lambert('#ffffff', { vertexColors: true });

  const mesh = (geometry, material, parent, shadow = true) => {
    track(geometry);
    const item = new THREE.Mesh(geometry, material);
    item.castShadow = shadow;
    parent.add(item);
    return item;
  };
  const hide = (geometry, seed, parent, color = PALETTE.hide) => mesh(facetColors(geometry, color, 0.035, seed), hideMaterial, parent);

  const root = new THREE.Group();
  root.name = 'cow';
  const body = new THREE.Group();
  body.position.y = BODY_PIVOT_Y;
  root.add(body);

  // Torso: [x, top, bottom, half width]. The middle sections share a width so
  // the flank is flat where the hatch sits.
  const torsoSections = [
    [-1.0, 1.34, 1.1, 0.09],
    [-0.92, 1.42, 0.8, 0.22],
    [-0.68, 1.47, 0.7, 0.33],
    [-0.28, 1.45, 0.62, 0.36],
    [0.13, 1.44, 0.61, 0.36],
    [0.47, 1.48, 0.66, 0.32],
    [0.71, 1.42, 0.72, 0.25],
    [0.85, 1.27, 0.84, 0.13],
  ];
  const torsoGeometry = loft(torsoSections.map(([x, top, bottom, width]) => ring(TORSO_PROFILE, x, top, bottom, width)));
  torsoGeometry.translate(0, -BODY_PIVOT_Y, 0);
  const torso = hide(torsoGeometry, 3, body);

  // Decals are projected in body space, before the torso is animated.
  torso.updateMatrixWorld(true);
  const decal = (target, position, size, rotation = new THREE.Euler(0, Math.PI, 0)) =>
    track(new DecalGeometry(target, position, rotation, size));

  const decalMaterial = (texture, options = {}) => lambert('#ffffff', {
    map: track(texture),
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...options,
  });

  // Ordinary spots make the pink animal read as a cow, not a pig.
  const spots = [
    [21, new THREE.Vector3(-0.8, 1.2, -0.25), new THREE.Vector3(0.36, 0.34, 0.34), 0.6],
    [22, new THREE.Vector3(0.56, 1.27, -0.3), new THREE.Vector3(0.3, 0.26, 0.3), -0.3],
    [23, new THREE.Vector3(0.12, 1.44, 0.12), new THREE.Vector3(0.34, 0.4, 0.3), 0],
  ];
  spots.forEach(([seed, position, size, yaw], index) => {
    const bodyPosition = position.clone().setY(position.y - BODY_PIVOT_Y);
    const rotation = index === 2 ? new THREE.Euler(-Math.PI / 2, 0, 0.4) : new THREE.Euler(0, Math.PI + yaw, 0);
    body.add(new THREE.Mesh(decal(torso, bodyPosition, size, rotation), decalMaterial(spotTexture(seed))));
  });

  // The question-mark hatch: a door cut from the flank that opens onto a lit
  // interior. The door is the decal; the hinge is its front (head-side) edge.
  const hatchCenter = new THREE.Vector3(-0.1, 1.05 - BODY_PIVOT_Y, VIEW_SIDE * 0.36);
  const hatchSize = new THREE.Vector2(1.02, 0.66);
  const hatchGeometry = decal(torso, hatchCenter, new THREE.Vector3(hatchSize.x, hatchSize.y, 0.28));
  const hingeX = hatchCenter.x + hatchSize.x * 0.5 * 0.9;
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, hatchCenter.y, hatchCenter.z);
  body.add(pivot);
  const door = new THREE.Group();
  pivot.add(door);
  const doorOffset = new THREE.Vector3(-hingeX, -hatchCenter.y, -hatchCenter.z);
  const outer = new THREE.Mesh(hatchGeometry, decalMaterial(hatchTexture('outer', 512, 332), {
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  }));
  outer.position.copy(doorOffset);
  outer.castShadow = true;
  door.add(outer);
  // The door's inside faces away from the key light; a little warmth keeps it pink.
  const inner = new THREE.Mesh(hatchGeometry, decalMaterial(hatchTexture('inner', 256, 166), {
    side: THREE.BackSide,
    emissive: '#ff8fb5',
    emissiveIntensity: 0.35,
  }));
  inner.position.copy(doorOffset);
  door.add(inner);

  const portal = new THREE.Mesh(hatchGeometry, track(new THREE.MeshBasicMaterial({
    map: track(hatchTexture('portal', 256, 166)),
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })));
  portal.visible = false;
  body.add(portal);

  const glow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1, 1)),
    track(new THREE.MeshBasicMaterial({
      map: track(glowTexture()),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })),
  );
  glow.position.copy(hatchCenter).add(new THREE.Vector3(0, 0, VIEW_SIDE * 0.06));
  glow.rotation.y = VIEW_SIDE < 0 ? Math.PI : 0;
  glow.scale.set(hatchSize.x * 1.25, hatchSize.y * 1.45, 1);
  glow.visible = false;
  body.add(glow);

  // Udder, tucked between the hind legs.
  const udderGeometry = new THREE.IcosahedronGeometry(1, 1);
  udderGeometry.scale(0.15, 0.1, 0.13);
  udderGeometry.translate(-0.38, 0.62 - BODY_PIVOT_Y, 0);
  mesh(facetColors(udderGeometry, PALETTE.udder, 0.03, 5), hideMaterial, body);
  const teatMaterial = lambert(PALETTE.muzzle);
  for (const [x, z] of [[-0.45, 0.06], [-0.45, -0.06], [-0.31, 0.06], [-0.31, -0.06]]) {
    const teat = new THREE.ConeGeometry(0.018, 0.07, 5);
    teat.rotateX(Math.PI);
    teat.translate(x, 0.52 - BODY_PIVOT_Y, z);
    mesh(teat, teatMaterial, body, false);
  }

  // Neck, head and face ------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.set(0.64, 1.25 - BODY_PIVOT_Y, 0);
  body.add(neck);
  const neckSections = [
    [-0.14, 0.25, -0.34, 0.2],
    [0.12, 0.21, -0.37, 0.18],
    [0.32, 0.17, -0.31, 0.155],
    [0.5, 0.135, -0.2, 0.13],
    [0.62, 0.12, -0.14, 0.12],
  ];
  hide(loft(neckSections.map(([x, top, bottom, width]) => ring(NECK_PROFILE, x, top, bottom, width))), 7, neck);

  const collarGeometry = new THREE.TorusGeometry(1, 0.12, 4, 14);
  collarGeometry.rotateY(Math.PI / 2);
  collarGeometry.scale(0.3, 0.255, 0.165);
  collarGeometry.rotateZ(-0.32);
  collarGeometry.translate(0.27, -0.065, 0);
  mesh(collarGeometry, lambert(PALETTE.collar), neck);

  const bell = new THREE.Group();
  bell.position.set(0.36, -0.31, 0);
  neck.add(bell);
  const bellProfile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.03, 0.005),
    new THREE.Vector2(0.045, -0.04),
    new THREE.Vector2(0.06, -0.1),
    new THREE.Vector2(0.075, -0.12),
    new THREE.Vector2(0.001, -0.12),
  ];
  mesh(new THREE.LatheGeometry(bellProfile, 7), lambert(PALETTE.bell), bell);
  const clapper = new THREE.IcosahedronGeometry(0.022, 0);
  clapper.translate(0, -0.125, 0);
  mesh(clapper, lambert(PALETTE.bellDark), bell);

  // Head-local frame: +x runs down the face from poll to nose, +y is the
  // forehead side. The head hangs from the neck at the poll.
  const head = new THREE.Group();
  head.position.set(0.61, 0.03, 0);
  head.scale.setScalar(1.14);
  neck.add(head);
  const skullSections = [
    [-0.07, 0.1, -0.1, 0.125],
    [0.08, 0.11, -0.16, 0.165],
    [0.23, 0.075, -0.135, 0.125],
    [0.33, 0.055, -0.12, 0.115],
  ];
  const skull = hide(loft(skullSections.map(([x, top, bottom, width]) => ring(HEAD_PROFILE, x, top, bottom, width)), { end: false }), 9, head);
  const muzzleSections = [
    [0.33, 0.055, -0.12, 0.115],
    [0.42, 0.055, -0.125, 0.142],
    [0.475, 0.025, -0.1, 0.128],
  ];
  mesh(
    facetColors(loft(muzzleSections.map(([x, top, bottom, width]) => ring(HEAD_PROFILE, x, top, bottom, width)), { start: false }), PALETTE.muzzle, 0.03, 13),
    hideMaterial,
    head,
  );
  const nostrilMaterial = lambert(PALETTE.nostril);
  for (const side of [1, -1]) {
    const nostril = new THREE.CircleGeometry(0.024, 6);
    nostril.scale(1, 0.72, 1);
    nostril.rotateY(Math.PI / 2);
    nostril.rotateX(side * 0.3);
    nostril.translate(0.478, -0.03, side * 0.056);
    mesh(nostril, nostrilMaterial, head, false);
  }

  // A patch around the camera-side eye.
  skull.updateMatrixWorld(true);
  const facePatch = decal(skull, new THREE.Vector3(0.1, 0.02, VIEW_SIDE * 0.16), new THREE.Vector3(0.24, 0.22, 0.14));
  head.add(new THREE.Mesh(facePatch, decalMaterial(spotTexture(31))));

  const jaw = new THREE.Group();
  jaw.position.set(0.14, -0.12, 0);
  head.add(jaw);
  const jawSections = [
    [-0.02, 0.03, -0.05, 0.1],
    [0.14, 0.02, -0.07, 0.095],
    [0.3, 0.01, -0.045, 0.085],
  ];
  mesh(facetColors(loft(jawSections.map(([x, top, bottom, width]) => ring(NECK_PROFILE, x, top, bottom, width))), PALETTE.hide, 0.03, 17), hideMaterial, jaw);

  const eyes = [];
  const eyeMaterial = lambert(PALETTE.eye);
  const shineMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  for (const side of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(0.075, 0.035, side * 0.158);
    head.add(eye);
    const ball = new THREE.IcosahedronGeometry(0.034, 0);
    ball.scale(1.1, 1, 0.8);
    mesh(ball, eyeMaterial, eye, false);
    const shine = new THREE.IcosahedronGeometry(0.009, 0);
    shine.translate(0.014, 0.014, side * 0.022);
    mesh(shine, shineMaterial, eye, false);
    // A heavy upper lid gives the calm, slightly sleepy bovine look.
    const lid = new THREE.IcosahedronGeometry(0.04, 0);
    lid.scale(1.05, 0.55, 0.75);
    lid.translate(-0.004, 0.03, -side * 0.004);
    hide(lid, 90 + side, eye);
    eyes.push(eye);
  }

  const ears = [];
  const innerEarMaterial = lambert(PALETTE.earInner, { side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const ear = new THREE.Group();
    ear.position.set(0.0, 0.035, side * 0.12);
    head.add(ear);
    // Lofted outward along z: [distance, half height, half thickness].
    const earRings = [
      [0, 0.03, 0.02], [0.05, 0.06, 0.022], [0.12, 0.068, 0.02], [0.19, 0.045, 0.014], [0.235, 0.008, 0.006],
    ];
    const rings = earRings.map(([distance, halfHeight, halfThickness]) => {
      const points = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * halfThickness, Math.sin(angle) * halfHeight, side * distance));
      }
      return points;
    });
    hide(loft(rings), 19 + side, ear);
    const inner = new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(side * 0.05, -0.04),
      new THREE.Vector2(side * 0.13, -0.045),
      new THREE.Vector2(side * 0.19, -0.02),
      new THREE.Vector2(side * 0.18, 0.025),
      new THREE.Vector2(side * 0.12, 0.045),
      new THREE.Vector2(side * 0.05, 0.035),
    ]));
    inner.rotateY(-Math.PI / 2);
    inner.translate(0.0215, 0, 0);
    mesh(inner, innerEarMaterial, ear, false);
    ears.push(ear);
  }

  // Short horns that sweep out from the poll and curl forward.
  const hornMaterial = lambert(PALETTE.horn);
  const tipMaterial = lambert(PALETTE.hornTip);
  for (const side of [1, -1]) {
    const path = [
      new THREE.Vector3(-0.045, 0.075, side * 0.075),
      new THREE.Vector3(-0.085, 0.1, side * 0.15),
      new THREE.Vector3(-0.1, 0.14, side * 0.2),
      new THREE.Vector3(-0.07, 0.19, side * 0.225),
    ];
    const radii = [0.032, 0.025, 0.017, 0.004];
    for (let i = 0; i < path.length - 1; i += 1) {
      mesh(segmentBetween(path[i], path[i + 1], radii[i], radii[i + 1], 5), i === path.length - 2 ? tipMaterial : hornMaterial, head);
    }
  }

  // Tail ---------------------------------------------------------------------
  const tail = [];
  let tailParent = body;
  const tailLengths = [0.14, 0.14, 0.13, 0.13, 0.12];
  tailLengths.forEach((length, index) => {
    const segment = new THREE.Group();
    if (index === 0) segment.position.set(-0.98, 1.37 - BODY_PIVOT_Y, 0);
    else segment.position.y = -tailLengths[index - 1];
    tailParent.add(segment);
    const radius = 0.028 - index * 0.003;
    const geometry = new THREE.CylinderGeometry(radius, radius - 0.003, length, 5);
    geometry.translate(0, -length / 2, 0);
    hide(geometry, 40 + index, segment);
    tail.push(segment);
    tailParent = segment;
  });
  const switchGeometry = new THREE.OctahedronGeometry(1, 0);
  switchGeometry.scale(0.045, 0.1, 0.045);
  switchGeometry.translate(0, -0.2, 0);
  mesh(facetColors(switchGeometry, PALETTE.spot, 0.04, 47), hideMaterial, tail[tail.length - 1]);

  // Legs ---------------------------------------------------------------------
  const hoofMaterial = lambert(PALETTE.hoof);
  const makeLeg = (name, hind, side, x, y) => {
    const legRoot = new THREE.Group();
    legRoot.position.set(x, y - BODY_PIVOT_Y, side * (hind ? 0.2 : 0.19));
    body.add(legRoot);
    const lengths = hind ? [0.44, 0.42, 0.33] : [0.52, 0.31];
    // [depth (front-to-back), width (side-to-side), forward offset] per ring.
    const shapes = hind
      ? [
          [[0.24, 0.17, -0.08], [0.25, 0.165, -0.06], [0.17, 0.125, -0.01], [0.1, 0.085, 0.01]],
          [[0.1, 0.085, 0.01], [0.085, 0.07, -0.01], [0.065, 0.058, -0.02], [0.07, 0.058, -0.028]],
          [[0.058, 0.052, 0], [0.05, 0.047, 0], [0.048, 0.045, 0], [0.058, 0.052, 0.005]],
        ]
      : [
          [[0.14, 0.13, 0.0], [0.13, 0.11, 0.0], [0.095, 0.085, 0.0], [0.07, 0.064, 0.0]],
          [[0.062, 0.057, 0], [0.051, 0.048, 0], [0.049, 0.046, 0], [0.058, 0.052, 0.005]],
        ];
    const bones = [];
    let parent = legRoot;
    lengths.forEach((length, index) => {
      const bone = new THREE.Group();
      if (index > 0) bone.position.y = -lengths[index - 1];
      parent.add(bone);
      const rings = shapes[index].map(([depth, width, offset], ringIndex, all) =>
        limbRing((-length * ringIndex) / (all.length - 1) + (ringIndex === 0 ? 0.04 : 0), depth, width, offset));
      hide(loft(rings), 60 + index + (hind ? 10 : 0) + (side > 0 ? 5 : 0), bone);
      bones.push(bone);
      parent = bone;
    });
    const hoof = new THREE.Group();
    hoof.position.y = -lengths[lengths.length - 1];
    parent.add(hoof);
    const pastern = 0.12;
    hide(loft([limbRing(0.02, 0.058, 0.052, 0.0), limbRing(-0.06, 0.058, 0.054, 0.02)]), 80 + (hind ? 1 : 0), hoof);
    mesh(loft([limbRing(-0.055, 0.064, 0.06, 0.03), limbRing(-pastern, 0.078, 0.066, 0.045)]), hoofMaterial, hoof);
    return { name, hind, root: legRoot, bones, hoof, lengths, pastern, rest: legRoot.position.clone() };
  };
  const legs = [
    makeLeg('LF', false, 1, 0.47, 0.93),
    makeLeg('RF', false, -1, 0.47, 0.93),
    makeLeg('LH', true, 1, -0.62, 1.1),
    makeLeg('RH', true, -1, -0.62, 1.1),
  ];

  return {
    root,
    body,
    neck,
    head,
    jaw,
    ears,
    eyes,
    tail,
    bell,
    hatch: { door, portal, glow, center: hatchCenter, size: hatchSize },
    legs,
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}
