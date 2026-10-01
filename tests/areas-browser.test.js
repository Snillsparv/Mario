// Areas in the real game (Vite dev server, headless Chromium), opt-in: E2E=1. With ?test=1:
// walking up to the castle door starts the warp (AI RACE switched on while it closes is
// ignored); the iris (a canvas under the HUD) closes on Jonas, black at the corners and clear on
// him; 40 steps later he is in the Great Hall: the picture is the hall's warm fog and walls, not
// the sky, in fewer than 45 draw calls, and the pause screen names the course; setDark(true) in
// the hall is ignored; the inner door takes him back out onto the porch with the camera in front
// of him; ?area=hall boots straight into the hall (its furnished picture, and the bottle's end
// from the landing, each in fewer than 45 draw calls; the hall's own textures at most 128 px),
// and a stick held forward through the inner door walks him on out across the porch instead of
// back in. No page errors anywhere.
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

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?test=1&mute=1${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  // Walk toward world yaw `yaw` (the stick worked out from the camera each tick) until a warp
  // starts, at most n ticks; returns the warp.
  await page.evaluate(() => {
    window.__walkTo = (yaw, n) => {
      const g = window.__game;
      for (let i = 0; i < n && !g.snapshot().warp; i++) {
        const a = Math.atan2(Math.sin(g.camera.getYaw() - yaw), Math.cos(g.camera.getYaw() - yaw));
        g.step(1, { stickX: Math.sin(a), stickY: Math.cos(a) });
      }
      return g.snapshot().warp;
    };
  });
  const step = (n, input = null) => page.evaluate(([k, i]) => window.__game.step(k, i), [n, input]);
  const snap = () => page.evaluate(() => window.__game.snapshot());
  return { page, errors, step, snap };
}

// The drawn picture: draw calls and a few pixels (read right after a draw, before the swap).
const frame = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    g.render();
    const gl = g.view.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const pixels = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.8], [0.2, 0.6], [0.8, 0.6]]) {
      gl.readPixels(Math.floor(fx * w), Math.floor(fy * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      pixels.push([px[0], px[1], px[2]]);
    }
    return { calls: g.view.renderer.info.render.calls, triangles: g.view.renderer.info.render.triangles, pixels };
  });

// The sky's blue (FOG_COLOR, the grounds' horizon) and anything like it.
const skyBlue = ([r, g, b]) => b > r + 40 && b > 150;

test('through the castle door into the Great Hall and back out onto the porch', { skip, timeout: 600000 }, async (t) => {
  const { page, errors, step, snap } = await open();
  try {
    await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(0, 300, -460, Math.PI); // on the porch, facing the door
      g.player.setAction('idle');
      g.camera.reset(g.player);
    });
    const warp = await page.evaluate(() => window.__walkTo(Math.PI, 30));
    assert.deepEqual(warp, { phase: 'close', to: 'hall', entry: 'front', kind: 'door' });
    // AI RACE cannot start while the door takes him in (the storm stays on the grounds).
    await page.evaluate(() => window.__game.setDark(true));
    // Half way through the close: the iris shows under the HUD, black at the corners, clear on Jonas.
    await step(7);
    const iris = await page.evaluate(() => {
      const g = window.__game;
      const c = document.querySelector('.cg-wipe');
      const ctx = c.getContext('2d');
      const hero = g.model.object3D.position.clone();
      hero.y += 100;
      hero.project(g.view.camera);
      const at = (x, y) => ctx.getImageData(Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y)), 1, 1).data[3];
      return {
        display: getComputedStyle(c).display,
        underHud: !!(c.compareDocumentPosition(g.hud.el) & Node.DOCUMENT_POSITION_FOLLOWING),
        corner: at(0, 0),
        hero: at(((hero.x + 1) / 2) * c.width, ((1 - hero.y) / 2) * c.height),
        amount: g.areas.wipe(1).amount,
      };
    });
    assert.equal(iris.display, 'block');
    assert.ok(iris.underHud, 'the HUD draws over it');
    assert.equal(iris.corner, 255);
    assert.equal(iris.hero, 0);
    assert.ok(iris.amount > 0.3 && iris.amount < 0.7, `${iris.amount}`);
    await step(40);
    let s = await snap();
    assert.equal(s.area, 'hall');
    assert.equal(s.warp, null);
    assert.equal(await page.evaluate(() => window.__game.state.dark), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cg-wipe')).display), 'none');
    const hall = await frame(page);
    t.diagnostic(`hall: ${hall.calls} draw calls, ${hall.triangles} triangles, built in ${(await page.evaluate(() => window.__game.areas.buildMs.hall)).toFixed(1)} ms`);
    assert.ok(hall.calls < 45, `${hall.calls} draw calls`);
    for (const p of hall.pixels) assert.ok(!skyBlue(p), `no sky in the hall: ${p}`);
    // The pause screen names the course.
    await step(1, { START: true });
    assert.equal(await page.evaluate(() => window.__game.hud.course), 'THE GREAT HALL');
    await step(1); // (START let go, so the next press is a fresh one)
    await step(1, { START: true });
    assert.equal((await snap()).mode, 'play');
    assert.equal(await page.evaluate(() => window.__game.state.paused), false);
    // AI RACE cannot start indoors.
    await page.evaluate(() => window.__game.setDark(true));
    await step(10);
    assert.equal(await page.evaluate(() => window.__game.state.dark), false);
    // South through the inner door: back on the porch, walking out, the camera in front of him.
    const out = await page.evaluate(() => window.__walkTo(0, 150));
    assert.deepEqual(out, { phase: 'close', to: 'grounds', entry: 'porch', kind: 'door' });
    await step(40);
    s = await snap();
    assert.equal(s.area, 'grounds');
    assert.ok(Math.abs(s.pos.x) < 5 && s.pos.z > -470 && s.pos.z < -250 && s.pos.y > 200, JSON.stringify(s.pos));
    assert.ok(s.cameraPos[2] > s.pos.z + 800, `camera in front of him: ${s.cameraPos.map(Math.round)}`);
    assert.equal(await page.evaluate(() => window.__game.hud.course), 'CASTLE GROUNDS');
    const grounds = await frame(page);
    assert.ok(grounds.calls > hall.calls, `the grounds are back: ${grounds.calls} calls`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?area=hall boots straight into the Great Hall; forward held through the inner door walks him on out', { skip, timeout: 300000 }, async () => {
  const { page, errors, snap } = await open('&area=hall');
  try {
    const s = await snap();
    assert.equal(s.area, 'hall');
    assert.deepEqual([s.pos.x, s.pos.y, s.pos.z], [0, 0, -60000 + 1550]);
    const f = await frame(page);
    assert.ok(f.calls < 45, `${f.calls} draw calls`);
    for (const p of f.pixels) assert.ok(!skyBlue(p), `no sky in the hall: ${p}`);
    // Out of the bottle onto the landing, looking past him at the bottle and its model.
    await page.evaluate(() => {
      window.__game.enterArea('hall', 'bottle');
      window.__game.step(20);
    });
    const end = await frame(page);
    assert.ok(end.calls < 45, `the bottle's end: ${end.calls} draw calls`);
    const sizes = await page.evaluate(async () => {
      const textures = await import('/src/world/hall/textures.js');
      return Object.entries(textures).map(([name, make]) => {
        const { image } = make();
        return [name, image.width, image.height];
      });
    });
    assert.ok(sizes.length > 0);
    for (const [name, w, h] of sizes) assert.ok(w <= 128 && h <= 128, `${name}: ${w} x ${h}`);
    // Facing the inner door with the camera behind him, forward held all the way: out onto the
    // porch (where the camera looks at the door) and on away from it, not back in.
    const run = await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(0, 0, -60000 + 2000, 0);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      const areas = [];
      g.events.on('areaChange', (e) => areas.push(e.to));
      for (let n = 0; n < 150 && !(areas.length && g.snapshot().warp === null); n++) g.step(1, { stickY: 1 });
      g.step(90, { stickY: 1 });
      return { areas, area: g.area, z: g.snapshot().pos.z };
    });
    assert.deepEqual(run.areas, ['grounds']);
    assert.equal(run.area, 'grounds');
    assert.ok(run.z > 0, `walked out across the courtyard: z ${Math.round(run.z)}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
