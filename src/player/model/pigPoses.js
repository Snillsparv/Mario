// Pig-specific poses use the same blend clock, distance phase and stunt rotations as Jonas.
// In these poses the arm channels drive the forelegs. The soles are 30 units below the hip.
import { clamp, smoothstep, TAU } from '../../core/math.js';
import { ANIMS } from './animations.js';
import { arm, arms, leg, legs } from './kit.js';
import { HANG_DEPTH, WALL_DIST, POLE_GAP, POLE_TOP_SETTLE_TIME, LEDGE_CLIMB_TIME, climbProgress } from './physicsLink.js';
import { PIG_CENTER } from './pigRig.js';

function hoofAt(p, side, front, z, height, bodyHeight) {
  const y = 30 + bodyHeight - height;
  const length = clamp(Math.hypot(z, y), 3, 30);
  const bend = Math.acos(clamp((length * length - 16 * 16 - 14 * 14) / (2 * 16 * 14), -1, 1));
  const knee = front ? -bend : bend;
  const hip = Math.atan2(z, y) + Math.atan2(14 * Math.sin(knee), 16 + 14 * Math.cos(knee));
  if (front) arm(p, side, hip, 0, knee);
  else leg(p, side, hip, knee);
}

function plant(p, height) {
  for (const side of ['L', 'R']) {
    hoofAt(p, side, true, 0, 0, height);
    hoofAt(p, side, false, 0, 0, height);
  }
}

function idle(p, c) {
  const breath = Math.sin(c.time * 2.65);
  const u = c.t % 7.4;
  const glance = smoothstep(2.2, 2.8, u) * (1 - smoothstep(3.4, 4.0, u));
  p.hipsY = -1 + 0.9 * breath;
  p.headYaw = c.externalLook ? 0 : 0.42 * glance;
  p.headRoll = -0.07 * glance;
  p.headPitch = -0.025 - 0.035 * breath;
  plant(p, p.hipsY);
}

// Opposite fore and hind hooves touch together. The forward half of the swing
// clears the ground, while the stance travels backwards under the body.
function gait(p, c, reach, lift, drop) {
  const phase = c.ph * TAU;
  const bounce = Math.cos(2 * phase);
  p.hipsY = drop - 1.8 * bounce;
  p.flipRoll = c.bank * 0.55;
  p.headPitch = -0.04 + 0.075 * Math.sin(2 * phase - 0.6);
  p.headRoll = 0.035 * Math.sin(phase);
  for (const side of ['L', 'R']) {
    const a = phase + (side === 'L' ? 0 : Math.PI);
    for (const front of [true, false]) {
      const w = a + (front ? 0 : Math.PI);
      hoofAt(p, side, front, reach * Math.cos(w), lift * Math.max(0, -Math.sin(w)), p.hipsY);
    }
  }
}

function crouch(p, depth = 1) {
  p.hipsY = -15 * depth;
  p.squash = -0.12 * depth;
  p.headPitch = 0.13 * depth;
  plant(p, p.hipsY);
}

function land(p, c, strength) {
  const dip = (1 - smoothstep(0.035, 0.23, c.t)) * strength;
  crouch(p, dip);
  p.squash -= 0.09 * dip;
  p.headPitch += 0.12 * dip;
}

function jump(p, c) {
  const rise = clamp(c.vy / 55, -1, 1);
  p.flipPitch = -0.16 * rise;
  p.squash = 0.1 * (1 - smoothstep(0, 0.16, c.t));
  p.headPitch = -0.11 - 0.08 * rise;
  arms(p, 0.45 + 0.32 * rise, 0.16, -0.58);
  legs(p, -0.45 - 0.33 * rise, 0.7);
}

function stretch(p) {
  arms(p, 1.15, 0.13, -0.15);
  legs(p, -0.98, 0.28);
  p.headPitch = -0.12;
  p.squash = -0.06;
}

function paddle(p, c, rate) {
  const w = c.time * rate;
  p.rootY = 23 + 2 * Math.sin(w * 0.5);
  p.flipPitch = -0.18;
  p.headPitch = -0.15;
  for (const side of ['L', 'R']) {
    const a = w + (side === 'L' ? 0 : Math.PI);
    arm(p, side, 0.38 + 0.82 * Math.cos(a), 0.15, -0.6 + 0.4 * Math.sin(a));
    leg(p, side, -0.1 - 0.66 * Math.cos(a), 0.48 + 0.3 * Math.sin(a));
  }
}

function hang(p, amount) {
  // Rear up with the forelegs over the lip. The lip is HANG_DEPTH above the
  // physical anchor; the offsets decay along the same curve as the climb.
  p.flipPitch = -1.05 * amount;
  p.rootY = (HANG_DEPTH - 84) * amount;
  p.rootZ = (WALL_DIST - 16) * amount;
  p.headPitch = 0.65 * amount;
  arms(p, 2.13 * amount, 0.12 * amount, -0.32 * amount);
  legs(p, -0.5 * amount, 0.45 * amount);
}

function climbPole(p, c, moving) {
  const pedal = moving ? 0.5 * Math.sin(c.ph * TAU) : 0;
  p.flipPitch = -0.98;
  p.rootZ = POLE_GAP - 33;
  p.headPitch = 0.68;
  arm(p, 'L', 1.75 + pedal, 0.21, -0.43);
  arm(p, 'R', 1.75 - pedal, 0.21, -0.43);
  leg(p, 'L', 0.68 - pedal, 1);
  leg(p, 'R', 0.68 + pedal, 1);
}

// The anchor moves to the top of the trunk. Swing up from the old grip and balance
// on the forehooves. Counter-rotate the forelegs so they point down at the tip.
function handstand(p, c) {
  const u = smoothstep(0, POLE_TOP_SETTLE_TIME, c.t);
  const angle = 1.28 + 0.035 * Math.sin(c.t * 2.8);
  const y = 30 - PIG_CENTER;
  const z = 19;
  const tipY = 30 - PIG_CENTER - Math.cos(angle) * y + Math.sin(angle) * z;
  const tipZ = -Math.sin(angle) * y - Math.cos(angle) * z;
  climbPole(p, c, false);
  p.flipPitch += (angle - p.flipPitch) * u;
  p.rootX = c.entryX * (1 - u);
  p.rootY = c.entryY * (1 - u) + tipY * u + 8 * Math.sin(Math.PI * u);
  p.rootZ = (p.rootZ + c.entryZ) * (1 - u) + tipZ * u;
  p.headPitch += (-0.75 - p.headPitch) * u;
  arms(p, 1.75 + (angle - 1.75) * u, 0.21 * (1 - u), -0.43 * (1 - u));
  legs(p, 0.68 - 1.78 * u, 1 - 0.7 * u, 0.18 * u);
}

export const PIG_POSES = {
  idle,
  sleep(p, c) {
    crouch(p, smoothstep(0, 0.75, c.t));
    p.headPitch += 0.14 + Math.sin(c.time * 1.8) * 0.065;
    p.face = c.t > 0.6 ? 'sleep' : 'half';
  },
  tiptoe: (p, c) => gait(p, c, 8, 8, -4),
  walk: (p, c) => gait(p, c, 13, 9, -5),
  run: (p, c) => gait(p, c, 21, 15, -6),
  crawl: (p, c) => { gait(p, c, 7, 4, -14); p.squash = -0.12; },
  crouch: p => crouch(p),
  land: (p, c) => land(p, c, 0.72),
  ground_pound_land: (p, c) => land(p, c, 1.12),
  jump,
  fall: jump,
  water_jump: jump,
  long_jump(p) { stretch(p); p.flipPitch = -0.20; },
  dive(p) { stretch(p); p.flipPitch = 0.16; },
  belly_slide(p) { stretch(p); p.rootY = -14; p.floorPivot = 1; },
  fly(p, c) {
    ANIMS.fly.pose(p, c);
    // Keep the take-off somersault. A quadruped is already horizontal in flight.
    p.flipPitch -= 1.44 * smoothstep(0, 0.4, c.t);
    stretch(p);
  },
  cannon_shot(p, c) { stretch(p); p.flipRoll = c.t * 2.4; },
  swim_idle: (p, c) => paddle(p, c, 4.5),
  water_surface: (p, c) => paddle(p, c, 5.2),
  swim_stroke: (p, c) => paddle(p, c, 10),
  swim_flutter: (p, c) => paddle(p, c, 13),
  ledge_hang: p => hang(p, 1),
  ledge_climb(p, c) {
    const { up, fwd } = climbProgress(clamp(c.t / LEDGE_CLIMB_TIME, 0, 1));
    hang(p, 1 - up);
    p.rootZ = (WALL_DIST - 16) * (1 - fwd);
  },
  pole_hold: (p, c) => climbPole(p, c, false),
  pole_climb: (p, c) => climbPole(p, c, true),
  pole_handstand: handstand,
};

function poseLeg({ upper, hoof }, swing, bend, spread, swell) {
  upper.rotation.set(-swing, 0, spread);
  hoof.rotation.x = bend;
  hoof.scale.setScalar(1 + 0.52 * swell);
}

export function applyPigPose(r, p, rs, animator, dt) {
  const pivot = PIG_CENTER * (1 - p.floorPivot);
  r.orient.position.y = pivot;
  r.orient.rotation.set(rs.pitch, 0, rs.roll);
  r.lift.position.set(p.rootX, p.rootY + PIG_CENTER - pivot, p.rootZ);
  r.lift.rotation.set(p.flipPitch, p.flipYaw, p.flipRoll);
  const sy = Math.max(0.5, 1 + p.squash);
  r.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  r.hips.position.y = 48 + clamp(p.hipsY, -19, 18);
  r.hips.rotation.set(p.hipsPitch * 0.42, p.hipsYaw * 0.6, p.hipsRoll * 0.55);
  r.head.rotation.set(p.headPitch * 0.82 + p.spinePitch * 0.16, p.headYaw + rs.headYaw, p.headRoll + p.spineRoll * 0.18);
  poseLeg(r.frontL, p.armLSwing, p.elbowL, p.armLRaise * 0.65, p.handLSwell);
  poseLeg(r.frontR, p.armRSwing, p.elbowR, -p.armRRaise * 0.65, p.handRSwell);
  poseLeg(r.hindL, p.legLSwing, p.kneeL, p.legLSpread, p.footLSwell);
  poseLeg(r.hindR, p.legRSwing, p.kneeR, -p.legRSpread, p.footRSwell);

  const t = animator.time;
  const speed = clamp(Math.abs(rs.forwardVel) / 32, 0, 1);
  const wind = 0.65 * speed + 0.44 * clamp(rs.vy / 55, -1, 1) - 1.5 * p.squash;
  r.wind += (wind - r.wind) * (1 - Math.exp(-12 * dt));
  for (let i = 0; i < r.ears.length; i++) {
    const side = i === 0 ? 1 : -1;
    const twitch = Math.max(0, Math.cos(1.5 * t + i * 2.4)) ** 16 * Math.sin(20 * t + i);
    r.ears[i].rotation.x = -0.12 - 0.30 * r.wind + 0.10 * twitch;
    r.ears[i].rotation.z = -side * (0.38 + i * 0.07 + 0.08 * twitch - 0.15 * p.squash);
  }
  r.tail.rotation.y = (0.26 + speed * 0.24) * Math.sin(t * 6.4);
  r.tail.rotation.x = -0.1 + 0.14 * Math.sin(t * 5 - 0.6);
  r.ribbon.rotation.x = 0.11 + 0.62 * r.wind + (0.1 + 0.14 * speed) * Math.sin(t * 6 + animator.gaitPhase * TAU);
  r.ribbon.rotation.y = 0.18 * Math.sin(t * 3.7);
}
