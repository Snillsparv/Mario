// The cannon (docs/ARCHITECTURE.md "Cannon"): the real Player on the real castle grounds with
// the real cannon (objects/Cannon.js at layout.CANNON). Stepping onto its pad puts Pip in the
// barrel and B climbs back out; the stick aims (yaw all round, pitch 5..80 degrees, ratchet
// clicks); A fires him out along the barrel on a ballistic arc. A search over aims proves that
// a full shot lands him on the very top of the keep, and on the wing and rear-block roofs,
// standing and unhurt; shots at the castle's walls never tunnel into it; shots are held inside
// the level; with the winged hat a shot takes off into flight at its peak, keeping its speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { Cannon } from '../src/objects/Cannon.js';
import { CANNON_DIMS } from '../src/objects/cannonModel.js';
import { barrelDir } from '../src/player/actions/cannon.js';
import { Events } from '../src/core/events.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { angleDiff, wrapAngle } from '../src/core/math.js';
import * as T from '../src/player/physics/tuning.js';

const DEG = Math.PI / 180;
const scene = new THREE.Scene();
const level = buildLevel(scene);
const col = level.collision;
const L = level.layout;
const K = L.KEEP_TOP;
// Roof heights of castle/building.js: the wings' walkways, the rear block's, the keep's.
const B = L.CASTLE.baseY;
const MH = L.CASTLE.mainHeight;
const ROOF = { wing: B + Math.round(MH * 0.84), rear: B + MH + 300, keep: K.y };

const events = new Events();
const log = [];
for (const name of ['sfx', 'cannonFire', 'hurt', 'land', 'signRead', 'wingHat']) events.on(name, (e) => log.push({ event: name, ...e }));
const cannon = new Cannon({ spot: L.CANNON, collision: col, events, groundAt: L.groundHeight });

// A fresh Pip (full health) and a clean event log; the cannon back at rest and armed.
function rig() {
  log.length = 0;
  cannon.reset();
  const p = new Player({ collision: col, events, spawn: level.spawn });
  const ctl = new ScriptedController();
  const step = (input = {}, cameraYaw = 0) => {
    p.update(ctl.next(input), cameraYaw);
    cannon.update(p);
  };
  return { p, step };
}
const sfx = () => log.filter((e) => e.event === 'sfx').map((e) => e.name);
const hurts = () => log.filter((e) => e.event === 'hurt');

// Pip on the pad, into the barrel and on to the aim phase.
function loaded(r) {
  const { p, step } = r;
  p.teleport(cannon.pad.x, cannon.pad.y, cannon.pad.z, 0);
  p.setAction('idle');
  step();
  assert.equal(p.action, 'cannon', 'the pad put him in');
  for (let t = 0; t < 80 && p.cannon.phase !== 'aim'; t++) step();
  assert.equal(p.cannon.phase, 'aim');
  return r;
}

// Fires from the aim (yaw off the rest yaw, pitch; degrees) and runs until Pip stands still
// (or `max` ticks). `each(p, t)` sees every tick. Returns what became of him.
function shoot(yawOff, pitchDeg, { hat = 0, max = 360, each = null, input = () => ({}) } = {}) {
  const r = loaded(rig());
  const { p, step } = r;
  if (hat) p.giveWingHat(hat);
  p.cannon.yaw = wrapAngle(cannon.restYaw + yawOff * DEG);
  p.cannon.pitch = pitchDeg * DEG;
  step({ A: true });
  const acts = [p.action];
  let t = 0;
  for (; t < max; t++) {
    step(input(t, p));
    if (acts.at(-1) !== p.action) acts.push(p.action);
    each?.(p, t);
    if (p.grounded && p.action === 'idle') break;
  }
  return { p, acts, ticks: t, hurt: hurts().length, floorY: p.floor.y };
}

// Inside a solid (the castle's walls enclose him): from his chest most horizontal rays first
// meet a face from behind (the collision faces point out of their solids).
function insideSolid(p) {
  const o = { x: p.pos.x, y: p.pos.y + 80, z: p.pos.z };
  let back = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    const d = { x: Math.sin(a), y: 0, z: Math.cos(a) };
    const hit = col.raycast(o, d, 3000, { floors: false, ceilings: false });
    if (hit && hit.normal.x * d.x + hit.normal.z * d.z > 0.05) back++;
  }
  return back >= 5;
}

const inKeep = (x, z) => Math.abs(x - K.x) <= K.halfX && Math.abs(z - K.z) <= K.halfZ;
const DRY = (p) => p.grounded && !p.inWater;

test('stepping onto the glowing pad: Pip hops into the barrel, drops out of sight, the barrel settles, then it is his to aim', () => {
  const r = rig();
  const { p, step } = r;
  // Walk up to the pad from beside it.
  const a = cannon.padYaw;
  const x = cannon.pad.x + Math.sin(a) * 420;
  const z = cannon.pad.z + Math.cos(a) * 420;
  p.teleport(x, col.findFloor(x, 5000, z).y, z, a + Math.PI);
  p.setAction('idle');
  let t = 0;
  for (; t < 120 && p.action !== 'cannon'; t++) step({ stickY: 1 }, a + Math.PI);
  assert.equal(p.action, 'cannon', 'walking onto the pad climbs in');
  assert.equal(p.cannon.phase, 'hop');
  assert.ok(sfx().includes('triple_jump'), 'the hop');
  assert.equal(p.cannon.desc, cannon.desc);
  // The hop: up over the breech and head first into the muzzle; then he is inside.
  let top = -Infinity;
  for (t = 0; t < T.CANNON_HOP_TICKS && p.cannon.phase === 'hop'; t++) {
    step();
    top = Math.max(top, p.pos.y);
  }
  assert.ok(top > cannon.desc.y + CANNON_DIMS.MUZZLE * Math.sin(CANNON_DIMS.REST_PITCH) - 100, `the hop tops out over the mouth (${top.toFixed(0)})`);
  assert.equal(p.cannon.phase, 'settle');
  assert.ok(p.cannon.inside);
  assert.ok(sfx().includes('cannon_enter'), 'the clunk as he drops in');
  // Tucked in the turret under the pivot, out of reach of harm.
  assert.ok(Math.hypot(p.pos.x - cannon.x, p.pos.z - cannon.z) < 1 && p.pos.y < cannon.desc.y);
  assert.equal(p.takeDamage(2, { x: p.pos.x + 100, y: p.pos.y, z: p.pos.z }), false, 'no damage in the barrel');
  assert.equal(p.health, T.MAX_HEALTH);
  // The barrel lowers from its rest pitch to the start aim, input waiting.
  const before = p.cannon.yaw;
  for (t = 0; t < 40 && p.cannon.phase === 'settle'; t++) step({ stickX: 1 });
  assert.equal(p.cannon.phase, 'aim');
  assert.equal(p.cannon.yaw, before, 'no turning while it settles');
  assert.ok(Math.abs(p.cannon.pitch - T.CANNON_START_PITCH) < 1e-9);
  // The cannon object follows the aim; the pad is disarmed while he is in.
  step({ stickX: 1 });
  assert.equal(cannon.yaw, p.cannon.yaw);
  assert.equal(cannon.pitch, p.cannon.pitch);
  assert.equal(cannon.armed, false);
});

test('B (or Z) climbs back out: the barrel swings back to rest, he hops down beside the pad and stands; the pad waits until he steps off and on again', () => {
  for (const button of ['B', 'Z']) {
    const r = loaded(rig());
    const { p, step } = r;
    for (let t = 0; t < 20; t++) step({ stickX: 0.8, stickY: -0.5 });
    step({ [button]: true });
    assert.equal(p.cannon.phase, 'unload');
    let t = 0;
    for (; t < 200 && p.action === 'cannon'; t++) step();
    assert.notEqual(p.action, 'cannon');
    assert.equal(cannon.yaw, cannon.restYaw, 'the barrel back at rest');
    assert.equal(cannon.pitch, cannon.restPitch);
    for (t = 0; t < 30; t++) step();
    assert.equal(p.action, 'idle', `${button}: standing`);
    assert.ok(p.grounded);
    const e = cannon.desc.exit;
    assert.ok(Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < 40, `${button}: beside the pad`);
    assert.ok(!cannon.onPad(p) && cannon.armed, 'off the pad: armed again');
    assert.equal(hurts().length, 0);
    // Back onto the pad: in again.
    p.teleport(cannon.pad.x, cannon.pad.y, cannon.pad.z, 0);
    p.setAction('idle');
    step();
    assert.equal(p.action, 'cannon');
  }
  // Standing on the pad after climbing out does not put him straight back in.
  const r = loaded(rig());
  const { p, step } = r;
  step({ B: true });
  for (let t = 0; t < 200 && p.action === 'cannon'; t++) step();
  p.teleport(cannon.pad.x, cannon.pad.y, cannon.pad.z, 0);
  p.setAction('idle');
  cannon.armed = false; // (as if he had landed on it)
  for (let t = 0; t < 30; t++) step();
  assert.equal(p.action, 'idle', 'the pad waits for him to step off first');
});

test('aiming: the stick turns the barrel all the way round and tilts it within 5..80 degrees, finely near the middle, with ratchet clicks', () => {
  const r = loaded(rig());
  const { p, step } = r;
  const s = p.cannon;
  // Full right: yaw falls at CANNON_YAW_RATE per tick (turning right), all the way round.
  let yaw = s.yaw;
  let turned = 0;
  log.length = 0;
  for (let t = 0; t < 250; t++) {
    step({ stickX: 1 });
    const d = angleDiff(yaw, s.yaw);
    assert.ok(Math.abs(d + T.CANNON_YAW_RATE) < 1e-9, 'full-rate right turn');
    turned -= d;
    yaw = s.yaw;
  }
  assert.ok(turned > 2 * Math.PI, 'more than a full circle');
  const clicks = sfx().filter((n) => n === 'cannon_turn').length;
  assert.ok(Math.abs(clicks - turned / T.CANNON_CLICK_ANGLE) <= 1, `a click every ${T.CANNON_CLICK_ANGLE / DEG} deg (${clicks})`);
  // Half a push turns a quarter as fast (fine aim); left turns the other way.
  yaw = s.yaw;
  step({ stickX: -0.5 });
  assert.ok(Math.abs(angleDiff(yaw, s.yaw) - 0.25 * T.CANNON_YAW_RATE) < 1e-9);
  // Pitch: stick up raises, down lowers, clamped.
  for (let t = 0; t < 120; t++) step({ stickY: 1 });
  assert.ok(Math.abs(s.pitch - T.CANNON_MAX_PITCH) < 1e-9, 'max pitch');
  assert.ok(Math.abs(T.CANNON_MAX_PITCH - 80 * DEG) < 1e-9);
  for (let t = 0; t < 120; t++) step({ stickY: -1 });
  assert.ok(Math.abs(s.pitch - T.CANNON_MIN_PITCH) < 1e-9, 'min pitch');
  assert.ok(Math.abs(T.CANNON_MIN_PITCH - 5 * DEG) < 1e-9);
  // No clicks while the stick rests.
  log.length = 0;
  for (let t = 0; t < 20; t++) step();
  assert.equal(sfx().filter((n) => n === 'cannon_turn').length, 0);
});

test('A fires him out along the barrel with a boom, then a ballistic arc under CANNON_GRAVITY, head first along it', () => {
  const r = loaded(rig());
  const { p, step } = r;
  // Aim away from the castle, up into open sky over the lawn.
  p.cannon.yaw = wrapAngle(cannon.restYaw + Math.PI * 0.6);
  p.cannon.pitch = 60 * DEG;
  const dir = barrelDir(p.cannon.yaw, p.cannon.pitch);
  log.length = 0;
  step({ A: true });
  assert.equal(p.action, 'cannon_shot');
  const fire = log.find((e) => e.event === 'cannonFire');
  assert.ok(fire, "'cannonFire'");
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(fire.dir[k] - dir[k]) < 1e-9, `fired along the barrel (${k})`);
  assert.ok(Math.abs(fire.pitch - 60 * DEG) < 1e-9);
  // The mouth: the muzzle length out along the barrel from the pivot.
  const m = cannon.desc;
  assert.ok(Math.abs(Math.hypot(fire.pos.x - m.x, fire.pos.y - m.y, fire.pos.z - m.z) - m.muzzle) < 1e-6);
  for (const n of ['cannon_fire', 'cannon_whoosh']) assert.ok(sfx().includes(n), n);
  // Speed along the barrel (one tick of gravity applied after the first step).
  const h = Math.hypot(p.vel.x, p.vel.z);
  assert.ok(Math.abs(h - T.CANNON_SPEED * Math.cos(60 * DEG)) < 1e-6, `horizontal speed ${h}`);
  assert.ok(Math.abs(p.vel.y - (T.CANNON_SPEED * Math.sin(60 * DEG) - T.CANNON_GRAVITY)) < 1e-6);
  // The arc: horizontal speed constant, vertical speed falling by CANNON_GRAVITY a tick.
  let vy = p.vel.y;
  let peak = p.pos.y;
  for (let t = 0; t < 40; t++) {
    step();
    assert.equal(p.action, 'cannon_shot');
    assert.ok(Math.abs(Math.hypot(p.vel.x, p.vel.z) - h) < 1e-6, 'no drag');
    assert.ok(Math.abs(p.vel.y - (vy - T.CANNON_GRAVITY)) < 1e-6, 'gravity');
    vy = p.vel.y;
    peak = Math.max(peak, p.pos.y);
    const rs = p.getRenderState(1);
    assert.equal(rs.anim, 'cannon_shot');
    assert.ok(Math.abs(rs.pitch - Math.atan2(-p.vel.y, h)) < 1e-9, 'the body follows the arc');
  }
  assert.ok(peak > m.y + 2000, 'high up');
  assert.ok(p.getAttack()?.kind === 'cannon_shot', 'the flying body hits things');
  // And lands safely on the lawn, standing.
  for (let t = 0; t < 300 && !(p.grounded && p.action === 'idle'); t++) step();
  assert.equal(p.action, 'idle');
  assert.equal(hurts().length, 0, 'no fall damage');
});

test('a well-aimed shot lands Pip on the very top of the keep, standing and unhurt; others on the wing and rear-block roofs', (t) => {
  const found = { keep: [], wing: [], rear: [] };
  let shots = 0;
  let ledges = 0;
  const unsafe = [];
  for (let yo = -20; yo <= 20; yo += 2) {
    for (let pd = 20; pd <= 80; pd += 2) {
      const r = shoot(yo, pd);
      shots++;
      const { p } = r;
      if (r.acts.includes('ledge_hang')) ledges++;
      if (DRY(p) && r.hurt) unsafe.push(`${yo}/${pd}`);
      if (!(p.action === 'idle' && p.grounded && p.health === T.MAX_HEALTH)) continue;
      const y = p.pos.y;
      if (Math.abs(y - ROOF.keep) < 0.5 && inKeep(p.pos.x, p.pos.z)) found.keep.push([yo, pd]);
      else if (Math.abs(y - ROOF.wing) < 0.5) found.wing.push([yo, pd]);
      else if (Math.abs(y - ROOF.rear) < 0.5) found.rear.push([yo, pd]);
    }
  }
  assert.deepEqual(unsafe, [], 'no shot ever hurts him on landing');
  assert.ok(found.keep.length >= 10, `keep top: ${found.keep.length} of ${shots} aims`);
  assert.ok(found.wing.length >= 3, `wing roofs: ${found.wing.length}`);
  assert.ok(found.rear.length >= 3, `rear block roof: ${found.rear.length}`);
  assert.ok(ledges >= 3, `falling short, he grabs the roofs' edges (${ledges})`);
  // Straight at the keep (the rest yaw) a band of pitches lands on top of it.
  const straight = found.keep.filter(([yo]) => yo === 0).map(([, pd]) => pd);
  assert.ok(straight.length >= 5, `straight at the keep: ${straight.join(', ')}`);
  t.diagnostic(`${shots} aims: keep top ${found.keep.length}, wing roofs ${found.wing.length}, rear roof ${found.rear.length}, ledge grabs ${ledges}; straight at the keep, pitch ${straight.join(' ')} deg`);
});

test('aimed with the stick alone (straight at the keep, raised a moment at full push), a shot lands on top of the keep', () => {
  const r = loaded(rig());
  const { p, step } = r;
  assert.equal(p.cannon.yaw, cannon.restYaw, 'the barrel starts pointing at the keep');
  for (let t = 0; t < 12; t++) step({ stickY: 1 });
  assert.ok(Math.abs(p.cannon.pitch - (T.CANNON_START_PITCH + 12 * T.CANNON_PITCH_RATE)) < 1e-9);
  step();
  step({ A: true });
  const acts = [];
  for (let t = 0; t < 360 && !(p.grounded && p.action === 'idle'); t++) {
    step();
    if (acts.at(-1) !== p.action) acts.push(p.action);
  }
  assert.equal(p.action, 'idle', acts.join('>'));
  assert.equal(p.pos.y, ROOF.keep, `on the keep's top (${acts.join('>')})`);
  assert.ok(inKeep(p.pos.x, p.pos.z));
  assert.equal(p.health, T.MAX_HEALTH);
  assert.equal(hurts().length, 0);
});

test("the keep's top is a walkable flat top: Pip walks round the tower through the coin ring and reads the sign there", () => {
  // The coin ring: floor at the walkway under every coin, headroom over it.
  const ring = L.COINS.filter((c) => c.y === K.y + 60);
  assert.equal(ring.length, 8);
  for (const c of ring) {
    assert.ok(inKeep(c.x, c.z));
    const f = col.findFloor(c.x, K.y + 50, c.z);
    assert.equal(f.y, K.y, 'walkway under the coin');
    assert.ok(f.surface.normal.y > 0.99);
    assert.ok(col.findCeil(c.x, K.y + 80, c.z).y - K.y > 400, 'room to stand');
  }
  // Walk the ring (steering at the next coin each tick) without falling off.
  const r = rig();
  const { p, step } = r;
  p.teleport(ring[0].x, K.y, ring[0].z, Math.PI / 2);
  p.setAction('idle');
  for (let lap = 0; lap < 8; lap++) {
    const next = ring[(lap + 1) % 8];
    for (let t = 0; t < 90 && Math.hypot(p.pos.x - next.x, p.pos.z - next.z) > 40; t++) {
      step({ stickY: 0.7 }, Math.atan2(next.x - p.pos.x, next.z - p.pos.z));
      assert.equal(p.pos.y, K.y, `on the walkway (to coin ${(lap + 1) % 8})`);
    }
    assert.ok(Math.hypot(p.pos.x - next.x, p.pos.z - next.z) <= 40, `reached coin ${(lap + 1) % 8}`);
  }
  // The sign, in front of the tower facing the front: read from before its face.
  const sign = L.SIGNS.find((s) => s.id === 'keep_top');
  assert.ok(sign && sign.y === K.y && inKeep(sign.x, sign.z));
  p.teleport(sign.x, K.y, sign.z + 110, Math.PI);
  p.setAction('idle');
  step();
  step({ B: true });
  assert.equal(p.action, 'reading');
  assert.equal(log.find((e) => e.event === 'signRead')?.sign, sign);
  p.endReading();
});

test('no tunnelling: shots into the castle at every height bonk off its walls or land on its roofs, never passing into it', () => {
  const problems = [];
  const from = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: 0 };
  let bonks = 0;
  for (let yo = -24; yo <= 24; yo += 6) {
    for (let pd = 6; pd <= 36; pd += 5) {
      let prev = null;
      const r = shoot(yo, pd, {
        max: 200,
        each: (p) => {
          const cur = { x: p.pos.x, y: p.pos.y + 80, z: p.pos.z };
          if (prev && ['cannon_shot', 'soft_bonk'].includes(p.action)) {
            // The chest's path this tick must not cross a wall and end up behind it.
            const d = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
            Object.assign(from, prev);
            dir.x = (cur.x - prev.x) / d;
            dir.y = (cur.y - prev.y) / d;
            dir.z = (cur.z - prev.z) / d;
            const hit = d > 1 ? col.raycast(from, dir, d, { floors: false, ceilings: false }) : null;
            if (hit) {
              const n = hit.normal;
              const behind = (cur.x - hit.point.x) * n.x + (cur.y - hit.point.y) * n.y + (cur.z - hit.point.z) * n.z;
              if (behind < -5) problems.push(`${yo}/${pd}: through a wall at ${hit.point.x.toFixed(0)},${hit.point.y.toFixed(0)},${hit.point.z.toFixed(0)}`);
            }
          }
          prev = cur;
        },
      });
      if (r.acts.includes('soft_bonk')) bonks++;
      const { p } = r;
      if (insideSolid(p)) problems.push(`${yo}/${pd}: ended inside a solid at ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(bonks >= 5, `${bonks} shots bonked off walls`);
});

test('shots stay inside the level: over the perimeter cliffs an invisible barrier bonks him back in', () => {
  const out = [];
  for (const off of [150, 180, 210]) {
    const r = shoot(off, 45, {
      max: 300,
      each: (p) => {
        if (L.sdRoundRect(p.pos.x, p.pos.z, L.PERIMETER) > 0) out.push(`${off}: ${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)}`);
      },
    });
    assert.ok(r.acts.includes('soft_bonk'), `${off}: bonked (${r.acts.join('>')})`);
    assert.ok(r.p.pos.y < L.CLIFF_TOP, 'landed back down in the grounds');
  }
  assert.deepEqual(out, []);
});

test('with the winged hat the shot takes off into flight at its peak, keeping its speed, high over the castle', () => {
  let switched = null;
  const r = shoot(0, 72, {
    hat: 40,
    max: 120,
    each: (p) => {
      if (!switched && p.action === 'flying') switched = { y: p.pos.y, speed: p.flySpeed, vy: p.vel.y, t: p.actionTimer };
    },
  });
  assert.ok(switched, `took off (${r.acts.join('>')})`);
  assert.deepEqual(r.acts.slice(0, 2), ['cannon_shot', 'flying']);
  const h = T.CANNON_SPEED * Math.cos(72 * DEG);
  assert.ok(Math.abs(switched.speed - Math.max(T.FLY_LAUNCH_SPEED, h)) < 3, `flight speed ${switched.speed.toFixed(1)} from the shot's ${h.toFixed(1)}`);
  assert.ok(switched.y > K.y + 1500, `soaring high over the keep (${switched.y.toFixed(0)})`);
  // A flatter shot is faster at its peak than a flight can go: the flight keeps that speed
  // (bleeding it off by drag), never gaining more.
  let first = null;
  let last = null;
  let maxSpeed = 0;
  const fast = shoot(0, 42, {
    hat: 40,
    max: 60,
    each: (p) => {
      if (p.action !== 'flying') return;
      first ??= p.flySpeed;
      maxSpeed = Math.max(maxSpeed, p.flySpeed);
      last = p.flySpeed;
    },
  });
  assert.ok(fast.acts.includes('flying'));
  assert.ok(first > T.FLY_MAX_SPEED + 10 && first <= T.CANNON_FLY_MAX_SPEED, `kept ${first}`);
  assert.ok(maxSpeed <= first + 1e-9 && last < first, 'only bleeds off');
  // Without the hat the same shot stays a shot.
  const plain = shoot(0, 72, { max: 60 });
  assert.ok(!plain.acts.includes('flying'));
});

test('a low shot at a tree grabs its trunk', () => {
  const tree = col.poles.reduce((a, b) => (Math.hypot(b.x - cannon.x, b.z - cannon.z) < Math.hypot(a.x - cannon.x, a.z - cannon.z) ? b : a));
  const yaw = Math.atan2(tree.x - cannon.x, tree.z - cannon.z);
  const grabs = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let pd = 5; pd <= 20; pd += 5) {
      const r = shoot(angleDiff(cannon.restYaw, yaw) / DEG + dy, pd, { max: 90, each: (p) => p.action === 'pole' && grabs.push(p.pole) });
      assert.equal(r.hurt, 0);
    }
  }
  assert.ok(grabs.length > 0 && grabs.every((g) => g === tree), 'hugging that tree');
});

test('during the shot Z ground-pounds and B dives (from a few ticks in); every landing is safe', () => {
  const pound = shoot(0, 60, { input: (t) => ({ Z: t === 20 }) });
  assert.ok(pound.acts.includes('ground_pound'), pound.acts.join('>'));
  assert.ok(pound.acts.includes('ground_pound_land'));
  assert.equal(pound.p.health, T.MAX_HEALTH);
  const dive = shoot(0, 60, { input: (t) => ({ B: t === 20 }) });
  assert.ok(dive.acts.includes('dive'), dive.acts.join('>'));
  assert.equal(dive.p.health, T.MAX_HEALTH);
  assert.equal(dive.hurt, 0);
  // Right out of the muzzle the buttons do nothing yet.
  const early = shoot(0, 60, { max: 5, input: (t) => ({ Z: t === 0, B: t === 1 }) });
  assert.deepEqual(early.acts, ['cannon_shot']);
});
