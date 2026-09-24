// Where Pip's attacks can hit this tick (player.getAttack, read by objects after the tick):
// a sphere { x, y, z, radius, kind } in front of or around him, or null. `kind` names the
// move: 'punch1' | 'punch2' | 'kick' (the punch combo's steps), 'jump_kick', 'dive',
// 'belly_slide' (only while still sliding fast), 'ground_pound_land' (the landing ticks) and
// 'flying' (the flying body, see flying.js). Timings count the ticks since the move (or the
// combo step) began, the current tick being 1 (actionTimer after the tick).

import { CENTER } from '../model/dims.js';

// ahead: sphere centre ahead of the feet along the facing; up: above the feet.
const PUNCH = { ahead: 55, up: 90, radius: 70, from: 1, to: 5 }; // the jab's snap-out and hold
const KICK = { ahead: 75, up: 60, radius: 80, from: 2, to: 8 }; // the leg out
const JUMP_KICK = { ahead: 60, up: 70, radius: 80, from: 1, to: 15 }; // the boot out
const DIVE = { ahead: 50, up: 50, radius: 90 };
const POUND = { ahead: 0, up: 20, radius: 160, to: 2 }; // the landing tick and the next
const FLY = { ahead: 30, up: CENTER, radius: 90 };
const BELLY_SLIDE_MIN_SPEED = 12;
const PUNCH_KINDS = ['punch1', 'punch2', 'kick'];

function zone(p, out, kind, z) {
  out.x = p.pos.x + Math.sin(p.faceYaw) * z.ahead;
  out.y = p.pos.y + z.up;
  out.z = p.pos.z + Math.cos(p.faceYaw) * z.ahead;
  out.radius = z.radius;
  out.kind = kind;
  return out;
}

const within = (t, z) => t >= z.from && t <= z.to;

// Fills `out` and returns it, or returns null when nothing can hit this tick.
export function attackZone(p, out) {
  switch (p.action) {
    case 'punch': {
      const t = p.actionTimer - (p.punchStart ?? 0);
      const step = p.punchStep;
      const z = step === 2 ? KICK : PUNCH;
      return within(t, z) ? zone(p, out, PUNCH_KINDS[step], z) : null;
    }
    case 'jump_kick':
      return within(p.actionTimer, JUMP_KICK) ? zone(p, out, 'jump_kick', JUMP_KICK) : null;
    case 'dive':
      return zone(p, out, 'dive', DIVE);
    case 'belly_slide':
      return p.forwardVel >= BELLY_SLIDE_MIN_SPEED ? zone(p, out, 'belly_slide', DIVE) : null;
    case 'ground_pound_land':
      return p.actionTimer <= POUND.to ? zone(p, out, 'ground_pound_land', POUND) : null;
    case 'flying':
      return zone(p, out, 'flying', FLY);
    default:
      return null;
  }
}
