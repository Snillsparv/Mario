// STOMPWATT, Sparrow Lane's boss, in the real game (Vite dev server, headless Chromium), opt-in:
// E2E=1. In the classic look and on the realistic look's tiers (high: the whole story; mid and
// low: its draw calls): the lane's lazy chunk attaches (window.__game.laneBoss resolves with its
// boss); the dad's car parked (its faces drawn by the street's meshes); Jonas walks up to it and
// it wakes into its intro (Jonas held: the stick does nothing, its name card shows); mid-morph G
// swaps the look (on high: classic and back) and it carries on, the right model drawing, the
// parked car hidden in both looks' meshes; it stands (the draw calls and triangles with it up,
// within the tier's budgets); Jonas walks off and it folds back and parks: its collider back
// (Jonas stands on its roof), the car drawn again. No page errors.
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

// The tiers' budgets with the robot up (the shadow pass and the post chain included).
const BUDGET = { classic: { calls: 55, triangles: 60000 }, high: { calls: 175, triangles: 1000000, programs: 24 }, mid: { calls: 150, triangles: 520000, programs: 24 }, low: { calls: 104, triangles: 230000, programs: 18 } };

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?test=1&mute=1&area=lane${query}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  if (!query.includes('classic')) await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 300000, polling: 250 });
  return { page, errors };
}

// Draw calls, triangles and realistic programs of a frame looking at the robot from in front.
async function frame(page) {
  return page.evaluate(() => {
    const g = window.__game;
    g.render();
    const r = g.view.renderer;
    return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.filter((p) => p.cacheKey.includes('real-')).length, mode: g.view.describeMode() };
  });
}

for (const [label, query] of [['classic', '&look=classic'], ['high', '&tier=high'], ['mid', '&tier=mid'], ['low', '&tier=low']]) {
  const story = label === 'classic' || label === 'high';
  test(`STOMPWATT (${label}): ${story ? 'woken by Jonas, its intro holding him, G mid-morph, standing within the budgets, folding back and parking, its collider back' : 'woken, standing within the budgets, parked again'}`, { skip, timeout: 900000 }, async (t) => {
    const { page, errors } = await open(query);
    try {
      const attached = await page.evaluate(async () => {
        const lane = await window.__game.laneBoss;
        return { boss: !!lane?.boss, state: lane?.boss?.state, shown: lane?.boss?.shown };
      });
      assert.deepEqual(attached, { boss: true, state: 'parked', shown: false });
      // Jonas walks up to it: it notices him, then wakes into its intro, holding him.
      const woke = await page.evaluate(async () => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        const o = g.areas.current.def.origin;
        g.player.teleport(1900 + o.x, 22 + o.y, 1000 + o.z, 0);
        g.player.setAction('idle');
        g.camera.reset(g.player);
        let n = 0;
        for (; n < 60 && boss.state !== 'wake'; n++) g.step(1);
        const at = { x: g.player.pos.x, z: g.player.pos.z };
        // (Held: the stick does nothing.)
        g.step(20, { stickX: 0, stickY: 1 });
        const moved = Math.hypot(g.player.pos.x - at.x, g.player.pos.z - at.z);
        // (The realistic contact shadow stays until the car parts.)
        return { n, state: boss.state, cinematic: boss.cinematic, moved, m: boss.cur.m, hidden: boss.hides.every((h) => h.contact || h.mesh.geometry.drawRange.count === h.first) };
      });
      assert.ok(woke.n < 40, `woke after ${woke.n} ticks`);
      assert.equal(woke.state, 'wake');
      assert.equal(woke.cinematic, true, 'the intro holds him');
      assert.ok(woke.moved < 1, `he stays put (${woke.moved})`);
      assert.equal(woke.hidden, true, 'the parked car hidden in the street\'s meshes');
      // Mid-morph (the panels flying), G swaps the look and back (high), the right model drawing.
      const mid = await page.evaluate(async (swap) => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        g.step(50);
        const out = { m: boss.cur.m };
        if (swap) {
          g.areas.setClassic(true);
          g.step(3);
          out.classic = { classic: boss.classic.group.visible, real: boss.realModel?.group.visible ?? false, mode: g.view.describeMode(), m: boss.cur.m };
          g.areas.setClassic(false);
          g.step(3);
          out.real = { classic: boss.classic.group.visible, real: boss.realModel?.group.visible ?? false, mode: g.view.describeMode(), m: boss.cur.m };
        }
        out.hidden = boss.hides.every((h) => h.mesh.geometry.drawRange.count === h.first);
        return out;
      }, label === 'high');
      assert.ok(mid.m > 0.1 && mid.m < 0.9, `mid-morph (${mid.m})`);
      if (label === 'high') {
        assert.deepEqual([mid.classic.classic, mid.classic.real], [true, false], `G: the classic model (${mid.classic.mode})`);
        assert.ok(!mid.classic.mode.startsWith('real'), mid.classic.mode);
        assert.deepEqual([mid.real.classic, mid.real.real], [false, true], `G again: the realistic model (${mid.real.mode})`);
        assert.ok(mid.real.m > mid.classic.m, 'the morph carries on');
      }
      assert.equal(mid.hidden, true, 'the parked car hidden in both looks\' meshes');
      // It stands: its name card showed (the intro), and the frame with it up.
      const up = await page.evaluate(async () => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        let card = false;
        for (let n = 0; n < 200 && boss.state === 'wake'; n++) {
          g.step(1);
          card ||= !!document.querySelector('.cg-alert');
        }
        return { state: boss.state, card, cinematic: boss.cinematic };
      });
      if (story) assert.ok(up.card, 'its name card');
      assert.equal(up.state, 'show');
      assert.equal(up.cinematic, false, 'he is free again');
      const f = await page.evaluate(() => {
        const g = window.__game;
        const o = g.areas.current.def.origin;
        g.player.teleport(1990 + o.x, 22 + o.y, 760 + o.z, 0.2);
        g.player.setAction('idle');
        g.camera.reset(g.player);
        g.step(10);
      }).then(() => frame(page));
      t.diagnostic(`${label} with the robot up: ${JSON.stringify(f)}`);
      const B = BUDGET[label];
      assert.ok(f.calls <= B.calls, `${f.calls} draw calls`);
      assert.ok(f.triangles <= B.triangles, `${f.triangles} triangles`);
      if (B.programs) assert.ok(f.programs <= B.programs, `${f.programs} realistic programs`);
      // He walks off: it folds back and parks, its collider back (he stands on its roof).
      const parked = await page.evaluate(async () => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        const o = g.areas.current.def.origin;
        g.player.teleport(1900 + o.x, 22 + o.y, -1400 + o.z, 0);
        g.player.setAction('idle');
        let n = 0;
        for (; n < 600 && boss.state !== 'parked'; n += 10) g.step(10);
        const roof = g.areas.current.collision.findFloor(1900 + o.x, 1000, 1445 + o.z).y - o.y;
        g.player.teleport(1900 + o.x, 300 + o.y, 1445 + o.z, 0);
        g.player.setAction('idle');
        g.step(20);
        return { n, state: boss.state, roof, stands: g.player.pos.y - o.y, shown: boss.shown, drawn: boss.hides.every((h) => h.mesh.geometry.drawRange.count === Infinity) };
      });
      assert.equal(parked.state, 'parked', `parked after ${parked.n} ticks`);
      assert.equal(parked.roof, 257, 'its collider back');
      assert.ok(Math.abs(parked.stands - 257) < 1, `he stands on its roof (${parked.stands})`);
      assert.equal(parked.shown, false);
      assert.equal(parked.drawn, true, 'the parked car drawn again');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
