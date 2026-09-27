// The video recorder's pure parts (ui/recordLogic.js, N64Renderer frameLayout) and its hooks
// into the audio engine and the pause legend: the container/codec choice from
// MediaRecorder.isTypeSupported answers, the 16:9 picture rect and the recording pixel ratio
// for all kinds of windows, the element -> recording rect mapping, the file name, the frame
// guard, the clock, the CSS vignettes and drop shadow it redraws, the master-bus tap, the
// legend row and the recorder's texts in the pixel font. The recorder in the real game is
// tests/recorder-browser.test.js (E2E=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REC,
  REC_FORMATS,
  REC_TEXTS,
  REC_SMALL_STRINGS,
  pickFormat,
  recordFileName,
  inIframe,
  recordSupport,
  mapRect,
  recClock,
  parseRadialGradient,
  gradientRadii,
  parseDropShadow,
} from '../src/ui/recordLogic.js';
import { frameLayout } from '../src/render/N64Renderer.js';
import { KEY_CONTROLS, SMALL_STRINGS } from '../src/ui/hudLogic.js';
import { SMALL_FONT, missingGlyphs } from '../src/ui/bitmapFont.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { Recorder } from '../src/ui/Recorder.js';

const answers = (...supported) => (type) => supported.includes(type);

test('format: MP4 with H.264 + AAC where the browser records it, else WebM VP9/VP8 + Opus', () => {
  // Chrome/Edge on Windows or macOS: MP4 H.264 High + AAC.
  const chrome = pickFormat(answers('video/mp4;codecs=avc1.64002A,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/mp4'));
  assert.equal(chrome.mimeType, 'video/mp4;codecs=avc1.64002A,mp4a.40.2');
  assert.equal(chrome.ext, 'mp4');
  assert.deepEqual([chrome.video, chrome.audio], ['avc1.64002A', 'mp4a.40.2']);
  // Only Baseline profile: still MP4 + AAC.
  assert.equal(pickFormat(answers('video/mp4;codecs=avc1.42E02A,mp4a.40.2', 'video/webm;codecs=vp8,opus')).mimeType, 'video/mp4;codecs=avc1.42E02A,mp4a.40.2');
  // Chrome on Linux: H.264 but no AAC encoder -> MP4 with Opus before WebM.
  assert.equal(pickFormat(answers('video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus')).mimeType, 'video/mp4;codecs=avc1,opus');
  // Chromium without H.264 (the headless test browser) and Firefox: WebM, VP9 first.
  const chromium = pickFormat(answers('video/mp4', 'video/mp4;codecs=vp9,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'));
  assert.equal(chromium.mimeType, 'video/webm;codecs=vp9,opus');
  assert.equal(chromium.ext, 'webm');
  assert.equal(pickFormat(answers('video/webm;codecs=vp8,opus', 'video/webm')).mimeType, 'video/webm;codecs=vp8,opus');
  // An old Safari that only knows the plain type: MP4 (its own H.264 + AAC).
  const safari = pickFormat(answers('video/mp4'));
  assert.equal(safari.mimeType, 'video/mp4');
  assert.equal(safari.ext, 'mp4');
  // Nothing at all, or a throwing check.
  assert.equal(pickFormat(answers()), null);
  assert.equal(
    pickFormat(() => {
      throw new Error('nope');
    }),
    null,
  );
});

test('format: without a sound track the audio codec is left out of the type', () => {
  const seen = [];
  const fmt = pickFormat((t) => (seen.push(t), t === 'video/webm;codecs=vp9'), { audio: false });
  assert.equal(fmt.mimeType, 'video/webm;codecs=vp9');
  assert.equal(fmt.audio, null);
  assert.ok(seen.every((t) => !/mp4a|opus/.test(t)), 'no audio codec asked for');
  assert.equal(new Set(seen).size, seen.length, 'each type asked once');
  // Every candidate names a known container; MP4 + AAC ones come first.
  assert.ok(REC_FORMATS.every((f) => f.container === 'mp4' || f.container === 'webm'));
  assert.equal(REC_FORMATS[0].container, 'mp4');
  assert.equal(REC_FORMATS[0].audio, 'mp4a.40.2');
});

test('recording constants: exactly Full HD 16:9 at 60 fps, ~16 Mbit/s, 1 s chunks, a 10 minute limit', () => {
  assert.equal(REC.width, 1920);
  assert.equal(REC.height, 1080);
  assert.equal(REC.width / REC.height, REC.aspect);
  assert.equal(REC.fps, 60);
  assert.ok(REC.videoBitsPerSecond >= 12e6 && REC.videoBitsPerSecond <= 20e6);
  assert.ok(REC.timesliceMs > 0 && REC.timesliceMs <= 2000);
  assert.equal(REC.maxSeconds, 600);
});

test('16:9 framing: letterbox or pillarbox in any window, the buffer at least 1080 px tall', () => {
  const capture = { aspect: REC.aspect, minHeight: REC.height };
  const windows = [
    [1920, 1080], // exactly 16:9
    [1280, 720],
    [1000, 600], // 5:3: letterboxed (bars top and bottom)
    [960, 540],
    [1024, 768], // 4:3
    [2560, 1080], // ultra-wide: pillarboxed
    [900, 900], // square
    [390, 844], // phone portrait
    [844, 390], // phone landscape
    [3840, 2160], // 4K window: nothing to raise
    [333, 187],
    [1366, 768],
  ];
  for (const [w, h] of windows) {
    for (const base of [1, 1.5, 2]) {
      for (const pillarbox of [false, true]) {
        const { viewport: vp, pixelRatio } = frameLayout(w, h, { pillarbox, capture, basePixelRatio: base });
        const label = `${w}x${h} dpr ${base}${pillarbox ? ' 4:3 set' : ''}`;
        assert.ok(Math.abs(vp.width / vp.height - 16 / 9) < 2 / vp.height + 1e-9, `${label}: 16:9 (${vp.width}x${vp.height})`);
        assert.ok(vp.width <= w && vp.height <= h, `${label}: inside the window`);
        assert.ok(vp.width === w || vp.height === h, `${label}: as big as fits`);
        assert.ok(Math.abs(vp.x - (w - vp.width) / 2) <= 0.5 && Math.abs(vp.y - (h - vp.height) / 2) <= 0.5, `${label}: centred`);
        assert.ok(pixelRatio >= base, `${label}: never below the normal ratio`);
        // three.js sizes the buffer as floor(css * ratio).
        const bufH = Math.floor(vp.height * pixelRatio);
        const bufW = Math.floor(vp.width * pixelRatio);
        assert.ok(bufH >= REC.height, `${label}: buffer ${bufW}x${bufH}`);
        assert.ok(bufW >= REC.width - 2, `${label}: buffer ${bufW}x${bufH}`);
        if (base * vp.height < REC.height) assert.ok(bufH <= REC.height + 1, `${label}: raised just enough (${bufH})`);
        else assert.equal(pixelRatio, base, `${label}: already big enough`);
      }
    }
  }
});

test('framing without a capture is unchanged: full window, or the 4:3 pillarbox', () => {
  assert.deepEqual(frameLayout(1280, 720), { viewport: { x: 0, y: 0, width: 1280, height: 720 }, pixelRatio: 1 });
  assert.deepEqual(frameLayout(1280, 720, { pillarbox: true, basePixelRatio: 2 }), { viewport: { x: 160, y: 0, width: 960, height: 720 }, pixelRatio: 2 });
  // A capture overrides the 4:3 setting (restored when it ends: the setting is not touched).
  assert.deepEqual(frameLayout(1280, 960, { pillarbox: true, capture: { aspect: 16 / 9, minHeight: 1080 } }).viewport, { x: 0, y: 120, width: 1280, height: 720 });
});

test('element rects map from the picture on screen into the 1920x1080 recording', () => {
  // A 1000x563 picture letterboxed at y 18 in a 1000x600 window.
  const picture = { left: 0, top: 18, width: 1000, height: 562.5 };
  const out = {};
  const r = mapRect({ left: 0, top: 18, width: 1000, height: 562.5 }, picture, out);
  assert.equal(r, out, 'writes into the given object');
  assert.deepEqual(out, { x: 0, y: 0, w: 1920, h: 1080 });
  mapRect({ left: 500, top: 18 + 281.25, width: 100, height: 50 }, picture, out);
  assert.deepEqual(out, { x: 960, y: 540, w: 192, h: 96 });
  // Pillarboxed picture (x offset) and an element partly off it.
  const pic2 = { left: 140, top: 0, width: 640, height: 360 };
  mapRect({ left: 100, top: -10, width: 80, height: 20 }, pic2, out);
  assert.deepEqual(out, { x: -120, y: -30, w: 240, h: 60 });
  // Any recording size.
  mapRect({ left: 0, top: 0, width: 320, height: 180 }, { left: 0, top: 0, width: 640, height: 360 }, out, 1280, 720);
  assert.deepEqual(out, { x: 0, y: 0, w: 640, h: 360 });
});

test('file name: castle-grounds-YYYY-MM-DD-HHMM.<ext> in local time', () => {
  assert.equal(recordFileName(new Date(2026, 8, 27, 14, 5), 'mp4'), 'castle-grounds-2026-09-27-1405.mp4');
  assert.equal(recordFileName(new Date(2027, 0, 3, 0, 0), 'webm'), 'castle-grounds-2027-01-03-0000.webm');
  assert.match(recordFileName(), /^castle-grounds-\d{4}-\d{2}-\d{2}-\d{4}\.webm$/);
});

test('frame guard: inside an iframe recording refuses (downloads are blocked there)', () => {
  const top = {};
  top.self = top;
  top.top = top;
  assert.equal(inIframe(top), false);
  const framed = { top };
  framed.self = framed;
  assert.equal(inIframe(framed), true);
  const hostile = {
    self: null,
    get top() {
      throw new Error('cross-origin');
    },
  };
  assert.equal(inIframe(hostile), true, 'a top that cannot be read counts as framed');
  assert.equal(inIframe(null), false);

  const recorderWindow = (extra = {}) => {
    const w = { MediaRecorder: Object.assign(function MediaRecorder() {}, { isTypeSupported: () => true }), HTMLCanvasElement: function () {} };
    w.HTMLCanvasElement.prototype.captureStream = () => ({});
    w.self = w;
    w.top = w;
    return Object.assign(w, extra);
  };
  assert.equal(recordSupport(recorderWindow()), null);
  assert.equal(recordSupport(recorderWindow({ top: {} })), 'iframe', 'the frame comes first: the note explains how to record');
  assert.equal(recordSupport(recorderWindow({ MediaRecorder: undefined })), 'unsupported');
  const noCapture = recorderWindow();
  delete noCapture.HTMLCanvasElement.prototype.captureStream;
  assert.equal(recordSupport(noCapture), 'unsupported');
  assert.equal(recordSupport(null), 'unsupported');
});

test('REC clock reads mm:ss', () => {
  assert.equal(recClock(0), '00:00');
  assert.equal(recClock(9.99), '00:09');
  assert.equal(recClock(61), '01:01');
  assert.equal(recClock(600), '10:00');
  assert.equal(recClock(-3), '00:00');
  assert.equal(recClock(NaN), '00:00');
});

test('CSS vignettes: computed radial gradients parse into centre, shape and stops', () => {
  // The title card's, as Chromium serialises it.
  assert.deepEqual(parseRadialGradient('radial-gradient(at 50% 45%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 24, 0.4) 100%)'), {
    cx: 0.5,
    cy: 0.45,
    circle: false,
    stops: [[0.55, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 24, 0.4)']],
  });
  // The AI RACE alert's (ellipse at center: the defaults dropped).
  assert.deepEqual(parseRadialGradient('radial-gradient(rgba(120, 0, 0, 0) 45%, rgba(150, 0, 10, 0.55) 100%)'), {
    cx: 0.5,
    cy: 0.5,
    circle: false,
    stops: [[0.45, 'rgba(120, 0, 0, 0)'], [1, 'rgba(150, 0, 10, 0.55)']],
  });
  // Spelled out, keywords, stops without positions.
  const g = parseRadialGradient('radial-gradient(ellipse farthest-corner at right top, red, blue, rgb(0, 128, 0))');
  assert.equal(g.cx, 1);
  assert.equal(g.cy, 0);
  assert.deepEqual(g.stops.map(([t]) => t), [0, 0.5, 1]);
  assert.equal(parseRadialGradient('radial-gradient(circle at 36% 28%, red 0%, blue 46%)').circle, true);
  // What it does not draw: other kinds, explicit sizes, nothing.
  assert.equal(parseRadialGradient('linear-gradient(red, blue)'), null);
  assert.equal(parseRadialGradient('radial-gradient(circle 10px at 50% 50%, red 0%, blue 100%)'), null);
  assert.equal(parseRadialGradient('radial-gradient(closest-side, red, blue)'), null);
  assert.equal(parseRadialGradient('none'), null);
  assert.equal(parseRadialGradient(undefined), null);
});

test('CSS vignettes: farthest-corner radii (an ellipse through the corners)', () => {
  const { rx, ry } = gradientRadii({ cx: 0.5, cy: 0.5, circle: false }, 1920, 1080);
  assert.ok(Math.abs(rx - 960 * Math.SQRT2) < 1e-9 && Math.abs(ry - 540 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs((960 / rx) ** 2 + (540 / ry) ** 2 - 1) < 1e-9, 'passes through the corner');
  const off = gradientRadii({ cx: 0.5, cy: 0.45, circle: false }, 1000, 1000);
  assert.ok(Math.abs(off.ry - 550 * Math.SQRT2) < 1e-9, 'the farther side counts');
  const c = gradientRadii({ cx: 0, cy: 0, circle: true }, 300, 400);
  assert.equal(c.rx, 500);
  assert.equal(c.ry, 500);
});

test('the title logo drop shadow parses from the computed filter', () => {
  assert.deepEqual(parseDropShadow('drop-shadow(rgba(0, 0, 30, 0.35) 0px 9px 6px)'), { color: 'rgba(0, 0, 30, 0.35)', x: 0, y: 9, blur: 6 });
  assert.deepEqual(parseDropShadow('drop-shadow(2px 3px #000)'), { color: '#000', x: 2, y: 3, blur: 0 });
  assert.equal(parseDropShadow('none'), null);
  assert.equal(parseDropShadow('blur(2px)'), null);
  assert.equal(parseDropShadow(''), null);
});

test('pause legend has the V row; every recorder text is in the pixel font and checked for glyphs', () => {
  assert.deepEqual(KEY_CONTROLS.find(([k]) => k === 'V'), ['V', 'Record video']);
  for (const s of REC_SMALL_STRINGS) {
    assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], s);
    assert.ok(SMALL_STRINGS.includes(s), `glyph coverage checks "${s}"`);
  }
  for (const s of [...REC_TEXTS.iframe, ...REC_TEXTS.unsupported, ...REC_TEXTS.failed, REC_TEXTS.limit]) {
    assert.ok(REC_SMALL_STRINGS.includes(s), s);
  }
  assert.match(REC_TEXTS.iframe.join(' '), /own computer/);
  assert.match(REC_TEXTS.iframe.join(' '), /npm run dev/);
  assert.match(REC_TEXTS.iframe.join(' '), /npm run preview/);
  assert.deepEqual(missingGlyphs(SMALL_FONT, recordFileName(new Date(), 'webm')), []);
  for (const t of REC_SMALL_STRINGS) assert.ok(!/n64|nintendo|mario/i.test(t), t);
});

test('audio: the master bus is tapped in parallel with the speakers, and released', () => {
  const connections = [];
  const master = {
    connect: (node) => connections.push(['connect', node]),
    disconnect: (node) => connections.push(['disconnect', node]),
  };
  const stream = { id: 'tap' };
  const audio = new AudioEngine(null);
  assert.equal(audio.captureStream(), null, 'no context yet: a silent recording');
  audio.ctx = { createMediaStreamDestination: () => ({ stream }) };
  audio.mix = { master };
  const tap = audio.captureStream();
  assert.equal(tap.stream, stream);
  assert.equal(connections.length, 1);
  assert.equal(connections[0][0], 'connect');
  tap.release();
  tap.release();
  assert.deepEqual(connections.map(([k]) => k), ['connect', 'disconnect'], 'released once');
  audio._muted = true;
  assert.equal(audio.captureStream(), null, 'muted: silent');
  audio._muted = false;
  audio.ctx = { createMediaStreamDestination: () => { throw new Error('old browser'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(audio.captureStream(), null);
  } finally {
    console.warn = warn;
  }
});

test('the recorder imports and constructs in node without a DOM (nothing recorded)', async () => {
  const r = new Recorder({ view: null, uiRoot: null, audio: null, win: undefined });
  assert.equal(r.recording, false);
  assert.equal(await r.stop(), null);
  assert.equal(r.note, null);
});
