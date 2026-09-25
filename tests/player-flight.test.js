// Round 5: the winged hat and its flight (action 'flying'), the attack spheres for enemies
// (player.getAttack), stomp bounces (player.bounce) and endReading as a no-op.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { ScriptedController, createSim as sim } from '../src/player/physics/testCourse.js';
import { Events } from '../src/core/events.js';
import { angleDiff } from '../src/core/math.js';
import * as T from '../src/player/physics/tuning.js';
import { buildLevel } from '../src/world/level.js';
import { PlayerModel } from '../src/player/PlayerModel.js';

const flat = (b) => b.ground(90000);

// Runs up and chains single, double and triple jump presses (stick up = +Z).
function tripleJump(s) {
  s.run(60, { stickY: 1 });
  for (let k = 0; k < 3; k++) {
    s.run(1, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    if (k < 2) s.until(100, { stickY: 1, A: true }, (p) => p.grounded);
  }
  return s.p.action;
}

// Puts Pip in flight at (x, y, z) heading `yaw`, already cruising (take-off done) at `speed`.
function cruising(build, { x = 0, y = 2000, z = 0, yaw = 0, speed = 40, pitch = T.FLY_GLIDE_PITCH, hat = 40 } = {}) {
  const s = sim(build, { x, y, z, yaw });
  s.p.giveWingHat(hat);
  s.p.setAction('flying');
  s.p.actionTimer = T.FLY_LAUNCH_TICKS;
  s.p.flySpeed = speed;
  s.p.flyPitch = pitch;
  return s;
}

const flaps = (s) => s.sfx().filter((n) => n === 'wing_flap').length;
const hatEvents = (s) => s.events('wingHat').map((e) => e.on);

describe('winged hat: take-off', () => {
  test('a triple jump flies only with the hat on', () => {
    const plain = sim(flat);
    assert.equal(tripleJump(plain), 'triple_jump');
    assert.equal(plain.p.getRenderState(1).wingHat, false);

    const s = sim(flat);
    s.p.giveWingHat();
    assert.deepEqual(hatEvents(s), [true]);
    assert.ok(s.sfx().includes('powerup'));
    assert.equal(s.p.wingHat, T.WING_HAT_SECONDS * 30);
    // The flip goes up first and takes off into flight at its peak.
    assert.equal(tripleJump(s), 'triple_jump');
    const flipY = s.p.pos.y;
    const n = s.until(40, {}, (p) => p.action !== 'triple_jump');
    assert.equal(s.p.action, 'flying', `took off after ${n} ticks`);
    assert.ok(s.p.pos.y > flipY + 400, `at the flip's peak (${s.p.pos.y.toFixed(0)})`);
    const rs = s.p.getRenderState(1);
    assert.equal(rs.anim, 'fly');
    assert.equal(rs.wingHat, true);
    assert.equal(rs.wingHatEnding, false);
    assert.ok(Math.abs(s.p.flySpeed - 40) < 2, `launch speed ${s.p.flySpeed}`);
    assert.ok(s.p.vel.y > 20, 'climbs away');
    assert.ok(s.p.flyPitch < -0.8, `nose up at take-off (pitch ${s.p.flyPitch})`);
    assert.ok(rs.pitch < 0 && rs.pitch >= -0.2 - 1e-9, `the body tilts up smoothly (${rs.pitch})`);
    assert.ok(flaps(s) >= 1, 'the wings flap on take-off');
    s.run(4, {});
    assert.equal(s.p.getRenderState(1).pitch, s.p.flyPitch, 'then shows the flight pitch');
    // The take-off climbs well above a triple jump before levelling into a glide.
    let top = 0;
    s.run(60, {}, (p) => ((top = Math.max(top, p.pos.y)), p.action === 'flying'));
    assert.ok(top > 1000, `take-off peak ${top}`);
    assert.equal(s.p.action, 'flying');
  });

  test("the run-up's stick still held forward doesn't dive the take-off into the ground; once let go, up dives", () => {
    const s = sim(flat);
    s.p.giveWingHat();
    tripleJump(s);
    s.until(40, { stickY: 1 }, (p) => p.action !== 'triple_jump');
    assert.equal(s.p.action, 'flying');
    assert.equal(s.p.flyStickLatch, true);
    let top = 0;
    s.run(90, { stickY: 1 }, (p) => ((top = Math.max(top, p.pos.y)), p.action === 'flying'));
    assert.equal(s.p.action, 'flying', 'still flying 3 s later with the stick held');
    assert.ok(top > 1000, `climbed away (peak ${top.toFixed(0)})`);
    assert.ok(s.p.flyPitch < 0.2, `a glide, not a dive (pitch ${s.p.flyPitch.toFixed(2)})`);
    // Let go, then push up again: now it dives.
    s.run(2, {});
    assert.equal(s.p.flyStickLatch, false);
    s.run(20, { stickY: 1 });
    assert.ok(s.p.flyPitch > 0.8, `diving (pitch ${s.p.flyPitch.toFixed(2)})`);
  });

  test('a stick pulled back or left alone at the take-off is not latched', () => {
    for (const stickY of [0, -1]) {
      const s = sim(flat);
      s.p.giveWingHat();
      tripleJump(s);
      s.until(40, { stickY }, (p) => p.action !== 'triple_jump');
      assert.equal(s.p.action, 'flying');
      assert.equal(s.p.flyStickLatch, false);
    }
  });

  test('with the hat on, a triple jump cut short before its peak (a ground pound) never flies', () => {
    const s = sim(flat);
    s.p.giveWingHat();
    tripleJump(s);
    s.run(3, { stickY: 1 });
    s.run(1, { Z: true });
    assert.equal(s.p.action, 'ground_pound');
    s.until(100, {}, (p) => p.grounded);
    assert.notEqual(s.p.action, 'flying');
  });

  test('the tree-top flip jump flies off with the hat on', () => {
    const tree = (b) => {
      flat(b);
      b.pole(0, 0, 0, 1300, 40);
    };
    for (const hat of [false, true]) {
      const s = sim(tree, { x: 0, y: 900, z: -100, yaw: 0 });
      if (hat) s.p.giveWingHat();
      s.p.setAction('pole', s.world.poles[0]);
      s.until(200, { stickY: 1 }, (p) => p.action === 'pole_top');
      assert.equal(s.p.action, 'pole_top');
      s.run(10, {});
      s.run(1, { A: true });
      assert.equal(s.p.action, hat ? 'flying' : 'pole_top_jump');
      if (hat) {
        s.run(40, {});
        assert.equal(s.p.action, 'flying', 'still flying, the trunk is not grabbed');
        assert.ok(s.p.pos.y > 1300, `flew up from the tip (y ${s.p.pos.y})`);
      }
    }
  });
});

describe('winged hat: flight controls', () => {
  test('stick up dives: nose down, the speed grows up to the cap', () => {
    const s = cruising(flat, { y: 6000 });
    let prev = s.p.flySpeed;
    s.run(40, { stickY: 1 }, (p) => {
      assert.ok(p.flySpeed >= prev, `slowed from ${prev} to ${p.flySpeed}`);
      prev = p.flySpeed;
    });
    assert.equal(s.p.action, 'flying');
    assert.ok(s.p.flyPitch > 0.8, `pitch ${s.p.flyPitch}`);
    assert.ok(s.p.getRenderState(1).pitch > 0.8, 'RenderState.pitch shows the dive');
    assert.equal(s.p.flySpeed, T.FLY_MAX_SPEED, 'up to the top speed');
    assert.ok(s.p.vel.y < -40, 'heading down');
    assert.equal(flaps(s), 0, 'no flapping in a dive');
  });

  test('stick down climbs: the speed drains, the wings flap, then it stalls into a fall', () => {
    const s = cruising(flat, { y: 1000 });
    const y0 = s.p.pos.y;
    const ticks = s.until(200, { stickY: -1 }, (p) => p.action !== 'flying');
    assert.equal(s.p.action, 'freefall', 'stalled');
    assert.ok(ticks > 15 && ticks < 60, `stalled after ${ticks} ticks`);
    assert.ok(s.p.pos.y > y0 + 300, `climbed ${s.p.pos.y - y0}`);
    assert.ok(Math.hypot(s.p.vel.x, s.p.vel.z) < T.FLY_STALL_SPEED, 'slow when stalling');
    const n = flaps(s);
    assert.ok(n >= Math.floor(ticks / T.FLY_FLAP_TICKS) && n <= Math.ceil(ticks / T.FLY_FLAP_TICKS) + 1, `${n} flaps in ${ticks} ticks`);
    // A fall that starts in a flight never hurts, even from high up.
    s.until(400, {}, (p) => p.grounded);
    assert.ok(s.p.grounded);
    assert.equal(s.events('hurt').length, 0);
    assert.notEqual(s.p.action, 'hard_fall');
  });

  test('a neutral stick glides: nose slightly down at a steady ~40', () => {
    const s = cruising(flat, { y: 3000, speed: 30 });
    s.run(150, {});
    assert.equal(s.p.action, 'flying');
    assert.ok(Math.abs(s.p.flyPitch - T.FLY_GLIDE_PITCH) < 1e-6);
    assert.ok(s.p.flySpeed > 33 && s.p.flySpeed < 42, `glide speed ${s.p.flySpeed}`);
    assert.ok(s.p.vel.y < 0 && s.p.vel.y > -6, `sink ${s.p.vel.y}`);
    assert.equal(flaps(s), 0);
  });

  test('stick left / right banks and turns the heading with the bank', () => {
    for (const side of [1, -1]) {
      const s = cruising(flat, { y: 4000 });
      let prevYaw = s.p.faceYaw;
      let turned = 0;
      s.run(40, { stickX: side }, (p) => {
        turned += angleDiff(prevYaw, p.faceYaw);
        prevYaw = p.faceYaw;
      });
      const rs = s.p.getRenderState(1);
      assert.ok(Math.abs(rs.roll - side * T.FLY_MAX_BANK) < 1e-6, `bank ${rs.roll}`);
      // stick right: right side down (roll > 0) and a right turn (yaw decreasing).
      assert.ok(Math.sign(turned) === -side && Math.abs(turned) > 1.5, `turned ${turned}`);
      // The turn rate follows the bank.
      const rate = Math.abs(angleDiff(s.p.prevFaceYaw, s.p.faceYaw));
      assert.ok(Math.abs(rate - T.FLY_MAX_BANK * T.FLY_TURN_PER_BANK) < 1e-6, `rate ${rate}`);
      s.run(20, {});
      assert.ok(Math.abs(s.p.flyBank) < 1e-6, 'levels out when released');
    }
  });

  test('Z ends the flight in a fall (no ground pound)', () => {
    const s = cruising(flat, { y: 1500 });
    s.run(5, {});
    const h = Math.hypot(s.p.vel.x, s.p.vel.z);
    s.run(1, { Z: true });
    assert.equal(s.p.action, 'freefall');
    assert.ok(Math.hypot(s.p.vel.x, s.p.vel.z) > h - 3, 'keeps its momentum');
    assert.equal(s.p.getRenderState(1).anim, 'fall');
    s.until(300, {}, (p) => p.grounded);
    assert.equal(s.events('hurt').length, 0, 'no fall damage after a flight');
    assert.ok(!s.sfx().includes('ground_pound'));
  });
});

describe('winged hat: flight endings', () => {
  test('a shallow touchdown belly-slides to a stop; a steep one lands on the feet', () => {
    const shallow = cruising(flat, { y: 60, speed: 40 });
    shallow.until(60, {}, (p) => p.grounded);
    assert.equal(shallow.p.action, 'belly_slide');
    assert.ok(shallow.p.forwardVel > 30, `slides on at ${shallow.p.forwardVel}`);
    shallow.until(120, {}, (p) => p.action === 'idle');
    assert.equal(shallow.p.action, 'idle', 'skidded to a stop');

    const steep = cruising(flat, { y: 3000, speed: 60, pitch: T.FLY_MAX_DIVE });
    steep.until(200, { stickY: 1 }, (p) => p.grounded);
    assert.equal(steep.p.action, 'land');
    assert.ok(steep.p.forwardVel <= T.FLY_LAND_MAX_SPEED);
    assert.equal(steep.events('hurt').length, 0, 'no fall damage from a flight');
    const land = steep.events('land').at(-1);
    assert.equal(land.hard, false);
  });

  test('flying into a wall bonks; grazing one slides along it', () => {
    const wall = (b) => {
      flat(b);
      b.box(-3000, 0, 1500, 3000, 3000, 1600);
    };
    const s = cruising(wall, { y: 500, speed: 60, pitch: 0 });
    s.until(60, {}, (p) => p.action !== 'flying');
    assert.equal(s.p.action, 'bonk');
    assert.ok(s.p.pos.z <= 1500 - 49, `stopped in front of the wall (z ${s.p.pos.z})`);
    assert.ok(s.sfx().includes('bonk'));
    s.until(200, {}, (p) => p.grounded);
    assert.equal(s.events('hurt').length, 0);

    const g = cruising(wall, { x: 0, y: 500, z: 1300, yaw: Math.PI / 2 + 0.2, speed: 50, pitch: 0 });
    g.run(20, {});
    assert.equal(g.p.action, 'flying', 'grazing the wall keeps flying');
    assert.ok(g.p.pos.z <= 1500 - 49);
  });

  test('never tunnels through a thin panel or a steep slope at full speed', () => {
    const course = (b) => {
      flat(b);
      for (const facing of [[0, 0, 1], [0, 0, -1]]) b.quad([-3000, 0, 2000], [3000, 0, 2000], [3000, 4000, 2000], [-3000, 4000, 2000], facing);
      // A very steep (~81 deg, still a floor) slope rising toward -Z, 700 high: at top speed
      // the classic quarter steps would pass its surface by more than the floor tolerance.
      b.slope(-3000, 3000, -1000, -1110, 0, 700);
    };
    for (const yaw of [0, 0.4, -0.5]) {
      const s = cruising(course, { y: 800, z: 0, yaw, speed: 70, pitch: 0.2 });
      s.run(60, { stickY: 1 }, (p) => assert.ok(p.pos.z < 2000, `through the panel at z ${p.pos.z}`));
    }
    for (let y = 200; y < 320; y += 7) {
      const s = cruising(course, { y, z: 0, yaw: Math.PI, speed: 70, pitch: 0 });
      s.run(40, {}, (p) => {
        const top = s.world.findFloor(p.pos.x, 1000, p.pos.z, 0);
        assert.ok(!top.surface || p.pos.y >= top.y - 1, `inside the slope at z ${p.pos.z}, y ${p.pos.y} < ${top.y}`);
      });
      assert.notEqual(s.p.action, 'flying');
    }
  });

  test('a ceiling levels the climb off', () => {
    const roofed = (b) => {
      flat(b);
      b.box(-3000, 1200, -3000, 3000, 1300, 6000);
    };
    const s = cruising(roofed, { y: 700, speed: 60, pitch: -0.6 });
    s.run(30, { stickY: -1 }, (p) => assert.ok(p.pos.y + 160 <= 1200 + 1e-6, `head in the ceiling at ${p.pos.y}`));
  });

  test('a shallow glide into the water dives in as soon as the feet dip under', () => {
    const pool = (b) => {
      b.ground(30000, 0, { x0: -2000, z0: 1000, x1: 2000, z1: 6000 });
      b.pool({ x0: -2000, z0: 1000, x1: 2000, z1: 6000, y0: -2000, level: -60, bank: 1000 });
    };
    const s = cruising(pool, { y: 0, z: 1200, speed: 40 });
    let prevY = s.p.pos.y;
    s.until(80, {}, (p) => {
      if (p.action === 'flying') {
        assert.ok(p.pos.y >= -60, `flying on with the feet ${-60 - p.pos.y} under`);
        prevY = p.pos.y;
      }
      return p.action !== 'flying';
    });
    assert.equal(s.p.action, 'swim_idle');
    assert.ok(prevY - s.p.pos.y < 15 && s.p.pos.y < -60, `in at the surface (${s.p.pos.y})`);
    const splash = s.events('splash');
    assert.equal(splash.length, 1);
    assert.ok(Math.abs(splash[0].pos.z - s.p.pos.z) < 1, 'the splash is where he went in');
    s.run(30, {});
    assert.ok(s.p.inWater, 'swims on');

    // Water too shallow to swim in: the flight touches down on its bed instead.
    const shallow = (b) => {
      b.ground(30000, -50, { x0: -2000, z0: 1000, x1: 2000, z1: 6000 });
      b.pool({ x0: -2000, z0: 1000, x1: 2000, z1: 6000, y0: -100, groundY: -50, bank: 10, level: -30 });
    };
    const w = cruising(shallow, { y: 0, z: 1200, speed: 40 });
    w.until(80, {}, (p) => p.action !== 'flying');
    assert.equal(w.p.action, 'belly_slide');
    assert.equal(w.events('splash').length, 0);
  });

  test('diving into water carries on as a swim dive', () => {
    const pool = (b) => {
      b.ground(30000, 0, { x0: -2000, z0: 1000, x1: 2000, z1: 6000 });
      b.pool({ x0: -2000, z0: 1000, x1: 2000, z1: 6000, y0: -2000, level: -60, bank: 1000 });
    };
    const s = cruising(pool, { y: 900, z: 1500, speed: 50 });
    s.until(120, { stickY: 1 }, (p) => p.inWater || p.action !== 'flying');
    assert.ok(s.p.inWater, `dove into the water (${s.p.action})`);
    assert.equal(s.p.action, 'swim_idle');
    assert.ok(s.p.swimPitch > 0.3, `dives in nose down (${s.p.swimPitch})`);
    assert.ok(s.p.forwardVel > 15, 'keeps some speed');
    assert.equal(s.events('splash').at(-1).big, true);
    assert.equal(s.p.wingHat > 0, true, 'the hat stays on in the water');
  });
});

describe('winged hat: the edge of the world', () => {
  test('a flight never leaves the ground behind: it turns for home at the edge', () => {
    const island = (b) => b.ground(3000);
    for (const [yaw, stick] of [[0, {}], [0.7, { stickY: 1 }], [Math.PI / 2, { stickX: -0.3 }], [-2.5, { stickY: -0.3 }]]) {
      const s = cruising(island, { y: 2500, z: 0, yaw, speed: 60 });
      let turned = false;
      s.run(300, stick, (p) => {
        assert.ok(Math.abs(p.pos.x) <= 3000 && Math.abs(p.pos.z) <= 3000, `left the ground at ${p.pos.x}, ${p.pos.z}`);
        if (Math.abs(angleDiff(yaw, p.faceYaw)) > 2) turned = true;
        return p.action === 'flying';
      });
      assert.ok(turned || s.p.action !== 'flying', 'turned round');
    }
  });

  test('diving at the rim never sinks below the ground: it touches down on the rim', () => {
    const island = (b) => b.ground(3000);
    for (const [x, z, yaw] of [[2900, 0, Math.PI / 2], [0, -2800, Math.PI], [-2950, 2950, -2.4]]) {
      const s = cruising(island, { x, y: 150, z, yaw, speed: 50, pitch: 0.6 });
      s.until(40, { stickY: 1 }, (p) => {
        assert.ok(Math.abs(p.pos.x) <= 3000 && Math.abs(p.pos.z) <= 3000, `left the ground at ${p.pos.x}, ${p.pos.z}`);
        assert.ok(p.pos.y >= 0, `below the rim (${p.pos.y})`);
        return p.grounded;
      });
      assert.ok(s.p.grounded && s.p.pos.y === 0, `landed on the rim (${s.p.action})`);
    }
  });

  test('a hole in the collision mesh is no invisible wall aloft and no way out of the level', () => {
    // A 100-wide gap with nothing under it and no walls (like a seam between terrain pieces).
    const seam = (b) => b.ground(20000, 0, { x0: 1000, z0: -20000, x1: 1100, z1: 20000 });
    // Gliding over it high up: straight on, no stall of the motion or yank of the heading.
    const g = cruising(seam, { x: 800, y: 2000, z: 0, yaw: Math.PI / 2, speed: 40, pitch: 0 });
    let prevX = g.p.pos.x;
    g.run(12, {}, (p) => {
      assert.ok(p.pos.x - prevX > 30, `held up at x ${p.pos.x}`);
      assert.ok(Math.abs(angleDiff(p.faceYaw, Math.PI / 2)) < 1e-9, 'heading kept');
      prevX = p.pos.x;
    });
    assert.ok(g.p.pos.x > 1200);
    // Diving into it from all sorts of angles and speeds: lands on its rim, never below it.
    for (const [x0, speed, pitch, yaw] of [[900, 20, 0.9, Math.PI / 2], [980, 14, 0.9, Math.PI / 2], [1200, 25, 0.8, -Math.PI / 2], [900, 66, 0.5, 1.8]]) {
      const s = cruising(seam, { x: x0, y: 80, z: 0, yaw, speed, pitch });
      s.until(60, { stickY: 1 }, (p) => {
        const inGap = p.pos.x > 1000 && p.pos.x < 1100;
        assert.ok(p.pos.y >= (inGap ? 0 : -1e-9), `fell into the gap at ${p.pos.x}, ${p.pos.y}`);
        return p.grounded;
      });
      assert.ok(s.p.grounded && s.p.pos.y === 0, `landed (${s.p.action} at ${s.p.pos.x}, ${s.p.pos.y})`);
      assert.equal(s.events('lifeLost').length, 0);
    }
    // A hop into it on foot lands on its rim too.
    for (const ticks of [2, 4, 6]) {
      const h = sim(seam, { x: 990, y: 0, z: 0, yaw: Math.PI / 2 });
      h.run(1, {});
      h.run(1 + ticks, { A: true, stickX: -1 });
      h.until(60, {}, (p) => p.grounded);
      assert.ok(h.p.grounded && h.p.pos.y === 0 && h.events('lifeLost').length === 0, `hop ${ticks}: ${h.p.action} at ${h.p.pos.x}, ${h.p.pos.y}`);
    }
    // A real edge (floor on one side only) is still a way down.
    const edge = sim((b) => b.floor(-500, -500, 500, 500, 0), { x: 0, y: 0, z: 0, yaw: 0 });
    edge.run(30, { stickY: 1 });
    edge.run(40, { stickY: 1, A: true });
    assert.ok(edge.p.pos.z > 500 && edge.p.pos.y < 0 && !edge.p.grounded, 'fell off the edge');
  });

  test('a fall out of a flight eases out of its tilt', () => {
    const s = cruising(flat, { y: 2000, pitch: -0.7 });
    s.run(6, { stickX: 0.6, stickY: -0.8 });
    assert.ok(s.p.pitch < -0.6 && s.p.roll > 0.3, `tilted ${s.p.pitch}, ${s.p.roll}`);
    s.run(1, { Z: true });
    assert.equal(s.p.action, 'freefall');
    assert.ok(Math.abs(s.p.pitch - s.p.prevPitch) <= T.FLY_TILT_EASE + 1e-9, 'no snap upright');
    let prev = s.p.pitch;
    s.run(8, {}, (p) => {
      assert.ok(Math.abs(p.pitch - prev) <= T.FLY_TILT_EASE + 1e-9, 'no snap upright');
      prev = p.pitch;
    });
    assert.equal(s.p.pitch, 0);
    assert.equal(s.p.roll, 0);
  });
});

describe('winged hat: timer and events', () => {
  test('runs out after its time: event, blinking at the end, and a flight turns into a fall', () => {
    const s = cruising(flat, { y: 3000, hat: 2 });
    assert.equal(s.p.wingHat, 60);
    s.run(20, {});
    assert.equal(s.p.getRenderState(1).wingHatEnding, true, 'the last 3 s blink');
    s.run(39, {});
    assert.equal(s.p.action, 'flying');
    assert.deepEqual(hatEvents(s), [true]);
    s.run(1, {});
    assert.equal(s.p.wingHat, 0);
    assert.equal(s.p.action, 'freefall');
    assert.deepEqual(hatEvents(s), [true, false]);
    const rs = s.p.getRenderState(1);
    assert.equal(rs.wingHat, false);
    assert.equal(rs.wingHatEnding, false);
    s.run(10, {});
    assert.deepEqual(hatEvents(s), [true, false], 'one off event');
  });

  test('a new hat restarts the time; the time stands still while reading', () => {
    const s = sim((b) => {
      b.ground(30000);
      return [b.sign(0, 1000, Math.PI, 0, ['Page'])];
    }, { x: 0, y: 0, z: 900, yaw: 0 });
    s.p.giveWingHat(10);
    s.run(100, {});
    assert.equal(s.p.wingHat, 200);
    s.p.giveWingHat(10);
    assert.equal(s.p.wingHat, 300);
    s.run(1, { B: true });
    assert.equal(s.p.action, 'reading');
    const left = s.p.wingHat;
    s.run(60, {});
    assert.equal(s.p.wingHat, left);
    s.p.endReading();
    s.run(5, {});
    assert.equal(s.p.wingHat, left - 5);
  });

  test('dying or respawning takes the hat off', () => {
    const s = sim(flat);
    s.p.giveWingHat();
    s.p.loseHealth(8);
    assert.equal(s.p.action, 'death');
    assert.equal(s.p.wingHat, 0);
    assert.deepEqual(hatEvents(s), [true, false]);

    const r = sim(flat);
    r.p.giveWingHat();
    r.p.respawn();
    assert.equal(r.p.wingHat, 0);
    assert.deepEqual(hatEvents(r), [true, false]);
    r.p.beginIntro(); // a new game after GAME OVER: nothing to take off
    assert.deepEqual(hatEvents(r), [true, false]);

    const f = cruising(flat, { y: 3000 });
    f.p.respawn();
    assert.equal(f.p.action, 'spawn');
    assert.equal(f.p.getRenderState(1).wingHat, false);
  });
});

describe('attacks for enemies (getAttack)', () => {
  test('nothing while idle, walking or jumping', () => {
    const s = sim(flat);
    s.run(2, {});
    assert.equal(s.p.getAttack(), null);
    s.run(20, { stickY: 1 });
    assert.equal(s.p.getAttack(), null);
    s.run(1, { stickY: 1, A: true });
    assert.equal(s.p.getAttack(), null);
  });

  test('punch, punch, kick: a sphere in front on the strike ticks, one reused object', () => {
    const s = sim(flat);
    s.run(2, {});
    const kinds = [];
    let first = null;
    for (let i = 0; i < 24; i++) {
      s.run(1, { B: i % 4 === 0 });
      const a = s.p.getAttack();
      if (!a) continue;
      first ??= a;
      assert.equal(a, first, 'the same object every call');
      if (kinds.at(-1) !== a.kind) kinds.push(a.kind);
      // Facing +Z, his right is -X: the jab (right mitten) and the kick (right boot) sit to
      // the right, the cross (left mitten) to the left.
      const ahead = a.z - s.p.pos.z;
      const right = s.p.pos.x - a.x;
      assert.ok(ahead > 40 && ahead + a.radius <= 105, `in front, not far past the limb (${ahead} + ${a.radius})`);
      assert.ok(a.kind === 'punch2' ? right < -10 : right > 10, `${a.kind} on the striking side (${right})`);
      if (a.kind === 'kick') assert.ok(a.radius === 60 && a.y - s.p.pos.y < 60, 'kick: low, around the boot');
      else assert.ok(a.radius === 55 && Math.abs(a.y - s.p.pos.y - 80) < 1e-6);
    }
    assert.deepEqual(kinds, ['punch1', 'punch2', 'kick']);
    const t = sim(flat);
    t.run(2, {});
    t.run(1, { B: true });
    assert.equal(t.p.getAttack()?.kind, 'punch1', 'the first tick strikes');
    t.run(5, {});
    assert.equal(t.p.getAttack(), null, 'the arm pulls back');
  });

  test('the punch and kick spheres hold the posed mitten / boot and reach little past it', () => {
    const s = sim(flat, { x: 300, y: 0, z: -200, yaw: 2.2 });
    const model = new PlayerModel();
    const limb = new THREE.Vector3();
    const vert = new THREE.Vector3();
    s.run(2, {});
    const seen = new Set();
    for (let i = 0; i < 26; i++) {
      s.run(1, { B: i === 0 || i === 4 || i === 10 });
      const rs = s.p.getRenderState(1);
      for (let k = 0; k < 2; k++) model.update(rs, 1 / 60); // 60 fps frames of this tick
      model.object3D.updateMatrixWorld(true);
      const a = s.p.getAttack();
      if (!a) continue;
      seen.add(a.kind);
      const { rig } = model;
      const [centre, part] = { punch1: [rig.armR.hand, rig.armR.wrist], punch2: [rig.armL.hand, rig.armL.wrist], kick: [rig.legR.boot, rig.legR.boot] }[a.kind];
      centre.getWorldPosition(limb);
      const d = Math.hypot(limb.x - a.x, limb.y - a.y, limb.z - a.z);
      assert.ok(d < a.radius - 10, `${a.kind} tick ${i}: limb ${d.toFixed(0)} from the centre`);
      // How far the sphere reaches ahead of the limb's front (its farthest vertex) along the facing.
      const fx = Math.sin(s.p.faceYaw);
      const fz = Math.cos(s.p.faceYaw);
      let front = -Infinity;
      part.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          vert.fromBufferAttribute(pos, v).applyMatrix4(o.matrixWorld);
          front = Math.max(front, vert.x * fx + vert.z * fz);
        }
      });
      const past = a.x * fx + a.z * fz + a.radius - front;
      assert.ok(past < 60, `${a.kind} tick ${i}: reaches ${past.toFixed(0)} past the limb`);
    }
    assert.deepEqual([...seen], ['punch1', 'punch2', 'kick']);
  });

  test('jump kick, dive, belly slide at speed and the ground-pound landing', () => {
    const j = sim(flat);
    j.run(1, {});
    j.run(1, { A: true });
    j.run(3, { A: true });
    j.run(1, { A: true, B: true });
    assert.equal(j.p.action, 'jump_kick');
    assert.equal(j.p.getAttack()?.kind, 'jump_kick');

    const d = sim(flat);
    d.run(60, { stickY: 1 });
    d.run(1, { stickY: 1, B: true });
    assert.equal(d.p.action, 'dive');
    const a = d.p.getAttack();
    assert.equal(a.kind, 'dive');
    assert.equal(a.radius, 90);
    assert.ok(Math.abs(a.y - d.p.pos.y - 50) < 1e-6);
    d.until(60, {}, (p) => p.action === 'belly_slide');
    assert.equal(d.p.getAttack()?.kind, 'belly_slide');
    d.until(120, {}, (p) => p.action !== 'belly_slide');
    assert.equal(d.p.getAttack(), null, 'a slow slide no longer hits');

    const g = sim(flat);
    g.run(1, {});
    g.run(1, { A: true });
    g.run(8, { A: true });
    g.run(1, { Z: true });
    g.until(80, {}, (p) => p.action === 'ground_pound_land');
    const pound = g.p.getAttack();
    assert.equal(pound.kind, 'ground_pound_land');
    assert.equal(pound.radius, 160);
    assert.ok(Math.hypot(pound.x - g.p.pos.x, pound.z - g.p.pos.z) < 1e-6, 'around the feet');
    g.run(1, {});
    assert.ok(g.p.getAttack());
    g.run(1, {});
    assert.equal(g.p.getAttack(), null, 'only on the landing ticks');
  });

  test('the flying body hits too', () => {
    const s = cruising(flat, { y: 1000 });
    s.run(1, {});
    const a = s.p.getAttack();
    assert.equal(a.kind, 'flying');
    assert.ok(a.y > s.p.pos.y + 50);
  });
});

describe('stomp bounces (bounce)', () => {
  test('bounces up from a fall keeping the forward speed; higher with A held; no jump cut', () => {
    const s = sim(flat, { x: 0, y: 600, z: 0, yaw: 0 });
    s.p.setAction('freefall');
    s.p.forwardVel = 20;
    s.run(8, { stickY: 1 });
    const fv = s.p.forwardVel;
    assert.equal(s.p.bounce(), true);
    assert.equal(s.p.action, 'jump');
    assert.equal(s.p.anim, 'jump');
    assert.equal(s.p.vel.y, T.BOUNCE_VY);
    assert.equal(s.p.forwardVel, fv);
    assert.ok(s.sfx().includes('stomp'));
    assert.ok(!s.sfx().includes('jump'));
    const y0 = s.p.pos.y;
    let top = y0;
    s.run(30, { stickY: 1 }, (p) => ((top = Math.max(top, p.pos.y)), !p.grounded)); // A not held
    assert.ok(top - y0 > 250, `rose ${top - y0}: releasing A does not cut a bounce`);

    const h = sim(flat, { x: 0, y: 600, z: 0, yaw: 0 });
    h.p.setAction('freefall');
    h.run(8, { A: true });
    h.p.bounce();
    assert.equal(h.p.vel.y, T.BOUNCE_HELD_VY);
  });

  test('a stomp ends the fall: landing after the bounce never hurts, however long the drop', () => {
    for (const [h, A] of [[1500, false], [1500, true], [1300, true], [4000, false]]) {
      const s = sim(flat, { x: 0, y: h, z: 0, yaw: 0 });
      s.p.setAction('freefall');
      s.until(200, A ? { A: true } : {}, (p) => p.pos.y <= 70);
      assert.equal(s.p.bounce(), true);
      s.until(120, A ? { A: true } : {}, (p) => p.grounded);
      assert.equal(s.p.action, 'land', `from ${h}: ${s.p.action}`);
      assert.equal(s.p.health, T.MAX_HEALTH);
      assert.equal(s.events('hurt').length, 0);
    }
  });

  test('ignored while swimming, on a tree or reading; keeps a flight flying', () => {
    const w = sim((b) => {
      b.ground(30000, 0, { x0: -1000, z0: -3000, x1: 1000, z1: -500 });
      b.pool({ x0: -1000, z0: -3000, x1: 1000, z1: -500, y0: -800, level: -60, bank: 800 });
    }, { x: 0, y: -500, z: -2000, yaw: 0 });
    w.run(2, {});
    assert.ok(w.p.inWater);
    const swimming = w.p.action;
    assert.equal(w.p.bounce(), false);
    assert.equal(w.p.action, swimming);

    const t = sim((b) => (flat(b), b.pole(0, 0, 0, 1300, 40)), { x: 0, y: 400, z: -100, yaw: 0 });
    t.p.setAction('pole', t.world.poles[0]);
    assert.equal(t.p.bounce(), false);
    assert.equal(t.p.action, 'pole');

    const r = sim((b) => (b.ground(30000), [b.sign(0, 1000, Math.PI, 0, ['Page'])]), { x: 0, y: 0, z: 900, yaw: 0 });
    r.run(1, {});
    r.run(1, { B: true });
    assert.equal(r.p.action, 'reading');
    assert.equal(r.p.bounce(), false);
    assert.equal(r.p.action, 'reading');

    const f = cruising(flat, { y: 1000, pitch: 0.5 });
    assert.equal(f.p.bounce(), true);
    assert.equal(f.p.action, 'flying');
    assert.ok(f.p.flyPitch <= T.BOUNCE_FLY_PITCH);
  });

  test('safe from ground actions and slides too', () => {
    const s = sim(flat);
    s.run(40, { stickY: 1 });
    assert.equal(s.p.bounce(60), true);
    assert.equal(s.p.action, 'jump');
    assert.equal(s.p.grounded, false);
    s.until(80, { stickY: 1 }, (p) => p.grounded);
    assert.ok(s.p.grounded);
  });
});

test('endReading is a no-op when Pip is not reading (the castle door reuses the dialog)', () => {
  const s = sim(flat);
  s.run(20, { stickY: 1 });
  s.p.endReading();
  assert.equal(s.p.action, 'walking');
  s.run(1, { stickY: 1, A: true });
  assert.equal(s.p.action, 'jump', 'the next press is not swallowed');
  s.p.endReading();
  assert.equal(s.p.action, 'jump');
  const f = cruising(flat, { y: 1000 });
  f.p.endReading();
  assert.equal(f.p.action, 'flying');
});

test('free flights over the real grounds never pass through walls, floors or the castle', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  const p = new Player({ collision: col, events: new Events(), spawn: level.spawn });
  const ctl = new ScriptedController();
  const bad = [];
  let crashes = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    p.teleport(Math.sin(a) * 5000, 1200 + (k % 3) * 400, 2500 + Math.cos(a) * 3000, a + Math.PI);
    p.giveWingHat();
    p.setAction('flying');
    for (let i = 0; i < 240 && p.action === 'flying'; i++) {
      const input = { stickX: Math.sin(i / 17 + k), stickY: 0.3 + 0.7 * Math.sin(i / 11 + k * 0.7) };
      const from = { x: p.pos.x, y: p.pos.y + 80, z: p.pos.z };
      p.update(ctl.next(input), 0);
      const dx = p.pos.x - from.x;
      const dy = p.pos.y + 80 - from.y;
      const dz = p.pos.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1) continue;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const hit = col.raycast(from, dir, len);
      if (hit && hit.normal.x * dir.x + hit.normal.y * dir.y + hit.normal.z * dir.z < 0) {
        bad.push(`flight ${k} tick ${i}: crossed a ${hit.surface.kind} at ${hit.point.x.toFixed(0)}, ${hit.point.y.toFixed(0)}, ${hit.point.z.toFixed(0)}`);
      }
    }
    if (p.action !== 'flying') crashes++;
  }
  assert.deepEqual(bad.slice(0, 5), []);
  assert.ok(crashes > 0, 'some flights met the ground, a wall or the water');
});
