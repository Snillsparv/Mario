// AI RACE mode look for the renderer: the storm's fog and lights (crossfaded by darkness t),
// the colour grade applied in the post pass, and the lightning flash envelope.
//
// Everything is a no-op at t = 0 and flash 0: the fog and lights keep their sunny values,
// and the grade's uniform branches are skipped.

import { clamp } from '../../core/math.js';

// Storm fog: dark blue-grey, much shorter range than the sunny haze (8000..30000).
export const STORM_FOG = Object.freeze({ color: 0x2a323c, near: 1200, far: 15000 });
// Underwater in the storm: murky black-teal.
export const STORM_UNDERWATER_FOG = Object.freeze({ color: 0x0a2028, near: -700, far: 3200 });
// Lights for dynamic actors (hero, coins) at t = 1: a weak cold key and a grey ambient.
export const STORM_LIGHTS = Object.freeze({
  sunColor: 0x9aa6b8,
  sunIntensity: 0.3 * Math.PI,
  skyColor: 0x8494a4,
  groundColor: 0x363c36,
  ambientIntensity: 0.56 * Math.PI,
});

// Grade strengths at t = 1 (the shader interpolates from the untouched image at t = 0).
export const STORM_GRADE = Object.freeze({
  desaturate: 0.42,
  gamma: 1.32, // > 1 deepens the shadows
  gain: [0.8, 0.93, 0.95], // darker, cold teal
  lift: [0.004, 0.012, 0.018], // shadows sit on a faint blue-green, not pure black
});

// Lightning flash colour: added (and multiplied into the image) at flash strength 1.
export const FLASH_ADD = [0.3, 0.34, 0.46];
export const FLASH_GAIN = [0.9, 0.98, 1.14];

// Brightness of a lightning flash `age` seconds after it starts, 0..1: a bright stroke,
// a short dark gap, a second (return) stroke, then a quick decay (gone after ~0.45 s).
export function flashEnvelope(age) {
  if (!(age >= 0)) return 0;
  if (age < 0.045) return 1;
  if (age < 0.085) return 0.28;
  if (age < 0.13) return 0.85;
  if (age > 0.45) return 0;
  return 0.85 * Math.exp(-(age - 0.13) / 0.075);
}

// GLSL for the grade, applied to a display (sRGB) colour. uStorm = darkness t, uFlash = the
// flash's current brightness. Shared by the N64 pass and the native grade pass.
export const GRADE_GLSL = /* glsl */ `
  uniform float uStorm;
  uniform float uFlash;
  vec3 stormGrade(vec3 c) {
    if (uStorm > 0.0) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 g = mix(c, vec3(l), ${STORM_GRADE.desaturate.toFixed(3)});
      g = pow(max(g, vec3(0.0)), vec3(${STORM_GRADE.gamma.toFixed(3)}));
      g = g * vec3(${STORM_GRADE.gain.map((v) => v.toFixed(3)).join(', ')}) + vec3(${STORM_GRADE.lift.map((v) => v.toFixed(3)).join(', ')});
      c = mix(c, g, uStorm);
    }
    if (uFlash > 0.0) {
      c += uFlash * (vec3(${FLASH_ADD.map((v) => v.toFixed(3)).join(', ')}) + c * vec3(${FLASH_GAIN.map((v) => v.toFixed(3)).join(', ')}));
    }
    return c;
  }
`;

// The same grade on the CPU (tests, tuning): c = [r, g, b] display colour, returns a new one.
export function gradeColor(c, storm, flash = 0) {
  let [r, g, b] = c;
  if (storm > 0) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const d = STORM_GRADE.desaturate;
    const out = [r, g, b].map((v, i) => {
      let x = v + (l - v) * d;
      x = Math.max(0, x) ** STORM_GRADE.gamma * STORM_GRADE.gain[i] + STORM_GRADE.lift[i];
      return v + (x - v) * storm;
    });
    [r, g, b] = out;
  }
  if (flash > 0) {
    r += flash * (FLASH_ADD[0] + r * FLASH_GAIN[0]);
    g += flash * (FLASH_ADD[1] + g * FLASH_GAIN[1]);
    b += flash * (FLASH_ADD[2] + b * FLASH_GAIN[2]);
  }
  return [r, g, b];
}

// Fog values for darkness t: out = { near, far, uwNear, uwFar, t } (colours are mixed by
// the renderer with THREE.Color.lerpColors). Pure.
export function stormFogRange(t, day, underwater, out = {}) {
  const k = clamp(t, 0, 1);
  out.t = k;
  out.near = day.near + (STORM_FOG.near - day.near) * k;
  out.far = day.far + (STORM_FOG.far - day.far) * k;
  out.uwNear = underwater.near + (STORM_UNDERWATER_FOG.near - underwater.near) * k;
  out.uwFar = underwater.far + (STORM_UNDERWATER_FOG.far - underwater.far) * k;
  return out;
}
