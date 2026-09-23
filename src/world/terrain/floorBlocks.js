// Merged collision floors for flat-enough ground. Grid cells that lie wholly in one ground
// type (no region contour crosses them) are greedily merged into rectangles of up to
// maxCells x maxCells cells: grow along +X while the run stays planar, then along +Z. A
// rectangle is planar when the fine (rendered) mesh deviates from its two triangles by a
// range of at most `tol`; it becomes two collision triangles, lifted so they never dip below
// the rendered ground (a chord across a convex bump would otherwise sink blob shadows into
// the grass): feet may float up to `tol` above it. Cells not merged keep the fine tessellation's
// triangles (see covers()). Rectangles and cells tile the plane exactly in XZ, so there are
// no holes; heights along shared edges differ by at most `tol`, far below the floor-snap
// tolerance.
//
//   sample(x, z) -> { key, terrain, y, clear }
//     key: ground type (a rectangle must be uniform), terrain: collision tag, y: height,
//     clear: lower bound of the distance to the nearest region contour.
//   minClear: contours must stay this far from every vertex of a merged cell.

import { antiDiagonal } from './tessellate.js';

export function floorBlocks({ minX, minZ, cols, rows, step, maxCells, tol, minClear, sample }) {
  const samples = new Array((cols + 1) * (rows + 1));
  const at = (i, j) => {
    const k = j * (cols + 1) + i;
    samples[k] ??= sample(minX + i * step, minZ + j * step);
    return samples[k];
  };
  const covered = new Uint8Array(cols * rows);
  const positions = {};

  // Cell (i, j) can be merged into a rectangle of ground type `key`.
  const mergeable = (i, j, key) => {
    if (covered[j * cols + i]) return false;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const s = at(i + a, j + b);
      if (s.key !== key || s.clear < minClear) return false;
    }
    return true;
  };

  // Lift that puts the rectangle's two triangles (diagonal from (w,0) to (0,h)) on or above
  // the fine mesh everywhere inside it, or null when the two surfaces differ by a range of
  // more than tol. Both are piecewise linear, so their difference peaks at a fine vertex or
  // where the big diagonal crosses a fine edge (grid lines and each cell's own diagonal).
  const lift = (i0, j0, w, h) => {
    const Y = (a, b) => at(i0 + a, j0 + b).y;
    const c0 = Y(0, 0);
    const c1 = Y(w, 0);
    const c2 = Y(0, h);
    const c3 = Y(w, h);
    let lo = 0;
    let hi = 0;
    const check = (fine, big) => {
      lo = Math.min(lo, fine - big);
      hi = Math.max(hi, fine - big);
      return hi - lo <= tol;
    };
    const onDiagonal = (t) => c1 + t * (c2 - c1);
    for (let b = 0; b <= h; b++) {
      for (let a = 0; a <= w; a++) {
        const fx = a / w;
        const fz = b / h;
        const big = fx + fz <= 1 ? c0 + fx * (c1 - c0) + fz * (c2 - c0) : c3 + (1 - fx) * (c2 - c3) + (1 - fz) * (c1 - c3);
        if (!check(Y(a, b), big)) return null;
      }
    }
    // Big diagonal x = w(1 - t), z = h t (rectangle-local grid units) across grid lines...
    for (let a = 1; a < w; a++) {
      const t = (w - a) / w;
      const z = h * t;
      const b = Math.floor(z);
      if (z > b && !check(Y(a, b) + (z - b) * (Y(a, b + 1) - Y(a, b)), onDiagonal(t))) return null;
    }
    for (let b = 1; b < h; b++) {
      const t = b / h;
      const x = w * (1 - t);
      const a = Math.floor(x);
      if (x > a && !check(Y(a, b) + (x - a) * (Y(a + 1, b) - Y(a, b)), onDiagonal(t))) return null;
    }
    // ...and across each cell's own diagonal.
    for (let b = 0; b < h; b++) {
      for (let a = 0; a < w; a++) {
        const anti = antiDiagonal(i0 + a, j0 + b);
        if (anti && w === h) continue; // parallel to the big diagonal
        const t = anti ? (1 + a + b - w) / (h - w) : (w - a + b) / (w + h);
        const u = w * (1 - t) - a;
        const v = h * t - b;
        if (!(t > 0 && t < 1 && u > 0 && u < 1 && v > 0 && v < 1)) continue;
        const fine = anti ? Y(a, b + 1) + u * (Y(a + 1, b) - Y(a, b + 1)) : Y(a, b) + u * (Y(a + 1, b + 1) - Y(a, b));
        if (!check(fine, onDiagonal(t))) return null;
      }
    }
    return hi;
  };

  const emit = (i0, j0, w, h, dy) => {
    const x0 = minX + i0 * step;
    const z0 = minZ + j0 * step;
    const x1 = x0 + w * step;
    const z1 = z0 + h * step;
    const y = [at(i0, j0), at(i0 + w, j0), at(i0, j0 + h), at(i0 + w, j0 + h)].map((s) => s.y + dy);
    // Counter-clockwise from above (facing up).
    const out = (positions[at(i0, j0).terrain] ??= []);
    out.push(x0, y[0], z0, x0, y[2], z1, x1, y[1], z0);
    out.push(x1, y[1], z0, x0, y[2], z1, x1, y[3], z1);
    for (let j = j0; j < j0 + h; j++) covered.fill(1, j * cols + i0, j * cols + i0 + w);
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const key = at(i, j).key;
      if (!mergeable(i, j, key)) continue;
      let w = 1;
      while (w < maxCells && i + w < cols && mergeable(i + w, j, key) && lift(i, j, w + 1, 1) !== null) w++;
      let h = 1;
      const rowFits = (jj) => {
        for (let ii = i; ii < i + w; ii++) if (!mergeable(ii, jj, key)) return false;
        return true;
      };
      while (h < maxCells && j + h < rows && rowFits(j + h) && lift(i, j, w, h + 1) !== null) h++;
      if (w * h < 2) continue; // a lone cell gains nothing: keep its fine triangles
      emit(i, j, w, h, lift(i, j, w, h));
    }
  }

  return {
    // { terrain: flat xyz array } of the merged triangles.
    positions,
    // Whether the fine grid cell containing (x, z) is covered by a merged rectangle.
    covers(x, z) {
      const i = Math.floor((x - minX) / step);
      const j = Math.floor((z - minZ) / step);
      return i >= 0 && j >= 0 && i < cols && j < rows && covered[j * cols + i] === 1;
    },
  };
}
