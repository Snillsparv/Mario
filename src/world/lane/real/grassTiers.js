// The realistic grass's grid per tier (world/lane/real/grass.js: its blades, built in the
// worker; look.js, in the realLook chunk, lays the clumps out by it). Data only, so the realLook
// chunk does not reach the worker's builders through it (tools/chunkPlan.js works on modules).
//
//   GRASS = { high, mid }   // side clumps a side, cell units each, radius (blades fade out from
//                           // 0.7 of it), blades a clump, segs a blade

export const GRASS = Object.freeze({
  high: Object.freeze({ side: 128, cell: 12, radius: 760, blades: 4, segs: 3 }),
  mid: Object.freeze({ side: 80, cell: 12, radius: 480, blades: 3, segs: 2 }),
});
