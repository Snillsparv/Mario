// The realistic look's street furniture and garden things (world/lane/real/detail.js builds them
// in the worker; the classic builders keep every collider): the dad's mailbox and its carved
// bird, the granite kerbs, the road's mended patches and covers, the corner bed's stones, the
// turning area's sign.
//
//   mailbox(kit, L)     // kit: detail.js's Geo per material (boards, paint, metal, enamel, bird,
//                       // gloss, granite, patch)
//   kerbs(kit, L)       // granite kerb stones along the road's north edge and round the
//                       // apron (plan.js roadPieces, kerbRuns), none at the drives (an asphalt
//                       // bevel up into them), along the south edge (the asphalt's bevelled
//                       // edge up to the lawns) or along the dad's corner bed
//   roadDecals(kit, L)  // mended patches, a sealed crack, manhole and drain covers
//   bedStones(kit, L)   // the corner bed's field stones (where the classic ones lie)
//   turnSign(kit, L)    // the turning area's sign at the bed's corner (its face: sign.js)
//   neighbourGround(kit, L)   // W5: south_2's gravel, the beech row's and the beds' soil, the
//                       // link's two bins
//
// The mailbox (MAILBOX, W3): one anthracite pedestal box of sheet steel standing on the lawn
// (a concrete pad at its foot), its gable end toward the street: a lid of two folded sheets
// overhanging all round under a rounded ridge strip; at the street end the top-hinged letter flap
// just under the lid (a shadow gap under it), a blank enamel plate in the gable (no name: the
// repository is public) and the lower door in thin seams with its round lock. The little blue
// sparrow (the sign calls it so) is a blue-grey bird on the ridge: a white breast, a yellow
// beak, glossy black eyes, its wings raised and swept back like the real ornament's, its tail a
// wide spiky fan cocked up behind, on a rod at the ridge's street end, side-on to the street.

import { Geo, add, mul, norm, cross } from './geo.js';
import { bins } from './street.js';
import { roadPieces, kerbRuns, bevelEnds, BEVEL, bedStones as bedStoneSpots } from './plan.js';
import { signFace } from './sign.js';
import { makeRng } from '../../../core/math.js';

const ANTHRACITE = 0x484b52; // (the pedestal box: sheet steel, W3)
const LID = 0x3a3d43;
const BLUE = 0x6f8db4; // (the bird: a blue-grey)
const BIRD_SIZE = 0.62; // (the bird's size against its carving's: ~30 long, as the real one)

// An eight-sided chamfered post or box (corners cut by `ch`) from ya to yb.
function chamfered(g, xa, xb, za, zb, ya, yb, ch) {
  const pts = [[xa + ch, za], [xb - ch, za], [xb, za + ch], [xb, zb - ch], [xb - ch, zb], [xa + ch, zb], [xa, zb - ch], [xa, za + ch]];
  for (let i = 0; i < 8; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 8];
    g.quad([a[0], ya, a[1]], [a[0], yb, a[1]], [b[0], yb, b[1]], [b[0], ya, b[1]], { uvs: [[a[0] + a[1], ya], [a[0] + a[1], yb], [b[0] + b[1], yb], [b[0] + b[1], ya]] });
  }
}

export function mailbox(kit, L) {
  const { paint, metal, enamel, gloss } = kit;
  const M = L.MAILBOX;
  const y0 = L.GROUND;
  const [bw, bd] = M.body;
  const { x: cx, z: cz } = M;
  const yb = y0 + M.post; // the box's foot
  const ye = M.eaves;
  const yr = M.ridge;
  const [x0, x1] = [cx - bw / 2, cx + bw / 2];
  const [zf, zb] = [cz - bd / 2, cz + bd / 2]; // the street end (-z), the back
  // The body: anthracite sheet steel, its corners a little rounded, the gable ends to the lid.
  metal.color(ANTHRACITE);
  chamfered(metal, x0, x1, zf, zb, yb, ye, 2.5);
  for (const [z, s] of [[zf, -1], [zb, 1]]) {
    const [a, b, c] = [[x0, ye, z], [x1, ye, z], [cx, yr - 3, z]];
    if (s < 0) metal.tri(b, a, c);
    else metal.tri(a, b, c);
  }
  // The lid: two folded sheets overhanging 8 all round, a rounded ridge strip.
  paint.color(LID);
  const ov = 8;
  const T = 2;
  for (const s of [-1, 1]) {
    const xe = cx + s * (bw / 2 + ov);
    const ylo = ye - (ov * (yr - ye)) / (bw / 2);
    const top = [[xe, ylo, zf - ov], [cx, yr, zf - ov], [cx, yr, zb + ov], [xe, ylo, zb + ov]];
    const dn = (p) => [p[0], p[1] - T, p[2]];
    if (s < 0) {
      paint.quad(top[0], top[3], top[2], top[1]);
      paint.quad(dn(top[0]), dn(top[1]), dn(top[2]), dn(top[3]), { shade: 0.6 });
    } else {
      paint.quad(top[0], top[1], top[2], top[3]);
      paint.quad(dn(top[0]), dn(top[3]), dn(top[2]), dn(top[1]), { shade: 0.6 });
    }
    paint.quad(dn(top[0]), top[0], top[3], dn(top[3]));
    paint.quad(dn(top[1]), top[1], top[0], dn(top[0]));
    paint.quad(dn(top[3]), top[3], top[2], dn(top[2]));
  }
  paint.cyl('z', zf - ov - 1, zb + ov + 1, cx, yr - 0.5, 2.2, 8, { a0: 0, arc: Math.PI, caps: true });
  // The street end: the letter flap under the lid (top-hinged, a shadow gap under it), a blank
  // plate in the gable, the lower door (thin seams round it) with its round lock.
  const front = (g, xa, xb, ya, yb2, d) => g.box(xa, xb, ya, yb2, zf - d, zf, { skip: '+z' });
  metal.color(ANTHRACITE, 1.15);
  front(metal, cx - 22, cx + 22, ye - 30, ye - 7, 2.5);
  gloss.rgb(0.01, 0.01, 0.01);
  gloss.quad([cx + 21, ye - 32, zf - 0.3], [cx - 21, ye - 32, zf - 0.3], [cx - 21, ye - 30, zf - 0.3], [cx + 21, ye - 30, zf - 0.3]);
  enamel.color(0xd8d6d0);
  enamel.quad([cx + 9, ye + 3, zf - 0.4], [cx - 9, ye + 3, zf - 0.4], [cx - 9, ye + 10, zf - 0.4], [cx + 9, ye + 10, zf - 0.4]);
  paint.color(0x22252a);
  const [d0, d1] = [yb + 8, ye - 46];
  for (const [xa, xb, ya, yb2] of [[x0 + 4, x1 - 4, d0, d0 + 1.5], [x0 + 4, x1 - 4, d1 - 1.5, d1], [x0 + 4, x0 + 5.5, d0, d1], [x1 - 5.5, x1 - 4, d0, d1]]) front(paint, xa, xb, ya, yb2, 0.6);
  metal.color(0x9a9890);
  metal.cyl('z', zf - 2.5, zf, x0 + 13, d1 - 22, 2.6, 10, { caps: true });
  // Its foot: a concrete pad flush with the lawn.
  enamel.color(0x8c8a84);
  enamel.box(x0 - 6, x1 + 6, y0 - 2, y0 + 2, zf - 6, zb + 6, { skip: 'b' });
  // (The bird drawn at its carving's size, then scaled about its feet to the real one's: W3.)
  const o = [cx, yr + 6, zf + 5];
  const from = new Map(['bird', 'gloss', 'metal'].map((k) => [kit[k], kit[k].count]));
  carvedBird(kit, o);
  for (const [g, start] of from) {
    for (let i = start * 3; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) g.pos[i + k] = o[k] + (g.pos[i + k] - o[k]) * BIRD_SIZE;
  }
}

// The carved bird standing at o (its feet), facing +x, side-on to the street.
function carvedBird({ bird, gloss, metal }, o) {
  const fwd = [1, 0, 0];
  const up = [0, 1, 0];
  const side = [0, 0, 1];
  const B = (a, y, s) => add(add(add(o, mul(fwd, a)), mul(up, y)), mul(side, s));
  metal.color(0x3a3a3a);
  metal.cyl('y', o[1] - 8, o[1] + 8, o[0], o[2], 0.9, 6);
  bird.color(BLUE);
  const tilt = norm([Math.cos(0.25), Math.sin(0.25), 0]); // the body's axis, its breast up a little
  const tUp = norm(cross(side, tilt));
  bird.ellipsoid(B(0, 14, 0), tilt, tUp, side, 17, 10, 9, 18, 10);
  bird.color(0xe8e4dc);
  bird.ellipsoid(B(5, 11, 0), tilt, tUp, side, 11, 6.5, 6.5, 14, 8); // the breast
  bird.color(BLUE, 1.05);
  bird.ellipsoid(B(15, 26, 0), fwd, up, side, 8, 7.5, 7, 16, 10); // the head
  bird.color(0xe2a628);
  const [base, tip] = [B(22, 26, 0), B(29, 25, 0)];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const at = (a) => add(base, add(mul(up, Math.cos(a) * 2.4), mul(side, Math.sin(a) * 2.4)));
    bird.tri(at(a0), at(a1), tip);
  }
  gloss.rgb(0.004, 0.004, 0.005);
  for (const s of [-1, 1]) gloss.ellipsoid(B(19.5, 28, s * 5.4), fwd, up, side, 1.6, 1.6, 1.2, 8, 6);
  // The tail: a wide fan of spiky feathers cocked up behind.
  bird.color(BLUE, 0.8);
  const root = B(-12, 15, 0);
  const fan = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((k, i) => B(-34 + Math.abs(k) * 6 + (i % 2) * 5, 36 - Math.abs(k) * 6 - (i % 2) * 4, k * 13));
  for (let i = 0; i < 8; i++) bird.tri(root, fan[i], fan[i + 1]);
  // The wings: curved plates raised from the shoulders, swept back.
  bird.color(BLUE, 0.9);
  for (const s of [-1, 1]) {
    const W = (u, v) => {
      const chord = 13 * (1 - 0.65 * u) * (1 - 0.2 * Math.abs(v));
      const curl = 3 * Math.sin(u * Math.PI * 0.5);
      return B(2 - 6 * u + v * chord, 18 + Math.sin(0.95) * 22 * u + curl, s * (7 + Math.cos(0.95) * 22 * u));
    };
    for (let i = 0; i < 6; i++) bird.quad(W(i / 6, -0.5), W((i + 1) / 6, -0.5), W((i + 1) / 6, 0.5), W(i / 6, 0.5));
  }
}

// ---------------------------------------------------------------- the ground's things

const KERB = { stone: 150, joint: 0.8, chamfer: 3, lift: 1.5 };

// The kerbs (lane/build.js kerbs: the same runs, plan.js kerbRuns): along each run of the
// road's edge, granite stones about KERB.stone long with a joint between them, a chamfered
// arris and a top KERB.w deep; at the drives none: the asphalt runs on up into them (a bevel);
// along the south edge none (the road's asphalt bevelled up to the lawn: lane/build.js kerbs
// draws it in both looks); along the dad's corner bed none (its soil's dark face, the field
// stones over it: bedStones).
export function kerbs({ granite, core, patch }, L) {
  const G = L.GROUND;
  const stone = (p0, q0, n, drop) => {
    // (Its faces wound for a run with the road on its left; the apron's pieces run the other way:
    // turned round.)
    const [p, q] = (q0[0] - p0[0]) * n[1] - (q0[1] - p0[1]) * n[0] < 0 ? [q0, p0] : [p0, q0];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const count = Math.max(1, Math.round(len / KERB.stone));
    const top = G + (drop ? 0.3 : KERB.lift);
    const ch = drop ? 1 : KERB.chamfer;
    const w = L.KERB.w;
    for (let k = 0; k < count; k++) {
      const t0 = k / count;
      const t1 = (k + 1) / count;
      const at = (t, d, y) => [p[0] + (q[0] - p[0]) * t + n[0] * d, y, p[1] + (q[1] - p[1]) * t + n[1] * d];
      const j = KERB.joint / len;
      // (No joint at the run's own ends: there it meets the next run's stone or a bevel's end
      // flush, no slit through to the void under the lawn.)
      const [a, b] = [k ? t0 + j : t0, k + 1 < count ? t1 - j : t1];
      granite.color(drop ? 0x8a8884 : 0xd8d6d2);
      // The road face, the chamfer, the top; the joints' ends in shade.
      granite.quad(at(b, 0, -2), at(a, 0, -2), at(a, 0, top - ch), at(b, 0, top - ch));
      granite.quad(at(b, 0, top - ch), at(a, 0, top - ch), at(a, ch, top), at(b, ch, top));
      granite.quad(at(b, ch, top), at(a, ch, top), at(a, w, top), at(b, w, top));
      granite.quad(at(a, 0, -2), at(a, w, -2), at(a, w, top), at(a, 0, top), { shade: 0.6 });
      granite.quad(at(b, w, -2), at(b, 0, -2), at(b, 0, top), at(b, w, top), { shade: 0.6 });
      // The joint's back, dark (a joint, not the sky through it).
      if (k + 1 < count) granite.quad(at(t1 + j, w, -2), at(t1 - j, w, -2), at(t1 - j, w, top), at(t1 + j, w, top), { shade: 0.3 });
    }
  };
  const runs = kerbRuns(L, roadPieces(L));
  // The drives' bevels closed at their ends (plan.js bevelEnds; the edges' by lane/build.js).
  patch.color(0x7c7a74, 1.12);
  for (const { kind, pts, facing } of bevelEnds(runs, G)) {
    if (kind !== 'drop') continue;
    const uvs = pts.map(([x, y, z]) => (facing[1] > 0 ? [x, z] : [x * facing[2] - z * facing[0], y]));
    if (pts.length === 3) patch.tri(pts[0], pts[1], pts[2], { uvs });
    else patch.quad(pts[0], pts[1], pts[2], pts[3], { uvs });
  }
  for (const { p, q, n, kind } of runs) {
    if (kind === 'kerb') {
      stone(p, q, n, false);
      continue;
    }
    if (kind === 'edge') continue; // (the south edge's bevel: the road's own, lane/build.js kerbs)
    if (kind === 'drop') {
      // (At a drive the asphalt runs on up into it: a bevel from the road to its edge.)
      patch.color(0x7c7a74, 1.12);
      const o = (t, d, y) => [t[0] - n[0] * d, y, t[1] - n[1] * d];
      // (Wound to face up whichever way the run goes: W2's drive side along the apron runs
      // against the street's.)
      let Q = [o(q, BEVEL, 0.4), o(p, BEVEL, 0.4), o(p, 0, G), o(q, 0, G)];
      const [a, b, c] = Q;
      if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) Q = [Q[1], Q[0], Q[3], Q[2]];
      patch.quad(Q[0], Q[1], Q[2], Q[3], { uvs: Q.map((v) => [v[0], v[2]]) });
      continue;
    }
    // The bed's soil face at the asphalt's edge (the stones sit along it).
    core.rgb(0.035, 0.024, 0.017);
    const top = G + L.BED.raise;
    core.quad([q[0], -2, q[1]], [p[0], -2, p[1]], [p[0], top, p[1]], [q[0], top, q[1]]);
  }
}

// The road's wear: mended patches (darker, smoother asphalt: the patch material, a little
// glossy), a sealed crack wandering across
// the straight, manhole covers and drain grates by the kerbs.
export function roadDecals({ patch, paint, metal }, L) {
  patch.color(0x818185); // (darker than the worn road round them: sealed)
  for (const [x, z, w, d] of [[-700, 220, 420, 160], [900, -120, 260, 300], [-1900, 60, 600, 120], [-3300, -260, 380, 220], [1900, 150, 300, 180], [3300, -500, 340, 260]]) {
    patch.quad([x + w, 0.6, z], [x, 0.6, z], [x, 0.6, z + d], [x + w, 0.6, z + d], { uvs: [[x + w, z], [x, z], [x, z + d], [x + w, z + d]] });
  }
  const R = makeRng(77);
  paint.rgb(0.012, 0.012, 0.013);
  let [x, z] = [-1500, -330];
  for (let i = 0; i < 26; i++) {
    const nx = x + 60 + R() * 30;
    const nz = z + (R() - 0.45) * 40;
    paint.quad([nx, 0.7, nz - 1.6], [x, 0.7, z - 1.6], [x, 0.7, z + 1.6], [nx, 0.7, nz + 1.6]);
    [x, z] = [nx, nz];
  }
  // Covers: rings of cast iron, raised and sunk by turns.
  metal.color(0x2a2826);
  for (const [mx, mz, r] of [[450, 160, 45], [-2500, -120, 45], [3500, -250, 45]]) {
    for (let ring = 0; ring < 4; ring++) {
      const [ra, rb] = [(r * ring) / 4, (r * (ring + 1)) / 4];
      const y = ring % 2 ? 1.1 : 0.8;
      for (let i = 0; i < 20; i++) {
        const [a, b] = [(i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2];
        metal.quad([mx + Math.cos(b) * ra, y, mz + Math.sin(b) * ra], [mx + Math.cos(a) * ra, y, mz + Math.sin(a) * ra], [mx + Math.cos(a) * rb, y, mz + Math.sin(a) * rb], [mx + Math.cos(b) * rb, y, mz + Math.sin(b) * rb], { shade: ring % 2 ? 1.2 : 0.8 });
      }
    }
  }
  // Drain grates along the kerbs: bars across a dark slot.
  // (Off the drives' mouths; z from the straight's centreline.)
  for (const [gx, s] of [[-1900, 1], [1150, -1], [-3000, 1], [2200, -1]]) {
    const gz = L.ROAD.line.at(-1)[1] + s * (L.ROAD.half - 30);
    paint.rgb(0.01, 0.01, 0.01);
    paint.quad([gx + 40, 0.7, gz - 20], [gx - 40, 0.7, gz - 20], [gx - 40, 0.7, gz + 20], [gx + 40, 0.7, gz + 20]);
    metal.color(0x2a2826);
    for (let k = -35; k <= 35; k += 10) metal.box(gx + k - 2.5, gx + k + 2.5, 0.5, 1.4, gz - 20, gz + 20, { skip: 'b' });
  }
}

// The corner bed's field stones (plan.js bedStones: where the classic ones lie): squat, lumpy,
// round, grey or pinkish granite, along its asphalt edges and round its lawn side.
export function bedStones({ granite }, L) {
  bedStoneSpots(L).forEach((st, i) => {
    const { x, y, z, s, e, h, a } = st;
    granite.color(st.pink ? 0xc0a294 : 0xbab6ae, st.k);
    const lump = makeRng(1000 + i);
    const bumps = Array.from({ length: 10 * 5 }, () => 1 + 0.34 * (lump() - 0.5));
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    const rings = [];
    for (let j = 0; j < 5; j++) {
      const phi = -0.25 * Math.PI + (j / 4) * 0.7 * Math.PI;
      rings.push(Array.from({ length: 10 }, (_, q) => {
        const t = -(q / 10) * Math.PI * 2;
        const r = s * bumps[j * 10 + q] * Math.cos(phi);
        // (Longer along the edge by e, turned along it.)
        const [u, w] = [Math.cos(t) * r * e, Math.sin(t) * r];
        return [x + u * ca - w * sa, y + Math.sin(phi) * s * h + 4, z + u * sa + w * ca];
      }));
    }
    granite.loft(rings, { capEnd: true });
  });
}

// The turning area's sign (TURN_SIGN; its face: sign.js): a galvanized post in a concrete
// collar, two clamps, the plate's grey aluminium back and edges, its face in enamel (the
// reflective sheeting's sheen) a little grimy toward its foot and rim, the no-parking sign and
// the lettering on it; under it the small blank blue plate (W3).
export function turnSign({ steel, enamel, paint }, L) {
  const S = L.TURN_SIGN;
  const P = S.plate;
  const y0 = L.groundHeight(S.x, S.z);
  steel.color(0xa4a8aa);
  steel.cyl('y', y0 - 10, S.top, S.x, S.z, S.r, 12, { caps: true });
  paint.color(0x8c8a84);
  paint.cyl('y', y0 - 4, L.GROUND + L.BED.raise + 2, S.x, S.z, S.r + 5, 10, { caps: true });
  const f = [Math.sin(S.yaw), 0, Math.cos(S.yaw)];
  const right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)];
  const out = S.r + 2.5;
  const at = (u, v, d) => [S.x + f[0] * (out + d) + right[0] * (u - P.w / 2), P.y0 + v, S.z + f[2] * (out + d) + right[2] * (u - P.w / 2)];
  // The plate's back and edges (1.6 thick), the clamps round the post.
  steel.color(0xb4b6b8);
  const [a, b, c, d] = [at(0, 0, -1.6), at(P.w, 0, -1.6), at(P.w, P.h, -1.6), at(0, P.h, -1.6)];
  steel.quad(b, a, d, c);
  const [a2, b2, c2, d2] = [at(0, 0, 0), at(P.w, 0, 0), at(P.w, P.h, 0), at(0, P.h, 0)];
  steel.quad(a, b, b2, a2);
  steel.quad(d2, c2, c, d);
  steel.quad(a, a2, d2, d);
  steel.quad(b2, b, c, c2);
  steel.color(0x8a8c8e);
  for (const v of [12, P.h - 12]) steel.cyl('y', P.y0 + v - 3, P.y0 + v + 3, S.x, S.z, S.r + 1.2, 10, { caps: true });
  // The face: each layer a hair in front of the one under it; the yellow field in a grid of
  // quads, a little dirtier toward its foot and its rim.
  const grime = makeRng(4242);
  for (const { color, layer, poly } of signFace(P)) {
    enamel.color(color);
    if (layer !== 1) {
      const pts = poly.map(([u, v]) => at(u, v, 0.15 + 0.15 * layer));
      for (let i = 1; i + 1 < pts.length; i++) enamel.tri(pts[0], pts[i], pts[i + 1], { n: [f, f, f] });
      continue;
    }
    const [[u0, v0], , [u1, v1]] = poly;
    const [nu, nv] = [3, 6];
    const dirt = Array.from({ length: (nu + 1) * (nv + 1) }, (_, k) => {
      const [i, j] = [k % (nu + 1), Math.floor(k / (nu + 1))];
      const edge = i === 0 || i === nu || j === 0 || j === nv ? 0.06 : 0;
      return 1 - edge - 0.12 * (1 - j / nv) ** 2 - 0.05 * grime();
    });
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const q = (ii, jj) => at(u0 + ((u1 - u0) * ii) / nu, v0 + ((v1 - v0) * jj) / nv, 0.3);
        const sh = (ii, jj) => dirt[jj * (nu + 1) + ii];
        enamel.quad(q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1), { n: [f, f, f, f], shade: [sh(i, j), sh(i + 1, j), sh(i + 1, j + 1), sh(i, j + 1)] });
      }
    }
  }
  // The small blue plate under it (no text): its back and edges, its face.
  if (S.sub) {
    const [v0, v1] = [S.sub.y0 - P.y0, S.sub.y0 - P.y0 + S.sub.h];
    steel.color(0xb4b6b8);
    const [a3, b3, c3, d3] = [at(0, v0, -1.6), at(P.w, v0, -1.6), at(P.w, v1, -1.6), at(0, v1, -1.6)];
    const [a4, b4, c4, d4] = [at(0, v0, 0), at(P.w, v0, 0), at(P.w, v1, 0), at(0, v1, 0)];
    steel.quad(b3, a3, d3, c3);
    steel.quad(a3, b3, b4, a4);
    steel.quad(d4, c4, c3, d3);
    steel.quad(a3, a4, d4, d3);
    steel.quad(b4, b3, c3, c4);
    steel.color(0x8a8c8e);
    steel.cyl('y', S.sub.y0 + S.sub.h / 2 - 3, S.sub.y0 + S.sub.h / 2 + 3, S.x, S.z, S.r + 1.2, 10, { caps: true });
    enamel.color(0x1d4f9c);
    enamel.quad(at(1.5, v0 + 1.5, 0.3), at(P.w - 1.5, v0 + 1.5, 0.3), at(P.w - 1.5, v1 - 1.5, 0.3), at(1.5, v1 - 1.5, 0.3), { n: [f, f, f, f] });
    enamel.color(0xf0f0ec);
    enamel.quad(at(0, v0, 0.2), at(P.w, v0, 0.2), at(P.w, v1, 0.2), at(0, v1, 0.2), { n: [f, f, f, f] });
  }
}

// The neighbours' ground (W5): south_2's gravel (the granite set at a gravel's grain, over its
// hard surface, round its raised bed and its bed), the fresh dark soil of the young beech row and
// the beds' soil (the raised bed's top: its blocks are the classic build's, both looks); the
// link's two bins (the dad's bin turned round, their backs to the wall; boxes on low).
export function neighbourGround(kit, L) {
  const { granite, paint } = kit;
  const G = L.GROUND;
  const flat = (x0, x1, z0, z1, y, k = 3, tile = 500) => {
    for (let x = x0; x < x1 - 0.5; x += tile) {
      for (let z = z0; z < z1 - 0.5; z += tile) {
        const [a, b, c, d] = [Math.min(x1, x + tile), x, z, Math.min(z1, z + tile)];
        granite.quad([a, y, c], [b, y, c], [b, y, d], [a, y, d], { uvs: [[a * k, c * k], [b * k, c * k], [b * k, d * k], [a * k, d * k]] });
      }
    }
  };
  const P = L.S2_GARDEN;
  const [E, R, D, Gr] = [P.edging, P.raised, P.bed, P.gravel];
  const [z0, z1] = [E.z + E.w, Gr.z1];
  granite.rgb(0.5, 0.48, 0.45);
  for (const [x0, x1, za, zb] of [[Gr.x0, R.x0, z0, z1], [R.x0, R.x1, R.z1, z1], [R.x1, D.x0, z0, z1], [D.x0, Gr.x1, D.z1, z1], [D.x1, Gr.x1, z0, D.z1]]) flat(x0, x1, za, zb, G + 0.5);
  granite.rgb(0.2, 0.13, 0.08);
  const B = L.BEECH_ROW;
  flat(B.x0, B.x1, B.soil[0], B.soil[1], G + 0.8, 2);
  flat(D.x0 + 12, D.x1 - 12, D.z0 + 12, D.z1 - 12, G + 3, 2);
  // (The raised bed's top under its ground cover: dense dark green.)
  granite.rgb(0.05, 0.075, 0.025);
  flat(R.x0 + 14, R.x1 - 14, R.z0 + 14, R.z1 - 14, R.top - 2, 2);
  // The path's concrete slabs (~45 cm) over its hard surface, dark joints between them.
  const Pa = P.path;
  const n = Math.round((Pa.x1 - Pa.x0) / 66);
  const [sw, sd] = [(Pa.x1 - Pa.x0) / n, 66];
  for (let z = E.z + E.w + 2; z + sd <= Pa.z1 + 1; z += sd) {
    for (let i = 0; i < n; i++) {
      granite.rgb(...[0.72, 0.7, 0.66].map((c) => c * (0.94 + 0.08 * Math.sin(i * 7.1 + z * 0.37))));
      flat(Pa.x0 + i * sw + 2, Pa.x0 + (i + 1) * sw - 2, z + 2, z + sd - 2, G + 0.7, 1.2, 400);
    }
  }
  // (W5 fix: the slabs east of the path round the apron's corner to the plinth, short of the
  // footpath and round the soil beds: whole slabs only, the hard surface under them showing along
  // the curve; the beds' soil.)
  const Pv = P.paving;
  const F = L.FOOTPATH;
  const foot = [[F.from, F.half], [F.from, -F.half], [F.len, -F.half], [F.len, F.half]].map(([t, s]) => {
    const p = L.footpathAt(t, s);
    return [p.x, p.z];
  });
  const free = (x, z) => !L.inApron(x, z) && !L.inPolygon(foot, x, z) && !P.beds.some(([a, b, c, d]) => x > a - 2 && x < b + 2 && z > c - 2 && z < d + 2);
  for (let z = Pv.z1 - sd, j = 0; z >= Pv.z0 - 1; z -= sd, j++) {
    for (let x = Pv.x0, i = 0; x < Pv.x1 - 1; x += sd, i++) {
      const [x1, z1] = [Math.min(Pv.x1, x + sd), z + sd];
      if (![[x, z], [x1, z], [x1, z1], [x, z1]].every(([a, b]) => free(a, b))) continue;
      granite.rgb(...[0.64, 0.61, 0.56].map((c) => c * (0.93 + 0.09 * Math.sin(i * 5.3 + j * 2.9))));
      flat(x + 2, x1 - 2, z + 2, z1 - 2, G + 0.7, 1.2, 400);
    }
  }
  granite.rgb(0.2, 0.13, 0.08);
  for (const [x0, x1, z0, z1] of P.beds) flat(x0, x1, z0, z1, G + 1.5, 2);
  const K = L.LINK_BIN;
  if (kit.tier === 'low') {
    paint.color(0x182434);
    for (const b of L.LINK_BINS) {
      paint.box(b.x - K.x / 2 + 4, b.x + K.x / 2 - 4, G, G + K.h - 10, b.z - K.z / 2 + 6, b.z + K.z / 2, { skip: 'b' });
      paint.box(b.x - K.x / 2, b.x + K.x / 2, G + K.h - 10, G + K.h, b.z - K.z / 2, b.z + K.z / 2 + 4, { skip: 'b' });
    }
    return;
  }
  const g = new Geo();
  bins({ paint: g, tyre: g, steel: g }, { BIN: K });
  for (const b of L.LINK_BINS) {
    for (let i = 0; i < g.count; i++) {
      const [p, n] = [g.pos.slice(i * 3, i * 3 + 3), g.nrm.slice(i * 3, i * 3 + 3)];
      paint.tint = g.col.slice(i * 3, i * 3 + 3);
      paint.vertex([b.x - p[0], G + p[1], b.z - p[2]], [-n[0], n[1], -n[2]], g.uv.slice(i * 2, i * 2 + 2));
    }
  }
}
