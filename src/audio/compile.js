// Turns song data (songs.js) into a flat, sorted list of note events for the sequencer:
//   { beat, dur, inst, midi, vel }   (beat/dur in beats from the loop start; midi null = unpitched)
// Hand-written parts are parsed from bar strings; the accompaniment is generated from the
// chord chart per section style: voice-led pad, patterned bass, harp stabs or arpeggios,
// and percussion. A song may swap the accompaniment's instruments (roles: { pad, bass,
// comp }; default strings, bass, harp), name its lead instrument (lead, default flute), be
// in a minor mode (mode: 'minor'), move its bass register (bassLow), ask to be faded in
// (fadeIn seconds) and trim instruments' channel levels for its own balance (mix: { inst:
// factor }, applied by the sequencer on top of CHANNELS).

import { parseBar, parseChordBar, modeScale, notesInRange, pitchClass } from './theory.js';

const PAD_RANGE = [52, 77]; // E3..F5
const STAB_RANGE = [60, 77]; // C4..F5
const ARP_LOW = 57; // arpeggios start at the lowest chord tone >= A3
const BASS_LOW = 38; // bass roots live in D2..C#3
const ROLL_STEP = 1 / 6; // timpani roll stroke spacing in beats

// Bass patterns by chord-segment length: [beatOffset, duration, degree, velocity?], where
// degree is 'R' bass note, '5' the chord's fifth (below when it fits), '8' octave, 'A' a
// diatonic approach note into the next chord's bass. Velocity defaults to an accented
// downbeat (0.9) and 0.7 elsewhere.
const BASS_PATTERNS = {
  bounce: {
    4: [[0, 0.8, 'R'], [1, 0.45, '5'], [2, 0.8, '8'], [3, 0.45, '5'], [3.5, 0.45, 'A']],
    2: [[0, 0.8, 'R'], [1, 0.45, '5'], [1.5, 0.45, 'A']],
  },
  lilt: {
    4: [[0, 1.4, 'R'], [1.5, 0.45, '5'], [2, 1.4, '8'], [3.5, 0.45, 'A']],
    2: [[0, 1.4, 'R'], [1.5, 0.45, 'A']],
  },
  waltz: {
    3: [[0, 2.6, 'R']],
    2: [[0, 1.8, 'R']],
    1: [[0, 0.9, 'R']],
  },
  // One root per chord, whatever its length (short cues).
  hold: {
    4: [[0, 3.6, 'R']],
    2: [[0, 1.8, 'R']],
    1: [[0, 0.9, 'R']],
  },
  // Driving 8ths for the flying theme's climax: the root under a fifth and an octave on the
  // beats (no approach notes, so borrowed chords never get a clashing passing tone).
  gallop: {
    4: [[0, 0.45, 'R', 0.95], [0.5, 0.4, 'R', 0.6], [1, 0.45, '5', 0.75], [1.5, 0.4, 'R', 0.6], [2, 0.45, '8', 0.85], [2.5, 0.4, 'R', 0.6], [3, 0.45, '5', 0.75], [3.5, 0.4, 'R', 0.65]],
    2: [[0, 0.45, 'R', 0.95], [0.5, 0.4, 'R', 0.6], [1, 0.45, '5', 0.75], [1.5, 0.4, 'R', 0.6]],
  },
  // Throbbing 8ths on the root, leaning on beats 1 and 3, lifting an octave on beat 4.
  pulse: {
    4: [[0, 0.42, 'R', 0.95], [0.5, 0.3, 'R', 0.5], [1, 0.42, 'R', 0.7], [1.5, 0.3, 'R', 0.5], [2, 0.42, 'R', 0.85], [2.5, 0.3, 'R', 0.5], [3, 0.42, '8', 0.7], [3.5, 0.3, 'R', 0.6]],
    2: [[0, 0.42, 'R', 0.95], [0.5, 0.3, 'R', 0.5], [1, 0.42, 'R', 0.7], [1.5, 0.3, 'R', 0.5]],
  },
};

// Percussion on an 8th-note grid: 'x' hit, 'X' accent, '.' rest. Patterns are cycled to
// the bar length.
const DRUM_PATTERNS = {
  march: { kick: 'x...x...', shaker: 'xXxXxXxX' },
  soft: { kick: 'x.......', shaker: '.x.x.x.x' },
  // Dark track: a slow clock ticking over heavy, lurching thumps.
  industrial: { thump: 'X..x....', tick: 'x.x.x.xX' },
  sparse: { thump: 'X.......', tick: 'x...x...' },
  // Flying: a driving kick across the bar under busy shakers; its storm variant on metal.
  soar: { kick: 'x..x..x.', shaker: 'xxXxxxXx' },
  rush: { thump: 'X..x..x.', tick: 'xxXxxxXx' },
  none: {},
};
const DRUM_VEL = { kick: [0.75, 0.9], shaker: [0.3, 0.55], thump: [0.7, 0.95], tick: [0.3, 0.5] };

// Arpeggio index patterns over ascending chord tones, by segment length in 8ths.
const ARP_PATTERNS = { 8: [0, 1, 2, 3, 4, 3, 2, 1], 6: [0, 1, 2, 3, 2, 1], 4: [0, 1, 2, 3], 2: [0, 2] };

const SEMITONE_COST = 3; // penalty per adjacent semitone pair in a voicing (e.g. A-Bb in Bbmaj7)

// Pitch classes the pad and stabs voice. A major 7th chord is voiced rootless as 3-5-7-9
// (the bass has the root), so the 7th never grinds a semitone under the root.
function voicingPcs({ root, pcs }) {
  return pcs[3] === (root + 11) % 12 ? [pcs[1], pcs[2], pcs[3], (root + 2) % 12] : pcs;
}

// Choose a close voicing of `count` chord tones in [lo, hi] that moves least from prev.
function voiceLead(chord, prev, count, [lo, hi]) {
  const tones = notesInRange(voicingPcs(chord), lo, hi);
  const center = (lo + hi) / 2;
  let best = null;
  let bestCost = Infinity;
  for (let i = 0; i + count <= tones.length; i++) {
    const v = tones.slice(i, i + count);
    const mean = v.reduce((a, b) => a + b, 0) / count;
    let cost = Math.abs(mean - center) * (prev ? 0.3 : 1);
    if (prev) for (let k = 0; k < count; k++) cost += Math.abs(v[k] - prev[k]);
    for (let k = 1; k < count; k++) if (v[k] - v[k - 1] === 1) cost += SEMITONE_COST;
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}

// Voice-led voicings for every chord segment. The chain runs twice, the second pass seeded
// with the first pass's last voicing, so the loop point moves as smoothly as any change.
function voicings(timeline, count, range) {
  let prev = null;
  let out = [];
  for (let pass = 0; pass < 2; pass++) out = timeline.map((seg) => (prev = voiceLead(seg.chord, prev, count, range)));
  return out;
}

// Ascending arpeggio tones from ARP_LOW, leaving out a tone a semitone under the next one
// (the major 7th under the root), which would ring against it on a harp.
function arpTones(chord) {
  const tones = notesInRange(chord.pcs, ARP_LOW, ARP_LOW + 24);
  return tones.filter((m, i) => tones[i + 1] !== m + 1);
}

// Bass note for a pc in the root register (the octave from `low` up).
const bassNote = (pc, low = BASS_LOW) => low + ((pc - (low % 12) + 12) % 12);

// Diatonic step toward `target` from the side `from` is on.
function approachNote(from, target, scale) {
  const below = from < target;
  for (let m = target + (below ? -1 : 1); Math.abs(m - target) <= 2; m += below ? -1 : 1) {
    if (scale.includes(pitchClass(m))) return m;
  }
  return target;
}

function bassEvents(style, seg, next, scale, { inst, low }) {
  const pattern = BASS_PATTERNS[style]?.[seg.dur];
  if (!pattern) throw new Error(`no '${style}' bass pattern for ${seg.dur}-beat chords`);
  const root = bassNote(seg.chord.bass, low);
  const fifthPc = seg.chord.pcs[2];
  const fifthUp = root + ((fifthPc - pitchClass(root) + 12) % 12);
  const fifth = fifthUp - 12 >= 33 ? fifthUp - 12 : fifthUp;
  const nextRoot = next ? bassNote(next.chord.bass, low) : root;
  return pattern.map(([off, dur, degree, vel]) => {
    let midi = root;
    if (degree === '5') midi = fifth;
    else if (degree === '8') midi = root + 12;
    else if (degree === 'A') midi = nextRoot === root ? fifth : approachNote(root, nextRoot, scale);
    return { beat: seg.beat + off, dur, inst, midi, vel: vel ?? (off === 0 ? 0.9 : 0.7) };
  });
}

function drumEvents(style, barBeat, beatsPerBar) {
  const out = [];
  for (const [inst, pattern] of Object.entries(DRUM_PATTERNS[style] || {})) {
    for (let i = 0; i < beatsPerBar * 2; i++) {
      const c = pattern[i % pattern.length];
      if (c === '.') continue;
      const vel = DRUM_VEL[inst][c === 'X' ? 1 : 0];
      out.push({ beat: barBeat + i / 2, dur: 0.25, inst, midi: null, vel });
    }
  }
  return out;
}

// Parse hand-written parts; copyBars parts reuse another part's bars (e.g. a doubling).
function writtenEvents(song) {
  const byName = Object.fromEntries(song.parts.filter((p) => p.bars).map((p) => [p.inst, p]));
  const out = [];
  for (const part of song.parts) {
    const bars = part.copyBars
      ? Object.fromEntries(part.copyBars.bars.map((b) => [b, byName[part.copyBars.from].bars[b]]))
      : part.bars;
    for (const [barNo, str] of Object.entries(bars)) {
      const barBeat = (Number(barNo) - 1) * song.beatsPerBar;
      for (const n of parseBar(str).notes) {
        const midi = n.midi + (part.transpose || 0);
        const vel = Math.min(1, part.vel * (n.accent ? 1.15 : 1));
        if (!n.roll) {
          out.push({ beat: barBeat + n.beat, dur: n.dur, inst: part.inst, midi, vel });
          continue;
        }
        // Roll: repeated strokes with a crescendo into the next downbeat.
        const strokes = Math.round(n.dur / ROLL_STEP);
        for (let i = 0; i < strokes; i++) {
          const beat = barBeat + n.beat + i * ROLL_STEP;
          out.push({ beat, dur: ROLL_STEP, inst: part.inst, midi, vel: vel * (0.3 + 0.55 * (i / strokes)) });
        }
      }
    }
  }
  return out;
}

// Shift offbeat 8ths late by `swing` beats (a light shuffle).
function swingBeat(beat, swing) {
  const frac = beat - Math.floor(beat);
  return Math.abs(frac - 0.5) < 1e-6 ? beat + swing : beat;
}

// Chord segments with absolute beats: [{ beat, dur, chord, bar }] (bar is 1-based).
export function chordTimeline(song) {
  return song.chords.flatMap((str, i) =>
    parseChordBar(str, song.beatsPerBar).map((s) => ({ ...s, beat: s.beat + i * song.beatsPerBar, bar: i + 1 })),
  );
}

// Instruments that play the generated accompaniment, by role.
const DEFAULT_ROLES = { pad: 'strings', bass: 'bass', comp: 'harp' };

export function compileSong(song) {
  const bpb = song.beatsPerBar;
  const loopBeats = song.chords.length * bpb;
  const scale = modeScale(song.key, song.mode);
  const roles = { ...DEFAULT_ROLES, ...song.roles };
  const bass = { inst: roles.bass, low: song.bassLow ?? BASS_LOW };
  const timeline = chordTimeline(song);
  const sectionOf = (bar) => song.sections.find((s) => bar >= s.from && bar <= s.to);
  const events = writtenEvents(song);

  const pads = voicings(timeline, 4, PAD_RANGE);
  const stabs = voicings(timeline, 3, STAB_RANGE);
  timeline.forEach((seg, i) => {
    const sec = sectionOf(seg.bar);
    const next = timeline[(i + 1) % timeline.length];
    for (const midi of pads[i]) events.push({ beat: seg.beat, dur: seg.dur, inst: roles.pad, midi, vel: sec.pad });
    events.push(...bassEvents(sec.bass, seg, next, scale, bass));
    if (sec.comp === 'stabs') {
      // Off-beat chords on beats 2 and 4 (odd beats; bars are 4 beats long).
      for (let b = Math.ceil(seg.beat); b < seg.beat + seg.dur; b++) {
        if (b % 2 === 1) for (const midi of stabs[i]) events.push({ beat: b, dur: 0.4, inst: roles.comp, midi, vel: 0.42 });
      }
    } else if (sec.comp === 'arp') {
      const tones = arpTones(seg.chord);
      ARP_PATTERNS[seg.dur * 2].forEach((idx, k) => {
        events.push({ beat: seg.beat + k / 2, dur: 0.5, inst: roles.comp, midi: tones[idx], vel: k % 2 ? 0.28 : 0.36 });
      });
    }
  });
  song.chords.forEach((_, bar) => {
    events.push(...drumEvents(sectionOf(bar + 1).drums, bar * bpb, bpb));
  });

  for (const e of events) {
    const end = swingBeat(e.beat + e.dur, song.swing);
    e.beat = swingBeat(e.beat, song.swing);
    e.dur = end - e.beat;
  }
  events.sort((a, b) => a.beat - b.beat);
  // A cue (finalBar) ends after the notes on its final bar's downbeat; offbeats, even
  // swung ones, start later than this.
  const endBeat = song.finalBar ? (song.finalBar - 1) * bpb + 0.25 : null;
  return {
    title: song.title,
    bpm: song.bpm,
    level: song.level ?? 1,
    menu: !!song.menu,
    jingle: !!song.jingle,
    fadeIn: song.fadeIn ?? 0,
    mix: song.mix ?? {},
    roles,
    lead: song.lead ?? 'flute',
    beatsPerBar: bpb,
    loopBeats,
    endBeat,
    events,
    timeline,
  };
}
