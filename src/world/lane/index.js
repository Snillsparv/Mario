// Sparrow Lane's classic code, the lazy chunk `lane` (src/core/chunks.js; world/areaDefs.js
// def.code): its builders; and the loaders of its own children, each a chunk of its own loaded
// through this one (so they may import what it holds, as look.js does lane/build.js): the
// realistic look's main-thread code (`realLook`: world/lane/real/jobs.js LANE_REAL_AREA.load) and
// what moves in the dad's drive (`laneBoss`: objects/laneBoss/area.js LANE_BOSS_AREA.load). Its
// layout and entries stay in main (world/areaDefs.js).
import { once } from '../../core/chunks.js';
import { buildLane } from './build.js';

export const chunk = 'lane'; // (src/core/chunks.js: its name)
export const builders = [buildLane];
export const loadRealLook = once(() => import('./real/realLook.js'), 'realLook');
export const loadBoss = once(() => import('../../objects/laneBoss/index.js'), 'laneBoss');
