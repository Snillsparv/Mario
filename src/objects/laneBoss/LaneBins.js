// Sparrow Lane's movable wheelie bins (layout.MOVABLE_BINS: the dad's two by his gable; docs/
// ARCHITECTURE.md "Sparrow Lane"), in the lane's lazy chunk (objects/laneBoss/index.js).
//
//   new LaneBins({ collision, events, layout, meshes })
//       layout: the area's objectsLayout (MOVABLE_BINS: each bin's id, home x, y (its floor), z,
//       size w, d, h and leash, in world coordinates; NAMED: the bins' colliders' surfaces and
//       rest corners; ORIGIN), meshes: the looks' bin meshes (an InstancedMesh each, an instance
//       a bin, in the area's frame)
//   bins.grip                  the grip record the player reads (player.binGrip: actions/bin.js)
//   bins.update(player, tick, cameraYaw)   30 Hz, after the player's tick (ObjectManager._step)
//   bins.animate(alpha)        per frame: the moving bins' instances, between the last two ticks
//   bins.setLook(part)         the realistic part shown (its bin mesh posed too), or null
//   bins.sendHome()            every bin home at once (an arrival, a lost life, a new game)
//   bins.shove(bin, dx, dz, dist) -> moved   STOMPWATT shoving a bin out of its way (fight.js):
//                              it slides SHOVE a tick along (dx, dz) (a unit) for dist where it
//                              may go (stopping short of walls, the other bin and Jonas), with
//                              a clatter; not one he holds
//   bins.reset()               a new game (sendHome)
//   bins.list                  [{ id, x, z, home, held, homing, ... }] (tests)
//
// Their colliders are the static build's boxes (lane/props.js, named bin_0, bin_1), covered over
// their leash (CollisionWorld.cover) and moved in place (moveSurfaces); a held bin's collider is
// parked under the world (it would stop his own pushes) and comes back where the bin stands when
// he lets go. Bins never turn (their boxes only translate); the drawn bin tips toward him while
// he pulls it.
//
// Pushing: Jonas walking into a bin (grounded, walking or slowing, the stick held, his feet
// circle touching its box on its level, facing it within 45 degrees) slides it PUSH a tick along
// the axis of the face he pushes, away from him, where the spot is free: inside its leash, the
// floor under its corners level with its own, clear of walls (the gable, the posts, the hedges,
// the cars, the other bin) and of him. Blocked, it stays and he stands in his push against it.
// Grabbing and pulling: B next to one (actions/bin.js) holds it; after his tick the bin follows
// him at the grip distance along the held face's axis; where it cannot go he is put back at the
// grip distance and the grip says which way is `blocked`.
// Home (never a softlock: the star climb's first step is a bin at home): at once on every
// arrival (objects.enter), on a lost life (the 'spawn' edge) and on a new game (reset); and by
// themselves: left alone HOME_WAIT ticks more than HOME_NEAR from home with Jonas HOME_AWAY away,
// a bin trundles home (x then z, or z then x, whichever is free); still not home HOME_SNAP ticks
// later, it is put home where the camera does not look.
//
// Allocation: none per tick but the collision queries' results (and only while a bin moves:
// idle, no queries at all); none per frame.

import * as THREE from 'three';
import { PLAYER_RADIUS } from '../../core/constants.js';
import { moveSurfaces } from '../../collision/CollisionWorld.js';
import { BIN_HOLD } from '../../player/physics/tuning.js';
import { BINS_TUNING as B } from './tuning.js';

const PUSHERS = { walking: 1, decelerating: 1 };
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _axis = new THREE.Vector3();

export class LaneBins {
  constructor({ collision, events = null, layout, meshes = [] }) {
    this.collision = collision;
    this.events = events;
    this.origin = layout.ORIGIN ?? { x: 0, y: 0, z: 0 };
    this.meshes = meshes.slice(); // the classic look's (and any other always there)
    this.real = null; // the realistic part's bin mesh while it is shown (setLook)
    this.list = layout.MOVABLE_BINS.map((spec, i) => {
      const named = layout.NAMED?.[spec.id];
      if (!named) throw new Error(`LaneBins: no collider named ${spec.id}`);
      const b = {
        i,
        id: spec.id,
        home: { x: spec.x, z: spec.z },
        x: spec.x,
        z: spec.z,
        px: spec.x, // (last tick's: the frames between are drawn between the two)
        pz: spec.z,
        y: spec.y,
        hw: spec.w / 2,
        hd: spec.d / 2,
        h: spec.h,
        leash: spec.leash,
        surfaces: named.surfaces,
        rest: named.rest,
        parked: false,
        held: false,
        idle: 0, // ticks since anything moved it
        homing: 0, // ticks it has been trying to get home
        tip: 0,
        ptip: 0,
        tnx: 0, // the side it tips toward (the held face's normal)
        tnz: 0,
        shoveT: 0, // ticks of a shove left, and its step
        svx: 0,
        svz: 0,
        stale: true, // its instances to be written (a look attached, put home)
        dx: NaN, // where its instances were last written (frames may be skipped)
        dz: NaN,
        dtip: NaN,
      };
      // Its collider may be anywhere in its leash.
      const L = spec.leash;
      collision.cover(b.surfaces, L.x0 - b.hw, L.x1 + b.hw, L.z0 - b.hd, L.z1 + b.hd);
      return b;
    });
    this.grip = { bins: this.list.map((b) => ({ x: b.x, y: b.y, z: b.z, hw: b.hw, hd: b.hd, active: true })), held: -1, nx: 0, nz: 0, blocked: 0, release: false };
    this.lastAction = null;
    this.player = null;
  }

  // ------------------------------------------------------------------ colliders

  _place(b) {
    moveSurfaces(b.surfaces, b.rest, b.x - b.home.x, b.parked ? B.PARK : 0, b.z - b.home.z);
  }

  _park(b, on) {
    if (b.parked === on) return;
    b.parked = on;
    this._place(b);
  }

  // Whether bin b may stand with its middle at (x, z): inside its leash, the floor under its
  // corners level with its own, clear of walls and of Jonas (`player`, or null).
  free(b, x, z, player = null) {
    const L = b.leash;
    if (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1) return false;
    if (player !== null) {
      // His feet circle against its box (at its height).
      const p = player.pos;
      if (p.y < b.y + b.h + 10 && p.y + 150 > b.y) {
        const cx = p.x < x - b.hw ? x - b.hw : p.x > x + b.hw ? x + b.hw : p.x;
        const cz = p.z < z - b.hd ? z - b.hd : p.z > z + b.hd ? z + b.hd : p.z;
        const dx = p.x - cx;
        const dz = p.z - cz;
        if (dx * dx + dz * dz < (PLAYER_RADIUS - 1) * (PLAYER_RADIUS - 1)) return false;
      }
    }
    const was = b.parked;
    if (!was) this._park(b, true);
    let ok = true;
    const col = this.collision;
    for (let k = 0; k < 4 && ok; k++) {
      const cx = x + (k & 1 ? b.hw : -b.hw);
      const cz = z + (k & 2 ? b.hd : -b.hd);
      const f = col.findFloor(cx, b.y + 40, cz);
      if (f.surface === null || Math.abs(f.y - b.y) > B.FLOOR) ok = false;
    }
    // The box as three circles along its longer side, at its foot and under its lid: a wall
    // that pushes one is in the way.
    const alongX = b.hw >= b.hd;
    const r = (alongX ? b.hd : b.hw) + B.FIT;
    const step = alongX ? b.hw - b.hd : b.hd - b.hw;
    for (let k = -1; k <= 1 && ok; k++) {
      const px = alongX ? x + k * step : x;
      const pz = alongX ? z : z + k * step;
      for (let j = 0; j < 2 && ok; j++) {
        const w = col.findWalls(px, b.y + (j === 0 ? 30 : b.h - 20), pz, 0, r);
        if (w.walls.length > 0) ok = false;
      }
    }
    if (!was) this._park(b, false);
    return ok;
  }

  _moveTo(b, x, z) {
    b.x = x;
    b.z = z;
    this._place(b);
    b.idle = 0;
    const g = this.grip.bins[b.i];
    g.x = x;
    g.z = z;
  }

  // ------------------------------------------------------------------ home

  _home(b) {
    b.held = false;
    b.parked = false;
    b.homing = 0;
    b.shoveT = 0;
    b.idle = 0;
    b.tip = b.ptip = 0;
    b.px = b.home.x;
    b.pz = b.home.z;
    this._moveTo(b, b.home.x, b.home.z);
    this.grip.bins[b.i].active = true;
    b.stale = true;
  }

  sendHome() {
    for (const b of this.list) this._home(b);
    const g = this.grip;
    if (g.held >= 0) g.release = true;
    g.held = -1;
    g.blocked = 0;
  }

  reset() {
    this.sendHome();
    this.lastAction = null;
  }

  // Shoved by the robot (fight.js): sliding off along (dx, dz) for `dist`, a clatter; false if
  // he holds it or it is already sliding.
  shove(b, dx, dz, dist) {
    if (b.held || b.shoveT > 0) return false;
    b.shoveT = Math.ceil(dist / B.SHOVE);
    b.svx = dx * B.SHOVE;
    b.svz = dz * B.SHOVE;
    b.homing = 0;
    this.events?.emit('sfx', { name: 'bin_clatter', pos: { x: b.x, y: b.y + 80, z: b.z } });
    return true;
  }

  // A shove under way: a step where the bin may go, else it stops.
  _slide(b, player) {
    b.shoveT--;
    const x = b.x + b.svx;
    const z = b.z + b.svz;
    if (this.free(b, x, z, player)) this._moveTo(b, x, z);
    else b.shoveT = 0;
  }

  // ------------------------------------------------------------------ the tick

  update(player, tick = 0, cameraYaw = null) {
    this.player = player;
    if (player.binGrip !== this.grip) player.binGrip = this.grip;
    const g = this.grip;
    // A lost life: he drops in at his door again, the bins are home.
    if (player.action === 'spawn' && this.lastAction !== 'spawn') this.sendHome();
    this.lastAction = player.action;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      b.px = b.x;
      b.pz = b.z;
      b.ptip = b.tip;
    }
    const holding = player.action === 'bin_hold' && g.held >= 0 && !g.release;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (holding && g.held === i) {
        if (!b.held) {
          b.held = true;
          b.homing = 0;
          this._park(b, true);
        }
        this._follow(player, b);
      } else if (b.held) {
        // Let go: its collider back where it stands.
        b.held = false;
        this._park(b, false);
      }
      if (b.shoveT > 0 && !b.held) this._slide(b, player);
      // The tip: pulled, it tips toward him; else it rolls level again.
      const pull = holding && g.held === i && player.anim === 'bin_pull';
      if (pull) {
        b.tnx = g.nx;
        b.tnz = g.nz;
      }
      const target = pull ? B.TIP : 0;
      if (b.tip < target) b.tip = b.tip + B.TIP_RATE < target ? b.tip + B.TIP_RATE : target;
      else if (b.tip > target) b.tip = b.tip - B.TIP_RATE > target ? b.tip - B.TIP_RATE : target;
    }
    if (!holding) {
      if (g.held >= 0 && player.action !== 'bin_hold') g.held = -1;
      this._push(player);
    }
    g.release = false;
    this._homeByThemselves(player, cameraYaw);
  }

  // The held bin follows him at the grip distance along the held face's axis; where it may not
  // go, he is put back at the grip distance and the grip says which way is blocked.
  _follow(player, b) {
    const g = this.grip;
    const half = g.nx !== 0 ? b.hw : b.hd;
    const reach = BIN_HOLD + half;
    const p = player.pos;
    const tx = g.nx !== 0 ? p.x - g.nx * reach : b.x;
    const tz = g.nz !== 0 ? p.z - g.nz * reach : b.z;
    const dx = tx - b.x;
    const dz = tz - b.z;
    if (dx * dx + dz * dz < 1e-6) return;
    if (this.free(b, tx, tz, null)) {
      this._moveTo(b, tx, tz);
      g.blocked = 0;
      return;
    }
    // (Toward the bin, along -n, is forward.)
    g.blocked = dx * -g.nx + dz * -g.nz > 0 ? 1 : -1;
    const x = g.nx !== 0 ? b.x + g.nx * reach : p.x;
    const z = g.nz !== 0 ? b.z + g.nz * reach : p.z;
    const f = this.collision.findFloor(x, p.y + 30, z);
    p.x = x;
    p.z = z;
    if (f.surface !== null) {
      p.y = f.y;
      player.floor = f;
    }
    player.grounded = true;
  }

  // Jonas walking into a bin pushes it along the face's axis, away from him.
  _push(player) {
    if (!player.grounded || !player.stickHeld || PUSHERS[player.action] !== 1) return;
    const p = player.pos;
    const fx = Math.sin(player.faceYaw);
    const fz = Math.cos(player.faceYaw);
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (b.homing > 0 || Math.abs(p.y - b.y) > B.LEVEL) continue;
      const cx = p.x < b.x - b.hw ? b.x - b.hw : p.x > b.x + b.hw ? b.x + b.hw : p.x;
      const cz = p.z < b.z - b.hd ? b.z - b.hd : p.z > b.z + b.hd ? b.z + b.hd : p.z;
      const dx = cx - p.x;
      const dz = cz - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > PLAYER_RADIUS + B.TOUCH || d < 1e-6) continue;
      if ((dx * fx + dz * fz) / d < B.FACE_COS) continue;
      // The face he pushes: the axis he is further out along.
      const alongX = Math.abs(p.x - b.x) - b.hw > Math.abs(p.z - b.z) - b.hd;
      const sx = alongX ? (p.x < b.x ? B.PUSH : -B.PUSH) : 0;
      const sz = alongX ? 0 : p.z < b.z ? B.PUSH : -B.PUSH;
      if (this.free(b, b.x + sx, b.z + sz, player)) {
        this._moveTo(b, b.x + sx, b.z + sz);
        b.homing = 0;
      }
      return;
    }
  }

  // Left alone (and Jonas far), a bin trundles home; blocked for long, it is put home unseen.
  _homeByThemselves(player, cameraYaw) {
    const p = player.pos;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (b.held) continue;
      const hx = b.home.x - b.x;
      const hz = b.home.z - b.z;
      const off = hx * hx + hz * hz;
      if (off === 0) {
        b.homing = 0;
        continue;
      }
      if (b.homing === 0 && off <= B.HOME_NEAR * B.HOME_NEAR) continue;
      if (b.homing === 0 && ++b.idle < B.HOME_WAIT) continue;
      const ax = b.x - p.x;
      const az = b.z - p.z;
      if (ax * ax + az * az < B.HOME_AWAY * B.HOME_AWAY) {
        // (He came back: it stops where it is, his to move again; it goes on its way once he
        // is far again.)
        if (b.homing > 0) this._arrive(b);
        continue;
      }
      b.homing++;
      this.grip.bins[i].active = false;
      // A step home: along x first, else along z (or the other way round), whichever is free.
      const sx = hx > B.HOME_SPEED ? B.HOME_SPEED : hx < -B.HOME_SPEED ? -B.HOME_SPEED : hx;
      const sz = hz > B.HOME_SPEED ? B.HOME_SPEED : hz < -B.HOME_SPEED ? -B.HOME_SPEED : hz;
      if ((sx !== 0 && this.free(b, b.x + sx, b.z, player) && this._step(b, b.x + sx, b.z)) || (sz !== 0 && this.free(b, b.x, b.z + sz, player) && this._step(b, b.x, b.z + sz))) {
        if (b.x === b.home.x && b.z === b.home.z) this._arrive(b);
        continue;
      }
      // Stuck for long: put home where the camera does not look, if its spot is free.
      if (b.homing >= B.HOME_SNAP && !this._inView(b.x, b.z, p, cameraYaw) && !this._inView(b.home.x, b.home.z, p, cameraYaw) && this.free(b, b.home.x, b.home.z, player)) this._home(b);
      if (b.x === b.home.x && b.z === b.home.z) this._arrive(b);
    }
  }

  _step(b, x, z) {
    this._moveTo(b, x, z);
    return true;
  }

  _arrive(b) {
    b.homing = 0;
    this.grip.bins[b.i].active = true;
  }

  // Whether (x, z) is in the picture: within HOME_VIEW (radians) of the camera's look along the
  // ground from Jonas (an unknown camera sees nothing).
  _inView(x, z, p, yaw) {
    if (yaw === null || !Number.isFinite(yaw)) return false;
    const dx = x - p.x;
    const dz = z - p.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1) return true;
    return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / l > Math.cos(B.HOME_VIEW);
  }

  // ------------------------------------------------------------------ drawing

  setLook(part) {
    this.real = part?.movers?.bins ?? null;
    for (const b of this.list) b.stale = true;
  }

  animate(alpha = 1) {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      const x = b.px + (b.x - b.px) * alpha - this.origin.x;
      const z = b.pz + (b.z - b.pz) * alpha - this.origin.z;
      const tip = b.ptip + (b.tip - b.ptip) * alpha;
      if (!b.stale && x === b.dx && z === b.dz && tip === b.dtip) continue;
      b.dx = x;
      b.dz = z;
      b.dtip = tip;
      const y = b.y - this.origin.y;
      _m.makeTranslation(x, y, z);
      if (tip > 0) {
        // About its foot's edge on the side it tips toward (the axis up x n).
        const half = b.tnx !== 0 ? b.hw : b.hd;
        _axis.set(b.tnz, 0, -b.tnx);
        _m.multiply(_t.makeTranslation(b.tnx * half, 0, b.tnz * half));
        _m.multiply(_t.makeRotationAxis(_axis, tip));
        _m.multiply(_t.makeTranslation(-b.tnx * half, 0, -b.tnz * half));
      }
      for (let k = 0; k < this.meshes.length; k++) this._write(this.meshes[k], i);
      if (this.real !== null) this._write(this.real, i);
      b.stale = false;
    }
  }

  _write(mesh, i) {
    mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
