// Midsummer Skerries' critters' sound recipes (audio/sfx.js's format), a pack of the skerries
// chunk (objects/Critters.js registers it as it loads): the Wreath Frogs, the Tin Crabs and the
// Mosquitoes.
//
//   CRITTER_SFX, CRITTER_SFX_INFO, register(sfx, info)

import { CRYSTAL, METAL, boing, chime, plip, thud, thwack, whoosh } from '../sfx.js';
import { bell, lfo, noise, tone } from '../synth.js';
import { mtof } from '../theory.js';

export const CRITTER_SFX = {
  // ---- Midsummer critters (objects/Critters.js; positional, with the event's pitch, quiet:
  // an idle critter's softer call, deflate: a punched mosquito's pop)

  // A Wreath Frog's croak: two buzzy 'kvaak' pulses (a sawtooth bending down, warbling, over a
  // reedy band of noise); `quiet` for its idle croak on the meadow.
  frog_croak(ctx, out, t, { p, quiet }) {
    const k = quiet ? 0.45 : 1;
    for (const dt of [0, 0.13]) {
      const saw = tone(ctx, out, t + dt, { wave: 'sawtooth', freq: 160 * p, to: 120 * p, dur: 0.09, gain: 0.12 * k, attack: 0.008 });
      lfo(ctx, saw.detune, t + dt, 0.09, { rate: 45, depth: 60 });
      noise(ctx, out, t + dt, { freq: 600 * p, q: 4, dur: 0.1, gain: 0.1 * k, attack: 0.006 });
    }
    return 0.26;
  },
  // Its throat sac puffing up (the windup, before the leap): a swelling, wobbling croak rising
  // under a breathy hiss, loudest just before it jumps.
  frog_puff(ctx, out, t, { p }) {
    const swell = tone(ctx, out, t, { wave: 'triangle', freq: [[0, 110 * p], [0.6, 300 * p]], dur: 0.66, gain: 0.16, attack: 0.5 });
    lfo(ctx, swell.detune, t, 0.66, { rate: 14, depth: 80 });
    noise(ctx, out, t, { freq: [[0, 900], [0.6, 1800]], q: 1.5, dur: 0.66, gain: 0.05, attack: 0.45 });
    return 0.66;
  },
  // The leap: a springy boing up and a whoosh as it flies.
  frog_leap(ctx, out, t, { p }) {
    boing(ctx, out, t, { from: 260 * p, to: 520 * p, dur: 0.22, gain: 0.25 });
    whoosh(ctx, out, t + 0.08, { from: 600, to: 2000, dur: 0.2, gain: 0.12 });
    return 0.3;
  },
  // Landing: a wet thump, a squelch and two little drips.
  frog_land(ctx, out, t, { p }) {
    thud(ctx, out, t, { freq: 140 * p, to: 60 * p, dur: 0.12, gain: 0.3 });
    noise(ctx, out, t, { filter: 'lowpass', freq: 1500, to: 300, dur: 0.1, gain: 0.15, attack: 0.002 });
    plip(ctx, out, t + 0.05, 500 * p, 0.08);
    plip(ctx, out, t + 0.1, 700 * p, 0.06);
    return 0.2;
  },
  // Stomped or knocked over: a trampoline boing and a plop as it pops, then the wreath flying
  // off on three rising chimes (C, E, G).
  frog_pop(ctx, out, t, { p }) {
    boing(ctx, out, t, { from: 220 * p, to: 480 * p, dur: 0.25, gain: 0.22, rate: 24 });
    tone(ctx, out, t, { freq: 900 * p, to: 260 * p, dur: 0.08, gain: 0.3, attack: 0.001 });
    for (const [dt, m] of [[0.12, 84], [0.17, 88], [0.22, 91]]) chime(ctx, out, t + dt, mtof(m) * p, 0.25, 0.05);
    return 0.5;
  },
  // A Tin Crab's claws: two dry clicks (a tick, a little blip and the tin's 'tink'); `quiet` a
  // softer pair.
  crab_clack(ctx, out, t, { p, quiet }) {
    const k = quiet ? 0.6 : 1;
    for (const dt of [0, 0.055]) {
      noise(ctx, out, t + dt, { filter: 'highpass', freq: 2800, dur: 0.015, gain: 0.22 * k, attack: 0.0008 });
      tone(ctx, out, t + dt, { wave: 'triangle', freq: 1500 * p, to: 1150 * p, dur: 0.025, gain: 0.08 * k, attack: 0.001 });
      bell(ctx, out, t + dt, { freq: 2400 * p, dur: 0.08, gain: 0.03 * k, partials: METAL });
    }
    return 0.14;
  },
  // Its pinch: a snapping thwack and a scissor 'shink'.
  crab_snap(ctx, out, t, { p }) {
    thwack(ctx, out, t, { body: 420 * p, to: 160 * p, snap: 3600, gain: 0.36 });
    noise(ctx, out, t, { freq: 5000, q: 6, dur: 0.05, gain: 0.12, attack: 0.002 });
    return 0.2;
  },
  // Stomped or knocked over: the tin bonked (ringing like a can, a dull thud under it), a little
  // squeak, and three chimes (G, B, D).
  crab_tonk(ctx, out, t, { p }) {
    bell(ctx, out, t, { freq: 520 * p, dur: 0.5, gain: 0.12, partials: METAL });
    bell(ctx, out, t, { freq: 780 * p, dur: 0.35, gain: 0.07 });
    thud(ctx, out, t, { freq: 200 * p, to: 80 * p, gain: 0.25 });
    tone(ctx, out, t + 0.1, { freq: 1400 * p, to: 2100 * p, dur: 0.06, gain: 0.06, attack: 0.004 });
    for (const [dt, m] of [[0.2, 79], [0.26, 83], [0.32, 86]]) chime(ctx, out, t + dt, mtof(m) * p, 0.25, 0.05);
    return 0.6;
  },
  // A Mosquito's whine, 'nnneee': a thin buzzing sawtooth bending up and back, warbling, over a
  // narrow hiss; `quiet` for its idle whine over the meadow (the loud one means it has seen him).
  mosquito_whine(ctx, out, t, { p, quiet }) {
    const k = quiet ? 0.35 : 1;
    const saw = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 520 * p], [0.25, 600 * p], [0.5, 540 * p]], dur: 0.5, gain: 0.06 * k, attack: 0.08 });
    lfo(ctx, saw.detune, t, 0.5, { rate: 26, depth: 40 });
    noise(ctx, out, t, { freq: 2400, q: 8, dur: 0.5, gain: 0.02 * k, attack: 0.08 });
    return 0.55;
  },
  // Its aim (the tell before the dive): a glassy 'ting' as it locks on, then the whine rising and
  // swelling with a fifth over it.
  mosquito_aim(ctx, out, t, { p }) {
    bell(ctx, out, t + 0.02, { freq: 2400 * p, dur: 0.3, gain: 0.05, partials: CRYSTAL });
    const rise = [[0, 480 * p], [0.75, 1150 * p]];
    const saw = tone(ctx, out, t, { wave: 'sawtooth', freq: rise, dur: 0.78, gain: 0.12, attack: 0.6 });
    const fifth = tone(ctx, out, t, { wave: 'sawtooth', freq: rise.map(([dt, f]) => [dt, f * 1.5]), dur: 0.78, gain: 0.03, attack: 0.6 });
    lfo(ctx, [saw.detune, fifth.detune], t, 0.78, { rate: 26, depth: 40 });
    return 0.8;
  },
  // The dive, 'zzzip': the whine falling fast with a rush of air, a thump as the needle goes in.
  mosquito_dive(ctx, out, t, { p }) {
    tone(ctx, out, t, { wave: 'sawtooth', freq: 1150 * p, to: 300 * p, dur: 0.3, gain: 0.1, attack: 0.005 });
    whoosh(ctx, out, t, { from: 3000, to: 800, dur: 0.3, gain: 0.1 });
    thud(ctx, out, t + 0.3, { freq: 160 * p, to: 70 * p, gain: 0.25 });
    return 0.45;
  },
  // Its needle stuck in the turf, quivering: a 'doinng' (pitched up, the 'thwop' as it pulls
  // free); `quiet` for the tugs after the first.
  mosquito_stuck(ctx, out, t, { p, quiet }) {
    boing(ctx, out, t, { from: 700 * p, to: 400 * p, dur: 0.3, gain: 0.12 * (quiet ? 0.6 : 1), rate: 40 });
    return 0.35;
  },
  // Stomped: a thwack, the whine collapsing and three chimes (D, F, A). `deflate` (punched): off
  // like a balloon let go, a 'pfrrrt', then a click and a little pop.
  mosquito_pop(ctx, out, t, { p, deflate }) {
    if (deflate) {
      const pfrt = tone(ctx, out, t, { wave: 'sawtooth', freq: [[0, 900 * p], [0.35, 260 * p]], dur: 0.36, gain: 0.08, attack: 0.01 });
      lfo(ctx, pfrt.detune, t, 0.36, { rate: 30, depth: 120 });
      noise(ctx, out, t + 0.38, { filter: 'highpass', freq: 3000, dur: 0.012, gain: 0.15, attack: 0.0005 });
      tone(ctx, out, t + 0.38, { freq: 700 * p, to: 250 * p, dur: 0.08, gain: 0.25, attack: 0.001 });
      return 0.6;
    }
    thwack(ctx, out, t, { body: 300 * p, to: 90 * p, snap: 2600, gain: 0.36 });
    tone(ctx, out, t, { wave: 'sawtooth', freq: 700 * p, to: 120 * p, dur: 0.5, gain: 0.06, attack: 0.005 });
    for (const [dt, m] of [[0.15, 86], [0.2, 89], [0.25, 93]]) chime(ctx, out, t + dt, mtof(m) * p, 0.25, 0.05);
    return 0.6;
  },
};

// Playback rules (audio/sfx.js SFX_INFO's).
export const CRITTER_SFX_INFO = {
  frog_croak: { range: 0.8, gap: 0.3, max: 2 },
  frog_puff: { gap: 0.3, max: 1 },
  frog_leap: { gap: 0.2, max: 2 },
  frog_land: { gap: 0.1, max: 2 },
  frog_pop: { gap: 0.05, max: 3 },
  crab_clack: { gap: 0.06, max: 2 },
  crab_snap: { gap: 0.1, max: 2 },
  crab_tonk: { gap: 0.05, max: 3 },
  mosquito_whine: { range: 0.8, gap: 0.4, max: 2 },
  mosquito_aim: { gap: 0.3, max: 1 },
  mosquito_dive: { gap: 0.2, max: 1 },
  mosquito_stuck: { gap: 0.2, max: 2 },
  mosquito_pop: { gap: 0.05, max: 3 },
};

// Into the game's tables (the engine plays any name they have); a name there already stays.
export function register(sfx, info) {
  for (const [name, recipe] of Object.entries(CRITTER_SFX)) if (!Object.hasOwn(sfx, name)) sfx[name] = recipe;
  for (const [name, i] of Object.entries(CRITTER_SFX_INFO)) if (!Object.hasOwn(info, name)) info[name] = i;
}
