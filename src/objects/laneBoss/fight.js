// STOMPWATT's fight (B3; LaneBoss.js mixes these into its own methods): its three attacks, its
// battery running low and the charging window at the dad's wall charger, the hits, its defeat,
// its reward star. Numbers: tuning.js FIGHT; places: lane/layout.js LANE_BOSS (docs/
// ARCHITECTURE.md "STOMPWATT").
//
// The loop: it stands up facing him (`stand`), walks into range (`walk`) and runs its phase's
// attack set (tuning.js FIGHT.PHASES), each attack told ahead (its tell: a pose, a sound, an
// orange marker on the ground; the target locks LOCK ticks before it can hurt), GAP ticks apart:
//   Wheel Stomp   (`stomp_tell`, `stomp_hop`, `stomp_land`): a leg raised high, a ring where it
//                 will land (under him, or FAR toward him); it hops onto the locked spot, its foot
//                 slams down (hurting within FOOT) and a
//                 shockwave runs out over the ground: he jumps it (it hurts only standing).
//   Roll Dash     (`dash_tell`, `dash`, `dash_skid`, `dash_bonk`): crouched, its heel rollers
//                 screeching, chevrons down its line; it skates along the locked line; its body
//                 hurts and knocks him sideways off the line: he steps aside.
//   Wheel Swipe   (`swipe_tell`, `swipe`): its right fist drawn back, an arc in front of it; the
//                 fist sweeps the arc low: he jumps it or steps back out.
// After its set its battery runs low (`low`): it walks to the charger (`walk` to LANE_BOSS.
// charge), kneels facing it, its back to the open drive (`kneel`), plugs in (`plug`: the cable
// from the charger to the port on its chest, the charger's light blue) and its battery bay's
// hatch on its lower back swings open on three glowing cells: the window (`open`, the phase's
// window long). Any of his attacks on the cells is a hit (`zapped`, then `dizzy`: a power
// light out, three coins, the next phase faster); no hit: it unplugs and runs the set again
// (`unplug`). The third hit: it short-circuits (`shortout`), walks off sheepishly to the front
// of its slot (`walk` to LANE_BOSS.prepark), folds back into the car (`unmorph`), reverses into
// its slot (`reverse`), settles and stays a car, tame, until a new game (`tame`); its reward
// star (BossStar, boss: true) spirals up in front of it.
// He out of its reach (away: reading, on a pole, a dialog or a warp; perched on the bins, the
// carport or a roof; in the store room behind the garage doors; out of the arena) it starts
// nothing and watches him (`watch`); WATCH ticks of that, or a lost life, and it goes home
// (`home`: walks to its spot, folds back, parks), keeping its hits.
//
// Fairness (R1-R8, docs): only the stomp's foot and wave, the dash's body and the swipe's fist
// hurt, one wedge an attack at most; every attack told FIGHT.PHASES[..].tell ticks (>= 22),
// locked >= 10 before it can hurt, an orange marker where; one at a time, GAP apart, never
// while it charges, kneels, is zapped, dizzy, low or going home; nothing new while he is away
// or blinking after a hit, and an attack under way when he goes away hurts nobody (a tell is
// called off); his attack on the cells is tested before its own step; a knockback never
// carries him off his level (probed, else toward the arena's middle); never while he is up on
// the bins, the carport or a roof; three hits win, each dropping three coins.
//
// Collision: its feet circle against walls (findWalls at two heights) as it walks or dashes,
// its middle kept in LANE_BOSS.walk; the ground's height from a grid made once (layout.
// groundHeight: no query). At most four queries a tick (its walk's two, his bump's one, a
// knockback's probe); none while it stands. Allocation: none per tick but event payloads.

import { PLAYER_RADIUS } from '../../core/constants.js';
import { TINT } from '../Sparkles.js';
import { BossStar } from '../BossStar.js';
import { FIGHT as F, BOSS } from './tuning.js';
import { BONE, KNEEL_DROP, WALK, footLift, smooth, wrap } from './rig.js';
import { INDEX, POSE } from './poses.js';
import { Markers, Cable } from './markers.js';

const GRID = 50; // (the ground's height grid over the arena)
// States in which it stands up as a robot and fights (the fight's camera, his bump on its body).
export const FIGHTING = { stand: 1, walk: 1, watch: 1, stomp_tell: 1, stomp_hop: 1, stomp_land: 1, dash_tell: 1, dash: 1, dash_skid: 1, dash_bonk: 1, swipe_tell: 1, swipe: 1, gap: 1, low: 1, kneel: 1, plug: 1, open: 1, zapped: 1, dizzy: 1, unplug: 1, shortout: 1 };
// ...kneeling at the charger (its bump: the kneeling body).
const KNEELING = { kneel: 1, plug: 1, open: 1, zapped: 1, unplug: 1 };
// The charger (lane-local): the box's underside where its cable leaves, the plug's holster, the
// status light on its face.
const CHARGER = { from: [7, 130, 18], holster: [6, 84, 38], light: [16, 196, 0] };
// The port on its chest (its left side, by the power gauge), in the chest bone's frame.
const PORT = [92, 90, 110];
const LEG_L = [INDEX.hipL, INDEX.knL, INDEX.anL];
const LEG_R = [INDEX.hipR, INDEX.knR, INDEX.anR];
// Its joints the short circuit sparks off, in turn.
const JOINTS = ['shL', 'knR', 'elR', 'neck', 'hipL', 'elL', 'shR', 'knL', 'hipR', 'chest'].map((b) => BONE[b]);
const ARM_L = INDEX.shL;
const ARM_R = INDEX.shR;

export const FIGHT_METHODS = {
  // ---------------------------------------------------------------- set-up

  _initFight(objects, area, layout) {
    const o = area.objectsLayout.ORIGIN ?? { x: 0, y: 0, z: 0 };
    this.origin = o;
    const spec = layout.LANE_BOSS;
    const A = spec.arena;
    this.arena = { x: A.x + o.x, z: A.z + o.z, r: A.r };
    this.boxes = spec.walk.map(([x0, x1, z0, z1]) => [x0 + o.x, x1 + o.x, z0 + o.z, z1 + o.z]);
    this.chargeAt = { x: spec.charge.x + o.x, z: spec.charge.z + o.z, yaw: spec.charge.yaw };
    this.preparkAt = { x: spec.prepark.x + o.x, z: spec.prepark.z + o.z };
    // (The drive's mouth: the walking ground's second box, met from the street.)
    const [px0, px1, pz0] = spec.walk[1];
    this.mouth = { x: (px0 + px1) / 2 + o.x, z: pz0 - 40 + o.z, x0: px0 + 40 + o.x, x1: px1 - 40 + o.x };
    // The ground's height over the arena (and a margin): the road at 0, the rest at GROUND.
    const span = A.r + 400;
    this.gx0 = A.x - span;
    this.gz0 = A.z - span;
    this.gn = Math.ceil((span * 2) / GRID) + 1;
    this.grid = new Float32Array(this.gn * this.gn);
    for (let i = 0; i < this.gn; i++) for (let j = 0; j < this.gn; j++) this.grid[i * this.gn + j] = layout.groundHeight(this.gx0 + i * GRID, this.gz0 + j * GRID);
    // The charger's points in the world.
    const C = layout.DAD.charger;
    const G = layout.GROUND;
    const pt = (p) => ({ x: C.x + p[0] + o.x, y: G + p[1] + o.y, z: C.z + p[2] + o.z });
    this.chargerFrom = pt(CHARGER.from);
    this.chargerHolster = pt(CHARGER.holster);
    this.chargerLight = pt(CHARGER.light);
    this.portAt = { x: 0, y: 0, z: 0 };
    // Its overlays and its reward star.
    this.markers = new Markers((x, z) => this._ground(x, z));
    this.cable = new Cable();
    this.group.add(this.markers.mesh, this.cable.mesh);
    objects.view?.prewarm?.(this.markers.mesh); // (their programs ready before the first tell)
    objects.view?.prewarm?.(this.cable.mesh);
    this.cables = []; // the charger's own hanging cable in each look (hidden while it is plugged in)
    this.star = new BossStar({ events: this.events, collision: this.collision, sparkles: objects.sparkles, shadows: this.blobs, shadowSlot: 2, envMap: objects.star?.mesh.material.envMap ?? null, over: spec.star.y - G });
    this.starSpot = { x: spec.star.x + o.x, z: spec.star.z + o.z, floorY: G + o.y, water: false };
    this.group.add(this.star.mesh);
    this.starDue = false;
    this.wreckPos = this.starSpot;
    this.setEasy(!!spec.easy);
    this.atk = { kind: '', struck: false, harmless: false, x0: 0, z0: 0, tx: 0, tz: 0, dx: 0, dz: 1, ran: 0, fist: 0 };
    this.hits = 0;
    this.beaten = false;
    this.setIndex = 0;
    this.waveStruck = false;
    this.waveHarmless = false;
    this.tinkAt = -Infinity;
    this.walking = false;
    this.walkT = 0;
    this.stepLen = 16;
    this.walkMode = '';
    this.walkKind = '';
    this.best = Infinity;
    this.stall = 0;
    this.shoved = false;
    this.plugged = false;
    this.wait = 0;
  },

  // A part's charger cable (its mover), hidden while the robot's own is plugged in.
  _cableOf(part) {
    const m = part?.movers?.charger_cable;
    if (m && !this.cables.includes(m)) this.cables.push(m);
  },

  // The fight's state off at once (an arrival, a new game, going home, parked): no marker, no
  // wave, no cable, the hatch shut.
  _clearFight() {
    this.markers.clear();
    this.atk.kind = '';
    this.walking = false;
    this.walkMode = '';
    this._plug(false);
    this.cur.hatch = 0;
    this.cur.spin = 0;
    this.cur.heel = 0;
    this.camera.fight(false);
  },

  // The ground's height at a world point (the grid's nearest).
  _ground(x, z) {
    let i = Math.round((x - this.origin.x - this.gx0) / GRID);
    let j = Math.round((z - this.origin.z - this.gz0) / GRID);
    const n = this.gn - 1;
    i = i < 0 ? 0 : i > n ? n : i;
    j = j < 0 ? 0 : j > n ? n : j;
    return this.grid[i * this.gn + j] + this.origin.y;
  },

  // The nearest point to (x, z) where its middle may stand (LANE_BOSS.walk's boxes): this._rx,
  // this._rz; returns how far that is from (x, z) squared.
  _inside(x, z) {
    let best = Infinity;
    const list = this.boxes;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const cx = x < b[0] ? b[0] : x > b[1] ? b[1] : x;
      const cz = z < b[2] ? b[2] : z > b[3] ? b[3] : z;
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < best) {
        best = d;
        this._rx = cx;
        this._rz = cz;
      }
    }
    return best;
  },

  // How he stands toward it in the fight (after LaneBoss._read).
  _fightRead(player, hold) {
    const p = player.pos;
    const c = this.cur;
    this.rdx = p.x - c.x;
    this.rdz = p.z - c.z;
    this.rdist = Math.sqrt(this.rdx * this.rdx + this.rdz * this.rdz);
    const f = player.floor;
    this.heroFloorY = f && f.surface ? f.y : p.y;
    const ax = p.x - this.arena.x;
    const az = p.z - this.arena.z;
    const R = this.arena.r + F.OUT;
    this.perched = this.heroFloorY - this._ground(p.x, p.z) > F.PERCH;
    // (In the store room behind the garage doors he is out of its reach too.)
    this.outside = ax * ax + az * az > R * R || this.perched || (this.garage !== null && this.garage.in);
    this.gone = hold || this.awayAct;
    this.blinking = this.invincible;
  },

  // ---------------------------------------------------------------- the tick

  // One fight state's step (LaneBoss.update's switch hands these over); false: not a fight state.
  _fightStep(player) {
    switch (this.state) {
      case 'stand':
        this._stand();
        return true;
      case 'walk':
        this._walkState();
        return true;
      case 'watch':
        this._watch();
        return true;
      case 'stomp_tell':
        this._stompTell();
        return true;
      case 'stomp_hop':
        this._stompHop(player);
        return true;
      case 'stomp_land':
        if (this.t >= F.STOMP.land) this._toGap();
        return true;
      case 'dash_tell':
        this._dashTell();
        return true;
      case 'dash':
        this._dash(player);
        return true;
      case 'dash_skid':
      case 'dash_bonk':
        this._dashEnd();
        return true;
      case 'swipe_tell':
        this._swipeTell();
        return true;
      case 'swipe':
        this._swipe(player);
        return true;
      case 'gap':
        this._gap();
        return true;
      case 'low':
        this._low();
        return true;
      case 'kneel':
        if (this.t >= F.KNEEL) {
          this._set('plug');
          this._plug(true);
        }
        return true;
      case 'plug':
        if (this.t >= F.PLUG) this._openUp();
        return true;
      case 'open':
        this._open();
        return true;
      case 'zapped':
        this._zapped();
        return true;
      case 'dizzy':
        this._dizzy();
        return true;
      case 'unplug':
        this._unplug();
        return true;
      case 'shortout':
        this._shortout();
        return true;
      case 'reverse':
        this._reverse(player);
        return true;
      case 'tame':
        this._tame();
        return true;
    }
    return false;
  },

  // The fight starts (its wake done): it stands, facing him; the music.
  _startFight() {
    this.setIndex = 0;
    this._set('stand');
    this.goal = POSE.guard;
    this._emit('fight');
  },

  _phase() {
    return this.rounds[this.hits < 2 ? this.hits : 2];
  },

  // The easier fight (LANE_BOSS.easy, for the youngest: FIGHT.EASY): longer tells and windows, no
  // dash in the second round.
  setEasy(on) {
    const E = F.EASY;
    this.easy = on;
    this.rounds = on ? F.PHASES.map((P, i) => ({ ...P, tell: P.tell + E.tell, window: P.window + E.window, set: i === 1 ? P.set.map((k) => (k === 'dash' ? 'stomp' : k)) : P.set })) : F.PHASES;
  },

  // Standing, choosing: its next attack (walking into range first), or its battery low after
  // its set, or watching him while he is out of its reach.
  _stand() {
    if (this.leave) {
      this._goHome();
      return;
    }
    this.goal = POSE.guard;
    if (this.gone || this.outside) {
      this._set('watch');
      return;
    }
    this._face(Math.atan2(this.rdx, this.rdz), 0.3);
    if (this.blinking) return;
    const P = this._phase();
    if (this.setIndex >= P.set.length) {
      this._set('low');
      this.goal = POSE.lowbat;
      this._sfx('robot_lowbat');
      return;
    }
    const kind = this._resolve(P.set[this.setIndex]);
    const far = kind === 'dash' ? F.DASH.max : F.STOMP.reach;
    if (this.rdist > far) {
      this.walkKind = kind;
      this._walkTo('range');
      return;
    }
    this._tell(kind);
  },

  // An attack of the set as it can be done now: the swipe only with him in front within its
  // reach, the dash only with him far enough off (else a stomp).
  _resolve(kind) {
    if (kind === 'swipe') {
      const rel = wrap(Math.atan2(this.rdx, this.rdz) - this.cur.yaw);
      return this.rdist <= F.SWIPE.reach && rel > -F.SWIPE.half && rel < F.SWIPE.half ? 'swipe' : 'stomp';
    }
    if (kind === 'dash') return this.rdist >= F.DASH.min ? 'dash' : 'stomp';
    return kind;
  },

  _walkTo(mode) {
    this._set('walk');
    this.walkMode = mode;
    this.best = Infinity;
    this.stall = 0;
    this.turning = false;
  },

  // Walking: into range for its attack, to the charger, home, or (beaten) to the front of its slot.
  _walkState() {
    const P = this._phase();
    const mode = this.walkMode;
    if (mode === 'range') {
      if (this.leave) {
        this._goHome();
        return;
      }
      if (this.gone || this.outside) {
        this.walking = false;
        this._set('watch');
        return;
      }
      const near = this.walkKind === 'dash' ? F.DASH.near : F.STOMP.near;
      if (this.rdist <= near) {
        this.walking = false;
        this._tell(this._resolve(this.walkKind));
        return;
      }
      this.goal = POSE.guard;
      this._walk(this.cur.x + this.rdx, this.cur.z + this.rdz, P.walk);
      // (Stuck behind something: it stomps from where it is if it can, else skips this one.)
      if (this._stalled(this.rdist)) {
        this.walking = false;
        if (this.rdist <= F.STOMP.reach) this._tell('stomp');
        else this._toGap();
      }
      return;
    }
    if (mode === 'charge') {
      if (this.leave) {
        this._goHome();
        return;
      }
      const C = this.chargeAt;
      if (!this.walking && this.t > 1 && this._at(C.x, C.z)) {
        // (There: it turns to the charger, then kneels.)
        if (this._face(C.yaw, 0.02)) {
          this._set('kneel');
          this.goal = POSE.kneel;
        }
        return;
      }
      this.goal = POSE.lowbat;
      this.eyes = true;
      this.cur.blinkL = this.cur.blinkR = 0.35;
      if (this._walkVia(C.x, C.z, P.walk * 0.85)) this.walking = false;
      return;
    }
    if (mode === 'prepark') {
      const Q = this.preparkAt;
      if (!this.walking && this.t > 1 && this._at(Q.x, Q.z)) {
        if (this._face(this.yaw0, 0.02)) this._foldBeaten();
        return;
      }
      this.goal = POSE.sheepish;
      if (this._walkVia(Q.x, Q.z, 5)) this.walking = false;
      return;
    }
    // Home: to its spot, then the show's way of parking (LaneBoss._home: facing the car's
    // heading, shooing him off its spot, folding back).
    const S = this.spot;
    if (!this.walking && this.t > 1 && this._at(S.x, S.z)) {
      this._set('home');
      return;
    }
    this.goal = POSE.stand;
    if (this._walkVia(S.x, S.z, P.walk) || this._stalled((S.x - this.cur.x) * (S.x - this.cur.x) + (S.z - this.cur.z) * (S.z - this.cur.z))) {
      this.walking = false;
      this._set('home');
    }
  },

  // Walking to a goal on the dad's drive (between his gable and the SUV): from the street by way
  // of the drive's mouth (it never squeezes past the SUV's or the hedge's corners).
  _walkVia(gx, gz, speed) {
    const m = this.mouth;
    const c = this.cur;
    if (gz > m.z + 20 && (c.x < m.x0 || c.x > m.x1) && c.z < gz) {
      this._walk(m.x, m.z, speed);
      return false;
    }
    return this._walk(gx, gz, speed);
  },

  _at(x, z) {
    const dx = x - this.cur.x;
    const dz = z - this.cur.z;
    return dx * dx + dz * dz < 64;
  },

  // No progress toward its goal (`d`, any growing measure of how far) for a while.
  _stalled(d) {
    if (d < this.best - 1) {
      this.best = d;
      this.stall = 0;
      return false;
    }
    return ++this.stall > 45;
  },

  // A step toward (gx, gz) at `speed` (turning toward it first); true once there.
  _walk(gx, gz, speed) {
    const c = this.cur;
    const dx = gx - c.x;
    const dz = gz - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= speed) {
      this._move(dx, dz);
      return true;
    }
    const turn = wrap(Math.atan2(dx, dz) - c.yaw);
    const at = turn < 0 ? -turn : turn;
    c.yaw = wrap(c.yaw + (at < F.TURN ? turn : turn < 0 ? -F.TURN : F.TURN));
    // (Slower while it turns; turning on the spot when facing well off its way.)
    const k = at > 1 ? 0 : 1 - at * 0.6;
    if (!this.walking) {
      this.walking = true;
      this.walkT = 0;
      // (Its steps as long as its speed carries it: its feet planted, not sliding.)
      this.stepLen = Math.round(F.STRIDE / speed);
    }
    this.walkT++;
    if (this.walkT % this.stepLen === 0) this._sfx('robot_step');
    if (k > 0) this._move(Math.sin(c.yaw) * speed * k, Math.cos(c.yaw) * speed * k);
    return false;
  },

  // Moves its middle by (mx, mz) where it may stand: in its walking ground, its feet circle out of
  // the walls (sliding along them); a bin in its way is shoved aside. True if nothing stopped it.
  _move(mx, mz) {
    const c = this.cur;
    this._inside(c.x + mx, c.z + mz);
    let x = this._rx;
    let z = this._rz;
    this._shoveBins(x, z, mx, mz);
    const col = this.collision;
    let w = col.findWalls(x, c.y + 40, z, 0, F.FEET);
    let free = w.walls.length === 0;
    w = col.findWalls(w.x, c.y + 200, w.z, 0, F.FEET);
    free = free && w.walls.length === 0;
    this._inside(w.x, w.z);
    x = this._rx;
    z = this._rz;
    const moved = (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z);
    c.x = x;
    c.z = z;
    // Its feet on the ground (the kerb stepped smoothly).
    const g = this._ground(x, z);
    const dy = g - c.y;
    c.y += dy > 4 ? 4 : dy < -4 ? -4 : dy;
    return free && moved > (mx * mx + mz * mz) * 0.25;
  },

  // A bin its feet (at x, z) would meet is shoved aside (along its way, or `side` of it).
  _shoveBins(x, z, mx, mz, sx = 0, sz = 0) {
    const bins = this.objects.bins;
    if (!bins) return;
    const list = bins.list;
    const r = F.FEET + 10;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.held) continue;
      const cx = x < b.x - b.hw ? b.x - b.hw : x > b.x + b.hw ? b.x + b.hw : x;
      const cz = z < b.z - b.hd ? b.z - b.hd : z > b.z + b.hd ? b.z + b.hd : z;
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > r * r) continue;
      let dx = sx !== 0 || sz !== 0 ? sx : b.x - x;
      let dz = sx !== 0 || sz !== 0 ? sz : b.z - z;
      if (sx === 0 && sz === 0 && mx * mx + mz * mz > 0) {
        dx += mx * 4;
        dz += mz * 4;
      }
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      if (bins.shove(b, dx / l, dz / l, F.SHOVE)) this.shoved = true;
    }
  },

  // He is away, perched or out of the arena: it watches him (turning to him, tapping its foot);
  // he back, it fights on; WATCH ticks of it, it goes home.
  _watch() {
    if (this.leave || this.t >= F.WATCH) {
      this._goHome();
      return;
    }
    this.goal = this.t > 40 ? POSE.hips : POSE.guard;
    this._face(Math.atan2(this.rdx, this.rdz), 0.4);
    if (!this.gone && !this.outside) this._set('stand');
  },

  // ---------------------------------------------------------------- the attacks

  _tell(kind) {
    const a = this.atk;
    a.kind = kind;
    a.struck = false;
    a.harmless = false;
    a.x0 = this.cur.x;
    a.z0 = this.cur.z;
    this.turning = false;
    this.walking = false;
    // (Its marker shows from the tell's first tick.)
    const mk = this.markers;
    const c = this.cur;
    if (kind === 'stomp') {
      this._set('stomp_tell');
      this.goal = POSE.stompTell;
      this._sfx('robot_stomp_tell');
      this._hopTarget();
      mk.ring.on = true;
      mk.ring.x = mk.ring.px = a.tx;
      mk.ring.z = mk.ring.pz = a.tz;
      mk.ring.size = mk.ring.psize = F.STOMP.ring[0];
    } else if (kind === 'dash') {
      this._set('dash_tell');
      this.goal = POSE.crouch;
      this._sfx('robot_screech');
      a.dx = Math.sin(c.yaw);
      a.dz = Math.cos(c.yaw);
      this._lane();
    } else {
      this._set('swipe_tell');
      this.goal = POSE.swipeTell;
      this._sfx('robot_swipe_tell');
      this._arc();
    }
  },

  // The dash's chevrons along its line (atk.dx, dz) from in front of it.
  _lane() {
    const lane = this.markers.lane;
    const c = this.cur;
    const a = this.atk;
    lane.on = true;
    lane.x = c.x + a.dx * 60;
    lane.z = c.z + a.dz * 60;
    lane.dx = a.dx;
    lane.dz = a.dz;
    lane.len = F.DASH.speed * F.DASH.ticks;
    lane.w = F.DASH.lane;
  },

  // The swipe's arc in front of it.
  _arc() {
    const arc = this.markers.arc;
    const c = this.cur;
    arc.on = true;
    arc.x = c.x;
    arc.z = c.z;
    arc.yaw = c.yaw;
    arc.r = F.SWIPE.reach;
    arc.half = F.SWIPE.half;
  },

  // A tell called off (he went away): nothing happens, on to the next.
  _calledOff() {
    if (!this.gone) return false;
    this.markers.clear();
    this._toGap();
    return true;
  },

  _toGap() {
    this.markers.ring.on = false;
    this.markers.lane.on = false;
    this.markers.arc.on = false;
    this.atk.kind = '';
    this._set('gap');
    this.goal = POSE.guard;
  },

  // Between attacks: it guards, facing him, GAP ticks (longer while he blinks after a hit).
  _gap() {
    if (this.leave) {
      this._goHome();
      return;
    }
    this._face(Math.atan2(this.rdx, this.rdz), 0.3);
    if (this.t >= F.GAP && !this.blinking) {
      this.setIndex++;
      this._set('stand');
    }
  },

  // The Wheel Stomp's tell: a leg up, its heel roller spinning up; the ring under him grows and
  // follows him until it locks.
  _stompTell() {
    if (this._calledOff()) return;
    const T = this._phase().tell;
    const t = this.t;
    const a = this.atk;
    const ring = this.markers.ring;
    if (t <= T - F.LOCK) {
      this._hopTarget();
      this._face(Math.atan2(this.rdx, this.rdz), 0.02);
    }
    ring.on = true;
    ring.x = a.tx;
    ring.z = a.tz;
    if (t === 1) {
      ring.px = ring.x;
      ring.pz = ring.z;
    }
    const S = F.STOMP;
    ring.size = S.ring[0] + ((S.ring[1] - S.ring[0]) * t) / T;
    this.cur.heel += 0.12 + (0.5 * t) / T;
    if (t % 5 === 0) this._sparksAt(this.cur.x, this.cur.y + 120, this.cur.z, TINT.red, 2);
    if (t < T) return;
    // The hop: onto the locked spot.
    a.x0 = this.cur.x;
    a.z0 = this.cur.z;
    a.dx = a.tx;
    a.dz = a.tz;
    this._set('stomp_hop');
    this.goal = POSE.stompHop;
    this.y0 = this.cur.y;
    this.y1 = this._ground(a.dx, a.dz);
    this._sfx('robot_whirr');
  },

  // Where its stomp lands (atk.tx, tz; its ring): on him, at most FAR from where it stands, on
  // its walking ground.
  _hopTarget() {
    const a = this.atk;
    let dx = this.rdx;
    let dz = this.rdz;
    const d = this.rdist;
    const far = F.STOMP.far;
    if (d > far) {
      dx *= far / d;
      dz *= far / d;
    }
    this._inside(this.cur.x + dx, this.cur.z + dz);
    a.tx = this._rx;
    a.tz = this._rz;
  },

  _stompHop(player) {
    const S = F.STOMP;
    const k = this.t / S.hop;
    const a = this.atk;
    const c = this.cur;
    c.x = a.x0 + (a.dx - a.x0) * k;
    c.z = a.z0 + (a.dz - a.z0) * k;
    c.y = this.y0 + (this.y1 - this.y0) * k + Math.sin(Math.PI * k) * S.peak;
    if (this.t < S.hop) return;
    c.y = this.y1;
    this._slam(player);
  },

  // It lands: a slam, the camera shaking, dust; its foot hurts round where it lands; the
  // shockwave sets off.
  _slam(player) {
    const c = this.cur;
    const a = this.atk;
    this._set('stomp_land');
    this.goal = POSE.stompLand;
    this.markers.ring.on = false;
    if (this.gone) a.harmless = true;
    this._sfx('robot_stomp');
    this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.9, kind: 'stomp' });
    this._sparksAt(c.x, c.y + 20, c.z, TINT.dirt, 10);
    this._sparksAt(c.x, c.y + 30, c.z, TINT.scrap, 6);
    const p = player.pos;
    const S = F.STOMP;
    const r = S.foot + PLAYER_RADIUS;
    if (!a.harmless && this.rdist >= 0) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      if (dx * dx + dz * dz <= r * r && p.y < c.y + 160) this._hurtFrom(c.x, c.z);
    }
    // The shockwave.
    const w = this.markers.wave;
    w.on = true;
    w.x = c.x;
    w.z = c.z;
    w.y = c.y;
    w.r = w.pr = 0;
    w.max = this._phase().wave;
    w.h = S.high;
    this.waveStruck = a.struck;
    this.waveHarmless = a.harmless;
    this._sfx('robot_wave');
  },

  // The shockwave running out: it hurts him standing on the ground (on its level) where its band
  // meets his feet circle; a jump clears it. Once a stomp.
  _waveTick(player) {
    const w = this.markers.wave;
    if (!w.on) return;
    w.r += F.STOMP.wave;
    if (w.r > w.max) {
      w.on = false;
      return;
    }
    if (this.waveStruck || this.waveHarmless) return;
    if (this.gone) {
      this.waveHarmless = true;
      return;
    }
    const p = player.pos;
    if (!this.grounded || this.heroFloorY - w.y > F.STOMP.level || w.y - this.heroFloorY > F.STOMP.level) return;
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const e = d - w.r;
    const band = F.STOMP.band / 2 + PLAYER_RADIUS;
    if (e > band || e < -band) return;
    if (this._hurtFrom(w.x, w.z)) this.waveStruck = true;
  },

  // The Roll Dash's tell: crouched, its heel rollers screeching (smoke), its eyes flashing; the
  // chevrons along its line follow him until it locks.
  _dashTell() {
    if (this._calledOff()) return;
    const T = this._phase().tell;
    const t = this.t;
    const c = this.cur;
    const a = this.atk;
    if (t <= T - F.LOCK) {
      // (Turning fast to face him: the line is where it looks.)
      const d = wrap(Math.atan2(this.rdx, this.rdz) - c.yaw);
      const ad = d < 0 ? -d : d;
      c.yaw = wrap(c.yaw + (ad < 0.15 ? d : d < 0 ? -0.15 : 0.15));
    }
    a.dx = Math.sin(c.yaw);
    a.dz = Math.cos(c.yaw);
    this._lane();
    c.heel += 0.3 + (0.9 * t) / T;
    if (t % 3 === 0) this._sparksAt(c.x - a.dx * 60, c.y + 20, c.z - a.dz * 60, TINT.fluff, 2);
    // (Its eyes flash three times.)
    const f = t % 8;
    this.eyes = true;
    c.blinkL = c.blinkR = t < 24 && f < 2 ? 1 : 0;
    if (t < T) return;
    a.ran = 0;
    this._set('dash');
    this.goal = POSE.skate;
    this._sfx('robot_dash');
  },

  // Skating along the locked line; its body hurts (knocking him sideways off its line); a wall
  // stops it with a bonk, the line's end or the ground's edge with a skid. A bin on the line is
  // knocked aside.
  _dash(player) {
    const D = F.DASH;
    const c = this.cur;
    const a = this.atk;
    if (this.gone) a.harmless = true;
    c.heel += 1.1;
    const sx = a.dz;
    const sz = -a.dx;
    // (Bins on its line go off to the side of it they are on.)
    this._shoveSide(sx, sz);
    const free = this._move(a.dx * D.speed, a.dz * D.speed);
    a.ran += D.speed;
    this._dashHit(player);
    if (!free) {
      // A wall (or the edge of its ground): a bonk against a wall, else a skid.
      const wall = this._inside(c.x + a.dx * 40, c.z + a.dz * 40) < 1;
      this.markers.lane.on = false;
      this._set(wall ? 'dash_bonk' : 'dash_skid');
      this.goal = wall ? POSE.dizzy : POSE.guard;
      if (wall) {
        this._sfx('robot_clang');
        this._sparksAt(c.x + a.dx * 120, c.y + 200, c.z + a.dz * 120, TINT.box, 10);
        this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.4, kind: 'land' });
      }
      return;
    }
    if (this.t >= D.ticks || a.ran >= D.speed * D.ticks) {
      this.markers.lane.on = false;
      this._set('dash_skid');
      this.goal = POSE.guard;
    }
  },

  _shoveSide(sx, sz) {
    const c = this.cur;
    const a = this.atk;
    const bins = this.objects.bins;
    if (!bins) return;
    const list = bins.list;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const side = (b.x - c.x) * sx + (b.z - c.z) * sz >= 0 ? 1 : -1;
      this._shoveBins(c.x + a.dx * F.DASH.speed, c.z + a.dz * F.DASH.speed, 0, 0, sx * side, sz * side);
    }
  },

  // Its body (a capsule round its middle, up to TOP) against his: a hurt, knocking him off its
  // line to the side he is on.
  _dashHit(player) {
    const a = this.atk;
    if (a.struck || a.harmless) return;
    const D = F.DASH;
    const c = this.cur;
    const p = player.pos;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const r = D.r + PLAYER_RADIUS;
    if (dx * dx + dz * dz > r * r || p.y > c.y + D.top) return;
    // (Sideways: perpendicular to the line, the side he is on; dead on it, the arena's middle's.)
    let s = dx * a.dz - dz * a.dx;
    if (s * s < 1) s = (this.arena.x - c.x) * a.dz - (this.arena.z - c.z) * a.dx;
    const k = s < 0 ? -1 : 1;
    this._hurt(a.dz * k, -a.dx * k);
  },

  _dashEnd() {
    const c = this.cur;
    const a = this.atk;
    if (this.state === 'dash_skid') {
      const k = 1 - this.t / F.DASH.skid;
      if (k > 0) this._move(a.dx * F.DASH.speed * 0.5 * k, a.dz * F.DASH.speed * 0.5 * k);
      if (this.t % 2 === 0) this._sparksAt(c.x, c.y + 10, c.z, TINT.fluff, 2);
      if (this.t >= F.DASH.skid) this._toGap();
      return;
    }
    if (this.t >= F.DASH.bonk) this._toGap();
  },

  // The Wheel Swipe's tell: its right fist drawn back, spinning up; the arc in front of it
  // follows its facing until it locks.
  _swipeTell() {
    if (this._calledOff()) return;
    const T = this._phase().tell;
    const t = this.t;
    const c = this.cur;
    if (t <= T - F.SWIPE.lock) this._face(Math.atan2(this.rdx, this.rdz), 0.02);
    this._arc();
    c.spin += 0.2 + (0.8 * t) / T;
    if (t < T) return;
    this.atk.fist = -F.SWIPE.half;
    this._set('swipe');
    this.goal = POSE.swipe;
    this._sfx('robot_swipe');
  },

  // The fist sweeping the arc from its right to its left: it hurts him there with his feet low
  // (a jump clears it), where the fist passes this tick.
  _swipe(player) {
    const S = F.SWIPE;
    const c = this.cur;
    const a = this.atk;
    c.spin += 1;
    if (this.gone) a.harmless = true;
    if (this.t <= S.ticks) {
      const from = a.fist;
      const to = -S.half + (2 * S.half * this.t) / S.ticks;
      a.fist = to;
      const rel = wrap(Math.atan2(this.rdx, this.rdz) - c.yaw);
      const p = player.pos;
      if (!a.struck && !a.harmless && this.rdist <= S.reach + PLAYER_RADIUS && rel >= from - S.slack && rel <= to + S.slack && p.y - this._ground(p.x, p.z) < S.high) {
        // (Knocked on along the fist's way: to its left.)
        const k = c.yaw + to + 0.6;
        this._hurt(Math.sin(k), Math.cos(k));
      }
    }
    if (this.t >= S.ticks + 10) {
      this.markers.arc.on = false;
      this._toGap();
    } else if (this.t === S.ticks) this.markers.arc.on = false;
  },

  // A few sparks (Sparkles.burst, `scale` times as big) at a world point.
  _sparksAt(x, y, z, tint, n, scale = 1) {
    const sp = this.objects.sparkles;
    if (!sp) return;
    _pt.x = x;
    _pt.y = y;
    _pt.z = z;
    sp.burst(_pt, this.objects.time ?? 0, tint, n, scale);
  },

  // ---------------------------------------------------------------- hurting him

  // A hurt from a point (he flies away from it).
  _hurtFrom(sx, sz) {
    const p = this.player.pos;
    let ux = p.x - sx;
    let uz = p.z - sz;
    const l = Math.sqrt(ux * ux + uz * uz);
    if (l > 1) {
      ux /= l;
      uz /= l;
    } else {
      ux = Math.sin(this.cur.yaw);
      uz = Math.cos(this.cur.yaw);
    }
    return this._hurt(ux, uz);
  },

  // One wedge (once an attack), his knockback along (ux, uz) where it lands him safely (a floor
  // on his level at KNOCK.near and .far), else toward the arena's middle.
  _hurt(ux, uz) {
    if (this.gone || this.blinking || this.atk.struck) return false;
    const player = this.player;
    const p = player.pos;
    const K = F.KNOCK;
    if (!this._safe(p.x + ux * K.near, p.z + uz * K.near) || !this._safe(p.x + ux * K.far, p.z + uz * K.far)) {
      ux = this.arena.x - p.x;
      uz = this.arena.z - p.z;
      const l = Math.sqrt(ux * ux + uz * uz) || 1;
      ux /= l;
      uz /= l;
    }
    const from = this._from;
    from.x = p.x - ux * K.from;
    from.y = p.y;
    from.z = p.z - uz * K.from;
    if (!player.takeDamage || !player.takeDamage(1, from)) return false;
    this.atk.struck = true;
    this.hurts++;
    return true;
  },

  _safe(x, z) {
    const y = this.heroFloorY;
    const f = this.collision.findFloor(x, y + 100, z);
    if (!f.surface || f.surface.surface === 'death') return false;
    return f.y - y <= F.KNOCK.dy && y - f.y <= F.KNOCK.dy;
  },

  // ---------------------------------------------------------------- the charging window

  // Its battery low: slumped, its eyes flickering and dim; then off to the charger.
  _low() {
    const c = this.cur;
    this.eyes = true;
    c.blinkL = c.blinkR = this.t % 7 < 2 ? 0.7 : 0.35;
    if (this.leave) {
      this._goHome();
      return;
    }
    if (this.t >= F.LOW) this._walkTo('charge');
  },

  // Plugged in (the cable out from the charger to its chest, the charger's own hidden), or not.
  _plug(on) {
    if (this.plugged === on) return;
    this.plugged = on;
    this.plugT = 0;
    for (let i = 0; i < this.cables.length; i++) this.cables[i].visible = !on;
    if (on) {
      this._sfx('robot_clunk', { pitch: 1.3 });
      this._emit('charging');
    }
  },

  _openUp() {
    this._set('open');
    this._sfx('robot_charge');
  },

  // The window: the hatch swings open on the glowing cells (its charging hum); hit them!
  _open() {
    const c = this.cur;
    const P = this._phase();
    c.hatch = F.HATCH * smooth(this.t / F.OPEN);
    if (this.t % 60 === 0) this._sfx('robot_charge');
    if (this.t % 5 === 0 && this.t > F.OPEN) {
      this._cells(_pt);
      this.objects.sparkles?.twinkle(_pt, 60, this.objects.time ?? 0, TINT.life);
    }
    if (this.leave) {
      this._goHome();
      return;
    }
    if (this.t >= F.OPEN + P.window) {
      this._set('unplug');
      this.goal = POSE.guard;
      this._sfx('robot_whirr');
    }
  },

  // The cells' sphere's middle (world) while it kneels.
  _cells(out) {
    const c = this.cur;
    const C = F.CELLS;
    out.x = c.x - Math.sin(c.yaw) * C.back;
    out.y = c.y + C.up;
    out.z = c.z - Math.cos(c.yaw) * C.back;
    return out;
  },

  // His attack on the cells (tested before its own step: he wins a tie): a hit.
  _cellsHit(player) {
    if (this.state !== 'open' || this.t < 3) return;
    const atk = player.getAttack ? player.getAttack() : null;
    if (atk === null || !(atk.radius > 0)) return;
    this._cells(_pt);
    const dx = atk.x - _pt.x;
    const dy = atk.y - _pt.y;
    const dz = atk.z - _pt.z;
    const r = atk.radius + F.CELLS.r;
    if (dx * dx + dy * dy + dz * dz <= r * r) this._zap();
  },

  // A hit on its body outside the window: a metal tink, a white twinkle, no damage.
  _tink(player) {
    if (this.cur.m < 1 || this.tick - this.tinkAt < F.TINK_GAP) return;
    const atk = player.getAttack ? player.getAttack() : null;
    if (atk === null || !(atk.radius > 0)) return;
    const c = this.cur;
    const dx = atk.x - c.x;
    const dz = atk.z - c.z;
    const r = atk.radius + BOSS.BUMP.body + 10;
    if (dx * dx + dz * dz > r * r || atk.y > c.y + 650) return;
    this.tinkAt = this.tick;
    this._sfx('robot_tink');
    _pt.x = atk.x;
    _pt.y = atk.y;
    _pt.z = atk.z;
    this.objects.sparkles?.twinkle(_pt, 40, this.objects.time ?? 0, TINT.petal);
  },

  // ZAP: a crackle and a pop, sparks, the hatch slams, a power light out, three coins behind it.
  _zap() {
    const c = this.cur;
    this.hits++;
    this._set('zapped');
    this.goal = POSE.zapped;
    c.lights = 3 - this.hits;
    this._sfx('robot_zap');
    this._cells(_pt);
    this.objects.sparkles?.burst(_pt, this.objects.time ?? 0, TINT.box, 14);
    this.objects.sparkles?.burst(_pt, this.objects.time ?? 0, TINT.life, 6);
    this.events.emit('bossImpact', { pos: { x: c.x, y: c.y, z: c.z }, strength: 0.45, kind: 'land' });
    // Three coins in a fan behind it (where he stands).
    const bx = -Math.sin(c.yaw);
    const bz = -Math.cos(c.yaw);
    for (let i = 0; i < F.COINS; i++) {
      const s = (i - (F.COINS - 1) / 2) * F.FAN;
      this.objects.spawnCoin(c.x + bx * 260 + bz * s, c.y + 60, c.z + bz * 260 - bx * s, c.y);
    }
    this._emit('hit');
  },

  _zapped() {
    const c = this.cur;
    c.hatch = c.hatch > 0.3 ? c.hatch - 0.3 : 0;
    if (this.t === 4) this._plug(false);
    if (this.t % 4 === 0) this._sparksAt(c.x, c.y + 300, c.z, TINT.box, 3);
    if (this.t < F.ZAPPED) return;
    if (this.hits >= 3) {
      this._defeat();
      return;
    }
    this._set('dizzy');
    this.goal = POSE.dizzy;
  },

  // Dizzy (its eyes spinning), turning round to face him; then an angry honk and the next phase.
  _dizzy() {
    this._face(Math.atan2(this.rdx, this.rdz), 0.3);
    if (this.t < F.DIZZY) return;
    this._sfx('robot_horn', { pitch: 0.8 });
    this.setIndex = 0;
    this._set('stand');
    this.goal = POSE.guard;
  },

  // No hit in the window: the hatch shuts, it unplugs, stands (a cheerful chirp) and runs the
  // same set again.
  _unplug() {
    const c = this.cur;
    c.hatch = c.hatch > 0.12 ? c.hatch - 0.12 : 0;
    if (this.t === 8) this._plug(false);
    if (this.t < F.UNPLUG) return;
    this._sfx('ev_chirp');
    this.setIndex = 0;
    this._set('stand');
  },

  // ---------------------------------------------------------------- defeat

  _defeat() {
    this.beaten = true;
    this.markers.clear();
    this._set('shortout');
    this.goal = POSE.zapped;
    this._sfx('robot_power_down');
    this._emit('beaten');
    this._sfx('boss_win');
  },

  // Short-circuiting: big sparks crackling off its joints in turn (blue-white and yellow), bits
  // flying off its neck, its power gauge sputtering, its eyes flickering and spinning (its mood);
  // sagging, sheepish.
  _shortout() {
    const c = this.cur;
    const t = this.t;
    this.eyes = true;
    c.blinkL = c.blinkR = t % 9 < 3 ? 0.8 : 0;
    c.lights = t < F.SHORT - 20 && (t * 7) % 11 < 3 ? 1 : 0;
    if (t === 30) this.goal = POSE.sheepish;
    if (t % 3 === 0) {
      const e = this.classic.rig.bones[JOINTS[(t / 3) % JOINTS.length]].matrixWorld.elements;
      this._sparksAt(e[12], e[13], e[14], t % 2 ? TINT.coin : TINT.box, 6, 2.2);
    }
    if (t % 16 === 2) this._sfx('robot_zap', { pitch: 0.7 + (t % 5) * 0.08 });
    if (t % 10 === 5) {
      const e = this.classic.rig.bones[BONE.neck].matrixWorld.elements;
      this._sparksAt(e[12], e[13], e[14], TINT.scrap, 4, 1.4);
    }
    if (t < F.SHORT) return;
    c.blinkL = c.blinkR = 0;
    c.lights = 0;
    this._walkTo('prepark');
  },

  // In front of its slot, facing its heading: it folds back into the car.
  _foldBeaten() {
    this._fold();
    this.beatenFold = true;
  },

  // Reversing into its slot as a car (beeping); waiting (honking) while he stands in it, at
  // most WAIT ticks (then it parks anyway and lifts him onto its roof).
  _reverse(player) {
    const c = this.cur;
    const S = this.spot;
    c.m = 0;
    c.lift = BOSS.LIFT;
    if (this._onSpot() && this.wait < F.WAIT) {
      this.wait++;
      if (this.wait % BOSS.SHOO_EVERY === 1) this._sfx('robot_horn');
      return;
    }
    if (this.wait >= F.WAIT) this.lifting = true;
    if (this.t % 24 === 1) this._sfx('ev_reverse');
    const dx = S.x - c.x;
    const dz = S.z - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > F.REVERSE) {
      c.x += (dx / d) * F.REVERSE;
      c.z += (dz / d) * F.REVERSE;
      c.yaw = wrap(c.yaw + wrap(this.yaw0 - c.yaw) * 0.2);
      return;
    }
    c.x = S.x;
    c.z = S.z;
    c.y = S.y;
    c.yaw = this.yaw0;
    this._set('settle');
    void player;
  },

  // Parked for good this game: blinks hello now and then (a happy double chirp).
  _tame() {
    const c = this.cur;
    if (this.state === 'tame' && this.noticeT > 0) {
      this.noticeT++;
      c.blinkL = c.blinkR = (this.noticeT >= 3 && this.noticeT <= 6) || (this.noticeT >= 11 && this.noticeT <= 14) ? 1 : 0;
      if (this.noticeT === 3 || this.noticeT === 11) this._hazard();
      if (this.noticeT === 9) this._sfx('ev_chirp', { quiet: 1 });
      if (this.noticeT >= 18) {
        this.noticeT = 0;
        this._show(false);
      }
      return;
    }
    if (this.dist < this.spec.notice && this.level && !this.away && this.tick - this.lastNotice >= BOSS.NOTICE_EVERY) {
      this.lastNotice = this.tick;
      this.noticeT = 1;
      this._show(true);
      this._sfx('ev_chirp', { quiet: 1 });
    }
  },

  // ---------------------------------------------------------------- going home

  _goHome() {
    this.leave = false;
    this._clearFight();
    this._emit('home');
    this._walkTo('home');
  },

  // ---------------------------------------------------------------- drawing

  // The fight's poses on the frame this tick (after the goal is eased in: LaneBoss._frame).
  _fightFrame(t) {
    const c = this.cur;
    // On bent legs (kneeling, a crouch, a landing): its pelvis down as far as its lower foot
    // rose (rig.footLift), its soles (or a knee) on the ground, not floating.
    const l = footLift(t[LEG_L[0] * 3], t[LEG_L[1] * 3]);
    const r = footLift(t[LEG_R[0] * 3], t[LEG_R[1] * 3]);
    this.kneelBob = l < r ? -l : -r;
    c.bob += this.kneelBob;
    this.kneeling = KNEELING[this.state] === 1 && this.kneelBob < -KNEEL_DROP * 0.5;
    // Walking: each leg up in turn, the arms swinging, the pelvis bobbing.
    if (this.walking) {
      const L = this.stepLen;
      const s = this.walkT % (2 * L);
      const legs = s < L ? LEG_L : LEG_R;
      const back = s < L ? LEG_R : LEG_L;
      const up = Math.sin((Math.PI * (s % L)) / L);
      t[legs[0] * 3] += WALK.hip[0] * up;
      t[legs[1] * 3] += WALK.kn[0] * up;
      t[legs[2] * 3] += WALK.an[0] * up;
      t[back[0] * 3] += WALK.back[0] * up;
      const swing = (s < L ? 1 : -1) * WALK.arm * up;
      t[ARM_L * 3] += swing;
      t[ARM_R * 3] -= swing;
      c.bob -= WALK.bob * up;
    }
    // Dizzy: swaying; watching: a foot tapping.
    if (this.state === 'dizzy' || this.state === 'dash_bonk') {
      const w = Math.sin(this.tick * 0.35);
      t[INDEX.chest * 3 + 2] += w * 0.12;
      t[INDEX.neck * 3 + 2] -= w * 0.2;
    } else if (this.state === 'shortout') {
      // (Shuddering as it crackles.)
      const j = this.tick % 4 < 2 ? 0.05 : -0.05;
      t[INDEX.chest * 3 + 2] += j;
      t[INDEX.neck * 3] += j;
    } else if (this.state === 'watch' && this.t > 40) {
      t[INDEX.anR * 3] += (this.tick % 16 < 8 ? -0.25 : 0) * (this.t % 90 < 60 ? 1 : 0);
    }
    // The wheels slowing down when nothing spins them.
    if (this.state !== 'swipe_tell' && this.state !== 'swipe') c.spin *= 0.94;
  },

  // Per frame: the markers, the cable (the charger to the plug in its hand, then its chest's
  // port), the reward star.
  _fightAnimate(alpha, clock, camera) {
    this.markers.animate(alpha, clock);
    if (this.plugged) {
      const b = this.classic.rig.bones[this.chestBone].matrixWorld.elements;
      const P = this.portAt;
      P.x = b[0] * PORT[0] + b[4] * PORT[1] + b[8] * PORT[2] + b[12];
      P.y = b[1] * PORT[0] + b[5] * PORT[1] + b[9] * PORT[2] + b[13];
      P.z = b[2] * PORT[0] + b[6] * PORT[1] + b[10] * PORT[2] + b[14];
      // (Taken from the holster to its chest over the plug's ticks.)
      const k = this.state === 'plug' ? smooth((this.t + alpha) / F.PLUG) : 1;
      const H = this.chargerHolster;
      _to.x = H.x + (P.x - H.x) * k;
      _to.y = H.y + (P.y - H.y) * k;
      _to.z = H.z + (P.z - H.z) * k;
      this.cable.set(true, this.chargerFrom, _to, this.chargerLight);
    } else this.cable.set(false);
    this.star.animate(clock, alpha, camera, !this.objects.star?.active);
  },
};
const _pt = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
