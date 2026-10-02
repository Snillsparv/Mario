// The Great Hall's floor plan (hall/layout.js HALL, APSE, ROUNDS) as runs of wall, for the
// builder (hall/shell.js, hall/features.js, hall/light.js): what the walls are drawn on, swept
// along and collided with.
//
//   planRuns(L) -> [run]            the plan's six runs of wall in order round the room:
//                                   south, sw, west, apse, east, se
//     run = { name, curved, centre?, r?, pts: [[x, z]], nrm: [[nx, nz]], s: [arc length] }
//     (nrm: each point's inward normal, radial on the curves; s from the run's start)
//   planPolygon(L, d = 0) -> [[x, z]]   the plan inset by d (convex, no repeated points)
//   facetPanel(builder, run, i, y0, y1, opts)   a wall panel on facet i (run point i to i + 1)
//   archHole(uc, v0, hw, spring, segs)          an arched hole in a facet's (u, v)
//   runPath(run, s0, s1) -> path    a sweep path (castle/geom.js sweep) along a run, at y 0
//   wallColliders(L, solids)        the plan's walls as convex solids, floor to ceiling
//
// The plan is convex and tangent-continuous: a nave (straight walls at x ±halfX), a half-round
// apse to the north and quarter-round south corners into the flat south wall, so the walls
// have no inside corner for the camera to catch in. Curved walls are flat facets with smooth
// normals (they shade round), and collide as radial wedges out to well behind the wall, so no
// pocket of air is left between them and the slabs round the room.

import { polyArea, subtractConvex } from '../castle/geom.js';

const WEDGE = 1300; // how far behind a curved wall its wedge colliders reach

export function planRuns({ HALL, APSE, ROUNDS }) {
  const X = HALL.halfX;
  const runs = [];
  // A run round a centre: `facets` facets from angle a0 to a1 (radians from +x, z = cz + sin).
  const arc = (name, cx, cz, r, facets, a0, a1) => {
    const run = { name, curved: true, centre: [cx, cz], r, pts: [], nrm: [] };
    for (let i = 0; i <= facets; i++) {
      const a = a0 + ((a1 - a0) * i) / facets;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      run.pts.push([cx + dx * r, cz + dz * r]);
      run.nrm.push([-dx, -dz]);
    }
    return run;
  };
  runs.push({ name: 'south', curved: false, pts: [[ROUNDS.x, HALL.southZ], [-ROUNDS.x, HALL.southZ]], nrm: [[0, -1], [0, -1]] });
  runs.push(arc('sw', -ROUNDS.x, ROUNDS.z, ROUNDS.r, ROUNDS.facets, Math.PI / 2, Math.PI));
  runs.push({ name: 'west', curved: false, pts: [[-X, ROUNDS.z], [-X, APSE.z]], nrm: [[1, 0], [1, 0]] });
  // The apse from the west (180 degrees) round through north (z = APSE.z - r) to the east.
  runs.push(arc('apse', APSE.x, APSE.z, APSE.r, APSE.facets, Math.PI, Math.PI * 2));
  runs.push({ name: 'east', curved: false, pts: [[X, APSE.z], [X, ROUNDS.z]], nrm: [[-1, 0], [-1, 0]] });
  runs.push(arc('se', ROUNDS.x, ROUNDS.z, ROUNDS.r, ROUNDS.facets, 0, Math.PI / 2));
  for (const run of runs) {
    run.s = [0];
    for (let i = 1; i < run.pts.length; i++) run.s.push(run.s[i - 1] + Math.hypot(run.pts[i][0] - run.pts[i - 1][0], run.pts[i][1] - run.pts[i - 1][1]));
  }
  return runs;
}

export function planPolygon(L, d = 0) {
  const pts = [];
  for (const run of planRuns(L)) {
    for (let i = 0; i < run.pts.length; i++) {
      const q = [run.pts[i][0] + run.nrm[i][0] * d, run.pts[i][1] + run.nrm[i][1] * d];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) pts.push(q);
    }
  }
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  return pts;
}

// A wall panel on facet i of `run`, from height y0 to y1: cells about du along by dv up, minus
// the convex `holes` (in the facet's own (u, v): u along it from its start, v the height),
// with smooth normals (lerped between the run's point normals, so a curved wall shades round).
//   u0, u1: only this stretch of the facet (default all of it)
//   uv(s, v) -> [u, v]: the uvs from the run's arc length s and the height (default: both in
//     the builder's repeats)
//   shade(x, y, z) -> multiplier
export function facetPanel(builder, run, i, y0, y1, { du = 300, dv = 300, holes = [], uv = null, shade = null, u0 = 0, u1 = null } = {}) {
  const [ax, az] = run.pts[i];
  const [bx, bz] = run.pts[i + 1];
  const len = Math.hypot(bx - ax, bz - az);
  const end = u1 ?? len;
  const [na, nb] = [run.nrm[i], run.nrm[i + 1]];
  const nu = Math.max(1, Math.round((end - u0) / du));
  const nv = Math.max(1, Math.round((y1 - y0) / dv));
  const facing = [na[0] + nb[0], 0, na[1] + nb[1]];
  const R = builder.repeat;
  const vertex = ([u, v]) => {
    const t = u / len;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const nx = na[0] + (nb[0] - na[0]) * t;
    const nz = na[1] + (nb[1] - na[1]) * t;
    const l = Math.hypot(nx, nz) || 1;
    const s = run.s[i] + u;
    return { p: [x, v, z], n: [nx / l, 0, nz / l], t: uv ? uv(s, v) : [s / R, v / R], s: shade ? shade(x, v, z) : 1 };
  };
  for (let a = 0; a < nu; a++) {
    const ua = u0 + ((end - u0) * a) / nu;
    const ub = u0 + ((end - u0) * (a + 1)) / nu;
    for (let c = 0; c < nv; c++) {
      const va = y0 + ((y1 - y0) * c) / nv;
      const vb = y0 + ((y1 - y0) * (c + 1)) / nv;
      let pieces = [[[ua, va], [ub, va], [ub, vb], [ua, vb]]];
      for (const hole of holes) pieces = pieces.flatMap((piece) => subtractConvex(piece, hole));
      for (const piece of pieces) {
        if (piece.length < 3 || Math.abs(polyArea(piece)) < 1) continue;
        const V = piece.map(vertex);
        for (let k = 1; k + 1 < V.length; k++) builder._triV(V[0], V[k], V[k + 1], facing);
      }
    }
  }
}

// An arched hole in a facet's (u, v): its middle at u = uc, its foot at v0, half-width hw, the
// arch springing at v0 + spring; a convex polygon (the arch in `segs` segments, at the same
// angles as castle/geom.js archContour's, so it matches a door's opening).
export function archHole(uc, v0, hw, spring, segs = 16) {
  const pts = [[uc - hw, v0], [uc + hw, v0]];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push([uc + hw * Math.cos(a), v0 + spring + hw * Math.sin(a)]);
  }
  return pts;
}

// A sweep path along `run` from arc length s0 to s1: its points between them and the two ends
// (n the inward normal, b up, at y 0: a wall trim's profile v is its height).
export function runPath(run, s0, s1) {
  const point = (s) => {
    let i = 0;
    while (i + 2 < run.s.length && run.s[i + 1] < s) i++;
    const t = (s - run.s[i]) / (run.s[i + 1] - run.s[i] || 1);
    const [a, b] = [run.pts[i], run.pts[i + 1]];
    const nx = run.nrm[i][0] + (run.nrm[i + 1][0] - run.nrm[i][0]) * t;
    const nz = run.nrm[i][1] + (run.nrm[i + 1][1] - run.nrm[i][1]) * t;
    const l = Math.hypot(nx, nz) || 1;
    return { p: [a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t], n: [nx / l, 0, nz / l], b: [0, 1, 0] };
  };
  const path = [point(s0)];
  for (let i = 0; i < run.s.length; i++) {
    if (run.s[i] > s0 + 1 && run.s[i] < s1 - 1) path.push({ p: [run.pts[i][0], 0, run.pts[i][1]], n: [run.nrm[i][0], 0, run.nrm[i][1]], b: [0, 1, 0] });
  }
  path.push(point(s1));
  return path;
}

// The plan's walls, from the floor to the collision ceiling (no top or bottom: the floor and
// ceiling slabs close them): one convex solid per facet, a slab `thick` deep on the straight
// runs and a radial wedge out to WEDGE behind the wall on the curved ones.
export function wallColliders(L, solids) {
  const H = L.HALL.ceilingY;
  for (const run of planRuns(L)) {
    for (let i = 0; i + 1 < run.pts.length; i++) {
      const [a, b] = [run.pts[i], run.pts[i + 1]];
      let far;
      if (run.curved) {
        const [cx, cz] = run.centre;
        const k = (run.r + WEDGE) / run.r;
        far = [[cx + (b[0] - cx) * k, cz + (b[1] - cz) * k], [cx + (a[0] - cx) * k, cz + (a[1] - cz) * k]];
      } else {
        const [nx, nz] = run.nrm[i];
        far = [[b[0] - nx * L.HALL.thick, b[1] - nz * L.HALL.thick], [a[0] - nx * L.HALL.thick, a[1] - nz * L.HALL.thick]];
      }
      const foot = [a, b, ...far];
      const ring = (y) => foot.map(([x, z]) => [x, y, z]);
      const [lo, hi] = [ring(0), ring(H)];
      const polys = [];
      for (let k = 0; k < 4; k++) polys.push([lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]]);
      solids.solid(polys, 'stone');
    }
  }
}
