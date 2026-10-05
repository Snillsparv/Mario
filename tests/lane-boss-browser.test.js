// STOMPWATT, Sparrow Lane's boss, in the real game (Vite dev server, headless Chromium), opt-in:
// E2E=1. In the classic look and on the realistic look's tiers (high: the whole story; mid and
// low: its draw calls): the lane's lazy chunk attaches (window.__game.laneBoss resolves with its
// boss); the dad's car parked (its faces drawn by the street's meshes); Jonas walks up to it and
// it wakes into its intro (Jonas held: the stick does nothing, its name card shows); mid-morph G
// swaps the look (on high: classic and back) and it carries on, the right model drawing, the
// parked car hidden in both looks' meshes; it stands up for the fight (the draw calls and
// triangles with it up, a stomp's marker out and kneeling at the charger with its cable, within
// the tier's budgets); Jonas walks off and it goes home and parks: its collider back (Jonas
// stands on its roof), the car drawn again. And the fight (classic and high): won end to end by
// scripted input (tests/helpers/laneBossPolicy.js, through the dev server: the stick and the
// buttons each tick from the boss's state), G pressed after the first hit and again after the
// second (the fight carries on in the other look), the car reversed into its slot (Jonas stands
// on its roof), its reward star collected (+1 star, no star exit: still in the lane). No page
// errors.
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

// The tiers' budgets with the robot up and fighting (the shadow pass and the post chain included).
const BUDGET = { classic: { calls: 55, triangles: 60000 }, high: { calls: 175, triangles: 1000000, programs: 24 }, mid: { calls: 145, triangles: 500000, programs: 24 }, low: { calls: 100, triangles: 220000, programs: 18 } };

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
      assert.equal(up.state, 'stand', 'up for the fight');
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
      const within = (f, what) => {
        assert.ok(f.calls <= B.calls, `${what}: ${f.calls} draw calls`);
        assert.ok(f.triangles <= B.triangles, `${what}: ${f.triangles} triangles`);
        if (B.programs) assert.ok(f.programs <= B.programs, `${what}: ${f.programs} realistic programs`);
      };
      within(f, 'up');
      // Two fight framings through the game's own camera: a stomp's ring out under him, and the
      // robot kneeling at the charger with its cable, the hatch open, him behind it.
      for (const [what, moment] of [['stomp', 'stomp_tell'], ['window', 'open']]) {
        const fr = await page.evaluate(async (moment) => {
          const g = window.__game;
          const { boss } = await g.laneBoss;
          const o = g.areas.current.def.origin;
          if (moment === 'open') boss.setIndex = 99;
          g.step(900, {}, () => {
            if (moment === 'open' && boss.state !== 'open') {
              g.player.teleport(2400 + o.x, 22 + o.y, 650 + o.z, -0.6);
              g.player.setAction('idle');
            }
            return boss.state === moment && boss.t >= 14;
          });
          if (moment === 'open') {
            const c = boss.cur;
            g.player.teleport(c.x - Math.sin(c.yaw) * 320, 22 + o.y, c.z - Math.cos(c.yaw) * 320, c.yaw);
            g.player.setAction('idle');
            g.step(40);
          }
          return { state: boss.state, ring: boss.markers.ring.on, cable: boss.cable.mesh.visible };
        }, moment).then(async (st) => ({ ...st, ...(await frame(page)) }));
        t.diagnostic(`${label} fight (${what}): ${JSON.stringify(fr)}`);
        within(fr, what);
      }
      // He walks off: it folds back and parks, its collider back (he stands on its roof).
      const parked = await page.evaluate(async () => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        const o = g.areas.current.def.origin;
        g.player.teleport(1900 + o.x, 22 + o.y, -1400 + o.z, 0);
        g.player.setAction('idle');
        let n = 0;
        for (; n < 900 && boss.state !== 'parked'; n += 10) g.step(10);
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

// The fight won end to end by scripted input (tests/helpers/laneBossPolicy.js through the dev
// server), G after the first hit and again after the second.
for (const [label, query] of [['classic', '&look=classic'], ['high', '&tier=high']]) {
  test(`STOMPWATT's fight (${label}): won by scripted input in three hits, G pressed mid-fight twice, the car reversed home and its star collected (no star exit)`, { skip, timeout: 900000 }, async (t) => {
    const { page, errors } = await open(query);
    try {
      // The scripted player, installed in the page: the stick and buttons read each tick.
      const start = await page.evaluate(async () => {
        const g = window.__game;
        const { boss } = await g.laneBoss;
        const { policy } = await import('/tests/helpers/laneBossPolicy.js');
        const { FIGHT } = await import('/src/objects/laneBoss/tuning.js');
        let at = -1;
        let cur = null;
        const get = () => {
          if (at !== g.state.frame) {
            at = g.state.frame;
            cur = policy(boss, g.player, g.camera.getYaw(), at, { FIGHT });
          }
          return cur;
        };
        window.__fight = {
          boss,
          pol: { get stickX() { return get().stickX; }, get stickY() { return get().stickY; }, get A() { return get().A; }, get B() { return get().B; } },
          stars: g.player.stars,
          lives: g.state.lives,
          hurts: 0,
          log: [],
        };
        g.events.on('hurt', () => window.__fight.hurts++);
        g.events.on('laneBoss', (e) => window.__fight.log.push(e.phase));
        g.events.on('starCollected', (e) => window.__fight.log.push(e.boss ? 'star' : 'lane-star'));
        const o = g.areas.current.def.origin;
        g.player.teleport(1900 + o.x, 22 + o.y, 1000 + o.z, 0);
        g.player.setAction('idle');
        g.camera.reset(g.player);
        g.step(400, {}, () => boss.state === 'stand');
        return { state: boss.state, stars: g.player.stars };
      });
      assert.equal(start.state, 'stand', 'up for the fight');
      const swaps = [];
      for (let round = 0; round < 3; round++) {
        // Fought to the next hit (or the star at the end).
        const r = await page.evaluate(async (round) => {
          const g = window.__game;
          const F = window.__fight;
          const want = round + 1;
          let n = 0;
          for (; n < 5000 && F.boss.hits < want; n += 60) g.step(60, F.pol, () => F.boss.hits >= want);
          return { hits: F.boss.hits, state: F.boss.state, n, mode: g.view.describeMode(), area: g.area };
        }, round);
        t.diagnostic(`${label} round ${round + 1}: ${JSON.stringify(r)}`);
        assert.equal(r.hits, round + 1, `hit ${round + 1}`);
        // G after the first and the second hit: the other look, the fight carrying on.
        if (round < 2) {
          const from = await page.evaluate(() => {
            const g = window.__game;
            const classic = !g.view.describeMode().startsWith('real');
            g.areas.setClassic(!classic);
            return classic;
          });
          // (Into the realistic look: built in the background the first time, the fight frozen
          // meanwhile; back to the classic one at once.)
          if (from) await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 400000, polling: 500 });
          const sw = await page.evaluate(() => {
            const g = window.__game;
            const F = window.__fight;
            g.step(30, F.pol);
            const b = F.boss;
            return { mode: g.view.describeMode(), classicShown: b.classic.group.visible, realShown: b.realModel?.group.visible ?? false, state: b.state, hits: b.hits };
          }).then((r) => ({ ...r, from }));
          swaps.push(sw);
          t.diagnostic(`${label} G: ${JSON.stringify(sw)}`);
          const real = sw.mode.startsWith('real');
          assert.equal(real, from, `G: the ${from ? 'realistic' : 'classic'} look`);
          assert.equal(sw.classicShown, !real, `the classic model ${real ? 'hidden' : 'drawn'}`);
          assert.equal(sw.realShown, real, `the realistic model ${real ? 'drawn' : 'hidden'}`);
        }
      }
      // Beaten: it folds back, reverses in, tame; its star rises and is fetched.
      const end = await page.evaluate(async () => {
        const g = window.__game;
        const F = window.__fight;
        let n = 0;
        for (; n < 3000 && !F.log.includes('star'); n += 60) g.step(60, F.pol, () => F.log.includes('star'));
        const o = g.areas.current.def.origin;
        const roof = g.areas.current.collision.findFloor(1900 + o.x, 1000, 1445 + o.z).y - o.y;
        g.step(120);
        g.player.teleport(1900 + o.x, 300 + o.y, 1445 + o.z, 0);
        g.player.setAction('idle');
        g.step(20);
        return { n, state: F.boss.state, beaten: F.boss.beaten, stars: g.player.stars - F.stars, lives: g.state.lives - F.lives, hurts: F.hurts, log: F.log, area: g.area, warp: g.areas.warp?.kind ?? null, roof, stands: g.player.pos.y - o.y };
      });
      t.diagnostic(`${label} end: ${JSON.stringify(end)}`);
      assert.equal(end.state, 'tame');
      assert.equal(end.beaten, true);
      assert.ok(end.log.includes('star'), 'its star collected');
      assert.equal(end.stars, 1, '+1 star');
      assert.equal(end.area, 'lane', 'still in the lane: no star exit');
      assert.equal(end.warp, null);
      assert.equal(end.lives, 0, 'no life lost');
      assert.equal(end.roof, 257, 'its collider back');
      assert.ok(Math.abs(end.stands - 257) < 1, `he stands on its roof (${end.stands})`);
      assert.deepEqual(end.log.filter((p) => p === 'hit').length, 3);
      assert.equal(swaps.length, 2);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
