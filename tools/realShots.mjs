#!/usr/bin/env node
// Sparrow Lane's realistic look from fixed camera poses (the acceptance shots: render/real/*),
// beside the classic look for comparison. Starts its own Vite dev server and headless Chromium
// (SwiftShader) like tools/shot.mjs, boots the game straight into the lane, waits for the
// realistic look to swap in, hides the HUD, and for each view puts Jonas and the camera there
// and draws one frame (the camera set after the game's own: no follow camera in the picture);
// the follow views (f-*) instead show the game's own camera behind him after a few steps (the
// realistic look's camera profile: its framing), and the contact checks Jonas, drawn smaller in
// the realistic look, holding on (hang: from the dad's front eave, seen from the side; pole: on
// the junction's lamppost).
//
// Usage:
//   node tools/realShots.mjs --out shots/real
//   node tools/realShots.mjs --out shots/real --views arrival,door --sizes 960x540 \
//     --looks high,classic
// Options: --views (default all: arrival, door, west, turn, cars, roof, retro, tree: the dad's
// red-leaf tree close up, villa: a villa up the hill close up, kerb and carclose: close-ups,
// garage: the double garage's corner, balcony: north_3's balcony,
// f-arrival (the walk out of the dad's door), f-west, f-cars, f-turn, hang, pole; B1: ev37, ev36,
// evfront, evside, evrear, evleft (the dad's car), bins-home, bins-pulled, bins-pushed,
// bins-return; B2: morph-000 .. morph-100 (STOMPWATT, the lane's boss, posed by hand a quarter of
// its transformation apart, from the street), robot-front, robot-q34, robot-back, robot-scale
// (Jonas beside it), robot-flex, robot-wave, intro-040, intro-090, intro-135 (its first wake
// through the game's own camera: rising, mid-morph, flexing), gswap (mid-morph, the look swapped
// with G: the other look's model carrying on)), --sizes
// (default 960x540,1280x720), --looks (default high,low,classic: a tier, or classic). A frame
// on SwiftShader takes seconds: each screenshot waits up to three minutes.
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
  kerb: { pos: [-150, 95, -60], look: [-1100, 10, 230], fov: 50, hero: [-700, 0, 0, -Math.PI / 2] },
  carclose: { pos: [1640, 190, 820], look: [2080, 120, 1330], fov: 42, hero: [1250, 22, 1000, 0.6] },
  // The double garage's south-west corner (its downpipe, the clips' rust), north_3's balcony.
  garage: { pos: [4760, 210, 470], look: [5250, 230, 60], fov: 45, hero: [4950, 0, 260, 2.4] },
  balcony: { pos: [-1250, 470, -1750], look: [-850, 610, -2400], fov: 45 },
  // The game's camera behind him: out of the dad's door (the arrival's walk-in, then standing),
  // or from a spot facing `yaw` after `walk` ticks pushing the stick forward and `rest` idle.
  'f-arrival': { follow: { entry: 'home', rest: 50 } },
  'f-west': { follow: { hero: [-500, 0, 150, -Math.PI / 2], walk: 10, rest: 6 } },
  'f-cars': { follow: { hero: [1500, 22, 900, 0.5], walk: 6, rest: 40 } },
  'f-turn': { follow: { hero: [1700, 0, 120, Math.PI / 2], walk: 10, rest: 40 } },
  // Contact checks: a standing jump at the dad's front wall grabs the eave (seen from the side);
  // a jump at the junction's lamppost grabs it.
  hang: { grab: { hero: [-500, 22, 1220, 0], jump: true }, pos: [-920, 330, 1070], look: [-500, 360, 1330], fov: 35 },
  pole: { grab: { hero: [-8120, 0, 1360, 0], pole: [-8120, 1590] }, pos: [-8420, 240, 1420], look: [-8120, 200, 1590], fov: 40 },
  // The dad's car (B1): from the drive's mouth and from the north-east (where the reference photos
  // were taken, the photos themselves never in the repo), its nose, tail and left side close up.
  ev37: { pos: [2120, 235, 220], look: [2060, 120, 1500], fov: 50, hero: [-600, 22, 900, Math.PI] },
  ev36: { pos: [2560, 235, 330], look: [1820, 110, 1500], fov: 50, hero: [-600, 22, 900, Math.PI] },
  evfront: { pos: [1735, 262, 830], look: [1915, 95, 1230], fov: 42, hero: [-600, 22, 900, Math.PI] },
  evside: { pos: [2330, 250, 840], look: [1930, 105, 1420], fov: 46, hero: [-600, 22, 900, Math.PI] },
  evrear: { pos: [1700, 210, 2250], look: [1900, 110, 1600], fov: 42, hero: [-600, 22, 900, Math.PI] },
  evleft: { pos: [1430, 210, 1120], look: [1900, 140, 1480], fov: 46, hero: [-600, 22, 900, Math.PI] },
  // The bins (B1): at home; Jonas holding one he has pulled out onto the drive; pushing one.
  'bins-home': { pos: [1705, 330, 1190], look: [1665, 110, 1660], fov: 50, hero: [1700, 22, 1000, Math.PI] },
  'bins-pulled': { bins: { hero: [1665, 22, 1480, 0], pull: 45 }, pos: [1420, 240, 960], look: [1690, 110, 1330], fov: 45 },
  'bins-pushed': { bins: { hero: [1665, 22, 1480, 0], pull: 100, push: [0, 22, 0, -Math.PI / 2], walk: 40 }, pos: [1560, 240, 640], look: [1800, 110, 1000], fov: 45 },
  // ...and one left alone rolling home (Jonas gone off down the street).
  'bins-return': { bins: { hero: [1665, 22, 1480, 0], pull: 70, away: 440 }, pos: [1420, 240, 960], look: [1690, 110, 1330], fov: 45 },
  // STOMPWATT (B2): posed by hand (robot: the morph, its pose, its heading off the car's), or its
  // first wake run through its own steps to `intro` ticks in (the game's camera: its intro shot;
  // `swap`: then G, the other look drawing it).
  ...Object.fromEntries([0, 25, 50, 75, 100].map((m) => [`morph-${String(m).padStart(3, '0')}`, { robot: { m: m / 100 }, pos: [2420, 420, 640], look: [1900, 330, 1445], fov: 50 }])),
  'robot-front': { robot: { m: 1 }, pos: [1960, 330, 330], look: [1900, 360, 1445], fov: 50 },
  'robot-q34': { robot: { m: 1 }, pos: [2420, 420, 640], look: [1900, 340, 1445], fov: 50 },
  'robot-back': { robot: { m: 1, yaw: Math.PI }, pos: [1960, 330, 330], look: [1900, 360, 1445], fov: 50 },
  'robot-scale': { robot: { m: 1 }, pos: [2380, 300, 420], look: [1950, 260, 1200], fov: 50, hero: [2060, 22, 1020, Math.PI * 0.85] },
  'robot-flex': { robot: { m: 1, pose: 'flex' }, pos: [1960, 330, 330], look: [1900, 380, 1445], fov: 50 },
  'robot-wave': { robot: { m: 1, pose: 'wave' }, pos: [2420, 420, 640], look: [1900, 340, 1445], fov: 50 },
  'intro-040': { intro: 40 },
  'intro-090': { intro: 90 },
  'intro-135': { intro: 135 },
  gswap: { intro: 85, swap: true },
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
      await page.evaluate(() => window.__game.laneBoss); // (the lane's lazy chunk: the bins move)
      // (The dad's car stays a car unless a view wakes or poses it: Jonas near it would wake it.)
      await page.evaluate(async () => {
        const { boss } = await window.__game.laneBoss;
        if (boss) boss.armed = false;
      });
      // Native size for the classic look too (its saved default is the retro filter).
      await page.evaluate((classic) => {
        if (classic) window.__game.view.setN64Mode(false);
        document.getElementById('ui').style.visibility = 'hidden';
        window.__game.step(30);
      }, look === 'classic');
      for (const name of views) {
        const v = VIEWS[name];
        const line = await page.evaluate(async ([v, classic]) => {
          const g = window.__game;
          const view = g.view;
          const o = g.areas.current.def.origin;
          const info = () => {
            const r = view.renderer.info.render;
            return `${view.describeMode()}: ${r.calls} calls, ${r.triangles} triangles (Jonas ${g.player.action}, model ${g.model.object3D.scale.y.toFixed(2)}, fov ${view.camera.fov.toFixed(0)})`;
          };
          const { boss } = await g.laneBoss;
          if (v.intro) {
            // Its first wake: Jonas walked up to the car, the intro run to that tick, drawn through
            // the game's own camera (then G: the other look).
            boss.reset();
            g.player.teleport(1900 + o.x, 22 + o.y, 1000 + o.z, 0);
            g.player.setAction('idle');
            g.camera.reset(g.player);
            for (let n = 0; n < 80 && boss.state !== 'wake'; n++) g.step(1);
            g.step(v.intro);
            if (v.swap) {
              g.areas.setClassic(!classic);
              view.setN64Mode(false); // (the classic look's own picture, not through the retro TV)
              g.step(2);
            }
            g.render();
            const line = `${info()} [${boss.state} m ${boss.cur.m.toFixed(2)}]`;
            if (!v.swap) {
              boss.pose(null);
              boss.armed = false;
            }
            return line;
          }
          if (v.robot) boss.pose({ m: v.robot.m, pose: v.robot.pose ?? 'stand', yaw: v.robot.yaw !== undefined ? Math.PI + v.robot.yaw : undefined });
          else boss.pose(null);
          if (v.follow) {
            const f = v.follow;
            if (f.entry) g.enterArea('lane', f.entry);
            else {
              const [hx, hy, hz, yaw] = f.hero;
              g.player.teleport(hx + o.x, hy + o.y, hz + o.z, yaw);
              g.player.setAction('idle');
              g.camera.reset(g.player);
              g.step(f.walk, { stickY: 1 });
            }
            g.step(f.rest);
            return info();
          }
          const [hx, hy, hz, yaw] = v.bins?.hero ?? v.grab?.hero ?? v.hero ?? [0, 22, 1156, Math.PI];
          g.player.teleport(hx + o.x, hy + o.y, hz + o.z, yaw);
          g.player.setAction('idle');
          g.camera.reset(g.player);
          g.step(v.grab ? 2 : 5);
          if (v.bins) {
            // The lane's bins (its lazy chunk, attached once in): grab the first with B, pull it
            // out `pull` ticks; then (`push`) let go, stand west of it and walk into it.
            const toward = (y) => {
              const a = g.camera.getYaw() - y;
              return { stickX: Math.sin(a), stickY: Math.cos(a) };
            };
            // (Batches of ticks: a frame drawn per batch, the realistic look's are slow here.)
            g.step(1, { B: true });
            g.step(v.bins.pull, toward(yaw + Math.PI));
            if (v.bins.push) {
              g.step(1, { B: true });
              const b = g.areas.objects.bins.list[0];
              const [, py, , pyaw] = v.bins.push;
              g.player.teleport(b.x - 55 - 140, py + o.y, b.z, -pyaw);
              g.player.setAction('idle');
              g.step(v.bins.walk, toward(-pyaw));
            }
            if (v.bins.away) {
              g.step(1, { B: true });
              g.player.teleport(-1500 + o.x, 22 + o.y, 900 + o.z, 0);
              g.player.setAction('idle');
              g.step(v.bins.away);
            }
          }
          if (v.grab) {
            // (The stick pushes along the camera's view: turn it to where he faces.)
            const push = () => {
              const a = Math.atan2(Math.sin(g.camera.getYaw() - yaw), Math.cos(g.camera.getYaw() - yaw));
              return { stickX: Math.sin(a), stickY: Math.cos(a) };
            };
            const holding = () => (v.grab.pole ? g.player.action === 'pole' : g.player.action === 'ledge_hang');
            const jump = (t) => {
              if (!v.grab.pole) return t < 15;
              const [px, pz] = v.grab.pole;
              return g.player.grounded && Math.hypot(g.player.pos.x - o.x - px, g.player.pos.z - o.z - pz) < 130;
            };
            for (let t = 0; t < 60 && !holding(); t++) g.step(1, { ...push(), A: jump(t) });
            g.step(12);
          }
          if (v.retro) (classic ? view.setN64Mode(true) : view.toggleRetro());
          const cam = view.camera;
          cam.fov = v.fov;
          cam.position.set(v.pos[0] + o.x, v.pos[1] + o.y, v.pos[2] + o.z);
          cam.lookAt(v.look[0] + o.x, v.look[1] + o.y, v.look[2] + o.z);
          cam.updateProjectionMatrix();
          view.setFocus({ x: v.look[0] + o.x, y: 0, z: v.look[2] + o.z });
          g.areas.update(1, cam); // (what follows the camera: the realistic look's grass)
          view.render();
          return info();
        }, [v, look === 'classic']);
        const file = path.join(out, `${look}-${name}-${width}.png`);
        await page.screenshot({ path: path.resolve(root, file), timeout: 180000 });
        console.log(`${file}  ${line}`);
        // (G back, the boss parked again.)
        if (v.swap) {
          await page.evaluate(async (classic) => {
            const g = window.__game;
            g.areas.setClassic(classic);
            const { boss } = await g.laneBoss;
            boss.pose(null);
            boss.armed = false;
          }, look === 'classic');
          if (look !== 'classic') await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 180000, polling: 250 });
        }
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
