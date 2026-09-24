// Winged-hat flight camera (cameraConfig FLY_*). While the hero flies (action 'flying') the
// orbit becomes a flight-follow camera: it swings to straight behind his heading at an eased turn
// rate (fairly quick but smooth, with a touch of lag in a banked turn), trails at FLY_DIST and
// partly follows his flight pitch (RenderState / Player `pitch`, > 0 nose down): looking down on
// him in a dive, level-ish behind him in a climb. CameraController blends every setting between
// the follow camera and this one by `w` (0..1), which eases in over FLY_IN_TICKS at take-off and
// back out over FLY_OUT_TICKS once the flight ends, so the hand-back never pops; its vertical
// framing follows him closely meanwhile (no jump band), and its collider is `tolerant`.
//
// State for CameraController (numbers only: no per-tick garbage).

import { angleDiff, clamp } from '../core/math.js';
import { smootherstep } from './cinematics.js';
import * as K from './cameraConfig.js';

export class FlightCam {
  constructor() {
    this.reset(false, K.ORBIT_MODES.follow.pitch[0], 0);
  }

  // `flying`: the hero is in flight right now (the camera starts as the flight camera);
  // `orbitPitch`: the orbit's pitch; `heroPitch`: his flight pitch.
  reset(flying, orbitPitch, heroPitch) {
    this.flying = flying; // the hero flew last tick
    this.t = flying ? 1 : 0; // blend progress (linear)...
    this.w = flying ? 1 : 0; // ...and the eased weight of the flight camera
    this.pitch = flying ? flightPitch(heroPitch) : orbitPitch; // eased orbit pitch of the flight camera
    this.rate = 0; // eased yaw rate of the swing behind him
  }

  // Advances one tick (before the orbit uses mix / swing). Returns true on take-off.
  update(hero, orbitPitch) {
    const flying = K.FLY_ACTION.test(hero.action);
    const started = flying && !this.flying;
    this.flying = flying;
    this.t = flying ? Math.min(1, this.t + 1 / K.FLY_IN_TICKS) : Math.max(0, this.t - 1 / K.FLY_OUT_TICKS);
    this.w = smootherstep(this.t);
    // The flight pitch starts from the orbit's and follows his while he flies; after the flight it
    // holds while the blend hands back to the follow camera's.
    if (this.w === 0) this.pitch = orbitPitch;
    else if (flying) this.pitch += (flightPitch(hero.pitch) - this.pitch) * K.FLY_PITCH_RATE;
    return started;
  }

  // `normal` blended toward `flight` by the flight camera's weight (exactly `normal` at w = 0).
  mix(normal, flight) {
    return normal + (flight - normal) * this.w;
  }

  // Yaw turn this tick toward straight behind the hero's heading from the orbit yaw `yaw` (an
  // eased rate, weighted by w). Once the flight is over the rate eases out. Past FLY_SWING_KEEP
  // (he turned to face the camera) a swing under way keeps its direction, so it does not dither
  // about which way round to go.
  swing(hero, yaw) {
    if (this.w === 0) {
      this.rate = 0;
      return 0;
    }
    let goal = 0;
    if (this.flying) {
      let d = angleDiff(yaw, hero.faceYaw + Math.PI);
      if (Math.abs(d) > K.FLY_SWING_KEEP && this.rate * d < 0) d -= Math.sign(d) * 2 * Math.PI;
      goal = clamp(d * K.FLY_SWING_GAIN, -K.FLY_SWING_MAX, K.FLY_SWING_MAX);
    }
    this.rate += (goal - this.rate) * K.FLY_SWING_EASE;
    return this.rate * this.w;
  }
}

// Orbit pitch of the flight camera for the hero's flight pitch (> 0 nose down).
function flightPitch(heroPitch) {
  return clamp(K.FLY_PITCH_BASE + (heroPitch || 0) * K.FLY_PITCH_FOLLOW, K.FLY_PITCH_MIN, K.FLY_PITCH_MAX);
}
