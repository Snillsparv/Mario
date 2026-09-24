// Keeps a swimmer in view round the island's corners: the moat is a channel, and a camera
// trailing a swimmer round a corner of the island (or left on the bank while he dives) sees the
// island wall or the bank where he is. The sight fan does not react (a side ray still passes the
// corner, and under the surface neither a lift nor a dolly can help), so when the straight line
// from the swimmer's chest to the camera has been blocked for SWIM_HIDDEN_TICKS (while the
// collider is not pulling the camera in front of the blocker), the orbit turns
// toward the nearest yaw (SWIM_STEP steps, up to SWIM_MAX_TURN either way) whose line to a camera
// as far out, at the height it will have there, is clear: in practice along the channel.
// A covered swimmer (cover.js) is left to the cover logic.
//
// State for CameraController (no per-tick garbage): `hidden` ticks and the `goal` yaw.

import { NO_WATER } from '../core/constants.js';
import { angleDiff, clamp } from '../core/math.js';
import * as K from './cameraConfig.js';

const CHEST_HEIGHT = 80;
const MIN_DIST = 450; // the search looks at least this far out

export class SwimSight {
  constructor(collision, collider) {
    this.collision = collision;
    this.collider = collider;
    this._chest = { x: 0, y: 0, z: 0 };
    this.reset();
  }

  reset() {
    this.hidden = 0; // consecutive ticks the chest-to-camera line has been blocked
    this.goal = null; // yaw the orbit turns to...
    this.rate = 0; // ...at this eased rate (radians per tick)
  }

  // Yaw turn this tick, or null when this does not steer (the wall slide and the swing behind
  // the hero then run). `yaw` is the orbit yaw, `camPos` the camera, `tweening` a C-button
  // rotation in progress.
  steer(hero, yaw, camPos, tweening) {
    if (!hero.inWater || hero.covered || tweening) {
      this.reset();
      return null;
    }
    const chest = this._chest;
    chest.x = hero.x;
    chest.y = hero.y + CHEST_HEIGHT;
    chest.z = hero.z;
    // (Not while the collider pulls the camera in front of the blocker: it will see him from
    // there. A lift over the island's rim still leaves a swimmer's chest behind it.)
    this.hidden = this.collider.pullingIn || this.collider.lineClear(chest, camPos) ? 0 : this.hidden + 1;
    // Search once hidden for SWIM_HIDDEN_TICKS, and again every SWIM_HIDDEN_TICKS while it stays
    // hidden (the swimmer moves on: the clear yaw found earlier goes stale).
    if (this.hidden > K.SWIM_HIDDEN_TICKS && (this.goal === null || this.hidden % K.SWIM_HIDDEN_TICKS === 1)) {
      this.goal = this._search(hero, camPos);
      if (this.goal === null) this.hidden = 0; // no turn helps: look again later
    }
    let want = 0;
    if (this.goal !== null) {
      const d = angleDiff(yaw, this.goal);
      if (Math.abs(d) < 0.01) this.goal = null;
      want = clamp(d * K.SWIM_SWING_GAIN, -K.SWIM_SWING_MAX, K.SWIM_SWING_MAX);
    }
    // The turn rate eases in and out (no jerk as a swing starts or ends).
    this.rate += (want - this.rate) * K.SWIM_SWING_EASE;
    if (this.goal === null && Math.abs(this.rate) < 1e-4) {
      this.rate = 0;
      return null;
    }
    return this.rate;
  }

  // Nearest yaw (from the swimmer) to the camera's actual direction whose line from the chest
  // is clear, or null if none (or only that direction itself). The orbit yaw is turned to it
  // outright: walls may have pushed the camera well off its orbit yaw. Tested at the camera's
  // distance and at the height it will have there: a submerged swimmer takes it under the
  // surface wherever there is water.
  _search(hero, camPos) {
    const dx = camPos.x - hero.x;
    const dz = camPos.z - hero.z;
    const dist = Math.max(MIN_DIST, Math.sqrt(dx * dx + dz * dz));
    const at = Math.atan2(dx, dz);
    const water = this.collision.waterLevelAt(hero.x, hero.z);
    const y = hero.submerged && water !== NO_WATER ? Math.min(camPos.y, water - K.COVER_CAM_DEPTH) : camPos.y;
    const clear = this.collider.clearYaw(this._chest, at, dist, y, K.SWIM_STEP, K.SWIM_MAX_TURN);
    return clear === null || Math.abs(angleDiff(at, clear)) < 0.01 ? null : clear;
  }
}
