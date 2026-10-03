// Sparrow Lane's own realistic geometry (the realistic look's R2 detail), built in the realistic
// look's worker (render/real/laneRealWorker.js) from layout.js alone: the elements the realistic
// build draws itself instead of the classic builders' faces (lane/build.js REAL_DRAWN names
// them; the classic builders still make every collider). world/lane/real/look.js wraps the
// buffers in meshes on the main thread.
//
//   buildLaneDetail(L, tier) -> { meshes, firs, grass, triangles }
//     meshes: [{ name, material, cast, buffers }]   one per material (look.js DETAIL names
//             them), buffers: { position, normal, uv, color, sway? } (Float32Arrays, uvs in world
//             units but the leaf cards' atlas uvs); cast: casts the sun's shadow
//     firs:   { parts: [{ material, buffers }], matrices, colors, cast, far }   one fir (unit
//             height and radius) and the forest's instances (a 4 x 4 matrix and a tint each),
//             far: the tree line's { matrices, colors } (casting none)
//     grass:  { clump: buffers, mask }   the lawns' blade clump and their mask (grass.js; null on
//             low)
//     triangles: the meshes' and the instances' total
//   detailBuffers(detail) -> [ArrayBuffer]          everything to transfer
//
// tier: 'high' | 'mid' | 'low' (render/real/tier.js): on low half the leaf clusters, no tile
// courses, no blades, plainer windows and cars, fewer materials and shadow casters (LOW_MERGE,
// LOW_CASTERS).

import { Geo } from './geo.js';
import { mailbox, kerbs, roadDecals, bedStones } from './garden.js';
import { plants, firGeometry, firInstances } from './foliage.js';
import { chainHouse } from './house.js';
import { cars } from './cars.js';
import { grassClump, lawnMask } from './grass.js';
import { lampposts, flagpoles, fences, bins } from './street.js';
import { villaWindows, garageDoors, hipTrim } from './villas.js';
import { trampoline, hoop, motorhome, cabinet, treeLine } from './extras.js';

// Each material's builder; `cast` false: casts no shadow (the ground's, the glass, the rooms').
const MATERIALS = {
  boards: true,
  brick: true,
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
};

// The low tier (phones): small plain parts share a few materials (fewer draw calls), and only
// the houses and the cars cast the sun's shadow.
const LOW_MERGE = { enamel: 'gloss', lamp: 'gloss', tail: 'gloss', trim: 'tyre', rim: 'metal', steel: 'metal', bird: 'paint' };
const LOW_CASTERS = new Set(['boards', 'brick', 'paint', 'roof', 'shadow', 'carPaint', 'carGlass', 'tyre']);

export function buildLaneDetail(L, tier = 'high') {
  const kit = {};
  const low = tier === 'low';
  for (const name of Object.keys(MATERIALS)) kit[name] = new Geo();
  if (low) for (const [name, into] of Object.entries(LOW_MERGE)) kit[name] = kit[into];
  kit.tier = tier;
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
  villaWindows(kit, L);
  garageDoors(kit, L);
  hipTrim(kit, L);
  cars(kit, L);
  trampoline(kit, L);
  hoop(kit, L);
  motorhome(kit, L);
  cabinet(kit, L);
  const meshes = [];
  let triangles = 0;
  for (const [name, cast] of Object.entries(MATERIALS)) {
    if (!kit[name].count || (low && LOW_MERGE[name])) continue;
    meshes.push({ name, material: name, cast: cast && (!low || LOW_CASTERS.has(name)), buffers: kit[name].buffers() });
    triangles += kit[name].count / 3;
  }
  // The forest's firs and the far tree line: one fir, instanced (the far ones casting none).
  const fir = firGeometry(tier);
  const { matrices, colors } = firInstances(L);
  const firs = { parts: ['leaves', 'core'].map((k) => ({ material: `fir-${k}`, buffers: fir[k].buffers() })), matrices, colors, cast: !low, far: treeLine(L, tier) };
  for (const k of ['leaves', 'core']) triangles += (fir[k].count / 3) * ((matrices.length + firs.far.matrices.length) / 16);
  // The grass's clump and the lawns' mask (none on low).
  const clump = grassClump(tier);
  const grass = clump && { clump: clump.buffers(), mask: lawnMask(L) };
  return { meshes, firs, grass, triangles };
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
  }
  if (detail.grass) {
    add(detail.grass.clump);
    out.push(detail.grass.mask.data.buffer);
  }
  return out;
}
