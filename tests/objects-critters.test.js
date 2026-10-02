// The Midsummer critters (objects/Critters.js, critters/frog.js, critterModel.js) in node: one
// instanced mesh for all of them and a hidden marker mesh, sharing the models' attributes; the
// idle frogs on their rings (no collision queries, no sparkles, the same every run and after a
// reset); engagement (its circle on its level, never while he is away), the release and the
// hop home, a hop in the air landed first when it is let go or notices him; the tell (exactly
// 20 ticks, 26 for a calm one, the lock 9 or more before the first damage tick, the yaw locked
// with the target, the orange marker at the target, starting well over his shadow's size at
// full brightness), one wedge a leap, its peak; away and hold (every away action, the water, a
// blink after a hit, a dialog, a warp through ObjectManager); the token and its gap; defeat by a
// stomp (bounce(72)) or an attack in every live state, the hero winning a tie, a frog stomped
// in the air dropping to its floor, the wreath flying up and bursting into gold, one coin after
// the poof, a struck one knocked off the camera's line, the daze's three twinkles; the
// knock-safe rule at a drop and at the water; the leash, the water and the drop for its hops and
// its target (half way, else the windup called off) and the strike window; the lost-life edge
// and reset(); the blob shadows; the three models (triangles, normals, sizes, the crab's
// planted feet, the eyes and flowers clear of what they sit on, each part in its own model's
// branch of the shader); the allocation rules of the hot paths; the fairness table with the
// real Player (still: hit; a sidestep: no hit; mashing B: it is struck; a jump: a stomp); the
// sounds and the shared sound gate; the state vocabulary; the bump (at its leash's rim, against
// a wall, in its windup, off a dying hero).
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

const { FROG, SHARED } = CRITTER;
const SIZE = 30000;
const SEEN = new Set(); // every frog state seen in these tests (the vocabulary test)

// Flat floor at y 0; optional: water (surface 50 over a floor at -400) where x > waterFromX, a
// drop { z, side, depth } (the floor `depth` lower past z: where z > it with side 1, where z < it
// with side -1; a face down to it), a tall wall along x = wallX (facing -x), shallow water `wade`
// deep over the whole floor, a ledge { x0, x1, z0, z1, y } (a raised floor, over the water too).
function world({ waterFromX = Infinity, drop = null, wallX = null, wade = 0, ledge = null } = {}) {
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
  w.setWaterLevelFn((x) => (x > waterFromX ? 50 : wade > 0 ? wade : NO_WATER));
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
      for (const c of critters.list) if (c.kind === MODEL.FROG) SEEN.add(c.state);
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

test('construction: one instanced mesh for every critter and a hidden marker mesh, its own program; the models shared between managers; unknown kinds throw; crabs and mosquitoes stay calm until they get their steps', () => {
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
  // A crab and a mosquito (no steps yet): calm and still with him inside their circles.
  const still = crew([
    { id: 'crab', kind: 'crab', x: 0, y: 0, z: 0, yaw: 0, roam: 100, fight: 300 },
    { id: 'mosquito', kind: 'mosquito', x: 1000, y: 0, z: 0, yaw: 0, roam: 160, fight: 400 },
  ]);
  const p = fakePlayer(100, 0, 100);
  for (let t = 0; t < 600; t++) {
    p.pos.x = t % 2 ? 100 : 1050;
    still.step(p);
    assert.equal(still.critters.list[0].state, 'hidden');
    assert.equal(still.critters.list[1].state, 'patrol');
  }
  assert.equal(still.critters.engaged, 0);
  assert.equal(still.critters.mesh.count, 2, 'both drawn');
  assert.equal(still.critters.list[1].y, CRITTER.MOSQUITO.HOVER, 'the mosquito hovers over its home');
});

test('idle: far from him the frogs hop round their rings (ring point k along yaw0 + k * 60 degrees, 0.6 roam out; points by a wall dropped, the rest in order) with no collision queries, no sparkles; two crews run the same, a reset crew replays a fresh one', () => {
  const collision = world({ wallX: 150 });
  const q = counting(collision);
  const throwing = { twinkle: () => assert.fail('no sparkles'), clods: () => assert.fail('no sparkles'), burst: () => assert.fail('no sparkles') };
  const spots = [frogSpot({ id: 'free', x: -3000, yaw: 0.4 }), frogSpot({ id: 'walled', x: 0, yaw: 0 })];
  const k = crew(spots, { collision, sparkles: throwing });
  const [free, walled] = k.critters.list;
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
    for (const c of k.critters.list) {
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
      if (tw.length) sets.push({ t: f.t, tw });
    }
    assert.deepEqual(sets.map((e) => e.t), [1, 13, 25]);
    for (const { tw } of sets) {
      assert.equal(tw.length, 3);
      for (const e of tw) {
        assert.deepEqual(e.tint, TINT.petal);
        assert.ok(Math.abs(Math.hypot(e.x - f.x, e.z - f.z) - 40) < 1e-6, 'round its head');
      }
      const a = tw.map((e) => Math.atan2(e.x - f.x, e.z - f.z));
      assert.ok(Math.abs(Math.abs(wrapAngle(a[1] - a[0])) - (2 * Math.PI) / 3) < 1e-6, 'spaced round it');
    }
    assert.ok(Math.abs(wrapAngle(Math.atan2(sets[1].tw[0].x - f.x, sets[1].tw[0].z - f.z) - Math.atan2(sets[0].tw[0].x - f.x, sets[0].tw[0].z - f.z))) > 0.5, 'turning');
  }
});

test('knock-safe: at the edge of a drop or the water, a hit that would knock him off sends him toward home instead; on open floor it knocks him straight away from the frog', () => {
  const hitAt = (collision, hero, src) => {
    const k = crew([frogSpot()], { collision });
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

test("lifecycle: a lost life sends the live frogs home calm (to ring point 0) and keeps the defeated gone; a defeat under way still drops its coin; reset() brings every one back and forgets his last action; a wading critter's coin floats over the water", () => {
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
});

test('the models: triangles within their caps, unit normals, their sizes (the frog 115-130 across its hind feet and under 90 tall, the crab 165-180 across its legs with its tin top at 76-80, the mosquito 210-240 long with a 170-200 wingspan); the crab standing tall keeps its feet planted and its hips rising with its body; the mosquito\'s pupils clear of its head, the wreath\'s flowers clear of its leaves; every part posed in its own model\'s branch of the shader, the crab\'s leg lift and the wreath\'s squash undo as worked out here, the mosquito\'s eyes a deep red in the aim', () => {
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
  const hot = ['update', '_move', '_hop', '_fly', '_launch', '_markAt', '_standable', '_struck', '_stomped', '_hurt', '_safe', '_touches', '_engage', '_bump', '_knock', '_tumble', '_poofStep', '_every', '_twinkle', '_burst', '_clods', 'animate'];
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
});

// The fairness table (the dodge model's rows, docs/ARCHITECTURE.md "Critters"): the real Player
// on a flat course with a real ObjectManager holding one frog `d` north of him (in front, the
// camera looking north). He stands still until its windup starts, then plays `input(t)` (t: ticks
// since the windup started). Returns how it ended (HIT, STRUCK, STOMP or miss), the ticks of the
// windup, its lock and his first damage.
function dodge(d, input) {
  const run = (play) => {
    const b = new CourseBuilder();
    b.floor(-5000, -5000, 5000, 5000, 0);
    const collision = b.build();
    const events = new Events();
    const player = new Player({ collision, events, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
    player.teleport(0, 0, 0, 0);
    player.setAction('idle');
    const ctl = new ScriptedController();
    const om = new ObjectManager({ scene: new THREE.Scene(), collision, events, layout: { CRITTERS: [frogSpot({ z: d + 120, yaw: Math.PI })], groundHeight: () => 0 }, player });
    const frog = om.critters.list[0];
    const out = { windup: -1, lock: -1, damage: -1, end: 'miss' };
    for (let t = 0; t < 160; t++) {
      const health = player.health;
      player.update(ctl.next(play(t)), 0);
      om.update({ player });
      if (frog.state === 'windup' && out.windup < 0) out.windup = t;
      if (frog.markOn === 1 && out.lock < 0) out.lock = t;
      if (player.health < health && out.damage < 0) {
        out.damage = t;
        out.end = 'HIT';
        break;
      }
      if (frog.state === 'tumble') out.end = 'STRUCK';
      if (frog.state === 'squash') out.end = 'STOMP';
      if (out.end !== 'miss' || (out.windup >= 0 && t > out.windup + 60)) break;
    }
    return out;
  };
  const first = run(() => ({}));
  const u0 = first.windup;
  assert.ok(u0 > 0, `a windup from ${d}`);
  return run((t) => (t < u0 ? {} : input(t - u0)));
}

test('fairness (the real Player): at both ends of its window, standing still he is hit; a full sidestep at tick 22 of the tell misses; walking in mashing B he knocks it over first; a jump at tick 20 stomps it, one at tick 0 is never hit; the lock at least 9 ticks before any hit', () => {
  for (const d of [FROG.WIN_MIN, FROG.WIN_MAX]) {
    const rows = {
      still: dodge(d, () => ({})),
      side22: dodge(d, (t) => (t < 22 ? {} : { stickX: 1 })),
      mashB: dodge(d, (t) => ({ stickY: 0.6, B: t % 5 === 0 })),
      jump20: dodge(d, (t) => (t < 20 ? {} : { stickY: 0.5, A: t < 37 })),
      jump0: dodge(d, (t) => ({ stickY: 0.5, A: t < 17 })),
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
      if (!stop || stop(p)) {
        p.pos.x += dir.x;
        p.pos.z += dir.z;
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

test('the state vocabulary: every frog state seen above is in STATES.frog; HITTABLE is exactly every kind\'s non-defeat states', () => {
  for (const s of SEEN) assert.ok(STATES.frog[s], `${s} in STATES.frog`);
  for (const s of ['idle', 'notice', 'approach', 'windup', 'leap', 'dazed', 'cooldown', 'return', 'squash', 'poof', 'tumble', 'gone']) assert.ok(SEEN.has(s), `${s} seen`);
  const want = new Set();
  for (const kind of Object.values(STATES)) for (const [s, m] of Object.entries(kind)) if (m !== 'D') want.add(s);
  assert.deepEqual(new Set(Object.keys(HITTABLE)), want);
  for (const kind of Object.values(STATES)) for (const m of Object.values(kind)) assert.ok(['C', 'E', 'D'].includes(m));
});
