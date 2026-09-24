// The winged hat (the flight power-up): a pair of white feathered wings sprouting from both
// sides of the crown of Pip's own teal explorer hat (the winged-hat motif of old myths).
//
//   HatWings        the wings on Pip's hat: one mesh in hat space (a single draw call) whose
//                   vertices are re-posed on the CPU every frame (~300 of them), so each
//                   wing can flap about its own hinge and bend a little along its span.
//   buildWingedHat  a standalone winged hat (hat + wings) for the hovering pickup.
//
// Each wing is five low-poly pieces: four primary feathers fanned from a short arm, the
// leading one laid over the ones behind, and a broad covert over their roots. Tops are soft
// white, undersides cool grey (each piece is a thin two-sided slab), with a hint of teal
// where they meet the hat.

import * as THREE from 'three';
import { clamp, smoothstep, TAU } from '../../core/math.js';
import { easeOutBack } from './kit.js';
import { bodyMaterial, COLORS } from './palette.js';
import { buildHatMesh } from './rig.js';

// ---- the wing template (Pip's left wing, in its hinge frame) --------------------------------
// The hinge runs along +Z (front), the span reaches out along +X and the top faces +Y. Each
// piece: attach point `at` along the arm, `ang` swept back from the span direction, length,
// width, and `y` its layer height (leading pieces lie over the ones behind them).
const ARM_SWEEP = 0.2;
const PIECES = [
  { at: 18, ang: 0.32, len: 31, wid: 9, y: 0.9 },
  { at: 13.5, ang: 0.62, len: 28, wid: 9, y: 0.6 },
  { at: 9, ang: 0.92, len: 24, wid: 8.6, y: 0.3 },
  { at: 4.5, ang: 1.22, len: 19, wid: 8, y: 0 },
  { at: -1, ang: 0.3, len: 25, wid: 15, y: 1.7, covert: true },
];
const SIZE = 1.2; // overall scale of the pieces above
const THICK = 0.7; // slab thickness (top and underside)
const CURL = 0.09; // feather tips curl up by CURL x length
// Blade outline: [fraction along, half-width fraction] from the root to the rounded tip.
const BLADE = [[0, 0.22], [0.45, 0.5], [0.82, 0.4]];
const COVERT = [[0, 0.3], [0.4, 0.5], [0.8, 0.36]];
const SPAN = 55; // rough reach of the wing (for the bend along the span)

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function mix(out, a, b, t) {
  tmpA.set(COLORS[a]);
  tmpB.set(COLORS[b]);
  return out.copy(tmpA).lerp(tmpB, clamp(t, 0, 1));
}

// Non-indexed triangle soup of the left wing: positions, flat normals, vertex colours.
function wingTemplate() {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const armX = Math.cos(ARM_SWEEP);
  const armZ = -Math.sin(ARM_SWEEP);
  for (const piece of PIECES) {
    const { ang, y, covert } = piece;
    const at = piece.at * SIZE;
    const len = piece.len * SIZE;
    const wid = piece.wid * SIZE;
    const dx = Math.cos(ang);
    const dz = -Math.sin(ang); // swept back = -Z
    const ex = -dz; // across the feather (perpendicular in the wing plane)
    const ez = dx;
    const outline = covert ? COVERT : BLADE;
    // Outline points: left k, right k, ..., then the tip; each [x, y, z, fraction along].
    const pt = (f, w, top) => {
      const s = f * len;
      return [
        at * armX + dx * s + ex * w * wid,
        y + CURL * len * f * f - (top ? 0 : THICK),
        at * armZ + dz * s + ez * w * wid,
        f,
      ];
    };
    for (const top of [true, false]) {
      const L = outline.map(([f, w]) => pt(f, -w, top));
      const R = outline.map(([f, w]) => pt(f, w, top));
      const tip = pt(1, 0, top);
      const tris = [];
      for (let k = 0; k < outline.length - 1; k++) tris.push([L[k], R[k], L[k + 1]], [R[k], R[k + 1], L[k + 1]]);
      tris.push([L.at(-1), R.at(-1), tip]);
      for (const tri of tris) {
        // Wind so the top faces up and the underside down (front faces).
        const [a, b, d] = tri;
        const ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
        const order = (ny > 0) === top ? [a, b, d] : [a, d, b];
        for (const v of order) {
          pos.push(v[0], v[1], v[2]);
          const f = v[3];
          if (!top) mix(c, 'wingUnder', 'wingUnderTip', f * f);
          else if (covert) mix(c, 'wingRoot', 'wing', smoothstep(0.05, 0.6, f));
          else mix(c, 'wing', 'wingTip', 0.7 * f * f);
          col.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // non-indexed: flat face normals
  return { pos: new Float32Array(pos), nrm: g.attributes.normal.array.slice(), col: new Float32Array(col) };
}

let TEMPLATE = null;
const template = () => (TEMPLATE ??= wingTemplate());

// ---- placement on the hat (hat space: origin at the brim centre, +Y up, front +Z) -----------
// The hinge sits just inside the crown's side, above the band. A wing is posed by (in order)
// `attack` (tilt about its span: + raises the trailing feathers), the flap about the hinge
// (`lift` + the beat: + raises the tip; ~1 rad stands it up beside the crown), and `sweep`
// back about the vertical.
const ROOT = { x: 22.5, y: 10.5, z: 3 };
const SWEEP = 0.4; // base sweep back (rad)
const MIN_BEND = -0.2; // the lowest a wing section may flap (keeps the tips off the brim)
const MAX_BEND = 1.45; // ...and the highest (never folds in over the crown)
const NORMAL_LIFT = 1.4; // see poseWing
export const BOUND_R = 100; // the wings' fixed bounding sphere: (0, 15, -10) in hat space

// Flap styles: freq (beats/s), amp (rad), lift (rad), sweep (extra, rad), attack (rad),
// scale (size).
// On the ground the wings stand up beside the crown like a winged helmet's; in flight they
// spread out sideways for big bird-like beats.
const GROUND = { freq: 1.1, amp: 0.1, lift: 0.95, sweep: 0, attack: 0.4, scale: 1 };
const AIR = { freq: 3.2, amp: 0.4, lift: 0.8, sweep: 0, attack: 0.3, scale: 1 };
const STREAMLINED = { freq: 1.6, amp: 0.07, lift: 0.5, sweep: 0.75, attack: 0.1, scale: 1 }; // dives, slides
const WATER = { freq: 0.8, amp: 0.06, lift: 0.7, sweep: 0.55, attack: 0.3, scale: 1 };
// Upside down on a tree top: folded small along the brim, out of the tree's crown.
const FOLDED = { freq: 0.9, amp: 0.04, lift: 0.04, sweep: 0.8, attack: -0.12, scale: 0.72 };
const AIR_ANIMS = new Set([
  'jump', 'fall', 'double_jump', 'triple_jump', 'backflip', 'sideflip', 'wallkick', 'pole_jump', 'water_jump',
  'jump_kick', 'burn', 'spawn', 'hurt', 'bonk', 'ground_pound_spin', 'star_dance',
]);
const STREAMLINED_ANIMS = new Set(['dive', 'long_jump', 'belly_slide', 'ground_pound_fall', 'butt_slide']);
const WATER_ANIMS = new Set(['swim_idle', 'swim_stroke', 'swim_flutter', 'water_surface']);
const FOLDED_ANIMS = new Set(['pole_handstand']);

const BLINK_RATE = 10; // wingHatEnding: visibility toggles per second
const UNFOLD_TIME = 0.35; // the wings pop open when the hat goes on
const RESPONSE = 6; // 1/s: how fast the flap style follows the action

// Writes one wing's posed vertices into the mesh arrays (offset o, in floats). side: 1 left,
// -1 right (mirrored in x, with the triangle winding flipped to stay front-facing). w: the
// pose { lift, amp, phase, sweep, attack, scale }.
function poseWing(src, dst, o, side, w) {
  const { pos, nrm } = src;
  const out = dst.pos;
  const outN = dst.nrm;
  const flap = w.lift + w.amp * Math.sin(w.phase);
  const lag = -0.5 * w.amp * Math.cos(w.phase); // the tips trail the stroke
  const cs = Math.cos(SWEEP + w.sweep);
  const ss = Math.sin(SWEEP + w.sweep);
  const ct = Math.cos(w.attack);
  const st = Math.sin(w.attack);
  const scale = w.scale;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    // Mirrored wings keep front faces by swapping the 2nd and 3rd vertex of each triangle.
    const j = side > 0 ? i : i + ((i % 3) === 1 ? 1 : (i % 3) === 2 ? -1 : 0);
    const x0 = pos[i * 3];
    const a = Math.min(MAX_BEND, Math.max(MIN_BEND, flap + (lag * x0) / SPAN));
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = o + j * 3;
    // attack about x, flap about z, sweep about y, then onto the crown.
    let x = x0 * scale;
    let y = pos[i * 3 + 1] * scale;
    let z = pos[i * 3 + 2] * scale;
    let t = y * ct - z * st;
    z = y * st + z * ct;
    y = t;
    t = x * c - y * s;
    y = x * s + y * c;
    x = t;
    out[k] = side * (ROOT.x + x * cs + z * ss);
    out[k + 1] = ROOT.y + y;
    out[k + 2] = ROOT.z - x * ss + z * cs;
    x = nrm[i * 3];
    y = nrm[i * 3 + 1];
    z = nrm[i * 3 + 2];
    t = y * ct - z * st;
    z = y * st + z * ct;
    y = t;
    t = x * c - y * s;
    y = x * s + y * c;
    x = t;
    // Bent toward hat-up, so both sides of the thin feathers catch the light from above
    // (the undersides keep their cooler colour).
    const nx = x * cs + z * ss;
    const nz = -x * ss + z * cs;
    const ny = y + NORMAL_LIFT;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    outN[k] = side * nx * inv;
    outN[k + 1] = ny * inv;
    outN[k + 2] = nz * inv;
  }
}

// Both wings as one mesh in hat space, posed by pose({ lift, amp, phase, sweep, attack, scale }).
class WingPair {
  constructor(material) {
    const src = template();
    this.src = src;
    this.floats = src.pos.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.floats * 2);
    const nrm = new Float32Array(this.floats * 2);
    const col = new Float32Array(this.floats * 2);
    // The right wing's colours follow its swapped winding (see poseWing).
    for (let i = 0; i < this.floats / 3; i++) {
      const j = i + ((i % 3) === 1 ? 1 : (i % 3) === 2 ? -1 : 0);
      col.set(src.col.subarray(i * 3, i * 3 + 3), i * 3);
      col.set(src.col.subarray(i * 3, i * 3 + 3), this.floats + j * 3);
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.dst = { pos, nrm };
    this.pose({ lift: GROUND.lift, amp: 0, phase: 0, sweep: 0, attack: GROUND.attack, scale: 1 });
    // Fixed bounds that hold every flap (no per-frame recompute).
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, -10), BOUND_R);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-BOUND_R, 15 - BOUND_R, -10 - BOUND_R), new THREE.Vector3(BOUND_R, 15 + BOUND_R, BOUND_R - 10));
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'wings';
  }

  pose(w) {
    poseWing(this.src, this.dst, 0, 1, w);
    poseWing(this.src, this.dst, this.floats, -1, w);
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }
}

// The wings on Pip's hat. Hidden until RenderState.wingHat; then they pop open and flap in
// a style that follows the action: a lazy flutter on the ground (quicker at a run), brisk
// beats in the air, strong beats while flying (stronger still climbing, nose up), folded
// back in dives; they blink while RenderState.wingHatEnding.
export class HatWings {
  // material: the rig's vertex-colour body material (no extra program).
  constructor(material) {
    this.pair = new WingPair(material);
    this.mesh = this.pair.mesh;
    this.mesh.visible = false;
    this.on = false;
    this.unfold = 0;
    this.freq = GROUND.freq;
    this.amp = GROUND.amp; // the beat's amplitude (shown at amp x unfold)
    // The shown pose (eased toward the style of the current action).
    this.w = { lift: GROUND.lift, amp: GROUND.amp, phase: 0, sweep: 0, attack: GROUND.attack, scale: 1 };
    this.style = { freq: 0, amp: 0, lift: 0, sweep: 0, attack: 0, scale: 1 }; // scratch target
    this.size = 1; // eased style scale
  }

  // rs: the sanitized RenderState; time: the model's free-running clock (s).
  update(rs, dt, time) {
    if (!rs.wingHat) {
      this.on = false;
      this.mesh.visible = false;
      return;
    }
    if (!this.on) {
      this.on = true;
      this.unfold = 0;
    }
    this.unfold = Math.min(1, this.unfold + dt / UNFOLD_TIME);
    const s = styleFor(rs, this.style);
    const k = 1 - Math.exp(-RESPONSE * dt);
    const w = this.w;
    this.freq += (s.freq - this.freq) * k;
    w.lift += (s.lift - w.lift) * k;
    w.sweep += (s.sweep - w.sweep) * k;
    w.attack += (s.attack - w.attack) * k;
    this.size += (s.scale - this.size) * k;
    this.amp += (s.amp - this.amp) * k;
    w.phase = (w.phase + TAU * this.freq * dt) % TAU;
    // (+ a hair, so a clock stepping in exact 1/30 s ticks toggles every 3 ticks, not 2 / 4)
    this.mesh.visible = !rs.wingHatEnding || Math.floor(time * BLINK_RATE + 1e-4) % 2 === 0;
    if (!this.mesh.visible) return;
    const u = this.unfold;
    const keepSweep = w.sweep;
    w.amp = this.amp * u; // a folded wing does not beat
    w.sweep = keepSweep + 0.9 * (1 - u); // unfolding: swept back along the crown
    w.scale = this.size * Math.max(0.05, easeOutBack(u));
    this.pair.pose(w);
    w.sweep = keepSweep;
  }
}

// The flap style (see GROUND etc.) for the current action, written into `out`.
function styleFor(rs, out) {
  if (rs.anim === 'fly') {
    // Nose up (pitch < 0) climbs with hard beats; nose down folds the wings back.
    const climb = clamp(-rs.pitch / 0.5, 0, 1);
    const dive = clamp(rs.pitch / 0.6, 0, 1);
    out.freq = 2.4 + 2.2 * climb - 1.2 * dive;
    out.amp = 0.48 + 0.2 * climb - 0.36 * dive;
    out.lift = 0.55 + 0.12 * climb - 0.1 * dive;
    out.sweep = 0.25 + 0.5 * dive;
    out.attack = 0.45 + 0.1 * climb - 0.2 * dive;
    out.scale = 1.12 - 0.1 * dive; // spread wide
    return out;
  }
  const s = AIR_ANIMS.has(rs.anim) ? AIR
    : STREAMLINED_ANIMS.has(rs.anim) ? STREAMLINED
      : WATER_ANIMS.has(rs.anim) ? WATER
        : FOLDED_ANIMS.has(rs.anim) ? FOLDED : GROUND;
  out.freq = s.freq;
  out.amp = s.amp;
  out.lift = s.lift;
  out.sweep = s.sweep;
  out.attack = s.attack;
  out.scale = s.scale;
  if (s === GROUND) {
    // A quicker, bigger flutter at a run, a little swept back by the wind.
    const run = clamp(Math.abs(rs.forwardVel) / 48, 0, 1);
    out.freq += 1.6 * run;
    out.amp += 0.12 * run;
    out.sweep += 0.2 * run;
  }
  return out;
}

// A standalone winged hat for the hovering pickup: Pip's teal explorer hat (one merged
// vertex-coloured mesh, same look) with the same pair of wings (a second mesh), lit by the
// scene's lights like Pip. Origin at the centre of the brim, +Y up, front +Z; the brim is
// ~100 units across (y -1.4 .. 24 with the crown), the wings reach ~60 either side and ~67
// up. (The wing mesh carries fixed culling bounds of radius BOUND_R: measure it with
// Box3.setFromObject(hat, true).) Spread at rest; call
//   hat.userData.flap(timeSeconds, strength = 1)
// each frame to beat the wings (strength 0 = still, 1 = brisk beats).
export function buildWingedHat() {
  const material = bodyMaterial();
  const group = new THREE.Group();
  group.name = 'wingedHat';
  group.add(buildHatMesh(material));
  const pair = new WingPair(material);
  group.add(pair.mesh);
  const w = { lift: AIR.lift, amp: 0, phase: 0, sweep: 0.1, attack: AIR.attack, scale: 1 };
  pair.pose(w);
  group.userData.flap = (time, strength = 1) => {
    w.amp = AIR.amp * clamp(Number.isFinite(strength) ? strength : 1, 0, 1.5);
    w.phase = ((Number.isFinite(time) ? time : 0) * TAU * 2.4) % TAU;
    pair.pose(w);
  };
  return group;
}
