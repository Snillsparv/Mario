// Sound-effect recipes in a crisp, cartoony late-90s style, all synthesized.
// Each recipe is (ctx, out, t, opts) => durationSeconds, where opts.p is a pitch multiplier
// (the engine adds a little random variation) plus event data: terrain, big, index.

import { mtof } from './theory.js';
import { bell, envelope, hallImpulse, harmonicWave, lfo, noise, noiseSource, overdrive, prepareNoise, silentGain, sweep, tone } from './synth.js';
import { clamp } from '../core/math.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Footstep level and timbre by ground speed (units/tick), anchored on the gaits: tiptoe
// below 8 (a soft pad), walk below 18 (clearly quieter and duller than a run), a full run
// at 32 at full level; linear in between. `bright` (0..1) takes the click and the sheen off
// the gentler steps, so starting to walk eases in instead of hitting hard.
const STEP_SPEEDS = [0, 8, 18, 32];
const STEP_VOLUME = [0.16, 0.38, 0.62, 1];
const STEP_BRIGHT = [0.25, 0.4, 0.6, 1];
export function footstepLevel(speed = 20) {
  const v = clamp(Number.isFinite(speed) ? speed : 20, 0, STEP_SPEEDS.at(-1));
  let i = 1;
  while (v > STEP_SPEEDS[i]) i++;
  const k = (v - STEP_SPEEDS[i - 1]) / (STEP_SPEEDS[i] - STEP_SPEEDS[i - 1]);
  const at = (list) => list[i - 1] + (list[i] - list[i - 1]) * k;
  return { volume: at(STEP_VOLUME), bright: at(STEP_BRIGHT) };
}

// Landing level from how long Pip was in the air (seconds since he last touched the ground,
// Infinity if unknown) or, when the event carries it, the height fallen: a tiny hop (~0.25 s)
// or a step down lands softly and duller, a full jump (~0.7 s) or a real fall as before.
export function landLevel(air = Infinity, fall = null) {
  const s = Number.isFinite(fall) ? clamp((fall - 40) / 360, 0, 1) : clamp((air - 0.2) / 0.45, 0, 1);
  return { volume: 0.5 + 0.5 * s, bright: 0.4 + 0.6 * s };
}

// Cloth / air whoosh: band-passed noise swept up (or along a point list).
function whoosh(ctx, out, t, { from, to, dur, gain, freq }) {
  return noise(ctx, out, t, { freq: freq || from, to, q: 1.2, dur, gain, attack: dur * 0.3 });
}

// Cartoon spring 'boing', the core of the jump sounds: a sine body with a triangle edge an
// octave up, both bending up past the target and settling back, with a fast wobble that dies
// away as the spring rings out, over a short sub-octave push-off that gives it weight.
function boing(ctx, out, t, { from, to, dur, gain, rate = 32 }) {
  const bend = [[0, from], [dur * 0.35, to * 1.05], [dur, to * 0.97]];
  const body = tone(ctx, out, t, { freq: bend, dur, gain, attack: 0.003 });
  const edge = tone(ctx, out, t, { wave: 'triangle', freq: bend.map(([dt, f]) => [dt, f * 2]), dur: dur * 0.6, gain: gain * 0.22, attack: 0.003 });
  lfo(ctx, [body.detune, edge.detune], t, dur, { rate, depth: 90, decay: dur * 0.35 });
  tone(ctx, out, t, { freq: from * 0.5, to: to * 0.5, glide: dur * 0.5, dur: dur * 0.45, gain: gain * 0.45, attack: 0.003 });
}

// Body impact: a pitch-dropping sine, a muffled noise hit and a short bright contact click
// on top (the crisp edge that keeps it from sounding like mush).
function thud(ctx, out, t, { freq = 150, to = 60, dur = 0.12, gain = 0.4, click = 1 }) {
  tone(ctx, out, t, { freq, to, glide: dur * 0.45, dur, gain, attack: 0.002 });
  noise(ctx, out, t, { filter: 'lowpass', freq: 1400, dur: dur * 0.4, gain: gain * 0.4, attack: 0.001 });
  noise(ctx, out, t, { filter: 'highpass', freq: 3200, dur: 0.014, gain: gain * 0.16 * click, attack: 0.001 });
}

// Cartoon hit 'thwack': a bright wide-band crack, a pitched body that drops fast (the
// punch of it), a short woody 'tock' over it and muffled noise under it.
function thwack(ctx, out, t, { body, to, snap, gain, heavy = false }) {
  noise(ctx, out, t, { freq: snap, q: 0.7, dur: 0.03, gain: gain * 0.6, attack: 0.001 });
  tone(ctx, out, t, { freq: body, to, glide: 0.045, dur: heavy ? 0.13 : 0.1, gain, attack: 0.001 });
  tone(ctx, out, t, { wave: 'triangle', freq: body * 2.7, to: body * 1.6, glide: 0.02, dur: 0.035, gain: gain * 0.3, attack: 0.001 });
  noise(ctx, out, t, { filter: 'lowpass', freq: heavy ? 1100 : 1600, dur: heavy ? 0.07 : 0.05, gain: gain * 0.45, attack: 0.001 });
}

// The punch-punch-kick combo and the flying kick: a cloth swish (a frequency point list, see
// synth.js) that builds into the moment of contact, `swing` seconds in, then the thwack.
// Each has its own swing length, swish band and impact pitch, so the combo climbs from a
// light jab to a heavy kick.
const HITS = {
  punch1: { swing: 0.045, swish: [[0, 1500], [0.085, 4000]], body: [340, 125], snap: 3400, gain: 0.44 },
  punch2: { swing: 0.05, swish: [[0, 1250], [0.09, 3500]], body: [300, 105], snap: 2800, gain: 0.46 },
  kick: { swing: 0.075, swish: [[0, 850], [0.115, 3000]], body: [230, 72], snap: 2200, gain: 0.5, heavy: true },
  jump_kick: { swing: 0.07, swish: [[0, 700], [0.08, 2800], [0.22, 1300]], body: [260, 85], snap: 2500, gain: 0.44, heavy: true },
};
function hit(ctx, out, t, p, { swing, swish, body, snap, gain, heavy }) {
  const dur = swish.at(-1)[0];
  noise(ctx, out, t, { freq: swish, q: 1.4, dur, gain: gain * 0.45, attack: swing * 0.85 });
  thwack(ctx, out, t + swing, { body: body[0] * p, to: body[1] * p, snap, gain, heavy });
  return Math.max(dur, swing + 0.14);
}

// Water drop "plip": a sine that chirps upward very fast.
function plip(ctx, out, t, freq, gain) {
  tone(ctx, out, t, { freq, to: freq * 1.9, glide: 0.035, dur: 0.05, gain, attack: 0.002 });
}

// Short foot contact texture per terrain; also layered into landings. Every surface opens
// with a fast (1-2 ms) attack and a short bright edge so steps read crisply, not as mush.
// `b` (brightness, 0..1) softens a gentle step: a quieter edge, lower sheen, rounder onset.
function step(ctx, out, t, terrain, p, level, b = 1) {
  const edge = level * (0.3 + 0.7 * b); // the bright contact clicks
  const sheen = 0.8 + 0.2 * b; // band centres
  const brush = level * (0.7 + 0.3 * b); // the mid-band body
  const atk = 0.001 + 0.003 * (1 - b);
  switch (terrain) {
    case 'stone':
      noise(ctx, out, t, { filter: 'highpass', freq: 3500, dur: 0.018, gain: 0.19 * edge, attack: atk });
      tone(ctx, out, t, { freq: 1900 * p * sheen, dur: 0.022, gain: 0.06 * edge, attack: atk });
      tone(ctx, out, t, { freq: 200 * p, to: 120 * p, dur: 0.045, gain: 0.145 * level, attack: 0.002 });
      return 0.06;
    case 'wood':
      // Hollow knock, kept short and about as loud as stone (the bridge is walked a lot).
      noise(ctx, out, t, { filter: 'highpass', freq: 3000, dur: 0.01, gain: 0.07 * edge, attack: atk });
      tone(ctx, out, t, { freq: 340 * p, to: 300 * p, dur: 0.055, gain: 0.13 * level, attack: 0.002 });
      tone(ctx, out, t, { wave: 'triangle', freq: 780 * p * sheen, dur: 0.035, gain: 0.045 * edge, attack: atk });
      noise(ctx, out, t, { freq: 900, q: 3, dur: 0.03, gain: 0.06 * brush, attack: 0.002 });
      return 0.08;
    case 'sand':
      // (the grains keep their crisp onset: a rounder one would blur them together)
      for (const dt of [0, 0.013, 0.03]) noise(ctx, out, t + dt, { freq: 3000 * p * sheen, dur: 0.022, gain: 0.33 * brush, attack: 0.001 });
      noise(ctx, out, t, { filter: 'lowpass', freq: 550, dur: 0.05, gain: 0.175 * level, attack: 0.002 });
      return 0.07;
    case 'water':
      noise(ctx, out, t, { freq: 1500 * sheen, to: 700, dur: 0.14, gain: 0.42 * brush, attack: 0.01 });
      plip(ctx, out, t + 0.03, 900 * p, 0.14 * edge);
      return 0.16;
    default: // grass: a crisp blade snap over a soft brush and a light low thump
      noise(ctx, out, t, { filter: 'highpass', freq: 4500, dur: 0.012, gain: 0.13 * edge, attack: atk });
      noise(ctx, out, t, { freq: 1800 * p * sheen, q: 1, dur: 0.045, gain: 0.42 * brush, attack: 0.002 });
      noise(ctx, out, t, { filter: 'lowpass', freq: 520, dur: 0.045, gain: 0.23 * level, attack: 0.002 });
      return 0.07;
  }
}

// Brassy fanfare voice: saw + sub-square through an opening low-pass.
function brass(ctx, out, t, midi, dur, gain) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.05);
  lp.frequency.setTargetAtTime(f * 3, t + 0.05, 0.2);
  const g = silentGain(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.setTargetAtTime(gain * 0.7, t + 0.02, 0.15);
  g.gain.setTargetAtTime(0, t + dur, 0.06);
  lp.connect(g).connect(out);
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  if (dur > 0.4) lfo(ctx, saw.frequency, t, dur + 0.3, { rate: 5.5, depth: f * 0.006, fadeIn: 0.3 });
  saw.connect(lp);
  saw.start(t);
  saw.stop(t + dur + 0.4);
}

// Bright chime note used by coins and pickups: sine bell plus a thin square edge.
function chime(ctx, out, t, freq, dur, gain) {
  bell(ctx, out, t, { freq, dur, gain });
  tone(ctx, out, t, { wave: 'square', freq, dur: dur * 0.25, gain: gain * 0.12 });
}

// ---- AI RACE mode helpers (storm, fire and the robot beast)

// Clanging steel: stiff-bar-like inharmonic partials [ratio, relative gain, relative decay].
const METAL = [
  [1, 1, 1],
  [2.41, 0.6, 0.7],
  [3.87, 0.4, 0.45],
  [5.93, 0.22, 0.3],
];

// A scatter of tiny crackles (burning wood, flying debris): band-passed noise ticks over
// `span` seconds, bunched toward the start when `front` > 1.
function crackles(ctx, out, t, { count, span, gain, lo = 1200, hi = 4500, front = 1 }) {
  for (let i = 0; i < count; i++) {
    const dt = span * Math.random() ** front;
    noise(ctx, out, t + dt, { freq: rand(lo, hi), q: 1.5, dur: rand(0.004, 0.014), gain: gain * rand(0.35, 1), attack: 0.0006 });
  }
}

// Band-passed noise chopped by a sawtooth: a ratcheting, grinding or sputtering texture.
function grind(ctx, out, t, { freq, q, dur, gain, rate, attack = 0.01 }) {
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  chop.connect(envelope(ctx, out, t, { peak: gain, dur, attack }));
  lfo(ctx, chop.gain, t, dur, { rate, depth: 0.5, wave: 'sawtooth' });
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  sweep(f.frequency, t, freq);
  noiseSource(ctx, t, dur + 0.02).connect(f);
  f.connect(chop);
  return f;
}

// One klaxon pulse: two sawtooths a semitone apart (a grating, beating cluster) through a
// resonant low-pass, scooping up into pitch; `fall` bends the end of the pulse down.
function klaxon(ctx, out, t, f, dur, gain, fall = 1) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  sweep(lp.frequency, t, [[0, f * 2.5], [0.05, f * 6], [dur, f * 4 * fall]]);
  lp.connect(envelope(ctx, out, t, { peak: gain, dur, attack: 0.02, hold: dur - 0.08 }));
  for (const [ratio, detune] of [[1, -6], [1.0595, 5]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = detune;
    const fr = f * ratio;
    sweep(o.frequency, t, [[0, fr * 0.84], [0.05, fr], [dur - 0.07, fr], [dur, fr * fall]]);
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  tone(ctx, out, t, { freq: f / 2, dur, gain: gain * 0.5, attack: 0.02, hold: dur - 0.08 });
}

// ---- Winged hat, mystery box, minions and the locked castle (all original synthesis)

// Glassy crystal: bright inharmonic partials [ratio, relative gain, relative decay] that die
// away quickly, the upper ones first.
const CRYSTAL = [
  [1, 1, 1],
  [2.32, 0.5, 0.6],
  [4.25, 0.26, 0.35],
  [6.8, 0.12, 0.2],
];

// The minions' servo whine (the same gear timbre as the floor button's servo).
const servoWave = (ctx) => harmonicWave(ctx, 'servo', [1, 0.5, 0.35, 0.2, 0.12]);

// Band-passed noise riding a frequency point list, its level fluttering at `rate` Hz (the
// flutter dying away with time constant `settle`): air through feathers.
function feathers(ctx, out, t, { freq, q = 1.1, dur, gain, attack, rate = 34, depth = 0.35, settle = 0.12 }) {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  sweep(f.frequency, t, freq);
  const flutter = ctx.createGain();
  flutter.gain.value = 1 - depth;
  lfo(ctx, flutter.gain, t, dur, { rate, depth, decay: settle });
  noiseSource(ctx, t, dur + 0.02).connect(f);
  f.connect(flutter).connect(envelope(ctx, out, t, { peak: gain, dur, attack }));
  return f;
}

// A formant voice for the locked castle's laugh. The source is a deep glottal buzz (its
// harmonics falling off a little faster than a sawtooth's) with a triangle an octave under
// it (a growl), shaped by four band-pass formants. Formants [centre Hz, Q, level] of a big,
// dark 'ah' (each a little under an adult's, as from a huge chest) and of the closed hum it
// opens from ('m').
const GLOTTAL = Array.from({ length: 40 }, (_, i) => 1 / (i + 1) ** 1.3);
const LAUGH_AH = [[590, 5, 1], [980, 8, 0.6], [2250, 12, 0.24], [3050, 14, 0.12]];
const LAUGH_HUM = [[240, 3, 1], [820, 8, 0.12], [2100, 12, 0.05], [2900, 14, 0.03]];
// Syllables [start s, length s, pitch points [s from start, Hz], onset, formant scale]: 'mwa'
// hums and opens, then each 'ha' breathes first and drops in pitch, a little lower each
// time, and the last is held and sinks away, darker ('haaw').
const LAUGH = [
  [0, 0.38, [[0, 92], [0.13, 110], [0.38, 90]], 'm', 1],
  [0.48, 0.17, [[0, 114], [0.17, 94]], 'h', 1],
  [0.7, 0.17, [[0, 108], [0.17, 88]], 'h', 0.98],
  [0.92, 0.18, [[0, 102], [0.18, 82]], 'h', 0.96],
  [1.16, 0.58, [[0, 98], [0.2, 88], [0.58, 60]], 'h', 0.9],
];
const LAUGH_PEAK = 0.5; // voiced level per syllable (before the makeup)
const LAUGH_BREATH = 0.3; // an 'h'
// The formants pass only a few harmonics of the buzz each, so the bank is brought back up
// to a speaking level after them (measured with the preview's offline render).
const LAUGH_MAKEUP = 3.2;
const LAUGH_ECHO = { delay: 0.24, feedback: 0.34, send: 0.35, tone: 1600 }; // slapback off the walls
const LAUGH_HALL = 0.6; // send into the hall reverb

function laughVoice(ctx, out, t, { p, hall, outGain = 1 }) {
  // Output: the dry voice, a slapback echo (a feedback delay, darker each pass) and a big
  // hall, both of which have died away well within the sound's reported length. The hall is
  // the engine's shared one when it passes it (opts.hall, on the sfx bus: the send then
  // carries the voice's own volume, outGain); only a bare render makes one of its own
  // (making a convolver its impulse costs several ms, too long to do on every laugh).
  const voice = ctx.createGain();
  voice.gain.value = LAUGH_MAKEUP;
  voice.connect(out);
  const hallSend = ctx.createGain();
  hallSend.gain.value = LAUGH_HALL * (hall ? outGain : 1);
  if (!hall) {
    hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx);
    hall.connect(out);
  }
  hallSend.connect(hall);
  voice.connect(hallSend);
  const echo = ctx.createDelay(1);
  echo.delayTime.value = LAUGH_ECHO.delay;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = LAUGH_ECHO.tone;
  const feedback = ctx.createGain();
  feedback.gain.value = LAUGH_ECHO.feedback;
  const echoSend = ctx.createGain();
  echoSend.gain.value = LAUGH_ECHO.send;
  voice.connect(echoSend).connect(echo).connect(echoTone);
  echoTone.connect(feedback).connect(echo);
  echoTone.connect(out);
  echoTone.connect(hallSend);

  const bank = LAUGH_AH.map(([, q, level]) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    bp.connect(g).connect(voice);
    return bp;
  });
  const voiced = silentGain(ctx);
  const breath = silentGain(ctx);
  for (const bp of bank) {
    voiced.connect(bp);
    breath.connect(bp);
  }
  const end = LAUGH.at(-1)[0] + LAUGH.at(-1)[1] + 0.15;
  const glottis = ctx.createOscillator();
  glottis.setPeriodicWave(harmonicWave(ctx, 'glottal', GLOTTAL));
  const growl = ctx.createOscillator();
  growl.type = 'triangle';
  const growlLevel = ctx.createGain();
  growlLevel.gain.value = 0.35;
  glottis.connect(voiced);
  growl.connect(growlLevel).connect(voiced);
  lfo(ctx, [glottis.detune, growl.detune], t, end, { rate: 5.2, depth: 22 });
  noiseSource(ctx, t, end).connect(breath);
  for (const osc of [glottis, growl]) {
    osc.start(t);
    osc.stop(t + end);
  }

  const g = voiced.gain;
  const b = breath.gain;
  LAUGH.forEach(([start, len, pitch, onset, scale], i) => {
    const a = t + start;
    const pts = pitch.map(([dt, hz]) => [dt, hz * p]);
    sweep(glottis.frequency, a, pts);
    sweep(growl.frequency, a, pts.map(([dt, hz]) => [dt, hz / 2]));
    bank.forEach((bp, k) => {
      const ah = LAUGH_AH[k][0] * scale;
      if (onset === 'm') sweep(bp.frequency, a, [[0, LAUGH_HUM[k][0]], [0.1, LAUGH_HUM[k][0]], [0.2, ah]]);
      else bp.frequency.setValueAtTime(ah, a);
    });
    if (onset === 'm') {
      // A hum that swells as the mouth opens.
      g.setValueAtTime(0, a);
      g.linearRampToValueAtTime(LAUGH_PEAK * 0.5, a + 0.04);
      g.linearRampToValueAtTime(LAUGH_PEAK * 0.45, a + 0.1);
      g.linearRampToValueAtTime(LAUGH_PEAK, a + 0.19);
    } else {
      // A breath through the open mouth, the voice catching just after it.
      b.setValueAtTime(0, a);
      b.linearRampToValueAtTime(LAUGH_BREATH, a + 0.015);
      b.linearRampToValueAtTime(0, a + 0.07);
      g.setValueAtTime(0, a + 0.035);
      g.linearRampToValueAtTime(LAUGH_PEAK, a + 0.075);
    }
    g.linearRampToValueAtTime(LAUGH_PEAK * 0.75, a + len - 0.05);
    g.linearRampToValueAtTime(0, a + len);
    if (i === LAUGH.length - 1) {
      // The last one trails off into a breath.
      b.setValueAtTime(0, a + len - 0.12);
      b.linearRampToValueAtTime(LAUGH_BREATH * 0.4, a + len);
      b.linearRampToValueAtTime(0, a + len + 0.14);
    }
  });
}

// F major scale from F5 up an octave: red coins 1..8 climb it.
const RED_COIN_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];

export const SFX = {
  jump(ctx, out, t, { p }) {
    boing(ctx, out, t, { from: 290 * p, to: 780 * p, dur: 0.2, gain: 0.44 });
    whoosh(ctx, out, t, { from: 800, to: 2600, dur: 0.2, gain: 0.3 });
    return 0.22;
  },
  double_jump(ctx, out, t, { p }) {
    boing(ctx, out, t, { from: 400 * p, to: 1100 * p, dur: 0.17, gain: 0.38, rate: 36 });
    boing(ctx, out, t + 0.07, { from: 620 * p, to: 1450 * p, dur: 0.15, gain: 0.26, rate: 36 });
    whoosh(ctx, out, t, { from: 1000, to: 3000, dur: 0.24, gain: 0.26 });
    return 0.25;
  },
  // A springier, higher launch with a rising major arpeggio over it and a long airy swoop.
  triple_jump(ctx, out, t, { p }) {
    boing(ctx, out, t, { from: 330 * p, to: 990 * p, dur: 0.22, gain: 0.3, rate: 30 });
    [72, 76, 79, 84].forEach((m, i) => {
      tone(ctx, out, t + 0.04 + i * 0.055, { wave: 'triangle', freq: mtof(m) * p, to: mtof(m + 2) * p, dur: 0.12, gain: 0.2 });
    });
    const wee = tone(ctx, out, t + 0.24, { freq: 700 * p, to: 1500 * p, glide: 0.35, dur: 0.45, gain: 0.13, attack: 0.05 });
    lfo(ctx, wee.frequency, t + 0.24, 0.45, { rate: 9, depth: 40 });
    whoosh(ctx, out, t, { freq: [[0, 600], [0.3, 3200], [0.55, 1800]], dur: 0.6, gain: 0.24 });
    return 0.7;
  },
  backflip(ctx, out, t, { p }) {
    whoosh(ctx, out, t, { from: 700, to: 2000, dur: 0.16, gain: 0.35 });
    whoosh(ctx, out, t + 0.16, { from: 900, to: 2600, dur: 0.18, gain: 0.35 });
    tone(ctx, out, t, { wave: 'triangle', freq: 300 * p, to: 760 * p, dur: 0.3, gain: 0.3, attack: 0.02 });
    return 0.36;
  },
  sideflip(ctx, out, t, { p }) {
    whoosh(ctx, out, t, { freq: [[0, 800], [0.15, 2800], [0.32, 1200]], dur: 0.34, gain: 0.416 });
    tone(ctx, out, t, { wave: 'triangle', freq: 380 * p, to: 900 * p, dur: 0.24, gain: 0.312, attack: 0.02 });
    return 0.36;
  },
  long_jump(ctx, out, t, { p }) {
    whoosh(ctx, out, t, { freq: [[0, 500], [0.25, 1800], [0.55, 700]], dur: 0.58, gain: 0.4 });
    tone(ctx, out, t, { wave: 'triangle', freq: 250 * p, to: 540 * p, glide: 0.3, dur: 0.36, gain: 0.24, attack: 0.02 });
    return 0.6;
  },
  wallkick(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 180 * p, to: 60 * p, dur: 0.14, gain: 0.45 });
    const boing = tone(ctx, out, t + 0.03, { wave: 'triangle', freq: 300 * p, to: 820 * p, glide: 0.12, dur: 0.26, gain: 0.3 });
    lfo(ctx, boing.frequency, t + 0.03, 0.26, { rate: 30, depth: 50 });
    return 0.3;
  },
  dive(ctx, out, t, { p }) {
    whoosh(ctx, out, t, { from: 2400, to: 700, dur: 0.3, gain: 0.432 });
    tone(ctx, out, t, { wave: 'triangle', freq: 800 * p, to: 350 * p, dur: 0.28, gain: 0.27, attack: 0.01 });
    return 0.32;
  },
  ground_pound(ctx, out, t, { p }) {
    const f = whoosh(ctx, out, t, { from: 600, to: 2600, dur: 0.36, gain: 0.504 });
    lfo(ctx, f.frequency, t, 0.36, { rate: 16, depth: 500 });
    tone(ctx, out, t, { wave: 'triangle', freq: 500 * p, to: 1000 * p, dur: 0.3, gain: 0.224, attack: 0.03 });
    return 0.38;
  },
  ground_pound_land(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 120 * p, to: 38, glide: 0.25, dur: 0.45, gain: 0.44, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 500, to: 120, dur: 0.3, gain: 0.3 });
    noise(ctx, out, t, { freq: 1500, dur: 0.06, gain: 0.12 });
    tone(ctx, out, t, { freq: 55, dur: 0.9, gain: 0.2, attack: 0.01 });
    return 0.95;
  },
  punch1: (ctx, out, t, { p }) => hit(ctx, out, t, p, HITS.punch1),
  punch2: (ctx, out, t, { p }) => hit(ctx, out, t, p, HITS.punch2),
  kick: (ctx, out, t, { p }) => hit(ctx, out, t, p, HITS.kick),
  jump_kick: (ctx, out, t, { p }) => hit(ctx, out, t, p, HITS.jump_kick),
  // The plain name, for callers that do not tell the jabs apart: the engine plays it as
  // punch1 or, right after a first jab, as punch2 (see AudioEngine.comboJab).
  punch: (ctx, out, t, { p }) => hit(ctx, out, t, p, HITS.punch1),
  // An ordinary landing: a thump under the ground's texture. The engine passes a lower
  // volume and brightness for hops and small drops (landLevel): less click, a duller step.
  land(ctx, out, t, { p, terrain, bright = 1 }) {
    thud(ctx, out, t, { freq: 150 * p, to: 70 * p, dur: 0.1, gain: 0.45, click: 0.35 + 0.65 * bright });
    return Math.max(0.12, step(ctx, out, t, terrain, p, 1.2 * (0.85 + 0.15 * bright), 0.3 + 0.7 * bright));
  },
  land_hard(ctx, out, t, { p, terrain }) {
    thud(ctx, out, t, { freq: 130 * p, to: 45 * p, dur: 0.22, gain: 0.47 });
    return Math.max(0.24, step(ctx, out, t, terrain, p * 0.9, 1.4));
  },
  // bright: from footstepLevel (the engine passes it with the matching volume).
  footstep(ctx, out, t, { p, terrain, bright = 1 }) {
    return step(ctx, out, t, terrain, p * (0.94 + 0.06 * bright), 1, bright);
  },
  skid(ctx, out, t, { p, terrain }) {
    const sandy = terrain === 'sand' || terrain === 'grass';
    const f = noise(ctx, out, t, {
      freq: (sandy ? 1500 : 2600) * p,
      to: (sandy ? 1100 : 1800) * p,
      q: sandy ? 2 : 5,
      dur: 0.35,
      gain: 0.56,
      attack: 0.02,
    });
    lfo(ctx, f.frequency, t, 0.35, { rate: 25, depth: 300 });
    return 0.36;
  },
  bonk(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 220 * p, to: 80 * p, dur: 0.12, gain: 0.51 });
    const bwong = tone(ctx, out, t + 0.02, { wave: 'triangle', freq: 520 * p, to: 260 * p, glide: 0.3, dur: 0.35, gain: 0.26 });
    lfo(ctx, bwong.frequency, t + 0.02, 0.35, { rate: 12, depth: 20 });
    return 0.4;
  },
  hurt(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'lowpass', freq: 1800, dur: 0.06, gain: 0.4 });
    const wob = tone(ctx, out, t, { wave: 'triangle', freq: 760 * p, to: 240 * p, glide: 0.5, dur: 0.55, gain: 0.42 });
    lfo(ctx, wob.frequency, t, 0.55, { rate: 14, depth: 50 });
    return 0.58;
  },
  ledge_grab(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 1800, q: 2, dur: 0.05, gain: 0.42 });
    tone(ctx, out, t, { wave: 'triangle', freq: 420 * p, to: 640 * p, dur: 0.07, gain: 0.336 });
    return 0.08;
  },
  climb(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 1400 * p, q: 1.5, dur: 0.06, gain: 0.24, attack: 0.01 });
    tone(ctx, out, t, { wave: 'triangle', freq: 300 * p, to: 360 * p, dur: 0.05, gain: 0.15 });
    return 0.07;
  },
  swim(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'lowpass', freq: 900, to: 400, dur: 0.3, gain: 0.33, attack: 0.06 });
    for (let i = 0; i < 4; i++) plip(ctx, out, t + rand(0.02, 0.25), rand(350, 700) * p, 0.154);
    return 0.35;
  },
  splash(ctx, out, t, { p, big }) {
    const dur = big ? 0.9 : 0.5;
    noise(ctx, out, t, { freq: 2500, to: 500, q: 0.7, dur, gain: big ? 0.4 : 0.26, attack: 0.01 });
    noise(ctx, out, t, { filter: 'highpass', freq: 3000, dur: dur * 0.4, gain: 0.08 });
    if (big) tone(ctx, out, t, { freq: 90 * p, to: 40, dur: 0.3, gain: 0.28 });
    for (let i = 0; i < (big ? 8 : 5); i++) plip(ctx, out, t + rand(0.15, dur), rand(900, 1800) * p, 0.05);
    return dur + 0.05;
  },
  water_exit(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 1800, to: 900, dur: 0.25, gain: 0.45, attack: 0.02 });
    plip(ctx, out, t + 0.1, 1100 * p, 0.15);
    plip(ctx, out, t + 0.2, 1400 * p, 0.12);
    return 0.28;
  },
  coin(ctx, out, t, { p }) {
    chime(ctx, out, t, 1568 * p, 0.25, 0.2);
    chime(ctx, out, t + 0.065, 2349 * p, 0.5, 0.2);
    return 0.6;
  },
  red_coin(ctx, out, t, { p, index = 1 }) {
    const f = mtof(77 + RED_COIN_STEPS[Math.min(Math.max(index, 1), 8) - 1]) * p;
    chime(ctx, out, t, f, 0.5, 0.2);
    chime(ctx, out, t + 0.08, f * 1.5, 0.8, 0.16);
    bell(ctx, out, t + 0.16, { freq: f * 2, dur: 0.6, gain: 0.06 });
    return 0.95;
  },
  star_appear(ctx, out, t, { p }) {
    const penta = [65, 67, 69, 72, 74];
    for (let i = 0; i < 18; i++) {
      const m = penta[i % 5] + 12 * Math.floor(i / 5);
      bell(ctx, out, t + i * 0.05, { freq: mtof(m) * p, dur: 0.6, gain: 0.09 });
    }
    const shimmer = noise(ctx, out, t, { filter: 'highpass', freq: 6000, dur: 1.4, gain: 0.05, attack: 0.4 });
    lfo(ctx, shimmer.frequency, t, 1.4, { rate: 11, depth: 1500 });
    for (const m of [89, 93, 96]) bell(ctx, out, t + 0.95, { freq: mtof(m) * p, dur: 1.2, gain: 0.07 });
    return 2.2;
  },
  // Short original fanfare: F major arpeggio up, a lift through Bb, and a held F chord.
  star_get(ctx, out, t) {
    const lead = [[0, 72, 0.1], [0.12, 77, 0.1], [0.24, 81, 0.1], [0.36, 84, 0.32], [0.72, 82, 0.1], [0.84, 84, 0.1], [0.96, 86, 0.3], [1.32, 89, 1.1]];
    for (const [dt, m, d] of lead) brass(ctx, out, t + dt, m, d, 0.11);
    const harmony = [[0.36, [65, 69], 0.32], [0.72, [70, 74], 0.54], [1.32, [65, 69, 72, 77], 1.1]];
    for (const [dt, ms, d] of harmony) for (const m of ms) brass(ctx, out, t + dt, m, d, 0.06);
    brass(ctx, out, t + 1.32, 41, 1.1, 0.1);
    for (let i = 0; i < 8; i++) tone(ctx, out, t + 1.0 + i * 0.04, { freq: mtof(41), dur: 0.5, gain: 0.08 + i * 0.02 });
    for (let i = 0; i < 6; i++) bell(ctx, out, t + 1.32 + i * 0.07, { freq: mtof([77, 81, 84, 89, 93, 96][i]), dur: 0.7, gain: 0.05 });
    return 2.8;
  },
  one_up(ctx, out, t, { p }) {
    [79, 84, 88, 91, 96].forEach((m, i) => chime(ctx, out, t + i * 0.075, mtof(m) * p, i === 4 ? 0.7 : 0.18, 0.15));
    return 1.1;
  },
  life_lost(ctx, out, t, { p }) {
    [[79, 77], [76, 74], [72, 67]].forEach(([a, b], i) => {
      const glide = i === 2 ? 0.6 : 0.2;
      const o = tone(ctx, out, t + i * 0.3, { wave: 'triangle', freq: mtof(a) * p, to: mtof(b) * p, glide, dur: glide + 0.1, gain: 0.2, attack: 0.02 });
      lfo(ctx, o.frequency, t + i * 0.3, glide + 0.1, { rate: 6, depth: 8 });
    });
    return 1.4;
  },
  pause(ctx, out, t) {
    chime(ctx, out, t, 1175, 0.12, 0.14);
    chime(ctx, out, t + 0.08, 880, 0.2, 0.14);
    return 0.3;
  },
  unpause(ctx, out, t) {
    chime(ctx, out, t, 880, 0.12, 0.14);
    chime(ctx, out, t + 0.08, 1175, 0.2, 0.14);
    return 0.3;
  },
  menu_select(ctx, out, t, { p }) {
    tone(ctx, out, t, { wave: 'triangle', freq: 1320 * p, dur: 0.08, gain: 0.256 });
    tone(ctx, out, t + 0.05, { wave: 'triangle', freq: 1760 * p, dur: 0.14, gain: 0.256 });
    return 0.2;
  },
  camera_move(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'highpass', freq: 3000, dur: 0.012, gain: 0.105 });
    tone(ctx, out, t, { freq: 2200 * p, dur: 0.015, gain: 0.053 });
    noise(ctx, out, t, { freq: 1000, to: 1600, dur: 0.1, gain: 0.038, attack: 0.03 });
    return 0.11;
  },
  camera_buzz(ctx, out, t) {
    for (const dt of [0, 0.12]) tone(ctx, out, t + dt, { wave: 'square', freq: 140, dur: 0.09, gain: 0.084, hold: 0.05 });
    return 0.22;
  },
  // Sign dialog box. Soft UI sounds: they sit well under the gameplay sounds.
  // Opening: a paper flick and a hollow wooden 'pop' that bends up.
  dialog_open(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 2200, to: 4200, q: 1.3, dur: 0.06, gain: 0.07, attack: 0.012 });
    tone(ctx, out, t + 0.01, { freq: 380 * p, to: 640 * p, glide: 0.04, dur: 0.09, gain: 0.2, attack: 0.002 });
    tone(ctx, out, t + 0.01, { wave: 'triangle', freq: 1150 * p, to: 1500 * p, glide: 0.03, dur: 0.04, gain: 0.05, attack: 0.001 });
    return 0.12;
  },
  // Typing: one tiny soft tick every few characters (a single oscillator, so it is cheap),
  // its pitch wandering a little so a line of text chatters instead of drilling.
  text_blip(ctx, out, t, { p }) {
    tone(ctx, out, t, { wave: 'triangle', freq: 1250 * p * rand(0.93, 1.07), dur: 0.028, gain: 0.1, attack: 0.002 });
    return 0.03;
  },
  // Next page: a soft click, bright tick over a small low knock.
  dialog_next(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'highpass', freq: 3500, dur: 0.01, gain: 0.08, attack: 0.001 });
    tone(ctx, out, t, { freq: 1700 * p, to: 1400 * p, dur: 0.035, gain: 0.11, attack: 0.001 });
    tone(ctx, out, t, { freq: 560 * p, dur: 0.04, gain: 0.11, attack: 0.001 });
    return 0.04;
  },
  // Closing: the opening pop in reverse, bending down, settling with a soft knock.
  dialog_close(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 3000, to: 1500, q: 1.3, dur: 0.05, gain: 0.05, attack: 0.008 });
    tone(ctx, out, t, { freq: 620 * p, to: 330 * p, glide: 0.06, dur: 0.11, gain: 0.18, attack: 0.003 });
    tone(ctx, out, t + 0.05, { freq: 300 * p, to: 260 * p, dur: 0.06, gain: 0.1, attack: 0.002 });
    return 0.14;
  },

  // ---- AI RACE mode (all original synthesis, no recordings or imitations)

  // The floor button: a heavy clunk (sinking low body, dull knock, latch click and a clank
  // of steel), then a geared servo spinning up and settling, and a locking chunk.
  button_press(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 115 * p, to: 46 * p, glide: 0.12, dur: 0.32, gain: 0.44, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 900, dur: 0.08, gain: 0.3, attack: 0.001 });
    noise(ctx, out, t, { filter: 'highpass', freq: 3200, dur: 0.014, gain: 0.16, attack: 0.001 });
    bell(ctx, out, t + 0.005, { freq: 230 * p, dur: 0.4, gain: 0.09, partials: METAL });
    const servo = tone(ctx, out, t + 0.12, {
      wave: harmonicWave(ctx, 'servo', [1, 0.5, 0.35, 0.2, 0.12]),
      freq: [[0, 240 * p], [0.32, 640 * p], [0.55, 560 * p]],
      dur: 0.58,
      gain: 0.08,
      attack: 0.06,
      hold: 0.3,
    });
    lfo(ctx, servo.detune, t + 0.12, 0.58, { rate: 47, depth: 18 });
    tone(ctx, out, t + 0.72, { freq: 190 * p, to: 95 * p, glide: 0.05, dur: 0.09, gain: 0.2, attack: 0.002 });
    noise(ctx, out, t + 0.72, { filter: 'highpass', freq: 2800, dur: 0.012, gain: 0.1, attack: 0.001 });
    return 0.85;
  },

  // Alarm sting as the storm mode switches on: two grating klaxon pulses, then a lower one
  // that sinks away.
  alarm(ctx, out, t, { p }) {
    klaxon(ctx, out, t, 440 * p, 0.26, 0.15);
    klaxon(ctx, out, t + 0.34, 440 * p, 0.26, 0.15);
    klaxon(ctx, out, t + 0.68, 293.7 * p, 0.55, 0.16, 0.72);
    return 1.3;
  },

  // The robot beast's roar (~2.3 s): a driven growl of detuned saws and a sine, frequency-
  // modulated at an inharmonic ratio and trembling ~26 times a second, through a resonant
  // low-pass that opens and closes; steel grinding in its throat, a jaw servo, and a hiss of
  // venting steam as it dies away.
  kaiju_roar(ctx, out, t, { p }) {
    const dur = 2.2;
    const env = silentGain(ctx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3, t + 0.28);
    env.gain.linearRampToValueAtTime(0.24, t + 1.3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    env.connect(out);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    sweep(lp.frequency, t, [[0, 350], [0.3, 2600], [1.1, 1500], [dur, 260]]);
    lp.connect(env);
    const tremble = ctx.createGain();
    tremble.gain.value = 0.6;
    tremble.connect(overdrive(ctx, lp, 5));
    lfo(ctx, tremble.gain, t, dur, { rate: 26, depth: 0.35 });
    const pitch = [[0, 46 * p], [0.3, 76 * p], [0.8, 70 * p], [1.4, 62 * p], [dur, 36 * p]];
    const mod = ctx.createOscillator();
    sweep(mod.frequency, t, pitch.map(([dt, f]) => [dt, f * 1.47]));
    const depth = silentGain(ctx);
    depth.gain.setValueAtTime(10, t);
    depth.gain.linearRampToValueAtTime(55, t + 0.4);
    depth.gain.linearRampToValueAtTime(25, t + dur);
    mod.connect(depth);
    for (const [wave, detune, level] of [['sawtooth', -14, 0.5], ['sawtooth', 11, 0.5], ['sine', 0, 0.6]]) {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.detune.value = detune;
      sweep(osc.frequency, t, pitch);
      depth.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(tremble);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    mod.start(t);
    mod.stop(t + dur + 0.05);
    bell(ctx, out, t, { freq: 170 * p, dur: 0.5, gain: 0.07, partials: METAL });
    const gr = grind(ctx, out, t + 0.2, { freq: 2600, q: 8, dur: 1.5, gain: 0.12, rate: 38, attack: 0.25 });
    lfo(ctx, gr.frequency, t + 0.2, 1.5, { rate: 11, depth: 900 });
    tone(ctx, out, t, { wave: 'triangle', freq: [[0, 420 * p], [0.45, 1250 * p], [1.6, 1100 * p], [2.1, 500 * p]], dur: 2.1, gain: 0.025, attack: 0.2 });
    noise(ctx, out, t + 1.45, { filter: 'highpass', freq: 2800, to: 5200, dur: 0.85, gain: 0.16, attack: 0.06 });
    noise(ctx, out, t + 1.45, { freq: 1400, to: 900, q: 0.7, dur: 0.7, gain: 0.08, attack: 0.05 });
    return 2.3;
  },

  // The beast drawing breath for a fireball: a roaring whoosh that rises over ~0.8 s.
  fireball_charge(ctx, out, t, { p }) {
    const roar = noise(ctx, out, t, { freq: [[0, 180], [0.8, 1700]], q: 0.9, dur: 0.85, gain: 0.34, attack: 0.72 });
    lfo(ctx, roar.frequency, t, 0.85, { rate: 13, depth: 160 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 140], [0.8, 520]], dur: 0.85, gain: 0.3, attack: 0.65, kind: 'brown' });
    const rise = tone(ctx, out, t, { wave: 'triangle', freq: 75 * p, to: 210 * p, dur: 0.85, gain: 0.14, attack: 0.7 });
    lfo(ctx, rise.frequency, t, 0.85, { rate: 9, depth: 6 });
    crackles(ctx, out, t + 0.35, { count: 7, span: 0.5, gain: 0.07 });
    return 0.9;
  },

  // The fireball leaving the jaws: a push-off thump, a big fiery whoosh and a fluttering
  // flame roar trailing sparks.
  fireball_launch(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 130 * p, to: 48 * p, glide: 0.22, dur: 0.32, gain: 0.34, attack: 0.003 });
    noise(ctx, out, t, { freq: [[0, 500], [0.1, 2600], [0.95, 320]], q: 0.8, dur: 0.95, gain: 0.42, attack: 0.04 });
    const flame = noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 1400], [1, 260]], dur: 1, gain: 0.3, attack: 0.015 });
    lfo(ctx, flame.frequency, t, 1, { rate: 17, depth: 150 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 380, dur: 0.8, gain: 0.3, attack: 0.02, kind: 'brown' });
    crackles(ctx, out, t + 0.03, { count: 10, span: 0.7, gain: 0.08, front: 1.6 });
    return 1.05;
  },

  // A fireball's impact: a deep boom and a blast of low noise, a sharp crack, and debris
  // crackling down for a second and a half. Positional; farther blasts (opts.dist, from the
  // engine) lose their top end as well as level.
  fireball_explode(ctx, out, t, { p, dist = 0 }) {
    const near = clamp(1 - (dist - 1200) / 9000, 0.25, 1);
    tone(ctx, out, t, { freq: 90 * p, to: 30, glide: 0.5, dur: 1.1, gain: 0.46, attack: 0.003 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 400 + 1800 * near], [1, 90]], dur: 1.3, gain: 0.5, attack: 0.003, kind: 'brown' });
    noise(ctx, out, t, { filter: 'lowpass', freq: 500 + 3000 * near, to: 300, dur: 0.35, gain: 0.3 * near, attack: 0.002 });
    noise(ctx, out, t, { filter: 'highpass', freq: 2200, dur: 0.05, gain: 0.22 * near, attack: 0.001 });
    crackles(ctx, out, t + 0.08, { count: 18, span: 1.5, gain: 0.11 * near, lo: 900 + 800 * near, hi: 2500 + 2500 * near, front: 1.8 });
    noise(ctx, out, t + 0.25, { filter: 'lowpass', freq: 900, dur: 0.6, gain: 0.07, attack: 0.1 });
    return 1.7;
  },

  // Pip touching fire: a sputtering sizzle, a puff, and a short synth squeak (a quick flip
  // up and a wobbling fall; an instrument sound, no voice in it).
  burn(ctx, out, t, { p }) {
    const sizzle = noise(ctx, out, t, { filter: 'highpass', freq: 3200, to: 5200, dur: 0.7, gain: 0.2, attack: 0.012 });
    lfo(ctx, sizzle.frequency, t, 0.7, { rate: 31, depth: 1200 });
    grind(ctx, out, t, { freq: 2400, q: 2.5, dur: 0.55, gain: 0.14, rate: 43 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 700, dur: 0.18, gain: 0.18, attack: 0.003 });
    const squeak = harmonicWave(ctx, 'squeak', [1, 0.15, 0.3, 0.05, 0.1]);
    const eek = tone(ctx, out, t + 0.02, { wave: squeak, freq: [[0, 740 * p], [0.045, 1560 * p], [0.24, 980 * p]], dur: 0.26, gain: 0.11, attack: 0.004 });
    lfo(ctx, eek.frequency, t + 0.02, 0.26, { rate: 26, depth: 45 });
    tone(ctx, out, t + 0.02, { wave: 'triangle', freq: [[0, 1480 * p], [0.045, 3120 * p], [0.24, 1960 * p]], dur: 0.2, gain: 0.04, attack: 0.004 });
    return 0.75;
  },

  // A short crackle of burning wood (repeated near fires; the engine rate-limits it).
  fire_crackle(ctx, out, t, { p }) {
    crackles(ctx, out, t, { count: 5 + Math.floor(Math.random() * 5), span: 0.28, gain: 0.34, lo: 1000, hi: 4200 });
    if (Math.random() < 0.5) tone(ctx, out, t + rand(0, 0.2), { freq: rand(500, 800) * p, to: 180, glide: 0.02, dur: 0.025, gain: 0.12, attack: 0.001 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 480, dur: 0.34, gain: 0.16, attack: 0.1 });
    return 0.36;
  },

  // A fireball quenched in water: a first sharp sizzle, a long rising hiss and bubbles.
  steam(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: 4200, q: 2, dur: 0.08, gain: 0.14, attack: 0.002 });
    noise(ctx, out, t, { filter: 'highpass', freq: 2400, to: 4800, dur: 1.1, gain: 0.26, attack: 0.012 });
    const body = noise(ctx, out, t, { freq: [[0, 700], [0.9, 1900]], q: 0.8, dur: 0.9, gain: 0.18, attack: 0.02 });
    lfo(ctx, body.frequency, t, 0.9, { rate: 19, depth: 180 });
    for (let i = 0; i < 5; i++) plip(ctx, out, t + rand(0.05, 0.6), rand(500, 1100) * p, 0.05);
    return 1.15;
  },

  // A fireball put out by water sounds like any quenched flame: the steam hiss.
  fireball_fizzle(ctx, out, t, opts) {
    return SFX.steam(ctx, out, t, opts);
  },

  // A tree canopy catching fire: a rising flame whoosh that settles into crackling.
  tree_ignite(ctx, out, t, { p }) {
    const flame = noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 300 * p], [0.4, 1800 * p], [1, 700 * p]], dur: 1.1, gain: 0.3, attack: 0.08 });
    lfo(ctx, flame.frequency, t, 1.1, { rate: 13, depth: 200 });
    crackles(ctx, out, t + 0.2, { count: 12, span: 0.9, gain: 0.12, lo: 900, hi: 4000 });
    return 1.15;
  },

  // Thunder after lightning (the engine delays it by distance): a deep roll of low-passed
  // rumble whose level swells and fades a few times over 2-4 s (longer and louder the
  // stronger the strike), a slower sub layer under it, and for a close strike a sharp crack
  // and a crackling tear first.
  thunder(ctx, out, t, { strength = 0.7 }) {
    const s = clamp(strength, 0, 1);
    const dur = 2 + 2 * s;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    sweep(lp.frequency, t, [[0, 220 + 380 * s], [dur, 80]]);
    const roll = silentGain(ctx);
    const peak = 0.3 + 0.35 * s;
    const front = 0.12 + 0.25 * (1 - s); // a far strike's roll builds more slowly
    roll.gain.setValueAtTime(0, t);
    roll.gain.linearRampToValueAtTime(peak * rand(0.7, 1), t + front);
    // Swells alternate between loud and low, so the roll rumbles rather than just decays.
    let loud = false;
    for (let at = front + rand(0.15, 0.4); at < dur * 0.85; at += rand(0.2, 0.6)) {
      loud = !loud;
      roll.gain.linearRampToValueAtTime(peak * (1 - at / dur) * (loud ? rand(0.75, 1.1) : rand(0.15, 0.4)), t + at);
    }
    roll.gain.linearRampToValueAtTime(0, t + dur);
    noiseSource(ctx, t, dur + 0.05, 'brown').connect(lp);
    lp.connect(roll).connect(out);
    noise(ctx, out, t, { filter: 'lowpass', freq: 70, dur: dur * 0.8, gain: 0.12 + 0.18 * s, attack: 0.3, kind: 'brown' });
    if (s > 0.55) {
      const c = (s - 0.55) / 0.45;
      noise(ctx, out, t, { filter: 'highpass', freq: 1800, dur: 0.07, gain: 0.08 + 0.24 * c, attack: 0.001 });
      crackles(ctx, out, t, { count: 10, span: 0.3, gain: 0.05 + 0.12 * c, lo: 900, hi: 3500, front: 1.5 });
      tone(ctx, out, t, { freq: 160, to: 45, glide: 0.2, dur: 0.35, gain: 0.05 + 0.25 * c, attack: 0.002 });
    }
    return dur + 0.05;
  },
  // ---- Winged hat, mystery box, minions, locked castle

  // Bumping the crystal box: a bright glassy clink (two struck crystal tones a fifth apart),
  // the hollow bump of the box jolting in its frame under it, and a brief shimmer.
  box_hit(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 250 * p, to: 115 * p, dur: 0.11, gain: 0.3, click: 0.6 });
    tone(ctx, out, t, { wave: 'triangle', freq: 520 * p, to: 440 * p, dur: 0.09, gain: 0.1, attack: 0.001 });
    bell(ctx, out, t, { freq: 1760 * p, dur: 0.55, gain: 0.15, partials: CRYSTAL });
    bell(ctx, out, t + 0.014, { freq: 2637 * p, dur: 0.45, gain: 0.09, partials: CRYSTAL });
    const shimmer = noise(ctx, out, t + 0.01, { filter: 'highpass', freq: 6500, dur: 0.4, gain: 0.035, attack: 0.03 });
    lfo(ctx, shimmer.frequency, t + 0.01, 0.4, { rate: 13, depth: 900 });
    return 0.6;
  },

  // Winning the winged hat (original, in the flying theme's D major): a harp-like run
  // sweeping up the scale as the wings unfurl, a brass 'ta-DAA' from A major to a held D
  // major chord, bells sparkling up over it and a feathery flutter.
  powerup(ctx, out, t) {
    [62, 64, 66, 67, 69, 71, 73, 74, 76, 78].forEach((m, i) => {
      tone(ctx, out, t + i * 0.028, { wave: 'triangle', freq: mtof(m), dur: 0.2, gain: 0.08 + i * 0.006, attack: 0.003 });
    });
    for (const m of [69, 73, 76]) brass(ctx, out, t + 0.3, m, 0.12, 0.1);
    for (const m of [74, 78, 81, 86]) brass(ctx, out, t + 0.46, m, 0.78, 0.09);
    brass(ctx, out, t + 0.46, 50, 0.78, 0.12);
    [86, 90, 93, 98].forEach((m, i) => bell(ctx, out, t + 0.5 + i * 0.06, { freq: mtof(m), dur: 0.8, gain: 0.07 }));
    feathers(ctx, out, t + 0.02, { freq: [[0, 700], [0.35, 2400], [0.9, 1200]], dur: 0.9, gain: 0.1, attack: 0.3, rate: 30, settle: 0.4 });
    return 1.5;
  },

  // A wing beat: a soft, feathery downstroke of air (band-passed noise swelling and falling
  // back, fluttering as the feathers ride it) over a faint low push. Soft: it repeats.
  wing_flap(ctx, out, t, { p }) {
    feathers(ctx, out, t, { freq: [[0, 650 * p], [0.1, 1700 * p], [0.27, 800 * p]], dur: 0.28, gain: 0.3, attack: 0.09 });
    noise(ctx, out, t + 0.03, { filter: 'lowpass', freq: 320, dur: 0.16, gain: 0.2, attack: 0.04, kind: 'brown' });
    return 0.3;
  },

  // Landing on an enemy: a squashy thunk (a low body dropping fast under a muffled squish)
  // and the springy rebound twanging up and settling.
  stomp(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 190 * p, to: 58 * p, glide: 0.06, dur: 0.15, gain: 0.42, attack: 0.001 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 900, to: 280, dur: 0.07, gain: 0.3, attack: 0.001 });
    noise(ctx, out, t + 0.004, { freq: 1300, q: 2.5, dur: 0.05, gain: 0.14, attack: 0.002 });
    const spring = tone(ctx, out, t + 0.03, { wave: 'triangle', freq: [[0, 250 * p], [0.08, 720 * p], [0.24, 640 * p]], dur: 0.25, gain: 0.2, attack: 0.004 });
    lfo(ctx, spring.detune, t + 0.03, 0.25, { rate: 28, depth: 80, decay: 0.08 });
    return 0.3;
  },

  // A minion bursting out of the ground: a dull thump and a burst of earth (a low rush, clods
  // pattering down), then its servos chittering as it shakes itself off.
  minion_emerge(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 110 * p, to: 45 * p, glide: 0.12, dur: 0.22, gain: 0.32, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 900], [0.38, 170]], dur: 0.4, gain: 0.34, attack: 0.004, kind: 'brown' });
    noise(ctx, out, t, { freq: 1300, to: 600, q: 0.8, dur: 0.18, gain: 0.15, attack: 0.002 });
    crackles(ctx, out, t + 0.04, { count: 12, span: 0.45, gain: 0.09, lo: 500, hi: 2200, front: 1.6 });
    const servo = servoWave(ctx);
    for (let i = 0; i < 5; i++) {
      const f = rand(1100, 1600) * p;
      const up = i % 2 === 0;
      const chirp = tone(ctx, out, t + 0.3 + i * 0.055, { wave: servo, freq: up ? f * 0.7 : f, to: up ? f : f * 0.7, dur: 0.045, gain: 0.065, attack: 0.004 });
      lfo(ctx, chirp.detune, t + 0.3 + i * 0.055, 0.05, { rate: 90, depth: 60 });
    }
    return 0.65;
  },

  // A minion's jaw snapping shut: a servo zipping it closed and the dry clack of steel teeth
  // (two plates meeting a hair apart) over a small knock.
  minion_bite(ctx, out, t, { p }) {
    tone(ctx, out, t, { wave: servoWave(ctx), freq: 500 * p, to: 1600 * p, glide: 0.06, dur: 0.07, gain: 0.07, attack: 0.01 });
    for (const [dt, f, gain] of [[0.06, 1250, 0.13], [0.072, 1650, 0.1]]) {
      bell(ctx, out, t + dt, { freq: f * p, dur: 0.14, gain, partials: METAL });
      noise(ctx, out, t + dt, { filter: 'highpass', freq: 3500, dur: 0.012, gain: 0.2, attack: 0.0008 });
    }
    tone(ctx, out, t + 0.06, { freq: 420 * p, to: 200 * p, dur: 0.05, gain: 0.2, attack: 0.001 });
    return 0.25;
  },

  // A minion wrecked: a small metallic crunch (a short blast, grinding scrap and two clanks),
  // a fizz of sparks crackling on, and its servo whining down as it dies.
  minion_wreck(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 150 * p, to: 50 * p, glide: 0.15, dur: 0.3, gain: 0.32, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 2200, to: 400, dur: 0.22, gain: 0.28, attack: 0.002 });
    noise(ctx, out, t, { filter: 'highpass', freq: 2500, dur: 0.03, gain: 0.16, attack: 0.001 });
    grind(ctx, out, t + 0.01, { freq: 1900, q: 3, dur: 0.24, gain: 0.13, rate: 70, attack: 0.005 });
    bell(ctx, out, t + 0.02, { freq: 610 * p, dur: 0.35, gain: 0.07, partials: METAL });
    bell(ctx, out, t + 0.09, { freq: 930 * p, dur: 0.28, gain: 0.055, partials: METAL });
    const fizz = noise(ctx, out, t + 0.05, { filter: 'highpass', freq: 4200, to: 6500, dur: 0.6, gain: 0.08, attack: 0.02, hold: 0.2 });
    lfo(ctx, fizz.frequency, t + 0.05, 0.6, { rate: 29, depth: 1100 });
    crackles(ctx, out, t + 0.05, { count: 14, span: 0.65, gain: 0.065, lo: 2500, hi: 6500, front: 1.4 });
    tone(ctx, out, t + 0.08, { wave: servoWave(ctx), freq: [[0, 900 * p], [0.5, 110 * p]], dur: 0.5, gain: 0.045, attack: 0.02 });
    return 0.8;
  },

  // The minions surfacing for the first time (AI RACE mode; the engine plays it once per
  // storm, non-positional): an ominous stinger in the dark track's D minor. Two low
  // synth-brass stabs on open D, then the flat-two chord (Eb major) held over a D pedal (the
  // dark track's Phrygian colour) under a rising metallic swell and a strike of steel.
  minions_stinger(ctx, out, t) {
    for (const dt of [0, 0.24]) for (const m of [38, 50, 57]) brass(ctx, out, t + dt, m, 0.15, 0.075);
    for (const m of [38, 51, 55, 58]) brass(ctx, out, t + 0.52, m, 1.3, 0.062);
    tone(ctx, out, t + 0.52, { freq: 73.4, dur: 1.6, gain: 0.16, attack: 0.02 });
    const swell = noise(ctx, out, t + 0.3, { filter: 'highpass', freq: 1200, to: 5000, dur: 1.4, gain: 0.07, attack: 1.1 });
    lfo(ctx, swell.frequency, t + 0.3, 1.4, { rate: 7, depth: 400 });
    bell(ctx, out, t + 0.52, { freq: 146.8, dur: 1.6, gain: 0.1, partials: METAL });
    tone(ctx, out, t, { freq: 90, to: 40, glide: 0.2, dur: 0.4, gain: 0.25, attack: 0.002 });
    return 2.2;
  },

  // ---- AI RACE mode's tech takeover (server halls dropping out of the sky, rising out of
  // the ground)

  // A unit about to drop (played at its landing spot as the red marker appears): three urgent
  // two-tone beeps, closer together each time, over the whistle of something big falling out
  // of the sky and a rush of air swelling toward the impact.
  hall_warn(ctx, out, t, { p }) {
    for (const [dt, f] of [[0, 1480], [0.3, 1480], [0.52, 1976], [0.68, 1976]]) {
      tone(ctx, out, t + dt, { wave: 'square', freq: f * p, dur: 0.09, gain: 0.075, attack: 0.004, hold: 0.05 });
      tone(ctx, out, t + dt, { wave: 'triangle', freq: f * 0.5 * p, dur: 0.09, gain: 0.07, attack: 0.004, hold: 0.05 });
    }
    const whistle = tone(ctx, out, t + 0.12, { freq: [[0, 2700 * p], [1.3, 480 * p]], dur: 1.35, gain: 0.1, attack: 0.35, hold: 0.6 });
    lfo(ctx, whistle.detune, t + 0.12, 1.35, { rate: 9, depth: 18 });
    noise(ctx, out, t + 0.2, { filter: 'lowpass', freq: [[0, 180], [1.2, 900]], dur: 1.3, gain: 0.2, attack: 1.0, kind: 'brown' });
    noise(ctx, out, t + 0.5, { freq: [[0, 900], [1.0, 2600]], q: 0.9, dur: 1.0, gain: 0.06, attack: 0.8 });
    return 1.55;
  },

  // A server hall slamming into the ground: a deep boom with a sub thump, a crash of low
  // noise, two clanging steel partial sets (the frame ringing), a sharp crack, a short grind
  // of metal settling and debris pattering down.
  hall_impact(ctx, out, t, { p, dist = 0 }) {
    const near = clamp(1 - (dist - 1500) / 9000, 0.3, 1);
    tone(ctx, out, t, { freq: 78 * p, to: 28, glide: 0.6, dur: 1.25, gain: 0.34, attack: 0.003 });
    tone(ctx, out, t, { freq: 46 * p, dur: 0.9, gain: 0.12, attack: 0.004 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 500 + 1500 * near], [1.3, 110]], dur: 1.4, gain: 0.32, attack: 0.003, kind: 'brown' });
    bell(ctx, out, t + 0.012, { freq: 171 * p, dur: 1.3, gain: 0.075 * (0.6 + 0.4 * near), partials: METAL });
    bell(ctx, out, t + 0.03, { freq: 263 * p, dur: 1.0, gain: 0.05 * (0.6 + 0.4 * near), partials: METAL });
    noise(ctx, out, t, { filter: 'highpass', freq: 2000, dur: 0.05, gain: 0.16 * near, attack: 0.001 });
    grind(ctx, out, t + 0.14, { freq: [[0, 1100], [0.45, 600]], q: 3, dur: 0.5, gain: 0.07, rate: 38, attack: 0.02 });
    crackles(ctx, out, t + 0.1, { count: 16, span: 1.3, gain: 0.08 * near, lo: 700, hi: 2800, front: 1.7 });
    return 1.75;
  },

  // A unit grinding up out of the ground (and, pitched down, sinking back into it): a low
  // hydraulic rumble, a ratcheting grind of steel on earth climbing in pitch, a hydraulic
  // whine and hiss, and a heavy clunk as it locks in place.
  hall_rise(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'lowpass', freq: 230 * p, dur: 1.55, gain: 0.4, attack: 0.18, hold: 0.9, kind: 'brown' });
    grind(ctx, out, t + 0.05, { freq: [[0, 360 * p], [1.35, 640 * p]], q: 2.2, dur: 1.4, gain: 0.15, rate: 23, attack: 0.15 });
    const whine = tone(ctx, out, t + 0.1, { wave: 'triangle', freq: [[0, 72 * p], [1.3, 126 * p]], dur: 1.35, gain: 0.1, attack: 0.25, hold: 0.8 });
    lfo(ctx, whine.detune, t + 0.1, 1.35, { rate: 6, depth: 25 });
    noise(ctx, out, t + 0.2, { filter: 'highpass', freq: 3200, dur: 1.2, gain: 0.05, attack: 0.3, hold: 0.6 });
    tone(ctx, out, t + 1.45, { freq: 125 * p, to: 48 * p, glide: 0.18, dur: 0.28, gain: 0.3, attack: 0.002 });
    noise(ctx, out, t + 1.45, { filter: 'lowpass', freq: 900, dur: 0.12, gain: 0.2, attack: 0.002 });
    bell(ctx, out, t + 1.46, { freq: 210 * p, dur: 0.45, gain: 0.05, partials: METAL });
    return 1.8;
  },

  // ---- Rustmaw's tail: grab, haul, whirl, throw, crash (objects/RobotBeast.js)

  // Grabbing the tow coupling: a heavy steel clank (a thud under two clanging partial sets and
  // a hard contact click) and the coupling's links rattling after it.
  tail_grab(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 260 * p, to: 110 * p, dur: 0.12, gain: 0.34 });
    bell(ctx, out, t + 0.004, { freq: 420 * p, dur: 0.55, gain: 0.12, partials: METAL });
    bell(ctx, out, t + 0.03, { freq: 611 * p, dur: 0.4, gain: 0.07, partials: METAL });
    noise(ctx, out, t, { filter: 'highpass', freq: 3800, dur: 0.02, gain: 0.18, attack: 0.001 });
    crackles(ctx, out, t + 0.05, { count: 9, span: 0.28, gain: 0.07, lo: 2500, hi: 6000, front: 1.4 });
    return 0.6;
  },

  // Torn off the ridge: steel grinding over the roof tiles, a strained clang, a deep rumble and
  // the rush of air as the beast is hauled up into the sky.
  boss_haul(ctx, out, t, { p }) {
    grind(ctx, out, t, { freq: [[0, 300 * p], [0.7, 540 * p], [1.3, 360 * p]], q: 2.5, dur: 1.3, gain: 0.16, rate: 19, attack: 0.05 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 120], [0.5, 380], [1.3, 140]], dur: 1.35, gain: 0.32, attack: 0.15, kind: 'brown' });
    noise(ctx, out, t + 0.25, { freq: [[0, 300], [0.9, 1600]], q: 0.8, dur: 1, gain: 0.2, attack: 0.6 });
    bell(ctx, out, t, { freq: 140 * p, dur: 0.9, gain: 0.07, partials: METAL });
    crackles(ctx, out, t + 0.05, { count: 14, span: 0.9, gain: 0.07, lo: 700, hi: 2600, front: 1.5 });
    return 1.4;
  },

  // One turn of the whirl (the engine gets the pitch rising with the spin): a big rush of air
  // swelling and falling away as the beast sweeps past, over a low droning 'vwomm'.
  boss_whoosh(ctx, out, t, { p }) {
    noise(ctx, out, t, { freq: [[0, 300 * p], [0.22, 1500 * p], [0.5, 480 * p]], q: 1.1, dur: 0.52, gain: 0.32, attack: 0.2 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 200 * p], [0.25, 640 * p], [0.5, 180 * p]], dur: 0.5, gain: 0.24, attack: 0.18, kind: 'brown' });
    tone(ctx, out, t, { wave: 'triangle', freq: [[0, 70 * p], [0.22, 120 * p], [0.48, 60 * p]], dur: 0.48, gain: 0.13, attack: 0.2 });
    return 0.55;
  },

  // Letting go: a heave (a low push), the coupling springing free with a ringing twang, and a
  // huge whoosh as the beast is flung away.
  boss_throw(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 120 * p, to: 55 * p, dur: 0.2, gain: 0.3 });
    noise(ctx, out, t, { freq: [[0, 400], [0.18, 2600], [0.9, 350]], q: 0.9, dur: 0.95, gain: 0.36, attack: 0.12 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 500], [1, 120]], dur: 1, gain: 0.26, attack: 0.05, kind: 'brown' });
    tone(ctx, out, t + 0.12, { wave: 'triangle', freq: [[0, 180 * p], [0.05, 900 * p], [0.5, 640 * p]], dur: 0.5, gain: 0.08, attack: 0.003 });
    bell(ctx, out, t + 0.12, { freq: 760 * p, dur: 0.6, gain: 0.08, partials: METAL });
    return 1.05;
  },

  // The beast slamming back down on its perch (it twisted free): a deep boom, a crunch of
  // stone, steel clanging and rubble pattering down.
  boss_slam(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 85 * p, to: 32, glide: 0.5, dur: 1, gain: 0.36, attack: 0.003 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 1600], [1.1, 120]], dur: 1.15, gain: 0.34, attack: 0.003, kind: 'brown' });
    noise(ctx, out, t, { filter: 'highpass', freq: 2200, dur: 0.05, gain: 0.18, attack: 0.001 });
    bell(ctx, out, t + 0.01, { freq: 190 * p, dur: 1, gain: 0.08, partials: METAL });
    bell(ctx, out, t + 0.05, { freq: 297 * p, dur: 0.7, gain: 0.05, partials: METAL });
    crackles(ctx, out, t + 0.08, { count: 16, span: 1.1, gain: 0.08, lo: 600, hi: 2600, front: 1.7 });
    return 1.3;
  },

  // Thrown down and wrecked: an enormous crash. A sub-shaking boom, a blast of fire (a roaring
  // low noise), a sharp crack, the whole steel hulk clanging (three low partial sets), a long
  // grinding scrape of scrap as it settles, and debris raining down for a couple of seconds.
  boss_crash(ctx, out, t, { p, dist = 0 }) {
    const near = clamp(1 - (dist - 1500) / 12000, 0.35, 1);
    tone(ctx, out, t, { freq: 62 * p, to: 24, glide: 0.9, dur: 1.9, gain: 0.34, attack: 0.003 });
    tone(ctx, out, t, { freq: 38 * p, dur: 1.3, gain: 0.14, attack: 0.004 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 500 + 2200 * near], [2, 90]], dur: 2.1, gain: 0.34, attack: 0.003, kind: 'brown' });
    noise(ctx, out, t, { filter: 'lowpass', freq: 800 + 3200 * near, to: 300, dur: 0.5, gain: 0.26 * near, attack: 0.002 });
    noise(ctx, out, t, { filter: 'highpass', freq: 2000, dur: 0.06, gain: 0.2 * near, attack: 0.001 });
    bell(ctx, out, t + 0.01, { freq: 118 * p, dur: 2, gain: 0.07, partials: METAL });
    bell(ctx, out, t + 0.06, { freq: 173 * p, dur: 1.5, gain: 0.05, partials: METAL });
    bell(ctx, out, t + 0.14, { freq: 251 * p, dur: 1.1, gain: 0.04, partials: METAL });
    grind(ctx, out, t + 0.3, { freq: [[0, 900], [1.2, 380]], q: 3, dur: 1.3, gain: 0.08, rate: 27, attack: 0.05 });
    crackles(ctx, out, t + 0.1, { count: 30, span: 2.2, gain: 0.09 * near, lo: 600, hi: 3000, front: 1.8 });
    return 2.6;
  },

  // Thrown into the water: a huge splash (a deep plunge under a wide spray), steam hissing up
  // off the hot hulk, and big bubbles gurgling as it sinks.
  boss_splash(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 70 * p, to: 28, glide: 0.6, dur: 0.9, gain: 0.34, attack: 0.003 });
    noise(ctx, out, t, { freq: [[0, 3000], [1.2, 400]], q: 0.6, dur: 1.3, gain: 0.4, attack: 0.01 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 700, to: 150, dur: 1, gain: 0.3, attack: 0.005, kind: 'brown' });
    noise(ctx, out, t + 0.3, { filter: 'highpass', freq: 2400, to: 4600, dur: 1.6, gain: 0.16, attack: 0.1 });
    for (let i = 0; i < 12; i++) plip(ctx, out, t + rand(0.2, 1.9), rand(250, 700) * p, 0.07);
    return 2.2;
  },

  // Trying the locked castle door: an original villain's laugh ('mwa-ha-ha-haaa', formant
  // synthesis: see laughVoice) booming out of a big stone hall with a slapback echo, over a
  // low rumble swelling up from the castle's depths.
  evil_laugh(ctx, out, t, opts) {
    laughVoice(ctx, out, t, opts);
    noise(ctx, out, t, { filter: 'lowpass', freq: 140, dur: 2.4, gain: 0.14, attack: 0.5, kind: 'brown' });
    return 3.4;
  },

  // ---- The cannon (objects/Cannon.js, player actions/cannon.js)

  // Dropping into the barrel: a hollow iron 'thunk' (a low body and a knock) with the tube
  // ringing a moment after it (a resonant hollow 'bwong' and the iron's own partials).
  cannon_enter(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 150 * p, to: 62 * p, glide: 0.1, dur: 0.18, gain: 0.34, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 1200, dur: 0.05, gain: 0.22, attack: 0.001 });
    noise(ctx, out, t + 0.004, { freq: 290 * p, q: 9, dur: 0.45, gain: 0.3, attack: 0.004 });
    bell(ctx, out, t + 0.006, { freq: 196 * p, dur: 0.55, gain: 0.07, partials: METAL });
    tone(ctx, out, t + 0.01, { wave: 'triangle', freq: 392 * p, to: 370 * p, dur: 0.3, gain: 0.05, attack: 0.004 });
    return 0.6;
  },

  // One click of the barrel's ratchet as it is aimed: a dry pawl click, a tiny iron ping and a
  // soft knock (repeated every few degrees of turning, so short and quiet).
  cannon_turn(ctx, out, t, { p }) {
    const f = rand(0.94, 1.06) * p;
    noise(ctx, out, t, { filter: 'highpass', freq: 2600 * f, dur: 0.012, gain: 0.12, attack: 0.0006 });
    tone(ctx, out, t, { freq: 1500 * f, to: 1350 * f, dur: 0.045, gain: 0.035, attack: 0.001 });
    tone(ctx, out, t, { freq: 230 * f, to: 150 * f, dur: 0.04, gain: 0.09, attack: 0.001 });
    return 0.07;
  },

  // Firing: a sharp crack and a huge low boom (a sub-bass drop under a roaring blast of low
  // noise that opens and closes), the iron barrel ringing, then the smoke's rumble rolling
  // away with a scatter of crackles.
  cannon_fire(ctx, out, t, { p }) {
    noise(ctx, out, t, { filter: 'highpass', freq: 1800, dur: 0.06, gain: 0.2, attack: 0.001 });
    noise(ctx, out, t, { freq: 700, q: 0.8, dur: 0.16, gain: 0.26, attack: 0.001 });
    tone(ctx, out, t, { freq: 96 * p, to: 30, glide: 0.5, dur: 0.95, gain: 0.34, attack: 0.002 });
    tone(ctx, out, t, { freq: 52 * p, dur: 0.7, gain: 0.12, attack: 0.004 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 2600], [0.25, 700], [1.4, 110]], dur: 1.45, gain: 0.34, attack: 0.002, kind: 'brown' });
    bell(ctx, out, t + 0.015, { freq: 132 * p, dur: 1.1, gain: 0.06, partials: METAL });
    noise(ctx, out, t + 0.25, { filter: 'lowpass', freq: 260, dur: 1.2, gain: 0.14, attack: 0.3, kind: 'brown' });
    crackles(ctx, out, t + 0.05, { count: 12, span: 0.9, gain: 0.05, lo: 600, hi: 2400, front: 1.6 });
    return 1.6;
  },

  // Flying out of the cannon: air rushing past, rising to a roar and fading as the shot
  // slows, fluttering (a wind texture: band-passed noise riding a sweep) over a low rush.
  cannon_whoosh(ctx, out, t, { p }) {
    feathers(ctx, out, t, { freq: [[0, 700 * p], [0.35, 2300 * p], [1.5, 600 * p]], q: 0.9, dur: 1.6, gain: 0.22, attack: 0.18, rate: 17, depth: 0.25, settle: 0.8 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 500], [0.4, 900], [1.5, 200]], dur: 1.6, gain: 0.2, attack: 0.25, kind: 'brown' });
    noise(ctx, out, t + 0.05, { filter: 'highpass', freq: 4200, dur: 0.9, gain: 0.04, attack: 0.2 });
    return 1.7;
  },

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

// The cached buffers and waves the rarer sounds would otherwise make on their first play (a
// few ms at once, as the laugh starts or the first minion surfaces): the noise buffers and
// the glottal and servo waves. The engine calls this at an idle moment (AudioEngine.prepare);
// the laugh's hall impulse is prepared separately.
export function prepareSfx(ctx) {
  prepareNoise(ctx);
  harmonicWave(ctx, 'glottal', GLOTTAL);
  servoWave(ctx);
}

// Playback rules for some sounds, read by the engine:
//   range: distance multiplier for positional attenuation (huge sounds carry farther)
//   gap:   minimum seconds between two plays of the name (sounds that may be requested in
//          bursts, or by two modules for the same moment)
//   max:   at most this many sounding at once
//   duck:  { music, amb, seconds }: the music and ambience buses drop to these levels while
//          the sound plays (a sting that must be heard over them)
//   hall:  the recipe gets the engine's shared hall reverb (opts.hall; AudioEngine.hallReverb)
export const SFX_INFO = {
  kaiju_roar: { range: 3, gap: 0.5, max: 2 },
  fireball_charge: { range: 3, gap: 0.2, max: 2 },
  fireball_launch: { range: 3, gap: 0.1, max: 3 },
  fireball_explode: { range: 1.8, max: 4 },
  fire_crackle: { gap: 0.12, max: 3 },
  steam: { gap: 0.1, max: 3 },
  fireball_fizzle: { gap: 0.1, max: 3 },
  tree_ignite: { range: 2, gap: 0.3, max: 2 },
  burn: { gap: 0.3 },
  button_press: { gap: 0.3 },
  alarm: { gap: 1.2 },
  thunder: { max: 2 },
  box_hit: { gap: 0.15 },
  powerup: { gap: 0.5, duck: { music: 0.3, amb: 0.7, seconds: 1.3 } },
  wing_flap: { gap: 0.2, max: 2 },
  stomp: { gap: 0.08 },
  minion_emerge: { range: 1.5, gap: 0.1, max: 3 }, // a warning: heard across the ~2000 they surface at
  minion_bite: { gap: 0.06, max: 3 },
  minion_wreck: { gap: 0.05, max: 3 },
  minions_stinger: { gap: 4, duck: { music: 0.45, amb: 1, seconds: 1.8 } },
  evil_laugh: { range: 2, gap: 3, max: 1, hall: true, duck: { music: 0.4, amb: 0.45, seconds: 2.4 } },
  hall_warn: { range: 2.5, gap: 0.3, max: 2 }, // heard across the grounds: a unit is coming down
  hall_impact: { range: 2.5, gap: 0.1, max: 3 },
  hall_rise: { range: 2, gap: 0.25, max: 2 },
  // Rustmaw's tail grab: the whirl and the crash carry across the grounds (the beast is huge).
  tail_grab: { gap: 0.2, max: 1 },
  boss_haul: { range: 2.5, gap: 0.5, max: 1 },
  boss_whoosh: { range: 2.5, gap: 0.15, max: 2 },
  boss_throw: { range: 2, gap: 0.5, max: 1 },
  boss_slam: { range: 3, gap: 0.3, max: 2 },
  boss_crash: { range: 4, gap: 1, max: 1, duck: { music: 0.4, amb: 0.6, seconds: 1.6 } },
  boss_splash: { range: 3, gap: 1, max: 1 },
  cannon_enter: { gap: 0.2, max: 1 },
  cannon_turn: { gap: 0.05, max: 2 }, // the ratchet, every few degrees of aiming
  cannon_fire: { range: 2.5, gap: 0.3, max: 1 }, // heard across the grounds
  cannon_whoosh: { gap: 0.3, max: 1 },
  // The face screen: grabs, creaks and boings come in bursts (two fingers, fast pulls).
  face_grab: { gap: 0.04, max: 2 },
  face_stretch: { gap: 0.07, max: 2 },
  face_boing: { gap: 0.05, max: 3 },
  face_boop: { gap: 0.15, max: 1 },
};
