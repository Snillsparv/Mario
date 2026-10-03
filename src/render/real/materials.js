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
//       roughness, metalness, side, vertexColors, envMapIntensity, clearcoat }: clearcoat, a
//       car's lacquer, [strength, roughness] over the paint: three.js's own clearcoat lobe,
//       switched on in the standard material without the physical one's class)
//   glassMaterial(opts, haze) -> MeshStandardMaterial        // window glass (below)
//   foliageMaterial(map, opts, haze) -> MeshStandardMaterial // leaf cards (below); opts {
//       roughness, translucency, coverage, envMapIntensity, wind }: coverage, alpha to coverage
//       (with MSAA) for the alpha test; wind, the uniform { value: Vector4(dir x, dir z, phase,
//       0) } every swaying material shares (the part's update sets the phase)
//   shadowCaster() -> MeshBasicMaterial                      // draws nothing, casts the sun's
//       shadow (both faces): the flat stand-in for a mesh that casts none itself (the tiles)
//   grassMaterial({ lawn, rect, grid, wind }, haze) -> MeshStandardMaterial   // the grass's
//       clump over a grid of cells (below): lawn the mask (a DataTexture), rect its uniform
//       Vector4(x0, z0, 1 / width, 1 / depth), grid { value: Vector4(corner x, corner z, cell,
//       radius) } and the grid's middle { value: Vector2 } (the part's update moves both)
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
// Leaf cards: a card is a clump of leaves, not a sheet, so both its faces are lit with its own
// normal (bent out of the plant's middle and up: the mass shades as a volume), not flipped for
// the back face; the sun shines through them (the shadowed direct light, filtered by the leaf
// twice over: green leaves glow greener, red ones redder; a little through any card, more
// looking toward the sun); each vertex sways along the wind by its `sway` (units: the cards'
// tips, never their roots), in waves that run over the plants.
//
// Grass: one clump of blades instanced over a square grid of cells round a point ahead of the
// camera (an attribute `cell`: each instance's cell in the grid), each clump put in its cell at a
// hash of where the cell lies (so nothing swims as the grid moves on a cell at a time), turned
// and sized by the same hash, stood on the lawn mask's height, and shrunk to nothing off the
// lawns and out toward the grid's radius (no pop); its tips sway in the wind.
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

export function plainMaterial({ color = 0xffffff, roughness = 0.5, metalness = 0, side = THREE.FrontSide, vertexColors = true, envMapIntensity = 1, clearcoat = null } = {}, haze) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, vertexColors, envMapIntensity });
  if (!clearcoat) return hazeChunk(material, haze);
  material.defines = { USE_CLEARCOAT: '' };
  return hazeChunk(material, haze, 'real-coat', (shader) => {
    shader.uniforms.clearcoat = { value: clearcoat[0] };
    shader.uniforms.clearcoatRoughness = { value: clearcoat[1] };
  });
}

const FOLIAGE_VERT = /* glsl */ `#include <begin_vertex>
  {
    vec4 swayAt = modelMatrix * vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      swayAt.xz += instanceMatrix[3].xz;
    #endif
    float swayPhase = uWind.z + dot(swayAt.xz, vec2(0.0021, 0.0013));
    transformed.xz += uWind.xy * sway * (0.7 * sin(swayPhase) + 0.3 * sin(2.3 * swayPhase + swayAt.y * 0.01));
  }`;

const FOLIAGE_FRAG = /* glsl */ `#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
    {
      float back = pow(clamp(dot(-geometryViewDir, directLight.direction), 0.0, 1.0), 3.0);
      float through = clamp(dot(-normal, directLight.direction), 0.0, 1.0);
      reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * diffuseColor.rgb * 4.0 * uTranslucency * (0.35 * through + back);
    }
  #endif`;

export function foliageMaterial(map, { roughness = 0.6, translucency = 0.6, coverage = false, envMapIntensity = 0.7, wind }, haze) {
  const material = new THREE.MeshStandardMaterial({ map, roughness, metalness: 0, vertexColors: true, side: THREE.DoubleSide, envMapIntensity, alphaTest: 0.5, alphaToCoverage: coverage });
  return hazeChunk(material, haze, 'real-foliage', (shader) => {
    shader.uniforms.uWind = wind;
    shader.uniforms.uTranslucency = { value: translucency };
    shader.vertexShader = 'attribute float sway;\nuniform vec4 uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', FOLIAGE_VERT);
    shader.fragmentShader = 'uniform float uTranslucency;\n' + shader.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_end>', FOLIAGE_FRAG);
  });
}

const GRASS_COLOR = /* glsl */ `#include <color_vertex>
  vec2 grassAt = uGrid.xy + cell * uGrid.z;
  vec2 grassHash = fract(sin(vec2(dot(grassAt / uGrid.z, vec2(12.9898, 78.233)), dot(grassAt / uGrid.z, vec2(39.3468, 11.135)))) * 43758.5453);
  grassAt += grassHash * uGrid.z;
  vec4 grassLawn = texture2D(uLawn, (grassAt - uLawnRect.xy) * uLawnRect.zw);
  float grassSize = grassLawn.r * (1.0 - smoothstep(uGrid.w * 0.7, uGrid.w, distance(grassAt, uGridMiddle)));
  vColor.rgb *= mix(vec3(0.9, 0.92, 0.85), vec3(1.25, 1.2, 1.05), grassHash.y);`;

const GRASS_VERT = /* glsl */ `#include <begin_vertex>
  {
    float turn = grassHash.x * 6.2832;
    transformed.xz = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * transformed.xz;
    transformed *= grassSize * vec3(1.0, 0.7 + 0.6 * grassHash.y, 1.0);
    float swayPhase = uWind.z * 1.3 + dot(grassAt, vec2(0.004, 0.003));
    transformed.xz += uWind.xy * sway * 2.5 * grassSize * (0.6 * sin(swayPhase) + 0.4 * sin(2.7 * swayPhase));
    transformed.xz += grassAt;
    transformed.y += grassLawn.g * 1020.0;
  }`;

export function grassMaterial({ lawn, rect, grid, middle, wind }, haze) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  return hazeChunk(material, haze, 'real-grass', (shader) => {
    Object.assign(shader.uniforms, { uLawn: { value: lawn }, uLawnRect: { value: rect }, uGrid: grid, uGridMiddle: middle, uWind: wind });
    shader.vertexShader = 'attribute vec2 cell;\nattribute float sway;\nuniform sampler2D uLawn;\nuniform vec4 uLawnRect, uGrid, uWind;\nuniform vec2 uGridMiddle;\n' + shader.vertexShader.replace('#include <color_vertex>', GRASS_COLOR).replace('#include <begin_vertex>', GRASS_VERT);
  });
}

export function shadowCaster() {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
}

export function glassMaterial({ color = 0x9aa4a8, roughness = 0.02, ior = 2.2, opacity = 0.45, envMapIntensity = 1 } = {}, haze) {
  const f0 = ((ior - 1) / (ior + 1)) ** 2;
  // (Opaque at opacity 1: a car's dark glass, nothing seen through it.)
  const clear = opacity < 1;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    transparent: clear,
    opacity,
    premultipliedAlpha: clear,
    depthWrite: !clear,
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
