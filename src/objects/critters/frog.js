// The Wreath Frog ("kransgroda"), the meadow's critter (objects/Critters.js runs it): a fat lime
// frog in a midsummer flower wreath. Calm, it breathes, blinks and hops round a small ring of
// points about its home, croaking now and then. When Jonas comes into its fight circle it
// notices him (a croak, a hop, a white twinkle), then hops after him in short hops until he is
// 160 to 290 away (it backs off when he is nearer), and winds up: it crouches, its throat sac
// puffs up glowing, it shakes; 14 ticks in (18 for a calm one, the first met) it locks onto where
// he stands, and an orange ring shows the spot. Then it leaps there in a high arc (its peak 135
// over flat ground) and lands with a thump: only the last 6 ticks of the leap hurt. It sits dazed
// for 36 ticks (the stomp window), cools off and comes again; let go, it hops home. Walked into,
// it skips away from him in a little hop (calling off a windup).
// A stomp throws him high (bounce(72), the trampoline belly: about twice a plain stomp); a stomp
// squashes it flat (dropping it to the floor if it was caught in the air), a hit knocks it
// tumbling; either way its wreath pops off and flies up spinning after him, and at the top it
// bursts into gold sparkles as the frog poofs: its coin lies where the frog was.
//
//   frog.home(self, c)                   calm on ring point 0 (reset, a lost life)
//   frog.notice(self, c)                 calm -> NOTICE (he came into its circle, or bumped it)
//   frog.release(self, c)                engaged -> RETURN (he left; a windup is called off)
//   frog.bumped(self, c, dx, dz)         he walked into it (dx, dz: from him to it): it hops
//                                        away if it can (true), a windup called off first
//   frog.step(self, c, player, hero)     one 30 Hz tick of its state
//   frog.defeat(self, c, stomped)        stomped (SQUASH) or struck (TUMBLE), from any live state
//   frog.ring(self, c)                   builds and checks its idle ring (the constructor)
// `self` is the Critters manager (its shared mechanics: hops, the token, sounds, the hurt test),
// `c` the frog's record. Numbers: FROG (CRITTER.FROG); every choice is noise on the manager's
// life counter, so a reset manager replays exactly.

import { TAU, approachAngle as turn, smoothstep } from '../../core/math.js';
import { CRITTER_RIG } from '../critterModel.js';

const RIG = CRITTER_RIG.frog;

export const FROG = {
  WINDUP: 20, // ticks of the tell (times the spot's calm)
  LOCK: 14, // ... its target and facing lock at this windup tick (times calm)
  LEAP: 20,
  HURT_FROM: 15, // the leap hurts on its ticks HURT_FROM..LEAP only
  DAZED: 36, // the stomp window after landing
  COOLDOWN: 45,
  CANCEL_COOLDOWN: 30, // a windup called off (he went away, the spot was no good)
  WIN_MIN: 160, // a windup starts only with him this far away ...
  WIN_MAX: 290, // ... up to this (where every fairness row was measured)
  DY: 120, // ... and at most this far above or below it
  NOTICE: 12,
  TURN: 0.35, // radians per tick
  NOTICE_VY: 10, // the little hop in place as it notices him
  CROUCH: 6, // an approach cycle: crouch, a hop (HOP air ticks), a rest
  HOP: 12,
  REST: 8,
  HOP_MAX: 160, // the longest approach hop
  HOP_TO: 240, // ... toward him, to land about this far from him
  HOP_BACK: 220, // ... away from him (too near), to this far
  HOME_NEAR: 15, // a hop home ends here (then IDLE)
  RING: 0.6, // its idle ring's radius, times its roam
  RING_POINTS: 6,
  RING_DY: 12, // a ring point counts on the same floor within this
  RING_CLEAR: 60, // ... with no wall within this
  IDLE_HOP: 9, // air ticks of a hop round the ring
  IDLE_EVERY: [45, 90],
  BLINK: 4,
  BLINK_EVERY: [90, 130],
  CROAK_EVERY: [150, 260], // the idle croak (quiet), with him within CROAK_NEAR
  CROAK_NEAR: 2000,
  LEASH: 60, // its body never leaves fight + LEASH of home
  LEVEL_DY: 40, // the leap's target on its home floor within this
  LEAP_MAX: 400, // the target at most this far from where it leaps
  GRAVITY: 2.7,
  MARK_FROM: 110, // the danger ring grows from this across at the lock (well over his shadow's
  MARK_TO: 150, // size) to MARK_TO at the landing
  BOUNCE: 72, // a stomp's bounce
  SQUASH: 2, // a stomp: squashed flat this long (on the floor), then the poof (a flat frog shrinking)
  LIFT: 10, // the wreath flies up over this many ticks of the defeat, then bursts (with the
  // stomp's coin: early, while the camera following his bounce still has it in view)
  TUMBLE: 20, // a hit: knocked tumbling
  TUMBLE_SPEED: 8,
  TUMBLE_VY: 22, // (its arc peaks about 80 up: by his head on screen, not hidden behind him)
  ROLL: 0.5,
  DAZE_CROAK: 10, // the sleepy croak's tick in the daze
  TWINKLE_EVERY: 12, // the daze's twinkles
  WALL_Y: 30,
  WALL_R: 45,
};

// The windup and lock ticks of this frog (a calm spot's tell is slower).
const windupTicks = (c) => Math.round(FROG.WINDUP * c.calm);
const lockTick = (c) => Math.round(FROG.LOCK * c.calm);

// The calm channels: breathing, the sac's gentle swell, legs at rest, eyes open.
function calmLook(self, c) {
  const L = self.life;
  c.a0 *= 0.7;
  c.a1 = 0.15 + 0.1 * Math.sin(L * 0.12 + c.seed);
  c.a2 *= 0.8;
  c.a3 = Math.sin(L * 0.1 + c.seed * 3);
  c.glow *= 0.8;
  c.sq += (1 - c.sq) * 0.3;
}

// Blinks for BLINK ticks every BLINK_EVERY (hash-timed), whatever it does.
function blink(self, c) {
  const L = self.life;
  if (L >= c.blinkAt + FROG.BLINK) c.blinkAt = L + self._every(c, FROG.BLINK_EVERY, 1);
  c.b0 = L >= c.blinkAt ? 1 : 0;
}

// Its idle ring: point k at home + RING * roam along yaw0 + k * 60 degrees, kept when it lies
// on the home floor, dry and clear of walls (the constructor's queries; the idle hops then
// need none). The points left keep their order; with none, home itself.
function ring(self, c, spot) {
  const col = self.collision;
  const r = FROG.RING * (spot.roam ?? 200);
  c.hopN = 0;
  for (let k = 0; k < FROG.RING_POINTS; k++) {
    const a = c.yaw0 + (k * TAU) / FROG.RING_POINTS;
    const x = c.hx + Math.sin(a) * r;
    const z = c.hz + Math.cos(a) * r;
    const f = col.findFloor(x, c.hy + 60, z);
    if (!f.surface || f.surface.surface === 'death' || Math.abs(f.y - c.hy) > FROG.RING_DY) continue;
    if (col.waterLevelAt && col.waterLevelAt(x, z) > f.y - 10) continue;
    if (col.findWalls(x, f.y, z, FROG.WALL_Y, FROG.RING_CLEAR).walls.length > 0) continue;
    c.hopX[c.hopN] = x;
    c.hopY[c.hopN] = f.y;
    c.hopZ[c.hopN] = z;
    c.hopN++;
  }
  if (c.hopN === 0) {
    c.hopX[0] = c.hx;
    c.hopY[0] = c.hy;
    c.hopZ[0] = c.hz;
    c.hopN = 1;
  }
}

function home(self, c) {
  c.state = 'idle';
  c.t = 0;
  c.k = 0;
  c.n = 0;
  c.x = c.hopX[0];
  c.y = c.hopY[0];
  c.z = c.hopZ[0];
  c.floorY = c.y;
  c.vx = c.vy = c.vz = 0;
  c.yaw = c.yaw0;
  c.pitch = c.roll = 0;
  c.sq = 1;
  c.vis = 1;
  c.a0 = c.a1 = c.a2 = c.a3 = 0;
  c.b0 = c.b1 = c.glow = 0;
  c.next = self.life + self._every(c, FROG.IDLE_EVERY, 2);
  c.blinkAt = self.life + self._every(c, FROG.BLINK_EVERY, 1);
  c.croakAt = self.life + self._every(c, FROG.CROAK_EVERY, 3);
}

// IDLE: hop round the ring now and then (closed-form arcs between checked points: no
// queries), croak quietly when he is about.
function idle(self, c, player) {
  calmLook(self, c);
  const L = self.life;
  if (L >= c.croakAt) {
    c.croakAt = L + self._every(c, FROG.CROAK_EVERY, 3);
    const dx = player.pos.x - c.x;
    const dz = player.pos.z - c.z;
    if (dx * dx + dz * dz < FROG.CROAK_NEAR * FROG.CROAK_NEAR) self._idleSound(c, 'frog_croak');
  }
  if (c.n > 0) {
    airTick(self, c, false);
    c.a0 = c.n > FROG.IDLE_HOP / 2 ? 0.6 : 0.1;
    return;
  }
  if (c.hopN > 1) c.yaw = turn(c.yaw, Math.atan2(c.hopX[(c.k + 1) % c.hopN] - c.x, c.hopZ[(c.k + 1) % c.hopN] - c.z), 0.12);
  if (L < c.next) return;
  c.next = L + FROG.IDLE_HOP + self._every(c, FROG.IDLE_EVERY, 2);
  // To the next point (in place with fewer than two), a small arc.
  const k = c.hopN > 1 ? (c.k + 1) % c.hopN : 0;
  c.k = k;
  self._launch(c, c.hopX[k], c.hopY[k], c.hopZ[k], FROG.IDLE_HOP, FROG.GRAVITY); // (rising about 27)
}

// One tick in the air: on along its hop (stopped by walls when `walls`: one findWalls), under
// gravity, never past its leash (he may have bumped it on its way); it lands on the hop's floor
// height on its last tick.
function airTick(self, c, walls) {
  if (walls) self._fly(c, FROG.WALL_Y, FROG.WALL_R);
  else {
    c.x += c.vx;
    c.z += c.vz;
  }
  const hx = c.x - c.hx;
  const hz = c.z - c.hz;
  const h2 = hx * hx + hz * hz;
  if (h2 > c.leash2) {
    const k = Math.sqrt(c.leash2 / h2);
    c.x = c.hx + hx * k;
    c.z = c.hz + hz * k;
  }
  c.y += c.vy;
  c.vy -= FROG.GRAVITY;
  c.n--;
  if (c.n <= 0) {
    c.n = 0;
    c.y = c.ty;
    c.floorY = c.ty;
    c.vx = c.vy = c.vz = 0;
    return true;
  }
  return false;
}

// (Caught in an idle hop, it lands it first.)
function notice(self, c) {
  c.state = 'notice';
  c.t = 0;
  if (c.n === 0) {
    c.y = c.floorY;
    c.vy = FROG.NOTICE_VY;
  }
  self._sound(c, 'frog_croak', 1.25);
  self._twinkle(c, 20, 100);
}

// NOTICE: turns to him with a hop in place.
function noticeStep(self, c, player) {
  calmLook(self, c);
  c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), FROG.TURN);
  if (c.n > 0) airTick(self, c, false);
  else if (c.y > c.floorY || c.vy > 0) {
    c.y += c.vy;
    c.vy -= FROG.GRAVITY;
    if (c.y <= c.floorY) {
      c.y = c.floorY;
      c.vy = 0;
    }
  }
  if (c.t >= FROG.NOTICE) toApproach(self, c);
}

function toApproach(self, c) {
  c.state = 'approach';
  c.t = 0;
  c.n = 0;
  c.y = c.floorY;
  c.vy = 0;
  c.next = self.life + FROG.CROUCH;
}

// May it wind up now? He is in its window (160..290 away, within DY up or down), its own
// cooldown is over, the token is free (and the gap after the last strike has passed), and he can
// be fought (not away, not blinking after a hit).
function canWindup(self, c, player, d2) {
  if (d2 < FROG.WIN_MIN * FROG.WIN_MIN || d2 > FROG.WIN_MAX * FROG.WIN_MAX) return false;
  const dy = player.pos.y - c.y;
  if (dy >= FROG.DY || dy <= -FROG.DY) return false;
  return c.cooldown === 0 && self.fightable && self._tokenFree();
}

// APPROACH: cycles of a crouch, a hop and a rest. At take-off it hops toward him when he is
// beyond the window (to land about HOP_TO from him), away from him when he is nearer (to
// HOP_BACK), and rests inside it, ready to wind up.
function approach(self, c, player) {
  calmLook(self, c);
  if (c.cooldown > 0) c.cooldown--;
  if (c.n > 0) {
    c.a0 = c.n > FROG.HOP - 4 ? 1 : 0.2;
    if (airTick(self, c, true)) c.next = self.life + FROG.REST + FROG.CROUCH;
    return;
  }
  const p = player.pos;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d2 = dx * dx + dz * dz;
  c.yaw = turn(c.yaw, Math.atan2(dx, dz), FROG.TURN);
  if (canWindup(self, c, player, d2)) {
    toWindup(self, c);
    return;
  }
  const L = self.life;
  if (L >= c.next - FROG.CROUCH) {
    const k = smoothstep(0, FROG.CROUCH, L - c.next + FROG.CROUCH);
    c.a0 = -0.3 * k;
    c.sq = 1 - 0.08 * k;
  }
  if (L < c.next) return;
  const d = Math.sqrt(d2);
  let len = 0;
  if (d > FROG.WIN_MAX) len = d - FROG.HOP_TO;
  else if (d < FROG.WIN_MIN) len = -(FROG.HOP_BACK - d);
  if (len > FROG.HOP_MAX) len = FROG.HOP_MAX;
  else if (len < -FROG.HOP_MAX) len = -FROG.HOP_MAX;
  if (len === 0 || d < 1 || !self._hop(c, c.x + (dx / d) * len, c.z + (dz / d) * len, len < 0, FROG.HOP)) c.next = L + FROG.REST;
}

function toWindup(self, c) {
  c.state = 'windup';
  c.t = 0;
  c.struck = 0;
  self._takeToken(c);
  self._sound(c, 'frog_puff', 1);
}

// WINDUP: crouched, the sac swelling and glowing, the body shaking from tick 12; its yaw tracks
// him until the lock, when the target locks too (his feet, at most LEAP_MAX away, inside the
// leash, on its floor and dry, else half way; else the windup is called off, puzzled).
function windup(self, c, player) {
  const W = windupTicks(c);
  const lock = lockTick(c);
  if (!self.fightable) {
    cancel(self, c, false);
    return;
  }
  const u = c.t / W;
  c.a0 = -0.3;
  c.a1 = u;
  c.a3 = 0;
  c.glow = 0.25 - 0.25 * Math.cos((c.t * TAU * 6) / 30);
  c.sq = 0.92;
  if (c.t < lock) c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), FROG.TURN);
  else if (c.t === lock && !lockOn(self, c, player)) return;
  if (c.markOn === 1) c.mark = (c.t - lock) / (W - lock + FROG.LEAP);
  if (c.t >= W) {
    c.state = 'leap';
    c.t = 0;
    c.sx0 = c.x;
    c.sy0 = c.y;
    c.sz0 = c.z;
    self._launch(c, c.tx, c.ty, c.tz, FROG.LEAP, FROG.GRAVITY);
  }
}

// The lock: T and the facing together, the danger marker at T. False when called off.
function lockOn(self, c, player) {
  let tx = player.pos.x;
  let tz = player.pos.z;
  let dx = tx - c.x;
  let dz = tz - c.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > FROG.LEAP_MAX * FROG.LEAP_MAX) {
    const k = FROG.LEAP_MAX / Math.sqrt(d2);
    tx = c.x + dx * k;
    tz = c.z + dz * k;
  }
  // Inside the leash (pulled back toward home along the line from home).
  const hx = tx - c.hx;
  const hz = tz - c.hz;
  const h2 = hx * hx + hz * hz;
  if (h2 > c.leash2) {
    const k = Math.sqrt(c.leash2 / h2);
    tx = c.hx + hx * k;
    tz = c.hz + hz * k;
  }
  if (!self._markAt(c, tx, tz, FROG.LEVEL_DY) && !self._markAt(c, (c.x + tx) / 2, (c.z + tz) / 2, FROG.LEVEL_DY)) {
    cancel(self, c, true);
    return false;
  }
  dx = c.tx - c.x;
  dz = c.tz - c.z;
  if (dx * dx + dz * dz > 1) c.yaw = Math.atan2(dx, dz);
  c.lockYaw = c.yaw;
  c.mark = 0;
  return true;
}

// A windup called off: the token back (with its gap), a cooldown; puzzled when its spot was no
// good (a low croak).
function cancel(self, c, puzzled) {
  self._freeToken(c);
  c.markOn = 0;
  c.cooldown = FROG.CANCEL_COOLDOWN;
  c.glow = 0;
  if (puzzled) self._sound(c, 'frog_croak', 0.7);
  toApproach(self, c);
}

// LEAP: ballistic to T, landing on it on its last tick (one findWalls a tick: a wall stops it
// over the floor); it hurts only from HURT_FROM on (its body sphere against his capsule).
function leap(self, c) {
  if (c.t === 1) self._sound(c, 'frog_leap', 1);
  const landed = airTick(self, c, true);
  if (self._parried(c)) return;
  c.a0 = c.t <= 6 ? 1 : 0.25;
  c.a1 *= 0.7;
  c.glow *= 0.7;
  c.sq = 1;
  c.pitch = -0.012 * c.vy;
  const span = windupTicks(c) - lockTick(c) + FROG.LEAP;
  c.mark = (span - FROG.LEAP + c.t) / span;
  // (His last wedge leaves him where he stands: then it comes down short of him, not on him.)
  const hy = c.y + RIG.HIT_Y * c.scale;
  if (c.t >= FROG.HURT_FROM && c.struck === 0 && self._touches(c.x, hy, c.z, RIG.HIT_R * c.scale) && self._hurt(c, c.x, hy, c.z) && self.player.action === 'death') c.vx = c.vz = 0;
  if (landed || c.t >= FROG.LEAP) {
    c.y = c.ty;
    c.floorY = c.ty;
    c.pitch = 0;
    c.markOn = 0;
    self._sound(c, 'frog_land', 1);
    self._freeToken(c);
    c.state = 'dazed';
    c.t = 0;
    c.sq = 0.7;
  }
}

// DAZED: squashed from the landing, coming back up, its head wobbling, three twinkles circling
// it (a new three every TWINKLE_EVERY ticks, turned on); the stomp window.
function dazed(self, c) {
  c.a0 *= 0.6;
  c.a1 *= 0.8;
  c.glow = 0;
  c.sq = 0.7 + 0.3 * smoothstep(0, 14, c.t);
  c.a2 = 0.22 * Math.sin(c.t * 0.7) * (1 - c.t / FROG.DAZED);
  if (c.t % FROG.TWINKLE_EVERY === 1) {
    for (let k = 0; k < 3; k++) {
      const a = c.t * 0.35 + (k * TAU) / 3;
      self._twinkle(c, 6, 85, Math.sin(a) * 40, Math.cos(a) * 40);
    }
  }
  if (c.t === FROG.DAZE_CROAK) self._sound(c, 'frog_croak', 0.8);
  if (c.t >= FROG.DAZED) {
    c.state = 'cooldown';
    c.t = 0;
    c.a2 = 0;
  }
}

// COOLDOWN: it sits facing him, then comes again.
function cooldown(self, c, player) {
  calmLook(self, c);
  c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), FROG.TURN * 0.5);
  if (c.t >= FROG.COOLDOWN) toApproach(self, c);
}

// (Never in the air: the manager lets it land first.)
function release(self, c) {
  if (c.state === 'windup') {
    self._freeToken(c);
    c.markOn = 0;
    c.cooldown = FROG.CANCEL_COOLDOWN;
  }
  c.state = 'return';
  c.t = 0;
  c.n = 0;
  c.y = c.floorY;
  c.vy = 0;
  c.a2 = 0;
  c.glow = 0;
  c.next = self.life + FROG.CROUCH;
}

// RETURN: approach-style hops home (to ring point 0), then IDLE.
function returnStep(self, c) {
  calmLook(self, c);
  if (c.cooldown > 0) c.cooldown--;
  if (c.n > 0) {
    c.a0 = c.n > FROG.HOP - 4 ? 1 : 0.2;
    if (airTick(self, c, true)) c.next = self.life + FROG.REST + FROG.CROUCH;
    return;
  }
  const dx = c.hopX[0] - c.x;
  const dz = c.hopZ[0] - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < FROG.HOME_NEAR) {
    c.state = 'idle';
    c.t = 0;
    c.k = 0;
    c.next = self.life + self._every(c, FROG.IDLE_EVERY, 2);
    return;
  }
  c.yaw = turn(c.yaw, Math.atan2(dx, dz), FROG.TURN);
  const L = self.life;
  if (L < c.next) return;
  const len = d < FROG.HOP_MAX ? d : FROG.HOP_MAX;
  if (!self._hop(c, c.x + (dx / d) * len, c.z + (dz / d) * len, false, FROG.HOP)) c.next = L + FROG.REST;
}

// Bumped into on the ground while after him: a windup is called off (the token back, a
// cooldown), and it hops off away from him (a cooling one goes on with the cooldown it had left)
// rather than being pushed along the grass. False when it does not (in the air, dazed, still
// noticing him; or the hop is refused: the leash, a wall, no floor there), and it is pushed.
function bumped(self, c, dx, dz) {
  if (c.n > 0) return false;
  if (c.state === 'windup') cancel(self, c, false);
  else if (c.state === 'cooldown') {
    c.cooldown = FROG.COOLDOWN - c.t;
    toApproach(self, c);
  }
  if (c.state !== 'approach') return false;
  return self._hop(c, c.x + dx * FROG.HOP_MAX, c.z + dz * FROG.HOP_MAX, true, FROG.HOP);
}

// Defeated: stomped flat (SQUASH) or knocked tumbling (TUMBLE); the wreath pops off at once.
// Caught in the air it comes down on the floor its hop or leap was bound for.
function defeat(self, c, stomped) {
  if (c.n > 0) c.floorY = c.ty;
  c.n = 0;
  c.a0 = c.a1 = c.a2 = 0;
  c.glow = 0;
  c.b1 = 0;
  self._sound(c, 'frog_pop', 1);
  self._clods(c, 74 * c.scale, 'petal', 10);
  self._clods(c, 74 * c.scale, 'buttercup', 4);
  if (stomped) {
    c.state = 'squash';
    c.vx = c.vy = c.vz = 0;
  } else {
    c.state = 'tumble';
    self._knock(c, FROG.TUMBLE_SPEED, FROG.TUMBLE_VY);
  }
  c.t = 0;
}

// The popped wreath (every tick of the defeat, the poof too): up it flies over LIFT ticks,
// spinning and shrinking (critterModel.js), and at the top it bursts into gold sparkles: the
// wreath turned into the coin.
function wreathFly(self, c) {
  if (c.b1 >= 1) return;
  c.b1 += 1 / FROG.LIFT;
  if (c.b1 < 1 - 1e-6) return;
  c.b1 = 1;
  self._burst(c, RIG.WREATH[1] * c.sq * c.vis * c.scale + RIG.WREATH_RISE);
}

// SQUASH: flat in 2 ticks, wide (dropping to its floor when stomped in the air); then the poof.
function squash(self, c) {
  if (c.y > c.floorY) {
    c.vy -= FROG.GRAVITY;
    c.y += c.vy;
    if (c.y < c.floorY) c.y = c.floorY;
  }
  c.sq = c.t >= 2 ? 0.25 : 1 - 0.375 * c.t;
  wreathFly(self, c);
  if (c.t >= FROG.SQUASH && c.y <= c.floorY) self._poof(c);
}

// TUMBLE: knocked away rolling over (the minions' wreck rules for floors and walls; never into
// the water); then the poof.
function tumble(self, c) {
  self._tumble(c, FROG.GRAVITY);
  c.roll += FROG.ROLL;
  wreathFly(self, c);
  if (c.t >= FROG.TUMBLE) self._poof(c);
}

function step(self, c, player) {
  blink(self, c);
  switch (c.state) {
    case 'idle':
      idle(self, c, player);
      break;
    case 'notice':
      noticeStep(self, c, player);
      break;
    case 'approach':
      approach(self, c, player);
      break;
    case 'windup':
      windup(self, c, player);
      break;
    case 'leap':
      leap(self, c);
      break;
    case 'dazed':
      dazed(self, c);
      break;
    case 'cooldown':
      cooldown(self, c, player);
      break;
    case 'return':
      returnStep(self, c);
      break;
    case 'squash':
      squash(self, c);
      break;
    case 'tumble':
      tumble(self, c);
      break;
    case 'poof':
      self._poofStep(c);
      wreathFly(self, c);
      break;
  }
}

export const frog = { home, notice, release, bumped, step, defeat, ring };
