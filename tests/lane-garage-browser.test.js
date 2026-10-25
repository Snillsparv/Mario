// D1: Sparrow Lane's garage doors in the real game (Vite dev server, headless Chromium with
// SwiftShader), opt-in: E2E=1. In the classic look and on the realistic look's high tier: the
// lane's lazy chunk attaches with its garage (four leaves); driven by __game.step(n, input), six
// attacks each smash a leaf (the jab and the cross, the combo, a jump kick, a ground pound, a dive
// through the gap between the cars, its belly slide): the shown look's boards move, the crack and
// the smash sound, splinters fly; walking in through the red door the room camera takes over
// inside the room, the coins count up and the 1-up gives a life; out again the follow camera is
// back on the drive; through the dad's front door to the hall and back the doors are whole
// again; on high, G pressed while the boards fly shows both looks in the same pose. On every
// tier: the draw calls and triangles at the drive with the doors whole and one broken, with
// boards flying, inside the room (all broken, the 1-up shown) and through STOMPWATT's first round
// with a door broken, within the tier's budgets. No page errors.
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

// The tiers' budgets (the shadow pass and the post chain included; classic: the E2E's).
const BUDGET = { classic: { calls: 55, triangles: 60000 }, high: { calls: 175, triangles: 1000000, programs: 24 }, mid: { calls: 145, triangles: 500000, programs: 24 }, low: { calls: 100, triangles: 220000, programs: 18 } };

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?test=1&mute=1&area=lane${query}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  if (!query.includes('classic')) await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 300000, polling: 250 });
  await page.evaluate(async () => {
    const g = window.__game;
    const lane = await g.laneBoss;
    // (The dad's car tame meanwhile: running up the drive past it would wake it, and its intro
    // would hold him.)
    lane.boss.beaten = true;
    lane.boss.star.awarded = true;
    lane.boss.enter();
    // (Test helpers: Jonas placed at a local point facing `yaw`, the camera behind him; every
    // leaf whole with him away.)
    const o = g.areas.current.def.origin;
    // (W4: the places from the layout: the dad's cars parked deep, a strip one Jonas wide behind
    // them along the doors; __D: a leaf's middle, the strip's z, the gap between the cars, the
    // dad's car's nose, the room's coin row.)
    const L = await import('/src/world/lane/layout.js');
    const G = L.GARAGE;
    const [EV, SUV] = L.CARS;
    const hw = (c) => L.CAR_KINDS[c.kind].w / 2;
    window.__D = { mid: (k) => (G.leaves[k].x0 + G.leaves[k].x1) / 2, SZ: G.wall - 55, gap: (EV.x + hw(EV) + SUV.x - hw(SUV)) / 2, gapWest: EV.x + hw(EV) + 54, ev: EV.x, nose: EV.z - L.CAR_KINDS[EV.kind].l / 2, wall: G.wall, row: G.wall + 300, oneUp: (await import('/src/world/lane/garage.js')).ROOM.oneUp, room: { x0: L.CARPORT.x0, x1: L.CARPORT.x1, z0: G.wall + G.thick, z1: L.CARPORT.z1, under: G.under } };
    window.__put = (x, z, yaw = 0) => {
      g.player.teleport(x + o.x, 22 + o.y, z + o.z, yaw);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      g.step(2);
    };
    window.__mend = () => lane.garage.enter({ pos: { x: 1e7, y: 0, z: 1e7 } });
    // The stick toward a world yaw in the frame he moves by (as main: the overlay's held frame
    // through the room camera, else the camera's), read each tick.
    const frame = () => g.camera.overlay?.moveYaw ?? g.camera.getYaw();
    window.__steer = (yaw) => ({
      get stickX() {
        return Math.sin(frame() - yaw);
      },
      get stickY() {
        return Math.cos(frame() - yaw);
      },
    });
    window.__objects = g.areas.current.objects;
    // Walks to a local point (the stick toward it through the camera, read each tick).
    window.__goto = (x, z, n = 120) => {
      const yaw = () => Math.atan2(x + o.x - g.player.pos.x, z + o.z - g.player.pos.z);
      const near = () => Math.hypot(x + o.x - g.player.pos.x, z + o.z - g.player.pos.z) < 30;
      g.step(n, { get stickX() { return Math.sin(frame() - yaw()); }, get stickY() { return Math.cos(frame() - yaw()); } }, near);
      g.step(6);
    };
    // A script's buttons a tick (f(i)), one frame drawn at its end (the realistic look's frames
    // are slow in SwiftShader).
    window.__run = (n, f) => {
      let k = 0;
      let i = 0;
      const input = {
        get A() {
          return !!f(i).A;
        },
        get B() {
          return !!f(i).B;
        },
        get Z() {
          return !!f(i).Z;
        },
      };
      g.step(n, input, () => {
        i = k++;
        return false;
      });
    };
    // (The splinters thrown: Sparkles.clods calls counted.)
    const sp = window.__objects.sparkles;
    const clods = sp.clods;
    window.__clods = 0;
    sp.clods = (...a) => {
      window.__clods++;
      return clods.apply(sp, a);
    };
    window.__sfx = [];
    g.events.on('sfx', (e) => window.__sfx.push(e.name));
  });
  return { page, errors };
}

const within = (B, f, what) => {
  assert.ok(f.calls <= B.calls, `${what}: ${f.calls} draw calls`);
  assert.ok(f.triangles <= B.triangles, `${what}: ${f.triangles} triangles`);
  if (B.programs) assert.ok(f.programs <= B.programs, `${what}: ${f.programs} realistic programs`);
};

for (const [label, query] of [['classic', '&look=classic'], ['high', '&tier=high']]) {
  test(`the garage doors (${label}): six attacks each smash a leaf (the boards fly in the shown look, a crunch, splinters); in through the red door (the room camera, the coins, the 1-up), out again, and whole after the hall${label === 'high' ? '; G mid-flight shows both looks alike' : ''}`, { skip, timeout: 900000 }, async (t) => {
    const { page, errors } = await open(query);
    try {
      const attached = await page.evaluate(async () => (await window.__game.laneBoss).garage?.leaves.length ?? 0);
      assert.equal(attached, 4);
      // The attacks, each on a leaf from in front of it (local x, z, the inputs a tick).
      const r = await page.evaluate(async () => {
        const g = window.__game;
        const { garage } = await g.laneBoss;
        const shown = () => garage.shown.meshes[0].pos.array;
        const rows = [];
        const run = window.__run;
        const D = window.__D;
        const ATTACKS = [
          ['jab and cross', 0, D.mid(0), D.SZ, (i) => ({ B: i === 0 || i === 6 }), 16],
          ['combo', 1, D.mid(1), D.SZ, (i) => ({ B: i % 7 === 0 && i < 21 }), 30],
          ['jump kick', 2, D.mid(2), D.SZ, (i) => ({ A: i < 4, B: i === 4 }), 34],
          ['pound', 3, D.mid(3), D.SZ, (i) => ({ A: i < 9, Z: i === 9 }), 50],
        ];
        for (const [name, k, x, z, input, n] of ATTACKS) {
          window.__mend();
          window.__put(x, z, 0);
          const at = garage.shown.parts.find((q) => q.i === k * 5 + 2).start * 3;
          const before = Array.from(shown().slice(at, at + 30));
          const sparks = window.__clods;
          window.__sfx.length = 0;
          run(n, input);
          rows.push({ name, broken: garage.leaves[k].broken, moved: Array.from(shown().slice(at, at + 30)).some((v, j) => Math.abs(v - before[j]) > 1), sfx: window.__sfx.filter((s) => s.startsWith('door')), sparks: window.__clods > sparks });
        }
        // The dive and its belly slide, running up the gap between the cars (along the dad's car's
        // side) at the red door.
        for (const [name, diveZ] of [['dive', D.wall - 300], ['belly slide', D.wall - 650]]) {
          window.__mend();
          window.__put(D.gapWest, 300, 0);
          const on = window.__steer(0);
          g.step(80, on, () => g.player.pos.z - g.areas.current.def.origin.z >= diveZ);
          g.step(1, { stickX: on.stickX, stickY: on.stickY, B: true });
          let by = null;
          g.step(40, on, () => {
            if (garage.leaves[1].broken && !by) by = g.player.action;
            return !!by;
          });
          rows.push({ name, broken: garage.leaves[1].broken, by });
          g.step(20);
        }
        return rows;
      });
      t.diagnostic(JSON.stringify(r));
      for (const row of r) assert.ok(row.broken, `${row.name}: smashed`);
      for (const row of r.slice(0, 4)) {
        assert.ok(row.moved, `${row.name}: the boards moved in the shown look`);
        assert.ok(row.sfx.includes('door_smash') && row.sparks, `${row.name}: a crunch and splinters (${row.sfx})`);
      }
      assert.ok(r[0].sfx.includes('door_crack'), 'the jab cracks it first');
      // In through the red door: the room camera, the coins, the 1-up; out again.
      const walk = await page.evaluate(async () => {
        const g = window.__game;
        const { garage } = await g.laneBoss;
        const o = g.areas.current.def.origin;
        const D = window.__D;
        window.__mend();
        // (The dive's slide may have taken the 1-up already: back, as a new game brings it.)
        garage.gem.reset();
        // (From the strip behind the cars: B, B, not a jump kick: so close to the fascia a jump
        // grabs the row's edge.)
        window.__put(D.mid(1), D.SZ, 0);
        window.__run(16, (i) => ({ B: i === 0 || i === 6 }));
        const coins0 = g.player.coins;
        const lives0 = g.state.lives;
        g.step(60, {}, () => false);
        window.__goto(D.mid(1), D.row);
        const cam = g.camera.pos;
        const inRoom = { x: cam.x - o.x, y: cam.y - o.y, z: cam.z - o.z, w: garage.camera.w };
        for (const [x, z] of [[2380, D.row], [1800, D.row], [D.oneUp.x, D.oneUp.z - 185], [D.oneUp.x, D.oneUp.z - 60]]) window.__goto(x, z);
        const got = { coins: g.player.coins - coins0, lives: g.state.lives - lives0 };
        for (const [x, z] of [[D.mid(1), D.wall + 100], [D.mid(1), D.SZ], [D.gap, D.SZ], [D.gap, 1500]]) window.__goto(x, z);
        g.step(20);
        const out = { z: g.camera.pos.z - o.z, w: garage.camera.w, at: g.player.pos.z - o.z, wall: D.wall, room: D.room };
        return { inRoom, got, out };
      });
      t.diagnostic(JSON.stringify(walk));
      const room = walk.out.room;
      assert.equal(walk.inRoom.w, 1, 'the room camera in');
      assert.ok(walk.inRoom.x > room.x0 + 40 && walk.inRoom.x < room.x1 - 40 && walk.inRoom.z > room.z0 + 20 && walk.inRoom.z < room.z1 - 20 && walk.inRoom.y < room.under, `the camera in the room: ${JSON.stringify(walk.inRoom)}`);
      assert.ok(walk.got.coins >= 3, `coins on the HUD's count: ${walk.got.coins}`);
      assert.equal(walk.got.lives, 1, 'the 1-up: a life');
      assert.ok(walk.out.at < walk.out.wall - 350 && walk.out.w === 0 && walk.out.z < walk.out.wall - 350, `out, the follow camera on the drive: ${JSON.stringify(walk.out)}`);
      // Through the dad's front door to the hall and back: whole again.
      const back = await page.evaluate(async () => {
        const g = window.__game;
        const { garage } = await g.laneBoss;
        window.__put(window.__D.mid(2), window.__D.SZ, 0);
        window.__run(34, (i) => ({ A: i < 4, B: i === 4 }));
        const broken = garage.leaves.filter((l) => l.broken).length;
        g.enterArea('hall');
        g.step(5);
        g.enterArea('lane');
        g.step(5);
        return { broken, after: garage.leaves.filter((l) => l.broken).length };
      });
      assert.ok(back.broken >= 1 && back.after === 0, `whole after the hall: ${JSON.stringify(back)}`);
      if (label === 'high') {
        // G while the boards fly: the classic look shows them in the same pose, and back.
        const g2 = await page.evaluate(async () => {
          const g = window.__game;
          const { garage } = await g.laneBoss;
          window.__mend();
          window.__put(window.__D.mid(1), window.__D.SZ, 0);
          window.__run(9, (i) => ({ A: i < 4, B: i === 4 }));
          g.areas.setClassic(true);
          g.step(1);
          const flying = garage.pieces.filter((p) => p.state === 1).length;
          // The classic look's boards as G shows them, then (G again, no tick between) the
          // realistic look's as it is shown back: the same pose.
          const copy = garage.classic.parts.map((q) => Array.from(garage.classic.meshes[q.m].pos.array.slice(q.start * 3, (q.start + q.count) * 3)));
          g.areas.setClassic(false);
          g.render();
          const look = garage.looks.find((l) => l !== garage.classic);
          const diff = look.parts.reduce((m, r, k) => {
            const b = look.meshes[r.m].pos.array;
            let d = 0;
            for (let v = 0; v < r.count * 3; v++) d = Math.max(d, Math.abs(copy[k][v] - b[r.start * 3 + v]));
            return Math.max(m, d);
          }, 0);
          g.step(3);
          return { flying, diff, mode: g.view.describeMode(), shownReal: garage.shown !== garage.classic };
        });
        t.diagnostic(JSON.stringify(g2));
        assert.ok(g2.flying > 0, 'boards flying as G is pressed');
        assert.ok(g2.diff < 0.01, `both looks in the same pose (${g2.diff})`);
        assert.ok(g2.mode.startsWith('real') && g2.shownReal, 'the realistic look back, its boards shown');
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

for (const [label, query] of [['classic', '&look=classic'], ['high', '&tier=high'], ['mid', '&tier=mid'], ['low', '&tier=low']]) {
  test(`the garage's budgets (${label}): the drive with the doors whole and one broken, boards flying, inside the room (all broken, the 1-up shown), STOMPWATT's first round with a door broken`, { skip, timeout: 900000 }, async (t) => {
    const { page, errors } = await open(query);
    try {
      const views = await page.evaluate(async () => {
        const g = window.__game;
        const { garage } = await g.laneBoss;
        const r = g.view.renderer;
        const o = g.areas.current.def.origin;
        const frame = () => {
          g.render();
          return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.filter((p) => p.cacheKey.includes('real-')).length };
        };
        const out = {};
        window.__put(2099, 900, 0);
        g.step(20);
        out.driveWhole = frame();
        garage._smash(garage.leaves[1], 2082 + o.x, 1, 0);
        g.step(120);
        out.driveBroken = frame();
        window.__mend();
        window.__put(2099, 1400, 0);
        for (const k of [0, 1, 2]) garage._smash(garage.leaves[k], (garage.leaves[k].x0 + garage.leaves[k].x1) / 2, 1, 0);
        g.step(4);
        out.fly = frame();
        garage._smash(garage.leaves[3], (garage.leaves[3].x0 + garage.leaves[3].x1) / 2, 1, 0);
        window.__put(2085, window.__D.wall + 350, Math.PI);
        g.step(40);
        out.inside = { ...frame(), gem: garage.gem.mesh.visible, w: garage.camera.w };
        window.__mend();
        return out;
      });
      t.diagnostic(`${label}: ${JSON.stringify(views)}`);
      const B = BUDGET[label];
      for (const [name, f] of Object.entries(views)) within(B, f, name);
      assert.ok(views.inside.gem, 'the 1-up shown inside');
      // STOMPWATT's first round with the red door broken, a frame every 30 ticks.
      const run = await page.evaluate(async () => {
        const g = window.__game;
        const { boss, garage } = await g.laneBoss;
        const { policy } = await import('/tests/helpers/laneBossPolicy.js');
        const { FIGHT } = await import('/src/objects/laneBoss/tuning.js');
        const o = g.areas.current.def.origin;
        boss.beaten = false;
        boss.enter();
        boss.armed = true;
        garage._smash(garage.leaves[1], 2082 + o.x, 1, 0);
        window.__put(window.__D.ev, window.__D.nose - 130, 0);
        g.step(400, {}, () => boss.state === 'stand');
        let at = -1;
        let cur = null;
        const get = () => {
          if (at !== g.state.frame) {
            at = g.state.frame;
            cur = policy(boss, g.player, g.camera.getYaw(), at, { FIGHT });
          }
          return cur;
        };
        const pol = { get stickX() { return get().stickX; }, get stickY() { return get().stickY; }, get A() { return get().A; }, get B() { return get().B; } };
        const r = g.view.renderer.info.render;
        let worst = { calls: 0 };
        const states = new Set();
        for (let n = 0; n < 600 && boss.state !== 'low'; n += 30) {
          g.step(30, pol);
          states.add(boss.state);
          if (r.calls > worst.calls) worst = { calls: r.calls, triangles: r.triangles, state: boss.state, programs: g.view.renderer.info.programs.filter((p) => p.cacheKey.includes('real-')).length };
        }
        return { ...worst, states: [...states], broken: garage.leaves[1].broken };
      });
      t.diagnostic(`${label} STOMPWATT's first round, a door broken, the worst frame: ${JSON.stringify(run)}`);
      assert.ok(run.states.includes('stomp_land') || run.states.includes('gap'), `it fought (${run.states})`);
      within(B, run, 'its first round');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
