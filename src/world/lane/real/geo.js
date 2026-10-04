// Geometry for the realistic look's own builders (world/lane/real/*: the dad's house in full,
// the tile courses, the leaf cards, the cars...), pure: no three.js, plain arrays in, typed
// arrays out, so they run in the realistic look's worker (render/real/laneRealWorker.js) and in
// node tests, and the main thread only uploads what they made.
//
//   const g = new Geo(repeat?)        // uvs in world units / repeat (1: as given)
//   g.color(hex, k?) / g.rgb(r, g, b) // the next vertices' colour (hex sRGB, made linear; rgb
//                                     // linear), times k
//   g.sway                            // the next vertices' weight in the wind (0 still: the
//                                     // leaf cards' tips 1; only meshes that sway carry it)
//   g.wearAt = (p) => [below, over, length] | null   // the next vertices' `wear` (the walls'
//                                     // weathering, materials.js WEAR: how far under the sill or
//                                     // eave over it, how high over the ground, its streaks'
//                                     // length; only meshes with some carry it, the others' 0)
//   g.quad(a, b, c, d, { uvs, n, shade })   // a b c d counter-clockwise seen from its front;
//                                     // uvs default to its own edges (u along a->b, v along
//                                     // a->d, world units), n one normal each (flat by default),
//                                     // shade one number or four
//   g.tri(a, b, c, { uvs, n, shade })
//   g.box(x0, x1, y0, y1, z0, z1, { skip, shade, under })   // axis-aligned; skip a string of
//                                     // faces left out ('-x+x-z+zt b'), under: the bottom's shade
//   g.cyl(axis, from, to, c1, c2, r, sides, { a0, arc, caps, inside })   // round `axis` ('x',
//                                     // 'y', 'z'), at (c1, c2) across it; an arc of it (a half
//                                     // pipe: a gutter), inside: facing in
//   g.tube(p, q, r0, r1, sides, { caps })   // a tapering cylinder from point p to q
//   g.ellipsoid(c, ax, ay, az, a, b, cc, seg, ring)   // semi-axes a, b, cc along unit ax, ay, az
//   g.loft(rings, { segs, capStart, capEnd })   // a skin through rings of points (each ring
//                                     // closed, all the same length), smooth normals; segs(i):
//                                     // whether segment i .. i + 1 of the rings is skinned
//   g.count                           // vertices so far
//   g.buffers() -> { position, normal, uv, color, sway?, wear? }   // Float32Arrays, non-indexed
//
//   linear(hex) -> [r, g, b]          // an sRGB hex colour in linear light (as three.js's Color)
//   sub, add, mul, dot, cross, norm, lerp   // [x, y, z] vector helpers

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
export function linear(hex) {
  return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

export class Geo {
  constructor(repeat = 1) {
    this.s = 1 / repeat;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.sw = [];
    this.tint = [1, 1, 1];
    this.sway = 0;
    this.swaying = false; // (whether any vertex has swayed: the attribute is only kept then)
    this.wr = [];
    this.wearAt = null;
    this.wearing = false; // (whether any vertex has worn: the attribute is only kept then)
  }

  get count() {
    return this.pos.length / 3;
  }

  color(hex, k = 1) {
    const c = linear(hex);
    this.tint = [c[0] * k, c[1] * k, c[2] * k];
    return this;
  }

  rgb(r, g, b) {
    this.tint = [r, g, b];
    return this;
  }

  vertex(p, n, uv, shade = 1) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0] * this.s, uv[1] * this.s);
    this.col.push(this.tint[0] * shade, this.tint[1] * shade, this.tint[2] * shade);
    this.sw.push(this.sway);
    if (this.sway) this.swaying = true;
    const w = this.wearAt?.(p);
    if (w) {
      this.wr.push(w[0], w[1], w[2]);
      this.wearing = true;
    } else this.wr.push(0, 0, 0);
  }

  quad(a, b, c, d, { uvs = null, n = null, shade = 1 } = {}) {
    const fn = norm(cross(sub(b, a), sub(d, a)));
    let t = uvs;
    if (!t) {
      const eu = norm(sub(b, a));
      const ev = norm(cross(fn, eu));
      const at = (p) => [dot(sub(p, a), eu), dot(sub(p, a), ev)];
      t = [at(a), at(b), at(c), at(d)];
    }
    const P = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vertex(P[i], n ? n[i] : fn, t[i], Array.isArray(shade) ? shade[i] : shade);
  }

  tri(a, b, c, { uvs = UNIT, n = null, shade = 1 } = {}) {
    const fn = norm(cross(sub(b, a), sub(c, a)));
    const P = [a, b, c];
    for (let i = 0; i < 3; i++) this.vertex(P[i], n ? n[i] : fn, uvs[i], Array.isArray(shade) ? shade[i] : shade);
  }

  box(x0, x1, y0, y1, z0, z1, { skip = '', shade = 1, under = 0.6 } = {}) {
    const f = (k, a, b, c, d) => {
      if (skip.includes(k)) return;
      const flat = k === 't' || k === 'b';
      const side = k === '-x' || k === '+x';
      const uvs = [a, b, c, d].map((p) => (flat ? [p[0], p[2]] : side ? [p[2], p[1]] : [p[0], p[1]]));
      this.quad(a, b, c, d, { uvs, shade: k === 'b' ? under : shade });
    };
    f('-z', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    f('+z', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    f('-x', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    f('+x', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    f('t', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    f('b', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  cyl(axis, from, to, c1, c2, r, sides = 8, { a0 = 0, arc = Math.PI * 2, caps = false, inside = false } = {}) {
    const at = (t, a) => {
      const u = Math.cos(a) * r;
      const w = Math.sin(a) * r;
      return axis === 'x' ? [t, c1 + w, c2 + u] : axis === 'y' ? [c1 + u, t, c2 + w] : [c1 + u, c2 + w, t];
    };
    const out = (a) => {
      const u = Math.cos(a) * (inside ? -1 : 1);
      const w = Math.sin(a) * (inside ? -1 : 1);
      return axis === 'x' ? [0, w, u] : axis === 'y' ? [u, 0, w] : [u, w, 0];
    };
    // Each side's winding: round z the ring turns the other way.
    const flip = (axis === 'z') !== inside;
    const len = to - from;
    for (let i = 0; i < sides; i++) {
      const a = a0 + (arc * i) / sides;
      const b = a0 + (arc * (i + 1)) / sides;
      const q = [at(from, a), at(to, a), at(to, b), at(from, b)];
      const n = [out(a), out(a), out(b), out(b)];
      const uvs = [[0, a * r], [len, a * r], [len, b * r], [0, b * r]];
      if (flip) this.quad(q[3], q[2], q[1], q[0], { n: [n[3], n[2], n[1], n[0]], uvs: [uvs[3], uvs[2], uvs[1], uvs[0]] });
      else this.quad(q[0], q[1], q[2], q[3], { n, uvs });
    }
    if (!caps) return;
    for (const [t, s] of [[from, -1], [to, 1]]) {
      const c = axis === 'x' ? [t, c1, c2] : axis === 'y' ? [c1, t, c2] : [c1, c2, t];
      const n = axis === 'x' ? [s, 0, 0] : axis === 'y' ? [0, s, 0] : [0, 0, s];
      for (let i = 0; i < sides; i++) {
        const a = at(t, a0 + (arc * i) / sides);
        const b = at(t, a0 + (arc * (i + 1)) / sides);
        if ((s > 0) === (axis === 'z')) this.tri(c, a, b, { n: [n, n, n] });
        else this.tri(c, b, a, { n: [n, n, n] });
      }
    }
  }

  tube(p, q, r0, r1 = r0, sides = 6, { caps = false, a0 = 0, arc = Math.PI * 2, inside = false } = {}) {
    const axis = norm(sub(q, p));
    const helper = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    // Round a level axis, angle 0 lies level and pi/2 straight down (an arc 0 .. pi: a gutter's
    // trough; pi .. 2 pi: a ridge's cap).
    const u = norm(cross(axis, helper));
    const v = cross(axis, u);
    const whole = arc >= Math.PI * 2 - 1e-6;
    const at = (c, r, i) => {
      const a = a0 + (arc * i) / sides;
      return add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)));
    };
    // The side's normal leans out by the taper.
    const len = Math.hypot(...sub(q, p));
    const lean = (r0 - r1) / (len || 1);
    const out = (i) => {
      const a = a0 + (arc * i) / sides;
      const n = norm(add(add(mul(u, Math.cos(a)), mul(v, Math.sin(a))), mul(axis, lean)));
      return inside ? mul(n, -1) : n;
    };
    for (let i = 0; i < sides; i++) {
      const j = whole ? (i + 1) % sides : i + 1;
      const [A, B, C, D] = [at(p, r0, i), at(p, r0, j), at(q, r1, j), at(q, r1, i)];
      const uvs = [[i * r0, 0], [(i + 1) * r0, 0], [(i + 1) * r0, len], [i * r0, len]];
      if (inside) this.quad(B, A, D, C, { n: [out(j), out(i), out(i), out(j)], uvs: [uvs[1], uvs[0], uvs[3], uvs[2]] });
      else this.quad(A, B, C, D, { n: [out(i), out(j), out(j), out(i)], uvs });
    }
    if (!caps) return;
    const back = mul(axis, -1);
    for (let i = 0; i < sides; i++) {
      const j = whole ? (i + 1) % sides : i + 1;
      this.tri(p, at(p, r0, j), at(p, r0, i), { n: [back, back, back] });
      this.tri(q, at(q, r1, i), at(q, r1, j), { n: [axis, axis, axis] });
    }
  }

  ellipsoid(c, ax, ay, az, a, b, cc, seg = 12, ring = 8, shade = 1) {
    const at = (th, ph) => {
      const x = Math.cos(ph) * Math.cos(th);
      const y = Math.sin(ph);
      const z = Math.cos(ph) * Math.sin(th);
      const p = add(add(add(c, mul(ax, x * a)), mul(ay, y * b)), mul(az, z * cc));
      const n = norm(add(add(mul(ax, x / a), mul(ay, y / b)), mul(az, z / cc)));
      return [p, n];
    };
    for (let j = 0; j < ring; j++) {
      const p0 = -Math.PI / 2 + (Math.PI * j) / ring;
      const p1 = -Math.PI / 2 + (Math.PI * (j + 1)) / ring;
      for (let i = 0; i < seg; i++) {
        const t0 = (2 * Math.PI * i) / seg;
        const t1 = (2 * Math.PI * (i + 1)) / seg;
        const q = [at(t0, p0), at(t0, p1), at(t1, p1), at(t1, p0)];
        this.quad(q[0][0], q[1][0], q[2][0], q[3][0], { n: q.map((v) => v[1]), uvs: UNIT, shade });
      }
    }
  }

  loft(rings, { segs = () => true, capStart = false, capEnd = false } = {}) {
    const n = rings[0].length;
    // Smooth normals: each ring point's from its neighbours along the ring and across rings
    // (the skin faces along `along` x `across`: rings counter-clockwise round the way they run).
    const normals = rings.map((r, k) => r.map((p, i) => {
      const along = sub(r[(i + 1) % n], r[(i + n - 1) % n]);
      const across = sub(rings[Math.min(rings.length - 1, k + 1)][i], rings[Math.max(0, k - 1)][i]);
      return norm(cross(along, across));
    }));
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let i = 0; i < n; i++) {
        if (!segs(i)) continue;
        const j = (i + 1) % n;
        this.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], { n: [normals[k][i], normals[k][j], normals[k + 1][j], normals[k + 1][i]], uvs: UNIT });
      }
    }
    const cap = (r, flip) => {
      const c = mul(r.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / r.length);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (flip) this.tri(c, r[j], r[i]);
        else this.tri(c, r[i], r[j]);
      }
    };
    if (capStart) cap(rings[0], true);
    if (capEnd) cap(rings[rings.length - 1], false);
  }

  buffers() {
    const out = { position: Float32Array.from(this.pos), normal: Float32Array.from(this.nrm), uv: Float32Array.from(this.uv), color: Float32Array.from(this.col) };
    if (this.swaying) out.sway = Float32Array.from(this.sw);
    if (this.wearing) out.wear = Float32Array.from(this.wr);
    return out;
  }
}
