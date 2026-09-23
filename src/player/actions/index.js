// Registry of every player action, keyed by name. Each action is
// { group, anim?, enter?(player, arg), update(player, controller) -> boolean }: `anim` is
// shown from the moment the action starts; update returns true when it switched action and
// the new action should run in the same tick.

import { STATIONARY_ACTIONS } from './stationary.js';
import { MOVING_ACTIONS } from './moving.js';
import { AIRBORNE_ACTIONS } from './airborne.js';
import { SUBMERGED_ACTIONS } from './submerged.js';
import { AUTOMATIC_ACTIONS } from './automatic.js';

export { enterWater } from './submerged.js';

export const ACTIONS = {
  ...STATIONARY_ACTIONS,
  ...MOVING_ACTIONS,
  ...AIRBORNE_ACTIONS,
  ...SUBMERGED_ACTIONS,
  ...AUTOMATIC_ACTIONS,
};
