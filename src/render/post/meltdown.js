// The renderer's side of AI RACE's meltdown (fx/Meltdown.js): the warning's red haze, the
// burning sky's orange fog, actor lights and colour grade, the white-out, the glare of the
// light and the heat shimmer. Applied on top of the storm (post/storm.js) in the same passes.
//
// Everything is a no-op while the meltdown's levels are 0: the fog and lights keep their storm
// (or sunny) values and the grade's uniform branches are skipped.

import * as THREE from 'three';
import { clamp } from '../../core/math.js';

// Fog: the warning mixes a deep red haze into the storm fog; the fire turns it orange-brown
// and a little shorter; the white-out turns it white and pulls it right in, so the world
// dissolves into light from the distance inward.
export const WARN_FOG = Object.freeze({ color: 0x5a1a10, mix: 0.6 });
export const FIRE_FOG = Object.freeze({ color: 0x8c3a12, near: 500, far: 12500, uwColor: 0x5a2410 });
export const WHITE_FOG = Object.freeze({ color: 0xffffff, near: -600, far: 2400, curve: 0.6 });

// Actor lights under the burning sky (hero, coins, the beast): lit orange from above, deep red
// from the ground; brighter and whiter as the light grows.
export const FIRE_LIGHTS = Object.freeze({
  sunColor: 0xffa060,
  sunIntensity: 0.55 * Math.PI,
  skyColor: 0xff9058,
  groundColor: 0x6a2410,
  ambientIntensity: 0.62 * Math.PI,
  keyColor: 0xffc890,
  whiteIntensity: 2.5, // lights x (1 + this x white)
});

// Grade (display colours): the fire tints everything by its luminance toward orange (keeping a
// little of its own hue), the warning a share of that; the white-out raises the exposure
// exponentially, bleaches the colours and ends in pure white; the glare is a hot core and a
// wide halo round the light's place on screen.
export const MELT_GRADE = Object.freeze({
  fireTint: [1.52, 0.82, 0.44],
  fireLift: [0.07, 0.02, 0.004],
  keepHue: 0.35,
  hueGain: [1.3, 0.85, 0.6],
  keepHighlights: [0.55, 0.95], // luminance range over which the fire tint eases off (flames keep their yellow)
  keepShare: 0.65,
  stormEase: 0.45, // the storm grade's share taken off while the sky burns (the world is fire-lit)
  warnFire: 0.3, // the warning's share of the fire grade at its peak
  exposure: 3.6, // stops of exposure at white 1...
  exposureCurve: 0.75, // ...rising as white^this (brighter early on)
  bleachTint: [1.06, 1.0, 0.88], // colours bleach toward a warm white
  bleach: 0.95, // share of the colour bleached out (luminance kept), reached at white bleachBy
  bleachBy: 0.25,
  pureWhite: [0.45, 1], // white range over which the picture goes pure white
  glareCore: 22, // falloff of the tight core (per picture height)
  glareHalo: 3.5, // falloff of the wide halo
  glareCoreGain: 1.1,
  glareHaloGain: 0.4,
  shimmer: [0.0028, 0.0018], // uv offset of the heat shimmer at 1
});

const f3 = (v) => v.map((x) => x.toFixed(4)).join(', ');
const f = (x) => x.toFixed(4);

// GLSL shared by the N64 pass and the native grade pass: heatShimmer(uv) is the uv offset to
// sample the scene at, meltGrade(c, uv) grades a display colour after stormGrade().
export const MELT_GLSL = /* glsl */ `
  uniform float uFire;
  uniform float uWhite;
  uniform float uGlare;
  uniform vec2 uGlarePos;
  uniform float uAspect;
  uniform float uShimmer;
  uniform float uMeltTime;
  vec2 heatShimmer(vec2 uv) {
    if (uShimmer <= 0.0) return vec2(0.0);
    float t = uMeltTime;
    float a = sin(uv.y * 155.0 + t * 9.0 + sin(uv.x * 31.0 - t * 2.3) * 2.2);
    float b = cos(uv.x * 120.0 - t * 7.3 + sin(uv.y * 47.0 + t * 1.7) * 1.8);
    return uShimmer * vec2(a * ${f(MELT_GRADE.shimmer[0])}, b * ${f(MELT_GRADE.shimmer[1])});
  }
  vec3 meltGrade(vec3 c, vec2 uv) {
    if (uFire > 0.0) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 hot = l * vec3(${f3(MELT_GRADE.fireTint)}) + vec3(${f3(MELT_GRADE.fireLift)});
      hot = mix(hot, c * vec3(${f3(MELT_GRADE.hueGain)}), ${f(MELT_GRADE.keepHue)});
      c = mix(c, hot, uFire * (1.0 - ${f(MELT_GRADE.keepShare)} * smoothstep(${f(MELT_GRADE.keepHighlights[0])}, ${f(MELT_GRADE.keepHighlights[1])}, l)));
    }
    if (uGlare > 0.0) {
      vec2 d = (uv - uGlarePos) * vec2(uAspect, 1.0);
      float r = length(d);
      c += uGlare * (vec3(1.0, 0.96, 0.86) * exp(-r * ${f(MELT_GRADE.glareCore)}) * ${f(MELT_GRADE.glareCoreGain)}
        + vec3(1.0, 0.8, 0.55) * exp(-r * ${f(MELT_GRADE.glareHalo)}) * ${f(MELT_GRADE.glareHaloGain)});
    }
    if (uWhite > 0.0) {
      c *= exp2(pow(uWhite, ${f(MELT_GRADE.exposureCurve)}) * ${f(MELT_GRADE.exposure)});
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, l * vec3(${f3(MELT_GRADE.bleachTint)}), smoothstep(0.0, ${f(MELT_GRADE.bleachBy)}, uWhite) * ${f(MELT_GRADE.bleach)});
      c = mix(min(c, vec3(1.0)), vec3(1.0), smoothstep(${f(MELT_GRADE.pureWhite[0])}, ${f(MELT_GRADE.pureWhite[1])}, uWhite));
    }
    return c;
  }
`;

// The uniforms MELT_GLSL reads, all off.
export function meltUniforms() {
  return {
    uFire: { value: 0 },
    uWhite: { value: 0 },
    uGlare: { value: 0 },
    uGlarePos: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 4 / 3 },
    uShimmer: { value: 0 },
    uMeltTime: { value: 0 },
  };
}

// Copies a grade state { fire, white, glare, glareX, glareY, aspect, shimmer, time } into the
// uniforms (from meltUniforms() or a pass's material).
export function setMeltUniforms(u, g) {
  u.uFire.value = g.fire;
  u.uWhite.value = g.white;
  u.uGlare.value = g.glare;
  u.uGlarePos.value.set(g.glareX, g.glareY);
  u.uAspect.value = g.aspect;
  u.uShimmer.value = g.shimmer;
  u.uMeltTime.value = g.time;
}

// The grade state with everything off.
export const MELT_OFF = Object.freeze({ fire: 0, white: 0, glare: 0, glareX: 0.5, glareY: 0.5, aspect: 4 / 3, shimmer: 0, time: 0 });

// The fire grade's strength for the levels: the fire itself, plus a share of the warning.
export const fireGradeOf = (warn, fire) => clamp(fire + (1 - fire) * warn * MELT_GRADE.warnFire, 0, 1);

// The same grade on the CPU (tests, tuning), glare left out: c = [r, g, b] display colour.
export function meltGradeColor(c, fire = 0, white = 0) {
  let [r, g, b] = c;
  if (fire > 0) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const hot = [r, g, b].map((v, i) => {
      const t = l * MELT_GRADE.fireTint[i] + MELT_GRADE.fireLift[i];
      return t + (v * MELT_GRADE.hueGain[i] - t) * MELT_GRADE.keepHue;
    });
    const [h0, h1] = MELT_GRADE.keepHighlights;
    const u = clamp((l - h0) / (h1 - h0), 0, 1);
    const k = fire * (1 - MELT_GRADE.keepShare * u * u * (3 - 2 * u));
    [r, g, b] = [r, g, b].map((v, i) => v + (hot[i] - v) * k);
  }
  if (white > 0) {
    const e = 2 ** (white ** MELT_GRADE.exposureCurve * MELT_GRADE.exposure);
    [r, g, b] = [r * e, g * e, b * e];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const q = clamp(white / MELT_GRADE.bleachBy, 0, 1);
    const k = q * q * (3 - 2 * q) * MELT_GRADE.bleach;
    [r, g, b] = [r, g, b].map((v, i) => v + (l * MELT_GRADE.bleachTint[i] - v) * k);
    const [w0, w1] = MELT_GRADE.pureWhite;
    const u = clamp((white - w0) / (w1 - w0), 0, 1);
    const s = u * u * (3 - 2 * u);
    [r, g, b] = [r, g, b].map((v) => Math.min(v, 1) + (1 - Math.min(v, 1)) * s);
  }
  return [r, g, b];
}

// Fog range for the storm's (near, far) under the meltdown's fire and white (pure).
export function meltFogRange(near, far, fire, white, out = {}) {
  let n = near + (FIRE_FOG.near - near) * fire;
  let fa = far + (FIRE_FOG.far - far) * fire;
  const w = white > 0 ? white ** WHITE_FOG.curve : 0;
  n += (WHITE_FOG.near - n) * w;
  fa += (WHITE_FOG.far - fa) * w;
  out.near = n;
  out.far = fa;
  return out;
}
