// Grounded poses: standing, sleeping, locomotion, braking, pushing and crouching.
// Each entry: { pose(p, c), blend? }. c = { t: animTime, ph: gait phase (gaits) or
// cyclePhase, stride: gait stride (units), spd: |forwardVel| (units/tick), vy, time:
// free-running clock, bank: turn lean, headYaw / externalLook: the Player's look-around }
// — see ../animator.js.
//
// Poses that lean forward shift the body back a little (rootZ, with the boots) so the head
// and the wide hat brim stay near the 50-unit collision radius, out of walls Pip runs along.

import {
  TAU, clamp, smoothstep, easeInOut, arm, arms, legs, stand, plantLeg, plantFeet, keyframes, reachArm, bankAtFeet,
} from '../kit.js';
import { gaitAt, gaitLegs } from '../gait.js';
import { HAND_R } from '../dims.js';
import { WALL_DIST } from '../physicsLink.js';

// Occasional look-around while idling: glance left, pause, glance right, back to centre.
function lookAround(t) {
  const u = t % 9;
  return 0.75 * bump(u, 3.2, 4.8) - 0.75 * bump(u, 5.2, 6.8);
}
// 0 -> 1 over [a, a + 0.35], back to 0 over [b - 0.35, b].
const bump = (u, a, b) => smoothstep(a, a + 0.35, u) * (1 - smoothstep(b - 0.35, b, u));

// The Player's headYaw (added to the head by the rig) is the look-around channel when it
// drives one; the built-in glance only plays when it does not.
function idle(p, c) {
  stand(p);
  const b = Math.sin(c.time * 2.3); // breathing
  p.hipsY = -1 + 0.7 * b;
  p.spinePitch = 0.02 + 0.03 * b;
  p.headPitch = -0.04 - 0.025 * b;
  p.armLRaise += 0.04 * b;
  p.armRRaise += 0.04 * b;
  plantFeet(p, 3, -2);
  const look = c.externalLook ? c.headYaw : lookAround(c.t);
  p.headYaw = c.externalLook ? 0 : look;
  p.spineYaw = look * 0.15;
  p.headRoll = -look * 0.08;
}

// Sits down over ~0.8 s, then dozes: the head sinks slowly and jerks back up.
function sit(p, c) {
  p.hipsY = -33;
  p.hipsPitch = -0.28;
  legs(p, 1.25, 0.55, -0.35, 0.28);
  p.spinePitch = 0.45;
  arms(p, 0.55, 0.2, 1.1, 0.15);
  const n = (c.t * 0.45) % 1;
  const nod = n < 0.85 ? easeInOut(n / 0.85) : 1 - (n - 0.85) / 0.15;
  p.headPitch = 0.2 + 0.32 * nod;
  p.headRoll = 0.1 * nod;
  p.spinePitch += 0.035 * Math.sin(c.time * 1.5);
  p.face = 'sleep';
}

// The idle pose at its start (no glance), for the first sleep key.
const idleCtx = { t: 0, time: 0, headYaw: 0, externalLook: false };
function idleStart(p, c) {
  idleCtx.time = c.time;
  idleCtx.headYaw = c.headYaw;
  idleCtx.externalLook = c.externalLook;
  idle(p, idleCtx);
}

const SLEEP_KEYS = [
  [0, idleStart],
  [0.35, (q) => {
    stand(q);
    q.hipsY = -14;
    q.spinePitch = 0.35;
    plantFeet(q, 6, -2);
    arms(q, 0.5, 0.3, 0.6);
    q.face = 'half';
  }],
  [0.9, sit],
];

function sleep(p, c) {
  keyframes(p, c.t, SLEEP_KEYS, c);
}

// Locomotion gaits (see ../gait.js); strides by speed come from ../strides.js.
const WALK = { stance: 0.58, reach: 47, toeUp: 0.25, heelUp: 0.6, lift: 6, kick: 3, zMid: 3 };
const RUN = { stance: 0.45, reach: 47, toeUp: 0.2, heelUp: 0.9, lift: 12, kick: 18, drive: 24, zMid: -2 };
const TIPTOE = { stance: 0.62, reach: 30, tiptoe: true, heelUp: 0.75, lift: 11, kick: 0, zMid: -2 };
const CRAWL = { stance: 0.62, reach: 28, toeUp: 0, heelUp: 0, lift: 5, kick: 0, zMid: -32 };

// How far a gait has turned into bounding: 0 = walking (no flight), 1 = full flight run.
const flight = (g) => clamp((0.5 - g.stance) / 0.3, 0, 1);

// Left heel strikes at phase 0, the right one at 0.5; arms swing against the legs. At the
// top of its speed range the walk turns into a jog (a short flight between steps).
function walk(p, c) {
  stand(p);
  const g = gaitAt(WALK, c.stride);
  const jog = smoothstep(0.58, 0.42, g.stance);
  const a = clamp(c.spd / 12, 0.35, 1);
  const w = c.ph * TAU;
  const co = Math.cos(w);
  // Vaulting over the planted foot while walking, dipping onto it while jogging.
  p.rootY = -(1.6 - 3.6 * jog) * Math.cos(2 * w) - 2 * jog;
  p.hipsY = -4;
  p.hipsYaw = -0.14 * co;
  p.spinePitch = 0.08 * a + 0.08 * jog;
  p.spineYaw = 0.22 * a * co;
  bankAtFeet(p, c.bank);
  gaitLegs(p, c.ph, g);
  arm(p, 'L', -0.55 * a * co, 0.24, 0.35 + 0.3 * Math.max(0, -co) + 0.5 * jog);
  arm(p, 'R', 0.55 * a * co, 0.24, 0.35 + 0.3 * Math.max(0, co) + 0.5 * jog);
  p.headPitch = -0.05 - 0.05 * jog;
  p.headYaw = -0.1 * a * co;
}

// Bounding run: at full speed each boot is down for only a fifth of the cycle and the body
// sails between steps, heel kicked up behind, knee driven high in front.
function run(p, c) {
  const g = gaitAt(RUN, c.stride);
  const fly = flight(g);
  const a = clamp(c.spd / 26, 0.65, 1.15);
  const w = c.ph * TAU;
  const co = Math.cos(w);
  const mid = Math.cos(2 * (w - (TAU * g.stance) / 2)); // 1 at mid-stance of either foot
  p.rootZ = -8;
  p.rootY = -(2 + 6 * fly) * mid; // lowest while a boot is down, airborne between steps
  p.squash = -0.04 * mid * fly;
  p.hipsY = -5;
  p.hipsPitch = 0.14 * a;
  p.spinePitch = 0.3 * a;
  p.hipsYaw = -0.22 * co;
  p.spineYaw = 0.36 * a * co;
  bankAtFeet(p, c.bank);
  gaitLegs(p, c.ph, g);
  // Arms pump against the legs with elbows bent ~90 degrees.
  arm(p, 'L', 0.2 - 1.05 * a * co, 0.3, 1.45 - 0.35 * co, 0.15 * Math.max(0, co));
  arm(p, 'R', 0.2 + 1.05 * a * co, 0.3, 1.45 + 0.35 * co, 0.15 * Math.max(0, -co));
  p.headPitch = -0.4 * a; // chin up: keeps the brim out of the wall ahead
  p.headYaw = -0.12 * a * co;
}

// Cartoon sneaking: on the toes, knees lifted high, hands held up like paws.
function tiptoe(p, c) {
  const w = c.ph * TAU;
  const co = Math.cos(w);
  p.rootZ = -6;
  p.rootY = 1.5 * Math.cos(2 * w);
  p.hipsY = -3;
  p.spinePitch = 0.25;
  p.hipsPitch = 0.05;
  gaitLegs(p, c.ph, gaitAt(TIPTOE, c.stride));
  arm(p, 'L', 0.95 - 0.12 * co, 0.4, 1.75, -0.35);
  arm(p, 'R', 0.95 + 0.12 * co, 0.4, 1.75, -0.35);
  p.headPitch = -0.12;
  p.headYaw = 0.3 * Math.sin(w * 0.5);
  p.spineYaw = 0.1 * co;
}

// Braking hard: leaning back, front boot digging in, arms thrown out for balance.
function skid(p, c) {
  p.hipsY = -9;
  p.hipsPitch = -0.2;
  p.spinePitch = -0.32;
  p.rootX = 0.8 * Math.sin(c.t * 70);
  plantLeg(p, 'L', 24);
  plantLeg(p, 'R', -8);
  p.ankleL -= 0.35; // toes up on the braking foot
  const flap = Math.sin(c.t * 26);
  arm(p, 'L', 0.35, 1.35 + 0.15 * flap, 0.35, 0.2);
  arm(p, 'R', 0.35, 1.35 - 0.15 * flap, 0.35, 0.2);
  p.headPitch = 0.1;
  p.headRoll = 0.05 * flap;
  p.face = 'shout';
}

// Pivoting out of a skid: a low lunge into the new direction, arms whipping around.
function turnaround(p, c) {
  const k = easeInOut(c.t / 0.25);
  p.rootZ = -6;
  p.hipsY = -10 + 4 * k;
  p.hipsPitch = 0.15;
  p.spinePitch = 0.2 + 0.2 * k;
  plantLeg(p, 'L', 20 - 6 * k);
  plantLeg(p, 'R', -18);
  arm(p, 'L', -0.7 * k + 0.3 * (1 - k), 0.7 + 0.3 * (1 - k), 0.5, -0.4);
  arm(p, 'R', 0.9 * k, 0.5, 1.2);
  p.spineYaw = 0.35 * (1 - k);
  p.headPitch = -0.25;
  p.face = 'shout';
}

// Shoulder-first shove against the wall ahead (its face is WALL_DIST in front): body
// turned side-on with the right shoulder and both mittens pressed to it, head tilted away
// (which also keeps the wide hat brim out of the wall), boots scrabbling for grip.
function push(p, c) {
  const w = c.t * TAU * 1.3;
  const strain = Math.sin(c.t * 9);
  p.rootZ = PUSH.rootZ;
  p.hipsY = -6;
  p.hipsYaw = 0.6;
  p.hipsPitch = 0.1;
  p.spineYaw = 0.55;
  p.spinePitch = 0.2;
  p.spineRoll = -0.1;
  p.headRoll = -0.75;
  p.headYaw = -0.3;
  p.headPitch = -0.1 + 0.03 * strain;
  plantLeg(p, 'L', -16 + 6 * Math.sin(w));
  plantLeg(p, 'R', 2 - 6 * Math.sin(w));
  p.kneeL += 0.4 * Math.max(0, Math.cos(w));
  p.kneeR += 0.4 * Math.max(0, -Math.cos(w));
  reachArm(p, 'R', -14, 80 + strain, WALL_DIST - HAND_R);
  arm(p, 'L', 1.3, 0.5, 1.9 + 0.1 * strain, 0.5); // far fist braced at the chest
  p.face = 'shout';
}
const PUSH = { rootZ: 13 };

// Deep squat, knees apart, hands resting on the knees, looking ahead.
function crouch(p, c) {
  p.rootZ = -10;
  p.hipsY = -24;
  p.hipsPitch = 0.3;
  p.spinePitch = 0.3 + 0.03 * Math.sin(c.time * 2.3);
  plantFeet(p, 6, -4); // hips sit back behind the boots
  p.legLSpread = p.legRSpread = 0.22;
  arms(p, 0.95, 0.35, 0.5);
  p.headPitch = -0.5;
}

// Low crawl: hunched over, the boots shuffle along flat while the mittens paddle the
// floor; each planted mitten stays put like the boots (diagonal pairs move together).
function crawl(p, c) {
  const w = c.ph * TAU;
  const s = Math.sin(w);
  p.rootZ = -24;
  p.hipsY = -20;
  p.hipsPitch = 0.35;
  p.spinePitch = 0.75;
  p.rootY = 1.5 * Math.abs(Math.cos(w));
  p.spineYaw = 0.1 * s;
  p.headPitch = -0.85;
  const g = gaitAt(CRAWL, c.stride);
  gaitLegs(p, c.ph, g);
  for (let i = 0; i < 2; i++) { // left mitten with the right boot, and vice versa
    const u = (c.ph + (i ? 0 : 0.5)) % 1;
    const down = u < g.stance;
    const k = down ? u / g.stance : (u - g.stance) / (1 - g.stance);
    const reach = g.stance * g.stride / 2;
    const z = down ? 12 + reach - 2 * reach * k : 12 - reach + 2 * reach * easeInOut(k);
    reachArm(p, i ? 'R' : 'L', i ? -16 : 16, HAND_R + (down ? 0 : 6 * Math.sin(Math.PI * k)), z, 1, 0.8);
  }
}

// Crouched and sliding on the boots, leaning back, arms out for balance.
function crouchSlide(p, c) {
  p.floorPivot = 1; // tilts with the floor about the boots
  p.hipsY = -24;
  p.spinePitch = 0.15;
  p.hipsPitch = 0.1;
  plantFeet(p, 14, -6);
  p.legLSpread = p.legRSpread = 0.15;
  const wob = Math.sin(c.t * 18);
  arm(p, 'L', 0.4, 1.05 + 0.1 * wob, 0.4);
  arm(p, 'R', 0.4, 1.05 - 0.1 * wob, 0.4);
  p.rootX = 0.6 * Math.sin(c.t * 60);
  p.headPitch = -0.1;
  p.face = 'shout';
}

// Landing: quick squash and knee dip, then recover (the physics usually leaves this
// anim after a few ticks, so most of the motion happens in the first 0.25 s).
function land(p, c) {
  const d = c.t < 0.05 ? 0.4 + 12 * c.t : 1 - smoothstep(0.05, 0.35, c.t);
  stand(p);
  p.rootZ = -8 * d; // sitting back into the squat
  p.hipsY = -15 * d;
  p.squash = -0.14 * d;
  p.spinePitch = 0.28 * d;
  p.headPitch = 0.02 * d;
  plantFeet(p, 5, -4);
  arms(p, 0.05 + 0.25 * d, 0.24 + 0.55 * d, 0.3 + 0.2 * d);
}

export const GROUND_ANIMS = {
  idle: { pose: idle, blend: 0.15 },
  sleep: { pose: sleep, blend: 0.2 },
  walk: { pose: walk },
  run: { pose: run },
  tiptoe: { pose: tiptoe },
  skid: { pose: skid },
  turnaround: { pose: turnaround },
  push: { pose: push, blend: 0.15 },
  crouch: { pose: crouch },
  crawl: { pose: crawl },
  crouch_slide: { pose: crouchSlide },
  land: { pose: land, blend: 0.05 },
};

