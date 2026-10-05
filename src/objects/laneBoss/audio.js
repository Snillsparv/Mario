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
};

export function register(sfx, info) {
  for (const [name, recipe] of Object.entries(ROBOT_SFX)) if (!Object.hasOwn(sfx, name)) sfx[name] = recipe;
  for (const [name, i] of Object.entries(ROBOT_SFX_INFO)) if (!Object.hasOwn(info, name)) info[name] = i;
}
