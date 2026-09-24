// The hero's simulation: an action state machine ticked at 30 Hz (see docs/ARCHITECTURE.md
// for the Player contract). Actions live in ./actions (one file per group); collision
// stepping and velocity helpers in ./physics. Velocities are in units/tick.

import { clamp, lerp, lerpAngle, stickToWorldYaw } from '../core/math.js';
import { FRAME_DT, NO_WATER } from '../core/constants.js';
import { neutralController } from '../core/input.js';
import { SIGNS, groundHeight } from '../world/layout.js';
import * as T from './physics/tuning.js';
import { UP } from './physics/slopes.js';
import { ACTIONS, enterWater } from './actions/index.js';

// Actions during which water entry is not checked (they position the hero themselves).
const NO_WATER_CHECK = new Set(['death', 'ledge_hang', 'ledge_climb', 'pole', 'pole_top', 'spawn']);
const ON_TREE = new Set(['pole', 'pole_top']);
const FOOTSTEP_ANIMS = new Set(['tiptoe', 'walk', 'run', 'crawl']);
const MAX_CHAINED_ACTIONS = 8;

function finiteClamp(v, lo, hi) {
  return Number.isFinite(v) ? clamp(v, lo, hi) : 0;
}

// A button snapshot that does not count as a fresh press.
function unpressed(b) {
  return b.pressed ? { ...b, pressed: false } : b;
}

// Readable signs as the reach test uses them: `y` is the sign's foot (sign.y if given, else
// the layout's ground height there).
function signEntries(signs) {
  return (signs ?? []).map((sign) => ({
    sign,
    x: sign.x,
    z: sign.z,
    y: sign.y ?? groundHeight(sign.x, sign.z),
    yaw: sign.yaw ?? 0,
  }));
}

export class Player {
  // `signs`: readable signs ([{ x, z, yaw, y?, pages, ... }], default layout.SIGNS; [] for none).
  constructor({ collision, events, spawn, signs = SIGNS }) {
    this.collision = collision;
    this.events = events;
    this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw ?? 0 };
    this.signs = signEntries(signs);
    this.readingSign = null; // the p.signs entry being read (action 'reading')
    this.pressGuard = false; // the next tick ignores fresh A/B/Z presses (see endReading)

    this.pos = { x: 0, y: 0, z: 0 };
    this.prevPos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.slideVel = { x: 0, z: 0 };
    this.forwardVel = 0;
    this.airDrift = 0; // sideways air drift (units/tick), see updateAirControl
    this.faceYaw = 0;
    this.prevFaceYaw = 0;
    this.pitch = 0; // render orientation, set by actions every tick
    this.roll = 0;
    this.prevPitch = 0;
    this.prevRoll = 0;
    this.headYaw = 0;
    this.swimPitch = 0;
    this.waterVy = 0;
    this.atSurface = false; // swimming: floating at the surface after the last water step

    this.input = neutralController();
    this.cameraYaw = 0;
    this.stickMag = 0; // effective stick magnitude (see readInput)
    this.stickHeld = false;
    this.intendedMag = 0;
    this.intendedYaw = 0;
    this.rawStickX = 0; // the stick at the keys' full push (no keyboard ease-in, see readInput)
    this.rawStickY = 0;
    this.fullPush = false; // this key hold skips the rest of the ease-in (see readInput)

    this.action = 'idle';
    this.prevAction = 'idle';
    this.actionTimer = 0;
    this.anim = 'idle';
    this.animTicks = 0;
    this.cyclePhase = 0;
    this.prevCyclePhase = 0;
    this.punchStep = 0;

    this.tick = 0;
    this.floor = { y: 0, surface: null };
    this.grounded = true;
    this.waterLevel = NO_WATER;
    this.inWater = false;
    this.peakY = 0;
    this.fallCeiling = Infinity; // falls count from no higher than this (a tree's foot, see afterTick)
    this.wall = null;
    this.wallTouchTick = -Infinity;
    this.jumpChain = { kind: null, landedAt: -Infinity };
    this.comboJump = null; // a fast jump's take-off { fv, y }: Z soon after long-jumps (airborne.js)
    this.grabCooldownUntil = 0;
    this.letGoPole = null; // trunk let go of with Z: not grabbed again before landing
    this.walkOff = null; // walked off a ledge: where the air steps drift him clear of it (step.js)

    this.health = T.MAX_HEALTH;
    this.coins = 0;
    this.stars = 0;
    this.breath = 1;
    this.invincibleUntil = 0;
    this.drownTicks = 0;
    this.healTicks = 0;

    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z, this.spawn.yaw);
  }

  // ------------------------------------------------------------------ tick

  update(controller, cameraYaw = 0) {
    const p = this.pos;
    this.prevPos.x = p.x;
    this.prevPos.y = p.y;
    this.prevPos.z = p.z;
    this.prevFaceYaw = this.faceYaw;
    this.prevPitch = this.pitch;
    this.prevRoll = this.roll;
    this.prevCyclePhase = this.cyclePhase;
    this.pitch = 0;
    this.roll = 0;
    this.headYaw = 0;

    const c = this.readInput(controller, cameraYaw);
    this.waterLevel = this.collision.waterLevelAt(p.x, p.z);
    const def = ACTIONS[this.action];
    if (def.group !== 'submerged' && !NO_WATER_CHECK.has(this.action) && p.y < this.waterLevel - T.WATER_ENTER_DEPTH) {
      enterWater(this);
    }

    for (let i = 0; i < MAX_CHAINED_ACTIONS; i++) {
      if (!ACTIONS[this.action].update(this, c)) break;
    }
    this.recoverFromBadState();
    this.afterTick();
  }

  // Stores the controller (sanitised: finite stick values within -1..1) and derives the
  // intended speed / direction. A non-finite camera yaw reuses the last good one.
  //
  // Keyboard ease-in (core/input.js): stickMag rises over ~0.37 s after a key is pressed from
  // rest while rawStickMag is the key's full push along the same direction. The eased stick
  // softens starting from rest only: as soon as the hero already moves faster than it asks for
  // (a key pressed again while still skidding, mid-air at speed, a start downhill), the full
  // push applies for the rest of that hold, so pressing a key never slows him down. Stick
  // thresholds that must answer at once (water jump-out / dive, pole climbing) read
  // rawStickX / rawStickY. For a gamepad (or a controller without rawStickMag) both are equal.
  readInput(c, cameraYaw) {
    if (!(Math.abs(c.stickX) <= 1 && Math.abs(c.stickY) <= 1 && c.stickMag >= 0 && c.stickMag <= 1)) {
      c = { ...c, stickX: finiteClamp(c.stickX, -1, 1), stickY: finiteClamp(c.stickY, -1, 1), stickMag: finiteClamp(c.stickMag, 0, 1) };
    }
    if (this.pressGuard) {
      this.pressGuard = false;
      c = { ...c, A: unpressed(c.A), B: unpressed(c.B), Z: unpressed(c.Z) };
    }
    if (Number.isFinite(cameraYaw)) this.cameraYaw = cameraYaw;
    this.input = c;
    const eased = c.stickMag;
    const raw = eased > 0 && Number.isFinite(c.rawStickMag) ? clamp(c.rawStickMag, eased, 1) : eased;
    const k = eased > 0 ? raw / eased : 0;
    this.rawStickX = c.stickX * k;
    this.rawStickY = c.stickY * k;
    if (raw <= eased) this.fullPush = false;
    else if (eased * eased * T.MAX_TARGET_SPEED < Math.abs(this.forwardVel)) this.fullPush = true;
    this.stickMag = this.fullPush ? raw : eased;
    this.intendedMag = this.stickMag * this.stickMag * T.MAX_TARGET_SPEED;
    this.stickHeld = this.intendedMag > 0.5;
    this.intendedYaw = this.stickHeld ? stickToWorldYaw(c.stickX, c.stickY, this.cameraYaw) : this.faceYaw;
    return c;
  }

  // Last line of defence: a non-finite position / velocity / facing (which nothing could
  // ever recover from) restores the previous tick's placement, at rest.
  recoverFromBadState() {
    const { pos, vel } = this;
    if (Number.isFinite(pos.x + pos.y + pos.z + vel.x + vel.y + vel.z + this.forwardVel + this.faceYaw + this.swimPitch)) return;
    this.swimPitch = 0;
    this.waterVy = 0;
    this.teleport(this.prevPos.x, this.prevPos.y, this.prevPos.z, this.prevFaceYaw);
    this.setAction(this.grounded ? 'idle' : 'freefall');
  }

  afterTick() {
    const group = ACTIONS[this.action].group;
    // A death at swimming depth (drowning, hurt while swimming) still counts as in the water,
    // so the camera stays under the surface with the hero instead of popping above it.
    this.inWater =
      group === 'submerged' ||
      (this.action === 'death' && this.waterLevel !== NO_WATER && this.pos.y < this.waterLevel - T.WATER_ENTER_DEPTH);
    if (this.action !== 'punch') this.punchStep = 0;
    // Fall height for fall damage: from the highest point since leaving the ground, but a fall
    // that starts on a tree counts from its foot (FALL_DAMAGE notes in tuning.js).
    if (ON_TREE.has(this.action)) this.fallCeiling = this.pole.y0;
    else if (this.grounded || this.inWater || group === 'automatic') this.fallCeiling = Infinity;
    if (this.grounded || this.inWater || group === 'automatic') this.peakY = this.pos.y;
    else this.peakY = Math.min(this.fallCeiling, Math.max(this.peakY, this.pos.y));
    if ((this.grounded || this.inWater) && this.action !== 'pole') this.letGoPole = null;
    if (group !== 'airborne') this.walkOff = null;
    this.updateBreath();
    this.emitFootsteps();
    this.checkOutOfBounds();
    this.actionTimer++;
    this.animTicks++;
    this.tick++;
  }

  // With the head under water a wedge drains every DROWN_TICKS; breathing (feet within
  // BREATHING_DEPTH of the surface, in any swim action) refills a wedge every SURFACE_HEAL_TICKS.
  updateBreath() {
    if (!this.inWater || this.action === 'death') {
      this.drownTicks = 0;
      this.breath = 1;
      return;
    }
    if (this.pos.y >= this.waterLevel - T.BREATHING_DEPTH) {
      this.drownTicks = 0;
      if (this.health < T.MAX_HEALTH && ++this.healTicks >= T.SURFACE_HEAL_TICKS) {
        this.healTicks = 0;
        this.health++;
      }
    } else if (++this.drownTicks >= T.DROWN_TICKS) {
      this.drownTicks = 0;
      this.loseHealth(1);
    }
    this.breath = 1 - this.drownTicks / T.DROWN_TICKS;
  }

  emitFootsteps() {
    if (!this.grounded || !FOOTSTEP_ANIMS.has(this.anim)) return;
    if (Math.floor(this.cyclePhase * 2) === Math.floor(this.prevCyclePhase * 2)) return;
    const terrain = this.pos.y < this.waterLevel ? 'water' : this.floor.surface?.terrain ?? 'grass';
    // speed: the hero's speed this tick (tiptoe steps ~2-8, a full run 32); gait: the anim.
    this.emit('footstep', { terrain, pos: { ...this.pos }, speed: Math.abs(this.forwardVel), gait: this.anim });
  }

  // Falling out of the level or standing on a 'death' floor costs a life.
  checkOutOfBounds() {
    if (this.action === 'death') return;
    const deathFloor = this.grounded && this.floor.surface?.surface === 'death';
    if (deathFloor || (this.pos.y < T.OUT_OF_BOUNDS_Y && !this.floor.surface)) this.loseLife();
  }

  // ---------------------------------------------------------- action API

  // Switches action; returns true so updates can `return p.setAction(...)` to run it now.
  setAction(name, arg) {
    const def = ACTIONS[name];
    if (!def) throw new Error(`Unknown player action: ${name}`);
    this.prevAction = this.action;
    this.action = name;
    this.actionTimer = 0;
    if (def.anim) this.setAnim(def.anim);
    def.enter?.(this, arg);
    return true;
  }

  setAnim(name, restart = false) {
    if (name === this.anim && !restart) return;
    this.anim = name;
    this.animTicks = 0;
  }

  // Keeps the current anim on its first pose through this tick (animTime stays 0).
  holdAnimStart() {
    this.animTicks = -1;
  }

  emit(name, data) {
    this.events?.emit(name, data);
  }

  sfx(name) {
    this.emit('sfx', { name, pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z } });
  }

  // Places the hero without interpolation smear.
  teleport(x, y, z, yaw = this.faceYaw) {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.prevPos.x = x;
    this.prevPos.y = y;
    this.prevPos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.slideVel.x = this.slideVel.z = 0;
    this.forwardVel = 0;
    this.airDrift = 0;
    this.letGoPole = null;
    this.walkOff = null;
    this.faceYaw = this.prevFaceYaw = yaw;
    this.pitch = this.roll = this.prevPitch = this.prevRoll = 0;
    this.peakY = y;
    this.fallCeiling = Infinity;
    this.floor = this.collision.findFloor(x, y + 10, z);
    this.grounded = !!this.floor.surface && y - this.floor.y < 1;
    this.waterLevel = this.collision.waterLevelAt(x, z);
  }

  // Optional drop-in from the sky at the spawn point (also used on respawn).
  beginIntro() {
    const s = this.spawn;
    this.teleport(s.x, s.y + T.INTRO_DROP, s.z, s.yaw);
    this.setAction('spawn');
  }

  respawn() {
    this.health = T.MAX_HEALTH;
    this.invincibleUntil = 0;
    this.drownTicks = 0;
    this.beginIntro();
  }

  loseLife() {
    this.emit('lifeLost', {});
    this.respawn();
  }

  // Health loss without knockback (falls, drowning). Zero health -> death.
  loseHealth(wedges) {
    this.health = Math.max(0, this.health - wedges);
    this.emit('hurt', { pos: { ...this.pos }, amount: wedges });
    if (this.health === 0 && this.action !== 'death') this.setAction('death');
  }

  // ------------------------------------------------------------ contract

  collectCoin(value = 1) {
    this.coins += value;
    this.health = Math.min(T.MAX_HEALTH, this.health + value);
  }

  // The dialog box closed: stop reading and stand idle. The next update ignores fresh A/B/Z
  // presses, so the press that closed the box never turns into a jump or a punch even if it
  // still reaches the Player (main also flushes its input on 'dialogClosed').
  endReading() {
    if (this.action !== 'reading') return;
    this.readingSign = null;
    this.pressGuard = true;
    this.setAction('idle');
  }

  // The celebration plays on the ground: grabbed in mid-air, the hero drops first (star_fall).
  collectStar() {
    this.stars++;
    if (this.inWater || this.action === 'death') return;
    this.setAction(this.grounded ? 'star_dance' : 'star_fall');
  }

  // Damage with knockback away from fromPos, then INVINCIBLE_TICKS of invulnerability.
  // opts.fire: burnt (touching fire) instead: on land a hot-foot hop (action / anim 'burn',
  // sfx 'burn'), running in the air away from fromPos (or on along the facing when fromPos is
  // right under him or not given). In water the usual knockback.
  takeDamage(wedges = 1, fromPos = null, opts = null) {
    if (this.tick < this.invincibleUntil || this.action === 'death' || this.action === 'spawn') return false;
    this.invincibleUntil = this.tick + T.INVINCIBLE_TICKS;
    this.loseHealth(wedges);
    if (this.action === 'death') return true;
    const dx = fromPos ? fromPos.x - this.pos.x : 0;
    const dz = fromPos ? fromPos.z - this.pos.z : 0;
    const yaw = fromPos ? Math.atan2(dx, dz) : this.faceYaw;
    if (this.inWater) {
      this.faceYaw = yaw;
      this.forwardVel = -12;
      this.setAction('swim_idle');
    } else if (opts?.fire) {
      const away = dx * dx + dz * dz > 1 ? yaw + Math.PI : this.faceYaw;
      this.setAction('burn', { yaw: away });
    } else {
      this.setAction('hurt', { yaw });
    }
    return true;
  }

  getRenderState(alpha = 1) {
    const a = clamp(alpha, 0, 1);
    const p = this.prevPos;
    const c = this.pos;
    const n = this.floor.surface?.normal ?? UP;
    return {
      pos: { x: lerp(p.x, c.x, a), y: lerp(p.y, c.y, a), z: lerp(p.z, c.z, a) },
      yaw: lerpAngle(this.prevFaceYaw, this.faceYaw, a),
      pitch: lerp(this.prevPitch, this.pitch, a),
      roll: lerp(this.prevRoll, this.roll, a),
      action: this.action,
      anim: this.anim,
      animTime: Math.max(0, this.animTicks - 1 + a) * FRAME_DT,
      cyclePhase: lerp(this.prevCyclePhase, this.cyclePhase, a),
      forwardVel: this.forwardVel,
      vy: this.vel.y,
      grounded: this.grounded,
      inWater: this.inWater,
      floorY: this.floor.y,
      floorNormal: { x: n.x, y: n.y, z: n.z },
      health: this.health,
      invincible: this.tick < this.invincibleUntil,
      punchStep: this.punchStep,
      headYaw: this.headYaw,
    };
  }
}
