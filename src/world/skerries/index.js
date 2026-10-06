// Midsummer Skerries' code, the lazy chunk `skerries` (src/core/chunks.js; world/areaDefs.js
// def.code): its builders, and its critters (objects/Critters.js registers itself in
// objects/kinds.js as it is evaluated: ObjectManager makes the course's from there). Its layout
// and entries stay in main (world/areaDefs.js).
import { buildSkerries } from './build.js';
import { buildSea } from './sea.js';
import { Critters } from '../../objects/Critters.js';

export const chunk = 'skerries'; // (src/core/chunks.js: its name)
export const builders = [buildSkerries, buildSea];
export const kinds = { Critters };
