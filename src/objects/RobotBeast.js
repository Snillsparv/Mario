// The Rustmaw: the original giant mechanical lizard that climbs onto the castle roof in AI RACE
// mode (geometry and look in robotBeastModel.js). When the mode turns on it heaves itself up out
// of the front hall head first, slaps its front claws down on the roof one after the other and
// roars; then it lies sprawled along the ridge, breathing, swaying its tail and bobbing its
// head, tracks the hero with its neck and head, roars now and then (rearing up, jaw wide,
// claws raised, tail thrashing), and every few seconds draws its head back with the jaw open
// and the throat and dewlap glowing, then lunges and spits a fireball on a ballistic arc at
// where the hero is heading. When the mode turns off it rears back and sinks into the castle
// and is hidden (no draw calls). It has no colliders.
//
//   new RobotBeast({ anchor: layout.KAIJU, collision, events, fire, rng, launch })
//   setMode(on)          start rising / sinking
//   update(player, tick) 30 Hz: state machine, tracking, attacks (launch(x, y, z, vx, vy, vz))
//   animate(alpha, clock) render: interpolated pose, glows
//   reset()              hidden at once
//
// Placement: layout.KAIJU marks the keep; the beast's front feet stand STANCE_FORWARD in front
// of it, on the front hall's gable roof (their height found by raycasting down at the feet),
// the body along the ridge, the head out over the front facade toward the courtyard.
//
// Pose: the tick writes a few animation channels (CH) and the render interpolates them; idle
// breathing, head bob and the tail's sway are functions of the clock. Events: 'sfx' kaiju_roar,
// fireball_charge, fireball_launch (with pos), and 'kaijuRoar' { pos } when it roars.

import * as THREE from 'three';
import { TAU, wrapAngle } from '../core/math.js';
import { FRAME_DT } from '../core/constants.js';
import { buildBeastGeometries, makeBeastMaterial, RIG, headPivot } from './robotBeastModel.js';
import { FIRE } from './aiRaceTextures.js';
import { RAMP, TINTS } from './FireSprites.js';

export const BEAST = {
  SCALE: 1,
  STANCE_FORWARD: 1200, // the front feet stand this far in front of layout.KAIJU (the keep)
  HIDDEN_DEPTH: 3000, // below its standing height when hidden inside the castle
  RISE_TICKS: 100, // ~3.3 s: up head first, then down onto the roof, claw by claw
  SINK_TICKS: 75,
  ROAR_AT: 78, // rise tick the roar starts (after the claws land)
  ROAR_TICKS: 72,
  CHARGE_TICKS: 33, // ~1.1 s of glowing throat before the shot
  RECOVER_TICKS: 15,
  FIRST_SHOT: 60, // ticks after the rise's roar before the first shot
  PERIOD: [75, 120], // ticks from one charge to the next (2.5..4 s)
  ROAR_EVERY: [360, 600], // ticks between idle roars (12..20 s)
  RANGE: 11000, // horizontal reach of its shots
  MIN_RANGE: 500,
  FOV: 1.8, // it only attacks within this yaw of its facing (radians either side)
  GRACE: 75, // ticks after the hero (re)spawns before it shoots at him
  TURN: 0.05, // max tracking change per tick (radians)
  TRACK_FROM: [1420, 1150], // where it looks from: forward of and above its front feet
  CROUCH_PITCH: 0.95, // while crouched (rising, sinking) the body rears up this far...
  CROUCH_NECK: 0.4, // ...the neck and head bend up with it (the snout points at the sky)...
  CROUCH_HEAD: 0.2,
  ARM_TUCK: 0.7, // ...and the front legs fold back along the chest
  HEAD_SCALE: 1.3, // head and jaw, relative to the rest of the rig
  GLOW_PUSH: 110, // glow sprites sit this far toward the camera from their landmark
};

// Fireball ballistics (units, ticks): gravity per tick^2, flight time from horizontal range.
// A fast, fairly flat spit rather than a high lob: from behind the hero the arc must stay in
// the picture, since the beast shoots toward the camera.
export const SHOT = {
  GRAVITY: 0.9,
  T_MIN: 40,
  T_MAX: 72,
  T_BASE: 24,
  T_PER_UNIT: 1 / 150,
  LEAD: 1, // fraction of the hero's (smoothed) velocity extrapolated over the flight
  // Gaussian aim error (units, per axis): with a perfect prediction (a hero standing still or
  // running straight on) about 55 % of the shots land within 250 of him.
  SPREAD: 195,
  VEL_SMOOTH: 0.15, // the hero's velocity is an average of his recent motion (per-tick blend)
};

// Animation channels (the tick writes CUR, the render lerps from PREV).
const CH = {
  RISE: 0,
  CROUCH: 1,
  TWIST: 2,
  LEAN: 3,
  NECK_YAW: 4,
  NECK_PITCH: 5,
  HEAD_PITCH: 6,
  JAW: 7,
  ARMS: 8,
  CHARGE: 9,
  LUNGE: 10,
  POWER: 11,
  SHAKE: 12,
  HEAD_YAW: 13,
  GRAB: 14, // 0..1 through the rise's claw-over-claw landing (1: feet planted)
  TAIL: 15, // tail thrash
};
const N_CH = 16;

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);

// Flight time (ticks) for a shot covering `dist` horizontally.
export function flightTicks(dist) {
  const t = Math.round(SHOT.T_BASE + dist * SHOT.T_PER_UNIT);
  return t < SHOT.T_MIN ? SHOT.T_MIN : t > SHOT.T_MAX ? SHOT.T_MAX : t;
}

// Initial velocity (units/tick) so a ball stepped as `v.y -= g; p += v` from `from` reaches
// `to` after exactly T ticks. Writes into `out`.
export function aimVelocity(from, to, T, out, g = SHOT.GRAVITY) {
  out.x = (to.x - from.x) / T;
  out.z = (to.z - from.z) / T;
  out.y = (to.y - from.y + (g * T * (T + 1)) / 2) / T;
  return out;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _aim = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class RobotBeast {
  constructor({ anchor, collision, events, fire, rng, launch }) {
    this.events = events;
    this.collision = collision;
    this.fire = fire; // FireSprites (glows, sparks)
    this.rng = rng;
    this.launch = launch; // (x, y, z, vx, vy, vz) -> fires a ball
    this.yaw = anchor.yaw ?? 0;
    const S = BEAST.SCALE;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.x = anchor.x + fx * BEAST.STANCE_FORWARD;
    this.z = anchor.z + fz * BEAST.STANCE_FORWARD;
    this.baseY = this._findStanceHeight(S);

    this.material = makeBeastMaterial();
    this.uniforms = this.material.userData.uniforms;
    this._buildRig(S);

    this.cur = new Float32Array(N_CH);
    this.prev = new Float32Array(N_CH);
    this.draw = new Float32Array(N_CH);
    this.state = 'hidden'; // 'hidden' | 'rising' | 'active' | 'sinking'
    this.mode = 'idle'; // while active: 'idle' | 'charge' | 'recover'
    this.t = 0; // ticks in the current state
    this.modeT = 0; // ticks in the current mode
    this.roarT = -1; // ticks into a roar (-1: not roaring)
    this.fromRise = 0; // RISE channel value a rise / sink started from
    this.attackIn = 0;
    this.roarIn = 0;
    this.grace = 0;
    this.shots = 0;
    this.target = null; // aim point of the last shot { x, y, z, T }
    this.seen = { x: 0, z: 0, vx: 0, vz: 0, valid: false }; // the hero's smoothed motion
    this.flashAt = -10;
    this.flashStrength = 0;
    this.lastClock = 0;
    this.clockNow = 0; // simulation seconds of the latest tick
    this._hide();
  }

  // Height to stand at: the lower of the roof heights under the two front feet.
  _findStanceHeight(S) {
    const col = this.collision;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    let y = Infinity;
    for (const side of [-1, 1]) {
      const lx = RIG.FOOT_F[0] * side * S;
      const lz = RIG.FOOT_F[2] * S;
      const x = this.x + lx * c + lz * s;
      const z = this.z - lx * s + lz * c;
      const hit = col.raycast ? col.raycast({ x, y: 30000, z }, { x: 0, y: -1, z: 0 }, 40000) : null;
      const h = hit ? hit.point.y : col.findFloor(x, 1e5, z).y;
      if (h < y) y = h;
    }
    return Number.isFinite(y) && y > -5000 ? y : 0;
  }

  _buildRig(S) {
    const geo = buildBeastGeometries();
    const mat = this.material;
    const mesh = (g, name, pos) => {
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      if (pos) m.position.set(pos[0], pos[1], pos[2]);
      return m; // rigid parts: their bounding spheres stay valid, so off-screen parts are culled
    };
    const W = RIG.WAIST;
    const H = headPivot();
    const shoulderL = [-RIG.SHOULDER[0], RIG.SHOULDER[1], RIG.SHOULDER[2]];
    this.root = new THREE.Group();
    this.root.name = 'robotBeast';
    this.root.scale.setScalar(S);
    this.root.rotation.y = this.yaw;
    this.root.position.set(this.x, this.baseY, this.z);
    this.hips = mesh(geo.hips, 'beastHips');
    this.torso = mesh(geo.torso, 'beastTorso', W);
    this.neck = mesh(geo.neck, 'beastNeck', sub3(RIG.NECK, W));
    this.neck.rotation.order = 'YXZ';
    this.head = mesh(geo.head, 'beastHead', sub3(H, RIG.NECK));
    this.head.rotation.order = 'YXZ';
    this.head.scale.setScalar(BEAST.HEAD_SCALE);
    this.headBase = this.head.position.clone();
    this.jaw = mesh(geo.jaw, 'beastJaw', RIG.JAW);
    this.armL = mesh(geo.armL, 'beastArmL', sub3(shoulderL, W));
    this.armR = mesh(geo.armR, 'beastArmR', sub3(RIG.SHOULDER, W));
    this.tailA = mesh(geo.tailA, 'beastTailA', RIG.TAIL_A[0]);
    this.tailB = mesh(geo.tailB, 'beastTailB', sub3(RIG.TAIL_B[0], RIG.TAIL_A[0]));
    this.mouth = new THREE.Object3D();
    this.mouth.position.set(RIG.MOUTH[0], RIG.MOUTH[1], RIG.MOUTH[2]);
    this.head.add(this.jaw, this.mouth);
    this.neck.add(this.head);
    this.torso.add(this.neck, this.armL, this.armR);
    this.tailA.add(this.tailB);
    this.root.add(this.hips, this.torso, this.tailA);
    this.mesh = this.root;
    this.parts = [this.hips, this.torso, this.neck, this.head, this.jaw, this.armL, this.armR, this.tailA, this.tailB];
    // Landmarks for glows and sparks, in their parts' local space.
    const v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    this.marks = {
      eyes: RIG.EYES.map((p) => [this.head, v([p[0] * 1.14, p[1], p[2] + 8])]),
      throat: [this.head, v(RIG.THROAT)],
      dewlap: [this.jaw, v(sub3(RIG.DEWLAP, RIG.JAW))],
      core: [this.torso, v(sub3(RIG.CORE, sub3(W, [0, 0, 40])))],
      vents: RIG.VENTS.map((p, i) => (i < 2 ? [this.torso, v(sub3(p, W))] : [this.hips, v(p)])),
    };
  }

  get visible() {
    return this.state !== 'hidden';
  }

  // World position of a landmark [part, localVector] into `out` (matrices must be current).
  _mark(mark, out) {
    return out.copy(mark[1]).applyMatrix4(mark[0].matrixWorld);
  }

  // A landmark's glow position: pulled toward the camera so the plates around it do not clip
  // the sprite.
  _glowAt(mark, out) {
    this._mark(mark, out);
    const cam = this.camera;
    if (!cam) return out;
    _d.copy(cam.position).sub(out);
    const len = _d.length();
    if (len > BEAST.GLOW_PUSH * 2) out.addScaledVector(_d, BEAST.GLOW_PUSH / len);
    return out;
  }

  _hide() {
    this.state = 'hidden';
    this.root.visible = false;
    this.cur.fill(0);
    this.cur[CH.RISE] = -BEAST.HIDDEN_DEPTH;
    this.cur[CH.CROUCH] = 1;
    this.prev.set(this.cur);
    this.roarT = -1;
    this.mode = 'idle';
    this.target = null;
    if (this.seen) this.seen.valid = false;
  }

  reset() {
    this._hide();
    this.shots = 0;
  }

  // The mode switched on (rise) or off (sink), continuing from the current height.
  setMode(on) {
    if (on && (this.state === 'hidden' || this.state === 'sinking')) {
      if (this.state === 'hidden') {
        this.cur[CH.RISE] = -BEAST.HIDDEN_DEPTH;
        this.cur[CH.CROUCH] = 1;
        this.cur[CH.GRAB] = 0;
        this.prev.set(this.cur);
      }
      this.state = 'rising';
      this.fromRise = this.cur[CH.RISE];
      this.t = 0;
      this.root.visible = true;
      this.roarT = -1;
      this.mode = 'idle';
    } else if (!on && (this.state === 'rising' || this.state === 'active')) {
      this.state = 'sinking';
      this.fromRise = this.cur[CH.RISE];
      this.t = 0;
      this.mode = 'idle';
      this.target = null;
    }
  }

  // Lightning brightens the plates for a moment (render clock).
  flash(strength) {
    this.flashAt = this.lastClock;
    this.flashStrength = strength > 1 ? 1 : strength;
  }

  _roar() {
    this.roarT = 0;
    const pos = this.mouthPos();
    this.events.emit('sfx', { name: 'kaiju_roar', pos });
    this.events.emit('kaijuRoar', { pos });
  }

  // World position of the mouth for the current tick's pose (a fresh object).
  mouthPos() {
    this._pose(this.cur, this.clockNow);
    this.root.updateMatrixWorld(true);
    this.mouth.getWorldPosition(_v);
    return { x: _v.x, y: _v.y, z: _v.z };
  }

  // Can it shoot at the hero from here? (in range, in front of it, not dying or dropping in)
  _canTarget(player) {
    const a = player.action;
    if (a === 'spawn' || a === 'death') {
      this.grace = BEAST.GRACE;
      return false;
    }
    if (this.grace > 0) return false;
    const dx = player.pos.x - this.x;
    const dz = player.pos.z - this.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > BEAST.RANGE * BEAST.RANGE || d2 < BEAST.MIN_RANGE * BEAST.MIN_RANGE) return false;
    const rel = wrapAngle(Math.atan2(dx, dz) - this.yaw);
    return rel < BEAST.FOV && rel > -BEAST.FOV;
  }

  update(player, tick) {
    if (this.state === 'hidden') return;
    this.prev.set(this.cur);
    this.clockNow = tick * FRAME_DT;
    this.t++;
    if (this.grace > 0) this.grace--;
    const P = this.cur;
    const B = BEAST;
    const pos = player.pos;
    this._watch(pos);

    // Tracking targets: yaw and pitch from the head toward the hero's chest.
    const hx = this.x + Math.sin(this.yaw) * B.TRACK_FROM[0];
    const hz = this.z + Math.cos(this.yaw) * B.TRACK_FROM[0];
    const hy = this.baseY + B.TRACK_FROM[1];
    const dx = pos.x - hx;
    const dz = pos.z - hz;
    const far = dx * dx + dz * dz > 1e12;
    let relYaw = far ? 0 : wrapAngle(Math.atan2(dx, dz) - this.yaw);
    relYaw = relYaw > 1.2 ? 1.2 : relYaw < -1.2 ? -1.2 : relYaw;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    let pitch = far ? 0.3 : Math.atan2(hy - (pos.y + 100), horiz + 1); // + = down
    pitch = pitch > 0.95 ? 0.95 : pitch < -0.3 ? -0.3 : pitch;
    const twist = 0.08 * relYaw;
    const neckYaw = 0.55 * relYaw;
    const headYaw = 0.35 * relYaw;
    let neckPitch = 0.35 * pitch;
    let headPitch = 0.65 * pitch;
    let jaw = 0.04;
    let arms = 0;
    let lean = 0;
    let lunge = 0;
    let charge = 0;
    let power = 1;
    let crouch = 0;
    let shake = 0;
    let grab = 1;
    let tail = 0;

    if (this.state === 'rising') {
      // Up out of the front hall head first (done by 62 %), then down onto the ridge from 45 %
      // to 80 %, the front claws reaching over and slamming down one after the other.
      const u = this.t / B.RISE_TICKS;
      const r = 1 - smooth(u / 0.62);
      P[CH.RISE] = this.fromRise * r * r;
      crouch = 1 - smooth((u - 0.45) / 0.35);
      grab = clamp01((u - 0.45) / 0.45);
      shake = u < 0.85 ? 1 - u : 0;
      tail = 0.5 * (1 - u);
      power = this.t < 30 ? 0 : this.t < 44 ? ((this.t >> 1) % 3 === 0 ? 1 : 0.15) : 1;
      if (this.t === B.ROAR_AT) this._roar();
      if (this.t >= B.RISE_TICKS) {
        P[CH.RISE] = 0;
        this.state = 'active';
        this.t = 0;
        this.attackIn = B.FIRST_SHOT + (this.roarT >= 0 ? B.ROAR_TICKS - this.roarT : 0);
        this.roarIn = this._rand(B.ROAR_EVERY);
      }
    } else if (this.state === 'sinking') {
      const u = this.t / B.SINK_TICKS;
      const e = smooth(u) * smooth(u);
      P[CH.RISE] = this.fromRise + (-B.HIDDEN_DEPTH - this.fromRise) * e;
      crouch = smooth(u / 0.3);
      shake = 0.6 * u;
      tail = 0.4;
      power = u < 0.4 ? 1 : (this.t >> 1) % 2 ? 0.2 : u < 0.7 ? 0.8 : 0;
      charge = 0;
      this.roarT = -1;
      if (this.t >= B.SINK_TICKS) {
        this._hide();
        return;
      }
    } else {
      // Active: idle -> (charge -> recover) shots, and roars now and then.
      this.modeT++;
      const canTarget = this._canTarget(player);
      if (this.mode === 'idle') {
        if (this.roarT < 0) {
          this.attackIn--;
          this.roarIn--;
        }
        if (this.roarIn <= 0 && this.roarT < 0) {
          this._roar();
          this.roarIn = this._rand(B.ROAR_EVERY);
          if (this.attackIn < 40) this.attackIn = 40;
        } else if (this.attackIn <= 0 && this.roarT < 0 && canTarget) {
          this.mode = 'charge';
          this.modeT = 0;
          this.attackIn = this._rand(B.PERIOD); // counts on through the charge and recovery
          this.events.emit('sfx', { name: 'fireball_charge', pos: this.mouthPos() });
        }
      } else if (this.mode === 'charge') {
        // Draw the head back and up, jaw opening, throat and dewlap glowing.
        this.attackIn--;
        const u = this.modeT / B.CHARGE_TICKS;
        charge = u * Math.sqrt(u);
        jaw = 0.05 + 0.4 * u;
        headPitch -= 0.15 * u;
        neckPitch -= 0.08 * u;
        lunge = -0.6 * u;
        lean = -0.04 * u;
        tail = 0.3 * u;
        if (this.modeT >= B.CHARGE_TICKS) {
          if (canTarget) this._shoot(player);
          this.mode = 'recover';
          this.modeT = 0;
        }
      } else {
        // Lunge: the head snaps forward and down, jaw wide, then settles.
        this.attackIn--;
        const u = this.modeT / B.RECOVER_TICKS;
        charge = u < 0.4 ? 1 - u / 0.4 : 0;
        jaw = 0.85 * (1 - smooth(u)) + 0.04;
        lunge = 1 - smooth(u);
        headPitch += 0.12 * (1 - u);
        tail = 0.3 * (1 - u);
        if (this.modeT >= B.RECOVER_TICKS) {
          this.mode = 'idle';
          this.modeT = 0;
        }
      }
    }

    // A roar overrides the look: rear up on the front legs, claws raised, head up, jaw wide,
    // the tail thrashing.
    if (this.roarT >= 0) {
      const r = this.roarT;
      const w = smooth(r / 12) * (1 - smooth((r - (B.ROAR_TICKS - 18)) / 18));
      const quiver = Math.sin(r * 1.9) * 0.03;
      headPitch += w * (-0.5 - headPitch + quiver);
      neckPitch += w * (-0.3 - neckPitch);
      jaw += w * (1 - jaw);
      arms = w;
      lean -= 0.13 * w;
      charge += 0.25 * w;
      tail += w * (1 - tail);
      if (++this.roarT >= B.ROAR_TICKS) this.roarT = -1;
    }

    const turn = B.TURN;
    P[CH.TWIST] = this._approach(P[CH.TWIST], twist, turn * 0.5);
    P[CH.NECK_YAW] = this._approach(P[CH.NECK_YAW], neckYaw, turn * 1.4);
    P[CH.HEAD_YAW] = this._approach(P[CH.HEAD_YAW], headYaw, turn * 1.4);
    P[CH.NECK_PITCH] = this._approach(P[CH.NECK_PITCH], neckPitch, turn * 1.4);
    P[CH.HEAD_PITCH] = this._approach(P[CH.HEAD_PITCH], headPitch, turn * 2);
    P[CH.JAW] = this._approach(P[CH.JAW], jaw, 0.22);
    P[CH.ARMS] = this._approach(P[CH.ARMS], arms, 0.1);
    P[CH.LEAN] = this._approach(P[CH.LEAN], lean, 0.03);
    P[CH.LUNGE] = this._approach(P[CH.LUNGE], lunge, 0.35);
    P[CH.TAIL] = this._approach(P[CH.TAIL], tail, 0.08);
    P[CH.CHARGE] = charge > 1 ? 1 : charge;
    P[CH.POWER] = power;
    P[CH.CROUCH] = crouch;
    P[CH.SHAKE] = shake;
    P[CH.GRAB] = grab;

    this._sparks(tick);
  }

  // Smoothed hero velocity (units/tick) from his observed motion; teleports and respawns reset it.
  _watch(pos) {
    const w = this.seen;
    const dx = pos.x - w.x;
    const dz = pos.z - w.z;
    if (!w.valid || dx * dx + dz * dz > 200 * 200) {
      w.vx = 0;
      w.vz = 0;
    } else {
      const k = SHOT.VEL_SMOOTH;
      w.vx += (dx - w.vx) * k;
      w.vz += (dz - w.vz) * k;
    }
    w.x = pos.x;
    w.z = pos.z;
    w.valid = true;
  }

  _approach(cur, target, step) {
    const d = target - cur;
    return d > step ? cur + step : d < -step ? cur - step : target;
  }

  _rand(range) {
    return range[0] + Math.floor(this.rng() * (range[1] - range[0] + 1));
  }

  // Spits a fireball from the mouth toward where the hero is heading (with some spread).
  _shoot(player) {
    const from = this.mouthPos();
    const pos = player.pos;
    const vx = this.seen.vx * SHOT.LEAD;
    const vz = this.seen.vz * SHOT.LEAD;
    const rng = this.rng;
    // Gaussian aim error (Box-Muller).
    const g = SHOT.SPREAD * Math.sqrt(-2 * Math.log(1 - rng() * 0.999));
    const ga = rng() * TAU;
    let T = flightTicks(Math.sqrt((pos.x - from.x) ** 2 + (pos.z - from.z) ** 2));
    for (let i = 0; i < 2; i++) {
      _to.x = pos.x + vx * T + Math.cos(ga) * g;
      _to.z = pos.z + vz * T + Math.sin(ga) * g;
      T = flightTicks(Math.sqrt((_to.x - from.x) ** 2 + (_to.z - from.z) ** 2));
    }
    const floor = this.collision.findFloor(_to.x, pos.y + 300, _to.z);
    _to.y = floor.surface ? floor.y : pos.y;
    const water = this.collision.waterLevelAt ? this.collision.waterLevelAt(_to.x, _to.z) : -Infinity;
    if (water > _to.y) _to.y = water;
    aimVelocity(from, _to, T, _aim);
    this.target = { x: _to.x, y: _to.y, z: _to.z, T };
    this.shots++;
    this.launch(from.x, from.y, from.z, _aim.x, _aim.y, _aim.z);
    this.events.emit('sfx', { name: 'fireball_launch', pos: from });
  }

  // Sparks and smoke from the exhaust vents (more while charging or roaring) and embers
  // dripping from the open jaw.
  _sparks(tick) {
    const fire = this.fire;
    if (!fire || this.state === 'hidden') return;
    const P = this.cur;
    const busy = P[CH.CHARGE] > 0.2 || this.roarT >= 0;
    if (!busy && tick % 3 !== 0) return;
    const rng = this.rng;
    const t0 = this.clockNow;
    this._pose(P, t0);
    this.root.updateMatrixWorld(true);
    const vents = this.marks.vents;
    for (let i = 0; i < vents.length; i++) {
      if (rng() > (busy ? 0.9 : 0.35)) continue;
      this._mark(vents[i], _v);
      const p = fire.spawn(t0, 0.55 + rng() * 0.5, FIRE.SPARK);
      if (!p) return;
      p.x = _v.x + (rng() - 0.5) * 40;
      p.y = _v.y;
      p.z = _v.z + (rng() - 0.5) * 40;
      p.vx = (rng() - 0.5) * 260;
      p.vy = 380 + rng() * (busy ? 520 : 260);
      p.vz = (rng() - 0.5) * 260 - 120;
      p.gy = -900;
      p.size0 = 46 + rng() * 20;
      p.size1 = 10;
      p.ramp = RAMP.spark;
      if (rng() < 0.3) {
        const s = fire.spawn(t0, 0.9 + rng() * 0.5, FIRE.PUFF);
        if (!s) return;
        s.x = _v.x;
        s.y = _v.y + 20;
        s.z = _v.z;
        s.vx = (rng() - 0.5) * 60;
        s.vy = 160 + rng() * 80;
        s.vz = -60;
        s.size0 = 90;
        s.size1 = 260;
        s.a0 = 0.5;
        s.ramp = RAMP.smoke;
      }
    }
    if (P[CH.CHARGE] > 0.3 && rng() < P[CH.CHARGE]) {
      this._mark(this.marks.throat, _v);
      const p = fire.spawn(t0, 0.35 + rng() * 0.25, FIRE.FLAME);
      if (!p) return;
      p.x = _v.x + (rng() - 0.5) * 80;
      p.y = _v.y - 20;
      p.z = _v.z + (rng() - 0.5) * 80;
      p.vx = (rng() - 0.5) * 120;
      p.vy = -60 - rng() * 120;
      p.vz = (rng() - 0.5) * 120;
      p.size0 = 70;
      p.size1 = 20;
      p.ramp = RAMP.ember;
    }
  }

  // Poses the rig from channels P at clock time `clock` (seconds). While crouched (rising or
  // sinking through the roof) the body rears up about the hips with the neck and snout pointing
  // at the sky and the front legs folded back, so nothing juts out past the front facade below
  // the roof line.
  _pose(P, clock) {
    const B = BEAST;
    const breath = Math.sin(clock * 1.5);
    const sway = Math.sin(clock * 0.55);
    const bob = Math.sin(clock * 1.25);
    const shake = P[CH.SHAKE];
    const crouch = P[CH.CROUCH];
    const stand = 1 - crouch;
    const root = this.root;
    root.position.set(
      this.x + shake * 14 * Math.sin(clock * 41),
      this.baseY + P[CH.RISE] + shake * 10 * Math.sin(clock * 53),
      this.z + shake * 10 * Math.sin(clock * 37),
    );
    // Body: pitches about the hips (negative: the chest rises); the belly heaves with breath.
    const pitch = P[CH.LEAN] - crouch * B.CROUCH_PITCH - breath * 0.008;
    this.torso.rotation.set(pitch, P[CH.TWIST] + sway * 0.015, sway * 0.01);
    const lunge = P[CH.LUNGE];
    this.neck.rotation.set(stand * (P[CH.NECK_PITCH] + lunge * 0.22 + bob * 0.015) - crouch * B.CROUCH_NECK, P[CH.NECK_YAW] * stand, 0);
    const hb = this.headBase;
    this.head.position.set(hb.x, hb.y - lunge * 30, hb.z + lunge * 130);
    this.head.rotation.set(stand * (P[CH.HEAD_PITCH] + bob * 0.03) - crouch * B.CROUCH_HEAD, P[CH.HEAD_YAW] * stand, sway * 0.03);
    this.jaw.rotation.x = P[CH.JAW] * 0.75;
    // Front legs: undo the body's pitch (the feet stay on the roof), fold back while crouched,
    // reach up and over during the landing (left, then right), and lift, claws out, in a roar.
    const arms = P[CH.ARMS] * stand;
    const g = P[CH.GRAB];
    const reachL = g > 0 && g < 0.6 ? Math.sin((g / 0.6) * Math.PI) : 0;
    const reachR = g > 0.35 && g < 0.95 ? Math.sin(((g - 0.35) / 0.6) * Math.PI) : 0;
    const fold = crouch * B.ARM_TUCK;
    const shift = Math.sin(clock * 0.9) * 0.012;
    this.armL.rotation.set(-pitch + fold - reachL * 0.8 + arms * 0.3 + shift, 0, -(reachL * 0.3 + arms * 0.4) + crouch * 0.25);
    this.armR.rotation.set(-pitch + fold - reachR * 0.8 + arms * 0.3 - shift, 0, reachR * 0.3 + arms * 0.4 - crouch * 0.25);
    // Tail: a slow sway that travels down to the tip, and a fast thrash when roused.
    const thrash = P[CH.TAIL];
    this.tailA.rotation.set(0.02 * thrash, 0.02 * Math.sin(clock * 0.6) + 0.035 * thrash * Math.sin(clock * 4.2), 0);
    this.tailB.rotation.set(0.07 * thrash, 0.09 * Math.sin(clock * 0.6 - 0.9) + 0.13 * thrash * Math.sin(clock * 4.2 - 0.8), 0.02 * Math.sin(clock * 0.8));
  }

  animate(alpha, clock, camera = null) {
    this.lastClock = clock;
    this.camera = camera;
    if (this.state === 'hidden') return;
    const P = this.draw;
    const a = this.prev;
    const b = this.cur;
    for (let i = 0; i < N_CH; i++) P[i] = a[i] + (b[i] - a[i]) * alpha;
    this._pose(P, clock);
    this.root.updateMatrixWorld(true);
    const u = this.uniforms;
    const since = clock - this.flashAt;
    u.uCharge.value = P[CH.CHARGE];
    u.uPower.value = P[CH.POWER];
    u.uFlash.value = since >= 0 && since < 0.6 ? this.flashStrength * 0.7 * (1 - since / 0.6) : 0;
    this._glows(P);
  }

  // Queues a glow sprite at _v (see _glowAt) with a linear tint; false when out of slots.
  _glow(size, tint, alpha) {
    const g = this.fire.glowSlot();
    if (!g) return false;
    g.x = _v.x;
    g.y = _v.y;
    g.z = _v.z;
    g.size = size;
    g.r = tint[0];
    g.g = tint[1];
    g.b = tint[2];
    g.a = alpha;
    return true;
  }

  // Additive glows: the side optics, the chest furnace, the exhaust vents, and the throat and
  // dewlap while charging.
  _glows(P) {
    if (!this.fire) return;
    const power = P[CH.POWER];
    const charge = P[CH.CHARGE];
    const m = this.marks;
    if (power > 0.05) {
      for (let i = 0; i < 2; i++) {
        this._glowAt(m.eyes[i], _v);
        if (!this._glow(280, TINTS.eye, power)) return;
      }
    }
    this._glowAt(m.core, _v);
    if (!this._glow(260 + 320 * charge, TINTS.core, (0.45 + 0.55 * charge) * (0.4 + 0.6 * power))) return;
    for (let i = 0; i < m.vents.length; i++) {
      this._glowAt(m.vents[i], _v);
      if (!this._glow(110 + 90 * charge, TINTS.ember, 0.35 + 0.5 * charge)) return;
    }
    if (charge > 0.02) {
      this._glowAt(m.throat, _v);
      if (!this._glow(200 + 520 * charge, TINTS.charge, charge)) return;
      this._glowAt(m.dewlap, _v);
      this._glow(160 + 320 * charge, TINTS.core, 0.8 * charge);
    }
  }
}
