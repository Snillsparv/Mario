// Interactive objects of the castle grounds: yellow and red coins, the red-coin star, a hidden
// 1-up gem, butterflies and circling birds, plus their sparkles and blob shadows; the mystery box
// with the winged hat (MysteryBox.js) and the locked castle door (CastleDoor.js); and for AI RACE
// mode the "AI RACE" floor button, the robot beast on the castle roof, its fireballs and the
// robot lizard minions (Minions.js).
//
//   new ObjectManager({ scene, collision, events, layout, player, fx?, level? })
//   update({ player })             30 Hz: pickups, star state, butterfly AI, button, beast, fireballs
//   animate(time, alpha, camera)   per render frame: spin, flap, sparkles
//   reset()                        new game: every pickup back, star hidden, star count taken back,
//                                  no beast, fireballs, fire zones or minions, button up, mode off,
//                                  the mystery box lit with its hat inside, the door armed
//   spawnCoin(x, y, z)             a yellow coin appears over the floor there (minion drops)
//   ambient(time) -> alpha         title backdrop: ambient ticks that follow the caller's clock
//   setDarkness(t)                 AI RACE crossfade 0..1: butterflies and birds hide, the button glows
//
// AI RACE mode (docs/ARCHITECTURE.md): a ground pound landing on the button (layout.AI_BUTTON,
// AiButton.js) emits 'sfx' button_press and 'aiRaceButton' { on: !current }; main answers with
// 'darkMode' { on }, which raises (or sinks) the beast, a mechanical lizard (layout.KAIJU,
// RobotBeast.js), and turns the button's label to "STOP" (back to "AI RACE" when off). The beast
// spits fireballs (Fireballs.js) that explode through `fx`, scorch the ground and set trees alight
// through `level`, and hurt the hero (blast, direct hit, fire zones). Lightning ('lightning'
// { strength }) flashes the beast's plates. 10 s after the beast has fully risen, minions burrow
// out of the ground around the hero (Minions.js); they burrow back down when the mode ends.
//
// Mystery box (layout.MYSTERY_BOX, MysteryBox.js): bumped from below or punched it releases the
// winged hat (player.giveWingHat). Castle door (layout.CASTLE, CastleDoor.js): walking up to it
// plays 'evil_laugh' and opens the dialog ('signRead' { sign: { id: 'castle_locked', ... } }).
//
// Everything animates on the simulation clock (ticks + alpha), so pausing the game freezes the
// objects too. Before the first update() (the title screen shows the level behind it), and
// again after reset() until the next update(), animate() runs that clock from the caller's
// time instead (ambient()): ambient motion only (no pickups), and play then carries on from
// there without a jump. Seven draw calls in total: coins, sparkles, shadows, star, 1-up,
// butterflies, birds; plus the button (base, cap), the mystery box (frame, crystal back and
// front; the hat's three only while it is out) and, only while AI RACE mode shows them, the
// beast (nine rig parts), fireball cores, their ground markers, the fire sprites and the
// minions (one instanced draw).
//
// Allocation: once JIT-compiled, the per-frame path allocates nothing, and the per-tick path
// only event payloads plus the small result objects of its few collision queries (see
// Butterflies.js; also the star's floor while it rises). Sparkles come from a pool, sprites
// are written through SpriteBatch.next, and the hot loops avoid what V8 boxes numbers for:
// Math.hypot and Math.max/min on doubles, iterators, and numbers passed to calls that may not
// be inlined (tests/objects.test.js guards the hot methods' source).
//
// Events: 'coin' { value, pos, red, index? } (index = running red-coin count),
// 'redCoinsComplete' { pos } when the last red coin is taken (the audio plays the star
// jingle on it), 'starCollected' { pos }, 'oneUp' {}.

import * as THREE from 'three';
import { FRAME_DT, MAX_STEPS_PER_FRAME } from '../core/constants.js';
import { clamp, makeRng } from '../core/math.js';
import { BlobShadows, shadowSize } from './BlobShadows.js';
import { CoinField } from './CoinField.js';
import { Sparkles, TINT } from './Sparkles.js';
import { Star } from './Star.js';
import { OneUp } from './OneUp.js';
import { Butterflies } from './Butterflies.js';
import { Birds } from './Birds.js';
import { makeStarEnvMap } from './textures.js';
import { AiButton } from './AiButton.js';
import { RobotBeast } from './RobotBeast.js';
import { Fireballs } from './Fireballs.js';
import { FireSprites } from './FireSprites.js';
import { MysteryBox } from './MysteryBox.js';
import { Minions } from './Minions.js';
import { CastleDoor } from './CastleDoor.js';

const STAR_SHADOW = 150;
const STAR_GLOW = 360;
const ONE_UP_SHADOW = 90;
const TWINKLE_EVERY = 4; // ticks between the idle star's twinkles
const ONE_UP_TWINKLE_EVERY = 9;
const ONE_UP_BEHIND_CASTLE = 800; // default 1-up spot: this far behind the castle's back wall
const COIN_DROPS = 6; // run-time coin slots (minion drops)
const MINION_SLOTS = 8; // shadow slots for the minions (Minions POOL)
const _toCam = new THREE.Vector3();
// Stand-in hero for the title backdrop's ambient ticks: out of reach of every pickup and far
// from the butterflies.
const NOBODY = { pos: { x: 1e9, y: -1e9, z: 1e9 } };

// The hidden 1-up: layout.ONE_UP if the layout names one, else behind the castle.
function oneUpSpot(layout) {
  if (layout.ONE_UP) return layout.ONE_UP;
  const c = layout.CASTLE;
  return c ? { x: c.x, z: c.backZ - ONE_UP_BEHIND_CASTLE } : null;
}

export class ObjectManager {
  constructor({ scene, collision, events, layout, player, fx = null, level = null, buildHat = null }) {
    this.events = events;
    this.player = player;
    this.collision = collision;
    this.tick = 0;
    this.started = false; // update() seen since construction / reset(); until then animate() runs the backdrop
    this._backdropStart = null; // caller time that matches tick 0 while the backdrop runs
    this._starHolder = null; // the hero who got the star (reset() takes it back off his count)
    this.rng = makeRng(0x0b1ec7);
    this._animTick = -1; // see animate()
    this._animAlpha = 0;
    const groundAt = (x, z) => layout.groundHeight?.(x, z) ?? collision.findFloor(x, 1e5, z).y;

    const coinCount = (layout.COINS?.length ?? 0) + (layout.RED_COINS?.length ?? 0);
    this.starShadow = coinCount; // shadow slots after the coins
    this.oneUpShadow = coinCount + 1;
    const dropShadow0 = coinCount + 2;
    const boxShadow = dropShadow0 + COIN_DROPS; // box, hat
    const minionShadow0 = boxShadow + 2;
    this.shadows = new BlobShadows(minionShadow0 + (layout.KAIJU ? MINION_SLOTS : 0));
    this.coins = new CoinField({ layout, collision, groundAt, shadows: this.shadows, drops: COIN_DROPS, dropShadow0 });
    this.sparkles = new Sparkles(this.rng);
    this.star = new Star(makeStarEnvMap());
    this.starSpot = layout.STAR;
    this.starFloor = null; // floor under the star (for its shadow), found while it rises
    this.oneUpFloor = null; // { y, normal, size } of the 1-up's shadow (null: no floor)
    this.oneUp = this._makeOneUp(oneUpSpot(layout), groundAt);
    this.butterflies = new Butterflies(layout.BUTTERFLY_SPOTS ?? [], { collision, groundAt, rng: this.rng, waterTop: layout.WATER_LEVEL });
    this.birds = new Birds(layout.BIRD_CIRCLES ?? [], { collision, rng: this.rng });
    // The hero's previous tick (box bumps and stomps need his motion before the physics
    // stopped it): feet height, vertical speed, airborne.
    this.hero = { y: 0, vy: 0, air: false, valid: false };
    this.box = layout.MYSTERY_BOX
      ? new MysteryBox({ spot: layout.MYSTERY_BOX, collision, events, sparkles: this.sparkles, shadows: this.shadows, shadowSlots: [boxShadow, boxShadow + 1], groundAt, buildHat })
      : null;
    this.door = layout.CASTLE ? new CastleDoor({ castle: layout.CASTLE, collision, events }) : null;

    // AI RACE mode: the floor button, the beast and its fireballs (own random stream, so the
    // ambient objects' motion does not depend on the mode).
    this.modeOn = false; // AI RACE mode as last switched ('darkMode' events, or our own button)
    this.darkT = 0;
    this.button = layout.AI_BUTTON ? new AiButton({ spot: layout.AI_BUTTON, collision, groundAt }) : null;
    if (layout.KAIJU) {
      const rng = makeRng(0xa1ace);
      this.fire = new FireSprites(rng);
      this.fireballs = new Fireballs({ collision, events, fx, level, layout, fire: this.fire, rng });
      const balls = this.fireballs;
      this.beast = new RobotBeast({
        anchor: layout.KAIJU,
        collision,
        events,
        fire: this.fire,
        rng,
        launch: (x, y, z, vx, vy, vz) => balls.launch(x, y, z, vx, vy, vz),
      });
      this.minions = new Minions({
        collision,
        events,
        fx,
        fire: this.fire,
        sparkles: this.sparkles,
        shadows: this.shadows,
        shadowBase: minionShadow0,
        rng: makeRng(0x3a11ce),
        layout,
        groundAt: layout.groundHeight ?? null,
        onCoin: (x, y, z) => this.spawnCoin(x, y, z),
      });
    } else {
      this.fire = this.fireballs = this.beast = this.minions = null;
    }
    events.on?.('darkMode', (e) => this._setMode(!!e?.on));
    events.on?.('lightning', (e) => this.beast?.flash(e?.strength ?? 1));

    this.group = new THREE.Group();
    this.group.name = 'objects';
    for (const part of [this.shadows, this.coins, this.star, this.oneUp, this.butterflies, this.birds, this.sparkles, this.button, this.box, this.beast, this.fireballs, this.minions, this.fire]) {
      if (part) this.group.add(part.mesh);
    }
    scene.add(this.group);
    this._draw(0, 1, null);
  }

  // AI RACE mode switched (main's 'darkMode' event): the beast rises or sinks, and the button's
  // cap reads "STOP" while the mode is on ("AI RACE" while it is off).
  _setMode(on) {
    this.modeOn = on;
    this.button?.setOn(on);
    this.beast?.setMode(on);
  }

  // The button was pounded: ask main to toggle the mode.
  _pressButton() {
    const on = !this.modeOn;
    this.modeOn = on;
    const b = this.button;
    this.events.emit('sfx', { name: 'button_press', pos: { x: b.x, y: b.capTop0, z: b.z } });
    this.events.emit('aiRaceButton', { on });
  }

  // AI RACE crossfade (main calls it every tick while it changes): butterflies and birds keep
  // away from the storm, and the button glows. Reaching full darkness without a 'darkMode'
  // event (a preview, a test) still brings the beast.
  setDarkness(t) {
    this.darkT = t;
    this.button?.setDarkness(t);
    this.box?.setDarkness(t);
    const calm = t < 0.5;
    this.butterflies.mesh.visible = calm;
    this.birds.mesh.visible = calm;
    if (t >= 0.999 && !this.modeOn) this._setMode(true);
  }

  _makeOneUp(spot, groundAt) {
    if (!spot) return null;
    const floor = this.collision.findFloor(spot.x, (spot.y ?? groundAt(spot.x, spot.z)) + 100, spot.z);
    const floorY = floor.surface ? floor.y : groundAt(spot.x, spot.z);
    const gem = new OneUp(spot, floorY);
    if (floor.surface) {
      const size = shadowSize(ONE_UP_SHADOW, gem.pos.y - floor.y);
      this.oneUpFloor = { y: floor.y, normal: { ...floor.surface.normal }, size };
      this.shadows.place(this.oneUpShadow, spot.x, floor.y, spot.z, floor.surface.normal, size);
    }
    return gem;
  }

  // A new game after GAME OVER: every coin comes back (red-coin count 0), the star is hidden
  // again until the next full set of red coins, the 1-up returns, and live sparkles vanish. The
  // hero who got the star loses it from his count, so the restored star is not counted twice.
  // The tick clock keeps running (birds and butterflies carry on where they are); until the
  // next update(), animate() drives it from the caller's time, as behind the first title.
  reset() {
    this.coins.reset();
    this.star.reset();
    this.starFloor = null;
    this.shadows.hide(this.starShadow);
    if (this._starHolder) {
      const holder = this._starHolder;
      holder.stars = holder.stars > 0 ? holder.stars - 1 : 0;
      this._starHolder = null;
    }
    const gem = this.oneUp;
    if (gem) {
      gem.reset();
      const f = this.oneUpFloor;
      if (f) this.shadows.place(this.oneUpShadow, gem.pos.x, f.y, gem.pos.z, f.normal, f.size);
    }
    this.sparkles.clear();
    // AI RACE mode ends with the game: no beast, fireballs or fires, the button up.
    this.modeOn = false;
    this.button?.reset();
    this.beast?.reset();
    this.fireballs?.clear();
    this.minions?.clear();
    this.box?.reset();
    this.door?.reset();
    this.hero.valid = false;
    this.setDarkness(0);
    this.started = false;
    this._backdropStart = null;
  }

  // Simulation time of the latest tick, in seconds.
  get time() {
    return this.tick * FRAME_DT;
  }

  update(ctx = {}) {
    this.started = true;
    this._backdropStart = null; // the next backdrop anchors to wherever play left the clock
    this._step(ctx.player ?? this.player);
  }

  // One 30 Hz tick: pickups by the hero, star state, butterfly AI.
  _step(player) {
    this.tick++;
    const pos = player.pos;

    const hits = this.coins.collect(pos);
    for (let i = 0; i < hits.length; i++) {
      const c = hits[i];
      const cpos = { x: c.x, y: c.y, z: c.z };
      player.collectCoin(c.value);
      this.events.emit('coin', c.red ? { value: c.value, pos: cpos, red: true, index: c.index } : { value: c.value, pos: cpos, red: false });
      this.sparkles.burst(cpos, this.time, c.red ? TINT.red : TINT.coin);
      if (c.red && this.coins.allRedCollected) this._spawnStar();
    }

    this._updateStar(player);
    this._updateOneUp(player);
    this.butterflies.update(this.tick, pos);
    if (this.button !== null && this.button.update(player)) this._pressButton();
    const hero = this.hero.valid ? this.hero : null;
    if (this.box !== null) this.box.update(player, hero, this.tick);
    if (this.door !== null) this.door.update(player);
    if (this.beast !== null) {
      this.beast.update(player, this.tick);
      this.fireballs.update(player, this.tick);
      this.minions.update(player, hero, this.tick, this.modeOn && this.beast.state === 'active');
    }
    this._rememberHero(player);
  }

  // The hero's motion this tick, read on the next one (see this.hero).
  _rememberHero(player) {
    const h = this.hero;
    const p = player.pos;
    const vy = player.vel ? player.vel.y : 0;
    h.y = p.y;
    h.vy = vy;
    const f = player.floor;
    h.air = f && f.surface !== undefined ? !(f.surface && p.y <= f.y + 1) : vy !== 0;
    h.valid = true;
  }

  // A yellow coin appears over the floor under (x, y, z) (a wrecked minion's drop).
  spawnCoin(x, y, z) {
    const c = this.coins.spawnCoin(x, y, z);
    if (c) this.sparkles.burst(c, this.time, TINT.coin, 5);
    return c;
  }

  _spawnStar() {
    const s = this.starSpot;
    if (!s) return;
    const floor = this.collision.findFloor(s.x, s.y, s.z);
    const fromY = floor.surface ? floor.y + 40 : s.y - 300;
    this.star.spawn(s, fromY);
    this.events.emit('redCoinsComplete', { pos: { x: s.x, y: s.y, z: s.z } });
  }

  _updateStar(player) {
    const star = this.star;
    star.update();
    if (!star.active) return;
    // The floor under the star (for its shadow) only changes while it rises; age 0 in 'idle'
    // is the tick it arrives.
    if (star.state === 'rising' || star.age === 0) this.starFloor = this.collision.findFloor(star.pos.x, star.pos.y, star.pos.z, 0);
    if (star.state === 'rising') {
      this.sparkles.trail(star.pos, this.time, TINT.star);
      this.sparkles.trail(star.pos, this.time, TINT.star);
    } else {
      if (this.tick % TWINKLE_EVERY === 0) this.sparkles.twinkle(star.pos, 90, this.time, TINT.star);
      if (star.touches(player.pos)) {
        const pos = { ...star.pos };
        star.collect();
        this.shadows.hide(this.starShadow);
        this.sparkles.glow.visible = false;
        this.sparkles.burst(pos, this.time, TINT.star, 12);
        player.collectStar();
        this._starHolder = player;
        this.events.emit('starCollected', { pos });
      }
    }
  }

  _updateOneUp(player) {
    const gem = this.oneUp;
    if (!gem?.alive) return;
    if (this.tick % ONE_UP_TWINKLE_EVERY === 0) this.sparkles.twinkle(gem.pos, 60, this.time, TINT.life);
    if (!gem.touches(player.pos)) return;
    gem.collect();
    this.shadows.hide(this.oneUpShadow);
    this.sparkles.burst(gem.pos, this.time, TINT.life, 10);
    this.events.emit('oneUp', {});
  }

  // Once play has started, time (seconds) is not used: the objects follow the simulation clock
  // so they pause with it.
  animate(time, alpha, camera) {
    if (!this.started) alpha = this.ambient(time);
    // While no tick runs (pause), the caller's alpha keeps cycling 0..1; holding the largest
    // alpha seen since the last tick freezes the objects instead of flickering. During play
    // alpha only grows between ticks, so this changes nothing.
    if (this.tick === this._animTick && this._animAlpha > alpha) alpha = this._animAlpha;
    this._animTick = this.tick;
    this._animAlpha = alpha;
    const clock = (this.tick - 1 + alpha) * FRAME_DT;
    this._draw(clock > 0 ? clock : 0, alpha, camera);
  }

  // Title backdrop: runs ambient ticks (butterflies wander, sparkles twinkle; no pickups) to
  // keep up with the caller's clock `time` (seconds) and returns the alpha into the latest one,
  // for animate(). The first call after construction, reset() or play anchors the clock where
  // the ticks are, so nothing jumps. A long stall (hidden tab) skips ahead instead of catching
  // up. animate() calls this itself until the first update() (and after reset()).
  ambient(time) {
    this._backdropStart ??= time - this.tick * FRAME_DT;
    const due = (time - this._backdropStart) / FRAME_DT;
    for (let n = 0; this.tick < Math.floor(due) && n < MAX_STEPS_PER_FRAME; n++) this._step(NOBODY);
    if (this.tick < Math.floor(due)) this._backdropStart = time - this.tick * FRAME_DT;
    return clamp(due - this.tick, 0, 1);
  }

  // Writes every object's pose for simulation time `clock` (seconds).
  _draw(clock, alpha, camera) {
    this.coins.animate(clock);
    this.oneUp?.animate(clock);
    this.butterflies.animate(alpha);
    this.birds.animate(clock);

    const star = this.star;
    if (star.active) {
      star.animate(clock, alpha);
      const r = star.render;
      const floor = this.starFloor;
      if (floor?.surface) {
        const size = shadowSize(STAR_SHADOW * r.scale, r.y - floor.y);
        this.shadows.place(this.starShadow, r.x, floor.y, r.z, floor.surface.normal, size);
      }
      // Halo sprite pushed a little behind the star so it glows around it, not over it.
      _toCam.set(r.x, r.y, r.z);
      if (camera) _toCam.sub(camera.position).setLength(70);
      else _toCam.set(0, 0, 0);
      this.sparkles.setGlow(r.x + _toCam.x, r.y + _toCam.y, r.z + _toCam.z, STAR_GLOW * r.scale, 0.55);
    }
    this.sparkles.animate(clock);
    if (this.button !== null) this.button.animate(alpha, clock);
    if (this.box !== null) this.box.animate(alpha, clock);
    if (this.beast !== null) {
      this.beast.animate(alpha, clock, camera);
      this.fireballs.animate(alpha, clock);
      this.minions.animate(alpha, clock, camera);
      this.fire.animate(clock);
    }
  }
}
