// STOMPWATT's frame (the machinery between the car's pieces: LaneBoss.js, model.js), in the
// robot's own frame standing at rest (rig.js BONES: x across, + its left; y up from its feet; z
// forward), each vertex on its bone. Pure geometry (world/lane/real/geo.js Geo), built for each
// look: the classic one flat-shaded boxes and 8-sided joints (the N64 look), the realistic one
// beveled, rounded blocks and smooth joints, finer on high.
//
//   buildFrame(look, tint, { chest }) -> { paint, black, metal, glow }   each a PartGeo (Geo + the
//       bone of every vertex: buffers() -> { position, normal, color, uv, part }); look: 'classic'
//       | 'high' | 'mid' | 'low'; tint: the car's body colour (hex); chest: where the car's roof
//       stands on its chest (z: the power gauge sits on it). paint: the body colour and the frame's
//       gloss black (the car's black roof's lacquer), black: grained black plastic and rubber,
//       metal: the joints, pistons and trim, glow: the green power lights (bright, unlit)
//
// The design (docs/ARCHITECTURE.md "STOMPWATT"): a chibi heavy-mech, its frame gloss black with
// silver joints, its body-colour armour on the forearms (big gauntlets), the thighs and the toes
// of its big boots; three green power lights on its chest (the car's black roof); nothing that is
// a face, an emblem or lettering.

import { Geo } from '../../world/lane/real/geo.js';
import { BONE, REST } from './rig.js';

export class PartGeo extends Geo {
  constructor() {
    super();
    this.bone = 0;
    this.parts = [];
    this.flat = []; // (uvs projected along the face's main axis, as castle/geom.js GeoBuilder's)
  }

  vertex(p, n, uv, shade) {
    super.vertex(p, n, uv, shade);
    this.parts.push(this.bone);
    const k = 1 / UV_REPEAT;
    const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    if (ay >= ax && ay >= az) this.flat.push(p[0] * k, -p[2] * k * Math.sign(n[1] || 1));
    else if (ax >= az) this.flat.push(-p[2] * k * Math.sign(n[0]), p[1] * k);
    else this.flat.push(p[0] * k * Math.sign(n[2]), p[1] * k);
  }

  buffers() {
    return { position: Float32Array.from(this.pos), normal: Float32Array.from(this.nrm), color: Float32Array.from(this.col), uv: Float32Array.from(this.flat), part: Uint8Array.from(this.parts) };
  }
}
const UV_REPEAT = 300; // (the lane's render texture: lane/build.js REPEAT.render)

const GLOSS = 0x23272c; // the frame: gloss black (the car's roof's lacquer)
const PLASTIC = 0x18191b;
const STEEL = 0x9ca3ab;
const DARK_STEEL = 0x50565e;
const GLOW = [0.25, 2.4, 0.7]; // the power lights (linear, bright: they bloom)
const GLOW_CLASSIC = [0.49, 1, 0.6];
const LOD = {
  classic: { sides: 8, per: 0, ball: [8, 5] },
  high: { sides: 18, per: 3, ball: [16, 10] },
  mid: { sides: 10, per: 1, ball: [10, 6] },
  low: { sides: 8, per: 0, ball: [8, 5] },
};

// A rounded rectangle's outline (half sizes a along x, b along z, corner radius r, `per` + 1
// points a corner), counter-clockwise seen from above, round (cx, cz).
function rrect(cx, cz, a, b, r, per) {
  const pts = [];
  r = Math.min(r, a - 0.01, b - 0.01);
  for (const [qx, qz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, (3 * Math.PI) / 2]]) {
    for (let i = 0; i <= per; i++) {
      const t = a0 + (per ? i / per : 0.5) * (Math.PI / 2);
      pts.push([cx + qx * (a - r) + Math.cos(t) * r, cz + qz * (b - r) + Math.sin(t) * r]);
    }
  }
  return pts.reverse(); // (clockwise to counter-clockwise seen from above: +x then +z)
}

export function buildFrame(look, tint, { chest = 100 } = {}) {
  const L = LOD[look] ?? LOD.high;
  const flat = look === 'classic';
  const G = { paint: new PartGeo(), black: new PartGeo(), metal: new PartGeo(), glow: new PartGeo() };
  let bone = 0;
  const on = (name) => {
    bone = BONE[name];
    for (const g of Object.values(G)) g.bone = bone;
  };

  // A block round c (half sizes h), its edges beveled by r (flat boxes in the classic look).
  const block = (g, c, h, r = 8) => {
    if (flat) {
      g.box(c[0] - h[0], c[0] + h[0], c[1] - h[1], c[1] + h[1], c[2] - h[2], c[2] + h[2], { under: 0.8 });
      return;
    }
    taper(g, c[1] - h[1], c[1] + h[1], [c[0], c[2]], [h[0], h[2]], [c[0], c[2]], [h[0], h[2]], r);
  };
  // An upright block from y0 to y1, its cross-section from half sizes h0 round m0 ([x, z]) at y0 to
  // h1 round m1 at y1, its edges beveled by r.
  const taper = (g, y0, y1, m0, h0, m1, h1, r = 8) => {
    const at = (t) => [m0[0] + (m1[0] - m0[0]) * t, m0[1] + (m1[1] - m0[1]) * t, h0[0] + (h1[0] - h0[0]) * t, h0[1] + (h1[1] - h0[1]) * t];
    if (flat) {
      const ring = (t, y) => {
        const [cx, cz, a, b] = at(t);
        return [[cx + a, y, cz + b], [cx - a, y, cz + b], [cx - a, y, cz - b], [cx + a, y, cz - b]];
      };
      const [lo, hi] = [ring(0, y0), ring(1, y1)];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        g.quad(lo[j], lo[i], hi[i], hi[j], { shade: 1 });
      }
      g.quad(hi[3], hi[2], hi[1], hi[0]);
      g.quad(lo[0], lo[1], lo[2], lo[3], { shade: 0.8 });
      return;
    }
    const e = Math.min(r, (y1 - y0) / 3);
    const levels = [[0, e], [e * 0.3, e * 0.3], [e, 0], [y1 - y0 - e, 0], [y1 - y0 - e * 0.3, e * 0.3], [y1 - y0, e]];
    const rings = levels.map(([dy, inset]) => {
      const t = dy / (y1 - y0);
      const [cx, cz, a, b] = at(t);
      return rrect(cx, cz, a - inset, b - inset, r, L.per).map(([x, z]) => [x, y0 + dy, z]);
    });
    g.loft(rings);
    const cap = (ring, up) => {
      const m = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length, s[2] + p[2] / ring.length], [0, 0, 0]);
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (up) g.tri(m, ring[i], ring[j]);
        else g.tri(m, ring[j], ring[i]);
      }
    };
    cap(rings[0], false);
    cap(rings[rings.length - 1], true);
  };
  const cylX = (g, c, r, half, sides = L.sides) => g.cyl('x', c[0] - half, c[0] + half, c[1], c[2], r, sides, { caps: true });
  const cylY = (g, c, r, y0, y1, sides = L.sides) => g.cyl('y', y0, y1, c[0], c[2], r, sides, { caps: true });
  const g3 = (g, axis, from, to, c1, c2, r) => g.cyl(axis, from, to, c1, c2, r, L.sides, { caps: true });
  const ball = (g, c, r) => g.ellipsoid(c, [1, 0, 0], [0, 1, 0], [0, 0, 1], r, r, r, L.ball[0], L.ball[1]);
  const body = (g) => g.color(tint);
  const gloss = (g) => g.color(GLOSS);
  const R = REST;

  // The pelvis: a beveled hip block (the car's floor rides round it as a belt), the hip joints'
  // housing under it.
  on('pelvis');
  const py = R.pelvis[1];
  block(gloss(G.paint), [0, py + 2, -4], [84, 34, 52], 12);
  G.metal.color(DARK_STEEL);
  block(G.metal, [0, py - 34, -4], [50, 10, 36], 5);
  // The chest: a torso widening up to its shoulders, body-colour armour round its sides and over
  // its shoulders (the car's greenhouse stands on its front, the black roof forward, and the
  // car's tail on its back).
  on('chest');
  const cy = R.chest[1];
  taper(gloss(G.paint), cy, cy + 70, [0, -8], [72, 46], [0, -10], [98, 54], 14);
  taper(body(G.paint), cy + 56, cy + 214, [0, -2], [100, 58], [0, -8], [136, 64], 20);
  block(body(G.paint), [0, R.shL[1] + 8, -8], [R.shL[0] + 6, 26, 54], 18);
  // (A dark grille in its waist, under the greenhouse.)
  G.black.color(PLASTIC);
  block(G.black, [0, cy + 26, 34], [52, 20, 12], 4);
  // The power gauge on its chest, on the greenhouse's black roof: a battery on its left side (a
  // steel case with its terminal on top), three green cells stacked in it (its power: a cell goes
  // out with every hit, B3), not a face.
  const front = chest + 1.5; // (on the roof's face)
  const [gx, gy] = [44, cy + 140];
  G.metal.color(STEEL);
  block(G.metal, [gx, gy, front - 1.5], [20, 38, 2.5], 3);
  block(G.metal, [gx, gy + 42, front - 1.5], [8, 5, 2.5], 2);
  G.black.color(PLASTIC);
  block(G.black, [gx, gy, front - 0.5], [15, 33, 2.2], 2);
  G.glow.rgb(...(flat ? GLOW_CLASSIC : GLOW));
  for (const dy of [-21, 0, 21]) block(G.glow, [gx, gy + dy, front + 1], [11.5, 8, 2.2], 2);
  // The neck: a steel column in a black collar.
  on('neck');
  G.metal.color(STEEL);
  cylY(G.metal, R.neck, 28, R.neck[1] - 12, R.neck[1] + 46);
  G.black.color(PLASTIC);
  cylY(G.black, R.neck, 40, R.neck[1] - 16, R.neck[1] + 4);
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    // Arms: a steel shoulder ball, a gloss black upper arm, a steel elbow, a big gauntlet in the
    // body colour (wider at the wrist), a black hand the wheel fist turns on.
    const sh = R[`sh${S}`];
    const el = R[`el${S}`];
    const wr = R[`wr${S}`];
    on(`sh${S}`);
    G.metal.color(STEEL);
    ball(G.metal, sh, 42);
    block(gloss(G.paint), [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2 + 4, (sh[2] + el[2]) / 2], [32, (sh[1] - el[1]) / 2 - 8, 32], 10);
    on(`el${S}`);
    G.metal.color(STEEL);
    cylX(G.metal, el, 30, 32);
    taper(body(G.paint), wr[1] + 18, el[1] - 10, [el[0], wr[2]], [50, 48], [el[0], el[2]], [38, 38], 12);
    G.black.color(PLASTIC);
    block(G.black, [wr[0], wr[1] + 22, wr[2]], [48, 7, 46], 3);
    on(`wr${S}`);
    G.metal.color(DARK_STEEL);
    block(G.metal, [wr[0], wr[1] - 6, wr[2]], [34, 18, 32], 6);
    // (The wheel fist's back: a dark hub plate behind its rim.)
    G.black.color(PLASTIC);
    g3(G.black, 'z', wr[2] + 6, wr[2] + 14, wr[0], wr[1] - 48, 46);
    G.metal.color(STEEL);
    cylY(G.metal, [wr[0], 0, wr[2] + 4], 15, wr[1] - 40, wr[1] - 16);
    // Legs: a steel hip ball, a stout gloss black thigh with a body-colour plate on its front, a
    // steel knee, a black shin behind the car's rear door (its shin guard), a steel ankle, a big
    // boot: a black sole, a body-colour toe cap; the car's rear wheel its heel roller.
    const hip = R[`hip${S}`];
    const kn = R[`kn${S}`];
    const an = R[`an${S}`];
    on(`hip${S}`);
    G.metal.color(STEEL);
    ball(G.metal, hip, 38);
    taper(gloss(G.paint), kn[1], hip[1], [kn[0], 8], [42, 42], [hip[0], 4], [50, 48], 18);
    block(body(G.paint), [kn[0], (hip[1] + kn[1]) / 2 + 4, 50], [38, (hip[1] - kn[1]) / 2 - 12, 8], 7);
    G.metal.color(STEEL);
    cylY(G.metal, [kn[0] + s * 40, 0, -22], 7, kn[1] + 14, hip[1] - 10, 6);
    on(`kn${S}`);
    G.metal.color(STEEL);
    cylX(G.metal, kn, 34, 38);
    taper(gloss(G.paint), an[1] + 4, kn[1], [an[0], 10], [44, 40], [kn[0], 8], [36, 34], 16);
    on(`an${S}`);
    G.metal.color(STEEL);
    cylX(G.metal, an, 26, 34);
    block(gloss(G.paint), [an[0], 24, 16], [58, 24, 82], 18);
    block(body(G.paint), [an[0], 36, 80], [56, 22, 36], 16);
    G.black.color(PLASTIC);
    block(G.black, [an[0], 5, 18], [60, 5, 88], 3);
  }
  return G;
}
