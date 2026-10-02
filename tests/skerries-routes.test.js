// The routes of Midsummer Skerries, played with scripted input on the real course (world/area.js
// buildArea at its origin) with the real Player and the course's own ObjectManager: each running
// hop from Home Island's corner across the stepping skerries to Great Rock; the long jump from
// s4 to s5 (over the arc of coins), where a plain running jump falls in the water; out of the
// water onto every rock (a swim up to it, a water jump up its sheer side); the swim across the
// Sound to the islet's south beach and the walk up it; the first terrace up the two blocks to
// the second, the stair to the third; the signal mast (the climb, the handstand on its tip, the
// jump onto the lamp gallery for aims up to 15 degrees off); the mast as a player meets it, with
// the real follow camera (walked to from the stair's head and every other side, a rest on its
// tip, facing the lighthouse, then the stick pushed at it where it shows on the screen); the
// walk round the gallery to the star ('starCollected' { id: 'skerries_star', area: 'skerries' });
// the east route: running jumps over the boardwalk's two gaps (on past the second up onto East
// Rock without leaving the ground) and along its narrow plank (off its middle too; past its edge
// he falls off), wall kicks up the chimney onto the net shed's loft (the stick angled toward its
// back wall too; run into and walked into with the follow camera, from behind and off to the
// sides) or the net mast's tip jump, the plank bridge (its gap jumped at a run, not at a walk)
// down onto the islet's second terrace; a dive to the sunken boat for the 1-up; the maypole's
// climb past its four coins. No route ever wakes one of the course's critters (or is hurt by
// one).
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
  for (const name of ['coin', 'oneUp', 'starCollected']) events.on(name, (e) => log.push({ name, ...e }));
  const p = new Player({ collision: col, events, spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: col, events, layout: area.objectsLayout, player: p, area: 'skerries' });
  const at = () => ({ x: p.pos.x - O.x, y: p.pos.y - O.y, z: p.pos.z - O.z });
  const tick = (input, camYaw) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
    // The critters live clear of every route.
    assert.equal(om.critters.engaged, 0, 'a route never wakes a critter');
    assert.equal(om.critters.hits, 0);
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

test("the boardwalk: a running jump over each gap lands on the stretch beyond (past the first, on its long deck short of the plank, even let go; past the second, on the step higher last stretch, and he walks on up onto East Rock); the narrow plank holds him off its middle line too, and past its edge he falls off", () => {
  const W = sk.BOARDWALK;
  const st = W.stretches;
  const E = sk.EAST_ROCK;
  const north = Math.PI;
  const on = (w, q) => q.x > w.x0 && q.x < w.x1 && q.z > w.z0 && q.z < w.z1 && Math.abs(q.y - (w.top ?? W.top)) < 1;
  // On East Rock's top (granite, not the last stretch's planks running on under its edge).
  const onRock = (h) => h.p.grounded && Math.abs(h.at().y - E.top) < 1 && col.findFloor(h.p.pos.x, h.p.pos.y + 10, h.p.pos.z).surface.terrain === 'stone';
  // From `back` before the north edge of stretch a, running north at x, jumping (A held) `pre`
  // before its edge: where he lands; then `after` ticks with the stick held on (or let go).
  const gapJump = (a, x, back, pre, { after = 0, hold = true } = {}) => {
    const s = st[a];
    const h = hero(x, W.top, s.z0 + back, north);
    let jumped = -1;
    let landed = null;
    for (let t = 0; t < 200 && !landed; t++) {
      if (jumped < 0 && h.p.grounded && h.at().z < s.z0 + pre) jumped = t;
      h.tick({ stickY: 1, A: jumped >= 0 }, north);
      if (jumped >= 0 && t - jumped > 3 && (h.p.inWater || (h.p.grounded && h.p.action !== 'jump'))) landed = h.at();
    }
    let air = 0;
    for (let t = 0; t < after && !h.p.inWater && !onRock(h); t++) {
      h.tick({ stickY: hold ? 1 : 0 }, north);
      if (!h.p.grounded) air++;
    }
    return { h, landed, air, water: h.p.inWater, end: h.at() };
  };
  const off = [];
  for (const x of [2640, 2700, 2760]) {
    for (const pre of [50, 90, 130]) {
      // The first gap, from far back on the corner stretch (at full speed) or nearer: on the
      // long deck beyond, and let go, he skids to a stop on it, short of the plank.
      for (const back of [560, 250]) {
        const { landed, water, end } = gapJump(1, x, back, pre, { after: 40, hold: false });
        if (water || !landed || !on(st[2], landed) || !on(st[2], end)) off.push(`gap 1 from ${x}, ${back} back, ${pre} before: ${JSON.stringify(landed)} then ${water ? 'water' : JSON.stringify(end)}`);
      }
      // The second: onto the last stretch, a step higher (or, from nearer the edge, on over it
      // onto East Rock); the stick held on, he walks on up onto the rock without leaving the
      // ground.
      const { h, landed, air, water } = gapJump(4, x, 240, pre, { after: 120 });
      if (water || !landed || Math.abs(landed.y - E.top) >= 1 || landed.z > st[5].z1 || air > 0 || !onRock(h)) off.push(`gap 2 from ${x}, ${pre} before: ${JSON.stringify(landed)} then ${water ? 'water' : JSON.stringify(h.at())} (${air} ticks in the air)`);
    }
  }
  assert.deepEqual(off, []);

  // Up off the last stretch onto East Rock, walked or run, with the stick held up (the camera
  // looking north, or the real follow camera behind him): where it meets the rock's slanted
  // south-west face and its south face, never a wall in his way, never off the ground.
  const last = st[5];
  const stuck = [];
  for (const x of [last.x0 + 20, (last.x0 + last.x1) / 2, last.x1 - 10]) {
    for (const stickY of [1, 0.5]) {
      for (const follow of [false, true]) {
        const h = hero(x, last.top, last.z1 - 20, north);
        const cam = follow ? new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000), events: new Events() }) : null;
        cam?.reset(h.p);
        let air = 0;
        for (let t = 0; t < 120 && h.at().z > last.z0 - 200; t++) {
          if (cam) {
            const c = h.ctl.next({ stickY });
            h.p.update(cam.playerInput(c), cam.getYaw());
            cam.update(c, h.p);
          } else h.tick({ stickY }, north);
          if (!h.p.grounded) air++;
        }
        if (air > 0 || !onRock(h) || h.at().z > last.z0 - 200) stuck.push(`from ${x}, stick ${stickY}${follow ? ', follow camera' : ''}: ${JSON.stringify(h.at())} (${air} ticks in the air)`);
      }
    }
  }
  assert.deepEqual(stuck, []);

  // The plank: from the stretch south of it to the one north of it, at a run and a walk, never
  // off the ground: along its middle, 40 either side of it, and with the stick 5 degrees off
  // (toward its middle when he starts off it); 100 off its middle (his middle past its edge),
  // he falls off.
  const plank = st.find((w) => w.narrow);
  const mid = (plank.x0 + plank.x1) / 2;
  const walks = [];
  for (const [dx, deg, holds] of [[0, 0, true], [-40, 0, true], [40, 0, true], [0, -5, true], [0, 5, true], [-40, -5, true], [40, 5, true], [-100, 0, false], [100, 0, false]]) {
    for (const stickY of [1, 0.5]) {
      const h = hero(mid + dx, W.top, plank.z1 + 150, north);
      const yaw = north + (deg * Math.PI) / 180;
      let air = 0;
      for (let t = 0; t < 200 && h.at().z > plank.z0 - 100 && !h.p.inWater; t++) {
        h.tick({ stickY }, yaw);
        if (!h.p.grounded) air++;
      }
      const across = air === 0 && Math.abs(h.at().y - W.top) < 1 && h.at().z <= plank.z0 - 100;
      if (across !== holds) walks.push(`${dx} off its middle, ${deg} degrees, stick ${stickY}: ${across ? 'across' : 'fell off'} at ${JSON.stringify(h.at())}`);
    }
  }
  assert.deepEqual(walks, []);

  // Out along it from Home Island: east along the first stretch onto the second.
  const walk = hero(1500, sk.HOME.top, 2300, Math.PI / 2);
  for (let t = 0; t < 200 && walk.at().x < st[1].x0 + 100; t++) walk.tick({ stickY: 1 }, Math.PI / 2);
  assert.ok(walk.p.grounded && Math.abs(walk.at().y - W.top) < 1, `onto the boardwalk: ${JSON.stringify(walk.at())}`);
  assert.equal(walk.coins(), 2, 'its first two coins');
});

test("East Rock: wall kicks back and forth up the 360-wide chimney reach the net shed's loft (taking its three coins), the stick pushed straight across or angled toward the back wall, from anywhere in it; walked or run into from the south with the follow camera too; the net mast's tip jump lands on the loft for aims up to 15 degrees off, the stick let go or held on", () => {
  const C = sk.CHIMNEY;
  const S = sk.NET_SHED;
  assert.equal(C.x1 - C.x0, 360);
  const east = Math.PI / 2;
  const north = Math.PI; // the camera looking into the chimney, as the follow camera does
  // The stick for world yaw W, the camera looking along camYaw.
  const stickFor = (camYaw, W, k = 1) => {
    const a = Math.atan2(Math.sin(camYaw - W), Math.cos(camYaw - W));
    return { stickX: Math.sin(a) * k, stickY: Math.cos(a) * k };
  };
  const failed = [];
  // Kicking back and forth across the chimney (the hall slot's script), the stick `deg` toward
  // the back wall (a child pushing left and right with a little up in it): from its middle, near
  // its mouth, and pressed against the back wall in its corners. There he touches the back wall
  // as well as the side he kicks off.
  for (const [x, z, d0] of [[C.x0 + 60, (C.z0 + C.z1) / 2, 1], [C.x1 - 60, (C.z0 + C.z1) / 2, -1], [C.x0 + 60, C.z1 - 60, 1], [C.x0 + 60, C.z0 + 50, 1], [C.x1 - 60, C.z0 + 50, -1]]) {
    for (const deg of [0, 10, 20]) {
      const h = hero(x, sk.EAST_ROCK.top, z, d0 * east);
      const a = (deg * Math.PI) / 180;
      let dir = d0;
      let kicks = 0;
      let top = 0;
      for (let i = 0; i < 400; i++) {
        const p = h.p;
        const hit = p.action === 'air_hit_wall';
        if (hit) {
          dir = -dir;
          kicks++;
        }
        const mid = Math.abs(h.at().x - (C.x0 + C.x1) / 2) < (C.x1 - C.x0) / 2 - 40;
        h.tick({ ...stickFor(north, dir * (east + a)), A: hit || (p.grounded && i > 2 && mid && kicks === 0 && p.forwardVel > 8) }, north);
        top = Math.max(top, h.at().y);
        if (p.grounded && kicks > 0 && i > 20) break;
      }
      const q = h.at();
      if (kicks < 4 || top < S.top || Math.abs(q.y - S.top) >= 1 || h.coins() !== 3) failed.push(`from (${x}, ${z}), ${deg} degrees up: ${kicks} kicks, ${h.coins()} coins, up to ${top.toFixed(0)}, ends ${JSON.stringify(q)}`);
    }
  }
  assert.deepEqual(failed, []);

  // As a player meets it, with the follow camera: walked into from the south, a stop, then the
  // stick pushed left and right as the camera shows the chimney's walls, jump on the bump; or
  // run into at full tilt and the stick swung at a side wall at once, no stop: the back wall
  // stops the run (without it he ran on out of the chimney's north end), he runs across, up
  // against that wall if it is too near to jump at and back, jumps and kicks. Up onto the top
  // (the loft or the pinnacle's) every time, never out of the camera's sight.
  // (`from`: how far south of the chimney's mouth he starts, `camYaw`: the camera's orbit yaw
  // to start with, as an entry's; null: behind him.)
  const play = (x, { run = false, turnAt = (C.z0 + C.z1) / 2, d0 = 1, from = 500, camYaw = null } = {}) => {
    const h = hero(x, sk.EAST_ROCK.top, C.z1 + from, Math.PI);
    const cam = new CameraController({ collision: col, camera: new THREE.PerspectiveCamera(45, 16 / 9, 20, 45000), events: new Events() });
    cam.reset(h.p, camYaw === null ? {} : { yaw: camYaw });
    let hidden = 0;
    let longest = 0;
    let streak = 0;
    const tick = (input) => {
      const c = h.ctl.next(input);
      h.p.update(cam.playerInput(c), cam.getYaw());
      h.om.update({ player: h.p });
      cam.update(c, h.p);
      const d = { x: h.p.pos.x - cam.pos.x, y: h.p.pos.y + 100 - cam.pos.y, z: h.p.pos.z - cam.pos.z };
      streak = col.raycast(cam.pos, d, Math.hypot(d.x, d.y, d.z) - 5) ? streak + 1 : 0;
      hidden += streak > 0 ? 1 : 0;
      longest = Math.max(longest, streak);
    };
    for (let k = 0; k < 80 && h.at().z > turnAt; k++) tick(stickFor(cam.getYaw(), Math.PI, run ? 1 : 0.5));
    if (!run) for (let k = 0; k < 15; k++) tick({});
    let dir = d0;
    let kicks = 0;
    for (let i = 0; i < 300; i++) {
      const hit = h.p.action === 'air_hit_wall';
      if (hit) {
        dir = -dir;
        kicks++;
      }
      // Run up against the side wall before a first jump: turn round and run at the other.
      if (kicks === 0 && h.p.grounded && Math.abs(h.at().x - (dir > 0 ? C.x1 : C.x0)) < 80) dir = -dir;
      const mid = Math.abs(h.at().x - (C.x0 + C.x1) / 2) < (C.x1 - C.x0) / 2 - 40;
      const facing = Math.abs(Math.atan2(Math.sin(h.p.faceYaw - dir * east), Math.cos(h.p.faceYaw - dir * east))) < 0.4;
      // Hanging from the top's edge: the stick pushed at it climbs up.
      if (h.p.action === 'ledge_hang') tick(stickFor(cam.getYaw(), h.p.faceYaw));
      else tick({ ...stickFor(cam.getYaw(), dir * east), A: hit || (h.p.grounded && i > 2 && mid && facing && kicks === 0 && h.p.forwardVel > 8) });
      if (h.p.grounded && kicks > 0 && i > 20) break;
    }
    return { h, kicks, hidden, longest };
  };
  {
    const { h, kicks, hidden } = play((C.x0 + C.x1) / 2);
    assert.ok(kicks >= 4 && Math.abs(h.at().y - S.top) < 1, `walked in, with the camera: ${kicks} kicks, up to ${JSON.stringify(h.at())}`);
    assert.equal(hidden, 0, 'never hidden from the camera');
    assert.equal(h.coins(), 3);
  }
  const runs = [];
  for (const x of [C.x0 + 120, (C.x0 + C.x1) / 2, C.x1 - 120]) {
    for (const turnAt of [C.z1 - 20, C.z1 - 60, C.z1 - 100]) {
      for (const d0 of [1, -1]) {
        const { h, kicks, hidden } = play(x, { run: true, turnAt, d0 });
        if (kicks < 4 || Math.abs(h.at().y - S.top) >= 1 || hidden > 0) runs.push(`run in at ${x}, turned at ${turnAt} toward ${d0 > 0 ? 'the shed' : 'the pinnacle'}: ${kicks} kicks, ${hidden} ticks hidden, ends ${JSON.stringify(h.at())}`);
      }
    }
  }
  assert.deepEqual(runs, []);
  // With the camera off to a side of the chimney or ahead of him to start with, walked in or
  // kicking from just inside its mouth: still up onto the top. Seen from a slant the chimney's
  // walls (the pinnacle's south face, the shed's corner further out) hide him for a moment as he
  // goes in or starts to kick, until the camera has swung round to look into it: never longer
  // than half a second (the Great Hall's slot does the same).
  const slant = [];
  for (const camYaw of [0.6, -0.6, 1.2, -1.2, Math.PI]) {
    for (const from of [500, -40]) {
      const { h, kicks, longest } = play((C.x0 + C.x1) / 2, { from, turnAt: from > 0 ? (C.z0 + C.z1) / 2 : Infinity, camYaw });
      if (kicks < 4 || Math.abs(h.at().y - S.top) >= 1 || longest > 15) slant.push(`camera at ${camYaw.toFixed(1)}, ${from > 0 ? 'walked in' : 'kicking from inside'}: ${kicks} kicks, hidden ${longest} ticks in a row, ends ${JSON.stringify(h.at())}`);
    }
  }
  assert.deepEqual(slant, []);

  const M = sk.NET_MAST;
  const off = [];
  for (const deg of [-15, -8, 0, 8, 15]) {
    for (const hold of [false, true]) {
      // Onto the mast from its south side, up to its tip, then the jump north at the shed.
      const h = hero(M.x, M.y0, M.z + 250, Math.PI);
      h.tick({ stickY: 1 }, Math.PI);
      for (let k = 0; k < 60 && h.p.action !== 'pole'; k++) h.tick({ stickY: 1, A: k === 3 }, Math.PI);
      assert.equal(h.p.action, 'pole', 'grabbed it');
      for (let k = 0; k < 400 && h.p.action !== 'pole_top'; k++) h.tick({ stickY: 1 }, Math.PI);
      assert.equal(h.p.action, 'pole_top', 'up on its tip');
      const aim = Math.PI + (deg * Math.PI) / 180;
      for (let k = 0; k < 4; k++) h.tick({ stickY: 1 }, aim);
      let landed = null;
      for (let k = 0; k < 150 && !landed; k++) {
        h.tick({ stickY: hold || k < 2 ? 1 : 0, A: true }, aim);
        if (k > 3 && (h.p.grounded || h.p.inWater || h.p.action === 'ledge_hang')) landed = h.at();
      }
      // On the loft; let go, he stays up there (sliding to a stop on it or against its railing,
      // or on onto the bridge's head where it leaves the loft).
      const onLoft = (q) => Math.abs(q.y - S.top) < 1 && q.x > S.x0 && q.x < S.x1 && q.z > S.z0 && q.z < S.z1;
      for (let k = 0; k < 30; k++) h.tick({}, aim);
      const q = h.at();
      const onBridge = h.p.grounded && q.z < S.z0 && q.y > sk.BRIDGE.head.y - 100;
      if (!landed || !onLoft(landed) || !(onLoft(q) || onBridge)) off.push(`${deg} deg, ${hold ? 'held on' : 'let go'}: ${JSON.stringify(landed)} then ${JSON.stringify(q)}`);
    }
  }
  assert.deepEqual(off, []);
});

test("the plank bridge: from the loft across the chimney's back wall to its head, a running jump over its gap (landing well clear of its far edge, not far past it), and on down it onto the islet's second terrace (its coins on the way); a jump at a walk falls short into the water", () => {
  const B = sk.BRIDGE;
  const yaw = Math.atan2(B.foot.x - B.head.x, B.foot.z - B.head.z);
  const run = Math.hypot(B.foot.x - B.head.x, B.foot.z - B.head.z);
  const fromHead = (q) => along({ x: q.x - B.head.x, z: q.z - B.head.z }, yaw);
  const g0 = (run - B.gap) / 2;
  const g1 = (run + B.gap) / 2;
  const T2 = sk.TERRACES[1].top;
  const N = sk.NET_SHED;
  for (const pre of [40, 100, 160]) {
    // From the middle of the loft (or its north-east corner) over to the head's landing on the
    // back wall, then turned down the bridge.
    const [x, z] = pre === 100 ? [N.x1 - 100, N.z0 + 60] : [(N.x0 + N.x1) / 2, (N.z0 + N.z1) / 2];
    const h = hero(x, N.top, z, 0);
    const to = { x: B.head.x - Math.sin(yaw) * 60, z: B.head.z - Math.cos(yaw) * 60 };
    for (let t = 0; t < 200 && Math.hypot(h.at().x - to.x, h.at().z - to.z) > 40; t++) h.tick({ stickY: 0.6 }, Math.atan2(to.x - h.at().x, to.z - h.at().z));
    assert.ok(Math.hypot(h.at().x - to.x, h.at().z - to.z) <= 40 && Math.abs(h.at().y - B.head.y) < 1, `${pre}: at the bridge's head: ${JSON.stringify(h.at())}`);
    let jumped = -1;
    let landed = null;
    let lowest = Infinity;
    let t = 0;
    for (; t < 300 && !(h.p.grounded && Math.abs(h.at().y - T2) < 1 && fromHead(h.at()) > run + 60); t++) {
      if (jumped < 0 && h.p.grounded && fromHead(h.at()) > g0 - pre) jumped = t;
      h.tick({ stickY: 1, A: jumped >= 0 && t - jumped < 8 }, yaw);
      if (jumped >= 0 && t - jumped > 3 && landed === null && h.p.grounded) landed = fromHead(h.at());
      // Never under the deck's line (off it, or down the gap).
      const s = Math.max(0, Math.min(run, fromHead(h.at())));
      lowest = Math.min(lowest, h.at().y - (B.head.y + ((B.foot.y - B.head.y) * s) / run));
      assert.ok(!h.p.inWater, `${pre}: fell in`);
    }
    assert.ok(t < 300 && jumped >= 0, `${pre}: onto the terrace: ${JSON.stringify(h.at())}`);
    // The gap asks for the run: he lands 100 to 550 past its far edge (were it 150 narrower, he
    // would land further on; twice as wide, he barely makes it, downhill).
    assert.ok(landed - g1 > 100 && landed - g1 < 550, `${pre}: landed ${(landed - g1).toFixed(0)} past the gap`);
    assert.ok(lowest > -5, `${pre}: kept to the bridge (${lowest.toFixed(0)} under its line)`);
    assert.ok(h.coins() >= 2, `${pre}: ${h.coins()} of its coins`);
  }
  // A jump at a walk (the stick at 0.6, from a walk down the bridge 600 before the gap) falls
  // short: the gap wants a running jump.
  for (const pre of [40, 100, 160]) {
    const k = g0 - 600;
    const h = hero(B.head.x + Math.sin(yaw) * k, B.head.y + ((B.foot.y - B.head.y) * k) / run, B.head.z + Math.cos(yaw) * k, yaw);
    let jumped = -1;
    for (let t = 0; t < 300 && !h.p.inWater && !(jumped >= 0 && t - jumped > 3 && h.p.grounded); t++) {
      if (jumped < 0 && h.p.grounded && fromHead(h.at()) > g0 - pre) jumped = t;
      h.tick({ stickY: 0.6, A: jumped >= 0 && t - jumped < 8 }, yaw);
    }
    assert.ok(jumped >= 0 && h.p.inWater, `a walking jump ${pre} before the gap: ${JSON.stringify(h.at())}`);
  }
  // Walked slowly all the way down from the gap's far side, he takes the last two.
  const k = g1 + 20;
  const walk = hero(B.head.x + Math.sin(yaw) * k, B.head.y + ((B.foot.y - B.head.y) * k) / run, B.head.z + Math.cos(yaw) * k, yaw);
  for (let t = 0; t < 300 && fromHead(walk.at()) < run + 80; t++) walk.tick({ stickY: 0.5 }, yaw);
  assert.ok(walk.p.grounded && Math.abs(walk.at().y - T2) < 1, `on the terrace: ${JSON.stringify(walk.at())}`);
  assert.equal(walk.coins(), 2);
});

test('the sunken boat: from the surface anywhere round it, a dive (Z, strokes nose down, then level) takes the 1-up in its stern with breath to spare', () => {
  const G = sk.ONE_UP;
  for (const [dx, dz] of [[500, 500], [-600, 0], [0, -600], [700, -300], [0, 0]]) {
    const yaw0 = Math.atan2(-dx, -dz);
    const h = hero(G.x + dx, 0, G.z + dz, yaw0);
    h.p.teleport(G.x + dx + O.x, -80 + O.y, G.z + dz + O.z, yaw0);
    h.p.setAction('water_surface');
    let t = 0;
    for (; t < 400 && !h.log.some((e) => e.name === 'oneUp'); t++) {
      const q = h.at();
      // Tank controls: stick X turns toward the gem, stick Y pitches (up: nose down) while
      // well over it, levels out at its depth.
      const d = Math.atan2(Math.sin(Math.atan2(G.x - q.x, G.z - q.z) - h.p.faceYaw), Math.cos(Math.atan2(G.x - q.x, G.z - q.z) - h.p.faceYaw));
      const over = q.y - (G.y - 40);
      const stickY = over > 60 ? (Math.hypot(G.x - q.x, G.z - q.z) < 300 ? 1 : 0.7) : over < -40 ? -0.5 : 0;
      h.tick({ stickX: Math.max(-1, Math.min(1, -3 * d)), stickY, A: t % 10 === 0, Z: t === 0 }, 0);
    }
    assert.ok(t < 400, `from (${dx}, ${dz}): the 1-up (${JSON.stringify(h.at())})`);
    assert.equal(h.p.health, 8, 'no wedge lost');
    assert.ok(h.p.breath > 0.5, `breath ${h.p.breath.toFixed(2)}`);
  }
});

test("the maypole and the flagpole: climbed from any side to their tips, the maypole's four coins up its axis on the way", () => {
  const M = sk.MAYPOLE;
  for (const [dx, dz] of [[0, 400], [0, -400], [400, 0], [-400, 0]]) {
    const yaw = Math.atan2(-dx, -dz);
    const h = hero(M.x + dx, M.y0, M.z + dz, yaw);
    for (let k = 0; k < 80 && h.p.action !== 'pole'; k++) {
      const q = h.at();
      h.tick({ stickY: 1, A: Math.hypot(q.x - M.x, q.z - M.z) < 140 && h.p.grounded }, yaw);
    }
    assert.equal(h.p.action, 'pole', `from (${dx}, ${dz}): grabbed it`);
    const before = h.coins();
    for (let k = 0; k < 400 && h.p.action !== 'pole_top'; k++) h.tick({ stickY: 1 }, yaw);
    assert.equal(h.p.action, 'pole_top', 'up on its tip');
    assert.equal(Math.round(h.at().y), M.y1);
    assert.equal(h.coins() - before, 4, 'the four up its axis');
  }
  const F = sk.FLAGPOLE;
  const flag = hero(F.x, F.y0, F.z + 300, Math.PI);
  for (let k = 0; k < 80 && flag.p.action !== 'pole'; k++) flag.tick({ stickY: 1, A: Math.hypot(flag.at().x - F.x, flag.at().z - F.z) < 140 && flag.p.grounded }, Math.PI);
  for (let k = 0; k < 400 && flag.p.action !== 'pole_top'; k++) flag.tick({ stickY: 1 }, Math.PI);
  assert.equal(flag.p.action, 'pole_top');
  assert.equal(Math.round(flag.at().y), F.y1);
});
