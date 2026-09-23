// Objects preview: /preview.html?m=objects&...
//   view=close|star|wide|birds|flies|oneup  camera preset (cam=x,y,z&look=x,y,z still override)
//   px=&pz=[&py=]                     place the fake hero (feet); coins it touches are collected
//   reds=N                            collect the first N red coins first (8 spawns the star)
//   ticks=N                           simulate N ticks (30 Hz) before the first frame
//   walk=1                            the fake hero walks down the coin line in real time
//   freeze=1                          stop the simulation after setup (repeatable screenshots)
//   pause=1                           like the game's pause: no ticks, alpha keeps cycling
// Flat lawn with a round hill (for slope shadows), built into a small CollisionWorld.

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
  groundHeight,
};

const VIEWS = {
  close: { pos: [260, 170, 820], look: [0, 90, 300] },
  star: { pos: [-60, 420, -300], look: [-300, 380, -800] },
  wide: { pos: [-200, 1300, 2600], look: [0, 200, -400] },
  birds: { pos: [0, 250, 1400], look: [0, 1200, -1200] },
  flies: { pos: [-300, 350, 500], look: [-700, 250, -100] },
  oneup: { pos: [620, 170, 560], look: [500, 90, 250] },
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
  const collision = new CollisionWorld();
  collision.addObject(ground);
  collision.finalize();

  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const player = {
    pos: { x: num('px', 0), y: 0, z: num('pz', 1400) },
    coins: 0,
    stars: 0,
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
  for (const name of ['coin', 'redCoinsComplete', 'starCollected', 'oneUp']) events.on(name, (e) => log.push(name + (e?.red ? ` red #${e.index}` : '')));

  const objects = new ObjectManager({ scene, collision, events, layout: LAYOUT, player });
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
  for (let i = 0; i < num('ticks', 0); i++) tick();

  const view = VIEWS[params.get('view')] ?? VIEWS.close;
  const walk = params.has('walk');
  const freeze = params.has('freeze');
  const pause = params.has('pause');
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
      while (acc >= FRAME_DT && !pause) {
        acc -= FRAME_DT;
        if (walk) player.pos = { x: 0, y: 0, z: 1000 - (ticks % 150) * 12 };
        tick();
        ticks++;
      }
      objects.animate(t, freeze ? 1 : (acc / FRAME_DT) % 1, camera);
      hud.textContent = `coins ${player.coins}  stars ${player.stars}  star:${objects.star.state}  ${log.slice(-3).join(', ')}`;
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
