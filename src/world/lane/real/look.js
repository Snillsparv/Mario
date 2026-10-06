// Sparrow Lane's realistic look (render/real/*): its materials (from the catalogue in jobs.js:
// a material for each of the course's meshes) and its build. In the lazily loaded realLook
// chunk (realLook.js: RealAreas loads it at boot, beside the workers, from LANE_REAL_AREA.load),
// with the render/real code only it needs. The visuals are the classic builders' faces built
// again unbaked (lane/build.js look 'real'); the colliders, poles, signs, coins and entries stay
// the classic build's. (This folder, world/lane/real/, holds the lane's realistic-look code; this
// module runs on the main thread.)
//
//   laneJobs, laneDetail, LANE_REAL_AREA   // jobs.js's (in the game's main chunk: this module is
//                                          // in the lazy realLook chunk), re-exported
//   laneMaterials(store, tier, haze, { anisotropy, exposure, grade }) -> { [mesh name]: material }
//       (grade: the look's grade uniforms, RealLook.grade, which the signs turn back)
//   detailMaterials(store, tier, haze, { anisotropy, probes }) -> { [detail material]: material }
//       (probes: the detail's meshes' own probes' names; a material reflecting each one,
//       `material@probe`, for the meshes that name it)
//   wearUniforms(mask, origin) -> { uWearGround, uWearRect, uWearOrigin }   // the weathering's
//       ground map (the worker's lawn mask: materials.js WEAR) as the look's haze uniforms
//   buildLaneReal(layout, { store, tier, origin, anisotropy, canRetro, detail }) -> { part, look }
//   laneRealSteps(layout, options)   // the same a step at a time (a generator whose return value
//                                    // is { part, look }: RealAreas runs it over several frames)
//       part: the WorldPart 'lane' (its object3D 'lane-real', under the area's root: the classic
//       builders' faces the realistic look keeps, and the worker's `detail` in its own
//       materials; part.movers: the bins (the worker's, instanced: lane-detail-bins) and the
//       charger's cable; part.hide: the dad's car's first vertex in each detail mesh; part.robot:
//       the dad's car as the lane's boss's pieces, detail.js robotPieces, in their materials), look: the
//       RealLook from layout.LANE_REAL (its probe over the road in world coordinates, its far
//       shadow map over the course's bounds up to FAR_TOP)
//
// The catalogue (CATALOGUE): each mesh's set (and its options), the world units one repeat of
// the set covers, a colour the map and the vertex tint are multiplied by (linear: the tints stay
// each house's own colour from layout.js, the sets are near neutral), its roughness (a
// multiplier of the map's), the normal map's strength. The glass is physical (the reflection
// probe's street over a dim room); paint and cloth are flat; the signs keep the classic look
// (unlit, baked), their colour turned back through the exposure, the tone mapping and the grade,
// so they read exactly as before through the output pass (materials.js classicLook).
//
// The detail's catalogue (DETAIL): the worker's meshes come with uvs in world units, so a set
// repeats once over `cover` units; plain materials are flat (paint, metal, enamel...); `leaf`
// ones are leaf cards (materials.js foliageMaterial: the leaf atlas, the fir twig), `glass` ones
// glass (the windows' on the reflection probe; the cars' opaque and dark), `clearcoat` the cars'
// lacquer, `shadow` the tile courses' flat stand-in (it only casts), `contact` the cars' contact
// shadows (a darkening of the drive under them). The cars' paint and glass reflect their own
// cluster's probe and the villas' windows the street in front of them (the detail's probes:
// taken as the build is readied, each a task of its own). Firs come instanced, the
// grass as a grid of clumps that follows the camera (grassGrid: look.grass(share) sets its reach,
// the governor's); the plants, the grass and the flags move in one wind (layout.WIND's way, its
// phase run by the part's update in gusts: fast and slow by turns, the sway stronger as it runs
// fast), the cirrus drifting along it.

import * as THREE from 'three';
import { RealLook } from '../../../render/real/RealLook.js';
import { pbrMaterial, plainMaterial, glassMaterial, foliageMaterial, grassMaterial, shadowCaster, contactMaterial, classicLook, setWear } from '../../../render/real/materials.js';
import { jobKey } from '../../../render/real/texgen/jobs.js';
import { GRASS } from './grassTiers.js';
import { CATALOGUE, DETAIL, jobOf } from './jobs.js';
import { worldMaterial } from '../../../render/materials.js';
import { woodTexture as signWoodTexture } from '../../props/textures.js';
import { laneSteps, binsMesh, REPEAT, REAL_REPEAT } from '../build.js';

export { laneJobs, laneDetail, LANE_REAL_AREA } from './jobs.js';

const PAINT = { roughness: 0.5 };
const CLOTH = { roughness: 0.85, side: THREE.DoubleSide };
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3, sway: 1, wear: 3 };
const WIND_SPEED = 1.7; // the plants' sway, radians a second
const FAR_TOP = 3000; // the far shadow map's box reaches this high (the hill's trees' tops)
const CLOUD_DRIFT = 0.002; // the cirrus's drift along the wind (the sky's units a second)
// The meshes that cast no sun shadow on mid and low (B4: the fight's draw calls within the tiers'
// budgets): the front door's leaf (flush with its wall) and the charger's cable; on mid the cars'
// lamps, T lights, tail lamps, rims and trim (inside the body's own shadow: on low they are merged
// into casting-free materials already), the window sills' pots and the mailbox's carved bird; on
// low the signs and the flags too (lost in its coarse map).
const QUIET = {
  mid: new Set(['lane-door', 'lane-cable', ...['drl', 'lamp', 'tail', 'rim', 'trim', 'enamel', 'bird'].map((n) => `lane-detail-${n}`)]),
  low: new Set(['lane-door', 'lane-cable', 'lane-signs', 'lane-cloth']),
};

const repeatOf = (name) => REPEAT[name] ?? REAL_REPEAT[name];
const colorOf = (c = 1) => (Array.isArray(c) ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(c, c, c));

export function laneMaterials(store, tier, haze, { anisotropy = tier.anisotropy, exposure = 1, grade = null } = {}) {
  const M = {};
  const wear = { lite: tier.name === 'low' };
  for (const [name, entry] of Object.entries(CATALOGUE)) {
    const maps = store.maps(jobKey(jobOf(tier, entry)), { anisotropy });
    M[name] = pbrMaterial(maps, { repeat: repeatOf(name) / entry.cover, color: colorOf(entry.color), roughness: entry.roughness ?? 1, normalScale: entry.normalScale ?? 1, vertexColors: entry.vertexColors ?? true, wear }, haze);
    setWear(M[name], name);
  }
  M.paint = plainMaterial(PAINT, haze);
  M.cloth = plainMaterial(CLOTH, haze);
  M.glass = glassMaterial({}, haze);
  M.signs = classicLook(worldMaterial({ map: signWoodTexture() }), { exposure, direct: tier.direct, grade });
  for (const [name, m] of Object.entries(M)) m.name = `lane-real-${name}`;
  return M;
}

export function detailMaterials(store, tier, haze, { anisotropy = tier.anisotropy, wind, probes = [], worn = new Set() } = {}) {
  const M = {};
  const plain = (entry) => (entry.glass ? glassMaterial(entry.glass === true ? {} : entry.glass, haze) : entry.shadow ? shadowCaster() : entry.contact ? contactMaterial() : plainMaterial(entry, haze));
  for (const { material, probe } of probes) M[`${material}@${probe}`] = plain(DETAIL[material]);
  for (const [name, entry] of Object.entries(DETAIL)) {
    if (!entry.set) {
      M[name] = plain(entry);
      continue;
    }
    const maps = store.maps(jobKey(jobOf(tier, entry)), { anisotropy });
    if (entry.leaf) M[name] = foliageMaterial(maps.albedo, { ...entry.leaf, coverage: tier.samples > 0, wind }, haze);
    else {
      M[name] = pbrMaterial(maps, { repeat: 1 / entry.cover, color: colorOf(entry.color), roughness: entry.roughness ?? 1, normalScale: entry.normalScale ?? 1, wear: { attr: worn.has(name), lite: tier.name === 'low' } }, haze);
      setWear(M[name], name);
    }
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
  for (const { name, material, cast, buffers, sphere, probe } of detail.meshes) {
    const geo = geometryOf(buffers);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]); // (the worker's)
    add(new THREE.Mesh(geo, M[probe ? `${material}@${probe}` : material]), name, cast);
  }
  const { parts, matrices, colors, cast, far, edge } = detail.firs;
  const instanced = (geo, material, set, name, casts) => {
    const mesh = new THREE.InstancedMesh(geo, M[material], set.matrices.length / 16);
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(set.matrices, 16);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(set.colors, 3);
    add(mesh, name, casts);
  };
  for (const { material, buffers } of parts) {
    const geo = geometryOf(buffers);
    instanced(geo, material, { matrices, colors }, material, cast);
    instanced(geo, material, far, `${material}-far`, false);
  }
  // (On high the edge's firs, nearest the street, a spruce of their own.)
  for (const { material, buffers } of edge?.parts ?? []) instanced(geometryOf(buffers), material, edge, `${material}-edge`, cast);
  return group;
}

// The grass's clumps over a grid of G.side x G.side cells (materials.js grassMaterial), its mask
// a DataTexture; returns { follow(camera), reach(share) }: the grid's per-frame move, centred
// ahead of the camera (on the ground it looks at), snapped to whole cells (no allocation a
// frame), and its blades' reach (the governor's).
// The lawn mask as a texture (nearest texels: the grass reads where it grows and the ground's
// height there) and its rect: Vector4(x0, z0, 1 / width, 1 / depth).
function groundTexture(mask) {
  const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  return { texture, rect: new THREE.Vector4(mask.x0, mask.z0, 1 / (mask.x1 - mask.x0), 1 / (mask.z1 - mask.z0)) };
}

export function wearUniforms(mask, origin) {
  const { texture, rect } = groundTexture(mask);
  return { uWearGround: { value: texture }, uWearRect: { value: rect }, uWearOrigin: { value: new THREE.Vector3(origin.x, origin.y, origin.z) } };
}

function grassGrid(group, { clump, ground }, G, haze, wind) {
  const { texture: lawn, rect } = ground;
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
  return { follow, reach, mesh };
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
  const xs = layout.BOUNDS.map(([x]) => x + origin.x);
  const zs = layout.BOUNDS.map(([, z]) => z + origin.z);
  const farBox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: origin.y - 100, y1: origin.y + FAR_TOP, z0: Math.min(...zs), z1: Math.max(...zs) };
  const look = new RealLook({ preset, tier, probeAt: { x: p.x + origin.x, y: p.y + origin.y, z: p.z + origin.z }, farBox, canRetro });
  // The weathering's ground map (the worker's lawn mask), every realistic material's.
  const wear = detail?.ground ? wearUniforms(detail.ground, origin) : null;
  if (wear) Object.assign(look.haze, wear);
  const ground = wear && { texture: wear.uWearGround.value, rect: wear.uWearRect.value };
  const materials = laneMaterials(store, tier, look.haze, { anisotropy, exposure: preset.exposure, grade: look.grade });
  look.useProbe([materials.glass]);
  yield;
  const part = yield* laneSteps(layout, { look: 'real', materials });
  // (B4, the fight's budgets: on mid and low the small things cast no sun shadow, QUIET.)
  const quiet = QUIET[tier.name];
  const hush = (list) => {
    if (quiet) for (const o of list) if (quiet.has(o.name)) o.castShadow = false;
  };
  hush(part.object3D.children);
  yield;
  for (const o of part.object3D.children) o.geometry?.computeBoundingSphere(); // (not in the first frame)
  if (!detail) return { part, look };
  yield;
  // The wind the plants sway in (the flags' breeze: their direction, a phase running with the
  // clock), set as the part updates.
  const [wx, wz] = layout.WIND.dir.map((c) => c / Math.hypot(...layout.WIND.dir));
  const wind = { value: new THREE.Vector4(wx, wz, 0, 0) };
  // The probes the detail's meshes reflect: each cluster of cars', the villas' windows'.
  const own = detail.meshes.filter((m) => m.probe);
  const worn = new Set(detail.meshes.filter((m) => m.buffers.wear).map((m) => m.material));
  const D = detailMaterials(store, tier, look.haze, { anisotropy, wind, probes: own, worn });
  look.useProbe([D.glass]);
  for (const p of detail.probes ?? []) {
    look.addProbe(p.name, { x: p.at[0] + origin.x, y: p.at[1] + origin.y, z: p.at[2] + origin.z }, p.kind === 'car' ? tier.carProbe : tier.probe);
    look.useProbe(own.filter((m) => m.probe === p.name).map((m) => D[`${m.material}@${p.name}`]), p.name);
  }
  const group = detailGroup(detail, D);
  hush(group.children);
  part.object3D.add(group);
  // The movers: the bins (one bin in its own frame, instanced, each at home: casting), and the
  // dad's car's hide range in each detail mesh it shares (it is drawn last into them).
  const bins = detail.movers?.bins;
  if (bins) {
    const mesh = binsMesh(geometryOf(bins.meshes[0].buffers), D[bins.meshes[0].material], layout);
    mesh.name = 'lane-detail-bins';
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    part.movers.bins = mesh;
  }
  for (const [id, at] of Object.entries(detail.hide ?? {})) {
    part.hide[id] = {};
    for (const [name, vertex] of Object.entries(at)) part.hide[id][`lane-detail-${name}`] = vertex;
  }
  // The lane's boss's car as STOMPWATT's pieces (objects/laneBoss/model.js skins them), each in
  // the material the car is drawn in.
  const robot = detail.robot;
  if (robot) part.robot = { cuts: robot.cuts, tier: tier.name, meshes: robot.meshes.map((m) => ({ name: m.material, material: D[m.probe ? `${m.material}@${m.probe}` : m.material], buffers: m.buffers })) };
  yield;
  const grass = detail.grass ? grassGrid(group, { clump: detail.grass.clump, ground }, GRASS[tier.name], look.haze, wind) : null;
  const follow = grass?.follow;
  if (grass) look.probeSkip.push(grass.mesh);
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
