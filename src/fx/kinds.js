// What each particle kind looks like: atlas shape, orientation, blend, and its colour/size
// over its life. Pure functions of the particle's fields, evaluated every drawn frame by
// ParticleBatch (so fire flicker, colour cooling and fades cost no extra simulation state).
//
// Colours are linear RGB and may exceed 1 (hot cores and flashes saturate to white).

import { SHAPE } from './atlas.js';

export const KIND = Object.freeze({
  FLAME: 0, // fire tongue: yellow-white core, red edges, rises and shrinks
  SMOKE: 1, // dark rising smoke (alpha blended)
  EMBER: 2, // tiny glowing streak drifting up from a fire
  SPARK: 3, // bright blast spark, falls with gravity
  FIREBALL: 4, // blast billow: white-hot to orange to deep red
  FLASH: 5, // blast core flash
  DEBRIS: 6, // dark tumbling chunk (alpha blended)
  SHOCKWAVE: 7, // ground ring of a blast
  RING: 8, // rain splash ring on the ground / water
  DROPLET: 9, // rain splash droplet
  BOLT: 10, // lightning segment core
  BOLT_GLOW: 11, // lightning segment halo
  DUST: 12, // billowing grey-brown dust (a heavy landing; alpha blended)
});

export const MODE = Object.freeze({ BILLBOARD: 0, STREAK: 1, GROUND: 2 });

// Per kind: shape (atlas cell), mode (orientation), alpha (1 = alpha blended, 0 = additive),
// fog (0 = unaffected by fog: the distant lightning).
export const KIND_INFO = [
  { shape: SHAPE.FLAME_A, mode: MODE.STREAK, alpha: 0, fog: 1 }, // FLAME (variant B by seed)
  { shape: SHAPE.SMOKE, mode: MODE.BILLBOARD, alpha: 1, fog: 1 }, // SMOKE
  { shape: SHAPE.GLOW, mode: MODE.STREAK, alpha: 0, fog: 1 }, // EMBER
  { shape: SHAPE.GLOW, mode: MODE.STREAK, alpha: 0, fog: 1 }, // SPARK
  { shape: SHAPE.FLAME_A, mode: MODE.BILLBOARD, alpha: 0, fog: 1 }, // FIREBALL
  { shape: SHAPE.STAR, mode: MODE.BILLBOARD, alpha: 0, fog: 1 }, // FLASH
  { shape: SHAPE.CHUNK, mode: MODE.BILLBOARD, alpha: 1, fog: 1 }, // DEBRIS
  { shape: SHAPE.RING, mode: MODE.GROUND, alpha: 0, fog: 1 }, // SHOCKWAVE
  { shape: SHAPE.RING, mode: MODE.GROUND, alpha: 0, fog: 1 }, // RING
  { shape: SHAPE.GLOW, mode: MODE.STREAK, alpha: 0, fog: 1 }, // DROPLET
  { shape: SHAPE.LINE, mode: MODE.STREAK, alpha: 0, fog: 0 }, // BOLT
  { shape: SHAPE.LINE, mode: MODE.STREAK, alpha: 0, fog: 0 }, // BOLT_GLOW
  { shape: SHAPE.SMOKE, mode: MODE.BILLBOARD, alpha: 1, fog: 1 }, // DUST
];

// True for kinds drawn in the alpha-blended group (drawn before the additive ones).
export const isAlphaKind = (kind) => KIND_INFO[kind].alpha === 1;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Piecewise-linear colour ramp over stops [f, r, g, b, ...] (f ascending) at f, as [r, g, b].
function ramp(stops, f) {
  const n = stops.length / 4;
  if (f <= stops[0]) return [stops[1], stops[2], stops[3]];
  for (let s = 1; s < n; s++) {
    const f1 = stops[s * 4];
    if (f <= f1 || s === n - 1) {
      const f0 = stops[s * 4 - 4];
      const t = Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
      return [0, 1, 2].map((c) => stops[s * 4 - 3 + c] + (stops[s * 4 + 1 + c] - stops[s * 4 - 3 + c]) * t);
    }
  }
  return [0, 0, 0];
}

// Colours and envelopes over a particle's life are baked into lookup tables of LUT_N steps
// (6 ms apart for a 0.8 s flame), read with an integer index: the per-sprite style below then
// calls no helper with floating-point arguments, which V8 would box (allocate) whenever it
// does not inline the call.
const LUT_N = 128;
const lutIndex = (f) => (f <= 0 ? 0 : f >= 1 ? LUT_N - 1 : (f * (LUT_N - 1) + 0.5) | 0);
function bakeColors(stops) {
  const lut = new Float32Array(LUT_N * 3);
  for (let k = 0; k < LUT_N; k++) lut.set(ramp(stops, k / (LUT_N - 1)), k * 3);
  return lut;
}
function bakeCurve(fn) {
  const lut = new Float32Array(LUT_N);
  for (let k = 0; k < LUT_N; k++) lut[k] = fn(k / (LUT_N - 1));
  return lut;
}

// Seconds a lightning bolt stays drawn (fx/lightning.js LIGHTNING.boltLife).
export const BOLT_LIFE = 0.2;

// Lightning: a bright first stroke, a dark gap, a return stroke, then a fade.
export function boltFlicker(age, life) {
  if (age < 0.05) return 1;
  if (age < 0.08) return 0.25;
  if (age < 0.13) return 0.9;
  return Math.max(0, 1 - (age - 0.13) / Math.max(0.01, life - 0.13)) * 0.75;
}

const FLAME_RGB = bakeColors([0, 1.7, 1.25, 0.5, 0.3, 1.45, 0.62, 0.14, 0.7, 0.95, 0.2, 0.04, 1, 0.45, 0.06, 0.02]);
const FIREBALL_RGB = bakeColors([0, 3.2, 2.5, 1.3, 0.2, 2.3, 1.2, 0.3, 0.55, 1.25, 0.33, 0.06, 1, 0.25, 0.06, 0.03]);
const SPARK_RGB = bakeColors([0, 2.8, 2.3, 1.4, 0.5, 2.0, 0.9, 0.25, 1, 1.2, 0.3, 0.05]);
// Smoke: dark grey, lit orange from below by the fire while young.
const SMOKE_RGB = bakeColors([0, 0.485, 0.205, 0.1, 0.25, 0.1125, 0.1025, 0.0975, 1, 0.19, 0.19, 0.2]);

// Dust (linear): dry grey-brown, lighter while it billows out, settling to a dull grey.
const DUST_RGB = bakeColors([0, 0.24, 0.215, 0.18, 0.4, 0.15, 0.14, 0.125, 1, 0.085, 0.085, 0.09]);
const DUST_ALPHA = bakeCurve((f) => smooth(f / 0.05) * (1 - f) ** 1.5 * 0.8);
const FLAME_ALPHA = bakeCurve((f) => smooth(f / 0.1) * (1 - smooth((f - 0.55) / 0.45)));
const FLAME_GROW = bakeCurve((f) => 0.75 + 0.25 * smooth(f / 0.2)); // quick swell, then thinner
const SMOKE_ALPHA = bakeCurve((f) => smooth(f / 0.15) * (1 - f) ** 1.2 * 0.78);
const EASE_OUT2 = bakeCurve((f) => 1 - (1 - f) ** 2);
const EASE_OUT3 = bakeCurve((f) => 1 - (1 - f) ** 3);
const EASE_OUT4 = bakeCurve((f) => 1 - (1 - f) ** 4);
const FADE_07 = bakeCurve((f) => (1 - f) ** 0.7);
const FADE_15 = bakeCurve((f) => (1 - f) ** 1.5);
const FADE_16 = bakeCurve((f) => (1 - f) ** 1.6);
const FADE_SQ = bakeCurve((f) => 1 - f * f);
const DEBRIS_ALPHA = bakeCurve((f) => 1 - smooth((f - 0.75) / 0.25));
const BOLT_ALPHA = bakeCurve((f) => boltFlicker(f * BOLT_LIFE, BOLT_LIFE));

// Fills `out` { r, g, b, a, size, shape, mode, alpha, fog, stretch } for particle i of the
// pool at time out.clock (seconds, for flicker). Returns false when it draws nothing now.
export function particleStyle(pool, i, out) {
  const age = pool.age[i];
  if (age < 0) return false;
  const kind = pool.kind[i];
  const info = KIND_INFO[kind];
  const life = pool.life[i];
  const f = age / life;
  const seed = pool.seed[i];
  const heat = pool.heat[i];
  const s0 = pool.size0[i];
  const s1 = pool.size1[i];
  const clock = out.clock;
  out.shape = info.shape;
  out.mode = info.mode;
  out.alpha = info.alpha;
  out.fog = info.fog;
  out.stretch = pool.stretch[i];
  const k = lutIndex(f);
  const c = k * 3;
  let size = s0 + (s1 - s0) * f;
  let a = 1;
  switch (kind) {
    case KIND.FLAME: {
      if (seed > 0.5) out.shape = SHAPE.FLAME_B;
      out.r = FLAME_RGB[c];
      out.g = FLAME_RGB[c + 1];
      out.b = FLAME_RGB[c + 2];
      a = FLAME_ALPHA[k] * heat;
      // Swells quickly, then licks upward thinner; flickers on its own phase.
      size *= FLAME_GROW[k] * (0.86 + 0.14 * Math.sin(clock * 23 + seed * 60));
      break;
    }
    case KIND.SMOKE: {
      out.r = SMOKE_RGB[c];
      out.g = SMOKE_RGB[c + 1];
      out.b = SMOKE_RGB[c + 2];
      a = SMOKE_ALPHA[k] * heat;
      size = s0 + (s1 - s0) * EASE_OUT2[k];
      break;
    }
    case KIND.EMBER: {
      out.r = 2.4;
      out.g = 0.95 + seed * 0.5;
      out.b = 0.22;
      a = (1 - f) * (0.55 + 0.45 * Math.sin(clock * 31 + seed * 90)) * heat;
      break;
    }
    case KIND.SPARK: {
      out.r = SPARK_RGB[c];
      out.g = SPARK_RGB[c + 1];
      out.b = SPARK_RGB[c + 2];
      a = FADE_07[k] * heat;
      break;
    }
    case KIND.FIREBALL: {
      if (seed > 0.5) out.shape = SHAPE.FLAME_B;
      out.r = FIREBALL_RGB[c];
      out.g = FIREBALL_RGB[c + 1];
      out.b = FIREBALL_RGB[c + 2];
      a = FADE_SQ[k] * heat;
      size = s0 + (s1 - s0) * EASE_OUT3[k];
      break;
    }
    case KIND.FLASH: {
      out.r = 3.2 - 1.4 * f;
      out.g = 2.3 - 1.6 * f;
      out.b = 1.2 - 1.0 * f;
      a = FADE_16[k] * heat;
      size = s0 + (s1 - s0) * EASE_OUT4[k];
      break;
    }
    case KIND.DEBRIS: {
      // Charred chunks, still glowing a little at first.
      const glow = f < 0.333 ? 1 - f * 3 : 0;
      out.r = 0.07 + 0.5 * glow;
      out.g = 0.055 + 0.12 * glow;
      out.b = 0.05;
      a = DEBRIS_ALPHA[k];
      break;
    }
    case KIND.SHOCKWAVE: {
      out.r = 1.8;
      out.g = 0.9;
      out.b = 0.35;
      a = FADE_15[k] * heat * 0.8;
      size = s0 + (s1 - s0) * EASE_OUT2[k];
      break;
    }
    case KIND.RING: {
      out.r = 0.62;
      out.g = 0.7;
      out.b = 0.82;
      a = (1 - f) * 0.55 * heat;
      size = s0 + (s1 - s0) * EASE_OUT2[k];
      break;
    }
    case KIND.DROPLET: {
      out.r = 0.65;
      out.g = 0.72;
      out.b = 0.85;
      a = (1 - f) * 0.8 * heat;
      break;
    }
    case KIND.DUST: {
      out.r = DUST_RGB[c];
      out.g = DUST_RGB[c + 1];
      out.b = DUST_RGB[c + 2];
      a = DUST_ALPHA[k] * heat;
      size = s0 + (s1 - s0) * EASE_OUT3[k];
      break;
    }
    case KIND.BOLT: {
      out.r = 2.4;
      out.g = 2.6;
      out.b = 3.2;
      a = BOLT_ALPHA[k] * heat;
      break;
    }
    case KIND.BOLT_GLOW: {
      out.r = 0.55;
      out.g = 0.65;
      out.b = 1.2;
      a = BOLT_ALPHA[k] * heat * 0.7;
      break;
    }
    default:
      return false;
  }
  if (!(a > 0.002) || !(size > 0)) return false;
  out.a = a;
  out.size = size;
  return true;
}
