// Turns a RenderState into a pose: evaluates the current anim's pose function and
// cross-fades from whatever was on screen when the anim changed (or restarted), over the
// anim's blend time. Unknown anims fall back to idle.
//
// Gait anims (walk, run, tiptoe, crawl) get their own phase: the Player's cyclePhase counts
// cycles of its STRIDE, so each increment is converted to distance and divided by the
// gait's stride at the current speed (strides.js). Integrating increments keeps the legs
// continuous when the anim switches between gaits or the stride changes with speed.

import { createPose, resetPose, copyPose, blendPose, wrapFlips } from './pose.js';
import { ANIMS, DEFAULT_BLEND, resolveAnim } from './animations.js';
import { physicsStride } from './physicsLink.js';
import { gaitStride } from './strides.js';

// A cyclePhase change this large in one frame is a reset / teleport, not movement.
const MAX_CYCLE_STEP = 1;
// While the model's stride equals the Player's, the gait phase is nudged toward the
// Player's cyclePhase (at most this many cycles per second) so footstep events fire on
// heel strikes (both sides put a heel strike at every half cycle).
const PHASE_LOCK_RATE = 0.4;
// Attack swells (mitten / boot size, pose.js) grow as authored but never deflate faster than
// this (swell units per second: a 1.8x fist takes >= 0.1 s to shrink back), so a strike cut
// short by a quick-blending anim (a jump out of a punch) shrinks smoothly instead of popping.
// The authored deflations are slower, so they pass unchanged.
const SWELL_DEFLATE_RATE = 8;

const release = (shown, target, step) => Math.max(target, shown - step);

export class Animator {
  constructor() {
    this.pose = createPose(); // output
    this.from = createPose(); // snapshot at the last anim change
    this.target = createPose();
    this.anim = null;
    this.lastAnimTime = 0;
    this.blendTime = 0;
    this.blendDur = 0;
    this.time = 0; // free-running clock (breathing, flutter)
    this.prevCycle = NaN;
    this.gaitPhase = 0;
    this.externalLook = false; // the Player drives headYaw during this anim
    this.swell = { handL: 0, handR: 0, footL: 0, footR: 0 }; // shown attack swells
    this.ctx = { t: 0, ph: 0, stride: 0, spd: 0, vy: 0, time: 0, bank: 0, headYaw: 0, externalLook: false };
  }

  // rs must be sanitized (finite numbers); dt in seconds; bank = lean into turns (radians).
  update(rs, dt, bank = 0) {
    // A head-on wall hit mid-air is shown as a brace against the wall (the Player keeps
    // the wall kick anim on its first frame while it waits for A).
    const name = rs.action === 'air_hit_wall' ? 'wall_brace' : resolveAnim(rs.anim);
    const def = ANIMS[name];
    const restarted = rs.animTime < this.lastAnimTime - 0.05;
    if (name !== this.anim || restarted) {
      copyPose(this.from, this.pose);
      wrapFlips(this.from);
      this.blendTime = 0;
      this.blendDur = this.anim === null ? 0 : (def.blend ?? DEFAULT_BLEND);
      this.anim = name;
      this.externalLook = false;
    }
    this.lastAnimTime = rs.animTime;
    this.time += dt;
    this.blendTime += dt;
    if (Math.abs(rs.headYaw) > 0.01) this.externalLook = true;

    const c = this.ctx;
    const spd = Math.abs(rs.forwardVel);
    c.stride = gaitStride(name, spd);
    c.ph = c.stride ? this.advanceGait(rs.cyclePhase, name, c.stride, dt) : rs.cyclePhase;
    this.prevCycle = rs.cyclePhase;
    c.t = rs.animTime;
    c.spd = spd;
    c.vy = rs.vy;
    c.time = this.time;
    c.bank = bank;
    c.headYaw = rs.headYaw;
    c.externalLook = this.externalLook;
    def.pose(resetPose(this.target), c);

    const k = this.blendDur > 0 ? Math.min(1, this.blendTime / this.blendDur) : 1;
    if (k >= 1) copyPose(this.pose, this.target);
    else blendPose(this.pose, this.from, this.target, k * k * (3 - 2 * k));
    this.releaseSwell(this.pose, dt);
    return this.pose;
  }

  releaseSwell(p, dt) {
    const step = SWELL_DEFLATE_RATE * dt;
    const s = this.swell;
    p.handLSwell = s.handL = release(s.handL, p.handLSwell, step);
    p.handRSwell = s.handR = release(s.handR, p.handRSwell, step);
    p.footLSwell = s.footL = release(s.footL, p.footLSwell, step);
    p.footRSwell = s.footR = release(s.footR, p.footRSwell, step);
  }

  // Advances the gait phase by the distance the Player covered since the last frame.
  advanceGait(cycle, name, stride, dt) {
    const phys = physicsStride(name) || stride;
    const d = cycle - this.prevCycle;
    if (Math.abs(d) < MAX_CYCLE_STEP) this.gaitPhase += (d * phys) / stride;
    else this.gaitPhase = (cycle * phys) / stride; // first frame or a jump: map directly
    if (Math.abs(phys - stride) < 1) {
      const err = cycle - this.gaitPhase;
      const off = err - Math.round(err * 2) / 2; // to the nearest heel strike, (-0.25, 0.25]
      const step = PHASE_LOCK_RATE * dt;
      this.gaitPhase += Math.max(-step, Math.min(step, off));
    }
    return this.gaitPhase;
  }
}
