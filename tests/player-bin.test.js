// Jonas and a wheelie bin (player/actions/bin.js, player/model/anims/bin.js; the lane's bins,
// objects/laneBoss/LaneBins.js, attached by hand): B punches as ever away from a bin and grabs one
// only in reach and facing it; holding it, pushing it and pulling it his mittens are on its face
// (on its tipped face while he pulls), at his full size and drawn at the realistic look's 0.85
// (scaled about the bin's face on the floor: player/model/scalePivot.js), his boots on the floor;
// the pivot eases in as he grabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import * as lane from '../src/world/lane/layout.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController, ANIM_NAMES as DOCUMENTED } from '../src/player/physics/testCourse.js';
import { ObjectManager } from '../src/objects/ObjectManager.js';
import { Events } from '../src/core/events.js';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { ScalePivot, heroPivot } from '../src/player/model/scalePivot.js';
import { ANIM_NAMES } from '../src/player/model/animations.js';
import { HAND_R } from '../src/player/model/dims.js';
import { BIN_HOLD } from '../src/player/physics/tuning.js';
import * as chunk from '../src/objects/laneBoss/index.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const { GROUND, BINS, BIN } = lane;
const SCALE = lane.LANE_REAL.hero;

function hero(x, z, yaw) {
  const p = new Player({ collision: area.collision, events: new Events(), spawn: area.respawn, signs: area.signs });
  p.teleport(x + O.x, GROUND + O.y, z + O.z, yaw);
  p.setAction('idle');
  const om = new ObjectManager({ scene: new THREE.Scene(), collision: area.collision, events: new Events(), layout: area.objectsLayout, player: p, area: 'lane' });
  om.attachLane(chunk, area);
  om.bins.sendHome();
  const ctl = new ScriptedController();
  const tick = (input = {}, camYaw = 0) => {
    p.update(ctl.next(input), camYaw);
    om.update({ player: p });
  };
  return { p, om, tick };
}

// His model as main.js draws it (at `scale`, shifted to its pivot, the blends settled).
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

test('the bin anims are documented and pose', () => {
  for (const name of ['bin_hold', 'bin_push', 'bin_pull']) {
    assert.ok(ANIM_NAMES.includes(name), name);
    assert.ok(DOCUMENTED.has(name), `${name} documented`);
  }
});

test('B punches as ever away from a bin, and beside one he does not face; it grabs only one in reach that he faces', () => {
  const press = (x, z, yaw) => {
    const h = hero(x, z, yaw);
    h.tick({}, yaw);
    h.tick({ B: true }, yaw);
    return h.p.action;
  };
  assert.equal(press(1200, 900, 0), 'punch', 'on the lawn');
  assert.equal(press(BINS[0].x, 1480, Math.PI), 'punch', 'beside a bin, his back to it');
  assert.equal(press(BINS[0].x, 1480, 0), 'bin_hold', 'facing it in reach');
});

test('holding, pushing and pulling, his mittens are on the bin\'s face (its tipped face as he pulls), at his full size and at the realistic look\'s 0.85, his boots on the floor', () => {
  const h = hero(BINS[0].x, 1480, 0);
  h.tick();
  h.tick({ B: true });
  const b = h.om.bins.list[0];
  for (const [label, input, n, anim] of [['holding', {}, 5, 'bin_hold'], ['pulling', { stickY: -1 }, 20, 'bin_pull'], ['pushing', { stickY: 1 }, 6, 'bin_push']]) {
    for (let t = 0; t < n; t++) h.tick(input);
    assert.equal(h.p.anim, anim, label);
    const face = b.z - BIN.z / 2; // (its north face, toward him; the world's z is the course's)
    for (const s of [1, SCALE]) {
      const m = drawn(h.p, s);
      for (const side of ['L', 'R']) {
        const hand = m.rig[`arm${side}`].hand.getWorldPosition(new THREE.Vector3());
        const up = hand.y - GROUND - O.y;
        // Where the face is at the mitten's height: tipped toward him by b.tip about its foot.
        const at = face - up * Math.tan(b.tip);
        const gap = at - hand.z - HAND_R * s;
        assert.ok(Math.abs(gap) < 2, `${label} at ${s}: the ${side} mitten ${gap.toFixed(1)} off the face`);
        assert.ok(up > 60 * s && up < 130 * s, `${label} at ${s}: on its body (${up.toFixed(0)} up)`);
      }
      const box = new THREE.Box3().setFromObject(m.object3D);
      assert.ok(Math.abs(box.min.y - (h.p.pos.y)) < 3, `${label} at ${s}: his boots on the floor (${(box.min.y - h.p.pos.y).toFixed(1)})`);
    }
  }
});

test('the scale pivot holding a bin: its face under his mittens, on the floor', () => {
  const h = hero(BINS[0].x, 1480, 0);
  h.tick();
  h.tick({ B: true });
  const out = heroPivot('bin_hold', h.p, h.p.pos, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(out.z - h.p.pos.z - BIN_HOLD) < 1e-9 && out.x === h.p.pos.x && out.y === h.p.pos.y);
});
