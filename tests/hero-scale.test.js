// Jonas drawn smaller in a realistic look (layout.LANE_REAL.hero, 0.85: view.heroScale; only his
// model, scaled about his grip: player/model/scalePivot.js), on the real lane with the real
// Player: the pivot per action (his feet, but the ledge's lip under his hands while he hangs
// from it or pulls up onto it); hanging from the dad's eave, the carport's edge and the
// motorhome's roof his mittens stay on the lip (their height and their reach over it within 2
// units of his full size's; along the lip they close in with his smaller shoulders); pulling
// up onto the eave they keep to it; holding each of the poles his mittens keep their grip
// (within 2 of his full size's distance from the trunk) and nothing of him sinks deeper into
// the trunk, his chest never; standing, walking and running his lowest point on the floor
// (within 1; a running stride's flight shrinks with him); his blob shadow at his scale; a change of pivot eased (no pop as he lets go);
// nothing moved at full size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { HAND_R } from '../src/player/model/dims.js';
import { WALL_DIST } from '../src/player/model/physicsLink.js';
import { heroPivot, ScalePivot, PIVOT_BLEND } from '../src/player/model/scalePivot.js';
import { Events } from '../src/core/events.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { GROUND, DAD } = lane;
const S = lane.LANE_REAL.hero;

// Jonas at a local point, facing `yaw`; tick(input, camYaw).
function hero(x, y, z, yaw) {
  const p = new Player({ collision: area.collision, events: new Events(), spawn: { x: x + O.x, y: y + O.y, z: z + O.z, yaw }, signs: area.signs });
  p.teleport(x + O.x, y + O.y, z + O.z, yaw);
  p.setAction('idle');
  const ctl = new ScriptedController();
  return { p, tick: (input, camYaw) => p.update(ctl.next(input), camYaw) };
}

// His model drawn as main.js draws it: at `scale`, shifted to its pivot, posed (frames of 60 Hz,
// the blends settled), world matrices current.
function drawn(player, scale, frames = 40) {
  const model = new PlayerModel();
  const pivot = new ScalePivot();
  model.object3D.scale.setScalar(scale);
  for (let i = 0; i < frames; i++) {
    const rs = player.getRenderState(1);
    pivot.shift(rs, scale, player, 1 / 60);
    model.update(rs, 1 / 60);
  }
  model.object3D.updateMatrixWorld(true);
  return model;
}
const hand = (model, side) => model.rig[`arm${side}`].hand.getWorldPosition(new THREE.Vector3());
// The body's vertices (world), each with its mesh's group's name.
function vertices(model) {
  const out = [];
  model.rig.orient.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) out.push({ v: new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld), part: o.parent.name });
  });
  return out;
}

// The three ledges: a standing jump at the dad's front eave, and at the carport's front edge; a
// running double jump at the motorhome's roof.
function hang(name) {
  if (name === 'motorhome') {
    const M = lane.MOTORHOME;
    const yaw = M.yaw + Math.PI;
    const x = M.cx + Math.sin(M.yaw) * 600;
    const z = M.cz + Math.cos(M.yaw) * 600;
    const h = hero(x, lane.groundHeight(x, z), z, yaw);
    h.tick({}, yaw);
    for (let jump = 0; jump < 2 && h.p.action !== 'ledge_hang'; jump++) {
      h.tick({ stickY: 1 }, yaw);
      h.tick({ stickY: 1, A: true }, yaw);
      for (let t = 0; t < 90 && !(h.p.grounded && t > 2) && h.p.action !== 'ledge_hang'; t++) h.tick({ stickY: 1, A: true }, yaw);
    }
    return h;
  }
  const [x, z] = name === 'eave' ? [-500, DAD.z0 - 110] : [2050, lane.CARPORT.z0 - 110];
  const h = hero(x, GROUND, z, 0);
  h.tick({}, 0);
  h.tick({}, 0);
  for (let t = 0; t < 40 && h.p.action !== 'ledge_hang'; t++) h.tick({ stickY: 1, A: t < 15 }, 0);
  return h;
}

// Each mitten's height over the lip, its reach past the wall's face and its place along the lip.
function onLip(model, p) {
  const { hn, y } = p.ledge;
  return ['L', 'R'].map((side) => {
    const v = hand(model, side);
    const dx = v.x - p.pos.x;
    const dz = v.z - p.pos.z;
    return { up: v.y - y, over: -(dx * hn.x + dz * hn.z) - WALL_DIST, along: dx * -hn.z + dz * hn.x };
  });
}

test('the pivot: his feet, but the ledge\'s lip under his hands hanging from it and pulling up onto it (from where he hung)', () => {
  const feet = { x: 10, y: 20, z: 30 };
  const out = {};
  const player = { ledge: { y: 400, hn: { x: 0, z: -1 }, climbTo: { x: 10, y: 400, z: 120 } }, climbFrom: { x: 12, y: 240, z: 34 }, pole: { x: 10, z: 100, radius: 30 } };
  for (const action of ['idle', 'walk', 'run', 'jump', 'pole', 'pole_top', 'swimming']) assert.deepEqual(heroPivot(action, player, feet, out), feet, action);
  assert.deepEqual(heroPivot('ledge_hang', player, feet, out), { x: 10, y: 400, z: 30 + WALL_DIST });
  assert.deepEqual(heroPivot('ledge_climb', player, feet, out), { x: 12, y: 400, z: 34 + WALL_DIST });
  assert.deepEqual(heroPivot('ledge_hang', { ...player, ledge: null }, feet, out), feet, 'no ledge: his feet');
});

test('hanging from the dad\'s eave, the carport\'s edge and the motorhome\'s roof at 0.85, his mittens stay on the lip (height and reach within 2 of his full size\'s); pulling up onto the eave they keep to it', () => {
  assert.equal(S, 0.85);
  for (const name of ['eave', 'carport', 'motorhome']) {
    const h = hang(name);
    assert.equal(h.p.action, 'ledge_hang', `${name}: hanging`);
    for (let t = 0; t < 8; t++) h.tick({}, 0);
    const full = onLip(drawn(h.p, 1), h.p);
    const small = onLip(drawn(h.p, S), h.p);
    full.forEach((f, i) => {
      const s = small[i];
      assert.ok(f.up > 0 && f.up < 10 && f.over > 0 && f.over < 10, `${name}: at full size on the lip ${JSON.stringify(f)}`);
      assert.ok(Math.abs(s.up - f.up) <= 2 && Math.abs(s.over - f.over) <= 2, `${name}: ${JSON.stringify(s)} vs ${JSON.stringify(f)}`);
      // Along the lip they close in with his shoulders (the pivot between them), no further.
      assert.ok(Math.abs(s.along - S * f.along) <= 2, `${name}: along the lip ${s.along.toFixed(1)} vs ${f.along.toFixed(1)}`);
    });
    // Scaled about his feet instead, they would sink well below the lip.
    const model = new PlayerModel();
    model.object3D.scale.setScalar(S);
    for (let i = 0; i < 40; i++) model.update(h.p.getRenderState(1), 1 / 60);
    model.object3D.updateMatrixWorld(true);
    for (const f of onLip(model, h.p)) assert.ok(f.up < -15, `${name}: about his feet the mittens ${f.up.toFixed(1)} under the lip`);
  }
  // Pulling up onto the eave: the mittens keep to the lip as at full size, the first half of it.
  const h = hang('eave');
  for (let t = 0; t < 8; t++) h.tick({}, 0);
  h.tick({ A: true }, 0);
  assert.equal(h.p.action, 'ledge_climb');
  for (let t = 0; t < 4; t++) {
    const full = onLip(drawn(h.p, 1), h.p);
    const small = onLip(drawn(h.p, S), h.p);
    full.forEach((f, i) => assert.ok(Math.abs(small[i].up - f.up) <= 2 && Math.abs(small[i].over - f.over) <= 2, `climb ${t}: ${JSON.stringify(small[i])} vs ${JSON.stringify(f)}`));
    h.tick({}, 0);
  }
});

test('holding each of the poles (every lamppost among them) at 0.85 his mittens keep their grip (within 2 of his full size\'s gap to the trunk) and nothing sinks deeper into it, his chest never', () => {
  const held = [];
  for (const P of lane.POLES) {
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const sx = P.x + Math.sin(a) * 250;
      const sz = P.z + Math.cos(a) * 250;
      const floor = area.collision.findFloor(sx + O.x, P.y0 + 100 + O.y, sz + O.z);
      if (!floor.surface || Math.abs(floor.y - O.y - P.y0) > 30) continue;
      const h = hero(sx, floor.y - O.y, sz, a + Math.PI);
      for (let k = 0; k < 120 && h.p.action !== 'pole'; k++) {
        const x = h.p.pos.x - O.x;
        const z = h.p.pos.z - O.z;
        h.tick({ stickY: 1, A: Math.hypot(x - P.x, z - P.z) < 130 && h.p.grounded }, Math.atan2(P.x - x, P.z - z));
      }
      if (h.p.action !== 'pole') continue;
      for (let k = 0; k < 20; k++) h.tick({ stickY: 1 }, a + Math.PI);
      for (let k = 0; k < 10; k++) h.tick({}, a + Math.PI);
      held.push(P);
      const pole = h.p.pole;
      const grip = (model) => ['L', 'R'].map((side) => {
        const v = hand(model, side);
        return Math.hypot(v.x - pole.x, v.z - pole.z) - pole.radius - HAND_R * model.object3D.scale.x;
      });
      const deepest = (model, chest = false) => {
        let d = -Infinity;
        for (const { v, part } of vertices(model)) {
          if (v.y > pole.y1 || (chest && part !== 'torso')) continue;
          d = Math.max(d, pole.radius - Math.hypot(v.x - pole.x, v.z - pole.z));
        }
        return d;
      };
      const full = drawn(h.p, 1);
      const small = drawn(h.p, S);
      const [gf, gs] = [grip(full), grip(small)];
      gf.forEach((g, i) => assert.ok(Math.abs(gs[i] - g) <= 2, `pole (${P.x}, ${P.z}): mitten ${gs[i].toFixed(1)} from the trunk (full size ${g.toFixed(1)})`));
      assert.ok(deepest(small) <= Math.max(deepest(full), 0) + 0.5, `pole (${P.x}, ${P.z}): ${deepest(small).toFixed(1)} into the trunk (full size ${deepest(full).toFixed(1)})`);
      assert.ok(deepest(small, true) < 0, `pole (${P.x}, ${P.z}): his chest clear of the trunk`);
      break;
    }
  }
  assert.equal(held.length, lane.POLES.length, 'every pole held');
});

test('standing, walking and running at 0.85 his lowest point is on the floor; his blob shadow at his scale; a change of pivot eases; nothing moves at full size', () => {
  const lows = [];
  for (const [input, n] of [[{}, 20], [{ stickY: 0.4 }, 20], [{ stickY: 1 }, 30], [{ stickY: 1 }, 33]]) {
    const h = hero(-500, GROUND, 600, Math.PI);
    for (let t = 0; t < n; t++) h.tick(input, Math.PI);
    assert.ok(h.p.grounded, h.p.action);
    const model = drawn(h.p, S);
    const low = Math.min(...vertices(model).map(({ v }) => v.y)) - h.p.pos.y;
    const full = Math.min(...vertices(drawn(h.p, 1)).map(({ v }) => v.y)) - h.p.pos.y;
    // (A running stride's flight, both feet off the ground, shrinks with him.)
    assert.ok(Math.abs(low - S * full) <= 0.5, `${h.p.action}: lowest point ${low.toFixed(2)} (full size ${full.toFixed(2)})`);
    if (Math.abs(full) <= 1) assert.ok(Math.abs(low) <= 1, `${h.p.action}: lowest point ${low.toFixed(2)} off the floor`);
    lows.push(low);
    const ws = model.shadow.mesh.getWorldScale(new THREE.Vector3());
    const ms = model.object3D.getWorldScale(new THREE.Vector3());
    assert.ok(Math.abs(ws.y / model.shadow.mesh.scale.y - ms.y) < 1e-9, 'the blob at his scale');
  }
  assert.ok(lows.filter((l) => Math.abs(l) <= 1).length >= 3, `on the floor: ${lows.map((l) => l.toFixed(1))}`);
  // From the hang to letting go: the offset eases from the lip's to none over PIVOT_BLEND.
  const h = hang('eave');
  for (let t = 0; t < 8; t++) h.tick({}, 0);
  const pivot = new ScalePivot();
  const step = (dt) => {
    const rs = h.p.getRenderState(1);
    const feet = { ...rs.pos };
    pivot.shift(rs, S, h.p, dt);
    return rs.pos.y - feet.y;
  };
  for (let i = 0; i < 20; i++) step(1 / 60);
  const lifted = step(1 / 60);
  assert.ok(Math.abs(lifted - (1 - S) * (h.p.ledge.y - h.p.pos.y)) < 1e-6, `hanging: lifted ${lifted}`);
  h.tick({ Z: true }, 0);
  assert.equal(h.p.action, 'freefall');
  const offsets = [];
  for (let t = 0; t <= PIVOT_BLEND * 60 + 1; t++) offsets.push(step(1 / 60));
  for (let i = 1; i < offsets.length; i++) assert.ok(Math.abs(offsets[i] - offsets[i - 1]) < lifted * 0.3, `no pop: ${offsets.map((o) => o.toFixed(1))}`);
  assert.equal(offsets.at(-1), 0);
  // At full size nothing moves.
  const rs = h.p.getRenderState(1);
  const before = { ...rs.pos };
  new ScalePivot().shift(rs, 1, h.p, 1 / 60);
  assert.deepEqual(rs.pos, before);
});
