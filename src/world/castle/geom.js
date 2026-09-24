// Small geometry toolkit for the castle and the drawbridge.
//
// Shapes are described as lists of convex planar polygons ("polys", arrays of [x, y, z]).
// GeoBuilder turns them into render triangles (position, normal, uv, colour) for one
// material; SolidBuilder turns them into collider triangles. Every face is given an
// intended outward direction and re-wound to match it, so faces are counter-clockwise
// seen from outside (three.js front faces, CollisionWorld outward walls) by construction.

import * as THREE from 'three';

// ---------------------------------------------------------------- vector helpers ([x, y, z])

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function centroid(points) {
  const c = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length];
}

// ---------------------------------------------------------------- 2D contours

// Arched opening outline (a rectangle with a semicircular head), clockwise seen from the
// front: bottom-left, up, over the arch, down to bottom-right. Open at the bottom.
export function archContour(halfWidth, springY, segs = 6) {
  const pts = [[-halfWidth, 0]];
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI - (Math.PI * i) / segs;
    pts.push([halfWidth * Math.cos(a), springY + halfWidth * Math.sin(a)]);
  }
  pts.push([halfWidth, 0]);
  return pts;
}

// Closed circle outline, clockwise seen from the front, starting at the top.
export function circleContour(cx, cy, r, segs = 16) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = Math.PI / 2 - (i / segs) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// ---------------------------------------------------------------- wall-mounted frames

// Local (u, v, w) coordinates on a vertical wall: origin on the wall surface, `out` the
// horizontal wall normal. u runs to the right (seen from outside), v up, w outward.
export function wallFrame(origin, out) {
  const o = normalize([out[0], 0, out[2]]);
  const right = [o[2], 0, -o[0]];
  const at = (u, v, w = 0) => [
    origin[0] + right[0] * u + o[0] * w,
    origin[1] + v,
    origin[2] + right[2] * u + o[2] * w,
  ];
  // Local direction -> world direction.
  const dir = (du, dv, dw) => [right[0] * du + o[0] * dw, dv, right[2] * du + o[2] * dw];
  return { at, dir, out: o, right };
}

// Lathe start angle that centres a face on yaw 0 (and on every multiple of 2pi/sides).
export const faceCentred = (sides) => -Math.PI / sides;

// Frame on the face of a polygonal tower (lathe with `sides` sides and a0 = faceCentred)
// nearest to `angle` (yaw convention: 0 faces +Z).
export function towerFrame(cx, cz, r, sides, angle, y) {
  const step = (Math.PI * 2) / sides;
  const a = Math.round(angle / step) * step;
  const ap = r * Math.cos(step / 2);
  return wallFrame([cx + Math.sin(a) * ap, y, cz + Math.cos(a) * ap], [Math.sin(a), 0, Math.cos(a)]);
}

// ---------------------------------------------------------------- convex solids as polys

// Corner signs walking once around a rectangle, for building hexahedra.
const RING = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

// Hexahedron from 8 corners: bottom ring b0..b3 then top ring t0..t3 (same order).
// ys: extra heights at which the side faces are split (for vertex shading gradients).
export function hexaPolys(c, { bottom = true, top = true, ys = [] } = {}) {
  const polys = [];
  if (bottom) polys.push([c[0], c[1], c[2], c[3]]);
  if (top) polys.push([c[4], c[5], c[6], c[7]]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const b0 = c[i];
    const b1 = c[j];
    const t0 = c[i + 4];
    const t1 = c[j + 4];
    const lerpEdge = (b, t, y) => {
      const k = (y - b[1]) / (t[1] - b[1] || 1);
      return [b[0] + (t[0] - b[0]) * k, y, b[2] + (t[2] - b[2]) * k];
    };
    const cuts = ys.filter((y) => y > Math.max(b0[1], b1[1]) && y < Math.min(t0[1], t1[1])).sort((p, q) => p - q);
    let lo0 = b0;
    let lo1 = b1;
    for (const y of cuts) {
      const hi0 = lerpEdge(b0, t0, y);
      const hi1 = lerpEdge(b1, t1, y);
      polys.push([lo0, lo1, hi1, hi0]);
      lo0 = hi0;
      lo1 = hi1;
    }
    polys.push([lo0, lo1, t1, t0]);
  }
  return polys;
}

export function boxPolys(x0, x1, y0, y1, z0, z1, opts) {
  return hexaPolys(
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    opts,
  );
}

// Box in a wall frame's local coordinates.
export function localBoxPolys(frame, u0, u1, v0, v1, w0, w1, opts) {
  const f = frame.at;
  return hexaPolys(
    [f(u0, v0, w0), f(u1, v0, w0), f(u1, v0, w1), f(u0, v0, w1), f(u0, v1, w0), f(u1, v1, w0), f(u1, v1, w1), f(u0, v1, w1)],
    opts,
  );
}

// Box of size (along, up, across) centred on `c`, its long axis along direction `d` (XZ).
export function orientedBoxPolys(c, d, along, y0, y1, across, opts) {
  const l = Math.hypot(d[0], d[2]) || 1;
  const ax = [(d[0] / l) * along * 0.5, 0, (d[2] / l) * along * 0.5];
  const cx = [(-d[2] / l) * across * 0.5, 0, (d[0] / l) * across * 0.5];
  const corner = ([sa, sc], y) => [c[0] + ax[0] * sa + cx[0] * sc, y, c[2] + ax[2] * sa + cx[2] * sc];
  return hexaPolys([...RING.map((k) => corner(k, y0)), ...RING.map((k) => corner(k, y1))], opts);
}

// Straight beam from P to Q with a rectangular section: `side` is a horizontal-ish unit
// vector across the beam (width tw); the section's other axis (height th) is perpendicular.
export function beamPolys(P, Q, side, tw, th, opts) {
  const u = normalize(cross(side, sub(Q, P)));
  const at = (C, [ss, su]) => [
    C[0] + side[0] * ss * tw * 0.5 + u[0] * su * th * 0.5,
    C[1] + side[1] * ss * tw * 0.5 + u[1] * su * th * 0.5,
    C[2] + side[2] * ss * tw * 0.5 + u[2] * su * th * 0.5,
  ];
  return hexaPolys([...RING.map((k) => at(P, k)), ...RING.map((k) => at(Q, k))], opts);
}

// Vertical prism approximating a round tower (collision).
export function prismPolys(cx, cz, r, sides, y0, y1, { bottom = false, top = true } = {}) {
  const ring = (y) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
    });
  const lo = ring(y0);
  const hi = ring(y1);
  const polys = [];
  if (bottom) polys.push(lo);
  if (top) polys.push(hi);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    polys.push([lo[i], lo[j], hi[j], hi[i]]);
  }
  return polys;
}

// Cone approximating a conical roof (collision).
export function conePolys(cx, cz, r, sides, y0, y1, { bottom = false } = {}) {
  const tip = [cx, y1, cz];
  const ring = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y0, cz + Math.cos(a) * r];
  });
  const polys = [];
  if (bottom) polys.push(ring);
  for (let i = 0; i < sides; i++) polys.push([ring[i], ring[(i + 1) % sides], tip]);
  return polys;
}

// ---------------------------------------------------------------- render geometry

const tmpColor = new THREE.Color();

export class GeoBuilder {
  // repeat: world units per texture repeat for projected UVs.
  constructor(repeat) {
    this.repeat = repeat;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.tint = [1, 1, 1];
    // Optional hand-painted shading: (x, y, z) -> multiplier, applied per vertex.
    this.shade = null;
    // Glow (0..1) of subsequent faces in AI RACE mode (lit windows), the 'darkGlow'
    // attribute: a number, or (x, y, z) -> number per vertex.
    this.glow = 0;
    this.glows = [];
  }

  // Sets the vertex tint for subsequent faces (sRGB hex, converted to linear).
  color(hex, mul = 1) {
    tmpColor.set(hex);
    this.tint = [tmpColor.r * mul, tmpColor.g * mul, tmpColor.b * mul];
    return this;
  }

  // World-space planar UVs chosen by the dominant normal axis, so texel density and block
  // courses line up across every wall.
  project(p, n) {
    const s = 1 / this.repeat;
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) return [p[0] * s, -p[2] * s * Math.sign(n[1] || 1)];
    if (ax >= az) return [-p[2] * s * Math.sign(n[0]), p[1] * s];
    return [p[0] * s * Math.sign(n[2]), p[1] * s];
  }

  _vertex(p, n, uv, shadeMul) {
    const k = (this.shade ? this.shade(p[0], p[1], p[2]) : 1) * shadeMul;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(this.tint[0] * k, this.tint[1] * k, this.tint[2] * k);
    this.glows.push(typeof this.glow === 'function' ? this.glow(p[0], p[1], p[2]) : this.glow);
  }

  // One triangle. facing: intended outward direction (re-winds to match).
  // normals: per-vertex normals (default flat). uvs: per-vertex uvs, or opts.uv(p) -> [u, v]
  // (default: projected). shade: number multiplier or per-vertex array.
  tri(a, b, c, { facing = null, normals = null, uvs = null, uv = null, shade = 1 } = {}) {
    let fn = cross(sub(b, a), sub(c, a));
    if (Math.hypot(fn[0], fn[1], fn[2]) < 1e-9) return;
    let pts = [a, b, c];
    let ns = normals;
    let ts = uvs;
    let sh = Array.isArray(shade) ? shade : [shade, shade, shade];
    const ref = facing ?? (normals && normals.reduce((acc, n) => [acc[0] + n[0], acc[1] + n[1], acc[2] + n[2]], [0, 0, 0]));
    if (ref && dot(fn, ref) < 0) {
      const flip = (arr) => arr && [arr[0], arr[2], arr[1]];
      pts = flip(pts);
      ns = flip(ns);
      ts = flip(ts);
      sh = flip(sh);
      fn = [-fn[0], -fn[1], -fn[2]];
    }
    fn = normalize(fn);
    for (let i = 0; i < 3; i++) {
      const t = ts ? ts[i] : uv ? uv(pts[i]) : this.project(pts[i], fn);
      this._vertex(pts[i], ns ? ns[i] : fn, t, sh[i]);
    }
  }

  _triV(a, b, c, facing) {
    this.tri(a.p, b.p, c.p, { facing, normals: [a.n, b.n, c.n], uvs: [a.t, b.t, c.t], shade: [a.s, b.s, c.s] });
  }

  // Convex planar polygon (triangle fan).
  poly(points, opts = {}) {
    const { uvs, shade } = opts;
    for (let i = 1; i + 1 < points.length; i++) {
      this.tri(points[0], points[i], points[i + 1], {
        ...opts,
        uvs: uvs && [uvs[0], uvs[i], uvs[i + 1]],
        shade: Array.isArray(shade) ? [shade[0], shade[i], shade[i + 1]] : shade,
      });
    }
  }

  // Convex solid: every poly faces away from the solid's centroid.
  // opts.faceShade(normal) -> multiplier shades whole faces (e.g. dark undersides).
  solid(polys, opts = {}) {
    const c = centroid(polys.flat());
    for (const p of polys) {
      const facing = sub(centroid(p), c);
      let shade = opts.shade ?? 1;
      if (opts.faceShade) {
        let n = normalize(cross(sub(p[1], p[0]), sub(p[p.length - 1], p[0])));
        if (dot(n, facing) < 0) n = [-n[0], -n[1], -n[2]];
        shade *= opts.faceShade(n);
      }
      this.poly(p, { ...opts, facing, shade });
    }
  }

  box(x0, x1, y0, y1, z0, z1, opts = {}) {
    this.solid(boxPolys(x0, x1, y0, y1, z0, z1, opts), opts);
  }

  // Surface of revolution about the vertical axis through (cx, cz). The profile
  // [[r, y, shade?], ...] walks the outside of the surface from the bottom centre outward, up
  // and back in, so the outward normal of each segment is (dy, -dr). Smooth around, faceted
  // along the profile. Repeat a point with a different shade for a hard shading change.
  //   uRepeats: texture repeats around (default: from the largest radius)
  //   vMode: 'y' (v = world height, courses align with walls) or 'len' (along the profile)
  //   flat: faceted shading around too.
  lathe(cx, cz, profile, sides, { uRepeats = null, vMode = 'y', flat = false, a0 = 0 } = {}) {
    const rMax = Math.max(...profile.map((p) => p[0]));
    const reps = uRepeats ?? Math.max(1, Math.round((Math.PI * 2 * rMax) / this.repeat));
    let len = 0;
    for (let s = 0; s + 1 < profile.length; s++) {
      const [r0, y0] = profile[s];
      const [r1, y1] = profile[s + 1];
      const dr = r1 - r0;
      const dy = y1 - y0;
      const segLen = Math.hypot(dr, dy);
      if (segLen < 1e-6) continue;
      const nr = dy / segLen;
      const ny = -dr / segLen;
      const v0 = vMode === 'y' ? y0 / this.repeat : len / this.repeat;
      const v1 = vMode === 'y' ? y1 / this.repeat : (len + segLen) / this.repeat;
      len += segLen;
      for (let i = 0; i < sides; i++) {
        const aA = a0 + (i / sides) * Math.PI * 2;
        const aB = a0 + ((i + 1) / sides) * Math.PI * 2;
        const aM = (aA + aB) / 2;
        const P = (r, y, a) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
        const N = (a) => [Math.sin(a) * nr, ny, Math.cos(a) * nr];
        const nA = flat ? N(aM) : N(aA);
        const nB = flat ? N(aM) : N(aB);
        const uA = (i / sides) * reps;
        const uB = ((i + 1) / sides) * reps;
        const uM = (uA + uB) / 2;
        const s0 = profile[s][2] ?? 1;
        const s1 = profile[s + 1][2] ?? 1;
        // Vertex records: position, normal, uv, shade.
        const V = (r, y, a, n, u, v, sh) => ({ p: P(r, y, a), n, t: [u, v], s: sh });
        const A0 = V(r0, y0, aA, nA, uA, v0, s0);
        const B0 = V(r0, y0, aB, nB, uB, v0, s0);
        const A1 = V(r1, y1, aA, nA, uA, v1, s1);
        const B1 = V(r1, y1, aB, nB, uB, v1, s1);
        const facing = N(aM);
        if (r0 < 1e-6) {
          this._triV(V(r0, y0, aM, N(aM), uM, v0, s0), A1, B1, facing);
        } else if (r1 < 1e-6) {
          this._triV(A0, B0, V(r1, y1, aM, N(aM), uM, v1, s1), facing);
        } else {
          this._triV(A0, B0, B1, facing);
          this._triV(A0, B1, A1, facing);
        }
      }
    }
  }

  // Thick moulding between an inner and an outer 2D contour (same point count) in a wall
  // frame: front face at w = depth, outer sides and inner reveals from w0 to depth.
  // Contours are clockwise seen from the front; `closed` joins the last point to the first.
  moulding(frame, inner, outer, depth, { w0 = 0, closed = false, revealShade = 0.55, frontShade = 1 } = {}) {
    const n = inner.length;
    const count = closed ? n : n - 1;
    const f = frame.at;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      const [iu0, iv0] = inner[i];
      const [iu1, iv1] = inner[j];
      const [ou0, ov0] = outer[i];
      const [ou1, ov1] = outer[j];
      const fs = Array.isArray(frontShade) ? frontShade[i] : frontShade;
      const front = [f(iu0, iv0, depth), f(iu1, iv1, depth), f(ou1, ov1, depth), f(ou0, ov0, depth)];
      this.poly(front, { facing: frame.out, shade: fs });
      // Left normal of a clockwise contour edge points away from the opening.
      const outSide = [f(ou0, ov0, w0), f(ou1, ov1, w0), f(ou1, ov1, depth), f(ou0, ov0, depth)];
      this.poly(outSide, { facing: frame.dir(-(ov1 - ov0), ou1 - ou0, 0) });
      const reveal = [f(iu0, iv0, w0), f(iu1, iv1, w0), f(iu1, iv1, depth), f(iu0, iv0, depth)];
      this.poly(reveal, { facing: frame.dir(iv1 - iv0, -(iu1 - iu0), 0), shade: revealShade });
    }
  }

  // Flat convex 2D contour placed in a wall frame at offset w, facing out.
  panel(frame, contour, w, opts = {}) {
    this.poly(
      contour.map(([u, v]) => frame.at(u, v, w)),
      { ...opts, facing: frame.out },
    );
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('darkGlow', new THREE.Float32BufferAttribute(this.glows, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- collision geometry

export class SolidBuilder {
  constructor() {
    this.byTerrain = new Map();
  }

  // Convex solid (list of polys) -> outward-wound triangles tagged with a terrain kind.
  solid(polys, terrain = 'stone') {
    let out = this.byTerrain.get(terrain);
    if (!out) this.byTerrain.set(terrain, (out = []));
    const c = centroid(polys.flat());
    for (const p of polys) {
      const facing = sub(centroid(p), c);
      for (let i = 1; i + 1 < p.length; i++) {
        let a = p[0];
        let b = p[i];
        let d = p[i + 1];
        const n = cross(sub(b, a), sub(d, a));
        if (Math.hypot(n[0], n[1], n[2]) < 1e-9) continue;
        if (dot(n, facing) < 0) [b, d] = [d, b];
        out.push(...a, ...b, ...d);
      }
    }
  }

  box(x0, x1, y0, y1, z0, z1, terrain, opts = { bottom: false }) {
    this.solid(boxPolys(x0, x1, y0, y1, z0, z1, opts), terrain);
  }

  colliders() {
    return [...this.byTerrain].map(([terrain, positions]) => ({ positions, terrain }));
  }
}
