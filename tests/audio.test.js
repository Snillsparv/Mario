// Audio: the engine must be inert (never throw) without WebAudio, and the music data must
// be well-formed and musically consistent (diatonic, no clashes, sane ranges and lengths).
// Engine behaviour against a fake AudioContext is in audio-engine.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../src/core/events.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong, chordTimeline } from '../src/audio/compile.js';
import { INSTRUMENTS, CHANNELS } from '../src/audio/instruments.js';
import { SFX } from '../src/audio/sfx.js';
import { noteToMidi, parseBar, parseChord, parseChordBar, majorScale, pitchClass } from '../src/audio/theory.js';

const RANGES = {
  flute: [60, 96],
  glock: [72, 108],
  horn: [50, 72],
  strings: [48, 84],
  harp: [48, 91],
  bass: [28, 62],
  timpani: [38, 57],
};

test('engine is a silent no-op without an AudioContext', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  assert.equal(await audio.unlock(), false);
  audio.muted = true;
  audio.muted = false;
  audio.play('jump', { pos: { x: 0, y: 0, z: 0 } });
  audio.play('no_such_sound');
  audio.playMusic('castle_grounds');
  audio.playMusic('no_such_song');
  audio.setListener({ x: 1, y: 2, z: 3 }, 0.5);
  audio.update(1 / 60);
  for (const [name, data] of [
    ['sfx', { name: 'coin' }],
    ['sfx', { name: 'nonsense' }],
    ['footstep', { terrain: 'stone', pos: { x: 0, y: 0, z: 0 }, speed: 20 }],
    ['land', { terrain: 'grass', hard: true }],
    ['splash', { big: true }],
    ['hurt', {}],
    ['coin', { value: 2, red: true, index: 3 }],
    ['redCoinsComplete', {}],
    ['starCollected', {}],
    ['pause', {}],
    ['unpause', {}],
    ['gameStart', {}],
  ]) {
    events.emit(name, data);
  }
  audio.stopMusic();
  clearTimeout(audio.fanfareTimer);
});

test('every standard sfx name has a recipe', () => {
  const names = `jump double_jump triple_jump backflip sideflip long_jump wallkick dive ground_pound
    ground_pound_land punch kick land land_hard skid bonk hurt ledge_grab climb swim splash
    water_exit coin red_coin star_appear star_get one_up pause menu_select camera_move camera_buzz
    footstep life_lost unpause punch1 punch2 jump_kick dialog_open text_blip dialog_next dialog_close`;
  for (const n of names.split(/\s+/)) assert.equal(typeof SFX[n], 'function', n);
});

test('positional sounds pan toward the correct ear and fade with distance', () => {
  const audio = new AudioEngine(null);
  // Facing +Z, the listener's right is -X.
  audio.setListener({ x: 0, y: 0, z: 0 }, 0);
  assert.ok(audio.spatial({ x: -2000, y: 0, z: 0 }).pan > 0.5);
  assert.ok(audio.spatial({ x: 2000, y: 0, z: 0 }).pan < -0.5);
  assert.equal(audio.spatial({ x: 0, y: 0, z: 800 }).gain, 1);
  assert.equal(audio.spatial({ x: 0, y: 0, z: 20000 }).gain, 0);
  // Facing +X, the right is +Z.
  audio.setListener({ x: 0, y: 0, z: 0 }, Math.PI / 2);
  assert.ok(audio.spatial({ x: 0, y: 0, z: 2000 }).pan > 0.5);
});

test('theory helpers', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('F#5'), 78);
  assert.deepEqual(parseChord('Dm7').pcs, [2, 5, 9, 0]);
  assert.equal(parseChord('C/E').bass, 4);
  assert.deepEqual(majorScale('F'), [5, 7, 9, 10, 0, 2, 4]);
  assert.deepEqual(parseChordBar('Cm7:2 F:1', 3).map((s) => s.dur), [2, 1]);
  assert.deepEqual(parseChordBar('Gm7 C7', 4).map((s) => s.beat), [0, 2]);
  assert.equal(parseBar('A5:1 r:.5 C6!:1/2 G5:2').length, 4);
});

for (const [name, song] of Object.entries(SONGS)) {
  test(`${name}: bars, chords and sections are well formed`, () => {
    const bars = song.chords.length;
    for (const str of song.chords) {
      const total = parseChordBar(str, song.beatsPerBar).reduce((a, s) => a + s.dur, 0);
      assert.equal(total, song.beatsPerBar, `chord bar '${str}'`);
    }
    for (const part of song.parts.filter((p) => p.bars)) {
      for (const [bar, str] of Object.entries(part.bars)) {
        assert.ok(bar >= 1 && bar <= bars, `${part.inst} bar ${bar} out of range`);
        assert.ok(Math.abs(parseBar(str).length - song.beatsPerBar) < 1e-9, `${part.inst} bar ${bar} length`);
      }
    }
    // Sections tile the song exactly.
    let next = 1;
    for (const s of song.sections) {
      assert.equal(s.from, next);
      next = s.to + 1;
    }
    assert.equal(next, bars + 1);
  });

  test(`${name}: loop length and note ranges`, () => {
    const c = compileSong(song);
    const seconds = (c.loopBeats * 60) / c.bpm;
    if (name === 'castle_grounds') assert.ok(seconds >= 60 && seconds <= 90, `loop ${seconds}s`);
    else if (song.jingle) {
      // A jingle (nothing but its cue): the final chord lands well inside the 3.2 s
      // GAME OVER card, so it rings before the title track crossfades in.
      const toFinal = (c.endBeat * 60) / c.bpm;
      assert.ok(toFinal >= 1.5 && toFinal <= 2.8, `jingle reaches its final chord at ${toFinal}s`);
    } else assert.ok(seconds >= 25 && seconds <= 90, `loop ${seconds}s`);
    for (const e of c.events) {
      assert.ok(INSTRUMENTS[e.inst] && CHANNELS[e.inst], `instrument ${e.inst}`);
      assert.ok(e.beat >= 0 && e.beat < c.loopBeats, `event at ${e.beat}`);
      assert.ok(e.dur > 0 && e.beat + e.dur <= c.loopBeats + 0.5, `event end ${e.beat + e.dur}`);
      assert.ok(e.vel > 0 && e.vel <= 1, `velocity ${e.vel}`);
      if (e.midi === null) continue;
      const [lo, hi] = RANGES[e.inst];
      assert.ok(e.midi >= lo && e.midi <= hi, `${e.inst} note ${e.midi} outside ${lo}..${hi}`);
    }
    for (let i = 1; i < c.events.length; i++) assert.ok(c.events[i].beat >= c.events[i - 1].beat, 'sorted');
  });

  test(`${name}: harmony is diatonic and clash-free`, () => {
    const c = compileSong(song);
    const scale = majorScale(song.key);
    const timeline = chordTimeline(song);
    const chordAt = (beat) => timeline.findLast((s) => s.beat <= beat + 0.2).chord;
    const melody = c.events.filter((e) => e.inst === 'flute');
    // Every note is in the key, or a tone of the chord sounding under it (a borrowed chord
    // such as the minor iv).
    for (const e of c.events.filter((ev) => ev.midi !== null && ev.inst !== 'timpani')) {
      const pc = pitchClass(e.midi);
      assert.ok(scale.includes(pc) || chordAt(e.beat).pcs.includes(pc), `${e.inst} ${e.midi} at ${e.beat} not in ${song.key} major or ${chordAt(e.beat).symbol}`);
    }
    // Held melody notes may be chord tones or tensions, but never a semitone above a
    // chord tone (the harsh "avoid note" clash).
    for (const e of melody.filter((ev) => ev.dur >= 1)) {
      const chord = chordAt(e.beat);
      const pc = pitchClass(e.midi);
      for (const t of chord.pcs) assert.notEqual(pc, (t + 1) % 12, `melody ${e.midi} clashes with ${chord.symbol} at beat ${e.beat}`);
    }
    // Pad and harp only play chord tones (major 7th chords may add their 9th).
    for (const e of c.events.filter((ev) => ev.inst === 'strings' || ev.inst === 'harp')) {
      const chord = chordAt(e.beat);
      const allowed = chord.symbol.endsWith('maj7') ? [...chord.pcs, (chord.root + 2) % 12] : chord.pcs;
      assert.ok(allowed.includes(pitchClass(e.midi)), `${e.inst} ${e.midi} not in ${chord.symbol}`);
    }
    // The lead is monophonic.
    for (let i = 1; i < melody.length; i++) {
      assert.ok(melody[i].beat >= melody[i - 1].beat + melody[i - 1].dur - 1e-6, `melody overlap at ${melody[i].beat}`);
    }
  });

  test(`${name}: pad voice leading is smooth (also across the loop point), no semitone clusters`, () => {
    const c = compileSong(song);
    // Notes of one instrument grouped by onset, each group sorted upward.
    const chordsOf = (inst) => {
      const byBeat = new Map();
      for (const e of c.events.filter((ev) => ev.inst === inst)) {
        if (!byBeat.has(e.beat)) byBeat.set(e.beat, []);
        byBeat.get(e.beat).push(e.midi);
      }
      return [...byBeat.values()].map((v) => v.sort((a, b) => a - b));
    };
    const pads = chordsOf('strings');
    pads.forEach((v, i) => {
      const prev = pads[(i + pads.length - 1) % pads.length]; // chord 0 follows the last one
      v.forEach((m, k) => assert.ok(Math.abs(m - prev[k]) <= 5, `pad leap into chord ${i}`));
    });
    // Neither the pad nor the harp stabs (simultaneous 3-note chords) stack semitones.
    for (const v of [...pads, ...chordsOf('harp').filter((h) => h.length === 3)]) {
      for (let k = 1; k < v.length; k++) assert.ok(v[k] - v[k - 1] > 1, `semitone cluster ${v}`);
    }
  });

  test(`${name}: melody has rhythmic variety`, () => {
    const c = compileSong(song);
    const durations = new Set(c.events.filter((e) => e.inst === 'flute').map((e) => e.dur.toFixed(2)));
    assert.ok(durations.size >= 4, `melody rhythms: ${[...durations]}`);
  });
}

test('castle theme has distinct A and B sections', () => {
  const flute = SONGS.castle_grounds.parts.find((p) => p.inst === 'flute').bars;
  const a = [1, 2, 3, 4, 5, 6, 7, 8].map((b) => flute[b]);
  const b = [17, 18, 19, 20, 21, 22, 23, 24].map((n) => flute[n]);
  assert.ok(b.every((bar) => !a.includes(bar)), 'B section reuses A bars');
  // The A theme returns (bar 25 restates bar 1).
  assert.equal(flute[25], flute[1]);
});

test('a cue ends on the tonic: final bar is the tonic chord and the melody lands on its root', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    if (!song.finalBar) continue;
    const c = compileSong(song);
    const downbeat = (song.finalBar - 1) * song.beatsPerBar;
    assert.ok(c.endBeat > downbeat && c.endBeat < downbeat + 0.5, `${name} endBeat ${c.endBeat}`);
    assert.ok(c.endBeat <= c.loopBeats, `${name} ends inside the song`);
    const last = chordTimeline(song).find((s) => s.beat === downbeat);
    assert.equal(last.chord.root, pitchClass(noteToMidi(`${song.key}4`)), `${name} final chord`);
    const melody = c.events.find((e) => e.inst === 'flute' && e.beat === downbeat);
    assert.ok(melody, `${name}: melody note on the final downbeat`);
    assert.equal(pitchClass(melody.midi), last.chord.root, `${name}: melody ends on the tonic`);
    // Nothing starts between the final downbeat and the end point (it would be cut off).
    assert.ok(!c.events.some((e) => e.beat > downbeat && e.beat < c.endBeat));
  }
  assert.equal(SONGS.castle_grounds.finalBar, 8, 'castle music is an arrival cue');
});
