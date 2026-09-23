// Interactive objects of the castle grounds: yellow and red coins, the red-coin star, a hidden
// 1-up gem, butterflies and circling birds, plus their sparkles and blob shadows.
//
//   new ObjectManager({ scene, collision, events, layout, player })
//   update({ player })             30 Hz: pickups, star state, butterfly AI
//   animate(time, alpha, camera)   per render frame: spin, flap, sparkles
//
// Everything animates on the simulation clock (ticks + alpha), so pausing the game freezes the
// objects too. Seven draw calls in total: coins, sparkles, shadows, star, 1-up, butterflies,
// birds. The per-tick and per-frame paths do not allocate (apart from event payloads).
//
// Events: 'coin' { value, pos, red, index? } (index = running red-coin count),
// 'redCoinsComplete' { pos } when the last red coin is taken (the audio plays the star
// jingle on it), 'starCollected' { pos }, 'oneUp' {}.

import * as THREE from 'three';
import { FRAME_DT } from '../core/constants.js';
import { makeRng } from '../core/math.js';
import { BlobShadows, shadowSize } from './BlobShadows.js';
import { CoinField } from './CoinField.js';
import { Sparkles, TINT } from './Sparkles.js';
import { Star } from './Star.js';
import { OneUp } from './OneUp.js';
import { Butterflies } from './Butterflies.js';
import { Birds } from './Birds.js';
import { makeStarEnvMap } from './textures.js';

const STAR_SHADOW = 150;
const STAR_GLOW = 360;
const ONE_UP_SHADOW = 90;
const TWINKLE_EVERY = 4; // ticks between the idle star's twinkles
const ONE_UP_TWINKLE_EVERY = 9;
const ONE_UP_BEHIND_CASTLE = 800; // default 1-up spot: this far behind the castle's back wall
const _toCam = new THREE.Vector3();

// The hidden 1-up: layout.ONE_UP if the layout names one, else behind the castle.
function oneUpSpot(layout) {
  if (layout.ONE_UP) return layout.ONE_UP;
  const c = layout.CASTLE;
  return c ? { x: c.x, z: c.backZ - ONE_UP_BEHIND_CASTLE } : null;
}

export class ObjectManager {
  constructor({ scene, collision, events, layout, player }) {
    this.events = events;
    this.player = player;
    this.collision = collision;
    this.tick = 0;
    this.rng = makeRng(0x0b1ec7);
    this._animTick = -1; // see animate()
    this._animAlpha = 0;
    const groundAt = (x, z) => layout.groundHeight?.(x, z) ?? collision.findFloor(x, 1e5, z).y;

    const coinCount = (layout.COINS?.length ?? 0) + (layout.RED_COINS?.length ?? 0);
    this.starShadow = coinCount; // shadow slots after the coins
    this.oneUpShadow = coinCount + 1;
    this.shadows = new BlobShadows(coinCount + 2);
    this.coins = new CoinField({ layout, collision, groundAt, shadows: this.shadows });
    this.sparkles = new Sparkles(this.rng);
    this.star = new Star(makeStarEnvMap());
    this.starSpot = layout.STAR;
    this.starFloor = null; // floor under the star, refreshed every tick while it shows
    this.oneUp = this._makeOneUp(oneUpSpot(layout), groundAt);
    this.butterflies = new Butterflies(layout.BUTTERFLY_SPOTS ?? [], { collision, groundAt, rng: this.rng });
    this.birds = new Birds(layout.BIRD_CIRCLES ?? [], this.rng);

    this.group = new THREE.Group();
    this.group.name = 'objects';
    for (const part of [this.shadows, this.coins, this.star, this.oneUp, this.butterflies, this.birds, this.sparkles]) {
      if (part) this.group.add(part.mesh);
    }
    scene.add(this.group);
  }

  _makeOneUp(spot, groundAt) {
    if (!spot) return null;
    const floor = this.collision.findFloor(spot.x, (spot.y ?? groundAt(spot.x, spot.z)) + 100, spot.z);
    const floorY = floor.surface ? floor.y : groundAt(spot.x, spot.z);
    const gem = new OneUp(spot, floorY);
    if (floor.surface) {
      const size = shadowSize(ONE_UP_SHADOW, gem.pos.y - floor.y);
      this.shadows.place(this.oneUpShadow, spot.x, floor.y, spot.z, floor.surface.normal, size);
    }
    return gem;
  }

  // Simulation time of the latest tick, in seconds.
  get time() {
    return this.tick * FRAME_DT;
  }

  update(ctx = {}) {
    this.tick++;
    const player = ctx.player ?? this.player;
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
    this.starFloor = this.collision.findFloor(star.pos.x, star.pos.y, star.pos.z, 0);
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

  // time (seconds) is not used: the objects follow the simulation clock so they pause with it.
  animate(time, alpha, camera) {
    // While no tick runs (pause), the caller's alpha keeps cycling 0..1; holding the largest
    // alpha seen since the last tick freezes the objects instead of flickering. During play
    // alpha only grows between ticks, so this changes nothing.
    if (this.tick === this._animTick) alpha = Math.max(alpha, this._animAlpha);
    this._animTick = this.tick;
    this._animAlpha = alpha;

    const clock = Math.max(0, (this.tick - 1 + alpha) * FRAME_DT);
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
  }
}
