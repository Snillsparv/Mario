// Rustmaw's tail grab on camera (objects/RobotBeast.js, player actions/tail.js). While Pip holds
// the tail the view backs off and rises a little behind him, over the roof's parapet; once he
// spins the beast up into its whirl it moves far back and up and looks up past him, so the
// beast whirling round high over the castle shows with him in the picture. Thrown
// ('bossThrown' { flight, to }), the camera chases it along its flight (flightPoint: behind and
// above it, never closer than CLEAR over whatever lies under it) down to the crash, and holds
// on the wreck until it has sunk away and the reward star starts to rise (LINGER); then it hands
// back to the follow camera.
//
// It blends over the orbit's own pose: CameraController keeps running its orbit underneath (as
// in the intro) and calls update() after its tick, so taking over and handing back are smooth
// and the orbit (yaw, distance, collider) is untouched by it.
//
//   const bc = new BossCam(collision, events)
//   bc.update(cam, hero)   30 Hz, after the orbit: blends cam.pos / cam.target / cam.fov
//   bc.reset()             off at once (a cut: respawn, level start)
//   bc.w                   its weight, 0..1 (0: the camera is the orbit's)

import * as THREE from 'three';
import { FOV } from './cameraConfig.js';
import { GRAB, flightPoint } from '../objects/RobotBeast.js';
import { TAIL_RAISE_TICKS } from '../player/physics/tuning.js';

export const BOSS_CAM = {
  // Behind Pip (along the orbit's yaw as it was when he grabbed the tail): distance back,
  // height over his feet, and the point over his feet it looks at; blended from HOLD to SPIN
  // over the haul (TAIL_RAISE_TICKS).
  HOLD: { dist: 1500, up: 760, look: 260, fov: FOV },
  SPIN: { dist: 4300, up: 1500, look: 1750, fov: 62 },
  CHASE_BACK: 3600, // chasing the thrown beast: this far behind it along its flight...
  CHASE_UP: 1900, // ...and this high over it
  CHASE_FOV: 56,
  CLEAR: 450, // at least this far over the ground or roofs under it
  LINGER: GRAB.WRECK_TICKS + 45, // ticks it holds on the wreck (the star starts rising)
  LINGER_WATER: 70,
  IN_RATE: 0.05, // weight easing per tick (in, out)
  OUT_RATE: 0.03,
  EASE: 0.12, // pose easing per tick holding on Pip...
  CHASE_EASE: 0.3, // ...and chasing
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const TAIL_ACTION = /^tail_(hold|spin|throw)$/;

export class BossCam {
  constructor(collision, events = null) {
    this.collision = collision;
    this.w = 0;
    this.fresh = true; // the next pose starts from the orbit's
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.fov = FOV;
    this.goalFov = FOV;
    this.goalPos = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.yaw = 0; // the yaw it views Pip along (the orbit's, when he took hold)
    this.holding = false;
    this.lift = 0; // HOLD -> SPIN
    this.fly = null; // the flight it chases ('bossThrown')
    this.ft = 0; // ticks into it
    this.linger = 0;
    this.to = { x: 0, y: 0, z: 0 };
    this.ux = 0; // the flight's heading (horizontal unit)
    this.uz = 1;
    this.floorAt = -Infinity; // the floor under the chase camera (queried every few ticks)
    this.b = { x: 0, y: 0, z: 0 };
    events?.on?.('bossThrown', (e) => this._thrown(e));
  }

  reset() {
    this.w = 0;
    this.fresh = true;
    this.fly = null;
    this.holding = false;
    this.lift = 0;
  }

  _thrown(e) {
    if (!e?.flight) return;
    this.fly = e.flight;
    this.ft = 0;
    this.linger = e.water ? BOSS_CAM.LINGER_WATER : BOSS_CAM.LINGER;
    this.to.x = e.to.x;
    this.to.y = e.to.y;
    this.to.z = e.to.z;
    const dx = e.to.x - e.flight.x0;
    const dz = e.to.z - e.flight.z0;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.ux = d > 1 ? dx / d : 0;
    this.uz = d > 1 ? dz / d : 1;
    this.floorAt = -Infinity;
  }

  // One tick after the orbit's (cam: the CameraController, hero: its hero record).
  update(cam, hero) {
    const B = BOSS_CAM;
    let goal = 0;
    let ease = B.EASE;
    const b = this.b;
    if (this.fly !== null) {
      const f = this.fly;
      this.ft++;
      if (this.ft > f.T + this.linger) this.fly = null;
      else {
        goal = 1;
        ease = B.CHASE_EASE;
        flightPoint(f, this.ft < f.T ? this.ft : f.T, b);
        const landed = this.ft >= f.T;
        const x = b.x - this.ux * B.CHASE_BACK;
        const z = b.z - this.uz * B.CHASE_BACK;
        if (this.ft % 4 === 1) {
          const fl = this.collision?.findFloor ? this.collision.findFloor(x, 1e5, z) : null;
          this.floorAt = fl && fl.surface ? fl.y : -Infinity;
        }
        let y = (landed ? this.to.y : b.y) + B.CHASE_UP;
        if (y < this.floorAt + B.CLEAR) y = this.floorAt + B.CLEAR;
        this.goalPos.set(x, y, z);
        if (landed) this.goalTarget.set(this.to.x, this.to.y + 300, this.to.z);
        else this.goalTarget.set(b.x, b.y, b.z);
        this.goalFov = B.CHASE_FOV;
      }
    }
    if (this.fly === null) {
      const holding = TAIL_ACTION.test(hero.action);
      if (holding) {
        if (!this.holding) {
          this.yaw = cam.yaw;
          this.lift = 0;
        }
        goal = 1;
        if (hero.action === 'tail_spin') this.lift += 1 / TAIL_RAISE_TICKS;
        else if (hero.action === 'tail_hold') this.lift -= 1 / 20;
        this.lift = this.lift < 0 ? 0 : this.lift > 1 ? 1 : this.lift;
        const k = smooth(this.lift);
        const H = B.HOLD;
        const S = B.SPIN;
        const dist = H.dist + (S.dist - H.dist) * k;
        const up = H.up + (S.up - H.up) * k;
        const look = H.look + (S.look - H.look) * k;
        this.goalPos.set(hero.x + Math.sin(this.yaw) * dist, hero.y + up, hero.z + Math.cos(this.yaw) * dist);
        this.goalTarget.set(hero.x, hero.y + look, hero.z);
        this.goalFov = H.fov + (S.fov - H.fov) * k;
      }
      this.holding = holding;
    }
    // Weight: eased in and out.
    if (goal > this.w) this.w = this.w + B.IN_RATE > 1 ? 1 : this.w + B.IN_RATE;
    else if (goal < this.w) this.w = this.w - B.OUT_RATE < 0 ? 0 : this.w - B.OUT_RATE;
    if (this.w <= 0) {
      this.fresh = true;
      return;
    }
    if (this.fresh) {
      this.pos.copy(cam.pos);
      this.target.copy(cam.target);
      this.fov = cam.fov;
      this.fresh = false;
    }
    if (goal > 0) {
      // (A new flight moves fast: the pose follows it tightly.)
      this.pos.lerp(this.goalPos, ease);
      this.target.lerp(this.goalTarget, ease > 0.2 ? 0.6 : ease * 1.5);
      this.fov += (this.goalFov - this.fov) * ease;
    }
    const k = smooth(this.w);
    cam.pos.lerp(this.pos, k);
    cam.target.lerp(this.target, k);
    cam.fov += (this.fov - cam.fov) * k;
  }
}
