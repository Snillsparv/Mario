// Geometry and material of the Rustmaw, the original giant mechanical lizard of AI RACE mode.
//
// Design: a long, low war machine built like a monitor lizard, sprawled along the castle's
// front-hall ridge. A flattened, gunmetal body carried horizontally, clad in rows of small,
// low overlapping scale plates (shingled scutes, thin at the front edge and raised at the rear)
// along the back and flanks, over a darker ribbed belly. Four splayed legs with bent, rust-red
// ball-joint elbows and knees push the body up, and five-toed feet with hooked metal claws
// grip the roof tiles. A flexible segmented neck, braced by twin hoses, carries a long, low,
// wedge-shaped head: a flat skull with a tapering snout, red optic lenses set on the sides of
// the head under armoured brow plates, round "ear" grilles, ember nostril vents, and a big
// hinged lower jaw, both jaws lined with steel teeth. Under the chin hangs a V-shaped ribbed
// throat dewlap. Louvred exhaust vents sit on the shoulders and two exhaust pipes on the hips;
// a furnace grille glows in the chest. A long whip tail of tapering segments trails away and
// curls at its tip. The palate, tongue plate, throat vent, dewlap and chest furnace glow
// furnace-orange as it charges a shot.
//
// The rig is a handful of rigid parts (one mesh = one draw call each), all sharing one
// flat-shaded Lambert material with vertex colours and an extra per-vertex emission attribute:
//   hips (root: pelvis, hind legs, hip exhausts), torso (pivot at the pelvis) -> neck -> head
//   -> jaw, armL, armR (front legs, at the shoulders), tailA -> tailB
// Rig space: world units, the root's frame (the soles on y = 0, facing +Z; RobotBeast stands the
// root on the roof). Each part's geometry is built around its own pivot (buildBeastGeometries);
// RobotBeast places the pivots from the RIG landmarks.
//
// Fitted to the castle (layout.KAIJU): the feet grip the front hall's gable slopes, the belly
// rests on its ridge, the neck rises over the front facade and the tail climbs over the block
// behind, around the right side of the keep, and down onto the east wing's roof.

import * as THREE from 'three';
import { makeRng } from '../core/math.js';

// ---------------------------------------------------------------- palette

// Written in sRGB (as picked); vertex colours are linear, so PartBuilder converts them.
const GUN = [0.33, 0.35, 0.4];
const GUN_LIGHT = [0.45, 0.47, 0.52];
const GUN_DARK = [0.17, 0.18, 0.21];
const STEEL = [0.5, 0.52, 0.55];
const STEEL_DARK = [0.2, 0.2, 0.22];
const RUST = [0.78, 0.28, 0.1];
const RUST_DARK = [0.5, 0.16, 0.07];
const CLAW = [0.66, 0.64, 0.58];
const TOOTH = [0.8, 0.79, 0.74];
const CABLE = [0.12, 0.11, 0.11];
const HAZARD = [0.92, 0.7, 0.12];
const EYE = [1, 0.14, 0.06];
const EMBER = [1, 0.42, 0.1];
const FURNACE = [1, 0.5, 0.12];

// Emission: [constant (scaled by the power uniform), charge-driven (scaled by uCharge)].
const E_NONE = [0, 0];
const E_EYE = [2.6, 0];
const E_EMBER = [0.9, 0.9];
const E_JOINT = [0.28, 0.35]; // the rust joints run red-hot (reads in the dark)
const E_GRILLE = [0.85, 1.6];
const E_CORE = [1.2, 1.4];
const E_THROAT = [0.2, 2.4];
const E_DEWLAP = [0.12, 2.2];

// Rig landmarks (rig space unless noted; x mirrored for the left side where a single side is
// given). See the header for the frame.
export const RIG = {
  FOOT_F: [430, 0, -120], // front foot sole centre (on the gable slope)
  FOOT_H: [430, 0, -620], // hind foot sole centre
  FOOT_ROLL: 0.8, // the soles tilt outward-down by this much (the gable's 46 degree slope)
  SHOULDER: [400, 690, 100], // front leg pivots
  ELBOW: [770, 520, -40],
  WRIST: [520, 175, -100],
  HIP: [400, 710, -570],
  KNEE: [800, 580, -370],
  ANKLE: [560, 185, -710],
  WAIST: [0, 740, -590], // torso pivot: the pelvis centre
  PELVIS: [
    [0, 742, -400],
    [0, 745, -590],
    [0, 760, -840],
  ],
  PELVIS_R: [
    [420, 328],
    [390, 315],
    [275, 242],
  ],
  TRUNK: [
    [0, 740, -710],
    [0, 745, -480],
    [0, 750, -190],
    [0, 755, 70],
    [0, 775, 270],
    [0, 810, 410],
  ],
  TRUNK_R: [
    [330, 270],
    [420, 322],
    [455, 345],
    [432, 336],
    [352, 292],
    [262, 238],
  ],
  NECK: [0, 830, 390], // neck pivot
  NECK_PTS: [
    [0, 0, 0],
    [0, 105, 145],
    [0, 200, 285],
    [0, 262, 400],
    [0, 290, 485],
  ], // neck space; the head pivot is the last point
  NECK_R: [
    [250, 228],
    [230, 208],
    [212, 190],
    [196, 176],
    [184, 164],
  ],
  JAW: [0, -50, -70], // jaw hinge (head space)
  MOUTH: [0, -45, 900], // fireball spawn (head space), between the jaw tips
  THROAT: [0, -60, 330], // charge glow inside the mouth (head space)
  EYES: [
    [-200, 85, 150],
    [200, 85, 150],
  ], // head space
  DEWLAP: [0, -250, 330], // dewlap glow (head space, on the jaw)
  CORE: [0, 660, 450], // chest furnace (rig space)
  VENTS: [
    [-180, 1125, 60],
    [180, 1125, 60],
    [-240, 1190, -820],
    [240, 1190, -820],
  ], // exhaust outlets (rig space): shoulder louvres, hip pipes
  TAIL_A: [
    [0, 790, -600],
    [300, 1120, -680],
    [560, 1200, -860],
    [725, 1180, -1330],
  ],
  TAIL_A_R: [
    [232, 206],
    [205, 185],
    [178, 160],
    [150, 136],
  ],
  TAIL_B: [
    [725, 1180, -1330],
    [800, 1040, -1700],
    [900, 600, -2000],
    [1000, 230, -2270],
    [1060, 365, -2520],
    [1070, 585, -2640],
  ],
  TAIL_B_R: [
    [150, 136],
    [130, 116],
    [108, 96],
    [86, 76],
    [64, 57],
    [42, 38],
  ],
};

// The head pivot in rig space (the neck's tip).
export function headPivot() {
  const n = RIG.NECK_PTS[RIG.NECK_PTS.length - 1];
  return [RIG.NECK[0] + n[0], RIG.NECK[1] + n[1], RIG.NECK[2] + n[2]];
}

// ---------------------------------------------------------------- vector helpers

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.sqrt(dot3(a, a));
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p, s) => [p[0] * s, p[1], p[2]];
// p + x*X + y*Y + z*Z
const frameAt = (p, X, Y, Z, x, y, z) => [
  p[0] + X[0] * x + Y[0] * y + Z[0] * z,
  p[1] + X[1] * x + Y[1] * y + Z[1] * z,
  p[2] + X[2] * x + Y[2] * y + Z[2] * z,
];

// Frames along a polyline (parallel transport): tangent t, side and up (up is the dorsal side
// for a horizontal path heading +Z).
function pathFrames(pts) {
  const n = pts.length;
  const frames = [];
  let side = null;
  for (let i = 0; i < n; i++) {
    const t = norm3(sub3(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
    side = side ? sub3(side, mul3(t, dot3(side, t))) : cross3(t, Math.abs(t[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
    side = norm3(side);
    frames.push({ t, side, up: cross3(side, t) });
  }
  return frames;
}

// A sampler along a tube: at(u) interpolates centre, frame and radii (u = 0 .. n - 1).
function tubeSampler(pts, radii) {
  const frames = pathFrames(pts);
  const n = pts.length;
  return (u) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(u)));
    const f = Math.min(1, Math.max(0, u - i));
    const a = frames[i];
    const b = frames[i + 1];
    const t = norm3(lerp3(a.t, b.t, f));
    let side = lerp3(a.side, b.side, f);
    side = norm3(sub3(side, mul3(t, dot3(side, t))));
    return { c: lerp3(pts[i], pts[i + 1], f), t, side, up: cross3(side, t), rx: radii[i][0] + (radii[i + 1][0] - radii[i][0]) * f, ry: radii[i][1] + (radii[i + 1][1] - radii[i][1]) * f };
  };
}

// Point and outward normal on an elliptical tube section at angle a (a = PI/2: the top).
function surfaceAt(s, a) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const pos = add3(s.c, add3(mul3(s.side, c * s.rx), mul3(s.up, sn * s.ry)));
  const normal = norm3(add3(mul3(s.side, c / s.rx), mul3(s.up, sn / s.ry)));
  return { pos, normal };
}

// ---------------------------------------------------------------- builder

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Collects flat-shaded primitives into one non-indexed geometry with colour and emission.
class PartBuilder {
  constructor(seed) {
    this.pos = [];
    this.col = [];
    this.emit = [];
    this.rng = makeRng(seed);
  }

  // Linear colour with a slight random per-piece variation (plates read as separate panels).
  lin(color, vary = 0.06) {
    const k = 1 + (this.rng() - 0.5) * 2 * vary;
    return [srgbToLinear(color[0] * k), srgbToLinear(color[1] * k), srgbToLinear(color[2] * k)];
  }

  // Appends a three.js geometry transformed by `matrix`, coloured and with emission `emit`.
  add(geometry, matrix, color, emit = E_NONE, vary = 0.06) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const p = g.attributes.position.array;
    const [r, gr, bl] = this.lin(color, vary);
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.col.push(r, gr, bl);
      this.emit.push(emit[0], emit[1]);
    }
    g.dispose();
    geometry.dispose();
  }

  // Triangle with a linear colour, wound so its normal points away from `inside` (a point) or,
  // with `twoSided`, both ways (thin membranes).
  tri(a, b, c, lin, emit = E_NONE, inside = null, twoSided = false) {
    let B = b;
    let C = c;
    if (inside) {
      const n = cross3(sub3(b, a), sub3(c, a));
      const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (dot3(n, sub3(centroid, inside)) < 0) {
        B = c;
        C = b;
      }
    }
    for (const p of [a, B, C]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(lin[0], lin[1], lin[2]);
      this.emit.push(emit[0], emit[1]);
    }
    if (twoSided) this.tri(a, C, B, lin, emit);
  }

  quad(a, b, c, d, lin, emit, inside, twoSided) {
    this.tri(a, b, c, lin, emit, inside, twoSided);
    this.tri(a, c, d, lin, emit, inside, twoSided);
  }

  // A deformed box from 8 corners, indexed by bits (x+: 1, y+: 2, z+: 4). Mirrored corner sets
  // (left-handed) are detected and rewound.
  hexa(corners, color, emit = E_NONE, vary = 0.06) {
    const ex = sub3(corners[1], corners[0]);
    const ey = sub3(corners[2], corners[0]);
    const ez = sub3(corners[4], corners[0]);
    const flip = dot3(cross3(ex, ey), ez) < 0 ? 1 : 0;
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const bit = ((p.getX(i) > 0 ? 1 : 0) ^ flip) | (p.getY(i) > 0 ? 2 : 0) | (p.getZ(i) > 0 ? 4 : 0);
      const c = corners[bit];
      p.setXYZ(i, c[0], c[1], c[2]);
    }
    this.add(g, _m.identity(), color, emit, vary);
  }

  // A tapered box: bottom (y0) half sizes bx/bz, top (y1) half sizes tx/tz, centred on (cx, cz)
  // at the bottom and shifted by (sx, sz) at the top.
  slab(cx, cz, y0, y1, bx, bz, tx, tz, sx, sz, color, emit, vary) {
    const c = [];
    for (let bit = 0; bit < 8; bit++) {
      const top = bit & 2;
      const hx = top ? tx : bx;
      const hz = top ? tz : bz;
      c.push([cx + (top ? sx : 0) + (bit & 1 ? hx : -hx), top ? y1 : y0, cz + (top ? sz : 0) + (bit & 4 ? hz : -hz)]);
    }
    this.hexa(c, color, emit, vary);
  }

  // A box of size (w, h, d) centred at (x, y, z), rotated by Euler (rx, ry, rz).
  box(x, y, z, w, h, d, color, emit, rx = 0, ry = 0, rz = 0) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(w, h, d));
    this.add(new THREE.BoxGeometry(1, 1, 1), _m, color, emit);
  }

  // A box in the frame (X, Y, Z) (right-handed) centred at p: size w (X), h (Y), d (Z).
  frameBox(p, X, Y, Z, w, h, d, color, emit, vary) {
    const c = [];
    for (let bit = 0; bit < 8; bit++) c.push(frameAt(p, X, Y, Z, bit & 1 ? w / 2 : -w / 2, bit & 2 ? h / 2 : -h / 2, bit & 4 ? d / 2 : -d / 2));
    this.hexa(c, color, emit, vary);
  }

  // A plate along the bone a -> b, pushed `off` toward `out`: w across, t thick.
  bonePlate(a, b, out, off, w, t, color, emit, shrink = 0.8) {
    const Y = norm3(sub3(b, a));
    const Z = norm3(sub3(out, mul3(Y, dot3(out, Y))));
    const X = cross3(Y, Z);
    const l = len3(sub3(b, a)) * shrink;
    this.frameBox(add3(lerp3(a, b, 0.5), mul3(Z, off)), X, Y, Z, w, l, t, color, emit);
  }

  // A cylinder from point a to point b (radius ra at a, rb at b).
  cyl(a, b, ra, rb, sides, color, emit) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _q.setFromUnitVectors(Y_AXIS, _v.set(dx / len, dy / len, dz / len));
    _m.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rb, ra, len, sides, 1), _m, color, emit);
  }

  // A short ring (collar) of radius r and length `len` around the axis a->b at point a.
  ring(a, b, r, len, color, emit, sides = 8) {
    const d = norm3(sub3(b, a));
    this.cyl(add3(a, mul3(d, -len / 2)), add3(a, mul3(d, len / 2)), r, r, sides, color, emit);
  }

  ball(c, r, color, emit, detail = 0) {
    _m.makeTranslation(c[0], c[1], c[2]);
    this.add(new THREE.IcosahedronGeometry(r, detail), _m, color, emit);
  }

  // A cone from base centre a (radius r) to tip b.
  cone(a, b, r, sides, color, emit) {
    this.cyl(a, b, r, 0.5, sides, color, emit);
  }

  // A tube of elliptical sections [rx, ry] along `pts` (see pathFrames), `sides` around.
  // colorAt(segment, sinOfAngle) picks each quad's colour; caps close the ends.
  tube(pts, radii, sides, colorAt, emit = E_NONE, { capStart = true, capEnd = true, emitAt = null } = {}) {
    const frames = pathFrames(pts);
    const rings = pts.map((p, i) => {
      const f = frames[i];
      const out = [];
      for (let k = 0; k < sides; k++) {
        const a = ((k + 0.5) / sides) * Math.PI * 2;
        out.push(add3(p, add3(mul3(f.side, Math.cos(a) * radii[i][0]), mul3(f.up, Math.sin(a) * radii[i][1]))));
      }
      return out;
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const inside = lerp3(pts[i], pts[i + 1], 0.5);
      const cache = new Map();
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const sn = Math.sin(((k + 1) / sides) * Math.PI * 2);
        const color = colorAt(i, sn);
        if (!cache.has(color)) cache.set(color, this.lin(color, 0.04));
        const e = emitAt ? emitAt(i, sn) : emit;
        this.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k], cache.get(color), e, inside);
      }
    }
    const n = pts.length;
    const cap = (i, j) => {
      const lin = this.lin(colorAt(Math.min(i, n - 2), 0), 0.04);
      for (let k = 0; k < sides; k++) this.tri(pts[i], rings[i][k], rings[i][(k + 1) % sides], lin, emit, pts[j]);
    };
    if (capStart) cap(0, 1);
    if (capEnd) cap(n - 1, n - 2);
  }

  // A low shingle plate (scute) on a surface point `pos` with outward `normal`, lying along
  // `fwd` (toward the head): w across, l along, thin at the front edge and raised to h at the
  // rear, its bottom sunk a little into the surface.
  scute(pos, normal, fwd, w, l, h, color, emit = E_NONE) {
    const Y = norm3(normal);
    const Z = norm3(sub3(fwd, mul3(Y, dot3(fwd, Y))));
    const X = cross3(Y, Z);
    const c = [];
    for (let bit = 0; bit < 8; bit++) {
      const top = bit & 2;
      const front = bit & 4;
      const hw = top ? w * 0.4 : w * 0.5;
      const y = top ? (front ? h * 0.3 : h) : -h * 0.6;
      const z = (front ? 1 : -1) * (top ? l * 0.42 : l * 0.5);
      c.push(frameAt(pos, X, Y, Z, bit & 1 ? hw : -hw, y, z));
    }
    // Top and four sides (the bottom is buried in the surface).
    const lin = this.lin(color, 0.1);
    const inside = frameAt(pos, X, Y, Z, 0, -h, 0);
    this.quad(c[2], c[3], c[7], c[6], lin, emit, inside);
    this.quad(c[0], c[1], c[3], c[2], lin, emit, inside);
    this.quad(c[4], c[5], c[7], c[6], lin, emit, inside);
    this.quad(c[0], c[4], c[6], c[2], lin, emit, inside);
    this.quad(c[1], c[5], c[7], c[3], lin, emit, inside);
  }

  // Rows of scutes along a tube: rows = [{ a, w, l, h, color? }] (a: angle round the section,
  // PI/2 = top); from u0 to u1 in steps of about `step` units, every other station shifted by
  // `stagger` radians; `dir` +1 when the path runs toward the head, -1 when it runs away.
  scuteRows(sample, u0, u1, n, rows, { stagger = 0, dir = 1, rustChance = 0.12, taper = 0 } = {}) {
    for (let j = 0; j < n; j++) {
      const f = n === 1 ? 0.5 : j / (n - 1);
      const s = sample(u0 + (u1 - u0) * f);
      const k = 1 - taper * f;
      for (const r of rows) {
        const a = r.a + (j % 2 ? stagger : 0);
        const { pos, normal } = surfaceAt(s, a);
        const color = this.rng() < rustChance ? RUST_DARK : (r.color ?? GUN_LIGHT);
        this.scute(pos, normal, mul3(s.t, dir), r.w * k, r.l * k, r.h * k, color);
      }
    }
  }

  // Positions translated by -origin (the part's pivot), flat normals.
  build(origin = [0, 0, 0]) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = this.pos[i] - origin[0];
      pos[i + 1] = this.pos[i + 1] - origin[1];
      pos[i + 2] = this.pos[i + 2] - origin[2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.emit, 2));
    geo.computeVertexNormals(); // flat: the geometry is non-indexed
    geo.computeBoundingSphere();
    return geo;
  }
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------- limbs

// A clawed foot on a sole plane through `sole` (rig space), side s (+1 right): the sole tilts
// outward-down by `roll` and the toes fan out around a heading `yaw` (radians from +Z toward
// the outside). Five toes (the fourth longest, as a lizard's), each a two-segment digit with a
// knuckle joint and a hooked claw digging into the surface.
function foot(b, s, sole, { roll, yaw, len, width, heel, lift, fan = 1 }) {
  const M = new THREE.Matrix4().makeRotationZ(-s * roll).multiply(new THREE.Matrix4().makeRotationY(s * yaw));
  const pv = new THREE.Vector3();
  const at = (x, y, z) => {
    pv.set(s * x, y, z).applyMatrix4(M);
    return [sole[0] + pv.x, sole[1] + pv.y, sole[2] + pv.z];
  };
  // Sole plate: a tapered block, wider at the toes, with a raised instep.
  const c = [];
  for (let bit = 0; bit < 8; bit++) {
    const top = bit & 2;
    const front = bit & 4;
    const hw = (front ? width * 0.5 : width * 0.36) * (top ? 0.8 : 1);
    c.push(at(bit & 1 ? hw : -hw, top ? (front ? 70 : 110) : 0, front ? len * 0.2 : -heel));
  }
  b.hexa(c, GUN_DARK);
  b.hexa(
    [0, 1, 2, 3, 4, 5, 6, 7].map((bit) => {
      const top = bit & 2;
      const front = bit & 4;
      const hw = (front ? width * 0.36 : width * 0.3) * (top ? 0.7 : 1);
      return at(bit & 1 ? hw : -hw, top ? (front ? 120 : 160) : 60, front ? len * 0.1 : -heel * 0.8);
    }),
    GUN,
  );
  // Toes: fanned from the inner (thumb) side to the outer side.
  const toes = [
    [-0.5, 0.6],
    [-0.22, 0.85],
    [0.05, 1],
    [0.3, 1.05],
    [0.58, 0.72],
  ];
  for (const [a0, k] of toes) {
    const a = a0 * fan;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const root = [dx * width * 0.36, 45, len * 0.12 + dz * 30];
    const l = len * k;
    const knuckle = [root[0] + dx * l * 0.5, 60 + lift * 0.3, root[2] + dz * l * 0.5];
    const tip = [root[0] + dx * l, 40, root[2] + dz * l];
    const claw = [tip[0] + dx * 75, -40, tip[2] + dz * 75];
    b.cyl(at(...root), at(...knuckle), 40, 38, 4, GUN);
    b.cyl(at(...knuckle), at(...tip), 38, 30, 4, RUST_DARK, E_JOINT);
    b.cone(at(...tip), at(...claw), 30, 4, CLAW);
  }
}

// A leg: rust ball joints, a heavy upper bone with an armour plate, a lower bone with a
// hydraulic ram behind it, and the clawed foot.
function leg(b, s, j, { r0, r1, r2, sole, footOpts, back }) {
  const [top, mid, low] = j;
  b.ball(top, r0 * 1.1, RUST, E_JOINT, 1);
  b.cyl(top, mid, r0, r1, 6, GUN);
  b.bonePlate(top, mid, [s * 0.3, 1, 0], r0 * 0.75, r0 * 1.4, 34, GUN_LIGHT);
  b.ring(lerp3(top, mid, 0.85), mid, r1 * 1.12, 40, RUST_DARK);
  b.ball(mid, r1 * 1.05, RUST, E_JOINT, 1);
  // Elbow / knee guard: a low rounded cap on the outside (no spikes).
  b.bonePlate(mid, lerp3(mid, low, 0.35), [s, 0.4, back * 0.4], r1 * 0.8, r1 * 1.3, 30, GUN_LIGHT, E_NONE, 1);
  b.cyl(mid, low, r1 * 0.95, r2, 6, GUN_LIGHT);
  const ram = [0, 0, back * r1 * 0.9];
  b.cyl(add3(lerp3(mid, low, 0.1), ram), add3(lerp3(mid, low, 0.85), ram), 26, 26, 6, STEEL_DARK);
  b.cyl(add3(lerp3(mid, low, 0.55), ram), add3(lerp3(mid, low, 0.95), ram), 16, 16, 6, STEEL);
  b.ball(low, r2 * 1.05, RUST, E_JOINT);
  b.cyl(low, add3(sole, [0, 90, 0]), r2 * 0.9, r2 * 0.8, 6, GUN);
  foot(b, s, sole, footOpts);
}

function frontLeg(b, s) {
  leg(b, s, [mirror(RIG.SHOULDER, s), mirror(RIG.ELBOW, s), mirror(RIG.WRIST, s)], {
    r0: 172,
    r1: 150,
    r2: 118,
    sole: mirror(RIG.FOOT_F, s),
    footOpts: { roll: RIG.FOOT_ROLL, yaw: 0.55, len: 190, width: 250, heel: 130, lift: 60, fan: 0.85 },
    back: -1,
  });
}

function hindLeg(b, s) {
  leg(b, s, [mirror(RIG.HIP, s), mirror(RIG.KNEE, s), mirror(RIG.ANKLE, s)], {
    r0: 185,
    r1: 156,
    r2: 122,
    sole: mirror(RIG.FOOT_H, s),
    footOpts: { roll: RIG.FOOT_ROLL, yaw: 0.3, len: 270, width: 270, heel: 180, lift: 60 },
    back: 1,
  });
}

// ---------------------------------------------------------------- parts

// Pelvis, hind legs and the hip exhaust pipes (root space).
function buildHips() {
  const b = new PartBuilder(11);
  const pelvis = RIG.PELVIS;
  const pr = RIG.PELVIS_R;
  b.tube(pelvis, pr, 10, (i, sn) => (sn < -0.4 ? GUN_DARK : GUN), E_NONE, { capStart: false });
  const at = tubeSampler(pelvis, pr);
  b.scuteRows(at, 0.1, 1.55, 3, [
    { a: Math.PI / 2, w: 140, l: 165, h: 40 },
    { a: Math.PI / 2 - 0.5, w: 165, l: 175, h: 42 },
    { a: Math.PI / 2 + 0.5, w: 165, l: 175, h: 42 },
    { a: 0.4, w: 175, l: 175, h: 36, color: GUN },
    { a: Math.PI - 0.4, w: 175, l: 175, h: 36, color: GUN },
  ], { stagger: 0.16 });
  for (const s of [-1, 1]) {
    hindLeg(b, s);
    // Exhaust pipe angled up and back, a rust clamp and a glowing ember lip.
    const top = mirror(RIG.VENTS[3], s);
    const base = [s * 210, 990, -670];
    b.cyl(base, top, 74, 66, 7, STEEL_DARK);
    b.ring(lerp3(base, top, 0.35), top, 84, 44, RUST_DARK);
    b.ring(lerp3(base, top, 0.97), top, 76, 30, EMBER, E_EMBER);
    // Hip armour: a curved plate over the hip joint.
    b.bonePlate(mirror(RIG.HIP, s), mirror([510, 850, -440], s), [s, 0.7, 0], 200, 290, 50, GUN_LIGHT);
    b.bonePlate(mirror(RIG.HIP, s), mirror([510, 850, -440], s), [s, 0.7, 0], 230, 230, 22, RUST, E_JOINT, 0.5);
    // Hose from the hip into the tail root.
    b.cyl([s * 380, 640, -610], [s * 230, 700, -810], 40, 40, 6, CABLE);
  }
  return b.build();
}

// Trunk from the pelvis to the chest, with scutes, shoulder armour, vents and the furnace.
function buildTorso() {
  const b = new PartBuilder(23);
  const P = RIG.TRUNK;
  const R = RIG.TRUNK_R;
  // Banded plates above, a darker ribbed belly below.
  b.tube(P, R, 10, (i, sn) => (sn < -0.45 ? GUN_DARK : i % 2 ? GUN : GUN_LIGHT), E_NONE, { capStart: false });
  const at = tubeSampler(P, R);
  // Overlapping scale plates: three rows along the back, two down each flank.
  b.scuteRows(at, 0.3, 4.6, 10, [
    { a: Math.PI / 2, w: 140, l: 170, h: 42 },
    { a: Math.PI / 2 - 0.4, w: 165, l: 178, h: 44 },
    { a: Math.PI / 2 + 0.4, w: 165, l: 178, h: 44 },
    { a: Math.PI / 2 - 0.85, w: 175, l: 180, h: 40, color: GUN },
    { a: Math.PI / 2 + 0.85, w: 175, l: 180, h: 40, color: GUN },
    { a: 0.3, w: 175, l: 176, h: 34, color: GUN },
    { a: Math.PI - 0.3, w: 175, l: 176, h: 34, color: GUN },
  ], { stagger: 0.13, rustChance: 0.16 });
  // Belly ribs.
  for (let i = 0; i < 6; i++) {
    const s = at(0.5 + i * 0.7);
    const { pos, normal } = surfaceAt(s, -Math.PI / 2);
    b.scute(pos, normal, s.t, s.rx * 1.1, 70, 24, GUN_DARK);
  }
  for (const s of [-1, 1]) {
    // Shoulder armour over the leg's joint, with a rust rim.
    const sh = mirror(RIG.SHOULDER, s);
    b.bonePlate(sh, mirror([500, 840, 290], s), [s, 0.7, 0], 200, 300, 50, GUN_LIGHT);
    b.bonePlate(sh, mirror([500, 840, 290], s), [s, 0.7, 0], 230, 240, 22, RUST, E_JOINT, 0.5);
    // Louvred exhaust vent behind the shoulders: a box with glowing slats and a dark hood.
    const v = mirror(RIG.VENTS[1], s);
    b.box(v[0], v[1] - 50, v[2], 200, 90, 270, GUN_DARK, E_NONE, 0, 0, -s * 0.3);
    for (let k = 0; k < 3; k++) b.box(v[0], v[1] - 6, v[2] - 80 + k * 80, 165, 16, 30, EMBER, E_EMBER, 0, 0, -s * 0.3);
    b.box(v[0] + s * 12, v[1] + 8, v[2] - 145, 220, 22, 50, GUN, E_NONE, 0.4, 0, -s * 0.3);
    // Hoses along the lower flank, from the shoulder to the hip.
    const hose = [
      [s * 340, 560, 250],
      [s * 440, 610, -40],
      [s * 460, 620, -340],
      [s * 400, 600, -620],
    ];
    for (let k = 0; k < hose.length - 1; k++) b.cyl(hose[k], hose[k + 1], 38, 38, 6, CABLE);
  }
  // Chest furnace between the front legs, under the neck: a dark ring round a glowing core,
  // behind a grille of bars.
  const cr = RIG.CORE;
  b.cyl([0, cr[1], cr[2] - 90], [0, cr[1], cr[2] - 10], 160, 160, 8, GUN_DARK);
  b.cyl([0, cr[1], cr[2] - 40], [0, cr[1], cr[2]], 124, 124, 8, FURNACE, E_CORE);
  for (let i = 0; i < 4; i++) b.box(0, cr[1] - 96 + i * 64, cr[2] + 4, 250 - Math.abs(i - 1.5) * 50, 18, 16, GUN_DARK, E_NONE);
  for (let i = 0; i < 3; i++) b.box(0, cr[1] - 215 + i * 42, cr[2] - 80, 250 - i * 40, 14, 22, FURNACE, E_GRILLE);
  // Neck collar.
  b.ring(RIG.NECK, add3(RIG.NECK, [0, 160, 130]), 272, 100, RUST, E_JOINT);
  return b.build(RIG.WAIST);
}

// Segmented neck with scutes on top and two hoses underneath (neck space).
function buildNeck() {
  const b = new PartBuilder(37);
  const P = RIG.NECK_PTS;
  const R = RIG.NECK_R;
  b.tube(P, R, 8, (i, sn) => (sn < -0.5 ? GUN_DARK : i % 2 ? GUN_LIGHT : GUN), E_NONE, { capStart: false, capEnd: false });
  const at = tubeSampler(P, R);
  for (let i = 1; i < P.length - 1; i++) b.ring(P[i], P[i + 1], Math.max(R[i][0], R[i][1]) + 10, 46, RUST, E_JOINT);
  b.scuteRows(at, 0.2, 3.8, 6, [
    { a: Math.PI / 2, w: 120, l: 145, h: 36 },
    { a: Math.PI / 2 - 0.5, w: 130, l: 145, h: 36 },
    { a: Math.PI / 2 + 0.5, w: 130, l: 145, h: 36 },
    { a: 0.2, w: 130, l: 145, h: 32, color: GUN },
    { a: Math.PI - 0.2, w: 130, l: 145, h: 32, color: GUN },
  ], { stagger: 0.16, rustChance: 0.1 });
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i < P.length; i++) {
      const f = at(i);
      pts.push(add3(surfaceAt(f, -Math.PI / 2 + s * 0.45).pos, mul3(f.up, -18)));
    }
    for (let i = 0; i < pts.length - 1; i++) b.cyl(pts[i], pts[i + 1], 32, 32, 6, CABLE);
  }
  return b.build();
}

// The long, low head (head space: the pivot at the back of the skull's underside, +Z forward).
function buildHead() {
  const b = new PartBuilder(41);
  // Flat, wedge-shaped skull: a wide lower block under a bevelled, narrower crown.
  const z4 = (z, xb, yb, xt, yt) => [
    [-xb, yb, z],
    [xb, yb, z],
    [-xt, yt, z],
    [xt, yt, z],
  ];
  const block = (back, front, color) => {
    const c = [...back, ...front];
    b.hexa([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]], color);
  };
  block(z4(-110, 195, -70, 195, 95), z4(270, 188, -55, 186, 90), GUN);
  block(z4(-110, 195, 95, 125, 172), z4(270, 186, 90, 118, 160), GUN_LIGHT);
  // Long tapering snout, bevelled the same way, its top sloping down to a blunt nose.
  block(z4(262, 178, -52, 178, 62), z4(900, 92, -36, 92, 18), GUN);
  block(z4(262, 178, 62, 112, 152), z4(900, 92, 18, 48, 56), GUN_LIGHT);
  block(z4(895, 86, -36, 50, 54), z4(965, 62, -30, 36, 34), GUN_DARK);
  // Back plate where the neck plugs in.
  block(z4(-150, 170, -60, 120, 150), z4(-105, 190, -65, 130, 168), GUN_DARK);
  // Scute plates: rows along the crown and snout top and down both bevels.
  const up = [0, 1, 0];
  for (let k = 0; k < 4; k++) {
    const z = -60 + k * 100 + (k % 2) * 20;
    for (const x of [-72, 0, 72]) b.scute([x, 170 - k * 3, z], up, [0, 0, 1], 70, 100, 24, b.rng() < 0.15 ? RUST_DARK : GUN_LIGHT);
    for (const sx of [-1, 1]) b.scute([sx * 158, 132 - k * 3, z + 40], [sx * 0.74, 0.67, 0], [0, 0, 1], 64, 96, 22, GUN);
  }
  for (let k = 0; k < 6; k++) {
    const z = 320 + k * 100;
    const f = (z - 262) / 638;
    const y = 152 + (56 - 152) * f;
    b.scute([0, y + 2, z], norm3([0, 1, 0.15]), [0, 0, 1], 64 - f * 20, 90, 22, b.rng() < 0.2 ? RUST_DARK : GUN_LIGHT);
    if (k < 5) {
      const xb = 178 + (92 - 178) * f;
      const xt = 112 + (48 - 112) * f;
      const yb = 62 + (18 - 62) * f;
      for (const sx of [-1, 1]) b.scute([sx * (xb + xt) * 0.5, (yb + y) * 0.5, z + 50], [sx * 0.8, 0.6, 0.1], [0, 0, 1], 56 - f * 18, 84, 20, GUN);
    }
  }
  for (const s of [-1, 1]) {
    // Armoured brow over each side-set eye.
    b.hexa(
      [
        [s * 110, 150, 20],
        [s * 222, 150, 20],
        [s * 110, 196, 30],
        [s * 212, 190, 30],
        [s * 110, 140, 300],
        [s * 206, 128, 290],
        [s * 110, 180, 300],
        [s * 196, 160, 290],
      ],
      GUN_DARK,
    );
    b.box(s * 214, 136, 150, 18, 16, 250, RUST, E_JOINT);
    // Optic: a dark bezel round a red lens, facing out of the side of the head.
    const e = mirror(RIG.EYES[1], s);
    b.cyl(add3(e, [-s * 34, 0, -8]), add3(e, [s * 8, 0, 2]), 74, 74, 8, GUN_DARK);
    b.cyl(add3(e, [-s * 4, 0, 0]), add3(e, [s * 20, 0, 6]), 56, 50, 8, EYE, E_EYE);
    b.box(e[0] + s * 18, e[1], e[2] + 4, 8, 12, 70, CABLE, E_NONE); // slit pupil
    // Round "ear" grille behind the eye.
    b.cyl([s * 180, 40, -40], [s * 202, 40, -40], 52, 52, 8, GUN_DARK);
    for (let k = -1; k <= 1; k++) b.box(s * 204, 40 + k * 28, -40, 8, 10, 80, STEEL, E_NONE);
    // Cheek plate over the jaw muscle, with a rust bolt.
    b.hexa(
      [
        [s * 180, -70, -80],
        [s * 206, -70, -80],
        [s * 180, 40, -80],
        [s * 206, 30, -80],
        [s * 176, -60, 240],
        [s * 196, -60, 240],
        [s * 176, 10, 240],
        [s * 194, 6, 240],
      ],
      GUN_LIGHT,
    );
    b.cyl([s * 200, -20, 40], [s * 222, -20, 40], 30, 30, 6, RUST_DARK);
    // Nostril vents on the snout.
    b.box(s * 48, 60, 850, 36, 14, 60, EMBER, E_EMBER);
    // Upper teeth along the snout's lower edge (a bigger fang at each end).
    for (let k = 0; k < 8; k++) {
      const z = 330 + k * 75;
      const x = s * (162 - (z - 262) * 0.11 - 14);
      const big = k === 0 || k === 7;
      b.cone([x, -44, z], [x * 0.98, big ? -150 : -115, z + 10], big ? 26 : 20, 4, TOOTH);
    }
  }
  // Glowing palate and throat vent (the furnace shows when the jaw drops).
  b.hexa(
    [
      [-150, -50, 110],
      [150, -50, 110],
      [-150, -40, 110],
      [150, -40, 110],
      [-72, -40, 880],
      [72, -40, 880],
      [-72, -32, 880],
      [72, -32, 880],
    ],
    FURNACE,
    E_THROAT,
  );
  b.box(0, -60, 20, 250, 16, 200, FURNACE, E_THROAT);
  for (let k = 0; k < 4; k++) b.box(0, -70, -50 + k * 45, 260, 10, 12, GUN_DARK, E_NONE);
  return b.build();
}

// The big lower jaw, hinged at its back (jaw space), with teeth, a glowing tongue plate and the
// V-shaped dewlap under the chin.
function buildJaw() {
  const b = new PartBuilder(53);
  b.hexa(
    [
      [-192, -150, -10],
      [192, -150, -10],
      [-186, -4, -10],
      [186, -4, -10],
      [-88, -82, 960],
      [88, -82, 960],
      [-84, 10, 960],
      [84, 10, 960],
    ],
    GUN,
  );
  b.cyl([-212, -50, 0], [212, -50, 0], 62, 62, 8, RUST, E_JOINT);
  // Chin plate and side stripes.
  b.slab(0, 900, -95, -60, 80, 55, 76, 50, 0, 0, GUN_DARK);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = 150 + k * 80;
      b.box(s * (190 - z * 0.1), -80, z, 12, 90, 34, k === 1 ? HAZARD : RUST_DARK, E_NONE, -0.4, 0, 0);
    }
    // Lower teeth, between the upper ones.
    for (let k = 0; k < 8; k++) {
      const z = 370 + k * 75;
      const x = s * (168 - z * 0.1 - 16);
      b.cone([x, 0, z], [x * 0.98, k === 7 ? 90 : 68, z - 8], k === 7 ? 24 : 19, 4, TOOTH);
    }
  }
  b.hexa(
    [
      [-120, -6, 80],
      [120, -6, 80],
      [-120, 4, 80],
      [120, 4, 80],
      [-54, -2, 870],
      [54, -2, 870],
      [-54, 8, 870],
      [54, 8, 870],
    ],
    FURNACE,
    E_THROAT,
  );
  // Dewlap: two ribbed membranes hanging in a V under the chin, rimmed in rust.
  const hinge = [
    [0, -135, 130],
    [0, -128, 250],
    [0, -118, 380],
    [0, -106, 520],
  ];
  const edge = [
    [95, -215, 150],
    [128, -300, 270],
    [118, -292, 400],
    [70, -190, 530],
  ];
  const membrane = b.lin(FURNACE, 0);
  for (const s of [-1, 1]) {
    const h = hinge.map((p) => [s * 30, p[1], p[2]]);
    const e = edge.map((p) => mirror(p, s));
    for (let i = 0; i < h.length - 1; i++) b.quad(h[i], e[i], e[i + 1], h[i + 1], membrane, E_DEWLAP, null, true);
    for (let i = 0; i < h.length; i++) b.cyl(h[i], e[i], 14, 12, 4, GUN_DARK);
    for (let i = 0; i < e.length - 1; i++) b.cyl(e[i], e[i + 1], 16, 16, 4, RUST, E_JOINT);
  }
  return b.build(RIG.JAW);
}

function buildArm(s) {
  const b = new PartBuilder(s < 0 ? 61 : 67);
  frontLeg(b, s);
  return b.build(mirror(RIG.SHOULDER, s));
}

function buildTailPart(points, radii, seed, tip) {
  const b = new PartBuilder(seed);
  b.tube(points, radii, 8, (i, sn) => (sn < -0.5 ? GUN_DARK : i % 2 ? GUN_LIGHT : GUN), E_NONE, { capStart: false, capEnd: !tip });
  const at = tubeSampler(points, radii);
  for (let i = 1; i < points.length - (tip ? 0 : 1); i++) {
    const r = radii[Math.min(i, radii.length - 1)];
    b.ring(points[i], points[i - 1], Math.max(r[0], r[1]) + 8, 32, i % 2 ? RUST : RUST_DARK, E_JOINT);
  }
  const n = points.length - 1;
  const w = radii[0][0] * 0.62;
  b.scuteRows(at, 0.15, n - 0.2, Math.round(n * 3.2), [
    { a: Math.PI / 2, w: w * 0.8, l: w, h: w * 0.28 },
    { a: Math.PI / 2 - 0.55, w, l: w * 1.05, h: w * 0.28 },
    { a: Math.PI / 2 + 0.55, w, l: w * 1.05, h: w * 0.28 },
  ], { stagger: 0.2, dir: -1, taper: tip ? 0.62 : 0.2 });
  if (tip) {
    // A short blade on the tip.
    const a = points[n - 1];
    const p = points[n];
    const u = norm3(sub3(p, a));
    b.cone(p, add3(p, mul3(u, 160)), radii[n][0], 6, RUST_DARK);
  }
  return b.build(points[0]);
}

// ---------------------------------------------------------------- material

// One Lambert material for every part: flat shaded, vertex coloured, plus
//   emission = colour * (aEmit.x * uPower + aEmit.y * uCharge)   (optics, embers, furnace)
//   + a cold rim light (keeps the silhouette readable against the storm sky)
//   + colour * uFlash                                           (lightning flashes)
// and only uFogScale of the scene fog: the storm fog would otherwise melt the dark beast into
// the dark sky from the spawn (a deliberate cheat; it still recedes a little with distance).
export function makeBeastMaterial() {
  const uniforms = {
    uCharge: { value: 0 },
    uPower: { value: 0 },
    uFlash: { value: 0 },
    uRim: { value: new THREE.Color(0.3, 0.36, 0.5) },
    uFogScale: { value: 0.35 },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aEmit;\nvarying vec2 vEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCharge;\nuniform float uPower;\nuniform float uFlash;\nuniform vec3 uRim;\nuniform float uFogScale;\nvarying vec2 vEmit;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '\ttotalEmissiveRadiance += diffuseColor.rgb * (vEmit.x * uPower + vEmit.y * uCharge + uFlash);',
          '\tfloat rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
          '\ttotalEmissiveRadiance += uRim * (rimK * rimK);',
        ].join('\n'),
      )
      .replace('#include <fog_fragment>', scaledFog('uFogScale', false));
  };
  material.customProgramCacheKey = () => 'robotBeast';
  material.userData.uniforms = uniforms;
  return material;
}

// three.js's fog chunk with the fog factor scaled by uniform `scale`; `toBlack` fades to black
// instead of the fog colour (for additive sprites, which would otherwise add the fog colour).
export function scaledFog(scale, toBlack) {
  return [
    '#ifdef USE_FOG',
    '\t#ifdef FOG_EXP2',
    '\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    '\t#else',
    '\t\tfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
    '\t#endif',
    `\tfogFactor *= ${scale};`,
    toBlack ? '\tgl_FragColor.rgb *= 1.0 - fogFactor;' : '\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    '#endif',
  ].join('\n');
}

// Builds every part's geometry, each around its own pivot:
// { hips, torso, neck, head, jaw, armL, armR, tailA, tailB }.
export function buildBeastGeometries() {
  return {
    hips: buildHips(),
    torso: buildTorso(),
    neck: buildNeck(),
    head: buildHead(),
    jaw: buildJaw(),
    armL: buildArm(-1),
    armR: buildArm(1),
    tailA: buildTailPart(RIG.TAIL_A, RIG.TAIL_A_R, 71, false),
    tailB: buildTailPart(RIG.TAIL_B, RIG.TAIL_B_R, 73, true),
  };
}
