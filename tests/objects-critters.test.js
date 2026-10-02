// The Midsummer critters (objects/Critters.js, critters/*.js, critterModel.js) in node: one
// instanced mesh for all of them and a hidden marker mesh, sharing the models' attributes; the
// idle critters (the frogs on their rings, the crab in its tin, the mosquito on its closed-form
// patrol: no collision queries, no sparkles, the same every run and after a reset); engagement
// (its circle on its level, never while he is away), the release and the hop home, a hop in the
// air landed first when it is let go or notices him; the frog's tell (exactly 20 ticks, 26 for a
// calm one, the lock 9 or more before the first damage tick, the yaw locked with the target, the
// orange marker at the target, starting well over his shadow's size at full brightness), one
// wedge a leap, its peak; away and hold (every away action, the water, a blink after a hit, a
// dialog, a warp through ObjectManager; the crab's and the mosquito's tells called off too); the
// token and its gap; defeat by a stomp (bounce(72) off a frog, the default off the others) or an
// attack in every live state, the hero winning a tie (inside a strike too), a frog stomped in the
// air dropping to its floor, the wreath flying up and bursting into gold, one coin after the
// poof, a struck one knocked off the camera's line, the daze's three twinkles; the knock-safe
// rule at a drop and at the water; the leash, the water and the drop for the frog's hops and its
// target (half way, else the windup called off) and the strike window; the lost-life edge and
// reset(); the blob shadows; the three models (triangles, normals, sizes, the crab's planted
// feet, the eyes and flowers clear of what they sit on, each part in its own model's branch of
// the shader); the allocation rules of the hot paths; the Tin Crab (it wakes, sidles into its
// window at both sizes, the tell, the locked lunge, one wedge from its claw, never into deep
// water or off a drop) and the Mosquito (it spots him, parks 220 from him and aims only from
// 200 to 240, never backing off, held in its leash, sliding along a wall; T locked on its first
// aim tick, the needle hurting only low over the floor and only on the marked spot, a punch at
// its tip winning while it dives, stuck in the turf when it misses; the idle whine rare and
// quiet); the fairness tables with the real Player (the frog: still, hit; a sidestep, no hit;
// mashing B, it is struck; a jump, a stomp; the crab at both ends of its window and both sizes;
// the mosquito parked where it aims); the sounds and the shared sound gate; the state
// vocabulary; the bump (at its leash's rim, against a wall, in its windup, off a dying hero;
// the crab and the stuck mosquito pushed aside, never mid-strike; a crab pressed against its rim
// sliding round him a little each tick; a hovering mosquito once his head reaches it); the
// knockback round a critter standing in his way home; the token with a crab and a frog; let go
// mid-strike; the hit shapes; the crab's tell never hidden behind him from the camera; a wading
// crab at the sand bar's depth (its bands over the water hidden, its dented tin floating).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { Events } from '../src/core/events.js';
import { NO_WATER, PLAYER_RADIUS } from '../src/core/constants.js';
import { wrapAngle } from '../src/core/math.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { shadowSize } from '../src/objects/BlobShadows.js';
import { TINT } from '../src/objects/Sparkles.js';
import { Critters, CRITTER, AWAY, STATES, HITTABLE } from '../src/objects/Critters.js';
import { CRITTER_RIG, CRITTER_TRIS, CRITTER_PARTS, MODEL, critterBase, makeCritterMaterial } from '../src/objects/critterModel.js';
import { ACTIONS } from '../src/player/actions/index.js';
import { NO_BOUNCE } from '../src/player/Player.js';
import { CourseBuilder, ScriptedController } from '../src/player/physics/testCourse.js';
import { Player } from '../src/player/Player.js';

const { FROG, CRAB, MOSQUITO, SHARED } = CRITTER;
const SIZE = 30000;
const KIND = ['frog', 'crab', 'mosquito'];
// Every state seen in these tests, per kind (the vocabulary test).
const SEEN = { frog: new Set(), crab: new Set(), mosquito: new Set() };

// Flat floor at y 0; optional: water (surface 50 over a floor at -400) where x > waterFromX, a
// drop { z, side, depth } (the floor `depth` lower past z: where z > it with side 1, where z < it
// with side -1; a face down to it), a tall wall along x = wallX (facing -x), shallow water `wade`
// deep over the whole floor, a ledge { x0, x1, z0, z1, y } (a raised floor, over the water too),
// a pool { x, depth } (water `depth` deep over the same level floor where x > pool.x).
function world({ waterFromX = Infinity, drop = null, wallX = null, wade = 0, ledge = null, pool = null } = {}) {
  const w = new CollisionWorld();
  const tris = (...p) => w.addTriangles(p);
  const floor = (x0, x1, z0, z1, y) => tris(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0);
  const xEdge = Number.isFinite(waterFromX) ? waterFromX : SIZE;
  const [z0, z1] = drop ? (drop.side > 0 ? [-SIZE, drop.z] : [drop.z, SIZE]) : [-SIZE, SIZE];
  floor(-SIZE, xEdge, z0, z1, 0);
  if (Number.isFinite(waterFromX)) {
    floor(waterFromX, SIZE, -SIZE, SIZE, -400);
    tris(waterFromX, -400, SIZE, waterFromX, -400, -SIZE, waterFromX, 0, -SIZE, waterFromX, -400, SIZE, waterFromX, 0, -SIZE, waterFromX, 0, SIZE);
  }
  if (drop) {
    const d = -drop.depth;
    if (drop.side > 0) floor(-SIZE, xEdge, drop.z, SIZE, d);
    else floor(-SIZE, xEdge, -SIZE, drop.z, d);
    // The drop's face, toward the low side.
    const [a, b] = drop.side > 0 ? [-SIZE, xEdge] : [xEdge, -SIZE];
    tris(a, d, drop.z, b, d, drop.z, b, 0, drop.z, a, d, drop.z, b, 0, drop.z, a, 0, drop.z);
  }
  if (wallX !== null) tris(wallX, 0, -SIZE, wallX, 0, SIZE, wallX, 2000, -SIZE, wallX, 0, SIZE, wallX, 2000, SIZE, wallX, 2000, -SIZE);
  if (ledge) floor(ledge.x0, ledge.x1, ledge.z0, ledge.z1, ledge.y);
  w.setWaterLevelFn((x) => (x > waterFromX ? 50 : pool && x > pool.x ? pool.depth : wade > 0 ? wade : NO_WATER));
  w.finalize();
  return w;
}

// Counts the collision queries made through it (reset with .count = 0).
function counting(w) {
  const c = { count: 0 };
  for (const m of ['findFloor', 'findWalls', 'findCeil', 'waterLevelAt', 'raycast']) {
    const fn = w[m].bind(w);
    w[m] = (...a) => {
      c.count++;
      return fn(...a);
    };
  }
  return c;
}

function fakePlayer(x = 0, y = 0, z = 0) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    faceYaw: 0,
    tick: 0,
    invincibleUntil: 0,
    inWater: false,
    floor: { y, surface: {} },
    hits: [],
    bounces: [],
    bounceResult: true,
    attack: null,
    attackReads: 0,
    takeDamage(n, from) {
      if (this.tick < this.invincibleUntil) return false;
      this.hits.push({ n, from: { ...from }, tick: this.tick });
      this.invincibleUntil = this.tick + 60;
      return true;
    },
    getAttack() {
      this.attackReads++;
      return this.attack;
    },
    bounce(vy) {
      this.bounces.push(vy);
      return this.bounceResult;
    },
  };
}

const frogSpot = (over = {}) => ({ id: 'frog', kind: 'frog', x: 0, y: 0, z: 0, yaw: 0, roam: 200, fight: 500, ...over });
const crabSpot = (over = {}) => ({ id: 'crab', kind: 'crab', x: 0, y: 0, z: 0, yaw: 0, roam: 100, fight: 330, ...over });
const mosquitoSpot = (over = {}) => ({ id: 'mosquito', kind: 'mosquito', x: 0, y: 0, z: 0, yaw: 0, roam: 160, fight: 400, ...over });

// A crew of critters on its own: step() ticks them with the given hero (and his remembered
// last tick, as ObjectManager keeps it) and the camera's yaw set by setCam(yaw) (null: none);
// `sfx` logs every sound with the life tick and the first record's state and tick at that
// moment; `coins` the coins they dropped.
function crew(spots, { collision = world(), sparkles = null, events = new Events() } = {}) {
  const sfx = [];
  const coins = [];
  let critters = null;
  events.on('sfx', (e) => {
    const c = critters.list[0];
    sfx.push({ ...e, life: critters.life, state: c.state, t: c.t });
  });
  critters = new Critters({ spots, collision, events, sparkles, onCoin: (x, y, z, minY) => coins.push({ x, y, z, minY, life: critters.life }) });
  let tick = 0;
  let cam = null;
  const hero = { y: 0, vy: 0, air: false };
  const step = (player, n = 1, hold = false) => {
    for (let i = 0; i < n; i++) {
      player.tick++;
      critters.update(player, hero, ++tick, hold, cam);
      for (const c of critters.list) SEEN[KIND[c.kind]].add(c.state);
      critters.animate(1, tick / 30);
      hero.y = player.pos.y;
      hero.vy = player.vel.y;
      hero.air = player.pos.y > player.floor.y + 1;
    }
  };
  // Ticks until pred() (at most n); returns how many ran.
  const until = (player, pred, n = 600, hold = false) => {
    let i = 0;
    while (i < n && !pred()) {
      step(player, 1, hold);
      i++;
    }
    return i;
  };
  const setCam = (yaw) => (cam = yaw);
  return { critters, sfx, coins, step, until, hero, collision, events, setCam };
}

const dist = (c, p) => Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
const ring0 = (c) => ({ x: c.hopX[0], z: c.hopZ[0] });

// A frog crew with the hero standing still `d` in front of ring point 0 (the frog notices him,
// then winds up at once: he is in its window); `collision` and `sparkles` go to the crew, the
// rest to the spot.
function facing(d, { collision = world(), sparkles = null, ...over } = {}) {
  const spot = frogSpot({ yaw: Math.PI, z: d + 120, ...over });
  const k = crew([spot], { collision, sparkles });
  const player = fakePlayer(0, 0, 0);
  return { ...k, player, frog: k.critters.list[0] };
}

// The size across of marker instance 0 as drawn at `alpha` (and its colour as shown, sRGB).
const _mm = new THREE.Matrix4();
function markerSize(critters, alpha, clock) {
  critters.animate(alpha, clock);
  return new THREE.Vector3().setFromMatrixScale(critters.markers.getMatrixAt(0, _mm)).x;
}

test('construction: one instanced mesh for every critter and a hidden marker mesh, its own program; the models shared between managers; unknown kinds throw; a crab wakes within 15 ticks of him coming into its circle, a mosquito (hovering 150 over its home) spots him within 9', () => {
  const k = crew([frogSpot(), frogSpot({ id: 'b', x: 2000 })]);
  const { critters } = k;
  const mesh = critters.mesh;
  assert.ok(mesh.isInstancedMesh);
  assert.equal(mesh.name, 'critters');
  assert.equal(mesh.count, 2, 'both drawn, at home');
  assert.equal(mesh.frustumCulled, false);
  assert.equal(critters.markers.name, 'critterMarkers');
  assert.ok(critters.markers.isInstancedMesh);
  assert.equal(critters.markers.visible, false);
  assert.equal(critters.markers.count, 0);
  assert.equal(mesh.material.customProgramCacheKey(), 'skerryCritters');
  assert.equal(critters.alive, 2);
  for (const c of critters.list) assert.equal(c.state, 'idle');
  // animate() works before any update (the constructor ran it; again here).
  critters.animate(0.5, 0);
  assert.equal(mesh.count, 2);
  // A second manager shares the models' attributes, not the per-instance channels.
  const k2 = crew([frogSpot()]);
  const g1 = mesh.geometry;
  const g2 = k2.critters.mesh.geometry;
  assert.notEqual(g1, g2);
  assert.equal(g1.attributes.position.array, g2.attributes.position.array);
  assert.equal(g1.attributes.position, critterBase().position);
  assert.notEqual(g1.attributes.aAnim, g2.attributes.aAnim);
  assert.notEqual(g1.attributes.aAnim2.array, g2.attributes.aAnim2.array);
  assert.throws(() => crew([{ ...frogSpot(), kind: 'goblin' }]), /unknown kind/);
  // A crab and a mosquito: calm with him away, drawn; he steps into their circles.
  const both = crew([crabSpot(), mosquitoSpot({ x: 3000 })]);
  const [crab, mosquito] = both.critters.list;
  assert.deepEqual([crab.state, mosquito.state], ['hidden', 'patrol']);
  assert.equal(both.critters.mesh.count, 2, 'both drawn');
  assert.equal(mosquito.y, MOSQUITO.HOVER, 'the mosquito hovers over its home');
  const p = fakePlayer(0, 0, 3000);
  both.step(p, 30);
  assert.equal(both.critters.engaged, 0);
  p.pos.z = 300;
  assert.ok(both.until(p, () => crab.state === 'wake', 30) <= 15, 'the crab wakes');
  const q = fakePlayer(3000, 0, 3000);
  both.step(q, 30);
  q.pos.z = 380;
  assert.ok(both.until(q, () => mosquito.state === 'spot', 30) <= 9, 'the mosquito spots him');
});

test('idle: far from him the frogs hop round their rings (ring point k along yaw0 + k * 60 degrees, 0.6 roam out; points by a wall dropped, the rest in order), the crab sits in its tin and the mosquito flies its patrol (the closed form on the life counter), with no collision queries, no sparkles; two crews run the same, a reset crew replays a fresh one', () => {
  const collision = world({ wallX: 150 });
  const q = counting(collision);
  const throwing = { twinkle: () => assert.fail('no sparkles'), clods: () => assert.fail('no sparkles'), burst: () => assert.fail('no sparkles') };
  const spots = [frogSpot({ id: 'free', x: -3000, yaw: 0.4 }), frogSpot({ id: 'walled', x: 0, yaw: 0 }), crabSpot({ x: 3000 }), mosquitoSpot({ x: -1500, z: -3000, roam: 140 })];
  const k = crew(spots, { collision, sparkles: throwing });
  const [free, walled, tin, buzz] = k.critters.list;
  // Ring points: free keeps all six; by the wall (x 150 facing -x) the points at 60 and 120
  // degrees (x 104) are within 60 of it and dropped.
  const R = FROG.RING * 200;
  assert.equal(free.hopN, 6);
  for (let i = 0; i < 6; i++) {
    const a = 0.4 + (i * Math.PI) / 3;
    assert.ok(Math.abs(free.hopX[i] - (-3000 + Math.sin(a) * R)) < 1e-6 && Math.abs(free.hopZ[i] - Math.cos(a) * R) < 1e-6, `point ${i}`);
  }
  assert.equal(walled.hopN, 4);
  const kept = [0, 3, 4, 5];
  kept.forEach((k0, i) => {
    const a = (k0 * Math.PI) / 3;
    assert.ok(Math.abs(walled.hopX[i] - Math.sin(a) * R) < 1e-6 && Math.abs(walled.hopZ[i] - Math.cos(a) * R) < 1e-6, `kept point ${k0} at ${i}`);
  });
  q.count = 0;
  const player = fakePlayer(-1500, 0, 3000);
  const trace = [];
  let hops = 0;
  for (let t = 0; t < 1800; t++) {
    k.step(player);
    // The crab in its tin at home; the mosquito on its patrol curve at the life counter now.
    assert.ok(tin.state === 'hidden' && tin.x === tin.hx && tin.z === tin.hz && tin.y === tin.hy, `the crab at home (${tin.state})`);
    const L = k.critters.life;
    const sway = 140 / MOSQUITO.SWAY_X;
    assert.equal(buzz.state, 'patrol');
    assert.ok(Math.abs(buzz.x - (buzz.hx + MOSQUITO.SWAY_X * sway * Math.sin(MOSQUITO.SWAY_RATE * L + buzz.seed))) < 1e-9, `patrol x at ${L}`);
    assert.ok(Math.abs(buzz.z - (buzz.hz + MOSQUITO.SWAY_Z * sway * Math.sin(2 * MOSQUITO.SWAY_RATE * L + buzz.seed))) < 1e-9, `patrol z at ${L}`);
    assert.ok(Math.abs(buzz.y - (buzz.hy + MOSQUITO.HOVER + MOSQUITO.BOB * Math.sin(MOSQUITO.BOB_RATE * L))) < 1e-9, `patrol y at ${L}`);
    for (const c of k.critters.list) {
      if (c.kind !== MODEL.FROG) continue;
      if (c.n === 0) {
        let on = false;
        for (let i = 0; i < c.hopN; i++) if (Math.abs(c.x - c.hopX[i]) < 1e-6 && Math.abs(c.z - c.hopZ[i]) < 1e-6 && Math.abs(c.y - c.hopY[i]) < 1e-6) on = true;
        assert.ok(on, `${c.id} on a ring point at tick ${t}`);
      } else if (c.n === 1) hops++;
    }
    trace.push(k.critters.list.map((c) => `${c.state}${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.b0},${c.a1.toFixed(4)}`).join('|'));
  }
  assert.ok(hops >= 30, `${hops} hops round the rings`);
  assert.equal(k.critters.engaged, 0);
  assert.equal(k.critters.hits, 0);
  assert.equal(q.count, 0, 'no collision queries while idle');
  assert.deepEqual(k.sfx, [], 'no idle calls with him this far');
  // The same again, from another crew; and after a reset.
  const k2 = crew(spots, { collision: world({ wallX: 150 }) });
  const p2 = fakePlayer(-1500, 0, 3000);
  for (let t = 0; t < 1800; t++) {
    k2.step(p2);
    assert.equal(k2.critters.list.map((c) => `${c.state}${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.b0},${c.a1.toFixed(4)}`).join('|'), trace[t], `tick ${t}`);
  }
  k.critters.reset();
  const p3 = fakePlayer(-1500, 0, 3000);
  for (let t = 0; t < 600; t++) {
    k.step(p3);
    assert.equal(k.critters.list.map((c) => `${c.state}${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.b0},${c.a1.toFixed(4)}`).join('|'), trace[t], `after reset, tick ${t}`);
  }
});

test('engagement: he is ignored just outside its circle and noticed at once inside it; never off its level, swimming, reading, on a pole or while held; let go 20 ticks after he leaves fight + 80, it hops home; let go or noticing him in the air, it lands its hop first', () => {
  const near = (d) => {
    const k = crew([frogSpot()]);
    const p = fakePlayer(0, 0, d);
    return { k, p, c: k.critters.list[0] };
  };
  {
    const { k, p, c } = near(510);
    k.step(p, 600);
    assert.ok(STATES.frog[c.state] === 'C', `ignored: ${c.state}`);
    assert.equal(k.critters.engaged, 0);
  }
  {
    const { k, p, c } = near(490);
    const n = k.until(p, () => c.state !== 'idle', 30);
    assert.ok(n <= 13 && c.state === 'notice', `noticed after ${n}`);
    assert.equal(k.critters.engaged, 1);
  }
  const never = [
    ['off its level', (p) => ((p.pos.y = 70), (p.floor = { y: 70, surface: {} }))],
    ['swimming', (p) => ((p.inWater = true), (p.action = 'swim_idle'))],
    ['in the water', (p) => (p.inWater = true)],
    ['reading', (p) => (p.action = 'reading')],
    ['on a pole', (p) => (p.action = 'pole')],
  ];
  for (const [what, set] of never) {
    const { k, p } = near(300);
    set(p);
    k.step(p, 300);
    assert.equal(k.critters.engaged, 0, what);
  }
  {
    const { k, p } = near(300);
    k.step(p, 300, true);
    assert.equal(k.critters.engaged, 0, 'held');
  }
  // Released 20 ticks after he leaves fight + 80, then home to ring point 0 and idle.
  const { k, p, c } = near(450);
  k.until(p, () => c.state === 'approach', 40);
  p.pos.z = 700;
  const n = k.until(p, () => c.state === 'return', 60);
  assert.equal(n, SHARED.RELEASE, `let go after ${n}`);
  k.until(p, () => c.state === 'idle', 400);
  assert.equal(c.state, 'idle');
  assert.ok(Math.hypot(c.x - c.hopX[0], c.z - c.hopZ[0]) < FROG.HOME_NEAR, 'back on ring point 0');
  // In the air on an approach hop when the release falls due (he leaves at every tick of a 40
  // tick span), or on an idle hop when it notices him (he steps in at every tick of 160): it
  // never drops faster than its hop falls (an approach hop at most 14.85 a tick, an idle one
  // 10.8; its leap, a strike, aside), and it is let go only once it has landed.
  const g = FROG.GRAVITY;
  let waited = 0;
  for (let delay = 0; delay < 40; delay++) {
    const { k, p, c } = near(450);
    let worst = 0;
    let due = false;
    k.until(p, () => c.n > 0, 80);
    k.step(p, delay);
    p.pos.z = 700;
    for (let t = 0; t < 120 && c.state !== 'return'; t++) {
      const y0 = c.y;
      const leaping = c.state === 'leap';
      k.step(p);
      if (!leaping) worst = Math.max(worst, y0 - c.y);
      if (c.state !== 'return' && c.outFor >= SHARED.RELEASE) due = true;
      if (c.state === 'return') assert.ok(c.n === 0 && Math.abs(c.y - c.floorY) < 1e-9, `let go in the air (delay ${delay})`);
    }
    assert.equal(c.state, 'return', `let go (delay ${delay})`);
    assert.ok(worst <= g * (FROG.HOP - 1) / 2 + 1e-6, `dropped ${worst.toFixed(1)} in a tick (delay ${delay})`);
    if (due) waited++;
  }
  assert.ok(waited >= 5, `${waited} releases fell due in the air`);
  let airNotices = 0;
  for (let at = 40; at < 200; at++) {
    const { k, p, c } = near(3000);
    let worst = 0;
    for (let t = 0; t < at + 20; t++) {
      if (t === at) p.pos.z = 450;
      const y0 = c.y;
      const was = c.state;
      const air = c.n > 0;
      k.step(p);
      worst = Math.max(worst, y0 - c.y);
      if (was === 'idle' && c.state === 'notice' && air) airNotices++;
    }
    assert.ok(worst <= g * (FROG.IDLE_HOP - 1) / 2 + 1e-6, `dropped ${worst.toFixed(1)} in a tick (in at ${at})`);
  }
  assert.ok(airNotices >= 5, `${airNotices} notices in the air`);
});

// A frog's whole strike at a hero standing still `d` from it: the ticks of its windup start,
// its leap's start, its lock and landing, his hits (with the frog's leap tick), the marker's
// position, size (drawn at the tick's start and its end) and colour each tick, and its yaw from
// the lock to the landing. `move(player, t)` moves him from the lock on; without `blink` he has
// no blink after a hit (only the strike's own rule stops a second wedge).
function strike(d, { calm = 1, move = null, blink = true } = {}) {
  const s = facing(d, { calm });
  const { critters, step, player, frog } = s;
  const out = { windup: -1, leap: -1, lock: -1, land: -1, hits: [], marks: [], sizes: [], colors: [], yaws: [], peak: 0 };
  for (let t = 0; t < 160 && out.land < 0; t++) {
    if (move && out.lock >= 0) move(player, t);
    if (!blink) player.invincibleUntil = 0;
    const was = frog.state;
    const hitsBefore = player.hits.length;
    step(player);
    if (frog.state === 'windup' && was !== 'windup') out.windup = t;
    if (frog.state === 'leap' && was !== 'leap') out.leap = t;
    if (frog.markOn === 1 && out.lock < 0) out.lock = t;
    for (let h = hitsBefore; h < player.hits.length; h++) out.hits.push({ t, leapT: frog.state === 'leap' ? frog.t : was === 'leap' ? FROG.LEAP : -1, from: player.hits[h].from });
    if (frog.state === 'leap') out.peak = Math.max(out.peak, frog.y - frog.floorY);
    if (out.lock >= 0 && out.land < 0 && frog.state !== 'dazed') out.yaws.push(frog.yaw);
    const m = critters.markers;
    if (m.count > 0) {
      out.marks.push(new THREE.Vector3().setFromMatrixPosition(m.getMatrixAt(0, _mm)));
      out.sizes.push([markerSize(critters, 0, t / 30), markerSize(critters, 1, t / 30)]);
      out.colors.push(m.getColorAt(0, new THREE.Color()).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace));
    } else {
      out.marks.push(null);
      out.sizes.push(null);
      out.colors.push(null);
    }
    if (was === 'leap' && frog.state === 'dazed') out.land = t;
  }
  return { ...s, out };
}

test('the tell: exactly 20 ticks (26 for a calm frog) from the windup to the leap, the lock at 14 (18) with the yaw, the first damage at least 15 ticks into the leap and 9 after the lock; the orange marker at the target from the lock to the landing, at full brightness and well over his shadow\'s size as it shows, never shrinking from the last strike\'s; one wedge a leap, from the frog; still he is hit, walking sideways from the lock he is not and its yaw stays locked; its peak 135', () => {
  for (const calm of [1, 1.3]) {
    const { out, frog, player } = strike(240, { calm });
    assert.ok(out.windup >= 0 && out.lock > out.windup && out.land > out.lock, JSON.stringify({ ...out, marks: null, sizes: null, colors: null, yaws: null }));
    assert.equal(out.leap - out.windup, Math.round(FROG.WINDUP * calm), 'the tell\'s length');
    assert.equal(out.lock - out.windup, Math.round(FROG.LOCK * calm), 'the lock');
    assert.equal(out.hits.length, 1, 'one wedge');
    const first = out.hits[0].t;
    assert.ok(first - out.leap >= FROG.HURT_FROM, `first damage ${first - out.leap} into the leap`);
    assert.ok(out.lock <= first - 9, `lock ${out.lock}, damage ${first}`);
    assert.ok(out.hits[0].leapT >= FROG.HURT_FROM, `leap tick ${out.hits[0].leapT}`);
    assert.equal(player.hits[0].n, 1);
    // From the frog (open floor: the natural knockback), at the moment of the hit.
    const f = out.hits[0].from;
    assert.ok(Math.hypot(f.x - player.pos.x, f.z - player.pos.z) < 95, 'from the frog');
    // The yaw locked with the target, toward it.
    assert.ok(out.yaws.every((y) => y === out.yaws[0]), 'yaw locked');
    assert.equal(frog.lockYaw, out.yaws[0]);
    // The marker: at T (his feet at the lock) from the lock to the landing, else hidden.
    out.marks.forEach((m, t) => {
      if (t >= out.lock && t < out.land) assert.ok(m && Math.abs(m.x - frog.tx) < 1e-6 && Math.abs(m.z - frog.tz) < 1e-6 && Math.abs(m.y - 3) < 1e-6, `marker at tick ${t}`);
      else assert.equal(m, null, `no marker at tick ${t}`);
    });
    assert.ok(Math.hypot(frog.tx - 0, frog.tz - 0) < 1, 'T at his feet');
    // MARK_FROM across as it shows (well over his shadow), growing to about MARK_TO by the
    // landing; a bright orange as shown through all its pulse (sRGB: dimmed further, or the
    // plan's linear orange, it turns brown on the meadow), at its brightest, unpulsed, as it
    // shows.
    assert.deepEqual(out.sizes[out.lock].map((v) => +v.toFixed(6)), [FROG.MARK_FROM, FROG.MARK_FROM]);
    assert.ok(FROG.MARK_FROM >= 100, 'well over his shadow');
    assert.ok(Math.abs(out.sizes[out.land - 1][1] - FROG.MARK_TO) < 4, `${out.sizes[out.land - 1][1]} at the end`);
    for (let t = out.lock; t < out.land; t++) {
      const { r, g, b } = out.colors[t];
      assert.ok(r >= 0.69 && r - g >= 0.38 && b <= 0.15, `marker colour ${JSON.stringify(out.colors[t])}`);
      if (t < out.lock + 6) assert.deepEqual([r, g, b].map((v) => +v.toFixed(3)), [1, 0.45, 0.08], `full brightness at ${t - out.lock} after the lock`);
    }
    assert.ok(Math.abs(out.peak - 135) <= 2, `peak ${out.peak}`);
  }
  // Walking sideways at 8 a tick from the lock: no hit; its yaw stays as locked to the landing
  // although he is no longer where it faces.
  const side = strike(240, { move: (p) => (p.pos.x += 8) });
  assert.equal(side.out.hits.length, 0, 'sidestepped');
  assert.ok(side.out.land > 0);
  assert.ok(side.out.yaws.length >= FROG.WINDUP - FROG.LOCK + FROG.LEAP - 1 && side.out.yaws.every((y) => y === side.frog.lockYaw), 'yaw locked');
  const toHim = Math.atan2(side.player.pos.x - side.frog.x, side.player.pos.z - side.frog.z);
  assert.ok(Math.abs(wrapAngle(toHim - side.frog.lockYaw)) > 0.3, 'he moved off its line');
  // One wedge a leap by its own rule (his blink after a hit taken away).
  const once = strike(240, { blink: false });
  assert.equal(once.out.hits.length, 1, `${once.out.hits.length} wedges in one leap`);
  // Strike after strike, each ring shows at MARK_FROM (not shrinking from the last one's size).
  {
    const s = facing(240);
    let locks = 0;
    for (let t = 0; t < 700 && locks < 3; t++) {
      const was = s.frog.markOn;
      s.step(s.player);
      if (s.frog.markOn === 1 && was === 0) {
        locks++;
        assert.ok(Math.abs(markerSize(s.critters, 0, t / 30) - FROG.MARK_FROM) < 1e-6, `lock ${locks}: drawn at MARK_FROM`);
      }
    }
    assert.equal(locks, 3);
  }
});

test('away and hold: AWAY is exactly where bounce() refuses plus the cannon shot; while he is away (each action, in the water, blinking after a hit, a dialog) no windup starts, a running one is called off (token back, cooldown 30), a strike in flight does no damage; a warp holds them through ObjectManager', () => {
  const groups = Object.entries(ACTIONS)
    .filter(([, a]) => a.group === 'automatic' || a.group === 'submerged')
    .map(([n]) => n);
  const want = new Set([...groups, ...NO_BOUNCE, 'cannon_shot']);
  assert.deepEqual(new Set(Object.keys(AWAY)), want);
  assert.equal(Object.keys(AWAY).length, 19);
  for (const v of Object.values(AWAY)) assert.equal(v, 1);
  const conditions = [
    ...Object.keys(AWAY).map((a) => [a, (p) => (p.action = a), false]),
    ['in the water', (p) => (p.inWater = true), false],
    ['blinking', (p) => (p.invincibleUntil = p.tick + 10000), false],
    ['a dialog', () => {}, true],
  ];
  for (const [what, set, hold] of conditions) {
    // No windup starts.
    {
      const s = facing(240);
      set(s.player);
      s.step(s.player, 120, hold);
      assert.ok(s.frog.state !== 'windup' && s.frog.state !== 'leap', `${what}: no windup (${s.frog.state})`);
      assert.equal(s.critters.attacker, -1);
    }
    // A running windup is called off.
    {
      const s = facing(240);
      s.until(s.player, () => s.frog.state === 'windup', 60);
      s.step(s.player, 3);
      assert.equal(s.critters.attacker, 0, 'the token taken');
      set(s.player);
      s.step(s.player, 1, hold);
      assert.notEqual(s.frog.state, 'windup', `${what}: windup called off`);
      assert.equal(s.critters.attacker, -1, `${what}: token back`);
      // (Dropping in again after a lost life sends it home instead.)
      if (what !== 'spawn') assert.ok(s.frog.cooldown >= FROG.CANCEL_COOLDOWN - 1, `${what}: cooldown ${s.frog.cooldown}`);
      assert.equal(s.frog.markOn, 0);
    }
    // A strike in flight does no damage.
    {
      const s = facing(240);
      s.until(s.player, () => s.frog.state === 'leap', 80);
      set(s.player);
      s.until(s.player, () => s.frog.state === 'dazed', 40, hold);
      assert.equal(s.player.hits.length, 0, `${what}: no damage`);
      assert.equal(s.critters.hits, 0);
    }
  }
  // A warp: ObjectManager's update({ warping: true }) holds the critters; without it they go.
  const events = new Events();
  const player = fakePlayer(0, 0, 360);
  player.collectCoin = () => {};
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: world(), events, layout: { CRITTERS: [frogSpot({ yaw: 0 })], groundHeight: () => 0 }, player });
  const frog = om.critters.list[0];
  for (let t = 0; t < 200; t++) {
    player.tick++;
    om.update({ player, warping: true });
    assert.equal(STATES.frog[frog.state], 'C', 'held by the warp');
  }
  assert.equal(player.hits.length, 0);
  player.tick++;
  om.update({ player });
  assert.equal(frog.state, 'notice', 'the warp over: it notices him');
});

test('the token: two frogs on him never wind up at once; a strike ends and the next windup waits at least 40 ticks', () => {
  const k = crew([frogSpot({ id: 'a', x: -150, z: 400 }), frogSpot({ id: 'b', x: 150, z: 400, yaw: Math.PI })]);
  const p = fakePlayer(0, 0, 0);
  let striking = 0;
  const ends = [];
  const starts = [];
  for (let t = 0; t < 1500; t++) {
    const before = k.critters.list.map((c) => c.state);
    k.step(p);
    // He sidesteps back and forth (never hit, so it goes on).
    p.pos.x = 300 * Math.sin(t / 25);
    p.invincibleUntil = 0;
    p.hits.length = 0;
    const now = k.critters.list.map((c) => c.state);
    const n = now.filter((s) => s === 'windup' || s === 'leap').length;
    assert.ok(n <= 1, `tick ${t}: ${now}`);
    now.forEach((s, i) => {
      if (s === 'windup' && before[i] !== 'windup') starts.push(t);
      if ((before[i] === 'leap' && s !== 'leap') || (before[i] === 'windup' && s !== 'windup' && s !== 'leap')) ends.push(t);
    });
    if (n) striking++;
  }
  assert.ok(starts.length >= 6, `${starts.length} windups`);
  for (const s of starts) {
    const prev = ends.filter((e) => e < s).at(-1);
    if (prev !== undefined) assert.ok(s - prev >= SHARED.GAP, `windup at ${s}, ${s - prev} after a strike ended`);
  }
  assert.ok(striking > 0);
});

test('defeat: a stomp bounces him (72) and squashes it, a refused bounce does not; an attack defeats it in every live state; he wins a tie with its strike; landing on it knocked back is no stomp; one coin after the poof, where it was; his attack read once a tick', () => {
  // A stomp: falling onto its head.
  const stomp = (result, action = 'freefall') => {
    const k = crew([frogSpot()]);
    const c = k.critters.list[0];
    const p = fakePlayer(c.x + 20, c.y + FROG_TOP - 5, c.z);
    p.action = action;
    p.bounceResult = result;
    p.vel.y = -12;
    p.floor = { y: 0, surface: {} };
    Object.assign(k.hero, { y: c.y + FROG_TOP + 10, vy: -12, air: true });
    p.tick++;
    k.critters.update(p, k.hero, 1);
    return { k, c, p };
  };
  const FROG_TOP = CRITTER_RIG.frog.TOP;
  {
    const { c, p } = stomp(true);
    assert.deepEqual(p.bounces, [FROG.BOUNCE], 'bounce(72) once');
    assert.equal(c.state, 'squash');
  }
  {
    const { c, p } = stomp(false);
    assert.deepEqual(p.bounces, [FROG.BOUNCE]);
    assert.notEqual(c.state, 'squash', 'refused: no defeat');
  }
  {
    const { c, p } = stomp(true, 'hurt');
    assert.deepEqual(p.bounces, [], 'knocked back onto it: no stomp');
    assert.notEqual(c.state, 'squash');
  }
  // An attack in every live state.
  const drive = {
    idle: (s) => s,
    notice: (s) => s.until(s.player, () => s.frog.state === 'notice', 5),
    approach: (s) => s.until(s.player, () => s.frog.state === 'approach', 20),
    windup: (s) => s.until(s.player, () => s.frog.state === 'windup', 60),
    leap: (s) => s.until(s.player, () => s.frog.state === 'leap' && s.frog.t > 5, 90),
    dazed: (s) => s.until(s.player, () => s.frog.state === 'dazed', 120),
    cooldown: (s) => s.until(s.player, () => s.frog.state === 'cooldown', 180),
    return: (s) => {
      s.until(s.player, () => s.frog.state === 'approach', 20);
      s.player.pos.z = -1200;
      s.until(s.player, () => s.frog.state === 'return', 40);
    },
  };
  for (const state of Object.keys(STATES.frog).filter((st) => HITTABLE[st] === 1)) {
    const s = facing(240);
    if (state === 'idle') s.player.pos.z = -2000;
    drive[state](s);
    assert.equal(s.frog.state, state, `drove it to ${state}`);
    const f = s.frog;
    s.player.attack = { x: f.x, y: f.y + 30, z: f.z, radius: 40, kind: 'punch1' };
    s.step(s.player);
    assert.equal(s.frog.state, 'tumble', `struck while ${state}`);
  }
  // A tie: his punch on the tick its leap would first hurt him wins.
  {
    const s = facing(240);
    s.until(s.player, () => s.frog.state === 'leap' && s.frog.t === FROG.HURT_FROM - 1, 90);
    const f = s.frog;
    s.player.attack = { x: f.x + f.vx, y: f.y + 40, z: f.z + f.vz, radius: 55, kind: 'punch1' };
    s.step(s.player);
    assert.equal(s.frog.state, 'tumble');
    assert.equal(s.player.hits.length, 0, 'he wins the tie');
  }
  // One coin, after the poof, at the frog.
  {
    const s = facing(240);
    s.step(s.player, 3);
    const f = s.frog;
    s.player.attack = { x: f.x, y: f.y + 30, z: f.z, radius: 40, kind: 'kick' };
    s.step(s.player);
    s.player.attack = null;
    const at = s.critters.life;
    s.step(s.player, 60);
    assert.equal(s.coins.length, 1);
    assert.equal(s.coins[0].life, at + FROG.TUMBLE + SHARED.POOF);
    assert.equal(f.state, 'gone');
    assert.ok(Math.abs(s.coins[0].x - f.x) < 1e-9 && Math.abs(s.coins[0].z - f.z) < 1e-9, 'where it was');
    assert.equal(s.coins[0].minY, -Infinity);
    assert.equal(s.critters.mesh.count, 0, 'gone: not drawn');
    // A stomp's coin: squash + poof.
    const t = stomp(true);
    t.k.step(t.p, 40);
    assert.equal(t.k.coins.length, 1);
    assert.equal(t.k.coins[0].life, 1 + FROG.SQUASH + SHARED.POOF);
  }
  // His attack read once a tick, however many critters.
  const k = crew([frogSpot(), frogSpot({ id: 'b', x: 1500 }), frogSpot({ id: 'c', x: -1500 })]);
  const p = fakePlayer(0, 0, 3000);
  k.step(p, 50);
  assert.equal(p.attackReads, 50);
});

test('a defeat that shows: stomped in the air it drops to its floor as it flattens (never snapped down); the wreath flies up through the poof and bursts into gold sparkles WREATH_RISE up as the coin appears; struck straight away from the camera it tumbles off the camera\'s line, its arc peaking about 80 up; dazed, three white twinkles circle its head every 12 ticks', () => {
  const FROG_TOP = CRITTER_RIG.frog.TOP;
  const sparks = [];
  const sparkles = {
    burst: (p, t0, tint, n) => sparks.push({ kind: 'burst', x: p.x, y: p.y, z: p.z, tint, n }),
    clods: () => {},
    twinkle: (p, r, t0, tint) => sparks.push({ kind: 'twinkle', x: p.x, y: p.y, z: p.z, r, tint }),
  };
  // Stomped at the top of its leap (135 up).
  {
    const s = facing(240, { sparkles });
    s.until(s.player, () => s.frog.state === 'leap' && s.frog.t === 10, 90);
    const f = s.frog;
    const high = f.y - f.floorY;
    assert.ok(high > 120, `${high} up`);
    Object.assign(s.player.pos, { x: f.x, y: f.y + FROG_TOP - 5, z: f.z });
    s.player.vel.y = -12;
    s.player.action = 'freefall';
    s.player.floor = { y: f.floorY - 2000, surface: {} };
    Object.assign(s.hero, { y: f.y + FROG_TOP + 10, vy: -12, air: true });
    sparks.length = 0;
    const y0 = f.y;
    s.step(s.player);
    assert.equal(f.state, 'squash');
    assert.equal(f.y, y0, 'not snapped down');
    s.player.pos.y += 2000; // (gone up off its bounce)
    let worst = 0;
    let t = 0;
    let burstAt = -1;
    let poofAt = -1;
    for (; t < 60 && f.state !== 'gone'; t++) {
      const y = f.y;
      const n = sparks.length;
      s.step(s.player);
      if (f.state === 'squash' || (f.state === 'poof' && poofAt < 0)) worst = Math.max(worst, y - f.y);
      if (f.state === 'poof' && poofAt < 0) {
        poofAt = t + 1;
        assert.ok(Math.abs(f.y - f.floorY) < 1e-9, 'the poof once on its floor');
      }
      for (let i = n; i < sparks.length; i++) if (sparks[i].kind === 'burst') burstAt = t + 1;
    }
    assert.ok(poofAt > FROG.SQUASH, `the poof at ${poofAt} (it fell first)`);
    assert.ok(worst < 30, `dropped ${worst.toFixed(1)} in a tick`);
    // The wreath: lifting for LIFT ticks from the stomp, through the poof, then the gold burst
    // (a stomp in the air lands later, so its coin comes after the burst).
    assert.equal(f.state, 'gone');
    assert.equal(f.b1, 1, 'the wreath flew all the way');
    assert.equal(burstAt, FROG.LIFT, 'it burst LIFT ticks after the stomp');
    const b = sparks.find((e) => e.kind === 'burst');
    assert.deepEqual(b.tint, TINT.coin);
    assert.ok(b.y - f.floorY >= CRITTER_RIG.frog.WREATH_RISE && Math.hypot(b.x - f.x, b.z - f.z) < 1e-6, `burst ${b.y - f.floorY} over it`);
  }
  // A stomp on the floor (on it at once, idle at home): the burst and the coin together, LIFT
  // ticks after it.
  {
    const s = facing(240, { sparkles });
    const f = s.frog;
    Object.assign(s.player.pos, { x: f.x + 20, y: f.y + FROG_TOP - 5, z: f.z });
    s.player.vel.y = -12;
    s.player.action = 'freefall';
    Object.assign(s.hero, { y: f.y + FROG_TOP + 10, vy: -12, air: true });
    sparks.length = 0;
    const at = s.critters.life + 1;
    s.step(s.player);
    s.player.pos.y += 2000;
    s.step(s.player, 30);
    const burst = sparks.filter((e) => e.kind === 'burst');
    assert.equal(burst.length, 1);
    assert.equal(s.coins.length, 1);
    assert.equal(s.coins[0].life - at, FROG.LIFT, 'the coin with the burst');
    assert.equal(FROG.SQUASH + SHARED.POOF, FROG.LIFT, '(squash and poof last as long as the wreath flies)');
  }
  // Punched: straight away from the camera (he faces north, the camera behind him looks north),
  // it goes KNOCK_TURN off the camera's line; with no camera, straight away from him.
  for (const cam of [null, 0, -0.4]) {
    const s = facing(240);
    s.setCam(cam);
    s.until(s.player, () => s.frog.state === 'windup', 60);
    const f = s.frog;
    const away = Math.atan2(f.x - s.player.pos.x, f.z - s.player.pos.z);
    s.player.attack = { x: f.x, y: f.y + 30, z: f.z, radius: 40 };
    s.step(s.player);
    s.player.attack = null;
    assert.equal(f.state, 'tumble');
    const dir = Math.atan2(f.vx, f.vz);
    const off = Math.abs(wrapAngle(dir - away));
    if (cam === null) assert.ok(off < 1e-9, `no camera: straight away (${off})`);
    else {
      assert.ok(Math.abs(off - SHARED.KNOCK_TURN) < 1e-9, `off the line by ${off}`);
      assert.ok(Math.abs(wrapAngle(dir - cam)) > Math.abs(wrapAngle(away - cam)), 'further off the camera\'s line');
    }
    let peak = 0;
    for (let t = 0; t < FROG.TUMBLE; t++) {
      s.step(s.player);
      peak = Math.max(peak, f.y - f.floorY);
    }
    assert.ok(peak >= 75 && peak <= 100, `its arc peaks ${peak.toFixed(0)} up`);
  }
  // Dazed: three white twinkles round its head every TWINKLE_EVERY ticks, turning.
  {
    const s = facing(240, { sparkles });
    s.until(s.player, () => s.frog.state === 'dazed', 120);
    const f = s.frog;
    sparks.length = 0;
    const sets = [];
    for (let t = 0; t < FROG.DAZED - 1; t++) {
      const n = sparks.length;
      s.step(s.player);
      const tw = sparks.slice(n).filter((e) => e.kind === 'twinkle');
      // (Where it was as they showed: it lands on his feet, then is bumped off them.)
      if (tw.length) sets.push({ t: f.t, x: f.x, z: f.z, tw });
    }
    assert.deepEqual(sets.map((e) => e.t), [1, 13, 25]);
    for (const { x, z, tw } of sets) {
      assert.equal(tw.length, 3);
      for (const e of tw) {
        assert.deepEqual(e.tint, TINT.petal);
        assert.ok(Math.abs(Math.hypot(e.x - x, e.z - z) - 40) < 1e-6, 'round its head');
      }
      const a = tw.map((e) => Math.atan2(e.x - x, e.z - z));
      assert.ok(Math.abs(Math.abs(wrapAngle(a[1] - a[0])) - (2 * Math.PI) / 3) < 1e-6, 'spaced round it');
    }
    const ang = (k) => Math.atan2(sets[k].tw[0].x - sets[k].x, sets[k].tw[0].z - sets[k].z);
    assert.ok(Math.abs(wrapAngle(ang(1) - ang(0))) > 0.5, 'turning');
  }
});

test('knock-safe: at the edge of a drop or the water, a hit that would knock him off sends him toward home instead, round the critter where it stands in that way (never through it, and it is never shoved along by him flying back); on open floor it knocks him straight away from the frog', () => {
  // (The frog stands on its ring point 0: 120 from home along its yaw, south-west of home with
  // yaw -135 degrees, out of his way home from the north and the east.)
  const hitAt = (collision, hero, src, spot = { yaw: (-3 * Math.PI) / 4 }) => {
    const k = crew([frogSpot(spot)], { collision });
    const c = k.critters.list[0];
    const p = fakePlayer(hero.x, 0, hero.z);
    k.step(p, 1, true); // (the tick's hero, held: nothing else happens)
    k.critters.fightable = true;
    k.critters.away = false;
    assert.equal(k.critters._hurt(c, src.x, 40, src.z), true);
    return p.hits[0].from;
  };
  // Open floor: the frog's own position.
  const open = hitAt(world(), { x: 300, z: 0 }, { x: 150, z: 0 });
  assert.deepEqual([open.x, open.z], [150, 0]);
  // The water's edge (x 600): knocked on east he would land in it; he flies west, toward home.
  const wet = hitAt(world({ waterFromX: 600 }), { x: 420, z: 0 }, { x: 300, z: 0 });
  assert.ok(wet.x > 420 + 90 && Math.abs(wet.z) < 1e-9, `redirected: ${JSON.stringify(wet)}`);
  // A drop of 300 at z 500: knocked south he would fall; he flies north, toward home.
  const drop = hitAt(world({ drop: { z: 500, side: 1, depth: 300 } }), { x: 0, z: 400 }, { x: 0, z: 250 });
  assert.ok(drop.z > 400 + 90 && Math.abs(drop.x) < 1e-9, `redirected: ${JSON.stringify(drop)}`);
  // ... with the frog standing in that way (ring point 0 at (0, 120), 280 ahead of him: he would
  // land on it): turned round it to the first way clear of it (KNOCK_ROUND at a time, away from
  // its side), still homeward and landing safely on the level.
  {
    const round = hitAt(world({ drop: { z: 500, side: 1, depth: 300 } }), { x: 10, z: 400 }, { x: 10, z: 250 }, { yaw: 0 });
    const vx = (10 - round.x) / SHARED.REDIRECT;
    const vz = (400 - round.z) / SHARED.REDIRECT;
    const home = Math.atan2(-10, -400);
    const turned = wrapAngle(Math.atan2(vx, vz) - home);
    const its = wrapAngle(Math.atan2(-10, 120 - 400) - home);
    const k = Math.round(turned / SHARED.KNOCK_ROUND);
    assert.ok(Math.abs(Math.hypot(vx, vz) - 1) < 1e-9 && k !== 0 && Math.abs(turned - k * SHARED.KNOCK_ROUND) < 1e-9, `turned ${turned.toFixed(3)}`);
    assert.ok(Math.sign(turned) === -Math.sign(its), `away from its side (${its.toFixed(3)})`);
    const ahead = -10 * vx + (120 - 400) * vz;
    const side = -10 * vz - (120 - 400) * vx;
    assert.ok(ahead <= 0 || Math.abs(side) >= CRITTER_RIG.frog.BUMP_R, `clear of it: ${ahead.toFixed(0)} ahead, ${side.toFixed(0)} aside`);
    assert.ok(400 + vz * SHARED.KNOCK_FAR < 500, 'landing on the level');
  }
  // ... the way round it on its far side first, unless that lands him in the water (east of x
  // 60): then round the near side.
  {
    const far = hitAt(world({ waterFromX: 60, drop: { z: 500, side: 1, depth: 300 } }), { x: 0, z: 400 }, { x: 0, z: 250 }, { yaw: -Math.atan2(10, 120) });
    const vx = (0 - far.x) / SHARED.REDIRECT;
    const vz = (400 - far.z) / SHARED.REDIRECT;
    assert.ok(vx < -0.4 && vz < 0, `round its other side, west, homeward: ${vx.toFixed(2)}, ${vz.toFixed(2)}`);
  }
  // A crab pinching him at the edge of the drop from between him and home: he flies round it, and
  // it is not shoved along by him flying back over it (no bump while he is knocked back).
  {
    const k = crew([crabSpot({ yaw: 0 })], { collision: world({ drop: { z: 300, side: 1, depth: 300 } }) });
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, 180);
    k.until(p, () => c.state === 'pinch', 200);
    k.until(p, () => p.hits.length > 0 || c.state !== 'pinch', 10);
    assert.equal(p.hits.length, 1, 'pinched');
    const v = { x: (p.pos.x - p.hits[0].from.x) / SHARED.REDIRECT, z: (p.pos.z - p.hits[0].from.z) / SHARED.REDIRECT };
    const w = { x: c.x - p.pos.x, z: c.z - p.pos.z };
    const l = Math.hypot(p.pos.x, p.pos.z);
    const h = { x: -p.pos.x / l, z: -p.pos.z / l };
    assert.ok(w.x * h.x + w.z * h.z > 0 && Math.abs(w.x * h.z - w.z * h.x) < CRITTER_RIG.crab.BUMP_R, 'straight home he would fly through it');
    assert.ok(v.z < 0, 'toward home');
    assert.ok(w.x * v.x + w.z * v.z <= 0 || Math.abs(w.x * v.z - w.z * v.x) >= CRITTER_RIG.crab.BUMP_R, `round it: ${JSON.stringify(v)}, it at ${JSON.stringify(w)}`);
    // He flies back past it (knocked back: 'hurt') as its claws stick in the sand: it stays
    // where it is.
    k.until(p, () => c.state === 'stuck', 10);
    p.action = 'hurt';
    const at = { x: c.x, z: c.z };
    for (let t = 0; t < 8; t++) {
      Object.assign(p.pos, { x: c.x + 20 - 5 * t, z: c.z + 10 });
      k.step(p);
      assert.deepEqual({ x: c.x, z: c.z }, at, 'not shoved');
    }
  }
  // ... and through a whole strike with a drop behind him: the hit comes from behind him, so he
  // flies on toward home, not off the edge.
  const s = facing(240, { collision: world({ drop: { z: -100, side: -1, depth: 300 } }) });
  s.step(s.player, 120);
  assert.equal(s.player.hits.length, 1);
  assert.ok(s.player.hits[0].from.z < s.player.pos.z - 50, 'sent toward home');
});

test('movement: a frog never lands past fight + 60, in the water or off a drop: its back-hops refused there, its hops toward him and its target pulled in to the leash; the target on its level and dry, else half way, else the windup called off (puzzled); from any distance it winds up with him 160 to 290 away (backing off first when he is nearer)', () => {
  const LEASH = 500 + FROG.LEASH;
  const homeDist = (c, x = c.x, z = c.z) => Math.hypot(x - c.hx, z - c.hz);
  // (1) He stands on its land side within 160 of it, the water (and, again, a 150 drop) right
  // behind it: every back-hop away from him is refused there, and it stays dry, on its level.
  for (const [what, collision, spot, at, dry] of [
    ['water', world({ waterFromX: 100 }), { yaw: Math.PI }, { x: -100, z: -120 }, (c) => c.x < 100],
    // (Shallow water over the same level floor: only the water stops it.)
    ['pool', world({ pool: { x: 100, depth: 30 } }), { yaw: Math.PI }, { x: -100, z: -120 }, (c) => c.x < 100],
    ['drop', world({ drop: { z: 180, side: 1, depth: 150 } }), { yaw: 0 }, { x: 0, z: 20 }, (c) => c.z < 180],
  ]) {
    const k = crew([frogSpot(spot)], { collision });
    const c = k.critters.list[0];
    const p = fakePlayer(at.x, 0, at.z);
    let tries = 0;
    for (let t = 0; t < 300; t++) {
      const due = c.state === 'approach' && c.n === 0 && k.critters.life + 1 >= c.next;
      k.step(p);
      if (due) tries++;
      assert.ok(dry(c) && c.floorY === 0 && c.n === 0, `${what}: dry and on its level at tick ${t} (${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)}, ${c.state})`);
    }
    assert.ok(Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < FROG.WIN_MIN && tries >= 5, `${what}: it kept trying to back off (${tries})`);
  }
  // (2) He came into its circle, then stands just inside its release ring (fight + OUT) on the
  // far side: its hops toward him take off for spots inside the leash, and its target is pulled
  // in to it.
  {
    const k = crew([frogSpot()]);
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, 400);
    k.until(p, () => c.state === 'approach', 30);
    p.pos.z = 500 + SHARED.OUT - 5;
    let hops = 0;
    let locks = 0;
    for (let t = 0; t < 900; t++) {
      p.invincibleUntil = 0;
      const ground = c.n === 0;
      const marked = c.markOn;
      k.step(p);
      if (ground && c.n > 0) {
        hops++;
        assert.ok(homeDist(c, c.tx, c.tz) <= LEASH + 1e-6, `a hop for ${homeDist(c, c.tx, c.tz).toFixed(1)} from home`);
      }
      if (marked === 0 && c.markOn === 1) {
        locks++;
        assert.ok(homeDist(c, c.tx, c.tz) <= LEASH + 1e-6, `its target ${homeDist(c, c.tx, c.tz).toFixed(1)} from home`);
      }
      assert.ok(homeDist(c) <= LEASH + 1e-6, `${homeDist(c).toFixed(1)} from home`);
      assert.equal(k.critters.engaged, 1, 'still after him');
    }
    assert.ok(hops >= 5 && locks >= 2, `${hops} hops, ${locks} locks`);
  }
  // (3) He stands on a ledge 50 up (his level for it, but not for its landing): its target goes
  // half way, on the meadow; with the water under the half-way spot too, the windup is called
  // off, puzzled (a low croak, the token back, a cooldown).
  {
    const s = facing(240, { collision: world({ ledge: { x0: -200, x1: 200, z0: -100, z1: 60, y: 50 } }) });
    Object.assign(s.player.pos, { y: 50 });
    s.player.floor = { y: 50, surface: {} };
    s.until(s.player, () => s.frog.markOn === 1, 120);
    const f = s.frog;
    assert.equal(f.state, 'windup');
    assert.ok(Math.abs(f.tx - f.x / 2) < 1e-6 && Math.abs(f.tz - f.z / 2) < 1e-6 && f.ty === 0, `half way: ${f.tx}, ${f.ty}, ${f.tz}`);
  }
  {
    const k = crew([frogSpot({ x: -360, yaw: Math.PI / 2 })], { collision: world({ waterFromX: -150, ledge: { x0: -60, x1: 100, z0: -100, z1: 100, y: 50 } }) });
    const c = k.critters.list[0];
    const p = fakePlayer(0, 50, 0);
    k.until(p, () => c.state === 'windup', 80);
    assert.equal(c.state, 'windup');
    const n = k.sfx.length;
    k.until(p, () => c.state !== 'windup', 40);
    assert.equal(c.state, 'approach', 'called off');
    assert.equal(c.markOn, 0);
    assert.equal(k.critters.attacker, -1, 'the token back');
    assert.equal(k.critters.gapUntil, k.critters.life + SHARED.GAP);
    assert.equal(c.cooldown, FROG.CANCEL_COOLDOWN);
    assert.deepEqual(k.sfx.slice(n).map((e) => [e.name, e.pitch]), [['frog_croak', 0.7]], 'puzzled');
  }
  // And walking a loop round the edge of its circle by the water and the drop, for 3000 ticks:
  // every landing within the leash, dry, on the floor.
  const collision = world({ waterFromX: 500, drop: { z: 520, side: 1, depth: 150 } });
  const k = crew([frogSpot()], { collision });
  const c = k.critters.list[0];
  const p = fakePlayer(0, 0, 0);
  let landings = 0;
  for (let t = 0; t < 3000; t++) {
    const a = t / 60;
    p.pos.x = Math.min(480, 420 * Math.sin(a));
    p.pos.z = Math.min(500, 420 * Math.cos(a * 1.3));
    p.invincibleUntil = 0;
    const air = c.n > 0;
    k.step(p);
    if (air && c.n === 0) {
      landings++;
      assert.ok(homeDist(c) <= LEASH + 1e-6, `within the leash: ${c.x}, ${c.z}`);
      assert.ok(c.x < 500 && c.z < 520 && Math.abs(c.y) < 1e-6, `on the floor, dry: ${c.x}, ${c.y}, ${c.z}`);
    }
  }
  assert.ok(landings > 20, `${landings} landings`);
  for (let d = 100; d <= 460; d += 40) {
    const s = facing(d, { fight: 700 });
    const z0 = s.frog.z;
    let backed = false;
    s.until(s.player, () => {
      if (s.frog.z > z0 + 1) backed = true;
      return s.frog.state === 'windup';
    }, 300);
    assert.equal(s.frog.state, 'windup', `from ${d}`);
    const at = dist(s.frog, s.player);
    assert.ok(at >= FROG.WIN_MIN && at <= FROG.WIN_MAX, `from ${d}: wound up ${at.toFixed(0)} away`);
    if (d < FROG.WIN_MIN) assert.ok(backed, `from ${d}: it backed off first`);
  }
  const near = facing(120);
  near.until(near.player, () => near.frog.n > 0, 60);
  assert.ok(near.frog.vz > 0, 'from 120 it hops back first');
});

test("lifecycle: a lost life sends the live ones home calm (a frog to ring point 0, a crab into its tin at home, a mosquito onto its patrol) and keeps the defeated gone; a defeat under way still drops its coin; reset() brings every one back and forgets his last action; a wading critter's coin floats over the water", () => {
  const k = crew([frogSpot({ id: 'a', x: -300, z: 300 }), frogSpot({ id: 'b', x: 2000, z: 300 }), frogSpot({ id: 'c', x: 4000, z: 300 })]);
  const [a, b, c] = k.critters.list;
  const p = fakePlayer(-300, 0, 0);
  k.until(p, () => a.state === 'approach', 40);
  // b defeated and gone; c being defeated as he loses his life.
  p.attack = { x: b.x, y: 30, z: b.z, radius: 40 };
  k.step(p);
  p.attack = null;
  k.step(p, 40);
  assert.equal(b.state, 'gone');
  p.attack = { x: c.x, y: 30, z: c.z, radius: 40 };
  k.step(p);
  p.attack = null;
  assert.equal(c.state, 'tumble');
  p.action = 'spawn';
  k.step(p);
  assert.equal(a.state, 'idle', 'home, calm');
  assert.deepEqual([a.x, a.z], [ring0(a).x, ring0(a).z]);
  assert.equal(a.engaged, 0);
  assert.equal(k.critters.attacker, -1);
  assert.equal(b.state, 'gone', 'the defeated stay gone');
  assert.notEqual(c.state, 'idle', 'a defeat under way goes on');
  k.step(p, 40);
  assert.equal(c.state, 'gone');
  assert.equal(k.coins.length, 2, 'its coin too');
  // Still 'spawn' next tick: no edge, no second trip home.
  assert.equal(k.critters._lastAction, 'spawn');
  k.critters.reset();
  assert.equal(k.critters._lastAction, null);
  assert.equal(k.critters.alive, 3);
  for (const r of k.critters.list) assert.equal(r.state, 'idle');
  assert.equal(k.critters.life, 0);
  // A wading critter's coin: at least 50 over the water there.
  const wet = crew([frogSpot({ wade: true })], { collision: world({ wade: 30 }) });
  const f = wet.critters.list[0];
  const q = fakePlayer(0, 0, 3000);
  q.attack = { x: f.x, y: 30, z: f.z, radius: 40 };
  wet.step(q);
  q.attack = null;
  wet.step(q, 40);
  assert.equal(wet.coins.length, 1);
  assert.equal(wet.coins[0].minY, 80);
  // ... which ObjectManager's spawnCoin keeps.
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: world({ wade: 30 }), events: new Events(), layout: { CRITTERS: [frogSpot({ wade: true })], groundHeight: () => 0 }, player: q });
  const coin = om.spawnCoin(0, 0, 0, 80);
  assert.equal(coin.y, 80);
  assert.equal(om.spawnCoin(500, 0, 0).y, 60, 'a dry coin hovers at 60');
  // A crab in its windup and a mosquito in its aim when he loses his life: home and calm.
  const two = crew([crabSpot({ z: 180, yaw: Math.PI }), mosquitoSpot({ x: 3000, z: 225, yaw: Math.PI, roam: 1 })]);
  const [crab, buzz] = two.critters.list;
  const r = fakePlayer(0, 0, 0);
  two.until(r, () => crab.state === 'windup', 60);
  assert.equal(crab.state, 'windup');
  r.action = 'spawn';
  two.step(r);
  assert.deepEqual([crab.state, crab.x, crab.z, crab.engaged], ['hidden', crab.hx, crab.hz, 0]);
  assert.equal(two.critters.attacker, -1);
  r.action = 'idle';
  r.pos.x = 3000;
  r.invincibleUntil = 0;
  two.until(r, () => buzz.state === 'aim' && buzz.t === 5, 120);
  assert.ok(buzz.markOn === 1 && two.critters.attacker === 1, 'aiming, its ring showing');
  r.action = 'spawn';
  two.step(r);
  assert.equal(buzz.state, 'patrol');
  assert.equal(buzz.markOn, 0);
  assert.ok(Math.abs(buzz.y - (buzz.hy + MOSQUITO.HOVER + MOSQUITO.BOB * Math.sin(MOSQUITO.BOB_RATE * two.critters.life))) < 1e-9, 'on its patrol curve');
  assert.equal(two.critters.attacker, -1);
  // A wading crab's coin floats over the water too.
  const bar = crew([crabSpot({ wade: true })], { collision: world({ wade: 60 }) });
  const t = fakePlayer(0, 0, 3000);
  t.attack = { x: 0, y: 30, z: 0, radius: 40 };
  bar.step(t);
  t.attack = null;
  bar.step(t, 60);
  assert.equal(bar.coins.length, 1);
  assert.equal(bar.coins[0].minY, 60 + SHARED.WADE_COIN);
});

test('the models: triangles within their caps, unit normals, their sizes (the frog 115-130 across its hind feet and under 90 tall, the crab 165-180 across its legs with its tin top at 76-80, the mosquito 210-240 long with a 170-200 wingspan); the crab standing tall keeps its feet planted and its hips rising with its body; the mosquito\'s pupils clear of its head, the wreath\'s flowers clear of its leaves; every part posed in its own model\'s branch of the shader, the crab\'s leg lift and the wreath\'s squash undo as worked out here, its raised claws opening toward the front, the mosquito\'s eyes a deep red in the aim', () => {
  const b = critterBase();
  const pos = b.position.array;
  const nrm = b.normal.array;
  const part = b.aPart.array;
  const n = pos.length / 3;
  const of = (model, code = null) => {
    const out = [];
    for (let v = 0; v < n; v++) if (part[v * 3 + 2] === model && (code === null || part[v * 3] === code)) out.push(v);
    return out;
  };
  const box = (vs) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[v * 3 + k]);
      hi[k] = Math.max(hi[k], pos[v * 3 + k]);
    }
    return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
  };
  let total = 0;
  for (const [name, model] of Object.entries(MODEL)) {
    const tris = of(model).length / 3;
    const cap = CRITTER_TRIS[name.toLowerCase()];
    assert.ok(tris > 0.5 * cap && tris <= cap, `${name}: ${tris} triangles (cap ${cap})`);
    total += tris;
  }
  assert.ok(total <= CRITTER_TRIS.total, `${total} in all`);
  assert.equal(n % 3, 0);
  for (let v = 0; v < n; v++) assert.ok(Math.abs(Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) - 1) < 1e-4, `normal ${v}`);
  const frog = box(of(MODEL.FROG));
  assert.ok(frog.size[0] >= 115 && frog.size[0] <= 130, `frog ${frog.size[0]} across`);
  assert.ok(frog.hi[1] <= 90, `frog ${frog.hi[1]} tall`);
  const P = CRITTER_PARTS;
  const legs = box(of(MODEL.CRAB, P.crab.LEG));
  assert.ok(legs.size[0] >= 165 && legs.size[0] <= 180, `crab legs ${legs.size[0]} across`);
  let tinTop = -Infinity;
  for (const v of of(MODEL.CRAB, P.crab.TIN)) if (Math.abs(pos[v * 3]) <= 56 && pos[v * 3 + 2] > -40) tinTop = Math.max(tinTop, pos[v * 3 + 1]);
  assert.ok(tinTop >= 76 && tinTop <= 80, `tin top ${tinTop}`);
  const mosq = box(of(MODEL.MOSQUITO));
  assert.ok(mosq.size[2] >= 210 && mosq.size[2] <= 240, `mosquito ${mosq.size[2]} long`);
  const wings = box(of(MODEL.MOSQUITO, P.mosquito.WING));
  assert.ok(wings.size[0] >= 170 && wings.size[0] <= 200, `wingspan ${wings.size[0]}`);
  // The crab standing on its legs with stand 40 (lift 1): its lift channel 1 + 40 / LIFT_SPAN;
  // the shader moves a part by h = LIFT_SPAN * (channel - 1), a leg vertex by h * clamp(y /
  // LEG_W, 0, 1).
  const C = CRITTER_RIG.crab;
  const h = C.LIFT_SPAN * (1 + 40 / C.LIFT_SPAN - 1);
  const lifted = (v) => pos[v * 3 + 1] + h * Math.min(1, Math.max(0, pos[v * 3 + 1] / C.LEG_W));
  const legVs = of(MODEL.CRAB, P.crab.LEG);
  const feet = legVs.filter((v) => pos[v * 3 + 1] <= 0.5);
  assert.ok(feet.length >= 12, `${feet.length} foot vertices`);
  for (const v of feet) assert.ok(Math.abs(lifted(v)) <= 0.5, `a foot at ${lifted(v)}`);
  const hips = legVs.filter((v) => Math.abs(Math.abs(pos[v * 3]) - 40) < 5 && Math.abs(pos[v * 3 + 1] - 30) < 5);
  assert.ok(hips.length >= 12, `${hips.length} hip vertices`);
  for (const v of hips) assert.ok(Math.abs(lifted(v) - pos[v * 3 + 1] - h) <= 1, 'a hip rises with the body');
  // The mosquito's pupils (its eyes' black vertices) stand clear of its head ball, in front.
  const col = b.color.array;
  const dark = (v) => col[v * 3] < 0.05 && col[v * 3 + 1] < 0.05;
  const pupils = of(MODEL.MOSQUITO, P.mosquito.EYE).filter(dark);
  assert.ok(pupils.length >= 12, `${pupils.length} pupil vertices`);
  for (const v of pupils) assert.ok(Math.hypot(pos[v * 3], pos[v * 3 + 1] - 2, pos[v * 3 + 2] - 37) > 18 + 1 && pos[v * 3 + 2] > 50, 'a pupil out of the head');
  // The frog's pupils are under half its eye across.
  for (const side of [-1, 1]) {
    const eye = of(MODEL.FROG, P.frog.EYE).filter((v) => Math.sign(pos[v * 3]) === side);
    const xs = (vs) => vs.map((v) => pos[v * 3]);
    const w = Math.max(...xs(eye)) - Math.min(...xs(eye));
    const pw = Math.max(...xs(eye.filter(dark))) - Math.min(...xs(eye.filter(dark)));
    assert.ok(pw > 0.2 * w && pw < 0.5 * w, `pupil ${pw.toFixed(1)} of ${w.toFixed(1)} across`);
  }
  // Each wreath flower's centre (its hub, the one vertex in a centre colour) stands clear of the
  // ring of leaves under it (out of the tube, measured in the wreath's tilted frame).
  const W = CRITTER_RIG.frog.WREATH;
  const centres = [0xf3c433, 0xe89a1a, 0xf3e090].map((h) => new THREE.Color(h).toArray());
  const hubs = of(MODEL.FROG, P.frog.WREATH).filter((v) => centres.some((c) => Math.abs(col[v * 3] - c[0]) + Math.abs(col[v * 3 + 1] - c[1]) + Math.abs(col[v * 3 + 2] - c[2]) < 1e-5));
  assert.equal(hubs.length, 10 * 6, 'ten flowers, a hub each');
  const untilt = new THREE.Matrix4().makeRotationX(0.12);
  for (const v of hubs) {
    const q = new THREE.Vector3(pos[v * 3] - W[0], pos[v * 3 + 1] - W[1], pos[v * 3 + 2] - W[2]).applyMatrix4(untilt);
    assert.ok(Math.hypot(Math.hypot(q.x, q.z) - 32, q.y) > 6.5 + 1, 'a flower\'s centre out of the leaves');
  }
  // Every model's every part is present in the geometry and posed in its own model's branch of
  // the vertex shader (its name in that branch's comments).
  const src = makeCritterMaterial().userData.vertexChunks;
  const at = (mark, from = 0) => {
    const i = src.indexOf(mark, from);
    assert.ok(i >= 0, mark);
    return i;
  };
  const f0 = at('if(aPart.z<.5){');
  const c0 = at('}else if(aPart.z<1.5){', f0);
  const m0 = at('}else{', c0);
  const branch = { frog: src.slice(f0, c0), crab: src.slice(c0, m0), mosquito: src.slice(m0, at('#include <beginnormal_vertex>', m0)) };
  for (const [kind, parts] of Object.entries(P)) {
    for (const [name, code] of Object.entries(parts)) {
      assert.ok(of(MODEL[kind.toUpperCase()], code).length > 0, `${kind} ${name} built`);
      assert.match(branch[kind], new RegExp(`//[^\\n]*\\b${name}\\b`), `${kind} ${name} in its branch of the shader`);
    }
  }
  // The crab's leg lift as worked out above (h * clamp(y / LEG_W)); the wreath's squash undone
  // in its scale (so its normals take the inverse), its rise WREATH_RISE * lift * (2 - lift); the
  // upper jaw opening upward.
  assert.ok(branch.crab.includes(`clamp(position.y/${C.LEG_W.toFixed(1)},0.,1.)`) && branch.crab.includes('h*=w') && branch.crab.includes(`${C.LIFT_SPAN.toFixed(1)}*(aAnim2.y-1.)`), 'the leg lift');
  const wreath = branch.frog.slice(branch.frog.indexOf('//WREATH') - 80);
  assert.ok(wreath.includes('scl.y*=sqrt(q.x/q.y)') && !/R=mat3\(/.test(wreath), 'the squash undone in the scale');
  assert.ok(wreath.includes(`${CRITTER_RIG.frog.WREATH_RISE.toFixed(1)}*lift*(2.-lift)`), 'the rise');
  assert.ok(branch.crab.includes('critRotX(-.6*aAnim.w)'), 'the jaw opens upward');
  // ... and a claw raised past its rest (the tell) turns about its upright (about a radian more at
  // RAISE), so the opening faces him and the camera behind him, not edge on.
  assert.ok(branch.crab.includes('critRotY(side*(.3*aAnim.z+.9*max(aAnim.z-.4,0.)))'), 'the raised claws turned to open toward the front');
  assert.ok(branch.mosquito.includes('vEye=aAnim2.x'), 'the eye glow');
  // The fragment: the mosquito's eyes go a deep red in the aim, everything but the black pupils.
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  makeCritterMaterial().onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('mix(diffuseColor.rgb, vec3(0.85, 0.06, 0.03), vEye * step(0.1, diffuseColor.r))'), 'the red eyes');
});

test('blob shadows: one slot per critter after the others, under each one on its floor, sized by its height over it; hidden once it is gone', () => {
  const om = (spots) => new ObjectManager({ scene: new THREE.Scene(), collision: world(), events: new Events(), layout: { ...(spots ? { CRITTERS: spots } : {}), groundHeight: () => 0 }, player: fakePlayer(0, 0, 3000) });
  const base = om(null).shadows.mesh.count;
  const o = om([frogSpot(), frogSpot({ id: 'b', x: 1500 })]);
  assert.equal(o.shadows.mesh.count, base + 2, 'two more slots');
  assert.equal(o.critters.shadowBase, base, 'after the others');
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const slot = (i) => {
    o.shadows.mesh.getMatrixAt(base + i, m);
    m.decompose(pos, new THREE.Quaternion(), scl);
    return { x: pos.x, y: pos.y, z: pos.z, size: scl.x };
  };
  const player = fakePlayer(0, 0, 3000);
  player.collectCoin = () => {};
  let air = 0;
  for (let t = 0; t < 400; t++) {
    player.tick++;
    o.update({ player });
    o.animate(t / 30, 1, null);
    for (let i = 0; i < 2; i++) {
      const c = o.critters.list[i];
      const sh = slot(i);
      assert.ok(Math.abs(sh.x - c.x) < 1e-3 && Math.abs(sh.z - c.z) < 1e-3 && Math.abs(sh.y - (c.floorY + 2)) < 1e-3, `under ${c.id}`);
      assert.ok(Math.abs(sh.size - shadowSize(CRITTER_RIG.frog.SHADOW, c.y - c.floorY)) < 1e-3, `sized: ${sh.size}`);
      if (c.y > c.floorY + 10) air++;
    }
  }
  assert.ok(air > 10, 'some in the air (smaller)');
  // Punched away: once it is gone, its slot is empty.
  const c = o.critters.list[0];
  player.attack = { x: c.x, y: c.y + 30, z: c.z, radius: 40 };
  player.tick++;
  o.update({ player });
  player.attack = null;
  for (let t = 0; t < 40; t++) {
    player.tick++;
    o.update({ player });
    o.animate(0, 1, null);
  }
  assert.equal(c.state, 'gone');
  o.shadows.mesh.getMatrixAt(base, m);
  assert.deepEqual(m.elements, new THREE.Matrix4().makeScale(0, 0, 0).elements, 'hidden');
  assert.ok(slot(1).size > 0, 'the other still there');
});

// The per-tick and per-frame code must not use what V8 allocates for (see objects.test.js).
test('critter hot paths avoid allocating constructs', () => {
  const hot = ['update', '_move', '_hop', '_fly', '_launch', '_markAt', '_standable', '_struck', '_stomped', '_rise', '_at', '_near', '_parried', '_bounce', '_hurt', '_safe', '_touches', '_engage', '_bump', '_knock', '_tumble', '_poofStep', '_every', '_twinkle', '_burst', '_clods', 'animate'];
  for (const name of hot) {
    const src = Critters.prototype[name].toString();
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, name);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, name);
    assert.doesNotMatch(src, /\.(find|some|forEach)\(/, name);
  }
  // The frog's steps: all of critters/frog.js but its ring check (the constructor's).
  const file = readFileSync(new URL('../src/objects/critters/frog.js', import.meta.url), 'utf8');
  const from = file.indexOf('function ring(');
  const to = file.indexOf('function home(');
  assert.ok(from > 0 && to > from, 'the ring check, cut out');
  const steps = file.slice(0, from) + file.slice(to);
  for (const name of ['home', 'idle', 'airTick', 'notice', 'approach', 'windup', 'lockOn', 'leap', 'dazed', 'release', 'returnStep', 'bumped', 'defeat', 'wreathFly', 'squash', 'tumble', 'step']) assert.ok(steps.includes(`function ${name}(`), name);
  assert.ok(!steps.includes('function ring('));
  assert.doesNotMatch(steps, /Math\.(hypot|max|min)\(/);
  assert.doesNotMatch(steps, /for \((const|let|var) [^;]* of /);
  assert.doesNotMatch(steps, /\.(find|some|forEach)\(/);
  // The crab's and the mosquito's steps: the whole of each file (the mosquito's needle length,
  // worked out once at load, aside).
  const fns = {
    crab: ['home', 'walk', 'hidden', 'clack', 'notice', 'wake', 'canWindup', 'strafe', 'toWindup', 'windup', 'pinch', 'stuck', 'cancel', 'release', 'returnStep', 'hide', 'defeat', 'dented', 'dent', 'tumble', 'step'],
    mosquito: ['curve', 'flutter', 'hover', 'fly', 'home', 'patrol', 'notice', 'canAim', 'chase', 'toAim', 'aim', 'dive', 'endStrike', 'recoil', 'toRise', 'rise', 'cooldown', 'stuck', 'pull', 'cancel', 'release', 'returnStep', 'defeat', 'down', 'splat', 'fall', 'deflate', 'step'],
  };
  for (const [kind, names] of Object.entries(fns)) {
    let src = readFileSync(new URL(`../src/objects/critters/${kind}.js`, import.meta.url), 'utf8');
    src = src.replace('const TIP_LEN = Math.hypot(', 'const TIP_LEN = (');
    for (const name of names) assert.ok(src.includes(`function ${name}(`), `${kind} ${name}`);
    assert.doesNotMatch(src, /Math\.(hypot|max|min)\(/, kind);
    assert.doesNotMatch(src, /for \((const|let|var) [^;]* of /, kind);
    assert.doesNotMatch(src, /\.(find|some|forEach)\(/, kind);
  }
});

// The fairness tables (the dodge model's rows, docs/ARCHITECTURE.md "Critters"): the real
// Player on a flat course with a real ObjectManager holding one critter (`spot`) north of him (in
// front, the camera looking north). He stands still until its tell starts (a windup, the
// mosquito's aim), then plays `input(t)` (t: ticks since the tell started). Returns how it ended
// (HIT, STRUCK, STOMP, the mosquito STUCK in the turf, or miss), the ticks of the tell's start,
// its lock (the frog's and the mosquito's ring showing, the crab's heading locking) and his
// first damage, and how far from him the tell started.
const TELL = { windup: 1, aim: 1 };
const STRUCK = { tumble: 1, deflate: 1 };
const STOMPED = { squash: 1, dent: 1, splat: 1 };
function dodge(spot, input) {
  const run = (play) => {
    const b = new CourseBuilder();
    b.floor(-5000, -5000, 5000, 5000, 0);
    const collision = b.build();
    const events = new Events();
    const player = new Player({ collision, events, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
    player.teleport(0, 0, 0, 0);
    player.setAction('idle');
    const ctl = new ScriptedController();
    const om = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: { CRITTERS: [spot], groundHeight: () => 0 }, player });
    const c = om.critters.list[0];
    const out = { windup: -1, at: -1, lock: -1, damage: -1, end: 'miss' };
    for (let t = 0; t < 300; t++) {
      const health = player.health;
      player.update(ctl.next(play(t)), 0);
      om.update({ player });
      SEEN[KIND[c.kind]].add(c.state);
      if (TELL[c.state] === 1 && out.windup < 0) {
        out.windup = t;
        out.at = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
      }
      if (out.lock < 0 && (c.markOn === 1 || (c.kind === MODEL.CRAB && c.state === 'windup' && c.t === CRAB.LOCK))) out.lock = t;
      if (player.health < health && out.damage < 0) {
        out.damage = t;
        out.end = 'HIT';
        break;
      }
      if (STRUCK[c.state] === 1) out.end = 'STRUCK';
      if (STOMPED[c.state] === 1) out.end = 'STOMP';
      if (c.kind === MODEL.MOSQUITO && c.state === 'stuck') out.end = 'STUCK';
      if (out.end !== 'miss' || (out.windup >= 0 && t > out.windup + 60)) break;
    }
    return out;
  };
  const first = run(() => ({}));
  const u0 = first.windup;
  assert.ok(u0 > 0, `a tell from ${JSON.stringify(spot)}`);
  return run((t) => (t < u0 ? {} : input(t - u0)));
}

test('fairness (the real Player): the frog at both ends of its window, standing still he is hit; a full sidestep at tick 22 of the tell misses; walking in mashing B he knocks it over first; a jump at tick 20 stomps it, one at tick 0 is never hit; the lock at least 9 ticks before any hit', () => {
  for (const d of [FROG.WIN_MIN, FROG.WIN_MAX]) {
    const spot = frogSpot({ z: d + 120, yaw: Math.PI });
    const rows = {
      still: dodge(spot, () => ({})),
      side22: dodge(spot, (t) => (t < 22 ? {} : { stickX: 1 })),
      mashB: dodge(spot, (t) => ({ stickY: 0.6, B: t % 5 === 0 })),
      jump20: dodge(spot, (t) => (t < 20 ? {} : { stickY: 0.5, A: t < 37 })),
      jump0: dodge(spot, (t) => ({ stickY: 0.5, A: t < 17 })),
    };
    const summary = JSON.stringify(rows);
    assert.equal(rows.still.end, 'HIT', `${d} still: ${summary}`);
    assert.notEqual(rows.side22.end, 'HIT', `${d} sidestep: ${summary}`);
    assert.equal(rows.mashB.end, 'STRUCK', `${d} mashing B: ${summary}`);
    assert.equal(rows.jump20.end, 'STOMP', `${d} jump at 20: ${summary}`);
    assert.notEqual(rows.jump0.end, 'HIT', `${d} jump at 0: ${summary}`);
    for (const r of Object.values(rows)) if (r.damage >= 0) assert.ok(r.lock >= 0 && r.lock <= r.damage - 9, `${d}: lock ${r.lock}, damage ${r.damage}`);
  }
});

test('sounds: the notice croak (pitch 1.25), the puff at the windup, the leap on its first tick, the landing, the pop of a defeat; the idle croak is quiet and never within 45 ticks of another critter sound', () => {
  const s = facing(240);
  s.step(s.player, 90);
  const at = (name) => s.sfx.find((e) => e.name === name);
  assert.deepEqual([at('frog_croak').state, at('frog_croak').t, at('frog_croak').pitch], ['notice', 0, 1.25]);
  assert.deepEqual([at('frog_puff').state, at('frog_puff').t, at('frog_puff').pitch], ['windup', 0, undefined]);
  assert.deepEqual([at('frog_leap').state, at('frog_leap').t], ['leap', 1]);
  assert.deepEqual([at('frog_land').state, at('frog_land').t], ['leap', FROG.LEAP]);
  for (const e of s.sfx) {
    assert.ok(Number.isFinite(e.pos.x) && Math.abs(e.pos.y - (s.frog.floorY + 60)) < 200, 'at the frog, lifted');
    assert.equal(e.quiet, undefined, 'only idle calls are quiet');
  }
  const f = s.frog;
  s.player.attack = { x: f.x, y: f.y + 30, z: f.z, radius: 40 };
  s.step(s.player);
  assert.equal(s.sfx.at(-1).name, 'frog_pop');
  // Idle croaks with him about (not in their circles): quiet, spaced by the shared gate.
  const k = crew([frogSpot({ id: 'a' }), frogSpot({ id: 'b', x: 1300 }), frogSpot({ id: 'c', x: -1300 })]);
  const p = fakePlayer(0, 0, 1200);
  k.step(p, 1800);
  const croaks = k.sfx.filter((e) => e.name === 'frog_croak');
  assert.ok(croaks.length >= 10, `${croaks.length} idle croaks`);
  let last = -Infinity;
  for (const e of k.sfx) {
    assert.equal(e.quiet, 1);
    assert.ok(e.life - last >= SHARED.SOUND_GAP, `croak at ${e.life}, ${e.life - last} after the last`);
    last = e.life;
  }
  // None with him beyond CROAK_NEAR of them.
  const far = crew([frogSpot()]);
  far.step(fakePlayer(0, 0, FROG.CROAK_NEAR + 300), 1800);
  assert.equal(far.sfx.length, 0);
});

test('bump: walking into a frog he never stands inside it (never closer than 0.8 of arm\'s length while both stand, but in its leap): through its middle, out to its leash\'s rim, against a wall; never hurt; it skips off in a hop rather than being pushed along (a windup called off); a bumped idle frog notices him; one that has just taken his last wedge is pushed off his feet', () => {
  const reach = PLAYER_RADIUS + CRITTER_RIG.frog.BUMP_R;
  const LEASH = 500 + FROG.LEASH;
  // He walks at 8 a tick: on a line through its home and out past its rim (it ends up herded to
  // the rim: its hops away from him there refused), and again toward a wall beside its home (it
  // ends up pinned against the wall); and he runs (24 a tick) out to the rim, catching it in the
  // air. All but the first blinking after a hit, so no strike comes between (a leap lands on his
  // feet).
  for (const [what, collision, yaw, from, dir, stop] of [
    ['through', world(), 0, { x: 0, z: -800 }, { x: 0, z: 8 }, null],
    ['to the rim', world(), 0, { x: 0, z: -100 }, { x: 0, z: 8 }, null],
    ['running to the rim', world(), 0, { x: 0, z: -100 }, { x: 0, z: 24 }, (p) => p.pos.z < 900],
    ['to a wall', world({ wallX: 300 }), Math.PI / 2, { x: -300, z: 0 }, { x: 8, z: 0 }, (p) => p.pos.x < 300 - PLAYER_RADIUS],
  ]) {
    const k = crew([frogSpot({ yaw })], { collision });
    const c = k.critters.list[0];
    const p = fakePlayer(from.x, 0, from.z);
    if (what !== 'through') p.invincibleUntil = Infinity;
    let closest = Infinity;
    let farthest = 0;
    let wallward = -Infinity;
    for (let t = 0; t < 260; t++) {
      p.vel.x = p.vel.z = 0;
      if (!stop || stop(p)) {
        p.pos.x += dir.x;
        p.pos.z += dir.z;
        // (His pace, as the real Player reports it.)
        p.vel.x = dir.x;
        p.vel.z = dir.z;
      }
      const ground = c.n === 0;
      k.step(p);
      if (ground && c.n > 0) assert.ok(Math.hypot(c.tx - c.hx, c.tz - c.hz) <= LEASH + 1e-6, `${what}: a hop for ${Math.hypot(c.tx - c.hx, c.tz - c.hz).toFixed(0)} from home`);
      if (c.state !== 'leap' && c.n === 0 && c.y <= c.floorY + 0.5) closest = Math.min(closest, dist(c, p));
      farthest = Math.max(farthest, Math.hypot(c.x - c.hx, c.z - c.hz));
      wallward = Math.max(wallward, c.x);
    }
    assert.ok(closest >= 0.8 * reach, `${what}: closest ${closest.toFixed(1)}`);
    assert.ok(farthest <= LEASH + 1e-6, `${what}: ${farthest.toFixed(1)} from home`);
    assert.equal(k.critters.hits, 0);
    if (what === 'to the rim') assert.ok(farthest > LEASH - 30, `herded to the rim (${farthest.toFixed(0)})`);
    if (what === 'to a wall') assert.ok(wallward > 300 - CRITTER_RIG.frog.BUMP_R - 10, `pushed up to the wall (${wallward.toFixed(0)})`);
  }
  // Walked into in its windup: it calls the windup off (the token back, a cooldown) and hops off
  // away from him; never slid along the ground while he walks on after it.
  {
    const s = facing(240);
    s.until(s.player, () => s.frog.state === 'windup', 60);
    const f = s.frog;
    let slid = 0;
    let off = -1;
    for (let t = 0; t < 90; t++) {
      s.player.pos.z += 8;
      const x0 = f.x;
      const z0 = f.z;
      const ground = f.n === 0;
      const touching = dist(f, s.player) < reach;
      s.step(s.player);
      if (ground && f.n === 0 && touching) slid += Math.hypot(f.x - x0, f.z - z0);
      if (off < 0 && f.state !== 'windup') {
        off = t;
        assert.equal(f.state, 'approach');
        assert.ok(f.n > 0, 'off in a hop');
        assert.equal(s.critters.attacker, -1, 'the token back');
        assert.equal(f.cooldown, FROG.CANCEL_COOLDOWN - 1, 'a cooldown (one tick of it run)');
      }
    }
    assert.ok(off >= 0, 'called off');
    assert.ok(slid < 1, `slid ${slid.toFixed(0)} along the ground`);
  }
  // A frog whose circle is tiny: he bumps into it idle, outside its circle; it notices him.
  const tiny = crew([frogSpot({ fight: 40, roam: 400 })]);
  const f = tiny.critters.list[0];
  const q = fakePlayer(f.x, 0, f.z - 200);
  let noticed = -1;
  for (let t = 0; t < 40 && noticed < 0; t++) {
    q.pos.z += 8;
    tiny.step(q);
    if (f.state === 'notice') noticed = t;
  }
  assert.ok(noticed >= 0, 'bumped, it noticed him');
  assert.ok(Math.hypot(q.pos.x - f.hx, q.pos.z - f.hz) > 40, 'outside its circle');
  // His last wedge: he dies where he stands (away, no knockback); its leap comes down short of
  // him, and it is pushed off his feet at once.
  {
    const s = facing(240);
    s.player.takeDamage = function () {
      this.action = 'death';
      return true;
    };
    s.until(s.player, () => s.frog.state === 'dazed', 120);
    assert.equal(s.player.action, 'death');
    assert.ok(dist(s.frog, s.player) >= 0.6 * reach, `landed ${dist(s.frog, s.player).toFixed(0)} from him`);
    for (let t = 0; t < 20; t++) {
      s.step(s.player);
      assert.ok(dist(s.frog, s.player) >= 0.8 * reach, `${dist(s.frog, s.player).toFixed(0)} from him dying`);
    }
    assert.equal(s.critters.engaged, 1, 'nothing more (no notice, no hop)');
  }
});

// ---------------------------------------------------------------- the Tin Crab and the Mosquito

// A crab `d` in front of him (north, facing him), the hero standing still at the origin; and a
// mosquito whose home is `d` in front of him (roam 1: it hovers right over its home until it
// sees him). `collision` and `sparkles` go to the crew, the rest to the spot.
function facingCrab(d, { collision = world(), sparkles = null, ...over } = {}) {
  const k = crew([crabSpot({ z: d, yaw: Math.PI, fight: 400, ...over })], { collision, sparkles });
  return { ...k, player: fakePlayer(0, 0, 0), crab: k.critters.list[0] };
}
function facingMosquito(d = 400, { collision = world(), sparkles = null, ...over } = {}) {
  const k = crew([mosquitoSpot({ z: d, yaw: Math.PI, roam: 1, fight: 500, ...over })], { collision, sparkles });
  return { ...k, player: fakePlayer(0, 0, 0), buzz: k.critters.list[0] };
}
// A rig point of a critter in the world now (a copy).
const rigPoint = (critters, c, p) => ({ ...critters._at(c, p[0], p[1], p[2]) });
// Does a sphere at q (radius r) touch his body (a capsule from his feet up)?
const touching = (p, q, r) => Math.hypot(q.x - p.pos.x, q.z - p.pos.z) <= PLAYER_RADIUS + r && q.y >= p.pos.y + SHARED.HERO_LOW - r && q.y <= p.pos.y + SHARED.HERO_HIGH + r;

test("the Tin Crab's tell: from any still-hero distance (120 to 300) at both its sizes it winds up with him 175 to 185 (times its size) away; the tell 24 ticks, its heading locked at tick 14 and held through the pinch; the first damage 24 or more ticks after the windup starts and 9 after the lock, from its claw in front of it, one wedge a pinch, never on the pinch's first tick; its lunge 72 at both sizes; sidestepping from the lock he is not hit", () => {
  for (const scale of [1, 1.25]) {
    for (let d = 120; d <= 300; d += 30) {
      const s = facingCrab(d, { scale });
      s.until(s.player, () => s.crab.state === 'windup', 300);
      assert.equal(s.crab.state, 'windup', `x${scale} from ${d}`);
      const at = dist(s.crab, s.player);
      assert.ok(at >= CRAB.WIN_MIN * scale - 1e-6 && at <= CRAB.WIN_MAX * scale + 1e-6, `x${scale} from ${d}: wound up ${at.toFixed(1)} away`);
    }
    // A whole strike at him standing still (his blink after a hit taken away: only the strike's
    // own rule keeps it to one wedge).
    const s = facingCrab(180 * scale, { scale });
    const c = s.crab;
    const out = { windup: -1, lock: -1, pinch: -1, hits: [], yaws: [] };
    for (let t = 0; t < 200 && c.state !== 'cooldown'; t++) {
      s.player.invincibleUntil = 0;
      const n = s.player.hits.length;
      s.step(s.player);
      if (c.state === 'windup' && out.windup < 0) out.windup = t;
      if (c.state === 'windup' && c.t === CRAB.LOCK) out.lock = t;
      if (c.state === 'pinch' && out.pinch < 0) out.pinch = t;
      if (out.lock >= 0 && (c.state === 'windup' || c.state === 'pinch')) out.yaws.push(c.yaw);
      for (let h = n; h < s.player.hits.length; h++) out.hits.push({ t, pinchT: out.pinch >= 0 ? t - out.pinch : -1, x: c.x, z: c.z, from: s.player.hits[h].from });
    }
    assert.equal(out.lock - out.windup, CRAB.LOCK, 'the lock');
    assert.equal(out.pinch - out.windup, CRAB.WINDUP, 'the tell\'s length');
    assert.ok(out.yaws.every((y) => y === c.lockYaw), 'its heading held from the lock');
    assert.equal(out.hits.length, 1, `x${scale}: one wedge`);
    const h = out.hits[0];
    assert.ok(h.t - out.windup >= 24 && out.lock <= h.t - 9 && h.pinchT >= CRAB.HURT_FROM, `x${scale}: damage ${h.t - out.windup} after the windup (pinch tick ${h.pinchT})`);
    const f = CRAB.CLAW_FRONT * scale;
    assert.ok(Math.hypot(h.from.x - (h.x + Math.sin(c.lockYaw) * f), h.from.z - (h.z + Math.cos(c.lockYaw) * f)) < 1e-6, 'from its claw');
    // Sidestepping at 8 a tick from the lock: no hit.
    const side = facingCrab(180 * scale, { scale });
    for (let t = 0; t < 200 && side.crab.state !== 'cooldown'; t++) {
      if (side.crab.state === 'pinch' || (side.crab.state === 'windup' && side.crab.t >= CRAB.LOCK)) side.player.pos.x += 8;
      side.step(side.player);
    }
    assert.equal(side.player.hits.length, 0, `x${scale}: sidestepped`);
    // The lunge: 72 along its heading over the pinch, at every size (where the fairness rows
    // were measured); and only its ticks HURT_FROM on hurt: him right in front of its claw as
    // the pinch starts, he is not hurt on its first tick (touching it), and is on its second.
    {
      const q = facingCrab(180 * scale, { scale });
      const k = q.crab;
      q.until(q.player, () => k.state === 'pinch', 200);
      const at = { x: k.x, z: k.z };
      // (He steps in front of its claw, where it will be on the pinch's first tick.)
      const ahead = (CRAB.CLAW_FRONT + 10) * scale + CRAB.PINCH_SPEED;
      Object.assign(q.player.pos, { x: k.x + Math.sin(k.lockYaw) * ahead, z: k.z + Math.cos(k.lockYaw) * ahead });
      q.step(q.player);
      assert.equal(k.t, 1);
      const claw = { x: k.x + Math.sin(k.lockYaw) * CRAB.CLAW_FRONT * scale, y: k.y + (CRAB.CLAW_Y + q.critters._rise(k)) * scale, z: k.z + Math.cos(k.lockYaw) * CRAB.CLAW_FRONT * scale };
      assert.ok(touching(q.player, claw, CRAB.CLAW_R * scale), 'his body in its claw');
      assert.equal(q.player.hits.length, 0, `x${scale}: not on pinch tick 1`);
      q.step(q.player);
      assert.equal(q.player.hits.length, 1, `x${scale}: hurt on pinch tick ${CRAB.HURT_FROM}`);
      q.player.pos.z = -5000;
      q.until(q.player, () => k.state !== 'pinch', 10);
      assert.ok(Math.abs(Math.hypot(k.x - at.x, k.z - at.z) - 72) < 1e-6 && CRAB.PINCH * CRAB.PINCH_SPEED === 72, `x${scale}: lunged ${Math.hypot(k.x - at.x, k.z - at.z).toFixed(1)}`);
    }
  }
});

test("the Mosquito's chase and aim: with him standing still 400 away it flies in (at up to 9 a tick) and parks, its aim starting 220 ± 20 from him; from any still distance it aims only 200 to 240 from him (never from nearer); with his feet off its level no tell at all; T (his feet) and its heading lock on aim tick 1, the ring there from then to the dive's end (growing from MARK_FROM to 2 MARK_R); it rises 80 and draws back 40 from T; the first damage 24 or more ticks after the aim starts and 9 after the lock", () => {
  const s = facingMosquito(400);
  const b = s.buzz;
  const out = { aim: -1, lock: -1, end: -1, hits: [], at: -1, marks: [], sizes: [] };
  let parked = 0;
  let fastest = 0;
  for (let t = 0; t < 200 && out.end < 0; t++) {
    const was = b.state;
    const x0 = b.x;
    const z0 = b.z;
    s.step(s.player);
    if (b.state === 'chase' && b.x === x0 && b.z === z0) parked++;
    if (b.state === 'chase') fastest = Math.max(fastest, Math.hypot(b.x - x0, b.z - z0));
    if (b.state === 'aim' && out.aim < 0) {
      out.aim = t;
      out.at = dist(b, s.player);
    }
    if (b.markOn === 1 && out.lock < 0) out.lock = t;
    if (out.lock >= 0) {
      out.marks.push(b.markOn === 1 ? { x: b.tx, z: b.tz } : null);
      if (b.markOn === 1) out.sizes.push(markerSize(s.critters, 1, t / 30));
    }
    if (was === 'aim' && b.t >= 12 && b.state === 'aim') {
      assert.ok(Math.abs(b.y - b.sy0 - MOSQUITO.AIM_UP) < 1e-6, 'risen 80');
      assert.ok(Math.abs(Math.hypot(b.x - b.tx, b.z - b.tz) - Math.hypot(b.sx0 - b.tx, b.sz0 - b.tz) - MOSQUITO.AIM_BACK) < 1e-6, 'drawn back 40');
    }
    if (s.player.hits.length > out.hits.length) out.hits.push(t);
    if (was === 'dive' && b.state !== 'dive') out.end = t;
  }
  assert.ok(parked >= 1, 'it parked first');
  assert.ok(Math.abs(fastest - 9) < 1e-6, `it flies in at up to 9 a tick (${fastest.toFixed(2)})`);
  assert.ok(Math.abs(out.at - 220) <= 20, `aimed ${out.at.toFixed(1)} away`);
  assert.equal(out.lock - out.aim, 1, 'T locked on aim tick 1');
  assert.equal(out.hits.length, 1);
  assert.ok(out.hits[0] - out.aim >= 24 && out.lock <= out.hits[0] - 9, `damage ${out.hits[0] - out.aim} after the aim started`);
  assert.ok(out.marks.slice(0, out.end - out.lock).every((m) => m && Math.hypot(m.x, m.z) < 1e-9), 'the ring at his feet from the lock to the dive\'s end');
  assert.equal(out.marks.at(-1), null, 'gone after');
  assert.ok(Math.abs(out.sizes[0] - MOSQUITO.MARK_FROM) < 1e-6 && Math.abs(out.sizes.at(-1) - 2 * MOSQUITO.MARK_R) < 1e-6, `the ring ${out.sizes[0]} .. ${out.sizes.at(-1)}`);
  assert.ok(MOSQUITO.MARK_FROM >= 100, 'well over his shadow');
  // From any still distance: aims only 200 to 240 from him (the plan's window, where every
  // fairness row was measured); nearer (100, 140, 180: it never backs off) it just hovers.
  assert.deepEqual([MOSQUITO.WIN_MIN, MOSQUITO.WIN_MAX], [200, 240]);
  let aims = 0;
  for (let d = 100; d <= 460; d += 40) {
    const q = facingMosquito(d);
    let n = 0;
    for (let t = 0; t < 300; t++) {
      const was = q.buzz.state;
      q.step(q.player);
      q.player.invincibleUntil = 0;
      if (q.buzz.state === 'aim' && was !== 'aim') {
        n++;
        const at = dist(q.buzz, q.player);
        assert.ok(at >= 200 && at <= 240, `from ${d}: aimed ${at.toFixed(1)} away`);
      }
    }
    if (d < 200) assert.equal(n, 0, `from ${d}: it never aims`);
    aims += n;
  }
  assert.ok(aims >= 8, `${aims} aims`);
  // His feet off its level (a ledge 60 up: on its level for the chase, not for T, LEVEL_DY 40):
  // it parks but never starts its tell (no aim sound, no token), looking again now and then.
  const ledge = facingMosquito(400, { collision: world({ ledge: { x0: -200, x1: 200, z0: -200, z1: 100, y: 60 } }) });
  Object.assign(ledge.player.pos, { y: 60 });
  ledge.player.floor = { y: 60, surface: {} };
  ledge.step(ledge.player, 300);
  assert.equal(ledge.buzz.state, 'chase', 'parked');
  assert.ok(dist(ledge.buzz, ledge.player) >= 200 && dist(ledge.buzz, ledge.player) <= 240, 'in its window');
  assert.ok(SEEN.mosquito.has('aim'));
  assert.deepEqual(ledge.sfx.filter((e) => e.name === 'mosquito_aim'), [], 'no tell');
  assert.equal(ledge.critters.attacker, -1);
});

test("the Mosquito's needle hurts only low over the floor and only on the marked spot: on the ring, the tip touching him higher up does not hurt, he is hit once it is at most TIP_HURT up; 170 from T toward it, under the dive line (the tip passes him low, inside his body: without the gate a hit), he is not, and it sticks in the turf by T; a punch just past its needle's tip wins while it dives, not while it aims", () => {
  // He steps to `off` from T toward it once T has locked; the dive's ticks: the tip, whether it
  // touches him, his hits.
  const dive = (off) => {
    const s = facingMosquito(400);
    const b = s.buzz;
    const ticks = [];
    s.until(s.player, () => b.state === 'aim' && b.t === 2, 200);
    const ux = b.x - b.tx;
    const uz = b.z - b.tz;
    const l = Math.hypot(ux, uz);
    Object.assign(s.player.pos, { x: b.tx + (ux / l) * off, z: b.tz + (uz / l) * off });
    s.until(s.player, () => b.state === 'dive', 40);
    while (b.state === 'dive') {
      const n = s.player.hits.length;
      s.step(s.player);
      const tip = rigPoint(s.critters, b, CRITTER_RIG.mosquito.NEEDLE_TIP);
      ticks.push({ state: b.state, tip, touch: touching(s.player, tip, MOSQUITO.TIP_R), hit: s.player.hits.length > n });
    }
    return { s, b, ticks };
  };
  {
    const { ticks } = dive(MOSQUITO.MARK_R + PLAYER_RADIUS - 5);
    const hit = ticks.findIndex((k) => k.hit);
    assert.ok(hit >= 0, 'hit on the ring\'s edge');
    // (The hit's tick ends the dive: its tip there is the last place drawn before it bounced.)
    assert.ok(ticks.slice(0, hit).some((k) => k.touch && k.tip.y > MOSQUITO.TIP_HURT), 'touching him higher up first, unhurt');
    for (const k of ticks.slice(0, hit)) assert.ok(!(k.touch && k.tip.y <= MOSQUITO.TIP_HURT), 'never touching him low without the hit');
  }
  {
    const { s, b, ticks } = dive(170);
    assert.equal(s.player.hits.length, 0, 'off the ring: not hit');
    assert.ok(ticks.some((k) => k.touch && k.tip.y <= MOSQUITO.TIP_HURT), 'the tip passed him low, inside his body');
    assert.equal(b.state, 'stuck');
    const tip = rigPoint(s.critters, b, CRITTER_RIG.mosquito.NEEDLE_TIP);
    assert.ok(Math.hypot(tip.x - b.tx, tip.z - b.tz) < 30 && tip.y < b.ty, 'stuck in the turf by T');
  }
  // A punch just past the needle's tip (30 beyond it along the needle, radius 35): out of reach
  // of its body and the needle's middle, so it misses while it aims, and wins while it dives.
  const past = (s, b) => {
    const tip = rigPoint(s.critters, b, CRITTER_RIG.mosquito.NEEDLE_TIP);
    const mid = rigPoint(s.critters, b, CRITTER_RIG.mosquito.NEEDLE_MID);
    const l = Math.hypot(tip.x - mid.x, tip.y - mid.y, tip.z - mid.z);
    return { x: tip.x + ((tip.x - mid.x) / l) * 30, y: tip.y + ((tip.y - mid.y) / l) * 30, z: tip.z + ((tip.z - mid.z) / l) * 30, radius: 35 };
  };
  for (const [state, t, want] of [['aim', 14, 'aim'], ['dive', 2, 'deflate']]) {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === state && b.t === t, 200);
    s.player.attack = past(s, b);
    s.step(s.player);
    assert.equal(b.state, want, `punched past its tip in its ${state}`);
  }
  // The struck capsule itself, in one pose: diving it runs on to the needle's tip (an attack just
  // past the tip strikes it), aiming only to the needle's middle (the same attack misses).
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === 'dive' && b.t === 1, 200);
    const atk = past(s, b);
    assert.equal(s.critters._struck(b, atk), true, 'diving: struck at its tip');
    b.state = 'aim';
    assert.equal(s.critters._struck(b, atk), false, 'aiming: not');
    b.state = 'dive';
  }
});

test('every live state of the crab and the mosquito falls to one punch (the crab hidden, sidling, winding up, pinching, stuck; the mosquito patrolling, chasing, aiming, diving, stuck); a stomp on either is a plain bounce (bounce(undefined)) and squashes it: the crab dented, the mosquito splatted (poofing right there), each with one coin after the poof, 11 ticks after the stomp (while the camera following his bounce still has it in view)', () => {
  const punch = (s, c) => {
    s.player.attack = { x: c.x, y: c.y + 30, z: c.z, radius: 40 };
    s.step(s.player);
    s.player.attack = null;
  };
  for (const [state, t] of [['hidden', 0], ['wake', 3], ['strafe', 2], ['windup', 5], ['pinch', 2], ['stuck', 5], ['cooldown', 5]]) {
    const s = facingCrab(state === 'strafe' ? 300 : 180);
    if (state === 'hidden') s.player.pos.z = -2000;
    else s.until(s.player, () => s.crab.state === state && s.crab.t >= t, 200);
    s.player.invincibleUntil = 1e9;
    assert.equal(s.crab.state, state);
    punch(s, s.crab);
    assert.equal(s.crab.state, 'tumble', `struck while ${state}`);
  }
  for (const [state, t] of [['patrol', 0], ['spot', 3], ['chase', 2], ['aim', 5], ['dive', 2], ['stuck', 5]]) {
    const s = facingMosquito(state === 'chase' ? 480 : 400);
    const b = s.buzz;
    if (state === 'patrol') s.player.pos.z = -3000;
    else if (state === 'stuck') {
      s.until(s.player, () => b.state === 'aim' && b.t === 2, 200);
      s.player.pos.x = 300;
      s.until(s.player, () => b.state === 'stuck' && b.t >= t, 60);
    } else s.until(s.player, () => b.state === state && b.t >= t, 200);
    s.player.invincibleUntil = 1e9;
    assert.equal(b.state, state);
    punch(s, b);
    assert.equal(b.state, 'deflate', `struck while ${state}`);
    if (state !== 'patrol') continue;
    // Off like a balloon let go from its hover: still in the air as it has deflated, it falls to
    // its floor and poofs there, its coin on the floor.
    const seen = new Set();
    for (let t = 0; t < 120 && b.state !== 'gone'; t++) {
      s.step(s.player);
      seen.add(b.state);
    }
    assert.deepEqual([...seen], ['deflate', 'fall', 'poof', 'gone']);
    assert.equal(s.coins.length, 1);
    assert.ok(Math.abs(s.coins[0].y - b.hy) < 1e-9, 'its coin on its floor');
  }
  // Stomps: falling onto its top (the crab hidden in its tin, then standing; the mosquito
  // hovering, high over its floor).
  const stomp = (s, c, top) => {
    Object.assign(s.player.pos, { x: c.x + 20, y: top - 5, z: c.z });
    s.player.vel.y = -12;
    s.player.action = 'freefall';
    Object.assign(s.hero, { y: top + 10, vy: -12, air: true });
    s.step(s.player);
    s.player.pos.y += 2000;
    s.player.vel.y = 0;
  };
  const R = CRITTER_RIG;
  for (const standing of [false, true]) {
    const s = facingCrab(180, { scale: 1.25, stand: 40 });
    const c = s.crab;
    if (standing) s.until(s.player, () => c.state === 'strafe', 60);
    else s.player.pos.z = -2000;
    const rise = R.crab.LIFT_SPAN * (c.b1 - 1);
    assert.ok(standing ? Math.abs(rise - 40 / 1.25) < 1 : Math.abs(rise - (40 / 1.25 - R.crab.LIFT_SPAN)) < 1e-9, `its lift ${rise}`);
    stomp(s, c, c.y + (R.crab.TOP + rise) * c.scale);
    assert.deepEqual(s.player.bounces, [undefined], 'a plain bounce');
    assert.equal(c.state, 'dent');
    const stomped = s.critters.life;
    s.step(s.player, 40);
    assert.equal(c.state, 'gone');
    assert.equal(s.coins.length, 1);
    assert.equal(s.coins[0].life - stomped, CRAB.DENT + SHARED.POOF, 'its coin');
    assert.ok(CRAB.DENT + SHARED.POOF <= 12, 'soon');
  }
  const s = facingMosquito(400);
  const b = s.buzz;
  s.player.pos.z = -3000;
  s.step(s.player, 5);
  stomp(s, b, b.y + R.mosquito.TOP);
  assert.deepEqual(s.player.bounces, [undefined], 'a plain bounce');
  assert.equal(b.state, 'splat');
  const stomped = s.critters.life;
  const y0 = b.y;
  const seen = new Set();
  for (let t = 0; t < 80 && b.state !== 'gone'; t++) {
    s.step(s.player);
    seen.add(b.state);
    assert.ok(b.y >= y0, 'poofing where it was (no fall)');
  }
  assert.deepEqual([...seen], ['splat', 'poof', 'gone']);
  assert.equal(s.coins.length, 1);
  assert.ok(Math.abs(s.coins[0].y - b.hy) < 1e-9, 'its coin on its floor');
  assert.equal(s.coins[0].life - stomped, MOSQUITO.SPLAT + SHARED.POOF, 'its coin');
  assert.ok(MOSQUITO.SPLAT + SHARED.POOF <= 12, 'soon');
});

test('moving: a crab never sidles into the water (at a wading spot: over 95 deep) or off a drop, nor past fight + 40 from home; a mosquito never flies past fight + 100, slides along a wall, and never backs off: walking in on it from 400 to 150 it never moves away from him, and once he is within 230 of it, it hovers where it is', () => {
  // He walks a loop round the crab's circle (blinking: no strikes in between), the water, a
  // pool 30 deep over the same level floor, a 150 drop, or (wading) water 100 deep past a 10 step
  // down, beyond its edge; a wading crab walks into a pool 60 deep.
  for (const [what, collision, over, ok, wets] of [
    ['water', world({ waterFromX: 100 }), {}, (c) => c.x < 100],
    ['pool', world({ pool: { x: 100, depth: 30 } }), {}, (c) => c.x < 100],
    ['drop', world({ drop: { z: 180, side: 1, depth: 150 } }), {}, (c) => c.z < 180],
    ['deep wading', world({ wade: 90, drop: { z: 180, side: 1, depth: 10 } }), { wade: true }, (c) => c.z < 180],
    ['wading pool', world({ pool: { x: 100, depth: 60 } }), { wade: true }, () => true, (c) => c.x > 100],
  ]) {
    const k = crew([crabSpot(over)], { collision });
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, 0);
    p.invincibleUntil = Infinity;
    let walked = 0;
    let wet = 0;
    for (let t = 0; t < 1500; t++) {
      const a = t / 70;
      p.pos.x = 300 * Math.sin(a);
      p.pos.z = 300 * Math.cos(a * 1.3);
      const x0 = c.x;
      const z0 = c.z;
      k.step(p);
      walked += Math.hypot(c.x - x0, c.z - z0);
      if (wets && wets(c)) wet++;
      assert.ok(ok(c) && c.y === 0, `${what}: (${c.x.toFixed(0)}, ${c.y}, ${c.z.toFixed(0)}) at tick ${t}`);
      assert.ok(Math.hypot(c.x - c.hx, c.z - c.hz) <= 330 + CRAB.LEASH + 1e-6, `${what}: in its leash`);
    }
    assert.ok(walked > 1000, `${what}: it sidled ${walked.toFixed(0)}`);
    if (wets) assert.ok(wet > 50, `${what}: it waded in (${wet} ticks)`);
  }
  // A wading crab knocked over toward deep water (160 deep past z 30, beyond a drop of 100):
  // it tumbles no further than where it may wade (glancing off along the edge, away from him),
  // and its coin floats where he picks it up standing in the shallows (CoinField: feet - 40 ..
  // feet + 200).
  {
    const k = crew([crabSpot({ wade: true })], { collision: world({ wade: 60, drop: { z: 30, side: 1, depth: 100 } }) });
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, -120);
    p.invincibleUntil = Infinity;
    k.step(p);
    p.attack = { x: c.x, y: 30, z: c.z - 20, radius: 40 };
    k.step(p);
    p.attack = null;
    assert.equal(c.state, 'tumble');
    for (let t = 0; t < 60 && c.state !== 'gone'; t++) {
      k.step(p);
      assert.ok(c.z < 30 && c.floorY === 0, `in the shallows: ${c.z.toFixed(0)}, floor ${c.floorY}`);
    }
    assert.ok(c.z > 10, `it tumbled to the edge (${c.z.toFixed(0)})`);
    assert.ok(Math.abs(c.x) > 10, `and glanced off along it (${c.x.toFixed(0)})`);
    assert.equal(k.coins.length, 1);
    const y = Math.max(k.coins[0].y + 60, k.coins[0].minY);
    assert.ok(y - 0 >= -40 && y - 0 <= 200, `his feet on its floor reach its coin at ${y}`);
  }
  // The mosquito: he runs out to its circle's rim and round and back in again (no strikes).
  {
    const s = facingMosquito(0, { fight: 400 });
    const b = s.buzz;
    s.player.invincibleUntil = Infinity;
    for (let t = 0; t < 1500; t++) {
      const a = t / 50;
      const r = 300 + 170 * Math.sin(t / 37);
      Object.assign(s.player.pos, { x: r * Math.sin(a), z: r * Math.cos(a) });
      s.step(s.player);
      assert.ok(Math.hypot(b.x - b.hx, b.z - b.hz) <= 400 + MOSQUITO.LEASH + 1e-6, `in its leash at tick ${t}`);
    }
    assert.ok(SEEN.mosquito.has('chase'));
  }
  // Driven to its leash: he stands far out (900 from its home, so its stand point lies 680 out)
  // for 19 ticks at a time, one tick back inside fight + 80 between (so it is never let go): it
  // chases him out to its leash (fight + 100) and never past it.
  {
    const s = facingMosquito(0, { fight: 400 });
    const b = s.buzz;
    s.player.invincibleUntil = Infinity;
    s.player.pos.z = 300;
    s.until(s.player, () => b.state === 'chase', 30);
    let far = 0;
    for (let t = 0; t < 400; t++) {
      s.player.pos.z = t % 20 === 19 ? 470 : 900;
      s.step(s.player);
      const h = Math.hypot(b.x - b.hx, b.z - b.hz);
      assert.ok(h <= 400 + MOSQUITO.LEASH + 1e-6, `${h.toFixed(1)} from home at tick ${t}`);
      far = Math.max(far, h);
    }
    assert.ok(far > 400 + MOSQUITO.LEASH - 1, `out to its leash (${far.toFixed(1)})`);
    assert.equal(b.state, 'chase', 'still after him');
  }
  // A wall (x 150, facing -x) between it and him: it flies up against the wall and slides along it.
  {
    const s = facingMosquito(0, { collision: world({ wallX: 150 }) });
    const b = s.buzz;
    s.player.invincibleUntil = Infinity;
    Object.assign(s.player.pos, { x: 380, z: 0 });
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let t = 0; t < 400; t++) {
      if (t > 60) s.player.pos.z = 250 * Math.sin((t - 60) / 40);
      s.step(s.player);
      assert.ok(b.x <= 150 - MOSQUITO.WALL_R + 1e-6, `out of the wall: ${b.x.toFixed(1)}`);
      if (t > 60) {
        zMin = Math.min(zMin, b.z);
        zMax = Math.max(zMax, b.z);
      }
    }
    assert.ok(b.x > 150 - MOSQUITO.WALL_R - 5 && zMax - zMin > 200, `slid along it: x ${b.x.toFixed(1)}, z ${zMin.toFixed(0)} .. ${zMax.toFixed(0)}`);
  }
  // He walks in on it from 400 to 150 at 8 a tick (blinking: no aim): it never moves away from
  // him, and once he is within CHASE_FROM it stays put.
  {
    const s = facingMosquito(400, { fight: 410 });
    const b = s.buzz;
    s.player.invincibleUntil = Infinity;
    let close = 0;
    for (let z = 0; z <= 250; z += 8) {
      s.player.pos.z = z;
      const x0 = b.x;
      const z0 = b.z;
      const near = dist(b, s.player) <= MOSQUITO.CHASE_FROM;
      s.step(s.player);
      if (b.state === 'patrol') continue;
      const ax = x0 - s.player.pos.x;
      const az = z0 - s.player.pos.z;
      const away = ((b.x - x0) * ax + (b.z - z0) * az) / Math.hypot(ax, az);
      assert.ok(away <= 1e-9, `moved ${away.toFixed(2)} away from him`);
      if (near) {
        close++;
        assert.ok(b.x === x0 && b.z === z0, 'hovering where it is');
      }
    }
    for (let t = 0; t < 60; t++) {
      const x0 = b.x;
      const z0 = b.z;
      s.step(s.player);
      assert.ok(b.x === x0 && b.z === z0, 'still where it is');
    }
    assert.ok(close >= 10 && dist(b, s.player) < 200, `${close} ticks with him within reach, now ${dist(b, s.player).toFixed(0)} from him`);
  }
});

test('away and hold for the crab and the mosquito: a windup or an aim under way is called off when he goes away (token back, cooldown 30), and a pinch or a dive in flight does no damage', () => {
  for (const [what, make, tell, strike] of [
    ['crab', () => facingCrab(180), 'windup', 'pinch'],
    ['mosquito', () => facingMosquito(400), 'aim', 'dive'],
  ]) {
    {
      const s = make();
      const c = s.critters.list[0];
      s.until(s.player, () => c.state === tell && c.t === 5, 200);
      assert.equal(s.critters.attacker, 0, `${what}: the token taken`);
      s.player.action = 'reading';
      s.step(s.player);
      assert.notEqual(c.state, tell, `${what}: called off`);
      assert.equal(s.critters.attacker, -1, `${what}: token back`);
      assert.ok(c.cooldown >= 29, `${what}: cooldown ${c.cooldown}`);
      assert.equal(c.markOn, 0);
    }
    {
      const s = make();
      const c = s.critters.list[0];
      s.until(s.player, () => c.state === strike, 200);
      s.player.action = 'reading';
      s.step(s.player, 20);
      assert.equal(s.player.hits.length, 0, `${what}: no damage in flight`);
    }
  }
});

test('the crab and the mosquito sound: the crab clacks as it wakes (ticks 0 and 6) and through its windup (ticks 0, 6, 12, 18), snaps at pinch tick 2, goes tonk when defeated; the mosquito whines (pitch 1.3) as it spots him, sounds its aim at aim tick 0 and its dive at dive tick 0, a doinng at stuck ticks 0, 20 and 40 (quiet after the first) and a thwop (pitch 1.6) as it pulls free 60 ticks in, pops (deflating when punched); its idle whine is rare and quiet: at most 10 in a minute with him 1000 from its home, none at 1500', () => {
  const at = (sfx, name) => sfx.filter((e) => e.name === name).map((e) => [e.state, e.t, e.pitch ?? 1, e.quiet ?? 0, e.deflate ?? 0]);
  {
    const s = facingCrab(180);
    s.until(s.player, () => s.crab.state === 'cooldown', 200);
    assert.deepEqual(at(s.sfx, 'crab_clack'), [['wake', 0, 1, 0, 0], ['wake', 6, 1, 0, 0], ['windup', 0, 1, 0, 0], ['windup', 6, 1, 0, 0], ['windup', 12, 1, 0, 0], ['windup', 18, 1, 0, 0]]);
    assert.deepEqual(at(s.sfx, 'crab_snap'), [['pinch', CRAB.HURT_FROM, 1, 0, 0]]);
    s.player.attack = { x: s.crab.x, y: 30, z: s.crab.z, radius: 40 };
    s.step(s.player);
    assert.deepEqual(at(s.sfx, 'crab_tonk'), [['tumble', 0, 1, 0, 0]]);
  }
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === 'aim' && b.t === 2, 200);
    s.player.pos.x = 300;
    s.until(s.player, () => b.state === 'cooldown', 200);
    assert.deepEqual(at(s.sfx, 'mosquito_whine'), [['spot', 0, 1.3, 0, 0]]);
    assert.deepEqual(at(s.sfx, 'mosquito_aim'), [['aim', 0, 1, 0, 0]]);
    assert.deepEqual(at(s.sfx, 'mosquito_dive'), [['dive', 0, 1, 0, 0]]);
    assert.deepEqual(at(s.sfx, 'mosquito_stuck'), [['stuck', 0, 1, 0, 0], ['stuck', 20, 1, 1, 0], ['stuck', 40, 1, 1, 0], ['pull', 0, 1.6, 0, 0]]);
    const stuck = s.sfx.filter((e) => e.name === 'mosquito_stuck');
    assert.equal(stuck[3].life - stuck[0].life, 60, 'stuck 60 ticks (the counter window)');
    s.player.attack = { x: b.x, y: b.y, z: b.z, radius: 40 };
    s.step(s.player);
    assert.deepEqual(at(s.sfx, 'mosquito_pop'), [['deflate', 0, 1, 0, 1]]);
    for (const e of s.sfx) assert.ok(Math.abs(e.pos.y - b.y - 60) < 400, 'at it, lifted');
  }
  // The idle whine: with him still 1000 from its home (it patrols within 160 of it), quiet, at
  // most 10 in 1800 ticks; at 1500, none.
  const idle = (d) => {
    const k = crew([mosquitoSpot()]);
    k.step(fakePlayer(0, 0, d), 1800);
    return k.sfx;
  };
  const whines = idle(1000);
  assert.ok(whines.length >= 3 && whines.length <= 10, `${whines.length} idle whines`);
  for (const e of whines) assert.deepEqual([e.name, e.quiet, e.state], ['mosquito_whine', 1, 'patrol']);
  assert.deepEqual(idle(1500), []);
});

test('bump: walking into a crab (hidden: it wakes; or after him) or a stuck mosquito he never stands inside it (never nearer than 0.8 of PLAYER_RADIUS + its BUMP_R, times its size; a stuck mosquito\'s STUCK_R); never hurt; a pinching crab and an aiming or diving mosquito are never pushed, a hovering one only once his body reaches it (his head over its underside)', () => {
  // He walks at it, wherever it is, until it is pressed against its leash's rim (pushed straight
  // out it would leave its leash, so it slides round him), then back out of its circle. It moves
  // at most BUMP_STEP a tick more than his pace (plus its own sidling): never a jump.
  for (const scale of [1, 1.25]) {
    const k = crew([crabSpot({ scale })]);
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, -600);
    p.invincibleUntil = Infinity;
    const reach = PLAYER_RADIUS + CRITTER_RIG.crab.BUMP_R * scale;
    const most = SHARED.BUMP_STEP + 8 + Math.hypot(CRAB.SIDE_SPEED, CRAB.IN_SPEED) * scale;
    let closest = Infinity;
    let woke = false;
    let farthest = 0;
    let fastest = 0;
    for (let t = 0; t < 400; t++) {
      const l = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
      p.vel.x = t < 250 ? (8 * (c.x - p.pos.x)) / l : 0;
      p.vel.z = t < 250 ? (8 * (c.z - p.pos.z)) / l : -8;
      p.pos.x += p.vel.x;
      p.pos.z += p.vel.z;
      const x0 = c.x;
      const z0 = c.z;
      k.step(p);
      if (c.state === 'wake') woke = true;
      closest = Math.min(closest, dist(c, p));
      farthest = Math.max(farthest, Math.hypot(c.x - c.hx, c.z - c.hz));
      fastest = Math.max(fastest, Math.hypot(c.x - x0, c.z - z0));
    }
    assert.ok(woke, 'bumped awake');
    // (Even pressed against its rim: it slides round him a little each tick, the least turn it
    // may take, so it keeps nearly arm's length.)
    assert.ok(closest >= 0.95 * reach, `x${scale}: closest ${closest.toFixed(1)} (reach ${reach})`);
    assert.ok(farthest > 330 + CRAB.LEASH - 5, `x${scale}: pressed to its rim (${farthest.toFixed(0)})`);
    assert.ok(fastest <= most + 1e-6, `x${scale}: at most ${fastest.toFixed(1)} a tick (${most.toFixed(1)})`);
    assert.equal(k.critters.hits, 0);
  }
  // A stuck mosquito: he walks into it from where he stood.
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === 'aim' && b.t === 2, 200);
    s.player.pos.x = 300;
    s.until(s.player, () => b.state === 'stuck', 60);
    s.player.invincibleUntil = Infinity;
    const reach = PLAYER_RADIUS + CRITTER_RIG.mosquito.STUCK_R;
    const x0 = b.x;
    let closest = Infinity;
    for (let t = 0; t < 50 && b.state === 'stuck'; t++) {
      const dx = b.x - s.player.pos.x;
      const dz = b.z - s.player.pos.z;
      const l = Math.hypot(dx, dz);
      s.player.pos.x += (dx / l) * 8;
      s.player.pos.z += (dz / l) * 8;
      s.step(s.player);
      if (b.state === 'stuck') closest = Math.min(closest, dist(b, s.player));
    }
    assert.ok(closest >= 0.8 * reach, `closest ${closest.toFixed(1)}`);
    assert.ok(Math.abs(b.x - x0) > 20, 'pushed aside');
  }
  // Never pushed mid-strike, nor in the mosquito's aim: the hero right on it (his feet `y` under
  // its origin), the bump does nothing.
  const still = (s, c, y = 0) => {
    Object.assign(s.player.pos, { x: c.x + 10, y: c.y - y, z: c.z });
    s.critters.player = s.player;
    s.critters.heroFloorY = 0;
    s.critters.away = false;
    const x0 = c.x;
    const z0 = c.z;
    s.critters._bump(c);
    return c.x === x0 && c.z === z0;
  };
  {
    const s = facingCrab(180);
    s.until(s.player, () => s.crab.state === 'pinch', 200);
    assert.ok(still(s, s.crab), 'a pinching crab');
  }
  for (const state of ['aim', 'dive']) {
    const s = facingMosquito(400);
    s.until(s.player, () => s.buzz.state === state, 200);
    assert.ok(still(s, s.buzz, 100), `a mosquito in its ${state}`);
  }
  // Hovering: pushed once his head reaches its underside (UNDER below its origin), not while it
  // is still over his head; out to PLAYER_RADIUS + BUMP_R (short of its stomp reach).
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.player.pos.z = -3000;
    s.until(s.player, () => b.state === 'patrol', 5);
    const R = CRITTER_RIG.mosquito;
    assert.ok(still(s, b, SHARED.HERO_HIGH + R.UNDER + 1), 'his head under it');
    assert.ok(!still(s, b, SHARED.HERO_HIGH + R.UNDER - 1), 'his head into it');
    assert.ok(PLAYER_RADIUS + R.BUMP_R < PLAYER_RADIUS + R.STOMP_REACH, 'pushed short of its stomp reach');
  }
});

test('fairness (the real Player): the crab at both sizes and both ends of its window (175 and 185 times its size): standing still he is hit; a sidestep (half or full stick) 18 ticks into the tell is never hit; walking in mashing B he knocks it over first. The mosquito, its aim started where it parks: standing still he is hit; a sidestep at 18 leaves it stuck in the turf; walking in mashing B it is struck or stuck, never hitting him; mashing B where he stands he swats it; a jump 4 ticks into the aim is never hit, one at 12 stomps it. The lock always at least 9 ticks before any hit', () => {
  const lockOk = (rows, what) => {
    for (const r of Object.values(rows)) if (r.damage >= 0) assert.ok(r.lock >= 0 && r.lock <= r.damage - 9, `${what}: lock ${r.lock}, damage ${r.damage}`);
  };
  for (const scale of [1, 1.25]) {
    for (const d of [CRAB.WIN_MIN, CRAB.WIN_MAX]) {
      const spot = crabSpot({ z: d * scale, yaw: Math.PI, scale, fight: 400 });
      const rows = {
        still: dodge(spot, () => ({})),
        half18: dodge(spot, (t) => (t < 18 ? {} : { stickX: 0.5 })),
        full18: dodge(spot, (t) => (t < 18 ? {} : { stickX: 1 })),
        mashB: dodge(spot, (t) => ({ stickY: 0.6, B: t % 5 === 0 })),
      };
      const what = `crab x${scale} at ${d}`;
      const summary = JSON.stringify(rows);
      assert.ok(Math.abs(rows.still.at - d * scale) < 1, `${what}: wound up ${rows.still.at}`);
      assert.equal(rows.still.end, 'HIT', `${what} still: ${summary}`);
      assert.notEqual(rows.half18.end, 'HIT', `${what} half sidestep: ${summary}`);
      assert.notEqual(rows.full18.end, 'HIT', `${what} full sidestep: ${summary}`);
      assert.equal(rows.mashB.end, 'STRUCK', `${what} mashing B: ${summary}`);
      lockOk(rows, what);
    }
  }
  const spot = mosquitoSpot({ z: 400, yaw: Math.PI, fight: 500 });
  const rows = {
    still: dodge(spot, () => ({})),
    side18: dodge(spot, (t) => (t < 18 ? {} : { stickX: 1 })),
    mashB: dodge(spot, (t) => ({ stickY: 0.6, B: t % 5 === 0 })),
    stillMashB: dodge(spot, (t) => ({ B: t % 5 === 0 })),
    jump4: dodge(spot, (t) => (t < 4 ? {} : { stickY: 0.5, A: t < 21 })),
    jump12: dodge(spot, (t) => (t < 12 ? {} : { stickY: 0.5, A: t < 29 })),
  };
  const summary = JSON.stringify(rows);
  assert.ok(Math.abs(rows.still.at - 220) <= 20, `aimed ${rows.still.at}`);
  assert.equal(rows.still.end, 'HIT', `still: ${summary}`);
  assert.equal(rows.side18.end, 'STUCK', `sidestep: ${summary}`);
  assert.ok(rows.mashB.end === 'STRUCK' || rows.mashB.end === 'STUCK', `mashing B: ${summary}`);
  assert.equal(rows.stillMashB.end, 'STRUCK', `mashing B where he stands: ${summary}`);
  assert.notEqual(rows.jump4.end, 'HIT', `jump at 4: ${summary}`);
  assert.equal(rows.jump12.end, 'STOMP', `jump at 12: ${summary}`);
  lockOk(rows, 'mosquito');
});

test('let go: 20 ticks after he leaves fight + 80 the crab sidles home and hides in its tin there, the mosquito flies back onto its patrol curve (an aim under way called off)', () => {
  {
    const s = facingCrab(300);
    const c = s.crab;
    s.until(s.player, () => c.state === 'strafe' && c.t === 20, 200);
    const away = Math.hypot(c.x - c.hx, c.z - c.hz);
    assert.ok(away > 30, `it sidled ${away.toFixed(0)} from home`);
    s.player.pos.z = -2000;
    assert.equal(s.until(s.player, () => c.state === 'return', 60), SHARED.RELEASE, 'let go');
    s.until(s.player, () => c.state === 'hidden', 200);
    assert.equal(c.state, 'hidden');
    assert.ok(Math.hypot(c.x - c.hx, c.z - c.hz) < CRAB.HOME_NEAR, 'home');
    assert.ok(Math.abs(c.b1) < 1e-9 && c.b0 < 0.2, 'down in its tin');
  }
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === 'aim' && b.t === 3, 200);
    s.player.pos.z = -2000;
    s.step(s.player, SHARED.RELEASE);
    assert.equal(b.state, 'return', 'let go, its aim called off');
    assert.equal(s.critters.attacker, -1);
    s.until(s.player, () => b.state === 'patrol', 300);
    assert.equal(b.state, 'patrol');
    s.step(s.player);
    const L = s.critters.life;
    assert.ok(Math.abs(b.z - (b.hz + MOSQUITO.SWAY_Z * (1 / MOSQUITO.SWAY_X) * Math.sin(2 * MOSQUITO.SWAY_RATE * L + b.seed))) < 1e-9, 'on its curve');
  }
});

test('the token with a crab and a frog: the pinch gives it back at its end (with the gap) and the crab winds up again; a crab and a frog both after him never wind up at once, each winding up again and again', () => {
  {
    const s = facingCrab(180);
    const c = s.crab;
    s.until(s.player, () => c.state === 'pinch', 200);
    assert.equal(s.critters.attacker, 0, 'the crab has it');
    s.until(s.player, () => c.state !== 'pinch', 10);
    assert.equal(c.state, 'stuck');
    assert.equal(s.critters.attacker, -1, 'given back at the pinch\'s end');
    assert.equal(s.critters.gapUntil, s.critters.life + SHARED.GAP, 'with the gap');
    const n = s.until(s.player, () => c.state === 'windup', 400);
    assert.equal(c.state, 'windup', `a second windup ${n} ticks on`);
    assert.equal(s.critters.attacker, 0);
  }
  // Both about him (their circles overlapping on him), he sidesteps to and fro (never hit long).
  const k = crew([frogSpot({ id: 'f', x: -150, z: 400 }), crabSpot({ id: 'c', x: 160, z: 220, yaw: Math.PI, fight: 400 })]);
  const p = fakePlayer(0, 0, 0);
  const TELLS = [{ windup: 1, leap: 1 }, { windup: 1, pinch: 1 }];
  const windups = [0, 0];
  for (let t = 0; t < 2000; t++) {
    const before = k.critters.list.map((c) => c.state);
    k.step(p);
    p.pos.x = 250 * Math.sin(t / 30);
    p.invincibleUntil = 0;
    const now = k.critters.list.map((c) => c.state);
    assert.ok(!(TELLS[0][now[0]] === 1 && TELLS[1][now[1]] === 1), `tick ${t}: ${now}`);
    for (let i = 0; i < 2; i++) if (now[i] === 'windup' && before[i] !== 'windup') windups[i]++;
  }
  assert.ok(windups[0] >= 3 && windups[1] >= 3, `windups ${windups}`);
});

test('let go mid-strike: he leaves fight + 80 as the crab winds up and the mosquito aims, and stays away: the pinch and the dive finish first (and the stomp window after them), then it goes home with the token given back and no ring left', () => {
  for (const [what, make, tell, leaveAt, strike] of [
    ['crab', () => facingCrab(180), 'windup', 7, { pinch: 1, stuck: 1 }],
    ['mosquito', () => facingMosquito(400), 'aim', 8, { dive: 1, stuck: 1, recoil: 1, pull: 1 }],
  ]) {
    const s = make();
    const c = s.critters.list[0];
    s.until(s.player, () => c.state === tell && c.t === leaveAt, 200);
    // (Far behind him: off the line of its strike, out of its circle.)
    s.player.pos.z = -1500;
    const left = s.critters.life;
    let struck = false;
    let before = c.state;
    for (let t = 0; t < 300 && c.state !== 'return'; t++) {
      before = c.state;
      s.step(s.player);
      if (strike[c.state] === 1) struck = true;
    }
    assert.ok(struck, `${what}: its strike went on`);
    assert.equal(c.state, 'return', `${what}: let go`);
    assert.ok(strike[before] !== 1 && before !== tell, `${what}: let go after its strike (from ${before})`);
    assert.ok(s.critters.life - left > SHARED.RELEASE + 1, `${what}: the release waited`);
    assert.equal(s.critters.attacker, -1, `${what}: the token back`);
    assert.equal(c.markOn, 0, `${what}: no ring`);
    assert.equal(s.player.hits.length, 0);
  }
});

test('hit shapes (scalar math): the crab\'s struck capsule rides its lift (an attack over a hidden crab misses what strikes a standing one); a stuck mosquito is a little fatter (STUCK_R); every kind is stomped with his feet down to STOMP_LOW under its origin (times its size), not lower', () => {
  {
    const k = crew([crabSpot()]);
    const c = k.critters.list[0];
    const atk = { x: c.x, y: c.y + 115, z: c.z, radius: 10 };
    assert.equal(c.state, 'hidden');
    assert.equal(k.critters._struck(c, atk), false, 'hidden: its top low in its tin');
    c.b1 = 1;
    assert.equal(k.critters._struck(c, atk), true, 'standing');
  }
  {
    const s = facingMosquito(400);
    const b = s.buzz;
    s.until(s.player, () => b.state === 'aim' && b.t === 2, 200);
    // (One pose for both: level, facing +z; the attack 44 off the middle of its body's axis.)
    b.pitch = 0;
    b.yaw = 0;
    const R = CRITTER_RIG.mosquito;
    const atk = { x: b.x + 44, y: b.y - 10, z: b.z, radius: 1 };
    assert.equal(s.critters._struck(b, atk), false, 'aiming: R ' + R.BODY_R);
    b.state = 'stuck';
    assert.equal(s.critters._struck(b, atk), true, 'stuck: R ' + R.STUCK_R);
    b.state = 'aim';
  }
  assert.equal(SHARED.STOMP_LOW, 40);
  for (const [spot, scale] of [[frogSpot(), 1], [crabSpot({ scale: 1.25 }), 1.25], [mosquitoSpot(), 1]]) {
    const k = crew([spot]);
    const c = k.critters.list[0];
    const R = CRITTER_RIG[KIND[c.kind]];
    const top = c.y + (R.TOP + k.critters._rise(c)) * c.scale;
    const p = fakePlayer(c.x + 10, 0, c.z);
    p.vel.y = -60;
    p.action = 'freefall';
    const hero = { y: top + 5, vy: -60, air: true };
    for (const [dy, want] of [[-SHARED.STOMP_LOW * scale + 1, true], [-SHARED.STOMP_LOW * scale - 1, false]]) {
      p.pos.y = c.y + dy;
      assert.equal(k.critters._stomped(c, p, hero), want, `${KIND[c.kind]}: his feet ${dy} under its origin`);
    }
  }
});

test("the crab never starts its tell hidden behind him from the camera: with the camera looking along the line through him at it, it sidles out at least OFF_LINE off that line first (or, kept on it, winds up after LINE_WAIT ticks); without a camera it winds up as soon as he is in its window", () => {
  const off = (s) => {
    const c = s.crab;
    const a = Math.atan2(c.x - s.player.pos.x, c.z - s.player.pos.z);
    return Math.abs(wrapAngle(a - s.cam()));
  };
  // The camera behind him looking north at it (it stands 180 north of him).
  {
    const s = facingCrab(180);
    let cam = 0;
    s.setCam(cam);
    s.cam = () => cam;
    s.until(s.player, () => s.crab.state === 'strafe', 30);
    const n = s.until(s.player, () => s.crab.state === 'windup', 200);
    assert.equal(s.crab.state, 'windup');
    assert.ok(n >= 3, `it sidled ${n} ticks first`);
    assert.ok(off(s) >= CRAB.OFF_LINE - 1e-9, `${off(s).toFixed(3)} off the camera's line`);
  }
  // The camera swinging to keep it right behind him: it winds up after LINE_WAIT ticks.
  {
    const s = facingCrab(180);
    s.until(s.player, () => s.crab.state === 'strafe', 30);
    const n = s.until(s.player, () => {
      s.setCam(Math.atan2(s.crab.x - s.player.pos.x, s.crab.z - s.player.pos.z));
      return s.crab.state === 'windup';
    }, 200);
    assert.equal(s.crab.state, 'windup');
    assert.equal(n, CRAB.LINE_WAIT, 'after LINE_WAIT ticks of sidling');
  }
  // No camera (the tests' tables): at once.
  {
    const s = facingCrab(180);
    s.until(s.player, () => s.crab.state === 'strafe', 30);
    assert.equal(s.until(s.player, () => s.crab.state === 'windup', 200), 1);
  }
});

test('a wading crab at the sand bar\'s depth (88; stand 40, times 1.25): hidden, its yellow band and all above it over the water, its eyes on him when he swims about (never woken by a swimmer); stomped or knocked over, its dented tin floats up, its top always over the water through the dent, the tumble and the poof', () => {
  const water = 88;
  const spot = crabSpot({ wade: true, scale: 1.25, stand: 40, yaw: 0 });
  // The tin's yellow band's lowest point and its top (rig space, from the model).
  const b = critterBase();
  const yellow = new THREE.Color(0xf3c433).toArray();
  let band = Infinity;
  let tinTop = -Infinity;
  for (let v = 0; v < b.position.count; v++) {
    if (b.aPart.array[v * 3 + 2] !== MODEL.CRAB || b.aPart.array[v * 3] !== CRITTER_PARTS.crab.TIN) continue;
    const y = b.position.array[v * 3 + 1];
    tinTop = Math.max(tinTop, y);
    if (Math.abs(b.color.array[v * 3] - yellow[0]) + Math.abs(b.color.array[v * 3 + 1] - yellow[1]) + Math.abs(b.color.array[v * 3 + 2] - yellow[2]) < 1e-5) band = Math.min(band, y);
  }
  assert.ok(band > 45 && band < 55 && tinTop > 76, `band from ${band}, top ${tinTop}`);
  const C = CRITTER_RIG.crab;
  const over = (c, y) => c.y + (y + C.LIFT_SPAN * (c.b1 - 1)) * c.scale * c.sq * c.vis - water;
  {
    const k = crew([spot], { collision: world({ wade: water }) });
    const c = k.critters.list[0];
    assert.ok(over(c, band) >= 0, `hidden: its yellow band ${over(c, band).toFixed(1)} over the water`);
    // He swims about 300 east of it (away: in the water): it watches him, stays in its tin.
    const p = fakePlayer(300, -40, 0);
    p.inWater = true;
    k.step(p, 60);
    assert.equal(c.state, 'hidden', 'never woken by a swimmer');
    assert.ok(Math.abs(wrapAngle(c.yaw - Math.PI / 2)) < 0.05, `its tin turned to him (${c.yaw.toFixed(2)})`);
    assert.ok(c.b0 > 0.6, 'its eyes out');
  }
  for (const how of ['stomp', 'punch']) {
    const k = crew([spot], { collision: world({ wade: water }) });
    const c = k.critters.list[0];
    const p = fakePlayer(0, 0, -150);
    k.until(p, () => c.state === 'strafe', 40);
    p.invincibleUntil = Infinity;
    if (how === 'stomp') {
      const top = c.y + (C.TOP + k.critters._rise(c)) * c.scale;
      Object.assign(p.pos, { x: c.x + 20, y: top - 5, z: c.z });
      p.vel.y = -12;
      p.action = 'freefall';
      Object.assign(k.hero, { y: top + 10, vy: -12, air: true });
    } else p.attack = { x: c.x, y: c.y + 30, z: c.z - 20, radius: 40 };
    k.step(p);
    p.attack = null;
    p.pos.y = 3000;
    assert.equal(c.state, how === 'stomp' ? 'dent' : 'tumble');
    const stood = c.b1;
    let floated = false;
    for (let t = 0; t < 60 && c.state !== 'gone'; t++) {
      k.step(p);
      if (c.state === 'gone') break;
      assert.ok(over(c, tinTop) >= 20, `${how}: its tin's top ${over(c, tinTop).toFixed(1)} over the water (${c.state} ${c.t})`);
      // (Standing on its legs as it dents, not sagging: its feet float up no more than they must.)
      assert.ok(c.b1 >= stood - 1e-9, `${how}: standing (${c.b1.toFixed(3)} of ${stood.toFixed(3)})`);
      if (c.y > c.floorY + 1) floated = true;
    }
    assert.ok(floated, `${how}: it floated up`);
    assert.equal(k.coins.length, 1);
  }
});

test('the state vocabulary: every state of every kind seen above is in its STATES, and each of its STATES was seen; HITTABLE is exactly every kind\'s non-defeat states', () => {
  for (const kind of KIND) {
    for (const s of SEEN[kind]) assert.ok(STATES[kind][s], `${s} in STATES.${kind}`);
    for (const s of Object.keys(STATES[kind])) assert.ok(SEEN[kind].has(s), `${kind} ${s} seen`);
  }
  const want = new Set();
  for (const kind of Object.values(STATES)) for (const [s, m] of Object.entries(kind)) if (m !== 'D') want.add(s);
  assert.deepEqual(new Set(Object.keys(HITTABLE)), want);
  for (const kind of Object.values(STATES)) for (const m of Object.values(kind)) assert.ok(['C', 'E', 'D'].includes(m));
});
