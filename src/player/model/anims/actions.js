// Attacks, hard landings and the scripted moments: punches, kicks, ground-pound impact,
// fall damage, the star celebration, the spawn landing and the death spin.

import {
  PI, TAU, smoothstep, unit, easeIn, easeOut, easeOutBack, hump, arm, arms, leg, legs, stand, plantLeg, plantFeet,
  keyframes, swellHand, swellFoot, strikeSwell, STRIKE_SWELL, PUNCH_SWELL,
} from '../kit.js';

// Jab curve: snaps out in 0.06 s, holds briefly, pulls back by ~0.3 s.
const jab = (t) => (t < 0.06 ? easeOut(t / 0.06) : 1 - smoothstep(0.14, 0.32, t));

// side: the punching arm. The opposite foot leads and the hips and chest turn into the
// blow, but only part way: the arm swings level and a little out to the side, so the
// fist lands ahead of the punching shoulder, clear of the body and head as seen from the
// follow camera behind Pip.
function punch(p, c, side) {
  const other = side === 'R' ? 'L' : 'R';
  const s = side === 'R' ? 1 : -1;
  const e = jab(c.t);
  // Small lunge into the blow from a stance set back behind rs.pos, so the fist (not the
  // face) meets a wall Pip is standing at.
  p.rootZ = -10 + 5 * e;
  p.hipsY = -6;
  p.hipsPitch = 0.1;
  plantLeg(p, other, 2);
  plantLeg(p, side, -20);
  p.spinePitch = 0.12 + 0.03 * e;
  p.spineYaw = s * (-0.25 + 0.4 * e);
  p.hipsYaw = s * 0.1 * e;
  p.headYaw = -p.spineYaw * 0.7;
  arm(p, side, 0.95 + 0.8 * e, 0.12 + 0.55 * e, 1.7 * (1 - e) + 0.05);
  arm(p, other, 1.0, 0.3, 1.85, 0.3); // guard
  // The fist balloons (~2.1x) as the arm snaps out, stays big through the hit, deflates
  // on the way back.
  swellHand(p, side, PUNCH_SWELL * strikeSwell(c.t, 0.06, 0.15, 0.3));
  p.face = 'shout';
}

// Side kick: hips turn the right side toward the target and the leg snaps out sideways
// while the upper body leans away and keeps facing forward.
function kick(p, c) {
  const e = c.t < 0.08 ? easeOut(c.t / 0.08) : 1 - smoothstep(0.22, 0.45, c.t);
  const chamber = hump(unit(c.t / 0.16)) * 0.6;
  p.hipsY = -5;
  p.hipsYaw = 1.0 * e;
  p.spineYaw = -0.75 * e;
  p.spineRoll = -0.35 * e;
  p.headYaw = -0.3 * e;
  plantLeg(p, 'L', 2);
  leg(p, 'R', 0.2 + 0.3 * e, 0.2 + 1.2 * chamber, 0.1, 1.42 * e);
  arm(p, 'L', 0.3, 0.3 + 1.1 * e, 0.6);
  arm(p, 'R', 0.9, 0.6, 1.5);
  // The boot swells once it is off the floor and deflates before the leg comes back down.
  swellFoot(p, 'R', STRIKE_SWELL * strikeSwell(c.t - 0.03, 0.08, 0.16, 0.3));
  p.face = 'shout';
}

// Landing from a ground pound: deep squashed crouch with arms flung out, then recover.
function groundPoundLand(p, c) {
  const d = c.t < 0.04 ? 1 : 1 - smoothstep(0.04, 0.5, c.t);
  p.rootZ = -16 * d; // hips sit back so the head stays over the boots
  p.hipsY = -2 - 26 * d;
  p.squash = -0.2 * d;
  p.spinePitch = 0.1 + 0.35 * d;
  plantFeet(p, 8, -6);
  p.legLSpread = p.legRSpread = 0.2 * d;
  arms(p, -0.2 * d, 0.3 + 1.2 * d, 0.4);
  p.headPitch = 0.15 * d;
  p.face = d > 0.3 ? 'hurt' : 'open';
}

// Landed too hard: sprawled on the seat, propped on the hands, head circling dizzily.
function fallDamage(p, c) {
  const hit = 1 - smoothstep(0, 0.2, c.t);
  const w = c.t * 5;
  p.hipsY = -34;
  p.hipsPitch = -0.35;
  leg(p, 'L', 1.25, 0.3, -0.2, 0.5);
  leg(p, 'R', 1.1, 0.5, -0.2, 0.45);
  p.spinePitch = 0.1 + 0.08 * Math.sin(c.t * 4.5);
  p.spineRoll = 0.08 * Math.sin(w);
  arms(p, -0.55, 0.5, 0.15);
  p.headRoll = 0.22 * Math.sin(w);
  p.headPitch = 0.12 + 0.1 * Math.cos(w);
  p.squash = -0.15 * hit;
  p.face = 'dizzy';
}

// Star celebration: crouch, spinning leap with arms up, land, then a fist pump.
const STAR_KEYS = [
  [0, stand],
  [0.22, (q) => {
    q.hipsY = -14;
    q.spinePitch = 0.3;
    plantFeet(q, 5, -4);
    arms(q, -0.6, 0.4, 0.3);
  }],
  [0.4, (q) => {
    q.rootY = 40;
    arms(q, 0.35, 2.05, 0.15);
    legs(q, 0.4, 0.9, 0.5, 0.15);
    q.headPitch = -0.3;
  }],
  [0.7, (q) => {
    q.rootY = 45;
    arms(q, 0.35, 2.05, 0.15);
    legs(q, 0.2, 0.5, 0.5, 0.2);
    q.headPitch = -0.3;
  }],
  [0.9, (q) => {
    q.hipsY = -12;
    q.squash = -0.1;
    plantFeet(q, 6, -6);
    arms(q, 0.2, 1.2, 0.3);
  }],
  [1.15, (q) => {
    q.spinePitch = -0.12;
    q.spineRoll = -0.2; // lean away from the raised fist so it clears the hat brim
    q.headRoll = -0.1;
    q.hipsY = -2;
    plantFeet(q, 6, -6);
    arm(q, 'R', 0.55, 2.0, 0.6); // fist up and out beside the hat
    arm(q, 'L', -0.3, 0.75, 1.9, -0.8); // hand on hip
    q.headPitch = -0.35;
  }],
];

function starDance(p, c) {
  keyframes(p, c.t, STAR_KEYS, c);
  p.flipYaw = TAU * easeOut((c.t - 0.3) / 0.55);
  // Three quick pumps of the raised fist.
  const pump = c.t > 1.2 && c.t < 2.1 ? Math.max(0, Math.sin((c.t - 1.2) * 3 * TAU / 0.9)) : 0;
  p.elbowR += 0.9 * pump;
  p.armRRaise -= 0.25 * pump;
  p.hipsY -= 3 * pump;
  p.face = 'happy';
}

// Dropping into the level from the sky (the Player plays 'land' for the touchdown): arms
// flung up in a V, knees tucked, turning a lazy full circle that settles by ~0.8 s.
function spawn(p, c) {
  const k = easeOutBack(c.t / 0.35);
  arms(p, 0.35, 0.3 + 1.75 * k, 0.2);
  leg(p, 'L', 0.7 * k, 1.1 * k, 0.4);
  leg(p, 'R', 0.35 * k, 0.8 * k, 0.5);
  p.flipYaw = TAU * easeOut(c.t / 0.8);
  p.spinePitch = -0.1 * k;
  p.headPitch = -0.3 * k;
  p.face = 'happy';
}

// Spins on the spot, slowing down, then topples over backwards.
function death(p, c) {
  const u = unit(c.t / 1.1);
  const fallBack = easeIn(unit((c.t - 0.9) / 0.5));
  p.flipYaw = 3 * TAU * easeOut(u);
  p.flipPitch = -PI / 2 * fallBack;
  p.rootY = -54 * fallBack;
  arms(p, 0.3, 0.3 + 1.1 * hump(u) + 1.1 * fallBack, 0.4);
  legs(p, 0.2 + 0.3 * fallBack, 0.3, 0.2, 0.15 + 0.2 * fallBack);
  p.headRoll = 0.3 * Math.sin(c.t * 9) * (1 - fallBack);
  p.headPitch = 0.3 * fallBack;
  p.face = 'dizzy';
}

export const ACTION_ANIMS = {
  punch1: { pose: (p, c) => punch(p, c, 'R'), blend: 0.05 },
  punch2: { pose: (p, c) => punch(p, c, 'L'), blend: 0.05 },
  kick: { pose: kick, blend: 0.05 },
  ground_pound_land: { pose: groundPoundLand, blend: 0.04 },
  fall_damage: { pose: fallDamage, blend: 0.05 },
  star_dance: { pose: starDance, blend: 0.1 },
  spawn: { pose: spawn, blend: 0.05 },
  death: { pose: death, blend: 0.1 },
};
