// Registry of every AnimName (docs/ARCHITECTURE.md) -> { pose(p, c), blend?, blendOut?,
// carryFrom?, flipIn? }: blend = cross-fade time into the anim (s), blendOut = the least
// cross-fade time into whatever follows it, carryFrom = anims whose switch to this one moves
// rs.pos to a new anchor that the animator carries over, flipIn = +1 to only ever pitch
// forward into the anim (a somersault rolls on into it instead of unwinding; animator.js).
import { GROUND_ANIMS } from './anims/ground.js';
import { AIR_ANIMS } from './anims/air.js';
import { ACTION_ANIMS } from './anims/actions.js';
import { CLIMB_ANIMS } from './anims/climb.js';
import { WATER_ANIMS } from './anims/water.js';

export const ANIMS = { ...GROUND_ANIMS, ...AIR_ANIMS, ...ACTION_ANIMS, ...CLIMB_ANIMS, ...WATER_ANIMS };

export const ANIM_NAMES = Object.keys(ANIMS);

export const DEFAULT_BLEND = 0.1;

// Unknown names fall back to idle.
export function resolveAnim(name) {
  return Object.hasOwn(ANIMS, name) ? name : 'idle';
}
