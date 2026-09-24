// AI RACE mode colour grade for the world's unlit materials (terrain, water, castle, props).
//
// Every patched material keeps its normal look at darkT = 0 and crossfades to a graded
// version of its own colour as darkT goes to 1:
//   dark = mix(luminance, colour, sat) * mul + add
// so each material picks how much colour it keeps (sat), its tint and brightness (mul) and a
// floor (add). The code is always compiled in and driven by uniforms only: switching the mode
// never compiles a shader or touches geometry, and every material patched the same way
// shares one program (their per-material values are uniforms).
//
// Options (patch(material, grade)):
//   sat, mul, add        the grade (mul/add: [r, g, b] linear, or a hex colour, sRGB)
//   glow                 'attribute': vertices with the 'darkGlow' attribute (0..1) light up
//                        in glowColor, pulsing, and shine through the fog (castle windows);
//                        every mesh with this material must carry that attribute
//   glowColor            linear [r, g, b]
//   ragged               tear the cloth: fragments near the free end (uv.x -> 1) and a few
//                        holes are discarded as darkT grows (flags)
//   oil                  thin-film sheen: the colour runs through an iridescent palette over
//                        the uv (water highlights)
// Uniforms shared by every material of one DarkGrade: darkT (0..1) and darkTime (seconds).
//
// Patches chain onto a material's own onBeforeCompile / customProgramCacheKey (the foliage
// fade's), so they combine.

import * as THREE from 'three';

const LUMA = 'vec3(0.299, 0.587, 0.114)';

function toLinear(c) {
  if (Array.isArray(c)) return new THREE.Vector3(...c);
  const col = new THREE.Color(c); // sRGB hex -> linear working colour
  return new THREE.Vector3(col.r, col.g, col.b);
}

export class DarkGrade {
  constructor() {
    this.t = { value: 0 };
    this.time = { value: 0 };
    this.materials = [];
  }

  // Crossfade amount (0 sunny .. 1 storm).
  set(t) {
    this.t.value = t;
  }

  tick(time) {
    if (Number.isFinite(time)) this.time.value = time;
  }

  patch(material, { sat = 0.3, mul = [0.3, 0.3, 0.3], add = [0, 0, 0], glow = null, glowColor = [0.95, 0.03, 0.16], ragged = false, oil = false } = {}) {
    const uniforms = {
      darkT: this.t,
      darkTime: this.time,
      darkSat: { value: sat },
      darkMul: { value: toLinear(mul) },
      darkAdd: { value: toLinear(add) },
      darkGlowColor: { value: toLinear(glowColor) },
    };
    const flags = [glow === 'attribute' ? 'g' : '', ragged ? 'r' : '', oil ? 'o' : ''].join('');
    const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile');
    const prev = own ? material.onBeforeCompile : null;
    const prevKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      applyGrade(shader, uniforms, { glow: glow === 'attribute', ragged, oil });
    };
    const key = `dark-grade-${flags}`;
    material.customProgramCacheKey = prevKey ? () => `${prevKey.call(material)}|${key}` : () => key;
    material.userData.darkGrade = uniforms;
    this.materials.push(material);
    return material;
  }
}

// Rewrites a MeshBasicMaterial shader (as handed to onBeforeCompile).
export function applyGrade(shader, uniforms, { glow = false, ragged = false, oil = false } = {}) {
  Object.assign(shader.uniforms, uniforms);
  if (glow) {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float darkGlow;
varying float vDarkGlow;
varying vec3 vDarkWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vDarkGlow = darkGlow;
vDarkWorld = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
  }
  const uv = ragged || oil ? '#if defined(USE_MAP)\n' : '';
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float darkT;
uniform float darkTime;
uniform float darkSat;
uniform vec3 darkMul;
uniform vec3 darkAdd;
uniform vec3 darkGlowColor;${glow ? '\nvarying float vDarkGlow;\nvarying vec3 vDarkWorld;\nfloat darkShine = 0.0;' : ''}`,
    )
    .replace(
      '#include <specularmap_fragment>',
      `if (darkT > 0.0) {
  vec3 dc = diffuseColor.rgb;
  float dl = dot(dc, ${LUMA});
  vec3 dd = mix(vec3(dl), dc, darkSat) * darkMul + darkAdd;${
    oil
      ? `
  ${uv}  // Thin-film sheen: an iridescent palette drifting over the ripples.
  float film = vMapUv.x * 1.7 + vMapUv.y * 1.1 + 0.35 * sin(vMapUv.y * 9.0 + darkTime * 0.7);
  dd *= 0.75 + 0.5 * (0.5 + 0.5 * cos(6.2832 * (film + vec3(0.0, 0.33, 0.67))));
  #endif`
      : ''
  }
  diffuseColor.rgb = mix(dc, dd, darkT);${
    glow
      ? `
  // Glowing windows: a slow uneven pulse, drifting across the building so neighbouring
  // windows are out of step.
  float ph = dot(vDarkWorld, vec3(0.0021, 0.0013, 0.0017));
  float pulse = 0.72 + 0.2 * sin(darkTime * 2.1 + ph) + 0.08 * sin(darkTime * 7.3 + ph * 3.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, darkGlowColor * pulse, darkT * vDarkGlow);
  darkShine = darkT * vDarkGlow;`
      : ''
  }${
    ragged
      ? `
  ${uv}  // Ragged cloth: a torn free end and a few holes.
  float rowTear = fract(sin(floor(vMapUv.y * 26.0) * 91.7) * 4375.85);
  if (vMapUv.x > 1.0 - darkT * (0.14 + 0.24 * rowTear)) discard;
  float hole = fract(sin(dot(floor(vec2(vMapUv.x * 10.0, vMapUv.y * 14.0)), vec2(12.9898, 78.233))) * 43758.5453);
  if (vMapUv.x > 0.25 && hole > 1.0 - 0.14 * darkT) discard;
  #endif`
      : ''
  }
}
#include <specularmap_fragment>`,
    );
  if (glow) {
    // Lit windows shine through the fog, like lights in a storm.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * (1.0 - 0.75 * darkShine));
#endif`,
    );
  }
  return shader;
}
