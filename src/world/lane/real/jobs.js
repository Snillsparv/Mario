// Sparrow Lane's realistic look's catalogue and jobs, in the game's main chunk: RealAreas starts
// the workers on the look's texture sets and geometry at boot (the boot waits until they run),
// while the look's own main-thread code (look.js, the render/real materials, sky, probe, post
// chain and output pass) arrives in its lazily loaded chunk (realLook.js, a child of the lane's
// chunk), started beside them.
//
//   LANE_REAL_AREA = { jobs, detail, load }   // world/areaDefs.js lane def.real: RealAreas
//       builds it (load() -> Promise<laneRealSteps>: the realLook chunk's build, loaded through
//       the lane's chunk, world/lane/index.js; memoised, a failure loads again on the next call)
//   laneJobs(tier) -> [{ kind, size, opts }]   // the texture sets at the tier's sizes
//   laneDetail(tier) -> { area, tier }   // the worker's geometry job (world/lane/real/detail.js)
//   CATALOGUE, DETAIL, BLOCKS   // the materials' catalogue (look.js reads it: see there)
//   jobOf(tier, entry) -> job   // an entry's texture set at the tier's size

import * as THREE from 'three';
import { jobKey } from '../../../render/real/texgen/jobs.js';
import { CHUNKS } from '../../../core/chunks.js';
import { texSize } from '../../../render/real/tier.js';

// The terraces' split-face blocks and the steps: grey, coarse.
export const BLOCKS = { cols: 3, rows: 7, seed: 23, tone: [0.5, 0.5, 0.48], mortar: [0.32, 0.32, 0.31], jitter: 0.12 };

export const CATALOGUE = {
  asphalt: { set: 'asphalt', cover: 420, color: 4.7, normalScale: 0.8 },
  grass: { set: 'grass', cover: 300, color: [1.7, 1.8, 1.36] },
  blocks: { set: 'brick', opts: BLOCKS, cover: 240, color: 1.4, normalScale: 1.6 },
  brick: { set: 'brick', cover: 100, color: 1.1, normalScale: 1.2 },
  render: { set: 'render', cover: 300 },
  boards: { set: 'boards', cover: 240, color: 1.15, normalScale: 1.3 },
  roof: { set: 'tiles', cover: 270, color: 5, roughness: 0.85 },
  cobbles: { set: 'pavers', opts: { cols: 10, seed: 73 }, cover: 240, color: 1.6 },
  path: { set: 'pavers', cover: 240, color: [1.2, 1.42, 0.98], vertexColors: false }, // (mossy)
};
export const DETAIL = {
  boards: { set: 'boards', cover: 240, color: 1.15, normalScale: 1.3 },
  brick: { set: 'brick', cover: 100, color: 1.1, normalScale: 1.2 },
  render: { set: 'render', cover: 300 },
  roof: { set: 'tiles', cover: 270, color: 5, roughness: 0.85 },
  tiles: { set: 'tiles', opts: { relief: 0 }, cover: 270, color: 5, roughness: 0.8 },
  granite: { set: 'granite', cover: 120, color: 0.95 },
  patch: { set: 'asphalt', cover: 420, color: 4.2, normalScale: 0.5, roughness: 0.72 }, // (sealed: smoother, a little glossier)
  bark: { set: 'bark', cover: 120, normalScale: 1.6 },
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
  drl: { roughness: 0.2, emissive: 1.6 }, // (the dad's crossover's T lights: they glow and bloom)
  contact: { contact: true },
  core: { roughness: 1, envMapIntensity: 0.6 },
  'fir-core': { set: 'fir', cover: 1, roughness: 1 },
  foliage: { set: 'leaves', leaf: { roughness: 0.75, translucency: 0.6, envMapIntensity: 0.5 } },
  'fir-leaves': { set: 'fir', leaf: { roughness: 0.85, translucency: 0.2, envMapIntensity: 0.35 } },
};
export const jobOf = (tier, { set, opts = {} }) => ({ kind: set, size: texSize(tier, set, opts), opts });

export function laneJobs(tier) {
  const jobs = [];
  for (const entry of [...Object.values(CATALOGUE), ...Object.values(DETAIL).filter((e) => e.set)]) {
    const job = jobOf(tier, entry);
    if (!jobs.some((j) => jobKey(j) === jobKey(job))) jobs.push(job);
  }
  return jobs;
}

export const laneDetail = (tier) => ({ area: 'lane', tier: tier.name });

// (The realLook chunk is the lane chunk's child: loaded through it, world/lane/index.js.)
const load = () => CHUNKS.lane().then((lane) => lane.loadRealLook()).then((m) => m.laneRealSteps);

export const LANE_REAL_AREA = Object.freeze({ jobs: laneJobs, detail: laneDetail, load });
