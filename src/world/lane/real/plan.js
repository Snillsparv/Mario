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
