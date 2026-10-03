// Where Sparrow Lane's forest stands (lane/layout.js FOREST, EDGE_FOREST): the seeded scatter of
// firs and birches on the bank behind the north gardens and the ring of firs round the outside
// of the boundary, as one pure list, so the classic builder (lane/props.js forest) and the
// realistic look's worker (world/lane/real/foliage.js: card firs and birches) plant the very
// same trees.
//
//   forestSpots(L) -> { firs: [{ x, z, base, h, r, a0 }], birches: [{ x, z, base, h, r, seed }] }
//                     // firs: the bank's FOREST.count first, then the edge's
//
// The seeds' order is the classic forest's: the bank's firs (each its place, its size, its
// turn), then its birches (place, size), then the edge's firs (a seeded way out from a seeded
// point on one of the boundary's edges, kept off the road drawn on past it and the bank).

import { makeRng } from '../../../core/math.js';

const FIR_SIZE = { h: [900, 1700], r: [260, 420] };
const BIRCH_SIZE = { h: [1300, 1800], r: [280, 380] };

export function forestSpots(L) {
  const { FOREST: F, EDGE_FOREST: E, BOUNDS } = L;
  const firs = [];
  const birches = [];
  const rng = makeRng(F.seed);
  const size = (S, r) => [S.h[0] + r() * (S.h[1] - S.h[0]), S.r[0] + r() * (S.r[1] - S.r[0])];
  const fir = (x, z, r) => {
    const [h, rad] = size(FIR_SIZE, r);
    firs.push({ x, z, base: L.groundHeight(x, z) - 10, h, r: rad, a0: r() });
  };
  for (let i = 0; i < F.count; i++) fir(F.x0 + rng() * (F.x1 - F.x0), F.z0 + rng() * (F.z1 - F.z0), rng);
  for (let i = 0; i < F.birches; i++) {
    const [x, z] = [F.x0 + rng() * (F.x1 - F.x0), F.z0 + rng() * (F.z1 - F.z0)];
    const [h, rad] = size(BIRCH_SIZE, rng);
    birches.push({ x, z, base: L.groundHeight(x, z) - 10, h, r: rad, seed: 500 + i });
  }
  const er = makeRng(E.seed);
  const edges = BOUNDS.map((p, i) => [p, BOUNDS[(i + 1) % BOUNDS.length]]);
  const lengths = edges.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const total = lengths.reduce((s, l) => s + l, 0);
  for (let i = 0, tries = 0; i < E.count && tries < E.count * 6; tries++) {
    let pick = er() * total;
    let k = 0;
    while (pick > lengths[k]) pick -= lengths[k++];
    const [p, q] = edges[k];
    const t = pick / lengths[k];
    const out = E.from + er() * (E.to - E.from);
    // The edge's outward normal (the polygon runs clockwise seen from above: out is its left).
    const nx = (q[1] - p[1]) / lengths[k];
    const nz = -(q[0] - p[0]) / lengths[k];
    const x = p[0] + (q[0] - p[0]) * t + nx * out;
    const z = p[1] + (q[1] - p[1]) * t + nz * out;
    if (L.inBounds(x, z) || L.roadDistance(x, z, L.ROAD_DRAWN) < L.ROAD.half + 300 || (x > F.x0 && z < F.z0)) continue;
    fir(x, z, er);
    i++;
  }
  return { firs, birches };
}
