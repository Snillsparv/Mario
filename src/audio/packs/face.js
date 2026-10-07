// The face screen's sound recipes (audio/sfx.js's format), a pack of the FaceScreen chunk
// (ui/FaceScreen.js registers it as it loads): grabs, creaks, boings and boops.
//
//   FACE_SFX, FACE_SFX_INFO, register(sfx, info)

import { clamp } from '../../core/math.js';
import { boing, rand } from '../sfx.js';
import { envelope, lfo, noise, sweep, tone } from '../synth.js';

export const FACE_SFX = {
  // ---- The face screen (ui/FaceScreen.js): pulling Pip's big stretchy face about.

  // Grabbing the face: a soft, fleshy squish (a muffled press and a little dropping 'pap').
  face_grab(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'lowpass', freq: 1500 * p, to: 450 * p, dur: 0.08, gain: 0.18, attack: 0.004 });
    tone(ctx, out, t, { freq: 360 * p, to: 210 * p, dur: 0.075, gain: 0.12, attack: 0.003 });
    tone(ctx, out, t + 0.02, { wave: 'triangle', freq: 820 * p, to: 640 * p, dur: 0.05, gain: 0.035, attack: 0.003 });
    return 0.1;
  },
  // A rubbery creak each time a pull stretches further (p rises with the stretch): a buzzy
  // sawtooth squeak through a resonant band that bends up, chopped by a stick-slip flutter,
  // over the soft rub of the rubber.
  face_stretch(ctx, out, t, { p }) {
    const dur = 0.17;
    const f = 190 * p;
    const chop = ctx.createGain();
    chop.gain.value = 0.55;
    chop.connect(envelope(ctx, out, t, { peak: 0.6, dur, attack: 0.025, hold: dur * 0.35 }));
    lfo(ctx, chop.gain, t, dur, { rate: rand(30, 40) * p, depth: 0.45, wave: 'square' });
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 6;
    sweep(band.frequency, t, [[0, f * 4.5], [dur, f * 7.5]]);
    band.connect(chop);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    sweep(saw.frequency, t, f, f * 1.4, dur);
    lfo(ctx, saw.detune, t, dur, { rate: 21, depth: 45 });
    saw.connect(band);
    saw.start(t);
    saw.stop(t + dur + 0.02);
    noise(ctx, out, t, { freq: 650 * p, to: 1100 * p, q: 2.5, dur, gain: 0.16, attack: 0.02 });
    return dur + 0.03;
  },
  // Let go: a springy boing with a wobbly 'oing' ringing on after it, its vibrato slowing
  // as it settles. p: lower and longer the further the face was pulled.
  face_boing(ctx, out, t, { p }) {
    const dur = clamp(0.62 / p, 0.35, 0.9);
    boing(ctx, out, t, { from: 120 * p, to: 300 * p, dur, gain: 0.34, rate: 11 });
    const tail = tone(ctx, out, t + 0.03, { wave: 'triangle', freq: 450 * p, to: 420 * p, dur: dur * 0.9, gain: 0.08, attack: 0.01 });
    lfo(ctx, tail.detune, t + 0.03, dur * 0.9, { rate: 7.5, depth: 140, decay: dur * 0.45 });
    return dur + 0.05;
  },
  // A quick poke on the nose: a squeaky toy squeezed and let go (up, then down), each half
  // a reedy chirp with a little air through it.
  face_boop(ctx, out, t, { p }) {
    for (const [dt, a, b, len] of [[0, 980, 1420, 0.085], [0.1, 1380, 820, 0.12]]) {
      const reed = tone(ctx, out, t + dt, { wave: 'triangle', freq: a * p, to: b * p, glide: len * 0.8, dur: len, gain: 0.15, attack: 0.004, hold: len * 0.4 });
      lfo(ctx, reed.detune, t + dt, len, { rate: 42, depth: 30 });
      noise(ctx, out, t + dt, { freq: 2400 * p, q: 4, dur: len * 0.7, gain: 0.05, attack: 0.004 });
    }
    return 0.25;
  },
};

// Playback rules (audio/sfx.js SFX_INFO's).
export const FACE_SFX_INFO = {
  // The face screen: grabs, creaks and boings come in bursts (two fingers, fast pulls).
  face_grab: { gap: 0.04, max: 2 },
  face_stretch: { gap: 0.07, max: 2 },
  face_boing: { gap: 0.05, max: 3 },
  face_boop: { gap: 0.15, max: 1 },
};

// Into the game's tables (the engine plays any name they have); a name there already stays.
export function register(sfx, info) {
  for (const [name, recipe] of Object.entries(FACE_SFX)) if (!Object.hasOwn(sfx, name)) sfx[name] = recipe;
  for (const [name, i] of Object.entries(FACE_SFX_INFO)) if (!Object.hasOwn(info, name)) info[name] = i;
}
