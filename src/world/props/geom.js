// Small geometry + collider toolkit for the props.
//
// MeshBuilder collects triangles for one material (position, normal, uv, colour [+ alpha])
// and turns them into a non-indexed BufferGeometry, so every prop of a material ends up in
// a single draw call. Collider helpers append world-space triangles (9 numbers each) to a
// flat array; walls are wound counter-clockwise seen from the side they face, as
// CollisionWorld expects.

import * as THREE from 'three';
import { bakeLighting } from '../../render/materials.js';

export class MeshBuilder {
  constructor({ alpha = false } = {}) {
    this.alpha = alpha;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
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

// Open vertical prism (walls only, no caps) around (x, z): a solid trunk you can bump into
// but not stand on. Walls face outward.
export function prismWalls(out, x, z, y0, y1, radius, sides = 8) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    // Angles run from +x toward +z, so each edge's (dz, -dx) points away from the axis.
    const ax = x + Math.cos(a0) * radius;
    const az = z + Math.sin(a0) * radius;
    const bx = x + Math.cos(a1) * radius;
    const bz = z + Math.sin(a1) * radius;
    wallQuad(out, ax, az, bx, bz, y0, y1, y0, y1);
  }
}

// Solid round obstacle (boulder, bush, post): an open prism of walls up to `shoulder` and a
// low cone of floors from there up to `top` (flat when top === shoulder), so the hero bumps
// into it and lands on top of it, never inside.
export function solidMound(out, x, z, y0, shoulder, top, radius, sides = 8) {
  prismWalls(out, x, z, y0, shoulder, radius, sides);
  cone(out, x, z, top, radius, sides, () => shoulder);
}

// Floor-only cone from a rim of `sides` points (rimY(px, pz) high) up to an apex at (x, top, z).
export function cone(out, x, z, top, radius, sides, rimY) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = x + Math.cos(a0) * radius;
    const z0 = z + Math.sin(a0) * radius;
    const x1 = x + Math.cos(a1) * radius;
    const z1 = z + Math.sin(a1) * radius;
    // apex, a1, a0: counter-clockwise seen from above (faces up).
    out.push(x, top, z, x1, rimY(x1, z1), z1, x0, rimY(x0, z0), z0);
  }
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
// `matrix`. UVs are a box projection chosen per face (world units / tile) so texel density
// stays even. colorFn(x, y, z) -> [r, g, b] tints each vertex (world space, before lighting).
export function addSolid(builder, geo, matrix, { tile = 400, colorFn = null } = {}) {
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
      if (fy >= fx && fy >= fz) [v.u, v.v] = [v.x / tile, v.z / tile];
      else if (fx >= fz) [v.u, v.v] = [v.z / tile, v.y / tile];
      else [v.u, v.v] = [v.x / tile, v.y / tile];
      if (colorFn) [v.r, v.g, v.b] = colorFn(v.x, v.y, v.z);
    }
    builder.tri(a, b, c);
  }
}
