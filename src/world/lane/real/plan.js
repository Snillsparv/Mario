// Sparrow Lane's ground plan in 2D ([x, z] outlines, pure): the road's pieces and the helpers its
// builders share, used by the classic build (lane/build.js: the road, the kerbs, the lawns cut
// round it) and by the realistic look's worker (world/lane/real/garden.js: its granite kerbs
// along the very same edges).
//
//   roadPieces(L) -> [outline]               // the carriageway (on past the junction into the
//                                            // fog), the turning area's apron (APRON.pieces:
//                                            // its rounded rectangle and the quads under its
//                                            // north kerb's S), the side road
//   band(line, from, to) -> [quad]           // a band along a polyline (below)
//   normals(outline) -> [[nx, nz]]           // each edge's outward unit normal (convex, either
//                                            // winding)
//   inside(outline, x, z) -> boolean         // inside a convex outline (either winding)
//   polyArea(outline) -> signed area         // positive counter-clockwise (x right, z up)
//   kerbRuns(L, road) -> [{ p, q, n, kind }] // the kerbs (below)
//   bevelEnds(runs, G) -> [{ kind, pts, facing }]  // the drops' and edges' bevels closed at their
//                                            // ends (below; BEVEL: how far in front they run)
//   terraceSpans(L) -> [{ plot, spans }]     // the terraces' fronts (below)
//   bedStones(L) -> [{ x, y, z, s, k, a, pink }]   // the dad's red-leaf bed's field stones (below)
//   redTreeStems(T) -> [[x, y, z, w]]        // the red-leaf tree's stems (layout RED_TREE): from its
//                                            // fork out to each end, w thick (both looks)
//   redTreeCrown(T) -> [{ c, r }]            // its crown's blobs (middle, radii), sparse
//   ivyMasses(L) -> [{ c, r }]               // the ivy mound's lumps (layout IVY)
//   chainFaces(h) -> [face]                  // a chain house's drawn faces (a wing's joined end
//                                            // left out: lane/layout.js DAD_WINGS)
//   brickSpans(h, face, half) -> [[u0, u1, brick?]]   // a face's spans, split at its brick
//                                            // ranges (h.brick[face]: white brick to the eaves)

import { makeRng } from '../../../core/math.js';

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

export function roadPieces({ ROAD, ROAD_DRAWN, APRON, SIDE_ROAD: S }) {
  const pieces = band(ROAD_DRAWN, -ROAD.half, ROAD.half);
  pieces.push(...APRON.pieces);
  const [dx, dz] = S.dir;
  const end = [S.x + dx * S.len, S.z + dz * S.len];
  pieces.push(...band([[S.x - dx * 300, S.z - dz * 300], end], -S.half, S.half));
  return pieces;
}

// The kerbs' runs (both builds draw theirs along them: lane/build.js kerbs, garden.js kerbs):
// every edge of every piece clipped exactly to where it is the road's edge (outside every other
// piece, a hair out from it: no stub of kerb into the road where two pieces meet, no gap at a
// corner), then split where a drive's or the dad's bed's span begins or ends: { p, q, n (the
// edge's outward normal), kind: 'kerb' (granite: the north side and round the apron's north and
// east), 'drop' (dropped flush at a drive or the double garage's forecourt), 'bed' (no kerb: the
// dad's corner bed's field stones edge the asphalt) or 'edge' (no kerb: along the whole south
// side, the edges facing south, the asphalt's bevelled edge up to the lawns) }.
const KERB_SPANS = (L) => [
  { x0: L.DAD_DRIVE.x0, x1: L.DAD_DRIVE.x1, south: true, kind: 'drop' },
  { x0: L.LINK_DRIVE.x0, x1: L.LINK_DRIVE.x1, south: true, kind: 'drop' },
  ...L.PLOTS_N.map((p) => ({ x0: p.drive[0], x1: p.drive[1], south: false, kind: 'drop' })),
  { x0: L.FORECOURT.x0 - 10, x1: L.FORECOURT.x0 + 10, z0: L.FORECOURT.z0, z1: L.FORECOURT.z1, kind: 'drop' },
  { x0: L.BED.x0, x1: L.BED.x1, south: true, kind: 'bed' },
  // (The apron's south-west corner rounds onto south_2's lawn: its edge, like the south edge's.)
  { x0: L.APRON.x0, x1: L.APRON.x0 + L.APRON.sw, z0: L.APRON.z1 - L.APRON.sw, z1: L.APRON.z1, kind: 'edge' },
];
// The edges facing south (an outward normal's z over this) have no kerb.
const SOUTH_FACING = 0.5;

export function kerbRuns(L, road) {
  const spans = KERB_SPANS(L);
  const kindAt = (x, z, n) => spans.find((d) => x >= d.x0 && x <= d.x1 && (d.z0 !== undefined ? z >= d.z0 && z <= d.z1 : d.south === z > 0 && Math.abs(z) < 2000))?.kind ?? (n[1] > SOUTH_FACING ? 'edge' : 'kerb');
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
          const kind = kindAt(...at((u0 + u1) / 2), n);
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

// The bevels' ends (both builds close them beside their bevels: lane/build.js kerbs, garden.js
// kerbs). A drop's or an edge's bevel runs from its edge at GROUND down to 0.4 at BEVEL in front of
// it; where it ends with no other bevel carrying on over its end (at a kerb or the bed, at a free
// end, on the inside of a corner) its cross-section was open, the one-sided road and lawn behind
// it showing the sky. Closed there: on the inside of a corner between two bevels a fan from the
// corner's top round to both feet (in the first one's kind), anywhere else an end face from the
// bevel down to under the road. -> [{ kind, pts: [[x, y, z]], facing }] each a convex polygon
// wound counter-clockwise seen from `facing` (its outward direction).
export const BEVEL = 22;

export function bevelEnds(runs, G) {
  const ends = runs
    .filter((r) => r.kind === 'drop' || r.kind === 'edge')
    .flatMap((run) => [[run.p, run.q], [run.q, run.p]].map(([s, o]) => {
      const l = Math.hypot(o[0] - s[0], o[1] - s[1]);
      return { run, s, t: [(o[0] - s[0]) / l, (o[1] - s[1]) / l] }; // (t: into the run)
    }));
  const foot = (s, [nx, nz], y = 0.4) => [s[0] - nx * BEVEL, y, s[1] - nz * BEVEL];
  const wound = (pts, facing) => {
    const [a, b, c] = pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return f[0] * facing[0] + f[1] * facing[1] + f[2] * facing[2] < 0 ? [pts[0], ...pts.slice(1).reverse()] : pts;
  };
  const out = [];
  ends.forEach((e, i) => {
    const { run: A, s, t } = e;
    const met = ends.filter((f) => f.run !== A && Math.hypot(f.s[0] - s[0], f.s[1] - s[1]) < 2);
    // (Straight on, or round a corner turning its way, another bevel covers this end.)
    const turn = (f) => -(A.n[0] * f.t[0] + A.n[1] * f.t[1]);
    if (met.some((f) => turn(f) > -1e-3)) return;
    const inner = met.find((f) => turn(f) <= -1e-3);
    if (inner) {
      if (ends.indexOf(inner) < i) return; // (each corner's fan once)
      const B = inner.run;
      const a = Math.acos(Math.max(-1, Math.min(1, A.n[0] * B.n[0] + A.n[1] * B.n[1])));
      const segs = Math.max(1, Math.ceil(a / (Math.PI / 6)));
      const top = [s[0], G, s[1]];
      const feet = [];
      for (let k = 0; k <= segs; k++) {
        const [nx, nz] = [A.n[0] + (B.n[0] - A.n[0]) * (k / segs), A.n[1] + (B.n[1] - A.n[1]) * (k / segs)];
        const l = Math.hypot(nx, nz);
        feet.push(foot(s, [nx / l, nz / l]));
      }
      for (let k = 0; k < segs; k++) {
        const pts = [top, feet[k], feet[k + 1]];
        const [dx, dz] = [(feet[k][0] + feet[k + 1][0]) / 2 - s[0], (feet[k][2] + feet[k + 1][2]) / 2 - s[1]];
        const facing = [dx, (BEVEL * BEVEL) / (G - 0.4), dz];
        out.push({ kind: A.kind, pts: wound(pts, facing), facing });
      }
      return;
    }
    const facing = [-t[0], 0, -t[1]];
    out.push({ kind: A.kind, pts: wound([[s[0], G, s[1]], foot(s, A.n), foot(s, A.n, -1), [s[0], -1, s[1]]], facing), facing });
  });
  return out;
}

// The terraces' fronts (both builds: lane/build.js terraces and the lawn's holes, the realistic
// coping, hardware.js): per plot (west to east), its front from x0 to x1 cut where the wall's line
// bends (NORTH.wall's points) and at its steps and its drive: { plot, spans: [{ a, b, za, zb,
// kind }] }, kind 'wall' (its front on the wall's line, za at a and zb at b), 'steps' or 'drive'
// (za, zb: the wall's line at their ends).
export function terraceSpans(L) {
  const bends = L.NORTH.wall.map(([x]) => x);
  return L.PLOTS_N.map((plot) => {
    const cuts = [[...plot.steps, 'steps'], [...plot.drive, 'drive']].sort((p, q) => p[0] - q[0]);
    const spans = [];
    const span = (a, b, kind) => {
      if (b - a >= 1) spans.push({ a, b, za: L.wallZAt(a + 0.01), zb: L.wallZAt(b - 0.01), kind });
    };
    const wall = (a, b) => {
      const xs = [a, ...bends.filter((x) => x > a && x < b), b];
      for (let i = 0; i + 1 < xs.length; i++) span(xs[i], xs[i + 1], 'wall');
    };
    let x = plot.x0;
    for (const [a, b, kind] of cuts) {
      wall(x, a);
      span(a, b, kind);
      x = b;
    }
    wall(x, plot.x1);
    return { plot, spans };
  });
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
  const S = L.TURN_SIGN;
  const put = (x, y, z, s, a) => {
    const st = { x, y, z, s, e: 1 + 0.35 * R(), h: 0.8 + 0.35 * R(), a: a + (R() - 0.5) * 0.5, k: 0.68 + 0.5 * R(), pink: R() < 0.3 };
    // (None on the sign's post: one in its way moves aside along x, or is left out.)
    const clear = s * st.e + S.collider + 4;
    const dz = Math.abs(z - S.z);
    if (Math.hypot(x - S.x, dz) < clear) {
      if (dz >= clear) return;
      st.x = S.x + Math.sign(x - S.x || 1) * Math.sqrt(clear * clear - dz * dz);
      if (out.some((o) => Math.hypot(o.x - st.x, o.z - st.z) < (o.s + s) * 0.8)) return;
    }
    out.push(st);
  };
  const size = () => 20 + 14 * R() ** 1.4 + (R() < 0.15 ? 10 : 0);
  // Along the asphalt (sitting on the road against the soil's face), then up the drive's side,
  // round the back (its rounded corners) and down the path's side: a row each, the biggest at
  // the north-east corner by the sign.
  for (let d = 24; d < B.x1 - B.x0 - 16; ) {
    const s = size() * 0.85 + (d < 130 ? 12 : 0);
    put(B.x1 - d, -3, B.z0 + s * 0.5, s, 0);
    d += s * 1.35 + 2 + 6 * R();
  }
  const ring = L.bedOutline(4);
  const len = (i) => Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
  for (let i = 1; i < ring.length; i++) {
    const [[ax, az], [bx, bz]] = [ring[i], ring[(i + 1) % ring.length]];
    const l = len(i);
    const [ux, uz] = [(bx - ax) / l, (bz - az) / l];
    for (let d = i === 1 ? 50 : 14; d < l - 14; ) {
      const s = size() * 0.85;
      // (Inside the edge by half a stone: the outline runs round counter-clockwise, its inside on
      // the left.)
      put(ax + ux * d - uz * s * 0.5, G - 3, az + uz * d + ux * s * 0.5, s, Math.atan2(uz, ux));
      d += s * 1.6 + 6 + 10 * R();
    }
  }
  return out;
}

export function redTreeStems(T) {
  // Four stems leaning out from the fork, each [x, y, z, w] at its end: long, rising to the
  // crown's middle height, spread round the trunk (none straight over its top).
  const C = T.canopy;
  return [[0.5, 0.55, 640, 17], [2.0, 0.5, 600, 15], [-1.1, 0.6, 680, 16], [3.5, 0.45, 560, 13]].map(([a, out, y, w]) => [T.x + Math.sin(a) * C.r * out, y, T.z + Math.cos(a) * C.r * out, w]);
}

export function redTreeCrown(T) {
  // Small blobs spread wide like an open umbrella: the outer ones lower (the limbs droop), the
  // inner ones higher, none low over the trunk's top.
  const C = T.canopy;
  const R = makeRng(4517);
  const out = [];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996 + R() * 0.5;
    const k = 0.3 + 0.7 * Math.sqrt((i + 0.5) / 14) * (0.85 + 0.15 * R());
    const d = C.r * k;
    const y = C.y1 - (C.y1 - C.y0) * (0.08 + 0.5 * k * k + 0.1 * R());
    const r = C.r * (0.24 + 0.08 * R());
    out.push({ c: [T.x + Math.sin(a) * d, y, T.z + Math.cos(a) * d], r: [r, r * (0.55 + 0.2 * R()), r] });
  }
  return out;
}

// A chain house's faces that are drawn: all four, but a wing's end that runs into the main body
// (`join`: its +u end, the 'right' face, stands inside it).
export const chainFaces = (h) => (h.join ? ['front', 'back', 'left'] : ['front', 'back', 'left', 'right']);

// A face's spans across (-half..half) split where its brick ranges (h.brick[name]: [u0, u1], white
// brick to the eaves) begin and end: [[u0, u1, brick?]].
export function brickSpans(h, name, half) {
  const ranges = (h.brick?.[name] ?? []).map(([a, b]) => [Math.max(-half, Math.min(a, b)), Math.min(half, Math.max(a, b))]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  let u = -half;
  for (const [a, b] of ranges) {
    if (a > u) out.push([u, a, false]);
    out.push([Math.max(u, a), b, true]);
    u = b;
  }
  if (u < half) out.push([u, half, false]);
  return out;
}

// The ivy mound's masses ({ c, r }: three lumps along the front's east pier and round the corner
// onto the gable; both looks draw them, lane/props.js too).
export function ivyMasses(L) {
  const I = L.IVY;
  const G = L.GROUND;
  // (Two lumps along the pier, one round the corner onto the gable, and a sheet climbing the
  // pier flat against the wall up to the gutter.)
  return [
    { c: [I.x - I.rx * 0.45, G + I.h * 0.43, I.z + 40], r: [I.rx * 0.62, I.h * 0.44, I.rz * 0.7] },
    { c: [I.x + I.rx * 0.2, G + I.h * 0.46, I.z + 30], r: [I.rx * 0.6, I.h * 0.47, I.rz * 0.78] },
    { c: [L.DAD.x1 + 45, G + I.h * 0.42, L.DAD.z0 - 30], r: [I.rx * 0.38, I.h * 0.43, I.rz * 0.68] },
    { c: [I.x - I.rx * 0.15, G + I.h * 0.74, L.DAD.z0 - 22], r: [I.rx * 0.85, I.h * 0.25, 34] },
  ];
}
