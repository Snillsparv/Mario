// Sparrow Lane's realistic look (render/real/*): the texture sets it asks the worker for, its
// material catalogue (a material for each of the course's meshes) and its build. The visuals
// are the classic builders' faces built again unbaked (lane/build.js look 'real'); the colliders,
// poles, signs, coins and entries stay the classic build's. (This folder, world/lane/real/, holds
// the lane's realistic-look code; this module runs on the main thread.)
//
//   LANE_REAL_AREA = { jobs, build }      // world/areas.js lane def.real (RealAreas builds it)
//   laneJobs(tier) -> [{ kind, size, opts }]   // the texture sets at the tier's sizes
//   laneMaterials(store, tier, haze, { anisotropy }) -> { [mesh name]: material }
//   buildLaneReal(layout, { store, tier, origin, anisotropy, canRetro }) -> { part, look }
//       part: the WorldPart 'lane' (its object3D 'lane-real', under the area's root), look: the
//       RealLook from layout.LANE_REAL (its probe over the road in world coordinates)
//
// The catalogue (CATALOGUE): each mesh's set (and its options), the world units one repeat of
// the set covers, a colour the map and the vertex tint are multiplied by (linear: the tints stay
// each house's own colour from layout.js, the sets are near neutral), its roughness (a
// multiplier of the map's), the normal map's strength. The glass is physical (the reflection
// probe's street over a dim room); paint and cloth are flat; the signs keep the classic look
// (unlit, baked), their colour turned back through the exposure and tone mapping, so they read
// exactly as before through the output pass (materials.js classicLook).

import * as THREE from 'three';
import { RealLook } from '../../../render/real/RealLook.js';
import { pbrMaterial, plainMaterial, glassMaterial, classicLook } from '../../../render/real/materials.js';
import { jobKey } from '../../../render/real/texgen/jobs.js';
import { texSize } from '../../../render/real/tier.js';
import { worldMaterial } from '../../../render/materials.js';
import { woodTexture as signWoodTexture } from '../../props/textures.js';
import { buildLane, REPEAT, REAL_REPEAT } from '../build.js';

// The terraces' split-face blocks, the round bed's stones and the kerbs: grey, coarse.
const BLOCKS = { cols: 3, rows: 7, seed: 23, tone: [0.5, 0.5, 0.48], mortar: [0.32, 0.32, 0.31], jitter: 0.12 };

const CATALOGUE = {
  asphalt: { set: 'asphalt', cover: 420, color: 4.2, normalScale: 0.8 },
  grass: { set: 'grass', cover: 300, color: [1.6, 1.79, 1.52] },
  blocks: { set: 'brick', opts: BLOCKS, cover: 240, color: 1.4, normalScale: 1.6 },
  brick: { set: 'brick', cover: 180, color: 1.1, normalScale: 1.2 },
  render: { set: 'render', cover: 300 },
  boards: { set: 'boards', cover: 240, color: 1.15, normalScale: 1.3 },
  roof: { set: 'tiles', cover: 270, color: 5, roughness: 0.55 },
  cobbles: { set: 'pavers', opts: { cols: 10, seed: 73 }, cover: 240, color: 1.6 },
  path: { set: 'pavers', cover: 240, color: 1.5, vertexColors: false },
  leaves: { set: 'grass', opts: { seed: 133, leaves: 0 }, cover: 160, color: [5.5, 4.4, 5.5] },
  wood: { set: 'soil', opts: { seed: 95 }, cover: 150, color: 5 },
};
const PAINT = { roughness: 0.5 };
const CLOTH = { roughness: 0.85, side: THREE.DoubleSide };

const repeatOf = (name) => REPEAT[name] ?? REAL_REPEAT[name];
const colorOf = (c = 1) => (Array.isArray(c) ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(c, c, c));
const jobOf = (tier, { set, opts = {} }) => ({ kind: set, size: texSize(tier, set, opts), opts });

export function laneJobs(tier) {
  const jobs = [];
  for (const entry of Object.values(CATALOGUE)) {
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

export function buildLaneReal(layout, { store, tier, origin, anisotropy, canRetro = true }) {
  const preset = layout.LANE_REAL;
  const p = preset.probe;
  const look = new RealLook({ preset, tier, probeAt: { x: p.x + origin.x, y: p.y + origin.y, z: p.z + origin.z }, canRetro });
  const materials = laneMaterials(store, tier, look.haze, { anisotropy, exposure: preset.exposure });
  look.useProbe([materials.glass]);
  const part = buildLane(layout, { look: 'real', materials });
  return { part, look };
}

export const LANE_REAL_AREA = Object.freeze({ jobs: laneJobs, build: buildLaneReal });
