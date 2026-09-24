// Round-3 feedback moves: the handstand on top of a climbed tree, the keyboard long jump
// (Z and A together or in either order), fire damage's hot-foot hop, footstep speeds and
// running jumps into trunk colliders at speed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/core/input.js';
import { Events } from '../src/core/events.js';
import { angleDiff, stickToWorldYaw } from '../src/core/math.js';
import { Player } from '../src/player/Player.js';
import { ANIM_NAMES, CourseBuilder, ScriptedController, createSim as sim } from '../src/player/physics/testCourse.js';
import * as T from '../src/player/physics/tuning.js';
import { buildLevel } from '../src/world/level.js';

const flat = (b) => b.ground(30000);

// Octagonal wall-only prism (like the props' trunk colliders): vertex radius r.
function prism(b, x, z, y0, y1, r, sides = 8) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * 2 * Math.PI;
    const a1 = ((i + 1) / sides) * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    const p0 = [x + r * Math.sin(a0), z + r * Math.cos(a0)];
    const p1 = [x + r * Math.sin(a1), z + r * Math.cos(a1)];
    b.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [Math.sin(am), 0, Math.cos(am)]);
  }
}

// Stick input that pushes toward world yaw `yaw` (camera yaw 0).
const toward = (yaw, extra = {}) => ({ stickX: -Math.sin(yaw), stickY: Math.cos(yaw), ...extra });

test('the new anims are part of the documented AnimName list', () => {
  assert.ok(ANIM_NAMES.has('pole_handstand'));
  assert.ok(ANIM_NAMES.has('burn'));
});

describe('handstand on top of a tree', () => {
  // A tree like the level's: a trunk prism under the canopy and a pole up to the crown, 1300 tall.
  const TIP = 1300;
  const tree = (b) => {
    flat(b);
    prism(b, 0, 0, -100, 500, 45);
    b.pole(0, 0, 0, TIP, 40);
  };

  // Grabs the trunk from direction a (radians from the trunk) and climbs until the handstand.
  function climbToTop(a = 0.3) {
    const s = sim(tree, { x: Math.sin(a) * 100, y: 250, z: Math.cos(a) * 100, yaw: a + Math.PI });
    s.p.setAction('freefall');
    s.until(10, {}, (p) => p.action === 'pole');
    assert.equal(s.p.action, 'pole', 'grabbed the trunk');
    const trace = [];
    s.until(300, { stickY: 1 }, (p) => (trace.push({ action: p.action, y: p.pos.y }), p.action === 'pole_top'));
    return { s, trace };
  }

  test('climbing on up the trunk ends in a handstand with the hands on the pole tip', () => {
    for (const a of [0.3, 2, 4]) {
      const { s, trace } = climbToTop(a);
      const p = s.p;
      assert.equal(p.action, 'pole_top');
      assert.equal(p.anim, 'pole_handstand');
      const climbTop = Math.max(...trace.filter((t) => t.action === 'pole').map((t) => t.y));
      assert.equal(climbTop, TIP - T.HANG_DEPTH, 'climbed until the hands reach the tip');
      assert.deepEqual({ ...p.pos }, { x: 0, y: TIP, z: 0 }, 'pos = the pole tip');
      // Entering, the render position does not smear from the climbing spot to the tip.
      assert.deepEqual(p.getRenderState(0).pos, { x: 0, y: TIP, z: 0 });
      const yaw = p.faceYaw;
      s.run(40, { stickY: 1 }, (pp) => {
        assert.equal(pp.action, 'pole_top', 'stays balanced while the stick is held up');
        assert.deepEqual({ ...pp.pos }, { x: 0, y: TIP, z: 0 });
      });
      assert.equal(p.faceYaw, yaw, 'keeps facing the way he climbed');
      assert.ok(!p.grounded && p.floor.y === 0, 'the blob shadow stays on the ground below');
      assert.equal(p.getRenderState(1).anim, 'pole_handstand');
    }
  });

  test('stick left/right turns the handstand round on the tip', () => {
    const { s } = climbToTop(0.3);
    const p = s.p;
    s.run(T.POLE_TOP_SETTLE_TICKS, {});
    for (const dir of [1, -1]) {
      const yaw = p.faceYaw;
      s.run(10, { stickX: dir }, (pp) => {
        assert.equal(pp.action, 'pole_top', 'keeps balancing while turning');
        assert.deepEqual({ ...pp.pos }, { x: 0, y: TIP, z: 0 }, 'hands stay on the tip');
      });
      const turned = angleDiff(yaw, p.faceYaw);
      assert.ok(Math.abs(turned + dir * 10 * T.POLE_TOP_TURN_RATE) < 1e-6, `turned ${turned.toFixed(3)} for stick ${dir}`);
    }
  });

  test('A springs off in a big high flip with a little forward speed; the landing never hurts', () => {
    for (const stick of [null, 'side']) {
      const { s } = climbToTop();
      const yaw = s.p.faceYaw;
      s.run(10, {});
      const hurtBefore = s.events('hurt').length;
      const input = stick ? { stickX: 1 } : {};
      s.run(1, { ...input, A: true });
      assert.equal(s.p.action, 'pole_top_jump');
      assert.equal(s.p.anim, 'triple_jump');
      assert.ok(s.sfx().includes('triple_jump'));
      const vy = s.p.vel.y + T.GRAVITY; // one gravity step already applied
      assert.ok(vy >= 62 && vy <= 70, `take-off vy ${vy}`);
      assert.ok(s.p.forwardVel > 8 && s.p.forwardVel < 18, `forward speed ${s.p.forwardVel}`);
      const want = stick ? stickToWorldYaw(1, 0, 0) : yaw;
      assert.ok(Math.abs(angleDiff(s.p.faceYaw, want)) < 1e-9, `jumps toward ${stick ?? 'the facing'}`);
      let peak = 0;
      const acts = new Set();
      s.until(150, {}, (p) => ((peak = Math.max(peak, p.pos.y)), acts.add(p.action), p.grounded));
      assert.ok(peak > TIP + 500, `peak ${peak - TIP} above the tip`);
      assert.ok(s.p.grounded && s.p.pos.y === 0, 'lands on the ground');
      assert.ok(!acts.has('pole'), `never re-grabs the trunk: ${[...acts].join()}`);
      assert.equal(s.events('hurt').length, hurtBefore, 'no fall damage from a tree top');
      assert.equal(s.p.health, T.MAX_HEALTH);
      assert.notEqual(s.p.action, 'hard_fall');
      // Clear of the trunk even with the stick let go (the air coasts the little speed away),
      // in the direction he jumped.
      const dist = Math.hypot(s.p.pos.x, s.p.pos.z);
      assert.ok(dist > 200, `landed ${dist} from the trunk`);
      assert.ok(Math.abs(angleDiff(Math.atan2(s.p.pos.x, s.p.pos.z), want)) < 0.3, 'landed the way he jumped');
    }
  });

  test('stick down climbs back down onto the trunk; up again returns to the handstand', () => {
    const { s } = climbToTop();
    s.run(2, {});
    s.run(1, { stickY: -1 });
    assert.equal(s.p.action, 'pole_top', 'not while still swinging up');
    s.run(T.POLE_TOP_SETTLE_TICKS, {});
    s.run(1, { stickY: -1 });
    assert.equal(s.p.action, 'pole');
    assert.ok(Math.hypot(s.p.pos.x, s.p.pos.z) > 60, 'back beside the trunk');
    const from = s.p.getRenderState(0).pos;
    assert.ok(Math.hypot(from.x, from.z) > 60 && from.y === TIP - T.HANG_DEPTH, 'no smear from the tip: from the top of the climb');
    const y = s.p.pos.y;
    s.run(10, { stickY: -1 });
    assert.ok(s.p.pos.y < y - 100, 'goes back down the trunk');
    s.until(60, { stickY: 1 }, (p) => p.action === 'pole_top');
    assert.equal(s.p.action, 'pole_top', 'climbs up into the handstand again');
    s.until(200, { stickY: -1 }, (p) => p.grounded);
    assert.equal(s.p.action, 'idle', 'all the way down to the ground');
  });

  test('Z lets go: drops beside the trunk without re-grabbing it or getting hurt', () => {
    const { s } = climbToTop();
    s.run(4, {});
    s.run(1, { Z: true });
    const acts = [s.p.action];
    s.until(90, {}, (p) => (acts.at(-1) !== p.action && acts.push(p.action), p.grounded));
    assert.ok(acts.includes('freefall') && !acts.includes('ground_pound'), acts.join('>'));
    assert.ok(acts.lastIndexOf('pole') < acts.indexOf('freefall'), acts.join('>'));
    assert.ok(s.p.grounded && s.p.pos.y === 0);
    assert.equal(s.p.health, T.MAX_HEALTH, 'the drop from a tree top counts from its foot');
  });

  test('a trunk grabbed at the very top shows the hold a moment before the handstand', () => {
    const s = sim(tree, { x: 100, y: TIP - 150, z: 0, yaw: -Math.PI / 2 });
    s.p.setAction('freefall');
    s.until(10, {}, (p) => p.action === 'pole');
    s.run(1, { stickY: 1 });
    assert.equal(s.p.action, 'pole');
    s.run(1, { stickY: 1 });
    assert.equal(s.p.action, 'pole_top');
  });

  test('a star or a hit in the handstand drops him clear of the trunk, never inside it', () => {
    for (const hit of ['star', 'hurt', 'fire']) {
      const { s } = climbToTop();
      s.run(10, {});
      if (hit === 'star') s.p.collectStar();
      else s.p.takeDamage(1, { x: 0, y: TIP, z: 0 }, { fire: hit === 'fire' });
      s.until(150, {}, (p) => p.grounded);
      assert.ok(s.p.grounded && s.p.pos.y === 0, `${hit}: landed`);
      const flatFace = 45 * Math.cos(Math.PI / 8); // the prism's faces, 50 the body radius
      assert.ok(Math.hypot(s.p.pos.x, s.p.pos.z) >= flatFace + 50 - 1, `${hit}: landed ${Math.hypot(s.p.pos.x, s.p.pos.z)} from the axis`);
      const knee = s.p.collision.findWalls(s.p.pos.x, 0, s.p.pos.z, 30, 24);
      assert.ok(Math.hypot(knee.x - s.p.pos.x, knee.z - s.p.pos.z) < 1, `${hit}: standing inside the trunk collider`);
      assert.ok(s.p.health >= T.MAX_HEALTH - 1, `${hit}: no fall damage on top`);
    }
  });

  test('falls from a tree count from its foot; other falls still hurt', () => {
    // Kicking off high up a 1300 tree (a ~1600 fall) and dropping off a 1600 wall.
    const kick = climbToTop().s;
    kick.run(1, { stickY: -1 });
    kick.run(T.POLE_TOP_SETTLE_TICKS, {});
    kick.run(1, { stickY: -1 });
    assert.equal(kick.p.action, 'pole');
    kick.run(2, {});
    kick.run(1, { A: true });
    assert.equal(kick.p.action, 'pole_jump');
    kick.until(120, {}, (p) => p.grounded);
    assert.equal(kick.p.health, T.MAX_HEALTH);
    const wall = sim((b) => {
      flat(b);
      b.box(-500, 0, -500, 500, 1600, 0, { noBottom: true });
    }, { x: 0, y: 1600, z: -100, yaw: 0 });
    wall.run(20, { stickY: 1 });
    wall.until(90, {}, (p) => p.grounded);
    assert.equal(wall.p.action, 'hard_fall');
  });
});

describe('handstand on the real trees', () => {
  test('every tree in the level: climb to the crown, handstand on the tip, flip off it unhurt', () => {
    const level = buildLevel(new THREE.Scene());
    const col = level.collision;
    const events = new Events();
    let hurts = 0;
    events.on('hurt', () => hurts++);
    const p = new Player({ collision: col, events, spawn: level.spawn, signs: [] });
    const ctl = new ScriptedController();
    const bad = [];
    for (const pole of col.poles) {
      for (const k of [0, 3, 5]) {
        const yaw = (k / 8) * 2 * Math.PI;
        p.teleport(pole.x - Math.sin(yaw) * 90, pole.y0 + 250, pole.z - Math.cos(yaw) * 90, yaw);
        p.health = T.MAX_HEALTH;
        p.invincibleUntil = 0;
        p.setAction('pole', pole);
        for (let t = 0; t < 300 && p.action !== 'pole_top'; t++) p.update(ctl.next({ stickY: t < 3 ? 0 : 1 }), 0);
        const at = `(${pole.x}, ${pole.z}) dir ${k}`;
        if (p.action !== 'pole_top' || p.pos.y !== pole.y1 || p.pos.x !== pole.x || p.pos.z !== pole.z) {
          bad.push(`${at}: ${p.action} at y ${p.pos.y.toFixed(0)} (tip ${pole.y1})`);
          continue;
        }
        for (let t = 0; t < 10; t++) p.update(ctl.next({}), 0);
        p.update(ctl.next({ A: true }), 0);
        hurts = 0;
        let peak = p.pos.y;
        const acts = [p.action];
        for (let t = 0; t < 200 && !(p.grounded || p.inWater); t++) {
          p.update(ctl.next({}), 0);
          peak = Math.max(peak, p.pos.y);
          if (acts.at(-1) !== p.action) acts.push(p.action);
        }
        if (acts[0] !== 'pole_top_jump' || peak < pole.y1 + 450 || !(p.grounded || p.inWater) || hurts || acts.includes('hard_fall')) {
          bad.push(`${at}: ${acts.join('>')} peak +${(peak - pole.y1).toFixed(0)}, hurt ${hurts}`);
        }
      }
    }
    assert.ok(col.poles.length >= 5, 'the level has trees');
    assert.deepEqual(bad, []);
  });
});

// The real keyboard: W held, then Shift (Z) and Space (A) pressed `offset` polls apart
// (negative: Shift first; 0: together).
function keyboardRun(offset, runTicks = 30, { build = flat, extraKeys = [] } = {}) {
  const b = new CourseBuilder();
  build(b);
  const p = new Player({ collision: b.build(), events: new Events(), spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs: [] });
  const target = new EventTarget();
  const input = new Input(target);
  input.getGamepads = () => [];
  const key = (type, code) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  for (const k of ['KeyW', ...extraKeys]) key('keydown', k);
  if (!runTicks) key('keyup', 'KeyW');
  for (let i = 0; i < Math.max(runTicks, 3); i++) p.update(input.poll(), 0);
  const fv = p.forwardVel;
  const z0 = p.pos.z;
  const first = offset <= 0 ? 'ShiftLeft' : 'Space';
  const second = offset <= 0 ? 'Space' : 'ShiftLeft';
  const acts = [];
  for (let t = 0; t <= Math.abs(offset); t++) {
    if (t === 0) key('keydown', first);
    if (t === Math.abs(offset)) key('keydown', second);
    p.update(input.poll(), 0);
    if (acts.at(-1) !== p.action) acts.push(p.action);
  }
  key('keyup', 'ShiftLeft');
  key('keyup', 'Space');
  let peak = 0;
  for (let t = 0; t < 150 && !p.grounded; t++) {
    p.update(input.poll(), 0);
    peak = Math.max(peak, p.pos.y);
    if (acts.at(-1) !== p.action) acts.push(p.action);
  }
  return { p, fv, acts, dist: p.pos.z - z0, peak };
}

describe('long jump from the keyboard', () => {
  test('running ~1 s, Shift and Space pressed together long-jump', () => {
    const r = keyboardRun(0);
    assert.ok(r.fv >= 25, `running at ${r.fv}`);
    assert.equal(r.acts[0], 'long_jump', r.acts.join('>'));
    assert.ok(!r.acts.includes('ground_pound'), r.acts.join('>'));
    assert.ok(r.dist > 1300 && r.peak < 300, `distance ${r.dist}, peak ${r.peak}`);
    assert.ok(r.p.grounded);
  });

  test('either order within 4 ticks long-jumps too, rising no higher than a long jump', () => {
    for (let offset = -4; offset <= 4; offset++) {
      const r = keyboardRun(offset);
      assert.ok(r.acts.includes('long_jump') && !r.acts.includes('ground_pound'), `offset ${offset}: ${r.acts.join('>')}`);
      assert.ok(r.dist > 1150, `offset ${offset}: distance ${r.dist}`);
      assert.ok(r.peak <= 245, `offset ${offset}: peak ${r.peak}`);
    }
  });

  test('a late conversion carries on from the jump without a snap', () => {
    const b = new CourseBuilder();
    flat(b);
    const s = sim(flat);
    s.run(30, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.run(2, { stickY: 1, A: true });
    const before = { ...s.p.pos };
    s.run(1, { stickY: 1, A: true, Z: true });
    assert.equal(s.p.action, 'long_jump');
    const moved = Math.hypot(s.p.pos.x - before.x, s.p.pos.y - before.y, s.p.pos.z - before.z);
    assert.ok(moved < 50, `moved ${moved} in the converting tick`);
    assert.ok(s.p.vel.y > 0, 'still rising');
  });

  test('Z later than 4 ticks after the take-off is the usual ground pound', () => {
    const r = keyboardRun(6);
    assert.deepEqual(r.acts.slice(0, 2), ['jump', 'ground_pound'], r.acts.join('>'));
  });

  test('walking slowly, Shift and Space together just jump (never a ground pound on take-off)', () => {
    const r = keyboardRun(0, 5);
    assert.ok(r.fv < T.LONG_JUMP_COMBO_SPEED, `walking at ${r.fv}`);
    assert.deepEqual(r.acts, ['jump', 'land'], r.acts.join('>'));
  });

  test('standing still, Shift and Space together backflip; crouch then A still backflips', () => {
    const r = keyboardRun(0, 0);
    assert.equal(r.acts[0], 'backflip', r.acts.join('>'));
    const late = keyboardRun(-3, 0);
    assert.deepEqual(late.acts.slice(0, 2), ['crouch', 'backflip'], late.acts.join('>'));
  });

  test('crouch slide, standing hop + ground pound and the jump chain are unchanged', () => {
    const slide = sim(flat);
    slide.run(30, { stickY: 1 });
    slide.run(1, { stickY: 1, Z: true });
    assert.equal(slide.p.action, 'crouch_slide');
    slide.run(10, { Z: true });
    assert.equal(slide.p.action, 'crouch_slide', 'no jump without A');
    slide.run(1, { Z: true, A: true });
    assert.equal(slide.p.action, 'long_jump', 'A 11 ticks into the slide still long-jumps');
    const hop = sim(flat);
    hop.run(1, { A: true });
    hop.run(6, { A: true });
    hop.run(1, { Z: true });
    assert.equal(hop.p.action, 'ground_pound');
    const chain = sim(flat);
    chain.run(40, { stickY: 1 });
    const kinds = [];
    for (let i = 0; i < 3; i++) {
      chain.run(1, { stickY: 1 });
      chain.run(1, { stickY: 1, A: true });
      kinds.push(chain.p.action);
      chain.until(80, { stickY: 1, A: true }, (p) => p.grounded);
    }
    assert.deepEqual(kinds, ['jump', 'double_jump', 'triple_jump']);
  });

  test('Z with A in the landing window of a running jump long-jumps instead of the double jump', () => {
    const s = sim(flat);
    s.run(40, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(80, { stickY: 1, A: true }, (p) => p.grounded);
    s.run(1, { stickY: 1 });
    s.run(1, { stickY: 1, A: true, Z: true });
    assert.equal(s.p.action, 'long_jump');
  });
});

describe('fire damage', () => {
  test('burnt: a hot-foot hop straight up, running away from the fire, then an ordinary landing', () => {
    const s = sim(flat);
    s.run(20, { stickY: 1 });
    const fire = { x: 0, y: 0, z: s.p.pos.z + 60 }; // just ahead of him
    assert.ok(s.p.takeDamage(1, fire, { fire: true }));
    assert.equal(s.p.action, 'burn');
    assert.equal(s.p.anim, 'burn');
    assert.equal(s.p.health, T.MAX_HEALTH - 1);
    assert.ok(s.sfx().includes('burn'));
    assert.ok(s.events('hurt').length === 1);
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI)) < 1e-9, 'turns away from the fire');
    assert.ok(s.p.getRenderState(1).invincible);
    assert.ok(!s.p.takeDamage(1, fire, { fire: true }), 'invincible frames');
    const z0 = s.p.pos.z;
    let peak = 0;
    let rising = 0;
    const acts = new Set();
    s.until(60, {}, (p) => {
      peak = Math.max(peak, p.pos.y);
      if (p.vel.y > 0) rising++;
      acts.add(p.anim);
      return p.grounded;
    });
    assert.ok(peak > 250 && peak < 400, `hop peak ${peak}`);
    assert.ok(z0 - s.p.pos.z > 150, `ran ${z0 - s.p.pos.z} away from the fire in the air`);
    assert.deepEqual([...acts], ['burn', 'land'], 'burning in the air, then a normal landing');
    s.run(10, {});
    assert.equal(s.p.action, 'idle');
  });

  test('the burn hop turns toward the stick a little', () => {
    const s = sim(flat);
    s.p.takeDamage(1, { x: 0, y: 0, z: 100 }, { fire: true });
    const yaw0 = s.p.faceYaw;
    const right = stickToWorldYaw(1, 0, 0); // 90 deg off his facing
    s.run(5, { stickX: 1 });
    const turned = Math.abs(angleDiff(s.p.faceYaw, yaw0));
    assert.ok(turned > 0.2 && turned <= 5 * T.BURN_TURN_RATE + 1e-9, `turned ${turned}`);
    s.until(60, { stickX: 1 }, (p) => p.grounded);
    const along = s.p.pos.x * Math.sin(right) + s.p.pos.z * Math.cos(right);
    assert.ok(along > 100, `steered ${along} toward the stick`);
  });

  test('fire right under him keeps his facing; without the option damage is the usual knockback', () => {
    const s = sim(flat, { x: 0, y: 0, z: 0, yaw: 1 });
    s.p.takeDamage(1, { x: 0, y: 0, z: 0 }, { fire: true });
    assert.equal(s.p.action, 'burn');
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, 1)) < 1e-9);
    const h = sim(flat);
    h.p.takeDamage(1, { x: 0, y: 0, z: 100 });
    assert.equal(h.p.action, 'hurt');
    assert.ok(!h.sfx().includes('burn'));
    const w = sim(flat);
    w.p.takeDamage(1, { x: 0, y: 0, z: 100 }, {});
    assert.equal(w.p.action, 'hurt');
  });
});

describe('footsteps', () => {
  test('each footstep carries the speed at that tick, tiptoe steps included', () => {
    for (const stick of [0.35, 1]) {
      const s = sim(flat);
      const speeds = [];
      s.run(60, { stickY: stick }, (p) => {
        const step = s.log.at(-1);
        if (step?.event === 'footstep' && step.tick === p.tick - 1) {
          assert.equal(step.speed, Math.abs(p.forwardVel));
          speeds.push({ speed: step.speed, gait: p.anim });
        }
      });
      assert.ok(speeds.length >= 6, `stick ${stick}: ${speeds.length} steps`);
      if (stick < 0.5) {
        assert.ok(speeds.every((st) => st.gait === 'tiptoe' && st.speed < T.TIPTOE_SPEED), JSON.stringify(speeds));
      } else {
        assert.ok(speeds[0].speed < 10 && speeds.at(-1).speed === 32, 'steps get louder as he speeds up');
      }
    }
  });
});

describe('running jumps into trunk colliders', () => {
  test('a fast running jump at a prism-wrapped pole grabs it from every direction, never bonks', () => {
    const tree = (b) => {
      flat(b);
      prism(b, 0, 0, -100, 500, 45);
      b.pole(0, 0, 0, 1000, 40);
    };
    for (const runUp of [420, 700, 1400]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI + 0.1;
        const yaw = a + Math.PI;
        const s = sim(tree, { x: Math.sin(a) * runUp, y: 0, z: Math.cos(a) * runUp, yaw });
        const acts = new Set();
        let jumped = false;
        s.until(120, toward(yaw), (p) => {
          const d = Math.hypot(p.pos.x, p.pos.z);
          if (!jumped && d < 230) {
            jumped = true;
            s.run(1, toward(yaw, { A: true }));
          }
          acts.add(p.action);
          return p.action === 'pole';
        });
        assert.equal(s.p.action, 'pole', `run-up ${runUp} dir ${k}: ${[...acts].join()}`);
        assert.ok(!acts.has('air_hit_wall') && !acts.has('soft_bonk'), `run-up ${runUp} dir ${k}: ${[...acts].join()}`);
      }
    }
  });
});
