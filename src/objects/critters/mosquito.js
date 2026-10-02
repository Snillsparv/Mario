// The Mosquito ("mygga"), the meadow's other critter (objects/Critters.js runs it): a big
// cartoon mosquito in a charcoal-and-white livery. Calm, it patrols a figure of eight over its
// home 150 up (a closed form on the life counter: no queries), whining quietly now and then
// when he is about. When Jonas comes into its fight circle it spots him (a loud whine) and
// chases him to a stand point 220 from him, moving only while it is further than 230 from him:
// it never backs off, so nearer it just hovers. Parked 200 to 240 from him, his feet on its
// level and dry (else it waits), it aims: T (his feet) and its heading lock on its first tick
// and an orange ring shows the spot (growing to MARK_R across); over 12 ticks it rises 80 and
// draws back 40, the needle pitched at T, the abdomen curling, its eyes and the needle's tip
// glowing red, a rising whine with a 'ting' as it locks.
// 24 ticks in it dives: the needle's tip runs along the locked line to 20 under T's floor, and
// it hurts only low over the floor (TIP_HURT) and only on the marked spot (his feet within
// MARK_R + PLAYER_RADIUS of T): anywhere else it passes him and sticks in the turf. Hit, it
// bounces off in a somersault and cools off; missed, it is STUCK for 60 ticks (wings buzzing,
// legs kicking, a tug and a 'doinng' every 20: the counter window), pulls free with a 'thwop'
// and comes again; let go, it flies back to its patrol.
// A stomp flattens it (an accordion splat) and it poofs right there; a hit sends it off like a
// balloon let go, deflating as it zig-zags away, then it falls and poofs; its coin on the floor
// under it.
//
//   mosquito.home(self, c)               patrolling over its home (reset, a lost life)
//   mosquito.notice(self, c)             calm -> SPOT (he came into its circle, or bumped it)
//   mosquito.release(self, c)            engaged -> RETURN (he left; an aim is called off)
//   mosquito.bumped()                    false: walked or jumped into (but in its aim and dive),
//                                        it is pushed aside
//   mosquito.step(self, c, player)       one 30 Hz tick of its state
//   mosquito.defeat(self, c, stomped)    stomped (SPLAT) or struck (DEFLATE), from any live state
// `self` is the Critters manager (its shared mechanics), `c` the mosquito's record: its origin
// is its thorax; floorY stays its home's floor (it flies over the meadow). Numbers: MOSQUITO
// (CRITTER.MOSQUITO); every choice is noise on the manager's life counter, so a reset manager
// replays exactly.

import { PLAYER_RADIUS } from '../../core/constants.js';
import { TAU, approachAngle as turn, lerp, smoothstep } from '../../core/math.js';
import { CRITTER_RIG } from '../critterModel.js';

const RIG = CRITTER_RIG.mosquito;
// The needle's tip: how far from its origin, and how far (radians) under its body's axis.
const TIP_LEN = Math.hypot(RIG.NEEDLE_TIP[1], RIG.NEEDLE_TIP[2]);
const TIP_DROP = Math.atan2(-RIG.NEEDLE_TIP[1], RIG.NEEDLE_TIP[2]);

export const MOSQUITO = {
  HOVER: 150, // it flies this high over its home's floor ...
  BOB: 18, // ... bobbing this much on its patrol
  SWAY_X: 160, // its patrol: a figure of eight this far across its home (times roam / SWAY_X) ...
  SWAY_Z: 110, // ... and this far along
  SWAY_RATE: 0.035, // radians a tick across (twice it along)
  BOB_RATE: 0.11,
  WHINE_EVERY: [180, 300], // its idle whine (quiet), with him within WHINE_NEAR of it
  WHINE_NEAR: 1200,
  SPOT: 8,
  TURN: 0.3, // radians per tick
  STAND: 220, // it chases him to a stand point this far from him ...
  CHASE_FROM: 230, // ... moving only while it is further than this from him (never away)
  ACCEL: 0.8,
  SPEED: 9,
  AIM: 24, // ticks of the tell (T and its heading lock on its first)
  WIN_MIN: 200, // an aim starts only with him this far away (across the ground) ...
  WIN_MAX: 240, // ... up to this
  DY: 120, // ... and his feet at most this far above or below its floor
  LEVEL_DY: 40, // T on its home floor within this, and dry
  AIM_UP: 80, // in the aim it rises this much ...
  AIM_BACK: 40, // ... and draws back this far from T ...
  AIM_EASE: 12, // ... over this many ticks
  MARK_FROM: 110, // the danger ring grows from this across (well over his shadow) ...
  MARK_TO: 170, // ... to 2 MARK_R by the dive
  DIVE_SPEED: 24, // the needle's tip along the locked line ...
  DEEP: 20, // ... to this far under T's floor
  TIP_HURT: 100, // it hurts only with its tip at most this high over T's floor ...
  MARK_R: 85, // ... and him on the marked spot (his feet within MARK_R + PLAYER_RADIUS of T)
  TIP_R: 30,
  OFF_LINE: 10, // a wall pushing it this far off its line: a miss, no stick
  RECOIL: 14, // hit: it bounces up and back in a somersault ...
  RECOIL_BACK: 6,
  RECOIL_VY: 10,
  RECOIL_G: 0.8,
  HIT_COOLDOWN: 60, // ... and cools off
  STUCK: 60, // missed: the needle stuck in the turf (the counter window) ...
  STUCK_ANGLE: 0.96, // ... at this angle down (its body about 85 over the floor)
  TUG_EVERY: 20, // ... tugging every this many ticks ...
  TUG: 8, // ... pulling back this far, springing back in TUG_TICKS
  TUG_TICKS: 6,
  PULL: 10, // pulling free ...
  PULL_COOLDOWN: 45, // ... then cooling off
  CANCEL_COOLDOWN: 30, // an aim called off (he went away, T no good)
  RETURN_SPEED: 12,
  HOME_NEAR: 15, // a flight home ends here (then its patrol)
  WALL_R: 45,
  LEASH: 100, // its body never leaves fight + LEASH of home
  SPLAT: 3, // a stomp: squashed flat this long, then it poofs where it is (its coin at SPLAT +
  // POOF, while the camera following his bounce still has it in view)
  SPLAT_SQ: 0.35,
  FALL_G: 2,
  FALL_SPIN: 0.3,
  REST: 12, // its origin over the floor, flat on it
  DEFLATE: 24, // a hit: off like a balloon let go, shrinking to DEFLATE_TO ...
  DEFLATE_SPEED: 12,
  DEFLATE_VY: 10,
  DEFLATE_DRAG: 0.92, // ... slowing ...
  DEFLATE_G: 1, // ... sinking
  DEFLATE_TO: 0.45,
  WING: 2.4, // wing beats (radians a tick): calm, aiming or diving, stuck
  WING_FAST: 3.2,
  WING_STUCK: 3.8,
};

// Its patrol point at the life counter now (a figure of eight round home, closed form), in _cv.
const _cv = { x: 0, y: 0, z: 0 };
function curve(self, c) {
  const L = self.life;
  const k = c.roam / MOSQUITO.SWAY_X;
  _cv.x = c.hx + MOSQUITO.SWAY_X * k * Math.sin(MOSQUITO.SWAY_RATE * L + c.seed);
  _cv.y = c.hy + MOSQUITO.HOVER + MOSQUITO.BOB * Math.sin(MOSQUITO.BOB_RATE * L);
  _cv.z = c.hz + MOSQUITO.SWAY_Z * k * Math.sin(2 * MOSQUITO.SWAY_RATE * L + c.seed);
}

// Wings beating (amplitude, speed) and legs dangling.
function flutter(c, amp, rate) {
  c.a0 += rate;
  c.a1 = lerp(c.a1, amp, 0.3);
  c.a3 += 0.12;
}

// Level at its hover height, the needle down, the tell's glow gone.
function hover(c) {
  c.y = lerp(c.y, c.hy + MOSQUITO.HOVER, 0.15);
  c.pitch = lerp(c.pitch, 0, 0.3);
  c.a2 = lerp(c.a2, 0, 0.2);
  c.b0 *= 0.7;
  c.b1 = 0;
  c.glow *= 0.8;
}

const face = (c, player) => (c.yaw = turn(c.yaw, Math.atan2(player.pos.x - c.x, player.pos.z - c.z), MOSQUITO.TURN));

// One tick along (vx, vz), held inside its leash, out of the walls (one findWalls: it slides
// along them).
function fly(self, c) {
  let x = c.x + c.vx;
  let z = c.z + c.vz;
  const hx = x - c.hx;
  const hz = z - c.hz;
  const h2 = hx * hx + hz * hz;
  if (h2 > c.leash2) {
    const k = Math.sqrt(c.leash2 / h2);
    x = c.hx + hx * k;
    z = c.hz + hz * k;
  }
  const w = self.collision.findWalls(x, c.y, z, 0, MOSQUITO.WALL_R * c.scale);
  c.x = w.x;
  c.z = w.z;
}

function home(self, c) {
  c.state = 'patrol';
  c.t = 0;
  curve(self, c);
  c.x = _cv.x;
  c.y = _cv.y;
  c.z = _cv.z;
  c.floorY = c.hy;
  c.vx = c.vy = c.vz = 0;
  c.yaw = c.yaw0;
  c.a0 = c.a2 = c.a3 = c.b0 = c.b1 = c.glow = 0;
  c.a1 = 1;
  c.croakAt = self.life + self._every(c, MOSQUITO.WHINE_EVERY, 3);
}

// PATROL: along its figure of eight, facing its way; a quiet whine now and then with him about.
function patrol(self, c, player) {
  curve(self, c);
  const dx = _cv.x - c.x;
  const dz = _cv.z - c.z;
  if (dx * dx + dz * dz > 0.01) c.yaw = turn(c.yaw, Math.atan2(dx, dz), MOSQUITO.TURN);
  c.x = _cv.x;
  c.y = _cv.y;
  c.z = _cv.z;
  hover(c);
  c.y = _cv.y;
  flutter(c, 1, MOSQUITO.WING);
  const L = self.life;
  if (L >= c.croakAt) {
    c.croakAt = L + self._every(c, MOSQUITO.WHINE_EVERY, 3);
    const hx = player.pos.x - c.x;
    const hz = player.pos.z - c.z;
    if (hx * hx + hz * hz < MOSQUITO.WHINE_NEAR * MOSQUITO.WHINE_NEAR) self._idleSound(c, 'mosquito_whine');
  }
}

function notice(self, c) {
  c.state = 'spot';
  c.t = 0;
  c.vx = c.vz = 0;
  self._sound(c, 'mosquito_whine', 1.3);
}

// May it aim now? He is in its window (200..240 away across the ground; his feet within DY of
// its floor), its own cooldown is over, the token is free (and the gap after the last strike has
// passed), and he can be fought (not away, not blinking after a hit).
function canAim(self, c, player, d) {
  if (d < MOSQUITO.WIN_MIN || d > MOSQUITO.WIN_MAX) return false;
  const dy = player.pos.y - c.floorY;
  if (dy >= MOSQUITO.DY || dy <= -MOSQUITO.DY) return false;
  return c.cooldown === 0 && self.fightable && self._tokenFree();
}

// CHASE: toward its stand point (STAND from him, on its side of him), speeding up, only while it
// is further than CHASE_FROM from him; nearer it hovers (and aims when it may): it never backs
// off.
function chase(self, c, player) {
  hover(c);
  flutter(c, 1, MOSQUITO.WING);
  if (c.cooldown > 0) c.cooldown--;
  const p = player.pos;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  face(c, player);
  if (d > MOSQUITO.CHASE_FROM) {
    const ex = dx - (dx / d) * MOSQUITO.STAND;
    const ez = dz - (dz / d) * MOSQUITO.STAND;
    const e = Math.sqrt(ex * ex + ez * ez);
    let v = Math.sqrt(c.vx * c.vx + c.vz * c.vz) + MOSQUITO.ACCEL;
    if (v > MOSQUITO.SPEED) v = MOSQUITO.SPEED;
    if (v > e) v = e;
    c.vx = (ex / e) * v;
    c.vz = (ez / e) * v;
    fly(self, c);
    return;
  }
  c.vx = c.vz = 0;
  if (!canAim(self, c, player, d)) return;
  // T (his feet) on its level and dry first, or no tell at all: it waits a while and looks again.
  if (self._floorAt(c, p.x, p.z, MOSQUITO.LEVEL_DY) !== null) toAim(self, c);
  else c.cooldown = MOSQUITO.CANCEL_COOLDOWN;
}

function toAim(self, c) {
  c.state = 'aim';
  c.t = 0;
  c.struck = 0;
  c.sx0 = c.x;
  c.sy0 = c.y;
  c.sz0 = c.z;
  self._takeToken(c);
  self._sound(c, 'mosquito_aim');
}

// AIM: on its first tick T (his feet, on its level and dry, as they were a tick before; else it
// gives up) and its heading lock, the ring at T; it rises and draws back from T, the needle
// pitched at T, the abdomen curling, eyes and needle red and glowing; then the DIVE.
function aim(self, c, player) {
  if (!self.fightable) {
    cancel(self, c);
    return;
  }
  flutter(c, 1.4, MOSQUITO.WING_FAST);
  if (c.t === 1) {
    if (!self._markAt(c, player.pos.x, player.pos.z, MOSQUITO.LEVEL_DY)) {
      cancel(self, c);
      return;
    }
    const dx = c.tx - c.x;
    const dz = c.tz - c.z;
    if (dx * dx + dz * dz > 1) c.yaw = Math.atan2(dx, dz);
    c.lockYaw = c.yaw;
  }
  const e = smoothstep(0, MOSQUITO.AIM_EASE, c.t);
  let bx = c.sx0 - c.tx;
  let bz = c.sz0 - c.tz;
  const b = Math.sqrt(bx * bx + bz * bz);
  if (b > 1) {
    bx /= b;
    bz /= b;
  } else {
    bx = -Math.sin(c.yaw);
    bz = -Math.cos(c.yaw);
  }
  c.x = c.sx0 + bx * MOSQUITO.AIM_BACK * e;
  c.y = c.sy0 + MOSQUITO.AIM_UP * e;
  c.z = c.sz0 + bz * MOSQUITO.AIM_BACK * e;
  const hx = c.tx - c.x;
  const hz = c.tz - c.z;
  c.pitch = (Math.atan2(c.y - c.ty + MOSQUITO.DEEP, Math.sqrt(hx * hx + hz * hz)) - TIP_DROP) * e;
  c.a2 = e;
  c.b0 = 1;
  c.glow = e;
  c.mark = (c.t - 1) / (MOSQUITO.AIM - 1);
  if (c.t >= MOSQUITO.AIM) {
    c.state = 'dive';
    c.t = 0;
    c.sx0 = c.x;
    c.sy0 = c.y;
    c.sz0 = c.z;
    self._sound(c, 'mosquito_dive');
  }
}

// DIVE: the needle's tip runs from where the aim ended along the locked line, DIVE_SPEED a
// tick, to DEEP under T's floor (its body behind it on the line, one findWalls a tick: pushed
// off the line, a miss). It hurts him only low over the floor and on the marked spot (its tip's
// sphere against his capsule); a hit bounces it off (RECOIL), else it sticks in the turf
// (STUCK). The token goes back either way.
function dive(self, c, player) {
  const s = c.scale;
  const qx = c.tx - c.sx0;
  const qy = c.ty - MOSQUITO.DEEP - c.sy0;
  const qz = c.tz - c.sz0;
  const L = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const ux = qx / L;
  const uy = qy / L;
  const uz = qz / L;
  let run = c.t * MOSQUITO.DIVE_SPEED + TIP_LEN * s;
  if (run > L) run = L;
  const tx = c.sx0 + ux * run;
  const ty = c.sy0 + uy * run;
  const tz = c.sz0 + uz * run;
  const x = tx - ux * TIP_LEN * s;
  const z = tz - uz * TIP_LEN * s;
  const w = self.collision.findWalls(x, ty - uy * TIP_LEN * s, z, 0, MOSQUITO.WALL_R * s);
  if ((w.x - x) * (w.x - x) + (w.z - z) * (w.z - z) > MOSQUITO.OFF_LINE * MOSQUITO.OFF_LINE) {
    endStrike(self, c);
    toRise(c, MOSQUITO.PULL_COOLDOWN);
    return;
  }
  c.x = x;
  c.y = ty - uy * TIP_LEN * s;
  c.z = z;
  c.yaw = Math.atan2(ux, uz);
  c.pitch = Math.atan2(-uy, Math.sqrt(ux * ux + uz * uz)) - TIP_DROP;
  c.b0 *= 0.7;
  flutter(c, 1.4, MOSQUITO.WING_FAST);
  if (self._parried(c)) return;
  const p = player.pos;
  const mx = p.x - c.tx;
  const mz = p.z - c.tz;
  const on = MOSQUITO.MARK_R + PLAYER_RADIUS;
  if (c.struck === 0 && ty <= c.ty + MOSQUITO.TIP_HURT && mx * mx + mz * mz <= on * on && self._touches(tx, ty, tz, MOSQUITO.TIP_R * s) && self._hurt(c, tx, ty, tz)) {
    endStrike(self, c);
    c.state = 'recoil';
    c.t = 0;
    c.vx = -ux * MOSQUITO.RECOIL_BACK;
    c.vz = -uz * MOSQUITO.RECOIL_BACK;
    c.vy = MOSQUITO.RECOIL_VY;
    return;
  }
  if (run >= L) {
    endStrike(self, c);
    c.state = 'stuck';
    c.t = 0;
    self._sound(c, 'mosquito_stuck');
    self._clods(c, ty - c.y, 'dirt', 4, tx - c.x, tz - c.z);
  }
}

// A strike over (hit, stuck, missed) or called off: the token back, the ring gone.
function endStrike(self, c) {
  self._freeToken(c);
  c.markOn = 0;
}

// RECOIL: bounced up and back off him in one backward somersault (one findWalls a tick).
function recoil(self, c) {
  fly(self, c);
  c.y += c.vy;
  c.vy -= MOSQUITO.RECOIL_G;
  c.pitch -= TAU / MOSQUITO.RECOIL;
  flutter(c, 1.4, MOSQUITO.WING_FAST);
  if (c.t >= MOSQUITO.RECOIL) {
    // (A whole turn back off its drawn angle too, so it is never drawn spinning round again.)
    c.pitch += TAU;
    c.ppitch += TAU;
    toRise(c, MOSQUITO.HIT_COOLDOWN);
  }
}

function toRise(c, cooldown) {
  c.state = 'rise';
  c.t = 0;
  c.cooldown = cooldown;
  c.vx = c.vz = 0;
}

// RISE: back up (or down) to its hover height, level; then it cools off.
function rise(self, c) {
  hover(c);
  flutter(c, 1, MOSQUITO.WING);
  const dy = c.y - c.hy - MOSQUITO.HOVER;
  if (dy < 3 && dy > -3 && c.pitch < 0.05 && c.pitch > -0.05) {
    c.state = 'cooldown';
    c.t = 0;
  }
}

// COOLDOWN: it hovers facing him, then chases again.
function cooldown(self, c, player) {
  hover(c);
  flutter(c, 1, MOSQUITO.WING);
  face(c, player);
  if (c.cooldown > 0) c.cooldown--;
  if (c.cooldown === 0) {
    c.state = 'chase';
    c.t = 0;
  }
}

// How far a tug has pulled it back along its needle, `t` ticks into STUCK.
const tug = (t) => {
  const k = t % MOSQUITO.TUG_EVERY;
  return t > 0 && k < MOSQUITO.TUG_TICKS ? MOSQUITO.TUG * Math.sin((Math.PI * k) / MOSQUITO.TUG_TICKS) : 0;
};

// STUCK: the needle in the turf, its body turning about the tip to STUCK_ANGLE down, wings
// buzzing, legs kicking, quivering; a tug and a 'doinng' every TUG_EVERY ticks (quieter after
// the first); then it pulls free. (Pushed aside by a bump, the needle comes along.)
function stuck(self, c) {
  const L = TIP_LEN * c.scale;
  const a0 = c.pitch + TIP_DROP;
  const a1 = lerp(a0, MOSQUITO.STUCK_ANGLE, 0.3);
  const r0 = L + tug(c.t - 1);
  const r1 = L + tug(c.t);
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  // (the body = the tip - the needle's direction * (its length + the tug))
  const h = r0 * Math.cos(a0) - r1 * Math.cos(a1);
  c.x += sy * h;
  c.z += cy * h;
  c.y += r1 * Math.sin(a1) - r0 * Math.sin(a0);
  c.pitch = a1 - TIP_DROP;
  flutter(c, 1.6, MOSQUITO.WING_STUCK);
  c.a3 += 0.4;
  c.b0 *= 0.7;
  c.b1 = 1;
  c.glow *= 0.7;
  if (c.t % MOSQUITO.TUG_EVERY === 0 && c.t < MOSQUITO.STUCK) self._sound(c, 'mosquito_stuck', 1, 'quiet');
  if (c.t >= MOSQUITO.STUCK) {
    c.state = 'pull';
    c.t = 0;
    c.b1 = 0;
    self._sound(c, 'mosquito_stuck', 1.6);
  }
}

// PULL: back out of the turf along its needle and up, levelling; then it rises and cools off.
function pull(self, c) {
  const a = c.pitch + TIP_DROP;
  c.x -= Math.sin(c.yaw) * Math.cos(a) * 3;
  c.z -= Math.cos(c.yaw) * Math.cos(a) * 3;
  c.y += Math.sin(a) * 3 + 2;
  c.pitch *= 0.8;
  flutter(c, 1.4, MOSQUITO.WING_FAST);
  if (c.t >= MOSQUITO.PULL) toRise(c, MOSQUITO.PULL_COOLDOWN);
}

// An aim called off: the token back, the ring gone, down to its hover height and a cooldown.
function cancel(self, c) {
  endStrike(self, c);
  toRise(c, MOSQUITO.CANCEL_COOLDOWN);
}

function release(self, c) {
  if (c.state === 'aim') cancel(self, c);
  c.state = 'return';
  c.t = 0;
  c.vx = c.vz = 0;
}

// RETURN: back to its patrol point (moving on as the life counter runs), then PATROL.
function returnStep(self, c) {
  hover(c);
  flutter(c, 1, MOSQUITO.WING);
  if (c.cooldown > 0) c.cooldown--;
  curve(self, c);
  c.y = lerp(c.y, _cv.y, 0.15);
  const dx = _cv.x - c.x;
  const dz = _cv.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < MOSQUITO.HOME_NEAR) {
    c.state = 'patrol';
    c.t = 0;
    c.croakAt = self.life + self._every(c, MOSQUITO.WHINE_EVERY, 3);
    return;
  }
  c.yaw = turn(c.yaw, Math.atan2(dx, dz), MOSQUITO.TURN);
  const v = d < MOSQUITO.RETURN_SPEED ? d : MOSQUITO.RETURN_SPEED;
  c.vx = (dx / d) * v;
  c.vz = (dz / d) * v;
  fly(self, c);
}

// Defeated: stomped (an accordion SPLAT) or struck (DEFLATE: off like a balloon let go); a pop
// and a puff of fluff.
function defeat(self, c, stomped) {
  c.glow = 0;
  c.b0 = 0;
  c.b1 = 0;
  c.a2 = 0;
  c.t = 0;
  self._clods(c, 0, 'fluff', 10);
  if (stomped) {
    c.state = 'splat';
    c.vx = c.vy = c.vz = 0;
    self._sound(c, 'mosquito_pop');
  } else {
    c.state = 'deflate';
    self._sound(c, 'mosquito_pop', 1, 'deflate');
    self._knock(c, MOSQUITO.DEFLATE_SPEED, MOSQUITO.DEFLATE_VY);
  }
}

// Falling (or poofing, once on the floor) after its deflate.
function down(self, c) {
  if (c.y > c.floorY + MOSQUITO.REST) {
    c.state = 'fall';
    c.t = 0;
  } else self._poof(c);
}

// SPLAT: squashed flat, the wings barely beating; then the poof, right there.
function splat(self, c) {
  c.sq = lerp(c.sq, MOSQUITO.SPLAT_SQ, 0.6);
  c.pitch *= 0.7;
  flutter(c, 0.3, 1);
  if (c.t >= MOSQUITO.SPLAT) self._poof(c);
}

// FALL: to its floor (its home's: no query), turning, the wings fluttering weakly; the poof.
function fall(self, c) {
  c.vy -= MOSQUITO.FALL_G;
  c.y += c.vy;
  c.yaw += MOSQUITO.FALL_SPIN;
  flutter(c, 0.3, 1);
  if (c.y <= c.floorY + MOSQUITO.REST) {
    c.y = c.floorY + MOSQUITO.REST;
    self._poof(c);
  }
}

// DEFLATE: knocked away slowing and sinking (the minions' wreck rules: walls and the floor stop
// it), zig-zagging, rolling over and shrinking; then down.
function deflate(self, c) {
  const k = MOSQUITO.DEFLATE_DRAG;
  c.vx *= k;
  c.vz *= k;
  c.vy *= k;
  self._tumble(c, MOSQUITO.DEFLATE_G);
  c.yaw += 0.45 * Math.sin(1.3 * c.t);
  c.roll += 0.5;
  c.vis = 1 - ((1 - MOSQUITO.DEFLATE_TO) * c.t) / MOSQUITO.DEFLATE;
  flutter(c, 0.6, MOSQUITO.WING_FAST);
  if (c.t >= MOSQUITO.DEFLATE) down(self, c);
}

function step(self, c, player) {
  switch (c.state) {
    case 'patrol':
      patrol(self, c, player);
      break;
    case 'spot':
      hover(c);
      flutter(c, 1, MOSQUITO.WING);
      face(c, player);
      if (c.t >= MOSQUITO.SPOT) {
        c.state = 'chase';
        c.t = 0;
      }
      break;
    case 'chase':
      chase(self, c, player);
      break;
    case 'aim':
      aim(self, c, player);
      break;
    case 'dive':
      dive(self, c, player);
      break;
    case 'recoil':
      recoil(self, c);
      break;
    case 'rise':
      rise(self, c);
      break;
    case 'cooldown':
      cooldown(self, c, player);
      break;
    case 'stuck':
      stuck(self, c);
      break;
    case 'pull':
      pull(self, c);
      break;
    case 'return':
      returnStep(self, c);
      break;
    case 'splat':
      splat(self, c);
      break;
    case 'fall':
      fall(self, c);
      break;
    case 'deflate':
      deflate(self, c);
      break;
    case 'poof':
      self._poofStep(c);
      break;
  }
}

const bumped = () => false;

export const mosquito = { home, notice, release, bumped, step, defeat };
