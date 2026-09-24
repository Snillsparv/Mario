// Objects preview: /preview.html?m=objects&...
//   view=close|star|wide|birds|flies|oneup  camera preset (cam=x,y,z&look=x,y,z still override)
//   px=&pz=[&py=]                     place the fake hero (feet); coins it touches are collected
//   reds=N                            collect the first N red coins first (8 spawns the star)
//   ticks=N                           simulate N ticks (30 Hz) before the first frame
//   walk=1                            the fake hero walks down the coin line in real time
//   freeze=1                          stop the simulation after setup (repeatable screenshots)
//   pause=1                           like the game's pause: no ticks, alpha keeps cycling
//   title=1                           like the title screen: never update(), animate() only
//   dark=1                            AI RACE mode: the robot beast rises on its block and shoots
//                                     at the fake hero (view=beast frames it, view=button the switch)
//   pound=1                           the fake hero ground-pounds the AI RACE button once
// Flat lawn with a round hill (for slope shadows), built into a small CollisionWorld, plus a
// stone block standing in for the castle roof under the beast.

import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { Events } from '../../core/events.js';
import { FRAME_DT } from '../../core/constants.js';
import { ObjectManager } from '../../objects/ObjectManager.js';
import { canvasTexture, tileableFbm, paintPixels } from '../../render/texgen.js';
import { SUN_DIR } from '../../world/layout.js';

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
  beast: { pos: [900, 1500, 2600], look: [0, 2400, -2800] },
};

export async function setup({ THREE, scene, params, camera }) {
  scene.background = new THREE.Color(0xa8c8f0);
  scene.fog = new THREE.Fog(0xa8c8f0, 8000, 30000);
  // Same lights as the game renderer (N64Renderer): sun along SUN_DIR + hemisphere ambient.
  const sun = new THREE.DirectionalLight(0xfff3e0, 0.6 * Math.PI);
  sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).multiplyScalar(10000);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x9a9a88, 0.62 * Math.PI));

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
  const player = {
    pos: { x: num('px', 0), y: 0, z: num('pz', 1400) },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    health: 8,
    coins: 0,
    stars: 0,
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
  events.on('sfx', (e) => /kaiju|fireball|button/.test(e.name) && log.push(e.name));
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
  const title = params.has('title');
  const pause = params.has('pause');
  const ticks0 = title ? 0 : Math.max(num('ticks', 0), pause ? 1 : 0);
  for (let i = 0; i < ticks0; i++) tick();

  const view = VIEWS[params.get('view')] ?? VIEWS.close;
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
      objects.animate(t, freeze ? 1 : (acc / FRAME_DT) % 1, camera);
      const beast = objects.beast ? `  beast:${objects.beast.state}  hp ${player.health}` : '';
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
