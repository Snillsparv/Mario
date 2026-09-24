// Low cover over a swimmer (the drawbridge deck, see cameraConfig COVER_*): with no room for
// the camera between the water and the deck, it ducks under the surface with the hero and
// looks at the waterline; while the line from the hero's hips to the camera is blocked, the
// orbit turns toward the nearest yaw with a clear view along the water.
//
// State for CameraController: `ticks` (cover lasts while > 0), the eased look-point drop and
// pitch hold (`drop`, `mix`, `cap`) and the yaw the orbit turns to (`goal`). No per-tick garbage.

import { NO_WATER } from '../core/constants.js';
import { angleDiff, clamp } from '../core/math.js';
import * as K from './cameraConfig.js';

export class Cover {
  constructor(collision, collider) {
    this.collision = collision;
    this.collider = collider;
    this._from = { x: 0, y: 0, z: 0 };
    this.ticks = 0;
    this.reset(false);
  }

  // Cover ends (a reset or a respawn), then starts in full if `covered`.
  reset(covered) {
    this.drop = covered ? K.COVER_LOOK_DROP : 0; // the look point sinks this much (eased)...
    this.mix = covered ? 1 : 0; // ...and the orbit pitch is held under the surface this much...
    this.cap = Infinity; // ...at most this pitch (camera COVER_CAM_DEPTH under the water)
    this.goal = null; // yaw the orbit turns to for a clear view under cover
  }

  // Per tick, from the hero's feet p (x, z) and water flag: cover starts under a low ceiling over
  // the swimmer, and lasts while the camera (at camPos) or its line to the swimmer is still under
  // it (the camera comes out from under the deck first). Returns whether the hero is covered.
  track(p, inWater, camPos) {
    if (inWater && (this.lowCover(p.x, p.z) || (this.ticks > 0 && this._behind(p, camPos)))) {
      this.ticks = K.COVER_HOLD;
    } else if (!inWater) this.ticks = 0;
    else if (this.ticks > 0) this.ticks--;
    return this.ticks > 0;
  }

  // Eases the look-point drop and the pitch hold toward (covered ? full : none).
  ease(covered) {
    const c = covered ? 1 : 0;
    this.drop += (c * K.COVER_LOOK_DROP - this.drop) * K.COVER_DROP_RATE;
    this.mix += (c - this.mix) * K.COVER_DROP_RATE;
  }

  // Orbit pitch (from a look point at lookY, dist away) that keeps the camera COVER_CAM_DEPTH
  // under the water at the hero (Infinity when there is none); stored in `cap`.
  updateCap(hero, lookY, dist) {
    const water = this.collision.waterLevelAt(hero.x, hero.z);
    this.cap = water === NO_WATER ? Infinity : Math.atan2(water - K.COVER_CAM_DEPTH - lookY, dist);
    return this.cap;
  }

  // Orbit pitch p with the cover's hold applied.
  pitch(p) {
    return this.mix > 0 ? p + (Math.min(p, this.cap) - p) * this.mix : p;
  }

  // Yaw turn this tick toward a clear view along the water, or null when cover does not steer
  // (the wall slide and the swing behind the hero then run). `yaw` is the orbit yaw, `camPos`
  // the camera, `tweening` a C-button rotation in progress.
  steer(hero, yaw, camPos, tweening) {
    if (!hero.covered || tweening) {
      this.goal = null;
      return null;
    }
    const from = this._from;
    from.x = hero.x;
    from.y = hero.y + K.COVER_SIGHT_HEIGHT;
    from.z = hero.z;
    if (this.goal === null) {
      if (this.collider.lineClear(from, camPos)) return 0;
      const water = this.collision.waterLevelAt(hero.x, hero.z);
      const y = Math.min(camPos.y, (water === NO_WATER ? hero.y : water) - K.COVER_CAM_DEPTH);
      this.goal = this.collider.clearYaw(from, yaw, K.COVER_SIGHT_DIST, y, K.COVER_STEP, K.COVER_MAX_TURN);
      if (this.goal === null) return 0;
    }
    const d = angleDiff(yaw, this.goal);
    if (Math.abs(d) < 0.01) this.goal = null;
    return clamp(d * K.COVER_SWING_GAIN, -K.COVER_SWING_MAX, K.COVER_SWING_MAX);
  }

  // A ceiling less than COVER_GAP above the water surface at (x, z).
  lowCover(x, z) {
    const water = this.collision.waterLevelAt(x, z);
    if (water === NO_WATER) return false;
    return this.collision.findCeil(x, water + 1, z, 0).y < water + K.COVER_GAP;
  }

  // Low cover over the camera at c or three points on its way to the hero at p.
  _behind(p, c) {
    for (let i = 0; i < 4; i++) {
      const k = i / 4;
      if (this.lowCover(c.x + (p.x - c.x) * k, c.z + (p.z - c.z) * k)) return true;
    }
    return false;
  }
}
