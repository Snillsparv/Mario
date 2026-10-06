// STOMPWATT's sounds (LaneBoss.js), procedural like audio/sfx.js's recipes (each (ctx, out, t,
// opts) => seconds; opts.p the pitch, the engine's jitter in it), registered into the game's SFX
// table when the lane's chunk attaches (register(): the engine plays any name it has). It talks in
// car sounds and electric hums, never words; its transformation is a rising hum, ratchets and
// clunks of our own (nothing like any famous robot's).
//
//   ROBOT_SFX, ROBOT_SFX_INFO, register(sfx, info)
//
//   ev_chirp          the car's lock chirp: two short square blips (`quiet`: its notice, softer)
//   robot_power_up    waking: a rising electric hum (saw and sine climbing, a wobble), ratchet
//                     clicks speeding up
//   robot_clunk       a piece locking into place: a metal ka-chunk (a thud, a filtered click, a
//                     short ring); `pitch` by the piece's size
//   robot_horn        a two-note car-horn chord (a major third); `pitch` 0.8 grumpier
//   robot_step        a heavy footfall: a low thud and a servo's whirr
//   robot_whirr       a small servo turning (its head following him)
//   robot_power_down  folding back: a falling whine and a soft blip
// The fight (B3):
//   ev_reverse        a soft reversing beep (beaten, backing into its slot)
//   robot_stomp_tell  a rising servo whine with its heel roller's buzz spinning up
//   robot_stomp       the slam: a sub thud, a crunch and a ringing metal tail
//   robot_wave        the shockwave's whoosh (band-passed noise sweeping down)
//   robot_screech     its heel rollers spinning up on the drive (a tyre squeal)
//   robot_dash        an electric whoosh as it skates
//   robot_clang       the dash's bonk on a wall
//   robot_swipe_tell, robot_swipe   the wheel fist's whine, its whoosh
//   robot_lowbat      three descending beeps
//   robot_charge      the charging hum (a rising sine, pulsing)
//   robot_zap         a hit on its cells: a crackling buzz and a pop
//   robot_tink        a hit anywhere else: a metal tink
//   boss_win          its defeat: a short bright sting (the star's fanfare follows on the star)
//   bin_clatter       a bin shoved aside: a plastic clatter
// The bins (B4: LaneBins.js):
//   bin_roll          rolling: its plastic wheels' rumble on the drive, a seam's click
//   bin_lid           knocked or stopping: its lid's hollow clack and a bounce (`pitch` lower: a pound)
// The store room's doors (D1: LaneGarage.js; STOMPWATT's slams rattle them with the game's own
// door_rattle, `pitch` 0.8):
//   door_crack        a leaf cracked: a woody crack, a tock, a short low creak (a quiet saw)
//   door_smash        a leaf smashed: a thump and a crunch, splinters ticking off, the planks
//                     landing (three tocks)
//
// Its fight's music, 'stompwatt' (STOMPWATT_SONG, audio/songs.js format, registered into SONGS
// with a handclap instrument of its own: registerSong): an original bouncy electro-polka in A
// minor, 140 bpm, 16 bars looped: a pulsing synth bass on the oom-pah, synth-arpeggio stabs and
// arpeggios, a bright bell lead, handclaps on the backbeat.
//
//   ROBOT_SFX, ROBOT_SFX_INFO, register(sfx, info), STOMPWATT_SONG, registerSong(songs,
//   instruments, channels)

import { noise, tone, lfo } from '../../audio/synth.js';

function clunk(ctx, out, t, p, gain) {
  tone(ctx, out, t, { freq: 140 * p, to: 55 * p, glide: 0.08, dur: 0.16, gain, attack: 0.002 });
  noise(ctx, out, t, { filter: 'bandpass', freq: 2600 * p, q: 2.5, dur: 0.035, gain: gain * 0.5, attack: 0.001 });
  noise(ctx, out, t + 0.05, { filter: 'bandpass', freq: 1500 * p, q: 3, dur: 0.05, gain: gain * 0.55, attack: 0.001 });
  tone(ctx, out, t + 0.05, { wave: 'triangle', freq: 820 * p, to: 760 * p, dur: 0.18, gain: gain * 0.12, attack: 0.002 });
}

export const ROBOT_SFX = {
  ev_chirp(ctx, out, t, { p, quiet }) {
    const k = quiet ? 0.35 : 1;
    tone(ctx, out, t, { wave: 'square', freq: 1800 * p, dur: 0.07, gain: 0.07 * k, attack: 0.003, hold: 0.04 });
    tone(ctx, out, t + 0.12, { wave: 'square', freq: 2300 * p, dur: 0.07, gain: 0.07 * k, attack: 0.003, hold: 0.04 });
    return 0.22;
  },
  robot_power_up(ctx, out, t, { p }) {
    const dur = 1.6;
    const saw = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 80 * p], [dur, 320 * p]], dur, gain: 0.1, attack: 0.5, hold: 0.8 });
    const sine = tone(ctx, out, t, { freq: [[0, 160 * p], [dur, 640 * p]], dur, gain: 0.08, attack: 0.4, hold: 0.9 });
    lfo(ctx, [saw.detune, sine.detune], t, dur, { rate: 7, depth: 35, fadeIn: 0.4 });
    noise(ctx, out, t, { filter: 'bandpass', freq: [[0, 300], [dur, 1800]], q: 2, dur, gain: 0.05, attack: 0.6 });
    // Ratchet clicks, faster and higher as it winds up.
    let at = 0.15;
    for (let i = 0; at < dur - 0.05; i++) {
      noise(ctx, out, t + at, { filter: 'highpass', freq: 2200 + i * 160, dur: 0.012, gain: 0.08, attack: 0.001 });
      at += Math.max(0.05, 0.16 - i * 0.012);
    }
    return dur + 0.1;
  },
  robot_clunk(ctx, out, t, { p }) {
    clunk(ctx, out, t, p, 0.32);
    return 0.3;
  },
  robot_horn(ctx, out, t, { p }) {
    for (const f of [392, 494]) {
      const o = tone(ctx, out, t, { wave: 'sawtooth', freq: f * p, dur: 0.5, gain: 0.05, attack: 0.02, hold: 0.36 });
      lfo(ctx, o.detune, t, 0.5, { rate: 5, depth: 6 });
      tone(ctx, out, t, { wave: 'square', freq: f * p, dur: 0.5, gain: 0.025, attack: 0.02, hold: 0.36 });
    }
    return 0.55;
  },
  robot_step(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 90 * p, to: 42 * p, glide: 0.1, dur: 0.2, gain: 0.34, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 700, dur: 0.08, gain: 0.18, attack: 0.002 });
    tone(ctx, out, t + 0.03, { wave: 'sawtooth', freq: 420 * p, to: 560 * p, glide: 0.12, dur: 0.14, gain: 0.025, attack: 0.02 });
    return 0.22;
  },
  robot_whirr(ctx, out, t, { p }) {
    const o = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 600 * p], [0.12, 760 * p], [0.24, 700 * p]], dur: 0.26, gain: 0.025, attack: 0.04 });
    lfo(ctx, o.detune, t, 0.26, { rate: 38, depth: 20 });
    return 0.28;
  },
  robot_power_down(ctx, out, t, { p }) {
    const dur = 1.1;
    const saw = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 300 * p], [dur, 70 * p]], dur, gain: 0.08, attack: 0.05, hold: 0.5 });
    lfo(ctx, saw.detune, t, dur, { rate: 6, depth: 30 });
    tone(ctx, out, t, { freq: [[0, 600 * p], [dur, 140 * p]], dur, gain: 0.06, attack: 0.05, hold: 0.4 });
    tone(ctx, out, t + dur, { wave: 'square', freq: 880 * p, to: 660 * p, glide: 0.08, dur: 0.1, gain: 0.04, attack: 0.003 });
    return dur + 0.12;
  },
  ev_reverse(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 1050 * p, dur: 0.16, gain: 0.06, attack: 0.01, hold: 0.1 });
    return 0.2;
  },
  robot_stomp_tell(ctx, out, t, { p }) {
    const dur = 0.95;
    const saw = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 260 * p], [dur, 900 * p]], dur, gain: 0.06, attack: 0.15, hold: 0.6 });
    lfo(ctx, saw.detune, t, dur, { rate: 11, depth: 25 });
    tone(ctx, out, t, { wave: 'square', freq: [[0, 30 * p], [dur, 95 * p]], dur, gain: 0.05, attack: 0.2, hold: 0.6 });
    noise(ctx, out, t, { filter: 'bandpass', freq: 600, to: 1600, q: 3, dur, gain: 0.04, attack: 0.3 });
    return dur + 0.05;
  },
  robot_stomp(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 75 * p, to: 28 * p, glide: 0.4, dur: 0.6, gain: 0.7, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 1100, to: 200, dur: 0.3, gain: 0.45, attack: 0.002 });
    noise(ctx, out, t + 0.02, { filter: 'bandpass', freq: 2600, q: 1.5, dur: 0.08, gain: 0.2, attack: 0.001 });
    for (const [f, g, d] of [[410, 0.05, 0.9], [627, 0.035, 0.7], [941, 0.025, 0.5], [1380, 0.015, 0.35]]) tone(ctx, out, t + 0.03, { wave: 'triangle', freq: f * p, dur: d, gain: g, attack: 0.003 });
    return 1;
  },
  robot_wave(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'bandpass', freq: 2400 * p, to: 260 * p, q: 1.2, dur: 0.8, gain: 0.22, attack: 0.02 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 400, dur: 0.6, gain: 0.12, attack: 0.05, kind: 'brown' });
    return 0.85;
  },
  robot_screech(ctx, out, t, { p }) {
    const dur = 0.75;
    noise(ctx, out, t, { filter: 'bandpass', freq: 2800 * p, to: 3400 * p, q: 9, dur, gain: 0.16, attack: 0.05, hold: 0.4 });
    const o = tone(ctx, out, t, { wave: 'sawtooth', freq: 1700 * p, to: 2100 * p, dur, gain: 0.02, attack: 0.08, hold: 0.4 });
    lfo(ctx, o.detune, t, dur, { rate: 23, depth: 40 });
    return dur + 0.05;
  },
  robot_dash(ctx, out, t, { p }) {
    const dur = 0.9;
    tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 180 * p], [0.3, 520 * p], [dur, 340 * p]], dur, gain: 0.07, attack: 0.03, hold: 0.4 });
    noise(ctx, out, t, { filter: 'highpass', freq: 900, to: 3000, q: 0.7, dur, gain: 0.1, attack: 0.08, hold: 0.3 });
    return dur + 0.05;
  },
  robot_clang(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'highpass', freq: 1600, dur: 0.04, gain: 0.3, attack: 0.001 });
    for (const [f, g, d] of [[180, 0.18, 1.1], [432, 0.09, 0.9], [761, 0.06, 0.7], [1133, 0.04, 0.5]]) tone(ctx, out, t, { wave: 'triangle', freq: f * p, dur: d, gain: g, attack: 0.002 });
    return 1.15;
  },
  robot_swipe_tell(ctx, out, t, { p }) {
    const dur = 0.7;
    const o = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 480 * p], [dur, 1500 * p]], dur, gain: 0.05, attack: 0.1, hold: 0.45 });
    lfo(ctx, o.detune, t, dur, { rate: 31, depth: 30 });
    return dur + 0.05;
  },
  robot_swipe(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'bandpass', freq: 1700 * p, to: 420 * p, q: 1.4, dur: 0.38, gain: 0.26, attack: 0.02 });
    tone(ctx, out, t, { freq: 160 * p, to: 70 * p, dur: 0.3, gain: 0.12, attack: 0.01 });
    return 0.42;
  },
  robot_lowbat(ctx, out, t, { p }) {
    [880, 660, 440].forEach((f, i) => tone(ctx, out, t + i * 0.2, { wave: 'square', freq: f * p, dur: 0.15, gain: 0.05, attack: 0.005, hold: 0.09 }));
    return 0.62;
  },
  robot_charge(ctx, out, t, { p }) {
    const dur = 2.2;
    const a = tone(ctx, out, t, { freq: [[0, 110 * p], [dur, 230 * p]], dur, gain: 0.07, attack: 0.25, hold: 1.6 });
    const b = tone(ctx, out, t, { wave: 'triangle', freq: [[0, 220 * p], [dur, 460 * p]], dur, gain: 0.035, attack: 0.25, hold: 1.6 });
    lfo(ctx, [a.detune, b.detune], t, dur, { rate: 6, depth: 18 });
    noise(ctx, out, t, { filter: 'bandpass', freq: 5200, q: 4, dur, gain: 0.012, attack: 0.4, hold: 1.2 });
    return dur + 0.05;
  },
  robot_zap(ctx, out, t, { p }) {
    for (let i = 0; i < 6; i++) noise(ctx, out, t + i * 0.045, { filter: 'highpass', freq: 2400 + ((i * 1700) % 3000), dur: 0.035, gain: 0.16, attack: 0.001 });
    const o = tone(ctx, out, t, { wave: 'sawtooth', freq: 140 * p, dur: 0.3, gain: 0.07, attack: 0.005 });
    lfo(ctx, o.detune, t, 0.3, { rate: 47, depth: 300, wave: 'square' });
    tone(ctx, out, t + 0.3, { freq: 900 * p, to: 180 * p, glide: 0.18, dur: 0.22, gain: 0.14, attack: 0.002 });
    return 0.6;
  },
  robot_tink(ctx, out, t, { p }) {
    tone(ctx, out, t, { wave: 'triangle', freq: 2350 * p, dur: 0.28, gain: 0.07, attack: 0.001 });
    tone(ctx, out, t, { freq: 3610 * p, dur: 0.16, gain: 0.04, attack: 0.001 });
    noise(ctx, out, t, { filter: 'highpass', freq: 4000, dur: 0.015, gain: 0.06, attack: 0.001 });
    return 0.32;
  },
  boss_win(ctx, out, t, { p }) {
    // (D major up an arpeggio to a held top note: bright square and bell.)
    [587, 740, 880, 1175].forEach((f, i) => {
      const at = t + i * 0.11;
      const last = i === 3;
      tone(ctx, out, at, { wave: 'square', freq: f * p, dur: last ? 0.7 : 0.16, gain: 0.045, attack: 0.004, hold: last ? 0.35 : 0.06 });
      tone(ctx, out, at, { wave: 'triangle', freq: f * 2 * p, dur: last ? 0.9 : 0.2, gain: 0.03, attack: 0.002 });
    });
    return 1.25;
  },
  bin_clatter(ctx, out, t, { p }) {
    for (let i = 0; i < 4; i++) noise(ctx, out, t + i * 0.07 + (i % 2) * 0.02, { filter: 'bandpass', freq: (700 + i * 230) * p, q: 3, dur: 0.06, gain: 0.12 - i * 0.02, attack: 0.002 });
    tone(ctx, out, t, { freq: 120 * p, to: 70 * p, dur: 0.15, gain: 0.08, attack: 0.003 });
    return 0.4;
  },
  bin_roll(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'lowpass', freq: 380 * p, dur: 0.26, gain: 0.09, attack: 0.03, kind: 'brown' });
    noise(ctx, out, t + 0.09, { filter: 'bandpass', freq: 900 * p, q: 4, dur: 0.025, gain: 0.05, attack: 0.002 });
    return 0.28;
  },
  bin_lid(ctx, out, t, { p }) {
    for (const [at, g] of [[0, 0.16], [0.075, 0.07]]) {
      noise(ctx, out, t + at, { filter: 'bandpass', freq: 1150 * p, q: 5, dur: 0.05, gain: g, attack: 0.001 });
      tone(ctx, out, t + at, { freq: 210 * p, to: 110 * p, dur: 0.08, gain: g * 0.6, attack: 0.002 });
    }
    return 0.2;
  },
  // The store room's doors (D1: LaneGarage.js).
  door_crack(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'bandpass', freq: 2200 * p, q: 2, dur: 0.03, gain: 0.2, attack: 0.001 });
    tone(ctx, out, t, { wave: 'triangle', freq: 330 * p, to: 180 * p, dur: 0.06, gain: 0.14, attack: 0.002 });
    tone(ctx, out, t + 0.05, { wave: 'sawtooth', freq: 150 * p, to: 120 * p, dur: 0.12, gain: 0.025, attack: 0.01 });
    return 0.25;
  },
  door_smash(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 120 * p, to: 50 * p, dur: 0.2, gain: 0.3, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 1800 * p, dur: 0.12, gain: 0.22, attack: 0.001 });
    // Splinters ticking off, falling; then the planks landing (three tocks).
    for (let i = 0; i < 10; i++) noise(ctx, out, t + 0.03 + i * 0.045, { filter: 'bandpass', freq: (4500 - i * 300) * p, q: 4, dur: 0.018, gain: 0.07 - i * 0.004, attack: 0.001 });
    for (let i = 0; i < 3; i++) tone(ctx, out, t + 0.28 + i * 0.13, { wave: 'triangle', freq: (240 - i * 35) * p, to: (170 - i * 25) * p, dur: 0.07, gain: 0.1, attack: 0.002 });
    return 0.7;
  },
};

// (Its notice chirp and steps carry less far; nothing piles up.)
export const ROBOT_SFX_INFO = {
  ev_chirp: { gap: 0.2, max: 1 },
  robot_power_up: { range: 2, gap: 1, max: 1 },
  robot_clunk: { range: 2, gap: 0.03, max: 4 },
  robot_horn: { range: 2.5, gap: 0.4, max: 1 },
  robot_step: { range: 2, gap: 0.08, max: 2 },
  robot_whirr: { range: 0.8, gap: 0.3, max: 1 },
  robot_power_down: { range: 2, gap: 1, max: 1 },
  ev_reverse: { range: 1.2, gap: 0.3, max: 1 },
  robot_stomp_tell: { range: 2, gap: 0.5, max: 1 },
  robot_stomp: { range: 3, gap: 0.3, max: 1 },
  robot_wave: { range: 2, gap: 0.3, max: 1 },
  robot_screech: { range: 2, gap: 0.5, max: 1 },
  robot_dash: { range: 2, gap: 0.5, max: 1 },
  robot_clang: { range: 2.5, gap: 0.3, max: 1 },
  robot_swipe_tell: { range: 2, gap: 0.5, max: 1 },
  robot_swipe: { range: 2, gap: 0.2, max: 1 },
  robot_lowbat: { range: 2, gap: 1, max: 1 },
  robot_charge: { range: 1.5, gap: 1, max: 1 },
  robot_zap: { range: 2.5, gap: 0.3, max: 1 },
  robot_tink: { range: 1.5, gap: 0.12, max: 2 },
  boss_win: { range: 4, gap: 2, max: 1 },
  bin_clatter: { range: 1.2, gap: 0.15, max: 2 },
  bin_roll: { range: 0.8, gap: 0.12, max: 2 },
  bin_lid: { range: 1.2, gap: 0.2, max: 1 },
  door_crack: { range: 1.2, gap: 0.1, max: 2 },
  door_smash: { range: 1.5, gap: 0.08, max: 2 },
};

export function register(sfx, info) {
  for (const [name, recipe] of Object.entries(ROBOT_SFX)) if (!Object.hasOwn(sfx, name)) sfx[name] = recipe;
  for (const [name, i] of Object.entries(ROBOT_SFX_INFO)) if (!Object.hasOwn(info, name)) info[name] = i;
}

// ---------------------------------------------------------------- its fight's music

// A handclap: three quick bursts of band-passed noise and a short room tail.
export function clap(ctx, out, t, dur, midi, vel) {
  for (let i = 0; i < 3; i++) noise(ctx, out, t + i * 0.011, { filter: 'bandpass', freq: 1250, q: 1.6, dur: 0.02, gain: 0.2 * vel, attack: 0.001 });
  noise(ctx, out, t + 0.033, { filter: 'bandpass', freq: 1100, q: 1.2, dur: 0.14, gain: 0.12 * vel, attack: 0.002 });
}

// "Stompwatt Shuffle": A minor, 4/4, 140 bpm, 16 bars (~27 s loop). A (1-8): the bell lead
// bounces up and down the chords in eighths over the pulse bass's oom-pah and synth stabs on the
// backbeat; it turns on the dominant (Dm E) and comes home. B (9-16): the arpeggios ripple under
// a lead that climbs the major side (F G C) to a high E, falls back through Dm and E, and the
// last bar's E turns the loop round. Original, quoting nothing.
export const STOMPWATT_SONG = {
  title: 'Stompwatt Shuffle',
  level: 0.55,
  fadeIn: 0.6,
  key: 'A',
  mode: 'minor',
  bpm: 140,
  beatsPerBar: 4,
  swing: 0,
  roles: { pad: 'strings', bass: 'pulse', comp: 'synarp' },
  lead: 'glock',
  bassLow: 33,
  mix: { glock: 2.6, synarp: 1.2, clap: 1, pulse: 0.9, strings: 0.6 },
  chords: [
    // A
    'Am', 'Am', 'F', 'G', 'Am', 'Am', 'Dm E', 'Am',
    // B
    'F', 'G', 'C', 'Am', 'Dm', 'E', 'Am', 'E',
  ],
  sections: [
    { from: 1, to: 8, pad: 0.2, bass: 'bounce', comp: 'stabs', drums: 'march' },
    { from: 9, to: 16, pad: 0.26, bass: 'bounce', comp: 'arp', drums: 'soar' },
  ],
  parts: [
    {
      inst: 'glock',
      vel: 0.95,
      bars: {
        1: 'A4:.5 C5:.5 E5:.5 A5:.5 G5:.5 E5:.5 C5:1',
        2: 'B4:.5 C5:.5 D5:.5 E5:.5 C5:1 A4:1',
        3: 'F5:.5 E5:.5 F5:.5 A5:.5 C6:1 A5:1',
        4: 'G5:.5 F5:.5 E5:.5 D5:.5 B4:1 G4:1',
        5: 'A4:.5 C5:.5 E5:.5 A5:.5 B5:.5 A5:.5 E5:1',
        6: 'C6:.75 B5:.25 A5:.5 G5:.5 A5:1 E5:1',
        7: 'F5:.5 A5:.5 D6:1 E5:.5 G#5:.5 B5:1',
        8: 'A5:1.5 E5:.5 A4:1 r:1',
        9: 'C5:.5 F5:.5 A5:.5 C6:.5 A5:1 F5:1',
        10: 'D5:.5 G5:.5 B5:.5 D6:.5 B5:1 G5:1',
        11: 'E5:.5 G5:.5 C6:.5 E6:.5 D6:.5 C6:.5 G5:1',
        12: 'A5:.5 C6:.5 E6:1 C6:.5 A5:.5 E5:1',
        13: 'D6:.5 C6:.5 A5:.5 F5:.5 D5:1 F5:1',
        14: 'E5:.5 G#5:.5 B5:.5 E6:.5 D6:1 B5:1',
        15: 'C6:.5 B5:.5 A5:.5 E5:.5 C5:.5 E5:.5 A5:1',
        16: 'G#5:1 B5:1 E6:1 r:1',
      },
    },
    {
      // Handclaps on the backbeat, doubling up at the end of each half.
      inst: 'clap',
      vel: 0.8,
      bars: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i % 8 === 7 ? 'r:1 C4:1 r:1 C4:.5 C4:.5' : 'r:1 C4:1 r:1 C4:1'])),
    },
  ],
};

// The song and its handclap into the game's tables (audio/songs.js SONGS, instruments.js
// INSTRUMENTS and CHANNELS): the engine plays it as any other track once it has the slot.
export function registerSong(songs, instruments, channels) {
  if (!Object.hasOwn(instruments, 'clap')) instruments.clap = clap;
  if (!Object.hasOwn(channels, 'clap')) channels.clap = { gain: 0.55, pan: -0.12 };
  if (!Object.hasOwn(songs, 'stompwatt')) songs.stompwatt = STOMPWATT_SONG;
}
