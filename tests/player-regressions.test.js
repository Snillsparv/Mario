// Regression tests for defects found in review of the player physics (one describe per finding).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSim as sim } from '../src/player/physics/testCourse.js';
import { angleDiff } from '../src/core/math.js';

const DEG = Math.PI / 180;
const flat = (b) => b.ground(30000);

// Walks +Z from the origin into the wall of a course whose obstacle face is at z = 300,
// hops straight up with A held plus `after` input. Returns the sim and a per-tick trace of { action, y }.
function hopBeside(build, { ticks = 60, after = {} } = {}) {
  const s = sim(build, { x: 0, y: 0, z: 0, yaw: 0 });
  s.run(30, { stickY: 1 });
  s.run(2, {});
  s.run(1, { A: true });
  const trace = [];
  s.run(ticks, { A: true, ...after }, (p) => {
    trace.push({ action: p.action, y: p.pos.y });
  });
  return { s, trace };
}

describe('walking and air control use the project model', () => {
  test('rest to 30 takes 1.1-1.6 s at full stick, then holds 32', () => {
    const s = sim(flat);
    const t = s.until(90, { stickY: 1 }, (p) => p.forwardVel >= 30);
    assert.ok(t >= 33 && t <= 48, `${t} ticks`);
    s.run(30, { stickY: 1 });
    assert.equal(s.p.forwardVel, 32);
  });

  test('a speed above the cap only bleeds off in the air, even with the stick held', () => {
    const s = sim(flat, { x: 0, y: 2000, z: 0, yaw: 0 });
    s.run(1, {});
    s.p.forwardVel = 40;
    let prev = 40;
    s.run(12, { stickY: 1 }, (p) => {
      assert.ok(p.forwardVel <= prev, `sped up to ${p.forwardVel}`);
      prev = p.forwardVel;
    });
    assert.ok(Math.abs(s.p.forwardVel - 32) < 1e-9, `settled at ${s.p.forwardVel}`);
  });
});

describe('ledge grabs only within arm reach', () => {
  const box = (h) => (b) => {
    flat(b);
    b.box(-500, 0, 300, 500, h, 1000, { noBottom: true });
  };

  test('low boxes are never hung from with the feet in the ground', () => {
    for (const h of [60, 90, 120, 150]) {
      const { trace } = hopBeside(box(h));
      assert.ok(!trace.some((t) => t.action === 'ledge_hang'), `grabbed a ${h} box`);
    }
    const { trace } = hopBeside(box(250));
    const hang = trace.filter((t) => t.action === 'ledge_hang');
    assert.ok(hang.length, 'grabs a 250 box');
    assert.ok(hang.every((t) => t.y >= 0), 'feet above the ground');
  });

  test('the hang never pops the hero up, and sinks into place at most 30 per tick', () => {
    for (const h of [260, 300, 360]) {
      const { trace } = hopBeside(box(h));
      const i = trace.findIndex((t) => t.action === 'ledge_hang');
      assert.ok(i > 0, `grabbed the ${h} box`);
      const rise = h - trace[i].y;
      assert.ok(rise >= 100 && rise <= 160, `${h}: grabbed ${rise} above the feet`);
      for (let k = i + 1; k < trace.length && trace[k].action === 'ledge_hang'; k++) {
        const dy = trace[k].y - trace[k - 1].y;
        assert.ok(dy <= 0 && dy >= -30, `${h}: hang moved ${dy} in a tick`);
      }
    }
  });

  test('a wall reached only 40 below its top is slid down, not grabbed', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 1300, 2000, 300, 2500);
    });
    s.run(40, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    const seen = new Set();
    s.until(60, { stickY: 1, A: true }, (p) => {
      seen.add(p.action);
      return p.grounded;
    });
    assert.ok(!seen.has('ledge_hang'), [...seen].join());
  });

  test('a wall that continues above an inner floor is no ledge (castle facade)', () => {
    // A hollow tower: its outer wall runs to 1500 while a floor inside sits at 300.
    const tower = (b) => {
      flat(b);
      b.box(-500, 0, 300, 500, 1500, 320, { noBottom: true });
      b.floor(-480, 320, 480, 1000, 300);
    };
    const { trace } = hopBeside(tower, { ticks: 200, after: { stickY: 1 } });
    assert.ok(!trace.some((t) => t.action === 'ledge_hang' || t.action === 'ledge_climb'));
  });

  test('no grab under a deck: something solid right over the ledge top', () => {
    const deck = (b) => {
      box(250)(b);
      b.box(-500, 345, 250, 500, 400, 1000);
    };
    const { trace } = hopBeside(deck);
    assert.ok(!trace.some((t) => t.action === 'ledge_hang'));
  });

  test('no grab when there is no room to stand on the ledge', () => {
    const shelf = (b) => {
      box(250)(b);
      b.box(-500, 250, 320, 500, 1500, 1000, { noBottom: true });
    };
    const { trace } = hopBeside(shelf);
    assert.ok(!trace.some((t) => t.action === 'ledge_hang'));
  });
});

describe('fall damage, pole jumps, drowning', () => {
  test('falls over 1150 cost 3 wedges, over 3000 cost 4; slippery floors cushion only the smaller', () => {
    for (const [h, health] of [[1200, 5], [2000, 5], [2900, 5], [3100, 4]]) {
      const s = sim(flat, { x: 0, y: h, z: 0, yaw: 0 });
      s.until(120, {}, (p) => p.grounded);
      assert.equal(s.p.health, health, `fall of ${h}`);
      assert.equal(s.p.action, 'hard_fall');
    }
    const ice = (h) => {
      const s = sim((b) => b.ground(30000, 0, null, { surface: 'slippery' }), { x: 0, y: h, z: 0, yaw: 0 });
      s.until(150, {}, (p) => p.grounded);
      return s;
    };
    const small = ice(2000);
    assert.equal(small.p.health, 8);
    assert.ok(small.events('land').some((e) => e.hard));
    assert.equal(ice(3500).p.health, 4);
  });

  test('jumping off a pole is a wall-kick-sized leap away from the trunk', () => {
    const s = sim((b) => {
      flat(b);
      b.pole(0, 600, 0, 900, 30);
    });
    s.run(10, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(30, { stickY: 1, A: true }, (p) => p.action === 'pole');
    s.run(3, {});
    s.run(1, { A: true });
    assert.equal(s.p.action, 'pole_jump');
    const y0 = s.p.pos.y;
    const z0 = s.p.pos.z;
    let peak = 0;
    s.until(80, { A: true }, (p) => {
      peak = Math.max(peak, p.pos.y - y0);
      return p.grounded;
    });
    assert.ok(peak > 440, `rose ${peak}`);
    assert.ok(z0 - s.p.pos.z > 500, `travelled ${z0 - s.p.pos.z}`);
  });

  test('drowning costs a wedge per ~8.5 s; any swim action near the surface breathes', () => {
    const pool = (b) => {
      const hole = { x0: -1000, z0: -3000, x1: 1000, z1: -500 };
      b.ground(30000, 0, hole);
      b.pool({ ...hole, y0: -2000, level: -60, bank: 1000 });
    };
    const s = sim(pool, { x: 0, y: -1900, z: -1500, yaw: 0 });
    s.run(1, {});
    assert.ok(s.p.inWater);
    let lost = 0;
    s.run(600, { stickY: 1 }, (p) => {
      if (p.pos.y > -60 - 140) throw new Error('surfaced');
      lost = 8 - p.health;
    });
    assert.equal(lost, 2, `lost ${lost} wedges in 20 s`);
    // A level stroke just under the surface (head above water) breathes: 1 wedge per 10 ticks.
    s.p.teleport(0, -190, -1500, 0);
    s.p.swimPitch = 0;
    s.p.setAction('swim_stroke');
    s.run(12, {});
    assert.equal(s.p.action, 'swim_stroke');
    assert.equal(s.p.health, 7);
  });
});

describe('walls and trunks', () => {
  test('a long jump into a wall kicks off keeping its speed; un-kicked it bonks hard', () => {
    const wall = (b) => {
      flat(b);
      b.box(-2000, 0, 2200, 2000, 2000, 2400);
    };
    const longJumpAtWall = () => {
      const s = sim(wall);
      s.run(70, { stickY: 1 });
      s.run(1, { stickY: 1, Z: true });
      s.run(1, { stickY: 1, Z: true, A: true });
      assert.equal(s.p.action, 'long_jump');
      s.until(40, { stickY: 1 }, (p) => p.action === 'air_hit_wall');
      assert.equal(s.p.action, 'air_hit_wall');
      return s;
    };
    const k = longJumpAtWall();
    k.run(1, { A: true });
    assert.equal(k.p.action, 'wallkick');
    assert.ok(k.p.forwardVel > 40, `kicked off at ${k.p.forwardVel}`);
    const b = longJumpAtWall();
    b.run(3, {});
    assert.equal(b.p.action, 'bonk');
  });

  test('the wall contact shows the braced wall-kick pose; a rollout somersaults', () => {
    const s = sim((b) => {
      flat(b);
      b.box(-2000, 0, 700, 2000, 2000, 900);
    });
    s.run(25, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    s.until(30, { stickY: 1, A: true }, (p) => p.action === 'air_hit_wall');
    s.run(1, { A: false });
    const rs = s.p.getRenderState(0.5);
    assert.equal(rs.anim, 'wallkick');
    assert.equal(rs.animTime, 0);
    const r = sim(flat);
    r.run(70, { stickY: 1 });
    r.run(1, { stickY: 1, B: true });
    r.until(40, { stickY: 1 }, (p) => p.action === 'belly_slide');
    r.run(3, {});
    r.run(1, { A: true });
    assert.equal(r.p.action, 'forward_rollout');
    assert.equal(r.p.anim, 'triple_jump');
  });

  test('running into a trunk pushes against it: no speed, no footsteps', () => {
    const s = sim((b) => {
      flat(b);
      b.pole(0, 600, 0, 900, 30);
    });
    s.run(40, { stickY: 1 });
    const steps = s.events('footstep').length;
    s.run(30, { stickY: 1 });
    assert.equal(s.p.anim, 'push');
    assert.ok(s.p.forwardVel <= 6);
    assert.equal(s.events('footstep').length, steps);
  });

  test('trunks are solid in the air and in water too', () => {
    const s = sim((b) => {
      flat(b);
      b.pole(0, 300, 0, 900, 40);
    }, { x: 0, y: 0, z: 0, yaw: 0 });
    s.p.takeDamage(1, { x: 0, y: 0, z: -100 }); // knocked back toward +Z, into the trunk
    s.run(30, {}, (p) => {
      assert.ok(Math.hypot(p.pos.x, p.pos.z - 300) >= 80 - 1e-6, `inside the trunk at z=${p.pos.z}`);
    });
  });

  test('a zero-thickness double-sided panel is never walked, run or swum through', () => {
    const panel = (b) => {
      b.ground(30000, 0, { x0: -1000, z0: -3000, x1: 1000, z1: -500 });
      b.pool({ x0: -1000, z0: -3000, x1: 1000, z1: -500, y0: -800, level: -60, bank: 800 });
      for (const facing of [[1, 0, 0], [-1, 0, 0]]) {
        b.quad([0, -800, -3000], [0, -800, 3000], [0, 400, 3000], [0, 400, -3000], facing);
      }
    };
    for (const stick of [1, 0.6, 0.35]) {
      for (const angle of [0, 20, 45]) {
        const yaw = (90 - angle) * DEG;
        const s = sim(panel, { x: -400, y: 0, z: 500, yaw });
        const input = { stickX: -Math.sin(yaw) * stick, stickY: Math.cos(yaw) * stick };
        s.run(90, input, (p) => {
          assert.ok(p.pos.x < 0, `crossed to x=${p.pos.x} (stick ${stick}, ${angle} deg)`);
        });
      }
    }
    const w = sim(panel, { x: -60, y: -500, z: -2800, yaw: 0.3 });
    w.run(1, {});
    assert.ok(w.p.inWater);
    w.run(120, { A: true, stickX: -0.3 }, (p) => {
      assert.ok(p.pos.x < 0, `swam through to x=${p.pos.x}`);
    });
  });

  test('jumping toward a spot without headroom still falls and lands (no hovering)', () => {
    const s = sim((b) => {
      b.ground(5000, 0);
      b.quad([-500, 400, 200], [500, 400, 200], [500, 60, 1200], [-500, 60, 1200], [0, -1, 0]);
    });
    s.run(60, { stickY: 1 });
    s.run(1, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    let airborne = 0;
    s.run(60, { stickY: 1, A: true }, (p) => {
      if (!p.grounded) airborne++;
      assert.ok(p.forwardVel <= 32);
    });
    assert.ok(airborne < 20, `airborne ${airborne} ticks`);
  });
});

describe('small moves', () => {
  test('a second hop in place is a double jump', () => {
    const s = sim(flat);
    s.run(1, { A: true });
    s.until(60, { A: true }, (p) => p.grounded);
    s.run(1, {});
    s.run(1, { A: true });
    assert.equal(s.p.action, 'double_jump');
  });

  test('Z while walking slowly crouch-slides and stops into a crouch', () => {
    const s = sim(flat);
    s.run(20, { stickY: 0.5 });
    assert.ok(s.p.forwardVel > 6 && s.p.forwardVel < 10, `fv=${s.p.forwardVel}`);
    s.run(1, { stickY: 0.5, Z: true });
    assert.equal(s.p.action, 'crouch_slide');
    s.until(30, { Z: true }, (p) => p.action === 'crouch');
    assert.equal(s.p.action, 'crouch');
  });

  test('the ground-pound wind-up rises about 110', () => {
    const s = sim(flat, { x: 0, y: 2000, z: 0, yaw: 0 });
    s.run(1, {});
    const y0 = s.p.pos.y;
    s.run(1, { Z: true });
    let peak = 0;
    s.run(12, {}, (p) => {
      peak = Math.max(peak, p.pos.y - y0);
    });
    assert.ok(peak > 95 && peak < 125, `rose ${peak}`);
  });

  test('turnaround pivot: A just after the skid still side-flips toward the new direction', () => {
    const s = sim(flat);
    s.run(70, { stickY: 1 });
    s.until(30, { stickY: -1 }, (p) => p.action === 'finish_turnaround');
    s.run(1, { stickY: -1 });
    s.run(1, { stickY: -1, A: true });
    assert.equal(s.p.action, 'sideflip');
    assert.ok(Math.abs(angleDiff(s.p.faceYaw, Math.PI)) < 1e-6, 'faces -Z');
    assert.ok(s.p.vel.z < 0);
  });

  test('skids are much longer on slippery floors', () => {
    const skid = (surface) => {
      const s = sim((b) => b.ground(30000, 0, null, { surface }));
      s.run(70, { stickY: 1 });
      return s.until(80, {}, (p) => p.action === 'idle');
    };
    assert.ok(skid('default') <= 8);
    assert.ok(skid('slippery') >= 18);
    assert.ok(skid('very_slippery') >= 50);
  });
});

describe('water banks', () => {
  test('paddling into a steep bank neither climbs it nor flip-flops in and out', () => {
    for (const deg of [55, 65, 75]) {
      const rise = 700;
      const run = rise / Math.tan(deg * DEG);
      const s = sim((b) => {
        const hole = { x0: -1000, z0: -3000, x1: 1000, z1: -500 };
        b.ground(30000, 0, hole);
        b.floor(-1000, -3000, 1000, -500 - run, -700, { terrain: 'sand' });
        b.slope(-1000, 1000, -500 - run, -500, -700, 0);
        b.quad([-1000, -700, -3000], [1000, -700, -3000], [1000, 0, -3000], [-1000, 0, -3000], [0, 0, 1]);
        b.pools.push({ ...hole, level: -60 });
      }, { x: 0, y: -300, z: -1500, yaw: 0 });
      s.run(1, {});
      assert.ok(s.p.inWater);
      s.run(300, { stickY: 1 }, (p) => {
        assert.ok(p.inWater, `${deg} deg: left the water onto the bank`);
      });
      assert.ok(s.events('splash').length <= 1, `${deg} deg: ${s.events('splash').length} splashes`);
    }
  });
});

// ---------------------------------------------------------------- round 3 review findings

// Octagonal wall-only prism (like the props' trunk and post colliders): vertex radius r.
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

describe('slow wall contacts in the air', () => {
  test('jumping while pushing against a wall never bonks, and grabs a 300 ledge on the way down', () => {
    for (const h of [3000, 300]) {
      const s = sim((b) => {
        flat(b);
        b.box(-3000, 0, 600, 3000, h, 3000, { noBottom: true });
      });
      s.until(200, { stickY: 1 }, (p) => p.anim === 'push' && p.actionTimer > 10);
      s.run(1, { stickY: 1, A: true });
      const seen = new Set();
      s.until(60, { stickY: 1, A: true }, (p) => {
        seen.add(p.action);
        assert.ok(p.forwardVel < 16, `${h}: built up ${p.forwardVel} against the wall`);
        return p.grounded || p.action === 'ledge_hang';
      });
      assert.ok(!s.sfx().includes('bonk'), `${h}: ${[...seen].join()}`);
      assert.ok(!seen.has('air_hit_wall') && !seen.has('soft_bonk'), `${h}: ${[...seen].join()}`);
      assert.equal(s.p.action === 'ledge_hang', h === 300, `${h}: ended in ${s.p.action}`);
    }
  });
});

describe('long jump descent', () => {
  test('falls at half the terminal speed and never takes fall damage', () => {
    for (const h of [1200, 3500]) {
      const s = sim((b) => {
        b.box(-2000, -h, -2000, 2000, 0, 1000, { noBottom: true });
        b.ground(60000, -h);
      });
      s.until(200, { stickY: 1 }, (p) => p.pos.z > 850);
      s.run(1, { stickY: 1, Z: true });
      s.run(1, { stickY: 1, Z: true, A: true });
      assert.equal(s.p.action, 'long_jump');
      let minVy = 0;
      s.until(300, { stickY: 1, A: true }, (p) => {
        minVy = Math.min(minVy, p.vel.y);
        return p.grounded;
      });
      assert.ok(minVy >= -37.5, `fell at ${minVy}`);
      assert.equal(s.p.health, 8, `${h}: lost health`);
      assert.equal(s.p.action, 'land');
    }
  });
});

describe('starting to walk', () => {
  test('snaps to walking speed 8, reaches 32 after ~41 ticks and pumps the legs from the start', () => {
    const s = sim(flat);
    s.run(1, { stickY: 1 });
    assert.ok(s.p.forwardVel >= 8 && s.p.forwardVel < 10, `first tick ${s.p.forwardVel}`);
    s.run(4, { stickY: 1 });
    assert.ok(s.p.cyclePhase > 0.5, `run cycle only at ${s.p.cyclePhase} after 5 ticks`);
    assert.ok(s.p.pos.z > 45, `covered ${s.p.pos.z} in 5 ticks`);
    const t = s.until(60, { stickY: 1 }, (p) => p.forwardVel >= 32);
    assert.ok(t + 5 >= 38 && t + 5 <= 44, `32 after ${t + 5} ticks`);
    const slow = sim(flat);
    slow.run(1, { stickY: 0.4 });
    assert.ok(Math.abs(slow.p.forwardVel - 0.16 * 32) < 0.5, `half stick starts at ${slow.p.forwardVel}`);
    const ice = sim((b) => b.ground(30000, 0, null, { surface: 'very_slippery' }));
    ice.run(1, { stickY: 1 });
    assert.ok(ice.p.forwardVel < 2, `very slippery start ${ice.p.forwardVel}`);
  });

  test('the turnaround pivot runs off at speed 8', () => {
    const s = sim(flat);
    s.run(70, { stickY: 1 });
    s.until(30, { stickY: -1 }, (p) => p.action === 'finish_turnaround');
    assert.ok(s.p.forwardVel >= 8, `pivot at ${s.p.forwardVel}`);
    const z = s.p.pos.z;
    s.run(10, { stickY: -1 });
    assert.ok(z - s.p.pos.z > 90, `ran back ${z - s.p.pos.z} in 10 ticks`);
  });
});

describe('surface swimming', () => {
  const pool = (b) => {
    const hole = { x0: -3000, z0: -6000, x1: 3000, z1: -500 };
    b.ground(30000, 0, hole);
    b.pool({ ...hole, y0: -700, level: -60, bank: 1000 });
  };
  const floating = () => {
    const s = sim(pool, { x: 0, y: -140, z: -3000, yaw: Math.PI });
    s.p.setAction('water_surface');
    s.run(5, {});
    return s;
  };

  test('A strokes along the surface at stroke speed; mashing never leaps out', () => {
    const s = floating();
    s.run(1, { A: true });
    assert.equal(s.p.action, 'swim_stroke');
    const z0 = s.p.pos.z;
    for (let i = 1; i < 90; i++) {
      s.run(1, { A: i % 10 === 0 });
      assert.ok(s.p.inWater && s.p.action !== 'water_jump', `left the water: ${s.p.action}`);
      assert.ok(Math.abs(s.p.pos.y - (-60 - 80)) < 1e-6, `left the surface: y=${s.p.pos.y}`);
    }
    const speed = (z0 - s.p.pos.z) / 89;
    assert.ok(speed > 22, `surface stroke speed ${speed}`);
  });

  test('A with the stick pulled back leaps out; pushed up dives', () => {
    const s = floating();
    s.run(1, { stickY: -1, A: true });
    assert.equal(s.p.action, 'water_jump');
    const d = floating();
    d.run(1, { stickY: 1, A: true });
    assert.equal(d.p.action, 'swim_stroke');
    d.run(10, { stickY: 1 });
    assert.ok(d.p.pos.y < -200, `dived to ${d.p.pos.y}`);
  });
});

describe('wall kick and pole jump heights', () => {
  test('releasing A early cuts a wall kick short', () => {
    const peakAfterKick = (holdA) => {
      const s = sim((b) => {
        flat(b);
        b.box(-2000, 0, 700, 2000, 3000, 900);
      });
      s.run(25, { stickY: 1 });
      s.run(1, { stickY: 1, A: true });
      s.until(40, { stickY: 1, A: true }, (p) => p.action === 'air_hit_wall');
      s.run(1, {});
      s.run(1, { A: true });
      assert.equal(s.p.action, 'wallkick');
      const y0 = s.p.pos.y;
      let peak = 0;
      s.until(60, { A: holdA }, (p) => {
        peak = Math.max(peak, p.pos.y - y0);
        return p.vel.y <= 0;
      });
      return peak;
    };
    const full = peakAfterKick(true);
    const tapped = peakAfterKick(false);
    assert.ok(full > 400, `full kick rose ${full}`);
    assert.ok(tapped < full / 2, `tapped kick rose ${tapped} vs ${full}`);
  });
});

describe('topless wall volumes', () => {
  test('dropping onto a topless slab or post ejects the hero instead of standing inside', () => {
    const slab = (b) => {
      flat(b);
      b.quad([-800, -80, -20], [800, -80, -20], [800, 150, -20], [-800, 150, -20], [0, 0, -1]);
      b.quad([-800, -80, 20], [800, -80, 20], [800, 150, 20], [-800, 150, 20], [0, 0, 1]);
      prism(b, 3000, 0, -80, 305, 45);
    };
    for (const x of [-300, 0, 450]) {
      for (const z of [0, 8, -12]) {
        const s = sim(slab, { x, y: 400, z, yaw: 0 });
        s.p.setAction('freefall');
        s.until(60, {}, (p) => p.grounded);
        assert.ok(Math.abs(s.p.pos.z) >= 20 + 50 - 1e-6, `rests ${s.p.pos.z} from the slab centre`);
        const side = Math.sign(s.p.pos.z);
        s.run(30, { stickY: -side });
        assert.equal(Math.sign(s.p.pos.z), side, 'walked through the slab');
      }
    }
    for (const [dx, dz] of [[0, 0], [20, 0], [0, -25], [-30, 10]]) {
      const s = sim(slab, { x: 3000 + dx, y: 600, z: dz, yaw: 0 });
      s.p.setAction('freefall');
      s.until(60, {}, (p) => p.grounded);
      const d = Math.hypot(s.p.pos.x - 3000, s.p.pos.z);
      assert.ok(d >= 45 * Math.cos(Math.PI / 8) + 50 - 1e-6, `rests ${d} from the post axis`);
      s.run(20, { stickX: 1 });
      assert.ok(s.p.pos.x < 3000 - 90 || Math.hypot(s.p.pos.x - 3000, s.p.pos.z) >= 91, 'walked through the post');
    }
  });
});

describe('crossing thin slabs', () => {
  test('flying at a thin slab while sinking past its top is never pulled through it', () => {
    const slab = (b) => {
      flat(b);
      b.quad([-800, -80, 980], [800, -80, 980], [800, 150, 980], [-800, 150, 980], [0, 0, -1]);
      b.quad([-800, -80, 1020], [800, -80, 1020], [800, 150, 1020], [-800, 150, 1020], [0, 0, 1]);
    };
    for (const speed of [20, 32, 45]) {
      for (let y = 140; y <= 260; y += 4) {
        const s = sim(slab, { x: 0, y, z: 1080, yaw: Math.PI });
        s.p.setAction('dive');
        s.p.forwardVel = speed;
        s.p.vel.y = -20;
        s.run(30, {}, (p) => {
          // Sinking onto the slab's edge ejects the body through the nearer face: a correction
          // of at most its radius + half the slab. Being pulled through the whole slab is more.
          const step = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
          assert.ok(step <= speed + 50 + 20 + 1, `speed ${speed} from y ${y}: moved ${step} in a tick`);
        });
        const { pos } = s.p;
        assert.ok(pos.z >= 1020 || pos.z <= 980 || pos.y > 150, `rests inside the slab at z=${pos.z}`);
      }
    }
  });
});

describe('trees with trunk colliders', () => {
  test('running jumps at a pole wrapped in a trunk prism grab it from every direction', () => {
    const tree = (b) => {
      flat(b);
      prism(b, 0, 0, -100, 350, 45);
      b.pole(0, 0, 0, 600, 40);
    };
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI + 0.1;
      const x = Math.sin(a) * 300;
      const z = Math.cos(a) * 300;
      const yaw = Math.atan2(-x, -z);
      const r = sim(tree, { x, y: 0, z, yaw });
      const acts = new Set();
      for (let t = 0; t < 60 && r.p.action !== 'pole'; t++) {
        const d = Math.hypot(r.p.pos.x, r.p.pos.z);
        r.run(1, toward(yaw, { A: d < 230 && d > 150 }));
        acts.add(r.p.action);
      }
      assert.equal(r.p.action, 'pole', `direction ${k}: ${[...acts].join()}`);
      assert.ok(!acts.has('air_hit_wall') && !acts.has('soft_bonk'), `direction ${k}: ${[...acts].join()}`);
    }
  });
});

describe('presses on the touchdown tick', () => {
  // Takes off with `jump` (a list of ticks' inputs), then presses `press` on the tick the hero
  // lands (found with a dry run). Returns the action right after.
  const pressOnTouchdown = (jump, press) => {
    const start = () => {
      const s = sim(flat);
      s.run(40, { stickY: 1 });
      for (const input of jump) s.run(1, input);
      return s;
    };
    const n = start().until(100, { stickY: 1 }, (p) => p.grounded);
    const s = start();
    s.run(n, { stickY: 1 });
    assert.ok(!s.p.grounded, 'still airborne one tick before landing');
    s.run(1, { stickY: 1, ...press });
    return s.p.action;
  };

  test('A pressed exactly as the hero lands chains the double jump', () => {
    assert.equal(pressOnTouchdown([{ stickY: 1, A: true }], { A: true }), 'double_jump');
  });

  test('B or Z pressed as a long jump lands punches or starts the next crouch slide', () => {
    const longJump = [{ stickY: 1, Z: true }, { stickY: 1, Z: true, A: true }];
    assert.equal(pressOnTouchdown(longJump, { B: true }), 'punch');
    assert.equal(pressOnTouchdown(longJump, { Z: true }), 'crouch_slide');
  });
});

describe('one-sided ceilings', () => {
  test('dropping through a sloped ceiling into a low gap never leaves the hero stuck', () => {
    const wedge = (b) => {
      flat(b);
      b.quad([-500, 400, -1000], [500, 400, -1000], [500, 100, 0], [-500, 100, 0], [0, -1, 0]);
    };
    const s = sim(wedge, { x: 0, y: 125, z: -25, yaw: Math.PI });
    s.p.setAction('freefall');
    s.until(30, {}, (p) => p.grounded);
    assert.ok(s.p.pos.y >= 0, `fell through the floor to ${s.p.pos.y}`);
    // Toward the high end of the ceiling (-Z) the gap opens up: he can always walk out.
    s.run(60, { stickY: -1 });
    const room = s.world.findCeil(s.p.pos.x, s.p.pos.y + 80, s.p.pos.z).y - s.p.pos.y;
    assert.ok(room >= 160, `still squeezed (headroom ${room}) at z=${s.p.pos.z}`);
    // From open ground he can't walk into the low part.
    s.run(60, { stickY: 1 }, (p) => {
      const r = s.world.findCeil(p.pos.x, p.pos.y + 80, p.pos.z).y - p.pos.y;
      assert.ok(r >= 160, `walked under a ${r} ceiling`);
    });
  });
});

describe('belly slide escapes', () => {
  test('pinned against a wall at the bottom of a steep chute, A jumps out', () => {
    const chute = (b) => {
      b.ground(6000);
      b.box(-1000, 0, -400, 1000, 600, 0, { noBottom: true });
      b.ramp(-600, 600, 0, 800, 100, 900);
      b.box(-900, 0, 0, -600, 1400, 1600, { noBottom: true });
      b.box(600, 0, 0, 900, 1400, 1600, { noBottom: true });
    };
    const s = sim(chute, { x: 0, y: 1100, z: 500, yaw: Math.PI });
    s.p.setAction('dive');
    s.run(40, {});
    assert.equal(s.p.action, 'belly_slide');
    s.run(1, { A: true });
    assert.equal(s.p.action, 'jump');
  });
});

describe('bad input', () => {
  test('a non-finite camera yaw or stick value never poisons the state', () => {
    const s = sim(flat);
    s.run(20, { stickY: 1 });
    s.p.update({ ...s.p.input, stickX: 0, stickY: 1, stickMag: 1 }, NaN);
    s.p.update({ ...s.p.input, stickX: NaN, stickY: 5, stickMag: Infinity }, 0);
    const { pos, vel } = s.p;
    assert.ok(Number.isFinite(pos.x + pos.z + vel.x + vel.z + s.p.faceYaw + s.p.forwardVel));
    s.run(30, { stickY: 1 });
    s.run(1, { stickY: 1, A: true });
    assert.equal(s.p.action, 'jump');
    s.run(10, { stickY: 1, A: true });
    assert.ok(s.p.pos.y > 100, 'jumps normally afterwards');
  });
});
