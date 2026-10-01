// The routes of Midsummer Skerries, played with scripted input on the real course (world/area.js
// buildArea at its origin) with the real Player and the course's own ObjectManager: each running
// hop from Home Island's corner across the stepping skerries to Great Rock; the long jump from
// s4 to s5 (over the arc of coins), where a plain running jump falls in the water; out of the
// water onto every rock (a swim up to it, a water jump up its sheer side); the swim across the
// Sound to the islet's south beach and the walk up it; the first terrace up the two blocks to
// the second, the stair to the third; the signal mast (the climb, the handstand on its tip, the
// jump onto the lamp gallery for aims up to 15 degrees off); the mast as a player meets it, with
// the real follow camera (walked to from the stair's head and every other side, a rest on its
// tip, facing the lighthouse, then the stick pushed at it where it shows on the screen); and the
// walk round the gallery to the star ('starCollected' { id: 'skerries_star', area: 'skerries' }).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as sk from '../src/world/skerries/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { CameraController } from '../src/camera/CameraController.js';
import { Events } from '../src/core/events.js';

const O = AREA_DEFS.skerries.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.skerries);
const col = area.collision;
const topR = (s) => s.r * sk.SKERRY.topK;

// Jonas at a local point (the camera looks along `yaw` each tick: stickY 1 pushes him that way
// on land; in the water the stick pitches him and A strokes), with the course's objects; `log`
// lists the events they emitted ({ name, ...payload }).
function hero(x, y, z, yaw) {
  const events = new Events();
  const log = [];
  for (const name of ['coin', 'starCollected']) events.on(name, (e) => log.push({ name, ...e }));
  const p = new Player({ collision: col, events, spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'skerries' });
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const tick = (input, camYaw) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
  };
  return { p, ctl, om, log, tick, at, coins: () => log.filter((e) => e.name === 'coin').length };
}

// How far along `yaw` a local point lies (from the origin).
const along = (q, yaw) => q.x * Math.sin(yaw) + q.z * Math.cos(yaw);

// A running jump from rock a toward rock b: from behind a's middle, running at b, A held from
// `pre` before a's edge; how it ends ('water' or the floor's height) and where.
function runningJump(a, b, { pre = 40, long = false } = {}) {
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const back = a.r ? topR(a) * 0.85 : 400;
  const h = hero(a.x - Math.sin(yaw) * back, a.top, a.z - Math.cos(yaw) * back, yaw);
  const edge = along(a, yaw) + (a.r ? topR(a) : 0);
  let jumped = false;
  for (let t = 0; t < 200; t++) {
    const take = !jumped && h.p.grounded && along(h.at(), yaw) > edge - pre;
    if (take) jumped = true;
    h.tick(take && long ? { stickY: 1, A: true, Z: true } : { stickY: 1, A: jumped }, yaw);
    if (jumped && t > 3 && (h.p.inWater || (h.p.grounded && h.p.action !== 'jump'))) break;
  }
  return { end: h.p.inWater ? 'water' : Math.round(h.at().y), at: h.at(), h };
}

test('the hops: from Home Island\'s north-west corner a running jump lands on each stepping skerry in turn, and from s5 on Great Rock', () => {
  const home = { id: 'home', x: sk.HOME.outline[0][0], z: sk.HOME.outline[0][1], r: 0, top: sk.HOME.top };
  const chain = [home, ...sk.SKERRIES];
  const ends = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const [a, b] = [chain[i], chain[i + 1]];
    if (a.id === 's4') continue; // the long jump (next test)
    const { end, at } = runningJump(a, b);
    const onB = Math.hypot(at.x - b.x, at.z - b.z) < topR(b);
    ends.push(`${a.id} -> ${b.id}: ${end}${onB ? '' : ' (not on it)'}`);
  }
  assert.deepEqual(ends, ['home -> s1: 140', 's1 -> s2: 190', 's2 -> s3: 230', 's3 -> s4: 200', 's5 -> great_rock: 300']);
});

test('s4 to s5: the long jump lands on s5 (taking the five coins over the gap); a plain running jump falls in the water', () => {
  const [s4, s5] = [sk.skerry('s4'), sk.skerry('s5')];
  for (const pre of [60, 120, 200]) {
    const { end, at, h } = runningJump(s4, s5, { pre, long: true });
    assert.equal(end, s5.top, `long jump ${pre} before the edge: ${JSON.stringify(at)}`);
    assert.ok(Math.hypot(at.x - s5.x, at.z - s5.z) < topR(s5));
    // s4's coin on the way, the five in the air, s5's.
    assert.equal(h.coins(), 7, `${pre}: coins`);
  }
  for (const pre of [40, 120]) {
    const { end } = runningJump(s4, s5, { pre });
    assert.equal(end, 'water', `a running jump ${pre} before the edge`);
  }
});

test('out of the water onto every rock: a swim up to it from any side, then a water jump up its sheer side onto the top', () => {
  const rocks = [...sk.SKERRIES, ...sk.REEF.map((r, i) => ({ ...r, id: `reef ${i}` }))];
  const failed = [];
  let tried = 0;
  for (const s of rocks) {
    for (let k = 0; k < 8; k++) {
      const dir = (k / 8) * Math.PI * 2;
      const d = s.r + 500;
      const [sx, sz] = [s.x + Math.sin(dir) * d, s.z + Math.cos(dir) * d];
      // Open water to start in, and a clear swim (nothing else in the way, a body's width either side).
      if (sx < sk.BAY.x0 + 100 || sx > sk.BAY.x1 - 100 || sz < sk.BAY.z0 + 100 || sz > sk.BAY.z1 - 100) continue;
      if (col.findFloor(sx + O.x, 0, sz + O.z).y - O.y > -100) continue;
      const yaw = dir + Math.PI;
      const path = topR(s) + 120;
      const clear = [-60, 0, 60].every((w) => {
        const hit = col.raycast({ x: sx + Math.cos(yaw) * w + O.x, y: -40, z: sz - Math.sin(yaw) * w + O.z }, { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, d);
        return !hit || Math.hypot(hit.point.x - O.x - s.x, hit.point.z - O.z - s.z) < path;
      });
      if (!clear) continue;
      tried++;
      const h = hero(sx, 0, sz, yaw);
      h.p.teleport(sx + O.x, -80 + O.y, sz + O.z, yaw);
      h.p.setAction('water_surface');
      let jumped = -1;
      let out = false;
      for (let t = 0; t < 300 && !out; t++) {
        const q = h.at();
        // Strokes along the surface up to the rock; at its side (where it stops him), the leap
        // (a leap from further out, at full swimming speed, can carry him over a small rock).
        let input = { A: t % 12 === 0 };
        if (jumped < 0 && h.p.inWater && Math.hypot(q.x - s.x, q.z - s.z) < topR(s) + 80) {
          input = { stickY: -1, A: true }; // at its side: the stick pulled back, A
          jumped = t;
        } else if (jumped >= 0 && !h.p.inWater) input = {};
        if (jumped >= 0 && h.p.inWater && t - jumped > 20) jumped = -1; // fell back in: again
        h.tick(input, yaw);
        out = h.p.grounded && !h.p.inWater && h.at().y > s.top - 1;
      }
      if (!out) failed.push(`${s.id} from ${Math.round((dir * 180) / Math.PI)}: ${JSON.stringify(h.at())}`);
    }
  }
  assert.ok(tried >= 50, `${tried} swims`);
  assert.deepEqual(failed, []);
});

test("the Sound: a swim from Home Island's north shore across to the islet's south beach, and the walk up it onto the first terrace", () => {
  const B = sk.ISLET_BEACH;
  const h = hero((B.x0 + B.x1) / 2, 0, 400, Math.PI);
  h.p.teleport(O.x, -80 + O.y, 400 + O.z, Math.PI);
  h.p.setAction('water_surface');
  let t = 0;
  for (; t < 600 && !(h.p.grounded && Math.abs(h.at().y - B.top) < 1); t++) h.tick(h.p.inWater ? { A: t % 12 === 0 } : { stickY: 1 }, Math.PI);
  assert.ok(t < 600, `up on the first terrace: ${JSON.stringify(h.at())} (${h.p.action})`);
  assert.equal(col.findFloor(h.p.pos.x, h.p.pos.y + 10, h.p.pos.z).surface.terrain, 'stone');
  assert.ok(h.p.health === 8 || h.p.breath > 0.5, 'no harm done');
});

test('the islet: walking hops up the two blocks onto the second terrace, then the stair onto the third', () => {
  const B = sk.BLOCKS;
  const T2 = sk.TERRACES[1];
  // The second terrace's east face (a flat edge of its polygon).
  const faceX = sk.ISLET.x + T2.r * Math.cos(Math.PI / T2.sides);
  // Walk along yaw at half speed, hop (A held 6 ticks) 80 before the face at `edge` (along yaw).
  const hop = (h, yaw, edge) => {
    let jumped = -1;
    for (let t = 0; t < 150; t++) {
      if (jumped < 0 && h.p.grounded && along(h.at(), yaw) > edge - 80) jumped = t;
      h.tick({ stickY: 0.5, A: jumped >= 0 && t - jumped < 6 }, yaw);
      if (jumped >= 0 && h.p.grounded && t - jumped > 3) break;
    }
    for (let t = 0; t < 10; t++) h.tick({}, yaw);
    return Math.round(h.at().y);
  };
  const mid = (B[0].z0 + B[0].z1) / 2;
  const h = hero((B[0].x0 + B[0].x1) / 2, sk.TERRACES[0].top, -3700, Math.PI);
  const north = Math.PI;
  const west = -Math.PI / 2;
  const tops = [hop(h, north, -B[0].z1)];
  // Along the first block to its middle, then west up the second onto the terrace and on.
  for (let t = 0; t < 60 && h.at().z > mid; t++) h.tick({ stickY: 0.5 }, north);
  tops.push(hop(h, west, -B[1].x1), hop(h, west, -faceX));
  for (let t = 0; t < 20; t++) h.tick({ stickY: 0.5 }, west);
  assert.deepEqual(tops, [B[0].top, B[1].top, T2.top], 'block by block');
  assert.equal(h.coins(), 3, 'the coins on the blocks and the second terrace\'s by them');

  const S = sk.STAIR;
  const yaw = Math.atan2(S.head.x - S.foot.x, S.head.z - S.foot.z);
  const up = hero(S.foot.x - Math.sin(yaw) * 200, S.foot.y, S.foot.z - Math.cos(yaw) * 200, yaw);
  let t = 0;
  for (; t < 150 && !(up.p.grounded && up.at().y > S.head.y - 1); t++) up.tick({ stickY: 1 }, yaw);
  assert.ok(t < 150, `up the stair: ${JSON.stringify(up.at())}`);
  assert.equal(up.coins(), 2, 'the stair\'s coins');
  // A stop on the landing at its head, then a walk across the third terrace toward the mast.
  for (let k = 0; k < 10; k++) up.tick({}, yaw);
  assert.equal(Math.round(up.at().y), sk.TERRACES[2].top);
  const toMast = () => Math.atan2(sk.MAST.x - up.at().x, sk.MAST.z - up.at().z);
  for (let k = 0; k < 20; k++) up.tick({ stickY: 0.6 }, toMast());
  assert.equal(Math.round(up.at().y), sk.TERRACES[2].top);
  assert.ok(up.p.grounded);
});

test('the signal mast: the climb, the handstand on its tip and the jump onto the gallery, for aims up to 15 degrees off the lighthouse; then round the gallery to the star', () => {
  const M = sk.MAST;
  const L = sk.LIGHTHOUSE;
  const landed = [];
  for (const deg of [-15, -8, 0, 8, 15]) {
    // Onto the mast from the lighthouse's side, then the jump back north toward it.
    const h = hero(M.x, M.y0, M.z - 250, 0);
    h.tick({ stickY: 1 }, 0);
    for (let k = 0; k < 60 && h.p.action !== 'pole'; k++) h.tick({ stickY: 1, A: k === 3 }, 0);
    assert.equal(h.p.action, 'pole', 'grabbed it');
    let climb = 0;
    for (; climb < 400 && h.p.action !== 'pole_top'; climb++) h.tick({ stickY: 1 }, 0);
    assert.equal(h.p.action, 'pole_top', 'up on its tip');
    assert.ok(climb < 260, `${climb} ticks up`);
    assert.equal(h.coins(), 3, 'the three coins up the mast');
    const aim = Math.PI + (deg * Math.PI) / 180;
    for (let k = 0; k < 4; k++) h.tick({ stickY: 1 }, aim);
    let end = null;
    for (let k = 0; k < 150 && !end; k++) {
      h.tick({ stickY: 1, A: true }, aim);
      if (k > 3 && (h.p.grounded || h.p.action === 'ledge_hang')) end = h.at();
    }
    landed.push(end && Math.round(end.y));
    if (deg !== 0) continue;
    // Round the gallery's east side to the star.
    const star = sk.STAR;
    for (let k = 0; k < 120 && !h.log.some((e) => e.name === 'starCollected'); k++) {
      const q = h.at();
      h.tick({ stickY: 1 }, Math.atan2(star.x - q.x, star.z - q.z));
    }
    const got = h.log.find((e) => e.name === 'starCollected');
    assert.ok(got, 'the star');
    assert.deepEqual([got.id, got.area], ['skerries_star', 'skerries']);
    assert.equal(h.p.stars, 1);
  }
  assert.deepEqual(landed, [L.gallery, L.gallery, L.gallery, L.gallery, L.gallery], 'on the gallery');
});

test("the signal mast as a player meets it, with the follow camera: walked to from the stair's head (or round any other side), climbed, a rest on its tip facing the lighthouse, then the stick pushed at it on the screen and A: onto the gallery", () => {
  const M = sk.MAST;
  const L = sk.LIGHTHOUSE;
  const T3 = sk.TERRACES[2].top;
  const S = sk.STAIR;
  const sign = sk.SIGNS.find((e) => e.id === 'skerries_mast');
  const starts = {
    "the stair's head": S.head,
    'the sign': { x: sign.x + Math.sin(sign.yaw) * 120, z: sign.z + Math.cos(sign.yaw) * 120 },
    east: { x: M.x + 500, z: M.z - 100 },
    west: { x: M.x - 500, z: M.z - 100 },
    south: { x: M.x, z: M.z + 140 },
  };
  const ends = {};
  for (const [name, from] of Object.entries(starts)) {
    const h = hero(from.x, T3, from.z, Math.atan2(M.x - from.x, M.z - from.z));
    const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000), events: new Events() });
    cam.reset(h.p);
    const tick = (input) => {
      const c = h.ctl.next(input);
      h.p.update(cam.playerInput(c), cam.getYaw());
      h.om.update({ player: h.p });
      cam.update(c, h.p);
    };
    // The stick toward a local point, for the camera as it is.
    const toward = (x, z) => {
      const q = h.at();
      const a = Math.atan2(Math.sin(cam.getYaw() - Math.atan2(x - q.x, z - q.z)), Math.cos(cam.getYaw() - Math.atan2(x - q.x, z - q.z)));
      return { stickX: Math.sin(a), stickY: Math.cos(a) };
    };
    // Walk up to it and jump at it, then climb all the way and rest on the tip.
    for (let k = 0; k < 200 && h.p.action !== 'pole'; k++) {
      const q = h.at();
      tick({ ...toward(M.x, M.z), A: Math.hypot(q.x - M.x, q.z - M.z) < 130 && h.p.grounded });
    }
    assert.equal(h.p.action, 'pole', `${name}: grabbed it`);
    for (let k = 0; k < 400 && h.p.action !== 'pole_top'; k++) tick({ stickY: 1 });
    for (let k = 0; k < 40; k++) tick({});
    assert.equal(h.p.action, 'pole_top', `${name}: resting on its tip`);
    assert.ok(Math.abs(Math.atan2(Math.sin(h.p.faceYaw - Math.PI), Math.cos(h.p.faceYaw - Math.PI))) < 0.02, `${name}: facing the lighthouse (${h.p.faceYaw.toFixed(2)})`);
    // Where the lighthouse's lantern shows on the screen, from where Jonas is: the stick pushed
    // that way (the camera looks past him at it: the stick is pushed up).
    const view = cam.camera;
    view.position.copy(cam.pos);
    view.lookAt(cam.target);
    view.updateMatrixWorld();
    const lantern = new THREE.Vector3(L.x + O.x, L.gallery + 300 + O.y, L.z + O.z).project(view);
    const him = new THREE.Vector3(h.p.pos.x, h.p.pos.y + 100, h.p.pos.z).project(view);
    assert.ok(Math.abs(lantern.x) < 0.33, `${name}: the lighthouse in the middle of the picture (x ${lantern.x.toFixed(2)})`);
    const [sx, sy] = [lantern.x - him.x, lantern.y - him.y];
    const push = { stickX: sx / Math.hypot(sx, sy), stickY: sy / Math.hypot(sx, sy) };
    assert.ok(push.stickY > 0.9, `${name}: pushed up (${push.stickX.toFixed(2)}, ${push.stickY.toFixed(2)}), not down onto the trunk`);
    for (let k = 0; k < 4; k++) tick(push);
    let end = null;
    for (let k = 0; k < 150 && !end; k++) {
      tick({ ...push, A: true });
      if (k > 3 && (h.p.grounded || h.p.inWater || h.p.action === 'ledge_hang')) end = h.at();
    }
    ends[name] = end && Math.round(end.y);
  }
  assert.deepEqual(ends, Object.fromEntries(Object.keys(starts).map((k) => [k, L.gallery])), 'on the gallery');
});
