// Renderer preview: the level (or a fallback test scene) drawn through N64Renderer.
//   /preview.html?m=render            N64 mode, default view from behind the spawn point
//   &n64=0                            native resolution
//   &box=1                            4:3 pillarbox
//   &under=1                          camera below the water in the front moat
//   &debug=1                          F1 overlay on
//   &h=360                            internal height override (tuning)
//   &overlay=1                        a 4:3-aware test overlay aligned with alignOverlay()
//   &scene=test                       skip the level, use the fallback test scene
//   &props=0                          hide the test props (spheres, boxes, gradient panel)
// Camera overrides (&cam=x,y,z&look=x,y,z) from the harness work as usual.
// The preview never reads or writes the game's saved display settings (storage: null), so
// URL flags cannot leak into the game on the same origin.

import * as THREE from 'three';
import { N64Renderer } from '../../render/N64Renderer.js';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { canvasTexture, paintPixels, tileableFbm, mixRgb } from '../../render/texgen.js';
import * as layout from '../../world/layout.js';

const VIEWS = {
  spawn: { pos: [0, 720, 7300], look: [0, 380, 0] },
  underwater: { pos: [-1500, -650, 700], look: [-4200, -760, 760] },
};

// Test props stand on the lawn just in front of the default camera.
const PROPS_Z = 5000;

export async function setup(ctx) {
  const { params } = ctx;
  // The harness made its own renderer; this preview draws through N64Renderer instead.
  ctx.renderer.domElement.remove();
  ctx.renderer.dispose();

  const options = { storage: null };
  if (params.has('h')) options.internalHeight = Number(params.get('h'));
  const view = new N64Renderer(ctx.container, options);
  if (params.has('n64')) view.setN64Mode(params.get('n64') !== '0');
  if (params.has('box')) view.setPillarbox(params.get('box') !== '0');
  if (params.has('debug')) view.setDebugOverlay(true);
  if (params.has('overlay')) view.alignOverlay(cornerMarkers(ctx.ui));

  // Without an override the renderer uses layout.waterLevelAt (as the game does).
  const level = params.get('scene') === 'test' ? null : await tryBuildLevel(view.scene);
  if (!level) view.scene.add(fallbackScene());
  if (params.get('props') !== '0') view.scene.add(testProps(level ? layout.groundHeight : () => 0));

  window.__view = view;
  return {
    camera: params.has('under') ? VIEWS.underwater : VIEWS.spawn,
    update(dt, t) {
      level?.update(t, view.camera);
    },
    render() {
      // Follow the harness camera (it applies the URL/preset camera to ctx.camera).
      view.camera.position.copy(ctx.camera.position);
      view.camera.quaternion.copy(ctx.camera.quaternion);
      view.render();
    },
  };
}

// World modules are rewritten concurrently; a broken one must not break this preview.
async function tryBuildLevel(scene) {
  try {
    const { buildLevel } = await import('../../world/level.js');
    return buildLevel(scene);
  } catch (err) {
    console.warn('render preview: level failed to build, using the fallback scene', err);
    return null;
  }
}

// Fixed overlay with a frame and four corner labels, like the HUD's corner widgets.
function cornerMarkers(ui) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;box-sizing:border-box;border:3px solid #ff0;pointer-events:none';
  const corners = { TL: 'left:6px;top:6px', TR: 'right:6px;top:6px', BL: 'left:6px;bottom:6px', BR: 'right:6px;bottom:6px' };
  for (const [label, pos] of Object.entries(corners)) {
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText = `position:absolute;${pos};font:bold 20px monospace;color:#fff;background:#c00;padding:2px 5px`;
    el.appendChild(tag);
  }
  ui.appendChild(el);
  return el;
}

function brickTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const noise = tileableFbm(w, h, 8, 3, 7);
    paintPixels(ctx, w, h, (x, y) => {
      const row = Math.floor(y / 16);
      const mortar = y % 16 < 2 || (x + (row % 2) * 16) % 32 < 2;
      const base = mortar ? [150, 140, 125] : [208, 190, 150];
      return mixRgb(base, [90, 80, 70], noise(x, y) * 0.45);
    });
  });
}

function grassTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const noise = tileableFbm(w, h, 4, 4, 3);
    paintPixels(ctx, w, h, (x, y) => mixRgb([70, 150, 40], [140, 200, 70], noise(x, y)));
  });
}

// Baked-lit, textured world-style mesh (like the level builders make).
function worldMesh(geometry, map, tint = [1, 1, 1]) {
  const geo = bakeLighting(geometry.toNonIndexed(), { tint });
  return new THREE.Mesh(geo, worldMaterial({ map }));
}

// Spheres (lit actors), textured boxes and a smooth gradient panel for judging the
// quantisation/dither and the actor lighting against the baked world.
function testProps(groundAt) {
  const group = new THREE.Group();
  const bricks = brickTexture();
  const y0 = (x) => groundAt(x, PROPS_Z);

  const box = worldMesh(new THREE.BoxGeometry(300, 300, 300), bricks);
  box.position.set(420, y0(420) + 150, PROPS_Z);
  const tall = worldMesh(new THREE.BoxGeometry(200, 520, 200), bricks, [1, 0.85, 0.8]);
  tall.position.set(-620, y0(-620) + 260, PROPS_Z - 200);
  tall.rotation.y = 0.5;

  const red = new THREE.Mesh(new THREE.SphereGeometry(110, 16, 12), new THREE.MeshLambertMaterial({ color: 0xd8342c }));
  red.position.set(-220, y0(-220) + 110, PROPS_Z + 150);
  const white = new THREE.Mesh(new THREE.SphereGeometry(80, 16, 12), new THREE.MeshLambertMaterial({ color: 0xf2efe6 }));
  white.position.set(120, y0(120) + 80, PROPS_Z + 300);
  const gold = new THREE.Mesh(new THREE.TorusGeometry(60, 18, 8, 16), new THREE.MeshPhongMaterial({ color: 0xf0c020, shininess: 60 }));
  gold.position.set(-40, y0(-40) + 200, PROPS_Z + 450);

  // Vertical dark-to-light blue ramp: banding/dither test.
  const panelGeo = new THREE.PlaneGeometry(500, 400, 1, 8);
  const pos = panelGeo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + 200) / 400;
    colors.push(0.05 + 0.5 * t, 0.12 + 0.6 * t, 0.3 + 0.7 * t);
  }
  panelGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const panel = new THREE.Mesh(panelGeo, worldMaterial({ side: THREE.DoubleSide }));
  panel.position.set(1000, y0(1000) + 220, PROPS_Z - 300);
  panel.rotation.y = -0.5;

  // A lit actor swimming in the front moat, seen by the &under=1 view.
  const diver = new THREE.Mesh(new THREE.SphereGeometry(90, 16, 12), new THREE.MeshLambertMaterial({ color: 0xd8342c }));
  diver.position.set(-2400, -700, 760);

  group.add(box, tall, red, white, gold, panel, diver);
  return group;
}

// Stand-in world when the level cannot be built: a grass plain cut by the front arm of
// the moat (so the layout's water level applies there) and a row of textured pillars.
function fallbackScene() {
  const group = new THREE.Group();
  const grass = grassTexture();
  grass.repeat.set(30, 30);
  const moatSouth = layout.MOAT.maxZ;
  const moatNorth = layout.ISLAND.maxZ;
  for (const [z0, z1] of [[-10000, moatNorth], [moatSouth, 10000]]) {
    const ground = worldMesh(new THREE.PlaneGeometry(20000, z1 - z0, 10, 10).rotateX(-Math.PI / 2), grass);
    ground.position.z = (z0 + z1) / 2;
    group.add(ground);
  }
  const moatFloor = worldMesh(new THREE.PlaneGeometry(20000, moatSouth - moatNorth).rotateX(-Math.PI / 2), grass, [0.5, 0.6, 0.7]);
  moatFloor.position.set(0, layout.MOAT_FLOOR, (moatNorth + moatSouth) / 2);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, moatSouth - moatNorth).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3a90c0, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  water.position.set(0, layout.WATER_LEVEL, (moatNorth + moatSouth) / 2);
  group.add(moatFloor, water);

  const bricks = brickTexture();
  for (let i = 0; i < 8; i++) {
    const pillar = worldMesh(new THREE.BoxGeometry(300, 900, 300), bricks);
    pillar.position.set(i % 2 ? 1200 : -1200, 450, 3000 - i * 1500);
    group.add(pillar);
  }
  return group;
}
