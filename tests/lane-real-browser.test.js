// Sparrow Lane's realistic look in the real game (Vite dev server, headless Chromium with
// SwiftShader), opt-in: E2E=1. ?area=lane&tier=high: the realistic look swaps in once built
// (the F1 line 'real ...'), no console errors; its picture: a blue zenith, the dad's wall Falu
// red, its windows neither black nor NaN (the probe's old bug), the sign boards as the classic
// look draws them, Jonas's shirt red as in the classic look; the storm's grade, a flash and the
// meltdown draw through the grade pass; the recorder's 16:9 and 9:16 framings see drawn frames;
// draw calls, triangles, programs and texture bytes at the five views within the high tier's
// budgets (and the low tier's at them on ?tier=low), the sky blue at each; G draws it classic and
// back. ?tier=low draws straight to the canvas. ?look=classic
// keeps the classic look. Leaving restores the renderer exactly: a snapshot of every field a
// look may touch (and the programs the grounds draw with, and the scene's children) taken on the
// grounds equals one taken after a visit to the lane (out through the dad's door, the hall, back
// to the grounds), also after F2 there (retro over realistic, this visit only: the saved retro
// setting never changes).
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

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?test=1&mute=1${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => {
    // The picture's pixels at world points (local to the current area), read right after a
    // draw (before the buffer is swapped): [r, g, b] each, or null off screen.
    window.__pixelsAt = (points) => {
      const g = window.__game;
      g.render();
      const gl = g.view.renderer.getContext();
      const cam = g.view.camera;
      const o = g.areas.current.def.origin;
      const v = cam.position.clone();
      const px = new Uint8Array(4);
      return points.map(([x, y, z]) => {
        v.set(x + o.x, y + o.y, z + o.z).project(cam);
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z > 1) return null;
        gl.readPixels(Math.floor((v.x * 0.5 + 0.5) * gl.drawingBufferWidth), Math.floor((v.y * 0.5 + 0.5) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      });
    };
    // ...and at screen fractions (0..1 from the bottom left).
    window.__pixelsOn = (spots) => {
      const g = window.__game;
      g.render();
      const gl = g.view.renderer.getContext();
      const px = new Uint8Array(4);
      return spots.map(([fx, fy]) => {
        gl.readPixels(Math.floor(fx * gl.drawingBufferWidth), Math.floor(fy * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      });
    };
    // Every field a realistic look may touch (N64Renderer.lookState's and more), the programs
    // the visible scene draws with, the scene's children: compared before and after a visit.
    window.__lookSnapshot = () => {
      const g = window.__game;
      const v = g.view;
      const r = v.renderer;
      const s = v.sun;
      const c = s.shadow.camera;
      g.render();
      // Each visible object's programs (by its uuid), and the scene's children but the areas
      // built meanwhile (their roots and objects' groups, hidden).
      const programs = {};
      v.scene.traverseVisible((o) => {
        if (!o.material) return;
        programs[o.uuid] = [].concat(o.material).map((m) => r.properties.get(m).currentProgram?.cacheKey ?? null);
      });
      const areas = new Set();
      for (const a of Object.values(g.areas.built)) if (a.name !== 'grounds') areas.add(a.root).add(a.objects?.group);
      const hero = [];
      g.model.object3D.traverse((o) => o.isMesh && hero.push([o.castShadow, o.receiveShadow]));
      const blob = g.model.shadow.mesh.material;
      return {
        shadowMap: [r.shadowMap.enabled, r.shadowMap.type, r.shadowMap.autoUpdate],
        toneMapping: [r.toneMapping, r.toneMappingExposure],
        pixelRatio: r.getPixelRatio(),
        size: [r.domElement.width, r.domElement.height],
        environment: [v.scene.environment, v.scene.environmentIntensity],
        background: v.scene.background?.getHexString() ?? null,
        fog: [v.scene.fog.color.getHexString(), v.scene.fog.near, v.scene.fog.far],
        sun: [s.castShadow, s.shadow.map, s.shadow.mapSize.toArray(), s.shadow.radius, s.shadow.bias, s.shadow.normalBias, [c.left, c.right, c.top, c.bottom, c.near, c.far], s.position.toArray(), s.target.position.toArray(), s.color.getHexString(), s.intensity],
        ambient: [v.ambient.color.getHexString(), v.ambient.groundColor.getHexString(), v.ambient.intensity],
        retro: [v.n64, v.retro, v.lookRetro, localStorage.getItem('castleGrounds.render.v1')],
        mode: v.describeMode(),
        look: v.look,
        children: v.scene.children.filter((o) => !areas.has(o)).map((o) => o.name || o.type),
        sky: g.level.parts.find((p) => p.name === 'sky').object3D.visible,
        hero,
        blob: [blob.opacity, blob.transparent],
        programs,
      };
    };
  });
  const step = (n, input = null) => page.evaluate(([k, i]) => window.__game.step(k, i), [n, input]);
  const real = () => page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 120000, polling: 250 });
  return { page, errors, step, real };
}

const blue = ([r, g, b]) => b > r + 40;

// The five views (Jonas there, the camera behind him; local x, y, z, yaw): each one's draw calls,
// triangles (the shadow pass included), realistic programs and texture bytes within the tier's
// budgets, the sky at its top blue.
const VIEWS = { arrival: [0, 22, 1156, Math.PI], door: [-260, 22, 700, 0.4], west: [-600, 22, 200, -Math.PI / 2], turn: [1500, 0, 250, Math.PI / 2 + 0.3], cars: [1500, 22, 700, 0.7] };
async function countViews(page, t, budget) {
  for (const [name, [x, y, z, yaw]] of Object.entries(VIEWS)) {
    const f = await page.evaluate(([x, y, z, yaw]) => {
      const g = window.__game;
      g.player.teleport(x - 60000, y, z, yaw);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      g.step(10);
      g.render();
      const r = g.view.renderer;
      const programs = r.info.programs.filter((p) => p.cacheKey.includes('real-')).length;
      let texels = 0;
      for (const s of g.areas.real.store.sets.values()) texels += s.albedo.length + s.normal.length + s.orm.length;
      const out = { calls: r.info.render.calls, triangles: r.info.render.triangles, programs, all: r.info.programs.length, textureBytes: Math.round(texels * 1.33) };
      out.sky = window.__pixelsOn([[0.5, 0.98]])[0];
      return out;
    }, [x, y, z, yaw]);
    t.diagnostic(`${name}: ${JSON.stringify(f)}`);
    assert.ok(f.calls <= budget.calls, `${name}: ${f.calls} draw calls`);
    assert.ok(f.triangles <= budget.triangles, `${name}: ${f.triangles} triangles`);
    assert.ok(f.programs <= budget.programs, `${name}: ${f.programs} realistic programs`);
    assert.ok(f.textureBytes <= budget.textureBytes, `${name}: ${f.textureBytes} texture bytes`);
    assert.ok(blue(f.sky), `${name}: the sky ${f.sky}`);
  }
}
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

test('?area=lane&tier=high: the realistic look swaps in; its sky, the dad\'s Falu red wall, live windows, the signs and Jonas as the classic look draws them; the grade and the recorder\'s framings; the counts at five views; G draws it classic and back', { skip, timeout: 900000 }, async (t) => {
  const { page, errors, step, real } = await open('&area=lane&tier=high');
  try {
    await real();
    await step(60);
    const mode = await page.evaluate(() => window.__game.view.describeMode());
    t.diagnostic(`mode: ${mode}; built in ${JSON.stringify(await page.evaluate(() => window.__game.areas.real.ms.lane))} ms`);
    assert.match(mode, /^real 960x540 msaa4 high$/);
    // The arrival: the zenith blue, the wall between the second and third windows Falu red, the
    // panes of three windows lit (the probe's reflections over a dim room), never black.
    const [zenith] = await page.evaluate(() => window.__pixelsOn([[0.5, 0.98]]));
    assert.ok(blue(zenith), `the zenith ${zenith}`);
    const wall = await page.evaluate(() => window.__pixelsAt([[-440, 300, 1329], [-440, 250, 1329], [600, 300, 1329]]));
    for (const p of wall) assert.ok(p && p[0] > 2 * p[1] && p[0] > 2 * p[2], `Falu red: ${p}`);
    for (const x of [-880, -580, 400]) {
      const pane = [];
      for (const dx of [-50, 0, 50]) for (const y of [205, 255, 305]) pane.push([x + dx, y, 1326]);
      const px = await page.evaluate((pts) => window.__pixelsAt(pts), pane);
      const mean = px.reduce((s, p) => s + lum(p), 0) / px.length;
      t.diagnostic(`window ${x}: mean ${mean.toFixed(3)}`);
      assert.ok(mean > 0.08, `window ${x}: not black (${mean})`);
      for (const p of px) assert.ok(p.some((c) => c > 0), `window ${x}: no black pixel ${p}`);
    }
    // The signs as the classic look draws them (unlit, turned back through the tone mapping),
    // Jonas's shirt red: the
    // same view realistic and classic (G).
    // (On the turning area, the trampoline's sign beyond him, the camera behind him.)
    const sign = await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(4456 - 60000, 40, -740, 2.47);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      g.step(15);
      return g.areas.current.def.layout.SIGNS.find((x) => x.id === 'trampoline');
    });
    // Two points on the board's face either side of the writing (local x ±76, 125 up).
    const boardAt = [-76, 76].map((u) => [sign.x + Math.cos(sign.yaw) * u + Math.sin(sign.yaw) * 21, 22 + 125, sign.z - Math.sin(sign.yaw) * u + Math.cos(sign.yaw) * 21]);
    const shirtAt = () =>
      page.evaluate(() => {
        const p = window.__game.player.pos;
        return window.__pixelsAt([[p.x + 60000, p.y + 62, p.z]]);
      });
    const realBoard = await page.evaluate((pts) => window.__pixelsAt(pts), boardAt);
    const realShirt = (await shirtAt())[0];
    await page.evaluate(() => window.__game.view.setN64Mode(false)); // (classic at full size, as the realistic look draws)
    await page.keyboard.press('g');
    assert.match(await page.evaluate(() => window.__game.view.describeMode()), /^native 960x540 \(classic: chosen\)$/, 'G: the classic look (the F1 line says why)');
    const classicBoard = await page.evaluate((pts) => window.__pixelsAt(pts), boardAt);
    const classicShirt = (await shirtAt())[0];
    t.diagnostic(`sign board ${JSON.stringify(realBoard)} (classic ${JSON.stringify(classicBoard)}), shirt ${realShirt} (classic ${classicShirt})`);
    realBoard.forEach((p, i) => {
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(p[c] - classicBoard[i][c]) <= 0.06 * 255, `the sign board within 6 %: ${p} vs ${classicBoard[i]}`);
    });
    // His colours his own: the shirt's chromaticity within 8 % of the classic look's (how bright
    // it is is the realistic sun's: in the house's shade he is darker, as everything is).
    const chroma = ([r, g, b]) => [r / (r + g + b), g / (r + g + b)];
    const [a, b] = [chroma(realShirt), chroma(classicShirt)];
    assert.ok(realShirt[0] > 2 * realShirt[1] && classicShirt[0] > 2 * classicShirt[1], `the shirt red: ${realShirt} / ${classicShirt}`);
    assert.ok(Math.abs(a[0] - b[0]) <= 0.08 && Math.abs(a[1] - b[1]) <= 0.08, `Jonas's shirt within 8 %: ${realShirt} vs ${classicShirt}`);
    await page.keyboard.press('g');
    await real();
    // The grade (forced on: AI RACE never starts here) and the recorder's framings.
    const graded = await page.evaluate(() => {
      const g = window.__game;
      const v = g.view;
      const out = {};
      v.setDarkness(0.6);
      v.flash(1);
      v.setMeltdown({ warn: 0, fire: 0.5, white: 0, glare: 0.5, shimmer: 0.5, seconds: 30, lit: false });
      out.mode = v.describeMode();
      out.px = window.__pixelsOn([[0.5, 0.9], [0.5, 0.3]]);
      out.grade = !!v.gradePass.target;
      v.setDarkness(0);
      v.setMeltdown(null);
      g.step(20); // (the flash fades)
      out.after = !!v.gradePass.target;
      const frames = [];
      const copy = document.createElement('canvas');
      copy.width = copy.height = 8;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      v.setFrameHook(() => {
        const c = v.renderer.domElement;
        ctx.drawImage(c, 0, 0, c.width, c.height * 0.1, 0, 0, 8, 8);
        frames.push([c.width, c.height, [...ctx.getImageData(4, 1, 1, 1).data.slice(0, 3)]]);
      });
      for (const [aspect, label] of [[16 / 9, '16:9'], [9 / 16, '9:16']]) {
        v.setCapture({ aspect, minHeight: 1080, zoom: aspect < 1 ? 0.72 : 1, label });
        out[label] = v.describeMode();
        v.render();
      }
      v.setCapture(null);
      v.setFrameHook(null);
      out.frames = frames;
      return out;
    });
    t.diagnostic(JSON.stringify(graded));
    assert.match(graded.mode, /^real .* storm meltdown$/);
    assert.ok(graded.grade && !graded.after, 'the grade target while graded, freed after');
    for (const p of graded.px) assert.ok(p.some((c) => c > 8), `graded, not black: ${p}`);
    assert.match(graded['16:9'], /^real 192\d+x108\d+ .* 16:9 rec$/);
    assert.match(graded['9:16'], /^real \d+x\d+ .* 9:16 rec$/);
    assert.equal(graded.frames.length, 2);
    for (const [w, h, px] of graded.frames) {
      assert.ok(h >= 1080, `${w} x ${h}`);
      assert.ok(blue(px), `the recorded frame's sky: ${px}`);
    }
    // Counts at the five views (the arrival, the door, west, the turning area, the dad's drive),
    // the shadow pass included: within the high tier's budgets; the sky blue at each.
    await countViews(page, t, { calls: 160, triangles: 900000, programs: 20, textureBytes: 64 * 1024 * 1024 });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('leaving restores the renderer exactly: the grounds before and after a visit to the realistic lane (out through the dad\'s door), also with F2 there (retro over realistic, this visit only; the saved setting unchanged)', { skip, timeout: 900000 }, async (t) => {
  const { page, errors, step, real } = await open('&tier=high');
  try {
    for (const retro of [false, true]) {
      await step(5);
      const before = await page.evaluate(() => window.__lookSnapshot());
      assert.equal(before.look, null);
      await page.evaluate(() => window.__game.enterArea('lane'));
      await real();
      await step(30);
      if (retro) {
        await page.keyboard.press('F2');
        const mode = await page.evaluate(() => window.__game.view.describeMode());
        t.diagnostic(`F2 in the lane: ${mode}`);
        assert.match(mode, /^real \d+x240 .* Retro$/, 'retro over realistic');
        const [zenith] = await page.evaluate(() => window.__pixelsOn([[0.5, 0.98]]));
        assert.ok(blue(zenith), `through the retro filter: ${zenith}`);
        assert.equal(await page.evaluate(() => window.__game.view.n64), before.retro[0], 'the saved setting unchanged');
      }
      // Off the door's apron (the door he came out of is quiet till then) and back in through
      // it, into the hall; then back onto the grounds.
      const warp = await page.evaluate(() => {
        const g = window.__game;
        const o = g.areas.current.def.origin;
        for (let i = 0; i < 60 && g.player.pos.z - o.z > 900; i++) {
          const a = Math.atan2(Math.sin(g.camera.getYaw() - Math.PI), Math.cos(g.camera.getYaw() - Math.PI));
          g.step(1, { stickX: Math.sin(a), stickY: Math.cos(a) });
        }
        for (let i = 0; i < 200 && !g.snapshot().warp; i++) {
          const a = Math.atan2(Math.sin(g.camera.getYaw()), Math.cos(g.camera.getYaw())); // toward world yaw 0
          g.step(1, { stickX: Math.sin(a), stickY: Math.cos(a) });
        }
        return g.snapshot().warp;
      });
      assert.deepEqual(warp, { phase: 'close', to: 'hall', entry: 'east_2', kind: 'door' });
      await step(60);
      assert.equal(await page.evaluate(() => window.__game.area), 'hall');
      await page.evaluate(() => window.__game.enterArea('grounds', 'start'));
      await step(5);
      const after = await page.evaluate(() => window.__lookSnapshot());
      // Every object drawn before draws with the same programs after (things that came into
      // view meanwhile, a sparkle, are no matter).
      const same = Object.keys(before.programs).filter((id) => id in after.programs);
      assert.ok(same.length > 0.9 * Object.keys(before.programs).length, `${same.length} of ${Object.keys(before.programs).length} objects still drawn`);
      for (const id of same) assert.deepEqual(after.programs[id], before.programs[id], `${retro ? 'with F2: ' : ''}object ${id}'s programs`);
      delete before.programs;
      delete after.programs;
      assert.deepEqual(after, before, `${retro ? 'with F2: ' : ''}restored`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?tier=low draws straight to the canvas (tone mapped per material), its sky blue and walls red; ?look=classic keeps the classic look', { skip, timeout: 600000 }, async (t) => {
  {
    const { page, errors, step, real } = await open('&area=lane&tier=low');
    try {
      await real();
      await step(30);
      const mode = await page.evaluate(() => window.__game.view.describeMode());
      t.diagnostic(mode);
      assert.match(mode, /^real 960x540 direct low$/);
      const [zenith] = await page.evaluate(() => window.__pixelsOn([[0.5, 0.98]]));
      assert.ok(blue(zenith), `the zenith ${zenith}`);
      const wall = await page.evaluate(() => window.__pixelsAt([[-440, 300, 1329], [600, 300, 1329]]));
      for (const p of wall) assert.ok(p && p[0] > 2 * p[1], `Falu red: ${p}`);
      // The low tier's budgets (a phone): no grass blades, no tile courses, fewer casters.
      await countViews(page, t, { calls: 100, triangles: 200000, programs: 18, textureBytes: 20 * 1024 * 1024 });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  {
    const { page, errors, step } = await open('&area=lane&look=classic');
    try {
      await step(30);
      await page.waitForTimeout(3000);
      await step(1);
      const s = await page.evaluate(() => ({ mode: window.__game.view.describeMode(), look: window.__game.view.look, real: window.__game.areas.current.real }));
      assert.match(s.mode, /^(native|Retro) /, 'the classic look');
      assert.equal(s.look, null);
      assert.equal(s.real, null, 'not even built');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});
