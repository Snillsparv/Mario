// Vertical walls along region boundaries (perimeter cliffs, moat/island masonry, the pond's
// rocky banks). Each wall segment spans between the heights of the two regions at the two
// shared contour vertices, so it closes the gap between the heightfield pieces exactly.
//
// Rendering: each end of a segment is a "column" of rows (more rows on cliffs, plus rows at
// the waterline for a crisp underwater tint); columns depend only on the vertex, so adjacent
// segments share identical columns. Rock rows are pushed back into the high side with 3D
// noise for a craggy, faceted face (never toward the player): only a little within reach of
// the hero, so the drawn rock stays within FLUSH of the collider there, and deeply above it.
// The rock texture is slid up and down along the outline, and broad light/dark bands run
// along it, so its slabs never line up into rows. Collision uses the straight, truly
// vertical quad.

import { smoothstep } from '../../core/math.js';
import { WATER_LEVEL } from '../layout.js';
import { applyUnderwater, noise3 } from './shading.js';

const LIP = 110; // grassy lip at the top of the cliffs
// The hero can touch walls up to about REACH above the ground (or the water surface) at their
// foot (a triple jump or a wall kick, plus body height); rock there is pushed back at most
// FLUSH. Deep crags fade in over the next REACH_BLEND.
const REACH = 700;
const REACH_BLEND = 500;
const FLUSH = 15;
const TEX = {
  rock: { u: 1280, v: 1280 },
  masonry: { u: 480, v: 480 },
  grass: { u: 640, v: 640 },
};

// Wall styles: spacing of the intermediate rows (at absolute heights, so two walls sharing a
// vertical edge at a junction have identical rows), how far rock is pushed back, buffer,
// colour tint, and how much darker the foot of the wall is than its top.
const STYLES = {
  cliff: { rowStep: 200, depth: 300, buffer: 'rock', lip: true, tint: [1, 1, 1], foot: 0.62 },
  bank: { rowStep: 200, depth: 70, buffer: 'rock', lip: false, tint: [0.96, 0.98, 0.9], foot: 0.7 },
  masonry: { rowStep: Infinity, depth: 0, buffer: 'masonry', lip: false, tint: [1, 1, 1], foot: 0.8 },
};

export class WallBuilder {
  // buffers: { rock, masonry, grass } MeshBuffers; collider: array of xyz triples.
  constructor(buffers, collider) {
    this.buffers = buffers;
    this.collider = collider;
  }

  // One wall segment from contour vertex p to q, facing (-dz, dx) (the low side).
  // contour: { sdf(x, z) (positive toward the high side for jittered styles), param(x, z),
  //   junction(x, z): distance to the nearest *other* region contour }.
  add({ style, contour, p, q, loP, hiP, loQ, hiQ }) {
    const st = STYLES[style];
    // Collision: straight vertical quad (degenerate halves are ignored by the collision world).
    this.collider.push(p.x, loP, p.z, q.x, loQ, q.z, q.x, hiQ, q.z, p.x, loP, p.z, q.x, hiQ, q.z, p.x, hiP, p.z);

    // Texture u runs along the outline; handle the wrap-around seam of the closed contour.
    const a = contour.param(p.x, p.z);
    const b = contour.param(q.x, q.z);
    if (Math.abs(a.s - b.s) > a.length / 2) {
      if (a.s < b.s) a.s += a.length;
      else b.s += b.length;
    }
    const colA = this.column(st, contour, p, loP, hiP, a);
    const colB = this.column(st, contour, q, loQ, hiQ, b);
    this.zip(st, colA, colB);
  }

  column(st, contour, v, lo, hi, param) {
    const span = hi - lo;
    const lip = st.lip && span > 4 * LIP ? LIP : 0;
    const rockTop = hi - lip;
    const ys = [lo, rockTop];
    if (lip) ys.push(hi);
    if (Number.isFinite(st.rowStep)) {
      for (let y = Math.ceil((lo + 1) / st.rowStep) * st.rowStep; y < rockTop - 1; y += st.rowStep) ys.push(y);
    }
    // Waterline rows: exactly at the surface and just below it, for a crisp tint line.
    for (const y of [WATER_LEVEL, WATER_LEVEL - 14]) if (y > lo + 1 && y < rockTop - 1) ys.push(y);
    ys.sort((m, n) => m - n);

    // Direction into the high side (SDF gradient) for pushing rock back. The push fades out
    // near junctions with other contours, where walls of other heights/styles share this
    // column's vertical edge and must meet it exactly.
    let gx = 0;
    let gz = 0;
    let fade = 0;
    if (st.depth) {
      fade = smoothstep(20, 300, contour.junction(v.x, v.z));
      const e = 4;
      gx = contour.sdf(v.x + e, v.z) - contour.sdf(v.x - e, v.z);
      gz = contour.sdf(v.x, v.z + e) - contour.sdf(v.x, v.z - e);
      const l = Math.hypot(gx, gz) || 1;
      gx /= l;
      gz /= l;
    }
    const reachTop = Math.max(lo, WATER_LEVEL) + REACH;
    const tiles = (tex) => Math.max(1, Math.round(param.length / tex.u)) / param.length;
    const uRock = param.s * tiles(TEX[st.buffer]);
    const uGrass = param.s * tiles(TEX.grass);
    // Slow vertical slide of the rock texture along the outline (masonry courses stay level),
    // and broad light/dark bands (period ~3000 along the outline, +-12%).
    const slide = st.depth ? 500 * noise3(v.x / 1500, 0.7, v.z / 1500) : 0;
    const band = st.depth ? 1 + 0.24 * (noise3(v.x / 1500, 9.7, v.z / 1500) - 0.5) : 1;
    const warm = noise3(v.x / 1800, 3.3, v.z / 1800) - 0.5;
    const tint = [st.tint[0] * band * (1 + 0.04 * warm), st.tint[1] * band, st.tint[2] * band * (1 - 0.05 * warm)];

    return ys.map((y) => {
      const t = span > 1e-3 ? (y - lo) / span : 0; // 0 at the foot, 1 at the top
      const tr = rockTop - lo > 1e-3 ? Math.min(1, (y - lo) / (rockTop - lo)) : 0;
      const n = noise3(v.x / 280, y / 230, v.z / 280);
      const depth = Math.min(st.depth, FLUSH) + Math.max(0, st.depth - FLUSH) * smoothstep(reachTop, reachTop + REACH_BLEND, y);
      const push = fade * depth * Math.sqrt(Math.sin(Math.PI * tr)) * (0.1 + 0.9 * n);
      // Darker toward the foot, with blotchy variation.
      const k = (st.foot + (1 - st.foot) * smoothstep(-0.05, 0.9, t)) * (0.88 + 0.22 * n);
      return {
        x: v.x + gx * push,
        y,
        z: v.z + gz * push,
        t,
        lip: lip > 0 && y >= rockTop - 0.5,
        rock: { u: uRock, v: (y + slide) / TEX[st.buffer].v, rgb: applyUnderwater(tint.map((c) => c * k), y) },
        grass: { u: uGrass, v: y / TEX.grass.v, rgb: [0.92, 0.95, 0.9] },
      };
    });
  }

  // Stitch two columns (sorted bottom to top) into triangles, advancing whichever column's
  // next row is lower (relative to its own height span).
  zip(st, A, B) {
    let i = 0;
    let j = 0;
    while (i < A.length - 1 || j < B.length - 1) {
      const advanceA = j >= B.length - 1 || (i < A.length - 1 && A[i + 1].t <= B[j + 1].t);
      if (advanceA) {
        this.face(st, A[i], B[j], A[i + 1]);
        i++;
      } else {
        this.face(st, A[i], B[j], B[j + 1]);
        j++;
      }
    }
  }

  face(st, a, b, c) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-3) return;
    nx /= len;
    ny /= len;
    nz /= len;
    const lip = a.lip && b.lip && c.lip;
    const buf = this.buffers[lip ? 'grass' : st.buffer];
    const idx = [a, b, c].map((p) => {
      const m = lip ? p.grass : p.rock;
      return buf.vertex({ x: p.x, y: p.y, z: p.z, nx, ny, nz, u: m.u, v: m.v, r: m.rgb[0], g: m.rgb[1], b: m.rgb[2] });
    });
    buf.tri(idx[0], idx[1], idx[2]);
  }
}
