// Objects preview: /preview.html?m=objects&...
//   view=close|star|wide|birds|flies|oneup  camera preset (cam=x,y,z&look=x,y,z still override)
//   px=&pz=[&py=]                     place the fake hero (feet); coins it touches are collected
//   reds=N                            collect the first N red coins first (8 spawns the star)
//   ticks=N                           simulate N ticks (30 Hz) before the first frame
//   walk=1                            the fake hero walks down the coin line in real time
//   freeze=1                          stop the simulation after setup (repeatable screenshots)
//   pause=1                           like the game's pause: no ticks, alpha keeps cycling
//   title=1                           like the title screen: never update(), animate() only
//   dark=1                            AI RACE mode: the robot lizard rises onto the castle roof and
//                                     shoots at the fake hero (view=button frames the switch, which
//                                     then reads STOP)
//   pound=1                           the fake hero ground-pounds the AI RACE button once
//   level=1                           the real level (castle, terrain, props) and its layout instead
//                                     of the test lawn; implied by the view=beast* presets:
//     view=beast|beastSpawn|beastSide|beastFront|beastClose|beastBack|beastButton
//                                     the lizard from the courtyard (3/4), the spawn, the east side,
//                                     straight in front, its head close up, behind, the button
//   pose=charge|roar|rise:N           (with dark=1) freeze-frame a moment: mid-charge (jaw open,
//                                     throat and dewlap glowing), mid-roar, or N ticks into the rise
//   view=box|boxLow|hat               the mystery box (lawn: from the side, from below) and the
//                                     winged hat; hit=N: the fake hero bumps it N ticks before the
//                                     first frame (hit=40: the hat hovers over it, hit=120: beside it)
//   minions=N                         N mushroom-capped robot minions burst out of the lawn round the fake
//                                     hero (view=minion: the first one close up, the camera
//                                     following it as it runs; view=minions: the pack);
//                                     wreck=N wrecks the first one N ticks before the first frame
// Flat lawn with a round hill (for slope shadows), built into a small CollisionWorld, plus a
// stone block standing in for the castle roof under the beast.

import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { Events } from '../../core/events.js';
import { FRAME_DT } from '../../core/constants.js';
import { ObjectManager } from '../../objects/ObjectManager.js';
import { canvasTexture, tileableFbm, paintPixels } from '../../render/texgen.js';
import { SUN_DIR } from '../../world/layout.js';
import { buildLevel } from '../../world/level.js';

const HILL = { x: 1300, z: -400, radius: 950, height: 380 };

function groundHeight(x, z) {
  const d = Math.hypot(x - HILL.x, z - HILL.z) / HILL.radius;
  return d >= 1 ? 0 : HILL.height * 0.5 * (1 + Math.cos(Math.PI * d));
}

const LAYOUT = {
  COINS: [
    ...[0, 1, 2, 3, 4].map((i) => ({ x: 0, z: 600 - i * 260 })),
    ...Array.from({ length: 8 }, (_, i) => ({
      x: HILL.x + Math.cos((i / 8) * Math.PI * 2) * 520,
      z: HILL.z + Math.sin((i / 8) * Math.PI * 2) * 520,
    })),
  ],
  RED_COINS: Array.from({ length: 8 }, (_, i) => ({ x: -1500 + i * 190, z: 900 - Math.abs(i - 3.5) * 120 })),
  STAR: { x: -300, y: 380, z: -800 },
  BUTTERFLY_SPOTS: [{ x: -700, z: -100 }, { x: 600, z: 500 }],
  BIRD_CIRCLES: [{ x: 0, z: -1200, y: 1300, radius: 900 }],
  ONE_UP: { x: 500, z: 250 },
  AI_BUTTON: { x: -900, z: 150, radius: 140 },
  KAIJU: { x: 0, z: -3600, yaw: 0 },
  MYSTERY_BOX: { x: -600, z: 500, y: 340, size: 130 },
  groundHeight,
};
const ROOF = { minX: -1300, maxX: 1300, minZ: -3600, maxZ: -1900, y: 1200 };

const VIEWS = {
  close: { pos: [260, 170, 820], look: [0, 90, 300] },
  star: { pos: [-60, 420, -300], look: [-300, 380, -800] },
  wide: { pos: [-200, 1300, 2600], look: [0, 200, -400] },
  birds: { pos: [0, 250, 1400], look: [0, 1200, -1200] },
  flies: { pos: [-300, 350, 500], look: [-700, 250, -100] },
  oneup: { pos: [620, 170, 560], look: [500, 90, 250] },
  button: { pos: [-900, 420, 750], look: [-900, 40, 150] },
  box: { pos: [-330, 520, 900], look: [-600, 400, 500] },
  boxLow: { pos: [-470, 120, 700], look: [-600, 420, 500] },
  hat: { pos: [-420, 260, 1080], look: [-600, 170, 740] },
  hatHold: { pos: [-380, 700, 1000], look: [-600, 600, 500] },
  minion: { pos: [300, 150, 1200], look: [0, 45, 1080] },
  minions: { pos: [0, 900, 2600], look: [0, 60, 1300] },
};

// Real-level camera presets (world units; the lizard's front feet stand at about (0, 2260, -1100)).
const LEVEL_VIEWS = {
  beast: { pos: [2000, 2800, 1700], look: [0, 3000, -1000] },
  beastSpawn: { pos: [0, 700, 7000], look: [0, 2200, -1000] },
  beastSide: { pos: [3900, 3300, -1400], look: [0, 2900, -1400] },
  beastFront: { pos: [300, 2900, 2600], look: [0, 3100, -900] },
  beastClose: { pos: [1500, 2800, 500], look: [0, 3000, -300] },
  beastBack: { pos: [-2600, 5000, -4300], look: [0, 3000, -1400] },
  beastButton: { pos: [-700, 520, 5300], look: [-950, 40, 4550] },
};

export async function setup(ctx) {
  const { params } = ctx;
  if (params.has('level') || (params.get('view') ?? '').startsWith('beast')) return setupLevel(ctx);
  return setupLawn(ctx);
}

function addLights(THREE, scene) {
  // Same lights as the game renderer (N64Renderer): sun along SUN_DIR + hemisphere ambient.
  const sun = new THREE.DirectionalLight(0xfff3e0, 0.6 * Math.PI);
  sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).multiplyScalar(10000);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x9a9a88, 0.62 * Math.PI));
}

function fakeHero(x, y, z) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    faceYaw: Math.PI,
    health: 8,
    coins: 0,
    stars: 0,
    wingHat: 0,
    giveWingHat(s) {
      this.wingHat = s * 30;
    },
    takeDamage(n) {
      this.health = Math.max(0, this.health - n);
    },
    collectCoin(v) {
      this.coins += v;
    },
    collectStar() {
      this.stars++;
    },
  };
}

// Steps the objects until the beast is in the requested moment (pose=charge|roar|rise:N).
function runToPose(objects, pose, tick) {
  const beast = objects.beast;
  if (!beast || !pose) return;
  if (pose.startsWith('rise')) {
    const n = Number(pose.split(':')[1] ?? 50);
    for (let i = 0; i < n; i++) tick();
    return;
  }
  for (let i = 0; i < 900 && beast.state !== 'active'; i++) tick();
  for (let i = 0; i < 120 && beast.roarT >= 0; i++) tick();
  if (pose === 'roar') {
    beast._roar();
    for (let i = 0; i < 22; i++) tick();
  } else if (pose === 'charge') {
    for (let i = 0; i < 900 && !(beast.mode === 'charge' && beast.modeT >= 26); i++) tick();
  }
}

// ?level=1 (and the beast views): the whole real level with the game's layout.
async function setupLevel({ THREE, scene, params }) {
  const dark = params.has('dark');
  scene.background = new THREE.Color(dark ? 0x30363e : 0xa0c8ff);
  scene.fog = new THREE.Fog(dark ? 0x30363e : 0xa0c8ff, 9000, 30000);
  addLights(THREE, scene);
  const level = buildLevel(scene);
  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const x = num('px', 0);
  const z = num('pz', 5700);
  const player = fakeHero(x, level.collision.findFloor(x, 1e5, z).y, z);
  const events = new Events();
  events.on('aiRaceButton', ({ on }) => events.emit('darkMode', { on }));
  const objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player, level });
  const tick = () => objects.update({ player });
  if (params.has('pound')) {
    const b = objects.button;
    const home = player.pos;
    player.pos = { x: b.x, y: b.capTop0, z: b.z };
    player.action = 'ground_pound_land';
    tick();
    player.action = 'idle';
    player.pos = home;
  }
  if (dark) {
    level.setDarkness(1);
    objects.setDarkness(1);
  }
  for (let i = 0; i < num('ticks', 0); i++) tick();
  runToPose(objects, dark ? params.get('pose') : null, tick);
  const view = LEVEL_VIEWS[params.get('view')] ?? LEVEL_VIEWS.beast;
  const freeze = params.has('freeze') || params.has('pose');
  let acc = 0;
  let last = null;
  return {
    camera: view,
    objects,
    update(dt, t) {
      if (last === null) last = t;
      if (!freeze) acc += Math.min(0.25, t - last);
      last = t;
      while (acc >= FRAME_DT) {
        acc -= FRAME_DT;
        tick();
      }
      level.update(t, window.__preview?.camera);
      objects.animate(t, freeze ? 1 : acc / FRAME_DT, window.__preview?.camera);
    },
  };
}

async function setupLawn({ THREE, scene, params, camera }) {
  scene.background = new THREE.Color(0xa8c8f0);
  scene.fog = new THREE.Fog(0xa8c8f0, 8000, 30000);
  addLights(THREE, scene);

  // Ground mesh doubles as the collision floor.
  const geo = new THREE.PlaneGeometry(8000, 8000, 80, 80).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60, uv.getY(i) * 60);
  const noise = tileableFbm(32, 32, 4, 3, 7);
  const grassTex = canvasTexture(32, 32, (ctx, w, h) =>
    paintPixels(ctx, w, h, (x, y) => {
      const n = noise(x, y);
      return [70 + n * 40, 140 + n * 50, 40 + n * 25];
    }),
  );
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grassTex }));
  scene.add(ground);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(ROOF.maxX - ROOF.minX, ROOF.y, ROOF.maxZ - ROOF.minZ).translate((ROOF.minX + ROOF.maxX) / 2, ROOF.y / 2, (ROOF.minZ + ROOF.maxZ) / 2),
    new THREE.MeshLambertMaterial({ color: 0xd8ccb0 }),
  );
  scene.add(roof);
  const collision = new CollisionWorld();
  collision.addObject(ground);
  collision.addObject(roof);
  collision.finalize();

  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const player = fakeHero(num('px', 0), 0, num('pz', 1400));
  player.pos.y = num('py', groundHeight(player.pos.x, player.pos.z));

  // Stand-in for the hero so pickups can be judged against its size.
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(40, 50, 160, 10).translate(0, 80, 0),
    new THREE.MeshLambertMaterial({ color: 0xd8702a }),
  );
  scene.add(marker);

  const events = new Events();
  const hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;left:8px;top:8px;font:14px monospace;color:#fff;text-shadow:1px 1px #000';
  document.getElementById('ui').appendChild(hud);
  const log = [];
  for (const name of ['coin', 'redCoinsComplete', 'starCollected', 'oneUp', 'aiRaceButton']) events.on(name, (e) => log.push(name + (e?.red ? ` red #${e.index}` : '') + (name === 'aiRaceButton' ? ` ${e.on}` : '')));
  events.on('sfx', (e) => /kaiju|fireball|button|box|minion/.test(e.name) && log.push(e.name));
  // Stands in for main: the button's request switches the mode.
  events.on('aiRaceButton', ({ on }) => events.emit('darkMode', { on }));
  const level = { trees: [], addScorch() {} };

  const objects = new ObjectManager({ scene, collision, events, layout: LAYOUT, player, level });
  if (params.has('tex')) showTextures(objects);
  const tick = () => {
    marker.position.set(player.pos.x, player.pos.y, player.pos.z);
    objects.update({ player });
  };

  // Collect red coins by visiting them, then return to the requested spot.
  const home = { ...player.pos };
  for (const r of LAYOUT.RED_COINS.slice(0, num('reds', 0))) {
    player.pos = { x: r.x, y: 0, z: r.z };
    tick();
  }
  player.pos = home;
  if (params.has('pound')) {
    const b = objects.button;
    player.pos = { x: b.x, y: b.capTop0, z: b.z };
    player.action = 'ground_pound_land';
    tick();
    player.action = 'idle';
  }
  if (params.has('dark')) {
    objects.setDarkness(1);
    scene.background.set(0x30363e);
    scene.fog.color.set(0x30363e);
  }
  // Mystery box: the fake hero jumps into it from below `hit` ticks before the first frame.
  if (params.has('hit') && objects.box) {
    const box = objects.box;
    const home = { ...player.pos };
    player.pos = { x: box.x, y: box.bottomY - 160, z: box.z };
    player.vel.y = 10;
    player.faceYaw = Math.PI;
    tick();
    player.vel.y = 0;
    player.pos = home;
    for (let i = 0; i < num('hit', 30); i++) tick();
  }
  // Minions: N burst out of the lawn round the fake hero; the first one close in front of him.
  if (params.has('minions') && objects.minions) {
    const n = num('minions', 1);
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? 0 : (i / n) * Math.PI * 2 + 0.4;
      const r = i === 0 ? 330 : 700 + (i % 2) * 250;
      const x = player.pos.x + Math.sin(a) * r;
      const z = player.pos.z - Math.cos(a) * r;
      objects.minions.spawnAt(x, z, Math.atan2(player.pos.x - x, player.pos.z - z));
    }
    for (let i = 0; i < num('mticks', 40); i++) tick();
    if (params.has('wreck')) {
      const m = objects.minions.list.find((r) => r.state !== 'free');
      if (m) objects.minions._wreck(m, player, false);
      for (let i = 0; i < num('wreck', 1); i++) tick();
    }
  }
  const title = params.has('title');
  const pause = params.has('pause');
  const ticks0 = title ? 0 : Math.max(num('ticks', 0), pause ? 1 : 0);
  for (let i = 0; i < ticks0; i++) tick();

  const view = VIEWS[params.get('view')] ?? VIEWS.close;
  // view=minion: the camera keeps the first minion framed from the preset's angle as it runs.
  const follow = params.get('view') === 'minion' && !params.has('cam') && objects.minions ? VIEWS.minion : null;
  const followMinion = (alpha) => {
    const m = objects.minions.list.find((r) => r.state !== 'free');
    if (!m) return;
    const x = m.px + (m.x - m.px) * alpha;
    const y = m.py + (m.y - m.py) * alpha;
    const z = m.pz + (m.z - m.pz) * alpha;
    const [cx, cy, cz] = follow.pos;
    const [lx, ly, lz] = follow.look;
    camera.position.set(x + cx - lx, y + cy, z + cz - lz);
    camera.lookAt(x, y + ly, z);
  };
  const walk = params.has('walk');
  const freeze = params.has('freeze');
  let acc = 0;
  let last = null;
  let ticks = 0;
  return {
    camera: view,
    objects, // for --actions '{"eval": "__preview.handle.objects..."}'
    update(dt, t) {
      if (last === null) last = t;
      if (!freeze) acc += Math.min(0.25, t - last);
      last = t;
      while (acc >= FRAME_DT && !pause && !title) {
        acc -= FRAME_DT;
        if (walk) player.pos = { x: 0, y: 0, z: 1000 - (ticks % 150) * 12 };
        tick();
        ticks++;
      }
      const alpha = freeze ? 1 : (acc / FRAME_DT) % 1;
      if (follow) followMinion(alpha);
      objects.animate(t, alpha, camera);
      const beast = objects.beast ? `  beast:${objects.beast.state}  hp ${player.health}  minions ${objects.minions.alive}` : '';
      hud.textContent = `coins ${player.coins}  stars ${player.stars}  star:${objects.star.state}${beast}  ${log.slice(-3).join(', ')}`;
    },
  };
}

// ?tex=1: the painted atlases, enlarged, over the scene (coin frames, sparkles, wings, shadow).
function showTextures(objects) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:8px;top:30px;background:#345;padding:6px;display:flex;flex-direction:column;align-items:flex-start;gap:6px';
  const maps = [
    objects.coins.batch.mesh.material.uniforms.map.value,
    objects.sparkles.batch.mesh.material.uniforms.map.value,
    objects.butterflies.mesh.material.map,
    objects.shadows.mesh.material.map,
  ];
  for (const tex of maps) {
    const src = tex.image;
    const c = document.createElement('canvas');
    const scale = src.width > 512 ? 0.9 : 2;
    c.width = src.width * scale;
    c.height = src.height * scale;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    box.appendChild(c);
  }
  document.getElementById('ui').appendChild(box);
}
