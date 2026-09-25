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
//   new RobotBeast({ anchor: layout.KAIJU, collision, events, fire, rng, launch, fx?, level?, layout?, blocked? })
//   setMode(on)          start rising / sinking
//   update(player, tick) 30 Hz: state machine, tracking, attacks (launch(x, y, z, vx, vy, vz))
//   animate(alpha, clock) render: interpolated pose, glows
//   reset()              hidden at once
//   grip                 the tail's grip record (the hero's actions/tail.js reads it)
//   starDue, wreckPos    a crash's wreck has gone: the reward star is due at wreckPos (objects
//                        clear starDue once they placed it)
//
// Placement: layout.KAIJU marks the keep; the beast's front feet stand STANCE_FORWARD in front
// of it, on the front hall's gable roof (their height found by raycasting down at the feet),
// the body along the ridge, the head out over the front facade toward the courtyard.
//
// Pose: the tick writes a few animation channels (CH) and the render interpolates them; idle
// breathing, head bob and the tail's sway are functions of the clock. Events: 'sfx' kaiju_roar,
// fireball_charge, fireball_launch (with pos), and 'kaijuRoar' { pos } when it roars.
//
// The tail grab (docs/ARCHITECTURE.md "AI RACE mode"): the tail's end lies on the rear block's
// flat roof, its tow coupling (RIG.GRIP) pulsing orange. The hero's B next to it grabs it
// (actions/tail.js); the beast answers from his action:
//   'held'    tail_hold: it lies where it is but struggles: roars, looks back over its
//             shoulder, thrashes and shakes, no fireballs. Let go (Z, a hit, holding too long
//             without spinning): back to 'active' after an angry roar, GRAB.RELEASE_GRACE ticks
//             before it shoots again. A throw with no spin: it twists free, slams its tail down
//             and knocks him back (1 wedge).
//   'haul'    tail_spin starts: over TAIL_RAISE_TICKS it is torn off the ridge and hauled up
//             into the whirl along a scripted path (GRAB.HAUL keys: bearing, elevation, how
//             straight the tail is, roll) that swings it up east of the keep's spire, rolling
//             onto its back; it leads the hero's facing meanwhile (grip.lead / grip.yaw).
//   'whirl'   the coupling in his hands, the tail pulled straight, the whole beast swings round
//             him along his facing, its body GRAB.THETA above the horizontal (belly up, limbs
//             flailing): high enough that nothing of it touches the keep, its spire or the
//             towers (tests/boss-throw.test.js checks every bearing). A whoosh each turn,
//             rising in pitch with the spin ('boss_whoosh').
//   'thrown'  a throw at GRAB.THROW_MIN or more: it flies off along the swing's tangent to a
//             landing spot on that line clear of the castle (courtyard, lawn, island or moat;
//             _landingSpot), tumbling and flailing on a ballistic arc; a weaker one (or the spin
//             running down, or a hit) and it twists free instead ('fall').
//   'fall'    back onto its perch in a high arc, slamming down on the ridge (dust, shake).
//   'wrecked' the crash: on the ground a huge blast of fire, sparks, scrap and dust, a scorch,
//             fires and a strong camera shake ('bossImpact'); in water a huge splash and
//             steam. 'bossDefeated' { pos, water } (main ends AI RACE mode as if STOP was
//             pressed). It lies on its back smoking and sparking, the optics dying, then sinks
//             away (GRAB.WRECK_TICKS + GRAB.SCRAP_TICKS); starDue flags the reward star. The
//             next time the mode turns on it rises again, repaired.
// Events of the grab: 'sfx' tail_grab, boss_haul, boss_whoosh (pitch), boss_throw, boss_slam,
// boss_crash / boss_splash; 'bossThrown' { flight, to, water } (flightPoint(flight, t) is its
// waist t ticks on: the camera follows it); 'bossImpact' { pos, strength, kind:
// 'slam'|'crash'|'splash' } (camera shake); 'bossDefeated' { pos, water }.

import * as THREE from 'three';
import { TAU, wrapAngle } from '../core/math.js';
import { FRAME_DT, NO_WATER } from '../core/constants.js';
import { buildBeastGeometries, makeBeastMaterial, RIG, headPivot } from './robotBeastModel.js';
import { FIRE } from './aiRaceTextures.js';
import { RAMP, TINTS } from './FireSprites.js';
import { TAIL_HANDS } from '../player/actions/tail.js';
import { TAIL_RAISE_TICKS } from '../player/physics/tuning.js';

const DEG = Math.PI / 180;

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

// The tail grab (see the top). Angles in radians, times in ticks.
export const GRAB = {
  // Haul keys [bearing from its facing, elevation (deg), tail straightened 0..1, roll (deg),
  // time 0..1]: from lying on the ridge (0, 0, 0, 0) up into the whirl. Found against the real
  // castle with tests/boss-throw.test.js's clearance check (it swings up east of the spire).
  HAUL: [
    [0, 0, 0, 0, 0],
    [8, 14, 0.1, 0, 0.2],
    [22, 30, 0.3, 0, 0.45],
    [40, 45, 0.6, 60, 0.7],
    [45, 68, 1, 180, 1],
  ],
  HAUL_TICKS: TAIL_RAISE_TICKS,
  THETA: 68 * DEG, // the whirling body's elevation from the hero's hands
  ROLL: Math.PI, // belly up (its splayed legs flail inward, not down into the towers)
  WOBBLE: 0.03, // elevation wobble while whirling
  FLAIL_ROLL: 0.22, // roll wobble while whirling
  THROW_MIN: 0.15, // spin (rad/tick) a throw needs
  RELEASE_GRACE: 75, // ticks after it is let go before it shoots again
  HOLD_ROAR: 50, // a held beast starts another roar this often (ticks) once the last is over
  // The throw's flight: ballistic under THROW_GRAVITY, its waist's apex THROW_APEX over the
  // castle's top (T within THROW_T), levelling out of the whirl, spinning and rolling (FLY_*;
  // both scaled to end lined up with the wreck), set down on its back over the last CRASH_BLEND
  // ticks. The landing spot keeps LAND_MARGIN clear of the castle's footprint (LAND_MARGIN_FRONT
  // in front) and LAND_EDGE inside the level's perimeter, with room for the wreck (WRECK_*,
  // LAND_*: _wreckFit); lying on its back its waist is LAND_REST over the ground.
  THROW_GRAVITY: 5,
  THROW_APEX: 2600, // the waist's apex over the castle's top (layout.CASTLE.keepTopY)
  THROW_T: [50, 110],
  FLY_HOLD: 6, // ticks it keeps the whirl's steep pose, rising, before it levels out...
  FLY_SETTLE: 14, // ...over this many
  FLY_PITCH: 0.12, // flying nose up this much...
  FLY_SPIN: 0.85, // ...spinning flat at this much of the throw's spin at first...
  FLY_SPIN_DECAY: 18, // ...dying away over about this many ticks...
  FLY_YAW: 0.05, // ...to this (rad/tick)...
  FLY_ROLL: 0.075, // ...and barrel-rolling (rad/tick)
  CRASH_BLEND: 16,
  WRECK_PITCH: 0, // on its back, level (its neck curls its head up off the ground)
  LAND_MARGIN: 2200,
  LAND_MARGIN_FRONT: 3400, // (it comes down over the facade's towers: land further out there)
  WRECK_HEAD: 1900, // the wreck reaches this far ahead of its waist (head curled up)...
  WRECK_TAIL: 3000, // ...and this far behind (the tail)...
  WRECK_HALF_WIDTH: 450, // ...and this far to either side
  LAND_END: 500, // its ends stay this far clear of the castle and inside the perimeter
  LAND_BUMP: 180, // the ground along it at most this much higher than the spot
  LAND_EDGE: 2500,
  LAND_REST: 430,
  FALL_TICKS: 40, // twisting free: back onto its perch in an arc FALL_ARC high
  FALL_ARC: 1800,
  WRECK_TICKS: 96, // lying wrecked, then sinking away over SCRAP_TICKS by SCRAP_DEPTH
  SCRAP_TICKS: 60,
  SCRAP_DEPTH: 1500,
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
  FLAIL: 16, // limbs flailing, neck whipping (hauled, whirled, thrown, twitching wreck)
  GRIP: 17, // the coupling's glow: 0 off, ~0.5 pulsing (grabbable), 1 held
  TUCK: 18, // front legs folded back along the chest (torn off the ridge)
};
const N_CH = 19;

// States where the root's pose comes from the free pose (fq, fk, fpos / the hero's hands).
const FREE = new Set(['haul', 'whirl', 'thrown', 'fall', 'wrecked']);

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

// Where a thrown beast's waist is t ticks into its flight f ({ x0, y0, z0, vx, vy, vz, T, g }):
// ballistic up and down (stepped like aimVelocity, so at t = T it is exactly on target), its
// way across eased in and out (it first shoots up out of the whirl, then drops onto the spot).
// Into `out` ({ x, y, z }). Also used by the camera (camera/bossCam.js, 'bossThrown').
export function flightPoint(f, t, out) {
  const u = t <= 0 ? 0 : t >= f.T ? 1 : t / f.T;
  const across = u * u * (3 - 2 * u) * f.T;
  out.x = f.x0 + f.vx * across;
  out.y = f.y0 + f.vy * t - (f.g * t * (t + 1)) / 2;
  out.z = f.z0 + f.vz * across;
  return out;
}

// Signed distance to a rounded rectangle { minX, maxX, minZ, maxZ, radius } (< 0 inside).
function sdRoundRect(x, z, r) {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const rad = r.radius ?? 0;
  const qx = Math.abs(x - cx) - ((r.maxX - r.minX) / 2 - rad);
  const qz = Math.abs(z - cz) - ((r.maxZ - r.minZ) / 2 - rad);
  const ox = qx > 0 ? qx : 0;
  const oz = qz > 0 ? qz : 0;
  const inside = qx > qz ? qx : qz;
  return Math.sqrt(ox * ox + oz * oz) + (inside < 0 ? inside : 0) - rad;
}

// Orientation of the whirling beast: its body (rig +Z) along the bearing `phi` at elevation
// `theta` from the hero's hands, its back (rig +Y) toward the sky side, rolled by `roll` about
// the body. Into `out` (a Quaternion); no garbage.
const _ox = new THREE.Vector3();
const _oy = new THREE.Vector3();
const _oz = new THREE.Vector3();
const _om = new THREE.Matrix4();
const _oq = new THREE.Quaternion();
const _oaxis = new THREE.Vector3(0, 0, 1);
export function whirlQuaternion(phi, theta, roll, out) {
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  _oz.set(sp * ct, st, cp * ct);
  _oy.set(-sp * st, ct, -cp * st);
  _ox.crossVectors(_oy, _oz);
  out.setFromRotationMatrix(_om.makeBasis(_ox, _oy, _oz));
  if (roll !== 0) out.multiply(_oq.setFromAxisAngle(_oaxis, roll));
  return out;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const IDENT = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _aim = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const _spot = { x: 0, z: 0, floorY: 0, water: NO_WATER, heading: 0 };
const _gp = { x: 0, y: 0, z: 0, ux: 0, uz: 1, standX: 0, standY: 0, standZ: 0 };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// The tail pulled straight (whirled): each tail part turned so its chord (pivot to the next
// part's pivot, or to the grip) runs straight back along rig -Z. TAIL_A_STRAIGHT is tailA's
// rotation, TAIL_B_STRAIGHT tailB's (in tailA's frame).
const A0 = vec(RIG.TAIL_A[0]);
const B0 = vec(RIG.TAIL_B[0]);
const GRIP_B = vec(sub3(RIG.GRIP, RIG.TAIL_B[0])); // the grip in tailB's space
const B0_A = vec(sub3(RIG.TAIL_B[0], RIG.TAIL_A[0])); // tailB's pivot in tailA's space
const TIP_B = vec(sub3(RIG.TAIL_B[RIG.TAIL_B.length - 1], RIG.TAIL_B[0])); // the tail's tip
const GRIP_B_DIR = GRIP_B.clone().normalize();
const HELD_AXIS = vec(RIG.GRIP).sub(A0).normalize(); // tail root to coupling (root space)
const BACK = new THREE.Vector3(0, 0, -1);
const TAIL_A_STRAIGHT = new THREE.Quaternion().setFromUnitVectors(B0_A.clone().normalize(), BACK);
const TAIL_B_STRAIGHT = new THREE.Quaternion().setFromUnitVectors(
  GRIP_B.clone().normalize(),
  BACK.clone().applyQuaternion(TAIL_A_STRAIGHT.clone().invert()),
);
// The body point the throw's flight follows (the waist) and the whole tail's length pulled
// straight (grip to tail root).
const WAIST = vec(RIG.WAIST);
export const TAIL_REACH = B0_A.length() + GRIP_B.length();

export class RobotBeast {
  constructor({ anchor, collision, events, fire, rng, launch, fx = null, level = null, layout = null, blocked = null }) {
    this.events = events;
    this.collision = collision;
    this.fire = fire; // FireSprites (glows, sparks)
    this.rng = rng;
    this.launch = launch; // (x, y, z, vx, vy, vz) -> fires a ball
    this.fx = fx; // Effects (the crash's blast and dust), optional
    this.level = level; // the crash's scorch mark, optional
    this.layout = layout; // CASTLE / PERIMETER: where a throw may land, optional
    this.blocked = blocked; // (x, z, margin) -> something moving is (or will be) there, optional
    this.yaw = anchor.yaw ?? 0;
    const S = BEAST.SCALE;
    const fx0 = Math.sin(this.yaw);
    const fz0 = Math.cos(this.yaw);
    this.x = anchor.x + fx0 * BEAST.STANCE_FORWARD;
    this.z = anchor.z + fz0 * BEAST.STANCE_FORWARD;
    this.baseY = this._findStanceHeight(S);
    this.restQ = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);

    this.material = makeBeastMaterial();
    this.uniforms = this.material.userData.uniforms;
    this._buildRig(S);

    this.cur = new Float32Array(N_CH);
    this.prev = new Float32Array(N_CH);
    this.draw = new Float32Array(N_CH);
    this.state = 'hidden'; // 'hidden' | 'rising' | 'active' | 'sinking' | 'held' | 'haul' | 'whirl' | 'thrown' | 'fall' | 'wrecked'
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

    // The tail grab. `grip` is shared with the hero (player.tailGrip, see actions/tail.js).
    this.grip = {
      active: false,
      held: false,
      lead: false,
      whirling: false,
      yaw: 0,
      x: 0,
      y: 0,
      z: 0,
      standX: 0,
      standY: 0,
      standZ: 0,
      standYaw: 0,
    };
    // The free pose (haul .. wrecked), this tick and last: root orientation, how straight the
    // tail is, the root position (or, `anchored`, the hero's hands the coupling hangs in).
    this.fq = new THREE.Quaternion();
    this.fqPrev = new THREE.Quaternion();
    this.fk = 0;
    this.fkPrev = 0;
    this.fpos = new THREE.Vector3();
    this.fposPrev = new THREE.Vector3();
    this.hand = new THREE.Vector3();
    this.handPrev = new THREE.Vector3();
    this.anchored = false;
    this.whirlTurn = 0; // radians swung since the last whoosh
    this.lastPhi = 0;
    this.spin = 0; // the hero's spin (rad/tick) as last seen
    this.from = { q: new THREE.Quaternion(), pos: new THREE.Vector3(), k: 0 }; // a fall's start
    this.fly = {
      T: 1, g: GRAB.THROW_GRAVITY, x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, dirX: 0, dirZ: 1, tAlign: 1, spinScale: 1, rollScale: 1,
      q0: new THREE.Quaternion(), qEnd: new THREE.Quaternion(), h0: 0, dir: 1, w: 0,
    };
    this.wreckPos = { x: 0, y: 0, z: 0, floorY: 0, water: false };
    this.starDue = false; // a wreck has gone: the reward star is due at wreckPos
    this.defeats = 0; // crashes so far
    this.throws = 0; // throws attempted (weak ones too)
    this.knockFrom = { x: 0, y: 0, z: 0 };
    this.jolt = 0; // ticks of a shudder and tail thrash still to come (it slammed down)
    this.riseAfter = false; // the mode came back on while it was flying / wrecked
    this.sinkAfter = false; // the mode went off while it was hauled / whirled / falling back
    this.restGrip = this._restGrip();
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
      grip: [this.tailB, GRIP_B.clone()],
      tip: [this.tailB, TIP_B.clone()],
      waist: [this.root, WAIST.clone()],
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

  // Where the coupling lies with the beast at rest on its perch, and the spot the hero holds it
  // from (its floor found once: the roof there does not move).
  _restGrip() {
    const P = this.cur;
    P.fill(0);
    P[CH.GRAB] = 1;
    P[CH.POWER] = 1;
    this._pose(P, 0);
    this.root.updateMatrixWorld(true);
    const out = { x: 0, y: 0, z: 0, ux: 0, uz: 1, standX: 0, standY: 0, standZ: 0 };
    this._placeGrip(out);
    const f = this.collision.findFloor(out.standX, out.y, out.standZ);
    out.standY = f.surface ? f.y : out.y - TAIL_HANDS.HOLD_UP;
    return out;
  }

  // The coupling's crossbar (x, y, z) and the way the tail runs out of it (ux, uz: horizontal,
  // away from the body), and the spot HOLD_AHEAD back from the bar along it, from the current
  // matrices.
  _placeGrip(out) {
    this._mark(this.marks.grip, _v);
    this._mark(this.marks.tip, _d);
    out.x = _v.x;
    out.y = _v.y;
    out.z = _v.z;
    let ux = _v.x - _d.x;
    let uz = _v.z - _d.z;
    const len = Math.sqrt(ux * ux + uz * uz);
    ux = len > 1e-6 ? ux / len : 0;
    uz = len > 1e-6 ? uz / len : 1;
    out.ux = ux;
    out.uz = uz;
    out.standX = _v.x + ux * TAIL_HANDS.HOLD_AHEAD;
    out.standZ = _v.z + uz * TAIL_HANDS.HOLD_AHEAD;
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
    this.anchored = false;
    this.fk = this.fkPrev = 0;
    this.root.quaternion.copy(this.restQ);
    this.tailA.quaternion.identity();
    this.tailB.quaternion.identity();
    const g = this.grip;
    if (g) g.active = g.held = g.lead = g.whirling = false;
  }

  reset() {
    this._hide();
    this.shots = 0;
    this.starDue = false;
    this.riseAfter = false;
    this.sinkAfter = false;
    this.spin = 0;
  }

  // The mode switched on (rise) or off (sink), continuing from the current height.
  setMode(on) {
    if (FREE.has(this.state)) {
      // Flying off or wrecked: it finishes (and comes back up repaired if the mode is on by
      // then). Hauled, whirled or falling back: it lands on its perch first, then sinks.
      if (this.state === 'thrown' || this.state === 'wrecked') this.riseAfter = on;
      else this.sinkAfter = !on;
      if (!on && (this.state === 'haul' || this.state === 'whirl')) this._startFall();
      return;
    }
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
    } else if (!on && (this.state === 'rising' || this.state === 'active' || this.state === 'held')) {
      this.state = 'sinking';
      this.fromRise = this.cur[CH.RISE];
      this.t = 0;
      this.mode = 'idle';
      this.target = null;
      this.grip.active = this.grip.held = false;
    }
  }

  // Lightning brightens the plates for a moment (render clock).
  flash(strength) {
    this.flashAt = this.lastClock;
    this.flashStrength = strength > 1 ? 1 : strength;
  }

  _roar(pitch = 1) {
    this.roarT = 0;
    const pos = this.mouthPos();
    this.events.emit('sfx', pitch === 1 ? { name: 'kaiju_roar', pos } : { name: 'kaiju_roar', pos, pitch });
    this.events.emit('kaijuRoar', { pos });
  }

  // World position of the mouth for the current tick's pose (a fresh object).
  mouthPos() {
    this._poseAt(this.cur, this.clockNow, 1);
    this.root.updateMatrixWorld(true);
    this.mouth.getWorldPosition(_v);
    return { x: _v.x, y: _v.y, z: _v.z };
  }

  // World position of the waist (the body's middle) for the current tick's pose (fresh).
  bodyPos() {
    this._poseAt(this.cur, this.clockNow, 1);
    this.root.updateMatrixWorld(true);
    this._mark(this.marks.waist, _v);
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
    if (this.state === 'hidden') {
      this.grip.active = false;
      return;
    }
    this.prev.set(this.cur);
    this.fqPrev.copy(this.fq);
    this.fkPrev = this.fk;
    this.fposPrev.copy(this.fpos);
    this.handPrev.copy(this.hand);
    this.clockNow = tick * FRAME_DT;
    this.t++;
    if (this.grace > 0) this.grace--;
    const P = this.cur;
    const B = BEAST;
    const pos = player.pos;
    this._watch(pos);
    const act = player.action;
    const holding = act === 'tail_hold' || act === 'tail_spin';
    if (this.state === 'active' && holding && this.grip.active) this._grab();
    else if (this.state === 'held') {
      if (act === 'tail_spin') this._startHaul(player);
      else if (act === 'tail_throw') this._twistFree(player);
      else if (!holding) this._letGo();
    }
    if (FREE.has(this.state)) {
      this._updateFree(player);
      if (this.state !== 'hidden') {
        this._sparks(tick);
        this._updateGrip();
      }
      return;
    }

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
    let twist = 0.08 * relYaw;
    let neckYaw = 0.55 * relYaw;
    let headYaw = 0.35 * relYaw;
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
    let grip = 0;

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
      grip = 0.5 * clamp01((u - 0.8) / 0.2);
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
    } else if (this.state === 'held') {
      // Held by the tail: it looks back over its shoulder at the hero (the tracking clamps
      // there), claws scrabbling, body shaking, and roars again and again. No shots.
      this.mode = 'idle';
      const k = this.t < 10 ? this.t / 10 : 1;
      shake = 0.35 * k;
      arms = 0.35 + 0.25 * Math.sin(this.t * 0.45);
      twist *= 1.6;
      lean = -0.05 * k;
      tail = 0; // (the tail lies pinned: the hero holds its end)
      grip = 1;
      if (this.t % GRAB.HOLD_ROAR === 12 && this.roarT < 0) this._roar(1.08);
      jaw = 0.35 + 0.1 * Math.sin(this.t * 0.7);
    } else {
      // Active: idle -> (charge -> recover) shots, and roars now and then.
      this.modeT++;
      grip = 0.5;
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
      arms = w > arms ? w : arms;
      lean -= 0.13 * w;
      charge += 0.25 * w;
      if (this.state !== 'held') tail += w * (1 - tail);
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
    if (this.jolt > 0) {
      shake += this.jolt / 14;
      P[CH.TAIL] = this.jolt / 14;
      this.jolt--;
    }
    P[CH.CHARGE] = charge > 1 ? 1 : charge;
    P[CH.POWER] = power;
    P[CH.CROUCH] = crouch;
    P[CH.SHAKE] = shake;
    P[CH.GRAB] = grab;
    P[CH.FLAIL] = 0;
    P[CH.GRIP] = grip;
    P[CH.TUCK] = 0;

    this._sparks(tick);
    this._updateGrip();
  }

  // ------------------------------------------------------------------ the tail grab

  // The grip record for this tick (see actions/tail.js): grabbable while it lies on its perch.
  _updateGrip() {
    const g = this.grip;
    const s = this.state;
    g.active = s === 'active';
    g.held = s === 'held' || s === 'haul' || s === 'whirl';
    g.lead = s === 'haul';
    g.whirling = s === 'whirl';
    if (!g.active) return;
    this._poseAt(this.cur, this.clockNow, 1);
    this.root.updateMatrixWorld(true);
    const r = this._placeGrip(_gp);
    g.x = r.x;
    g.y = r.y;
    g.z = r.z;
    g.standX = r.standX;
    g.standZ = r.standZ;
    g.standY = this.restGrip.standY;
    g.standYaw = Math.atan2(-r.ux, -r.uz);
    g.yaw = g.standYaw;
  }

  // The hero grabbed the coupling: a clank, an angry roar, and it starts to struggle.
  _grab() {
    this.state = 'held';
    this.t = 0;
    this.mode = 'idle';
    this.modeT = 0;
    this.target = null;
    const g = this.grip;
    this.events.emit('sfx', { name: 'tail_grab', pos: { x: g.x, y: g.y, z: g.z } });
    this._roar(1.1);
  }

  // Let go while it still lay on its perch (Z, a hit, held too long): back to its business.
  _letGo() {
    this.state = 'active';
    this.t = 0;
    this.mode = 'idle';
    this.grace = GRAB.RELEASE_GRACE;
    if (this.attackIn < GRAB.RELEASE_GRACE) this.attackIn = GRAB.RELEASE_GRACE;
    if (this.roarT < 0) this._roar();
  }

  // A throw with no spin while it lies on its perch: it twists, slams its tail down and the
  // hero is knocked back (1 wedge).
  _twistFree(player) {
    this.throws++;
    this._letGo();
    this.jolt = 14;
    this._knock(player);
    const r = this.restGrip;
    this._slam(r.x, r.standY, r.z, 0.8);
  }

  // Knocks the hero back 1 wedge, toward the roof's inside (away from the tail's end).
  _knock(player) {
    const r = this.restGrip;
    const k = this.knockFrom;
    k.x = player.pos.x + r.ux * 100;
    k.y = player.pos.y;
    k.z = player.pos.z + r.uz * 100;
    player.takeDamage?.(1, k);
  }

  // The hero's hands this tick (world): in front of his feet along his facing, blending from
  // the low hold to the raised whirl over the haul.
  _hands(player, raise) {
    const ahead = TAIL_HANDS.HOLD_AHEAD + (TAIL_HANDS.SPIN_AHEAD - TAIL_HANDS.HOLD_AHEAD) * raise;
    const up = TAIL_HANDS.HOLD_UP + (TAIL_HANDS.SPIN_UP - TAIL_HANDS.HOLD_UP) * raise;
    const yaw = player.faceYaw;
    this.hand.set(player.pos.x + Math.sin(yaw) * ahead, player.pos.y + up, player.pos.z + Math.cos(yaw) * ahead);
  }

  // Spin starts: torn off the ridge and hauled up into the whirl.
  _startHaul(player) {
    this.state = 'haul';
    this.t = 0;
    this.roarT = -1;
    this.anchored = true;
    this.spin = player.tailSpeed ?? 0;
    this.fq.copy(this.restQ);
    this.fqPrev.copy(this.fq);
    this.fk = this.fkPrev = 0;
    this._hands(player, 0);
    this.handPrev.copy(this.hand);
    this.whirlTurn = 0;
    this.lastPhi = player.faceYaw;
    const g = this.grip;
    this.events.emit('sfx', { name: 'boss_haul', pos: { x: g.x, y: g.y, z: g.z } });
    this._roar(1.15);
    this.fx?.dust?.(this.x, this.baseY, this.z, { radius: 700, count: 18, sparks: 16, debris: 10 });
  }

  // Haul, whirl, flight, fall and wreck: one tick of the free pose.
  _updateFree(player) {
    const P = this.cur;
    const act = player.action;
    const s = this.state;
    P[CH.RISE] = 0;
    P[CH.CROUCH] = 0;
    P[CH.CHARGE] = 0;
    P[CH.SHAKE] = 0;
    P[CH.GRAB] = 1;
    P[CH.LUNGE] = 0;
    P[CH.LEAN] = 0;
    P[CH.TAIL] = 0;
    P[CH.TWIST] = 0;
    P[CH.NECK_YAW] = 0;
    P[CH.HEAD_YAW] = 0;
    P[CH.TUCK] = 0;
    if (s === 'haul' || s === 'whirl') {
      this.spin = player.tailSpeed ?? 0;
      if (act === 'tail_throw') {
        const w = player.tailRelease ?? 0;
        this.throws++;
        if (s === 'whirl' && w >= GRAB.THROW_MIN) this._throw(player, w);
        else {
          this._knock(player);
          this._startFall();
        }
      } else if (act !== 'tail_spin') {
        this._startFall(); // hit, or the beast was let go some other way
      }
    }
    if (this.state === 'haul') this._haulTick(player);
    else if (this.state === 'whirl') this._whirlTick(player);
    else if (this.state === 'thrown') this._flyTick();
    else if (this.state === 'fall') this._fallTick();
    else if (this.state === 'wrecked') this._wreckTick();
    if (this.roarT >= 0 && ++this.roarT >= BEAST.ROAR_TICKS) this.roarT = -1;
  }

  _haulTick(player) {
    const P = this.cur;
    const keys = GRAB.HAUL;
    const u = this.t / GRAB.HAUL_TICKS;
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][4]) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const e = smooth((u - a[4]) / (b[4] - a[4]));
    whirlQuaternion(this.yaw + a[0] * DEG, a[1] * DEG, a[3] * DEG, _qa);
    whirlQuaternion(this.yaw + b[0] * DEG, b[1] * DEG, b[3] * DEG, _qb);
    this.fq.slerpQuaternions(_qa, _qb, e);
    this.fk = a[2] + (b[2] - a[2]) * e;
    this.grip.yaw = wrapAngle(this.yaw + (a[0] + (b[0] - a[0]) * e) * DEG);
    this._hands(player, smooth(u));
    // (Its front legs fold back as it is torn off the ridge, clear of the entrance towers'
    // roofs, then flail.)
    P[CH.TUCK] = 1 - smooth((u - 0.35) / 0.3);
    P[CH.FLAIL] = smooth((u - 0.3) / 0.4);
    P[CH.JAW] = 0.9;
    P[CH.POWER] = 1;
    P[CH.GRIP] = 1;
    P[CH.ARMS] = 0;
    P[CH.NECK_PITCH] = -0.25;
    P[CH.HEAD_PITCH] = -0.3;
    if (this.t >= GRAB.HAUL_TICKS) {
      this.state = 'whirl';
      this.t = 0;
      this.lastPhi = player.faceYaw;
    }
  }

  _whirlTick(player) {
    const P = this.cur;
    const phi = player.faceYaw;
    const d = wrapAngle(phi - this.lastPhi);
    this.lastPhi = phi;
    this.whirlTurn += d < 0 ? -d : d;
    const clock = this.clockNow;
    const theta = GRAB.THETA + GRAB.WOBBLE * Math.sin(clock * 2.1);
    whirlQuaternion(phi, theta, GRAB.ROLL + GRAB.FLAIL_ROLL * Math.sin(clock * 2.7), this.fq);
    this.fk = 1;
    this._hands(player, 1);
    P[CH.FLAIL] = 1;
    P[CH.JAW] = 0.75 + 0.25 * Math.sin(clock * 5);
    P[CH.POWER] = 1;
    P[CH.GRIP] = 1;
    P[CH.ARMS] = 0.6;
    P[CH.NECK_PITCH] = -0.2;
    P[CH.HEAD_PITCH] = -0.3;
    if (this.whirlTurn >= TAU) {
      this.whirlTurn -= TAU;
      const b = this.bodyPos();
      this.events.emit('sfx', { name: 'boss_whoosh', pos: b, pitch: 0.7 + 2.2 * this.spin });
      if (this.roarT < 0 && this.rng() < 0.35) this._roar(1.2);
    }
  }

  // The throw: along the swing's tangent to a landing spot clear of the castle, on a high arc
  // (its waist's apex THROW_APEX over the castle's top) that carries it over everything.
  _throw(player, w) {
    const f = this.fly;
    const c = this.bodyPos(); // (the pose it was let go in)
    this.fpos.copy(this.root.position);
    this.fposPrev.copy(this.fpos);
    // The body's horizontal velocity: round the hero, the way his facing turns (from the
    // bearing it was swung at last tick, the pose it is let go in).
    const dir = player.tailDir < 0 ? -1 : 1;
    const phi = this.lastPhi;
    let tx = Math.cos(phi) * dir;
    let tz = -Math.sin(phi) * dir;
    const spot = this._landingSpot(c.x, c.z, tx, tz);
    tx = spot.x - c.x;
    tz = spot.z - c.z;
    const dist = Math.sqrt(tx * tx + tz * tz);
    const hl = dist > 1 ? 1 / dist : 0;
    const water = spot.water !== NO_WATER && spot.water > spot.floorY;
    const w0 = this.wreckPos;
    w0.x = spot.x;
    w0.z = spot.z;
    w0.floorY = water ? spot.water : spot.floorY;
    w0.water = water;
    w0.y = water ? spot.water - 250 : spot.floorY + GRAB.LAND_REST;
    // Flight time for the apex: up at vy = sqrt(2 g rise), down to the target (the discrete
    // steps' quadratic), then the exact launch for that whole number of ticks.
    const g = GRAB.THROW_GRAVITY;
    const top = this.layout?.CASTLE?.keepTopY ?? c.y;
    const apex = top + GRAB.THROW_APEX > c.y + 1500 ? top + GRAB.THROW_APEX : c.y + 1500;
    const vy = Math.sqrt(2 * g * (apex - c.y));
    const b = vy - g / 2;
    let T = Math.round((b + Math.sqrt(b * b - 2 * g * (w0.y - c.y))) / g);
    T = T < GRAB.THROW_T[0] ? GRAB.THROW_T[0] : T > GRAB.THROW_T[1] ? GRAB.THROW_T[1] : T;
    _to.x = spot.x;
    _to.y = w0.y;
    _to.z = spot.z;
    aimVelocity(c, _to, T, _aim, g);
    f.T = T;
    f.g = g;
    f.x0 = c.x;
    f.y0 = c.y;
    f.z0 = c.z;
    f.vx = _aim.x;
    f.vy = _aim.y;
    f.vz = _aim.z;
    f.q0.copy(this.fq);
    // Flying: it levels out, spinning flat the way it was swung (fast at first, then slower)
    // and barrel-rolling, limbs flailing; it comes down on its back along the nearest wall.
    f.h0 = phi;
    f.dir = dir;
    f.w = w;
    whirlQuaternion(spot.heading, GRAB.WRECK_PITCH, Math.PI, f.qEnd);
    // Spin and roll end lined up with the wreck by tAlign: the turn nearest the natural one
    // that ends on its heading, and a whole number of rolls.
    f.tAlign = T - GRAB.CRASH_BLEND;
    f.spinScale = 1;
    f.rollScale = 1;
    const nat = this._spinTurn(f.tAlign);
    let turn = wrapAngle((spot.heading - phi) * dir);
    turn += TAU * Math.round((nat - turn) / TAU);
    if (turn < 0.5) turn += TAU;
    if (nat > 0.5) f.spinScale = turn / nat;
    const roll = GRAB.FLY_ROLL * f.tAlign;
    const rolls = Math.round(roll / TAU);
    f.rollScale = roll > 1e-6 ? ((rolls < 1 ? 1 : rolls) * TAU) / roll : 1;
    f.dirX = tx * hl;
    f.dirZ = tz * hl;
    this.state = 'thrown';
    this.t = 0;
    this.anchored = false;
    this.events.emit('sfx', { name: 'boss_throw', pos: { x: player.pos.x, y: player.pos.y + 100, z: player.pos.z } });
    this.events.emit('bossThrown', {
      flight: { x0: f.x0, y0: f.y0, z0: f.z0, vx: f.vx, vy: f.vy, vz: f.vz, T, g },
      to: { x: w0.x, y: w0.floorY, z: w0.z },
      water,
    });
    this._roar(1.3);
  }

  // The flying orientation t ticks after the throw (into `out`): the flat spin and the roll.
  // (Spin and roll are scaled so that by tAlign they end lined up with the wreck: no part of it
  // sweeps round as it comes down.)
  _flyQuat(t, out) {
    const f = this.fly;
    const ta = t < f.tAlign ? t : f.tAlign;
    const heading = f.h0 + f.dir * this._spinTurn(ta) * f.spinScale;
    return whirlQuaternion(heading, GRAB.FLY_PITCH, Math.PI + f.dir * GRAB.FLY_ROLL * ta * f.rollScale, out);
  }

  // How far (radians) the flat spin has turned t ticks after the throw: nothing while it is
  // still held steep (FLY_HOLD), easing in as it levels out (FLY_SETTLE: its tail swings up
  // first), fast at first, then slower (FLY_SPIN_DECAY), then FLY_YAW.
  _spinTurn(t) {
    const f = this.fly;
    const k = GRAB.FLY_SPIN_DECAY;
    const S = GRAB.FLY_SETTLE;
    const u = t - GRAB.FLY_HOLD;
    const ts = u <= 0 ? 0 : u < S ? (u * u) / (2 * S) : u - S / 2;
    return f.w * GRAB.FLY_SPIN * k * (1 - Math.exp(-ts / k)) + GRAB.FLY_YAW * ts;
  }

  // Where a throw from (cx, cz) heading (dx, dz) comes down: the first spot along that line (or,
  // failing that, one swung further round) at least LAND_MARGIN outside the castle's footprint
  // (LAND_MARGIN_FRONT in front of it), LAND_EDGE inside the level's perimeter, on low ground or
  // water, where the wreck fits (_wreckFit). Fills and returns _spot (heading: the wreck's).
  _landingSpot(cx, cz, dx, dz) {
    const L = this.layout;
    const C = L?.CASTLE;
    const PER = L?.PERIMETER;
    const M = GRAB.LAND_MARGIN;
    const col = this.collision;
    for (let n = 0; n < 21; n++) {
      // 0, +0.3, -0.3, +0.6, ... radians off the throw's heading.
      const a = n === 0 ? 0 : (n % 2 ? 1 : -1) * ((n + 1) >> 1) * 0.3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ux = dx * ca + dz * sa;
      const uz = dz * ca - dx * sa;
      for (let d = 900; d <= 12000; d += 250) {
        const x = cx + ux * d;
        const z = cz + uz * d;
        if (PER && sdRoundRect(x, z, PER) > -GRAB.LAND_EDGE) break;
        if (C && x > C.x - C.halfWidth - M && x < C.x + C.halfWidth + M && z > C.backZ - M && z < C.frontZ + GRAB.LAND_MARGIN_FRONT) continue;
        const f = col.findFloor(x, 1e5, z);
        if (!f.surface && !C) continue;
        if (f.y > 1300) continue;
        const floorY = f.surface ? f.y : 0;
        const water = col.waterLevelAt ? col.waterLevelAt(x, z) : NO_WATER;
        const heading = this._wreckFit(x, z, floorY, water !== NO_WATER && water > floorY, ux, uz);
        if (heading === null) continue;
        _spot.x = x;
        _spot.z = z;
        _spot.floorY = floorY;
        _spot.water = water;
        _spot.heading = heading;
        return _spot;
      }
    }
    // Nowhere along any of those: straight out in front of it.
    _spot.x = this.x + Math.sin(this.yaw) * 5000;
    _spot.z = this.z + Math.cos(this.yaw) * 5000;
    const f = col.findFloor(_spot.x, 1e5, _spot.z);
    _spot.floorY = f.surface ? f.y : 0;
    _spot.water = col.waterLevelAt ? col.waterLevelAt(_spot.x, _spot.z) : NO_WATER;
    _spot.heading = this.yaw + Math.PI / 2;
    return _spot;
  }

  // The heading a wreck lying on its back at (x, z) can take (its head WRECK_HEAD one way, its
  // tail WRECK_TAIL the other): along the castle's walls or across them (tried from closest to
  // the flight's heading (ux, uz)), both ends LAND_END clear of the castle's footprint and
  // inside the perimeter, and on land the ground along it level with the spot (no mound, rock,
  // fence or server hall under it). null: it does not fit there.
  _wreckFit(x, z, floorY, water, ux, uz) {
    const L = this.layout;
    const C = L?.CASTLE;
    const PER = L?.PERIMETER;
    const col = this.collision;
    const E = GRAB.LAND_END;
    for (let pass = 0; pass < 4; pass++) {
      // The four headings, best-aligned with the flight first.
      const alongX = (ux > 0 ? ux : -ux) >= (uz > 0 ? uz : -uz) ? pass < 2 : pass >= 2;
      const flip = pass % 2 === 1;
      let hx = alongX ? (ux >= 0 ? 1 : -1) : 0;
      let hz = alongX ? 0 : uz >= 0 ? 1 : -1;
      if (flip) {
        hx = -hx;
        hz = -hz;
      }
      let ok = true;
      for (let s = -GRAB.WRECK_TAIL; s <= GRAB.WRECK_HEAD && ok; s += 300) {
        // Three lanes: its middle and either side (the width of it lying on its back).
        for (let lane = -1; lane <= 1 && ok; lane++) {
          const px = x + hx * s - hz * lane * GRAB.WRECK_HALF_WIDTH;
          const pz = z + hz * s + hx * lane * GRAB.WRECK_HALF_WIDTH;
          if (PER && sdRoundRect(px, pz, PER) > -E) ok = false;
          else if (C && px > C.x - C.halfWidth - E && px < C.x + C.halfWidth + E && pz > C.backZ - E && pz < C.frontZ + E) ok = false;
          else if (this.blocked !== null && this.blocked(px, pz, 200)) ok = false;
          else {
            const f = col.findFloor(px, 1e5, pz);
            const w = col.waterLevelAt ? col.waterLevelAt(px, pz) : NO_WATER;
            const wet = w !== NO_WATER && f.surface && w > f.y + 150;
            // In water: water all along it (it sinks there); on land: level, dry ground.
            if (water) ok = lane !== 0 || wet;
            else if (wet || !f.surface || f.y > floorY + GRAB.LAND_BUMP || f.y < floorY - 3 * GRAB.LAND_BUMP) ok = false;
          }
        }
      }
      // Clear of the trees (trunks and canopies).
      const trees = this.level?.trees;
      if (ok && trees) {
        const ax = x - hx * GRAB.WRECK_TAIL;
        const az = z - hz * GRAB.WRECK_TAIL;
        const len = GRAB.WRECK_TAIL + GRAB.WRECK_HEAD;
        for (let i = 0; i < trees.length && ok; i++) {
          const tr = trees[i];
          let along = (tr.x - ax) * hx + (tr.z - az) * hz;
          along = along < 0 ? 0 : along > len ? len : along;
          const ex = tr.x - (ax + hx * along);
          const ez = tr.z - (az + hz * along);
          const clear = (tr.canopy?.radius ?? 300) + GRAB.WRECK_HALF_WIDTH + 150;
          if (ex * ex + ez * ez < clear * clear) ok = false;
        }
      }
      if (ok) return Math.atan2(hx, hz);
    }
    return null;
  }

  _flyTick() {
    const P = this.cur;
    const f = this.fly;
    const t = this.t;
    // The waist on its arc (flightPoint): its tail levels out over the roof it came from as it
    // shoots up, then it drops onto the spot.
    flightPoint(f, t, _h);
    this._flyQuat(t, _qa);
    if (t < GRAB.FLY_HOLD + GRAB.FLY_SETTLE) this.fq.slerpQuaternions(f.q0, _qa, smooth((t - GRAB.FLY_HOLD) / GRAB.FLY_SETTLE));
    else this.fq.copy(_qa);
    const left = f.T - t;
    if (left < GRAB.CRASH_BLEND) this.fq.slerp(f.qEnd, smooth(1 - left / GRAB.CRASH_BLEND));
    // The tail curls back as it goes, and lies out straight behind it again as it lands.
    this.fk = 1 - 0.65 * smooth(t / 24) + 0.55 * smooth(1 - left / GRAB.CRASH_BLEND);
    _g.copy(WAIST).multiplyScalar(BEAST.SCALE).applyQuaternion(this.fq);
    this.fpos.copy(_h).sub(_g);
    P[CH.FLAIL] = 1;
    P[CH.JAW] = 1;
    P[CH.POWER] = 1;
    P[CH.GRIP] = 0.4;
    P[CH.ARMS] = 1;
    const land = left < GRAB.CRASH_BLEND ? smooth(1 - left / GRAB.CRASH_BLEND) : 0;
    P[CH.NECK_PITCH] = -0.35 + 0.2 * Math.sin(t * 0.3) + 1.05 * land;
    P[CH.HEAD_PITCH] = -0.4 + 1 * land;
    P[CH.TAIL] = 1 - land;
    if (t >= f.T) this._crash();
  }

  // Down: the blast (or the splash), 'bossDefeated'.
  _crash() {
    const w = this.wreckPos;
    const pos = { x: w.x, y: w.floorY, z: w.z };
    this.state = 'wrecked';
    this.t = 0;
    this.defeats++;
    const fx = this.fx;
    if (w.water) {
      fx?.explode?.(w.x, w.floorY + 60, w.z, { radius: 380 });
      fx?.dust?.(w.x, w.floorY, w.z, { radius: 900, count: 30 });
      this.events.emit('splash', { pos, big: true });
      this.events.emit('sfx', { name: 'boss_splash', pos });
      this._steam(w.x, w.floorY, w.z, 24);
    } else {
      fx?.explode?.(w.x, w.floorY + 260, w.z, { radius: 1100 });
      const f = this.fly;
      fx?.explode?.(w.x + 900 * f.dirX, w.floorY + 150, w.z + 900 * f.dirZ, { radius: 650 });
      fx?.explode?.(w.x - 900 * f.dirX, w.floorY + 120, w.z - 900 * f.dirZ, { radius: 500 });
      fx?.dust?.(w.x, w.floorY, w.z, { radius: 1100, count: 44, sparks: 44, debris: 36 });
      fx?.ignite?.(w.x, w.floorY + 60, w.z, { radius: 420, duration: 7, intensity: 1 });
      this.level?.addScorch?.(w.x, w.z, 1200);
      this.events.emit('sfx', { name: 'boss_crash', pos });
    }
    this.events.emit('bossImpact', { pos, strength: w.water ? 2 : 3, kind: w.water ? 'splash' : 'crash' });
    this.events.emit('bossDefeated', { pos, water: w.water });
  }

  // Steam puffs rising off the water (fire sprites).
  _steam(x, y, z, n) {
    const fire = this.fire;
    if (!fire) return;
    const rng = this.rng;
    const t0 = this.clockNow;
    for (let i = 0; i < n; i++) {
      const s = fire.spawn(t0, 1.4 + rng() * 1.6, FIRE.PUFF);
      if (!s) return;
      const a = rng() * TAU;
      const r = rng() * 700;
      s.x = x + Math.cos(a) * r;
      s.y = y + 30;
      s.z = z + Math.sin(a) * r;
      s.vx = Math.cos(a) * 80;
      s.vy = 260 + rng() * 260;
      s.vz = Math.sin(a) * 80;
      s.size0 = 220;
      s.size1 = 700;
      s.a0 = 0.7;
      s.ramp = RAMP.steam;
    }
  }

  _wreckTick() {
    const P = this.cur;
    const w = this.wreckPos;
    const t = this.t;
    P[CH.FLAIL] = t < 40 ? 0.8 * (1 - t / 40) : 0.08 * (Math.sin(t * 1.7) > 0.95 ? 1 : 0);
    P[CH.JAW] = 0.9 - 0.4 * clamp01(t / 60);
    P[CH.POWER] = t < 50 ? ((t >> 1) % 3 === 0 ? 0.15 : 0.8 - t / 70) : 0;
    P[CH.GRIP] = 0;
    P[CH.ARMS] = 0.8;
    P[CH.NECK_PITCH] = 0.7;
    P[CH.HEAD_PITCH] = 0.6;
    this.fk = this.fk + (0.9 - this.fk) * 0.1;
    // Lying on its back where it came down (the flight's end pose), then sinking away (water:
    // at once, steaming).
    const sinkFrom = w.water ? 20 : GRAB.WRECK_TICKS;
    const sinkTicks = w.water ? 70 : GRAB.SCRAP_TICKS;
    if (t === sinkFrom) {
      this.starDue = true;
      if (!w.water) this.fx?.dust?.(w.x, w.floorY, w.z, { radius: 900, count: 26, debris: 12 });
      else this._steam(w.x, w.floorY, w.z, 10);
    }
    if (t > sinkFrom) {
      const e = smooth((t - sinkFrom) / sinkTicks);
      this.fpos.y = this.fposPrev.y - (GRAB.SCRAP_DEPTH / sinkTicks) * (0.5 + e);
    }
    if (t % 3 === 0 && t > sinkFrom && !w.water) this.fx?.dust?.(w.x, w.floorY, w.z, { radius: 500, count: 3 });
    if (t >= sinkFrom + sinkTicks) {
      const again = this.riseAfter;
      this._hide();
      this.riseAfter = false;
      if (again) this.setMode(true);
    }
  }

  // Twisting free: back onto its perch in a high arc, slamming down on the ridge.
  _startFall() {
    const fr = this.from;
    this._poseAt(this.cur, this.clockNow, 1);
    fr.q.copy(this.fq);
    fr.pos.copy(this.root.position);
    fr.k = this.fk;
    this.fpos.copy(fr.pos);
    this.fposPrev.copy(fr.pos);
    this.state = 'fall';
    this.t = 0;
    this.anchored = false;
    const g = this.grip;
    g.held = g.lead = g.whirling = false;
    this._roar(1.05);
  }

  _fallTick() {
    const P = this.cur;
    const fr = this.from;
    const u = this.t / GRAB.FALL_TICKS;
    const e = smooth(u);
    this.fq.slerpQuaternions(fr.q, this.restQ, smooth(u * 1.3));
    this.fk = fr.k * (1 - smooth(u * 1.2));
    const lift = GRAB.FALL_ARC * Math.sin(Math.PI * (u < 1 ? u : 1));
    this.fpos.set(fr.pos.x + (this.x - fr.pos.x) * e, fr.pos.y + (this.baseY - fr.pos.y) * e + lift, fr.pos.z + (this.z - fr.pos.z) * e);
    P[CH.FLAIL] = 1 - e;
    P[CH.JAW] = 0.9;
    P[CH.POWER] = 1;
    P[CH.GRIP] = 0.5;
    P[CH.ARMS] = 0.7 * (1 - e);
    if (this.t >= GRAB.FALL_TICKS) {
      // Slammed down on the ridge: back to its business (or sinking, if the mode ended).
      this.state = 'active';
      this.t = 0;
      this.mode = 'idle';
      this.grace = GRAB.RELEASE_GRACE;
      if (this.attackIn < GRAB.RELEASE_GRACE) this.attackIn = GRAB.RELEASE_GRACE;
      this.jolt = 14;
      this._slam(this.x, this.baseY, this.z - 600, 1.3);
      if (this.sinkAfter) {
        this.sinkAfter = false;
        this.setMode(false);
      }
    }
  }

  // A heavy landing on its perch (or its tail slammed down): dust, sparks, a shake, a slam.
  _slam(x, y, z, strength) {
    const pos = { x, y, z };
    this.fx?.dust?.(x, y, z, { radius: 400 + 400 * strength, count: 22, sparks: 22, debris: 14 });
    this.events.emit('sfx', { name: 'boss_slam', pos });
    this.events.emit('bossImpact', { pos, strength, kind: 'slam' });
  }

  // ------------------------------------------------------------------ shots

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

  // Sparks and smoke from the exhaust vents (more while charging, roaring, flailing or wrecked)
  // and embers dripping from the open jaw.
  _sparks(tick) {
    const fire = this.fire;
    if (!fire || this.state === 'hidden') return;
    const P = this.cur;
    const busy = P[CH.CHARGE] > 0.2 || this.roarT >= 0 || P[CH.FLAIL] > 0.3 || this.state === 'wrecked';
    if (!busy && tick % 3 !== 0) return;
    const rng = this.rng;
    const t0 = this.clockNow;
    this._poseAt(P, t0, 1);
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
      if (rng() < (this.state === 'wrecked' ? 0.8 : 0.3)) {
        const s = fire.spawn(t0, 0.9 + rng() * 0.5, FIRE.PUFF);
        if (!s) return;
        s.x = _v.x;
        s.y = _v.y + 20;
        s.z = _v.z;
        s.vx = (rng() - 0.5) * 60;
        s.vy = 160 + rng() * 80;
        s.vz = -60;
        s.size0 = 90;
        s.size1 = this.state === 'wrecked' ? 520 : 260;
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
    // The coupling sheds sparks while it is whirled.
    if (P[CH.FLAIL] > 0.5 && P[CH.GRIP] > 0.9 && rng() < 0.7) {
      this._mark(this.marks.grip, _v);
      const p = fire.spawn(t0, 0.3 + rng() * 0.3, FIRE.SPARK);
      if (!p) return;
      p.x = _v.x;
      p.y = _v.y;
      p.z = _v.z;
      p.vx = (rng() - 0.5) * 500;
      p.vy = 100 + rng() * 300;
      p.vz = (rng() - 0.5) * 500;
      p.gy = -1200;
      p.size0 = 30;
      p.size1 = 6;
      p.ramp = RAMP.spark;
    }
  }

  // ------------------------------------------------------------------ pose

  // The pose for channels P at clock time `clock`, `alpha` into the tick for the free pose.
  _poseAt(P, clock, alpha) {
    if (FREE.has(this.state)) this._poseFree(P, clock, alpha);
    else this._pose(P, clock);
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
    root.quaternion.copy(this.restQ);
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
    // Tail: a slow sway near its root and a thrash when roused; the far part turns back against
    // the root's sway, so the end lying on the rear roof (the coupling) barely moves. Held, it
    // only quivers with the strain.
    const thrash = P[CH.TAIL];
    if (this.state === 'held') {
      // Held: its tail thrashes, swinging round the line from its root to the coupling like a
      // skipping rope, so the end stays put in the hero's hands.
      const psi = 0.075 * Math.sin(clock * 5.5) + 0.03 * Math.sin(clock * 9.1);
      this.tailA.quaternion.setFromAxisAngle(HELD_AXIS, psi);
      this.tailB.quaternion.setFromAxisAngle(GRIP_B_DIR, 0.05 * Math.sin(clock * 19));
      return;
    }
    const aYaw = 0.02 * Math.sin(clock * 0.6) + 0.035 * thrash * Math.sin(clock * 4.2);
    const aLift = 0.03 * thrash * (1 + Math.sin(clock * 5.3));
    this.tailA.rotation.set(aLift, aYaw, 0);
    this.tailB.rotation.set(-1.5 * aLift, -1.3 * aYaw + 0.012 * Math.sin(clock * 0.7 - 0.9) + 0.03 * thrash * Math.sin(clock * 5.1 - 0.8), 0.02 * Math.sin(clock * 0.8));
  }

  // The free pose: the limbs from the channels (flailing), the tail pulled straight by fk, and
  // the root from fq with either the coupling in the hero's hands (anchored) or fpos, all
  // interpolated `alpha` into the tick.
  _poseFree(P, clock, alpha) {
    this._pose(P, clock);
    const tuck = P[CH.TUCK];
    if (tuck > 0) {
      this.armL.rotation.x += tuck * BEAST.ARM_TUCK * 1.4;
      this.armR.rotation.x += tuck * BEAST.ARM_TUCK * 1.4;
      this.armL.rotation.z += tuck * 0.3;
      this.armR.rotation.z -= tuck * 0.3;
    }
    const fl = P[CH.FLAIL];
    if (fl > 0) {
      const w = clock * 9;
      this.armL.rotation.x += fl * 0.7 * Math.sin(w);
      this.armL.rotation.z -= fl * (0.5 + 0.3 * Math.sin(w * 1.3));
      this.armR.rotation.x += fl * 0.7 * Math.sin(w + 2.1);
      this.armR.rotation.z += fl * (0.5 + 0.3 * Math.sin(w * 1.2 + 1));
      this.neck.rotation.y += fl * 0.4 * Math.sin(clock * 4.3);
      this.neck.rotation.x += fl * 0.15 * Math.sin(clock * 3.1);
      this.head.rotation.y += fl * 0.3 * Math.sin(clock * 5.2 + 0.7);
      this.head.rotation.z += fl * 0.25 * Math.sin(clock * 3.7);
      this.torso.rotation.y += fl * 0.1 * Math.sin(clock * 2.9);
    }
    const k = this.fkPrev + (this.fk - this.fkPrev) * alpha;
    this.tailA.quaternion.slerpQuaternions(IDENT, TAIL_A_STRAIGHT, k);
    this.tailB.quaternion.slerpQuaternions(IDENT, TAIL_B_STRAIGHT, k);
    const thrash = P[CH.TAIL];
    if (thrash > 0) {
      _q.setFromAxisAngle(UP, thrash * 0.25 * Math.sin(clock * 6.3));
      this.tailB.quaternion.multiply(_q);
    }
    const root = this.root;
    root.quaternion.slerpQuaternions(this.fqPrev, this.fq, alpha);
    if (this.anchored) {
      _h.lerpVectors(this.handPrev, this.hand, alpha);
      // The grip in the root's space for this tail pose, then turned with the root.
      _g.copy(GRIP_B).applyQuaternion(this.tailB.quaternion).add(B0_A).applyQuaternion(this.tailA.quaternion).add(A0);
      _g.multiplyScalar(BEAST.SCALE).applyQuaternion(root.quaternion);
      root.position.copy(_h).sub(_g);
    } else {
      root.position.lerpVectors(this.fposPrev, this.fpos, alpha);
    }
  }

  animate(alpha, clock, camera = null) {
    this.lastClock = clock;
    this.camera = camera;
    if (this.state === 'hidden') return;
    const P = this.draw;
    const a = this.prev;
    const b = this.cur;
    for (let i = 0; i < N_CH; i++) P[i] = a[i] + (b[i] - a[i]) * alpha;
    this._poseAt(P, clock, alpha);
    this.root.updateMatrixWorld(true);
    const u = this.uniforms;
    const since = clock - this.flashAt;
    u.uCharge.value = P[CH.CHARGE];
    u.uPower.value = P[CH.POWER];
    u.uFlash.value = since >= 0 && since < 0.6 ? this.flashStrength * 0.7 * (1 - since / 0.6) : 0;
    u.uGrip.value = this._gripGlow(P[CH.GRIP], clock);
    this._glows(P, clock);
  }

  // The coupling's glow: a slow pulse while it can be grabbed (GRIP ~0.5), steady and bright
  // once held (1).
  _gripGlow(g, clock) {
    if (g <= 0.01) return 0;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 5.5);
    const held = g > 0.5 ? (g - 0.5) * 2 : 0;
    return g * (0.6 + 0.8 * pulse) * (1 - held) + held * 1.3;
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

  // Additive glows: the side optics, the chest furnace, the exhaust vents, the throat and
  // dewlap while charging, and the tail's coupling (pulsing while it can be grabbed).
  _glows(P, clock = 0) {
    if (!this.fire) return;
    const power = P[CH.POWER];
    const charge = P[CH.CHARGE];
    const m = this.marks;
    const grip = P[CH.GRIP];
    if (grip > 0.01) {
      // Pulsing and big while it waits to be grabbed; small once held (the hero's hands are
      // there, the glow must not hide them).
      this._glowAt(m.grip, _v);
      const pulse = 0.5 + 0.5 * Math.sin(clock * 5.5);
      const wait = grip < 0.75 ? 1 : (1 - grip) * 4;
      if (!this._glow(90 + wait * (160 + 160 * pulse), TINTS.core, 0.3 + wait * (0.2 + 0.4 * pulse))) return;
    }
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
