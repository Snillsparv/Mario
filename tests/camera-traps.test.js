// Camera regressions on the real level with the real hero: C-buttons and drags that would park
// the camera behind a front corner tower of the castle, drops into the moat (smooth, no
// lurches), a swimmer against a trestle post under the bridge (all of him in view), and the
// east hill descent (no dolly lurch where the crest stops hiding his feet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { CameraController } from '../src/camera/CameraController.js';

const level = buildLevel(new THREE.Scene());
const col = level.collision;

// The game loop's order: hero, then camera (as main.js does it).
function makeGame() {
  const sfx = [];
  const events = { emit: (name, data) => name === 'sfx' && sfx.push(data.name) };
  const player = new Player({ collision: col, events: null, spawn: level.spawn });
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  const cam = new CameraController({ collision: col, camera, events });
  const ctl = new ScriptedController();
  const step = (input = {}) => {
    const c = ctl.next(input);
    c.mouseDX = input.mouseDX || 0;
    player.update(cam.playerInput(c), cam.getYaw());
    cam.update(c, player);
  };
  const place = (x, y, z, yaw) => {
    player.teleport(x, y, z, yaw);
    player.setAction('idle');
    cam.reset(player);
  };
  return { player, cam, sfx, step, place };
}

// Whether the straight line from a point `h` above the hero's feet to the camera is clear.
function sees(g, h) {
  const c = g.cam.pos;
  const p = g.player.pos;
  const o = { x: p.x, y: p.y + h, z: p.z };
  const d = { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
  const len = Math.hypot(d.x, d.y, d.z);
  return !col.raycast(o, d, len - 25);
}

// Stick input toward (tx, tz), camera-relative on land, tank controls in the water; `pitch`
// dives a swimmer (stick Y) toward depth `y`.
function steer(g, tx, tz, y) {
  const p = g.player;
  const want = Math.atan2(tx - p.pos.x, tz - p.pos.z);
  if (/swim|water/.test(p.action)) {
    const diff = Math.atan2(Math.sin(want - p.faceYaw), Math.cos(want - p.faceYaw));
    const stickX = Math.max(-1, Math.min(1, -diff * 3));
    if (y === undefined) return { stickX, stickY: 1, A: Math.abs(diff) < 0.6 };
    const dy = p.pos.y - y;
    if (p.action === 'water_surface' && dy > 60) return { stickX, Z: true };
    const pitch = Math.atan2(dy, Math.max(1, Math.hypot(tx - p.pos.x, tz - p.pos.z)));
    return { stickX, stickY: Math.max(-1, Math.min(1, (pitch / (75 * Math.PI / 180)) * 1.3)), A: true };
  }
  const a = g.cam.getYaw() - want;
  return { stickX: Math.sin(a), stickY: Math.cos(a) };
}

test('C-left/C-right that would park the camera behind a front corner tower is refused with a buzz', () => {
  for (const side of [-1, 1]) {
    const g = makeGame();
    // In front of the facade, facing along it toward the corner tower, zoomed out.
    g.place(side * 805, 160, -228, -side * Math.PI / 2);
    for (let i = 0; i < 30; i++) g.step();
    g.step({ CD: true });
    for (let i = 0; i < 60; i++) g.step();
    g.sfx.length = 0;
    g.step({ [side < 0 ? 'CL' : 'CR']: true });
    assert.deepEqual(g.sfx, ['camera_buzz'], `side ${side}: the rotation toward the tower is refused`);
    for (let i = 0; i < 60; i++) {
      g.step();
      assert.ok(sees(g, 80) || sees(g, 150), `side ${side}, tick ${i}: hero hidden`);
    }
    // The other way round is open.
    g.sfx.length = 0;
    g.step({ [side < 0 ? 'CR' : 'CL']: true });
    assert.deepEqual(g.sfx, ['camera_move'], `side ${side}: the rotation away from the tower`);
  }
});

test('a camera dragged round behind the corner tower reports the occlusion and swings back to a clear view', () => {
  const g = makeGame();
  g.place(-805, 160, -228, Math.PI / 2);
  for (let i = 0; i < 30; i++) g.step();
  g.step({ CD: true });
  for (let i = 0; i < 60; i++) g.step();
  // A 45 deg mouse drag to the camera's left (what C-left would have done).
  for (let i = 0; i < 6; i++) g.step({ mouseDX: (Math.PI / 4) / 0.006 / 6 });
  let occluded = false;
  let seenAt = -1;
  for (let i = 0; i < 90 && seenAt < 0; i++) {
    g.step();
    occluded ||= g.cam.collider.occluded;
    if (sees(g, 80) && sees(g, 150)) seenAt = i;
  }
  assert.ok(occluded, 'the collider reported the hero hidden');
  // (Before: stuck behind the tower, hero out of sight indefinitely.)
  assert.ok(seenAt >= 0 && seenAt < 45, `hero back in view after ${seenAt} ticks`);
  for (let i = 0; i < 60; i++) {
    g.step();
    assert.ok(sees(g, 80) || sees(g, 150), `tick ${i}: hidden again`);
  }
});

// Largest per-tick camera move over `ticks` ticks of `input(i)` (after the first tick).
function worstStep(g, ticks, input, stop) {
  let prev = g.cam.pos.clone();
  let worst = 0;
  for (let i = 0; i < ticks; i++) {
    g.step(input(i));
    if (i > 0) worst = Math.max(worst, g.cam.pos.distanceTo(prev));
    prev.copy(g.cam.pos);
    if (stop?.(i)) break;
  }
  return worst;
}

test('dropping into the moat: no camera lurches', () => {
  // Down the east hill's rim into the moat, and off the courtyard's west edge beside the bridge
  // (the camera also passes the bridge's north pillar there), then swimming on.
  const runs = [
    [6200, -2000, -2.3],
    [6300, -3200, -0.8],
    [5700, -1800, -2.6],
  ];
  for (const [x0, z0, yaw] of runs) {
    const g = makeGame();
    g.place(x0, col.findFloor(x0, 1e5, z0).y, z0, yaw);
    for (let i = 0; i < 5; i++) g.step();
    const tx = x0 + Math.sin(yaw) * 4000;
    const tz = z0 + Math.cos(yaw) * 4000;
    let wet = -1;
    const worst = worstStep(g, 200, () => steer(g, tx, tz), (i) => {
      if (wet < 0 && g.player.inWater) wet = i;
      return wet >= 0 && i > wet + 40;
    });
    assert.ok(wet > 0, `from ${x0},${z0}: reached the moat`);
    // (Before: 145-160 a tick as the hero went under.)
    assert.ok(worst < 100, `from ${x0},${z0}: the camera moved ${worst.toFixed(0)} in a tick`);
  }
  const g = makeGame();
  g.place(-700, 160, 0, 0);
  for (let i = 0; i < 5; i++) g.step();
  let phase = 0;
  const worst = worstStep(g, 150, () => {
    if (phase === 0 && Math.hypot(g.player.pos.x + 700, g.player.pos.z - 700) < 60) phase = 1;
    return phase === 0 ? steer(g, -700, 700) : steer(g, -300, 420, -420);
  });
  assert.ok(g.player.inWater, 'the hero is swimming');
  // (Before: up to 227 in a tick.)
  assert.ok(worst < 100, `west edge: the camera moved ${worst.toFixed(0)} in a tick`);
});

test('a swimmer against a trestle post under the bridge stays all in view', () => {
  // Off the west edge beside the bridge, then swimming for the red coin under the bridge: the
  // hero ends up pressed against the west post of the south trestle.
  const g = makeGame();
  g.place(-700, 160, 0, 0);
  for (let i = 0; i < 5; i++) g.step();
  for (let i = 0; i < 200 && Math.hypot(g.player.pos.x + 700, g.player.pos.z - 700) > 60; i++) g.step(steer(g, -700, 700));
  for (let i = 0; i < 200; i++) g.step(steer(g, 0, 850, -400));
  const p = g.player.pos;
  assert.ok(Math.hypot(p.x + 310, p.z - 850) < 100 && g.player.inWater, `hero at the post (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
  // Hips, chest, head and either side of the chest (across the view) all in sight.
  let blocked = 0;
  for (let i = 0; i < 30; i++) {
    g.step(steer(g, 0, 850, -400));
    if (!g.cam.collider.heroInView(g.cam.hero, g.cam.pos)) blocked++;
  }
  // (Before: a post of the other trestle covered half of him the whole time.)
  assert.equal(blocked, 0, `part of the hero hidden for ${blocked} of 30 ticks`);
});

test('walking down the east hill: no dolly lurch where the crest stops hiding the feet', () => {
  const g = makeGame();
  const x0 = 6500;
  const z0 = -2600;
  g.place(x0, col.findFloor(x0, 1e5, z0).y, z0, -Math.PI / 2);
  for (let i = 0; i < 5; i++) g.step();
  let prev = g.cam.pos.clone();
  let heroPrev = { ...g.player.pos };
  let worst = 0;
  for (let i = 0; i < 80 && !g.player.inWater && g.player.action !== 'freefall'; i++) {
    g.step(steer(g, x0 - 4000, z0));
    const heroStep = Math.hypot(g.player.pos.x - heroPrev.x, g.player.pos.y - heroPrev.y, g.player.pos.z - heroPrev.z);
    if (i > 0) worst = Math.max(worst, g.cam.pos.distanceTo(prev) - heroStep);
    prev.copy(g.cam.pos);
    heroPrev = { ...g.player.pos };
  }
  // The camera moves little more than the hero does. (Before: ~100 a tick for 4 ticks, ~55
  // more than the hero, as a dolly took over from the lift.)
  assert.ok(worst < 30, `the camera moved ${worst.toFixed(0)} more than the hero in a tick`);
});
