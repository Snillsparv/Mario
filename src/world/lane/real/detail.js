// Sparrow Lane's own realistic geometry (the realistic look's R2 detail), built in the realistic
// look's worker (render/real/laneRealWorker.js) from layout.js alone: the elements the realistic
// build draws itself instead of the classic builders' faces (lane/build.js REAL_DRAWN names
// them; the classic builders still make every collider), and what G2 adds over them: the
// houses' hardware (hardware.js), the ground's clutter and the blank street sign (clutter.js),
// the cars' contact shadows (cars.js: `contact`). world/lane/real/look.js wraps the buffers in
// meshes on the main thread.
//
//   buildLaneDetail(L, tier) -> { meshes, firs, grass, ground, probes, triangles }
//     meshes: [{ name, material, cast, buffers, sphere, probe? }]   one per material (look.js
//             DETAIL names them; a probe's own meshes, `name@probe`, in their material
//             reflecting that probe), buffers: { position, normal, uv, color, sway?, wear? }
//             (Float32Arrays, uvs in world units but the leaf cards' atlas uvs); cast: casts the
//             sun's shadow; sphere: its bounding sphere [x, y, z, r] (as three.js computes it)
//     firs:   { parts: [{ material, buffers }], matrices, colors, cast, far, edge }   one fir
//             (unit height and radius) and the forest's instances (a 4 x 4 matrix and a tint
//             each), far: the tree line's { matrices, colors } (casting none), edge: on high
//             the edge's firs, nearest the street, a spruce of their own ({ parts, matrices,
//             colors }; else null: they are the forest's)
//     grass:  { clump: buffers }   the lawns' blade clump (grass.js; null on low)
//     ground: the lawn mask (grass.js lawnMask: where the blades grow, the ground's height, the
//             road's wheel track, the damp lawns): the grass's map and the weathering's ground
//             map (materials.js WEAR), on every tier
//     probes: [{ name, at: [x, y, z], kind }]   the reflection probes the meshes name (layout
//             local): each cluster of cars' ('car0'.., kind 'car': cars.js carClusters) and the
//             villas' windows' ('north', kind 'windows': from the street in front of them, so
//             they reflect the chain houses across it); none on low (the sky's environment)
//     triangles: the meshes' and the instances' total
//   detailBuffers(detail) -> [ArrayBuffer]          everything to transfer
//
// tier: 'high' | 'mid' | 'low' (render/real/tier.js): on mid 70 % of the leaf clusters, plainer
// cars, 60 % of the clutter; on low half of the clusters, no tile courses, no blades, plainer
// windows and cars still, a quarter of the leaves on the ground and no weeds, fewer materials and
// shadow casters (LOW_MERGE, LOW_CASTERS), no probes of its own (one paint, one glass).

import { Geo } from './geo.js';
import { mailbox, kerbs, roadDecals, bedStones } from './garden.js';
import { plants, firGeometry, firInstances, FIR_SHAPES } from './foliage.js';
import { chainHouse } from './house.js';
import { cars, carClusters } from './cars.js';
import { grassClump, lawnMask } from './grass.js';
import { lampposts, flagpoles, fences, bins } from './street.js';
import { villaHouses, garageDoors, hipTrim } from './villas.js';
import { trampoline, hoop, motorhome, cabinet, treeLine } from './extras.js';
import { clutter, streetSign } from './clutter.js';
import { hardware } from './hardware.js';

// Each material's builder; `cast` false: casts no shadow (the ground's, the glass, the rooms').
const MATERIALS = {
  boards: true,
  brick: true,
  render: true,
  paint: true,
  metal: true,
  enamel: true,
  bird: true,
  gloss: true,
  foliage: true,
  core: true,
  bark: true,
  birch: true,
  tiles: false, // (the flat shadow stand-in casts the tiled roofs' shadow)
  shadow: true,
  roof: true,
  glass: false,
  cloth: false,
  granite: true,
  patch: false,
  steel: true,
  carPaint: true,
  carGlass: true,
  tyre: true,
  rim: true,
  trim: true,
  lamp: true,
  tail: true,
  contact: false, // (the cars' contact shadows: a darkening of the ground under them)
};
// The villas' windows' probe: over the street in front of them (layout local).
const NORTH_PROBE = [0, 420, -350];

// The low tier (phones): small plain parts share a few materials (fewer draw calls), and only
// the houses and the cars cast the sun's shadow.
const LOW_MERGE = { enamel: 'gloss', lamp: 'gloss', tail: 'gloss', trim: 'tyre', rim: 'metal', steel: 'metal', bird: 'paint' };
const LOW_CASTERS = new Set(['boards', 'brick', 'render', 'paint', 'roof', 'shadow', 'carPaint', 'carGlass', 'tyre']);

export function buildLaneDetail(L, tier = 'high') {
  const kit = {};
  const low = tier === 'low';
  for (const name of Object.keys(MATERIALS)) kit[name] = new Geo();
  if (low) for (const [name, into] of Object.entries(LOW_MERGE)) kit[name] = kit[into];
  kit.tier = tier;
  // Each cluster of cars' paint and glass, and the villas' panes, their own meshes reflecting
  // their own probes (not on low).
  const probes = [];
  const own = [];
  if (!low) {
    carClusters(L).forEach((g, k) => {
      probes.push({ name: `car${k}`, at: g.at, kind: 'car' });
      for (const m of ['carPaint', 'carGlass']) own.push({ key: `${m}@${k}`, material: m, probe: `car${k}` });
    });
    probes.push({ name: 'north', at: NORTH_PROBE, kind: 'windows' });
    own.push({ key: 'glass@north', material: 'glass', probe: 'north' });
    for (const o of own) kit[o.key] = new Geo();
  }
  mailbox(kit, L);
  kerbs(kit, L);
  roadDecals(kit, L);
  bedStones(kit, L);
  lampposts(kit, L);
  flagpoles(kit, L);
  fences(kit, L);
  bins(kit, L);
  plants(kit, L);
  for (const h of L.HOUSES) if (h.kit === 'chain') chainHouse(kit, L, h, { tiled: L.LANE_REAL.tiles.includes(h.id) });
  villaHouses(kit['glass@north'] ? { ...kit, glass: kit['glass@north'] } : kit, L);
  garageDoors(kit, L);
  hipTrim(kit, L);
  hardware(kit, L);
  cars(kit, L);
  trampoline(kit, L);
  hoop(kit, L);
  motorhome(kit, L);
  cabinet(kit, L);
  const ground = lawnMask(L);
  clutter(kit, L, ground);
  streetSign(kit, L);
  const meshes = [];
  let triangles = 0;
  for (const [name, cast] of Object.entries(MATERIALS)) {
    if (!kit[name].count || (low && LOW_MERGE[name])) continue;
    const buffers = kit[name].buffers();
    meshes.push({ name, material: name, cast: cast && (!low || LOW_CASTERS.has(name)), buffers, sphere: sphereOf(buffers.position) });
    triangles += kit[name].count / 3;
  }
  for (const { key, material, probe } of own) {
    if (!kit[key].count) continue;
    const buffers = kit[key].buffers();
    meshes.push({ name: key, material, probe, cast: MATERIALS[material], buffers, sphere: sphereOf(buffers.position) });
    triangles += kit[key].count / 3;
  }
  // The forest's firs and the far tree line: one fir, instanced (the far ones casting none); on
  // high the edge's firs (nearest the street) a second spruce of their own (FIR_SHAPES.B).
  const fir = firGeometry(tier);
  const split = tier === 'high' ? L.FOREST.count : Infinity;
  const { matrices, colors } = firInstances(L, 0, split);
  const parts = (geo) => ['leaves', 'core'].map((k) => ({ material: `fir-${k}`, buffers: geo[k].buffers() }));
  const firs = { parts: parts(fir), matrices, colors, cast: !low, far: treeLine(L, tier), edge: null };
  for (const k of ['leaves', 'core']) triangles += (fir[k].count / 3) * ((matrices.length + firs.far.matrices.length) / 16);
  if (split < Infinity) {
    const edge = firGeometry(tier, 11, FIR_SHAPES.B);
    firs.edge = { parts: parts(edge), ...firInstances(L, split) };
    for (const k of ['leaves', 'core']) triangles += (edge[k].count / 3) * (firs.edge.matrices.length / 16);
  }
  // The grass's clump (none on low) and the ground's map.
  const clump = grassClump(tier);
  const grass = clump && { clump: clump.buffers() };
  return { meshes, firs, grass, ground, probes, triangles };
}

// The bounding sphere three.js would compute (the box's middle, the farthest point), made here
// so the main thread never walks the buffers.
function sphereOf(p) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) r2 = Math.max(r2, (p[i] - c[0]) ** 2 + (p[i + 1] - c[1]) ** 2 + (p[i + 2] - c[2]) ** 2);
  return [...c, Math.sqrt(r2)];
}

export function detailBuffers(detail) {
  const out = [];
  const add = (buffers) => {
    for (const a of Object.values(buffers)) if (a?.buffer) out.push(a.buffer);
  };
  for (const m of detail.meshes) add(m.buffers);
  if (detail.firs) {
    for (const p of detail.firs.parts) add(p.buffers);
    out.push(detail.firs.matrices.buffer, detail.firs.colors.buffer, detail.firs.far.matrices.buffer, detail.firs.far.colors.buffer);
    const edge = detail.firs.edge;
    if (edge) {
      for (const p of edge.parts) add(p.buffers);
      out.push(edge.matrices.buffer, edge.colors.buffer);
    }
  }
  if (detail.grass) add(detail.grass.clump);
  if (detail.ground) out.push(detail.ground.data.buffer);
  return out;
}
