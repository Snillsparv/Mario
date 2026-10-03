// Sparrow Lane's realistic look (render/real/*): the texture sets it asks the worker for, its
// material catalogue (a material for each of the course's meshes) and its build. The visuals
// are the classic builders' faces built again unbaked (lane/build.js look 'real'); the colliders,
// poles, signs, coins and entries stay the classic build's. (This folder, world/lane/real/, holds
// the lane's realistic-look code; this module runs on the main thread.)
//
//   LANE_REAL_AREA = { jobs, detail, build }   // world/areas.js lane def.real (RealAreas builds it;
//                                              // build: laneRealSteps)
//   laneJobs(tier) -> [{ kind, size, opts }]   // the texture sets at the tier's sizes
//   laneDetail(tier) -> { area, tier }   // the worker's geometry job (world/lane/real/detail.js)
//   laneMaterials(store, tier, haze, { anisotropy }) -> { [mesh name]: material }
//   detailMaterials(store, tier, haze, { anisotropy }) -> { [detail material]: material }
//   buildLaneReal(layout, { store, tier, origin, anisotropy, canRetro, detail }) -> { part, look }
//   laneRealSteps(layout, options)   // the same a step at a time (a generator whose return value
//                                    // is { part, look }: RealAreas runs it over several frames)
//       part: the WorldPart 'lane' (its object3D 'lane-real', under the area's root: the classic
//       builders' faces the realistic look keeps, and the worker's `detail` in its own
//       materials), look: the RealLook from layout.LANE_REAL (its probe over the road in world
//       coordinates)
//
// The catalogue (CATALOGUE): each mesh's set (and its options), the world units one repeat of
// the set covers, a colour the map and the vertex tint are multiplied by (linear: the tints stay
// each house's own colour from layout.js, the sets are near neutral), its roughness (a
// multiplier of the map's), the normal map's strength. The glass is physical (the reflection
// probe's street over a dim room); paint and cloth are flat; the signs keep the classic look
// (unlit, baked), their colour turned back through the exposure and tone mapping, so they read
// exactly as before through the output pass (materials.js classicLook).
//
// The detail's catalogue (DETAIL): the worker's meshes come with uvs in world units, so a set
// repeats once over `cover` units; plain materials are flat (paint, metal, enamel...); `leaf`
// ones are leaf cards (materials.js foliageMaterial: the leaf atlas, the fir twig), `glass` ones
// glass (the windows' on the reflection probe; the cars' opaque and dark), `clearcoat` the cars'
// lacquer, `shadow` the tile courses' flat stand-in (it only casts). Firs come instanced, the
// grass as a grid of clumps that follows the camera (grassGrid: look.grass(share) sets its reach,
// the governor's); the plants, the grass and the flags move in one wind (layout.WIND's way, its
// phase run by the part's update in gusts: fast and slow by turns, the sway stronger as it runs
// fast), the cirrus drifting along it.

import * as THREE from 'three';
import { RealLook } from '../../../render/real/RealLook.js';
import { pbrMaterial, plainMaterial, glassMaterial, foliageMaterial, grassMaterial, shadowCaster, classicLook } from '../../../render/real/materials.js';
import { jobKey } from '../../../render/real/texgen/jobs.js';
import { texSize } from '../../../render/real/tier.js';
import { GRASS } from './grass.js';
import { worldMaterial } from '../../../render/materials.js';
import { woodTexture as signWoodTexture } from '../../props/textures.js';
import { laneSteps, REPEAT, REAL_REPEAT } from '../build.js';

// The terraces' split-face blocks and the steps: grey, coarse.
const BLOCKS = { cols: 3, rows: 7, seed: 23, tone: [0.5, 0.5, 0.48], mortar: [0.32, 0.32, 0.31], jitter: 0.12 };

const CATALOGUE = {
  asphalt: { set: 'asphalt', cover: 420, color: 4.2, normalScale: 0.8 },
  grass: { set: 'grass', cover: 300, color: [1.6, 1.79, 1.52] },
  blocks: { set: 'brick', opts: BLOCKS, cover: 240, color: 1.4, normalScale: 1.6 },
  brick: { set: 'brick', cover: 100, color: 1.1, normalScale: 1.2 },
  render: { set: 'render', cover: 300 },
  boards: { set: 'boards', cover: 240, color: 1.15, normalScale: 1.3 },
  roof: { set: 'tiles', cover: 270, color: 5, roughness: 0.85 },
  cobbles: { set: 'pavers', opts: { cols: 10, seed: 73 }, cover: 240, color: 1.6 },
  path: { set: 'pavers', cover: 240, color: [1.2, 1.42, 0.98], vertexColors: false }, // (mossy)
};
const PAINT = { roughness: 0.5 };
const CLOTH = { roughness: 0.85, side: THREE.DoubleSide };
const DETAIL = {
  boards: { set: 'boards', cover: 240, color: 1.15, normalScale: 1.3 },
  brick: { set: 'brick', cover: 100, color: 1.1, normalScale: 1.2 },
  render: { set: 'render', cover: 300 },
  roof: { set: 'tiles', cover: 270, color: 5, roughness: 0.85 },
  tiles: { set: 'tiles', opts: { relief: 0 }, cover: 270, color: 5, roughness: 0.8 },
  granite: { set: 'granite', cover: 120, color: 0.95 },
  patch: { set: 'asphalt', cover: 420, color: 4.2, normalScale: 0.5 },
  bark: { set: 'bark', cover: 120, normalScale: 1.2 },
  birch: { set: 'bark', opts: { birch: 1 }, cover: 140 },
  paint: { roughness: 0.55, side: THREE.DoubleSide },
  metal: { roughness: 0.35, metalness: 0.3 },
  steel: { roughness: 0.45, metalness: 0.6 },
  enamel: { roughness: 0.3 },
  bird: { roughness: 0.38, side: THREE.DoubleSide },
  gloss: { roughness: 0.15 },
  cloth: { roughness: 0.9, side: THREE.DoubleSide },
  glass: { glass: true },
  shadow: { shadow: true },
  carPaint: { roughness: 0.4, metalness: 0.45, clearcoat: [1, 0.05] },
  carGlass: { glass: { color: 0x050607, ior: 2, opacity: 1 } },
  tyre: { roughness: 0.9 },
  rim: { roughness: 0.3, metalness: 1 },
  trim: { roughness: 0.6 },
  lamp: { roughness: 0.08, metalness: 0.2 },
  tail: { roughness: 0.15 },
  core: { roughness: 1, envMapIntensity: 0.6 },
  'fir-core': { roughness: 1, envMapIntensity: 0.6 },
  foliage: { set: 'leaves', leaf: { roughness: 0.75, translucency: 0.6, envMapIntensity: 0.5 } },
  'fir-leaves': { set: 'fir', leaf: { roughness: 0.85, translucency: 0.2, envMapIntensity: 0.35 } },
};
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3, sway: 1 };
const WIND_SPEED = 1.7; // the plants' sway, radians a second
const CLOUD_DRIFT = 0.002; // the cirrus's drift along the wind (the sky's units a second)

const repeatOf = (name) => REPEAT[name] ?? REAL_REPEAT[name];
const colorOf = (c = 1) => (Array.isArray(c) ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(c, c, c));
const jobOf = (tier, { set, opts = {} }) => ({ kind: set, size: texSize(tier, set, opts), opts });

export function laneJobs(tier) {
  const jobs = [];
  for (const entry of [...Object.values(CATALOGUE), ...Object.values(DETAIL).filter((e) => e.set)]) {
    const job = jobOf(tier, entry);
    if (!jobs.some((j) => jobKey(j) === jobKey(job))) jobs.push(job);
  }
  return jobs;
}

export function laneMaterials(store, tier, haze, { anisotropy = tier.anisotropy, exposure = 1 } = {}) {
  const M = {};
  for (const [name, entry] of Object.entries(CATALOGUE)) {
    const maps = store.maps(jobKey(jobOf(tier, entry)), { anisotropy });
    M[name] = pbrMaterial(maps, { repeat: repeatOf(name) / entry.cover, color: colorOf(entry.color), roughness: entry.roughness ?? 1, normalScale: entry.normalScale ?? 1, vertexColors: entry.vertexColors ?? true }, haze);
  }
  M.paint = plainMaterial(PAINT, haze);
  M.cloth = plainMaterial(CLOTH, haze);
  M.glass = glassMaterial({}, haze);
  M.signs = classicLook(worldMaterial({ map: signWoodTexture() }), { exposure, direct: tier.direct });
  for (const [name, m] of Object.entries(M)) m.name = `lane-real-${name}`;
  return M;
}

export const laneDetail = (tier) => ({ area: 'lane', tier: tier.name });

export function detailMaterials(store, tier, haze, { anisotropy = tier.anisotropy, wind } = {}) {
  const M = {};
  for (const [name, entry] of Object.entries(DETAIL)) {
    if (!entry.set) {
      M[name] = entry.glass ? glassMaterial(entry.glass === true ? {} : entry.glass, haze) : entry.shadow ? shadowCaster() : plainMaterial(entry, haze);
      continue;
    }
    const maps = store.maps(jobKey(jobOf(tier, entry)), { anisotropy });
    if (entry.leaf) M[name] = foliageMaterial(maps.albedo, { ...entry.leaf, coverage: tier.samples > 0, wind }, haze);
    else M[name] = pbrMaterial(maps, { repeat: 1 / entry.cover, color: colorOf(entry.color), roughness: entry.roughness ?? 1, normalScale: entry.normalScale ?? 1 }, haze);
  }
  for (const [name, m] of Object.entries(M)) m.name = `lane-detail-${name}`;
  return M;
}

const geometryOf = (buffers) => {
  const geo = new THREE.BufferGeometry();
  for (const [key, array] of Object.entries(buffers)) geo.setAttribute(key, new THREE.BufferAttribute(array, ATTRIBUTES[key]));
  return geo;
};

// The worker's meshes in their materials (the group 'lane-detail'), the firs instanced.
function detailGroup(detail, M) {
  const group = new THREE.Group();
  group.name = 'lane-detail';
  const add = (mesh, name, cast = true) => {
    mesh.name = `lane-detail-${name}`;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const { name, material, cast, buffers, sphere } of detail.meshes) {
    const geo = geometryOf(buffers);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]); // (the worker's)
    add(new THREE.Mesh(geo, M[material]), name, cast);
  }
  const { parts, matrices, colors, cast, far } = detail.firs;
  for (const { material, buffers } of parts) {
    const geo = geometryOf(buffers);
    for (const [set, casts, name] of [[{ matrices, colors }, cast, material], [far, false, `${material}-far`]]) {
      const mesh = new THREE.InstancedMesh(geo, M[material], set.matrices.length / 16);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(set.matrices, 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(set.colors, 3);
      add(mesh, name, casts);
    }
  }
  return group;
}

// The grass's clumps over a grid of G.side x G.side cells (materials.js grassMaterial), its mask
// a DataTexture; returns { follow(camera), reach(share) }: the grid's per-frame move, centred
// ahead of the camera (on the ground it looks at), snapped to whole cells (no allocation a
// frame), and its blades' reach (the governor's).
function grassGrid(group, { clump, mask }, G, haze, wind) {
  const lawn = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  lawn.needsUpdate = true;
  const rect = new THREE.Vector4(mask.x0, mask.z0, 1 / (mask.x1 - mask.x0), 1 / (mask.z1 - mask.z0));
  const grid = { value: new THREE.Vector4(0, 0, G.cell, G.radius) };
  const middle = { value: new THREE.Vector2() };
  const geo = new THREE.InstancedBufferGeometry();
  for (const [key, array] of Object.entries(clump)) geo.setAttribute(key, new THREE.BufferAttribute(array, ATTRIBUTES[key]));
  // The cells nearest the grid's middle first, so the first n of them are a disc (a shorter
  // reach: reach(r)).
  const order = [];
  for (let i = 0; i < G.side * G.side; i++) order.push([i % G.side, Math.floor(i / G.side)]);
  const off = (G.side - 1) / 2;
  const far = ([i, j]) => (i - off) ** 2 + (j - off) ** 2;
  order.sort((a, b) => far(a) - far(b));
  geo.setAttribute('cell', new THREE.InstancedBufferAttribute(new Float32Array(order.flat()), 2));
  geo.instanceCount = order.length;
  const mesh = new THREE.Mesh(geo, grassMaterial({ lawn, rect, grid, middle, wind }, haze));
  mesh.name = 'lane-detail-grass';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // (its clumps are placed in the shader)
  group.add(mesh);
  const at = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const follow = (camera) => {
    const reach = grid.value.w;
    group.worldToLocal(at.copy(camera.position));
    camera.getWorldDirection(ahead);
    const l = Math.hypot(ahead.x, ahead.z) || 1;
    const x = at.x + (ahead.x / l) * reach * 0.55;
    const z = at.z + (ahead.z / l) * reach * 0.55;
    middle.value.set(x, z);
    grid.value.x = (Math.floor(x / G.cell) - G.side / 2) * G.cell;
    grid.value.y = (Math.floor(z / G.cell) - G.side / 2) * G.cell;
  };
  // The blades' reach, a share of the grid's (the governor's levels: tier.js ladder): the cells
  // within it drawn, the blades fading out toward it.
  const reach = (share) => {
    const r = G.radius * share;
    grid.value.w = Math.max(r, 1);
    let n = 0;
    while (r > 0 && n < order.length && Math.sqrt(far(order[n])) * G.cell <= r + G.cell) n++;
    geo.instanceCount = n;
    mesh.visible = n > 0;
  };
  return { follow, reach };
}

export function buildLaneReal(layout, options) {
  const steps = laneRealSteps(layout, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// buildLaneReal a step at a time (a generator, as lane/build.js laneSteps: RealAreas runs it
// over several frames).
export function* laneRealSteps(layout, { store, tier, origin, anisotropy, canRetro = true, detail = null }) {
  const preset = layout.LANE_REAL;
  const p = preset.probe;
  const look = new RealLook({ preset, tier, probeAt: { x: p.x + origin.x, y: p.y + origin.y, z: p.z + origin.z }, canRetro });
  const materials = laneMaterials(store, tier, look.haze, { anisotropy, exposure: preset.exposure });
  look.useProbe([materials.glass]);
  yield;
  const part = yield* laneSteps(layout, { look: 'real', materials });
  yield;
  for (const o of part.object3D.children) o.geometry?.computeBoundingSphere(); // (not in the first frame)
  if (!detail) return { part, look };
  yield;
  // The wind the plants sway in (the flags' breeze: their direction, a phase running with the
  // clock), set as the part updates.
  const [wx, wz] = layout.WIND.dir.map((c) => c / Math.hypot(...layout.WIND.dir));
  const wind = { value: new THREE.Vector4(wx, wz, 0, 0) };
  const D = detailMaterials(store, tier, look.haze, { anisotropy, wind });
  look.useProbe([D.glass]);
  const group = detailGroup(detail, D);
  part.object3D.add(group);
  yield;
  const grass = detail.grass ? grassGrid(group, detail.grass, GRASS[tier.name], look.haze, wind) : null;
  const follow = grass?.follow;
  look.grass = grass?.reach ?? null;
  look.grass?.(look.level.grass);
  // Gusts: the wind's phase runs fast and slow by turns (the flags waving with it), its sway
  // stronger while it runs fast; the cirrus drifting with it.
  const update = part.update;
  const drift = look.sky.material.uniforms.uDrift.value;
  part.update = (time, camera) => {
    const phase = time + 1.6 * Math.sin(time * 0.23) + 1.1 * Math.sin(time * 0.37 + 1);
    const gust = 1 + 0.09 * Math.cos(time * 0.23) + 0.1 * Math.cos(time * 0.37 + 1); // (0.8 .. 1.2 as it runs)
    update(phase);
    wind.value.set(wx * gust, wz * gust, phase * WIND_SPEED, 0);
    drift.set(wx, wz).multiplyScalar(time * CLOUD_DRIFT);
    if (camera) follow?.(camera);
  };
  return { part, look };
}

export const LANE_REAL_AREA = Object.freeze({ jobs: laneJobs, detail: laneDetail, build: laneRealSteps });
