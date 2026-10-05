// STOMPWATT's camera (LaneBoss.js): its first wake's intro shot, blended over the follow camera's
// own pose as Rustmaw's BossCam is (camera/bossCam.js): CameraController keeps running its orbit
// underneath and calls the overlay after its tick (cam.overlay: main sets it from the current
// area's objects each tick), so taking over and handing back are smooth and the orbit (its yaw,
// its distance, its collider) is untouched.
//
//   const lc = new LaneBossCam()
//   lc.intro(spot, yaw, ticks)   the intro starts: spot the car's middle on the ground (world),
//                                yaw its heading; ticks the intro's length
//   lc.tick()                    30 Hz (LaneBoss.update): the intro's clock
//   lc.update(cam, hero)         30 Hz, after the orbit (CameraController): blends cam.pos,
//                                cam.target, cam.fov
//   lc.reset()                   off at once (a cut: a respawn, an arrival, a new game)
//   lc.w                         its weight, 0 .. 1
//
// The shot (the car's own frame: x across, y up, z ahead of its nose): from the drive's mouth a
// little to its right, looking at the car low (A); as it rises the camera eases up and back to
// take it all in (B), the view a little wider; it holds through the name card, then hands back.

import * as THREE from 'three';

export const INTRO_CAM = {
  A: { at: [-180, 278, 995], look: [0, 138, 0] },
  B: { at: [-220, 540, 1330], look: [0, 410, 0] },
  RISE: [45, 120], // (ticks into the intro: from A to B)
  FOV: 6, // wider than the look's own
  IN: 10, // ticks to blend in, ...
  OUT: 20, // ...and out
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class LaneBossCam {
  constructor() {
    this.w = 0;
    this.t = -1; // ticks into the intro (-1: none)
    this.len = 0;
    this.spot = new THREE.Vector3();
    this.yaw = 0;
    this.fov = 0;
    this.base = null; // the look's own field of view (as the intro started)
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  intro(spot, yaw, ticks) {
    this.spot.set(spot.x, spot.y, spot.z);
    this.yaw = yaw;
    this.t = 0;
    this.len = ticks;
    this.base = null;
  }

  tick() {
    if (this.t >= 0 && ++this.t > this.len) this.t = -1;
  }

  reset() {
    this.w = 0;
    this.t = -1;
  }

  // A point of the car's frame in the world.
  _at(p, out) {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(this.spot.x + p[0] * c + p[2] * s, this.spot.y + p[1], this.spot.z - p[0] * s + p[2] * c);
  }

  update(cam) {
    const C = INTRO_CAM;
    const on = this.t >= 0;
    if (on) this.w = Math.min(1, this.w + 1 / C.IN);
    else this.w = Math.max(0, this.w - 1 / C.OUT);
    if (this.w <= 0) return;
    if (on) {
      this.base ??= cam.fov;
      const k = smooth((this.t - C.RISE[0]) / (C.RISE[1] - C.RISE[0]));
      const a = this._at(C.A.at, _a);
      const b = this._at(C.B.at, _b);
      this.pos.lerpVectors(a, b, k);
      this._at(C.A.look, _a);
      this._at(C.B.look, _b);
      this.target.lerpVectors(_a, _b, k);
      this.fov = this.base + C.FOV * k;
    }
    const w = smooth(this.w);
    cam.pos.lerp(this.pos, w);
    cam.target.lerp(this.target, w);
    cam.fov += (this.fov - cam.fov) * w;
  }
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
