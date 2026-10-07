// AI RACE's two tracks (audio/songs.js's notation), a pack of the aiRace chunk
// (objects/aiRace.js registers them as it loads: they play only in AI RACE mode).
//
//   DARK, FLY_DARK, registerSongs(songs)

// "Signal Lost" - AI RACE mode loop. D minor, 4/4, 76 bpm, 24 bars (~76 s loop).
// Slow and cold: a breathing synth pad over a throbbing low bass, a ticking clock, heavy
// thumps and struck steel. A (1-8): pad, pulse and steel with a few glassy pings; B (9-16):
// the glass lead enters as the harmony leans from the tonic onto the Phrygian flat two
// (Eb) and back; C (17-24): the lead climbs over the fuller kit, and the Asus4 - A half
// cadence (the steel hammering four times) turns the loop back into D minor. The engine
// plays it itself while the storm mode is on, fading it in with the picture (fadeIn).
export const DARK = {
  title: 'Signal Lost',
  level: 0.6,
  fadeIn: 3,
  key: 'D',
  mode: 'minor',
  bpm: 76,
  beatsPerBar: 4,
  swing: 0,
  roles: { pad: 'darkpad', bass: 'pulse' },
  lead: 'glass',
  bassLow: 33, // roots from A1 up: a low throb
  chords: [
    // A
    'Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'Eb', 'A',
    // B
    'Dm', 'Eb', 'Dm', 'Eb', 'Bb', 'Gm', 'Asus4', 'A',
    // C
    'Gm', 'Eb', 'Bb', 'A', 'Dm', 'Eb', 'Asus4', 'A',
  ],
  sections: [
    { from: 1, to: 8, pad: 0.8, bass: 'pulse', comp: 'none', drums: 'sparse' },
    { from: 9, to: 16, pad: 0.85, bass: 'pulse', comp: 'none', drums: 'industrial' },
    { from: 17, to: 24, pad: 1, bass: 'pulse', comp: 'none', drums: 'industrial' },
  ],
  parts: [
    {
      inst: 'glass',
      vel: 0.8,
      bars: {
        4: 'r:2 F5:2',
        6: 'r:2 D5:1 Bb4:1',
        8: 'r:2 C#5:2',
        9: 'A4:3 F4:1',
        10: 'G4:4',
        11: 'A4:2 D5:1.5 C5:.5',
        12: 'Bb4:4',
        13: 'D5:3 F5:1',
        14: 'E5:1.5 D5:.5 Bb4:2',
        15: 'A4:4',
        16: 'C#5:2 E5:2',
        17: 'D5:2 Bb4:1 G4:1',
        18: 'G4:3 Bb4:1',
        19: 'F5:2 D5:1.5 F5:.5',
        20: 'E5:4',
        21: 'F5:1 E5:.5 D5:.5 A4:2',
        22: 'G5:2 Eb5:2',
        23: 'D5:3 E5:1',
        24: 'C#5:4',
      },
    },
    {
      // Struck steel on the phrase downbeats, hammering into the turnarounds.
      inst: 'clang',
      vel: 0.8,
      bars: {
        1: 'D3:4',
        5: 'G2:4',
        7: 'r:2 Bb2:2',
        8: 'A2:4',
        9: 'D3:4',
        11: 'D3:2 D3:2',
        13: 'Bb2:4',
        15: 'r:2 A2:2',
        16: 'A2:2 A2:1 A2:1',
        17: 'G2:4',
        19: 'Bb2:4',
        20: 'A2:2 A2:2',
        21: 'D3:4',
        23: 'r:2 A2:2',
        24: 'A2:1 A2:1 A2:1 A2:1',
      },
    },
  ],
};

// "Updraft in the Storm" - the flying theme in AI RACE mode. The same tune and form as
// "Updraft" turned to D minor (the storm drone's and "Signal Lost"'s key) over the dark
// track's sounds: breathing synth pad, a throbbing low pulse, a snapping synth arpeggio,
// metal percussion and struck steel. The E major lift becomes the flat two (Eb), and the
// dominant keeps its raised third (A major) for the pull home; the opening leap goes up a
// full octave (the sixth would grind against the minor chord's fifth).
export const FLY_DARK = {
  title: 'Updraft in the Storm',
  level: 0.55,
  fadeIn: 1.2,
  key: 'D',
  mode: 'minor',
  bpm: 120,
  beatsPerBar: 4,
  swing: 0,
  roles: { pad: 'darkpad', bass: 'pulse', comp: 'synarp' },
  lead: 'brass',
  bassLow: 33,
  mix: { synarp: 1.5, clang: 1.6 },
  chords: [
    // intro
    'Dm', 'Eb/D',
    // A
    'Dm', 'C', 'Bb', 'Gm', 'Am', 'Eb', 'Gm A', 'Dm',
    // A'
    'Dm', 'C', 'Bb', 'Gm', 'Am', 'Eb', 'Gm A', 'Dm',
    // B
    'Bb', 'Gm', 'C A', 'F', 'Gm A', 'Bb C',
  ],
  sections: [
    { from: 1, to: 2, pad: 0.7, bass: 'pulse', comp: 'arp', drums: 'sparse' },
    { from: 3, to: 10, pad: 0.6, bass: 'pulse', comp: 'arp', drums: 'industrial' },
    { from: 11, to: 18, pad: 0.65, bass: 'pulse', comp: 'arp', drums: 'rush' },
    { from: 19, to: 24, pad: 0.75, bass: 'pulse', comp: 'arp', drums: 'rush' },
  ],
  parts: [
    {
      inst: 'brass',
      vel: 0.85,
      bars: {
        1: 'D6:4',
        2: 'r:2 G4:1 Bb4:1',
        3: 'D5:.5 F5:.5 D6:1.5 A5:.5 F5:1',
        4: 'E5:1.5 F5:.5 A5:2',
        5: 'Bb5:1 F5:1.5 E5:.5 D5:1',
        6: 'D5:.5 E5:.5 G5:1 Bb5:2',
        7: 'A5:1 G5:.5 E5:.5 D5:1 E5:1',
        8: 'G5:1 A5:.5 Bb5:.5 C6:2',
        9: 'D6:1.5 Bb5:.5 C#6:1 A5:1',
        10: 'A5:3 F5:.5 A4:.5',
        11: 'D5:.5 F5:.5 D6:1.5 A5:.5 F5:1',
        12: 'E5:1.5 F5:.5 A5:1 C6:1',
        13: 'D6:1 C6:.5 Bb5:.5 F5:2',
        14: 'G5:.5 A5:.5 Bb5:1 D6:2',
        15: 'E6:1.5 D6:.5 C6:1 A5:1',
        16: 'G5:1 Bb5:1 Eb6:2',
        17: 'D6:1 Bb5:.5 D6:.5 E6:1 C#6:1',
        18: 'D6:4',
        19: 'F5:1.5 G5:.5 A5:1 Bb5:1',
        20: 'D6:2 Bb5:1 G5:1',
        21: 'G5:1.5 A5:.5 C#6:1 E6:1',
        22: 'C6:3 A5:1',
        23: 'Bb5:1 D6:1 C#6:1 E6:1',
        24: 'F5:1 Bb5:1 C6:1 E6:1',
      },
    },
    {
      // Struck steel on the phrase downbeats.
      inst: 'clang',
      vel: 0.7,
      bars: {
        3: 'D3:4',
        11: 'D3:4',
        19: 'Bb2:4',
        24: 'r:2 C3:2',
      },
    },
  ],
};

// Into the game's SONGS (a name there already stays).
export function registerSongs(songs) {
  if (!Object.hasOwn(songs, 'dark')) songs.dark = DARK;
  if (!Object.hasOwn(songs, 'fly_dark')) songs.fly_dark = FLY_DARK;
}
