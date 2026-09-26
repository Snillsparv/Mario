// Classic N64-style skybox: a big camera-centred sphere textured with a procedurally painted,
// seamless 360-degree panorama - a saturated blue gradient (deep overhead, pale at the
// horizon), big fluffy cumulus banks with soft grey undersides around the horizon band,
// smaller puffs and thin wisps higher up, and a hazy band of distant hills. The sphere
// follows the camera every frame (so it never gets closer) and drifts very slowly.
//
// Drawn first and behind everything: renderOrder -1, depthWrite false, fog false.
//
// AI RACE mode (setDarkness(t)): the dome crossfades to a storm: a low, heavy, churning deck
// of dark slate / purple-grey cloud masses receding in perspective to the horizon, lit tops
// and dark bellies, patches of sickly green light low on the horizon, no blue, rolling by
// much faster. The deck is two layers of one small tileable density map (paintStorm) projected
// onto a plane overhead (view direction xz / y), scrolling past each other, mixed in the
// dome's shader by uniforms (no recompile, no second mesh). The dome's material is a
// SkyMaterial, so the underwater tinted copy the renderer makes (material.clone() plus its own
// onBeforeCompile) keeps the storm.
//
// AI RACE's meltdown (setMeltdown(levels), fx/Meltdown.js), in the same shader by uniforms:
// the warning glows red-orange up from the horizon and blushes the storm deck from below; the
// fire turns the dome into roiling flames (procedural 3D value-noise fbm scrolling up: licking
// tongues that are white-hot at the horizon, orange, then deep red, under a burning cloud deck
// overhead), spreading up from the horizon as it catches; the light's bloom (a hot core, a wide
// glow round the fireball's direction) and the white-out wash the whole sky white.

import * as THREE from 'three';
import { HAS_CANVAS, canvasTexture, hexToRgb, mixRgb, tileableFbm } from '../render/texgen.js';
import { clamp, makeRng, smoothstep } from '../core/math.js';

// Fog should use this so distant terrain melts into the bottom of the sky.
export const SKY_HORIZON_COLOR = 0xa9caee;
// The storm sky's horizon haze (sRGB): the storm fog should use this (AI RACE mode).
export const SKY_STORM_HORIZON_COLOR = 0x2a323c; // = the renderer's STORM_FOG colour (render/post/storm.js)

const RADIUS = 20000; // inside the camera far plane (~45000)
const DRIFT = 0.0035; // radians per second
// Panorama: 1024 x 256 px covering all longitudes and latitudes LAT_MIN..LAT_MAX (degrees):
// under 3 texels per degree, so bilinear filtering keeps the clouds soft, era-style.
const TEX_W = 1024;
const TEX_H = 256;
const LAT_MIN = -10;
const LAT_MAX = 90;
// Storm density map (tiles both ways over the cloud deck), the deck's scale (map repeats per
// unit of view direction xz / y) and its layers' scroll velocities (repeats per second).
const STORM_SIZE = 256;
const STORM_SCALE = 0.2;
const STORM_WIND = [
  [0.011, 0.006],
  [-0.004, 0.017],
];

// Vertical gradient stops [latitude (deg), colour].
const GRADIENT = [
  [-10, 0xb4d2f0],
  [0, SKY_HORIZON_COLOR],
  [5, 0x98c0f0],
  [14, 0x78aaee],
  [28, 0x5892e8],
  [48, 0x3c78e0],
  [70, 0x2c66da],
  [90, 0x265ed6],
].map(([lat, hex]) => [lat, hexToRgb(hex)]);

export function buildSky() {
  const geo = new THREE.SphereGeometry(RADIUS, 48, 32);
  // Re-map v from the sphere's latitude to the panorama's LAT_MIN..LAT_MAX range (below
  // LAT_MIN the bottom row - pale haze - is stretched down to the nadir).
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const lat = (Math.asin(clamp(pos.getY(i) / RADIUS, -1, 1)) * 180) / Math.PI;
    uv.setY(i, clamp((lat - LAT_MIN) / (LAT_MAX - LAT_MIN), 0, 1));
  }

  const map = canvasTexture(TEX_W, TEX_H, paintPanorama);
  map.wrapT = THREE.ClampToEdgeWrapping; // wraps around horizontally only
  const stormMap = canvasTexture(STORM_SIZE, STORM_SIZE, paintStorm);
  stormMap.colorSpace = THREE.NoColorSpace; // densities, not colours
  const storm = {
    stormT: { value: 0 },
    stormScroll: { value: new THREE.Vector4(0, 0, 0, 0) },
    stormTime: { value: 0 },
    stormMap: { value: stormMap },
    stormHorizon: { value: new THREE.Color(SKY_STORM_HORIZON_COLOR) },
    // The meltdown (setMeltdown): warning glow, fire, the light's bloom and the white-out.
    meltWarn: { value: 0 },
    meltFire: { value: 0 },
    meltGlare: { value: 0 },
    meltWhite: { value: 0 },
    meltDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    meltTime: { value: 0 },
  };
  const light = { lit: false, x: 0, y: 0, z: 0 }; // the fireball's place while it shows
  const mat = new SkyMaterial({ map, side: THREE.BackSide, depthWrite: false, fog: false }, storm);
  if (!HAS_CANVAS) mat.color.setHex(SKY_HORIZON_COLOR); // node: no panorama was painted

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyDome';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'sky';
  group.add(mesh);
  // The horizon colour doubles as the clear colour of the scene the sky is added to.
  group.addEventListener('added', () => {
    if (group.parent?.isScene) group.parent.background = new THREE.Color(SKY_HORIZON_COLOR);
  });

  const camPos = new THREE.Vector3();
  let last = null;
  return {
    object3D: group,
    colliders: [],
    update(time, camera) {
      if (camera) group.position.copy(camera.getWorldPosition(camPos));
      mesh.rotation.y = time * DRIFT;
      // The storm layers scroll on while it shows (by game time: they freeze with the pause).
      const dt = last === null || time < last || time - last > 1 ? 0 : time - last;
      last = time;
      const k = storm.stormT.value;
      if (k > 0) {
        const sc = storm.stormScroll.value;
        const f = dt * (0.3 + 0.7 * k);
        sc.set((sc.x + f * STORM_WIND[0][0]) % 1, (sc.y + f * STORM_WIND[0][1]) % 1, (sc.z + f * STORM_WIND[1][0]) % 1, (sc.w + f * STORM_WIND[1][1]) % 1);
      }
      storm.stormTime.value = time;
      // The light's bloom looks toward the fireball from wherever the camera is now.
      if (light.lit && storm.meltGlare.value > 0) {
        const d = storm.meltDir.value.set(light.x - group.position.x, light.y - group.position.y, light.z - group.position.z);
        if (d.lengthSq() > 0) d.normalize();
      }
    },
    setDarkness(t) {
      const k = clamp(t, 0, 1);
      storm.stormT.value = k * k * (3 - 2 * k);
    },
    setMeltdown(levels) {
      storm.meltWarn.value = clamp(levels?.warn || 0, 0, 1);
      storm.meltFire.value = clamp(levels?.fire || 0, 0, 1);
      storm.meltGlare.value = clamp(levels?.glare || 0, 0, 1);
      storm.meltWhite.value = clamp(levels?.white || 0, 0, 1);
      storm.meltTime.value = levels?.seconds || 0;
      light.lit = !!levels?.lit;
      if (light.lit) {
        light.x = levels.lx;
        light.y = levels.ly;
        light.z = levels.lz;
      }
    },
  };
}

// The dome's material: a MeshBasicMaterial whose shader always mixes in the storm by its
// uniforms (`storm`, shared with every clone). A clone gets the storm patch too, and an
// onBeforeCompile assigned to it (the renderer's underwater tint) runs after the patch.
export class SkyMaterial extends THREE.MeshBasicMaterial {
  constructor(params, storm) {
    super(params);
    this.storm = storm;
    this.extraCompile = null;
    this.customProgramCacheKey = () => 'sky-storm';
  }

  get onBeforeCompile() {
    return (shader, renderer) => {
      if (this.storm) patchStorm(shader, this.storm);
      this.extraCompile?.(shader, renderer);
    };
  }

  set onBeforeCompile(fn) {
    this.extraCompile = fn;
  }

  copy(source) {
    super.copy(source);
    this.storm = source.storm;
    return this;
  }
}

function patchStorm(shader, storm) {
  Object.assign(shader.uniforms, storm);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSkyDir;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkyDir = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float stormT;
uniform vec4 stormScroll;
uniform float stormTime;
uniform sampler2D stormMap;
uniform vec3 stormHorizon;
uniform float meltWarn;
uniform float meltFire;
uniform float meltGlare;
uniform float meltWhite;
uniform vec3 meltDir;
uniform float meltTime;
varying vec3 vSkyDir;
${MELT_SKY_GLSL}`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
if (stormT > 0.0) {
  vec3 dir = normalize(vSkyDir);
  float up = max(dir.y, 0.0);
  // The cloud deck: a plane overhead, seen in perspective (mipmaps blur it to haze far off).
  vec2 deck = dir.xz / (up + 0.035) * ${STORM_SCALE.toFixed(3)};
  // Two layers of cloud masses rolling past each other, the second warped by the first.
  vec3 a = texture2D(stormMap, deck + stormScroll.xy).rgb;
  vec3 b = texture2D(stormMap, deck * 1.61 + stormScroll.zw + (a.rg - 0.5) * 0.12).rgb;
  float low = 1.0 - smoothstep(0.0, 0.5, up); // heavier toward the horizon
  float dens = clamp(a.r * (0.8 + 0.3 * low) + 0.35 * b.r * (0.3 + 0.7 * a.r) + 0.3 * low - 0.12, 0.0, 1.0);
  // Gaps: deep slate; masses: purple-grey, lit on their tops, dark in their bellies.
  float lit = clamp((a.g - 0.5) * 4.0, 0.0, 1.0);
  float belly = clamp((0.5 - a.g) * 4.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.02, 0.021, 0.03), vec3(0.075, 0.068, 0.098), dens);
  col = mix(col, vec3(0.18, 0.167, 0.23), lit * dens * 0.7);
  col = mix(col, vec3(0.012, 0.012, 0.018), belly * dens * 0.6);
  col += vec3(0.022, 0.02, 0.03) * b.b * dens; // billows
  col *= 1.0 - 0.3 * smoothstep(0.5, 1.0, up); // darker overhead
  // Patches of sickly green light low on the horizon, showing through the gaps, breathing.
  float lon = atan(dir.x, dir.z);
  float patches = smoothstep(0.45, 0.95, (0.5 + 0.5 * sin(lon * 3.0 + 1.3)) * (0.55 + 0.45 * sin(lon * 7.0 - 0.7 + stormScroll.x * 6.2832)));
  float greenBand = (1.0 - smoothstep(0.05, 0.2, up)) * smoothstep(0.0, 0.04, up);
  float breathe = 0.75 + 0.25 * sin(stormTime * 0.9 + lon * 4.0);
  col = mix(col, vec3(0.07, 0.13, 0.03), greenBand * patches * breathe * (1.0 - 0.6 * dens));
  // Haze at the very bottom melts into the storm fog.
  col = mix(col, stormHorizon, 1.0 - smoothstep(0.0, 0.07, dir.y));
  // Crossfade in a perceptual (gamma 2) space, like the world materials (darkGrade.js).
  vec3 sm = mix(sqrt(max(diffuseColor.rgb, 0.0)), sqrt(col), stormT);
  diffuseColor.rgb = sm * sm;
}
if (meltWarn > 0.0 || meltFire > 0.0 || meltGlare > 0.0 || meltWhite > 0.0) {
  diffuseColor.rgb = meltSky(diffuseColor.rgb, normalize(vSkyDir));
}`,
    );
}

// The meltdown's sky (see the header): meltSky(colour, view direction) -> colour, linear.
const MELT_SKY_GLSL = /* glsl */ `
float meltHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float meltNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(meltHash(i), meltHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(meltHash(i + vec3(0.0, 1.0, 0.0)), meltHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(meltHash(i + vec3(0.0, 0.0, 1.0)), meltHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(meltHash(i + vec3(0.0, 1.0, 1.0)), meltHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float meltFbm(vec3 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    s += a * meltNoise(p);
    p = p * 2.03 + vec3(1.7, -0.3, 2.9);
    a *= 0.5;
  }
  return s;
}
// Heat 0..1+ to fire colour (linear): smoke-dark red, deep red, orange, yellow, white-hot.
vec3 meltPalette(float h) {
  vec3 c = vec3(0.045, 0.006, 0.003);
  c = mix(c, vec3(0.42, 0.035, 0.008), smoothstep(0.1, 0.32, h));
  c = mix(c, vec3(1.0, 0.26, 0.025), smoothstep(0.34, 0.55, h));
  c = mix(c, vec3(1.0, 0.62, 0.12), smoothstep(0.55, 0.78, h));
  c = mix(c, vec3(1.0, 0.93, 0.7), smoothstep(0.8, 1.05, h));
  return c;
}
vec3 meltSky(vec3 col, vec3 dir) {
  float up = max(dir.y, 0.0);
  float mt = meltTime;
  if (meltWarn > 0.0) {
    // The sky overheating: a red-orange glow rising from the horizon (reaching higher as it
    // grows), throbbing with the klaxon, and the storm deck blushing from below.
    float lon = atan(dir.x, dir.z);
    float reach = 0.12 + 0.5 * meltWarn;
    float band = 1.0 - smoothstep(-0.02, reach, up + 0.03 * sin(lon * 5.0 + mt * 0.7) + 0.02 * sin(lon * 11.0 - mt * 1.3));
    float throb = 0.85 + 0.15 * sin(mt * 4.19);
    vec3 glow = mix(vec3(0.55, 0.035, 0.01), vec3(1.8, 0.4, 0.05), band * band);
    col = mix(col, glow, clamp(band * (0.35 + 0.65 * meltWarn) * 1.2, 0.0, 1.0) * throb);
    float low = 1.0 - up;
    col += vec3(0.45, 0.06, 0.0) * meltWarn * low * low * 0.6;
  }
  if (meltFire > 0.0) {
    // Licking tongues: noise stretched upright and scrolling up fast, swayed sideways by a
    // slower field, rising from a white-hot horizon; overhead, churning smoke lit by bright
    // veins of fire (ridged noise). The fire sweeps up from the horizon as it catches.
    float h = clamp(up / 0.6, 0.0, 1.0);
    float sway = meltFbm(vec3(dir.x * 2.0, dir.y * 1.2 - mt * 0.3, dir.z * 2.0), 2) - 0.47;
    vec3 p = vec3(dir.x * 7.0 + sway * 2.4, dir.y * 2.6 - mt * 1.3, dir.z * 7.0 - sway * 2.4);
    float n = (meltFbm(p, 4) - 0.47) * 4.0;
    float tongues = 0.95 - h * 1.55 + n * 0.3;
    vec2 deckUv = dir.xz / (up + 0.25);
    float d1 = meltFbm(vec3(deckUv * 1.2 + vec2(mt * 0.11, -mt * 0.07), mt * 0.16 + sway), 3);
    float ridge = 1.0 - abs(d1 * 2.1 - 1.0);
    float deck = 0.1 + 0.25 * d1 + 0.7 * pow(max(ridge, 0.0), 6.0);
    float heat = max(tongues, deck * (0.6 + 0.4 * (1.0 - h)));
    heat += (1.0 - smoothstep(0.0, 0.07, up)) * 0.4;
    float front = meltFire * 1.35 - h + n * 0.08;
    col = mix(col, meltPalette(heat), smoothstep(0.0, 0.2, front));
  }
  if (meltGlare > 0.0) {
    float d = max(dot(dir, meltDir), 0.0);
    col += vec3(1.0, 0.95, 0.85) * meltGlare * (pow(d, 600.0) * 6.0 + pow(d, 60.0) * 0.7 + pow(d, 8.0) * 0.3);
  }
  if (meltWhite > 0.0) col = mix(col, vec3(1.0), clamp(meltWhite * 1.4, 0.0, 1.0));
  return col;
}
`;

// ---------------------------------------------------------------- panorama painting

// Degrees <-> pixels. Longitudes wrap; clouds are authored in degrees.
const PX_PER_LON = TEX_W / 360;
const PX_PER_LAT = TEX_H / (LAT_MAX - LAT_MIN);
const latOfRow = (y) => LAT_MAX - ((y + 0.5) / TEX_H) * (LAT_MAX - LAT_MIN);
const wrapLon = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function gradientAt(lat) {
  for (let i = 1; i < GRADIENT.length; i++) {
    if (lat <= GRADIENT[i][0]) {
      const [l0, c0] = GRADIENT[i - 1];
      const [l1, c1] = GRADIENT[i];
      return mixRgb(c0, c1, clamp((lat - l0) / (l1 - l0), 0, 1));
    }
  }
  return GRADIENT[GRADIENT.length - 1][1];
}

// 1D periodic value noise over longitude (for the hills silhouette).
function periodicNoise(cells, seed) {
  const rng = makeRng(seed);
  const v = Array.from({ length: cells }, () => rng());
  return (lon) => {
    const f = (((lon / 360) * cells) % cells + cells) % cells;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return v[i] + (v[(i + 1) % cells] - v[i]) * s;
  };
}

// A cumulus: puffs { x (deg from the cloud centre), y (lat), r } packed into a dome over a
// flat base - a row along the base, a body biased toward the dome's surface, and a few bigger
// towers on top. Puffs are a few texels across at the panorama's resolution, so the lumpy
// outline stays bold after filtering.
const PUFF = 1.3; // puff size scale
function makeCumulus(rng, lon, base, width, height) {
  const puffs = [];
  const k = Math.max(3, Math.round(width / (2.4 * PUFF)));
  for (let j = 0; j < k; j++) {
    const x = -width / 2 + ((j + 0.5) * width) / k + (rng() - 0.5) * 1.2;
    const r = (1.5 + rng() * 1.1) * PUFF;
    puffs.push({ x, y: base + r * 0.5, r });
  }
  const dome = (x) => Math.sqrt(Math.max(0, 1 - ((2 * x) / width) ** 2));
  const m = Math.max(4, Math.round((width * height) / (7 * PUFF * PUFF)));
  for (let j = 0; j < m; j++) {
    const x = (rng() - 0.5) * width * 0.86;
    const p = dome(x);
    const surface = base + height * p * (0.75 + 0.25 * rng());
    const r = (1.4 + 2.4 * p * (0.5 + 0.5 * rng())) * PUFF;
    puffs.push({ x, y: base + 1 + Math.max(0, surface - base - 1 - r * 0.6) * Math.sqrt(rng()), r });
  }
  for (let j = 0; j < 1 + Math.floor(rng() * 3); j++) {
    const x = (rng() - 0.5) * width * 0.4;
    const r = (2.6 + rng() * 1.8) * PUFF;
    puffs.push({ x, y: base + height * dome(x) * 0.9 - r * 0.5, r });
  }
  const top = Math.max(...puffs.map((p) => p.y + p.r));
  return { lon, base, top, puffs };
}

// Thin horizontal wisp: a chain of elongated soft blobs. Widths are in true degrees, so
// they are stretched in longitude by 1 / cos(lat) to look right on the sphere.
function makeWisp(rng, lon, lat, length) {
  const stretch = 1 / Math.cos((lat * Math.PI) / 180);
  const n = 4 + Math.floor(rng() * 4);
  const blobs = Array.from({ length: n }, (_, j) => ({
    x: ((j / (n - 1) - 0.5) * length + (rng() - 0.5) * 3) * stretch,
    y: lat + (rng() - 0.5) * 1.6 + Math.sin(j) * 0.6,
    sx: (length / n) * (0.7 + rng() * 0.6) * stretch,
    sy: 0.7 + rng() * 0.9,
    a: 0.35 + rng() * 0.3,
  }));
  return { lon, blobs };
}

function paintPanorama(ctx, w, h) {
  const rng = makeRng(20260923);
  const buf = new Float32Array(w * h * 3);

  // Sky gradient + hazy distant hills just at the horizon.
  const hills = periodicNoise(24, 77);
  const hillsFine = periodicNoise(90, 78);
  const horizon = hexToRgb(SKY_HORIZON_COLOR);
  const hillFar = mixRgb(horizon, [104, 150, 150], 0.45);
  for (let y = 0; y < h; y++) {
    const lat = latOfRow(y);
    const sky = gradientAt(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x + 0.5) / PX_PER_LON;
      const ridge = 0.6 + 2.8 * hills(lon) + 0.6 * hillsFine(lon);
      let c = sky;
      if (lat < ridge) c = mixRgb(hillFar, horizon, clamp(0.25 + (ridge - lat) / 6, 0, 0.85));
      buf.set(c, (y * w + x) * 3);
    }
  }

  // Clouds, far (low) to near (high).
  // Big banks low around the horizon (their tops clear the cliffs), smaller puffs higher.
  const clouds = [];
  const bankCount = 12;
  for (let i = 0; i < bankCount; i++) {
    const lon = (i / bankCount) * 360 + (rng() - 0.5) * 16;
    clouds.push(makeCumulus(rng, lon, 6 + rng() * 8, 18 + rng() * 16, 8 + rng() * 8));
  }
  for (let i = 0; i < 10; i++) {
    clouds.push(makeCumulus(rng, rng() * 360, 18 + rng() * 14, 7 + rng() * 7, 3 + rng() * 3));
  }
  clouds.sort((a, b) => a.base - b.base);
  for (const c of clouds) paintCumulus(buf, w, h, c);
  // Wisps stay short and below ~50 degrees: long ones up high would follow the latitude
  // lines and curl around the zenith.
  for (let i = 0; i < 12; i++) paintWisp(buf, w, h, makeWisp(rng, rng() * 360, 28 + rng() * 20, 8 + rng() * 14));

  // Horizon haze over everything low.
  for (let y = 0; y < h; y++) {
    const lat = latOfRow(y);
    const haze = 0.55 * (1 - smoothstep(-1, 12, lat));
    if (haze <= 0) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      buf.set(mixRgb([buf[i], buf[i + 1], buf[i + 2]], horizon, haze), i);
    }
  }

  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < buf.length; i += 3, j += 4) {
    img.data[j] = buf[i];
    img.data[j + 1] = buf[i + 1];
    img.data[j + 2] = buf[i + 2];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Storm density map, tiling both ways: r = heavy cloud masses, g = their relief (lit from
// the sun side: > 0.5 on the lit side, < 0.5 in the bellies), b = finer billows (ridged
// noise).
function paintStorm(ctx, w, h) {
  const big = tileableFbm(w, h, 4, 4, 4401);
  const fine = tileableFbm(w, h, 8, 3, 5503);
  const A = (x, y) => smoothstep(0.3, 0.72, big(x, y));
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const shift = 5; // pixels toward the light for the relief
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = A(x, y);
      const toward = A((x + shift) % w, (y + shift) % h);
      const ridge = 1 - Math.abs(2 * fine(x, y) - 1);
      const i = (y * w + x) * 4;
      d[i] = clamp(255 * a, 0, 255);
      d[i + 1] = clamp(128 + 300 * (a - toward), 0, 255);
      d[i + 2] = clamp(255 * smoothstep(0.45, 0.95, ridge), 0, 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Visits every pixel of a lon/lat box (longitude wrapping): fn(index, dLon, lat).
function forBox(w, h, lon0, lon1, lat0, lat1, centreLon, fn) {
  const y0 = clamp(Math.floor((LAT_MAX - lat1) * PX_PER_LAT), 0, h - 1);
  const y1 = clamp(Math.ceil((LAT_MAX - lat0) * PX_PER_LAT), 0, h - 1);
  const x0 = Math.floor(lon0 * PX_PER_LON);
  const x1 = Math.ceil(lon1 * PX_PER_LON);
  for (let y = y0; y <= y1; y++) {
    const lat = latOfRow(y);
    for (let xr = x0; xr <= x1; xr++) {
      const x = ((xr % w) + w) % w;
      fn((y * w + x) * 3, wrapLon((x + 0.5) / PX_PER_LON - centreLon), lat);
    }
  }
}

const CLOUD_LIGHT = (() => {
  const l = Math.hypot(0.3, 0.85, 0.45);
  return [0.3 / l, 0.85 / l, 0.45 / l];
})();
const CLOUD_LIT = [255, 255, 255];
const CLOUD_SHADE = [182, 196, 222];
const PUFF_BLEND = 0.7; // soft-max width (degrees) blending neighbouring puffs' normals

// Cumulus shading: the puffs are spheres; each pixel's normal is a soft-max blend of the
// normals of the puffs covering it (weighted toward the one bulging furthest out), lit from
// above, with faint creases between puffs. The lower part and flat base are shaded
// grey-blue and the outline is soft.
function paintCumulus(buf, w, h, cloud) {
  const { puffs, base, top, lon } = cloud;
  const minX = Math.min(...puffs.map((p) => p.x - p.r)) - 1;
  const maxX = Math.max(...puffs.map((p) => p.x + p.r)) + 1;
  const L = CLOUD_LIGHT;
  forBox(w, h, lon + minX, lon + maxX, base - 1, top + 1, lon, (i, dx, lat) => {
    let sd = Infinity;
    let best = -Infinity;
    let second = -Infinity;
    let wsum = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const p of puffs) {
      const px = dx - p.x;
      const py = lat - p.y;
      const d = Math.hypot(px, py);
      sd = Math.min(sd, d - p.r);
      if (d >= p.r) continue;
      const hz = Math.sqrt(p.r * p.r - d * d);
      const wgt = Math.exp(hz / PUFF_BLEND);
      wsum += wgt;
      nx += (wgt * px) / p.r;
      ny += (wgt * py) / p.r;
      nz += (wgt * hz) / p.r;
      if (hz > best) {
        second = best;
        best = hz;
      } else if (hz > second) second = hz;
    }
    let a = smoothstep(0.7, -0.5, sd) * smoothstep(base - 0.3, base + 1, lat); // soft edge, flat base
    if (a <= 0) return;
    let lit = 0.35; // outermost fringe, outside every puff
    if (wsum > 0) {
      const l = Math.hypot(nx, ny, nz);
      lit = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / l);
      if (second > -Infinity) lit *= 0.88 + 0.12 * smoothstep(0, 0.8, best - second);
    }
    const up = smoothstep(base, base + (top - base) * 0.7, lat); // grey belly near the base
    const t = clamp((0.3 + 0.8 * lit) * (0.6 + 0.4 * up), 0, 1);
    const c = mixRgb(CLOUD_SHADE, CLOUD_LIT, t);
    a *= 0.9 + 0.1 * up;
    buf[i] += (c[0] - buf[i]) * a;
    buf[i + 1] += (c[1] - buf[i + 1]) * a;
    buf[i + 2] += (c[2] - buf[i + 2]) * a;
  });
}

function paintWisp(buf, w, h, wisp) {
  const { blobs, lon } = wisp;
  const minX = Math.min(...blobs.map((b) => b.x - 2.5 * b.sx));
  const maxX = Math.max(...blobs.map((b) => b.x + 2.5 * b.sx));
  const minY = Math.min(...blobs.map((b) => b.y - 2.5 * b.sy));
  const maxY = Math.max(...blobs.map((b) => b.y + 2.5 * b.sy));
  forBox(w, h, lon + minX, lon + maxX, minY, maxY, lon, (i, dx, lat) => {
    let a = 0;
    for (const b of blobs) {
      const u = (dx - b.x) / b.sx;
      const v = (lat - b.y) / b.sy;
      a += b.a * Math.exp(-(u * u + v * v));
    }
    a = Math.min(a, 0.6);
    for (let k = 0; k < 3; k++) buf[i + k] += (248 - buf[i + k]) * a;
  });
}
