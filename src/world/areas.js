// Every area with its code, statically: world/areaDefs.js's definitions (the game's: their code
// loads lazily, def.code) with each area's builders merged in, so a def builds at once
// (core/AreaSwitch.js get) without waiting for a chunk. Node tests and the dev previews import
// this; the game imports world/areaDefs.js (main must not reach the areas' code statically:
// tests/net-relay-build.test.js checks their chunks).
//
//   AREA_DEFS[name] = AreaDef with `builders` (world/areaDefs.js)
//   groundsArea, HALL_ATMOSPHERE, SKERRIES_ATMOSPHERE, LANE_ATMOSPHERE   // as there

import { AREA_DEFS as LAZY } from './areaDefs.js';
import * as hall from './hall/index.js';
import * as skerries from './skerries/index.js';
import * as lane from './lane/index.js';

export { groundsArea, HALL_ATMOSPHERE, SKERRIES_ATMOSPHERE, LANE_ATMOSPHERE } from './areaDefs.js';

const CODE = { hall, skerries, lane };

export const AREA_DEFS = Object.fromEntries(Object.entries(LAZY).map(([name, def]) => [name, CODE[name] ? { ...def, builders: CODE[name].builders } : def]));
