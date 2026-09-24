// Yellow and red coins: placement, pickup tests and the spinning sprite batch.
// Every coin shares one billboard batch (one draw call); the spin is a sequence of
// pre-painted rotation frames like on the N64.
//
// Besides the layout's coins, a few "drop" slots hold yellow coins that appear at run time
// (spawnCoin: a wrecked minion's coin). They are not part of `coins` (the layout's set), are
// gone again after reset(), and take their shadows from the slots after the layout coins'
// (shadow index `dropShadow0 + j`).

import { SpriteBatch } from './SpriteBatch.js';
import { makeCoinAtlas, coinFrameUV, COIN_FRAMES } from './textures.js';
import { shadowSize } from './BlobShadows.js';

export const COIN_HOVER = 60; // above the ground unless the layout gives y
const COIN_SIZE = 96; // sprite quad size (the disc is ~85 units across)
// Horizontal pickup radius from the hero's feet axis: hero radius (50) + coin radius (~42) +
// slack, so a coin the hero visibly touches is always taken.
export const PICKUP_RADIUS = 105;
const PICKUP_BELOW = 40; // coin may be this far below the feet...
const PICKUP_ABOVE = 200; // ...or this far above them
const SPIN_RATE = 1.6; // turns per second
const SPIN_PHASE = 0.5; // half-turn phase at clock 0: the middle frames, face-on
const HEADROOM = 60; // coin centre to any ceiling above (bridge beams): the disc stays clear
const SHADOW_SIZE = 64;

const FRAME_UVS = [false, true].map((red) => Array.from({ length: COIN_FRAMES }, (_, k) => coinFrameUV(k, red)));

export class CoinField {
  // groundAt(x, z) -> ground height; shadows: BlobShadows whose first N slots belong to the coins.
  constructor({ layout, collision, groundAt, shadows, drops = 0, dropShadow0 = -1 }) {
    const place = (c, red) => {
      let y = c.y;
      if (y === undefined) {
        y = groundAt(c.x, c.z) + COIN_HOVER;
        // Keep clear of a real floor that sits slightly above the analytic ground.
        const f = collision.findFloor(c.x, y, c.z);
        if (f.surface && f.y + COIN_HOVER > y) y = f.y + COIN_HOVER;
      }
      // Hang below a ceiling (e.g. a beam under the bridge) rather than poke into it.
      const ceil = collision.findCeil(c.x, y - HEADROOM, c.z, 0);
      if (ceil.surface && ceil.y - y < HEADROOM) y = ceil.y - HEADROOM;
      // Every field up front (index: running red-coin count, set on pickup) so all coins keep
      // one shape: a coin gaining a field later would make the per-tick loop polymorphic.
      return { x: c.x, y, z: c.z, red, value: red ? 2 : 1, alive: true, index: 0 };
    };
    this.coins = [...(layout.COINS ?? []).map((c) => place(c, false)), ...(layout.RED_COINS ?? []).map((c) => place(c, true))];
    this.redTotal = this.coins.filter((c) => c.red).length;
    this.redCollected = 0;
    this.shadows = shadows;
    // Each coin's shadow on the floor below it (null: no floor), kept so reset() can put the
    // shadows back without collision queries.
    this.shadowSpots = this.coins.map((c) => {
      const f = collision.findFloor(c.x, c.y, c.z, 0);
      return f.surface ? { y: f.y, normal: { ...f.surface.normal }, size: shadowSize(SHADOW_SIZE, c.y - f.y) } : null;
    });
    this._placeShadows();
    // Run-time coins (spawnCoin), same record shape as the layout's; reused round-robin.
    this.collision = collision;
    this.drops = Array.from({ length: drops }, () => ({ x: 0, y: 0, z: 0, red: false, value: 1, alive: false, index: 0 }));
    this.dropShadow0 = dropShadow0;
    this.nextDrop = 0;
    this.hits = []; // reused by collect()
    this.batch = new SpriteBatch(Math.max(1, this.coins.length + drops), { map: makeCoinAtlas(), alphaCut: 0.5 });
    this.mesh = this.batch.mesh;
  }

  // Marks and returns the coins touched by a hero standing at `pos` (feet). The returned array
  // is reused by the next call.
  collect(pos) {
    const hits = this.hits;
    hits.length = 0;
    const r2 = PICKUP_RADIUS * PICKUP_RADIUS;
    const lo = pos.y - PICKUP_BELOW;
    const hi = pos.y + PICKUP_ABOVE;
    const px = pos.x;
    const pz = pos.z;
    const coins = this.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c.alive || c.y < lo || c.y > hi) continue;
      const dx = c.x - px;
      const dz = c.z - pz;
      if (dx * dx + dz * dz > r2) continue;
      c.alive = false;
      this.shadows.hide(i);
      if (c.red) c.index = ++this.redCollected;
      hits.push(c);
    }
    const drops = this.drops;
    for (let j = 0; j < drops.length; j++) {
      const c = drops[j];
      if (!c.alive || c.y < lo || c.y > hi) continue;
      const dx = c.x - px;
      const dz = c.z - pz;
      if (dx * dx + dz * dz > r2) continue;
      c.alive = false;
      if (this.dropShadow0 >= 0) this.shadows.hide(this.dropShadow0 + j);
      hits.push(c);
    }
    return hits;
  }

  // A yellow coin appears hovering over the floor under (x, y, z) (a wrecked minion's drop);
  // returns its record, or null without drop slots. When every slot is taken the oldest coin
  // moves here.
  spawnCoin(x, y, z) {
    if (this.drops.length === 0) return null;
    const j = this.nextDrop;
    this.nextDrop = (j + 1) % this.drops.length;
    const c = this.drops[j];
    const f = this.collision.findFloor(x, y + 60, z);
    const floorY = f.surface ? f.y : y;
    c.x = x;
    c.y = floorY + COIN_HOVER;
    c.z = z;
    c.alive = true;
    if (this.dropShadow0 >= 0) {
      if (f.surface) this.shadows.place(this.dropShadow0 + j, x, floorY, z, f.surface.normal, shadowSize(SHADOW_SIZE, COIN_HOVER));
      else this.shadows.hide(this.dropShadow0 + j);
    }
    return c;
  }

  _placeShadows() {
    this.coins.forEach((c, i) => {
      const f = this.shadowSpots[i];
      if (c.alive && f) this.shadows.place(i, c.x, f.y, c.z, f.normal, f.size);
    });
  }

  // Every coin back where it started (a new game): alive, with its shadow; no red coins taken.
  reset() {
    for (const c of this.coins) {
      c.alive = true;
      c.index = 0;
    }
    this.redCollected = 0;
    this._placeShadows();
    this.drops.forEach((c, j) => {
      c.alive = false;
      if (this.dropShadow0 >= 0) this.shadows.hide(this.dropShadow0 + j);
    });
    this.nextDrop = 0;
  }

  get allRedCollected() {
    return this.redTotal > 0 && this.redCollected === this.redTotal;
  }

  // All coins spin in step; a half turn cycles through every frame.
  animate(clock) {
    const turn = clock * SPIN_RATE * 2 + SPIN_PHASE;
    const frame = Math.floor((turn - Math.floor(turn)) * COIN_FRAMES);
    const b = this.batch;
    b.clear();
    const s = b.next;
    s.size = COIN_SIZE;
    s.rot = 0;
    s.r = s.g = s.b = s.a = 1;
    const coins = this.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c.alive) continue;
      s.x = c.x;
      s.y = c.y;
      s.z = c.z;
      s.uv = FRAME_UVS[c.red ? 1 : 0][frame];
      b.push();
    }
    const drops = this.drops;
    for (let j = 0; j < drops.length; j++) {
      const c = drops[j];
      if (!c.alive) continue;
      s.x = c.x;
      s.y = c.y;
      s.z = c.z;
      s.uv = FRAME_UVS[0][frame];
      b.push();
    }
    b.commit();
  }
}
