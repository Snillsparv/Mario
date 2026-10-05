// Sparrow Lane's lazy chunk (`laneBoss`, loaded through objects/laneBoss/area.js): what moves
// in the dad's drive. The movable bins (LaneBins.js) and STOMPWATT, the dad's car standing up
// into a robot made of its own panels (LaneBoss.js: its model, rig, poses, camera and sounds).
//
//   attach(objects, area, { boss }) -> { bins, boss }   // ObjectManager.attachLane calls it: the
//       lane's bins made movers (their colliders taken over, the grip published to the player),
//       drawn into the area's looks' bin meshes (area.parts' movers, area.real's once it is shown:
//       setLook); the boss (its sounds registered into the game's SFX table, its fight's music
//       into SONGS with its handclap into INSTRUMENTS); boss: false leaves
//       it out (tests about the bins alone)
//   LaneBins, BINS_TUNING, LaneBoss, BOSS   // (tests)
//
// Node tests import this module statically and attach it themselves (om.attachLane(mod, area)):
// nothing loads it by itself there.

import { LaneBins } from './LaneBins.js';
import { LaneBoss } from './LaneBoss.js';
import { register, registerSong } from './audio.js';
import { SFX, SFX_INFO } from '../../audio/sfx.js';
import { SONGS } from '../../audio/songs.js';
import { INSTRUMENTS, CHANNELS } from '../../audio/instruments.js';
import * as LANE from '../../world/lane/layout.js';

export { LaneBins } from './LaneBins.js';
export { LaneBoss } from './LaneBoss.js';
export { BINS_TUNING, BOSS } from './tuning.js';

export function attach(objects, area, { boss = true } = {}) {
  const layout = area.objectsLayout;
  const bins = layout.MOVABLE_BINS?.length ? new LaneBins({ collision: area.collision, events: objects.events, layout, meshes: area.parts.map((p) => p.movers?.bins).filter(Boolean) }) : null;
  let laneBoss = null;
  if (boss && layout.NAMED?.[LANE.LANE_BOSS.car]) {
    register(SFX, SFX_INFO);
    registerSong(SONGS, INSTRUMENTS, CHANNELS);
    laneBoss = new LaneBoss({ objects, area, layout: LANE });
  }
  return { bins, boss: laneBoss };
}
