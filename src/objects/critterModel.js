// Geometry and material of the Midsummer critters of Midsummer Skerries (objects/Critters.js),
// three original designs in one geometry:
//   the Wreath Frog   a fat, glossy lime frog in a midsummer flower wreath (daisies, buttercups,
//                     harebells; never gold) with open, friendly gold eyes and a pink throat sac
//                     that puffs up before it leaps. About 120 across the hind feet, its head
//                     (the stomp top) at 75.
//   the Tin Crab      a coral hermit crab living in an old oval herring tin: a plain grey tin
//                     with cobalt and yellow bands (no lettering, no picture), its peeled lid
//                     curled up at the back; claws ending in two-jawed pincers, the right claw
//                     the bigger. About 175 across the legs.
//   the Mosquito      a big cartoon mosquito in a charcoal-and-white "tiger" livery (no yellow or
//                     tan: never a bee), a long needle, white cartoon eyes with black pupils
//                     standing out of its head (a deep red only while it aims), glassy wings
//                     and long dangling legs. About 230 from needle tip to abdomen tip, 185
//                     across the wings.
//
// All critters of a course are ONE InstancedMesh (one draw call) over this geometry, which holds
// all three models: an instance shows only its own model (the type mask: the other two collapse
// to a point), and its moving parts are posed in the vertex shader, so every critter moves on
// its own without a rig:
//   per vertex    aPart = (part code, param, model), aPivot (the part's joint), aEmit (glow)
//   per instance  aAnim, aAnim2 (vec4 each: CRITTER_ANIM's channels; aAnim2.w is the model shown)
// The shading is smooth: every round part is a lathe or a cylinder whose own smooth normals are
// kept (never recomputed, which would facet the non-indexed mesh), turned with the part in the
// shader. A warm rim light and the glow (aEmit, brighter in a tell) are added on top, and the fog
// reaches them at 0.6 of its strength like the minions'. Rig space: feet on y 0 facing +Z
// (units = world units); the mosquito's origin is its thorax.
//
//   CRITTER_RIG             landmarks and hit shapes per kind (Critters.js reads them)
//   CRITTER_ANIM            the per-instance channels per kind: record field -> slot (a0..a3 go
//                           to aAnim, b0, b1 and glow to aAnim2.xyz)
//   CRITTER_TRIS            the triangle caps per model and in all
//   MODEL                   { FROG: 0, CRAB: 1, MOSQUITO: 2 }
//   CRITTER_PARTS           the part codes per model
//   critterBase()           the three models' vertex attributes, built once per session
//   makeCritterGeometry(n)  a new geometry over those attributes for one manager (n instances),
//                           with its own aAnim / aAnim2 (the attributes are shared, not cloned)
//   makeCritterMaterial()   the smooth Lambert material (program cache key 'skerryCritters')
//   makeMarkerMesh(n)       the orange danger markers ('critterMarkers', n instances)

import * as THREE from 'three';
import { scaledFog } from './robotBeastModel.js';
import { makeMarkerTexture } from './aiRaceTextures.js';

const TAU = Math.PI * 2;

export const MODEL = { FROG: 0, CRAB: 1, MOSQUITO: 2 };

// Triangle caps (the masked models still run through the vertex shader for every instance).
export const CRITTER_TRIS = { frog: 800, crab: 750, mosquito: 600, total: 2150 };

// Part codes (aPart.x) per model.
export const CRITTER_PARTS = {
  frog: { BODY: 0, EYE: 1, SAC: 2, HIND: 3, FRONT: 4, WREATH: 5 },
  crab: { TIN: 0, BODY: 1, STALK: 2, CLAW: 3, FINGER: 4, LEG: 5 },
  mosquito: { BODY: 0, EYE: 1, NEEDLE: 2, ABDOMEN: 3, WING: 4, LEG: 5 },
};
const FROG = CRITTER_PARTS.frog;
const CRAB = CRITTER_PARTS.crab;
const MOSQUITO = CRITTER_PARTS.mosquito;

// Landmarks and hit shapes (rig space, before the spot's scale).
//   TOP          stomps land on this height over its origin (the feet; the mosquito's thorax),
//                his feet's axis within PLAYER_RADIUS + STOMP_REACH of its own (and his feet no
//                lower than Critters' STOMP_LOW under its origin)
//   BODY_*       the body capsule the hero's attacks strike: an upright one from BODY_LOW to
//                BODY_HIGH over the feet, radius BODY_R (the mosquito's runs along its body
//                axis from TAIL to NEEDLE_MID, or to NEEDLE_TIP while it dives; STUCK_R while
//                it is stuck)
//   HIT_*        the frog's landing: a sphere HIT_Y over its feet
//   WREATH       the frog's wreath's centre; WREATH_RISE how far it flies up (straight up, in
//                world units, whatever the frog does) when it pops off
//   BUMP_R       he bumps it at PLAYER_RADIUS + BUMP_R (a stuck mosquito at STUCK_R; a hovering
//                one when his head reaches its underside, UNDER below its thorax: its BUMP_R
//                short of its STOMP_REACH, so a jump beside it still comes down on it)
//   PIVOT        the height its pitch and roll turn about
//   SQUASH_XZ    a squash to height k widens it 1 + (1 - k) * SQUASH_XZ
//   SHADOW       its blob shadow's size
//   LIFT_SPAN    the crab's legs lift its body this much from hidden (0) to standing (1): every
//                height of it above (its TOP, BODY_HIGH) rides up and down with that lift
//   LEG_W        a crab leg vertex moves with the body by clamp(y / LEG_W, 0, 1): the hips and
//                knees all the way, the feet not at all (they stay planted as it stands up)
export const CRITTER_RIG = {
  frog: { TOP: 75, STOMP_REACH: 40, BODY_LOW: 15, BODY_HIGH: 55, BODY_R: 45, HIT_Y: 40, HIT_R: 45, BUMP_R: 45, PIVOT: 30, WREATH: [0, 74, -6], WREATH_RISE: 300, SQUASH_XZ: 0.6, SHADOW: 130 },
  crab: { TOP: 82, STOMP_REACH: 45, BODY_LOW: 10, BODY_HIGH: 75, BODY_R: 58, BUMP_R: 58, LIFT_SPAN: 34, LEG_W: 26, PIVOT: 40, SQUASH_XZ: 0.375, SHADOW: 160 },
  mosquito: { NEEDLE_TIP: [0, -21, 129], NEEDLE_MID: [0, -10, 80], TAIL: [0, -10, -70], BODY_R: 40, STUCK_R: 45, BUMP_R: 30, UNDER: 25, TOP: 30, STOMP_REACH: 40, PIVOT: 0, SQUASH_XZ: 0.46, SHADOW: 110 },
};

// The per-instance channels per kind (Critters.js record fields; see the shader below).
export const CRITTER_ANIM = {
  frog: { legs: 'a0', sac: 'a1', wobble: 'a2', breath: 'a3', blink: 'b0', wreathLift: 'b1', glow: 'glow' },
  crab: { gait: 'a0', stride: 'a1', raise: 'a2', open: 'a3', eyes: 'b0', lift: 'b1', glow: 'glow' },
  mosquito: { wingPhase: 'a0', flap: 'a1', curl: 'a2', legPhase: 'a3', eyeGlow: 'b0', quiver: 'b1', glow: 'glow' },
};

// Linear colour of an sRGB hex colour.
const _c = new THREE.Color();
function lin(hex) {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// A painter that gives every vertex one colour and glow.
const flat = (hex, emit = 0) => {
  const c = lin(hex);
  return () => [c[0], c[1], c[2], emit];
};
// Cheap deterministic noise in 0..1 of a position (the same at every copy of a vertex).
const hash3 = (x, y, z) => {
  const v = Math.sin(Math.round(x * 10) * 12.9898 + Math.round(y * 10) * 78.233 + Math.round(z * 10) * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _tp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _tn = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _tj = [0, 0, 0];
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Collects triangles with smooth normals, each vertex tagged with its part (model, part code,
// param) and the part's joint, coloured (linear) and with its glow.
class SmoothBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.part = [];
    this.pivot = [];
    this.emit = [];
    this.tag = [0, 0, 0];
    this.joint = [0, 0, 0];
  }

  // What follows belongs to part `code` of `model` (param: its side, or its gait offset), turning
  // about `joint` (rig space).
  at(model, code, param = 0, joint = [0, 0, 0]) {
    this.tag = [code, param, model];
    this.joint = joint;
    return this;
  }

  _vertex(p, n, j, paint) {
    const [r, g, b, e] = paint(p, n, j);
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(r, g, b);
    this.part.push(this.tag[0], this.tag[1], this.tag[2]);
    this.pivot.push(this.joint[0], this.joint[1], this.joint[2]);
    this.emit.push(e);
  }

  // Appends a three.js geometry moved by `matrix`, its own smooth normals turned with it. Every
  // vertex is painted by paint(p, n, j) -> [r, g, b (linear), emit], j being its row of a lathe's
  // profile (`rows` points long). Degenerate triangles (a lathe's poles) are dropped.
  add(geo, matrix, paint, rows = 1) {
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const idx = geo.index ? geo.index.array : null;
    const count = idx ? idx.length : pos.length / 3;
    _nm.getNormalMatrix(matrix);
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx[t + k] : t + k;
        _tp[k].fromArray(pos, v * 3).applyMatrix4(matrix);
        _tn[k].fromArray(nor, v * 3).applyMatrix3(_nm).normalize();
        _tj[k] = v % rows;
      }
      _ab.subVectors(_tp[1], _tp[0]);
      _ac.subVectors(_tp[2], _tp[0]);
      _ab.cross(_ac);
      if (_ab.length() < 1e-4) continue;
      // Wound to face the way its normals point (the material is FrontSide).
      const flip = _ab.dot(_ac.copy(_tn[0]).add(_tn[1]).add(_tn[2])) < 0;
      for (let k = 0; k < 3; k++) {
        const v = flip && k > 0 ? 3 - k : k;
        this._vertex(_tp[v], _tn[v], _tj[v], paint);
      }
    }
    geo.dispose();
  }

  // A flat triangle with normal n (both faces with `both`).
  tri(a, b, c, n, paint, both = false) {
    const pa = new THREE.Vector3(...a);
    const pb = new THREE.Vector3(...b);
    const pc = new THREE.Vector3(...c);
    const nn = new THREE.Vector3(...n).normalize();
    this._vertex(pa, nn, 0, paint);
    this._vertex(pb, nn, 0, paint);
    this._vertex(pc, nn, 0, paint);
    if (both) {
      nn.negate();
      this._vertex(pa, nn, 0, paint);
      this._vertex(pc, nn, 0, paint);
      this._vertex(pb, nn, 0, paint);
    }
  }

  // A surface of revolution: profile [[r, y], ...] from bottom to top (its normals face out),
  // `sides` round, moved by `matrix`; phiStart / phiLength for part of a turn (from +Z toward +X).
  lathe(profile, sides, matrix, paint, phiStart = 0, phiLength = TAU) {
    const geo = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      sides,
      phiStart,
      phiLength,
    );
    this.add(geo, matrix, paint, profile.length);
  }

  // An ellipsoid round c with radii r = [x, y, z] (a lathe of a half circle in `rings` even
  // rows, or through the given latitudes, in radians from the bottom pole to the top), turned
  // by rot (Euler XYZ, radians).
  ellipsoid(c, r, sides, rings, paint, rot = null) {
    const lat = Array.isArray(rings) ? rings : Array.from({ length: rings + 1 }, (_, k) => -Math.PI / 2 + (Math.PI * k) / rings);
    const profile = lat.map((a, k) => [k === 0 || k === lat.length - 1 ? 0 : Math.cos(a), Math.sin(a)]);
    _q.setFromEuler(_e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0));
    this.lathe(profile, sides, new THREE.Matrix4().compose(_v.set(c[0], c[1], c[2]), _q, _s.set(r[0], r[1], r[2])), paint);
  }

  ball(c, r, sides, rings, paint) {
    this.ellipsoid(c, [r, r, r], sides, rings, paint);
  }

  // A ring tube: a circle of radius `tube` swept round a circle of radius R (in its xz-plane),
  // moved by `matrix`.
  torus(R, tube, tubeSides, sides, matrix, paint) {
    const profile = [];
    for (let k = 0; k <= tubeSides; k++) {
      const a = (TAU * k) / tubeSides;
      profile.push([R + tube * Math.cos(a), tube * Math.sin(a)]);
    }
    this.lathe(profile, sides, matrix, paint);
  }

  // A cylinder from a (radius ra) to b (radius rb), `sides` round; open unless `caps`.
  cyl(a, b, ra, rb, sides, paint, caps = false) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _q.setFromUnitVectors(Y_AXIS, _v.set(dx / len, dy / len, dz / len));
    const m = new THREE.Matrix4().compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rb, ra, len, sides, 1, !caps), m, paint);
  }

  // A four-sided leg piece standing on the floor: from a horizontal square of radius ra round
  // point a down to one of radius rb round b, the squares level (so its foot stands flat at b's
  // height), the sides' normals level and outward.
  prism(a, b, ra, rb, paint) {
    const ring = (p, r, k) => {
      const ang = (k * TAU) / 4 + Math.PI / 4;
      return [p[0] + Math.sin(ang) * r, p[1], p[2] + Math.cos(ang) * r];
    };
    for (let k = 0; k < 4; k++) {
      const a0 = ring(a, ra, k);
      const a1 = ring(a, ra, k + 1);
      const b0 = ring(b, rb, k);
      const b1 = ring(b, rb, k + 1);
      const mid = ((k + 0.5) * TAU) / 4 + Math.PI / 4;
      const n = [Math.sin(mid), 0, Math.cos(mid)];
      this.tri(b0, b1, a1, n, paint);
      this.tri(b0, a1, a0, n, paint);
    }
  }

  // A flat fan round `centre` through the outline points (a closed loop), facing n.
  fan(centre, outline, n, paint, both = false) {
    for (let k = 0; k < outline.length; k++) this.tri(centre, outline[k], outline[(k + 1) % outline.length], n, paint, both);
  }
}

// ---------------------------------------------------------------- the Wreath Frog

function buildFrog(b) {
  const M = MODEL.FROG;
  const SIDE = lin(0xa4cf3e);
  const BACK = lin(0x8dc23a);
  const SPOT = lin(0x5f8a1c);
  const BELLY = lin(0xf4edb8);
  const LEG = 0xbede5a;
  // Six darker spots on the back (rig x, z), the back staying light: from the raised follow
  // camera it is most of what shows of the frog against the meadow.
  const SPOTS = [[-18, -22], [18, -22], [-30, 4], [30, 4], [0, -40], [0, 0]];
  b.at(M, FROG.BODY, 0, [0, 30, 0]).ellipsoid([0, 34, -5], [46, 30, 52], 12, 7, (p, n) => {
    if (n.y < -0.3) return [...BELLY, 0];
    if (n.y <= 0.55) return [...SIDE, 0];
    let s = 0;
    for (const [x, z] of SPOTS) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 16 && 1 - d / 16 > s) s = 1 - d / 16;
    }
    return [...mix(BACK, SPOT, 0.55 * s), 0];
  });
  // The smile: a thin dark ridge round the front of the body, just proud of it.
  const smile = new THREE.Matrix4().compose(_v.set(0, 0, -5), _q.identity(), _s.set(45.7, 1, 51.6));
  b.lathe([[1, 35.5], [1.035, 37.5], [1, 39.5]], 6, smile, flat(0x2f6b22), -0.62, 1.24);
  // Gold eyes on top, open and friendly, each a lathe whose pole looks forward (turned a little
  // out): a black horizontal pupil (the pole, and the first ring's vertices black but its top
  // and bottom ones: a wide oval under half the eye across), a paler gold round it, a white
  // glint up on the same side of both eyes (the light's), the rest gold.
  const GOLD = lin(0xf7c844);
  const PUPIL = lin(0x101010);
  const PALE = mix(GOLD, lin(0xfff4c8), 0.6);
  const EYE_ROWS = [-Math.PI / 2, -0.79, -0.09, 0.52, 1.05, Math.PI / 2];
  for (const side of [-1, 1]) {
    const c = [side * 22, 62, 22];
    const a = -side * 0.3;
    const fwd = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const glint = fwd.clone().multiplyScalar(Math.sin(1.05)).add(new THREE.Vector3(-Math.cos(a), 1, -Math.sin(a)).multiplyScalar(Math.SQRT1_2 * Math.cos(1.05)));
    b.at(M, FROG.EYE, side, c).ellipsoid(c, [14, 14, 14], 8, EYE_ROWS, (p, n, j) => {
      if (j === 5) return [...PUPIL, 0];
      if (j === 4) return n.dot(glint) > 0.99 ? [1, 1, 1, 0.4] : [...(Math.abs(n.y) < 0.45 ? PUPIL : PALE), 0];
      return [...(j === 3 ? PALE : GOLD), 0];
    }, [Math.PI / 2, 0, a]);
  }
  // The throat sac (it glows a little, more in the windup).
  b.at(M, FROG.SAC, 0, [0, 30, 30]).ball([0, 26, 40], 18, 8, 5, flat(0xfbc8d4, 1));
  // Hind legs: a thigh down to a long foot (overlapping, one leg), swinging back from the hip.
  for (const side of [-1, 1]) {
    b.at(M, FROG.HIND, side, [side * 30, 26, -20]);
    b.ellipsoid([side * 40, 18, -22], [16, 14, 26], 8, 4, flat(LEG));
    b.ellipsoid([side * 48, 6, -2], [14, 5, 26], 6, 3, flat(LEG));
  }
  // Front legs with flat pads.
  for (const side of [-1, 1]) {
    b.at(M, FROG.FRONT, side, [side * 24, 26, 28]);
    b.cyl([side * 24, 26, 28], [side * 30, 2, 38], 6, 6, 6, flat(LEG));
    b.ellipsoid([side * 31, 2, 40], [9, 3, 9], 6, 3, flat(LEG));
  }
  // The midsummer wreath: a ring of leaves (two greens in turn round it) on its crown behind the
  // eyes, tilted a little back, ten flowers on top (daisies, buttercups and harebells; never
  // gold), each standing clear of the leaves and turned up and out (toward the raised camera
  // from every side), its hub the one vertex in the centre's colour (the flower's eye) a little
  // proud of its six petals.
  const W = CRITTER_RIG.frog.WREATH;
  const tilt = new THREE.Matrix4().compose(_v.set(W[0], W[1], W[2]), _q.setFromEuler(_e.set(-0.12, 0, 0)), _s.set(1, 1, 1));
  const LEAF = [lin(0x2f7a22), lin(0x4c9a2a)];
  b.at(M, FROG.WREATH, 0, W).torus(32, 6.5, 5, 14, tilt, (p) => {
    const a = Math.atan2(p.x - W[0], p.z - W[2]);
    const k = Math.round((a / TAU) * 14 + 14) % 2;
    return [...LEAF[k], 0];
  });
  const DAISY = { petal: 0xffffff, centre: 0xf3c433, r: 11 };
  const BUTTERCUP = { petal: 0xffd23a, centre: 0xe89a1a, r: 9.5 };
  const HAREBELL = { petal: 0x8a6fe0, centre: 0xf3e090, r: 9.5 };
  const FLOWERS = [DAISY, BUTTERCUP, DAISY, HAREBELL, DAISY, BUTTERCUP, DAISY, HAREBELL, DAISY, BUTTERCUP];
  FLOWERS.forEach((f, i) => {
    const a = ((i + 0.5) / FLOWERS.length) * TAU;
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const n = new THREE.Vector3(0, Math.cos(0.5), 0).addScaledVector(out, Math.sin(0.5));
    const u = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const v = new THREE.Vector3().crossVectors(n, u);
    const c0 = new THREE.Vector3(out.x * 32, 6.5, out.z * 32);
    const at = (w) => w.applyMatrix4(tilt).toArray();
    const outline = [];
    for (let k = 0; k < 6; k++) {
      const pa = (k * TAU) / 6;
      outline.push(at(c0.clone().addScaledVector(u, Math.cos(pa) * f.r).addScaledVector(v, Math.sin(pa) * f.r)));
    }
    const petal = lin(f.petal);
    const centre = lin(f.centre);
    const hub = at(c0.clone().addScaledVector(n, 1.5));
    b.fan(hub, outline, n.transformDirection(tilt).toArray(), (p) => (Math.abs(p.x - hub[0]) + Math.abs(p.y - hub[1]) + Math.abs(p.z - hub[2]) < 0.01 ? [...centre, 0.15] : [...petal, 0.15]));
  });
}

// ---------------------------------------------------------------- the Tin Crab

function buildCrab(b) {
  const M = MODEL.CRAB;
  const CORAL = 0xe8613c;
  const TIP = lin(0xb33a22);
  // The herring tin, oval (55 by 38), 38..78 high, banded by height: silver, cobalt, yellow,
  // cobalt, silver (each band's rows doubled at its edges, so the bands stay crisp).
  const oval = new THREE.Matrix4().compose(_v.set(0, 0, -12), _q.identity(), _s.set(55, 1, 38));
  const BANDS = [0xa9b3ba, 0x2c5ba8, 0xf3c433, 0x2c5ba8, 0xa9b3ba].map(lin);
  const ys = [38, 45, 51, 57, 62, 78];
  const side = [];
  for (let k = 0; k < 5; k++) side.push([1, ys[k]], [1, ys[k + 1]]);
  b.at(M, CRAB.TIN).lathe(side, 16, oval, (p, n, j) => [...BANDS[j >> 1], 0]);
  // Its top: a darker rim round the lid's edge, the lid light (the sides a greyer tin, so it
  // reads as metal against the pale lid).
  const RIM = lin(0x7d878d);
  const TOP = lin(0xeef3f6);
  b.lathe([[1, 78], [0.92, 78.6], [0, 78.6]], 16, oval, (p, n, j) => [...(j === 0 ? RIM : TOP), 0]);
  // The peeled lid curled up at the back (a tube along x) on a thin plate from the back rim.
  const CURL = 0xdde3e8;
  b.cyl([-30, 86, -48], [30, 86, -48], 6, 6, 8, flat(CURL));
  b.tri([-28, 77.5, -44], [28, 77.5, -44], [28, 82, -48], [0, 0.66, 0.75], flat(CURL), true);
  b.tri([-28, 77.5, -44], [28, 82, -48], [-28, 82, -48], [0, 0.66, 0.75], flat(CURL), true);
  // The crab's body under the tin's open front: coral, a cream belly.
  const BODY = lin(CORAL);
  const BELLY = lin(0xf6d9b0);
  b.at(M, CRAB.BODY).ellipsoid([0, 34, 14], [44, 20, 30], 10, 6, (p, n) => [...(n.y < -0.2 ? BELLY : BODY), 0]);
  // Eye stalks with glossy black eyes, one white glint each (it catches the light).
  const BLACK = lin(0x111111);
  for (const s of [-1, 1]) {
    b.at(M, CRAB.STALK, s, [s * 14, 46, 34]);
    b.cyl([s * 14, 46, 34], [s * 18, 92, 40], 4, 4, 6, flat(CORAL));
    const g = new THREE.Vector3(s * 0.45, 0.6, 0.66).normalize();
    b.ball([s * 18, 96, 40], 9, 8, 4, (p, n) => (n.dot(g) > 0.86 ? [1, 1, 1, 0.6] : [...BLACK, 0]));
  }
  // Claws: an arm out from the shoulder and a round hand (the right one, at -x, the bigger)
  // that glows in the windup, ending in a pincer of two darker jaws: the lower one fixed, the
  // upper one (FINGER) hinged at the hand's front top, opening upward (a V from the front).
  const jaw = (x, w, h, z0, z1, y0, y1, yTip) => {
    // A flattened wedge from a w by h end at z0 (y0 .. y1) to a narrow edge at z1, height yTip.
    const q = [[x - w / 2, y0, z0], [x + w / 2, y0, z0], [x + w / 2, y1, z0], [x - w / 2, y1, z0]];
    const e = [[x - w / 5, yTip, z1], [x + w / 5, yTip, z1]];
    const paint = flat(0xb33a22, 1);
    b.tri(q[0], q[3], q[2], [0, 0, -1], paint);
    b.tri(q[0], q[2], q[1], [0, 0, -1], paint);
    b.tri(q[3], e[0], e[1], [0, z1 - z0, y1 - yTip], paint);
    b.tri(q[3], e[1], q[2], [0, z1 - z0, y1 - yTip], paint);
    b.tri(q[0], q[1], e[1], [0, z0 - z1, yTip - y0], paint);
    b.tri(q[0], e[1], e[0], [0, z0 - z1, yTip - y0], paint);
    b.tri(q[1], q[2], e[1], [1, 0, 0], paint);
    b.tri(q[0], e[0], q[3], [-1, 0, 0], paint);
  };
  for (const s of [-1, 1]) {
    const big = s < 0;
    const k = big ? 1 : 0.72;
    const r = big ? [20, 15, 20] : [14, 11, 15];
    const hand = [s * 50, 44, 76];
    b.at(M, CRAB.CLAW, s, [s * 40, 34, 30]);
    b.cyl([s * 40, 34, 30], [s * 52, 40, 58], 7, 7, 6, flat(CORAL));
    const coral = lin(CORAL);
    b.ellipsoid(hand, r, 8, 5, (p) => [...(p.z > hand[2] + r[2] * 0.55 ? TIP : coral), 1]);
    const front = hand[2] + r[2] * 0.75;
    const w = 1.2 * r[0];
    jaw(s * 50, w, 7 * k, front, front + 24 * k, hand[1] - 9 * k, hand[1] - 2 * k, hand[1] - 1 * k);
    const hinge = [s * 50, hand[1] + 2 * k, front];
    b.at(M, CRAB.FINGER, s, hinge);
    jaw(s * 50, w, 7 * k, front, front + 24 * k, hand[1] + 1 * k, hand[1] + 8 * k, hand[1] - 1 * k);
  }
  // Six legs, three a side: up and out from the hip to a knee, down to a planted foot. The
  // lower leg's squares are level, so the foot stands flat on the floor (its vertices at y 0
  // never move as the body rises, see LEG_W). param: the tripod gait's half (0 or pi).
  const zs = [-24, -4, 16];
  for (const s of [-1, 1]) {
    zs.forEach((z, i) => {
      const hip = [s * 40, 30, z];
      const knee = [s * 70, 44, 1.3 * z];
      const foot = [s * 86, 0, 1.45 * z];
      b.at(M, CRAB.LEG, ((i + (s > 0 ? 1 : 0)) % 2) * Math.PI, hip);
      b.cyl(hip, knee, 4, 3.2, 4, flat(CORAL));
      b.prism(knee, foot, 3.2, 2.5, flat(CORAL));
    });
  }
}

// ---------------------------------------------------------------- the Mosquito

function buildMosquito(b) {
  const M = MODEL.MOSQUITO;
  const CHAR = lin(0x2e2b35);
  // Thorax (lumpy: value noise of 6% on its radius) and head.
  b.at(M, MOSQUITO.BODY);
  const thorax = new THREE.Matrix4().compose(_v.set(0, 0, 0), _q.identity(), _s.set(25, 25, 30));
  const prof = [];
  for (let k = 0; k <= 6; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 6;
    prof.push([k === 0 || k === 6 ? 0 : Math.cos(a), Math.sin(a)]);
  }
  const lumpy = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10);
  const lp = lumpy.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const k = 1 + 0.12 * (hash3(lp.getX(i), lp.getY(i), lp.getZ(i)) - 0.5);
    lp.setXYZ(i, lp.getX(i) * k, lp.getY(i) * k, lp.getZ(i) * k);
  }
  b.add(lumpy, thorax, () => [...CHAR, 0], prof.length);
  b.ball([0, 2, 37], 18, 8, 4, flat(0x24222b));
  // White cartoon eyes standing out of the head, each a lathe whose pole looks forward (turned a
  // little out): its pole and first ring a round black pupil, one vertex of that ring white (a
  // glint), the rest white. They glow red only while it aims (the shader tints the white by the
  // eye-glow channel, the pupils staying black).
  const SCLERA = lin(0xf4f1ea);
  const PUPIL = lin(0x141414);
  const EYE_ROWS = [-Math.PI / 2, -0.44, 0.52, 1.22, Math.PI / 2];
  for (const s of [-1, 1]) {
    const c = [s * 13, 8, 47];
    const g = new THREE.Vector3(s * 0.13, 0.34, 0.93).normalize();
    b.at(M, MOSQUITO.EYE, s, c).ellipsoid(c, [11, 11, 11], 8, EYE_ROWS, (p, n, j) => {
      if (j < 3) return [...SCLERA, 0.5];
      return n.dot(g) > 0.995 ? [1, 1, 1, 0.5] : [...PUPIL, 0.5];
    }, [Math.PI / 2, 0, -s * 0.25]);
  }
  // The needle: a dark shaft, its last 16 red and glowing.
  const base = [0, -2, 53];
  const tip = CRITTER_RIG.mosquito.NEEDLE_TIP;
  const L = Math.hypot(tip[1] - base[1], tip[2] - base[2]);
  const red = [0, tip[1] + ((base[1] - tip[1]) * 16) / L, tip[2] + ((base[2] - tip[2]) * 16) / L];
  b.at(M, MOSQUITO.NEEDLE);
  b.cyl(base, red, 4.5, 1.6, 6, flat(0x2a2420));
  b.cyl(red, tip, 1.6, 0.6, 6, flat(0xc0302a, 1));
  // The abdomen: a slender lathe back along -z from behind the thorax, in alternating charcoal
  // and white rings (each ring's rows doubled at its edges: crisp stripes).
  const RINGS = [CHAR, lin(0xeeeaf2)];
  const abd = [];
  const n = 7;
  for (let k = 0; k < n; k++) {
    for (const u of [k / n, (k + 1) / n]) abd.push([u === 1 ? 0 : 16 * Math.sin(Math.PI * (0.1 + 0.9 * u)), u * 81.2]);
  }
  const a0 = [0, -4, -20];
  const a1 = [0, -18, -100];
  _q.setFromUnitVectors(Y_AXIS, _v.set(0, a1[1] - a0[1], a1[2] - a0[2]).normalize());
  const along = new THREE.Matrix4().compose(_v.set(...a0), _q, _s.set(1, 1, 1));
  b.at(M, MOSQUITO.ABDOMEN, 0, [0, 0, -20]).lathe(abd, 8, along, (p, nn, j) => [...RINGS[(j >> 1) % 2], 0]);
  // Wings: glassy leaves out from the shoulders, faces both ways (the material is FrontSide).
  for (const s of [-1, 1]) {
    const root = [s * 10, 16, 0];
    const end = [s * 92, 24, -22];
    const ax = new THREE.Vector3(end[0] - root[0], end[1] - root[1], end[2] - root[2]);
    const len = ax.length();
    ax.normalize();
    const wide = new THREE.Vector3().crossVectors(ax, Y_AXIS).normalize();
    const nrm = new THREE.Vector3().crossVectors(wide, ax).normalize();
    if (nrm.y < 0) nrm.negate();
    const pt = (t, w) => [root[0] + ax.x * len * t + wide.x * w, root[1] + ax.y * len * t + wide.y * w, root[2] + ax.z * len * t + wide.z * w];
    const half = (t) => 15 * Math.sin(Math.PI * t) ** 0.7;
    const outline = [pt(0, 0), pt(0.2, half(0.2)), pt(0.5, half(0.5)), pt(0.8, half(0.8)), pt(1, 0), pt(0.8, -half(0.8)), pt(0.5, -half(0.5)), pt(0.2, -half(0.2))];
    b.at(M, MOSQUITO.WING, s, root).fan(pt(0.45, 0), outline, nrm.toArray(), flat(0xdde8f0, 0.25), true);
  }
  // Six long dangling legs: out from the hip to a white knee, then down; param: each one's sway
  // offset.
  const KNEE = 0xede6da;
  let leg = 0;
  for (const s of [-1, 1]) {
    for (const z of [14, 0, -14]) {
      const hip = [s * 9, -12, z];
      const knee = [s * 39, -7, 1.5 * z];
      const foot = [s * 46, -80, 1.8 * z];
      b.at(M, MOSQUITO.LEG, leg++ * 1.1, hip);
      b.cyl(hip, knee, 2, 2, 4, flat(0x2e2b35));
      b.ball(knee, 3.5, 4, 3, flat(KNEE));
      b.cyl(knee, foot, 2, 1.6, 4, flat(0x2e2b35));
    }
  }
}

// ---------------------------------------------------------------- geometry

let BASE = null;

// The three models' vertex attributes (BufferAttributes: position, normal, color, aPart,
// aPivot, aEmit), built on the first call and shared by every manager's geometry since.
export function critterBase() {
  if (BASE) return BASE;
  const b = new SmoothBuilder();
  buildFrog(b);
  buildCrab(b);
  buildMosquito(b);
  BASE = {
    position: new THREE.BufferAttribute(new Float32Array(b.pos), 3),
    normal: new THREE.BufferAttribute(new Float32Array(b.nrm), 3),
    color: new THREE.BufferAttribute(new Float32Array(b.col), 3),
    aPart: new THREE.BufferAttribute(new Float32Array(b.part), 3),
    aPivot: new THREE.BufferAttribute(new Float32Array(b.pivot), 3),
    aEmit: new THREE.BufferAttribute(new Float32Array(b.emit), 1),
  };
  return BASE;
}

// A geometry for one manager: the shared base attributes in a new BufferGeometry (never
// cloned: a course's routes build hundreds of managers in the tests), plus its own per-instance
// channels for `capacity` critters.
export function makeCritterGeometry(capacity) {
  const base = critterBase();
  const geo = new THREE.BufferGeometry();
  for (const name of Object.keys(base)) geo.setAttribute(name, base[name]);
  for (const name of ['aAnim', 'aAnim2']) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
  }
  return geo;
}

// ---------------------------------------------------------------- material

// The vertex shader's parts (GLSL kept compact: it ships as written). critterPart() poses a
// vertex of part aPart as R * ((position - pivot) * scl) + pivot + off:
//   Wreath Frog (aAnim: legs, sac, wobble, breath; aAnim2: blink, wreath lift, glow): the BODY
//     breathes; an EYE blinks (squashed about its middle); the SAC puffs up; the HIND legs kick
//     back (legs 1) or fold (below 0) about the hip; the FRONT legs reach forward in a leap; the
//     WREATH pops off spinning and shrinking away, flying WREATH_RISE straight up in the world
//     (fast, then slowing: rise * lift * (2 - lift)) whatever the frog does under it (its
//     squash, its tumble, its poof: the instance's turn and scale undone for the offset), and
//     keeping its round shape as the body squashes (its height scaled back to its width, in
//     scl so its normals take the inverse); dazed, the head (body, eyes, sac and wreath) wobbles
//     about its base.
//   Tin Crab (aAnim: gait phase, stride, claw raise, pincer open; aAnim2: eyes, lift, glow):
//     the TIN and the BODY ride the lift (h = LIFT_SPAN * (lift - 1)); a STALK stretches with
//     its eyes (0.05 in .. 1.1 alert); a CLAW rises and spreads about the shoulder, turning on
//     its upright as it rises past its rest (raised in the tell, its pincer's opening faces the
//     front: never edge on to him and the camera behind him); its FINGER (the upper jaw) opens
//     upward about its hinge, riding the claw; a LEG's foot steps (sideways, a shear about the
//     hip, the tripod's halves in turn) and stays planted as the body rises: the lift reaches a
//     leg vertex by its modelled height (clamp(y / LEG_W, 0, 1)).
//   Mosquito (aAnim: wing phase, flap, curl, leg phase; aAnim2: eye glow, quiver, glow): the
//     BODY and the NEEDLE are rigid; an EYE glows red while it aims (vEye); the ABDOMEN curls; a
//     WING flaps; a LEG sways; stuck, the whole of it quivers.
const VERT_PARS = /* glsl */ `
attribute vec3 aPart;
attribute vec3 aPivot;
attribute float aEmit;
attribute vec4 aAnim;
attribute vec4 aAnim2;
varying float vEmit;
varying float vEye;
mat3 critRotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
mat3 critRotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
mat3 critRotZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.,-s,c,0.,0.,0.,1.);}
void critterPart(out mat3 R,out vec3 pivot,out vec3 off,out vec3 scl){
R=mat3(1.);pivot=aPivot;off=vec3(0.);scl=vec3(1.);vEye=0.;
float part=aPart.x,side=aPart.y;
if(aPart.z<.5){
if(part<.5)scl.y=1.+.03*aAnim.w;//BODY
else if(part<1.5)scl.y=1.-.9*aAnim2.x;//EYE
else if(part<2.5)scl=vec3(.35+1.65*aAnim.y);//SAC
else if(part<3.5)R=critRotX(1.3*aAnim.x);//HIND
else if(part<4.5)R=critRotX(-.5*aAnim.x);//FRONT
else{float lift=aAnim2.y;R=critRotY(9.*lift);scl=vec3(1.001-lift*lift);//WREATH
#ifdef USE_INSTANCING
mat3 im=mat3(instanceMatrix);vec3 q=vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]))+1e-6;scl.y*=sqrt(q.x/q.y);off=${CRITTER_RIG.frog.WREATH_RISE.toFixed(1)}*lift*(2.-lift)*vec3(im[0].y,im[1].y,im[2].y)/q;
#endif
}
if(part<2.5||part>4.5){mat3 W=critRotZ(aAnim.z);vec3 w0=vec3(0.,10.,0.);off=W*(pivot+off-w0)+w0-pivot;R=W*R;}
}else if(aPart.z<1.5){
float h=${CRITTER_RIG.crab.LIFT_SPAN.toFixed(1)}*(aAnim2.y-1.);//TIN BODY
if(part>1.5&&part<2.5)scl.y=aAnim2.x;//STALK
else if(part>2.5&&part<4.5){mat3 C=critRotY(side*(.3*aAnim.z+.9*max(aAnim.z-.4,0.)))*critRotX(-aAnim.z);
if(part<3.5)R=C;//CLAW
else{vec3 sh=vec3(side*40.,34.,30.);R=C*critRotX(-.6*aAnim.w);off=C*(pivot-sh)+sh-pivot;}//FINGER
}else if(part>4.5){float w=clamp(position.y/${CRITTER_RIG.crab.LEG_W.toFixed(1)},0.,1.),lp=aAnim.x+side,k=(1.-w)*aAnim.y;off.x=sin(lp)*12.*k;off.y=max(cos(lp),0.)*10.*k;h*=w;}//LEG
off.y+=h;
}else{
if(part>.5&&part<1.5)vEye=aAnim2.x;//EYE (BODY, NEEDLE rigid)
else if(part>2.5&&part<3.5)R=critRotX(.6*aAnim.z);//ABDOMEN
else if(part>3.5&&part<4.5)R=critRotZ(side*(.25+aAnim.y*.9*sin(aAnim.x)));//WING
else if(part>4.5)R=critRotX(.25*sin(aAnim.w+side));//LEG
off.x+=aAnim2.y*3.*sin(aAnim.x*.37);
}
}
`;

// Normals turn with the part (the inverse of its scale, normalised later).
const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
mat3 cR;vec3 cPivot,cOff,cScl;
critterPart(cR,cPivot,cOff,cScl);
objectNormal=cR*(objectNormal/cScl);
`;

// The pose, then the type mask: an instance shows its own model only (the others collapse to a
// point); the glow.
const VERT_DEFORM = /* glsl */ `
#include <begin_vertex>
transformed=cR*((position-cPivot)*cScl)+cPivot+cOff;
if(abs(aPart.z-aAnim2.w)>.5)transformed=vec3(0.);
vEmit=aEmit*(.12+aAnim2.z);
`;

export function makeCritterMaterial() {
  const uniforms = {
    uRim: { value: new THREE.Color(0.26, 0.22, 0.16) },
    uFogScale: { value: 0.6 },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', VERT_DEFORM);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uFogScale;\nvarying float vEmit;\nvarying float vEye;')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          // The mosquito's eyes go a deep red while it aims (their black pupils stay black).
          '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.06, 0.03), vEye * step(0.1, diffuseColor.r));',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '\ttotalEmissiveRadiance += diffuseColor.rgb * vEmit;',
          '\tfloat rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
          '\ttotalEmissiveRadiance += uRim * (rimK * rimK);',
        ].join('\n'),
      )
      .replace('#include <fog_fragment>', scaledFog('uFogScale', false));
  };
  material.customProgramCacheKey = () => 'skerryCritters';
  material.userData.uniforms = uniforms;
  material.userData.vertexChunks = VERT_PARS + VERT_NORMAL + VERT_DEFORM; // (tests read the parts' code here)
  return material;
}

// ---------------------------------------------------------------- danger markers

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// The orange rings on the ground where a strike will land (the frog's landing, the mosquito's
// needle): the AI RACE markers' texture with a wider, solid ring (the thin one blurs into the
// grass at the game's low resolution), blended normally (an additive orange turns yellow on the
// bright meadow), tinted per instance (Critters.animate), drawn with the blob shadows (before
// the water).
const RING_STOPS = [[0, 0.5], [0.4, 0.3], [0.58, 1], [0.86, 1], [0.95, 0.45], [1, 0]];

export function makeMarkerMesh(capacity) {
  const material = new THREE.MeshBasicMaterial({
    map: makeMarkerTexture(RING_STOPS),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const n = Math.max(1, capacity);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, n);
  mesh.name = 'critterMarkers';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.6;
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(i, _c.setRGB(1, 0.45, 0.08, THREE.SRGBColorSpace));
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}
