// Small geometry toolkit for the castle and the drawbridge (and the Great Hall, world/hall/).
//
// Shapes are described as lists of convex planar polygons ("polys", arrays of [x, y, z]).
// GeoBuilder turns them into render triangles (position, normal, uv, colour) for one
// material; SolidBuilder turns them into collider triangles. Every face is given an
// intended outward direction and re-wound to match it, so faces are counter-clockwise
// seen from outside (three.js front faces, CollisionWorld outward walls) by construction.
// sweep() runs a moulding's cross-section along a path (contourPath: round an arch; softBox:
// a box with soft edges); the 2D helpers clip convex polygons (clipConvex, subtractConvex,
// polyArea).

import * as THREE from 'three';

// ---------------------------------------------------------------- vector helpers ([x, y, z])

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// The normals of a profile ([[w, v], ...] or a lathe's [[r, y], ...]) walked with its visible
// side on its right, so each segment's normal is (dv, -dw), smoothed along it: per segment, its
// normal at its start and at its end, each the mean of its own and its neighbour's there. A
// zero-length segment (a repeated point) has no normal, so the edge there stays hard.
function profileNormals(profile) {
  const segs = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const dw = profile[i + 1][0] - profile[i][0];
    const dv = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dw, dv);
    segs.push(l < 1e-6 ? null : [dv / l, -dw / l]);
  }
  const mean = (a, b) => {
    if (!a || !b) return a ?? b;
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  };
  return segs.map((n, i) => (n ? [mean(n, segs[i - 1]), mean(n, segs[i + 1])] : null));
}

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

// Signed area of a 2D polygon [[x, y], ...] (positive counter-clockwise, x right and y up).
export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// The part of a convex 2D polygon on one side of the line through a and b: `side` +1 keeps
// the left of a -> b, -1 the right (Sutherland-Hodgman, one edge).
function clipLine(poly, a, b, side) {
  const out = [];
  const at = (p) => side * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = at(p);
    const sq = at(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// A convex 2D polygon clipped to a convex `clip` polygon (either winding): what lies inside
// it (fewer than 3 points when nothing does).
export function clipConvex(poly, clip) {
  const side = polyArea(clip) > 0 ? 1 : -1;
  let out = poly;
  for (let i = 0; i < clip.length && out.length > 2; i++) out = clipLine(out, clip[i], clip[(i + 1) % clip.length], side);
  return out;
}

// A convex 2D polygon minus a convex `hole`: the convex pieces of it outside the hole (cut
// off by each of the hole's edges in turn).
export function subtractConvex(poly, hole) {
  const side = polyArea(hole) > 0 ? 1 : -1;
  const pieces = [];
  let rest = poly;
  for (let i = 0; i < hole.length && rest.length > 2; i++) {
    const [a, b] = [hole[i], hole[(i + 1) % hole.length]];
    const outside = clipLine(rest, a, b, -side);
    if (outside.length > 2 && Math.abs(polyArea(outside)) > 0.5) pieces.push(outside);
    rest = clipLine(rest, a, b, side);
  }
  return pieces;
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

// A flat wall in a wall frame (u0..u1 across, v0..v1 up, at w = 0) with an opening cut out of
// it along an archContour (its foot at v = 0), as convex polys: the wall either side of the
// opening, under its foot and over its arch (one slice over each arch segment). The wall's top
// must clear the arch, or stay under its spring (a base course beside a door).
export function openingPolys(frame, u0, u1, v0, v1, contour) {
  const f = frame.at;
  const hw = contour[contour.length - 1][0];
  const rect = (ua, ub, va, vb) => [f(ua, va), f(ub, va), f(ub, vb), f(ua, vb)];
  const polys = [];
  if (u0 < -hw) polys.push(rect(u0, -hw, v0, v1));
  if (u1 > hw) polys.push(rect(hw, u1, v0, v1));
  if (v0 < 0) polys.push(rect(-hw, hw, v0, Math.min(0, v1)));
  for (let i = 1; i + 2 < contour.length; i++) {
    const [ua, va] = contour[i];
    const [ub, vb] = contour[i + 1];
    if (v1 > Math.max(va, vb)) polys.push([f(ua, va), f(ub, vb), f(ub, v1), f(ua, v1)]);
  }
  return polys;
}

// A sweep path (sweep(), below) along a 2D contour in a wall frame (an archContour, or with
// `closed` a circleContour: clockwise seen from the front): at each point n is the frame's out
// and b the contour's normal in the wall's plane, away from the opening (the left of a
// clockwise contour, as moulding()'s). A profile [[w, v], ...] swept along it stands w out of
// the wall and v out from the edge: a bullnose round an arch.
export function contourPath(frame, contour, { closed = false } = {}) {
  const n = contour.length;
  return contour.map(([u, v], i) => {
    const prev = contour[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = contour[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const du = next[0] - prev[0];
    const dv = next[1] - prev[1];
    const l = Math.hypot(du, dv) || 1;
    return { p: frame.at(u, v, 0), n: frame.out, b: frame.dir(-dv / l, du / l, 0) };
  });
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
  //   vMode: 'y' (v = world height, courses align with walls), 'len' (along the profile) or
  //     'plan' (segments turned up or down more than out projected from above, as a floor is,
  //     no streaks fanning to the middle; the rest as 'len')
  //   flat: faceted shading around too.
  //   a0, arc: the angles it spans, from a0 (yaw convention: 0 faces +z) round by arc (default
  //     the full turn; less leaves it open at both sides: a column engaged in a wall).
  //   smoothProfile: smooth along the profile too (each point's normal the mean of its two
  //     segments'; a repeated point still makes a hard edge).
  lathe(cx, cz, profile, sides, { uRepeats = null, vMode = 'y', flat = false, a0 = 0, arc = Math.PI * 2, smoothProfile = false } = {}) {
    const rMax = Math.max(...profile.map((p) => p[0]));
    const reps = uRepeats ?? Math.max(1, Math.round((arc * rMax) / this.repeat));
    const smooth = smoothProfile ? profileNormals(profile) : null;
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
      const plan = vMode === 'plan' && Math.abs(dy) < Math.abs(dr);
      const v0 = vMode === 'y' ? y0 / this.repeat : len / this.repeat;
      const v1 = vMode === 'y' ? y1 / this.repeat : (len + segLen) / this.repeat;
      len += segLen;
      // The segment's normal in the (r, y) plane at its two ends.
      const seg = [nr, ny];
      const [m0, m1] = smooth ? smooth[s] : [seg, seg];
      for (let i = 0; i < sides; i++) {
        const aA = a0 + (i / sides) * arc;
        const aB = a0 + ((i + 1) / sides) * arc;
        const aM = (aA + aB) / 2;
        const P = (r, y, a) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
        const N = (a, m = seg) => [Math.sin(a) * m[0], m[1], Math.cos(a) * m[0]];
        const nA = flat ? N(aM, m0) : N(aA, m0);
        const nB = flat ? N(aM, m0) : N(aB, m0);
        const nA1 = flat ? N(aM, m1) : N(aA, m1);
        const nB1 = flat ? N(aM, m1) : N(aB, m1);
        const uA = (i / sides) * reps;
        const uB = ((i + 1) / sides) * reps;
        const uM = (uA + uB) / 2;
        const s0 = profile[s][2] ?? 1;
        const s1 = profile[s + 1][2] ?? 1;
        // Vertex records: position, normal, uv, shade.
        const V = (r, y, a, n, u, v, sh) => {
          const p = P(r, y, a);
          return { p, n, t: plan ? this.project(p, [0, 1, 0]) : [u, v], s: sh };
        };
        const A0 = V(r0, y0, aA, nA, uA, v0, s0);
        const B0 = V(r0, y0, aB, nB, uB, v0, s0);
        const A1 = V(r1, y1, aA, nA1, uA, v1, s1);
        const B1 = V(r1, y1, aB, nB1, uB, v1, s1);
        const facing = N(aM);
        if (r0 < 1e-6) {
          this._triV(V(r0, y0, aM, N(aM, m0), uM, v0, s0), A1, B1, facing);
        } else if (r1 < 1e-6) {
          this._triV(A0, B0, V(r1, y1, aM, N(aM, m1), uM, v1, s1), facing);
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

// ---------------------------------------------------------------- sweeps

// A moulding: the cross-section `profile` [[w, v, shade?], ...] swept along `path`
// [{ p, n, b }, ...] into `builder`, each section's point at p + n * w + b * v (for a wall
// trim: p on the wall's foot, n into the room, b up, v the height). The profile is walked with
// its visible side on its right ((dv, -dw) is its outward normal, as a lathe's (dy, -dr)): for
// a trim, from the wall at the bottom out, up and back to the wall. Smooth along the path (its
// own n and b at each point) and across the profile unless `faceted` (a repeated point makes a
// hard edge either way).
//   closed: the path's last point joins its first
//   uv: 'path' (u along the path, v along the profile, in the builder's repeats) or 'project'
//   shade(pos, normal) -> multiplier, per vertex (with the profile's own shades)
//   caps: close both ends of an open path with the profile's shape (a trim stopping in the
//     open, not dying into something)
export function sweep(builder, path, profile, { closed = false, faceted = false, uv = 'path', shade = null, caps = false } = {}) {
  const smooth = profileNormals(profile);
  const R = builder.repeat;
  // Arc length along the path (u) and along the profile (v), for the uvs.
  const along = [0];
  for (let k = 1; k <= path.length; k++) {
    const a = path[k - 1].p;
    const c = path[k % path.length].p;
    along.push(along[k - 1] + Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
  }
  const across = [0];
  for (let j = 1; j < profile.length; j++) across.push(across[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  const at = (P, w, v) => [P.p[0] + P.n[0] * w + P.b[0] * v, P.p[1] + P.n[1] * w + P.b[1] * v, P.p[2] + P.n[2] * w + P.b[2] * v];
  // A vertex record of profile point j (its normal m in the (w, v) plane) on path point P.
  const vtx = (P, j, m, u) => {
    const [w, v, s = 1] = profile[j];
    const pos = at(P, w, v);
    const n = normalize([P.n[0] * m[0] + P.b[0] * m[1], P.n[1] * m[0] + P.b[1] * m[1], P.n[2] * m[0] + P.b[2] * m[1]]);
    return { p: pos, n, t: uv === 'path' ? [u / R, across[j] / R] : null, s: s * (shade ? shade(pos, n) : 1) };
  };
  const count = closed ? path.length : path.length - 1;
  for (let k = 0; k < count; k++) {
    const A = path[k];
    const B = path[(k + 1) % path.length];
    for (let j = 0; j + 1 < profile.length; j++) {
      if (!smooth[j]) continue;
      const [m0, m1] = faceted ? [null, null] : smooth[j];
      const seg = [profile[j + 1][1] - profile[j][1], profile[j][0] - profile[j + 1][0]];
      const a0 = vtx(A, j, m0 ?? seg, along[k]);
      const a1 = vtx(A, j + 1, m1 ?? seg, along[k]);
      const b0 = vtx(B, j, m0 ?? seg, along[k + 1]);
      const b1 = vtx(B, j + 1, m1 ?? seg, along[k + 1]);
      const facing = [a0.n[0] + a1.n[0] + b0.n[0] + b1.n[0], a0.n[1] + a1.n[1] + b0.n[1] + b1.n[1], a0.n[2] + a1.n[2] + b0.n[2] + b1.n[2]];
      const tri = (x, y, z) => builder.tri(x.p, y.p, z.p, { facing, normals: [x.n, y.n, z.n], uvs: x.t && [x.t, y.t, z.t], shade: [x.s, y.s, z.s] });
      tri(a0, b0, b1);
      tri(a0, b1, a1);
    }
  }
  if (!caps || closed) return;
  // Each end: the profile's outline closed along the wall (w 0), fanned from the middle of
  // that line, facing on along the path.
  const outline = profile.map(([w, v]) => [w, v]);
  if (outline[0][0] !== 0) outline.unshift([0, outline[0][1]]);
  if (outline[outline.length - 1][0] !== 0) outline.push([0, outline[outline.length - 1][1]]);
  const mid = [0, (outline[0][1] + outline[outline.length - 1][1]) / 2];
  for (const [P, Q] of [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]]) {
    const facing = sub(P.p, Q.p);
    const c = at(P, mid[0], mid[1]);
    for (let j = 0; j + 1 < outline.length; j++) builder.tri(c, at(P, ...outline[j]), at(P, ...outline[j + 1]), { facing });
  }
}

// A box x0..x1 by y0..y1 by z0..z1 with soft edges: its vertical edges rounded to radius rc and
// its top edges to rt, k segments to each quarter round, smooth throughout; flat top and
// bottom (closed: every edge is shared by two faces).
export function softBox(builder, x0, x1, y0, y1, z0, z1, rc, rt, k = 2) {
  // The outline round the box in plan, from the middle of its north side, with each point's
  // outward normal.
  const path = [];
  const corners = [[x1 - rc, z0 + rc, -Math.PI / 2], [x1 - rc, z1 - rc, 0], [x0 + rc, z1 - rc, Math.PI / 2], [x0 + rc, z0 + rc, Math.PI]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (i / k) * (Math.PI / 2);
      path.push({ p: [cx + Math.cos(a) * rc, 0, cz + Math.sin(a) * rc], n: [Math.cos(a), 0, Math.sin(a)], b: [0, 1, 0] });
    }
  }
  // Up the side, then a quarter round in to the top.
  const profile = [[0, y0], [0, y1 - rt]];
  for (let i = 1; i < k; i++) {
    const a = (i / k) * (Math.PI / 2);
    profile.push([rt * Math.cos(a) - rt, y1 - rt + rt * Math.sin(a)]);
  }
  profile.push([-rt, y1]);
  sweep(builder, path, profile, { closed: true });
  const ring = (w, v) => path.map((P) => [P.p[0] + P.n[0] * w + P.b[0] * v, P.p[1] + P.n[1] * w + P.b[1] * v, P.p[2] + P.n[2] * w + P.b[2] * v]);
  builder.poly(ring(-rt, y1), { facing: [0, 1, 0] });
  builder.poly(ring(0, y0), { facing: [0, -1, 0] });
}

// ---------------------------------------------------------------- collision geometry

export class SolidBuilder {
  constructor() {
    // One collider per terrain kind (and surface kind, where one is given):
    // key -> { terrain, surface, positions }.
    this.byKind = new Map();
  }

  // Convex solid (list of polys) -> outward-wound triangles tagged with a terrain kind and,
  // optionally, a surface kind (CollisionWorld's: 'slippery', 'not_slippery', ...; without
  // one the collider leaves it to the default).
  solid(polys, terrain = 'stone', surface = null) {
    const c = centroid(polys.flat());
    for (const p of polys) this.face(p, sub(centroid(p), c), terrain, surface);
  }

  // One convex planar polygon wound to face `facing` (a direction): a face on its own, such as
  // a floor of another terrain laid over a solid's top.
  face(p, facing, terrain = 'stone', surface = null) {
    const key = surface ? `${terrain}|${surface}` : terrain;
    let kind = this.byKind.get(key);
    if (!kind) this.byKind.set(key, (kind = { terrain, surface, positions: [] }));
    const out = kind.positions;
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

  box(x0, x1, y0, y1, z0, z1, terrain, opts = { bottom: false }) {
    this.solid(boxPolys(x0, x1, y0, y1, z0, z1, opts), terrain);
  }

  // A builder (solid, face, box) whose faces go where this one's would, in the same order, but
  // are also named: their ranges of their kind's positions are noted under `id` (a collider's
  // `named`: [{ id, from, to }], float offsets), so objects can find the surfaces they became
  // and move them (world/area.js: area.named). The colliders stay as they would be unnamed.
  named(id) {
    const mark = (fn) => (...args) => {
      const before = new Map([...this.byKind].map(([key, kind]) => [key, kind.positions.length]));
      fn(...args);
      for (const [key, kind] of this.byKind) {
        const from = before.get(key) ?? 0;
        if (kind.positions.length === from) continue;
        kind.named ??= [];
        const last = kind.named[kind.named.length - 1];
        if (last && last.id === id && last.to === from) last.to = kind.positions.length;
        else kind.named.push({ id, from, to: kind.positions.length });
      }
    };
    return { solid: mark(this.solid.bind(this)), face: mark(this.face.bind(this)), box: mark(this.box.bind(this)) };
  }

  // [{ positions, terrain, surface?, named? }], one per kind in the order first used.
  colliders() {
    return [...this.byKind.values()].map(({ terrain, surface, positions, named }) => {
      const c = surface ? { positions, terrain, surface } : { positions, terrain };
      if (named) c.named = named.map((r) => ({ ...r }));
      return c;
    });
  }
}
