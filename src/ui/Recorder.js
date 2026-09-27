// In-game video recorder: V starts recording, V again stops and saves the video: always exactly
// 1920x1080 (16:9, Full HD) at up to 60 fps with the game's sound, whatever the window's size.
//
//   const recorder = new Recorder({ view, uiRoot, audio });   // listens for V itself
//   recorder.toggle(); recorder.start() -> boolean; recorder.stop(reason?) -> Promise<saved | null>
//   recorder.recording, recorder.format ({ mimeType, ext, ... }), recorder.compositor (while
//   recording: .canvas, .drawn = the UI elements in the last frame, .stats), recorder.last
//   ({ name, type, size, url, seconds, reason } of the last saved file; url lives ~60 s),
//   recorder.note ({ kind, lines } while a message shows), recorder.dispose()
//
// While recording:
//   * the renderer frames the picture at 16:9 inside the window (letter- or pillarbox bars as
//     needed; the UI root follows through view.alignOverlay) and raises its pixel ratio until
//     the drawing buffer is at least 1080 px tall (view.setCapture); retro mode keeps its
//     240-line render, only its upscaled output grows. Stopping restores the 4:3 / full-window
//     setting and the pixel ratio; F2/R and F3/4 keep working (4:3 applies after the recording).
//   * after every view.render() (view.setFrameHook) the Compositor paints one reused 1920x1080
//     2D canvas: the WebGL picture, then every visible UI canvas inside the UI root at its
//     on-screen rect (computed display, visibility and the product of the ancestors' opacity;
//     pixel art unsmoothed), and the CSS-only visuals: background colours and radial-gradient
//     vignettes (the AI RACE alert's red one, the title card's, the GAME OVER card's dimming,
//     the face screen's curtain), rounded corners and borders, and the title logo's drop shadow.
//     The UI list is rebuilt only when the UI root's DOM changes (a MutationObserver). DOM
//     text is not recorded (the game draws its text into canvases). canvas.captureStream(60)
//     feeds a MediaRecorder together with the audio engine's master bus
//     (audio.captureStream(): silent without audio).
//   * format: MP4 (H.264 + AAC) where the browser records it, else WebM (VP9/VP8 + Opus)
//     (recordLogic.js pickFormat), ~16 Mbit/s, a chunk every second.
//   * a blinking REC dot and the running time in the window's lower-right corner, and the notes
//     ("Saved <file>", "not available here", ...), live outside the UI root: never recorded.
// Stopping (V, the 10-minute safety limit, the page hidden) saves
// castle-grounds-YYYY-MM-DD-HHMM.mp4|webm through a temporary <a download>; when the page goes
// away (pagehide) the chunks recorded so far are saved at once. Inside a frame (the sandboxed
// artifact page blocks downloads) V only explains that recording works when the game runs on
// your own computer; without MediaRecorder / captureStream it says so.
// Nothing runs while not recording but the V key listener.

import { SMALL_FONT } from './bitmapFont.js';
import { textCanvas, SpriteCache, drawIcon } from './raster.js';
import { hudMetrics } from './hudLogic.js';
import { pixelRatio } from './pixelRatio.js';
import {
  REC,
  REC_TEXTS,
  pickFormat,
  recordFileName,
  recordSupport,
  mapRect,
  recClock,
  parseRadialGradient,
  gradientRadii,
  parseDropShadow,
} from './recordLogic.js';

const URL_TTL_MS = 60000; // the saved file's object URL is revoked after this
const NOTE_MS = 3500;
const LONG_NOTE_MS = 6500;

// A computed colour with zero alpha ('rgba(0, 0, 0, 0)', 'transparent', 'rgb(0 0 0 / 0)').
const isClear = (c) => !c || c === 'transparent' || /[,/]\s*0\)$/.test(c);

// Paints the game picture and the UI over it into one 1920x1080 canvas, once per frame.
export class Compositor {
  constructor(root, source) {
    this.root = root;
    this.source = source; // the WebGL canvas (it is the picture rect)
    this.canvas = document.createElement('canvas');
    this.canvas.width = REC.width;
    this.canvas.height = REC.height;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.layers = []; // every element under the root, in paint order
    this.alpha = new Float32Array(64);
    this.shown = new Uint8Array(64);
    this.drawn = []; // elements painted in the last frame (reused)
    this.stats = { frames: 0, layers: 0, canvases: 0, boxes: 0, refreshes: 0 };
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.dirty = true;
    this.rootStyle = getComputedStyle(root);
    this.observer = typeof MutationObserver === 'function' ? new MutationObserver(() => (this.dirty = true)) : null;
    this.observer?.observe(root, { childList: true, subtree: true });
  }

  // The element list: the root's children by z-index (the phone panel paints on top), each
  // with its subtree in tree order. Live computed styles are kept, read each frame.
  refresh() {
    this.dirty = false;
    this.stats.refreshes++;
    const layers = [];
    const visit = (el, parent, shadow) => {
      const cs = getComputedStyle(el);
      const own = parseDropShadow(cs.filter);
      const layer = { el, cs, parent, canvas: el.tagName === 'CANVAS', shadow: own ?? shadow, gradKey: '', grad: null, fill: null, fillR: 0 };
      const index = layers.push(layer) - 1;
      for (const child of el.children) visit(child, index, layer.shadow);
    };
    const top = [...this.root.children].map((el, i) => ({ el, i, z: parseInt(getComputedStyle(el).zIndex, 10) || 0 }));
    top.sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { el } of top) visit(el, -1, null);
    this.layers = layers;
    this.stats.layers = layers.length;
    if (this.alpha.length < layers.length) {
      this.alpha = new Float32Array(layers.length * 2);
      this.shown = new Uint8Array(layers.length * 2);
    }
  }

  // One frame; call right after the WebGL canvas was drawn (its buffer is still valid).
  draw(dpr = 1) {
    const { ctx, source } = this;
    if (!source.width || !source.height) return false;
    const pic = source.getBoundingClientRect();
    if (pic.width < 1 || pic.height < 1) return false;
    if (this.dirty) this.refresh();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = source.height > REC.height * 1.2 ? 'high' : 'low'; // a HiDPI buffer shrinks
    ctx.drawImage(source, 0, 0, REC.width, REC.height);
    const rs = this.rootStyle;
    const rootAlpha = rs.display === 'none' ? 0 : Number(rs.opacity);
    const { layers, alpha, shown, drawn } = this;
    drawn.length = 0;
    let canvases = 0;
    let boxes = 0;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const cs = L.cs;
      const top = L.parent < 0;
      const pa = top ? rootAlpha : alpha[L.parent];
      const on = (top || shown[L.parent] === 1) && pa > 0 && cs.display !== 'none';
      shown[i] = on ? 1 : 0;
      if (!on) {
        alpha[i] = 0;
        continue;
      }
      const a = pa * Number(cs.opacity);
      alpha[i] = a;
      if (a < 0.004 || cs.visibility !== 'visible') continue;
      if (L.canvas ? this.drawCanvas(L, a, pic, dpr) : this.drawBox(L, a, pic)) {
        drawn.push(L.el);
        if (L.canvas) canvases++;
        else boxes++;
      }
    }
    ctx.globalAlpha = 1;
    this.stats.frames++;
    this.stats.canvases = canvases;
    this.stats.boxes = boxes;
    return true;
  }

  // The element's rect in the recording, or null when it is empty or off the picture.
  place(el, pic) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return null;
    const o = mapRect(r, pic, this.rect);
    if (o.x >= REC.width || o.y >= REC.height || o.x + o.w <= 0 || o.y + o.h <= 0) return null;
    return o;
  }

  drawCanvas(L, a, pic, dpr) {
    const c = L.el;
    if (!c.width || !c.height) return false;
    const o = this.place(c, pic);
    if (!o) return false;
    const { ctx } = this;
    // Smooth only what the page smooths itself: a canvas stretched by CSS (the title logo).
    // Pixel art (image-rendering: pixelated, or drawn 1:1 in device px) stays crisp.
    const ir = L.cs.imageRendering;
    const cssPx = (o.w / REC.width) * pic.width * dpr;
    ctx.imageSmoothingEnabled = ir !== 'pixelated' && ir !== 'crisp-edges' && Math.abs(cssPx - c.width) > Math.max(2, c.width * 0.04);
    ctx.globalAlpha = a;
    const sh = L.shadow;
    if (sh) {
      const k = REC.height / pic.height;
      ctx.shadowColor = sh.color;
      ctx.shadowOffsetX = sh.x * k;
      ctx.shadowOffsetY = sh.y * k;
      ctx.shadowBlur = sh.blur * k;
    }
    ctx.drawImage(c, o.x, o.y, o.w, o.h);
    if (sh) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0)';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    return true;
  }

  // CSS-only visuals: background colour, a radial-gradient background, rounded corners and a
  // border (box shadows and DOM text are left out).
  drawBox(L, a, pic) {
    const cs = L.cs;
    const color = cs.backgroundColor;
    const image = cs.backgroundImage;
    const fill = !isClear(color);
    if (image !== L.gradKey) {
      L.gradKey = image;
      L.grad = image && image !== 'none' ? parseRadialGradient(image) : null;
      L.fill = null;
    }
    const style = cs.borderTopStyle;
    const bw = style !== 'none' && style !== 'hidden' && !isClear(cs.borderTopColor) ? parseFloat(cs.borderTopWidth) || 0 : 0;
    if (!fill && !L.grad && bw <= 0) return false;
    const o = this.place(L.el, pic);
    if (!o) return false;
    const { ctx } = this;
    const k = REC.height / pic.height;
    const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * k;
    ctx.globalAlpha = a;
    if (fill) {
      ctx.fillStyle = color;
      this.path(o.x, o.y, o.w, o.h, radius);
      ctx.fill();
    }
    if (L.grad) this.fillGradient(L, o);
    if (bw > 0) {
      const w = bw * k;
      ctx.strokeStyle = cs.borderTopColor;
      ctx.lineWidth = w;
      this.path(o.x + w / 2, o.y + w / 2, o.w - w, o.h - w, Math.max(0, radius - w / 2));
      ctx.stroke();
    }
    return true;
  }

  path(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    if (r > 0.5 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
  }

  // A CSS radial gradient (farthest-corner ellipse) as a canvas one: a circle of radius rx
  // squashed to ry. The CanvasGradient is kept until the box's size changes.
  fillGradient(L, o) {
    const g = L.grad;
    const { rx, ry } = gradientRadii(g, o.w, o.h);
    if (!(rx > 0 && ry > 0)) return;
    const { ctx } = this;
    if (!L.fill || Math.abs(L.fillR - rx) > 0.5) {
      L.fill = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      for (const [t, c] of g.stops) L.fill.addColorStop(t, c);
      L.fillR = rx;
    }
    const cx = o.x + g.cx * o.w;
    const cy = o.y + g.cy * o.h;
    const k = ry / rx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, k);
    ctx.fillStyle = L.fill;
    ctx.fillRect(o.x - cx, (o.y - cy) / k, o.w, o.h / k);
    ctx.restore();
  }

  dispose() {
    this.observer?.disconnect();
    this.layers = [];
    this.drawn.length = 0;
    this.canvas.width = this.canvas.height = 1; // free the 8 MB
  }
}

// The REC indicator and the recorder's notes: fixed to the window, outside the UI root, so the
// recording never shows them. Pixel font at the HUD's scale.
const REC_DOT = {
  w: 7,
  h: 7,
  rows: ['..rrr..', '.rhrrr.', 'rhhrrrr', 'rrrrrrr', 'rrrrrrd', '.rrrdd.', '..rdd..'],
  palette: { r: '#f0302a', h: '#ff9c8c', d: '#b01810' },
};

const OVERLAY_CSS = `
.cg-rec { position:fixed; inset:0; pointer-events:none; z-index:40; }
.cg-rec-badge { position:absolute; right:10px; bottom:8px; display:none; align-items:center; gap:6px; }
.cg-rec-badge.cg-on { display:flex; }
.cg-rec-dot { animation: cg-rec-blink 1s steps(1) infinite; }
.cg-rec-note { position:absolute; left:50%; bottom:14%; transform:translateX(-50%); display:none; flex-direction:column;
  align-items:center; padding:6px 12px; border-radius:6px; background:rgba(8,10,40,0.78); }
.cg-rec-note.cg-on { display:flex; }
.cg-rec canvas { display:block; image-rendering:pixelated; }
@keyframes cg-rec-blink { 0% { opacity:1; } 50% { opacity:0; } }
@media (prefers-reduced-motion: reduce) { .cg-rec-dot { animation:none; } }
`;

class RecOverlay {
  constructor() {
    if (!document.getElementById('cg-rec-css')) {
      const style = document.createElement('style');
      style.id = 'cg-rec-css';
      style.textContent = OVERLAY_CSS;
      document.head.appendChild(style);
    }
    this.el = document.createElement('div');
    this.el.className = 'cg-rec';
    this.badge = document.createElement('div');
    this.badge.className = 'cg-rec-badge';
    this.dot = document.createElement('canvas');
    this.dot.className = 'cg-rec-dot';
    this.clock = document.createElement('canvas');
    this.badge.append(this.dot, this.clock);
    this.noteBox = document.createElement('div');
    this.noteBox.className = 'cg-rec-note';
    this.el.append(this.badge, this.noteBox);
    document.body.appendChild(this.el);
    this.note = null; // { kind, lines } while a note shows
    this.noteTimer = 0;
    this.px = 0;
    this.cache = new SpriteCache();
  }

  // Device px per font pixel (the HUD's scale for the window) and the ratio.
  scale() {
    const dpr = pixelRatio();
    const { scale } = hudMetrics(innerWidth, innerHeight);
    return { dpr, px: Math.max(1, scale * dpr) };
  }

  // A text line as a canvas at `px`, sized in CSS px.
  line(text, px, dpr, style = 'white') {
    const c = textCanvas(SMALL_FONT, text, px, style);
    c.style.width = `${c.width / dpr}px`;
    c.style.height = `${c.height / dpr}px`;
    return c;
  }

  showRec(seconds) {
    const { dpr, px } = this.scale();
    if (px !== this.px) {
      this.px = px;
      const size = Math.ceil((REC_DOT.w + 3) * px);
      this.dot.width = this.dot.height = size;
      const ctx = this.dot.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      drawIcon(ctx, this.cache, REC_DOT, 'recDot', px, px, px);
      this.dot.style.width = this.dot.style.height = `${size / dpr}px`;
    }
    const text = this.line(`${REC_TEXTS.rec} ${recClock(seconds)}`, px, dpr);
    text.className = this.clock.className;
    this.clock.replaceWith(text);
    this.clock = text;
    this.badge.classList.add('cg-on');
  }

  hideRec() {
    this.badge.classList.remove('cg-on');
  }

  showNote(kind, lines, ms = NOTE_MS) {
    clearTimeout(this.noteTimer);
    const { dpr, px: full } = this.scale();
    // Shrink the text until the widest line fits the window.
    const widest = Math.max(...lines.map((t) => textCanvas(SMALL_FONT, t, 1, 'white').width));
    const px = Math.max(1, Math.min(full, (innerWidth * dpr * 0.9) / widest));
    this.noteBox.replaceChildren(...lines.map((t, i) => this.line(t, px, dpr, i === 0 && kind === 'saved' ? 'key' : 'white')));
    this.noteBox.dataset.kind = kind;
    this.noteBox.classList.add('cg-on');
    this.note = { kind, lines: [...lines] };
    this.noteTimer = setTimeout(() => this.hideNote(), ms);
  }

  hideNote() {
    clearTimeout(this.noteTimer);
    this.noteBox.classList.remove('cg-on');
    this.noteBox.replaceChildren();
    this.note = null;
  }

  dispose() {
    clearTimeout(this.noteTimer);
    this.el.remove();
  }
}

// Save `blob` as `name` through a temporary download link.
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), URL_TTL_MS);
  return url;
}

export class Recorder {
  constructor({ view, uiRoot, audio = null, win = globalThis.window } = {}) {
    this.view = view;
    this.uiRoot = uiRoot;
    this.audio = audio;
    this.win = win;
    this.session = null;
    this.compositor = null;
    this.format = null;
    this.last = null;
    this.overlay = null;
    this._frame = () => this.frame();
    this._onHidden = () => {
      if (document.hidden) this.stop('hidden');
    };
    this._onPageHide = () => this.saveNow('unload');
    this._onKey = (e) => {
      if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      this.toggle();
    };
    if (typeof document === 'undefined' || !win?.addEventListener) return; // node
    win.addEventListener('keydown', this._onKey);
  }

  get recording() {
    return !!this.session;
  }

  get note() {
    return this.overlay?.note ?? null;
  }

  toggle() {
    if (this.session) {
      this.stop('key');
      return false;
    }
    return this.start();
  }

  _overlay() {
    this.overlay ??= new RecOverlay();
    return this.overlay;
  }

  // Start recording; false (with a note on screen) when it cannot here.
  start() {
    if (this.session) return true;
    const why = recordSupport(this.win);
    if (why) {
      this._overlay().showNote(why, REC_TEXTS[why], why === 'iframe' ? LONG_NOTE_MS : NOTE_MS);
      return false;
    }
    const MR = this.win.MediaRecorder;
    const tap = this.audio?.captureStream?.() ?? null; // null: muted or no audio -> silent video
    const format = pickFormat((type) => MR.isTypeSupported(type), { audio: !!tap });
    if (!format) {
      tap?.release();
      this._overlay().showNote('unsupported', REC_TEXTS.unsupported);
      return false;
    }
    const view = this.view;
    let compositor = null;
    let stream = null;
    let mr = null;
    try {
      view.setCapture({ aspect: REC.aspect, minHeight: REC.height });
      view.draw(); // the 16:9 frame in the buffer now, for the first composite
      compositor = new Compositor(this.uiRoot, view.renderer.domElement);
      compositor.draw(pixelRatio(this.win));
      stream = compositor.canvas.captureStream(REC.fps);
      for (const track of tap?.stream.getAudioTracks() ?? []) stream.addTrack(track);
      const opts = { mimeType: format.mimeType, videoBitsPerSecond: REC.videoBitsPerSecond };
      if (tap) opts.audioBitsPerSecond = REC.audioBitsPerSecond;
      mr = new MR(stream, opts);
      mr.start(REC.timesliceMs);
    } catch (err) {
      console.warn('video recording could not start:', err);
      for (const track of stream?.getVideoTracks() ?? []) track.stop();
      tap?.release();
      compositor?.dispose();
      view.setCapture(null);
      this._overlay().showNote('failed', REC_TEXTS.failed);
      return false;
    }
    const s = {
      mr,
      stream,
      tap,
      compositor,
      format,
      chunks: [],
      name: recordFileName(new Date(), format.ext),
      startedAt: performance.now(),
      second: -1,
      saved: false,
      limitTimer: 0,
    };
    mr.ondataavailable = (e) => {
      if (e.data?.size > 0) s.chunks.push(e.data);
    };
    mr.onerror = (e) => {
      console.warn('video recording failed:', e?.error ?? e);
      if (this.session === s) this.stop('error');
    };
    s.limitTimer = setTimeout(() => this.stop('limit'), REC.maxSeconds * 1000);
    this.session = s;
    this.compositor = compositor;
    this.format = format;
    document.addEventListener('visibilitychange', this._onHidden);
    this.win.addEventListener('pagehide', this._onPageHide);
    view.setFrameHook(this._frame);
    this._overlay().hideNote();
    this.frame();
    return true;
  }

  // After every render while recording (the renderer's frame hook).
  frame() {
    const s = this.session;
    if (!s) return;
    s.compositor.draw(pixelRatio(this.win));
    const second = Math.floor((performance.now() - s.startedAt) / 1000);
    if (second !== s.second) {
      s.second = second;
      this.overlay.showRec(second);
    }
  }

  // Stop and save. Resolves to the saved file's info (recorder.last), or null.
  stop(reason = 'key') {
    const s = this.session;
    if (!s) return Promise.resolve(null);
    this.session = null;
    clearTimeout(s.limitTimer);
    this.view.setFrameHook(null);
    this.view.setCapture(null);
    document.removeEventListener('visibilitychange', this._onHidden);
    this.win.removeEventListener('pagehide', this._onPageHide);
    this.overlay?.hideRec();
    s.compositor.dispose();
    this.compositor = null;
    s.seconds = (performance.now() - s.startedAt) / 1000;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const track of s.stream.getTracks()) track.stop();
        s.tap?.release();
        resolve(this.save(s, reason));
      };
      if (s.mr.state === 'inactive') return finish();
      s.mr.addEventListener('stop', finish, { once: true });
      try {
        s.mr.stop();
      } catch {
        finish();
      }
    });
  }

  // The page is going away: save the chunks recorded so far right now (the last second or
  // so is lost), then stop.
  saveNow(reason = 'unload') {
    const s = this.session;
    if (!s) return;
    s.seconds = (performance.now() - s.startedAt) / 1000;
    this.save(s, reason);
    this.stop(reason);
  }

  save(s, reason) {
    if (s.saved) return this.last;
    s.saved = true;
    const mimeType = s.mr.mimeType || s.format.mimeType;
    const blob = new Blob(s.chunks, { type: mimeType.split(';')[0] });
    if (!blob.size) {
      this._overlay().showNote('failed', REC_TEXTS.failed);
      return null;
    }
    const url = download(blob, s.name);
    this.last = { name: s.name, type: mimeType, size: blob.size, url, seconds: s.seconds, reason };
    const lines = [`${REC_TEXTS.saved} ${s.name}`];
    if (reason === 'limit') lines.push(REC_TEXTS.limit);
    this._overlay().showNote('saved', lines);
    return this.last;
  }

  dispose() {
    this.stop('dispose');
    this.win?.removeEventListener?.('keydown', this._onKey);
    this.overlay?.dispose();
    this.overlay = null;
  }
}
