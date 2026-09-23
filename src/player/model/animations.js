// Registry of every AnimName (docs/ARCHITECTURE.md) -> { pose(p, c), blend? }.
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
