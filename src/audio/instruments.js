// Synthesized instruments for the music sequencer. Each instrument is
//   (ctx, out, time, durationSeconds, midi, velocity) => void
// and schedules its own short-lived nodes. CHANNELS holds the mix (level and stereo pan).

import { mtof } from './theory.js';
import { bell, envelope, harmonicWave, lfo, noise, silentGain, tone } from './synth.js';

// Soft, breathy flute/ocarina: mostly fundamental with a few weak harmonics, a small
// scoop into the pitch, delayed vibrato and a breath "chiff" on the attack.
function flute(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const peak = 0.3 * vel;
  const release = t + Math.max(dur - 0.03, 0.06);
  const g = silentGain(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.03);
  g.gain.setTargetAtTime(peak * 0.78, t + 0.03, 0.25);
  g.gain.setTargetAtTime(0, release, 0.045);
  g.connect(out);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(harmonicWave(ctx, 'flute', [1, 0.22, 0.1, 0.04, 0.015]));
  osc.frequency.setValueAtTime(f * 0.985, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  if (dur > 0.3) lfo(ctx, osc.frequency, t, dur + 0.3, { rate: 5.3, depth: f * 0.0065, fadeIn: 0.4 });
  osc.connect(g);
  osc.start(t);
  osc.stop(release + 0.3);
  noise(ctx, out, t, { freq: f * 2, q: 2.5, dur: 0.09, gain: 0.045 * vel, attack: 0.012 });
}

// Warm string-section pad voice: two detuned saws through a gentle low-pass, slow bow.
function strings(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700 + f * 1.6;
  lp.Q.value = 0.4;
  const g = silentGain(ctx);
  const peak = 0.13 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.28);
  g.gain.setTargetAtTime(0, t + dur, 0.2);
  lp.connect(g).connect(out);
  for (const detune of [-8, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = detune;
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + dur + 1.2);
  }
}

// Mellow French-horn-like voice: a saw whose low-pass opens with the swell, plus a sine body.
function horn(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 4, t + 0.15);
  lp.frequency.setTargetAtTime(f * 2.5, t + 0.15, 0.4);
  const g = silentGain(ctx);
  const peak = 0.16 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.09);
  g.gain.setTargetAtTime(peak * 0.8, t + 0.09, 0.3);
  g.gain.setTargetAtTime(0, t + dur - 0.05, 0.08);
  lp.connect(g).connect(out);
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  const body = ctx.createOscillator();
  body.frequency.value = f;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.6;
  saw.connect(lp);
  body.connect(bodyGain).connect(lp);
  if (dur > 0.5) lfo(ctx, saw.frequency, t, dur + 0.5, { rate: 4.8, depth: f * 0.004, fadeIn: 0.5 });
  for (const osc of [saw, body]) {
    osc.start(t);
    osc.stop(t + dur + 0.6);
  }
}

// Plucked, bouncy bass: triangle + a little square through a resonant low-pass that snaps
// shut, giving a round "bwop" that decays like a pizzicato.
function bass(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  lp.frequency.setValueAtTime(Math.min(f * 14, 4000), t);
  lp.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.13);
  const env = envelope(ctx, out, t, { peak: 0.5 * vel, dur: Math.min(dur + 0.2, 0.9), attack: 0.004 });
  lp.connect(env);
  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  const sq = ctx.createOscillator();
  sq.type = 'square';
  sq.frequency.value = f;
  const sqGain = ctx.createGain();
  sqGain.gain.value = 0.22;
  tri.connect(lp);
  sq.connect(sqGain).connect(lp);
  for (const osc of [tri, sq]) {
    osc.start(t);
    osc.stop(t + 1);
  }
}

// Harp / plucked-string: triangle fundamental that rings, with a quick bright octave.
function harp(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  tone(ctx, out, t, { wave: 'triangle', freq: f, dur: 1.1, gain: 0.24 * vel, attack: 0.003 });
  tone(ctx, out, t, { freq: f * 2, dur: 0.3, gain: 0.08 * vel, attack: 0.002 });
}

function glock(ctx, out, t, dur, midi, vel) {
  bell(ctx, out, t, { freq: mtof(midi), dur: 1.3, gain: 0.1 * vel });
}

// Timpani: slightly sharp strike settling to pitch, inharmonic overtones, mallet thump.
function timpani(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  tone(ctx, out, t, { freq: f * 1.03, to: f, glide: 0.08, dur: 1.6, gain: 0.5 * vel, attack: 0.004 });
  tone(ctx, out, t, { freq: f * 1.5, dur: 0.7, gain: 0.16 * vel, attack: 0.004 });
  tone(ctx, out, t, { freq: f * 1.98, dur: 0.45, gain: 0.08 * vel, attack: 0.004 });
  noise(ctx, out, t, { filter: 'lowpass', freq: 500, dur: 0.07, gain: 0.25 * vel });
}

function kick(ctx, out, t, dur, midi, vel) {
  tone(ctx, out, t, { freq: 120, to: 44, glide: 0.1, dur: 0.3, gain: 0.6 * vel, attack: 0.002 });
}

function shaker(ctx, out, t, dur, midi, vel) {
  noise(ctx, out, t, { filter: 'highpass', freq: 5500, q: 0.7, dur: 0.075, gain: 0.13 * vel, attack: 0.014 });
}

// ---- Dark track ("Signal Lost", AI RACE mode): cold synths and metal.

// Dark synth pad: detuned saws (one an octave down) through a resonant low-pass whose
// cutoff breathes slowly, swelling in over a second and dying away slowly.
function darkpad(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300 + f * 1.1;
  lp.Q.value = 2;
  const g = silentGain(ctx);
  const peak = 0.07 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(1.2, dur * 0.5));
  g.gain.setTargetAtTime(0, t + dur, 0.5);
  lp.connect(g).connect(out);
  const end = t + dur + 2.5;
  lfo(ctx, lp.frequency, t, end - t, { rate: 0.18, depth: 220 });
  for (const [ratio, detune] of [[1, -9], [1, 8], [0.5, 0]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f * ratio;
    osc.detune.value = detune;
    osc.connect(lp);
    osc.start(t);
    osc.stop(end);
  }
}

// Pulsing low synth bass: a saw and a slightly flat square through a resonant low-pass that
// snaps shut on every note, a throb rather than a pluck (harder notes open it wider).
function pulse(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(Math.min(f * 10 * vel, 3000), t);
  lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.16);
  lp.connect(envelope(ctx, out, t, { peak: 0.36 * vel, dur: dur + 0.1, attack: 0.006 }));
  for (const [type, level, detune] of [['sawtooth', 1, 0], ['square', 0.4, -8]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(lp);
    osc.start(t);
    osc.stop(t + dur + 0.15);
  }
}

// Eerie glassy lead: a sine with a faint, slowly beating octave and a high inharmonic
// ring, a soft swell, and a vibrato creeping in on long notes.
function glass(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  const peak = 0.16 * vel;
  const release = t + Math.max(dur - 0.05, 0.1);
  const g = silentGain(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.12);
  g.gain.setTargetAtTime(peak * 0.75, t + 0.12, 0.6);
  g.gain.setTargetAtTime(0, release, 0.18);
  g.connect(out);
  const oscs = [[1, 1], [2.004, 0.25], [3.01, 0.08]].map(([ratio, level]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const lg = ctx.createGain();
    lg.gain.value = level;
    osc.connect(lg).connect(g);
    osc.start(t);
    osc.stop(release + 1);
    return osc;
  });
  if (dur > 0.6) lfo(ctx, oscs.map((o) => o.detune), t, release + 1 - t, { rate: 4.6, depth: 14, fadeIn: 0.7 });
}

// Struck steel (a girder, a hanging plate): inharmonic partials over the pitch, a noise
// strike and a band of metallic shimmer ringing on.
const CLANG = [
  [1, 0.5, 1],
  [1.73, 0.38, 0.75],
  [2.61, 0.3, 0.55],
  [3.49, 0.2, 0.4],
  [4.83, 0.14, 0.3],
  [6.12, 0.09, 0.2],
];
function clang(ctx, out, t, dur, midi, vel) {
  const f = mtof(midi);
  bell(ctx, out, t, { freq: f, dur: 2.4, gain: 0.22 * vel, partials: CLANG });
  noise(ctx, out, t, { filter: 'highpass', freq: 1800, dur: 0.05, gain: 0.18 * vel, attack: 0.001 });
  noise(ctx, out, t, { freq: f * 5.3, q: 6, dur: 1.2, gain: 0.08 * vel, attack: 0.01 });
}

// Industrial kick: a deep falling thud, a muffled knock and a metallic snap on top.
function thump(ctx, out, t, dur, midi, vel) {
  tone(ctx, out, t, { freq: 95, to: 36, glide: 0.1, dur: 0.5, gain: 0.6 * vel, attack: 0.002 });
  noise(ctx, out, t, { filter: 'lowpass', freq: 320, dur: 0.07, gain: 0.3 * vel, attack: 0.001 });
  noise(ctx, out, t, { freq: 2600, q: 3, dur: 0.025, gain: 0.08 * vel, attack: 0.001 });
}

// A dry metal tick, like a clock's escapement.
function tick(ctx, out, t, dur, midi, vel) {
  noise(ctx, out, t, { filter: 'highpass', freq: 6500, dur: 0.035, gain: 0.14 * vel, attack: 0.001 });
  tone(ctx, out, t, { wave: 'square', freq: 3900, dur: 0.02, gain: 0.025 * vel, attack: 0.001 });
}

export const INSTRUMENTS = { flute, strings, horn, bass, harp, glock, timpani, kick, shaker, darkpad, pulse, glass, clang, thump, tick };

// Mix per instrument: level and stereo position, like an orchestra seen from the front.
export const CHANNELS = {
  flute: { gain: 1, pan: 0 },
  glock: { gain: 0.9, pan: 0.3 },
  horn: { gain: 0.6, pan: -0.3 },
  strings: { gain: 0.85, pan: -0.15 },
  harp: { gain: 0.8, pan: 0.25 },
  bass: { gain: 0.85, pan: 0 },
  timpani: { gain: 0.8, pan: 0.1 },
  kick: { gain: 0.7, pan: 0 },
  shaker: { gain: 1, pan: 0.4 },
  darkpad: { gain: 0.9, pan: 0 },
  pulse: { gain: 0.85, pan: 0 },
  glass: { gain: 0.8, pan: 0.15 },
  clang: { gain: 0.7, pan: -0.3 },
  thump: { gain: 0.8, pan: 0 },
  tick: { gain: 0.7, pan: 0.35 },
};
