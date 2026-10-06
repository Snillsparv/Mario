// The realistic look's street furniture and garden things (world/lane/real/detail.js builds them
// in the worker; the classic builders keep every collider): the dad's mailbox and its carved
// bird, the granite kerbs, the road's mended patches and covers, the corner bed's stones, the
// turning area's sign.
//
//   mailbox(kit, L)     // kit: detail.js's Geo per material (boards, paint, metal, enamel, bird,
//                       // gloss, granite, patch)
//   kerbs(kit, L)       // granite kerb stones along every edge of the road (the turning area
//                       // drawn round: plan.js roadPieces, kerbRuns), none at the drives
//                       // (an asphalt bevel up into them) or along the dad's corner bed
//   roadDecals(kit, L)  // mended patches, a sealed crack, manhole and drain covers
//   bedStones(kit, L)   // the corner bed's field stones (where the classic ones lie)
//   turnSign(kit, L)    // the turning area's sign at the bed's corner (its face: sign.js)
//
// The mailbox (MAILBOX): a black wooden box shaped like a little house, its gable end toward the
// street: chamfered board walls (the boards' texture, charcoal) on a planed post in a little
// concrete foot, a floor; a roof of two boards overhanging all round under a rounded ridge
// strip; at the street end the letter flap (proud, a shadow gap under it), a blank enamel plate
// (no name: the repository is public) and a framed door with a knob. The little blue sparrow
// (the sign calls it so) is a carved wooden bird painted blue: a white breast, a yellow beak,
// glossy black eyes, its wings raised and swept back like the real ornament's, its tail cocked
// up, on a rod at the ridge's street end, side-on to the street.

import { add, mul, norm, cross } from './geo.js';
import { roadPieces, kerbRuns, bedStones as bedStoneSpots } from './plan.js';
import { signFace } from './sign.js';
import { makeRng } from '../../../core/math.js';

const CHARCOAL = 0x2c2e31;
const ROOF = 0x26282b;
const BLUE = 0x4c79b8;

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
  const { boards, paint, metal, enamel, bird, gloss } = kit;
  const M = L.MAILBOX;
  const y0 = L.GROUND;
  const [bw, bd] = M.body;
  const { x: cx, z: cz } = M;
  const yb = y0 + M.post; // the box's floor
  const ye = M.eaves;
  const yr = M.ridge;
  const [x0, x1] = [cx - bw / 2, cx + bw / 2];
  const [zf, zb] = [cz - bd / 2, cz + bd / 2]; // the street end (-z), the back
  boards.color(CHARCOAL);
  chamfered(boards, cx - 6, cx + 6, cz - 6, cz + 6, y0 - 4, yb + 2, 1.6);
  chamfered(boards, x0, x1, zf, zb, yb, ye, 1.6);
  boards.quad([x0, yb, zf], [x1, yb, zf], [x1, yb, zb], [x0, yb, zb], { shade: 0.5 });
  for (const [z, s] of [[zf, -1], [zb, 1]]) {
    const [a, b, c] = [[x0, ye, z], [x1, ye, z], [cx, yr - 4, z]];
    if (s < 0) boards.tri(b, a, c, { uvs: [[x1, ye], [x0, ye], [cx, yr]] });
    else boards.tri(a, b, c, { uvs: [[x0, ye], [x1, ye], [cx, yr]] });
  }
  // The roof: two 3-thick boards overhanging 8 all round, a rounded ridge strip.
  paint.color(ROOF);
  const ov = 8;
  const T = 3;
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
  paint.cyl('z', zf - ov - 1, zb + ov + 1, cx, yr - 1, 3.2, 8, { a0: 0, arc: Math.PI, caps: true });
  // The street end: the flap (a shadow gap under it), the blank plate, the framed door and knob.
  const front = (g, xa, xb, ya, yb2, d) => g.box(xa, xb, ya, yb2, zf - d, zf, { skip: '+z' });
  paint.color(0x2a2c2f);
  front(paint, cx - 30, cx + 30, ye - 50, ye - 36, 3.5);
  gloss.rgb(0.01, 0.01, 0.01);
  gloss.quad([cx + 28, ye - 52, zf - 0.3], [cx - 28, ye - 52, zf - 0.3], [cx - 28, ye - 50, zf - 0.3], [cx + 28, ye - 50, zf - 0.3]);
  enamel.color(0xece9e2);
  front(enamel, cx - 17, cx + 17, ye - 30, ye - 19, 1);
  paint.color(0x2f3134);
  for (const [xa, xb, ya, yb2] of [[x0 + 8, x1 - 8, yb + 8, yb + 11], [x0 + 8, x1 - 8, yb + 62, yb + 65], [x0 + 8, x0 + 11, yb + 8, yb + 65], [x1 - 11, x1 - 8, yb + 8, yb + 65]]) front(paint, xa, xb, ya, yb2, 1.2);
  metal.color(0x8a8780);
  metal.cyl('z', zf - 4, zf, x1 - 18, yb + 36, 2.2, 10, { caps: true });
  // The concrete foot round the post.
  enamel.color(0x8c8a84);
  enamel.box(cx - 13, cx + 13, y0 - 2, y0 + 3, cz - 13, cz + 13, { skip: 'b' });
  carvedBird(kit, [cx, yr + 6, zf + 6]);
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
  // The tail: a flat fan cocked up behind.
  bird.color(BLUE, 0.8);
  const root = B(-12, 15, 0);
  const fan = [-1, -0.5, 0, 0.5, 1].map((k) => B(-30, 26 - Math.abs(k) * 2, k * 6));
  for (let i = 0; i < 4; i++) bird.tri(root, fan[i], fan[i + 1]);
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
// along the dad's corner bed none (its soil's dark face, the field stones over it: bedStones).
export function kerbs({ granite, core, patch }, L) {
  const G = L.GROUND;
  const stone = (p, q, n, drop) => {
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
      const [a, b] = [t0 + j, t1 - j];
      granite.color(drop ? 0x8a8884 : 0xd8d6d2);
      // The road face, the chamfer, the top; the joints' ends in shade.
      granite.quad(at(b, 0, -2), at(a, 0, -2), at(a, 0, top - ch), at(b, 0, top - ch));
      granite.quad(at(b, 0, top - ch), at(a, 0, top - ch), at(a, ch, top), at(b, ch, top));
      granite.quad(at(b, ch, top), at(a, ch, top), at(a, w, top), at(b, w, top));
      granite.quad(at(a, 0, -2), at(a, w, -2), at(a, w, top), at(a, 0, top), { shade: 0.6 });
      granite.quad(at(b, w, -2), at(b, 0, -2), at(b, 0, top), at(b, w, top), { shade: 0.6 });
    }
  };
  for (const { p, q, n, kind } of kerbRuns(L, roadPieces(L, { round: true }))) {
    if (kind === 'kerb') {
      stone(p, q, n, false);
      continue;
    }
    if (kind === 'drop') {
      // (At a drive the asphalt runs on up into it: a bevel from the road to its edge.)
      patch.color(0x7c7a74, 1.12);
      const o = (t, d, y) => [t[0] - n[0] * d, y, t[1] - n[1] * d];
      patch.quad(o(q, 22, 0.4), o(p, 22, 0.4), o(p, 0, G), o(q, 0, G), { uvs: [o(q, 22, 0), o(p, 22, 0), o(p, 0, 0), o(q, 0, 0)].map((v) => [v[0], v[2]]) });
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
  patch.color(0x3c3c40); // (darker than the worn road round them: fresh, sealed)
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
  for (const [gx, s] of [[-1200, 1], [600, -1], [-3000, 1], [2200, -1]]) {
    const gz = s * (L.ROAD.half - 30);
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
    granite.color(st.pink ? 0xb89486 : 0xaaa69f, st.k);
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
// the lettering on it.
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
}
