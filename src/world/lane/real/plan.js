// Sparrow Lane's ground plan in 2D ([x, z] outlines, pure): the road's pieces and the helpers its
// builders share, used by the classic build (lane/build.js: the road, the kerbs, the lawns cut
// round it) and by the realistic look's worker (world/lane/real/garden.js: its granite kerbs
// along the very same edges).
//
//   roadPieces(L, { round }?) -> [outline]   // the carriageway (on past the junction into the
//                                            // fog), the turning area, the side road; round: the
//                                            // turning area drawn round (TURN_ROUND sides at the
//                                            // mean of the collider's 16-gon's radii, so it
//                                            // strays at most ~11 from it) instead of its 16-gon
//   band(line, from, to) -> [quad]           // a band along a polyline (below)
//   normals(outline) -> [[nx, nz]]           // each edge's outward unit normal (convex, either
//                                            // winding)
//   inside(outline, x, z) -> boolean         // inside a convex outline (either winding)
//   polyArea(outline) -> signed area         // positive counter-clockwise (x right, z up)
//   kerbRuns(L, road) -> [{ p, q, n, kind }] // the kerbs (below)
//   bedStones(L) -> [{ x, y, z, s, k, a, pink }]   // the dad's corner bed's field stones (below)

import { makeRng } from '../../../core/math.js';

export const TURN_ROUND = 64;

export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function normals(outline) {
  const s = polyArea(outline) > 0 ? 1 : -1;
  return outline.map(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(s * (bz - az)) / l, (-s * (bx - ax)) / l];
  });
}

export function inside(poly, x, z) {
  const s = polyArea(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    if (s * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 0) return false;
  }
  return true;
}

// A band either side of a polyline, from offset `from` to `to` along each segment's left normal
// (dz, -dx) (negative offsets: its right), mitred at the joints: one convex quad per segment.
export function band(line, from, to) {
  const n = line.length;
  const segN = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dz = line[i + 1][1] - line[i][1];
    const l = Math.hypot(dx, dz);
    segN.push([dz / l, -dx / l]);
  }
  // Each joint's mitre: the mean of its segments' normals, lengthened to keep the offset.
  const mitre = line.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    const mx = a[0] + b[0];
    const mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    const k = 1 / ((mx / ml) * a[0] + (mz / ml) * a[1]);
    return [(mx / ml) * k, (mz / ml) * k];
  });
  const off = (i, d) => [line[i][0] + mitre[i][0] * d, line[i][1] + mitre[i][1] * d];
  const quads = [];
  for (let i = 0; i + 1 < n; i++) quads.push([off(i, from), off(i + 1, from), off(i + 1, to), off(i, to)]);
  return quads;
}

export function roadPieces({ ROAD, ROAD_DRAWN, TURN, SIDE_ROAD: S }, { round = false } = {}) {
  const pieces = band(ROAD_DRAWN, -ROAD.half, ROAD.half);
  const sides = round ? TURN_ROUND : TURN.sides;
  const r = round ? (TURN.r * (1 + Math.cos(Math.PI / TURN.sides))) / 2 : TURN.r;
  const disc = Array.from({ length: sides }, (_, i) => {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    return [TURN.x + Math.sin(a) * r, TURN.z + Math.cos(a) * r];
  });
  pieces.push(disc);
  const [dx, dz] = S.dir;
  const end = [S.x + dx * S.len, S.z + dz * S.len];
  pieces.push(...band([[S.x - dx * 300, S.z - dz * 300], end], -S.half, S.half));
  return pieces;
}

// The kerbs' runs (both builds draw theirs along them: lane/build.js kerbs, garden.js kerbs):
// every edge of every piece clipped exactly to where it is the road's edge (outside every other
// piece, a hair out from it: no stub of kerb into the road where two pieces meet, no gap at a
// corner), then split where a drive's or the dad's bed's span begins or ends: { p, q, n (the
// edge's outward normal), kind: 'kerb' (granite), 'drop' (dropped flush at a drive) or 'bed' (no
// kerb: the dad's corner bed's field stones edge the asphalt) }.
const KERB_SPANS = (L) => [
  { x0: L.DAD_DRIVE.x0, x1: L.DAD_DRIVE.x1, south: true, kind: 'drop' },
  { x0: L.LINK_DRIVE.x0, x1: L.LINK_DRIVE.x1, south: true, kind: 'drop' },
  ...L.PLOTS_N.map((p) => ({ x0: p.drive[0], x1: p.drive[1], south: false, kind: 'drop' })),
  { x0: L.TURN.x + 800, x1: L.TURN.x + 2000, z0: -900, z1: 150, kind: 'drop' },
  { x0: L.BED.x1 - L.BED.rx, x1: L.BED.x1, south: true, kind: 'bed' },
];

export function kerbRuns(L, road) {
  const spans = KERB_SPANS(L);
  const kindAt = (x, z) => spans.find((d) => x >= d.x0 && x <= d.x1 && (d.z0 !== undefined ? z >= d.z0 && z <= d.z1 : d.south === z > 0))?.kind ?? 'kerb';
  const cuts = [...new Set(spans.flatMap((d) => (d.z0 !== undefined ? [d.z0, d.z1] : [])).concat(0))];
  const xs = [...new Set(spans.flatMap((d) => [d.x0, d.x1]))];
  const runs = [];
  for (const piece of road) {
    const ns = normals(piece);
    piece.forEach(([ax, az], i) => {
      const [bx, bz] = piece[(i + 1) % piece.length];
      const n = ns[i];
      const [dx, dz] = [bx - ax, bz - az];
      const len = Math.hypot(dx, dz);
      // Where (a hair out from it) the edge runs inside another piece: Cyrus-Beck against each.
      const covered = [];
      for (const o of road) {
        if (o === piece) continue;
        const on = normals(o);
        let [lo, hi] = [0, 1];
        for (let j = 0; j < o.length && lo < hi; j++) {
          const [mx, mz] = on[j];
          const c = mx * (ax + n[0] - o[j][0]) + mz * (az + n[1] - o[j][1]);
          const k = mx * dx + mz * dz;
          if (Math.abs(k) < 1e-9) {
            if (c > 0) hi = -1;
          } else if (k > 0) hi = Math.min(hi, -c / k);
          else lo = Math.max(lo, -c / k);
        }
        if (lo < hi) covered.push([lo, hi]);
      }
      covered.sort((a, b) => a[0] - b[0]);
      // The edge's own stretches, each split where a span begins or ends.
      const open = [];
      let t = 0;
      for (const [lo, hi] of covered) {
        if (lo > t) open.push([t, lo]);
        t = Math.max(t, hi);
      }
      if (t < 1) open.push([t, 1]);
      const at = (u) => [ax + dx * u, az + dz * u];
      for (const [t0, t1] of open) {
        if ((t1 - t0) * len < 2) continue; // (a sliver at a corner)
        const ts = [t0, t1];
        for (const x of xs) if (Math.abs(dx) > 1e-9) ts.push((x - ax) / dx);
        for (const z of cuts) if (Math.abs(dz) > 1e-9) ts.push((z - az) / dz);
        const marks = ts.filter((u) => u >= t0 && u <= t1).sort((a, b) => a - b);
        let run = null;
        for (let k = 0; k + 1 < marks.length; k++) {
          const [u0, u1] = [marks[k], marks[k + 1]];
          if (u1 - u0 < 1e-9) continue;
          const kind = kindAt(...at((u0 + u1) / 2));
          if (run && run.kind === kind) run.u1 = u1;
          else {
            if (run) runs.push(run);
            run = { u0, u1, kind };
          }
        }
        if (run) runs.push(run);
      }
      for (const r of runs) if (!r.p) Object.assign(r, { p: at(r.u0), q: at(r.u1), n });
    });
  }
  return runs.map(({ p, q, n, kind }) => ({ p, q, n, kind }));
}

// The dad's corner bed's field stones (both looks draw them here: lane/props.js dadsGarden,
// garden.js bedStones): round, grey or pink, close set along its two asphalt edges (sitting on
// the road along the street's, on the drive along his drive's, over the bed's soil face) and
// sparser round its lawn side, no two alike: each its foot's middle (x, y, z), its size s, how
// much longer than wide along the edge e, how squat h, its turn a (along the edge), a shade k.
export function bedStones(L) {
  const { BED: B, GROUND: G } = L;
  const R = makeRng(331);
  const out = [];
  const put = (x, y, z, s, a) => out.push({ x, y, z, s, e: 1 + 0.35 * R(), h: 0.8 + 0.35 * R(), a: a + (R() - 0.5) * 0.5, k: 0.68 + 0.5 * R(), pink: R() < 0.35 });
  // Along the asphalt: from the corner (round the sign's post) out along each edge.
  const size = () => 22 + 14 * R() ** 1.4 + (R() < 0.15 ? 10 : 0);
  for (const [len, at, a] of [[B.rx, (d, s) => [B.x1 - d, -3, B.z0 + s * 0.5], 0], [B.rz, (d, s) => [B.x1 - s * 0.5, G - 3, B.z0 + d], Math.PI / 2]]) {
    for (let d = 40; d < len - 30; ) {
      const s = size();
      const [x, y, z] = at(d, s);
      put(x, y, z, s, a);
      d += s * 1.55 + 3 + 9 * R();
    }
  }
  // Round the lawn side, every ~110.
  const n = Math.round((Math.PI / 4) * (B.rx + B.rz) / 110);
  for (let i = 1; i < n; i++) {
    const t = (i / n) * (Math.PI / 2) + (R() - 0.5) * 0.04;
    put(B.x1 - (B.rx - 18) * Math.sin(t), G - 3, B.z0 + (B.rz - 18) * Math.cos(t), 16 + 12 * R(), Math.atan2(B.rz * Math.sin(t), B.rx * Math.cos(t)));
  }
  return out;
}
