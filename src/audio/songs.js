// Original music for Castle Grounds, written for this project.
//
// Notation (see theory.js): chords are one string per bar; parts are bar strings of
// 'pitch:beats' tokens keyed by 1-based bar number. The accompaniment (string pad, bass,
// harp comping, percussion) is generated from the chords by compile.js according to each
// section's style, so harmony stays consistent everywhere; the melody, counter-line,
// bell doubling and timpani are written out by hand.

// "Meadow Parade" - castle grounds theme. F major, 4/4, 32 bars (~71 s loop).
// Form: A (1-8) A' (9-16) B (17-24) A'' (25-32). A is a bouncy flute tune over
// oom-pah bass and harp stabs; B turns lyrical with harp arpeggios and a horn
// counter-line; A'' returns with a bell doubling and a climax at bar 28.
// In game it is an arrival cue, not a loop: like the hub it recreates, the grounds have no
// background music, so the tune plays its A section over the intro fly-in and ends on the
// tonic downbeat of bar 8 (after the Gm7 C7 cadence), leaving the scene to the ambience.
// The full loop is kept for the preview.
const castleGrounds = {
  title: 'Meadow Parade',
  level: 0.6,
  finalBar: 8,
  key: 'F',
  bpm: 108,
  beatsPerBar: 4,
  swing: 0.06,
  chords: [
    // A
    'F', 'C/E', 'Dm7', 'Bb C', 'F', 'Bb', 'Gm7 C7', 'F',
    // A'
    'F', 'C/E', 'Dm7', 'Bb', 'Gm7', 'Am7 Dm7', 'Gm7', 'C7',
    // B
    'Bbmaj7', 'C7', 'Am7', 'Dm7', 'Gm7', 'C7', 'Am7 Dm7', 'Gm7 C7',
    // A''
    'F', 'C/E', 'Dm7', 'Bb C', 'Dm7', 'Bb', 'Gm7 C7', 'F C7',
  ],
  sections: [
    { from: 1, to: 8, pad: 0.26, bass: 'bounce', comp: 'stabs', drums: 'march' },
    { from: 9, to: 16, pad: 0.3, bass: 'bounce', comp: 'stabs', drums: 'march' },
    { from: 17, to: 24, pad: 0.36, bass: 'lilt', comp: 'arp', drums: 'soft' },
    { from: 25, to: 32, pad: 0.32, bass: 'bounce', comp: 'stabs', drums: 'march' },
  ],
  parts: [
    {
      inst: 'flute',
      vel: 0.85,
      bars: {
        1: 'A5:1 C6:.5 A5:.5 G5:.5 F5:.5 G5:1',
        2: 'E5:1.5 F5:.5 G5:1 C5:1',
        3: 'D5:.5 F5:.5 A5:1 G5:.5 A5:.5 C6:1',
        4: 'D6:1.5 C6:.5 Bb5:.5 A5:.5 G5:1',
        5: 'A5:1 C6:.5 A5:.5 G5:.5 F5:.5 A5:.5 C6:.5',
        6: 'D6:1.5 C6:.5 Bb5:1 F5:1',
        7: 'G5:.5 A5:.5 Bb5:.5 D6:.5 C6:1 Bb5:.5 G5:.5',
        8: 'F5:1.5 r:1.5 C5:.5 F5:.5',
        9: 'A5:1 C6:.5 A5:.5 G5:.5 F5:.5 G5:1',
        10: 'E5:1.5 F5:.5 G5:1 C6:1',
        11: 'D6:.5 C6:.5 A5:1 F5:.5 A5:.5 D6:1',
        12: 'D6:1.5 C6:.5 Bb5:1 D6:1',
        13: 'C6:1 Bb5:.5 A5:.5 G5:1 Bb5:1',
        14: 'A5:1 G5:.5 A5:.5 F5:1 D5:1',
        15: 'G5:1.5 A5:.5 Bb5:1 D6:1',
        16: 'C6:2 Bb5:.5 A5:.5 G5:.5 E5:.5',
        17: 'F5:1 D5:.5 F5:.5 A5:2',
        18: 'G5:1 E5:.5 G5:.5 Bb5:2',
        19: 'C6:1.5 A5:.5 G5:1 E5:1',
        20: 'F5:1.5 E5:.5 D5:2',
        21: 'Bb5:1 G5:.5 Bb5:.5 D6:2',
        22: 'C6:1 A5:.5 C6:.5 E6:1.5 D6:.5',
        23: 'C6:1.5 A5:.5 D6:1 C6:.5 A5:.5',
        24: 'Bb5:1 A5:.5 G5:.5 E5:.5 F5:.5 G5:.5 Bb5:.5',
        25: 'A5:1 C6:.5 A5:.5 G5:.5 F5:.5 G5:1',
        26: 'E5:1.5 F5:.5 G5:1 C6:1',
        27: 'D6:.5 C6:.5 A5:1 F5:.5 A5:.5 D6:1',
        28: 'D6:.5 E6:.5 F6!:1 E6:.5 D6:.5 C6:1',
        29: 'D6:1 C6:.5 A5:.5 F5:1 A5:1',
        30: 'Bb5:1.5 C6:.5 D6:1 Bb5:1',
        31: 'G5:1 A5:.5 Bb5:.5 C6:1 E5:1',
        32: 'F5:2 r:1 C6:.5 Bb5:.5',
      },
    },
    {
      // Horn counter-line under the lyrical B section, moving against the melody.
      inst: 'horn',
      vel: 0.6,
      bars: {
        17: 'D4:2 C4:2',
        18: 'Bb3:2 C4:2',
        19: 'C4:2 E4:2',
        20: 'F4:4',
        21: 'D4:2 F4:2',
        22: 'E4:2 G4:2',
        23: 'E4:2 F4:2',
        24: 'D4:2 E4:2',
      },
    },
    {
      // Glockenspiel doubles the returning tune an octave up.
      inst: 'glock',
      vel: 0.4,
      transpose: 12,
      copyBars: { from: 'flute', bars: [25, 26, 27, 28] },
    },
    {
      inst: 'timpani',
      vel: 0.7,
      bars: {
        8: 'r:2 C3:1 C3:1',
        16: 'r:1 C3~:3',
        17: 'Bb2!:4',
        24: 'r:2 C3~:2',
        25: 'F2!:4',
      },
    },
  ],
};

// "Lantern Waltz" - gentle title loop. Bb major, 3/4, 16 bars (~34 s loop).
// Harp arpeggios and soft strings under a lullaby-like flute line. A menu track: it stops
// when the game starts, whatever plays next.
const title = {
  title: 'Lantern Waltz',
  level: 1,
  menu: true,
  key: 'Bb',
  bpm: 84,
  beatsPerBar: 3,
  swing: 0,
  chords: [
    'Bb', 'Ebmaj7', 'Gm', 'F', 'Eb', 'Bb', 'Cm7', 'F',
    'Bb', 'Dm', 'Eb', 'Cm7:2 F:1', 'Gm', 'Eb', 'Cm7:2 F:1', 'Bb:2 F:1',
  ],
  sections: [{ from: 1, to: 16, pad: 0.24, bass: 'waltz', comp: 'arp', drums: 'none' }],
  parts: [
    {
      inst: 'flute',
      vel: 0.7,
      bars: {
        1: 'D5:1 F5:1 Bb5:1',
        2: 'G5:2 F5:1',
        3: 'Bb5:1.5 A5:.5 G5:1',
        4: 'A5:2 F5:1',
        5: 'G5:1 Bb5:1 Eb6:1',
        6: 'D6:2 C6:1',
        7: 'Bb5:1.5 G5:.5 Eb5:1',
        8: 'F5:1.5 G5:.5 A5:1',
        9: 'Bb5:2 F5:1',
        10: 'A5:1.5 G5:.5 F5:1',
        11: 'G5:2 Bb5:1',
        12: 'Eb6:1 C6:1 A5:1',
        13: 'Bb5:1.5 A5:.5 G5:1',
        14: 'G5:1.5 F5:.5 Eb5:1',
        15: 'Eb5:1 D5:1 C5:1',
        16: 'Bb4:2 F4:.5 C5:.5',
      },
    },
    {
      inst: 'glock',
      vel: 0.3,
      transpose: 12,
      copyBars: { from: 'flute', bars: [9, 10, 11, 12] },
    },
  ],
};

export const SONGS = { castle_grounds: castleGrounds, title };
