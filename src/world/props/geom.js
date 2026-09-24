// Small geometry + collider toolkit for the props.
//
// MeshBuilder collects triangles for one material (position, normal, uv, colour [+ alpha]
// [+ fade group]) and turns them into a non-indexed BufferGeometry, so every prop of a
// material ends up in a single draw call. Collider helpers append world-space triangles (9
// numbers each) to a flat array; walls are wound counter-clockwise seen from the side they
// face, as CollisionWorld expects.

import * as THREE from 'three';
import { bakeLighting } from '../../render/materials.js';

export class MeshBuilder {
  // fadeGroups: also record a 'fadeGroup' attribute, the current `fadeGroup` for every vertex
  // added (see foliageFade.js: every tree or bush fades as one).
  constructor({ alpha = false, fadeGroups = false } = {}) {
    this.alpha = alpha;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.groups = fadeGroups ? [] : null;
    this.fadeGroup = 0;
  }

  // Vertices: { x, y, z, u, v, nx?, ny?, nz?, r?, g?, b?, a? }. Without a normal the vertex
  // takes the (flat) face normal.
  tri(a, b, c) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let fx = uy * vz - uz * vy;
    let fy = uz * vx - ux * vz;
    let fz = ux * vy - uy * vx;
    const l = Math.hypot(fx, fy, fz) || 1;
    fx /= l;
    fy /= l;
    fz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      if (p.nx === undefined) this.nrm.push(fx, fy, fz);
      else this.nrm.push(p.nx, p.ny, p.nz);
      this.uv.push(p.u ?? 0, p.v ?? 0);
      this.col.push(p.r ?? 1, p.g ?? 1, p.b ?? 1);
      if (this.alpha) this.col.push(p.a ?? 1);
      if (this.groups) this.groups.push(this.fadeGroup);
    }
  }

  // Convex quad a-b-c-d (counter-clockwise seen from its front).
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  // Triangle / quad re-wound if needed so its front faces the direction `out` [x, y, z].
  facingTri(a, b, c, out) {
    if (facesOut(a, b, c, out)) this.tri(a, b, c);
    else this.tri(c, b, a);
  }

  facingQuad(a, b, c, d, out) {
    if (facesOut(a, b, c, out)) this.quad(a, b, c, d);
    else this.quad(d, c, b, a);
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.alpha ? 4 : 3));
    if (this.groups) geo.setAttribute('fadeGroup', new THREE.Float32BufferAttribute(this.groups, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

// Whether triangle a-b-c (counter-clockwise front) faces along `out`.
function facesOut(a, b, c, out) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2] >= 0;
}

// Bakes sun + ambient into the builder's vertex colours (see materials.bakeLighting) and
// returns a named mesh. Normals are dropped afterwards: unlit materials never read them.
export function bakedMesh(name, builder, material, bakeOpts) {
  const geo = builder.toGeometry();
  bakeLighting(geo, bakeOpts);
  geo.deleteAttribute('normal');
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return mesh;
}

// ---------------------------------------------------------------- colliders

// Vertical wall quad from A to B (horizontal positions), bottom/top heights at each end.
// It faces the horizontal direction (dz, -dx), where (dx, dz) = B - A.
export function wallQuad(out, ax, az, bx, bz, a0, a1, b0, b1) {
  out.push(ax, a0, az, ax, a1, az, bx, b1, bz);
  out.push(ax, a0, az, bx, b1, bz, bx, b0, bz);
}

// Corners of a polygon around (x, z): `sides` corners on a circle of `radius`, or, when
// `radius` is an array, one corner per entry at that distance. Corner i sits at angle
// (i + phase) / sides turns, running from +x toward +z.
export function ring(x, z, radius, sides, phase = 0) {
  const radii = Array.isArray(radius) ? radius : Array(sides).fill(radius);
  return radii.map((r, i) => {
    const a = ((i + phase) / radii.length) * Math.PI * 2;
    return [x + Math.cos(a) * r, z + Math.sin(a) * r];
  });
}

// Open vertical prism (walls only, no caps) around (x, z): a solid trunk you can bump into
// but not stand on. Walls face outward (each edge's (dz, -dx) points away from the axis).
// `radius` is a number (regular prism of `sides` sides) or per-corner radii (see ring).
export function prismWalls(out, x, z, y0, y1, radius, sides = 8, phase = 0) {
  polygonWalls(out, ring(x, z, radius, sides, phase), y0, y1);
}

// Walls from y0 to y1 along a closed polygon of [x, z] corners running from +x toward +z
// (like ring, or convexHull), facing outward.
export function polygonWalls(out, pts, y0, y1) {
  pts.forEach(([ax, az], i) => {
    const [bx, bz] = pts[(i + 1) % pts.length];
    wallQuad(out, ax, az, bx, bz, y0, y1, y0, y1);
  });
}

// Convex hull of [x, z] points, its corners running from +x toward +z like ring's (Andrew's
// monotone chain; points on an edge are dropped).
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop(); // each half's last point starts the other
    return h;
  };
  return [...half(pts), ...half(pts.reverse())];
}

// Solid round obstacle (boulder, bush, post): an open prism of walls up to `shoulder` and a
// low cone of floors from there up to `top` (flat when top === shoulder), so the hero bumps
// into it and lands on top of it, never inside.
export function solidMound(out, x, z, y0, shoulder, top, radius, sides = 8) {
  prismWalls(out, x, z, y0, shoulder, radius, sides);
  cone(out, x, z, top, radius, sides, () => shoulder);
}

// Floor-only cone from a rim of corners (see ring; rimY(px, pz) high) up to an apex at
// (x, top, z).
export function cone(out, x, z, top, radius, sides, rimY) {
  const pts = ring(x, z, radius, sides);
  pts.forEach(([x0, z0], i) => {
    const [x1, z1] = pts[(i + 1) % pts.length];
    // apex, corner i + 1, corner i: counter-clockwise seen from above (faces up).
    out.push(x, top, z, x1, rimY(x1, z1), z1, x0, rimY(x0, z0), z0);
  });
}

// Per-corner radii (for ring, with the same sides and phase) of a polygon around (x, z) that
// encloses the horizontal cross-sections of a placed solid (indexed geometry, transformed by
// `matrix`) within a height band that may differ by direction (band(angle) -> [lo, hi],
// taken at each angular sector's middle): the solid's farthest reach in each sector (sampled
// along its edges), pushed out by 1 / cos(half a sector) so the polygon's edges, not only
// its corners, clear it. A sector where nothing lies in its band takes the solid's full reach.
export function footprintRadii(geo, matrix, x, z, { sides, phase = 0, band }) {
  const reach = new Array(sides).fill(0);
  const anywhere = new Array(sides).fill(0);
  const bands = reach.map((_, k) => band(((k + phase + 0.5) / sides) * Math.PI * 2));
  const pos = geo.attributes.position;
  const index = geo.index;
  const p = (i) => new THREE.Vector3().fromBufferAttribute(pos, index.getX(i)).applyMatrix4(matrix);
  const SAMPLES = 16;
  for (let t = 0; t < index.count; t += 3) {
    const tri = [p(t), p(t + 1), p(t + 2)];
    tri.forEach((a, e) => {
      const b = tri[(e + 1) % 3];
      for (let j = 0; j <= SAMPLES; j++) {
        const q = new THREE.Vector3().lerpVectors(a, b, j / SAMPLES);
        const turn = (Math.atan2(q.z - z, q.x - x) / (Math.PI * 2)) * sides - phase;
        const k = ((Math.floor(turn) % sides) + sides) % sides;
        const r = Math.hypot(q.x - x, q.z - z);
        const [lo, hi] = bands[k];
        anywhere[k] = Math.max(anywhere[k], r);
        if (q.y >= lo && q.y <= hi) reach[k] = Math.max(reach[k], r);
      }
    });
  }
  const grow = 1 / Math.cos(Math.PI / sides);
  const sector = reach.map((r, k) => r || anywhere[k]);
  // Corner i sits between sectors i - 1 and i.
  return sector.map((r, i) => Math.max(r, sector[(i + sides - 1) % sides]) * grow);
}

// Convex polygon of [x, y, z] points as floor triangles (a fan), wound to face up.
export function floorPolygon(out, pts) {
  for (let i = 1; i + 1 < pts.length; i++) {
    const [a, b, c] = [pts[0], pts[i], pts[i + 1]];
    // y of (b - a) x (c - a): > 0 when counter-clockwise seen from above.
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0;
    out.push(...a, ...(up ? b : c), ...(up ? c : b));
  }
}

// Solid box turned by `yaw` about Y (local x = half-width hx, local z = half-depth hz,
// centred at (x, z)): four outward walls from y0 to y1 and a flat top to land on.
export function solidBox(out, x, z, yaw, hx, hz, y0, y1) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local (lx, lz) -> world, same convention as Object3D.rotation.y.
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  // Corners in the order that makes wallQuad face outward (angles running from +x to +z).
  const corners = [at(hx, hz), at(-hx, hz), at(-hx, -hz), at(hx, -hz)];
  if (!wallsFaceOut(corners, x, z)) corners.reverse();
  corners.forEach(([ax, az], i) => {
    const [bx, bz] = corners[(i + 1) % 4];
    wallQuad(out, ax, az, bx, bz, y0, y1, y0, y1);
  });
  floorPolygon(out, corners.map(([px, pz]) => [px, y1, pz]));
}

// Whether wallQuad along the polygon's first edge faces away from (x, z).
function wallsFaceOut(corners, x, z) {
  const [[ax, az], [bx, bz]] = corners;
  return (bz - az) * ((ax + bx) / 2 - x) - (bx - ax) * ((az + bz) / 2 - z) > 0;
}

// ---------------------------------------------------------------- lumpy solids

// Deterministic hash noise in -1..1 for a lattice point.
function hashSigned(x, y, z, seed) {
  let h = (Math.imul(Math.round(x * 1000), 374761393) ^ Math.imul(Math.round(y * 1000), 668265263)) | 0;
  h = (h ^ Math.imul(Math.round(z * 1000), 1274126177) ^ Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

// A lumpy dome (boulders, crags): a jittered icosphere whose lower half is squashed flat so
// it sits on the ground, returned as indexed unit-space positions.
//   detail: icosphere subdivision; jitter: radial noise amount; flatBottom: how much of the
//   lower hemisphere survives (0 = flat base at y = 0).
export function lumpyDome({ detail = 1, jitter = 0.18, flatBottom = 0.25, seed = 1 } = {}) {
  const geo = weld(new THREE.IcosahedronGeometry(1, detail));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const k = 1 + jitter * hashSigned(x, y, z, seed);
    x *= k;
    y *= k;
    z *= k;
    if (y < 0) y *= flatBottom;
    pos.setXYZ(i, x, y, z);
  }
  return geo;
}

// Indexed copy of a geometry's positions with coincident vertices shared (so jittering a
// corner moves every face that uses it).
function weld(source) {
  const src = source.attributes.position;
  const keys = new Map();
  const positions = [];
  const index = [];
  for (let i = 0; i < src.count; i++) {
    const key = [src.getX(i), src.getY(i), src.getZ(i)].map((v) => Math.round(v * 1e4)).join(',');
    let id = keys.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      keys.set(key, id);
      positions.push(src.getX(i), src.getY(i), src.getZ(i));
    }
    index.push(id);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  return geo;
}

// Appends an indexed unit-space solid to a builder as flat-shaded faces, transformed by
// `matrix`. UVs are a box projection chosen per face (world units / tile, where tile is a
// number or { u, v }; v runs up on the sides) so texel density stays even.
// colorFn(x, y, z) -> [r, g, b] tints each vertex (world space, before lighting).
export function addSolid(builder, geo, matrix, { tile = 400, colorFn = null } = {}) {
  const tu = tile.u ?? tile;
  const tv = tile.v ?? tile;
  const pos = geo.attributes.position;
  const index = geo.index;
  const p = new THREE.Vector3();
  const count = index ? index.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const vs = [0, 1, 2].map((k) => {
      p.fromBufferAttribute(pos, index ? index.getX(t + k) : t + k).applyMatrix4(matrix);
      return { x: p.x, y: p.y, z: p.z };
    });
    // The face normal picks the projection axis.
    const [a, b, c] = vs;
    const fx = Math.abs((b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y));
    const fy = Math.abs((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z));
    const fz = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    for (const v of vs) {
      if (fy >= fx && fy >= fz) [v.u, v.v] = [v.x / tu, v.z / tv];
      else if (fx >= fz) [v.u, v.v] = [v.z / tu, v.y / tv];
      else [v.u, v.v] = [v.x / tu, v.y / tv];
      if (colorFn) [v.r, v.g, v.b] = colorFn(v.x, v.y, v.z);
    }
    builder.tri(a, b, c);
  }
}
