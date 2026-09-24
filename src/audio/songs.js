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

// "Lanterns Out" - game-over jingle. Bb major, 4/4: one bar and a final chord (2.4 s to the
// last downbeat, which then rings and fades under the 3.2 s GAME OVER card). A sighing
// descent over vi - IV - iv: the borrowed minor iv (Ebm) turns the line chromatically
// (G -> Gb in the flute and the horn) before it settles plagally, low, onto Bb, the key of
// the title waltz that crossfades in after it. A jingle: nothing but its cue (finalBar),
// never looped, and never faded in (it cuts whatever still plays).
const gameOver = {
  title: 'Lanterns Out',
  level: 0.8,
  jingle: true,
  finalBar: 2,
  key: 'Bb',
  bpm: 100,
  beatsPerBar: 4,
  swing: 0,
  chords: ['Gm:2 Eb:1 Ebm:1', 'Bb'],
  sections: [{ from: 1, to: 2, pad: 0.3, bass: 'hold', comp: 'arp', drums: 'none' }],
  parts: [
    {
      inst: 'flute',
      vel: 0.8,
      bars: {
        1: 'D6:.75 C6:.25 Bb5:.5 G5:.5 Bb5:.5 G5:.5 Gb5:.5 Eb5:.5',
        2: 'Bb4:4',
      },
    },
    {
      // Inner chromatic line under the tune: 1 - 3 - b3 of the moving chords, then the 5th.
      inst: 'horn',
      vel: 0.55,
      bars: { 1: 'G4:2 G4:1 Gb4:1', 2: 'F4:4' },
    },
    {
      inst: 'timpani',
      vel: 0.55,
      bars: { 1: 'r:3 Bb2~:1', 2: 'Bb2!:4' },
    },
  ],
};

// "Signal Lost" - AI RACE mode loop. D minor, 4/4, 76 bpm, 24 bars (~76 s loop).
// Slow and cold: a breathing synth pad over a throbbing low bass, a ticking clock, heavy
// thumps and struck steel. A (1-8): pad, pulse and steel with a few glassy pings; B (9-16):
// the glass lead enters as the harmony leans from the tonic onto the Phrygian flat two
// (Eb) and back; C (17-24): the lead climbs over the fuller kit, and the Asus4 - A half
// cadence (the steel hammering four times) turns the loop back into D minor. The engine
// plays it itself while the storm mode is on, fading it in with the picture (fadeIn).
const dark = {
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

// "Updraft" - the winged hat's flying theme. D major, 4/4, 120 bpm, 24 bars (48 s loop).
// Bright and soaring: a synth-brass lead with wide leaps and long high notes over flowing
// harp arpeggios, strings and a bouncing bass. The engine plays it itself while the winged
// hat is on ('wingHat' events), fading in under the power-up fanfare, whose held D major
// chord it takes over. Intro (1-2): the lead holds a high D over a lydian lift (E/D) while
// the arpeggios start. A (3-10): the tune springs up a sixth to a held B (the added sixth
// over D) and floats back down, then reaches up through the major II (E, the sharp fourth's
// lift) to a cadence. A' (11-18): the tune again
// an octave-doubled by the glockenspiel, climbing higher, with a horn counter-line. B
// (19-24): driving bass and kick as the lead climbs to its peak, then the borrowed bVI-bVII
// (Bb - C) swings the loop back up into the high D.
const fly = {
  title: 'Updraft',
  level: 0.6,
  fadeIn: 1.2,
  key: 'D',
  bpm: 120,
  beatsPerBar: 4,
  swing: 0,
  lead: 'brass',
  mix: { harp: 1.4, glock: 1.6 }, // the flowing arpeggios and the doubling a little forward
  chords: [
    // intro
    'D', 'E/D',
    // A
    'D', 'A/C#', 'Bm', 'G', 'Em7', 'E', 'G A', 'D',
    // A'
    'D', 'A/C#', 'Bm', 'G', 'Em7', 'E', 'G A', 'D',
    // B
    'Bm', 'G', 'Em7 A', 'F#m', 'G A', 'Bb C',
  ],
  sections: [
    { from: 1, to: 2, pad: 0.4, bass: 'lilt', comp: 'arp', drums: 'soft' },
    { from: 3, to: 10, pad: 0.3, bass: 'bounce', comp: 'arp', drums: 'soft' },
    { from: 11, to: 18, pad: 0.34, bass: 'bounce', comp: 'arp', drums: 'march' },
    { from: 19, to: 24, pad: 0.4, bass: 'gallop', comp: 'arp', drums: 'soar' },
  ],
  parts: [
    {
      inst: 'brass',
      vel: 0.9,
      bars: {
        1: 'D6:4',
        2: 'r:2 B4:1 C#5:1',
        3: 'D5:.5 F#5:.5 B5:1.5 A5:.5 F#5:1',
        4: 'E5:1.5 F#5:.5 A5:2',
        5: 'B5:1 F#5:1.5 E5:.5 D5:1',
        6: 'D5:.5 E5:.5 G5:1 B5:2',
        7: 'A5:1 G5:.5 E5:.5 D5:1 E5:1',
        8: 'G#5:1 A5:.5 B5:.5 C#6:2',
        9: 'D6:1.5 C#6:.5 B5:1 A5:1',
        10: 'A5:3 F#5:.5 A4:.5',
        11: 'D5:.5 F#5:.5 B5:1.5 A5:.5 F#5:1',
        12: 'E5:1.5 F#5:.5 A5:1 C#6:1',
        13: 'D6:1 C#6:.5 B5:.5 F#5:2',
        14: 'G5:.5 A5:.5 B5:1 D6:2',
        15: 'E6:1.5 D6:.5 B5:1 G5:1',
        16: 'G#5:1 B5:1 E6:2',
        17: 'D6:1 B5:.5 D6:.5 E6:1 C#6:1',
        18: 'D6:4',
        19: 'F#5:1.5 G5:.5 A5:1 B5:1',
        20: 'D6:2 B5:1 G5:1',
        21: 'A5:1.5 B5:.5 C#6:1 E6:1',
        22: 'C#6:3 A5:1',
        23: 'B5:1 D6:1 C#6:1 E6:1',
        24: 'F5:1 Bb5:1 C6:1 E6:1',
      },
    },
    {
      // Horn counter-line from the tune's return on, moving against it.
      inst: 'horn',
      vel: 0.55,
      bars: {
        11: 'F#4:2 A4:2',
        12: 'E4:2 C#4:2',
        13: 'D4:2 F#4:2',
        14: 'G4:2 B4:2',
        15: 'G4:2 E4:2',
        16: 'G#4:2 B4:2',
        17: 'B4:2 A4:2',
        18: 'F#4:4',
        19: 'D4:4',
        20: 'B3:2 D4:2',
        21: 'E4:2 C#4:2',
        22: 'A4:2 F#4:2',
        23: 'G4:2 E4:2',
        24: 'F4:2 G4:2',
      },
    },
    {
      // Glockenspiel doubles the returning tune an octave up.
      inst: 'glock',
      vel: 0.35,
      transpose: 12,
      copyBars: { from: 'brass', bars: [11, 12, 13, 14, 15, 16, 17, 18] },
    },
    {
      inst: 'timpani',
      vel: 0.65,
      bars: {
        1: 'D3!:4',
        2: 'r:2 A2~:2',
        3: 'D3:4',
        10: 'r:2 A2~:2',
        11: 'D3!:4',
        18: 'r:2 A2~:2',
        19: 'B2!:4',
        24: 'r:2 C3~:2',
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
const flyDark = {
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

export const SONGS = { castle_grounds: castleGrounds, title, game_over: gameOver, dark, fly, fly_dark: flyDark };
