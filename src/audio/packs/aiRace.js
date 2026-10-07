// AI RACE's sound recipes (audio/sfx.js's format: each (ctx, out, t, opts) => seconds), a pack
// of the aiRace chunk (objects/aiRace.js registers it as it loads: they only play in AI RACE
// mode, which waits for that chunk): the alarm, Rustmaw's roar, fireballs and fire, its tail
// grab and throw, the minions, the server halls, the storm's thunder and the meltdown. Its two
// tracks are in audio/packs/aiRaceSongs.js.
//
//   AI_RACE_SFX, AI_RACE_SFX_INFO, register(sfx, info)

import { clamp } from '../../core/math.js';
import { METAL, SFX, brass, crackles, grind, plip, rand, servoWave, thud } from '../sfx.js';
import { bell, envelope, lfo, noise, noiseSource, overdrive, silentGain, sweep, tone } from '../synth.js';

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

export const AI_RACE_SFX = {
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
  // ---- AI RACE's meltdown (fx/Meltdown.js): none of them positional

  // The warning's klaxon (every 1.5 s from 30 s until the light): two rising 'whoop's of a
  // harsh sawtooth and a square a fifth above it through a resonant low-pass that opens with
  // them, over a triangle buzz an octave down.
  meltdown_klaxon(ctx, out, t, { p }) {
    const dur = 0.5;
    for (const dt of [0, 0.56]) {
      const s = t + dt;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      sweep(lp.frequency, s, [[0, 900], [dur * 0.8, 3400], [dur, 2200]]);
      lp.connect(envelope(ctx, out, s, { peak: 0.17, dur, attack: 0.03, hold: dur - 0.12 }));
      for (const [wave, ratio, detune] of [['sawtooth', 1, -7], ['square', 1.498, 6]]) {
        const o = ctx.createOscillator();
        o.type = wave;
        o.detune.value = detune;
        sweep(o.frequency, s, [[0, 300 * ratio * p], [dur * 0.75, 640 * ratio * p], [dur, 600 * ratio * p]]);
        o.connect(lp);
        o.start(s);
        o.stop(s + dur + 0.05);
      }
      tone(ctx, out, s, { wave: 'triangle', freq: 150 * p, to: 320 * p, glide: dur * 0.75, dur, gain: 0.08, attack: 0.03, hold: dur - 0.12 });
    }
    return 1.1;
  },
  // The sky catching fire (40 s): a huge 'whoomph', a deep swelling rush of flame sweeping up
  // over the sky (fluttering), a sub thump under it and a scatter of crackles as it catches.
  meltdown_ignite(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 58 * p, to: 30, glide: 1.2, dur: 1.9, gain: 0.3, attack: 0.04 });
    const rush = noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 200], [0.8, 2800], [2.4, 600]], q: 1.2, dur: 2.6, gain: 0.46, attack: 0.55 });
    lfo(ctx, rush.frequency, t, 2.6, { rate: 11, depth: 260 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 150, dur: 2.4, gain: 0.3, attack: 0.4, kind: 'brown' });
    crackles(ctx, out, t + 0.45, { count: 26, span: 2, gain: 0.1, lo: 800, hi: 3800, front: 0.8 });
    return 2.7;
  },
  // The light blooming (46 s): a deep sub boom, then a bright shimmering chord of sines rising
  // and swelling with the light, over a hiss that grows.
  meltdown_flash(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 48 * p, to: 22, glide: 1.5, dur: 2.6, gain: 0.36, attack: 0.01 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 1800], [2.5, 120]], dur: 2.8, gain: 0.34, attack: 0.005, kind: 'brown' });
    noise(ctx, out, t, { filter: 'highpass', freq: 2600, to: 6000, dur: 2.8, gain: 0.12, attack: 1.2 });
    for (const [ratio, gain] of [[1, 0.06], [1.5, 0.04], [2.01, 0.03]]) {
      const o = tone(ctx, out, t + 0.2, { freq: 440 * ratio * p, to: 880 * ratio * p, glide: 2.5, dur: 2.7, gain, attack: 1.4 });
      lfo(ctx, o.detune, t + 0.2, 2.7, { rate: 6.5, depth: 18 });
    }
    return 2.95;
  },
  // The shockwave passing (a blast of wind and grit and a hard low thud).
  meltdown_blast(ctx, out, t, { p }) {
    tone(ctx, out, t, { freq: 80 * p, to: 26, glide: 0.5, dur: 1.2, gain: 0.4, attack: 0.002 });
    noise(ctx, out, t, { filter: 'lowpass', freq: [[0, 3200], [1.8, 300]], dur: 2, gain: 0.45, attack: 0.01 });
    noise(ctx, out, t, { freq: [[0, 1400], [1.5, 500]], q: 0.7, dur: 1.8, gain: 0.25, attack: 0.05 });
    crackles(ctx, out, t, { count: 30, span: 1.4, gain: 0.08, lo: 1500, hi: 5000, front: 1.5 });
    return 2.1;
  },
  // The roar collapsing into light (full white): a high, pure ring fading out, two close sines
  // beating slowly and a quiet octave under them, like ears ringing after a blast.
  meltdown_ring(ctx, out, t, { p }) {
    const f = 3150 * p;
    for (const [ratio, gain] of [[1, 0.09], [1.004, 0.07], [0.5, 0.03]]) {
      tone(ctx, out, t, { freq: f * ratio, dur: 2.9, gain, attack: 0.02, hold: 0.5 });
    }
    return 2.95;
  },
};

// Playback rules (audio/sfx.js SFX_INFO's).
export const AI_RACE_SFX_INFO = {
  // AI RACE's meltdown (fx/Meltdown.js): one of each at a time (the klaxon repeats every 1.5 s,
  // sooner than a voice slot is freed: 1.1 s + the engine's 0.5 s tail, so two may overlap)
  kaiju_roar: { range: 3, gap: 0.5, max: 2 },
  fireball_charge: { range: 3, gap: 0.2, max: 2 },
  fireball_launch: { range: 3, gap: 0.1, max: 3 },
  fireball_explode: { range: 1.8, max: 4 },
  fireball_fizzle: { gap: 0.1, max: 3 },
  tree_ignite: { range: 2, gap: 0.3, max: 2 },
  alarm: { gap: 1.2 },
  thunder: { max: 2 },
  minion_emerge: { range: 1.5, gap: 0.1, max: 3 }, // a warning: heard across the ~2000 they surface at
  minion_bite: { gap: 0.06, max: 3 },
  minion_wreck: { gap: 0.05, max: 3 },
  minions_stinger: { gap: 4, duck: { music: 0.45, amb: 1, seconds: 1.8 } },
  hall_warn: { range: 2.5, gap: 0.3, max: 2 }, // heard across the grounds: a unit is coming down
  hall_impact: { range: 2.5, gap: 0.1, max: 3 },
  hall_rise: { range: 2, gap: 0.25, max: 2 },
  tail_grab: { gap: 0.2, max: 1 },
  boss_haul: { range: 2.5, gap: 0.5, max: 1 },
  boss_whoosh: { range: 2.5, gap: 0.15, max: 2 },
  boss_throw: { range: 2, gap: 0.5, max: 1 },
  boss_slam: { range: 3, gap: 0.3, max: 2 },
  boss_crash: { range: 4, gap: 1, max: 1, duck: { music: 0.4, amb: 0.6, seconds: 1.6 } },
  boss_splash: { range: 3, gap: 1, max: 1 },
  meltdown_klaxon: { gap: 1.2, max: 2 },
  meltdown_ignite: { gap: 2, max: 1 },
  meltdown_flash: { gap: 2, max: 1 },
  meltdown_blast: { gap: 2, max: 1 },
  meltdown_ring: { gap: 2, max: 1 },
};

// Into the game's tables (the engine plays any name they have); a name there already stays.
export function register(sfx, info) {
  for (const [name, recipe] of Object.entries(AI_RACE_SFX)) if (!Object.hasOwn(sfx, name)) sfx[name] = recipe;
  for (const [name, i] of Object.entries(AI_RACE_SFX_INFO)) if (!Object.hasOwn(info, name)) info[name] = i;
}
