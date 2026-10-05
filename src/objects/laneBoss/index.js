// Sparrow Lane's lazy chunk (`laneBoss`, loaded through objects/laneBoss/area.js): what moves
// in the dad's drive. B1: the movable bins (LaneBins.js). (The dad's car's boss, STOMPWATT,
// joins it in later milestones.)
//
//   attach(objects, area) -> { bins }   // ObjectManager.attachLane calls it: the lane's bins made
//       movers (their colliders taken over, the grip published to the player), drawn into the
//       area's looks' bin meshes (area.parts' movers, area.real's once it is shown: setLook)
//   LaneBins, BINS_TUNING                // (tests)
//
// Node tests import this module statically and attach it themselves (om.attachLane(mod, area)):
// nothing loads it by itself there.

import { LaneBins } from './LaneBins.js';

export { LaneBins } from './LaneBins.js';
export { BINS_TUNING } from './tuning.js';

export function attach(objects, area) {
  const layout = area.objectsLayout;
  const bins = layout.MOVABLE_BINS?.length ? new LaneBins({ collision: area.collision, events: objects.events, layout, meshes: area.parts.map((p) => p.movers?.bins).filter(Boolean) }) : null;
  return { bins };
}
