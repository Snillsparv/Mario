// Where rain lands: the top surface (highest floor, or the water surface above it) at a
// point, memoised on a coarse grid so the rain's splashes cost one collision query per
// grid cell for the whole session instead of one per splash.

import { FLOOR_LOWER_LIMIT, NO_WATER } from '../core/constants.js';

const UNKNOWN = -1e9;

export class HeightCache {
  // collision: { findFloor(x, y, z, tol), waterLevelAt(x, z) } (CollisionWorld), or null to
  // use layout.groundHeight / layout.waterLevelAt instead.
  constructor({ collision = null, layout = null, cell = 100, extent = 10000, top = 30000 } = {}) {
    this.collision = collision;
    this.layout = layout;
    this.cell = cell;
    this.extent = extent;
    this.top = top;
    this.n = Math.ceil((2 * extent) / cell);
    this.heights = new Float32Array(this.n * this.n).fill(UNKNOWN);
    this.flags = new Uint8Array(this.n * this.n); // 1 = water
    this.queries = 0; // collision queries made (tests / tuning)
    // lookup() reads the point from qx, qz and leaves the result in y (FLOOR_LOWER_LIMIT when
    // nothing is there) and water: no float crosses a call, so nothing is allocated per query.
    this.qx = 0.5;
    this.qz = 0.5;
    this.y = 0.5;
    this.water = false;
  }

  // Top surface at (x, z): returns y and sets this.y / this.water.
  sample(x, z) {
    this.qx = x;
    this.qz = z;
    this.lookup();
    return this.y;
  }

  // The top surface at (this.qx, this.qz) into this.y / this.water.
  lookup() {
    const x = this.qx;
    const z = this.qz;
    const cs = this.cell;
    const i = Math.floor((x + this.extent) / cs);
    const j = Math.floor((z + this.extent) / cs);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) {
      this.query(x, z); // off the grid: uncached
      return;
    }
    const k = j * this.n + i;
    const h = this.heights[k];
    if (h !== UNKNOWN) {
      this.y = h;
      this.water = this.flags[k] === 1;
      return;
    }
    // Sample the cell centre, so every point in the cell agrees.
    this.query((i + 0.5) * cs - this.extent, (j + 0.5) * cs - this.extent);
    this.heights[k] = this.y;
    this.flags[k] = this.water ? 1 : 0;
  }

  query(x, z) {
    this.queries++;
    let floor = FLOOR_LOWER_LIMIT;
    let water = NO_WATER;
    if (this.collision) {
      floor = this.collision.findFloor(x, this.top, z).y;
      water = this.collision.waterLevelAt(x, z);
    } else if (this.layout) {
      floor = this.layout.groundHeight?.(x, z) ?? FLOOR_LOWER_LIMIT;
      water = this.layout.waterLevelAt?.(x, z) ?? NO_WATER;
    }
    const wet = Number.isFinite(water) && water > NO_WATER && water >= floor;
    this.water = wet;
    this.y = wet ? water : floor;
  }

  clear() {
    this.heights.fill(UNKNOWN);
  }
}

export const NOTHING_BELOW = FLOOR_LOWER_LIMIT;
