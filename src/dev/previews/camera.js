// Camera preview: a test room (flat ground, a tall wall, a back wall, a pillar, a thin plank,
// a thin post, a low wall, a pool with a pier, a stand-in castle block with a corner tower
// standing out at its front-left corner, and a 25 deg ramp up to a plateau that ends in a sheer
// drop into a water pit) plus a scripted fake hero that exercises the follow camera.
//
// URL params:
//   s=<scenario>   circle | toward | jump | wall | pillar | swim | ledge | plank | post |
//                  lowwall | pier | tower | fp | buttons | mouse | intro | title | play |
//                  fly (winged-hat flight: take-off, glide, banked turns by the castle block
//                  and the pillar, a dive into the ground and the hand-back) |
//                  facade (flight: a hard turn away from the block's front below its roof) |
//                  airace (AI RACE mode: the look-up at a stand-in beast on the castle block)
//   t=<seconds>    simulate up to that time and freeze
//   strip=a,b,...  render the listed moments (seconds) as a grid plus a top-down trail map
//   map=0          hide the live mini-map
// 'play' drives the hero with the keyboard (WASD, Space jump, arrows = C buttons, C = R).

import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { CameraController } from '../../camera/CameraController.js';
import { NO_WATER } from '../../core/constants.js';
import { Input, neutralController } from '../../core/input.js';
import { Events } from '../../core/events.js';
import { approach, approachAngle, stickToWorldYaw } from '../../core/math.js';
import { canvasTexture } from '../../render/texgen.js';
import * as layout from '../../world/layout.js';

const TICK = 1 / 30;
const WATER_Y = -60;
const POOL = { x0: -4600, x1: -2400, z0: 1000, z1: 5000, floor: -900 };
// East course: ramp (y 0 -> 700) from z1 to rampTop, plateau to z0, then a pit (water WATER_Y).
const LEDGE = { x0: 4000, x1: 7000, z1: 7000, rampTop: 5500, z0: 3000, top: 700, pitZ: 500, pitFloor: -800 };
const PLANK = { x0: 1800, x1: 1840, z0: 6700, z1: 7500, height: 1500 };
const POST = { x: -6000, z: 3000, radius: 45, height: 900 }; // tree-trunk sized
const LOW_WALL = { x0: -7400, x1: -5400, z0: 5200, z1: 5230, height: 200 }; // parapet
// Corner tower standing out west of and in front of the castle block's front-left corner: a
// camera swung round behind it lands in the notch against the block's side wall.
const TOWER = { x0: -layout.CASTLE.halfWidth - 350, x1: -layout.CASTLE.halfWidth + 350, z0: layout.CASTLE.frontZ - 350, z1: layout.CASTLE.frontZ + 350, height: 2400 };
const PIER = { x0: -4200, x1: -4000, z0: 4400, z1: 4600, top: 200 }; // in the pool
const EXTENT = 8000;
const MAP_LAYER = 1;

// ---------------------------------------------------------------- scenarios
// Segments run in order: { ticks, stick:[x,y], goto:[[x,z]...], jump:vy, dive:depth, press:{CL..},
// mouse:[dx,dy], sweep:[amplitude, periodTicks] (sinusoidal mouse x), hold (hero frozen),
// fly:{ speed, pitch, bank } (winged-hat flight; pitch > 0 nose down, bank > 0 turns right; it
// ends on touching the ground), dark:true|false (emits 'darkMode' on the segment's first tick) }.
const SCENARIOS = {
  circle: { start: [-600, 4000, Math.PI], segs: [{ ticks: 15 }, { ticks: 330, stick: [1, 0.15] }] },
  toward: { start: [0, 3000, Math.PI], segs: [{ ticks: 15 }, { ticks: 170, stick: [0, -1] }] },
  jump: {
    start: [0, 3000, Math.PI],
    segs: [{ ticks: 15 }, { ticks: 1, jump: 42 }, { ticks: 35 }, { ticks: 1, jump: 72 }, { ticks: 50 }, { ticks: 30, stick: [0, 1] }, { ticks: 1, stick: [0, 1], jump: 60 }, { ticks: 40, stick: [0, 1] }],
  },
  wall: { start: [1900, 5000, Math.PI], segs: [{ ticks: 10 }, { ticks: 400, goto: [[2100, -250], [3300, -250], [3300, 4500]] }] },
  pillar: { start: [-600, 3600, Math.PI], segs: [{ ticks: 10 }, { ticks: 400, goto: [[-100, 2800], [-100, 1300], [-1100, 1300], [-1100, 2800], [-600, 3600]] }] },
  swim: {
    start: [-1500, 3000, -Math.PI / 2],
    segs: [{ ticks: 10 }, { ticks: 90, goto: [[-3200, 3000]] }, { ticks: 60, dive: 450, goto: [[-4000, 3000]] }, { ticks: 60, dive: 450, goto: [[-4000, 2000], [-3000, 1800]] }, { ticks: 80, goto: [[-3000, 4000]] }],
  },
  buttons: {
    start: [0, 3000, Math.PI],
    segs: [
      { ticks: 20 }, { ticks: 25, press: { CL: true } }, { ticks: 25, press: { CL: true } }, { ticks: 25, press: { CR: true } },
      { ticks: 35, press: { CD: true } }, { ticks: 35, press: { CU: true } }, { ticks: 25, press: { CU: true } },
      { ticks: 30, stick: [1, 0] }, { ticks: 20, stick: [0, 1] }, { ticks: 30, press: { CD: true } },
      { ticks: 30, press: { R: true } }, { ticks: 60, stick: [0.8, 0.6] }, { ticks: 30, press: { R: true } },
    ],
  },
  ledge: { start: [5500, 7600, Math.PI], segs: [{ ticks: 10 }, { ticks: 180, stick: [0, 1] }, { ticks: 90 }] },
  // The orbit sweeps back and forth across the yaw at which the view ray grazes the plank.
  plank: { start: [PLANK.x0 - 300, PLANK.z0 - 200, Math.PI + 0.21], segs: [{ ticks: 10 }, { ticks: 450, sweep: [-0.61, 150] }] },
  mouse: { start: [0, 3000, Math.PI], segs: [{ ticks: 10 }, { ticks: 40, mouse: [12, 0] }, { ticks: 20, mouse: [0, 10] }, { ticks: 20, mouse: [0, -14] }, { ticks: 30 }] },
  // Walks past a trunk-sized post 120 in front of the camera: it passes in front, no pull-in.
  post: { start: [POST.x - 700, POST.z - 120, Math.PI], segs: [{ ticks: 10 }, { ticks: 140, goto: [[POST.x + 700, POST.z - 120]] }] },
  // Orbit dragged round behind a parapet right beside the hero: the view tilts over it.
  lowwall: {
    start: [-6400, LOW_WALL.z0 - 150, -Math.PI / 2],
    segs: [{ ticks: 10 }, { ticks: 30, mouse: [(Math.PI / 2) / 0.006 / 30, 0] }, { ticks: 50 }, { ticks: 120, goto: [[-5700, LOW_WALL.z0 - 120]] }],
  },
  // Dives and swims a loop round the pier.
  pier: {
    start: [-3600, 3600, -Math.PI / 2],
    segs: [{ ticks: 10 }, { ticks: 60, dive: 450, goto: [[-4100, 4250]] }, { ticks: 240, dive: 450, goto: [[-3850, 4500], [-4100, 4750], [-4350, 4500], [-4100, 4250], [-3850, 4500]] }],
  },
  // In front of the castle block, facing the corner tower, zoomed out: C-left (round behind the
  // tower) is refused with a buzz; a mouse drag there anyway leaves the camera trapped in the
  // notch, and it swings back to a clear view.
  tower: {
    start: [-1155, -228, Math.PI / 2],
    segs: [{ ticks: 10 }, { ticks: 70, press: { CD: true } }, { ticks: 30, press: { CL: true } }, { ticks: 6, mouse: [(Math.PI / 4) / 0.006 / 6, 0] }, { ticks: 90 }],
  },
  // First-person look: the stick turns the view while the hero stands still, B leaves it.
  fp: { start: [0, 3000, Math.PI], segs: [{ ticks: 10 }, { ticks: 30, press: { CU: true } }, { ticks: 40, stick: [0.7, 0.25] }, { ticks: 40, press: { B: true } }] },
  intro: { start: [layout.SPAWN.x, layout.SPAWN.z, layout.SPAWN.yaw], dropFrom: 1400, intro: true, segs: [{ ticks: 45, hold: true }, { ticks: 150 }] },
  title: { start: [layout.SPAWN.x, layout.SPAWN.z, layout.SPAWN.yaw], title: true, segs: [{ ticks: 3600 }] },
  // Take off, climb, glide toward the castle block, bank left then round to the right past the
  // pillar (it passes between the camera and the hero), dive into the ground (a belly slide) and
  // stand while the camera hands back to the follow camera.
  fly: {
    start: [1400, 5900, Math.PI],
    segs: [
      { ticks: 15 }, { ticks: 30, fly: { speed: 40, pitch: -0.6 } }, { ticks: 25, fly: { speed: 45, pitch: 0.02 } },
      { ticks: 40, fly: { speed: 45, pitch: 0.02, bank: -0.75 } }, { ticks: 80, fly: { speed: 45, pitch: 0.02, bank: 0.75 } },
      { ticks: 20, fly: { speed: 45, pitch: 0.05 } }, { ticks: 50, fly: { speed: 55, pitch: 0.8 } }, { ticks: 60 },
    ],
  },
  // Fly at the castle block's front below its roof, bank hard left 900 in front of it and on round
  // (the camera must not be swung into the facade: it keeps beside him in the open until it has
  // room behind him again), then straight on.
  facade: {
    start: [0, 3600, Math.PI],
    segs: [
      { ticks: 10 }, { ticks: 25, fly: { speed: 40, pitch: -0.6 } }, { ticks: 62, fly: { speed: 40, pitch: 0.02 } },
      { ticks: 110, fly: { speed: 36, pitch: 0.02, bank: -0.75 } }, { ticks: 40, fly: { speed: 40, pitch: 0.02 } },
    ],
  },
  // AI RACE mode switched on in front of the castle block (the stand-in beast on its roof rises):
  // the view tilts up; running away down the lawn and turning round eases it out, coming back in.
  airace: {
    start: [900, 2600, Math.PI],
    beast: true,
    segs: [
      { ticks: 30 }, { ticks: 120, dark: true }, { ticks: 150, goto: [[900, 6500]] }, { ticks: 190, goto: [[900, 2400]] },
      { ticks: 60 }, { ticks: 90, dark: false },
    ],
  },
  play: { start: [0, 3000, Math.PI], segs: [] },
};

// Resolves the controller + hero command for a tick of a scenario.
function scriptAt(scn, tick) {
  let t = tick;
  for (const seg of scn.segs) {
    if (t < seg.ticks) {
      const c = neutralController();
      if (seg.stick) [c.stickX, c.stickY] = seg.stick;
      c.stickMag = Math.min(1, Math.hypot(c.stickX, c.stickY));
      if (seg.mouse) [c.mouseDX, c.mouseDY] = seg.mouse;
      if (seg.sweep) c.mouseDX = seg.sweep[0] * Math.sin((2 * Math.PI * t) / seg.sweep[1]);
      if (t === 0) for (const b of Object.keys(seg.press || {})) c[b] = { down: true, pressed: true, released: false };
      return { c, goto: seg.goto, jump: t === 0 ? seg.jump : 0, dive: seg.dive || 0, hold: seg.hold, fly: seg.fly, dark: t === 0 ? seg.dark : undefined };
    }
    t -= seg.ticks;
  }
  return { c: neutralController(), done: true };
}

// ---------------------------------------------------------------- fake hero
// Just enough movement to drive the camera: stick-relative or waypoint running, jumps,
// wall pushes, floors, and swimming at/below the pool surface.
class FakeHero {
  constructor(collision, x, z, yaw, y = 0) {
    this.collision = collision;
    this.pos = { x, y, z };
    this.prev = { ...this.pos };
    this.vel = { x: 0, y: 0, z: 0 };
    this.forwardVel = 0;
    this.faceYaw = yaw;
    this.pitch = 0; // flight attitude (pitch > 0 nose down, roll > 0 right side down)
    this.roll = 0;
    this.action = 'idle';
    this.inWater = false;
    this.floor = collision.findFloor(x, y + 100, z);
    this.waypoint = 0;
  }

  step({ c, goto, jump = 0, dive = 0, hold = false, fly = null }, camYaw) {
    const col = this.collision;
    const p = this.pos;
    this.prev = { ...p };
    if (hold) return;
    if (fly && this.action !== 'belly_slide') {
      this.flyStep(fly);
      return;
    }
    this.pitch = this.roll = 0;
    if (this.action === 'flying') this.action = 'fall'; // the flight ended in the air
    let want = null;
    let mag = 0;
    if (goto) {
      const wp = goto[Math.min(this.waypoint, goto.length - 1)];
      const d = Math.hypot(wp[0] - p.x, wp[1] - p.z);
      if (d < 120 && this.waypoint < goto.length - 1) this.waypoint++;
      if (d > 40) {
        want = Math.atan2(wp[0] - p.x, wp[1] - p.z);
        mag = Math.min(1, d / 300);
      }
    } else {
      this.waypoint = 0;
      if (c.stickMag > 0.1) {
        want = stickToWorldYaw(c.stickX, c.stickY, camYaw);
        mag = c.stickMag;
      }
    }
    const grounded = p.y <= this.floor.y + 1;
    const top = this.inWater ? 16 : 32;
    if (want !== null) {
      this.faceYaw = approachAngle(this.faceYaw, want, grounded || this.inWater ? 0.22 : 0.06);
      this.forwardVel = approach(this.forwardVel, top * mag, 2.5, 4);
    } else this.forwardVel = approach(this.forwardVel, 0, 4);
    p.x += Math.sin(this.faceYaw) * this.forwardVel;
    p.z += Math.cos(this.faceYaw) * this.forwardVel;
    const w = col.findWalls(p.x, p.y, p.z, 60, 50);
    p.x = w.x;
    p.z = w.z;

    this.floor = col.findFloor(p.x, p.y + 100, p.z);
    const water = col.waterLevelAt(p.x, p.z);
    this.inWater = water !== NO_WATER && p.y < water - 40;
    if (this.inWater) {
      const goal = Math.max(this.floor.y + 20, water - 80 - dive);
      this.vel.y = approach(0, goal - p.y, 10, 10);
      p.y += this.vel.y;
      this.action = dive ? 'swim_dive' : 'swim';
    } else {
      if (jump && grounded) this.vel.y = jump;
      this.vel.y = Math.max(this.vel.y - 4, -75);
      p.y += this.vel.y;
      if (p.y <= this.floor.y) {
        p.y = this.floor.y;
        this.vel.y = 0;
      }
      this.action = p.y > this.floor.y + 1 ? 'jump' : this.forwardVel > 1 ? 'run' : 'idle';
    }
    this.vel.x = Math.sin(this.faceYaw) * this.forwardVel;
    this.vel.z = Math.cos(this.faceYaw) * this.forwardVel;
  }

  // Winged-hat flight, like the Player's (air speed along heading and pitch, the bank turns the
  // heading); touching the ground ends it in a belly slide.
  flyStep({ speed = 40, pitch = 0.1, bank = 0 }) {
    const p = this.pos;
    if (this.action !== 'flying') {
      this.action = 'flying';
      this.pitch = pitch;
      this.roll = 0;
    }
    this.pitch = approach(this.pitch, pitch, 0.08);
    this.roll = approach(this.roll, bank, 0.07);
    this.faceYaw -= this.roll * 0.08;
    this.forwardVel = speed * Math.cos(this.pitch);
    this.vel.x = Math.sin(this.faceYaw) * this.forwardVel;
    this.vel.z = Math.cos(this.faceYaw) * this.forwardVel;
    this.vel.y = -speed * Math.sin(this.pitch);
    p.x += this.vel.x;
    p.y += this.vel.y;
    p.z += this.vel.z;
    this.floor = this.collision.findFloor(p.x, p.y + 100, p.z);
    if (p.y <= this.floor.y) {
      p.y = this.floor.y;
      this.vel.y = 0;
      this.action = 'belly_slide';
    }
  }
}

// ---------------------------------------------------------------- room

function checker(THREE, a, b) {
  const tex = canvasTexture(32, 32, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, w / 2, h / 2);
    ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// Two CCW triangles as seen from the side the face points to.
function quad(a, b, c, d) {
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

// Non-indexed geometry with world-planar UVs (1 checker = 400 units) from a triangle list.
function planarMesh(THREE, positions, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const uv = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.push(x / 400, z / 400);
    else if (ax >= az) uv.push(z / 400, y / 400);
    else uv.push(x / 400, y / 400);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return new THREE.Mesh(geo, material);
}

// Axis-aligned box (outward faces, no bottom) as a triangle list.
function box(x0, x1, y0, y1, z0, z1) {
  return [
    ...quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]),
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]),
    ...quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]),
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
  ];
}

function floorRect(x0, x1, z0, z1, y) {
  return quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}

// Ramp + plateau + pit of the east course (floors, the drop face and the side walls).
function ledgeCourse() {
  const L = LEDGE;
  const pitWall = (a, b) => quad([a[0], L.pitFloor, a[1]], [b[0], L.pitFloor, b[1]], [b[0], 0, b[1]], [a[0], 0, a[1]]);
  // Side faces follow the ramp profile: quad under the plateau, triangle under the ramp.
  const side = (x, facingPlusX) =>
    facingPlusX
      ? [x, 0, L.z1, x, 0, L.rampTop, x, L.top, L.rampTop, ...quad([x, 0, L.rampTop], [x, 0, L.z0], [x, L.top, L.z0], [x, L.top, L.rampTop])]
      : [x, 0, L.rampTop, x, 0, L.z1, x, L.top, L.rampTop, ...quad([x, 0, L.z0], [x, 0, L.rampTop], [x, L.top, L.rampTop], [x, L.top, L.z0])];
  return [
    ...quad([L.x0, 0, L.z1], [L.x1, 0, L.z1], [L.x1, L.top, L.rampTop], [L.x0, L.top, L.rampTop]), // ramp
    ...floorRect(L.x0, L.x1, L.z0, L.rampTop, L.top), // plateau
    ...floorRect(L.x0, L.x1, L.pitZ, L.z0, L.pitFloor), // pit bed
    ...quad([L.x1, L.pitFloor, L.z0], [L.x0, L.pitFloor, L.z0], [L.x0, L.top, L.z0], [L.x1, L.top, L.z0]), // drop face (-z)
    ...pitWall([L.x0, L.pitZ], [L.x1, L.pitZ]), // faces +z
    ...pitWall([L.x0, L.z0], [L.x0, L.pitZ]), // faces +x
    ...pitWall([L.x1, L.pitZ], [L.x1, L.z0]), // faces -x
    ...side(L.x0, false),
    ...side(L.x1, true),
  ];
}

function buildRoom(THREE) {
  const group = new THREE.Group();
  const grass = new THREE.MeshLambertMaterial({ map: checker(THREE, '#5aa845', '#4b9639') });
  const stone = new THREE.MeshLambertMaterial({ map: checker(THREE, '#c9bfa6', '#b3a78c') });
  const tile = new THREE.MeshLambertMaterial({ map: checker(THREE, '#6f8fa8', '#5d7d96') });
  const E = EXTENT;
  const P = POOL;
  const C = layout.CASTLE;

  const L = LEDGE;
  const ground = [
    ...floorRect(-E, P.x0, -E, E, 0),
    ...floorRect(P.x1, L.x0, -E, E, 0),
    ...floorRect(L.x1, E, -E, E, 0),
    ...floorRect(L.x0, L.x1, -E, L.pitZ, 0),
    ...floorRect(L.x0, L.x1, L.z1, E, 0),
    ...floorRect(P.x0, P.x1, -E, P.z0, 0),
    ...floorRect(P.x0, P.x1, P.z1, E, 0),
  ];
  const pool = [
    ...floorRect(P.x0, P.x1, P.z0, P.z1, P.floor),
    ...quad([P.x0, P.floor, P.z1], [P.x0, P.floor, P.z0], [P.x0, 0, P.z0], [P.x0, 0, P.z1]), // faces +x
    ...quad([P.x1, P.floor, P.z0], [P.x1, P.floor, P.z1], [P.x1, 0, P.z1], [P.x1, 0, P.z0]), // faces -x
    ...quad([P.x0, P.floor, P.z0], [P.x1, P.floor, P.z0], [P.x1, 0, P.z0], [P.x0, 0, P.z0]), // faces +z
    ...quad([P.x1, P.floor, P.z1], [P.x0, P.floor, P.z1], [P.x0, 0, P.z1], [P.x1, 0, P.z1]), // faces -z
  ];
  const walls = [
    ...box(LOW_WALL.x0, LOW_WALL.x1, 0, LOW_WALL.height, LOW_WALL.z0, LOW_WALL.z1),
    ...box(PIER.x0, PIER.x1, P.floor, PIER.top, PIER.z0, PIER.z1),
    ...box(2600, 2800, 0, 1400, 0, 6000), // tall side wall
    ...box(-1200, 1200, 0, 1400, 7400, 7600), // back wall
    ...box(C.x - C.halfWidth, C.x + C.halfWidth, 0, C.baseY + C.mainHeight, C.backZ, C.frontZ), // castle block
    ...box(TOWER.x0, TOWER.x1, 0, TOWER.height, TOWER.z0, TOWER.z1), // its front-left corner tower
    ...box(C.x - 600, C.x + 600, 0, C.baseY + 3600, C.backZ + 900, C.backZ + 2100), // keep
    ...box(PLANK.x0, PLANK.x1, 0, PLANK.height, PLANK.z0, PLANK.z1),
  ];
  const parts = [
    planarMesh(THREE, ground, grass),
    planarMesh(THREE, pool, tile),
    planarMesh(THREE, walls, stone),
    planarMesh(THREE, ledgeCourse(), grass),
  ];

  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(160, 160, 1600, 8), stone);
  pillar.position.set(-600, 800, 2000);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(POST.radius, POST.radius, POST.height, 8), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
  post.position.set(POST.x, POST.height / 2, POST.z);
  parts.push(pillar, post);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(900, 1400, 8), new THREE.MeshLambertMaterial({ color: 0xb03a2e }));
  roof.position.set(C.x, C.baseY + 3600 + 700, C.backZ + 1500);
  parts.push(roof);
  for (const m of parts) group.add(m);

  const collision = new CollisionWorld();
  collision.addObject(group);
  const pools = [P, { x0: L.x0, x1: L.x1, z0: L.pitZ, z1: L.z0 }];
  const inPool = (x, z) => pools.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
  collision.setWaterLevelFn((x, z) => (inPool(x, z) ? WATER_Y : NO_WATER));
  collision.finalize();

  const waterMat = new THREE.MeshLambertMaterial({ color: 0x2f7fd0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  for (const q of pools) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((q.x0 + q.x1) / 2, WATER_Y, (q.z0 + q.z1) / 2);
    group.add(water);
  }
  return { group, collision };
}

// Stand-in for the AI RACE beast: a block sprawled on the castle block's roof with a head hanging
// out over the front (roughly where objects/RobotBeast.js puts the real one), sunk out of sight
// while the mode is off.
const BEAST_SINK = 3200;
function buildBeast(THREE) {
  const C = layout.CASTLE;
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  const top = C.baseY + C.mainHeight;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1100, 800, 2600), mat);
  body.position.set(C.x, top + 400, C.frontZ - 1600);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(450, 450, 1200), mat);
  neck.position.set(C.x, top + 900, C.frontZ - 200);
  const head = new THREE.Mesh(new THREE.BoxGeometry(600, 500, 800), mat);
  head.position.set(C.x, top + 700, C.frontZ + 500);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(60, 80, 120), eye);
    e.position.set(C.x + s * 310, top + 780, C.frontZ + 700);
    g.add(e);
  }
  g.add(body, neck, head);
  g.position.y = -BEAST_SINK;
  return g;
}

function buildHeroMesh(THREE) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(50, 60, 4, 10), new THREE.MeshLambertMaterial({ color: 0xe07b24 }));
  body.position.y = 80;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(22, 60, 8), new THREE.MeshLambertMaterial({ color: 0x1f8a8a }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 120, 55);
  g.add(body, nose);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(55, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  return { group: g, shadow };
}

// ---------------------------------------------------------------- preview entry

export async function setup({ THREE, scene, camera, renderer, ui, params }) {
  const name = params.get('s') || 'circle';
  const scn = SCENARIOS[name] || SCENARIOS.circle;
  const room = buildRoom(THREE);
  scene.add(room.group);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(layout.SUN_DIR.x, layout.SUN_DIR.y, layout.SUN_DIR.z);
  scene.add(sun);
  const skyFog = new THREE.Fog(0xa0c8ff, 9000, 30000);
  const waterFog = new THREE.Fog(0x1d4f7a, 100, 2600);
  const skyColor = new THREE.Color(0x7fb2ff);
  scene.fog = skyFog;

  const heroMesh = buildHeroMesh(THREE);
  scene.add(heroMesh.group, heroMesh.shadow);

  const sfxLog = [];
  const events = new Events();
  events.on('sfx', (d) => sfxLog.push(d.name));
  const beast = scn.beast ? buildBeast(THREE) : null;
  if (beast) scene.add(beast);
  const cam = new CameraController({ collision: room.collision, camera, events });
  const [sx, sz, syaw] = scn.start;
  const hero = new FakeHero(room.collision, sx, sz, syaw, scn.dropFrom || 0);
  if (scn.intro) cam.startIntro(hero);
  else cam.reset(hero);
  const input = name === 'play' ? new Input(window) : null;

  // Trails for the top-down map (only visible to the map camera).
  const trails = { hero: [], cam: [] };
  const lineMat = (color) => new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  const heroLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0x1040ff));
  const camLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0xff5a00));
  const camMarker = new THREE.Group(); // cone pointing along the camera's look yaw
  const cone = new THREE.Mesh(new THREE.ConeGeometry(90, 260, 3), new THREE.MeshBasicMaterial({ color: 0xff5a00, depthTest: false, transparent: true }));
  cone.rotation.x = Math.PI / 2;
  camMarker.add(cone);
  for (const o of [heroLine, camLine, cone]) {
    o.layers.set(MAP_LAYER);
    o.renderOrder = 10;
  }
  scene.add(heroLine, camLine, camMarker);

  window.__camPreview = { cam, trails }; // for scripted inspection (tools/shot.mjs eval)

  let tick = 0;
  let darkOn = false;
  function simTick() {
    if (scn.title) {
      cam.titleOrbit(tick * TICK);
    } else {
      const s = input ? { c: input.poll(), jump: 0 } : scriptAt(scn, tick);
      if (input && s.c.A.pressed) s.jump = 52;
      if (s.dark !== undefined) {
        events.emit('darkMode', { on: s.dark });
        darkOn = s.dark;
      }
      if (beast) beast.position.y += ((darkOn ? 0 : -BEAST_SINK) - beast.position.y) * 0.08; // rises / sinks
      // Like main.js: the hero gets the controller the camera leaves it (first-person look
      // keeps the stick and buttons), and a scripted route pauses meanwhile.
      const c = cam.playerInput(s.c);
      hero.step(cam.firstPerson ? { c } : { ...s, c }, cam.getYaw());
      cam.update(s.c, hero);
    }
    tick++;
    trails.hero.push(hero.pos.x, hero.pos.y + 5, hero.pos.z);
    trails.cam.push(cam.pos.x, cam.pos.y, cam.pos.z);
  }

  function poseHero(alpha) {
    const p = hero.prev;
    const c = hero.pos;
    heroMesh.group.position.set(p.x + (c.x - p.x) * alpha, p.y + (c.y - p.y) * alpha, p.z + (c.z - p.z) * alpha);
    heroMesh.group.rotation.set(hero.pitch, hero.faceYaw, hero.roll, 'YXZ');
    heroMesh.group.visible = !cam.hideHero;
    heroMesh.shadow.position.set(heroMesh.group.position.x, hero.floor.y + 2, heroMesh.group.position.z);
  }

  function renderView(x, y, w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    scene.fog = cam.underwater ? waterFog : skyFog;
    scene.background = cam.underwater ? waterFog.color : skyColor;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(scene, camera);
  }

  // Orthographic top-down view of the trails around (cx, cz).
  const mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);
  mapCam.layers.enable(MAP_LAYER);
  function renderMap(x, y, w, h, cx, cz, half) {
    const setLine = (line, arr) => line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    setLine(heroLine, trails.hero);
    setLine(camLine, trails.cam);
    camMarker.position.set(cam.pos.x, 6000, cam.pos.z);
    camMarker.rotation.y = cam.getYaw();
    const aspect = w / h;
    Object.assign(mapCam, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    mapCam.position.set(cx, 9000, cz);
    mapCam.up.set(0, 0, -1);
    mapCam.lookAt(cx, 0, cz);
    mapCam.updateProjectionMatrix();
    scene.fog = null;
    scene.background = skyColor;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(scene, mapCam);
  }

  const info = document.createElement('div');
  info.style.cssText = 'position:absolute;left:8px;top:6px;font:12px monospace;color:#fff;text-shadow:1px 1px 0 #000;white-space:pre';
  ui.appendChild(info);
  const describe = () =>
    `${name}  t=${(tick * TICK).toFixed(2)}s  mode=${cam.mode} zoom=${cam.zoom}\n` +
    `dist=${cam.pos.distanceTo(cam.target).toFixed(0)} yaw=${((cam.getYaw() * 180) / Math.PI).toFixed(1)} ` +
    `camY=${cam.pos.y.toFixed(0)} underwater=${cam.underwater} hero=${hero.action}\n` +
    `aim=${((cam.aimRise * 180) / Math.PI).toFixed(1)} rest=${((cam.restAim * 180) / Math.PI).toFixed(1)} hlift=${cam.collider.heightLift.toFixed(0)} ` +
    `ratio=${(cam.collider.ratio ?? 1).toFixed(2)} view=${cam.collider.viewRatio.toFixed(2)} ` +
    `lift=${((cam.collider.lift * 180) / Math.PI).toFixed(0)}${cam.collider.occluded ? ' occluded' : ''}${cam.collider.trapped ? ' trapped' : ''} ` +
    `crest=${cam.collider.crestRise.toFixed(0)}${cam.hero.covered ? ' covered' : ''}${cam.sight.goal !== null ? ' sight-swing' : ''}${cam.celebration ? ' celebrating' : ''} ` +
    `flight=${cam.flight.w.toFixed(2)} rise=${((cam.flight.rise * 180) / Math.PI).toFixed(1)}${cam.flight.w > 0 && !cam.flight.roomy ? ' room-limited' : ''} ` +
    `lookup=${cam.lookUp.w.toFixed(2)} spread=${cam.lookUp.u.toFixed(2)} fov=${cam.fov.toFixed(1)}${darkOn ? ' AI-RACE' : ''}\n` +
    `sfx: ${sfxLog.slice(-4).join(' ')}`;

  const W = renderer.domElement.width;
  const H = renderer.domElement.height;
  renderer.setScissorTest(true);
  renderer.autoClear = true;

  // --- strip mode: pre-simulate and snapshot the requested moments.
  const strip = params.get('strip');
  if (strip) {
    const times = strip.split(',').map(Number);
    const shots = [];
    for (const time of times) {
      while (tick < Math.round(time / TICK)) simTick();
      cam.apply(1);
      poseHero(1);
      shots.push({
        time,
        pos: camera.position.clone(),
        quat: camera.quaternion.clone(),
        hero: heroMesh.group.position.clone(),
        yaw: hero.faceYaw,
        shadowY: heroMesh.shadow.position.y,
        underwater: cam.underwater,
        hidden: cam.hideHero,
        beastY: beast ? beast.position.y : 0,
        text: describe(),
      });
    }
    const cols = 3;
    const rows = Math.ceil((shots.length + 1) / cols);
    const cw = Math.floor(W / cols);
    const ch = Math.floor(H / rows);
    info.remove();
    shots.forEach((s, i) => {
      const label = document.createElement('div');
      label.style.cssText = `position:absolute;left:${(i % cols) * cw + 4}px;top:${Math.floor(i / cols) * ch + 2}px;font:10px monospace;color:#fff;text-shadow:1px 1px 0 #000;white-space:pre`;
      label.textContent = s.text;
      ui.appendChild(label);
    });
    const hx = trails.hero.filter((_, i) => i % 3 === 0);
    const hz = trails.hero.filter((_, i) => i % 3 === 2);
    const cx2 = trails.cam.filter((_, i) => i % 3 === 0);
    const cz2 = trails.cam.filter((_, i) => i % 3 === 2);
    const minX = Math.min(...hx, ...cx2);
    const maxX = Math.max(...hx, ...cx2);
    const minZ = Math.min(...hz, ...cz2);
    const maxZ = Math.max(...hz, ...cz2);
    const half = Math.max(maxX - minX, maxZ - minZ) / 2 + 600;
    return {
      render() {
        shots.forEach((s, i) => {
          camera.position.copy(s.pos);
          camera.quaternion.copy(s.quat);
          heroMesh.group.position.copy(s.hero);
          heroMesh.group.rotation.y = s.yaw;
          heroMesh.group.visible = !s.hidden;
          heroMesh.shadow.position.set(s.hero.x, s.shadowY, s.hero.z);
          cam.underwater = s.underwater;
          if (beast) beast.position.y = s.beastY;
          renderView((i % cols) * cw, H - (Math.floor(i / cols) + 1) * ch, cw - 2, ch - 2);
        });
        const i = shots.length;
        renderMap((i % cols) * cw, H - (Math.floor(i / cols) + 1) * ch, cw - 2, ch - 2, (minX + maxX) / 2, (minZ + maxZ) / 2, half);
      },
    };
  }

  // --- live / frozen mode.
  const freezeAt = params.has('t') ? Math.round(Number(params.get('t')) / TICK) : -1;
  while (freezeAt >= 0 && tick < freezeAt) simTick();
  const showMap = params.get('map') !== '0';
  let acc = 0;
  let alpha = 1;
  return {
    update(dt) {
      if (freezeAt >= 0) return;
      acc += dt;
      while (acc >= TICK) {
        simTick();
        acc -= TICK;
      }
      alpha = acc / TICK;
    },
    render() {
      cam.apply(freezeAt >= 0 ? 1 : alpha);
      poseHero(freezeAt >= 0 ? 1 : alpha);
      info.textContent = describe();
      renderView(0, 0, W, H);
      if (showMap) {
        const m = Math.floor(H * 0.42);
        renderMap(W - m - 8, H - m - 8, m, m, hero.pos.x, hero.pos.z, 2600);
      }
    },
  };
}
