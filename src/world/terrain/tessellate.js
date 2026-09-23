// Splits a regular XZ grid into triangles classified by signed scalar fields (value <= 0 is
// "inside"). Each grid cell becomes two triangles, and each triangle is clipped against the
// fields that `decide` asks for, one at a time, so the pieces follow the region contours
// (marching triangles). Contour crossings are computed once per edge and cached, so the
// pieces on both sides of a contour, and neighbouring cells, share exactly the same
// vertices: the result is crack-free by construction.
//
//   decide(sides) -> index of the next field to clip by, or a final label (null = discard)
//     sides[i] is true (inside), false (outside) or undefined (not clipped by field i yet)
//   emit(a, b, c, tags, label, sides)
//     a, b, c: vertices { id, x, z } counter-clockwise seen from above (+Y, front face up)
//     tags[k]: index of the field whose contour produced edge k (a->b, b->c, c->a), or -1
//   flip(i, j): grid cell (i, j) is split along its v01-v10 diagonal when true, else along
//     v00-v11 (default: alternating, so the grid has no directional bias)
//
// The interior of a piece lies to the (dz, -dx) side of each of its directed edges.
// Returns { grid: rows of grid vertices (grid[j][i]), vertexCount }.

const NUDGE = 0.5;

const alternate = (i, j) => ((i + j) & 1) === 1;

export function tessellate({ minX, minZ, cols, rows, step, fields, decide, emit, flip = alternate }) {
  const nf = fields.length;
  let nextId = 0;
  const vertex = (x, z) => ({ id: nextId++, x, z, f: new Float64Array(nf).fill(NaN) });

  // Field value at a vertex (cached). Values within NUDGE of zero are pushed outside, so a
  // contour running along a grid line (or grazing a vertex) never makes sliver triangles
  // thinner than about NUDGE units, which float32 positions could not represent.
  const value = (v, i) => {
    let f = v.f[i];
    if (Number.isNaN(f)) {
      f = fields[i](v.x, v.z);
      if (Math.abs(f) < NUDGE) f = NUDGE;
      v.f[i] = f;
    }
    return f;
  };

  // Crossing of field i's zero level on edge (u, w), linear in the vertex values.
  const cuts = new Map();
  const cut = (u, w, i) => {
    const lo = u.id < w.id ? u : w;
    const hi = lo === u ? w : u;
    const key = (lo.id * 2097152 + hi.id) * 16 + i;
    let v = cuts.get(key);
    if (!v) {
      const fl = value(lo, i);
      const t = fl / (fl - value(hi, i));
      v = vertex(lo.x + (hi.x - lo.x) * t, lo.z + (hi.z - lo.z) * t);
      v.f[i] = 0;
      cuts.set(key, v);
    }
    return v;
  };

  const withSide = (sides, i, inside) => {
    const s = sides.slice();
    s[i] = inside;
    return s;
  };

  const process = (a, b, c, tags, sides) => {
    const d = decide(sides);
    if (typeof d !== 'number') {
      if (d != null) emit(a, b, c, tags, d, sides);
      return;
    }
    const ia = value(a, d) <= 0;
    const ib = value(b, d) <= 0;
    const ic = value(c, d) <= 0;
    if (ia === ib && ib === ic) {
      process(a, b, c, tags, withSide(sides, d, ia));
      return;
    }
    // Rotate so L is the vertex alone on its side; M, N follow in winding order.
    let L, M, N, tLM, tMN, tNL;
    if (ib === ic) [L, M, N, tLM, tMN, tNL] = [a, b, c, tags[0], tags[1], tags[2]];
    else if (ia === ic) [L, M, N, tLM, tMN, tNL] = [b, c, a, tags[1], tags[2], tags[0]];
    else [L, M, N, tLM, tMN, tNL] = [c, a, b, tags[2], tags[0], tags[1]];
    const lonely = value(L, d) <= 0;
    const X = cut(L, M, d);
    const Y = cut(N, L, d);
    process(L, X, Y, [tLM, d, tNL], withSide(sides, d, lonely));
    const rest = withSide(sides, d, !lonely);
    process(X, M, N, [tLM, tMN, -1], rest);
    process(X, N, Y, [-1, tNL, d], rest);
  };

  const grid = [];
  for (let j = 0; j <= rows; j++) {
    const row = [];
    for (let i = 0; i <= cols; i++) row.push(vertex(minX + i * step, minZ + j * step));
    grid.push(row);
  }
  const none = [-1, -1, -1];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v00 = grid[j][i];
      const v10 = grid[j][i + 1];
      const v01 = grid[j + 1][i];
      const v11 = grid[j + 1][i + 1];
      if (flip(i, j)) {
        process(v00, v01, v10, none, []);
        process(v10, v01, v11, none, []);
      } else {
        process(v00, v11, v10, none, []);
        process(v00, v01, v11, none, []);
      }
    }
  }
  return { grid, vertexCount: nextId };
}
