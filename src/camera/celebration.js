// Star celebration (cameraConfig CELEBRATE_*): while the hero dances (or drops to dance) the
// orbit swings round to a three-quarter front view and moves in, then swings back to where it
// was once the dance is over (unless the player moves the hero or turns the camera first).
//
// `state` is null or { yaw0, from, delta, t, ticks, dist, returning }: yaw0 the orbit yaw to
// return to, from/delta the swing, dist the close-up distance. `blend` (0..1) is how far the
// framing is into the close-up (distance, pitch, aim): it follows the swing's own smooth curve in
// and back out, so the camera sets off and arrives gently whatever it was framing before (the
// AI RACE look-up's pull-back, say).

import { angleDiff, wrapAngle } from '../core/math.js';
import { smootherstep } from './cinematics.js';
import * as K from './cameraConfig.js';

export class Celebration {
  constructor(collider) {
    this.collider = collider;
    this.state = null;
    this.closeUp = false; // this tick's framing is the dance close-up (not the swing back)
    this.blend = 0; // how far the framing is into the close-up (see top)
    this._look = { x: 0, y: 0, z: 0 };
  }

  reset() {
    this.state = null;
    this.closeUp = false;
    this.blend = 0;
  }

  // The camera buttons wait for the dance...
  get holdsButtons() {
    return !!this.state && !this.state.returning;
  }

  // ...and during the swing back they take over.
  cancel() {
    this.state = null;
  }

  // Advances one tick from the orbit yaw `yaw`; returns the yaw the orbit takes (null while no
  // celebration drives it) and sets `closeUp`.
  update(hero, yaw) {
    const dancing = K.CELEBRATE_ACTION.test(hero.action);
    let cel = this.state;
    this.closeUp = false;
    if (dancing && (!cel || cel.returning)) {
      const yaw0 = cel ? cel.yaw0 : yaw;
      cel = this.state = { yaw0, from: yaw, delta: 0, t: 0, ticks: K.CELEBRATE_TICKS, dist: K.CELEBRATE_DIST, returning: false };
      this._shot(hero, yaw, cel);
    } else if (!dancing && cel && !cel.returning) {
      cel = this.state = { yaw0: cel.yaw0, from: yaw, delta: angleDiff(yaw, cel.yaw0), t: 0, ticks: K.CELEBRATE_RETURN_TICKS, dist: cel.dist, returning: true };
    }
    if (!cel) {
      this.blend = 0;
      return null;
    }
    if (cel.returning && hero.speed >= K.MOVING_SPEED) {
      this.state = null; // the player has taken over
      this.blend = 0;
      return null;
    }
    cel.t = Math.min(cel.t + 1, cel.ticks);
    const k = smootherstep(cel.t / cel.ticks);
    const out = wrapAngle(cel.from + cel.delta * k);
    this.blend = cel.returning ? 1 - k : k;
    if (cel.returning && cel.t >= cel.ticks) this.state = null;
    this.closeUp = !cel.returning;
    return out;
  }

  // Where the celebration looks from (cel.delta, cel.dist): three-quarters to the hero's front
  // on the side nearer the camera (orbit yaw `yaw`), moving in (down to CELEBRATE_MIN_DIST) or
  // turning further round toward a side view when a wall is in the way.
  _shot(hero, yaw, cel) {
    const look = this._look;
    look.x = hero.x;
    look.y = hero.y + K.LOOK_HEIGHT;
    look.z = hero.z;
    const front = hero.faceYaw;
    const first = angleDiff(front, yaw) >= 0 ? 1 : -1;
    let bestYaw = front + first * K.CELEBRATE_SIDES[0];
    let bestDist = -Infinity;
    search: for (const side of K.CELEBRATE_SIDES) {
      for (let s = first; Math.abs(s) === 1; s = s === first ? -first : 0) {
        const a = front + s * side;
        const room = this.collider.room(look, a, K.CELEBRATE_PITCH, K.CELEBRATE_DIST + K.CELEBRATE_PAD);
        const dist = Math.min(K.CELEBRATE_DIST, room - K.CELEBRATE_PAD);
        if (dist > bestDist) {
          bestDist = dist;
          bestYaw = a;
        }
        if (dist >= K.CELEBRATE_MIN_DIST) break search;
      }
    }
    cel.delta = angleDiff(yaw, bestYaw);
    cel.dist = Math.max(K.CELEBRATE_MIN_DIST, bestDist);
  }
}
