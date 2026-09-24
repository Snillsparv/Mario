// Sound-effect recipes in a crisp, cartoony late-90s style, all synthesized.
// Each recipe is (ctx, out, t, opts) => durationSeconds, where opts.p is a pitch multiplier
// (the engine adds a little random variation) plus event data: terrain, big, index.

import { mtof } from './theory.js';
import { bell, lfo, noise, silentGain, tone } from './synth.js';

const rand = (a, b) => a + Math.random() * (b - a);

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
function thud(ctx, out, t, { freq = 150, to = 60, dur = 0.12, gain = 0.4 }) {
  tone(ctx, out, t, { freq, to, glide: dur * 0.45, dur, gain, attack: 0.002 });
  noise(ctx, out, t, { filter: 'lowpass', freq: 1400, dur: dur * 0.4, gain: gain * 0.4, attack: 0.001 });
  noise(ctx, out, t, { filter: 'highpass', freq: 3200, dur: 0.014, gain: gain * 0.16, attack: 0.001 });
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
function step(ctx, out, t, terrain, p, level) {
  switch (terrain) {
    case 'stone':
      noise(ctx, out, t, { filter: 'highpass', freq: 3500, dur: 0.018, gain: 0.19 * level, attack: 0.001 });
      tone(ctx, out, t, { freq: 1900 * p, dur: 0.022, gain: 0.06 * level, attack: 0.001 });
      tone(ctx, out, t, { freq: 200 * p, to: 120 * p, dur: 0.045, gain: 0.145 * level, attack: 0.002 });
      return 0.06;
    case 'wood':
      // Hollow knock, kept short and about as loud as stone (the bridge is walked a lot).
      noise(ctx, out, t, { filter: 'highpass', freq: 3000, dur: 0.01, gain: 0.07 * level, attack: 0.001 });
      tone(ctx, out, t, { freq: 340 * p, to: 300 * p, dur: 0.055, gain: 0.13 * level, attack: 0.002 });
      tone(ctx, out, t, { wave: 'triangle', freq: 780 * p, dur: 0.035, gain: 0.045 * level, attack: 0.001 });
      noise(ctx, out, t, { freq: 900, q: 3, dur: 0.03, gain: 0.06 * level, attack: 0.002 });
      return 0.08;
    case 'sand':
      for (const dt of [0, 0.013, 0.03]) noise(ctx, out, t + dt, { freq: 3000 * p, dur: 0.022, gain: 0.33 * level, attack: 0.001 });
      noise(ctx, out, t, { filter: 'lowpass', freq: 550, dur: 0.05, gain: 0.175 * level, attack: 0.002 });
      return 0.07;
    case 'water':
      noise(ctx, out, t, { freq: 1500, to: 700, dur: 0.14, gain: 0.42 * level, attack: 0.01 });
      plip(ctx, out, t + 0.03, 900 * p, 0.14 * level);
      return 0.16;
    default: // grass: a crisp blade snap over a soft brush and a light low thump
      noise(ctx, out, t, { filter: 'highpass', freq: 4500, dur: 0.012, gain: 0.13 * level, attack: 0.001 });
      noise(ctx, out, t, { freq: 1800 * p, q: 1, dur: 0.045, gain: 0.42 * level, attack: 0.002 });
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
  land(ctx, out, t, { p, terrain }) {
    thud(ctx, out, t, { freq: 150 * p, to: 70 * p, dur: 0.1, gain: 0.45 });
    return Math.max(0.12, step(ctx, out, t, terrain, p, 1.2));
  },
  land_hard(ctx, out, t, { p, terrain }) {
    thud(ctx, out, t, { freq: 130 * p, to: 45 * p, dur: 0.22, gain: 0.47 });
    return Math.max(0.24, step(ctx, out, t, terrain, p * 0.9, 1.4));
  },
  footstep(ctx, out, t, { p, terrain }) {
    return step(ctx, out, t, terrain, p, 1);
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
};
