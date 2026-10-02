// The Tin Crab ("burkkrabba"), the critter of the sand bar in the Sound and of the islet's first
// terrace (objects/Critters.js runs it): a coral hermit crab living in an old oval herring tin.
// Calm, it sits hidden in its tin, its eye stalks peeking out now and then (and following him
// while he is about, swimming too). When Jonas comes into its fight circle it wakes: up on its
// legs with two clacks of its claws and a spray of sand. Then it sidles round him, facing him,
// walking sideways and closing in or easing off slowly until he is 175 to 185 away (times its
// size), and, once it has stepped out from behind him as the camera sees it, winds up: it rises
// tall, its claws go up and wide, glowing, the pincers working, clacking every 6 ticks; 14 ticks
// in its heading locks, and at 24 it lunges along it (4 ticks, 72 in all) and snaps: only the
// lunge's last 3 ticks hurt (its claw sphere in front of it). Then its claws stick in the sand
// for 28 ticks (the stomp window), it cools off and comes again; let go, it sidles home and
// hides. It never steps off its level, onto a deadly floor or into deeper water than its spot
// allows (a wading crab stands in the shallows, the sand bar's on taller legs, sitting up a
// little in its tin when hidden). A stomp dents its tin (it rattles like a can and poofs); a hit
// knocks it tumbling, the tin spinning, dented as it lands; either way a 'tonk', and its coin.
// In the shallows its dented tin floats up, never sinking out of sight.
//
//   crab.home(self, c)                   hidden in its tin at home (reset, a lost life)
//   crab.notice(self, c)                 calm -> WAKE (he came into its circle, or bumped it)
//   crab.release(self, c)                engaged -> RETURN (he left; a windup is called off)
//   crab.bumped()                        false: walked into, it is pushed aside
//   crab.step(self, c, player)           one 30 Hz tick of its state
//   crab.defeat(self, c, stomped)        stomped (DENT) or struck (TUMBLE), from any live state
// `self` is the Critters manager (its shared mechanics: moving on its floor, the token, sounds,
// the hurt test), `c` the crab's record; every length times its scale. Its legs' lift (0 in its
// tin, 1 standing, more in the tell) goes to the shader with its spot's stand in the lift
// channel (b1). Numbers: CRAB (CRITTER.CRAB); every choice is noise on the manager's life
// counter, so a reset manager replays exactly.

import { approachAngle as turn, lerp, smoothstep } from '../../core/math.js';
import { CRITTER_RIG } from '../critterModel.js';

const RIG = CRITTER_RIG.crab;

export const CRAB = {
  WINDUP: 24, // ticks of the tell
  LOCK: 14, // ... its heading locks at this windup tick
  CLACK_EVERY: 6, // a clack (and a twinkle at each claw) every this many ticks of it
  PINCH: 4, // the lunge: this many ticks forward along the locked heading ...
  PINCH_SPEED: 18, // ... this fast (at every size: where the fairness rows were measured)
  HURT_FROM: 2, // the pinch snaps at this tick and hurts on its ticks HURT_FROM..PINCH only:
  CLAW_FRONT: 56, // its claw sphere, this far in front of it ...
  CLAW_Y: 42, // ... this high (riding its lift) ...
  CLAW_R: 32, // ... this big
  STUCK: 28, // its claws stuck in the sand after the pinch: the stomp window
  COOLDOWN: 40,
  CANCEL_COOLDOWN: 30, // a windup called off (he went away)
  WIN_MIN: 175, // a windup starts only with him this far away ...
  WIN_MAX: 185, // ... up to this (where every fairness row was measured) ...
  DY: 100, // ... and at most this far above or below it ...
  OFF_LINE: 0.45, // ... and (with a camera) this far (radians) off the camera's line through him,
  LINE_WAIT: 45, // so its tell never plays hidden behind him (it sidles out first; or this long)
  WAKE: 14,
  HIDE: 16,
  TURN: 0.25, // radians per tick
  TRACK: 0.05, // hidden, its tin turns to follow him this fast
  SIDE_SPEED: 7, // it sidles round him this fast ...
  IN_SPEED: 3, // ... closing in or easing off toward its window this fast (slow: catchable)
  FLIP_EVERY: [40, 80], // it sidles the other way now and then (and when it cannot go on)
  GAIT: 0.6, // its legs' step (radians of the gait a tick)
  AWARE: 250, // hidden, it watches him while he is on its level within fight + AWARE ...
  PEEK: 30, // ... else it peeks for this long ...
  PEEK_EVERY: [60, 120], // ... now and then
  EYES_IN: 0.05, // its eye stalks: in, peeking, up
  EYES_PEEK: 0.7,
  EYES_UP: 1.1,
  TUCK: -0.4, // its claws: tucked, at rest, raised in the tell, dug into the sand
  REST: 0.3,
  RAISE: 1.3,
  DIG: -0.6,
  TELL_LIFT: 1.25, // how tall it stands in the tell
  WADE_LIFT: 0.65, // hidden at a wading spot it sits up this far on its legs (at the sand bar its
  // yellow band and up, and its peeking eyes, over the water)
  STUCK_PITCH: 0.25, // nose down, the tin's top up, while its claws are stuck
  HOME_NEAR: 15, // a walk home ends here (then it hides)
  LEASH: 40, // its body never leaves fight + LEASH of home
  DENT: 3, // a stomp: its tin dents this long, then the poof (rattling on: its coin comes at
  // DENT + POOF, while the camera following his bounce still has it in view)
  DENT_SQ: 0.6, // ... squashed to this height
  RATTLE: 0.2, // ... rolling this far each way, and less each tick
  RATTLE_DECAY: 0.85,
  FLOAT: 30, // at a wading spot a dented tin floats up, its top kept this far over the water
  TUMBLE: 20, // a hit: knocked tumbling, the tin spinning ...
  TUMBLE_SPEED: 8,
  TUMBLE_VY: 12,
  DENT_AT: 6, // ... dented from this tick on
  SPIN: 0.5,
  GRAVITY: 2.7,
};

// The lift channel: its legs' lift k plus its spot's stand (in its scale's LIFT_SPANs); hidden,
// its tin rests on the ground (in the shallows it sits up a little, WADE_LIFT).
const stand = (c) => c.stand / (RIG.LIFT_SPAN * c.scale);
const lift = (c) => c.b1 - stand(c);
const setLift = (c, k) => (c.b1 = k + stand(c));
const hiddenLift = (c) => (c.wade === 1 ? CRAB.WADE_LIFT : 0);

function home(self, c) {
  c.state = 'hidden';
  c.t = 0;
  c.x = c.hx;
  c.y = c.hy;
  c.z = c.hz;
  c.floorY = c.hy;
  c.vx = c.vy = c.vz = 0;
  c.yaw = c.yaw0;
  c.dir = 1;
  c.a0 = c.a1 = c.a3 = c.glow = 0;
  c.a2 = CRAB.TUCK;
  c.b0 = CRAB.EYES_IN;
  setLift(c, hiddenLift(c));
  c.blinkAt = self.life + self._every(c, CRAB.PEEK_EVERY, 1);
}

// Its legs walking (the gait on, a full stride) or still.
function walk(c, on) {
  if (on) c.a0 += CRAB.GAIT;
  c.a1 = lerp(c.a1, on ? 1 : 0, 0.3);
}

// HIDDEN: in its tin, claws tucked; its eye stalks watch him (the tin turning after him) while
// he is about (on its level within fight + AWARE, or swimming there: watched, never woken),
// else peek out now and then. No queries.
function hidden(self, c, player) {
  c.a2 = lerp(c.a2, CRAB.TUCK, 0.2);
  walk(c, false);
  const L = self.life;
  if (L >= c.blinkAt + CRAB.PEEK) c.blinkAt = L + self._every(c, CRAB.PEEK_EVERY, 1);
  let eyes = L >= c.blinkAt ? CRAB.EYES_PEEK : CRAB.EYES_IN;
  const r = Math.sqrt(c.fight2) + CRAB.AWARE;
  const dx = player.pos.x - c.hx;
  const dz = player.pos.z - c.hz;
  if (self._near(c, r) || (player.inWater === true && dx * dx + dz * dz < r * r)) {
    eyes = CRAB.EYES_PEEK;
    c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), CRAB.TRACK);
  }
  c.b0 = lerp(c.b0, eyes, 0.25);
}

// A clack of its claws, a white twinkle at each (up and wide in the tell).
function clack(self, c) {
  self._sound(c, 'crab_clack');
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const s = c.scale;
  for (let k = -1; k <= 1; k += 2) self._twinkle(c, 6, 95 + self._rise(c), (k * 55 * cy + 40 * sy) * s, (40 * cy - k * 55 * sy) * s);
}

function notice(self, c) {
  c.state = 'wake';
  c.t = 0;
  self._sound(c, 'crab_clack');
  self._clods(c, 20 * c.scale, 'sand', 6);
}

// WAKE: up on its legs, claws out, stalks up, turning to him; a second clack.
function wake(self, c, player) {
  setLift(c, lerp(lift(c), 1, 0.25));
  c.a2 = lerp(c.a2, CRAB.REST, 0.25);
  c.b0 = lerp(c.b0, CRAB.EYES_UP, 0.3);
  c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), CRAB.TURN);
  if (c.t === CRAB.CLACK_EVERY) self._sound(c, 'crab_clack');
  if (c.t >= CRAB.WAKE) {
    c.state = 'strafe';
    c.t = 0;
    c.next = self.life + self._every(c, CRAB.FLIP_EVERY, 2);
  }
}

// May it wind up now? He is in its window (175..185 away, times its scale; within DY up or
// down), its own cooldown is over, the token is free (and the gap after the last strike has
// passed), he can be fought (not away, not blinking after a hit), and it is not hidden behind
// him from the camera (within OFF_LINE of the camera's line through him: a child walking
// straight at it has it right there), unless it has sidled LINE_WAIT ticks already.
function canWindup(self, c, player, d) {
  if (d < CRAB.WIN_MIN * c.scale || d > CRAB.WIN_MAX * c.scale) return false;
  const dy = player.pos.y - c.y;
  if (dy >= CRAB.DY || dy <= -CRAB.DY) return false;
  if (c.cooldown !== 0 || !self.fightable || !self._tokenFree()) return false;
  const yaw = self.cameraYaw;
  if (yaw === null || c.t >= CRAB.LINE_WAIT || d < 1) return true;
  return ((c.x - player.pos.x) * Math.sin(yaw) + (c.z - player.pos.z) * Math.cos(yaw)) / d < Math.cos(CRAB.OFF_LINE);
}

// STRAFE (and COOLDOWN, with no windup): facing him it sidles round him, closing in while he is
// beyond its window, easing off while he is inside it, turning back now and then or when it
// may not go on (one findWalls and one findFloor a tick).
function strafe(self, c, player, may) {
  setLift(c, lerp(lift(c), 1, 0.25));
  c.a2 = lerp(c.a2, CRAB.REST, 0.2);
  c.a3 = lerp(c.a3, 0.2, 0.2);
  c.b0 = lerp(c.b0, 1, 0.3);
  c.glow *= 0.8;
  c.pitch *= 0.8;
  if (c.cooldown > 0) c.cooldown--;
  let dx = player.pos.x - c.x;
  let dz = player.pos.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  c.yaw = turn(c.yaw, Math.atan2(dx, dz), CRAB.TURN);
  if (may && canWindup(self, c, player, d)) {
    toWindup(self, c);
    return;
  }
  if (d > 1) {
    dx /= d;
    dz /= d;
  } else {
    dx = Math.sin(c.yaw);
    dz = Math.cos(c.yaw);
  }
  const L = self.life;
  if (L >= c.next) {
    c.dir = -c.dir;
    c.next = L + self._every(c, CRAB.FLIP_EVERY, 2);
  }
  const s = c.scale;
  const r = (d > CRAB.WIN_MAX * s ? CRAB.IN_SPEED : d < CRAB.WIN_MIN * s ? -CRAB.IN_SPEED : 0) * s;
  const side = CRAB.SIDE_SPEED * s * c.dir;
  const moved = self._move(c, c.x + dz * side + dx * r, c.z - dx * side + dz * r);
  if (!moved) c.dir = -c.dir;
  walk(c, moved);
}

function toWindup(self, c) {
  c.state = 'windup';
  c.t = 0;
  c.struck = 0;
  self._takeToken(c);
  clack(self, c);
}

// WINDUP: it rises tall, claws up and wide and glowing, the pincers working, a clack every 6
// ticks; its heading tracks him until the lock, then holds; then the PINCH.
function windup(self, c, player) {
  if (!self.fightable) {
    cancel(self, c);
    return;
  }
  const u = smoothstep(0, 8, c.t);
  setLift(c, 1 + (CRAB.TELL_LIFT - 1) * u);
  c.a2 = CRAB.REST + (CRAB.RAISE - CRAB.REST) * u;
  c.a3 = 0.5 + 0.5 * Math.sin(c.t * 0.9);
  c.glow = u;
  walk(c, false);
  const toHim = Math.atan2(player.pos.x - c.x, player.pos.z - c.z);
  if (c.t < CRAB.LOCK) c.yaw = turn(c.yaw, toHim, CRAB.TURN);
  else if (c.t === CRAB.LOCK) {
    c.yaw = toHim;
    c.lockYaw = toHim;
  }
  if (c.t % CRAB.CLACK_EVERY === 0 && c.t < CRAB.WINDUP) clack(self, c);
  if (c.t >= CRAB.WINDUP) {
    c.state = 'pinch';
    c.t = 0;
  }
}

// PINCH: a lunge along the locked heading (refused at its edge and walls like its sidling), the
// claws thrust out open and snapping shut at HURT_FROM ('crab_snap', hit or miss); from then on
// its claw sphere hurts him (once). The token goes back at its end.
function pinch(self, c) {
  const s = c.scale;
  const sy = Math.sin(c.lockYaw);
  const cy = Math.cos(c.lockYaw);
  const v = CRAB.PINCH_SPEED;
  self._move(c, c.x + sy * v, c.z + cy * v);
  c.yaw = c.lockYaw;
  if (self._parried(c)) return;
  c.a2 = lerp(c.a2, 0.4, 0.5);
  c.a3 = c.t < CRAB.HURT_FROM ? 1 : 0;
  if (c.t === CRAB.HURT_FROM) self._sound(c, 'crab_snap');
  if (c.t >= CRAB.HURT_FROM && c.struck === 0) {
    const f = CRAB.CLAW_FRONT * s;
    const x = c.x + sy * f;
    const y = c.y + (CRAB.CLAW_Y + self._rise(c)) * s;
    const z = c.z + cy * f;
    if (self._touches(x, y, z, CRAB.CLAW_R * s)) self._hurt(c, x, y, z);
  }
  if (c.t >= CRAB.PINCH) {
    self._freeToken(c);
    c.state = 'stuck';
    c.t = 0;
  }
}

// STUCK: claws dug into the sand, nose down and the tin up, legs scrabbling: the stomp window.
function stuck(self, c) {
  setLift(c, lerp(lift(c), 1, 0.3));
  c.a2 = lerp(c.a2, CRAB.DIG, 0.4);
  c.a3 = 0;
  c.glow *= 0.7;
  c.pitch = lerp(c.pitch, CRAB.STUCK_PITCH, 0.3);
  c.a0 += 2 * CRAB.GAIT;
  c.a1 = 1;
  if (c.t >= CRAB.STUCK) {
    c.state = 'cooldown';
    c.t = 0;
  }
}

// A windup called off: the token back (with its gap), a cooldown, sidling again.
function cancel(self, c) {
  self._freeToken(c);
  c.cooldown = CRAB.CANCEL_COOLDOWN;
  c.state = 'strafe';
  c.t = 0;
}

function release(self, c) {
  if (c.state === 'windup') {
    self._freeToken(c);
    c.cooldown = CRAB.CANCEL_COOLDOWN;
  }
  c.state = 'return';
  c.t = 0;
}

// RETURN: it sidles home (facing across its way), then HIDE; one that may not go on hides where
// it is.
function returnStep(self, c) {
  setLift(c, lerp(lift(c), 1, 0.25));
  c.a2 = lerp(c.a2, CRAB.REST, 0.2);
  c.glow *= 0.8;
  c.pitch *= 0.8;
  if (c.cooldown > 0) c.cooldown--;
  const dx = c.hx - c.x;
  const dz = c.hz - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  let moved = false;
  if (d >= CRAB.HOME_NEAR) {
    c.yaw = turn(c.yaw, Math.atan2(dz, -dx), CRAB.TURN);
    const v = CRAB.SIDE_SPEED * c.scale < d ? CRAB.SIDE_SPEED * c.scale : d;
    moved = self._move(c, c.x + (dx / d) * v, c.z + (dz / d) * v);
  }
  walk(c, moved);
  if (!moved) {
    c.state = 'hide';
    c.t = 0;
  }
}

// HIDE: down into its tin, claws tucked, stalks in; then HIDDEN.
function hide(self, c) {
  setLift(c, lerp(lift(c), hiddenLift(c), 0.2));
  c.a2 = lerp(c.a2, CRAB.TUCK, 0.2);
  c.b0 = lerp(c.b0, CRAB.EYES_IN, 0.2);
  walk(c, false);
  if (c.t >= CRAB.HIDE) {
    setLift(c, hiddenLift(c));
    c.state = 'hidden';
    c.t = 0;
    c.blinkAt = self.life + self._every(c, CRAB.PEEK_EVERY, 1);
  }
}

// Defeated: stomped (DENT) or knocked tumbling (TUMBLE); the tin goes 'tonk', sand and bits of
// tin fly.
function defeat(self, c, stomped) {
  c.glow = 0;
  c.a3 = 0;
  c.t = 0;
  if (stomped) {
    c.state = 'dent';
    c.vx = c.vy = c.vz = 0;
    c.roll = CRAB.RATTLE;
  } else {
    c.state = 'tumble';
    self._knock(c, CRAB.TUMBLE_SPEED * c.scale, CRAB.TUMBLE_VY);
  }
  self._sound(c, 'crab_tonk');
  self._clods(c, 50 * c.scale, 'sand', 8);
  self._clods(c, 50 * c.scale, 'scrap', 4);
}

// A dented tin: squashed, its stalks drooping, sagging on its legs (in the shallows it keeps
// standing), rattling like a can (rolling each way, less each tick).
function dented(c) {
  c.sq = lerp(c.sq, CRAB.DENT_SQ, 0.6);
  c.b0 = lerp(c.b0, 0.3, 0.3);
  c.a1 = 0;
  if (c.wade === 0) setLift(c, lerp(lift(c), 0.4, 0.3));
  c.roll = -c.roll * CRAB.RATTLE_DECAY;
}

// At a wading spot a dented tin floats up: its top (riding its lift, squashed and poofing with
// it) never under FLOAT over the water, where it would crumple out of sight.
function afloat(self, c) {
  const col = self.collision;
  if (c.wade === 0 || !col.waterLevelAt) return;
  const y = col.waterLevelAt(c.x, c.z) + CRAB.FLOAT - (RIG.TOP + self._rise(c)) * c.scale * c.sq * c.vis;
  if (c.y >= y) return;
  c.y = y;
  if (c.vy >= 0) return;
  // (Coming down on the water, as on its floor: it stops falling and slows.)
  c.vy = 0;
  c.vx *= 0.5;
  c.vz *= 0.5;
}

// DENT: squashed and rattling; then the poof (rattling on).
function dent(self, c) {
  dented(c);
  afloat(self, c);
  if (c.t >= CRAB.DENT) self._poof(c);
}

// TUMBLE: knocked away, the tin spinning (the minions' wreck rules for floors and walls; never
// into water deeper than it may wade), dented from DENT_AT on; then the poof.
function tumble(self, c) {
  self._tumble(c, CRAB.GRAVITY);
  c.yaw += CRAB.SPIN;
  if (c.t >= CRAB.DENT_AT) dented(c);
  afloat(self, c);
  if (c.t >= CRAB.TUMBLE) self._poof(c);
}

function step(self, c, player) {
  switch (c.state) {
    case 'hidden':
      hidden(self, c, player);
      break;
    case 'wake':
      wake(self, c, player);
      break;
    case 'strafe':
      strafe(self, c, player, true);
      break;
    case 'windup':
      windup(self, c, player);
      break;
    case 'pinch':
      pinch(self, c);
      break;
    case 'stuck':
      stuck(self, c);
      break;
    case 'cooldown':
      strafe(self, c, player, false);
      if (c.t >= CRAB.COOLDOWN) {
        c.state = 'strafe';
        c.t = 0;
      }
      break;
    case 'return':
      returnStep(self, c);
      break;
    case 'hide':
      hide(self, c);
      break;
    case 'dent':
      dent(self, c);
      break;
    case 'tumble':
      tumble(self, c);
      break;
    case 'poof':
      self._poofStep(c);
      dented(c);
      afloat(self, c);
      break;
  }
}

const bumped = () => false;

export const crab = { home, notice, release, bumped, step, defeat };
