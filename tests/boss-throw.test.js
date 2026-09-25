// Grabbing Rustmaw's tail and throwing him off the roof (AI RACE mode; objects/RobotBeast.js,
// player actions/tail.js, objects/BossStar.js, camera/bossCam.js), with the real castle, the
// real Player and the ObjectManager in node: the glowing coupling lies on the rear roof's flat
// walkway where Pip can stand; B grabs it only within reach and only while the beast lies on
// its perch; held, it struggles but never shoots; stick circles spin Pip up (faster each turn,
// winding down when the stick stops) and haul the beast into a whirl round him; a well-spun
// throw lands it clear of the castle and wrecks it ('bossDefeated': the mode ends, the button
// pops up) and the reward star comes out once per game; a weak throw knocks Pip back a wedge
// and the beast slams back onto its perch; the whirl, the haul and the flight never pass
// through the castle; reset() restores everything; the hot paths allocate nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Events } from '../src/core/events.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { RobotBeast, BEAST, GRAB, flightPoint, whirlQuaternion } from '../src/objects/RobotBeast.js';
import { BossStar } from '../src/objects/BossStar.js';
import { BossCam } from '../src/camera/bossCam.js';
import { TAIL_HANDS } from '../src/player/actions/tail.js';
import * as T from '../src/player/physics/tuning.js';

const level = buildLevel(new THREE.Scene());
const collision = level.collision;
const { CASTLE } = level.layout;

// The world as main wires it: 'aiRaceButton' -> 'darkMode', 'bossDefeated' ends the mode.
function setup() {
  const events = new Events();
  const log = [];
  for (const n of ['sfx', 'bossDefeated', 'bossImpact', 'bossThrown', 'darkMode', 'starCollected', 'hurt', 'kaijuRoar']) {
    events.on(n, (e) => log.push({ n, e }));
  }
  let dark = false;
  events.on('aiRaceButton', ({ on }) => {
    dark = on;
    events.emit('darkMode', { on });
  });
  events.on('bossDefeated', () => {
    if (!dark) return;
    dark = false;
    events.emit('darkMode', { on: false });
  });
  const player = new Player({ collision, events, spawn: level.spawn });
  const fxLog = [];
  const fx = {
    explode: (x, y, z, o) => fxLog.push({ fn: 'explode', x, y, z, ...o }),
    dust: (x, y, z, o) => fxLog.push({ fn: 'dust', x, y, z, ...o }),
    ignite: () => 1,
    extinguish() {},
    clearFires() {},
  };
  const lvl = { trees: level.trees, addScorch: (x, z, r) => fxLog.push({ fn: 'scorch', x, z, r }), addCircuit: () => 1, fadeCircuit() {}, clearCircuits() {} };
  const objects = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: level.layout, player, fx, level: lvl });
  const ctl = new ScriptedController();
  const tick = (input = {}) => {
    player.update(ctl.next(input), 0);
    objects.update({ player });
    objects.animate(0, 1, null);
  };
  const beast = objects.beast;
  const sfx = (name) => log.filter((l) => l.n === 'sfx' && l.e.name === name);
  const count = (n) => log.filter((l) => l.n === n).length;
  // AI RACE on and the beast up on its perch.
  const summon = () => {
    events.emit('aiRaceButton', { on: true });
    for (let i = 0; i < BEAST.RISE_TICKS + BEAST.ROAR_TICKS + 5 && beast.state !== 'active'; i++) tick();
    for (let i = 0; i < 5; i++) tick();
  };
  // Pip standing next to the coupling (behind it, facing it), then B.
  const grab = () => {
    const g = beast.grip;
    player.teleport(g.standX - 40, g.standY, g.standZ - 60, g.standYaw);
    player.setAction('idle');
    tick();
    tick({ B: true });
    for (let i = 0; i < 8; i++) tick();
  };
  let turn = 0;
  // One tick of stick circling (one circle every `period` ticks).
  const circle = (period = 12, extra = {}) => {
    const a = (turn++ / period) * Math.PI * 2;
    tick({ stickX: Math.sin(a), stickY: Math.cos(a), ...extra });
  };
  return { events, log, player, objects, beast, tick, sfx, count, summon, grab, circle, fxLog, dark: () => dark };
}

// How far any part of the beast dips below the top of whatever lies under it (castle roofs,
// towers, terrain), ignoring what is within `skip` of point `near` (the hero's hands).
const _v = new THREE.Vector3();
function worstDip(beast, near = null, skip = 260, step = 5) {
  beast.root.updateMatrixWorld(true);
  let worst = -Infinity;
  for (const part of beast.parts) {
    const pos = part.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(part.matrixWorld);
      if (near && _v.distanceTo(near) < skip) continue;
      const d = collision.findFloor(_v.x, 1e5, _v.z).y - _v.y;
      if (d > worst) worst = d;
    }
  }
  return worst;
}

const insideCastle = (x, z, m = 0) => x > CASTLE.x - CASTLE.halfWidth - m && x < CASTLE.x + CASTLE.halfWidth + m && z > CASTLE.backZ - m && z < CASTLE.frontZ + m;

test('the tail\'s glowing coupling lies on the rear roof\'s flat walkway, where Pip can stand and hold it', () => {
  const w = setup();
  w.summon();
  const g = w.beast.grip;
  assert.equal(w.beast.state, 'active');
  assert.ok(g.active, 'grabbable');
  // On the castle's rear block roof (not on a slope, not out over the edge).
  assert.ok(insideCastle(g.standX, g.standZ, -300), 'over the castle');
  assert.ok(g.standY > CASTLE.baseY + CASTLE.mainHeight, `up on a roof (${g.standY})`);
  const f = collision.findFloor(g.standX, g.standY + 50, g.standZ);
  assert.ok(f.surface && f.surface.normal.y > 0.99 && Math.abs(f.y - g.standY) < 1, 'a flat floor under the spot');
  for (let a = 0; a < 8; a++) {
    const x = g.standX + Math.sin(a) * 250;
    const z = g.standZ + Math.cos(a) * 250;
    assert.ok(Math.abs(collision.findFloor(x, g.standY + 50, z).y - g.standY) < 1, 'room to stand all round it');
  }
  // The bar hangs at hand height over the walkway, in front of the spot.
  assert.ok(Math.abs(g.y - (g.standY + TAIL_HANDS.HOLD_UP)) < 30, `bar at ${Math.round(g.y - g.standY)} over the roof`);
  const d = Math.hypot(g.x - g.standX, g.z - g.standZ);
  assert.ok(Math.abs(d - TAIL_HANDS.HOLD_AHEAD) < 25, `bar ${Math.round(d)} in front of the spot`);
  // The real hero stands there without sliding.
  w.player.teleport(g.standX, g.standY, g.standZ, g.standYaw);
  w.player.setAction('idle');
  const x0 = w.player.pos.x;
  const z0 = w.player.pos.z;
  for (let i = 0; i < 90; i++) w.tick();
  assert.equal(w.player.action, 'idle');
  assert.ok(Math.hypot(w.player.pos.x - x0, w.player.pos.z - z0) < 1 && Math.abs(w.player.pos.y - g.standY) < 1, 'he stays put');
});

test('B grabs the coupling only within reach, and only while the beast lies on its perch', () => {
  const w = setup();
  const p = w.player;
  // No beast yet: B at the spot is just a punch.
  const rest = w.beast.restGrip;
  p.teleport(rest.standX, rest.standY, rest.standZ, 0);
  p.setAction('idle');
  w.tick();
  w.tick({ B: true });
  assert.equal(p.action, 'punch');
  w.summon();
  // Too far away: a punch.
  const g = w.beast.grip;
  p.teleport(g.standX + 500, g.standY, g.standZ + 300, g.standYaw);
  p.setAction('idle');
  w.tick();
  w.tick({ B: true });
  assert.equal(p.action, 'punch');
  assert.equal(w.beast.state, 'active');
  for (let i = 0; i < 20; i++) w.tick();
  // Within reach: he grabs it, steps over to hold it and faces it; it knows it is held.
  w.grab();
  assert.equal(p.action, 'tail_hold');
  assert.equal(w.beast.state, 'held');
  assert.equal(w.sfx('tail_grab').length, 1);
  assert.ok(Math.hypot(p.pos.x - g.standX, p.pos.z - g.standZ) < 5, 'at the spot');
  assert.ok(Math.abs(Math.sin(p.faceYaw - g.standYaw)) < 0.1 && Math.cos(p.faceYaw - g.standYaw) > 0, 'facing the coupling');
});

test('held, it struggles and roars but never shoots; Z lets go, and holding on without spinning it tears loose', () => {
  const w = setup();
  w.summon();
  // Pip standing in front of it (in range of its fireballs) is shot at...
  w.player.teleport(0, 160, 3000, Math.PI);
  w.player.setAction('idle');
  const shots0 = w.sfx('fireball_launch').length;
  for (let i = 0; i < 30 * 8; i++) w.tick();
  assert.ok(w.sfx('fireball_launch').length > shots0, 'it shoots at him out front');
  // ...but while held it never shoots (not even with him standing in its sights meanwhile).
  w.grab();
  const shots = w.sfx('fireball_launch').length;
  const roars = w.sfx('kaiju_roar').length;
  for (let i = 0; i < T.TAIL_HOLD_TICKS - 20; i++) w.tick();
  assert.equal(w.beast.state, 'held');
  assert.equal(w.sfx('fireball_launch').length, shots, 'no shots while held');
  assert.ok(w.sfx('kaiju_roar').length > roars, 'it roars as it struggles');
  w.tick({ Z: true });
  assert.equal(w.player.action, 'idle');
  w.tick();
  assert.equal(w.beast.state, 'active');
  // Held again without spinning: it tears its tail loose (a stumble, no damage).
  for (let i = 0; i < 20; i++) w.tick();
  w.grab();
  const health = w.player.health;
  let t = 0;
  while (w.player.action === 'tail_hold' && t++ < T.TAIL_HOLD_TICKS + 10) w.tick();
  assert.ok(t >= T.TAIL_HOLD_TICKS - 12 && w.player.action === 'hurt', `torn loose after ${t} ticks (${w.player.action})`);
  assert.equal(w.player.health, health);
  w.tick();
  assert.equal(w.beast.state, 'active');
});

test('stick circles spin Pip up faster with every turn; the spin hauls the beast up into a whirl round him', () => {
  const w = setup();
  w.summon();
  w.grab();
  const p = w.player;
  const speeds = [];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 12; i++) w.circle();
    speeds.push(p.tailSpeed);
  }
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], `faster each turn: ${speeds.map((s) => s.toFixed(3))}`);
  assert.equal(p.action, 'tail_spin');
  assert.ok(['haul', 'whirl'].includes(w.beast.state));
  assert.ok(w.sfx('boss_haul').length === 1);
  const pos0 = { ...p.pos };
  let t = 0;
  while (w.beast.state !== 'whirl' && t++ < 60) w.circle();
  assert.equal(w.beast.state, 'whirl');
  // Whirling: the coupling in his hands, the body high over him along his facing, a whoosh a
  // turn that rises in pitch with the spin; he never leaves his spot.
  const yaws = [];
  for (let i = 0; i < 90; i++) {
    w.circle();
    yaws.push(p.faceYaw);
  }
  const b = w.beast.bodyPos();
  const bearing = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
  assert.ok(Math.abs(Math.sin(bearing - p.faceYaw)) < 0.25, 'the body swings round along his facing');
  assert.ok(b.y > p.pos.y + 2000, `lifted high over him (${Math.round(b.y - p.pos.y)})`);
  const whooshes = w.sfx('boss_whoosh');
  assert.ok(whooshes.length >= 2, `${whooshes.length} whooshes`);
  assert.ok(whooshes.at(-1).e.pitch >= whooshes[0].e.pitch, 'rising in pitch');
  assert.ok(Math.hypot(p.pos.x - pos0.x, p.pos.z - pos0.z) < 1 && Math.abs(p.pos.y - pos0.y) < 1, 'planted on the roof');
  // The hands and the coupling meet: the grip point of the tail is at his hands.
  w.beast.animate(1, w.objects.tick * (1 / 30), null);
  const hand = w.beast.hand;
  const grip = new THREE.Vector3().copy(w.beast.marks.grip[1]).applyMatrix4(w.beast.tailB.matrixWorld);
  assert.ok(grip.distanceTo(hand) < 1, 'the coupling sits in his hands');
  // The stick stops: the spin winds down, and once too slow he loses his grip (a weak throw).
  const top = p.tailSpeed;
  for (let i = 0; i < 20; i++) w.tick();
  assert.ok(p.tailSpeed < top, 'winding down');
  t = 0;
  while (p.action === 'tail_spin' && t++ < 300) w.tick();
  assert.notEqual(p.action, 'tail_spin');
});

test('a well-spun throw flings it clear of the castle to crash: bossDefeated, the mode ends, and the reward star comes out once', () => {
  const w = setup();
  w.summon();
  w.grab();
  const p = w.player;
  while (w.beast.state !== 'whirl' || p.tailSpeed < GRAB.THROW_MIN + 0.05) w.circle();
  w.circle(12, { B: true });
  assert.equal(p.action, 'tail_throw');
  assert.equal(w.beast.state, 'thrown');
  assert.equal(w.sfx('boss_throw').length, 1);
  assert.equal(w.count('bossThrown'), 1);
  const spot = { ...w.beast.wreckPos };
  assert.ok(!insideCastle(spot.x, spot.z, GRAB.LAND_MARGIN - 1), `lands clear of the castle (${Math.round(spot.x)}, ${Math.round(spot.z)})`);
  const shots = w.sfx('fireball_launch').length;
  let t = 0;
  while (w.beast.state === 'thrown' && t++ < 200) w.tick();
  assert.equal(w.beast.state, 'wrecked');
  assert.equal(w.sfx('fireball_launch').length, shots, 'no shots in the air');
  // The crash: a blast, dust, a scorch, a heavy shake, the defeat; the mode ends.
  assert.equal(w.count('bossDefeated'), 1);
  const impact = w.log.find((l) => l.n === 'bossImpact' && l.e.kind !== 'slam');
  assert.ok(impact && impact.e.strength >= 2, 'a strong camera shake');
  if (!spot.water) {
    assert.ok(w.fxLog.some((c) => c.fn === 'explode' && c.radius >= 800), 'a giant blast');
    assert.ok(w.fxLog.some((c) => c.fn === 'dust' && c.debris > 0 && c.sparks > 0), 'sparks, scrap and dust');
    assert.equal(w.sfx('boss_crash').length, 1);
  } else assert.equal(w.sfx('boss_splash').length, 1);
  assert.equal(w.dark(), false);
  assert.equal(w.objects.modeOn, false);
  assert.equal(w.objects.button.label, 'AI RACE', 'the button pops back up');
  // Pip is back to normal on his roof.
  for (let i = 0; i < 30; i++) w.tick();
  assert.equal(p.action, 'idle');
  // The wreck sinks away; the star rises at the crash site, once.
  const star = w.objects.bossStar.star;
  t = 0;
  while (w.beast.state !== 'hidden' && t++ < 400) w.tick();
  assert.equal(w.beast.state, 'hidden');
  for (let i = 0; i < 70; i++) w.tick();
  assert.equal(star.state, 'idle');
  assert.ok(Math.hypot(star.pos.x - spot.x, star.pos.z - spot.z) < 1, 'at the crash site');
  const stars = p.stars;
  p.teleport(star.pos.x, star.pos.y - 200, star.pos.z, 0);
  p.setAction('freefall');
  for (let i = 0; i < 4; i++) w.tick();
  assert.equal(p.stars, stars + 1, 'collected');
  assert.equal(star.state, 'collected');
  assert.ok(w.log.some((l) => l.n === 'starCollected' && l.e.boss));
  // Beaten again (the button brings back a repaired beast): no second star.
  for (let i = 0; i < 90; i++) w.tick();
  w.summon();
  assert.equal(w.beast.state, 'active');
  assert.ok(w.beast.grip.active, 'grabbable again');
  w.grab();
  while (w.beast.state !== 'whirl' || p.tailSpeed < GRAB.THROW_MIN + 0.05) w.circle();
  w.circle(12, { B: true });
  t = 0;
  while (w.beast.state !== 'hidden' && t++ < 600) w.tick();
  for (let i = 0; i < 70; i++) w.tick();
  assert.equal(w.count('bossDefeated'), 2);
  assert.equal(star.state, 'collected', 'no second star');
  assert.equal(p.stars, stars + 1);
});

test('a weak throw fails: it twists free, slams back onto its perch and knocks Pip back a wedge (onto the roof)', () => {
  const w = setup();
  w.summon();
  w.grab();
  const p = w.player;
  // B with no spin at all, while it lies there.
  w.tick({ B: true });
  assert.equal(p.action, 'hurt');
  assert.equal(p.health, T.MAX_HEALTH - 1);
  assert.equal(w.beast.state, 'active');
  assert.equal(w.sfx('boss_slam').length, 1);
  let t = 0;
  while (!p.grounded && t++ < 60) w.tick();
  for (let i = 0; i < 40; i++) w.tick();
  assert.ok(p.pos.y > 2300 && p.floor.surface, 'still up on the roof');
  // Spun up a little (it is hauled into the air) and let go too soon: it arcs back onto its
  // perch and slams down, and Pip is knocked back again.
  for (let i = 0; i < 80; i++) w.tick(); // (invincibility wears off)
  w.grab();
  let n = 0;
  while (w.beast.state !== 'whirl' && n++ < 200) w.circle(30);
  assert.equal(w.beast.state, 'whirl');
  assert.ok(p.tailSpeed < GRAB.THROW_MIN, `a slow spin (${p.tailSpeed.toFixed(3)})`);
  const hurt = p.health;
  w.circle(30, { B: true });
  assert.equal(w.beast.state, 'fall');
  assert.equal(p.action, 'hurt');
  assert.equal(p.health, hurt - 1);
  t = 0;
  while (w.beast.state === 'fall' && t++ < 100) w.tick();
  assert.equal(w.beast.state, 'active');
  assert.equal(w.sfx('boss_slam').length, 2);
  assert.equal(w.count('bossDefeated'), 0);
  // Back on its perch, as it was.
  w.beast._pose(w.beast.cur, 0);
  w.beast.root.updateMatrixWorld(true);
  assert.ok(Math.abs(w.beast.root.position.y - w.beast.baseY) < 20 && Math.abs(w.beast.root.position.z - w.beast.z) < 20);
  for (let i = 0; i < 60; i++) w.tick();
  assert.ok(p.pos.y > 2300 && p.floor.surface, 'Pip still up on the roof');
});

test('hauled, whirled and flying, no part of it passes through the castle', () => {
  const w = setup();
  w.summon();
  const b = w.beast;
  const rest = worstDip(b);
  w.grab();
  const hand = new THREE.Vector3();
  let worst = -Infinity;
  let n = 0;
  while (b.state !== 'whirl' && n++ < 120) {
    w.circle();
    if (b.state === 'haul') worst = Math.max(worst, worstDip(b, hand.copy(b.hand)));
  }
  // (Torn off the ridge its claws scrape the tiles, but go no deeper than a claw.)
  assert.ok(worst < rest + 40, `haul ${Math.round(worst)} (at rest ${Math.round(rest)})`);
  // The whirl, all round.
  const p = w.player;
  const q = new THREE.Quaternion();
  let whirl = -Infinity;
  for (let a = 0; a < 24; a++) {
    const phi = (a / 24) * Math.PI * 2;
    whirlQuaternion(phi, GRAB.THETA, GRAB.ROLL, q);
    b.fq.copy(q);
    b.fqPrev.copy(q);
    b.hand.set(p.pos.x + Math.sin(phi) * TAIL_HANDS.SPIN_AHEAD, p.pos.y + TAIL_HANDS.SPIN_UP, p.pos.z + Math.cos(phi) * TAIL_HANDS.SPIN_AHEAD);
    b.handPrev.copy(b.hand);
    b._poseFree(b.cur, 0, 1);
    whirl = Math.max(whirl, worstDip(b, b.hand));
  }
  assert.ok(whirl < 0, `whirl dips ${Math.round(whirl)} into the castle`);
  // Throws from several bearings: the flight clears the castle until it comes down on its spot.
  for (const spin of [10, 50, 90]) {
    for (let i = 0; i < spin; i++) w.circle();
    assert.equal(b.state, 'whirl');
    while (p.tailSpeed < GRAB.THROW_MIN + 0.05) w.circle();
    w.circle(12, { B: true });
    assert.equal(b.state, 'thrown');
    let fly = -Infinity;
    const T0 = b.fly.T;
    for (let t = 0; t < T0 - 3; t++) {
      w.tick();
      fly = Math.max(fly, worstDip(b, null, 0, 7));
    }
    assert.ok(fly < 60, `flight dips ${Math.round(fly)}`);
    // (Next round: a fresh beast.)
    let t = 0;
    while (b.state !== 'hidden' && t++ < 400) w.tick();
    for (let i = 0; i < 60; i++) w.tick();
    w.summon();
    w.grab();
    n = 0;
    while (b.state !== 'whirl' && n++ < 120) w.circle();
  }
});

test('a thrown beast\'s camera follows its flight (flightPoint lands exactly on the spot)', () => {
  const f = { x0: 100, y0: 5000, z0: -4000, vx: 40, vy: 150, vz: 90, T: 80, g: 5 };
  const out = { x: 0, y: 0, z: 0 };
  flightPoint(f, 0, out);
  assert.deepEqual([out.x, out.y, out.z], [100, 5000, -4000]);
  flightPoint(f, 80, out);
  assert.ok(Math.abs(out.x - (100 + 40 * 80)) < 1e-6 && Math.abs(out.z - (-4000 + 90 * 80)) < 1e-6);
  assert.ok(Math.abs(out.y - (5000 + 150 * 80 - (5 * 80 * 81) / 2)) < 1e-6);
  // The boss camera: holding on, it rises and backs off behind Pip; whirling, further back
  // and looking up; thrown, it chases the beast and ends looking at the crash site.
  const events = new Events();
  const bc = new BossCam(collision, events);
  const cam = { pos: new THREE.Vector3(0, 2500, -5000), target: new THREE.Vector3(0, 2500, -4000), fov: 45, yaw: Math.PI };
  const hero = { x: 0, y: 2360, z: -4000, action: 'tail_hold' };
  const pose = () => ({ pos: cam.pos.clone(), target: cam.target.clone() });
  let last = null;
  for (let i = 0; i < 40; i++) {
    cam.pos.set(0, 2500, -5000);
    cam.target.set(0, 2500, -4000);
    bc.update(cam, hero);
    last = pose();
  }
  assert.ok(bc.w === 1 && last.pos.y > 2900, 'up over the parapet');
  hero.action = 'tail_spin';
  for (let i = 0; i < 90; i++) {
    cam.pos.set(0, 2500, -5000);
    cam.target.set(0, 2500, -4000);
    bc.update(cam, hero);
  }
  assert.ok(cam.pos.distanceTo(new THREE.Vector3(hero.x, hero.y, hero.z)) > 3500, 'far back');
  assert.ok(cam.target.y > hero.y + 1200 && cam.fov > 55, 'looking up, wide');
  events.emit('bossThrown', { flight: f, to: { x: 3300, y: 100, z: 3200 }, water: false });
  for (let i = 0; i < 100; i++) {
    cam.pos.set(0, 2500, -5000);
    cam.target.set(0, 2500, -4000);
    bc.update(cam, hero);
  }
  assert.ok(cam.target.distanceTo(new THREE.Vector3(3300, 400, 3200)) < 600, 'looking at the crash');
  bc.reset();
  assert.equal(bc.w, 0);
});

test('reset() (game over) takes the beast, the star and the star count back; the next game brings it back grabbable', () => {
  const w = setup();
  w.summon();
  w.grab();
  const p = w.player;
  while (w.beast.state !== 'whirl' || p.tailSpeed < GRAB.THROW_MIN + 0.05) w.circle();
  w.circle(12, { B: true });
  let t = 0;
  while (w.objects.bossStar.star.state !== 'idle' && t++ < 600) w.tick();
  const star = w.objects.bossStar.star;
  p.teleport(star.pos.x, star.pos.y - 200, star.pos.z, 0);
  p.setAction('freefall');
  for (let i = 0; i < 4; i++) w.tick();
  assert.equal(p.stars, 1);
  w.objects.reset();
  assert.equal(p.stars, 0, 'the reward star is taken back');
  assert.equal(star.state, 'hidden');
  assert.equal(w.objects.bossStar.awarded, false);
  assert.equal(w.beast.state, 'hidden');
  assert.equal(w.beast.grip.active, false);
  // Pip holding on when the game ends: he lets go at once.
  w.summon();
  w.grab();
  assert.equal(p.action, 'tail_hold');
  w.objects.reset();
  w.tick();
  w.tick();
  assert.notEqual(p.action, 'tail_hold');
  // The next game: up again on its perch, grabbable, the star to be won again.
  w.events.emit('darkMode', { on: false });
  w.summon();
  assert.equal(w.beast.state, 'active');
  assert.ok(w.beast.grip.active);
  assert.ok(Math.abs(w.beast.grip.standX - w.beast.restGrip.standX) < 120);
});

// The per-tick and per-frame paths keep to the objects' allocation rules (objects.test.js).
test('the tail grab\'s hot paths avoid allocating constructs', () => {
  const hot = {
    update: RobotBeast.prototype.update,
    _updateGrip: RobotBeast.prototype._updateGrip,
    _updateFree: RobotBeast.prototype._updateFree,
    _haulTick: RobotBeast.prototype._haulTick,
    _whirlTick: RobotBeast.prototype._whirlTick,
    _flyTick: RobotBeast.prototype._flyTick,
    _flyQuat: RobotBeast.prototype._flyQuat,
    _spinTurn: RobotBeast.prototype._spinTurn,
    _fallTick: RobotBeast.prototype._fallTick,
    _wreckTick: RobotBeast.prototype._wreckTick,
    _pose: RobotBeast.prototype._pose,
    _poseFree: RobotBeast.prototype._poseFree,
    _poseAt: RobotBeast.prototype._poseAt,
    _hands: RobotBeast.prototype._hands,
    animate: RobotBeast.prototype.animate,
    _glows: RobotBeast.prototype._glows,
    _sparks: RobotBeast.prototype._sparks,
    'BossStar.update': BossStar.prototype.update,
    'BossStar.animate': BossStar.prototype.animate,
    'BossCam.update': BossCam.prototype.update,
  };
  for (const [name, fn] of Object.entries(hot)) {
    const src = fn.toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /new [A-Z]/, `${name} constructs objects`);
  }
});
