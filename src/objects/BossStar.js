// The reward for beating Rustmaw (AI RACE mode's mechanical lizard, RobotBeast.js): a second
// star (Star.js, the same original design with a warmer, redder glow, as if forged in its
// furnace) that spirals up out of the crash site once the wreck has sunk away. It shows once
// per game: throwing the repaired beast off the roof again brings no second one. Touching it is
// like touching the red-coin star: player.collectStar() (the celebration), 'starCollected'
// { pos, boss: true }. reset() (a new game) hides it and takes it back off the hero's count.
//
//   const bs = new BossStar({ events, collision, sparkles, shadows, shadowSlot, envMap })
//   bs.mesh                              (one draw call while it shows)
//   bs.update(player, beast, time, tick) 30 Hz: spawn when beast.starDue, rise, pickup
//   bs.animate(clock, alpha, camera, glowFree)  render; glowFree: the halo sprite is free to use
//   bs.reset()
//   bs.star, bs.awarded (it came out this game), bs.holder

import * as THREE from 'three';
import { Star } from './Star.js';
import { TINT } from './Sparkles.js';
import { shadowSize } from './BlobShadows.js';
import { NO_WATER } from '../core/constants.js';

const SHADOW = 150;
const GLOW = 360;
const TWINKLE_EVERY = 4;
const OVER_GROUND = 450; // where it hovers over the crash site (a jump reaches it)...
const OVER_WATER = 150; // ...or over the water, where a swimmer at the surface touches it
const _toCam = new THREE.Vector3();

export class BossStar {
  constructor({ events, collision, sparkles, shadows = null, shadowSlot = -1, envMap = null }) {
    this.events = events;
    this.collision = collision;
    this.sparkles = sparkles;
    this.shadows = shadows;
    this.shadowSlot = shadowSlot;
    this.star = new Star(envMap, { color: 0xffb42a, emissive: 0x8a2c00 });
    this.star.mesh.name = 'bossStar';
    this.mesh = this.star.mesh;
    this.awarded = false;
    this.holder = null;
    this.floor = null; // the floor under it (its shadow), found while it rises
    this.glowing = false; // it holds the halo sprite
  }

  // Spirals up out of the crash site (wreck: { x, z, floorY, water }).
  spawn(wreck) {
    if (this.awarded) return false;
    this.awarded = true;
    const y = wreck.floorY + (wreck.water ? OVER_WATER : OVER_GROUND);
    this.star.spawn({ x: wreck.x, y, z: wreck.z }, wreck.floorY + 40);
    this.floor = null;
    this.events.emit('sfx', { name: 'star_appear', pos: { x: wreck.x, y, z: wreck.z } });
    return true;
  }

  update(player, beast, time, tick) {
    if (beast && beast.starDue) {
      beast.starDue = false;
      this.spawn(beast.wreckPos);
    }
    const star = this.star;
    star.update();
    if (!star.active) return;
    if (star.state === 'rising' || star.age === 0) {
      const f = this.collision.findFloor(star.pos.x, star.pos.y, star.pos.z, 0);
      const w = this.collision.waterLevelAt ? this.collision.waterLevelAt(star.pos.x, star.pos.z) : NO_WATER;
      this.floor = f.surface && !(w !== NO_WATER && w > f.y) ? f : null;
    }
    if (star.state === 'rising') {
      this.sparkles.trail(star.pos, time, TINT.star);
      this.sparkles.trail(star.pos, time, TINT.red);
      return;
    }
    if (tick % TWINKLE_EVERY === 0) this.sparkles.twinkle(star.pos, 90, time, TINT.star);
    if (!player || !star.touches(player.pos)) return;
    const pos = { x: star.pos.x, y: star.pos.y, z: star.pos.z };
    star.collect();
    if (this.shadowSlot >= 0) this.shadows?.hide(this.shadowSlot);
    this.glowing = false;
    this.sparkles.burst(pos, time, TINT.star, 12);
    this.sparkles.burst(pos, time, TINT.red, 6);
    player.collectStar();
    this.holder = player;
    this.events.emit('starCollected', { pos, boss: true });
  }

  // Render: pose, shadow and (when glowFree: the red-coin star is not using it) the halo.
  animate(clock, alpha, camera, glowFree) {
    const star = this.star;
    if (!star.active) {
      if (this.glowing && glowFree) this.sparkles.glow.visible = false;
      this.glowing = false;
      return;
    }
    star.animate(clock, alpha);
    const r = star.render;
    const f = this.floor;
    if (f && this.shadowSlot >= 0 && this.shadows) {
      this.shadows.place(this.shadowSlot, r.x, f.y, r.z, f.surface.normal, shadowSize(SHADOW * r.scale, r.y - f.y));
    }
    if (!glowFree) return;
    _toCam.set(r.x, r.y, r.z);
    if (camera) _toCam.sub(camera.position).setLength(70);
    else _toCam.set(0, 0, 0);
    this.sparkles.setGlow(r.x + _toCam.x, r.y + _toCam.y, r.z + _toCam.z, GLOW * r.scale, 0.55);
    this.glowing = true;
  }

  // A new game: hidden, not yet awarded, and the hero who got it loses it from his count.
  reset() {
    this.star.reset();
    this.awarded = false;
    this.floor = null;
    if (this.shadowSlot >= 0) this.shadows?.hide(this.shadowSlot);
    if (this.holder) {
      const h = this.holder;
      h.stars = h.stars > 0 ? h.stars - 1 : 0;
      this.holder = null;
    }
    this.glowing = false;
  }
}
