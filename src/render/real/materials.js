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
//   contactMaterial() -> MeshBasicMaterial                   // the cars' contact shadows: the
//       colour already drawn multiplied by the vertex colour (what the ground's light under a
//       car is cut to: darkest under its middle and round its tyres), after the opaque scene,
//       writing no depth, pulled toward the camera a little (no fight with the drive)
//   grassMaterial({ lawn, rect, grid, wind }, haze) -> MeshStandardMaterial   // the grass's
//       clump over a grid of cells (below): lawn the mask (a DataTexture), rect its uniform
//       Vector4(x0, z0, 1 / width, 1 / depth), grid { value: Vector4(corner x, corner z, cell,
//       radius) } and the grid's middle { value: Vector2 } (the part's update moves both)
//   hazeChunk(material, haze, key, patch?, wear?)            // patches any standard material
//       (and, where the look has a far shadow map, haze.uFarShadow, sunShadowChunk: key '-far';
//       wear { attr, lite }: the WEAR patch where the look has the ground map, haze.uWearGround:
//       keys '-wear', '-wa' (the `wear` attribute), '-wl' (lite))
//   setWear(material, kind)                                  // its weathering's strengths
//       (WEAR_KIND[kind]: none by default)
//   WEAR_KIND, WEAR_GLSL                                     // (the tests')
//   sunShadowChunk(shader)                                   // the sun's shadow near and far
//   classicLook(material, { exposure, direct, grade })       // an unlit classic material (the
//       signs' boards) drawn through the look as it looked in the classic one (below; grade:
//       the look's grade uniforms, RealLook.grade, turned back too)
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
// the back face; the sun shines through them (the sun's shadowed light, kept as the lights' loop
// lit it: after the loop three leaves the last directional light in directLight, the storm's
// key; filtered by the leaf twice over: green leaves glow greener, red ones redder; a little
// through any card, more looking toward the sun); a card seen from behind its normal (against
// the light) gets no sheen, its light being the one through it; each vertex sways along the
// wind by its `sway` (units: the cards' tips, never their roots), in waves that run over the
// plants.
//
// Grass: one clump of blades instanced over a square grid of cells round a point ahead of the
// camera (an attribute `cell`: each instance's cell in the grid), each clump put in its cell at a
// hash of where the cell lies (so nothing swims as the grid moves on a cell at a time), turned
// and sized by the same hash, stood on the lawn mask's height, and shrunk to nothing off the
// lawns and out toward the grid's radius (no pop); its tips sway in the wind.
//
// Wear and grime (WEAR): the street weathered without a texture of its own. Every textured
// material (pbrMaterial) gets a patch before its lighting, with the look's ground map
// (haze.uWearGround: the lawn mask, world/lane/real/grass.js groundMap: G the ground's height,
// B the road's wheel track, A where a lawn lies damp; uWearRect, uWearOrigin) and its own
// strengths (uWear: the dirt band, the streaks, the moss, the ground's own: setWear by kind):
// a dirt band at the foot of every wall and kerb (its height over the ground from the map, 40
// out along the wall; or exact from the worker's `wear` attribute on the houses' walls: how far
// under the sill or eave over it, how high over the ground, the streaks' length), rain streaks
// hanging from the sills and eaves (and faint ones anywhere), moss and algae on the faces
// turned up or away from the sun (the roofs' north slopes, the kerbs' tops, the walls' copings,
// the trunks' north sides), a greener tint in the streaks under a north eave; the asphalt's
// wheel track down the street's middle (darker, smoother); the lawns' slow change of colour
// (yellowed patches, darker damp ones by the hedges: the grass blades match, grassMaterial). All
// from world positions and the interpolated normal (the normal-mapped one made the streaks
// speckle). The low tier's is lite (the band and the ground's only: one noise).
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

// The sun's shadow near and far (SUN_SHADOW): the look's far map (haze.uFarShadow: the whole
// street, drawn once a build; RealLook.takeFar) where the near one (the sun's own, a tight box
// round the focus) ends, cross-faded over its outer 5 % on each side (10 % of the box).
// uFarShadowParams: (on, the depth bias, the map's size, the normal bias in world units).
const FAR_VERT = /* glsl */ `#include <shadowmap_vertex>
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vFarShadowCoord = uFarMatrix * (worldPosition + vec4(shadowWorldNormal * uFarShadowParams.w, 0.0));
  #endif`;
const FAR_PARS_VERT = /* glsl */ `#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  uniform mat4 uFarMatrix;
  uniform vec4 uFarShadowParams;
  varying vec4 vFarShadowCoord;
#endif
`;
const FAR_PARS_FRAG = /* glsl */ `#include <shadowmap_pars_fragment>
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    varying vec4 vFarShadowCoord;
    #if defined( SHADOWMAP_TYPE_PCF )
      uniform sampler2DShadow uFarShadow;
      uniform vec4 uFarShadowParams;
      float realSunShadow(float nearShadow, vec4 nearCoord, float intensity) {
        vec3 n = nearCoord.xyz / nearCoord.w;
        float k = smoothstep(0.0, 0.05, min(min(n.x, 1.0 - n.x), min(n.y, 1.0 - n.y)));
        if (k >= 1.0 || uFarShadowParams.x < 0.5) return nearShadow;
        float farShadow = getShadow(uFarShadow, vec2(uFarShadowParams.z), intensity, uFarShadowParams.y, 1.5, vFarShadowCoord);
        return mix(farShadow, nearShadow, k);
      }
    #else
      float realSunShadow(float nearShadow, vec4 nearCoord, float intensity) { return nearShadow; }
    #endif
  #endif`;
const SUN_CALL = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

export function sunShadowChunk(shader) {
  shader.vertexShader = FAR_PARS_VERT + shader.vertexShader.replace('#include <shadowmap_vertex>', FAR_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <shadowmap_pars_fragment>', FAR_PARS_FRAG)
    .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
    .replace(SUN_CALL, `realSunShadow( ${SUN_CALL}, vDirectionalShadowCoord[ i ], directionalLightShadow.shadowIntensity )`);
}

// The weathering's strengths per kind: (the dirt band, the streaks, the moss, the ground's own:
// the asphalt's wheel track over 0, the lawn's colour under 0).
export const WEAR_KIND = Object.freeze({
  boards: [0.55, 0.55, 0.05, 0],
  brick: [0.9, 0.45, 0.3, 0],
  render: [0.8, 0.7, 0.25, 0],
  blocks: [0.9, 0.5, 0.7, 0],
  roof: [0, 0.35, 0.9, 0],
  tiles: [0, 0.35, 0.9, 0],
  granite: [0.5, 0, 0.6, 0],
  cobbles: [0.4, 0, 0.8, 0],
  path: [0.3, 0, 0.6, 0],
  bark: [0, 0, 0.6, 0],
  birch: [0, 0, 0.35, 0],
  asphalt: [0, 0, 0, 1],
  patch: [0, 0, 0, 0.6],
  grass: [0, 0, 0, -1],
});

export function setWear(material, kind) {
  material.userData.wear?.value.fromArray(WEAR_KIND[kind] ?? [0, 0, 0, 0]);
}

// The noise the weathering draws with (the grass's blades share it, in their vertex shader).
const WEAR_NOISE = /* glsl */ `
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float wFbm(vec2 p) { return 0.5 * wNoise(p) + 0.3 * wNoise(p * 2.13 + 7.1) + 0.2 * wNoise(p * 4.37 + 3.3); }
// The lawn's colour at a world point: yellowed patches, darker damp ones (damp: the ground map's).
vec3 wLawn(vec2 p, float damp, float k) {
  float dry = smoothstep(0.52, 0.78, wFbm(p * 0.0011 + 3.1));
  float wet = clamp(damp + 0.6 * smoothstep(0.58, 0.85, wFbm(p * 0.0017 + 7.3)), 0.0, 1.0);
  return mix(vec3(1.0), vec3(1.22, 1.1, 0.6), 0.5 * dry * k) * mix(1.0, 0.76, wet * k);
}
`;
export const WEAR_GLSL = /* glsl */ `
uniform sampler2D uWearGround;
uniform vec4 uWearRect;
uniform vec3 uWearOrigin;
uniform vec4 uWear;
#ifdef WEAR_ATTR
  varying vec3 vWear;
#endif
${WEAR_NOISE}`;
const WEAR_FRAG = /* glsl */ `
  if (dot(abs(uWear), vec4(1.0)) > 0.0) {
    vec3 wp = vHazeWorld;
    vec3 wn = inverseTransformDirection(normalize(vNormal), viewMatrix);
    float wall = 1.0 - smoothstep(0.35, 0.7, abs(wn.y));
    vec2 lp = wp.xz - uWearOrigin.xz;
    vec4 gm = texture2D(uWearGround, (lp + normalize(wn.xz + 1e-4) * 40.0 * wall - uWearRect.xy) * uWearRect.zw);
    float hag = wp.y - (gm.g * 1020.0 + uWearOrigin.y);
    float below = 1e4;
    float slen = 1.0;
    #ifdef WEAR_ATTR
      if (vWear.z > 0.0) {
        below = vWear.x;
        hag = vWear.y;
        slen = vWear.z;
      }
    #endif
    float along = dot(wp.xz, normalize(vec2(-wn.z, wn.x) + 1e-5));
    float n1 = wNoise(vec2(along * 0.03, wp.y * 0.01));
    float band = (1.0 - smoothstep(0.0, 25.0 + 60.0 * n1, hag)) * wall * step(-30.0, hag);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.3, 0.27, 0.22), clamp(uWear.x * band, 0.0, 0.85));
    float wet = 0.0;
    #ifndef WEAR_LITE
      // Streaks: faint ones anywhere on a wall, strong drips hanging from a sill or an eave.
      float faint = smoothstep(0.5, 0.92, wFbm(vec2(along * 0.11, wp.y * 0.0018 + along * 0.0007))) * (0.5 + 0.5 * wNoise(vec2(along * 0.013, 3.7)));
      float drip = smoothstep(0.42, 0.85, wFbm(vec2(along * 0.13, wp.y * 0.0035))) * exp(-below / (220.0 * slen));
      float streak = max(faint * 0.35, drip) * wall;
      float away = smoothstep(0.25, -0.35, dot(wn, uSunDir));
      diffuseColor.rgb *= 1.0 - 0.45 * uWear.y * streak;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.68, 0.42), clamp(uWear.y * drip * away * wall, 0.0, 0.6));
      // Moss: on faces turned up and away from the sun, in patches.
      float up = smoothstep(0.25, 0.75, wn.y);
      float moss = smoothstep(0.5, 0.76, wFbm(wp.xz * 0.012 + wp.y * 0.003)) * (0.35 + up) * (0.45 + 0.9 * away) * (0.6 + 0.4 * wNoise(wp.xz * 0.21));
      // (Lighter than the dark tiles, darker than the white plinths: a yellow-green.)
      vec3 mossTint = vec3(0.1, 0.115, 0.032) * (0.7 + 0.6 * wNoise(wp.xz * 0.05 + 1.7));
      diffuseColor.rgb = mix(diffuseColor.rgb, mossTint, clamp(uWear.z * moss, 0.0, 0.75));
      roughnessFactor = min(1.0, roughnessFactor + 0.25 * (uWear.x * band + uWear.z * moss));
    #endif
    // The ground's own: the asphalt's wheel track (uWear.w over 0: gm.b, darker and smoother),
    // the lawn's colour (under 0: gm.a, where it lies damp).
    float track = gm.b * max(uWear.w, 0.0) * (1.0 - wall);
    diffuseColor.rgb *= 1.0 - 0.2 * track;
    roughnessFactor *= 1.0 - 0.35 * track;
    if (uWear.w < 0.0) diffuseColor.rgb *= wLawn(wp.xz, gm.a, -uWear.w);
  }
`;
const WEAR_VERT = /* glsl */ `#include <begin_vertex>
  vWear = wear;`;

// The WEAR patch into a standard material's shader (attr: its geometry's `wear` attribute;
// lite: the band and the ground's only).
function wearChunk(shader, uniform, { attr = false, lite = false }) {
  shader.uniforms.uWear = uniform;
  const defines = (attr ? '#define WEAR_ATTR\n' : '') + (lite ? '#define WEAR_LITE\n' : '');
  if (attr) shader.vertexShader = 'attribute vec3 wear;\nvarying vec3 vWear;\n' + shader.vertexShader.replace('#include <begin_vertex>', WEAR_VERT);
  shader.fragmentShader = defines + WEAR_GLSL + shader.fragmentShader.replace('#include <lights_physical_fragment>', WEAR_FRAG + '#include <lights_physical_fragment>');
}

export function hazeChunk(material, haze, key = 'real-haze', patch = null, wear = null) {
  material.fog = false; // (the haze is the fog)
  const far = !!haze.uFarShadow;
  const worn = !!(wear && haze.uWearGround);
  if (worn) material.userData.wear = { value: new THREE.Vector4() };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, haze);
    shader.vertexShader = 'varying vec3 vHazeWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', HAZE_VERT);
    shader.fragmentShader = 'varying vec3 vHazeWorld;\nuniform float uHazeDensity;\n' + SKY_GLSL + shader.fragmentShader.replace('#include <fog_fragment>', HAZE_FRAG);
    patch?.(shader);
    if (worn) wearChunk(shader, material.userData.wear, wear);
    if (far) sunShadowChunk(shader);
  };
  const k = worn ? `${key}-wear${wear.attr ? '-wa' : ''}${wear.lite ? '-wl' : ''}` : key;
  material.customProgramCacheKey = () => (far ? `${k}-far` : k);
  return material;
}

const repeated = (texture, repeat) => {
  const t = texture.clone();
  t.repeat.set(repeat, repeat);
  return t;
};

export function pbrMaterial(maps, { repeat = 1, color = 0xffffff, roughness = 1, normalScale = 1, side = THREE.FrontSide, vertexColors = true, wear = {} } = {}, haze) {
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
  return hazeChunk(material, haze, 'real-haze', null, wear);
}

export function plainMaterial({ color = 0xffffff, roughness = 0.5, metalness = 0, side = THREE.FrontSide, vertexColors = true, envMapIntensity = 1, clearcoat = null, emissive = 0 } = {}, haze) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, vertexColors, envMapIntensity });
  // (emissive: a white glow of that strength over the lit colour: lights)
  if (emissive) material.emissive.setScalar(1).multiplyScalar(emissive);
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
  {
    // A card seen from behind its bent normal (the canopy's far side, against the light) shows
    // light passed through the leaves, not a reflection: no sheen there (at that grazing angle
    // the sky's reflection would bleach it white); elsewhere a leaf's sheen is soft.
    float sheen = 0.6 * smoothstep(-0.15, 0.35, dot(normal, geometryViewDir));
    reflectedLight.directSpecular *= sheen;
    reflectedLight.indirectSpecular *= sheen;
  }
  #if NUM_DIR_LIGHTS > 0
    {
      float back = pow(clamp(dot(-geometryViewDir, foliageSun.direction), 0.0, 1.0), 3.0);
      float through = clamp(dot(-normal, foliageSun.direction), 0.0, 1.0);
      reflectedLight.directDiffuse += foliageSun.color * diffuseColor.rgb * diffuseColor.rgb * 4.0 * uTranslucency * (0.35 * through + back);
    }
  #endif`;

// The lights' loop, keeping the first directional light as it was lit (its shadow in its colour:
// the sun, shadow casters coming first) for the light through the leaves (after the loop
// directLight is the last one's: the storm's key light, dark in the sun).
const DIR_LOOP = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const FOLIAGE_LIGHTS = (() => {
  const c = THREE.ShaderChunk.lights_fragment_begin;
  const at = c.indexOf(DIR_LOOP);
  const call = c.indexOf('RE_Direct(', at);
  const end = c.indexOf(';', call) + 1;
  return 'IncidentLight foliageSun;\n' + c.slice(0, end) + '\n#if UNROLLED_LOOP_INDEX == 0\nfoliageSun = directLight;\n#endif' + c.slice(end);
})();

export function foliageMaterial(map, { roughness = 0.6, translucency = 0.6, coverage = false, envMapIntensity = 0.7, wind }, haze) {
  const material = new THREE.MeshStandardMaterial({ map, roughness, metalness: 0, vertexColors: true, side: THREE.DoubleSide, envMapIntensity, alphaTest: 0.5, alphaToCoverage: coverage });
  return hazeChunk(material, haze, 'real-foliage', (shader) => {
    shader.uniforms.uWind = wind;
    shader.uniforms.uTranslucency = { value: translucency };
    shader.vertexShader = 'attribute float sway;\nuniform vec4 uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', FOLIAGE_VERT);
    shader.fragmentShader = 'uniform float uTranslucency;\n' + shader.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_begin>', FOLIAGE_LIGHTS)
      .replace('#include <lights_fragment_end>', FOLIAGE_FRAG);
  });
}

const GRASS_COLOR = /* glsl */ `#include <color_vertex>
  vec2 grassAt = uGrid.xy + cell * uGrid.z;
  vec2 grassHash = fract(sin(vec2(dot(grassAt / uGrid.z, vec2(12.9898, 78.233)), dot(grassAt / uGrid.z, vec2(39.3468, 11.135)))) * 43758.5453);
  grassAt += grassHash * uGrid.z;
  vec4 grassLawn = texture2D(uLawn, (grassAt - uLawnRect.xy) * uLawnRect.zw);
  float grassSize = grassLawn.r * (1.0 - smoothstep(uGrid.w * 0.7, uGrid.w, distance(grassAt, uGridMiddle)));
  vColor.rgb *= mix(vec3(0.9, 0.92, 0.85), vec3(1.25, 1.2, 1.05), grassHash.y);
  vColor.rgb *= wLawn((modelMatrix * vec4(grassAt.x, 0.0, grassAt.y, 1.0)).xz, grassLawn.a, 1.0); // (the lawn's own colour under it)`;

const GRASS_VERT = /* glsl */ `#include <begin_vertex>
  {
    float turn = grassHash.x * 6.2832;
    transformed.xz = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * transformed.xz;
    // (Longer where the lawn lies damp by the hedges and in unmown patches.)
    float grassLong = 1.0 + 0.5 * grassLawn.a + 0.4 * smoothstep(0.55, 0.8, wFbm(grassAt * 0.0016 + 5.3));
    transformed *= grassSize * vec3(1.0, (0.7 + 0.6 * grassHash.y) * grassLong, 1.0);
    float swayPhase = uWind.z * 1.3 + dot(grassAt, vec2(0.004, 0.003));
    transformed.xz += uWind.xy * sway * 2.5 * grassSize * (0.6 * sin(swayPhase) + 0.4 * sin(2.7 * swayPhase));
    transformed.xz += grassAt;
    transformed.y += grassLawn.g * 1020.0;
  }`;

export function grassMaterial({ lawn, rect, grid, middle, wind }, haze) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  return hazeChunk(material, haze, 'real-grass', (shader) => {
    Object.assign(shader.uniforms, { uLawn: { value: lawn }, uLawnRect: { value: rect }, uGrid: grid, uGridMiddle: middle, uWind: wind });
    shader.vertexShader = 'attribute vec2 cell;\nattribute float sway;\nuniform sampler2D uLawn;\nuniform vec4 uLawnRect, uGrid, uWind;\nuniform vec2 uGridMiddle;\n' + WEAR_NOISE + shader.vertexShader.replace('#include <color_vertex>', GRASS_COLOR).replace('#include <begin_vertex>', GRASS_VERT);
  });
}

export function shadowCaster() {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
}

export function contactMaterial() {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
    fog: false,
  });
  // (A factor, not a colour: never encoded for the screen.)
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', '');
  };
  material.customProgramCacheKey = () => 'real-contact';
  return material;
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

// ...and the colour its grade (OutputPass.js GRADE_GLSL, its uniforms the pass's own) turns into
// c: the vignette (at this pixel: uGradeScreen, the drawing buffer's size), the black level,
// the saturation (a vibrance, luma kept: its strength from the colour before it, found in three
// rounds) undone; the split toning's tints (from the luma before them, found in two rounds) and
// the S-contrast (Newton, per channel) after them. (And before the
// tone mapping, the bloom's mix: uBloom of the picture is the glow's, ~nothing at a sign.)
const UNGRADE_GLSL = /* glsl */ `
uniform float uContrast;
uniform float uSplit;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSaturation;
uniform float uBlack;
uniform float uVignette;
uniform vec2 uGradeScreen;
uniform float uBloom;
vec3 unsCurve(vec3 y) {
  vec3 x = y;
  for (int i = 0; i < 4; i++) {
    vec3 f = x + uContrast * (x * x * (3.0 - 2.0 * x) - x) - y;
    x = clamp(x - f / (1.0 + uContrast * (6.0 * x - 6.0 * x * x - 1.0)), 0.0, 1.0);
  }
  return x;
}
vec3 ungrade(vec3 c) {
  vec2 d = gl_FragCoord.xy / uGradeScreen - 0.5;
  c /= max(1.0 - uVignette * dot(d, d) * 2.0, 1e-3);
  c = (c - uBlack) / (1.0 - uBlack);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 y = c;
  for (int i = 0; i < 3; i++) {
    float m = max(c.r, max(c.g, c.b));
    float s = m > 1e-4 ? (m - min(c.r, min(c.g, c.b))) / m : 0.0;
    c = l + (y - l) / mix(uSaturation, 1.0, s * s);
  }
  vec3 x = c;
  for (int i = 0; i < 2; i++) {
    float l0 = dot(x, vec3(0.2126, 0.7152, 0.0722));
    x = unsCurve(c / (mix(vec3(1.0), uShadowTint, uSplit * (1.0 - l0) * (1.0 - l0)) * mix(vec3(1.0), uHighTint, uSplit * l0 * l0)));
  }
  return x;
}
`;

// (grade: the output pass's uniforms, OutputPass.grade, with uGradeScreen: what it grades with.)
export function classicLook(material, { exposure, direct = false, grade = null }) {
  if (direct) {
    material.toneMapped = false;
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uExposure = { value: exposure };
    const back = grade ? 'untoneNeutral(ungrade(gl_FragColor.rgb)) / (1.0 - uBloom)' : 'untoneNeutral(gl_FragColor.rgb)';
    if (grade) Object.assign(shader.uniforms, grade);
    shader.fragmentShader = UNTONE_GLSL + (grade ? UNGRADE_GLSL : '') + shader.fragmentShader.replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = ${back};\n#include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => (grade ? 'real-classic-graded' : 'real-classic');
  return material;
}
