// Synthetic collision courses and a scripted controller for the player-physics tests and
// the physics preview page (/preview.html?m=physics). Not used by the game itself.

import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { NO_WATER } from '../../core/constants.js';
import { Events } from '../../core/events.js';
import { Player } from '../Player.js';

const BUTTONS = ['A', 'B', 'Z', 'R', 'START', 'CU', 'CD', 'CL', 'CR'];
const PLAYER_EVENTS = ['sfx', 'land', 'footstep', 'splash', 'hurt', 'lifeLost', 'signRead', 'wingHat'];

// The documented AnimName values (docs/ARCHITECTURE.md), for contract checks. Round 3 adds
// pole_handstand (the handstand on a pole's tip, pos = the tip) and burn (the hot-foot hop);
// round 5 adds fly (the winged-hat flight, action 'flying').
export const ANIM_NAMES = new Set(
  `idle sleep walk run tiptoe skid turnaround push crouch crawl crouch_slide jump fall land double_jump
  triple_jump backflip sideflip long_jump dive belly_slide butt_slide ground_pound_spin ground_pound_fall
  ground_pound_land wallkick bonk hurt fall_damage ledge_hang ledge_climb pole_hold pole_climb pole_jump
  pole_handstand punch1 punch2 kick jump_kick swim_idle swim_stroke swim_flutter water_surface water_jump
  star_dance spawn death burn fly`.split(/\s+/),
);
const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Collects collider triangles (auto-wound to face a given direction), poles and water
// rectangles, then builds a finalized CollisionWorld.
export class CourseBuilder {
  constructor() {
    this.tris = []; // { positions: number[9], surface, terrain }
    this.poles = [];
    this.pools = []; // { x0, z0, x1, z1, level }
  }

  tri(a, b, c, facing, { surface = 'default', terrain = 'grass' } = {}) {
    const n = cross(sub(b, a), sub(c, a));
    const flip = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0;
    this.tris.push({ positions: flip ? [...a, ...c, ...b] : [...a, ...b, ...c], surface, terrain });
    return this;
  }

  quad(a, b, c, d, facing, opts) {
    this.tri(a, b, c, facing, opts);
    return this.tri(a, c, d, facing, opts);
  }

  floor(x0, z0, x1, z1, y, opts) {
    return this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], UP, opts);
  }

  // Solid axis-aligned box with outward-facing walls, a floor on top and a ceiling below.
  box(x0, y0, z0, x1, y1, z1, opts = {}) {
    this.floor(x0, z0, x1, z1, y1, opts);
    if (!opts.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], DOWN, opts);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], opts);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], opts);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], opts);
    return this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], opts);
  }

  // Sloped floor over x in [x0, x1], rising from y0 at z0 to y1 at z1 (no sides).
  slope(x0, x1, z0, z1, y0, y1, opts) {
    return this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], UP, opts);
  }

  // Solid wedge standing on y0: sloped top plus side and back walls.
  ramp(x0, x1, z0, z1, y0, y1, opts) {
    this.slope(x0, x1, z0, z1, y0, y1, opts);
    this.tri([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], opts);
    this.tri([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [1, 0, 0], opts);
    const back = z1 > z0 ? 1 : -1;
    return this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, back], opts);
  }

  // Ground plane of half-size `half` at height y with an optional rectangular hole.
  ground(half, y = 0, hole = null, opts) {
    if (!hole) return this.floor(-half, -half, half, half, y, opts);
    const { x0, z0, x1, z1 } = hole;
    this.floor(-half, -half, half, z0, y, opts);
    this.floor(-half, z1, half, half, y, opts);
    this.floor(-half, z0, x0, z1, y, opts);
    return this.floor(x1, z0, half, z1, y, opts);
  }

  // Pit under a ground hole: floor at y0 with walls, a walkable bank rising to groundY at
  // z1, and water up to `level`.
  pool({ x0, z0, x1, z1, y0, groundY = 0, bank = 900, level }) {
    const zb = z1 - bank;
    this.floor(x0, z0, x1, zb, y0, { terrain: 'sand' });
    this.slope(x0, x1, zb, z1, y0, groundY, { terrain: 'sand' });
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, groundY, z1], [x0, groundY, z0], [1, 0, 0], { terrain: 'stone' });
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, groundY, z1], [x1, groundY, z0], [-1, 0, 0], { terrain: 'stone' });
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, groundY, z0], [x0, groundY, z0], [0, 0, 1], { terrain: 'stone' });
    this.pools.push({ x0, z0, x1, z1, level });
    return this;
  }

  // Wooden signpost at (x, z) standing on y whose board faces `yaw` (like layout.SIGNS):
  // a post and a thin board, both solid. Returns the sign record for Player({ signs }).
  sign(x, z, yaw, y = 0, pages = ['Test sign']) {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const post = 9;
    this.box(x - post, y, z - post, x + post, y + 110, z + post, { noBottom: true, terrain: 'wood' });
    // The board: 120 wide, 8 thick; axis-aligned boxes only, so snap it to the nearer axis.
    const alongX = Math.abs(c) >= Math.abs(s);
    const hw = alongX ? 60 : 4;
    const hd = alongX ? 4 : 60;
    this.box(x - hw, y + 110, z - hd, x + hw, y + 180, z + hd, { terrain: 'wood' });
    return { id: `sign-${x}-${z}`, x, z, y, yaw, pages };
  }

  pole(x, z, y0, y1, radius = 30) {
    this.poles.push({ x, z, y0, y1, radius });
    return this;
  }

  waterLevelAt(x, z) {
    for (const w of this.pools) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w.level;
    return NO_WATER;
  }

  build() {
    const world = new CollisionWorld();
    for (const t of this.tris) world.addTriangles(t.positions, { surface: t.surface, terrain: t.terrain });
    for (const p of this.poles) world.addPole(p);
    world.setWaterLevelFn((x, z) => this.waterLevelAt(x, z));
    world.finalize();
    return world;
  }
}

// The preview's obstacle course. Spawn at the origin facing +Z.
//   +Z: 20 deg and 45 deg ramps, stairs   +X: ledge platform, tall wall, pole
//   -Z: swimming pool with a sloped bank   -X: slippery slope, low ceiling tunnel
//   a readable sign ahead-left of the spawn, its face toward the spawn (`signs`)
export function buildTestCourse() {
  const c = new CourseBuilder();
  const pool = { x0: -900, z0: -4200, x1: 900, z1: -1500 };
  c.ground(10000, 0, pool);
  c.pool({ ...pool, y0: -700, level: -60, bank: 1000 });
  const rise20 = Math.tan((20 * Math.PI) / 180) * 1200;
  const rise45 = 1000;
  c.ramp(-900, -300, 1500, 2700, 0, rise20);
  c.box(-900, 0, 2700, -300, rise20, 3300, { noBottom: true });
  c.ramp(300, 900, 1500, 2500, 0, rise45);
  c.box(300, 0, 2500, 900, rise45, 3100, { noBottom: true, terrain: 'stone' });
  for (let i = 0; i < 4; i++) {
    c.box(1400, 0, 1500 + i * 150, 2000, 25 * (i + 1), 1650 + i * 150, { noBottom: true, terrain: 'stone' });
  }
  c.box(1400, 0, 2100, 2000, 100, 2500, { noBottom: true, terrain: 'stone' });
  c.box(2400, 0, -600, 3400, 400, 600, { noBottom: true, terrain: 'stone' });
  c.box(4200, 0, -1500, 4400, 1400, 1500, { noBottom: true, terrain: 'stone' });
  c.box(3600, 0, -1500, 3700, 1400, 1500, { noBottom: true, terrain: 'stone' });
  c.pole(2000, -1500, 0, 900, 30);
  c.slope(-3400, -2400, 600, -1400, 0, 700, { surface: 'very_slippery', terrain: 'stone' });
  c.box(-3400, 0, -2000, -2400, 700, -1400, { noBottom: true });
  c.box(-2200, 200, 1000, -1400, 400, 2400, { terrain: 'wood' });
  const signs = [
    c.sign(-500, 700, Math.PI, 0, ['Test course', 'Walk up to a sign, face it and press B to read it.']),
  ];
  return { builder: c, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, signs };
}

// Produces controller snapshots (same shape as core/input.js poll()) from plain states like
// { stickX, stickY, A: true }, with pressed / released edges tracked across calls.
export class ScriptedController {
  constructor() {
    this.prev = Object.fromEntries(BUTTONS.map((b) => [b, false]));
  }

  next(state = {}) {
    let sx = state.stickX ?? 0;
    let sy = state.stickY ?? 0;
    let mag = Math.hypot(sx, sy);
    if (mag > 1) {
      sx /= mag;
      sy /= mag;
      mag = 1;
    }
    // rawStickMag (optional): a keyboard stick's full push while stickX/Y are eased in.
    const out = { stickX: sx, stickY: sy, stickMag: mag, rawStickMag: Math.max(mag, state.rawStickMag ?? mag), mouseDX: 0, mouseDY: 0 };
    for (const b of BUTTONS) {
      const down = !!state[b];
      out[b] = { down, pressed: down && !this.prev[b], released: !down && this.prev[b] };
      this.prev[b] = down;
    }
    return out;
  }
}

// Headless driver for tests and tools: a Player on a course made by build(CourseBuilder),
// with its events logged ({ event, tick, ...payload }). Every tick is checked for contract
// violations (undocumented anim, non-finite state), which throw. The course has no readable
// signs unless build() returns them (an array of CourseBuilder.sign() records).
//   run(n, input, each)  advances up to n ticks holding `input` (camera yaw 0: stick up = +Z);
//                        each(p, i) returning false stops early. Returns the ticks run.
//   until(n, input, pred) runs until pred(p) holds (or n ticks).
export function createSim(build, spawn = { x: 0, y: 0, z: 0, yaw: 0 }) {
  const builder = new CourseBuilder();
  const built = build(builder);
  const signs = Array.isArray(built) ? built : [];
  const world = builder.build();
  const events = new Events();
  const log = [];
  let p = null;
  for (const name of PLAYER_EVENTS) events.on(name, (e) => log.push({ event: name, tick: p.tick, ...e }));
  p = new Player({ collision: world, events, spawn, signs });
  const ctl = new ScriptedController();
  const sim = {
    p,
    world,
    log,
    run(n, input = {}, each) {
      for (let i = 0; i < n; i++) {
        p.update(ctl.next(input), 0);
        checkContract(p);
        if (each && each(p, i) === false) return i;
      }
      return n;
    },
    until(n, input, pred) {
      return sim.run(n, input, (pp) => !pred(pp));
    },
    events: (name) => log.filter((e) => e.event === name),
    sfx: () => sim.events('sfx').map((e) => e.name),
  };
  return sim;
}

function checkContract(p) {
  const rs = p.getRenderState(1);
  if (!ANIM_NAMES.has(rs.anim)) throw new Error(`undocumented anim ${rs.anim} in ${p.action}`);
  const { pos, vel } = p;
  if (!Number.isFinite(pos.x + pos.y + pos.z + vel.x + vel.y + vel.z + p.forwardVel + p.faceYaw)) {
    throw new Error(`non-finite player state in ${p.action}`);
  }
}
