// Yellow and red coins: placement, pickup tests and the spinning sprite batch.
// Every coin shares one billboard batch (one draw call); the spin is a sequence of
// pre-painted rotation frames like on the N64.

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
  constructor({ layout, collision, groundAt, shadows }) {
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
    this.hits = []; // reused by collect()
    this.batch = new SpriteBatch(Math.max(1, this.coins.length), { map: makeCoinAtlas(), alphaCut: 0.5 });
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
    return hits;
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
    b.commit();
  }
}
