// Every sound and music pack at once (node tests and the dev previews, which play everything;
// never the game: each pack is registered by its own chunk as it loads, see audio/packs/*).
//
//   registerAll() -> { SFX, SFX_INFO, SONGS }   // the game's tables, every pack's names in them

import { SFX, SFX_INFO } from '../sfx.js';
import { SONGS } from '../songs.js';
import { register as aiRace } from './aiRace.js';
import { register as critters } from './critters.js';
import { register as face } from './face.js';
import { registerSongs as aiRaceSongs } from './aiRaceSongs.js';
import { registerSong as hallSong } from './hallSong.js';

export function registerAll() {
  for (const register of [aiRace, critters, face]) register(SFX, SFX_INFO);
  aiRaceSongs(SONGS);
  hallSong(SONGS);
  return { SFX, SFX_INFO, SONGS };
}
