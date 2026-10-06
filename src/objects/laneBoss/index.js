// Sparrow Lane's lazy chunk (`laneBoss`, a child of the lane's chunk: world/lane/index.js
// loadBoss, which objects/laneBoss/area.js calls): what moves
// in the dad's drive. The movable bins (LaneBins.js), STOMPWATT, the dad's car standing up into a
// robot made of its own panels (LaneBoss.js: its model, rig, poses, camera and sounds), and the
// store room's doors under the carport, kicked to pieces (LaneGarage.js: the room's classic
// things, garageRoom.js; its camera, garageCam.js).
//
//   attach(objects, area, { boss }) -> { bins, boss, garage, camera }   // ObjectManager.attachLane
//       calls it: the lane's bins made movers (their colliders taken over, the grip published to
//       the player), drawn into the area's looks' bin meshes (area.parts' movers, area.real's once
//       it is shown: setLook); the boss (its sounds registered into the game's SFX table, its
//       fight's music into SONGS with its handclap into INSTRUMENTS); boss: false leaves it out
//       (tests about the bins alone); the garage doors (their leaves in the area's looks' meshes:
//       part.garage); camera: the lane's camera overlay (the boss's, then the room's: laneOverlay)
//   LaneBins, BINS_TUNING, LaneBoss, BOSS   // (tests; the garage's: LaneGarage.js, garageCam.js)
//
// Node tests import this module statically and attach it themselves (om.attachLane(mod, area)):
// nothing loads it by itself there.

import { LaneBins } from './LaneBins.js';
import { LaneBoss } from './LaneBoss.js';
import { LaneGarage } from './LaneGarage.js';
import { laneOverlay } from './garageCam.js';
import { register, registerSong } from './audio.js';
import { SFX, SFX_INFO } from '../../audio/sfx.js';
import { SONGS } from '../../audio/songs.js';
import { INSTRUMENTS, CHANNELS } from '../../audio/instruments.js';
import * as LANE from '../../world/lane/layout.js';

export const chunk = 'laneBoss'; // (src/core/chunks.js: its name)
export { LaneBins } from './LaneBins.js';
export { LaneBoss } from './LaneBoss.js';
export { BINS_TUNING, BOSS } from './tuning.js';

export function attach(objects, area, { boss = true } = {}) {
  const layout = area.objectsLayout;
  const bins = layout.MOVABLE_BINS?.length ? new LaneBins({ collision: area.collision, events: objects.events, layout, meshes: area.parts.map((p) => p.movers?.bins).filter(Boolean) }) : null;
  let laneBoss = null;
  register(SFX, SFX_INFO); // (the bins' sounds and the robot's)
  if (boss && layout.NAMED?.[LANE.LANE_BOSS.car]) {
    registerSong(SONGS, INSTRUMENTS, CHANNELS);
    laneBoss = new LaneBoss({ objects, area, layout: LANE });
  }
  // The store room's doors (with the lane's leaves drawn: its parts' piece tables).
  const garage = area.parts.some((p) => p.garage) && layout.NAMED?.garage_0 ? new LaneGarage({ objects, area, layout: LANE }) : null;
  if (garage && laneBoss) {
    garage.boss = laneBoss;
    laneBoss.garage = garage;
  }
  return { bins, boss: laneBoss, garage, camera: laneOverlay(laneBoss?.camera, garage?.camera) };
}
