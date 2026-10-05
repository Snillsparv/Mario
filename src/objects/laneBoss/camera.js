// STOMPWATT's camera (LaneBoss.js): its first wake's intro shot and the fight's framing, blended
// over the follow camera's own pose as Rustmaw's BossCam is (camera/bossCam.js): CameraController
// keeps running its orbit underneath and calls the overlay after its tick (cam.overlay: main sets
// it from the current area's objects each tick), so taking over and handing back are smooth and
// the orbit (its distance, its collider) is untouched; only the window's and the defeat's nudge
// turns its yaw a little each tick, as the pole swing does (yielding to the C buttons).
//
//   const lc = new LaneBossCam(collision?)
//   lc.intro(spot, yaw, ticks)   the intro starts: spot the car's middle on the ground (world),
//                                yaw its heading; ticks the intro's length
//   lc.fight(on, x, z, mode)     30 Hz (LaneBoss.update): the robot up and fighting at (x, z);
//                                mode 1 the fight's framing (the look point raised, the camera
//                                further back, the orbit nudged round to look at it past him),
//                                2 the charging window (turning faster: past him at its back), 3
//                                its defeat (the same, toward the car)
//   lc.tick()                    30 Hz (LaneBoss.update): the intro's clock
//   lc.update(cam, hero)         30 Hz, after the orbit (CameraController): blends cam.pos,
//                                cam.target, cam.fov (and nudges cam.yaw)
//   lc.reset()                   off at once (a cut: a respawn, an arrival, a new game)
//   lc.w, lc.fw                  the intro's and the fight framing's weights, 0 .. 1
//
// The intro (the car's own frame: x across, y up, z ahead of its nose): from the drive's mouth a
// little to its right, looking at the car low (A); as it rises the camera eases up and back to
// take it all in (B), the view a little wider; it holds through the name card, then hands back.
// The fight's framing (FIGHT_CAM): weight 0.6 while it is up and within FAR of him, the look point
// RAISE higher and the camera BACK further (a ray keeps it out of walls), easing in and out; the
// orbit nudged round (NUDGE a tick; TURN in the window and the defeat) to look from behind him at
// the robot while it is more than NEAR off (the C buttons win).

import * as THREE from 'three';

export const INTRO_CAM = {
  A: { at: [-180, 278, 995], look: [0, 138, 0] },
  B: { at: [-220, 540, 1330], look: [0, 410, 0] },
  RISE: [45, 120], // (ticks into the intro: from A to B)
  FOV: 6, // wider than the look's own
  IN: 10, // ticks to blend in, ...
  OUT: 20, // ...and out
};
export const FIGHT_CAM = { W: 0.6, RAISE: 90, BACK: 250, FAR: 1300, EASE: 0.06, TURN: 0.035, NUDGE: 0.012, NEAR: 250, CLEAR: 30 };

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class LaneBossCam {
  constructor(collision = null) {
    this.collision = collision;
    this.fw = 0; // the fight framing's weight
    this.on = false;
    this.mode = 0;
    this.rx = 0;
    this.rz = 0;
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

  fight(on, x = 0, z = 0, mode = 1) {
    this.on = on;
    this.rx = x;
    this.rz = z;
    this.mode = on ? mode : 0;
  }

  reset() {
    this.w = 0;
    this.t = -1;
    this.fw = 0;
  }

  // The fight's framing: the look point raised and the camera further back (as far as a ray
  // from the look point lets it), weighted in and out; in the window and the defeat, the orbit
  // turned (a little a tick) to look past him at the robot.
  _fight(cam, hero) {
    const K = FIGHT_CAM;
    let goal = 0;
    if (this.on && hero) {
      const dx = this.rx - hero.x;
      const dz = this.rz - hero.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < K.FAR * K.FAR) goal = K.W;
      // (Looking from behind him at the robot: gently in the fight, firmly in the window and
      // the defeat; the C buttons win.)
      const turn = this.mode >= 2 ? K.TURN : K.NUDGE;
      if (goal > 0 && !cam.tween && Number.isFinite(cam.yaw) && d2 > K.NEAR * K.NEAR) {
        const want = Math.atan2(-dx, -dz);
        let d = want - cam.yaw;
        d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
        cam.yaw += d > turn ? turn : d < -turn ? -turn : d;
      }
    }
    this.fw += (goal - this.fw) * K.EASE;
    if (this.fw < 0.002) {
      this.fw = goal > 0 ? this.fw : 0;
      if (this.fw === 0) return;
    }
    const w = this.fw;
    _d.subVectors(cam.pos, cam.target);
    cam.target.y += K.RAISE * w;
    const len = _d.length();
    if (len < 1) return;
    _d.multiplyScalar(1 / len);
    let want = len + K.BACK * w;
    const hit = this.collision?.raycast(cam.target, _d, want + K.CLEAR);
    if (hit && hit.distance - K.CLEAR < want) want = hit.distance - K.CLEAR > len ? hit.distance - K.CLEAR : len;
    cam.pos.copy(cam.target).addScaledVector(_d, want);
  }

  // A point of the car's frame in the world.
  _at(p, out) {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(this.spot.x + p[0] * c + p[2] * s, this.spot.y + p[1], this.spot.z - p[0] * s + p[2] * c);
  }

  update(cam, hero = null) {
    this._fight(cam, hero);
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
const _d = new THREE.Vector3();
