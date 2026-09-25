// Shot out of the cannon (action 'cannon_shot', actions/cannon.js): a human cannonball
// stretched out straight like a dart along the arc (the Player's RenderState pitch tilts the
// whole body about the belly to follow it), both mittens thrust ahead in a narrow V past the
// hat's brim, legs together and straight behind with the toes pointed, head up to see where
// he is going, yelling. He leaves the muzzle stretched long (the squash settles over
// ~0.35 s) and turns a slow corkscrew roll about the flight line (flipYaw: the body spins
// about its own long axis before it is laid flat), with a little flutter in the boots.

import { PI, smoothstep, arms, leg } from '../kit.js';

const ROLL_RATE = 2.4; // radians per second: about one turn in 2.6 s
const FLAT = PI / 2 - 0.08; // laid out flat along the flight line (the arc's pitch comes on top)

function cannonShot(p, c) {
  p.flipPitch = FLAT; // (already stretched out as he leaves the muzzle)
  p.flipYaw = c.t * ROLL_RATE;
  p.squash = 0.06 + 0.12 * (1 - smoothstep(0, 0.35, c.t));
  arms(p, 2.85, 0.42, 0.05);
  const flutter = 0.06 * Math.sin(c.t * 17);
  leg(p, 'L', -0.08 + flutter, 0.06, 0.9, 0.03);
  leg(p, 'R', -0.08 - flutter, 0.06, 0.9, 0.03);
  p.spinePitch = -0.12;
  p.headPitch = -0.8;
  p.face = 'shout';
}

export const CANNON_ANIMS = {
  // (It starts at once: the muzzle blast has him stretched out from the first frame.)
  cannon_shot: { pose: cannonShot, blend: 0.04, blendOut: 0.12 },
};
