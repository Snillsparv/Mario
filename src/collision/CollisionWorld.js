// Triangle-soup collision in the style of classic N64 platformers.
//
// Every triangle is classified by its unit normal:
//   floor   : n.y >  FLOOR_MIN_NY
//   ceiling : n.y < -FLOOR_MIN_NY
//   wall    : otherwise
// Triangles are bucketed into a uniform XZ grid. Queries are point based (floor/ceiling are
// vertical rays, walls are horizontal sphere pushes) which is exactly what an SM64-style
// character controller needs. See docs/ARCHITECTURE.md for the full contract.

import { CEIL_NONE, FLOOR_LOWER_LIMIT, FLOOR_TOLERANCE, NO_WATER } from '../core/constants.js';

export const FLOOR_MIN_NY = 0.1;
const CELL_SIZE = 1000;
const WALL_MARGIN = 200; // walls are inserted into cells within this distance so pushes near cell borders work
// Sideways extent tolerance for wall pushes, as a fraction of the pushed radius.
export const WALL_EDGE_MARGIN = 0.75;
// Grid cells are keyed by a number (no string building per query): cell coordinates are
// offset into [0, CELL_STRIDE) and packed as (cx + CELL_OFFSET) * CELL_STRIDE + cz + CELL_OFFSET.
const CELL_OFFSET = 1 << 15;
const CELL_STRIDE = 1 << 16;
const cellKey = (cx, cz) => (cx + CELL_OFFSET) * CELL_STRIDE + (cz + CELL_OFFSET);
// Shared result for findWalls when nothing was touched (callers only read it).
const NO_WALLS = Object.freeze([]);
const RAY_ALL = Object.freeze({});

// Surface kinds affect slope sliding and friction in player physics.
export const SURFACE = Object.freeze({
  DEFAULT: 'default',
  NOT_SLIPPERY: 'not_slippery',
  SLIPPERY: 'slippery',
  VERY_SLIPPERY: 'very_slippery',
  DEATH: 'death',
});

// Terrain kinds drive footstep sounds / particles.
export const TERRAIN = Object.freeze({
  GRASS: 'grass',
  STONE: 'stone',
  WOOD: 'wood',
  SAND: 'sand',
  WATER: 'water',
});

export class CollisionWorld {
  constructor({ cellSize = CELL_SIZE } = {}) {
    this.cellSize = cellSize;
    this.surfaces = [];
    this.cells = new Map();
    this.poles = [];
    this.waterFn = null;
    this.finalized = false;
    this._rayStamp = 0;
    this._rayBest = null; // raycast scratch: nearest surface and distance so far
    this._rayT = 0;
  }

  // ---------------------------------------------------------------- building

  // positions: flat array of xyz triples, 9 numbers per triangle (world space).
  addTriangles(positions, { surface = SURFACE.DEFAULT, terrain = TERRAIN.GRASS, flipped = false } = {}) {
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const a = [positions[i], positions[i + 1], positions[i + 2]];
      const b = [positions[i + 3], positions[i + 4], positions[i + 5]];
      const c = [positions[i + 6], positions[i + 7], positions[i + 8]];
      if (flipped) this._addTri(a, c, b, surface, terrain);
      else this._addTri(a, b, c, surface, terrain);
    }
  }

  // Adds every mesh under a THREE.Object3D, in world space. Per-mesh overrides:
  //   mesh.userData.collide === false  -> skipped
  //   mesh.userData.surface / terrain  -> override opts
  // Double sided materials are not duplicated: winding decides the facing, so author
  // colliders with outward (CCW, three.js default front face) winding.
  addObject(object3D, opts = {}) {
    object3D.updateMatrixWorld(true);
    const v = [0, 0, 0];
    object3D.traverse((node) => {
      if (!node.isMesh || node.userData.collide === false) return;
      const geo = node.geometry;
      const pos = geo.attributes.position;
      if (!pos) return;
      const e = node.matrixWorld.elements;
      const xf = (idx, out) => {
        const x = pos.getX(idx);
        const y = pos.getY(idx);
        const z = pos.getZ(idx);
        out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
        out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        return out;
      };
      // Mirrored transforms flip winding.
      const det =
        e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
      const flip = det < 0;
      const surface = node.userData.surface ?? opts.surface ?? SURFACE.DEFAULT;
      const terrain = node.userData.terrain ?? opts.terrain ?? TERRAIN.GRASS;
      const index = geo.index;
      const triCount = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        const a = xf(i0, v.slice());
        const b = xf(i1, v.slice());
        const c = xf(i2, v.slice());
        if (flip) this._addTri(a, c, b, surface, terrain);
        else this._addTri(a, b, c, surface, terrain);
      }
    });
  }

  // Collider descriptor used by world builders: { object3D } or { positions }, plus opts.
  addCollider(desc) {
    const opts = { surface: desc.surface, terrain: desc.terrain, flipped: desc.flipped };
    if (desc.object3D) this.addObject(desc.object3D, opts);
    if (desc.positions) this.addTriangles(desc.positions, opts);
  }

  // Vertical climbable pole (tree trunks etc).
  addPole({ x, z, y0, y1, radius = 40, kind = 'tree' }) {
    this.poles.push({ x, z, y0, y1, radius, kind });
  }

  // fn(x, z) -> water surface height, or NO_WATER.
  setWaterLevelFn(fn) {
    this.waterFn = fn;
  }

  _addTri(a, b, c, surface, terrain) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return; // degenerate
    nx /= len;
    ny /= len;
    nz /= len;
    const kind = ny > FLOOR_MIN_NY ? 'floor' : ny < -FLOOR_MIN_NY ? 'ceil' : 'wall';
    const s = {
      id: this.surfaces.length,
      kind,
      a,
      b,
      c,
      normal: { x: nx, y: ny, z: nz },
      d: -(nx * a[0] + ny * a[1] + nz * a[2]),
      minY: Math.min(a[1], b[1], c[1]),
      maxY: Math.max(a[1], b[1], c[1]),
      surface,
      terrain,
    };
    if (kind === 'wall') {
      s.ys = [a[1], b[1], c[1]]; // vertex heights for the extent test (wallContains)
      const h = Math.hypot(nx, nz);
      s.hscale = h; // |horizontal part of the unit normal|: plane distance -> horizontal distance
      s.hn = { x: nx / h, z: nz / h };
      // Horizontal tangent along the face; extent tests use (along-face, y) coordinates so
      // diagonal walls keep their true width.
      s.tx = -s.hn.z;
      s.tz = s.hn.x;
      s.pu = [a[0] * s.tx + a[2] * s.tz, b[0] * s.tx + b[2] * s.tz, c[0] * s.tx + c[2] * s.tz];
    }
    this.surfaces.push(s);
    const m = kind === 'wall' ? WALL_MARGIN : 0;
    const minX = Math.min(a[0], b[0], c[0]) - m;
    const maxX = Math.max(a[0], b[0], c[0]) + m;
    const minZ = Math.min(a[2], b[2], c[2]) - m;
    const maxZ = Math.max(a[2], b[2], c[2]) + m;
    const cs = this.cellSize;
    for (let cx = Math.floor(minX / cs); cx <= Math.floor(maxX / cs); cx++) {
      for (let cz = Math.floor(minZ / cs); cz <= Math.floor(maxZ / cs); cz++) {
        const key = cellKey(cx, cz);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = { floor: [], ceil: [], wall: [] };
          this.cells.set(key, cell);
        }
        cell[kind].push(s);
      }
    }
  }

  finalize() {
    // Sort floors by max height descending so findFloor can early-out cheaply in future.
    for (const cell of this.cells.values()) {
      cell.floor.sort((p, q) => q.maxY - p.maxY);
      cell.ceil.sort((p, q) => p.minY - q.minY);
    }
    this.finalized = true;
  }

  _cell(x, z) {
    const cs = this.cellSize;
    return this.cells.get(cellKey(Math.floor(x / cs), Math.floor(z / cs)));
  }

  // --------------------------------------------------------------- queries

  // Highest floor under (x, z) whose height is <= y + tol.
  // Returns { y, surface } where y = FLOOR_LOWER_LIMIT and surface = null if none.
  findFloor(x, y, z, tol = FLOOR_TOLERANCE) {
    const cell = this._cell(x, z);
    let bestY = FLOOR_LOWER_LIMIT;
    let best = null;
    if (cell) {
      const list = cell.floor;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.maxY <= bestY) continue;
        if (!insideXZ(s, x, z)) continue;
        const h = -(s.normal.x * x + s.normal.z * z + s.d) / s.normal.y;
        if (h > y + tol || h <= bestY) continue;
        bestY = h;
        best = s;
      }
    }
    return { y: bestY + 0, surface: best };
  }

  // Lowest ceiling above (x, z) whose height is >= y - tol.
  // Returns { y, surface } where y = CEIL_NONE and surface = null if none.
  findCeil(x, y, z, tol = FLOOR_TOLERANCE) {
    const cell = this._cell(x, z);
    let bestY = CEIL_NONE;
    let best = null;
    if (cell) {
      const list = cell.ceil;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.minY >= bestY) continue;
        if (!insideXZ(s, x, z)) continue;
        const h = -(s.normal.x * x + s.normal.z * z + s.d) / s.normal.y;
        if (h < y - tol || h >= bestY) continue;
        bestY = h;
        best = s;
      }
    }
    return { y: bestY + 0, surface: best };
  }

  // Pushes the point (x, y + offsetY, z) out of every wall within `radius` (horizontal).
  // Returns { x, z, walls } with the corrected x/z and the walls that were touched.
  findWalls(x, y, z, offsetY, radius) {
    const py = y + offsetY;
    let walls = NO_WALLS; // allocated on the first touch only
    const cell = this._cell(x, z);
    if (!cell) return { x, z, walls };
    const list = cell.wall;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (py < s.minY || py > s.maxY) continue;
      const n = s.normal;
      // Horizontal signed distance of the point to the wall plane.
      const offset = (n.x * x + n.y * py + n.z * z + s.d) / s.hscale;
      if (offset < -radius || offset > radius) continue;
      if (!wallContains(s, x, py, z, radius * WALL_EDGE_MARGIN)) continue;
      const push = radius - offset;
      x += s.hn.x * push;
      z += s.hn.z * push;
      if (walls === NO_WALLS) walls = [];
      walls.push(s);
    }
    return { x, z, walls };
  }

  // Ray against all surfaces (for the camera). dir need not be normalized.
  // Walks the XZ grid cells the ray crosses (every surface is bucketed into each cell its
  // XZ extent overlaps, so this is exact) and stamps surfaces to test each only once.
  // Returns { point:{x,y,z}, normal, distance, surface } or null.
  raycast(origin, dir, maxDist, opts = RAY_ALL) {
    const floors = opts.floors !== false;
    const walls = opts.walls !== false;
    const ceilings = opts.ceilings !== false;
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len < 1e-9) return null;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const stamp = (this._rayStamp = (this._rayStamp + 1) | 0 || 1);
    const cs = this.cellSize;
    this._rayBest = null;
    this._rayT = maxDist;

    let cx = Math.floor(ox / cs);
    let cz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-12 ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-12 ? cs / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-12 ? ((cx + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-12 ? ((cz + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
    for (;;) {
      const cell = this.cells.get(cellKey(cx, cz));
      if (cell) {
        if (floors) this._rayList(cell.floor, stamp, ox, oy, oz, dx, dy, dz);
        if (walls) this._rayList(cell.wall, stamp, ox, oy, oz, dx, dy, dz);
        if (ceilings) this._rayList(cell.ceil, stamp, ox, oy, oz, dx, dy, dz);
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      // Stop once the nearest hit lies inside the cells already visited.
      if (tExit >= this._rayT) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    const best = this._rayBest;
    if (!best) return null;
    const bestT = this._rayT;
    this._rayBest = null;
    return {
      point: { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT },
      normal: best.normal,
      distance: bestT,
      surface: best,
    };
  }

  // Tests one cell list for raycast(): surfaces already tested by this ray (same stamp) are
  // skipped; the nearest hit so far is kept in _rayBest/_rayT.
  _rayList(list, stamp, ox, oy, oz, dx, dy, dz) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.rayStamp === stamp) continue;
      s.rayStamp = stamp;
      const t = rayTri(ox, oy, oz, dx, dy, dz, s);
      if (t !== null && t >= 0 && t < this._rayT) {
        this._rayT = t;
        this._rayBest = s;
      }
    }
  }

  // Water surface height at (x, z) or NO_WATER.
  waterLevelAt(x, z) {
    return this.waterFn ? this.waterFn(x, z) : NO_WATER;
  }

  // Nearest pole the point (x, y, z) is touching within `reach` (horizontal), or null.
  findPole(x, y, z, reach = 80) {
    let best = null;
    let bestD = reach;
    const poles = this.poles;
    for (let i = 0; i < poles.length; i++) {
      const p = poles[i];
      if (y < p.y0 - 20 || y > p.y1) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz) - p.radius; // (Math.hypot allocates in V8)
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // Height of a surface's plane at (x, z) (floors/ceilings).
  static planeHeight(s, x, z) {
    return -(s.normal.x * x + s.normal.z * z + s.d) / s.normal.y;
  }
}

// Point-in-triangle in the XZ projection, winding agnostic.
function insideXZ(s, x, z) {
  const a = s.a;
  const b = s.b;
  const c = s.c;
  const d1 = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
  const d2 = (c[0] - b[0]) * (z - b[2]) - (c[2] - b[2]) * (x - b[0]);
  const d3 = (a[0] - c[0]) * (z - c[2]) - (a[2] - c[2]) * (x - c[0]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Whether (x, y, z) lies within wall s's extent, measured in the wall's own face
// coordinates (distance along the face, height). `margin` widens the extent sideways so a
// body just past a wall's vertical edge is still pushed: without it, points in the wedge
// outside a convex corner (box corners, polygonal posts and towers) touch neither face.
export function wallContains(s, x, y, z, margin = 0) {
  const pu = x * s.tx + z * s.tz;
  const P = s.pu;
  const ys = s.ys ?? (s.ys = [s.a[1], s.b[1], s.c[1]]);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 3; i++) {
    const j = i === 2 ? 0 : i + 1;
    const y0 = ys[i];
    const y1 = ys[j];
    if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
    if (y0 === y1) {
      lo = Math.min(lo, P[i], P[j]);
      hi = Math.max(hi, P[i], P[j]);
    } else {
      const u = P[i] + ((P[j] - P[i]) * (y - y0)) / (y1 - y0);
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
  }
  return lo <= hi && pu >= lo - margin && pu <= hi + margin;
}

// Möller–Trumbore, two sided. Returns t or null.
function rayTri(ox, oy, oz, dx, dy, dz, s) {
  const a = s.a;
  const b = s.b;
  const c = s.c;
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const tx = ox - a[0];
  const ty = oy - a[1];
  const tz = oz - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t;
}
