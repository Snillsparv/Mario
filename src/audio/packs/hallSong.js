// The Great Hall's track (audio/songs.js's notation), a pack of the hall chunk
// (world/hall/index.js registers it as it loads: it plays only in the hall).
//
//   CASTLE_HALL, registerSong(songs)

// "Compass and Candle" - the Great Hall's loop. G major, 3/4, 92 bpm, 24 bars (~47 s loop).
// A music box in a warm room: a glockenspiel tune over rippling harp arpeggios, soft strings
// and a waltz bass, no drums. A (1-8) swings out from the tonic and comes to rest on the
// dominant; B (9-16) climbs through the relative minor to the tune's high point (a high B over
// Em) and leans on D7; A' (17-24) brings the tune back and closes on G, the last bar's D7
// turning the loop round. The engine plays it while Jonas is in the hall (world/areaDefs.js
// def.audio.music), fading it in as the picture opens. Its level is higher than the busier
// songs' so the sparse music box sounds about as loud as they do (the polska and the arrival
// cue are a decibel louder in a render), not a drop on the way in.
export const CASTLE_HALL = {
  title: 'Compass and Candle',
  level: 1.2,
  fadeIn: 1,
  key: 'G',
  bpm: 92,
  beatsPerBar: 3,
  swing: 0,
  lead: 'glock',
  mix: { glock: 1.6, harp: 1.6 }, // a music box's tune on the bell alone, the harp ringing round it
  chords: [
    // A
    'G', 'Em', 'C', 'D', 'G', 'Bm', 'Am7:2 D7:1', 'G',
    // B
    'Em', 'C', 'Am', 'D', 'Em', 'C', 'Am7:2 D7:1', 'D7',
    // A'
    'G', 'Em', 'C', 'D', 'G/B', 'C', 'Am7:2 D7:1', 'G:2 D7:1',
  ],
  sections: [
    { from: 1, to: 8, pad: 0.28, bass: 'waltz', comp: 'arp', drums: 'none' },
    { from: 9, to: 16, pad: 0.34, bass: 'waltz', comp: 'arp', drums: 'none' },
    { from: 17, to: 24, pad: 0.3, bass: 'waltz', comp: 'arp', drums: 'none' },
  ],
  parts: [
    {
      inst: 'glock',
      vel: 0.9,
      bars: {
        1: 'B5:1.5 C6:.5 D6:1',
        2: 'G6:2 E6:1',
        3: 'E6:1 D6:.5 C6:.5 B5:1',
        4: 'A5:3',
        5: 'B5:1.5 C6:.5 D6:1',
        6: 'F#6:2 D6:1',
        7: 'E6:.5 D6:.5 C6:1 A5:1',
        8: 'G5:2 D5:1',
        9: 'E6:.5 F#6:.5 G6:1 E6:1',
        10: 'C6:.5 D6:.5 E6:1 C6:1',
        11: 'A5:.5 B5:.5 C6:1 E6:1',
        12: 'F#6:1.5 E6:.5 D6:1',
        13: 'E6:.5 F#6:.5 G6:1 B6:1',
        14: 'A6:1.5 G6:.5 E6:1',
        15: 'F#6:1 E6:1 D6:1',
        16: 'C6:1 B5:.5 C6:.5 A5:1',
        17: 'B5:1.5 C6:.5 D6:1',
        18: 'G6:2 E6:1',
        19: 'E6:1 D6:.5 C6:.5 B5:1',
        20: 'A5:2 B5:.5 C6:.5',
        21: 'D6:1 G6:1 F#6:1',
        22: 'E6:1.5 D6:.5 C6:1',
        23: 'B5:1 A5:1 F#5:1',
        24: 'G5:2 D5:1',
      },
    },
  ],
};

// Into the game's SONGS (a name there already stays).
export function registerSong(songs) {
  if (!Object.hasOwn(songs, 'castle_hall')) songs.castle_hall = CASTLE_HALL;
}
