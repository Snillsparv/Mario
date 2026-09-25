// Where Pip's attacks can hit this tick (player.getAttack, read by objects after the tick):
// a sphere { x, y, z, radius, kind } in front of or around him, or null. `kind` names the
// move: 'punch1' | 'punch2' | 'kick' (the punch combo's steps), 'jump_kick', 'dive',
// 'belly_slide' (only while still sliding fast), 'ground_pound_land' (the landing ticks),
// 'flying' (the flying body, see flying.js) and 'cannon_shot' (the same, shot out of the
// cannon). Timings count the ticks since the move (or the combo step) began, the current tick
// being 1 (actionTimer after the tick).

import { CENTER } from '../model/dims.js';

// ahead: sphere centre ahead of the feet along the facing; up: above the feet; side: to his
// right (< 0: left). The punches and the kick sit around the striking mitten / boot as the
// hero model poses them (jab: right mitten ~38 to the side, ~45 ahead, ~75 up; cross: the
// left one mirrored; side kick: right boot ~30 to the side, 25-40 ahead, ~30 up), a little
// generous but not reaching past them by more than a hand.
const PUNCH1 = { ahead: 45, up: 80, side: 18, radius: 55, from: 1, to: 5 }; // the jab's snap-out and hold
const PUNCH2 = { ...PUNCH1, side: -18 };
const KICK = { ahead: 45, up: 40, side: 25, radius: 60, from: 2, to: 8 }; // the leg out
const JUMP_KICK = { ahead: 60, up: 70, side: 0, radius: 80, from: 1, to: 15 }; // the boot out
const DIVE = { ahead: 50, up: 50, side: 0, radius: 90 };
const POUND = { ahead: 0, up: 20, side: 0, radius: 160, to: 2 }; // the landing tick and the next
const FLY = { ahead: 30, up: CENTER, side: 0, radius: 90 };
const COMBO = [PUNCH1, PUNCH2, KICK];
const BELLY_SLIDE_MIN_SPEED = 12;
const PUNCH_KINDS = ['punch1', 'punch2', 'kick'];

function zone(p, out, kind, z) {
  const s = Math.sin(p.faceYaw);
  const c = Math.cos(p.faceYaw);
  // Facing (s, c); his right is (-c, s).
  out.x = p.pos.x + s * z.ahead - c * z.side;
  out.y = p.pos.y + z.up;
  out.z = p.pos.z + c * z.ahead + s * z.side;
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
      const z = COMBO[step];
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
    case 'cannon_shot': // shot out of the cannon: the body flying head first (actions/cannon.js)
      return zone(p, out, 'cannon_shot', FLY);
    default:
      return null;
  }
}
