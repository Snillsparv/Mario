// The realistic grass's grid per tier (world/lane/real/grass.js: its blades, built in the
// worker; look.js, in the realLook chunk, lays the clumps out by it). Data only, so the realLook
// chunk does not reach the worker's builders through it (tools/chunkPlan.js works on modules).
//
//   GRASS = { high, mid }   // side clumps a side, cell units each, radius (blades fade out from
//                           // 0.7 of it), blades a clump, segs a blade
//   (W7: high's radius 760 -> 735, its far ring ~6 % fewer clumps where the blades fade out
//   anyway: the plan's lever for the forest's taller mixed canopy, ~-19k triangles a frame. W8:
//   735 -> 725, ~-8k: the plan's lever for the two ends' houses, hedges and far cars.)

export const GRASS = Object.freeze({
  high: Object.freeze({ side: 128, cell: 12, radius: 725, blades: 4, segs: 3 }),
  mid: Object.freeze({ side: 80, cell: 12, radius: 480, blades: 3, segs: 2 }),
});
