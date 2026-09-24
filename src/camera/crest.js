// Crest rise for CameraCollider: the sight fan only reacts to a fully hidden hero, so a hill
// crest between the camera and a hero walking down the far side would hide his legs and body
// without a response. A floors-only ray from just above his feet to the camera finds the
// terrain in the way; the camera then rises (with the height limit's easing, held a moment
// before it settles back) until the line passes over the crest. It only ever raises the
// camera, and the view tips down to the hero instead of keeping the orbit's pitch.
//
// Runs every tick: the knee points and the ray direction are per-instance scratch objects.

const KNEE_HEIGHT = 20; // the crest check aims at the hero's shins...
const CREST_CLEARANCE = 20; // ...and wants its sight line this far over the ground in between,
const CREST_CLEAR_SLOPE = 0.15; // ...or less close to the hero (per unit of distance from him)
const CREST_ROUNDS = 3; // crests behind each other one search may clear
const CREST_MAX_RISE = 350; // the crest never raises the camera more than this
const CREST_HOLD_TICKS = 10; // held this long once the feet are in view...
const CREST_RELEASE = 0.08; // ...then this fraction of the rise is given back per tick...
const CREST_RELEASE_MIN = 3; // ...at least this many units
const SIDE_OFFSET = 75; // side lines start this far left/right of the knee (as the sight fan)
const FLOORS_ONLY = Object.freeze({ walls: false, ceilings: false });

export class CrestRise {
  constructor(collision) {
    this.collision = collision;
    this._knee = { x: 0, y: 0, z: 0 };
    this._side = { x: 0, y: 0, z: 0 };
    this._ray = { x: 0, y: 0, z: 0 };
    this.reset();
  }

  reset() {
    this.rise = 0; // held rise that keeps the hero's feet in view over a crest...
    this.hold = 0; // ...ticks since it was last needed in full
  }

  // Extra height the camera needs at (cx, cz), above cy, for the line from just above the
  // hero's feet to pass CREST_CLEARANCE over terrain in between (0 if it is clear). Only
  // floors met from above count: a slope or crest rising toward the camera, never the top of
  // a fence, a step or a deck seen from below. Like the sight fan, the lines from SIDE_OFFSET
  // to either side must be blocked as well: a bush or a boulder is not a crest.
  needed(hero, cx, cy, cz) {
    const k = this._knee;
    k.x = hero.x;
    k.y = hero.y + KNEE_HEIGHT;
    k.z = hero.z;
    const hx = cx - k.x;
    const hz = cz - k.z;
    const reach = Math.sqrt(hx * hx + hz * hz);
    if (reach < 1) return 0;
    const d = this._ray;
    let y = cy;
    for (let round = 0; round < CREST_ROUNDS; round++) {
      d.x = hx;
      d.y = y - k.y;
      d.z = hz;
      const len = Math.sqrt(hx * hx + d.y * d.y + hz * hz);
      const hit = this.collision.raycast(k, d, len, FLOORS_ONLY);
      if (!hit || d.x * hit.normal.x + d.y * hit.normal.y + d.z * hit.normal.z >= 0) break;
      const px = hit.point.x - k.x;
      const pz = hit.point.z - k.z;
      const at = Math.max(1, Math.sqrt(px * px + pz * pz));
      const hy = hit.point.y;
      if (this._sideClear(k, cx, y, cz, hx / reach, hz / reach)) break;
      const clear = Math.min(CREST_CLEARANCE, at * CREST_CLEAR_SLOPE);
      y = Math.max(y, k.y + ((hy + clear - k.y) * reach) / at);
      if (y - cy >= CREST_MAX_RISE) return CREST_MAX_RISE;
    }
    return y - cy;
  }

  // The rise applies at once (the height limit's easing smooths it), is held while the hero
  // is in view for CREST_HOLD_TICKS, then given back slowly: walking over rolling ground does
  // not make the camera bob.
  ease(goal) {
    if (goal >= this.rise) {
      this.rise = goal;
      this.hold = 0;
      return;
    }
    if (++this.hold <= CREST_HOLD_TICKS) return;
    this.rise = Math.max(goal, this.rise - Math.max(CREST_RELEASE_MIN, this.rise * CREST_RELEASE));
  }

  // Whether a floors-only line from SIDE_OFFSET to either side of the knee point `k` (across
  // the horizontal direction ux, uz) to (cx, cy, cz) is clear.
  _sideClear(k, cx, cy, cz, ux, uz) {
    const o = this._side;
    const d = this._ray;
    for (let s = -1; s <= 1; s += 2) {
      o.x = k.x + uz * s * SIDE_OFFSET;
      o.y = k.y;
      o.z = k.z - ux * s * SIDE_OFFSET;
      d.x = cx - o.x;
      d.y = cy - o.y;
      d.z = cz - o.z;
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      if (!this.collision.raycast(o, d, len, FLOORS_ONLY)) return true;
    }
    return false;
  }
}
