import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player/Player.js';
import { ANIM_NAMES, ScriptedController, buildTestCourse, createSim as sim } from '../src/player/physics/testCourse.js';
import { Events } from '../src/core/events.js';
import { angleDiff, makeRng } from '../src/core/math.js';

const DEG = Math.PI / 180;

const flat = (b) => b.ground(30000);

// Runs forward until full speed on flat ground.
function runUp(s, ticks = 70) {
  s.run(ticks, { stickY: 1 });
}

// One tick with A released, a take-off tick pressing A with `input`, then `hold` until
// landing. Returns { action (at take-off), peak, ticks, dist (along +Z) }.
function jumpArc(s, input = {}, hold = { ...input, A: true }) {
  s.run(1, { ...input, A: false });
  const y0 = s.p.pos.y;
  const z0 = s.p.pos.z;
  s.run(1, { ...input, A: true });
  const action = s.p.action;
  let peak = s.p.pos.y - y0;
  const ticks = s.run(150, hold, (p) => {
    peak = Math.max(peak, p.pos.y - y0);
    return !p.grounded;
  });
  return { action, peak, ticks, dist: s.p.pos.z - z0 };
}

describe('ground movement', () => {
  test('accelerates to 32 at full stick and never exceeds it on flat ground', () => {
    const s = sim(flat);
    let max = 0;
    s.run(150, { stickY: 1 }, (p) => {
      max = Math.max(max, p.forwardVel);
    });
    assert.equal(s.p.action, 'walking');
    assert.ok(Math.abs(s.p.forwardVel - 32) < 1.2, `fv=${s.p.forwardVel}`);
    assert.ok(max <= 33.2, `max=${max}`);
    assert.equal(s.p.anim, 'run');
  });

  test('half stick targets the squared magnitude and shows the walk / tiptoe cycle', () => {
    const s = sim(flat);
    s.run(120, { stickY: 0.6 });
    assert.ok(Math.abs(s.p.forwardVel - 0.36 * 32) < 1.2, `fv=${s.p.forwardVel}`);
    assert.equal(s.p.anim, 'walk');
    const t = sim(flat);
    t.run(60, { stickY: 0.4 });
    assert.equal(t.p.anim, 'tiptoe');
  });

  test('turns toward the stick by at most 11.25 deg per tick', () => {
    const s = sim(flat);
    runUp(s, 30);
    let prev = s.p.faceYaw;
    s.run(8, { stickX: -1 }, (p) => {
      const d = Math.abs(angleDiff(prev, p.faceYaw));
      assert.ok(d <= 11.25 * DEG + 1e-9, `turned ${d / DEG} deg`);
      prev = p.faceYaw;
    });
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI / 2)) < 1e-6, 'faces +X after the turn');
  });

  test('releasing the stick at speed brakes with a short skid, then idles', () => {
    const s = sim(flat);
    runUp(s);
    const z0 = s.p.pos.z;
    s.run(1, {});
    assert.equal(s.p.action, 'braking');
    assert.equal(s.p.anim, 'skid');
    const ticks = s.until(40, {}, (p) => p.action === 'idle');
    assert.ok(ticks <= 8, `stopped after ${ticks}`);
    const dist = s.p.pos.z - z0;
    assert.ok(dist > 90 && dist < 140, `skid distance ${dist}`);
    assert.ok(s.sfx().includes('skid'));
  });

  test('reversing the stick skids around; A during it side-flips', () => {
    const s = sim(flat);
    runUp(s);
    s.run(1, { stickY: -1 });
    assert.equal(s.p.action, 'turnaround');
    assert.equal(s.p.anim, 'turnaround');
    const skid = s.until(30, { stickY: -1 }, (p) => p.action === 'finish_turnaround');
    assert.ok(skid <= 8, `skid lasted ${skid}`);
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI)) < 1e-6, 'now faces -Z');
    s.until(10, { stickY: -1 }, (p) => p.action === 'walking');
    assert.equal(s.p.action, 'walking');

    const f = sim(flat);
    runUp(f);
    f.run(3, { stickY: -1 });
    f.run(1, { stickY: -1, A: true });
    assert.equal(f.p.action, 'sideflip');
    assert.ok(Math.abs(angleDiff(f.p.faceYaw, Math.PI)) < 1e-6);
    assert.ok(Math.abs(f.p.vel.y - 58) < 1e-6, `vy=${f.p.vel.y}`);
  });

  test('running into a wall pushes against it at near-zero speed', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 800, 2000, 1000, 1000);
    });
    s.run(60, { stickY: 1 });
    assert.equal(s.p.anim, 'push');
    assert.ok(s.p.forwardVel <= 6);
    assert.ok(Math.abs(s.p.pos.z - 750) < 1e-6, `z=${s.p.pos.z}`);
  });

  test('idles, looks around after 5 s, falls asleep after 15 s, wakes on input', () => {
    const s = sim(flat);
    s.run(160, {});
    assert.equal(s.p.action, 'idle');
    assert.notEqual(s.p.getRenderState(1).headYaw, 0);
    s.run(300, {});
    assert.equal(s.p.anim, 'sleep');
    s.run(1, { stickY: 1 });
    assert.notEqual(s.p.action, 'sleep');
  });

  test('crouch, crawl, and punch combo', () => {
    const s = sim(flat);
    s.run(3, { Z: true });
    assert.equal(s.p.anim, 'crouch');
    s.run(30, { Z: true, stickY: 1 });
    assert.equal(s.p.anim, 'crawl');
    assert.ok(Math.abs(s.p.forwardVel - 3.2) < 0.1, `crawl speed ${s.p.forwardVel}`);

    const k = sim(flat);
    const seen = [];
    for (let i = 0; i < 8; i++) {
      k.run(1, { B: true });
      k.run(2, {}, (p) => {
        seen.push(p.getRenderState(1).punchStep);
      });
    }
    assert.ok(seen.includes(1) && seen.includes(2), `punch steps ${seen}`);
    assert.ok(k.sfx().includes('kick'));
  });
});

describe('slopes', () => {
  // Steady uphill running speed on a long default-surface ramp of the given angle.
  const uphillSpeed = (deg) => {
    const s = sim((b) => {
      flat(b);
      b.ramp(-1000, 1000, 200, 8200, 0, Math.tan(deg * DEG) * 8000);
    });
    s.run(150, { stickY: 1 });
    assert.equal(s.p.action, 'walking');
    return s.p.forwardVel;
  };

  test('gentle slopes keep full speed; steeper walkable slopes slow the run a lot', () => {
    assert.ok(uphillSpeed(15) > 31.5, 'full speed at 15 deg');
    const at25 = uphillSpeed(25);
    const at30 = uphillSpeed(30);
    const at36 = uphillSpeed(36);
    assert.ok(at25 > 12 && at25 < 20, `25 deg: ${at25}`);
    assert.ok(at30 > 6 && at30 < 14, `30 deg: ${at30}`);
    assert.ok(at36 > 0 && at36 < 6, `36 deg: ${at36}`);
  });

  test('running downhill builds speed past the stick target', () => {
    const rise = Math.tan(25 * DEG) * 8000;
    const s = sim((b) => {
      flat(b);
      b.slope(-1000, 1000, 8200, 200, 0, rise);
    }, { x: 0, y: rise - 10, z: 300, yaw: 0 });
    s.run(90, { stickY: 1 });
    assert.equal(s.p.action, 'walking');
    assert.ok(s.p.forwardVel > 36 && s.p.forwardVel <= 48, `fv=${s.p.forwardVel}`);
  });

  test('a 45 deg ramp cannot be climbed: the hero slides back down', () => {
    const s = sim((b) => {
      flat(b);
      b.ramp(-1000, 1000, 500, 1500, 0, 1000);
    });
    let maxY = 0;
    const seen = new Set();
    s.run(150, { stickY: 1 }, (p) => {
      maxY = Math.max(maxY, p.pos.y);
      seen.add(p.action);
    });
    assert.ok(seen.has('butt_slide'), [...seen].join());
    assert.ok(maxY < 300, `climbed to ${maxY}`);
  });

  test('jumping onto a steep slope slides back down it', () => {
    const s = sim((b) => {
      flat(b);
      b.ramp(-1000, 1000, 600, 1600, 0, 1000);
    });
    s.run(20, { stickY: 1 });
    jumpArc(s, { stickY: 1 });
    assert.equal(s.p.action, 'butt_slide');
    s.until(90, {}, (p) => p.action === 'idle');
    assert.equal(s.p.pos.y, 0);
    assert.ok(s.p.pos.z < 600, `ended at z=${s.p.pos.z}`);
  });

  test('standing on a very slippery gentle slope slides; default surface does not', () => {
    const slope = (surface) => (b) => {
      flat(b);
      b.slope(-1000, 1000, 1000, -1000, 0, Math.tan(15 * DEG) * 2000, { surface });
    };
    const spawnY = Math.tan(15 * DEG) * 1000;
    const icy = sim(slope('very_slippery'), { x: 0, y: spawnY, z: 0, yaw: 0 });
    icy.run(20, {});
    assert.equal(icy.p.action, 'butt_slide');
    assert.ok(icy.p.pos.z > 50, 'slid downhill (+Z)');
    const grass = sim(slope('default'), { x: 0, y: spawnY, z: 0, yaw: 0 });
    grass.run(20, {});
    assert.equal(grass.p.action, 'idle');
  });
});

describe('jumps', () => {
  test('standing single jump peaks near 42^2/8 and A release cuts it short', () => {
    const s = sim(flat);
    const full = jumpArc(s);
    assert.equal(full.action, 'jump');
    assert.ok(Math.abs(full.peak - (42 * 42) / 8) < 30, `peak ${full.peak}`);
    s.run(10, {});
    const short = jumpArc(s, {}, {});
    assert.ok(short.peak < full.peak * 0.5, `short hop ${short.peak}`);
  });

  test('running jump adds forward speed to the take-off velocity', () => {
    const s = sim(flat);
    runUp(s);
    const fv = s.p.forwardVel;
    s.run(1, { stickY: 1, A: true });
    assert.ok(Math.abs(s.p.vel.y + 4 - (42 + fv * 0.25)) < 1e-6);
    assert.ok(Math.abs(s.p.forwardVel - fv * 0.8) < 1.5);
  });

  test('double and triple jumps chain inside the landing window', () => {
    const s = sim(flat);
    runUp(s);
    const run = { stickY: 1 };
    const single = jumpArc(s, run);
    const dbl = jumpArc(s, run);
    const tri = jumpArc(s, run);
    assert.deepEqual([single.action, dbl.action, tri.action], ['jump', 'double_jump', 'triple_jump']);
    assert.ok(dbl.peak > single.peak + 100, `double peak ${dbl.peak}`);
    assert.ok(tri.peak > 580, `triple peak ${tri.peak}`);
    assert.ok(s.sfx().includes('triple_jump'));
  });

  test('waiting past the window, or a slow double jump, gives a plain jump', () => {
    const s = sim(flat);
    runUp(s);
    jumpArc(s, { stickY: 1 });
    s.run(8, { stickY: 1 });
    assert.equal(jumpArc(s, { stickY: 1 }).action, 'jump');
    const t = sim(flat);
    const walk = { stickY: 0.5 };
    t.run(6, walk);
    const chain = [jumpArc(t, walk), jumpArc(t, walk), jumpArc(t, walk)].map((j) => j.action);
    assert.deepEqual(chain, ['jump', 'double_jump', 'jump']);
  });

  test('backflip from a crouch goes high and backward', () => {
    const s = sim(flat);
    s.run(3, { Z: true });
    const j = jumpArc(s, { Z: true });
    assert.equal(j.action, 'backflip');
    assert.ok(Math.abs(j.peak - (62 * 62) / 8) < 50, `peak ${j.peak}`);
    assert.ok(j.dist < -200, `moved ${j.dist}`);
  });

  test('long jump: Z then A while running covers a long distance', () => {
    const s = sim(flat);
    runUp(s);
    s.run(1, { stickY: 1, Z: true });
    assert.equal(s.p.action, 'crouch_slide');
    const j = jumpArc(s, { stickY: 1, Z: true }, { stickY: 1 });
    assert.equal(j.action, 'long_jump');
    assert.ok(j.dist > 1100, `distance ${j.dist}`);
    assert.ok(j.peak < 300, `peak ${j.peak}`);
  });

  test('air control: holding back slows, sideways drifts without turning', () => {
    const s = sim(flat);
    runUp(s);
    s.run(1, { stickY: 1, A: true });
    const yaw = s.p.faceYaw;
    s.run(8, { stickX: -1, A: true });
    assert.equal(s.p.faceYaw, yaw);
    assert.ok(s.p.pos.x > 55 && s.p.pos.x <= 80, `drifted to x=${s.p.pos.x}`);
    const fv = s.p.forwardVel;
    s.run(6, { stickY: -1, A: true });
    assert.ok(s.p.forwardVel < fv - 8);
  });

  test('air speed is capped: holding forward never pushes past 32 (48 for long jumps)', () => {
    const s = sim((b) => b.box(-500, -4000, -6000, 500, 3000, 0), { x: 0, y: 3000, z: -1250, yaw: 0 });
    s.run(45, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    let max = 0;
    s.run(60, { stickY: 1, A: true }, (p) => {
      max = Math.max(max, p.forwardVel);
    });
    assert.ok(!s.p.grounded, 'still falling past the platform edge');
    assert.ok(max <= 32 + 1e-9, `air speed ${max}`);
    const l = sim(flat);
    runUp(l);
    l.run(1, { stickY: 1, Z: true });
    l.run(1, { stickY: 1, Z: true, A: true });
    let lmax = 0;
    l.until(60, { stickY: 1 }, (p) => {
      lmax = Math.max(lmax, p.forwardVel);
      return p.grounded;
    });
    assert.ok(lmax <= 48 + 1e-9, `long jump speed ${lmax}`);
  });
});

describe('walls and ledges', () => {
  test('wall kick off a wall hit head-on at speed', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 700, 2000, 2000, 900);
    });
    s.run(25, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(30, { stickY: 1, A: true }, (p) => p.action === 'air_hit_wall');
    assert.equal(s.p.action, 'air_hit_wall');
    s.run(1, { A: false });
    s.run(1, { A: true });
    assert.equal(s.p.action, 'wallkick');
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI)) < 1e-6, 'reflected to face away');
    assert.ok(s.p.forwardVel >= 24 - 0.5 && s.p.forwardVel <= 32, `kick speed ${s.p.forwardVel}`);
    s.run(10, {});
    assert.ok(s.p.pos.z < 500 && s.p.pos.y > 300, `pos ${s.p.pos.z}, ${s.p.pos.y}`);
    assert.ok(s.sfx().includes('wallkick'));
  });

  test('without A the wall hit becomes a soft bonk', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 700, 2000, 2000, 900);
    });
    s.run(25, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(30, { stickY: 1, A: true }, (p) => p.action === 'air_hit_wall');
    s.run(3, {});
    assert.equal(s.p.action, 'soft_bonk');
    assert.ok(s.p.forwardVel < 0);
    s.until(60, {}, (p) => p.grounded);
    assert.ok(s.p.pos.z < 650);
  });

  test('falling against a ledge grabs it; stick toward climbs up', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 1300, 2000, 400, 2500);
    });
    s.run(34, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(40, { stickY: 1, A: true }, (p) => p.action === 'ledge_hang');
    assert.equal(s.p.action, 'ledge_hang');
    assert.ok(s.sfx().includes('ledge_grab'));
    s.run(4, {});
    assert.equal(s.p.pos.y, 400 - 160);
    s.until(20, { stickY: 1 }, (p) => p.action === 'ledge_climb');
    s.until(30, {}, (p) => p.action === 'idle');
    assert.equal(s.p.pos.y, 400);
    assert.ok(s.p.pos.z > 1300);
  });

  test('a standing hop beside a 300 ledge grabs it on the way down', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 300, 2000, 300, 2500);
    });
    s.run(30, { stickY: 1 });
    s.run(2, {});
    s.run(1, { A: true });
    s.until(40, { A: true }, (p) => p.action === 'ledge_hang');
    assert.equal(s.p.action, 'ledge_hang');
    const rise = 300 - s.p.pos.y;
    assert.ok(rise >= 100 && rise <= 160, `grabbed ${rise} above the feet`);
  });

  test('Z drops from a ledge', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 1300, 2000, 400, 2500);
    });
    s.run(34, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(40, { stickY: 1, A: true }, (p) => p.action === 'ledge_hang');
    s.run(4, {});
    s.run(1, { Z: true });
    assert.equal(s.p.action, 'freefall');
    s.until(30, {}, (p) => p.grounded);
    assert.equal(s.p.pos.y, 0);
  });

  test('poles: grab by jumping into one, climb, jump off backward', () => {
    const s = sim((b) => {
      flat(b);
      b.pole(0, 600, 0, 900, 30);
    });
    s.run(10, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(30, { stickY: 1, A: true }, (p) => p.action === 'pole');
    assert.equal(s.p.action, 'pole');
    const y0 = s.p.pos.y;
    s.run(15, { stickY: 1 });
    assert.equal(s.p.anim, 'pole_climb');
    assert.ok(s.p.pos.y > y0 + 80);
    s.run(1, {});
    s.run(1, { A: true });
    assert.equal(s.p.action, 'pole_jump');
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI)) < 0.2, 'faces away from the pole');
    s.run(12, {});
    assert.ok(s.p.pos.z < 500, 'moved away from the pole');
  });

  test('walking into a pole on the ground is blocked by the trunk', () => {
    const s = sim((b) => {
      flat(b);
      b.pole(0, 600, 0, 900, 30);
    });
    s.run(60, { stickY: 1 }, (p) => {
      assert.ok(Math.hypot(p.pos.x, p.pos.z - 600) >= 69.9);
    });
  });
});

describe('special moves', () => {
  test('ground pound: spin, plummet, thud with no fall damage', () => {
    const s = sim(flat, { x: 0, y: 3600, z: 0, yaw: 0 });
    s.run(1, {});
    s.run(1, { Z: true });
    assert.equal(s.p.action, 'ground_pound');
    assert.equal(s.p.anim, 'ground_pound_spin');
    s.run(10, {});
    assert.equal(s.p.anim, 'ground_pound_fall');
    assert.ok(s.p.vel.y <= -50);
    s.until(80, {}, (p) => p.grounded);
    assert.equal(s.p.action, 'ground_pound_land');
    assert.equal(s.p.health, 8);
    assert.ok(s.sfx().includes('ground_pound_land'));
    assert.ok(s.log.some((e) => e.event === 'land' && e.hard));
    s.run(20, {});
    assert.equal(s.p.action, 'idle');
  });

  test('running dive lands in a belly slide; A rolls out', () => {
    const s = sim(flat);
    runUp(s);
    s.run(1, { stickY: 1, B: true });
    assert.equal(s.p.action, 'dive');
    assert.ok(s.p.forwardVel >= 45);
    s.until(40, { stickY: 1 }, (p) => p.action === 'belly_slide');
    assert.equal(s.p.anim, 'belly_slide');
    s.run(3, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    assert.equal(s.p.action, 'forward_rollout');
    assert.ok(s.p.vel.y > 20);
    s.until(40, { stickY: 1 }, (p) => p.grounded);
    assert.ok(['land', 'walking'].includes(s.p.action));
  });

  test('air B: jump kick when slow, dive when fast', () => {
    const s = sim(flat);
    s.run(1, { A: true });
    s.run(1, { B: true });
    assert.equal(s.p.action, 'jump_kick');
    const f = sim(flat);
    runUp(f);
    f.run(1, { stickY: 1, A: true });
    f.run(6, { stickY: 1, A: true });
    f.run(1, { stickY: 1, B: true });
    assert.equal(f.p.action, 'dive');
  });
});

describe('water', () => {
  const pool = (b) => {
    const hole = { x0: -1000, z0: -3000, x1: 1000, z1: -500 };
    b.ground(30000, 0, hole);
    b.pool({ ...hole, y0: -700, level: -60, bank: 1000 });
  };
  const facingPool = { x: 0, y: 0, z: 0, yaw: Math.PI };

  test('walks down the bank into the water and floats at the surface', () => {
    const s = sim(pool, facingPool);
    s.until(120, { stickY: -1 }, (p) => p.inWater);
    assert.equal(s.p.action, 'water_surface');
    assert.ok(s.log.some((e) => e.event === 'splash'));
    s.run(10, {});
    assert.ok(Math.abs(s.p.pos.y - (-60 - 80)) < 1e-6, `y=${s.p.pos.y}`);
  });

  test('dive under, stroke, flutter, drain health, surface and jump out', () => {
    const s = sim(pool, facingPool);
    s.until(120, { stickY: -1 }, (p) => p.inWater);
    s.run(10, {});
    s.run(1, { stickY: 1, A: true });
    assert.equal(s.p.action, 'swim_stroke');
    let maxFv = 0;
    s.run(8, { stickY: 1 }, (p) => {
      maxFv = Math.max(maxFv, p.forwardVel);
    });
    assert.ok(maxFv > 20 && maxFv <= 28, `stroke speed ${maxFv}`);
    assert.ok(s.p.pos.y < -250, `dived to ${s.p.pos.y}`);
    assert.ok(s.p.getRenderState(1).pitch > 0.3, 'nose down');
    s.run(1, { A: false });
    s.run(1, { A: true });
    s.run(30, { A: true });
    assert.equal(s.p.action, 'swim_flutter');
    assert.ok(Math.abs(s.p.forwardVel - 16) < 1e-6);
    // Hold position at depth (stick up keeps the nose down against buoyancy).
    s.run(270, { stickY: 0.2 });
    assert.ok(s.p.health < 8, 'drowning drains health');
    assert.ok(s.p.breath < 1);
    // Pitch up and swim to the surface.
    s.until(200, { stickY: -1, A: true }, (p) => p.action === 'water_surface');
    assert.equal(s.p.action, 'water_surface');
    const hurt = s.p.health;
    s.run(40, {});
    assert.ok(s.p.health > hurt, 'health refills at the surface');
    s.run(1, { stickY: -1, A: true });
    assert.equal(s.p.action, 'water_jump');
    assert.ok(s.sfx().includes('water_exit'));
  });

  test('swimming back to the bank wades out onto land', () => {
    const s = sim(pool, facingPool);
    s.until(120, { stickY: -1 }, (p) => p.inWater);
    s.run(20, { stickX: 1 });
    s.until(40, { stickX: 1 }, (p) => Math.abs(angleDiff(p.faceYaw, 0)) < 0.15);
    s.until(200, { stickY: 1 }, (p) => !p.inWater);
    assert.ok(!s.p.inWater);
    assert.ok(['walking', 'idle'].includes(s.p.action), s.p.action);
  });

  test('landing in water never hurts', () => {
    const s = sim(pool, { x: 0, y: 4000, z: -1500, yaw: 0 });
    s.until(200, {}, (p) => p.inWater);
    s.run(60, {});
    assert.equal(s.p.health, 8);
    assert.ok(s.log.some((e) => e.event === 'splash' && e.big));
  });
});

describe('health and respawn', () => {
  test('falls: >1150 costs 3 wedges, >3000 costs 4', () => {
    const s = sim(flat, { x: 0, y: 1500, z: 0, yaw: 0 });
    s.until(100, {}, (p) => p.grounded);
    assert.equal(s.p.health, 5);
    assert.equal(s.p.anim, 'fall_damage');
    assert.ok(s.log.some((e) => e.event === 'land' && e.hard));
    const d = sim(flat, { x: 0, y: 3500, z: 0, yaw: 0 });
    d.until(100, {}, (p) => p.grounded);
    assert.equal(d.p.health, 4);
    assert.equal(d.p.action, 'hard_fall');
    assert.equal(d.p.anim, 'fall_damage');
    const e = sim(flat, { x: 0, y: 800, z: 0, yaw: 0 });
    e.until(100, {}, (p) => p.grounded);
    assert.ok(!e.log.some((ev) => ev.event === 'land' && ev.hard));
  });

  test('damage knocks back, grants invincibility, coins heal', () => {
    const s = sim(flat);
    assert.ok(s.p.takeDamage(2, { x: 0, y: 0, z: 100 }));
    assert.equal(s.p.health, 6);
    assert.equal(s.p.action, 'hurt');
    assert.ok(s.p.getRenderState(1).invincible);
    assert.ok(!s.p.takeDamage(2, { x: 0, y: 0, z: 100 }), 'invincible');
    s.run(10, {});
    assert.ok(s.p.pos.z < -50, 'knocked away from the source');
    s.run(60, {});
    assert.equal(s.p.action, 'idle');
    assert.ok(!s.p.getRenderState(1).invincible);
    s.p.collectCoin(1);
    s.p.collectCoin(2);
    assert.equal(s.p.health, 8);
    assert.equal(s.p.coins, 3);
  });

  test('zero health: death, lifeLost, respawn at spawn with full health', () => {
    const s = sim(flat, { x: 100, y: 0, z: 200, yaw: 1 });
    s.run(10, { stickY: 1 });
    s.p.takeDamage(8, null);
    assert.equal(s.p.action, 'death');
    s.run(5, {});
    assert.equal(s.p.anim, 'death');
    assert.equal(s.log.filter((e) => e.event === 'lifeLost').length, 1);
    s.until(200, {}, (p) => p.action === 'idle');
    assert.equal(s.p.health, 8);
    assert.ok(Math.hypot(s.p.pos.x - 100, s.p.pos.z - 200) < 1e-6);
    assert.equal(s.p.pos.y, 0);
  });

  test('falling out of the level or onto a death floor loses a life', () => {
    // Walking can't leave the collision mesh (no floor = wall), so jump off the edge.
    const s = sim((b) => b.floor(-500, -500, 500, 500, 0), { x: 0, y: 0, z: 0, yaw: 0 });
    s.run(30, { stickY: 1 });
    assert.ok(s.p.grounded && s.p.pos.z > 400 && s.p.pos.z <= 500);
    jumpArc(s, { stickY: 1 }); // lasts until the respawn drop lands
    assert.equal(s.p.action, 'spawn_land');
    assert.deepEqual(s.p.pos, { x: 0, y: 0, z: 0 });
    assert.equal(s.log.filter((e) => e.event === 'lifeLost').length, 1);
    const d = sim((b) => {
      flat(b);
      b.floor(-500, 500, 500, 1500, 10, { surface: 'death' });
    });
    d.until(60, { stickY: 1 }, (p) => p.action === 'spawn');
    assert.equal(d.log.filter((e) => e.event === 'lifeLost').length, 1);
  });

  test('intro: drops in from the sky ignoring input, then idles', () => {
    const s = sim(flat, { x: 0, y: 0, z: 0, yaw: 0.5 });
    s.p.beginIntro();
    assert.equal(s.p.action, 'spawn');
    assert.equal(s.p.pos.y, 1600);
    s.until(100, { stickY: 1, A: true }, (p) => p.grounded);
    assert.equal(s.p.action, 'spawn_land');
    assert.equal(s.p.pos.x, 0);
    assert.equal(s.p.health, 8);
    s.run(25, {});
    assert.equal(s.p.action, 'idle');
  });

  test('collectStar celebrates', () => {
    const s = sim(flat);
    s.p.collectStar();
    assert.equal(s.p.stars, 1);
    s.run(2, {});
    assert.equal(s.p.anim, 'star_dance');
    s.run(90, {});
    assert.equal(s.p.action, 'idle');
  });
});

describe('robustness and render state', () => {
  test('never falls through a thin floor at terminal velocity', () => {
    const s = sim((b) => {
      b.box(-300, -20, -300, 300, 0, 300);
    }, { x: 0, y: 6000, z: 0, yaw: 0 });
    s.until(200, {}, (p) => p.grounded);
    assert.equal(s.p.pos.y, 0);
  });

  test('never passes through walls at max speed from any angle', () => {
    for (let a = 0; a < 16; a++) {
      const yaw = (a / 16) * Math.PI * 2;
      const s = sim((b) => {
        flat(b);
        b.box(-400, 0, -400, 400, 3000, 400);
      }, { x: -Math.sin(yaw) * 1500, y: 0, z: -Math.cos(yaw) * 1500, yaw });
      const input = { stickX: -Math.sin(yaw), stickY: Math.cos(yaw) };
      const outside = (p) => {
        assert.ok(Math.abs(p.pos.x) > 400 || Math.abs(p.pos.z) > 400 || p.pos.y >= 3000, `inside at ${p.pos.x}, ${p.pos.z}`);
      };
      s.run(100, input, outside);
      // Long jumps and dives at the box too.
      s.run(1, {});
      s.run(20, { stickX: Math.sin(yaw), stickY: -Math.cos(yaw) });
      s.run(40, input);
      s.run(1, { ...input, Z: true });
      s.run(1, { ...input, Z: true, A: true });
      s.run(40, input, outside);
    }
  });

  test('long random input runs on the test course stay finite and valid', () => {
    const { builder, spawn } = buildTestCourse();
    const world = builder.build();
    const player = new Player({ collision: world, events: new Events(), spawn });
    const ctl = new ScriptedController();
    const rng = makeRng(1234);
    let input = {};
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) {
      if (i % 12 === 0) {
        const a = rng() * Math.PI * 2;
        const m = rng() < 0.2 ? 0 : rng();
        input = { stickX: Math.cos(a) * m, stickY: Math.sin(a) * m, A: rng() < 0.3, B: rng() < 0.1, Z: rng() < 0.12 };
      }
      const { x, z } = player.pos;
      player.update(ctl.next(input), rng() * 6);
      const { pos, vel } = player;
      assert.ok(Number.isFinite(pos.x + pos.y + pos.z + vel.x + vel.y + vel.z + player.faceYaw), `NaN at ${i}`);
      assert.ok(Math.abs(pos.x) < 10000 && Math.abs(pos.z) < 10000, `escaped the course at ${i}`);
      assert.ok(ANIM_NAMES.has(player.getRenderState(0.5).anim));
      // No teleport-like horizontal jumps outside the actions that place the hero themselves.
      if (!['ledge_climb', 'spawn', 'pole'].includes(player.action)) {
        const moved = Math.hypot(pos.x - x, pos.z - z);
        assert.ok(moved <= Math.hypot(vel.x, vel.z) + 60, `jumped ${moved} in ${player.action} at ${i}`);
      }
    }
    const perTick = (performance.now() - t0) / 20000;
    assert.ok(perTick < 1, `tick took ${perTick} ms`);
  });

  test('render state interpolates position and yaw between ticks', () => {
    const s = sim(flat);
    runUp(s, 30);
    s.run(1, { stickX: -1 });
    const rs0 = s.p.getRenderState(0);
    const rs1 = s.p.getRenderState(1);
    const mid = s.p.getRenderState(0.5);
    assert.deepEqual(rs0.pos, s.p.prevPos);
    assert.deepEqual(rs1.pos, s.p.pos);
    assert.ok(Math.abs(mid.pos.z - (rs0.pos.z + rs1.pos.z) / 2) < 1e-9);
    assert.ok(Math.abs(angleDiff(mid.yaw, (rs0.yaw + rs1.yaw) / 2)) < 1e-9);
    assert.ok(mid.animTime > rs0.animTime && mid.animTime < rs1.animTime);
    for (const key of ['pitch', 'roll', 'cyclePhase', 'forwardVel', 'vy', 'grounded', 'inWater', 'floorY', 'health', 'invincible', 'punchStep']) {
      assert.ok(key in mid, key);
    }
    assert.ok(mid.floorNormal.y > 0.99);
  });

  test('footsteps fire twice per locomotion cycle with the floor terrain', () => {
    const s = sim((b) => b.ground(30000, 0, null, { terrain: 'stone' }));
    s.run(90, { stickY: 1 });
    const steps = s.log.filter((e) => e.event === 'footstep');
    const cycles = s.p.cyclePhase;
    assert.ok(Math.abs(steps.length - Math.floor(cycles * 2)) <= 1, `${steps.length} steps / ${cycles} cycles`);
    assert.equal(steps[0].terrain, 'stone');
  });
});
