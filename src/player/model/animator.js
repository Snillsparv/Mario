// Turns a RenderState into a pose: evaluates the current anim's pose function and
// cross-fades from whatever was on screen when the anim changed (or restarted), over the
// anim's blend time. Unknown anims fall back to idle.
//
// Gait anims (walk, run, tiptoe, crawl) get their own phase: the Player's cyclePhase counts
// cycles of its STRIDE, so each increment is converted to distance and divided by the
// gait's stride at the current speed (strides.js). Integrating increments keeps the legs
// continuous when the anim switches between gaits or the stride changes with speed.

import { createPose, resetPose, copyPose, blendPose, wrapFlips } from './pose.js';
import { TAU, wrapAngle } from '../../core/math.js';
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

// Carried switches (an anim's `carryFrom` lists the anims it carries over from): the Player
// moves rs.pos to a new anchor when the anim changes (e.g. from the climbing spot to the pole
// tip for pole_handstand), interpolated over that tick. For the first CARRY_TIME of the new
// anim every move of rs.pos is taken out of the blend's starting pose (so the body stays put
// on screen) and added up in ctx.entryX/Y/Z: where the old anchor is in the new body frame,
// for poses that travel from there. Moves longer than MAX_CARRY are teleports: not carried.
const CARRY_TIME = 0.07;
const MAX_CARRY = 400;

const release = (shown, target, step) => Math.max(target, shown - step);

// Whole-body rotations blend along the shortest arc to the target (blendPose). When a
// spinning target (a somersault) passes half a turn from the start pose mid-blend, that arc
// flips to the other side and the blend would jump by 2*PI*s: the animator counts those
// wraps of (target - start) per channel and adds the turns back, so the blended rotation
// stays continuous (and still ends on an angle equivalent to the target's).
const flipWrap = (d, last) => (Number.isNaN(last) ? 0 : d - last > Math.PI ? -1 : d - last < -Math.PI ? 1 : 0);

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
    // Flip wraps counted during the current blend, and last frame's (target - start) arcs.
    this.turnPitch = this.turnYaw = this.turnRoll = 0;
    this.arcPitch = this.arcYaw = this.arcRoll = NaN;
    this.carrying = false;
    this.lastPos = { x: 0, y: 0, z: 0 };
    this.ctx = {
      t: 0, ph: 0, stride: 0, spd: 0, vy: 0, time: 0, bank: 0, headYaw: 0, externalLook: false,
      entryX: 0, entryY: 0, entryZ: 0,
    };
  }

  // rs must be sanitized (finite numbers); dt in seconds; bank = lean into turns (radians).
  update(rs, dt, bank = 0) {
    // A head-on wall hit mid-air is shown as a brace against the wall (the Player keeps
    // the wall kick anim on its first frame while it waits for A).
    const name = rs.action === 'air_hit_wall' ? 'wall_brace' : resolveAnim(rs.anim);
    const def = ANIMS[name];
    const restarted = rs.animTime < this.lastAnimTime - 0.05;
    const c = this.ctx;
    if (name !== this.anim || restarted) {
      copyPose(this.from, this.pose);
      wrapFlips(this.from);
      this.blendTime = 0;
      // A slow-to-leave anim (blendOut) stretches the blend into whatever follows it.
      const prev = this.anim === null ? null : ANIMS[this.anim];
      this.blendDur = prev ? Math.max(def.blend ?? DEFAULT_BLEND, prev.blendOut ?? 0) : 0;
      this.carrying = !!prev && name !== this.anim && !!def.carryFrom?.includes(this.anim);
      c.entryX = c.entryY = c.entryZ = 0;
      this.turnPitch = this.turnYaw = this.turnRoll = 0;
      this.arcPitch = this.arcYaw = this.arcRoll = NaN;
      this.anim = name;
      this.externalLook = false;
    }
    if (this.carrying && rs.animTime <= CARRY_TIME) this.carry(rs);
    else this.carrying = false;
    this.lastPos.x = rs.pos.x;
    this.lastPos.y = rs.pos.y;
    this.lastPos.z = rs.pos.z;
    this.lastAnimTime = rs.animTime;
    this.time += dt;
    this.blendTime += dt;
    if (Math.abs(rs.headYaw) > 0.01) this.externalLook = true;

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
    else this.blend(k * k * (3 - 2 * k));
    this.releaseSwell(this.pose, dt);
    return this.pose;
  }

  // this.pose = from -> target at s, whole-body rotations kept continuous (flipWrap).
  blend(s) {
    const a = this.from;
    const b = this.target;
    const p = blendPose(this.pose, a, b, s);
    let d = wrapAngle(b.flipPitch - a.flipPitch);
    this.turnPitch += flipWrap(d, this.arcPitch);
    this.arcPitch = d;
    d = wrapAngle(b.flipYaw - a.flipYaw);
    this.turnYaw += flipWrap(d, this.arcYaw);
    this.arcYaw = d;
    d = wrapAngle(b.flipRoll - a.flipRoll);
    this.turnRoll += flipWrap(d, this.arcRoll);
    this.arcRoll = d;
    p.flipPitch += this.turnPitch * TAU * s;
    p.flipYaw += this.turnYaw * TAU * s;
    p.flipRoll += this.turnRoll * TAU * s;
  }

  // Takes this frame's move of rs.pos out of the blend's starting pose and adds it to the
  // entry offset (both in the body frame: yaw undone).
  carry(rs) {
    const dx = this.lastPos.x - rs.pos.x;
    const dy = this.lastPos.y - rs.pos.y;
    const dz = this.lastPos.z - rs.pos.z;
    if (dx * dx + dy * dy + dz * dz > MAX_CARRY * MAX_CARRY) {
      this.carrying = false;
      return;
    }
    const cos = Math.cos(rs.yaw);
    const sin = Math.sin(rs.yaw);
    const bx = cos * dx - sin * dz;
    const bz = sin * dx + cos * dz;
    const c = this.ctx;
    c.entryX += bx;
    c.entryY += dy;
    c.entryZ += bz;
    this.from.rootX += bx;
    this.from.rootY += dy;
    this.from.rootZ += bz;
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
