// Sparrow Lane's store-room doors, kicked to pieces (the lane's lazy chunk: objects/laneBoss/
// index.js attaches it; docs/ARCHITECTURE.md "The garage doors"). The door wall under the
// carport's roof (layout.GARAGE, drawn and made solid by the game's main chunk: world/lane/
// houses.js carport) has four leaves; any of Jonas's attacks breaks one: the jab cracks it (it
// rattles, a board stays askew), the cross smashes it, anything else smashes it at once. A smashed
// leaf bursts into its five boards (each with its ledges and hardware), which fly away from him,
// tumble, bounce, lie down flat and shrink away in a puff; its collider is parked under the world.
// Behind it: the store room's things (classic: garageRoom.js's mesh, shown once a leaf breaks;
// realistic: the worker's), five coins (layout COINS) and a 1-up over the workbench (its own
// OneUp, shown while a leaf is broken), the room camera (garageCam.js) while he is in the room.
//
//   new LaneGarage({ objects, area, layout })   objects: the lane's ObjectManager (events,
//       sparkles, rng, group, player), area: world/area.js's Area (its parts' `garage` piece
//       tables: five boards a leaf, in order; the named colliders garage_0 .. garage_3; ORIGIN),
//       layout: lane/layout.js
//   garage.update(player, tick)   30 Hz, after the boss (ObjectManager._step)
//   garage.animate(alpha, clock)  per frame: the moving boards of the shown look, between the
//                                 last two ticks (one update range per mesh); the 1-up
//   garage.setLook(part | null)   the realistic part shown (its meshes' rest read once), or null
//   garage.enter(player?)         an arrival or a lost life: every leaf whole (one he is in the
//                                 room for or stands by waits until he is clear: pending), its
//                                 boards home, the room closed
//   garage.reset()                a new game: enter() and the 1-up back
//   garage.inside(x, z, m?)       a point (world) in the room (m in from its sides)
//   garage.in                     his feet in the room this tick (the boss's test)
//   garage.leaves, garage.pieces  (tests) [{ k, hp, broken, pending, askew, ... }], [{ leaf,
//                                 state (0 whole, 1 flying, 2 lying, 3 shrinking, 4 gone), ... }]
//   garage.opened                 a leaf broken since the last arrival or new game
//   garage.camera, garage.gem, garage.roomMesh, garage.boss   the room camera, the 1-up, the
//                                 classic room's mesh, the lane's boss (its fight outside the room
//                                 hides the 1-up)
//
// Numbers (module constants; ticks and lane units): HP a whole leaf's hit points, a jab or a cross
// takes 1 (B, B smashes it), anything else 2 (at once); a leaf takes at most one hit in GAP ticks;
// cracked, it rattles CRACK ticks AMP to and fro (drawn only) and its board nearest the hit stays
// ASKEW radians about its foot (and LEAN out toward him); smashed, its boards fly (the launch in
// _smash), under gravity GRAV, kept in IN or OUT (their middles' boxes, local), rebounding BOUNCE
// off the floor; under REST (or after AIR ticks) one lies down, turning face up FLAT a tick and
// settling EASE a tick, its slide fading SLIDE; LIE ticks later it shrinks away over SHRINK. A
// smashed leaf's collider waits at PARK; a leaf comes back only with him out of the room and
// CLEAR from it. STOMPWATT's slams (bossImpact stomp or land, at least SLAM strong) rattle the
// whole leaves within RANGE, RATTLE ticks, SWAY * strength; the smash kicks the camera SHAKE.
//
// Drawing: the boards live in the lane's own meshes (both looks drew them with the classic
// builders: lane-boards, and lane-render (classic) or lane-paint (realistic) for the hardware), at
// the vertex ranges part.garage records; a moving board's vertices are rewritten from its rest
// copy (p = R (rest - at) s + at + offset, n = R rest_n): no draw call, no program. Only the
// shown look is written each frame; another is brought up to date when it is shown. STOMPWATT
// never breaks a door (its slams only rattle them), and Jonas in the room is out of its reach
// (fight.js reads garage.in).
//
// Allocation: none per tick or frame but event payloads.

import * as THREE from 'three';
import { moveSurfaces } from '../../collision/CollisionWorld.js';
import { OneUp } from '../OneUp.js';
import { TINT } from '../Sparkles.js';
import { FIGHTING } from './fight.js';
import { ROOM } from '../../world/lane/garage.js';
import { classicRoom } from './garageRoom.js';
import { GarageCam } from './garageCam.js';

export const HP = 2;
export const GAP = 8;
export const LIE = 75;
export const SHRINK = 15;
export const CLEAR = 120;
export const PARK = -60000;
const CRACK = 10;
const AMP = 3;
const ASKEW = 0.06;
const LEAN = 2;
const GRAV = 2.2;
const BOUNCE = 0.25;
const REST = 2.5;
const AIR = 40;
const FLAT = 0.3;
const EASE = 0.35;
const SLIDE = 0.6;
const IN = { x0: 1615, x1: 2485, z0: 1945, z1: 2620 };
const OUT = { x0: 1610, x1: 2490, z0: 1770, z1: 1960 };
const SLAM = 0.3;
const RANGE = 700;
const RATTLE = 12;
const SWAY = 4;
const SHAKE = 0.15;
const BOARDS = 5; // (a leaf's pieces, in order in the piece table)
// Splinters by the leaf's tint (dark brown, red, yellow), the vanishing board's puff.
const WOOD = [[0.36, 0.25, 0.18], [0.62, 0.22, 0.16], [0.82, 0.68, 0.36]];
const PUFF = [0.6, 0.55, 0.5];
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

export class LaneGarage {
  constructor({ objects, area, layout }) {
    this.objects = objects;
    this.events = objects.events;
    this.sparkles = objects.sparkles;
    const o = (this.origin = area.objectsLayout.ORIGIN);
    const G = layout.GARAGE;
    const C = layout.CARPORT;
    this.ground = layout.GROUND;
    this.floor = layout.GROUND + o.y;
    // The room's inside (world), less a margin.
    this.room = { x0: C.x0 + 15 + o.x, x1: C.x1 - 15 + o.x, z0: G.wall + G.thick + 15 + o.z, z1: C.z1 - 35 + o.z, top: this.floor + 200 };
    const named = area.objectsLayout.NAMED;
    this.leaves = G.leaves.map((l, k) => ({ k, x0: l.x0 + o.x, x1: l.x1 + o.x, y0: this.floor, y1: G.door + o.y, z0: G.wall + o.z, z1: G.wall + G.thick + o.z, tint: l.tint, hp: HP, gap: 0, broken: false, pending: false, rattle: 0, amp: 0, askew: -1, ...named[`garage_${k}`] }));
    const classic = area.parts.find((p) => p.garage);
    this.half = (G.door - layout.GROUND - 4) / 2; // (half a board: they stand `door` - 4 tall)
    this.pieces = classic.garage.pieces.map((p) => ({
      leaf: p.leaf,
      at: p.at, // its middle (local: the meshes' frame)
      state: 0,
      t: 0,
      box: IN,
      x: 0, // its middle's offset from rest (local), its turn, its scale; last tick's
      y: 0,
      z: 0,
      q: new THREE.Quaternion(),
      s: 1,
      px: 0,
      py: 0,
      pz: 0,
      pq: new THREE.Quaternion(),
      ps: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      w: new THREE.Vector3(), // its spin (radians a tick about each axis)
      flat: new THREE.Quaternion(), // lying: face up along where it points
      v: 0, // its pose's version (a look writes it when it has not seen it)
      live: false, // its pose changed this tick (drawn between the ticks)
    }));
    this.looks = [];
    this.classic = this.shown = this._look(classic);
    this.roomMesh = classicRoom(classic, G, layout.GROUND);
    this.roomMesh.visible = false;
    const g = ROOM.oneUp;
    this.gem = new OneUp({ x: g.x + o.x, y: g.y + o.y, z: g.z + o.z }, this.floor);
    this.gem.mesh.visible = false;
    objects.group?.add(this.gem.mesh);
    this.opened = false;
    this.in = false;
    this.boss = null;
    this.tick = 0;
    this.lastAction = null;
    this.camera = new GarageCam(area.collision, this, { x: ROOM.middle.x + o.x, y: this.floor, z: ROOM.middle.z + o.z });
    this.events.on?.('bossImpact', (e) => this._slam(e));
  }

  // A look's meshes (lane-boards, and lane-render or lane-paint) and each piece's rest vertices
  // in them (a look is only added at rest; the pieces written since come with their versions).
  _look(part) {
    let look = this.looks.find((l) => l.part === part);
    if (look) return look;
    const root = part.object3D;
    const paint = root.getObjectByName('lane-paint') ? 'paint' : 'render';
    look = { part, meshes: [], parts: [], done: new Int32Array(this.pieces.length) };
    part.garage.pieces.forEach((p, i) => {
      for (const { b, start, count } of p.parts) {
        const name = `lane-${b === 'paint' ? paint : b}`;
        let m = look.meshes.findIndex((e) => e.name === name);
        if (m < 0) {
          const { position: pos, normal: nrm } = root.getObjectByName(name).geometry.attributes;
          m = look.meshes.push({ name, pos, nrm, lo: 0, hi: 0 }) - 1;
        }
        const M = look.meshes[m];
        look.parts.push({ i, m, start, count, rp: M.pos.array.slice(start * 3, (start + count) * 3), rn: M.nrm.array.slice(start * 3, (start + count) * 3) });
      }
    });
    this.looks.push(look);
    return look;
  }

  setLook(part) {
    this.shown = part?.garage ? this._look(part) : this.classic;
  }

  inside(x, z, m = 0) {
    const r = this.room;
    return x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;
  }

  update(player, tick) {
    this.tick = tick;
    const p = player.pos;
    this.in = this.inside(p.x, p.z) && p.y < this.room.top;
    // A lost life: the doors come back (as the bins go home).
    if (player.action === 'spawn' && this.lastAction !== 'spawn') this.enter(player);
    this.lastAction = player.action;
    const a = player.getAttack ? player.getAttack() : null;
    for (let k = 0; k < this.leaves.length; k++) {
      const l = this.leaves[k];
      if (l.pending && this._clear(l, p)) this._mend(l);
      if (l.gap > 0) l.gap--;
      if (l.rattle > 0) l.rattle--;
      if (a !== null && !l.broken && l.gap === 0) this._hit(l, a, p);
    }
    for (let i = 0; i < this.pieces.length; i++) this._step(this.pieces[i]);
    this._gem(p);
  }

  // His attack's sphere against a whole leaf's box (as the bins'): a jab or a cross cracks it,
  // anything else (or a cracked leaf) smashes it.
  _hit(l, a, p) {
    const cx = a.x < l.x0 ? l.x0 : a.x > l.x1 ? l.x1 : a.x;
    const cy = a.y < l.y0 ? l.y0 : a.y > l.y1 ? l.y1 : a.y;
    const cz = a.z < l.z0 ? l.z0 : a.z > l.z1 ? l.z1 : a.z;
    const dx = cx - a.x;
    const dy = cy - a.y;
    const dz = cz - a.z;
    if (dx * dx + dy * dy + dz * dz > a.radius * a.radius) return;
    l.gap = GAP;
    l.hp -= a.kind === 'punch1' || a.kind === 'punch2' ? 1 : 2;
    const out = p.z < l.z0 + 10 ? 1 : -1; // (he stands on the drive's side)
    const t0 = this.objects.time;
    if (l.hp <= 0) return this._smash(l, cx, out, t0);
    // Cracked: it rattles, the board nearest the hit stays askew, splinters.
    l.rattle = CRACK;
    l.amp = AMP;
    if (l.askew < 0) {
      const n = Math.floor(((cx - l.x0) * BOARDS) / (l.x1 - l.x0));
      const q = this.pieces[(l.askew = l.k * BOARDS + (n < 0 ? 0 : n > BOARDS - 1 ? BOARDS - 1 : n))];
      q.q.setFromAxisAngle(_v.set(1, 0, 0), -ASKEW * out);
      q.y = this.half * (Math.cos(ASKEW) - 1);
      q.z = -out * (this.half * Math.sin(ASKEW) + LEAN);
      q.v++;
    }
    const pos = { x: cx, y: cy, z: cz };
    this.sparkles.clods(pos, t0, WOOD[l.tint], 5, 0.5);
    this.events.emit('sfx', { name: 'door_crack', pos });
  }

  // Smashed: its collider parked, its boards thrown away from him (`out`: into the room from
  // the drive's side), a crunch, splinters, a little camera kick; the room opens.
  _smash(l, hx, out, t0) {
    l.broken = true;
    l.rattle = 0;
    moveSurfaces(l.surfaces, l.rest, 0, PARK, 0);
    const rng = this.objects.rng;
    for (let i = l.k * BOARDS; i < l.k * BOARDS + BOARDS; i++) {
      const p = this.pieces[i];
      const dx = p.at[0] + this.origin.x - hx;
      const near = 1 - (dx < 0 ? -dx : dx) / 160;
      const n = near > 0 ? near : 0;
      p.state = 1;
      p.t = 0;
      p.box = out > 0 ? IN : OUT;
      p.vx = dx * 0.04 + (rng() - 0.5) * 3;
      p.vy = 4 + rng() * 5 + n * 3;
      p.vz = out * (3 + n * 5 + rng() * 2);
      p.w.set((rng() - 0.5) * 0.25 + 0.15 * out, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.25);
    }
    const pos = { x: (l.x0 + l.x1) / 2, y: (l.y0 + l.y1) / 2, z: l.z0 };
    this.events.emit('sfx', { name: 'door_smash', pos });
    for (let k = 0; k < 3; k++) this.sparkles.clods({ x: pos.x, y: l.y0 + 60 + 90 * k, z: l.z0 - 10 * out }, t0, WOOD[l.tint], 6, 0.9);
    this.events.emit('bossImpact', { pos, strength: SHAKE, kind: 'door' });
    this.opened = this.roomMesh.visible = true;
  }

  // A board's tick: whole (a rattle's sway), flying, lying (turning face up, settling, sliding to
  // a stop), shrinking, gone.
  _step(p) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.pq.copy(p.q);
    p.ps = p.s;
    if (p.state === 0) {
      const l = this.leaves[p.leaf];
      p.x = l.rattle > 0 ? (l.amp * Math.sin(1.9 * l.rattle) * l.rattle) / RATTLE : 0;
    } else if (p.state === 1) this._fly(p);
    else if (p.state < 4) {
      p.t++;
      if (p.state === 2) {
        p.q.slerp(p.flat, FLAT);
        p.y += (this.ground + 6 - p.at[1] - p.y) * EASE;
        p.x += p.vx *= SLIDE;
        p.z += p.vz *= SLIDE;
        if (p.t >= LIE) p.state = 3;
      } else p.s = 1 - (p.t - LIE) / SHRINK;
      if (p.s <= 0) {
        p.s = 0;
        p.state = 4;
        this.sparkles.clods({ x: p.at[0] + p.x + this.origin.x, y: this.floor + 10, z: p.at[2] + p.z + this.origin.z }, this.objects.time, PUFF, 3, 0.4);
      }
    }
    p.live = p.x !== p.px || p.y !== p.py || p.z !== p.pz || p.s !== p.ps || !p.q.equals(p.pq);
    if (p.live) p.v++;
  }

  _fly(p) {
    p.t++;
    p.x += p.vx;
    p.y += p.vy -= GRAV;
    p.z += p.vz;
    // (Off a side of its box it is put back and, moving on out, turned back.)
    const B = p.box;
    const x = p.at[0] + p.x;
    const z = p.at[2] + p.z;
    if (x < B.x0 || x > B.x1) {
      p.x = (x < B.x0 ? B.x0 : B.x1) - p.at[0];
      if (x < B.x0 === p.vx < 0) p.vx *= -0.3;
    }
    if (z < B.z0 || z > B.z1) {
      p.z = (z < B.z0 ? B.z0 : B.z1) - p.at[2];
      if (z < B.z0 === p.vz < 0) p.vz *= -0.3;
    }
    const w = p.w;
    const ang = w.length();
    if (ang > 0) p.q.premultiply(_r.setFromAxisAngle(_v.copy(w).multiplyScalar(1 / ang), ang)).normalize();
    // Its lowest point: its long half turned, and a little for its width.
    const up = _v.set(0, this.half, 0).applyQuaternion(p.q).y;
    const low = p.at[1] + p.y - (up < 0 ? -up : up) - 6;
    if (low <= this.ground && p.vy < 0) {
      p.y += this.ground - low;
      p.vy *= -BOUNCE;
      p.vx *= 0.5;
      p.vz *= 0.5;
      w.multiplyScalar(0.4);
    }
    if ((low <= this.ground && p.vy < REST) || p.t > AIR * 2) {
      // Lying down: face up, along where its length points.
      _v.set(0, 1, 0).applyQuaternion(p.q);
      p.flat.setFromEuler(_e.set(Math.PI / 2, Math.atan2(_v.x, _v.z), 0, 'YXZ'));
      p.state = 2;
      p.t = 0;
    }
  }

  // The 1-up: shown while a leaf is broken (not while STOMPWATT fights him outside the room),
  // taken once a game.
  _gem(p) {
    const g = this.gem;
    g.mesh.visible = g.alive && this.opened && (this.in || this.boss === null || FIGHTING[this.boss.state] !== 1);
    if (!g.mesh.visible) return;
    const t0 = this.objects.time;
    if (this.tick % 9 === 0) this.sparkles.twinkle(g.pos, 60, t0, TINT.life);
    if (!g.touches(p)) return;
    g.collect();
    this.sparkles.burst(g.pos, t0, TINT.life, 10);
    this.events.emit('oneUp', {});
  }

  // STOMPWATT's slams rattle the whole leaves near them (one rattle sound, the nearest's).
  _slam(e) {
    if ((e.kind !== 'stomp' && e.kind !== 'land') || !(e.strength >= SLAM) || !e.pos) return;
    let near = null;
    let best = RANGE * RANGE;
    for (const l of this.leaves) {
      const dx = (l.x0 + l.x1) / 2 - e.pos.x;
      const dz = l.z0 - e.pos.z;
      const d = dx * dx + dz * dz;
      if (l.broken || d > RANGE * RANGE) continue;
      l.rattle = RATTLE;
      l.amp = SWAY * e.strength;
      if (d <= best) {
        best = d;
        near = l;
      }
    }
    if (near) this.events.emit('sfx', { name: 'door_rattle', pos: { x: (near.x0 + near.x1) / 2, y: near.y0 + 150, z: near.z0 }, pitch: 0.8 });
  }

  // Clear of leaf l: out of the room (and its doorways) and CLEAR from its box.
  _clear(l, p) {
    const dx = p.x < l.x0 ? l.x0 - p.x : p.x > l.x1 ? p.x - l.x1 : 0;
    const dz = p.z < l.z0 ? l.z0 - p.z : p.z > l.z1 ? p.z - l.z1 : 0;
    return !this.inside(p.x, p.z, -30) && dx * dx + dz * dz > CLEAR * CLEAR;
  }

  // Leaf l whole again: its hit points, its collider back exactly, its boards home and straight.
  _mend(l) {
    if (l.broken) moveSurfaces(l.surfaces, l.rest, 0, 0, 0);
    Object.assign(l, { hp: HP, gap: 0, rattle: 0, askew: -1, pending: false, broken: false });
    for (let i = l.k * BOARDS; i < l.k * BOARDS + BOARDS; i++) {
      const p = this.pieces[i];
      p.state = p.x = p.y = p.z = p.px = p.py = p.pz = 0;
      p.q.identity();
      p.pq.identity();
      p.s = p.ps = 1;
      p.live = false;
      p.v++;
    }
  }

  // An arrival or a lost life: every leaf whole, but one he is in the room for or standing by
  // (it waits: pending); the room closed again (its things and the 1-up hidden).
  enter(player = this.objects.player) {
    const p = player?.pos;
    for (const l of this.leaves) {
      if (l.broken || l.hp < HP) {
        if (!p || this._clear(l, p)) this._mend(l);
        else l.pending = true;
      }
    }
    this.opened = this.roomMesh.visible = this.leaves.some((l) => l.broken);
    this.gem.mesh.visible = false;
  }

  // A new game: enter() and the 1-up back.
  reset() {
    this.enter();
    this.gem.reset();
    this.gem.mesh.visible = false;
    this.lastAction = null;
    this.camera.reset();
  }

  // The moving boards of the shown look, posed between the last two ticks; each mesh's written
  // range uploaded once.
  animate(alpha = 1, clock = 0) {
    if (this.gem.mesh.visible) this.gem.animate(clock);
    const look = this.shown;
    const pieces = this.pieces;
    const meshes = look.meshes;
    for (let m = 0; m < meshes.length; m++) {
      meshes[m].lo = Infinity;
      meshes[m].hi = -1;
    }
    for (let k = 0; k < look.parts.length; k++) {
      const part = look.parts[k];
      const p = pieces[part.i];
      if (p.live || look.done[part.i] !== p.v) this._write(p, part, meshes[part.m], alpha);
    }
    for (let i = 0; i < pieces.length; i++) look.done[i] = pieces[i].live ? -1 : pieces[i].v;
    for (let m = 0; m < meshes.length; m++) {
      const M = meshes[m];
      if (M.hi < 0) continue;
      M.pos.addUpdateRange(M.lo * 3, (M.hi - M.lo) * 3);
      M.nrm.addUpdateRange(M.lo * 3, (M.hi - M.lo) * 3);
      M.pos.needsUpdate = M.nrm.needsUpdate = true;
    }
  }

  // A piece's part posed between the last two ticks: p = R (rest - at) s + at + offset, n = R n.
  _write(p, part, M, alpha) {
    const s = p.ps + (p.s - p.ps) * alpha;
    const at = p.at;
    const ox = at[0] + p.px + (p.x - p.px) * alpha;
    const oy = at[1] + p.py + (p.y - p.py) * alpha;
    const oz = at[2] + p.pz + (p.z - p.pz) * alpha;
    _q.copy(p.pq).slerp(p.q, alpha);
    const P = M.pos.array;
    const N = M.nrm.array;
    const rp = part.rp;
    const rn = part.rn;
    for (let r = 0, w = part.start * 3; r < part.count * 3; r += 3, w += 3) {
      _v.set((rp[r] - at[0]) * s, (rp[r + 1] - at[1]) * s, (rp[r + 2] - at[2]) * s).applyQuaternion(_q);
      P[w] = _v.x + ox;
      P[w + 1] = _v.y + oy;
      P[w + 2] = _v.z + oz;
      _v.set(rn[r], rn[r + 1], rn[r + 2]).applyQuaternion(_q);
      N[w] = _v.x;
      N[w + 1] = _v.y;
      N[w + 2] = _v.z;
    }
    if (part.start < M.lo) M.lo = part.start;
    if (part.start + part.count > M.hi) M.hi = part.start + part.count;
  }
}
