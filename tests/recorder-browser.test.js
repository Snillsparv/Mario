// The video recorder in the real game (Vite dev server, headless Chromium), opt-in: E2E=1.
// V in play (real time, sound on) records ~2 s: the picture is framed 16:9 (from the 4:3
// setting) with a drawing buffer at least 1080 px tall, the HUD canvas is composited every
// frame, V again downloads castle-grounds-YYYY-MM-DD-HHMM.mp4|webm: a non-empty file whose
// video is exactly 1920x1080, with a sound track, and whose frames show the HUD (the lives
// counter's gold digit); afterwards the 4:3 framing, the pixel ratio and the UI root's box are
// back. Inside a frame V only explains that recording works locally (no framing change), a
// modified or repeated V does nothing, and without MediaRecorder it says so.
// REC_OUT=<dir> also keeps the recorded file and a PNG of one of its frames there.
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
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
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

test('V records a 1920x1080 video with the HUD and sound, V saves it, the framing comes back', { skip, timeout: 300000 }, async () => {
  const { page, errors } = await open('/?skipTitle=1&pad=0');
  try {
    // Start from the 4:3 screen: recording frames 16:9 and hands 4:3 back afterwards.
    await page.evaluate(() => window.__game.view.setPillarbox(true));
    const before43 = await framing(page);
    assert.equal(before43.pillarbox, true);
    assert.ok(Math.abs(before43.viewport.width / before43.viewport.height - 4 / 3) < 0.01);

    await page.keyboard.press('KeyV');
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
    const name = download.suggestedFilename();
    assert.match(name, /^castle-grounds-\d{4}-\d{2}-\d{2}-\d{4}\.(mp4|webm)$/);
    const out = process.env.REC_OUT || (await fs.mkdtemp(path.join(os.tmpdir(), 'rec-')));
    await fs.mkdir(out, { recursive: true });
    const file = path.join(out, name);
    await download.saveAs(file);
    const bytes = await fs.readFile(file);
    assert.ok(bytes.length > 20000, `file size ${bytes.length}`);
    if (name.endsWith('.webm')) assert.equal(bytes.readUInt32BE(0), 0x1a45dfa3, 'EBML header');
    else assert.equal(bytes.toString('latin1', 4, 8), 'ftyp', 'MP4 ftyp box');
    const hasSound = /A_OPUS|mp4a|Opus|A_AAC/.test(bytes.toString('latin1'));
    assert.equal(hasSound, !!rec.format.audio, `sound track (${rec.format.mimeType}, audio context: ${rec.audio})`);
    assert.ok(rec.format.audio, 'recorded with the game sound');

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
    // digits at the top left, over the blue sky).
    const video = await page.evaluate(async () => {
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
      await v.play();
      const t0 = performance.now();
      while (v.currentTime < 0.8 && !v.ended && performance.now() - t0 < 8000) {
        await new Promise((r) => v.requestVideoFrameCallback(() => r()));
      }
      v.pause();
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0);
      // The lives digit: HUD scale 1080 / 240 = 4.5 px per logical px, the '4' at x 189..225,
      // y 67..112 (hud.js: MARGIN 18, icon 14 + 2, '×' 8; TOP 13 + 2).
      const px = ctx.getImageData(150, 55, 100, 70).data;
      let gold = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 110 && px[i + 2] < 120) gold++;
      // The sky beside it (no HUD there) has no gold.
      const sky = ctx.getImageData(700, 60, 100, 70).data;
      let skyGold = 0;
      for (let i = 0; i < sky.length; i += 4) if (sky[i] > 200 && sky[i + 1] > 110 && sky[i + 2] < 120) skyGold++;
      return { ...meta, time: v.currentTime, gold, skyGold, png: c.toDataURL('image/png') };
    });
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert.ok(video.gold > 150, `gold HUD digit pixels in the recording: ${video.gold}`);
    assert.ok(video.skyGold < 20, `no gold in the open sky: ${video.skyGold}`);
    if (process.env.REC_OUT) await fs.writeFile(path.join(out, name.replace(/\.\w+$/, '.png')), Buffer.from(video.png.split(',')[1], 'base64'));
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
