// Player-physics test course: /preview.html?m=physics
//
// Live mode (default): WASD / Space / J / Shift drive a capsule stand-in with a follow camera.
// The course has a readable sign ahead-left of the spawn: J in front of its (cream) face reads
// it; Space / J turn the pages, as the game's dialog box does.
// Scripted mode: &demo=<preset> or &script=<json> runs the whole script at load, draws the
// trajectory (coloured by action group) and frames it from the side. Script steps:
//   { n: ticks, ...input }  or  { until: 'grounded' | 'airborne' | <action>, ...input }
// with input = { stickX, stickY, A, B, Z } (truthy buttons are held; presses are edges).
// Optional: &spawn=x,y,z,yaw  &cy=<camera yaw for the stick>  &intro=1 (drop-in first).

import { Player } from '../../player/Player.js';
import { ACTIONS } from '../../player/actions/index.js';
import { buildTestCourse, ScriptedController } from '../../player/physics/testCourse.js';
import { Events } from '../../core/events.js';
import { Input, neutralController } from '../../core/input.js';
import { FRAME_DT } from '../../core/constants.js';
import { approachAngle } from '../../core/math.js';

const HALF_PI = Math.PI / 2;

// Preset demos: spawn [x, y, z, yaw], the stick's camera yaw defaults to the spawn yaw.
export const DEMOS = {
  triple: {
    spawn: [-5000, 0, -4000, 0],
    script: [
      { n: 40, stickY: 1 },
      ...[0, 1, 2].flatMap(() => [{ n: 1, stickY: 1 }, { n: 1, stickY: 1, A: 1 }, { until: 'grounded', stickY: 1, A: 1 }]),
      { n: 15, stickY: 1 },
    ],
  },
  longjump: {
    spawn: [-5000, 0, -4000, 0],
    script: [{ n: 45, stickY: 1 }, { n: 1, stickY: 1, Z: 1 }, { n: 1, stickY: 1, Z: 1, A: 1 }, { until: 'grounded', stickY: 1 }, { n: 10 }],
  },
  flips: {
    spawn: [-5000, 0, -4000, 0],
    script: [
      { n: 4, Z: 1 },
      { n: 1, Z: 1, A: 1 },
      { until: 'grounded', Z: 1, A: 1 },
      { n: 12 },
      { n: 35, stickY: 1 },
      { n: 3, stickY: -1 },
      { n: 1, stickY: -1, A: 1 },
      { until: 'grounded', stickY: -1, A: 1 },
      { n: 10 },
    ],
  },
  wallkick: {
    spawn: [1500, 0, 1000, HALF_PI],
    script: [
      { n: 70, stickY: 1 },
      { n: 1, stickY: 1, A: 1 },
      { until: 'air_hit_wall', stickY: 1, A: 1 },
      { n: 1 },
      { n: 1, A: 1 },
      { until: 'grounded', A: 1 },
      { n: 10 },
    ],
  },
  ledge: {
    spawn: [1300, 0, 0, HALF_PI],
    script: [{ n: 28, stickY: 1 }, { n: 1, stickY: 1, A: 1 }, { until: 'ledge_hang', stickY: 1, A: 1 }, { until: 'idle', stickY: 1 }, { n: 20, stickY: 1 }],
  },
  dive: {
    spawn: [-5000, 0, -4000, 0],
    script: [{ n: 45, stickY: 1 }, { n: 1, stickY: 1, B: 1 }, { until: 'belly_slide', stickY: 1 }, { n: 6 }, { n: 1, A: 1 }, { until: 'grounded' }, { n: 10 }],
  },
  pound: {
    spawn: [-5000, 0, -4000, 0],
    script: [{ n: 20, stickY: 1 }, { n: 1, stickY: 1, A: 1 }, { n: 10, stickY: 1, A: 1 }, { n: 1, Z: 1 }, { until: 'grounded' }, { n: 15 }],
  },
  swim: {
    spawn: [0, 0, -600, Math.PI],
    script: [
      { until: 'water_surface', stickY: 1 },
      { n: 10, stickY: 1 },
      { n: 1, stickY: 1, A: 1 },
      { n: 8, stickY: 1 },
      { n: 1 },
      { n: 40, A: 1 },
      { until: 'water_surface', stickY: -1, A: 1 },
      { n: 26, stickX: 1 },
      { until: 'walking', stickY: 1 },
      { n: 20, stickY: -1 },
    ],
  },
  // A surface stroke toward the pool's side wall, then (mid-stroke, at speed) A with the stick
  // pulled back: the leap slides up the wall (no bonk) and carries on onto the rim.
  waterjump: {
    spawn: [690, -300, -3000, HALF_PI],
    script: [{ until: 'water_surface' }, { n: 1, A: 1 }, { n: 6 }, { n: 1, stickY: -1, A: 1 }, { until: 'grounded', stickY: 1 }, { n: 15 }],
  },
  // Walks up to the course's sign and reads it (B while walking in front of its face).
  read: {
    spawn: [-500, 0, 450, 0],
    script: [{ n: 16, stickY: 1 }, { n: 1, stickY: 1, B: 1 }, { until: 'reading' }, { n: 15 }],
  },
  pole: {
    spawn: [2000, 0, -2500, 0],
    script: [{ n: 32, stickY: 1 }, { n: 1, stickY: 1, A: 1 }, { until: 'pole', stickY: 1, A: 1 }, { n: 40, stickY: 1 }, { n: 1 }, { n: 1, A: 1 }, { until: 'grounded' }, { n: 10 }],
  },
  // Climbs the pole all the way up into the handstand on its tip, then flips off it (A).
  handstand: {
    spawn: [2000, 0, -2500, 0],
    script: [
      { n: 32, stickY: 1 },
      { n: 1, stickY: 1, A: 1 },
      { until: 'pole', stickY: 1, A: 1 },
      { until: 'pole_top', stickY: 1 },
      { n: 20 },
      { n: 1, A: 1 },
      { until: 'grounded' },
      { n: 10 },
    ],
  },
  // Running, Z and A pressed on the same tick: the keyboard's long jump (either order works).
  longjump2: {
    spawn: [-5000, 0, -4000, 0],
    script: [{ n: 30, stickY: 1 }, { n: 1, stickY: 1, Z: 1, A: 1 }, { until: 'grounded', stickY: 1 }, { n: 10 }],
  },
  steep: {
    spawn: [600, 0, 700, 0],
    script: [{ n: 90, stickY: 1 }, { n: 30 }],
  },
  slide: {
    spawn: [-2900, 700, -1350, Math.PI],
    script: [{ n: 70 }],
  },
};

const GROUP_COLORS = {
  stationary: 0xffffff,
  moving: 0x44dd66,
  airborne: 0xffcc22,
  submerged: 0x33aaff,
  automatic: 0xff55cc,
};

const TERRAIN_COLORS = { grass: 0x6fbf4a, stone: 0x9a9a9a, sand: 0xd8c38a, wood: 0x9b6a3c };

export async function setup({ THREE, scene, camera, ui, params }) {
  const { builder, spawn: courseSpawn, signs } = buildTestCourse();
  const world = builder.build();
  scene.add(courseMesh(THREE, builder));
  for (const sign of signs) scene.add(signFace(THREE, sign));
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x445533, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);
  const grid = new THREE.GridHelper(20000, 100, 0x335522, 0x335522);
  grid.position.y = 0.5;
  scene.add(grid);

  const demo = DEMOS[params.get('demo')];
  const spawnArr = params.get('spawn')?.split(',').map(Number) ?? demo?.spawn;
  const spawn = spawnArr ? { x: spawnArr[0], y: spawnArr[1], z: spawnArr[2], yaw: spawnArr[3] ?? 0 } : courseSpawn;
  const events = new Events();
  const recent = [];
  for (const name of ['sfx', 'land', 'splash', 'hurt', 'lifeLost']) {
    events.on(name, (e) => {
      recent.push(name === 'sfx' ? e.name : name);
      if (recent.length > 6) recent.shift();
    });
  }
  const player = new Player({ collision: world, events, spawn, signs });
  if (params.get('intro')) player.beginIntro();
  // Stand-in for the game's dialog box: the pages of the sign being read, one per A/B press.
  let reading = null; // { sign, page }
  events.on('signRead', ({ sign }) => {
    reading = { sign, page: 0 };
    recent.push('signRead');
    if (recent.length > 6) recent.shift();
  });

  const standIn = makeStandIn(THREE);
  scene.add(standIn.object3D);
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:absolute;left:8px;top:8px;margin:0;padding:6px 8px;color:#fff;background:rgba(0,0,0,.55);font:12px monospace';
  ui.appendChild(hud);

  const draw = (alpha) => {
    const rs = player.getRenderState(alpha);
    standIn.update(rs, ACTIONS[rs.action].group);
    hud.textContent =
      `${rs.action} / ${rs.anim}  t=${rs.animTime.toFixed(2)}\n` +
      `fv ${rs.forwardVel.toFixed(1)}  vy ${rs.vy.toFixed(1)}  health ${rs.health}\n` +
      `pos ${rs.pos.x.toFixed(0)}, ${rs.pos.y.toFixed(0)}, ${rs.pos.z.toFixed(0)}\n` +
      recent.join(' ') +
      (reading ? `\n\n[${reading.sign.pages[reading.page]}]  (Space/J)` : '');
  };

  const scriptText = params.get('script');
  const script = scriptText ? JSON.parse(scriptText) : demo?.script;
  const lockedCamera = params.has('cam');

  if (script) {
    const stickYaw = Number(params.get('cy') ?? spawn.yaw);
    const trail = runScript(player, script, stickYaw);
    scene.add(trailLine(THREE, trail));
    draw(1);
    return { camera: sideView(trail), update() {} };
  }

  // Live mode: keyboard / gamepad with a trailing camera.
  const input = new Input(window);
  let camYaw = spawn.yaw;
  let acc = 0;
  return {
    camera: { pos: [spawn.x, spawn.y + 500, spawn.z - 1100], look: [spawn.x, spawn.y + 120, spawn.z] },
    update(dt) {
      acc += dt;
      while (acc >= FRAME_DT) {
        acc -= FRAME_DT;
        let c = input.poll();
        if (reading) {
          if (c.A.pressed || c.B.pressed) reading.page++;
          if (reading.page >= reading.sign.pages.length) {
            reading = null;
            player.endReading();
            input.flush();
          }
          c = neutralController();
        }
        if (c.CL.down) camYaw += 0.06;
        if (c.CR.down) camYaw -= 0.06;
        if (player.forwardVel > 4 && !player.inWater) camYaw = approachAngle(camYaw, player.faceYaw, 0.02);
        player.update(c, camYaw);
      }
      draw(acc / FRAME_DT);
      if (lockedCamera) return;
      const p = standIn.object3D.position;
      camera.position.set(p.x - Math.sin(camYaw) * 1100, p.y + 500, p.z - Math.cos(camYaw) * 1100);
      camera.lookAt(p.x, p.y + 120, p.z);
    },
  };
}

// Runs a script to completion; returns [{ x, y, z, group }] per tick.
function runScript(player, script, stickYaw) {
  const ctl = new ScriptedController();
  const trail = [{ ...player.pos, group: ACTIONS[player.action].group }];
  const done = (until) =>
    until === 'grounded' ? player.grounded : until === 'airborne' ? !player.grounded && !player.inWater : player.action === until;
  for (const step of script) {
    const max = step.until ? 300 : step.n ?? 1;
    for (let i = 0; i < max; i++) {
      player.update(ctl.next(step), stickYaw);
      trail.push({ ...player.pos, group: ACTIONS[player.action].group });
      if (step.until && done(step.until)) break;
    }
  }
  return trail;
}

function trailLine(THREE, trail) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (const t of trail) {
    pos.push(t.x, t.y + 80, t.z);
    c.setHex(GROUP_COLORS[t.group]);
    col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  const dots = new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size: 14 }));
  line.add(dots);
  return line;
}

// Frames the trajectory from the side of its main travel direction.
function sideView(trail) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const t of trail) {
    for (const k of ['x', 'y', 'z']) {
      min[k] = Math.min(min[k], t[k]);
      max[k] = Math.max(max[k], t[k]);
    }
  }
  const c = [(min.x + max.x) / 2, (min.y + max.y) / 2 + 80, (min.z + max.z) / 2];
  const extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 400);
  const a = trail[0];
  const b = trail[trail.length - 1];
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 200) [dx, dz] = [0, 1];
  else [dx, dz] = [dx / len, dz / len];
  const dist = extent * 1.2 + 500;
  return { pos: [c[0] + dz * dist, c[1] + extent * 0.2 + 150, c[2] - dx * dist], look: c };
}

function courseMesh(THREE, builder) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (const t of builder.tris) {
    pos.push(...t.positions);
    const p = t.positions;
    const ny = normalY(p);
    c.setHex(TERRAIN_COLORS[t.terrain] ?? 0xaaaaaa);
    if (t.surface === 'very_slippery' || t.surface === 'slippery') c.lerp(new THREE.Color(0x66ccff), 0.5);
    if (Math.abs(ny) < 0.1) c.multiplyScalar(0.7);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  for (const w of builder.pools) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0).rotateX(-HALF_PI),
      new THREE.MeshLambertMaterial({ color: 0x3388dd, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    water.position.set((w.x0 + w.x1) / 2, w.level, (w.z0 + w.z1) / 2);
    group.add(water);
  }
  for (const p of builder.poles) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.y1 - p.y0, 8), new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    trunk.position.set(p.x, (p.y0 + p.y1) / 2, p.z);
    group.add(trunk);
  }
  return group;
}

function normalY(p) {
  const ux = p[3] - p[0];
  const uy = p[4] - p[1];
  const uz = p[5] - p[2];
  const vx = p[6] - p[0];
  const vy = p[7] - p[1];
  const vz = p[8] - p[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}

// A cream panel on the readable face of a course sign (the collider boxes are drawn plain).
function signFace(THREE, sign) {
  const face = new THREE.Mesh(new THREE.PlaneGeometry(100, 56), new THREE.MeshLambertMaterial({ color: 0xf2e6c4 }));
  face.position.set(sign.x + Math.sin(sign.yaw) * 5, sign.y + 145, sign.z + Math.cos(sign.yaw) * 5);
  face.rotation.y = sign.yaw;
  return face;
}

// Capsule with a nose cone (shows facing) and a blob shadow; tinted by action group.
function makeStandIn(THREE) {
  const object3D = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 80;
  body.rotation.order = 'YXZ';
  object3D.add(body);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(45, 70, 4, 12), mat);
  body.add(capsule);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(18, 50, 8).rotateX(HALF_PI), new THREE.MeshLambertMaterial({ color: 0xdd3322 }));
  nose.position.set(0, 40, 45);
  body.add(nose);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(45, 16).rotateX(-HALF_PI),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  object3D.add(shadow);
  return {
    object3D,
    update(rs, group) {
      object3D.position.set(rs.pos.x, rs.pos.y, rs.pos.z);
      body.rotation.set(rs.pitch, rs.yaw, rs.roll);
      mat.color.setHex(GROUP_COLORS[group]);
      mat.emissive.setHex(rs.invincible ? 0x662222 : 0x000000);
      shadow.position.y = rs.floorY - rs.pos.y + 2;
    },
  };
}
