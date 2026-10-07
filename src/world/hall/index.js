// The Great Hall's code, the lazy chunk `hall` (src/core/chunks.js; world/areaDefs.js def.code):
// its builders, and its track. Its layout and entries stay in main (world/areaDefs.js).
import { buildHall } from './hall.js';
import { SONGS } from '../../audio/songs.js';
import { registerSong } from '../../audio/packs/hallSong.js';

export const chunk = 'hall'; // (src/core/chunks.js: its name)
export const builders = [buildHall];

registerSong(SONGS); // "Compass and Candle", the hall's track (audio/packs/hallSong.js)
