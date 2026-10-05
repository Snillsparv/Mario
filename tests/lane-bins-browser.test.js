// Sparrow Lane's movable bins in the real game (Vite dev server, headless Chromium), opt-in:
// E2E=1. In the classic look and on the realistic look's high tier: the lane's lazy chunk
// attaches (window.__game.laneBoss resolves with its bins); Jonas grabs the dad's first bin with
// the touch controller's B (a tap), pulls it out of its slot by the gable with the stick, pushes
// it back a little and lets go: the bin's collider and the drawn bin (the look's instanced mesh,
// both looks' alike) follow; walking into it pushes it; left alone with him far away it rolls
// home. No page errors.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

for (const [label, query] of [['classic', '&look=classic'], ['high', '&tier=high']]) {
  test(`the bins (${label}): grabbed with the touch B, pulled out and pushed back, both looks' instances following; walked into, pushed; left alone, home again`, { skip, timeout: 900000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(`${base}/?test=1&mute=1&area=lane${query}`, { timeout: 240000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
      if (label !== 'classic') await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 300000, polling: 250 });
      const attached = await page.evaluate(async () => {
        const lane = await window.__game.laneBoss;
        // (The dad's car stays a car meanwhile: playing with the bins beside it would wake it, and
        // its intro would hold him.)
        if (lane?.boss) lane.boss.armed = false;
        return { bins: lane?.bins?.list.length ?? 0 };
      });
      assert.deepEqual(attached, { bins: 2 });
      const r = await page.evaluate(async () => {
        const g = window.__game;
        const { bins } = await g.laneBoss;
        const area = g.areas.current;
        const o = area.def.origin;
        const b = bins.list[0];
        const local = () => ({ x: b.x - o.x, z: b.z - o.z });
        // (The stick toward a world yaw, through the camera.)
        const toward = (yaw) => {
          const a = g.camera.getYaw() - yaw;
          return { stickX: Math.sin(a), stickY: Math.cos(a) };
        };
        const meshes = () => [area.parts[0].movers.bins, area.real?.movers?.bins].filter(Boolean);
        const drawnZ = () => meshes().map((m) => m.instanceMatrix.array[14]);
        g.player.teleport(1665 + o.x, 22 + o.y, 1480 + o.z, 0);
        g.player.setAction('idle');
        g.step(3);
        // The touch controller's B (a tap: down for a tick, then released).
        g.input.setTouchState({ stickX: 0, stickY: 0, B: true });
        g.step(1);
        g.input.setTouchState(null);
        const grabbed = g.player.action;
        // (A batch of ticks draws once: the realistic look's frames are slow in SwiftShader. The
        // stick read along his facing: the camera may turn a little meanwhile.)
        g.step(60, toward(Math.PI));
        const pulled = { ...local(), anim: g.player.anim, drawn: drawnZ() };
        g.step(10, toward(0));
        const pushed = local();
        g.step(1, { B: true });
        g.step(2);
        const let_go = g.player.action;
        // Walked into from the north: pushed south a little.
        g.player.teleport(1665 + o.x, 22 + o.y, b.z - 45 - 120, 0);
        g.player.setAction('idle');
        const z0 = b.z;
        g.step(40, toward(0));
        const walkedInto = b.z - z0;
        // Far away: it rolls home.
        g.player.teleport(-1500 + o.x, 22 + o.y, 900 + o.z, 0);
        g.player.setAction('idle');
        g.step(700);
        return { grabbed, pulled, pushed, let_go, walkedInto, home: local(), drawnHome: drawnZ(), fps: g.view.describeMode() };
      });
      assert.equal(r.grabbed, 'bin_hold', 'the touch B grabs it');
      assert.ok(r.pulled.z < 1600 - 300 && r.pulled.x === 1665 && r.pulled.anim === 'bin_pull', `pulled out: ${JSON.stringify(r.pulled)}`);
      for (const z of r.pulled.drawn) assert.ok(Math.abs(z - r.pulled.z) < 2, `drawn where it is, tipped toward him (${r.pulled.drawn})`);
      assert.equal(r.pulled.drawn.length, label === 'classic' ? 1 : 2, 'both looks\' meshes posed');
      assert.ok(r.pushed.z > r.pulled.z + 50, 'pushed back');
      assert.equal(r.let_go, 'idle');
      assert.ok(r.walkedInto > 60, `walked into, it slid (${r.walkedInto})`);
      assert.deepEqual({ x: r.home.x, z: r.home.z }, { x: 1665, z: 1600 }, 'home again');
      for (const z of r.drawnHome) assert.ok(Math.abs(z - 1600) < 1e-3, 'drawn at home');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
