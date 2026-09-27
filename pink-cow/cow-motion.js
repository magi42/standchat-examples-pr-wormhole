// Procedural locomotion. Each hoof is planted in world space while it bears
// weight, so feet never skate; swinging hooves travel to where the body will
// be when they land. Legs are solved with planar inverse kinematics every
// frame, and the head, ears, eyes, jaw, tail and bell get their own motion.

import * as THREE from 'three';

import { BODY_PIVOT_Y } from './cow-model.js';

// ---------------------------------------------------------------------------
// Inverse kinematics. Angles are measured from straight down (-y); positive
// angles swing a bone toward +x (forward).

/**
 * Solve a chain of two bones rooted at the origin so its tip reaches (tx, ty).
 * `bend` picks the side the middle joint bulges toward: +1 puts it in front of
 * the root-to-target line when the target is below the root.
 */
export function solveTwoBone(upper, lower, tx, ty, bend = 1) {
  const reach = Math.hypot(tx, ty);
  const min = Math.abs(upper - lower) + 1e-4;
  const max = upper + lower - 1e-4;
  const distance = Math.min(max, Math.max(min, reach));
  const scale = reach > 1e-9 ? distance / reach : 1;
  const ex = reach > 1e-9 ? tx * scale : 0;
  const ey = reach > 1e-9 ? ty * scale : -distance;
  const base = Math.atan2(ey, ex);
  const cosInner = (upper * upper + distance * distance - lower * lower) / (2 * upper * distance);
  const inner = Math.acos(Math.min(1, Math.max(-1, cosInner)));
  const upperStandard = base + bend * inner;
  const jointX = upper * Math.cos(upperStandard);
  const jointY = upper * Math.sin(upperStandard);
  const lowerStandard = Math.atan2(ey - jointY, ex - jointX);
  return {
    upper: upperStandard + Math.PI / 2,
    lower: lowerStandard + Math.PI / 2,
    reached: reach >= min && reach <= max,
  };
}

/**
 * Solve a three-bone hind leg (femur, tibia, cannon) whose cannon keeps a
 * fixed angle to the femur. Real hind legs behave much like this: the stifle
 * and hock flex together. The fixed angle reduces the chain to two bones.
 */
export function solveHindLeg(femur, tibia, cannon, cannonOffset, tx, ty) {
  const vx = femur + cannon * Math.cos(cannonOffset);
  const vy = cannon * Math.sin(cannonOffset);
  const virtualLength = Math.hypot(vx, vy);
  const offset = Math.atan2(vy, vx);
  const solved = solveTwoBone(virtualLength, tibia, tx, ty, 1);
  const femurAngle = solved.upper - offset;
  return { femur: femurAngle, tibia: solved.lower, cannon: femurAngle + cannonOffset, reached: solved.reached };
}

// ---------------------------------------------------------------------------
// Gaits: a lateral-sequence walk (LH, LF, RH, RF) and a transverse gallop.

const GAITS = {
  walk: {
    offsets: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 },
    duty: 0.66,
    frequency: (speed) => 0.55 + speed * 0.4,
    lift: { front: 0.13, hind: 0.1 },
    hoofFlex: { front: 1.25, hind: 0.8 },
  },
  gallop: {
    offsets: { LH: 0, RH: 0.11, LF: 0.44, RF: 0.55 },
    duty: 0.3,
    frequency: (speed) => 1.25 + speed * 0.14,
    lift: { front: 0.3, hind: 0.24 },
    hoofFlex: { front: 1.6, hind: 1.2 },
  },
};

export const WALK_SPEED = 1.35;
export const GALLOP_SPEED = 5.2;

const FRONT_NEUTRAL = 0.04;
const HIND_NEUTRAL = -0.02;
const HIND_CANNON_OFFSET = -0.55;
// Shoulder blades and pelvis rotate with each stride, carrying the top of the
// leg forward and back. Without this a quadruped's legs cannot reach far enough.
const FRONT_SLIDE = 0.4;
const HIND_SLIDE = 0.15;

const clamp = THREE.MathUtils.clamp;
const smooth = (t) => t * t * (3 - 2 * t);
const damp = (current, target, rate, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));

export class CowMotion {
  /** Distance walked since the start, along the cow's facing direction. */
  distance = 0;
  speed = 0;
  targetSpeed = 0;
  acceleration = 1.1;
  gait = 'walk';
  /** Head yaw toward the camera side (radians) and pitch (up is positive). */
  lookYaw = 0;
  lookPitch = 0;
  /** 0..1 blends in cud chewing. */
  chew = 0;
  /** 0..1 raises the tail, as cows do when they run. */
  tailUp = 0;
  /** 0..1 pricks the ears forward. */
  alert = 0;
  /** Extra hind-leg kick (0..1), for the buck before running off. */
  kick = 0;
  /** Vertical hop offset (m), added on top of the gait bob. */
  hop = 0;
  /** Called when a hoof lands, with its x in the cow's root space. */
  onTouchdown = null;

  #cow;
  #random;
  #phase = 0.1;
  #gaitBlend = 0;
  #legs;
  #blinkTimer = 2;
  #blinkTime = -1;
  #earTimers = [1.5, 3];
  #earFlick = [0, 0];
  #swishTimer = 3;
  #swish = 0;
  #bellAngle = new THREE.Vector2();
  #bellVelocity = new THREE.Vector2();
  #lastSpeed = 0;
  #yaw = 0;
  #pitch = 0;
  #chewPhase = 0;
  #time = 0;
  #inverse = new THREE.Matrix4();
  #point = new THREE.Vector3();

  constructor(cow, random = Math.random) {
    this.#cow = cow;
    this.#random = random;
    this.#legs = new Map(cow.legs.map((leg) => [leg.name, {
      planted: this.#neutral(leg),
      liftFrom: this.#neutral(leg),
      swinging: false,
      stepLength: 0,
    }]));
  }

  /** Called when the cow is placed; resets planted feet under the body. */
  reset(distance = 0) {
    this.distance = distance;
    for (const leg of this.#cow.legs) {
      const state = this.#legs.get(leg.name);
      state.planted = distance + this.#neutral(leg);
      state.liftFrom = state.planted;
      state.swinging = false;
    }
  }

  update(dt) {
    this.#time += dt;
    const rate = this.targetSpeed > this.speed ? this.acceleration : this.acceleration * 1.6;
    this.speed = this.speed < this.targetSpeed
      ? Math.min(this.targetSpeed, this.speed + rate * dt)
      : Math.max(this.targetSpeed, this.speed - rate * dt);
    const accel = (this.speed - this.#lastSpeed) / Math.max(dt, 1e-3);
    this.#lastSpeed = this.speed;
    this.distance += this.speed * dt;

    this.#gaitBlend = damp(this.#gaitBlend, this.gait === 'gallop' ? 1 : 0, 6, dt);
    const gait = this.#gaitBlend > 0.5 ? GAITS.gallop : GAITS.walk;
    const frequency = this.speed > 0.02 || this.#settling() ? gait.frequency(this.speed) : 0;
    this.#phase = (this.#phase + frequency * dt) % 1;

    this.#updateBody();
    for (const leg of this.#cow.legs) this.#updateLeg(leg, gait, frequency);
    this.#updateHead(dt);
    this.#updateFace(dt);
    this.#updateTail(dt);
    this.#updateBell(dt, accel);
  }

  #settling() {
    for (const [name, state] of this.#legs) {
      if (state.swinging || Math.abs(state.stepLength) > 0.01) return true;
      const leg = this.#cow.legs.find((l) => l.name === name);
      if (Math.abs(state.planted - (this.distance + this.#neutral(leg))) > 0.04) return true;
    }
    return false;
  }

  #neutral(leg) {
    return leg.rest.x + (leg.hind ? HIND_NEUTRAL : FRONT_NEUTRAL);
  }

  #updateBody() {
    const { body } = this.#cow;
    const intensity = clamp(this.speed / WALK_SPEED, 0, 1);
    const gallop = this.#gaitBlend;
    const cycle = this.#phase * Math.PI * 2;
    const walkBob = -0.014 * Math.cos(cycle * 2) * intensity;
    const gallopBob = 0.07 * Math.sin(cycle - 0.6) * gallop;
    body.position.y = BODY_PIVOT_Y + walkBob * (1 - gallop) + gallopBob + this.hop - 0.02 * gallop;
    body.rotation.x = 0.022 * Math.sin(cycle) * intensity * (1 - gallop);
    const walkPitch = 0.012 * Math.sin(cycle * 2 + 0.8) * intensity;
    const gallopPitch = 0.085 * Math.sin(cycle + 0.9) * gallop;
    body.rotation.z = walkPitch * (1 - gallop) + gallopPitch - this.kick * 0.15;
    body.rotation.y = 0.012 * Math.sin(cycle + 1.3) * intensity * (1 - gallop);
    body.updateMatrix();
  }

  #updateLeg(leg, gait, frequency) {
    const state = this.#legs.get(leg.name);
    const legPhase = (this.#phase + gait.offsets[leg.name]) % 1;
    const swingNow = legPhase >= gait.duty;
    const neutral = this.distance + this.#neutral(leg);
    const reach = frequency > 0 ? (this.speed * gait.duty) / frequency : 0;

    if (state.swinging && !swingNow) {
      // Landed since the last frame; the body has moved on a little since.
      const since = frequency > 0 ? legPhase / frequency : 0;
      state.planted = neutral + reach * 0.5 - this.speed * since;
      state.swinging = false;
      state.stepLength = 0;
      this.onTouchdown?.(leg, state.planted - this.distance);
    }
    if (swingNow && !state.swinging) {
      state.swinging = true;
      state.liftFrom = state.planted;
    }
    let footDistance = state.planted;
    let height = 0;
    let hoofAngle = 0;
    const kind = leg.hind ? 'hind' : 'front';
    if (state.swinging) {
      const s = clamp((legPhase - gait.duty) / (1 - gait.duty), 0, 1);
      const remaining = frequency > 0 ? (1 - legPhase) / frequency : 0;
      const target = neutral + this.speed * remaining + reach * 0.5;
      state.stepLength = target - state.liftFrom;
      const ease = leg.hind ? smooth(s) : smooth(Math.min(1, s * 1.08));
      footDistance = THREE.MathUtils.lerp(state.liftFrom, target, ease);
      const stride = Math.abs(state.stepLength);
      const lift = gait.lift[kind] * clamp(stride / 0.9, 0, 1.2);
      const shape = leg.hind ? Math.sin(Math.PI * s) : Math.sin(Math.PI * Math.pow(s, 0.8));
      height = lift * shape;
      hoofAngle = -gait.hoofFlex[kind] * Math.sin(Math.PI * Math.pow(s, 0.9)) * clamp(stride / 0.8, 0, 1);
    } else {
      // Heel rises in the last part of stance, rolling over the toe.
      const stanceProgress = legPhase / gait.duty;
      const breakover = clamp((stanceProgress - 0.8) / 0.2, 0, 1);
      hoofAngle = -0.35 * breakover * clamp(this.speed / WALK_SPEED, 0, 1);
    }

    if (leg.hind && this.kick > 0) {
      // Buck: both hind legs fling up and back.
      footDistance = THREE.MathUtils.lerp(footDistance, this.distance + leg.rest.x - 0.55, this.kick);
      height = THREE.MathUtils.lerp(height, 0.55, this.kick);
      hoofAngle = THREE.MathUtils.lerp(hoofAngle, -1.4, this.kick);
    }

    this.#solveLeg(leg, footDistance - this.distance, height, hoofAngle);
  }

  #solveLeg(leg, footX, footY, hoofAngle) {
    // Fetlock target in cow-root space, then into body space, then leg space.
    const fetlockX = footX - Math.sin(hoofAngle) * leg.pastern;
    const fetlockY = footY + Math.cos(hoofAngle) * leg.pastern;
    this.#inverse.copy(this.#cow.body.matrix).invert();
    this.#point.set(fetlockX, fetlockY, leg.rest.z).applyMatrix4(this.#inverse);
    const reachX = this.#point.x - leg.rest.x;
    const slide = clamp(reachX * (leg.hind ? HIND_SLIDE : FRONT_SLIDE), -0.2, 0.2);
    leg.root.position.set(leg.rest.x + slide, leg.rest.y - Math.abs(slide) * 0.15, leg.rest.z);
    const tx = this.#point.x - leg.root.position.x;
    const ty = this.#point.y - leg.root.position.y;
    const [first, second, third] = leg.bones;
    let lastAngle;
    if (leg.hind) {
      const [femur, tibia, cannon] = leg.lengths;
      const solved = solveHindLeg(femur, tibia, cannon, HIND_CANNON_OFFSET, tx, ty);
      first.rotation.z = solved.femur;
      second.rotation.z = solved.tibia - solved.femur;
      third.rotation.z = solved.cannon - solved.tibia;
      lastAngle = solved.cannon;
    } else {
      const [upper, lower] = leg.lengths;
      const solved = solveTwoBone(upper, lower, tx, ty, 1);
      first.rotation.z = solved.upper;
      second.rotation.z = solved.lower - solved.upper;
      lastAngle = solved.lower;
    }
    // The body's pitch tilts every bone; cancel it on the hoof.
    leg.hoof.rotation.z = hoofAngle - lastAngle - this.#cow.body.rotation.z;
  }

  #updateHead(dt) {
    const { neck, head } = this.#cow;
    const intensity = clamp(this.speed / WALK_SPEED, 0, 1) * (1 - this.#gaitBlend);
    const cycle = this.#phase * Math.PI * 2;
    this.#yaw = damp(this.#yaw, clamp(this.lookYaw, -1.25, 1.25), 5, dt);
    this.#pitch = damp(this.#pitch, clamp(this.lookPitch, -0.5, 0.6), 5, dt);
    const nod = 0.05 * Math.sin(cycle * 2 - 0.9) * intensity;
    const gallopNeck = this.#gaitBlend * (0.12 + 0.08 * Math.sin(cycle + 0.4));
    neck.rotation.y = this.#yaw * 0.45;
    neck.rotation.z = -0.04 + nod * 0.5 + this.#pitch * 0.35 - gallopNeck + this.kick * -0.18;
    head.rotation.y = this.#yaw * 0.55;
    head.rotation.z = -0.9 + nod + this.#pitch * 0.65 + this.alert * 0.1 + this.#gaitBlend * 0.25;
    head.rotation.x = -this.#yaw * 0.12;
  }

  #updateFace(dt) {
    const { eyes, ears, jaw } = this.#cow;
    // Blink every few seconds, and whenever the head starts a big turn.
    this.#blinkTimer -= dt;
    if (this.#blinkTimer <= 0 || (Math.abs(this.lookYaw - this.#yaw) > 0.5 && this.#blinkTime < 0)) {
      this.#blinkTime = 0;
      this.#blinkTimer = 2.2 + this.#random() * 4;
    }
    let lid = 1;
    if (this.#blinkTime >= 0) {
      this.#blinkTime += dt;
      const t = this.#blinkTime / 0.22;
      lid = t < 0.4 ? 1 - t / 0.4 : t < 0.55 ? 0 : clamp((t - 0.55) / 0.45, 0, 1);
      if (t >= 1) this.#blinkTime = -1;
    }
    for (const eye of eyes) eye.scale.y = Math.max(0.08, lid);

    ears.forEach((ear, index) => {
      this.#earTimers[index] -= dt;
      if (this.#earTimers[index] <= 0) {
        this.#earFlick[index] = 1;
        this.#earTimers[index] = 2.5 + this.#random() * 5;
      }
      this.#earFlick[index] = Math.max(0, this.#earFlick[index] - dt * 5);
      const side = index === 0 ? 1 : -1;
      const flick = Math.sin(this.#earFlick[index] * Math.PI);
      // Ears stick out sideways: x droops the tip, y sweeps it back or forward.
      ear.rotation.x = side * (0.38 - this.alert * 0.28 - flick * 0.35);
      ear.rotation.y = -side * (0.95 - this.alert * 0.6 + flick * 0.25);
      ear.rotation.z = 0.25 + this.alert * 0.15;
    });

    this.#chewPhase += dt * Math.PI * 2 * 1.3;
    jaw.rotation.y = Math.sin(this.#chewPhase) * 0.09 * this.chew;
    jaw.rotation.z = -(0.5 + 0.5 * Math.sin(this.#chewPhase * 2)) * 0.07 * this.chew;
  }

  #updateTail(dt) {
    const { tail } = this.#cow;
    this.#swishTimer -= dt;
    if (this.#swishTimer <= 0) {
      this.#swish = 1;
      this.#swishTimer = 3 + this.#random() * 5;
    }
    this.#swish = Math.max(0, this.#swish - dt * 0.9);
    const cycle = this.#phase * Math.PI * 2;
    const walk = clamp(this.speed / WALK_SPEED, 0, 1) * (1 - this.#gaitBlend);
    const swishWave = Math.sin(this.#swish * Math.PI) * Math.sin(this.#time * 9);
    tail.forEach((segment, index) => {
      const lag = index * 0.55;
      const sway = 0.07 * Math.sin(cycle - lag) * walk + (0.3 * swishWave * (index + 1)) / tail.length;
      const flutter = 0.12 * Math.sin(this.#time * 14 - lag * 2) * this.tailUp;
      segment.rotation.x = sway + flutter;
      const rest = index === 0 ? -0.28 : 0.04;
      const raised = index === 0 ? -2.1 : index < 3 ? 0.25 : 0.4;
      segment.rotation.z = THREE.MathUtils.lerp(rest, raised, this.tailUp) + 0.04 * Math.sin(cycle * 2 - lag) * walk;
    });
  }

  #updateBell(dt, accel) {
    // A damped pendulum pushed by the body's acceleration and gait bounce.
    const cycle = this.#phase * Math.PI * 2;
    const pace = clamp(this.speed / WALK_SPEED, 0, 2);
    const swing = accel * 0.25 + Math.sin(cycle * 2) * pace * 0.24;
    const sway = Math.cos(cycle) * 0.5 * pace;
    const stiffness = 28;
    const damping = 3.2;
    this.#bellVelocity.x += (-stiffness * this.#bellAngle.x - damping * this.#bellVelocity.x + swing) * dt;
    this.#bellVelocity.y += (-stiffness * this.#bellAngle.y - damping * this.#bellVelocity.y + sway) * dt;
    this.#bellAngle.addScaledVector(this.#bellVelocity, dt);
    this.#cow.bell.rotation.z = clamp(this.#bellAngle.x, -0.8, 0.8) + 0.1;
    this.#cow.bell.rotation.x = clamp(this.#bellAngle.y, -0.6, 0.6);
  }
}
