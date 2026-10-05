// STOMPWATT's model in each look (LaneBoss.js poses it): the dad's car's own triangles, each on the
// bone of the piece it belongs to (world/lane/real/pieces.js), and the robot's frame (frame.js),
// skinned (three.js SkinnedMesh, rigid: every vertex on one bone) on a rig of its own per look
// (rig.js bones; each look's pieces turn about their own pivots).
//
//   classicCar(layout, part) -> pieces   the classic look's car (part.ownCar: lane/props.js
//                                    dadCar, the same faces the parked car draws) in its own
//                                    frame, its pieces tagged
//   new RobotModel(look, pieces, opts)   look: 'classic', or the realistic tier ('high' | 'mid' |
//       | 'low'); pieces: classicCar's, or the realistic part's (look.js part.robot: the worker's,
//       detail.js robotPieces, each mesh with the material the car is drawn in); opts.tint (the
//       car's body colour), opts.light (the classic look's bake: the lane part's `light`, lane/
//       build.js LIGHT and its sun), opts.hl (the car's half length)
//     .group                         its skinned meshes and its bones (in world coordinates)
//     .pose(state)                   the bones from a pose state (LaneBoss.js: where it stands,
//                                    its turn, the morph, the lift, the frame's turns, blinks)
//     .meshes, .rig
//
// Car form (morph 0) is exactly the parked car: the classic look draws its pieces with the bake
// the parked car was baked with, computed live from the skinned normals (bakeMaterial: the same
// ambient, diffuse, clamp and warm tint), so the swap between them never shows; the realistic look
// draws them in the car's own materials (shared with the parked car's meshes). Slots (draw calls):
// classic 2 (the baked faces, the glow); high 6 (paint, glass, black, lamp, metal, glow: the
// paint, black, lamp and metal casting the sun's shadow); mid 3 (everything opaque in the paint,
// the glass, the glow); low 1 (everything in the paint, its lights lit bright there as the
// parked car's T lights are on low: one draw call).

import * as THREE from 'three';
import { GeoBuilder } from '../../world/castle/geom.js';
import { renderTexture } from '../../world/lane/textures.js';
import { PIECES, PIECE, pieceOf } from '../../world/lane/real/pieces.js';
import { BONE, BONES, BONE_COUNT, ATTACH, FOLLOW, LIGHTS, BAY, CELLS, pivotsOf, grow, rise, arrive, ARC } from './rig.js';
import { buildFrame } from './frame.js';

const ATTRS = { position: 3, normal: 3, color: 3 };
const ATTRS_UV = { ...ATTRS, uv: 2 }; // (the classic look's: render's grain texture, as the parked car)
// The realistic look's slots per tier: which slot each of the car's materials (and the frame's
// parts) is drawn in.
const SLOTS = {
  high: { carPaint: 'paint', carGlass: 'glass', trim: 'black', tyre: 'black', lamp: 'lamp', tail: 'lamp', metal: 'metal', rim: 'metal', drl: 'glow', paint: 'paint', black: 'black', glow: 'glow' },
  mid: { carPaint: 'paint', carGlass: 'glass', trim: 'paint', tyre: 'paint', lamp: 'paint', tail: 'paint', metal: 'paint', rim: 'paint', drl: 'glow', paint: 'paint', black: 'paint', glow: 'glow' },
  // (Low: one draw call, its lights lit bright in the paint as the parked car's T lights are.)
  low: { carPaint: 'paint', carGlass: 'paint', tyre: 'paint', gloss: 'paint', metal: 'paint', paint: 'paint', black: 'paint', glow: 'paint' },
  classic: { car: 'bake', paint: 'bake', black: 'bake', metal: 'bake', glow: 'glow' },
};
const CASTS = new Set(['paint', 'black', 'lamp', 'metal', 'bake']);
const GLASS = 0x2a323a; // (the classic car's glass: lane/props.js TINT.glass)
// Each realistic slot's material: the car's own (the first of these it was drawn in).
const SLOT_MATERIAL = { paint: ['carPaint'], glass: ['carGlass'], black: ['trim', 'tyre'], lamp: ['lamp', 'tail', 'gloss'], metal: ['metal', 'rim'] };
const EYE_BRIGHT = 1.6; // (the T lights' glow: the drl material's emissive)

// The classic look's car in its own frame, its triangles tagged with their pieces; its cuts.
export function classicCar(layout, part) {
  const car = layout.CARS.find((c) => c.id === layout.LANE_BOSS.car);
  const b = new GeoBuilder(300);
  const zones = [];
  const cuts = part.ownCar(car.id, b, (zone) => zones.push([zone, b.pos.length / 3]));
  // Each door's own window (the robot's pauldrons and shin guards keep theirs), just inside the
  // cabin's side glass where the car hides it: the cabin's side from the belt (hw - 10, its ends
  // at the cabin's foot) in to the roof (hw - 32, its ends at the roof's).
  const K = layout.CAR_KINDS[car.kind];
  const [hl, hw] = [K.l / 2, K.w / 2];
  zones.push(['doors', b.pos.length / 3]);
  b.color(GLASS);
  const side = (s, t, w) => [s * (hw - 11.5 - 22 * t), K.belt + (K.roof - K.belt) * t, w];
  const front = (t) => hl - K.hood - K.screen * t - 8;
  for (const s of [-1, 1]) {
    for (const [a, z] of [[() => cuts.pillar + 6, front], [() => cuts.tail + 4, () => cuts.pillar - 6]]) {
      const [t0, t1] = [0.03, 0.82];
      b.poly([side(s, t0, a(t0)), side(s, t0, z(t0)), side(s, t1, z(t1)), side(s, t1, a(t1))], { facing: [s, 0.2, 0] });
    }
  }
  const take = { car: { pos: [], nrm: [], col: [], uv: [], part: [] }, glow: { pos: [], nrm: [], col: [], uv: [], part: [] } };
  let z = 0;
  for (let v = 0; v < b.pos.length / 3; v += 3) {
    while (z + 1 < zones.length && zones[z + 1][1] <= v) z++;
    const zone = zones[z][0];
    const m = [0, 1, 2].map((k) => (b.pos[v * 3 + k] + b.pos[v * 3 + 3 + k] + b.pos[v * 3 + 6 + k]) / 3);
    const n = b.nrm.slice(v * 3, v * 3 + 3);
    const c = b.col.slice(v * 3, v * 3 + 3);
    const eye = zone === 'nose' && c[0] > 0.95 && c[1] > 0.95 && c[2] > 0.95;
    const id = zone === 'contact' ? PIECE.shadow : pieceOf(zone, m, n, cuts, eye);
    if (id < 0) continue;
    const t = eye ? take.glow : take.car;
    for (let k = 0; k < 3; k++) {
      t.pos.push(...b.pos.slice((v + k) * 3, (v + k) * 3 + 3));
      t.nrm.push(...b.nrm.slice((v + k) * 3, (v + k) * 3 + 3));
      t.col.push(...b.col.slice((v + k) * 3, (v + k) * 3 + 3));
      t.uv.push(b.uv[(v + k) * 2], b.uv[(v + k) * 2 + 1]);
      t.part.push(id);
    }
  }
  const buffers = (t) => ({ position: Float32Array.from(t.pos), normal: Float32Array.from(t.nrm), color: Float32Array.from(t.col), uv: Float32Array.from(t.uv), part: Uint8Array.from(t.part) });
  return { cuts, tint: car.classicTint ?? car.tint, meshes: [{ name: 'car', buffers: buffers(take.car) }, { name: 'glow', buffers: buffers(take.glow) }] };
}

// The classic look's material for the robot: unlit like the world, its light the world's bake
// (`light`: ambient + diffuse toward the sun, clamped, tinted: render/materials.js bakeLighting)
// computed per vertex from the skinned normal.
function bakeMaterial({ sun, ambient, diffuse, maxBright, tint }, map) {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBakeSun = { value: new THREE.Vector3(sun.x, sun.y, sun.z) };
    shader.uniforms.uBake = { value: new THREE.Vector3(ambient, diffuse, maxBright) };
    shader.uniforms.uBakeTint = { value: new THREE.Vector3(tint[0], tint[1], tint[2]) };
    shader.vertexShader = 'uniform vec3 uBakeSun, uBake, uBakeTint;\nvarying vec3 vBake;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_SKINNING
        vec3 bakeN = normalize(mat3(modelMatrix) * objectNormal);
      #else
        vec3 bakeN = normalize(mat3(modelMatrix) * normal);
      #endif
      vBake = min(uBake.x + uBake.y * max(0.0, dot(bakeN, uBakeSun)), uBake.z) * uBakeTint;`,
    );
    shader.fragmentShader = 'varying vec3 vBake;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vBake;');
  };
  material.customProgramCacheKey = () => 'lane-boss-bake';
  return material;
}

// Typed arrays joined.
function concat(list, Type) {
  const out = new Type(list.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of list) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

export class RobotModel {
  constructor(look, pieces, { tint, light = null, hl = 315 } = {}) {
    this.look = look;
    const classic = look === 'classic';
    const slotOf = SLOTS[classic ? 'classic' : look] ?? SLOTS.high;
    // The car's triangles and the frame's, by slot.
    const bySlot = {};
    const add = (slot, buffers, eyesToGlow = false) => {
      if (eyesToGlow && slot !== 'glow') {
        // (The T lights draw in the glow wherever their mesh is: on low they share the gloss.)
        const part = buffers.part;
        const eyes = [];
        const rest = [];
        for (let v = 0; v < part.length; v += 3) (part[v] === PIECE.eyeL || part[v] === PIECE.eyeR ? eyes : rest).push(v);
        if (eyes.length) {
          add('glow', pick(buffers, eyes, EYE_BRIGHT));
          if (!rest.length) return;
          buffers = pick(buffers, rest);
        }
      }
      (bySlot[slot] ??= []).push(buffers);
    };
    const mat = {};
    for (const [slot, names] of Object.entries(SLOT_MATERIAL)) {
      for (const n of names) mat[slot] ??= pieces.meshes.find((m) => m.name === n)?.material;
    }
    const toGlow = !classic && slotOf.glow === 'glow';
    for (const m of pieces.meshes) {
      const slot = slotOf[m.name] ?? 'paint';
      add(slot, slot === 'glow' && !classic ? scaled(m.buffers, EYE_BRIGHT) : m.buffers, toGlow);
    }
    // Each piece's pivot; the eyes' (the middle of each T) and the hatch's hinge (its top edge at
    // the back) from the geometry.
    const pivots = pivotsOf(pieces.cuts, hl);
    // (The car's roof's face on its chest: the classic roof slab stands 3 over the roof.)
    const [, off, , scale] = ATTACH.canopy;
    const chest = off[2] + (pieces.cuts.roof + (classic ? 3 : 0) - pivots.canopy[1]) * scale[1];
    const box = (id) => {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const list of Object.values(bySlot)) {
        for (const b of list) {
          for (let v = 0; v < b.part.length; v++) {
            if (b.part[v] !== id) continue;
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], b.position[v * 3 + k]);
              hi[k] = Math.max(hi[k], b.position[v * 3 + k]);
            }
          }
        }
      }
      return [lo, hi];
    };
    for (const e of ['eyeL', 'eyeR']) {
      const [lo, hi] = box(PIECE[e]);
      pivots[e] = lo[0] <= hi[0] ? lo.map((l, k) => (l + hi[k]) / 2) : pivots.head;
    }
    const [hlo, hhi] = box(PIECE.hatch);
    pivots.hatch = hlo[0] <= hhi[0] ? [0, hhi[1], hlo[2]] : pivots.tail;
    pivots.shadow = [0, 0, 0];
    const frame = buildFrame(look, tint, { chest });
    for (const [name, g] of Object.entries(frame)) if (g.count) add(slotOf[name], g.buffers());
    this.rig = new Rig(pivots);
    // Materials: the classic bake and glow; the realistic slots' from the car's own (the frame's
    // black and metal fall back to the paint where the car has none of them), the glow unlit.
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    glow.name = 'lane-boss-glow';
    const bake = classic ? bakeMaterial(light, renderTexture()) : null;
    if (bake) bake.name = 'lane-boss-bake';
    this.group = new THREE.Group();
    this.group.name = `lane-boss-${look}`;
    this.group.add(this.rig.root);
    this.meshes = [];
    for (const [slot, list] of Object.entries(bySlot)) {
      const geo = new THREE.BufferGeometry();
      const attrs = classic ? ATTRS_UV : ATTRS;
      for (const key of Object.keys(attrs)) geo.setAttribute(key, new THREE.BufferAttribute(concat(list.map((b) => b[key]), Float32Array), attrs[key]));
      const part = concat(list.map((b) => b.part), Uint8Array);
      const index = new Uint16Array(part.length * 4);
      const weight = new Float32Array(part.length * 4);
      for (let v = 0; v < part.length; v++) {
        index[v * 4] = part[v];
        weight[v * 4] = 1;
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
      geo.setAttribute('part', new THREE.BufferAttribute(part, 1)); // (tests: each vertex's bone)
      const material = slot === 'glow' ? glow : slot === 'bake' ? bake : mat[slot] ?? mat.paint;
      const mesh = new THREE.SkinnedMesh(geo, material);
      mesh.name = `lane-boss-${look}-${slot}`;
      mesh.bindMode = THREE.DetachedBindMode;
      mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false; // (its bind pose's bounds are the car's)
      mesh.castShadow = !classic && CASTS.has(slot);
      mesh.receiveShadow = !classic && slot !== 'glow';
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.triangles = this.meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
  }

  pose(state) {
    this.rig.pose(state);
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
  }
}

// Some of a buffer set's triangles (by first vertex), their colours times k.
function pick(b, firsts, k = 1) {
  const out = { position: [], normal: [], color: [], part: [] };
  for (const v of firsts) {
    for (let i = v; i < v + 3; i++) {
      for (let c = 0; c < 3; c++) {
        out.position.push(b.position[i * 3 + c]);
        out.normal.push(b.normal[i * 3 + c]);
        out.color.push(b.color[i * 3 + c] * k);
      }
      out.part.push(b.part[i]);
    }
  }
  return { position: Float32Array.from(out.position), normal: Float32Array.from(out.normal), color: Float32Array.from(out.color), part: Uint8Array.from(out.part) };
}
const scaled = (b, k) => ({ ...b, color: b.color.map((c) => c * k) });

// ---------------------------------------------------------------- the rig

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _s1 = new THREE.Vector3();
const ID = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const MOVERS = Object.keys(ATTACH);
const ON_WHEELS = MOVERS.map((p) => p.startsWith('wheel')); // (they stay down as the body lifts)
const FOLLOWERS = Object.keys(FOLLOW);
const LEADERS = FOLLOWERS.map((p) => FOLLOW[p]);
const REST = Object.fromEntries(BONES.map(([name, , at]) => [name, at]));
REST.root = [0, 0, 0];
const SPINS = MOVERS.map((p) => (p === 'wheelFL' || p === 'wheelFR' ? 1 : p === 'wheelRL' || p === 'wheelRR' ? 2 : 0)); // (fists, heels)
const LIGHT_AT = LIGHTS.map((n) => BONES.findIndex((b) => b[0] === n));
const CELLS_AT = BONES.findIndex((b) => b[0] === CELLS);
const BAY_AT = BONES.findIndex((b) => b[0] === BAY);
const PELVIS_REST = REST.pelvis[1];
const PELVIS_LOW = 60; // (folded inside the car: its pelvis in the car's floor)
const SHADOW_GONE = 0.25; // (the car's soft shadow gone this far into the morph)

// One look's bones: the root (where the robot stands, its turn), the frame's bones under it, the
// pieces' bones under it too (set each frame: in the car, flying, or on their frame bone).
export class Rig {
  constructor(pivots) {
    this.pivots = pivots;
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) this.bones.push(new THREE.Bone());
    const name = Object.fromEntries(Object.entries(BONE).map(([n, i]) => [i, n]));
    this.bones.forEach((b, i) => (b.name = `lane-boss-${name[i]}`));
    this.root = this.bones[BONE.root];
    const inverses = this.bones.map(() => new THREE.Matrix4());
    for (const p of PIECES) {
      const b = this.bones[PIECE[p]];
      b.matrixAutoUpdate = false;
      this.root.add(b);
      const v = pivots[p];
      inverses[PIECE[p]].makeTranslation(-v[0], -v[1], -v[2]);
    }
    for (const [n, parent, at] of BONES) {
      const b = this.bones[BONE[n]];
      const up = REST[parent];
      b.position.set(at[0] - up[0], at[1] - up[1], at[2] - up[2]);
      b.userData.rest = b.position.clone();
      this.bones[BONE[parent]].add(b);
      inverses[BONE[n]].makeTranslation(-at[0], -at[1], -at[2]);
    }
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    // Each piece's place on its bone (ATTACH: offset, axes, scale), as a matrix.
    this.attach = {};
    for (const [p, [, off, axes, scale]] of Object.entries(ATTACH)) {
      const a = new THREE.Matrix4().makeBasis(new THREE.Vector3(...axes[0]), new THREE.Vector3(...axes[1]), new THREE.Vector3(...axes[2]));
      a.scale(new THREE.Vector3(...scale));
      a.setPosition(off[0], off[1], off[2]);
      this.attach[p] = a;
    }
    this.frameBones = BONES.map(([n]) => this.bones[BONE[n]]);
  }

  // state: { x, y, z, yaw, m (the morph: 0 the car .. 1 the robot), lift (the car's body raised off
  // its wheels), bob (the pelvis up or down), turns (the frame bones' [x, y, z] in BONES order,
  // 'frame' first), blinkL, blinkR (0 open .. 1 shut), hatch (the battery bay's hatch open,
  // radians), gate (the backpack's tailgate lifted, radians; default 0), lights (its
  // power lights still lit, 0 .. 3; default 3), spin, heel (the fists' and the heel rollers' turn
  // on their axles, radians) }
  pose(st) {
    const root = this.root;
    root.position.set(st.x, st.y, st.z);
    root.rotation.set(0, st.yaw, 0);
    const m = st.m;
    // The frame: grown from nothing inside the car, its pelvis risen from the car's floor.
    const s = grow(m);
    const py = PELVIS_LOW + (PELVIS_REST - PELVIS_LOW) * rise(m) + st.bob;
    const frame = this.frameBones[0];
    frame.position.set(0, py - s * PELVIS_REST, 0);
    frame.scale.setScalar(s);
    const t = st.turns;
    for (let i = 1; i < this.frameBones.length; i++) {
      const b = this.frameBones[i];
      b.rotation.set(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]);
    }
    // Its power lights (one out for each hit it took) and the battery cells (while the hatch is
    // open), shrunk away to nothing when not shown.
    const lights = st.lights === undefined ? 3 : st.lights;
    for (let i = 0; i < LIGHT_AT.length; i++) this.frameBones[LIGHT_AT[i]].scale.setScalar(i < lights ? 1 : 1e-4);
    this.frameBones[BAY_AT].rotation.set(st.hatch, 0, 0);
    this.frameBones[CELLS_AT].scale.setScalar(st.hatch > 0.02 ? 1 : 1e-4);
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    // The pieces: in the car (their pivots, the body lifted), on their way (an arc), or on their
    // bones.
    const bones = this.bones;
    for (let i = 0; i < MOVERS.length; i++) {
      const p = MOVERS[i];
      const pv = this.pivots[p];
      const u = arrive(p, m);
      const lift = ON_WHEELS[i] ? 0 : st.lift;
      _p.set(pv[0], pv[1] + lift, pv[2]);
      _q.copy(ID);
      _s.copy(ONE);
      if (u > 0) {
        _m.multiplyMatrices(_inv, bones[BONE[ATTACH[p][0]]].matrixWorld).multiply(this.attach[p]);
        // (A wheel spinning on its axle: the fists' and the heel rollers'.)
        if (SPINS[i] !== 0) _m.multiply(_t.makeRotationX(SPINS[i] === 1 ? st.spin || 0 : st.heel || 0));
        _m.decompose(_p1, _q1, _s1);
        _p.lerp(_p1, u);
        _p.y += Math.sin(Math.PI * u) * ARC[p];
        _q.slerp(_q1, u);
        _s.lerp(_s1, u);
      }
      bones[PIECE[p]].matrix.compose(_p, _q, _s);
    }
    // The car's soft shadow (the classic look's) on the ground under it, shrinking away as it parts.
    const k = m >= SHADOW_GONE ? 0 : 1 - m / SHADOW_GONE;
    bones[PIECE.shadow].matrix.makeScale(k, 1, k);
    // The followers: the eyes on the head (squashed shut as they blink), the hatch on the tail.
    for (let i = 0; i < FOLLOWERS.length; i++) {
      const p = FOLLOWERS[i];
      const on = LEADERS[i];
      const a = this.pivots[p];
      const o = this.pivots[on];
      _t.makeTranslation(a[0] - o[0], a[1] - o[1], a[2] - o[2]);
      const shut = p === 'eyeL' ? st.blinkL : st.blinkR;
      if (p === 'hatch') _t.multiply(_m.makeRotationX(st.gate || 0));
      else _t.multiply(_m.makeScale(1, shut > 0.92 ? 0.08 : 1 - shut, 1));
      bones[PIECE[p]].matrix.multiplyMatrices(bones[PIECE[on]].matrix, _t);
    }
    root.updateMatrixWorld(true);
  }
}
