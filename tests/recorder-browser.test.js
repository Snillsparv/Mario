// The video recorder in the real game (Vite dev server, headless Chromium), opt-in: E2E=1.
// V in play (real time, sound on; its first press loads the recorder's chunk, then records)
// records ~2 s: the picture is framed 16:9 (from the 4:3
// setting) with a drawing buffer at least 1080 px tall, the HUD canvas is composited every
// frame, V again downloads castle-grounds-YYYY-MM-DD-HHMM.mp4|webm: a non-empty file whose
// video is exactly 1920x1080, with a sound track, and whose frames show the HUD (the lives
// counter's gold digit); afterwards the 4:3 framing, the pixel ratio and the UI root's box are
// back. 9 records portrait the same way: the picture framed 9:16 with a buffer at least 1920
// px tall, the camera zoomed out and the retro render turned to 240 columns, no frame recorded
// before the HUD has re-laid out for the column, V (either key) stops and saves
// castle-grounds-YYYY-MM-DD-HHMM-portrait.mp4|webm, exactly 1080x1920 with the HUD (from its
// first frame on), and the full-window framing, camera and retro render come back. Inside a
// frame V only explains that recording works locally (no framing change), a modified or
// repeated V does nothing, and without MediaRecorder it says so.
// REC_OUT=<dir> also keeps the recorded files and PNGs of their first frame (<name>-first.png)
// and of one at ~0.8 s (<name>.png) there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
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

async function open(url, viewport = { width: 1000, height: 600 }) {
  const page = await browser.newPage({ viewport, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}${url}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  return { page, errors };
}

// The picture's framing as the page has it now.
const framing = (page) =>
  page.evaluate(() => {
    const { view } = window.__game;
    const ui = document.getElementById('ui').style;
    const canvas = view.renderer.domElement;
    return {
      viewport: { ...view.viewport },
      pixelRatio: view.pixelRatio,
      pillarbox: view.pillarbox,
      capture: view.capture,
      hook: !!view.frameHook,
      buffer: { width: canvas.width, height: canvas.height },
      ui: { left: ui.left, top: ui.top, width: ui.width, height: ui.height },
    };
  });

// Wait until the HUD has painted its counters (the game's first ticks feed it): recording
// then starts mid-game, as a player would, not before the HUD was ever drawn.
const hudShown = (page) =>
  page.waitForFunction(
    () => {
      const c = window.__game.hud.canvas;
      if (!window.__game.hud.active || !c.width || !c.height) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 80)).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    },
    null,
    { timeout: 120000, polling: 250 },
  );

// Save the download (into REC_OUT or a temporary folder) and check its container and sound.
async function keep(download, format) {
  const name = download.suggestedFilename();
  const out = process.env.REC_OUT || (await fs.mkdtemp(path.join(os.tmpdir(), 'rec-')));
  await fs.mkdir(out, { recursive: true });
  const file = path.join(out, name);
  await download.saveAs(file);
  const bytes = await fs.readFile(file);
  assert.ok(bytes.length > 20000, `file size ${bytes.length}`);
  if (name.endsWith('.webm')) assert.equal(bytes.readUInt32BE(0), 0x1a45dfa3, 'EBML header');
  else assert.equal(bytes.toString('latin1', 4, 8), 'ftyp', 'MP4 ftyp box');
  const hasSound = /A_OPUS|mp4a|Opus|A_AAC/.test(bytes.toString('latin1'));
  assert.equal(hasSound, !!format.audio, `sound track (${format.mimeType})`);
  return { name, out };
}

// Count gold pixels (the HUD's lives digit) in each { x, y, w, h } region of the last saved
// video's first frame (`first`: its cover on a phone) and of the frame at ~0.8 s (`gold`);
// also its size and a PNG of the later frame.
const readVideo = (page, regions) =>
  page.evaluate(async (regions) => {
    const { url, size } = window.__game.recorder.last;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(new Error(`video error ${v.error?.code}`));
    });
    const meta = { width: v.videoWidth, height: v.videoHeight, size };
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    const count = () => {
      ctx.drawImage(v, 0, 0);
      return regions.map(({ x, y, w, h }) => {
        const px = ctx.getImageData(x, y, w, h).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 110 && px[i + 2] < 120) n++;
        return n;
      });
    };
    // The first presented frame, read in its own frame callback (before that the element has
    // nothing to draw).
    let first = null;
    let firstAt = null;
    const shown = new Promise((resolve) =>
      v.requestVideoFrameCallback((now, frame) => {
        first = count();
        firstAt = frame.mediaTime;
        resolve();
      }),
    );
    await v.play();
    await shown;
    const firstPng = c.toDataURL('image/png');
    const t0 = performance.now();
    while (v.currentTime < 0.8 && !v.ended && performance.now() - t0 < 8000) {
      await new Promise((r) => v.requestVideoFrameCallback(() => r()));
    }
    v.pause();
    const gold = count();
    return { ...meta, time: v.currentTime, first, firstAt, gold, png: c.toDataURL('image/png'), firstPng };
  }, regions);

const savePng = (video, out, name) =>
  process.env.REC_OUT ? Promise.all([fs.writeFile(path.join(out, name.replace(/\.\w+$/, '.png')), Buffer.from(video.png.split(',')[1], 'base64')), fs.writeFile(path.join(out, name.replace(/\.\w+$/, '-first.png')), Buffer.from(video.firstPng.split(',')[1], 'base64'))]) : null;

test('V records a 1920x1080 video with the HUD and sound, V saves it, the framing comes back', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('/?skipTitle=1&pad=0');
  try {
    // Start from the 4:3 screen: recording frames 16:9 and hands 4:3 back afterwards.
    await page.evaluate(() => window.__game.view.setPillarbox(true));
    const before43 = await framing(page);
    assert.equal(before43.pillarbox, true);
    assert.ok(Math.abs(before43.viewport.width / before43.viewport.height - 4 / 3) < 0.01);
    await hudShown(page);

    // (The first V loads the recorder's chunk, then starts: core/chunks.js.)
    assert.equal(await page.evaluate(() => window.__game.recorder), null, 'no recorder before the first V');
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => window.__game.recorder?.recording, null, { timeout: 30000, polling: 20 });
    const rec = await page.evaluate(() => {
      const { recorder, view } = window.__game;
      return { recording: recorder.recording, format: recorder.format, capture: view.capture, audio: !!window.__game.audio.ctx };
    });
    assert.equal(rec.recording, true, 'V starts recording');
    assert.match(rec.format.mimeType, /^video\/(mp4|webm)/);
    const during = await framing(page);
    const vp = during.viewport;
    assert.ok(Math.abs(vp.width / vp.height - 16 / 9) < 0.01, `16:9 picture: ${vp.width}x${vp.height}`);
    assert.equal(vp.width, 1000, 'a 1000x600 window letterboxes: full width');
    assert.equal(vp.y, Math.floor((600 - vp.height) / 2), 'centred');
    assert.ok(during.buffer.height >= 1080, `drawing buffer ${during.buffer.width}x${during.buffer.height}`);
    assert.ok(during.buffer.width >= 1918, `drawing buffer ${during.buffer.width}x${during.buffer.height}`);
    assert.deepEqual(during.ui, { left: `${vp.x}px`, top: `${vp.y}px`, width: `${vp.width}px`, height: `${vp.height}px` }, 'the UI follows the picture');
    assert.equal(during.hook, true);
    // The REC indicator shows, outside the UI root (never recorded).
    assert.equal(await page.evaluate(() => !!document.querySelector('.cg-rec-badge.cg-on') && !document.getElementById('ui').querySelector('.cg-rec')), true);

    // ~2 s of real time and a dozen frames (headless SwiftShader draws a 1080p picture and
    // encodes it in software: only a few frames a second here).
    const t0 = Date.now();
    await page.waitForFunction(() => window.__game.recorder.compositor.stats.frames >= 12, null, { timeout: 120000, polling: 250 });
    await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
    const comp = await page.evaluate(() => {
      const { recorder, hud } = window.__game;
      const c = recorder.compositor;
      return { frames: c.stats.frames, hud: c.drawn.includes(hud.canvas), canvases: c.stats.canvases, size: [c.canvas.width, c.canvas.height] };
    });
    assert.ok(comp.frames >= 10, `composited frames: ${comp.frames}`);
    assert.equal(comp.hud, true, 'the HUD canvas is composited');
    assert.deepEqual(comp.size, [1920, 1080]);

    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.keyboard.press('KeyV')]);
    const { name, out } = await keep(download, rec.format);
    assert.match(name, /^castle-grounds-\d{4}-\d{2}-\d{2}-\d{4}\.(mp4|webm)$/);
    assert.ok(rec.format.audio, `recorded with the game sound (audio context: ${rec.audio})`);

    // Framing, pixel ratio and the UI root's box are back (4:3).
    await page.waitForFunction(() => !window.__game.recorder.recording);
    const afterRec = await framing(page);
    assert.deepEqual(afterRec.viewport, before43.viewport);
    assert.equal(afterRec.pixelRatio, before43.pixelRatio);
    assert.deepEqual(afterRec.buffer, before43.buffer);
    assert.deepEqual(afterRec.ui, before43.ui);
    assert.equal(afterRec.pillarbox, true);
    assert.equal(afterRec.capture, null);
    assert.equal(afterRec.hook, false);
    const note = await page.evaluate(() => window.__game.recorder.note);
    assert.equal(note?.kind, 'saved');
    assert.equal(note.lines[0], `Saved ${name}`);

    // The saved video: exactly 1920x1080, and its frames show the HUD's lives counter (gold
    // digits at the top left, over the blue sky). The lives digit: HUD scale 1080 / 240 = 4.5
    // px per logical px, the '4' at x 189..225, y 67..112 (hud.js: MARGIN 18, icon 14 + 2,
    // '×' 8; TOP 13 + 2); the sky and cloud beside it (no HUD there, and left of the castle's
    // yellow flags) have no gold.
    const video = await readVideo(page, [
      { x: 150, y: 55, w: 100, h: 70 },
      { x: 300, y: 55, w: 100, h: 70 },
    ]);
    await savePng(video, out, name);
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    const [gold, skyGold] = video.gold;
    assert.ok(gold > 150, `gold HUD digit pixels in the recording: ${gold}`);
    assert.ok(skyGold < 20, `no gold in the open sky: ${skyGold}`);
    assert.ok(video.first[0] > 150, `the first frame (at ${video.firstAt} s) has the HUD too: ${video.first[0]}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('9 records a 1080x1920 portrait video with the HUD, V saves it, framing and camera come back', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('/?skipTitle=1&pad=0');
  try {
    await page.evaluate(() => window.__game.loadRecorder()); // (its chunk in, as after a first V)
    const look = () =>
      page.evaluate(() => {
        const { view, recorder } = window.__game;
        return { zoom: view.camera.zoom, internal: { ...view.internal }, n64: view.n64, mode: view.describeMode(), shape: recorder.shape, recording: recorder.recording };
      });
    const before = await framing(page);
    const beforeLook = await look();
    assert.equal(before.pillarbox, false);
    assert.deepEqual(before.viewport, { x: 0, y: 0, width: 1000, height: 600 });
    assert.equal(beforeLook.zoom, 1);
    assert.equal(beforeLook.n64, true, 'the retro filter is on by default');
    assert.equal(beforeLook.internal.height, 240);
    await hudShown(page);
    // Log every composited frame: the MediaRecorder's state and the HUD bitmap's width against
    // its box. The HUD re-lays out for the 9:16 column a frame or two late (a ResizeObserver),
    // and those frames must not be recorded: the video would open on the full-window HUD
    // squeezed into the column.
    await page.evaluate(() => {
      const r = window.__game.recorder;
      const frame = r.frame.bind(r);
      window.__recFrames = [];
      r.frame = () => {
        frame();
        const c = window.__game.hud.canvas;
        if (r.session) window.__recFrames.push({ state: r.session.mr?.state ?? 'settling', bitmap: c.width, box: Math.round(c.getBoundingClientRect().width * devicePixelRatio) });
      };
    });

    await page.keyboard.press('Digit9');
    const rec = await page.evaluate(() => ({ format: window.__game.recorder.format, capture: window.__game.view.capture }));
    const on = await look();
    assert.equal(on.recording, true, '9 starts recording');
    assert.equal(on.shape, 'portrait');
    assert.equal(rec.capture.aspect, 9 / 16);
    const during = await framing(page);
    const vp = during.viewport;
    assert.deepEqual(vp, { x: 331, y: 0, width: 338, height: 600 }, 'a 9:16 column, centred, full height');
    assert.ok(during.buffer.height >= 1920, `drawing buffer ${during.buffer.width}x${during.buffer.height}`);
    assert.ok(during.buffer.width >= 1078, `drawing buffer ${during.buffer.width}x${during.buffer.height}`);
    assert.deepEqual(during.ui, { left: `${vp.x}px`, top: `${vp.y}px`, width: `${vp.width}px`, height: `${vp.height}px` }, 'the UI follows the picture');
    assert.equal(on.zoom, 0.75, 'the camera sees wider');
    assert.deepEqual(on.internal, { width: 240, height: 426 }, 'retro: 240 columns');
    assert.match(on.mode, /9:16 rec/);

    const t0 = Date.now();
    await page.waitForFunction(() => window.__game.recorder.compositor.stats.frames >= 12, null, { timeout: 120000, polling: 250 });
    await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
    const comp = await page.evaluate(() => {
      const { recorder, hud } = window.__game;
      const c = recorder.compositor;
      return { hud: c.drawn.includes(hud.canvas), size: [c.canvas.width, c.canvas.height] };
    });
    assert.equal(comp.hud, true, 'the HUD canvas is composited');
    assert.deepEqual(comp.size, [1080, 1920]);
    const frames = await page.evaluate(() => window.__recFrames);
    const recorded = frames.filter((f) => f.state === 'recording');
    assert.ok(recorded.length >= 2, `recorded frames: ${JSON.stringify(frames)}`);
    for (const f of recorded) assert.ok(Math.abs(f.bitmap - f.box) <= 1, `a recorded frame with a stale HUD: ${JSON.stringify(frames)}`);

    // V stops a portrait recording too (it does not start a landscape one).
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.keyboard.press('KeyV')]);
    const { name, out } = await keep(download, rec.format);
    assert.match(name, /^castle-grounds-\d{4}-\d{2}-\d{2}-\d{4}-portrait\.(mp4|webm)$/);
    await page.waitForFunction(() => !window.__game.recorder.recording);
    const off = await look();
    assert.equal(off.recording, false);
    assert.equal(off.shape, null);
    assert.deepEqual(await framing(page), before, 'full-window framing, pixel ratio, buffer and UI box are back');
    assert.deepEqual(off.internal, beforeLook.internal);
    assert.equal(off.zoom, 1);
    assert.equal(off.mode, beforeLook.mode);
    assert.equal(await page.evaluate(() => window.__game.recorder.last.shape), 'portrait');

    // Exactly 1080x1920; the lives digit at the top left (HUD 1080 / 320 = 3.375 px per logical
    // px: x 142..169, y 50..84), none in the sky right of it.
    const video = await readVideo(page, [
      { x: 110, y: 35, w: 100, h: 65 },
      { x: 480, y: 35, w: 100, h: 65 },
    ]);
    await savePng(video, out, name);
    assert.equal(video.width, 1080);
    assert.equal(video.height, 1920);
    const [gold, skyGold] = video.gold;
    assert.ok(gold > 80, `gold HUD digit pixels in the recording: ${gold}`);
    assert.ok(skyGold < 20, `no gold in the open sky: ${skyGold}`);
    // The very first frame (a reel's default cover) already has the HUD laid out for 9:16, not
    // the old full-window HUD squeezed into the column.
    assert.ok(video.first[0] > 80 && video.first[1] < 20, `the first frame's HUD (at ${video.firstAt} s): ${video.first}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('in a frame V only explains; a modified or repeated V does nothing; no MediaRecorder: a note', { skip, timeout: 300000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  try {
    await page.setContent(`<iframe src="${base}/?test=1&mute=1" style="border:0;width:900px;height:500px"></iframe>`);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    await frame.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    const key = (init) => frame.evaluate((i) => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', ...i })), init);
    const state = () =>
      frame.evaluate(() => {
        const { recorder, view } = window.__game;
        const box = document.querySelector('.cg-rec-note.cg-on');
        return { recording: recorder.recording, note: recorder.note, capture: view.capture, shown: box ? box.querySelectorAll('canvas').length : 0, kind: box?.dataset.kind ?? null };
      });
    const before = await frame.evaluate(() => ({ ...window.__game.view.viewport }));
    await key({ ctrlKey: true });
    await key({ metaKey: true });
    await key({ altKey: true });
    assert.equal((await state()).note, null, 'Ctrl/Cmd/Alt+V are left alone');
    await key({});
    const s = await state();
    assert.equal(s.recording, false, 'no recording inside a frame');
    assert.equal(s.capture, null, 'no framing change');
    assert.equal(s.note?.kind, 'iframe');
    assert.match(s.note.lines.join(' '), /your own computer/);
    assert.match(s.note.lines.join(' '), /npm run dev/);
    assert.equal(s.kind, 'iframe');
    assert.equal(s.shown, 3, 'three lines in the pixel font');
    assert.deepEqual(await frame.evaluate(() => ({ ...window.__game.view.viewport })), before);
  } finally {
    await page.close();
  }

  const { page: p2, errors } = await open('/?test=1&mute=1', { width: 800, height: 600 });
  try {
    await p2.evaluate(() => {
      window.__startSpy = 0;
      const r = window.__game.recorder;
      const start = r.start.bind(r);
      r.start = () => (window.__startSpy++, start());
    });
    await p2.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', repeat: true })));
    assert.equal(await p2.evaluate(() => window.__startSpy), 0, 'key repeat does not toggle');
    await p2.evaluate(() => {
      window.MediaRecorder = undefined;
    });
    await p2.keyboard.press('KeyV');
    const s = await p2.evaluate(() => ({ recording: window.__game.recorder.recording, note: window.__game.recorder.note, capture: window.__game.view.capture }));
    assert.equal(s.recording, false);
    assert.equal(s.capture, null);
    assert.equal(s.note?.kind, 'unsupported');
    assert.deepEqual(errors, []);
  } finally {
    await p2.close();
  }
});
