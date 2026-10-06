// The store room's camera (LaneGarage.js: the room behind the garage doors is 880 x 660 and only
// 323 high, too small for the follow camera's 1000-odd distance): while Jonas's feet are in the
// room it sits inside it, on a circle round the room's middle on the far side from him, high
// under the ceiling, looking at his chest; it blends over the follow camera's pose (as
// STOMPWATT's does: CameraController runs the orbit underneath and calls the overlay after its
// tick), or cuts in and out when the straight line between the two poses crosses a wall (the N64
// way into a small room). laneOverlay composes the lane's overlays (the boss's, then this one:
// inside the room it wins).
//
//   const gc = new GarageCam(collision, garage, middle)   middle: the room's middle on its floor
//                                                          (world)
//   gc.update(cam, hero)   30 Hz, after the orbit: blends cam.pos, cam.target, cam.fov (cam.cut
//                          on a cut; cut out, the orbit set on the drive's side of him, its
//                          collider reset); C-left/right (the orbit's own turn) turn its circle
//   gc.reset()             off at once (a respawn, an arrival, a new game)
//   gc.w, gc.pos, gc.target   its weight (0 .. 1), its pose
//   gc.moveYaw             the stick's frame while it is held through the room camera's cuts and
//                          swings (latched as it is pushed from rest; null let go): main moves
//                          Jonas by it (cam.overlay.moveYaw), else by the camera's yaw
//   laneOverlay(...cams) -> { update(cam, hero), reset(), moveYaw }   the overlays run in order
//
// Numbers (module constants): R the circle's radius round the middle, Y its height over the floor
// (45 under the slab, 60 over the props' colliders), BOX its reach from the middle in x and z
// (inside the linings, in front of the bench and the shelves), TURN the most it turns toward its goal a tick, HOLD within this of the middle it holds
// its angle, LOOK his chest over his feet, FOV wider than the look's, IN and OUT ticks to blend,
// KEEP once in, his feet this far out of the room (into a doorway) still count as in.

import * as THREE from 'three';
import { smooth, wrap } from './rig.js';

const R = 330;
const Y = 278;
const BOX = { x0: -330, x1: 330, z0: -290, z1: 240 };
const TURN = 0.09;
const HOLD = 140;
const LOOK = 110;
const FOV = 6;
const IN = 6;
const OUT = 8;
const KEEP = 40;
const _d = new THREE.Vector3();

export class GarageCam {
  constructor(collision, garage, middle) {
    this.collision = collision;
    this.garage = garage;
    this.middle = middle;
    this.w = 0;
    this.on = false;
    this.angle = 0;
    this.yaw = NaN; // the orbit's yaw last tick (its C-button turns turn the circle)
    this.fov = 0;
    this.moveYaw = null; // the stick's frame while held through the room camera (else null)
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  reset() {
    this.w = 0;
    this.on = false;
    this.yaw = NaN;
    this.moveYaw = null;
  }

  // Its pose for him at `hero` (feet): on the circle, clamped into the room, at his chest.
  _pose(hero, cam) {
    const m = this.middle;
    const dx = m.x - hero.x;
    const dz = m.z - hero.z;
    // (The far side of the middle from him, held near the middle; turned by the C buttons.)
    if (dx * dx + dz * dz > HOLD * HOLD) {
      const d = wrap(Math.atan2(dx, dz) - this.angle);
      this.angle += d > TURN ? TURN : d < -TURN ? -TURN : d;
    }
    if (cam.tween && this.yaw === this.yaw) this.angle += wrap(cam.yaw - this.yaw);
    const x = R * Math.sin(this.angle);
    const z = R * Math.cos(this.angle);
    this.pos.set(m.x + (x < BOX.x0 ? BOX.x0 : x > BOX.x1 ? BOX.x1 : x), m.y + Y, m.z + (z < BOX.z0 ? BOX.z0 : z > BOX.z1 ? BOX.z1 : z));
    this.target.set(hero.x, hero.y + LOOK, hero.z);
  }

  // Whether the line between the orbit's pose and the room's crosses a wall.
  _blocked(cam) {
    const len = _d.subVectors(this.pos, cam.pos).length();
    return len > 1 && this.collision.raycast(cam.pos, _d.multiplyScalar(1 / len), len, { floors: false }) !== null;
  }

  update(cam, hero) {
    const g = this.garage;
    // In the room (his feet; once in, a little out into the doorway still counts).
    const inside = hero !== null && hero.y < g.room.top && g.inside(hero.x, hero.z, this.on ? -KEEP : 0);
    // The stick's frame: latched as it is pushed from rest in the room (or held through a hand
    // over in or out), kept while it stays held, so the camera's cuts and swings never turn him
    // round (a held stick walking in keeps walking in); let go, the camera's own again.
    const input = g.objects.player?.input;
    if (!input || input.stickMag < 0.1) this.moveYaw = null;
    else if (this.moveYaw === null && (inside || this.on)) this.moveYaw = cam.getYaw();
    if (inside && !this.on) {
      this.angle = Math.atan2(this.middle.x - hero.x, this.middle.z - hero.z);
      this.fov = cam.fov + FOV;
    }
    if (inside || this.w > 0) this._pose(hero ?? this.target, cam);
    if (inside) {
      if (this.w === 0 && this._blocked(cam)) {
        this.w = 1;
        cam.cut = true;
      } else this.w = Math.min(1, this.w + 1 / IN);
    } else if (this.on && this._blocked(cam)) {
      // Out, a wall between: a cut back to the follow camera, set on the drive's side of him.
      this.w = 0;
      cam.cut = true;
      cam._setOrbitYaw?.(Math.PI);
      cam.collider?.reset();
    } else if (this.w > 0) this.w = Math.max(0, this.w - 1 / OUT);
    this.on = inside;
    this.yaw = cam.yaw;
    if (this.w <= 0) return;
    const w = smooth(this.w);
    cam.pos.lerp(this.pos, w);
    cam.target.lerp(this.target, w);
    cam.fov += (this.fov - cam.fov) * w;
  }
}

// The lane's camera overlay: each of `cams` (null ones skipped) in order; moveYaw: the first's
// stick frame that holds one (main moves him by it, else by the camera's yaw).
export function laneOverlay(...cams) {
  const list = cams.filter(Boolean);
  return {
    list,
    get moveYaw() {
      for (let i = 0; i < list.length; i++) if (list[i].moveYaw != null) return list[i].moveYaw;
      return null;
    },
    update(cam, hero) {
      for (let i = 0; i < list.length; i++) list[i].update(cam, hero);
    },
    reset() {
      for (let i = 0; i < list.length; i++) list[i].reset();
    },
  };
}
