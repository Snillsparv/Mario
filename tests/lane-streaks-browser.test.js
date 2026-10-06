// Sparrow Lane's realistic look: no horizontal streaks over the road (E2E=1; Vite dev server,
// headless Chromium with SwiftShader). The dad's report after the R fixes: "still horizontal
// streaks across the screen; now they're most visible at the very bottom" (his view below:
// Jonas crouching on the turning area's asphalt before the double garage, the realistic camera's
// close follow framing, in a narrow portrait window). The cause: the ambient occlusion read the
// depth by uv at its half-res pixels' middles, each a corner of four full-res texels wherever the
// picture's size is even; which texel came back was the GPU's rounding, the middle and a
// neighbour could be the same texel, the rebuilt normal then faced the camera and the flat road
// occluded itself across whole rows (render/real/post/Ssao.js: now whole texels).
//
// At his view, 543 x 1250 CSS at a pixel ratio of 1 (drawn 543 x 1250 on every tier: an even
// height, every half-res row's middle on a texel boundary), on high, mid and low: the banding
// detector over the near road (the picture's lower quarter, 3 % in from each side): each pixel
// row's mean luminance over the road's width (0..255, the canvas's encoded values), high-passed
// along y (lightly smoothed, sigma 1 px, minus its Gaussian smoothing, sigma 3 % of the height:
// what is left is bands, not the road's own fading with distance), its rms under 1 level (the
// grain off; the road's texture leaves ~0.3; the old occlusion left 2.4 on high here, and on the
// dad's GPU 5.3 in his screenshot); where the level runs the occlusion (high, its 8 taps, mid)
// also the occlusion itself, its half-res target read back: every row over the flat road
// unoccluded (its mean over 0.98; the old code drew rows of ~0.8). The picture again at the
// governor's 85 % levels (another render size; the occlusion off by then).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;

// His view (lane-local; solved from his screenshot's garage doors, flagpole and Jonas).
const VIEW = { hero: [3362, 0, -59, 2.2], pos: [2316, 193, -182], look: [3307, 245, -66], fov: 55 };
const SIZE = { width: 543, height: 1250 };

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

// The lane in the realistic look at `tier`, his view drawn at each of `levels` (the tier's
// ladder's names); per level the detector's rms over the road and, with a post chain, the
// occlusion's rows over it.
async function streaks(tier, levels) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await page.goto(`${base}/?test=1&mute=1&area=lane&tier=${tier}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await page.waitForFunction(() => window.__game.view.describeMode().startsWith('real'), null, { timeout: 180000, polling: 250 });
    const out = await page.evaluate(
      async ([VIEW, levels]) => {
        const g = window.__game;
        const v = g.view;
        const look = v.look;
        const o = g.areas.current.def.origin;
        const boss = (await g.laneBoss)?.boss;
        if (boss) boss.armed = false; // (the dad's car stays a car)
        document.getElementById('ui').style.visibility = 'hidden';
        look.output.material.uniforms.uGrain.value = 0; // (a per-frame noise: the comparisons)
        const [hx, hy, hz, yaw] = VIEW.hero;
        g.player.teleport(hx + o.x, hy + o.y, hz + o.z, yaw);
        g.player.setAction('idle');
        g.camera.reset(g.player);
        g.step(5, { Z: true }); // (crouching, as in his screenshot)
        const gauss = (m, s) => {
          const r = Math.ceil(3 * s);
          const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / s) ** 2));
          const ks = k.reduce((a, b) => a + b, 0);
          return m.map((_, i) => k.reduce((a, w, j) => {
            let t = i + j - r;
            t = t < 0 ? -t : t >= m.length ? 2 * m.length - 2 - t : t; // (reflected at the ends)
            return a + w * m[t];
          }, 0) / ks);
        };
        // The detector: rows y0..y1 (from the bottom) of a w x h picture `at(x, y)`, columns 3 %
        // to 97 %: the rms of the row means' high-pass, the ends trimmed.
        const bands = (at, w, h, y0, y1) => {
          const m = [];
          for (let y = y0; y < y1; y++) {
            let sum = 0;
            for (let x = Math.floor(0.03 * w); x < Math.floor(0.97 * w); x++) sum += at(x, y);
            m.push(sum / (Math.floor(0.97 * w) - Math.floor(0.03 * w)));
          }
          const s = 0.03 * h;
          const fine = gauss(m, 1);
          const broad = gauss(m, s);
          const t = Math.min(Math.floor(m.length / 4), Math.floor(2 * s));
          const hp = fine.slice(t, m.length - t).map((f, i) => f - broad[i + t]);
          return { rms: Math.sqrt(hp.reduce((a, q) => a + q * q, 0) / hp.length), rows: m };
        };
        const toFloat = (h) => {
          const e = (h >> 10) & 31;
          const f = h & 1023;
          return (e === 0 ? (f / 1024) * 2 ** -14 : e === 31 ? Infinity : (1 + f / 1024) * 2 ** (e - 15)) * (h & 32768 ? -1 : 1);
        };
        const cam = v.camera;
        const results = [];
        for (const name of levels) {
          look.setLevel(look.levels.findIndex((l) => l.name === name), v);
          g.step(1, { Z: true });
          cam.fov = VIEW.fov;
          cam.position.set(VIEW.pos[0] + o.x, VIEW.pos[1] + o.y, VIEW.pos[2] + o.z);
          cam.lookAt(VIEW.look[0] + o.x, VIEW.look[1] + o.y, VIEW.look[2] + o.z);
          cam.updateProjectionMatrix();
          g.areas.update(1, cam);
          v.render(); // (his camera: the game's own draw would put the follow camera back)
          const gl = v.renderer.getContext();
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const lum = (x, y) => {
            const i = (y * w + x) * 4;
            return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          };
          // (The picture's rows 76 % to 99.5 % from its top: the near road under Jonas.)
          const picture = bands(lum, w, h, Math.round(0.005 * h), Math.round(0.24 * h));
          const r = { level: name, mode: v.describeMode(), size: [w, h], rms: picture.rms };
          const t = look.post?.ssao.a;
          if (t && look.level.post.ao > 0) {
            const half = new Uint16Array(t.width * t.height * 4);
            v.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, half);
            const ao = bands((x, y) => toFloat(half[(y * t.width + x) * 4]), t.width, t.height, Math.round(0.005 * t.height), Math.round(0.24 * t.height));
            r.aoRows = Math.min(...ao.rows);
            r.aoRms = ao.rms;
          }
          results.push(r);
        }
        return results;
      },
      [VIEW, levels],
    );
    assert.deepEqual(errors, [], `${tier}: no console errors`);
    return out;
  } finally {
    await page.close();
  }
}

function check(tier, results) {
  for (const r of results) {
    console.log(`  ${tier} ${r.level} (${r.mode}, ${r.size.join('x')}): bands ${r.rms.toFixed(3)}${r.aoRows !== undefined ? `, occlusion's rows over the road >= ${r.aoRows.toFixed(3)} (rms ${r.aoRms.toFixed(4)})` : ''}`);
    assert.ok(r.rms < 1, `${tier} ${r.level}: horizontal bands over the road, rms ${r.rms.toFixed(2)} levels (under 1)`);
    if (r.aoRows !== undefined) assert.ok(r.aoRows > 0.98, `${tier} ${r.level}: a row of the flat road occluded: ${r.aoRows.toFixed(3)}`);
  }
}

test('high: no streaks over the road at the dad\'s view (the picture and the occlusion at 12 and 8 taps; the governor\'s 85 %)', { skip, timeout: 420000 }, async () => {
  const results = await streaks('high', ['high', 'high ao8', 'high 85%']);
  assert.deepEqual(results.map((r) => r.aoRows !== undefined), [true, true, false], 'the occlusion drawn at 12 and 8 taps (off by the 85 % level)');
  check('high', results);
});

test('mid: no streaks over the road at the dad\'s view (the picture and the occlusion; the governor\'s 85 %)', { skip, timeout: 420000 }, async () => {
  const results = await streaks('mid', ['mid', 'mid 85%']);
  assert.deepEqual(results.map((r) => r.aoRows !== undefined), [true, false], 'the occlusion drawn on mid (off by its 85 % level)');
  check('mid', results);
});

test('low (phones: the direct path, no post chain): no streaks over the road at the dad\'s view', { skip, timeout: 420000 }, async () => {
  const results = await streaks('low', ['low', 'low 85%']);
  assert.ok(results.every((r) => r.aoRows === undefined && r.mode.includes('direct')), 'no occlusion on low');
  check('low', results);
});
