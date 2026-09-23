// Pure music helpers for the sequencer: note names, bar notation, chords and scales.
// No WebAudio here, so everything can be unit tested in node.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'C4' -> 60, 'Bb3' -> 58, 'F#5' -> 78.
export function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name '${name}'`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + LETTER_PC[m[1]] + accidental;
}

export const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;

// '1.5' -> 1.5, '1/3' -> 0.333...
export function parseBeats(s) {
  const [a, b] = s.split('/');
  const v = b === undefined ? Number(a) : Number(a) / Number(b);
  if (!(v > 0)) throw new Error(`bad duration '${s}'`);
  return v;
}

// One bar of a part: space separated 'pitch:beats' tokens, 'r' is a rest.
// A trailing '!' accents the note, a trailing '~' marks a roll (timpani).
// Returns [{ beat, dur, midi, accent, roll }] (rests are dropped) and the bar's length.
export function parseBar(str) {
  const notes = [];
  let beat = 0;
  for (const token of str.trim().split(/\s+/).filter(Boolean)) {
    const m = /^([^:]+?)([!~]*):(.+)$/.exec(token);
    if (!m) throw new Error(`bad note token '${token}'`);
    const dur = parseBeats(m[3]);
    if (m[1] !== 'r') {
      notes.push({ beat, dur, midi: noteToMidi(m[1]), accent: m[2].includes('!'), roll: m[2].includes('~') });
    }
    beat += dur;
  }
  return { notes, length: beat };
}

// Chord qualities as semitone offsets from the root.
const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  6: [0, 4, 7, 9],
  add9: [0, 4, 7, 2],
};

const pcOf = (name) => pitchClass(noteToMidi(`${name}4`));

// 'Dm7' -> { symbol, root: 2, pcs: [2, 5, 9, 0], bass: 2 }; 'C/E' puts E in the bass.
export function parseChord(symbol) {
  const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(symbol);
  if (!m || !(m[2] in QUALITIES)) throw new Error(`bad chord '${symbol}'`);
  const root = pcOf(m[1]);
  const pcs = QUALITIES[m[2]].map((i) => (root + i) % 12);
  return { symbol, root, pcs, bass: m[3] ? pcOf(m[3]) : root };
}

// A bar of chords: 'F', 'Gm7 C7' (split evenly) or 'Cm7:2 F:1' (explicit beats).
export function parseChordBar(str, beatsPerBar) {
  const tokens = str.trim().split(/\s+/);
  const explicit = tokens.every((t) => t.includes(':'));
  let beat = 0;
  return tokens.map((t) => {
    const [sym, beats] = t.split(':');
    const dur = explicit ? parseBeats(beats) : beatsPerBar / tokens.length;
    const seg = { beat, dur, chord: parseChord(sym) };
    beat += dur;
    return seg;
  });
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

// Pitch classes of the major scale on a tonic name, e.g. 'F' -> [5, 7, 9, 10, 0, 2, 4].
export function majorScale(tonic) {
  const t = pcOf(tonic);
  return MAJOR_STEPS.map((s) => (t + s) % 12);
}

// All MIDI notes in [lo, hi] whose pitch class is in pcs (ascending).
export function notesInRange(pcs, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pitchClass(m))) out.push(m);
  return out;
}
