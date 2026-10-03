#!/usr/bin/env node
// Sparrow Lane's realistic look from fixed camera poses (the acceptance shots: render/real/*),
// beside the classic look for comparison. Starts its own Vite dev server and headless Chromium
// (SwiftShader) like tools/shot.mjs, boots the game straight into the lane, waits for the
// realistic look to swap in, hides the HUD, and for each view puts Jonas and the camera there
// and draws one frame (the camera set after the game's own: no follow camera in the picture).
//
// Usage:
//   node tools/realShots.mjs --out shots/real
//   node tools/realShots.mjs --out shots/real --views arrival,door --sizes 960x540 \
//     --looks high,classic
// Options: --views (default all: arrival, door, west, turn, cars, roof, retro, tree: the dad's
// red-leaf tree close up, villa: a villa up the hill close up), --sizes (default
// 960x540,1280x720), --looks (default high,low,classic: a tier, or classic).
// Files: <out>/<look>-<view>-<width>.png. Prints each view's F1 line and draw calls.

import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

// Camera poses in the lane's local frame (position, look-at point, vertical fov) and where Jonas
// stands (x, y, z, yaw; none: at the arrival). 'retro' is the arrival through F2.
const VIEWS = {
  arrival: { pos: [0, 346, -82], look: [0, 303, 1156], fov: 45 },
  door: { pos: [-260, 250, 640], look: [150, 300, 1330], fov: 62 },
  west: { pos: [-600, 330, 200], look: [-4000, 250, 300], fov: 55, hero: [-900, 0, 150, -Math.PI / 2] },
  turn: { pos: [1500, 380, 250], look: [3900, 250, -500], fov: 55, hero: [2100, 0, 100, Math.PI / 2] },
  cars: { pos: [1500, 260, 700], look: [2150, 160, 1300], fov: 50, hero: [1450, 22, 1150, 0.7] },
  roof: { pos: [-1300, 900, 300], look: [600, 450, 1900], fov: 45, hero: [-100, 644, 1967.5, -Math.PI / 2] },
  retro: { pos: [0, 346, -82], look: [0, 303, 1156], fov: 45, retro: true },
  tree: { pos: [640, 260, 380], look: [1050, 470, 850], fov: 50, hero: [760, 22, 520, 0.7] },
  villa: { pos: [-2150, 330, -520], look: [-2450, 520, -1650], fov: 55, hero: [-2700, 160, -1150, 0.4] },
};

const out = opt('out', 'shots/real');
const views = opt('views', Object.keys(VIEWS).join(',')).split(',');
const sizes = opt('sizes', '960x540,1280x720').split(',').map((s) => s.split('x').map(Number));
const looks = opt('looks', 'high,low,classic').split(',');
fs.mkdirSync(path.resolve(root, out), { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  for (const look of looks) {
    for (const [width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => {
        failed = true;
        console.log(`[pageerror] ${e.stack || e.message}`);
      });
      page.on('console', (m) => m.type() === 'error' && console.log(`[browser error] ${m.text()}`));
      const query = look === 'classic' ? 'look=classic' : `tier=${look}`;
      await page.goto(`${base}/?test=1&mute=1&area=lane&${query}`, { waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
      if (look !== 'classic') await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 180000, polling: 250 });
      // Native size for the classic look too (its saved default is the retro filter).
      await page.evaluate((classic) => {
        if (classic) window.__game.view.setN64Mode(false);
        document.getElementById('ui').style.visibility = 'hidden';
        window.__game.step(30);
      }, look === 'classic');
      for (const name of views) {
        const v = VIEWS[name];
        const line = await page.evaluate(([v, classic]) => {
          const g = window.__game;
          const view = g.view;
          const o = g.areas.current.def.origin;
          const [hx, hy, hz, yaw] = v.hero ?? [0, 22, 1156, Math.PI];
          g.player.teleport(hx + o.x, hy + o.y, hz + o.z, yaw);
          g.player.setAction('idle');
          g.camera.reset(g.player);
          g.step(5);
          if (v.retro) (classic ? view.setN64Mode(true) : view.toggleRetro());
          const cam = view.camera;
          cam.fov = v.fov;
          cam.position.set(v.pos[0] + o.x, v.pos[1] + o.y, v.pos[2] + o.z);
          cam.lookAt(v.look[0] + o.x, v.look[1] + o.y, v.look[2] + o.z);
          cam.updateProjectionMatrix();
          view.setFocus({ x: v.look[0] + o.x, y: 0, z: v.look[2] + o.z });
          g.areas.update(1, cam); // (what follows the camera: the realistic look's grass)
          view.render();
          const info = view.renderer.info.render;
          return `${view.describeMode()}: ${info.calls} calls, ${info.triangles} triangles`;
        }, [v, look === 'classic']);
        const file = path.join(out, `${look}-${name}-${width}.png`);
        await page.screenshot({ path: path.resolve(root, file) });
        console.log(`${file}  ${line}`);
        if (v.retro) await page.evaluate((classic) => (classic ? window.__game.view.setN64Mode(false) : window.__game.view.toggleRetro()), look === 'classic');
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
