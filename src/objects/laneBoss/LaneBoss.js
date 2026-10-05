// STOMPWATT, Sparrow Lane's boss (the lane's lazy chunk: objects/laneBoss/index.js attaches it):
// the dad's car, woken by Jonas, stands up into a chunky, cheeky robot made of its own panels
// (docs/ARCHITECTURE.md "STOMPWATT"). It wakes and transforms (here), then fights him on the
// dad's drive and the street (fight.js, mixed into this class: its attacks, its battery running
// low and the charging window at the wall charger, the hits, its defeat and reward star); beaten
// it folds back into the car, reverses into its slot and stays tame until a new game. Away from
// it a while, or after a lost life, it walks home, folds back and parks (its hits kept).
//
//   new LaneBoss({ objects, area, layout })   objects: the lane's ObjectManager (events,
//       sparkles, view, bins, coins), area: world/area.js's Area (its collision, the named
//       colliders, the classic part's hide range), layout: lane/layout.js
//   boss.update(player, tick, hold)   30 Hz, after the player's tick (hold: a dialog or a warp)
//   boss.animate(alpha, clock, camera)   per frame: both looks' rigs posed between the last two
//                                     ticks, the markers, the cable, the reward star
//   boss.setLook(part | null)         the realistic part shown (its model built then; its hide
//                                     range), or the classic look again
//   boss.reset()                      a new game: parked at once, unbeaten, its star taken back,
//                                     its first wake's intro again
//   boss.enter()                      an arrival: parked at once (tame if beaten; hits kept)
//   boss.state                        'parked' | 'notice' | 'wake' | 'home' | 'shoo' | 'unmorph' |
//                                     'settle' | 'tame' (| 'pose': posed by hand, pose()) and the
//                                     fight's (fight.js)
//   boss.hits, boss.beaten            its power lights out (0 .. 3), beaten this game
//   boss.cinematic                    the intro holds Jonas (main: a neutral controller)
//   boss.camera                       its camera overlay (camera.js; main hands it to the camera)
//   boss.markers, boss.star           its ground markers and wave (markers.js), its reward star
//   boss.pose({ m, pose, yaw, ... })  posed by hand (previews, shots, tests): see there
//   boss.cur                          this tick's pose state (rig.js / model.js Rig.pose)
//
// Waking (layout.LANE_BOSS.wake): Jonas on the drive's level (his feet within `level` of its
// ground), on the ground, within `r` of the car's middle for `dwell` ticks, or touching it (his
// feet against its sides, or his attack on it); never while he is up on the bins, the carport or
// a roof, on the car itself, away (Critters.js AWAY: reading, on a pole or a ledge, ...), blinking
// after a hit, in a dialog or a warp; and once it has parked again, not until he has been REARM
// away from it (so he may climb the car). From `notice` its T lights blink at him now and then
// with a soft chirp, its indicators flashing amber (as with its wake's blinks and the tame car's
// hello). Up, its T lights show its mood (_mood: angry in its attacks, tired with its battery low,
// bored, sheepish, dizzy and spinning: BOSS.MOOD); it rocks on its wheels as it rises. Its first wake of a game is an intro (150 ticks: Jonas held, the camera's
// own, its name card); later wakes are quick (60 ticks).
//
// The car's collider (named dad_ev: lane/props.js) is parked under the world (moveSurfaces) from
// the wake's first tick until the car has settled back on its wheels, then put back exactly
// where it was; if he stands where the car settles, he is lifted onto it. The parked car is
// drawn by the street's own meshes (hidden by their draw range while the robot is up: area part
// .hide.dad_ev); the robot's car form is exactly those triangles, so the swap never shows.
//
// Deterministic (no Math.random, no clock): its idle moves and blinks come from a hash of the
// tick. Allocation: none per tick or frame on its hot paths but event payloads and collision
// results.

import { PLAYER_RADIUS } from '../../core/constants.js';
import { moveSurfaces } from '../../collision/CollisionWorld.js';
import { AWAY } from '../Critters.js';
import { heroInvincible } from '../Minions.js';
import { TINT } from '../Sparkles.js';
import { BlobShadows } from '../BlobShadows.js';
import { BOSS } from './tuning.js';
import { BONE, STEP_UP, ATTACH, arrive, unfold, footLift } from './rig.js';
import { N, INDEX, POSE } from './poses.js';
import { RobotModel, classicCar } from './model.js';
import { LaneBossCam } from './camera.js';
import { FIGHT_METHODS, FIGHTING } from './fight.js';
import { BOSS_CARD } from '../../ui/hudLogic.js';

const MOVERS = Object.keys(ATTACH);
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
// Cheap deterministic noise in 0 .. 1 (as the critters').
const noise = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
// The pitch of each piece's clunk as it locks in (big pieces lower).
const CLUNK = { core: 0.7, tail: 0.75, canopy: 0.72, head: 0.8, doorFL: 0.95, doorFR: 1, doorRL: 1.05, doorRR: 1.1, wheelFL: 1.2, wheelFR: 1.25, wheelRL: 1.15, wheelRR: 1.18 };
const CONTACT_GONE = 0.25; // (the realistic car's contact shadow hidden this far into the morph)
const BLOB = 230; // (the classic look's shadow under each foot, across)
const UP = { x: 0, y: 1, z: 0 };
const AMBER = [1, 0.6, 0.12]; // (its indicators' flash)
const _amber = { x: 0, y: 0, z: 0 };
// A step's legs (hip, knee, ankle) and their turns about x at its top.
const LEG_L = [INDEX.hipL, INDEX.knL, INDEX.anL];
const LEG_R = [INDEX.hipR, INDEX.knR, INDEX.anR];
const STEP_X = [STEP_UP.hip[0], STEP_UP.kn[0], STEP_UP.an[0]];

function makeState() {
  return { x: 0, y: 0, z: 0, yaw: 0, m: 0, lift: 0, bob: 0, turns: new Float32Array(N * 3), blinkL: 0, blinkR: 0, hatch: 0, gate: 0, lights: 3, spin: 0, heel: 0, rollL: 0, rollR: 0, eyeLen: 1, rock: 0 };
}
// States in which its head follows him (and its eyes blink by themselves).
const LOOKING = { shoo: 1, stand: 1, watch: 1, gap: 1, stomp_tell: 1, dash_tell: 1, swipe_tell: 1, dizzy: 1, walk: 1, unplug: 1 };
// Its eyes' mood in each fight state (BOSS.MOOD; the others 'set': ready, a little narrowed).
const MOODS = { stomp_tell: 'angry', stomp_hop: 'angry', stomp_land: 'angry', dash_tell: 'angry', dash: 'angry', dash_skid: 'angry', swipe_tell: 'angry', swipe: 'angry', low: 'tired', kneel: 'tired', plug: 'tired', open: 'tired', zapped: 'dizzy', dizzy: 'dizzy', dash_bonk: 'dizzy', shortout: 'dizzy', home: 'calm', shoo: 'calm', unmorph: 'calm', wake: 'calm' };
// Car-form states (no frame posing, no bump on its body).
const CAR_FORM = { parked: 1, notice: 1, tame: 1, reverse: 1, settle: 1 };

export class LaneBoss {
  constructor({ objects, area, layout }) {
    this.objects = objects;
    this.events = objects.events;
    this.collision = area.collision;
    this.layout = layout;
    const spec = layout.LANE_BOSS;
    this.spec = spec;
    const car = layout.CARS.find((c) => c.id === spec.car);
    this.car = car;
    const K = layout.CAR_KINDS[car.kind];
    this.hw = K.w / 2;
    this.hl = K.l / 2;
    this.top = K.roof;
    const o = area.objectsLayout.ORIGIN ?? { x: 0, y: 0, z: 0 };
    this.spot = { x: car.x + o.x, y: layout.groundHeight(car.x, car.z) + o.y, z: car.z + o.z }; // (its ground: the drive)
    this.yaw0 = car.yaw;
    const named = area.objectsLayout.NAMED?.[spec.car];
    if (!named) throw new Error(`LaneBoss: no collider named ${spec.car}`);
    this.named = named;
    this.carSurfaces = new Set(named.surfaces);
    // The parked car's faces in the street's meshes (hidden while it is up): the classic part's,
    // and the realistic part's once shown.
    this.hides = []; // [{ mesh, first }] of every part it was shown in (both looks')
    this.parts = new Set();
    for (const part of area.parts) this._hideRange(part);
    this.real = null;
    // The models: the classic one now (its programs warmed ahead), the realistic one once its
    // part is shown.
    this.group = objects.group;
    this.classic = new RobotModel('classic', classicCar(layout, area.parts[0]), { tint: car.classicTint ?? car.tint, light: area.parts[0].light, hl: this.hl });
    this.classic.group.visible = false;
    this.group.add(this.classic.group);
    objects.view?.prewarm?.(this.classic.group);
    this.realModel = null;
    this.models = [this.classic];
    // (The classic look's: a blob shadow under each foot, the realistic look's are the sun's;
    // and its reward star's, in both looks.)
    this.blobs = new BlobShadows(3);
    this.blobs.mesh.visible = false;
    this.blobs.mesh.name = 'lane-boss-shadows';
    this.group.add(this.blobs.mesh);
    this.camera = new LaneBossCam(area.collision);
    this.prev = makeState();
    this.cur = makeState();
    this.draw = makeState();
    this.ease = new Float32Array(N * 3); // the frame's turns, easing toward the goal pose
    this.goal = POSE.stand;
    this.chestBone = BONE.chest;
    this.player = null;
    this._from = { x: 0, y: 0, z: 0 }; // (a hurt's fromPos, reused)
    this.hurts = 0; // wedges it took off him (tests)
    this.kneelBob = 0;
    this.kneeling = false;
    this.noticeT = 0;
    this.beatenFold = false;
    this.eyes = false; // (a state drives its eyes itself this tick)
    this.look = 0; // (its head turned toward him, round, down, tilted)
    this.lookUp = 0;
    this.tilt = 0;
    this.warm = false;
    this.blinkT = 0;
    this.nextBlink = 0;
    this.turning = false;
    this.stepT = 0;
    this._initFight(objects, area, layout);
    for (const part of area.parts) this._cableOf(part);
    this._parkNow();
    this.introDone = false;
    this.armed = true;
  }

  // ---------------------------------------------------------------- looks

  _hideRange(part) {
    if (this.parts.has(part)) return;
    this.parts.add(part);
    for (const [name, first] of Object.entries(part?.hide?.[this.spec.car] ?? {})) {
      const mesh = part.object3D.getObjectByName(name);
      // (The realistic contact shadow stays under the car until it parts: the model has none.)
      if (mesh) this.hides.push({ mesh, first, contact: name.endsWith('-contact') });
    }
  }

  setLook(part) {
    this.real = part;
    if (part) {
      this._hideRange(part);
      this._cableOf(part);
      if (!this.realModel && part.robot) {
        const tier = part.robot.tier;
        this.realModel = new RobotModel(tier, part.robot, { tint: this.car.tint, hl: this.hl });
        this.realModel.group.visible = false;
        this.group.add(this.realModel.group);
        this.models.push(this.realModel);
        this.warm = true; // (its programs compiled as the look draws, on the next frame: _warm)
      }
    }
    this._show(this.shown);
  }

  // The robot (its skinned meshes, the current look's) shown and the parked car hidden, or back.
  // (A realistic look with no model of it yet keeps the parked car.)
  _show(on) {
    this.shown = on;
    const model = this.real ? this.realModel : this.classic;
    const vis = on && model !== null;
    this.classic.group.visible = vis && model === this.classic;
    if (this.realModel) this.realModel.group.visible = vis && model === this.realModel;
    const list = this.hides;
    const parted = this.cur.m > CONTACT_GONE;
    this.parted = parted;
    for (let i = 0; i < list.length; i++) list[i].mesh.geometry.drawRange.count = vis && (parted || !list[i].contact) ? list[i].first : Infinity;
  }

  // The car's collider parked under the world (the robot is up) or back where it was, exactly.
  _collider(parked) {
    if (this.colliderParked === parked) return;
    this.colliderParked = parked;
    moveSurfaces(this.named.surfaces, this.named.rest, 0, parked ? BOSS.PARK : 0, 0);
  }

  // ---------------------------------------------------------------- states

  get cinematic() {
    return this.state === 'wake' && this.intro;
  }

  _set(state) {
    this.state = state;
    this.t = 0;
  }

  // Parked at once (an arrival, a new game, construction): the car on its spot, its collider in
  // place, the robot hidden.
  _parkNow() {
    const c = this.cur;
    c.x = this.spot.x;
    c.y = this.spot.y;
    c.z = this.spot.z;
    c.yaw = this.yaw0;
    c.m = 0;
    c.lift = 0;
    c.bob = 0;
    c.blinkL = c.blinkR = 0;
    c.hatch = 0;
    c.gate = 0;
    c.spin = c.heel = 0;
    c.rollL = c.rollR = c.rock = 0;
    c.eyeLen = 1;
    c.lights = 3 - this.hits;
    c.turns.set(POSE.fold);
    this.ease.set(POSE.stand);
    this.goal = POSE.stand;
    this._clearFight();
    this.kneelBob = 0;
    this.kneeling = false;
    this.beatenFold = false;
    this.wait = 0;
    this.noticeT = 0;
    this._copy(this.prev, c);
    this._set(this.beaten ? 'tame' : 'parked');
    // (Beaten but parked at once before its star rose: it rises now.)
    if (this.beaten && !this.star.awarded) this.starDue = true;
    this.dwell = 0;
    this.lastNotice = -Infinity;
    this.intro = false;
    this.leave = false;
    this.lifting = false;
    this.camera.reset();
    this._collider(false);
    this._show(false);
  }

  // A new game: unbeaten, its lights all on, its star hidden and taken back off his count.
  reset() {
    this.hits = 0;
    this.beaten = false;
    this.starDue = false;
    this.star.reset();
    this._parkNow();
    this.introDone = false;
    this.armed = true;
  }

  enter() {
    this._parkNow();
    this.armed = true;
  }

  _emit(phase) {
    const s = this.spot;
    this.events.emit('laneBoss', { phase, hits: this.hits, pos: { x: s.x, y: s.y, z: s.z } });
  }

  _sfx(name, extra = null) {
    const c = this.cur;
    this.events.emit('sfx', extra ? { name, pos: { x: c.x, y: c.y + 200, z: c.z }, ...extra } : { name, pos: { x: c.x, y: c.y + 200, z: c.z } });
  }

  // Jonas in the car's own frame (u across, w along), and how he stands toward it.
  _read(player, hold) {
    const p = player.pos;
    const s = this.spot;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const c = Math.cos(this.yaw0);
    const sn = Math.sin(this.yaw0);
    this.u = dx * c - dz * sn;
    this.w = dx * sn + dz * c;
    this.dist = Math.sqrt(dx * dx + dz * dz);
    this.dx = dx;
    this.dz = dz;
    const f = player.floor;
    this.grounded = !!(f && f.surface) && p.y <= f.y + 1;
    this.onCar = this.grounded && this.carSurfaces.has(f.surface);
    this.level = Math.abs(p.y - s.y) <= this.spec.wake.level;
    this.awayAct = AWAY[player.action] === 1;
    this.invincible = heroInvincible(player);
    this.away = hold || this.awayAct || this.invincible;
    this._fightRead(player, hold);
  }

  // Touching the parked car: his feet against its sides (on its level), or his attack on it.
  _touching(player) {
    const r = PLAYER_RADIUS + 6;
    if (this.grounded && this.level && Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r) return true;
    const a = player.getAttack?.();
    if (!a || !(a.radius > 0)) return false;
    const s = this.spot;
    const c = Math.cos(this.yaw0);
    const sn = Math.sin(this.yaw0);
    const ax = a.x - s.x;
    const az = a.z - s.z;
    const u = Math.abs(ax * c - az * sn) - this.hw;
    const w = Math.abs(ax * sn + az * c) - this.hl;
    const y = a.y - s.y;
    const dy = y < 0 ? -y : y > this.top ? y - this.top : 0;
    const du = u > 0 ? u : 0;
    const dw = w > 0 ? w : 0;
    return du * du + dw * dw + dy * dy <= a.radius * a.radius;
  }

  update(player, tick, hold = false) {
    this.tick = tick;
    this.player = player;
    this._copy(this.prev, this.cur);
    this.markers.keep();
    if (this.state === 'pose') return;
    // (The easier fight chosen on the pause screen: main sets LANE_BOSS.easy.)
    if (this.easy !== !!this.spec.easy) this.setEasy(!!this.spec.easy);
    this._read(player, hold);
    // A lost life: it goes home (folds back) once it is up (beaten, it carries on parking).
    if (player.action === 'spawn' && this.lastAction !== 'spawn' && CAR_FORM[this.state] !== 1 && !this.beaten) this.leave = true;
    this.lastAction = player.action;
    if (!this.armed && this.dist > BOSS.REARM) this.armed = true;
    this.t++;
    this.eyes = false;
    // (He wins a tie: his attack on the cells before its own step; on its body, a tink.)
    if (this.state === 'open') this._cellsHit(player);
    else if (FIGHTING[this.state] === 1) this._tink(player);
    switch (this.state) {
      case 'parked':
      case 'notice':
        this._parked(player);
        break;
      case 'wake':
        this._wake();
        break;
      case 'home':
        this._home(player);
        break;
      case 'shoo':
        this._shoo();
        break;
      case 'unmorph':
        this._unmorph();
        break;
      case 'settle':
        this._settle(player);
        break;
      default:
        this._fightStep(player);
    }
    this._waveTick(player);
    this.markers.tick();
    // (Its reward star: rising once it is due, then waiting to be touched.)
    this.star.update(player, this, this.objects.time, tick);
    // (Its camera: the fight's framing while it is up, turning to its back in the window, to the
    // car as it goes home beaten.)
    const up = FIGHTING[this.state] === 1;
    const mode = this.state === 'open' ? 2 : this.beaten ? 3 : 1;
    this.camera.fight(up || (this.beaten && this.state !== 'tame'), this.cur.x, this.cur.z, mode);
    this.camera.tick();
    this._frame();
    if (this.shown && this.cur.m > CONTACT_GONE !== this.parted) this._show(true);
    if (this.state !== 'parked' && this.state !== 'notice' && this.state !== 'tame') this._bump(player);
  }

  _parked(player) {
    const W = this.spec.wake;
    const ok = this.armed && !this.away && this.level && this.grounded && !this.onCar;
    this.dwell = ok && this.dist < W.r ? this.dwell + 1 : 0;
    if (ok && (this.dwell >= W.dwell || this._touching(player))) {
      this._startWake();
      return;
    }
    // Its notice: the T lights blink at him (the robot's car form shown for a moment: the same
    // faces), a soft chirp.
    const c = this.cur;
    if (this.state === 'notice') {
      const k = this.t;
      c.blinkL = c.blinkR = k >= 3 && k <= 6 ? 1 : 0;
      if (k === 3) this._hazard();
      if (k >= 10) {
        this._set('parked');
        this._show(false);
      }
      return;
    }
    if (this.dist < this.spec.notice && this.level && !this.away && this.tick - this.lastNotice >= BOSS.NOTICE_EVERY) {
      this.lastNotice = this.tick;
      this._set('notice');
      this._show(true);
      this._sfx('ev_chirp', { quiet: 1 });
    }
  }

  _startWake() {
    this.intro = !this.introDone;
    this.phases = this.intro ? BOSS.INTRO : BOSS.QUICK;
    const P = this.phases;
    this.wakeLen = P.BLINK + P.RISE + P.MORPH + P.FLEX;
    this._set('wake');
    this.dwell = 0;
    this.leave = false;
    this.cur.blinkL = this.cur.blinkR = 0;
    this.arrived = 0; // (the pieces locked in so far: a bit each)
    this._collider(true);
    this._show(true);
    this._sfx('ev_chirp');
    if (this.intro) this.camera.intro(this.spot, this.yaw0, this.wakeLen);
    this._emit('wake');
  }

  _wake() {
    const P = this.phases;
    const c = this.cur;
    const t = this.t;
    // The T lights blink (twice in the intro), then it rocks up on its wheels...
    if (t <= P.BLINK) {
      const b = this.intro ? (t >= 2 && t <= 5) || (t >= 10 && t <= 13) : t >= 2 && t <= 5;
      c.blinkL = c.blinkR = b ? 1 : 0;
      if (t === 2 || (t === 10 && this.intro)) this._hazard();
      return;
    }
    const tr = t - P.BLINK;
    if (tr === 1) {
      this._sfx('robot_power_up');
      this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.25, kind: 'land' });
      this._sparks(6);
    }
    if (tr <= P.RISE) {
      c.lift = BOSS.LIFT * smooth(tr / P.RISE);
      c.bob = 0;
      // (Rocking on its wheels as it rises, settling.)
      c.rock = BOSS.ROCK * Math.sin(tr * 1.2) * (1 - tr / P.RISE);
      return;
    }
    // ...then the morph: the panels fly up on their arcs to their places as the frame unfolds.
    c.rock = 0;
    const tm = tr - P.RISE;
    if (tm <= P.MORPH) {
      c.m = tm / P.MORPH;
      this.goal = this.intro ? POSE.flex : POSE.stand;
      this.ease.set(this.goal);
      this._arrivals();
      return;
    }
    // ...it stands tall (the intro: a flex, a horn chord, its name card).
    const tf = tm - P.MORPH;
    c.m = 1;
    if (tf === 1 && this.intro) {
      this._sfx('robot_horn');
      this.events.emit('bossCard', { lines: BOSS_CARD, ms: 2600 });
      this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.35, kind: 'stomp' });
    }
    if (tf >= P.FLEX) {
      this.introDone = true;
      this.intro = false;
      this.nextBlink = this.tick + 40;
      if (this.leave) this._goHome();
      else this._startFight();
    }
  }

  // Each piece locking into place as it arrives: a clunk and a few sparks (the head's last).
  _arrivals() {
    const m = this.cur.m;
    for (let i = 0; i < MOVERS.length; i++) {
      const bit = 1 << i;
      if (this.arrived & bit || arrive(MOVERS[i], m) < 1) continue;
      this.arrived |= bit;
      this._sfx('robot_clunk', { pitch: CLUNK[MOVERS[i]] });
      this._sparks(4, MOVERS[i]);
    }
  }

  // A few white-blue sparks at the robot (or at a piece, on the classic rig's last pose).
  _sparks(n, piece = null) {
    const o = this.objects;
    const c = this.cur;
    const b = piece ? this.classic.rig.bones[BONE[piece]] : null;
    const pos = b ? { x: b.matrixWorld.elements[12], y: b.matrixWorld.elements[13], z: b.matrixWorld.elements[14] } : { x: c.x, y: c.y + 40, z: c.z };
    o.sparkles?.burst(pos, o.time ?? 0, TINT.box, n);
  }

  // Its indicators flashing amber (a glow at each corner of the car), as a car unlocking does.
  _hazard() {
    const sp = this.objects.sparkles;
    if (!sp) return;
    const c = Math.cos(this.yaw0);
    const s = Math.sin(this.yaw0);
    for (let i = 0; i < 4; i++) {
      const u = (i & 1 ? 1 : -1) * (this.hw - 12);
      const w = i & 2 ? this.hl - 34 : 14 - this.hl;
      _amber.x = this.spot.x + u * c + w * s;
      _amber.y = this.spot.y + 100;
      _amber.z = this.spot.z - u * s + w * c;
      sp.flash(_amber, this.objects.time ?? 0, AMBER, 130, 0.35);
    }
  }

  // Turning toward yaw (when more than `slack` off it), stepping as it turns; true once facing it.
  _face(yaw, slack) {
    const c = this.cur;
    const d = wrap(yaw - c.yaw);
    if (!this.turning && Math.abs(d) > slack) {
      this.turning = true;
      this.stepT = 0;
    }
    if (this.turning) {
      const ad = d < 0 ? -d : d;
      const step = ad < BOSS.TURN ? ad : BOSS.TURN;
      c.yaw = wrap(c.yaw + (d < 0 ? -step : step));
      this.stepT++;
      if (ad < 0.03 && this.stepT % BOSS.STEP === 0) this.turning = false;
      if (this.stepT % BOSS.STEP === 0) this._sfx('robot_step');
    }
    return !this.turning && Math.abs(wrap(yaw - c.yaw)) < 0.03;
  }

  // Going home: back round to the car's heading, then folding up (or shooing him off its spot).
  _home() {
    if (!this._face(this.yaw0, 0.03)) return;
    if (this._onSpot()) {
      this._set('shoo');
      this.goal = POSE.shoo;
      return;
    }
    this._fold();
  }

  // Jonas where the car will stand (its footprint and a little more).
  _onSpot() {
    const r = PLAYER_RADIUS + 20;
    return Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r && this.level;
  }

  _shoo() {
    if (this.t % BOSS.SHOO_EVERY === 1) this._sfx('robot_horn');
    if (!this._onSpot()) this._fold();
    else if (this.t >= BOSS.SHOO_MAX) {
      this.lifting = true;
      this._fold();
    }
  }

  _fold() {
    this._set('unmorph');
    this.goal = POSE.stand;
    this.turning = false;
    this.walking = false;
    this.arrived = 0;
    this._sfx('robot_power_down');
  }

  _unmorph() {
    const c = this.cur;
    c.m = this.t >= BOSS.UNMORPH ? 0 : 1 - this.t / BOSS.UNMORPH;
    c.lift = BOSS.LIFT;
    // (Each piece leaving its place back for the car: a clunk as it drops into the car.)
    for (let i = 0; i < MOVERS.length; i++) {
      const bit = 1 << i;
      if (this.arrived & bit || arrive(MOVERS[i], c.m) > 0) continue;
      this.arrived |= bit;
      this._sfx('robot_clunk', { pitch: CLUNK[MOVERS[i]] * 1.1 });
    }
    if (c.m <= 0) {
      // (Beaten: folded in front of its slot, it reverses in.)
      this._set(this.beatenFold ? 'reverse' : 'settle');
      this.wait = 0;
    }
  }

  _settle(player) {
    const c = this.cur;
    c.m = 0;
    c.lift = BOSS.LIFT * (1 - smooth(this.t / BOSS.SETTLE));
    c.rock = BOSS.ROCK * 0.6 * Math.sin(this.t * 1.6) * (1 - this.t / BOSS.SETTLE);
    if (this.t < BOSS.SETTLE) return;
    c.lift = 0;
    c.rock = 0;
    this._sfx('robot_clunk', { pitch: 0.6 });
    this._collider(false);
    // (Standing where the car settled: lifted onto it.)
    if (this._inCar(player)) {
      const p = player.pos;
      const f = this.collision.findFloor(p.x, this.spot.y + this.top + 40, p.z);
      if (f.surface) {
        p.y = f.y;
        if (player.vel) player.vel.y = 0;
      }
    }
    this._set(this.beaten ? 'tame' : 'parked');
    this._show(false);
    this.armed = false;
    this.lifting = false;
    this.leave = false;
    this.beatenFold = false;
    this._sfx('ev_chirp');
    // (The bins it shoved aside go home; beaten, its reward star rises in front of it.)
    if (this.shoved) this.objects.bins?.sendHome();
    this.shoved = false;
    if (this.beaten && !this.star.awarded) {
      this.starDue = true;
      this._sfx('ev_chirp', { pitch: 1.2 });
    }
    this._emit('parked');
  }

  _inCar(player) {
    const r = PLAYER_RADIUS - 4;
    return Math.abs(this.u) < this.hw + r && Math.abs(this.w) < this.hl + r && player.pos.y < this.spot.y + this.top;
  }

  // The frame's pose this tick: the goal eased into, folded during the morph, its head following
  // him, a step while it turns, blinks.
  _frame() {
    const c = this.cur;
    const e = this.ease;
    const g = this.goal;
    for (let i = 0; i < e.length; i++) e[i] += (g[i] - e[i]) * 0.16;
    const k = unfold(c.m);
    const fold = POSE.fold;
    const t = c.turns;
    for (let i = 0; i < t.length; i++) t[i] = fold[i] + (e[i] - fold[i]) * k;
    if (c.m < 1 || CAR_FORM[this.state] === 1) {
      // (Its eyes the car's lights again.)
      c.rollL = c.rollR = 0;
      c.eyeLen = 1;
      return;
    }
    // Stepping round: each foot up and down in turn.
    c.bob = 0;
    if (this.turning) {
      const s = this.stepT % (2 * BOSS.STEP);
      const legs = s < BOSS.STEP ? LEG_L : LEG_R;
      const up = Math.sin((Math.PI * (s % BOSS.STEP)) / BOSS.STEP);
      for (let j = 0; j < 3; j++) t[legs[j] * 3] += STEP_X[j] * up;
      c.bob = -5 * up;
    }
    // The fight's: kneeling, walking, swaying, tapping (fight.js).
    this._fightFrame(t);
    // Its head following him (a little round and up or down), unless folding up.
    const n = INDEX.neck * 3;
    if (LOOKING[this.state] === 1 && (this.state !== 'walk' || this.walkMode === 'range')) {
      const L = BOSS.LOOK;
      const rel = wrap(Math.atan2(this.dx, this.dz) - c.yaw);
      const yaw = rel > L.yaw ? L.yaw : rel < -L.yaw ? -L.yaw : rel;
      const pitch = Math.atan2(560, this.dist > 200 ? this.dist : 200) * 0.6;
      this.look = this.look + (yaw - this.look) * 0.15;
      this.lookUp = this.lookUp + ((pitch < L.down ? pitch : L.down) - this.lookUp) * 0.15;
      // (Close by, a curious tilt of its head toward the side he is on.)
      const tilt = this.dist < 650 ? (rel < 0 ? L.tilt : -L.tilt) : 0;
      this.tilt = this.tilt + (tilt - this.tilt) * 0.08;
    } else {
      this.look = this.look * 0.85;
      this.lookUp = this.lookUp * 0.85;
      this.tilt = this.tilt * 0.85;
    }
    t[n + 1] += this.look;
    t[n] += this.lookUp;
    t[n + 2] += this.tilt;
    // Its eyes: its mood, and blinks now and then (unless its state drives its eyes: low, a
    // dash's tell, ...).
    const shut = this._mood(c);
    if (this.eyes) return;
    if (this.tick >= this.nextBlink) {
      this.blinkT = BOSS.BLINK_LEN;
      this.nextBlink = this.tick + Math.round(BOSS.BLINK_EVERY * (0.6 + 0.8 * noise(this.tick)));
    }
    if (this.blinkT > 0) this.blinkT--;
    c.blinkL = c.blinkR = this.blinkT > 0 ? 1 : shut;
  }

  // Its eyes' expression this tick (the T lights narrowed and turned in its face, BOSS.MOOD):
  // angry in its attacks, tired with its battery low, bored watching him, sheepish beaten; zapped
  // and dizzy, short and spinning. Returns how far they are narrowed.
  _mood(c) {
    const s = this.state;
    const w = this.walkMode;
    const mood = s === 'walk' ? (w === 'charge' ? 'tired' : w === 'prepark' ? 'sheepish' : w === 'range' ? 'angry' : 'set') : s === 'watch' ? (this.t > 60 ? 'bored' : 'set') : MOODS[s] ?? 'set';
    const M = BOSS.MOOD;
    if (mood === 'dizzy') {
      c.eyeLen = M.dizzy[0];
      c.rollL = wrap(c.rollL + M.dizzy[1]);
      c.rollR = wrap(c.rollR + M.dizzy[1]);
      return 0;
    }
    const [shut, roll] = M[mood];
    c.eyeLen = 1;
    c.rollL = wrap(c.rollL + wrap(roll - c.rollL) * 0.3);
    c.rollR = wrap(c.rollR + wrap(roll - c.rollR) * 0.3);
    return shut;
  }

  // He cannot walk through it: his feet pushed out of its feet and body (car form: its footprint).
  _bump(player) {
    const c = this.cur;
    const p = player.pos;
    if (p.y > c.y + 690 || p.y < c.y - 60) return;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    const B = BOSS.BUMP;
    if (c.m < 0.35) {
      // (The car rising, or reversing into its slot: its footprint. Folding back it lets him be:
      // standing where it parks he is lifted onto it.)
      if (this.state !== 'wake' && this.state !== 'reverse') return;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const u = dx * cs - dz * sn;
      const w = dx * sn + dz * cs;
      const r = PLAYER_RADIUS;
      const ou = this.hw + r - Math.abs(u);
      const ow = this.hl + r - Math.abs(w);
      if (ou <= 0 || ow <= 0 || p.y > c.y + this.top + c.lift) return;
      let du = 0;
      let dw = 0;
      if (ou < ow) du = (u < 0 ? -1 : 1) * (ou < B.step ? ou : B.step);
      else dw = (w < 0 ? -1 : 1) * (ow < B.step ? ow : B.step);
      p.x += du * cs + dw * sn;
      p.z += -du * sn + dw * cs;
      return;
    }
    let pushed = false;
    if (this.kneeling) {
      // (Kneeling: its body, and its right shin and foot down behind it.)
      pushed = this._push(p, c.x, c.z, B.kneel);
      pushed = this._push(p, c.x - 76 * cs - 150 * sn, c.z + 76 * sn - 150 * cs, B.heel) || pushed;
    } else {
      pushed = this._push(p, c.x, c.z, B.body);
      pushed = this._push(p, c.x + 72 * cs + 20 * sn, c.z - 72 * sn + 20 * cs, B.foot) || pushed;
      pushed = this._push(p, c.x - 72 * cs + 20 * sn, c.z + 72 * sn + 20 * cs, B.foot) || pushed;
    }
    // (Never into a wall: the house, the cars.)
    if (pushed) {
      const w = this.collision.findWalls(p.x, p.y + 50, p.z, 0, PLAYER_RADIUS);
      p.x = w.x;
      p.z = w.z;
    }
  }

  _push(p, x, z, r) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const need = r + PLAYER_RADIUS - d;
    if (need <= 0) return false;
    const k = (need < BOSS.BUMP.step ? need : BOSS.BUMP.step) / (d || 1);
    p.x += (d ? dx : 1) * k;
    p.z += (d ? dz : 0) * k;
    return true;
  }

  _copy(to, from) {
    to.x = from.x;
    to.y = from.y;
    to.z = from.z;
    to.yaw = from.yaw;
    to.m = from.m;
    to.lift = from.lift;
    to.bob = from.bob;
    to.turns.set(from.turns);
    to.blinkL = from.blinkL;
    to.blinkR = from.blinkR;
    to.hatch = from.hatch;
    to.gate = from.gate;
    to.lights = from.lights;
    to.spin = from.spin;
    to.heel = from.heel;
    to.rollL = from.rollL;
    to.rollR = from.rollR;
    to.eyeLen = from.eyeLen;
    to.rock = from.rock;
  }

  // Its realistic model's programs compiled ahead (in the background where the browser can), once
  // the look is set (the renderer's compileLook): its first wake does not wait for them.
  _warm() {
    const view = this.objects.view;
    if (!view?.look || !view.compileLook) return;
    this.warm = false;
    view.compileLook(view.look, [this.realModel.group]).catch(() => {});
  }

  // Per frame: both looks' rigs (G may swap them any moment) between the last two ticks.
  animate(alpha, clock = 0, camera = null) {
    if (this.warm) this._warm();
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    if (!this.shown) {
      this.blobs.hide(0);
      this.blobs.hide(1);
      this._fightAnimate(a, clock, camera);
      this.blobs.mesh.visible = this.star.star.active;
      return;
    }
    const p = this.prev;
    const c = this.cur;
    const d = this.draw;
    d.x = p.x + (c.x - p.x) * a;
    d.y = p.y + (c.y - p.y) * a;
    d.z = p.z + (c.z - p.z) * a;
    d.yaw = p.yaw + wrap(c.yaw - p.yaw) * a;
    d.m = p.m + (c.m - p.m) * a;
    d.lift = p.lift + (c.lift - p.lift) * a;
    d.bob = p.bob + (c.bob - p.bob) * a;
    for (let i = 0; i < d.turns.length; i++) d.turns[i] = p.turns[i] + (c.turns[i] - p.turns[i]) * a;
    d.blinkL = c.blinkL;
    d.blinkR = c.blinkR;
    d.hatch = p.hatch + (c.hatch - p.hatch) * a;
    d.gate = p.gate + (c.gate - p.gate) * a;
    d.lights = c.lights;
    d.spin = p.spin + (c.spin - p.spin) * a;
    d.heel = p.heel + (c.heel - p.heel) * a;
    d.rollL = p.rollL + wrap(c.rollL - p.rollL) * a;
    d.rollR = p.rollR + wrap(c.rollR - p.rollR) * a;
    d.eyeLen = c.eyeLen;
    d.rock = p.rock + (c.rock - p.rock) * a;
    for (let i = 0; i < this.models.length; i++) this.models[i].pose(d);
    this._fightAnimate(a, clock, camera);
    // Its feet's blob shadows (the classic look's), as it stands up (on the ground under them).
    const feet = this.classic.group.visible && d.m > 0.4;
    this.blobs.mesh.visible = feet || this.star.star.active;
    if (!feet) {
      this.blobs.hide(0);
      this.blobs.hide(1);
      return;
    }
    const bones = this.classic.rig.bones;
    const size = (BLOB * (d.m - 0.4)) / 0.6;
    for (let i = 0; i < 2; i++) {
      const e = bones[i ? BONE.anR : BONE.anL].matrixWorld.elements;
      this.blobs.place(i, e[12], this._ground(e[12], e[14]), e[14], UP, size);
    }
  }

  // Posed by hand (previews, shots, tests): { m: the morph 0 .. 1, pose: a POSES name, yaw (its
  // heading; default the car's), x, z (where it stands, lane-local; default its spot), lift,
  // blink (0 .. 1), look (its head round, radians), hatch (its battery bay open), lights };
  // null lets it go (parked at once).
  pose(opts) {
    if (!opts) {
      this._parkNow();
      return;
    }
    const c = this.cur;
    this._set('pose');
    this._collider(true);
    c.m = opts.m ?? 1;
    c.lift = opts.lift ?? (c.m > 0 ? BOSS.LIFT : 0);
    c.yaw = opts.yaw ?? this.yaw0;
    c.blinkL = c.blinkR = opts.blink ?? 0;
    c.rollL = c.rollR = opts.roll ?? 0;
    c.eyeLen = opts.eyeLen ?? 1;
    c.hatch = opts.hatch ?? 0;
    c.lights = opts.lights ?? 3;
    c.spin = c.heel = 0;
    if (opts.x !== undefined) {
      c.x = opts.x + this.origin.x;
      c.z = opts.z + this.origin.z;
      c.y = this._ground(c.x, c.z);
    }
    const goal = POSE[opts.pose ?? 'stand'] ?? POSE.stand;
    const k = unfold(c.m);
    for (let i = 0; i < c.turns.length; i++) c.turns[i] = POSE.fold[i] + (goal[i] - POSE.fold[i]) * k;
    // (On its bent legs' lower foot: fight.js _fightFrame.)
    const l = footLift(goal[INDEX.hipL * 3], goal[INDEX.knL * 3]);
    const r = footLift(goal[INDEX.hipR * 3], goal[INDEX.knR * 3]);
    c.bob = c.m >= 1 ? -(l < r ? l : r) : 0;
    c.turns[INDEX.neck * 3 + 1] += opts.look ?? 0;
    this._copy(this.prev, c);
    this._show(true);
    this.animate(1);
  }
}

Object.assign(LaneBoss.prototype, FIGHT_METHODS);
