// The realistic look's materials (render/real/RealLook.js): physically based, lit by the sun,
// its shadow and the sky's environment, each ending in the look's haze. A world's catalogue of
// materials (world/lane/real/look.js for Sparrow Lane) is built from these.
//
//   pbrMaterial(maps, opts, haze) -> MeshStandardMaterial    // a texture set's maps (texture
//       Store.maps: albedo x the vertex tint x opts.color, the normal map, occlusion and
//       roughness from the ORM map); opts { repeat, color, roughness, normalScale, side,
//       vertexColors }: repeat = the textures' repeats per geometry uv unit (clones are taken,
//       sharing the images, so two materials may repeat one set differently)
//   plainMaterial(opts, haze) -> MeshStandardMaterial        // flat: paint, cloth (opts { color,
//       roughness, metalness, side, vertexColors })
//   glassMaterial(opts, haze) -> MeshStandardMaterial        // window glass (below)
//   hazeChunk(material, haze, key)                           // patches any standard material
//   classicLook(material, { exposure, direct })              // an unlit classic material (the
//       signs' boards) drawn through the look as it looked in the classic one (below)
//   CLAMP_GLSL                                               // the clamp's source (the tests')
//
// `haze` is the look's uniforms (sky.js skyUniforms + uHazeDensity), shared by every material,
// so the sky and the haze change together.
//
// The haze chunk replaces the fog: the fragment's distance to the camera fades it toward the
// sky's own colour in that direction (sky.js hazeColor: exponential, uHazeDensity per unit). And
// first it clamps the lit colour to 32: a sun highlight on a mirror-smooth surface (the glass at
// roughness 0.02) is ~1e6, which overflows a half-float target (the reflection probe's cube) to
// Inf, and the probe's prefilter then smears it into NaN: every window and car went black. The
// clamp also stops MSAA fireflies. Every realistic material must have it. On the direct path (no
// HDR target: the renderer tone maps per material) the haze colour is tone mapped and encoded the
// same way as the colour it mixes with.
//
// Glass: double glazing reflects ~14 % head on (ior 2.2 stands in for four surfaces: its F0,
// ((ior - 1) / (ior + 1))^2, set in the standard material's lighting, exactly as the physical
// material computes it from its ior, without that class in the bundle); its reflections (the
// street, from the look's reflection probe: its envMap) are added at full strength while what is
// behind it (the room) shows through at 1 - opacity: a premultiplied output, blended with
// premultipliedAlpha.
//
// Classic through the look: the output pass multiplies by the exposure and tone maps (Neutral
// subtracts a little from the darkest channel and compresses the brightest), so an unlit
// material's colour is turned back first (untoneNeutral, exact below the curve's shoulder):
// the signs' boards come out of the output pass as the classic look draws them. On the direct
// path (three tone maps per material) it simply is not tone mapped.
//
// Each patch has a fixed customProgramCacheKey: one program serves every material of a kind
// with the same three.js features.

import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';

export const CLAMP_GLSL = 'min(gl_FragColor.rgb, vec3(32.0))';

const HAZE_VERT = /* glsl */ `#include <project_vertex>
  vec4 hazePosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hazePosition = instanceMatrix * hazePosition;
  #endif
  vHazeWorld = (modelMatrix * hazePosition).xyz;`;

const HAZE_FRAG = /* glsl */ `{
    vec3 hazeDir = vHazeWorld - cameraPosition;
    float hazeDist = length(hazeDir);
    vec3 hazeTint = hazeColor(hazeDir / hazeDist);
    #ifdef TONE_MAPPING
      hazeTint = toneMapping(hazeTint);
    #endif
    hazeTint = linearToOutputTexel(vec4(hazeTint, 1.0)).rgb;
    gl_FragColor.rgb = mix(${CLAMP_GLSL}, hazeTint, 1.0 - exp(-hazeDist * uHazeDensity));
  }`;

export function hazeChunk(material, haze, key = 'real-haze', patch = null) {
  material.fog = false; // (the haze is the fog)
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, haze);
    shader.vertexShader = 'varying vec3 vHazeWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', HAZE_VERT);
    shader.fragmentShader = 'varying vec3 vHazeWorld;\nuniform float uHazeDensity;\n' + SKY_GLSL + shader.fragmentShader.replace('#include <fog_fragment>', HAZE_FRAG);
    patch?.(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

const repeated = (texture, repeat) => {
  const t = texture.clone();
  t.repeat.set(repeat, repeat);
  return t;
};

export function pbrMaterial(maps, { repeat = 1, color = 0xffffff, roughness = 1, normalScale = 1, side = THREE.FrontSide, vertexColors = true } = {}, haze) {
  const orm = repeated(maps.orm, repeat);
  const material = new THREE.MeshStandardMaterial({
    map: repeated(maps.albedo, repeat),
    normalMap: repeated(maps.normal, repeat),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: orm,
    aoMap: orm,
    color,
    roughness,
    metalness: 0,
    vertexColors,
    side,
  });
  return hazeChunk(material, haze);
}

export function plainMaterial({ color = 0xffffff, roughness = 0.5, metalness = 0, side = THREE.FrontSide, vertexColors = true } = {}, haze) {
  return hazeChunk(new THREE.MeshStandardMaterial({ color, roughness, metalness, side, vertexColors }), haze);
}

export function glassMaterial({ color = 0x9aa4a8, roughness = 0.02, ior = 2.2, opacity = 0.45, envMapIntensity = 1 } = {}, haze) {
  const f0 = ((ior - 1) / (ior + 1)) ** 2;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    transparent: true,
    opacity,
    premultipliedAlpha: true,
    depthWrite: false,
    envMapIntensity,
    side: THREE.DoubleSide,
  });
  material.forceSinglePass = true; // (flat panes never cover themselves: one pass, not two)
  material.userData.ior = ior;
  return hazeChunk(material, haze, 'real-glass', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        material.specularColor = vec3(${f0.toFixed(5)});
        material.specularColorBlended = material.specularColor;`,
      )
      .replace(
        '#include <opaque_fragment>',
        'gl_FragColor = vec4((reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * diffuseColor.a + reflectedLight.directSpecular + reflectedLight.indirectSpecular, diffuseColor.a);',
      )
      .replace('#include <premultiplied_alpha_fragment>', '');
  });
}

// The colour the output pass's exposure and Neutral tone mapping turn back into c.
const UNTONE_GLSL = /* glsl */ `
uniform float uExposure;
vec3 untoneNeutral(vec3 c) {
  float m = min(c.r, min(c.g, c.b));
  float x = m < 0.04 ? sqrt(max(m, 0.0) / 6.25) : m + 0.04;
  return (c + (x < 0.08 ? x - 6.25 * x * x : 0.04)) / uExposure;
}
`;

export function classicLook(material, { exposure, direct = false }) {
  if (direct) {
    material.toneMapped = false;
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uExposure = { value: exposure };
    shader.fragmentShader = UNTONE_GLSL + shader.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = untoneNeutral(gl_FragColor.rgb);\n#include <tonemapping_fragment>');
  };
  material.customProgramCacheKey = () => 'real-classic';
  return material;
}
