// Sparrow Lane's realistic look in the real game (Vite dev server, headless Chromium with
// SwiftShader), opt-in: E2E=1. ?area=lane&tier=high: the realistic look swaps in once built
// (the F1 line 'real ...'), no console errors; its picture: a blue zenith, the dad's wall Falu
// red, its windows neither black nor NaN (the probe's old bug), the sign boards as the classic
// look draws them, Jonas's shirt red as in the classic look; the storm's grade, a flash and the
// meltdown draw through the grade pass; the recorder's 16:9 and 9:16 framings see drawn frames;
// a crossfade draws the picture as it stood over the next ones until it has faded;
// draw calls, triangles, programs and texture bytes at the five views within the high tier's
// budgets (and the mid and low tiers' at them on ?tier=mid and ?tier=low), the sky blue at each;
// G draws it classic and back. ?tier=low draws straight to the canvas. ?look=classic
// keeps the classic look. Leaving restores the renderer exactly: a snapshot of every field a
// look may touch (and the programs the grounds draw with, and the scene's children, the
// camera's profile and field of view, Jonas's model's size) taken on the grounds equals one
// taken after a visit to the lane (out through the dad's door, the hall, back to the grounds),
// also after F2 there (retro over realistic, this visit only: the saved retro setting never
// changes); the look's post chain's targets are freed, its far shadow map kept and taken once.
// The GTA look (G1): the post chain draws 14 more calls on high facing the sun (12 away from it),
// 10 on mid, none on low; the occlusion's mean at the arrival neither black nor white, the sky
// the same with it and without; a bloom halo round the sun; Jonas drawn at 0.85 and the camera's
// field of view 55 in the realistic look, 1 and 45 with G (classic by choice) and after it.
// G2: each cluster of parked cars' reflection probe and the villas' windows' taken (none on low),
// the weathering's ground map bound, the cars' contact shadows darkening the drive beside them,
// the clutter and the blank street sign drawn; budgets per tier (section 9 of the GTA plan).
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
    // ...and their means over a 7 x 7 patch (a textured face: the boards' grooves, the grain).
    window.__patchAt = (points) => {
      const g = window.__game;
      g.render();
      const gl = g.view.renderer.getContext();
      const cam = g.view.camera;
      const o = g.areas.current.def.origin;
      const v = cam.position.clone();
      const px = new Uint8Array(4 * 49);
      return points.map(([x, y, z]) => {
        v.set(x + o.x, y + o.y, z + o.z).project(cam);
        if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98 || v.z > 1) return null;
        gl.readPixels(Math.floor((v.x * 0.5 + 0.5) * gl.drawingBufferWidth) - 3, Math.floor((v.y * 0.5 + 0.5) * gl.drawingBufferHeight) - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [0, 1, 2].map((c) => {
          let sum = 0;
          for (let i = 0; i < 49; i++) sum += px[i * 4 + c];
          return Math.round(sum / 49);
        });
      });
    };
    // ...the mean of a 7 x 7 patch at screen fractions (the grain and an edge evened out)...
    window.__patchOn = (spots) => {
      const g = window.__game;
      g.render();
      const gl = g.view.renderer.getContext();
      const px = new Uint8Array(4 * 49);
      return spots.map(([fx, fy]) => {
        gl.readPixels(Math.floor(fx * gl.drawingBufferWidth) - 3, Math.floor(fy * gl.drawingBufferHeight) - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [0, 1, 2].map((c) => Math.round(px.filter((_, i) => i % 4 === c).reduce((a, q) => a + q, 0) / 49));
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
        camera: [g.camera.k.FOV, g.camera.k.LOOK_HEIGHT, g.camera.k.PIVOT_RATE, v.camera.fov],
        hero: [v.heroScale, g.model.object3D.scale.y],
        mode: v.describeMode(),
        look: v.look,
        children: v.scene.children.filter((o) => !areas.has(o)).map((o) => o.name || o.type),
        sky: g.level.parts.find((p) => p.name === 'sky').object3D.visible,
        heroShadow: hero,
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
// budgets, the sky at its top blue (the bluest of its top band's left, middle and right: the
// realistic look's lower, wider camera puts the golden glow round the low sun at the top of the
// picture where he faces it, at the dad's drive).
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
      out.sky = window.__pixelsOn([[0.1, 0.98], [0.5, 0.98], [0.9, 0.98]]).sort((a, b) => b[2] - b[0] - (a[2] - a[0]))[0];
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

// The GTA look's checks at the arrival (?tier=high): the post chain's draw calls facing the sun
// and away from it, the occlusion's mean (its half-res target read back), the sky with the
// occlusion and without, the glow round the sun with the bloom and without (the grain off for
// the comparisons); Jonas's model's size and the camera's field of view.
async function gtaLook(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const v = g.view;
    const look = v.look;
    const out = { model: g.model.object3D.scale.y, fov: v.camera.fov, profile: g.camera.k.FOV, heroScale: v.heroScale };
    const u = look.output.material.uniforms;
    const grain = u.uGrain.value;
    u.uGrain.value = 0;
    const settings = look.output.settings;
    // Away from the sun: on the path facing the street, the camera behind him.
    g.player.teleport(-60000, 22, 900, Math.PI);
    g.player.setAction('idle');
    g.camera.reset(g.player);
    g.step(10);
    g.render();
    out.awayDrawn = look.post.drawn;
    // Toward it: facing the house (the sun low over its roof), the camera behind him.
    g.player.teleport(-60000, 22, 900, 0);
    g.player.setAction('idle');
    g.camera.reset(g.player);
    g.step(10);
    g.render();
    out.facingDrawn = look.post.drawn;
    // The occlusion's target, read back (half floats).
    const t = look.post.ssao.a;
    const half = new Uint16Array(t.width * t.height * 4);
    v.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, half);
    const toFloat = (h) => {
      const e = (h >> 10) & 31;
      const m = h & 1023;
      return (e === 0 ? m / 1024 * 2 ** -14 : e === 31 ? Infinity : (1 + m / 1024) * 2 ** (e - 15)) * (h & 32768 ? -1 : 1);
    };
    let sum = 0;
    let n = 0;
    for (let i = 0; i < half.length; i += 4) {
      if (toFloat(half[i + 1]) > 5e4) continue; // (the sky)
      sum += toFloat(half[i]);
      n++;
    }
    out.ao = sum / n;
    out.aoSize = [t.width, t.height];
    const ao = settings.ao;
    const sky = [[0.5, 0.97], [0.2, 0.95], [0.8, 0.95]];
    out.skyAo = window.__pixelsOn(sky);
    settings.ao = 0;
    out.skyNoAo = window.__pixelsOn(sky);
    out.wallNoAo = window.__pixelsAt([[600, 26, 1329]]);
    settings.ao = ao;
    out.wallAo = window.__pixelsAt([[600, 26, 1329]]);
    // Toward the sun (low in the south-west): the camera on the road looking at it.
    const d = look.sunDir;
    const cam = v.camera;
    g.step(1);
    cam.position.set(-60000 + 0, 300, 200);
    cam.lookAt(cam.position.x + d.x * 1000, cam.position.y + d.y * 1000, cam.position.z + d.z * 1000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    v.render();
    out.towardDrawn = look.post.drawn;
    const sun = cam.position.clone().addScaledVector(d, 10000).project(cam);
    // A ring round the sun, and the sky's top corners far from it.
    const ring = [[0.12, 0], [-0.12, 0], [0, 0.15], [0.09, 0.1], [-0.09, 0.1]].map(([dx, dy]) => [sun.x * 0.5 + 0.5 + dx, sun.y * 0.5 + 0.5 + dy]);
    ring.push([0.03, 0.97], [0.97, 0.97]);
    const read = () => {
      v.render();
      const gl = v.renderer.getContext();
      const px = new Uint8Array(4);
      return ring.map(([fx, fy]) => {
        gl.readPixels(Math.floor(fx * gl.drawingBufferWidth), Math.floor(fy * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px[0] + px[1] + px[2];
      });
    };
    out.sun = [sun.x, sun.y];
    out.glow = read();
    const bloom = settings.bloom;
    settings.bloom = 0;
    out.noGlow = read();
    settings.bloom = bloom;
    u.uGrain.value = grain;
    out.far = [look.far.taken, look.far.draws];
    return out;
  });
}

test('?area=lane&tier=high: the realistic look swaps in; its sky, the dad\'s Falu red wall, live windows, the signs and Jonas as the classic look draws them; the grade and the recorder\'s framings; the counts at five views; G draws it classic and back', { skip, timeout: 900000 }, async (t) => {
  const { page, errors, step, real } = await open('&area=lane&tier=high');
  try {
    await real();
    await step(60);
    const mode = await page.evaluate(() => window.__game.view.describeMode());
    t.diagnostic(`mode: ${mode}; built in ${JSON.stringify(await page.evaluate(() => window.__game.areas.real.ms.lane))} ms`);
    assert.match(mode, /^real 960x540 msaa4 high$/);
    // The arrival: the zenith blue, the wall Falu red (between the first windows west of the door,
    // and east of the door, where the realistic look's lower camera sees past the mailbox: the
    // mean of a patch, the boards' grooves and the grain evened out), the panes of three windows
    // lit (the probe's reflections over a dim room), never black.
    const [zenith] = await page.evaluate(() => window.__pixelsOn([[0.5, 0.98]]));
    assert.ok(blue(zenith), `the zenith ${zenith}`);
    const wall = await page.evaluate(() => window.__patchAt([[-730, 250, 1329], [-440, 250, 1329], [150, 250, 1329], [250, 250, 1329]]));
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
    // The GTA look: Jonas smaller, the camera wider; the post chain's calls; the occlusion
    // neither black (a target of no size) nor white, never on the sky; the bloom round the sun.
    const gta = await gtaLook(page);
    t.diagnostic(`GTA look: ${JSON.stringify(gta)}`);
    assert.equal(gta.model, 0.85, 'Jonas drawn at 0.85');
    assert.equal(gta.heroScale, 0.85);
    assert.equal(gta.fov, 55, 'the realistic look\'s camera: 55 degrees');
    assert.equal(gta.profile, 55);
    assert.equal(gta.awayDrawn, 12, 'occlusion 1 + blur 2 + bloom 5 down and 4 up');
    assert.equal(gta.facingDrawn, 14, '...and the shafts\' 2 facing the sun');
    assert.equal(gta.towardDrawn, 14);
    assert.ok(gta.ao > 0.55 && gta.ao < 0.98, `the occlusion's mean ${gta.ao}`);
    assert.deepEqual(gta.skyAo, gta.skyNoAo, 'the sky never occluded');
    assert.ok(lum(gta.wallAo[0]) < lum(gta.wallNoAo[0]), `the wall's foot darker with it: ${gta.wallAo} vs ${gta.wallNoAo}`);
    // (The bloom is mixed in: its share is the glow's, so far from the sun the sky darkens by
    // it, round the sun it brightens relative to that.)
    const ratio = gta.glow.map((p, i) => p / gta.noGlow[i]);
    const far = Math.max(ratio.at(-1), ratio.at(-2));
    for (const r of ratio.slice(0, -2)) assert.ok(r > far + 0.01, `a halo round the sun: ${ratio.map((x) => x.toFixed(3))}`);
    assert.deepEqual(gta.far, [true, 1], 'the far shadow map taken once');
    // G2: the probes (the cars' clusters' at 128, the windows' at 256), all taken; the
    // weathering's ground map; the contact shadows, the clutter, the sign.
    const g2 = await page.evaluate(() => {
      const g = window.__game;
      const look = g.view.look;
      const named = (n) => g.view.scene.getObjectByName(n);
      return {
        probes: [...look.probes.values()].map((p) => [p.name, p.size, p.taken, !!p.target, p.materials.length]),
        ground: !!look.haze.uWearGround?.value?.isDataTexture,
        contact: named('lane-detail-contact')?.visible === true && named('lane-detail-contact').material.transparent,
        paints: ['carPaint@0', 'carPaint@1', 'carPaint@2', 'carPaint@3'].map((n) => named(`lane-detail-${n}`)?.material.envMap?.isTexture === true),
      };
    });
    t.diagnostic(`G2: ${JSON.stringify(g2)}`);
    assert.deepEqual(g2.probes.map((p) => p[0]), ['street', 'car0', 'car1', 'car2', 'car3', 'north']);
    for (const [name, size, taken, target, materials] of g2.probes) {
      assert.ok(taken && target && materials > 0, `${name}: taken`);
      assert.equal(size, name.startsWith('car') ? 128 : 256, `${name}: its size`);
    }
    assert.ok(g2.ground, 'the weathering\'s ground map');
    assert.ok(g2.contact, 'the cars\' contact shadows');
    assert.deepEqual(g2.paints, [true, true, true, true], 'each cluster\'s paint on its probe');
    // Under the dad's dark car's nose (local 2300, 1430; its nose at z 1100), seen low from the
    // street: the drive darker under it (its contact shadow, the occlusion) than in front of it.
    const beside = await page.evaluate(() => {
      const g = window.__game;
      const v = g.view;
      const cam = v.camera;
      const o = g.areas.current.def.origin;
      g.step(1);
      cam.position.set(2300 + o.x, 60 + o.y, 700 + o.z);
      cam.lookAt(2300 + o.x, 40 + o.y, 1430 + o.z);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      v.render();
      const gl = v.renderer.getContext();
      const px = new Uint8Array(4 * 49);
      const p = cam.position.clone();
      return [[2300, 23, 1150], [2300, 23, 990]].map(([x, y, z]) => {
        p.set(x + o.x, y + o.y, z + o.z).project(cam);
        gl.readPixels(Math.floor((p.x * 0.5 + 0.5) * gl.drawingBufferWidth) - 3, Math.floor((p.y * 0.5 + 0.5) * gl.drawingBufferHeight) - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [0, 1, 2].map((c) => Math.round(px.filter((_, i) => i % 4 === c).reduce((a, q) => a + q, 0) / 49));
      });
    });
    t.diagnostic(`under the car and in front of it: ${JSON.stringify(beside)}`);
    assert.ok(lum(beside[0]) < lum(beside[1]) * 0.85, `the drive darker under the car: ${beside}`);
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
    const classicFrame = await page.evaluate(() => {
      const g = window.__game;
      g.step(1);
      return { model: g.model.object3D.scale.y, fov: g.view.camera.fov, profile: g.camera.k.FOV, heroScale: g.view.heroScale };
    });
    assert.deepEqual(classicFrame, { model: 1, fov: 45, profile: 45, heroScale: 1 }, 'G: Jonas and the camera as the classic look has them');
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
    assert.deepEqual(await page.evaluate(() => {
      const g = window.__game;
      g.step(1);
      return [g.model.object3D.scale.y, g.view.camera.fov];
    }), [0.85, 55], 'G again: the realistic look\'s');
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
    // A crossfade: the picture as it stood drawn over the next ones (here a long one, G drawing
    // the classic look under it), until it has faded.
    const fade = await page.evaluate(() => {
      const g = window.__game;
      const v = g.view;
      // (A patch's mean: the grain changes from frame to frame, and a thin rod of the roof's
      // hardware may cross the spot.)
      const spot = [[0.5, 0.75]];
      const real = window.__patchOn(spot)[0];
      v.crossfade(1000);
      g.areas.setClassic(true);
      const held = window.__patchOn(spot)[0];
      v.fader.start -= 2e6; // (over)
      const classic = window.__patchOn(spot)[0];
      const after = window.__patchOn(spot)[0];
      g.areas.setClassic(false);
      return { real, held, classic, after, active: v.fader.active };
    });
    t.diagnostic(`crossfade: ${JSON.stringify(fade)}`);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(fade.held[c] - fade.real[c]) <= 3, `the faded picture drawn over the classic one: ${fade.held} vs ${fade.real}`);
    assert.ok(fade.real.some((x, c) => Math.abs(x - fade.classic[c]) > 12), `the classic look under it differs: ${fade.classic}`);
    assert.deepEqual(fade.after, fade.classic);
    assert.equal(fade.active, false, 'the copy freed once faded');
    await real();
    // Counts at the five views (the arrival, the door, west, the turning area, the dad's drive),
    // the shadow pass included: within the high tier's budgets; the sky blue at each.
    await countViews(page, t, { calls: 175, triangles: 1000000, programs: 24, textureBytes: 64 * 1024 * 1024 });
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
      // The look's own: its targets and its post chain's freed, its far shadow map kept (taken
      // once a build), never the sun's.
      const kept = await page.evaluate(() => {
        const g = window.__game;
        const look = g.areas.get('lane').look;
        const p = look.post;
        return { hdr: look.hdr, ao: p.ssao.a, bloom: p.bloom.downs.length, shafts: p.shafts.a, far: [look.far.taken, look.far.draws], sunsMap: g.view.sun.shadow.map === look.far.light.shadow.map };
      });
      assert.deepEqual(kept, { hdr: null, ao: null, bloom: 0, shafts: null, far: [true, 1], sunsMap: false }, `${retro ? 'with F2: ' : ''}the look's own freed`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?tier=mid within its budgets at the five views; ?tier=low draws straight to the canvas (tone mapped per material), its sky blue and walls red; ?look=classic keeps the classic look', { skip, timeout: 900000 }, async (t) => {
  {
    const { page, errors, step, real } = await open('&area=lane&tier=mid');
    try {
      await real();
      await step(30);
      assert.match(await page.evaluate(() => window.__game.view.describeMode()), /^real 960x540 msaa2 mid$/);
      // The mid tier's budgets (a desktop with an integrated GPU): 70 % of the leaf clusters,
      // the smaller grass grid, 4 segments a tile roll.
      await countViews(page, t, { calls: 145, triangles: 500000, programs: 24, textureBytes: 64 * 1024 * 1024 });
      // Its post chain: the occlusion at 8 taps (1 + blur 2), bloom over 4 levels (4 + 3).
      const drawn = await page.evaluate(() => [window.__game.view.look.post.drawn, window.__game.view.look.level.post.ao]);
      assert.deepEqual(drawn, [10, 8], 'the mid tier\'s post chain');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
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
      const wall = await page.evaluate(() => window.__patchAt([[-730, 300, 1329], [150, 300, 1329], [250, 300, 1329]]));
      for (const p of wall) assert.ok(p && p[0] > 2 * p[1], `Falu red: ${p}`);
      // The low tier's budgets (a phone): no grass blades, no tile courses, fewer casters.
      await countViews(page, t, { calls: 100, triangles: 220000, programs: 18, textureBytes: 20 * 1024 * 1024 });
      assert.deepEqual(await page.evaluate(() => [window.__game.view.look.post, window.__game.view.look.far, window.__game.view.heroScale]), [null, null, 0.85], 'no post chain or far map on low (Jonas smaller all the same)');
      assert.deepEqual(await page.evaluate(() => window.__game.view.look.probeNames()), [], 'no probes on low');
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
