// The Great Hall's code, the lazy chunk `hall` (src/core/chunks.js; world/areaDefs.js def.code):
// its builders. Its layout and entries stay in main (world/areaDefs.js).
import { buildHall } from './hall.js';

export const chunk = 'hall'; // (src/core/chunks.js: its name)
export const builders = [buildHall];
