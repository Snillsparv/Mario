// Airborne and sliding poses: jumps, somersaults, long jump, dive, slides, ground pound,
// wall kick, knockbacks and aerial kicks. The model owns all flips: they are driven by
// animTime here, never by the physics (RenderState pitch/roll only add physical tilt).

import { createPose, resetPose, blendPose } from '../pose.js';
import {
  PI, TAU, clamp, smoothstep, unit, easeOut, easeOutBack, hump, arm, arms, leg, legs, tuck, legTo, reachArm,
  hipsPointAt, swellHand, swellFoot, strikeSwell, STRIKE_SWELL,
} from '../kit.js';
import { HAND_R } from '../dims.js';
import { WALL_DIST } from '../physicsLink.js';

// Stretch on take-off that settles within ~0.25 s.
const takeoffStretch = (t, amount = 0.12) => amount * (1 - smoothstep(0, 0.25, t));
// How far past the apex we are (0 rising .. 1 falling fast); vy in units/tick.
const falling = (vy) => clamp(-vy / 25, 0, 1);
// The dive's leading mittens swell only a little (1.25x), unlike a punch.
const DIVE_SWELL = 0.25;

function jump(p, c) {
  const k = easeOut(c.t / 0.15);
  const f = falling(c.vy);
  p.squash = takeoffStretch(c.t);
  // One fist flung up and out beside the hat (Pip's arms are too short to punch over the
  // big head), the chest and head leaning away from it.
  p.spineRoll = -0.16 * k;
  p.headRoll = -0.12 * k;
  arm(p, 'R', 0.3 + (0.45 - 0.2 * f) * k, 0.3 + (1.9 - 0.3 * f) * k, 0.15 + 0.35 * k);
  arm(p, 'L', -0.45 * k, 0.5 + 0.3 * f, 0.6);
  leg(p, 'L', 0.95 * k, (1.45 - 0.5 * f) * k, 0.3);
  leg(p, 'R', -0.12 * k, 0.35 * k, 0.6 * k);
  p.spinePitch = -0.08 * k;
  p.headPitch = -0.22 * k;
  p.face = c.t < 0.45 ? 'shout' : 'open';
}

// Arms flail overhead, legs bicycle.
function fall(p, c) {
  const a = smoothstep(0, 0.3, c.t);
  const f = c.t * 13;
  for (let i = 0; i < 2; i++) {
    const o = i * PI; // the arms flail half a turn apart
    arm(p, i ? 'R' : 'L', 0.35 + 0.3 * Math.cos(f + o), 0.3 + a * (1.85 + 0.35 * Math.sin(f + o)), 0.5 + 0.35 * Math.sin(f + o + 1));
  }
  const g = c.t * 9;
  leg(p, 'L', 0.35 + 0.35 * a * Math.sin(g), 0.7 + 0.5 * a * Math.sin(g + 1.2), 0.3);
  leg(p, 'R', 0.35 - 0.35 * a * Math.sin(g), 0.7 - 0.5 * a * Math.sin(g + 1.2), 0.3);
  p.spinePitch = -0.1;
  p.headPitch = -0.12;
  p.face = 'shout';
}

// Jubilant spread-eagle: arms flung up in a V, legs splayed, chest out.
function doubleJump(p, c) {
  const k = easeOutBack(c.t / 0.3);
  p.squash = takeoffStretch(c.t, 0.1);
  arms(p, 0.25, 0.3 + 2.05 * k, 0.15);
  leg(p, 'L', 0.3 * k, 0.4 * k, 0.5 * k, 0.4 * k);
  leg(p, 'R', -0.15 * k, 0.3 * k, 0.5 * k, 0.4 * k);
  p.spinePitch = -0.22 * k;
  p.headPitch = -0.35 * k;
  p.face = 'happy';
}

// Somersault helper: `turns` full rotations of `channel` over `dur` seconds (fast start,
// gentle finish), tucking into a ball mid-flip and opening into the `open` pose.
const tucked = createPose();
function somersault(p, c, channel, turns, dur, open, tightness = 1) {
  const u = unit(c.t / dur);
  open(p, c);
  resetPose(tucked);
  tuck(tucked);
  const face = p.face;
  blendPose(p, p, tucked, tightness * smoothstep(0, 0.18, u) * (1 - smoothstep(0.65, 1, u)));
  p.face = face;
  p[channel] = turns * TAU * (1 - (1 - u) ** 2);
  return u;
}

function armsOut(p) {
  arms(p, 0.3, 1.45, 0.2);
  leg(p, 'L', 0.25, 0.35, 0.5, 0.2);
  leg(p, 'R', -0.2, 0.3, 0.5, 0.2);
  p.headPitch = -0.2;
  p.face = 'happy';
}

function tripleJump(p, c) {
  somersault(p, c, 'flipPitch', 1, 0.7, armsOut);
  p.squash += takeoffStretch(c.t, 0.1);
}

function backflip(p, c) {
  somersault(p, c, 'flipPitch', -1, 0.65, (q) => {
    arms(q, 2.6, 0.5, 0.2);
    legs(q, 0.2, 0.4, 0.6);
    q.spinePitch = -0.15;
    q.headPitch = -0.3;
    q.face = 'shout';
  });
}

// Sideways flip with a half twist, body opened into a star.
function sideflip(p, c) {
  const u = somersault(p, c, 'flipRoll', 1, 0.6, (q) => {
    arms(q, 0.15, 1.5, 0.25);
    legs(q, 0.1, 0.25, 0.5, 0.35);
    q.headPitch = -0.1;
    q.face = 'happy';
  }, 0.55);
  p.flipYaw = 0.6 * hump(u);
}

// A bounding leap stretched out at ~45-55 degrees: arms reaching ahead either side of the
// brim (a forward cue even from the camera behind), legs split (leading knee up, trailing
// leg straight back). The dive differs: flat, legs together.
function longJump(p, c) {
  const k = easeOut(c.t / 0.2);
  const f = falling(c.vy);
  p.flipPitch = (0.8 + 0.2 * f) * k;
  p.squash = 0.08 * k;
  arms(p, 0.3 + 1.9 * k, 0.3 + 0.5 * k, 0.2);
  leg(p, 'L', (0.95 - 0.4 * f) * k, 1.35 * k, 0.35);
  leg(p, 'R', -0.55 * k, 0.25 * k, 0.8);
  p.spinePitch = -0.12 * k;
  p.headPitch = -0.7 * k;
  p.face = 'shout';
}

// Superman: flat out, arms thrust ahead in a narrow V either side of the hat, legs
// together with a little flutter, head tipped with the body.
function dive(p, c) {
  const k = easeOut(c.t / 0.15);
  p.flipPitch = 1.4 * k;
  p.squash = 0.06 * k;
  arms(p, 0.3 + 2.45 * k, 0.3 + 0.4 * k, 0.1);
  // A subtle swell of the leading mittens as they thrust ahead.
  const sw = DIVE_SWELL * strikeSwell(c.t, 0.15, 0.3, 0.55);
  swellHand(p, 'L', sw);
  swellHand(p, 'R', sw);
  const kick = 0.15 * Math.sin(c.t * 14);
  leg(p, 'L', -0.05 + kick, 0.2, 0.8);
  leg(p, 'R', -0.05 - kick, 0.2, 0.8);
  p.spinePitch = -0.15 * k;
  p.headPitch = -0.6 * k;
  p.face = 'shout';
}

// Prone on the belly, lowered onto the floor, arms ahead.
function bellySlide(p, c) {
  p.floorPivot = 1; // lies along floor slopes
  p.flipPitch = PI / 2 - 0.1;
  p.rootY = -52;
  arms(p, 2.75, 0.7, 0.15);
  const kick = 0.2 * Math.sin(c.t * 10);
  leg(p, 'L', -0.05, 0.5 + kick, 0.6);
  leg(p, 'R', -0.05, 0.5 - kick, 0.6);
  p.spinePitch = -0.25;
  p.headPitch = -1.2;
  p.rootX = 0.6 * Math.sin(c.t * 55);
  p.face = 'shout';
}

// Sitting on the seat of the trousers, boots up, hands trailing behind.
function buttSlide(p, c) {
  p.floorPivot = 1; // sits along floor slopes
  p.hipsY = -32;
  p.hipsPitch = -0.4;
  legs(p, 1.5, 0.35, 0.1, 0.18);
  p.spinePitch = 0.2;
  arms(p, -0.3, 0.85, 0.3);
  p.headPitch = -0.1;
  p.rootX = 0.6 * Math.sin(c.t * 50);
  p.flipRoll = 0.04 * Math.sin(c.t * 9);
  p.face = 'shout';
}

// A fast forward somersault in a tight ball before the drop.
function groundPoundSpin(p, c) {
  tuck(p);
  p.flipPitch = TAU * (1 - (1 - unit(c.t / 0.3)) ** 2);
  p.face = 'shout';
}

// Dropping butt-first: a cannonball rolled back so the seat leads, knees up at the chest,
// elbows out and fists braced either side of the knees.
function groundPoundFall(p, c) {
  p.flipPitch = -0.6;
  p.hipsY = 6;
  p.spinePitch = 0.65;
  p.headPitch = -0.1;
  legs(p, 2.2, 2.3, 0.3, 0.22);
  arms(p, 0.45, 1.05, 1.35, 0.2);
  p.rootY = -26;
  p.squash = 0.08;
  p.flipRoll = 0.04 * Math.sin(c.t * 45);
  p.face = 'shout';
}

// Push off the wall with both legs, arms flung back, then the normal jump pose.
const pushOff = createPose();
function wallkick(p, c) {
  resetPose(pushOff);
  pushOff.flipPitch = 0.35;
  pushOff.spinePitch = 0.25;
  pushOff.hipsPitch = 0.15;
  leg(pushOff, 'L', -0.9, 0.1, 0.9);
  leg(pushOff, 'R', -0.45, 1.1, 0.7);
  arms(pushOff, -1.3, 0.7, 0.2);
  pushOff.headPitch = -0.6;
  pushOff.squash = 0.12 * (1 - smoothstep(0, 0.2, c.t));
  jump(p, c);
  blendPose(p, pushOff, p, smoothstep(0.15, 0.45, c.t));
  p.face = 'shout';
}

// Slammed into a wall mid-air (the wall face is WALL_DIST ahead): tipped back from it, both
// mittens and the boot soles flat against it, head clear. Held for a couple of ticks
// before the bonk or a wall kick.
function wallBrace(p, c) {
  const hit = 1 - smoothstep(0, 0.1, c.t);
  p.flipPitch = -0.35;
  p.rootZ = 12;
  p.hipsPitch = 0.15; // the flared skirt tucked back off the wall
  p.squash = -0.08 * hit;
  p.spinePitch = -0.1;
  p.headPitch = -0.25;
  const wall = WALL_DIST - 2;
  legTo(p, 'L', wall - 19, 34, -1.35); // toes up, sole to the wall
  legTo(p, 'R', wall - 21, 20, -1.2);
  reachArm(p, 'L', 22, 104, wall - HAND_R, 1, 0.7);
  reachArm(p, 'R', -22, 104, wall - HAND_R, 1, 0.7);
  p.face = 'hurt';
}

// Knocked back off a wall: tipped back, arms and legs thrown forward, head wobbling.
function bonk(p, c) {
  const hit = 1 - smoothstep(0, 0.12, c.t);
  const f = Math.sin(c.t * 20);
  p.flipPitch = -0.35;
  p.spinePitch = -0.35;
  p.hipsPitch = -0.1;
  arm(p, 'L', 1.2 + 0.25 * f, 0.85, 0.5);
  arm(p, 'R', 1.2 - 0.25 * f, 0.85, 0.5);
  leg(p, 'L', 0.75, 0.5, 0.2, 0.1);
  leg(p, 'R', 0.45, 0.8, 0.2, 0.1);
  p.headPitch = -0.2;
  p.headRoll = 0.2 * Math.sin(c.t * 11);
  p.squash = -0.12 * hit;
  p.face = 'hurt';
}

// Flung backwards by a hit: arched back, limbs thrown forward and flailing.
function hurt(p, c) {
  const k = easeOut(c.t / 0.15);
  const f = c.t * 18;
  p.flipPitch = -0.6 * k;
  p.spinePitch = -0.35 * k;
  p.hipsPitch = -0.15 * k;
  arm(p, 'L', 0.6, 0.3 + 1.7 * k + 0.25 * Math.sin(f), 0.5);
  arm(p, 'R', 0.6, 0.3 + 1.7 * k + 0.25 * Math.sin(f + PI), 0.5);
  leg(p, 'L', 0.9 * k, 0.6, 0.3, 0.3);
  leg(p, 'R', 0.6 * k, 0.9, 0.3, 0.3);
  p.headPitch = 0.3 * k;
  p.face = 'hurt';
}

// Flying kick: leading boot out straight, other knee tucked, leaning back.
function jumpKick(p, c) {
  const k = easeOutBack(c.t / 0.12);
  p.flipPitch = -0.2 * k;
  p.spinePitch = -0.35 * k;
  leg(p, 'R', 1.5 * k, 0.05, -0.25);
  leg(p, 'L', 0.55 * k, 1.9 * k, 0.4);
  arm(p, 'L', -0.8 * k, 0.7, 0.4);
  arm(p, 'R', -0.5 * k, 0.8, 0.5);
  swellFoot(p, 'R', STRIKE_SWELL * strikeSwell(c.t, 0.12, 0.3, 0.55)); // the kicking boot
  p.headPitch = 0.2 * k;
  p.face = 'shout';
}

// Springing away from a trunk: arms up and out, one knee up.
function poleJump(p, c) {
  const k = easeOut(c.t / 0.2);
  p.squash = takeoffStretch(c.t, 0.1);
  arms(p, 0.3, 0.3 + 1.9 * k, 0.2);
  leg(p, 'L', 0.8 * k, 1.2 * k, 0.3);
  leg(p, 'R', -0.3 * k, 0.3, 0.6);
  p.spinePitch = -0.25 * k;
  p.headPitch = -0.3 * k;
  p.face = 'happy';
}

// Leaping out of the water like a dolphin: arms flung up in a V, legs together, toes pointed.
function waterJump(p, c) {
  p.squash = takeoffStretch(c.t, 0.14);
  arms(p, 0.5, 2.05, 0.2);
  legs(p, -0.1, 0.2, 0.75);
  p.flipPitch = -0.1 + 0.35 * falling(c.vy);
  p.headPitch = -0.25;
  p.face = 'happy';
}

// Hot foot: touched fire and launched straight up. A stiff, stretched jolt with the arms
// flung up, then both mittens clutch the smouldering seat of his trousers, the body pitches
// forward and the legs run frantically on thin air (BURN_STRIDES a second) while he yells
// with his head thrown back and shaking. Runs until the Player lands him.
const BURN_STRIDES = 3.2;
const SEAT = { x: 9, y: -3, z: -27 }; // mitten centres on the seat, in the pelvis frame
const seat = { x: 0, y: 0, z: 0 };
function burn(p, c) {
  const jolt = 1 - smoothstep(0.03, 0.16, c.t);
  const k = smoothstep(0.06, 0.22, c.t);
  const w = c.t * BURN_STRIDES * TAU;
  p.squash = 0.16 * jolt;
  p.rootY = 3 * Math.sin(2 * w) * k; // bobs twice a stride
  p.flipPitch = 0.45 * k;
  p.flipRoll = 0.06 * Math.sin(w + 0.6) * k; // rocks with the stride
  p.hipsPitch = 0.15 * k; // seat stuck out behind...
  p.spinePitch = -0.35 * k; // ...chest back up over it, so the short arms reach the seat
  p.headPitch = -0.35 * k - 0.25 * jolt;
  p.headRoll = 0.14 * Math.sin(c.t * 25) * k;
  p.headYaw = 0.12 * Math.sin(c.t * 17) * k;
  for (let i = 0; i < 2; i++) {
    // A cartoon wheel: the knee comes up high in front, the leg kicks out straight behind.
    const a = w + i * PI;
    leg(p, i ? 'R' : 'L', k * (0.55 + 1.0 * Math.sin(a)), 0.1 + k * (1.05 + 0.95 * Math.cos(a)), 0.2 + 0.35 * k * Math.sin(a), 0.08);
  }
  arms(p, 0.25, 0.4 + 1.5 * jolt, 0.3);
  hipsPointAt(p, SEAT.x, SEAT.y, SEAT.z, seat);
  reachArm(p, 'L', seat.x, seat.y, seat.z, k, 0.55);
  hipsPointAt(p, -SEAT.x, SEAT.y, SEAT.z, seat);
  reachArm(p, 'R', seat.x, seat.y, seat.z, k, 0.55);
  p.face = jolt > 0.5 ? 'hurt' : 'panic';
}

// Flying with the winged hat, the classic superhero way: stretched out flat along the flight
// path (the Player's pitch and roll tilt and bank the whole body about the belly), the right
// fist punched ahead beside the brim, the left arm swept back along the side, legs together
// behind with the toes pointed, head up to see ahead. A slow glide wobble on top; a dive
// (nose down) streamlines him, a climb (nose up) spreads the arms and works the legs.
function flight(p, c) {
  const dive = clamp(c.pitch / 0.6, 0, 1);
  const climb = clamp(-c.pitch / 0.5, 0, 1);
  const w = c.time;
  const wob = Math.sin(w * 2.1);
  p.flipPitch = 1.38 + 0.05 * Math.sin(w * 1.3);
  p.flipRoll = 0.07 * wob;
  p.rootY = -6 + 2.5 * Math.sin(w * 1.7 + 0.8);
  p.squash = 0.04 + 0.03 * dive;
  p.spinePitch = -0.16 - 0.06 * climb;
  p.spineYaw = 0.05 * wob;
  p.headPitch = -1.0 + 0.2 * dive;
  p.headRoll = -0.06 * wob;
  // The lead fist ahead beside the hat; the other arm back along the side (in a dive both
  // tuck in; climbing, the trailing arm swings out for balance).
  const reach = Math.sin(w * 1.9);
  arm(p, 'R', 2.62 + 0.05 * reach, 0.85 - 0.15 * dive + 0.15 * climb, 0.12, 0.1);
  arm(p, 'L', -0.35 + 0.35 * climb - 0.2 * dive, 0.45 + 0.5 * climb - 0.15 * dive, 0.35 + 0.2 * climb);
  // Legs together behind, a lazy flutter (a working kick when climbing).
  const kick = (0.06 + 0.16 * climb) * Math.sin(w * (4 + 5 * climb));
  leg(p, 'L', -0.1 + kick, 0.15 + 0.25 * climb + 0.1 * Math.max(0, kick), 0.85, 0.02);
  leg(p, 'R', -0.1 - kick, 0.15 + 0.25 * climb + 0.1 * Math.max(0, -kick), 0.85, 0.02);
  p.face = dive > 0.5 || climb > 0.6 ? 'shout' : 'open'; // wide-eyed whoops diving and climbing
}

// The take-off (the Player turns a triple jump straight into the flight): the triple jump's
// forward somersault, tucked mid-turn, rolls on round into the flight pose.
const FLY_FLIP_TIME = 0.6;
function fly(p, c) {
  flight(p, c);
  if (c.t >= FLY_FLIP_TIME) return;
  const u = c.t / FLY_FLIP_TIME;
  const end = p.flipPitch;
  const face = p.face;
  resetPose(tucked);
  tuck(tucked);
  blendPose(p, p, tucked, smoothstep(0, 0.2, u) * (1 - smoothstep(0.5, 0.95, u)));
  p.flipPitch = (TAU + end) * (1 - (1 - u) ** 2);
  p.squash += takeoffStretch(c.t, 0.1);
  p.face = u < 0.7 ? 'happy' : face;
}

// Flip anims start instantly (tiny blend) so the rotation is never delayed.
export const AIR_ANIMS = {
  jump: { pose: jump, blend: 0.06 },
  fall: { pose: fall, blend: 0.15, carryFrom: ['pole_handstand'] }, // Z: let go from the tree top
  double_jump: { pose: doubleJump, blend: 0.06 },
  triple_jump: { pose: tripleJump, blend: 0.03 },
  backflip: { pose: backflip, blend: 0.03 },
  sideflip: { pose: sideflip, blend: 0.03 },
  long_jump: { pose: longJump },
  dive: { pose: dive },
  belly_slide: { pose: bellySlide },
  butt_slide: { pose: buttSlide },
  ground_pound_spin: { pose: groundPoundSpin, blend: 0.03 },
  ground_pound_fall: { pose: groundPoundFall },
  wallkick: { pose: wallkick, blend: 0.04 },
  wall_brace: { pose: wallBrace, blend: 0.05 }, // internal: shown for the air_hit_wall action
  bonk: { pose: bonk, blend: 0.05 },
  hurt: { pose: hurt, blend: 0.05 },
  jump_kick: { pose: jumpKick, blend: 0.05 },
  pole_jump: { pose: poleJump },
  water_jump: { pose: waterJump },
  burn: { pose: burn, blend: 0.04 },
  // The take-off flip starts at once; entered mid-somersault it rolls on forward (flipIn).
  fly: { pose: fly, blend: 0.08, blendOut: 0.18, flipIn: 1 },
};
