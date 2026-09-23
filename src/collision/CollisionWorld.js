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
      const h = Math.hypot(nx, nz);
      s.hn = { x: nx / h, z: nz / h };
      // Project onto the plane most facing the normal for inside tests: 'x' uses (z,y), 'z' uses (x,y).
      s.axis = Math.abs(nx) > Math.abs(nz) ? 'x' : 'z';
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
        const key = cx + ',' + cz;
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
    return this.cells.get(Math.floor(x / cs) + ',' + Math.floor(z / cs));
  }

  // --------------------------------------------------------------- queries

  // Highest floor under (x, z) whose height is <= y + tol.
  // Returns { y, surface } where y = FLOOR_LOWER_LIMIT and surface = null if none.
  findFloor(x, y, z, tol = FLOOR_TOLERANCE) {
    const cell = this._cell(x, z);
    let bestY = FLOOR_LOWER_LIMIT;
    let best = null;
    if (cell) {
      for (const s of cell.floor) {
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
      for (const s of cell.ceil) {
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
    const walls = [];
    const cell = this._cell(x, z);
    if (!cell) return { x, z, walls };
    for (const s of cell.wall) {
      if (py < s.minY || py > s.maxY) continue;
      const hn = s.hn;
      // Horizontal signed distance of the point to the wall plane.
      const planeDist = s.normal.x * x + s.normal.y * py + s.normal.z * z + s.d;
      const hscale = Math.hypot(s.normal.x, s.normal.z);
      const offset = planeDist / hscale;
      if (offset < -radius || offset > radius) continue;
      if (!insideWall(s, x, py, z)) continue;
      const push = radius - offset;
      x += hn.x * push;
      z += hn.z * push;
      walls.push(s);
    }
    return { x, z, walls };
  }

  // Ray against all surfaces (for the camera). dir need not be normalized.
  // Returns { point:{x,y,z}, normal, distance, surface } or null.
  raycast(origin, dir, maxDist, { floors = true, walls = true, ceilings = true } = {}) {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    const seen = new Set();
    let best = null;
    let bestT = maxDist;
    const cs = this.cellSize;
    const steps = Math.ceil(maxDist / (cs * 0.5)) + 1;
    const visitCell = (cx, cz) => {
      const cell = this.cells.get(cx + ',' + cz);
      if (!cell) return;
      const lists = [];
      if (floors) lists.push(cell.floor);
      if (walls) lists.push(cell.wall);
      if (ceilings) lists.push(cell.ceil);
      for (const list of lists) {
        for (const s of list) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          const t = rayTri(origin.x, origin.y, origin.z, dx, dy, dz, s);
          if (t !== null && t >= 0 && t < bestT) {
            bestT = t;
            best = s;
          }
        }
      }
    };
    const visited = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(maxDist, (i * cs) / 2);
      const px = origin.x + dx * t;
      const pz = origin.z + dz * t;
      const ccx = Math.floor(px / cs);
      const ccz = Math.floor(pz / cs);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const key = ccx + ox + ',' + (ccz + oz);
          if (visited.has(key)) continue;
          visited.add(key);
          visitCell(ccx + ox, ccz + oz);
        }
      }
    }
    if (!best) return null;
    return {
      point: { x: origin.x + dx * bestT, y: origin.y + dy * bestT, z: origin.z + dz * bestT },
      normal: best.normal,
      distance: bestT,
      surface: best,
    };
  }

  // Water surface height at (x, z) or NO_WATER.
  waterLevelAt(x, z) {
    return this.waterFn ? this.waterFn(x, z) : NO_WATER;
  }

  // Nearest pole the point (x, y, z) is touching within `reach` (horizontal), or null.
  findPole(x, y, z, reach = 80) {
    let best = null;
    let bestD = reach;
    for (const p of this.poles) {
      if (y < p.y0 - 20 || y > p.y1) continue;
      const d = Math.hypot(x - p.x, z - p.z) - p.radius;
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

// Point-in-triangle for walls, projected on the plane most aligned with the wall.
function insideWall(s, x, y, z) {
  const a = s.a;
  const b = s.b;
  const c = s.c;
  // u coordinate: z for x-facing walls, x for z-facing walls; v coordinate: y.
  const ui = s.axis === 'x' ? 2 : 0;
  const pu = s.axis === 'x' ? z : x;
  const d1 = (b[ui] - a[ui]) * (y - a[1]) - (b[1] - a[1]) * (pu - a[ui]);
  const d2 = (c[ui] - b[ui]) * (y - b[1]) - (c[1] - b[1]) * (pu - b[ui]);
  const d3 = (a[ui] - c[ui]) * (y - c[1]) - (a[1] - c[1]) * (pu - c[ui]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
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
