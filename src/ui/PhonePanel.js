// The phone-controller panel: how to hook a phone up as Pip's controller (net/RemotePad.js).
// A DOM overlay in #ui in the HUD's retro look (bitmap fonts, dark navy panel with a gold
// edge), laid out on the HUD's 320x240 logical grid so it scales with the picture and keeps
// every font pixel and QR module on whole device pixels.
//
//   const phone = new PhonePanel(uiRoot, { remotePad, events, hud, canOpen: () => bool });
//   phone.available            // remotePad.available: the entry points are shown only then
//   phone.open() / phone.close() / phone.isOpen
//   phone.update(controller)   // 30 Hz while open during play: Start / B close it
//
// It shows the QR code of remotePad.padUrl (with its quiet zone), the URL as selectable text,
// the room code, "Scan with your phone - same Wi-Fi" and the link state (connecting / waiting /
// connected). When a phone joins while it is open it shows "PHONE CONNECTED!" and closes
// itself after JOINED_CLOSE_MS.
//
// Entry points: the P key whenever canOpen() allows it (main: on the title and on the pause
// screen), the title card's phone button (ui/TitleScreen.js), and the pause legend's
// "P  Phone controller" row (drawn by ui/pauseScreen.js while phoneEntry.enabled; this panel
// lays a click target over it). Closing: Esc / Enter / J (B) / P / Backspace, a click on the ×
// or beside the panel, Start / B on a gamepad or the phone (update() on the pause screen; the
// title card handles pads itself). While open, keys never reach the game or the title card.
//
// While a phone is connected a small phone badge sits in the bottom-left corner.

import { BIG_FONT, SMALL_FONT } from './bitmapFont.js';
import { SpriteCache, drawIcon, drawText, textCanvas, textWidth, makeCanvas } from './raster.js';
import { hudMetrics, phoneEntry, PHONE_CONTROL } from './hudLogic.js';
import { pauseItemRect } from './pauseScreen.js';
import { pixelRatio, watchPixelRatio } from './pixelRatio.js';
import {
  PHONE_TITLE,
  PHONE_SCAN,
  PHONE_OPEN,
  PHONE_ROOM,
  PHONE_LINKING,
  PHONE_WAITING,
  PHONE_JOINED,
  PHONE_LINKED,
  PHONE_CLOSE,
  PHONE_ICON,
  JOINED_CLOSE_MS,
  QR_QUIET,
  BADGE,
  qrMatrix,
  qrModulePx,
  panelLayout,
} from './phoneLogic.js';

const CLOSE_KEYS = new Set(['Escape', 'Enter', 'NumpadEnter', 'KeyJ', 'KeyP', 'Backspace']);
const QR_DARK = '#0c0c24';
const QR_LIGHT = '#ffffff';

const CSS = `
.pp-shade { position:absolute; inset:0; display:none; pointer-events:auto; background:rgba(0,0,14,0.5); }
.pp-panel { position:absolute; display:none; pointer-events:auto; box-sizing:border-box; cursor:default;
  background:#080a28; border:var(--b) solid rgba(255,230,150,0.6); border-radius:calc(var(--u) * 5);
  box-shadow:0 calc(var(--u) * 3) calc(var(--u) * 10) rgba(0,0,20,0.55); user-select:none; -webkit-user-select:none;
  animation:pp-in 0.16s ease-out; }
.pp-open > .pp-shade, .pp-open > .pp-panel { display:block; }
.pp-panel canvas, .pp-badge, .pp-tbadge { position:absolute; display:block; image-rendering:pixelated; }
.pp-qr { position:absolute; image-rendering:pixelated; border-radius:calc(var(--u) * 2); }
.pp-url { position:absolute; box-sizing:border-box; margin:0; padding:calc(var(--u) * 2) calc(var(--u) * 3);
  font:600 calc(var(--u) * 6.4)/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  color:#fff3b0; background:rgba(0,0,16,0.6); border-radius:calc(var(--u) * 2); text-shadow:0 1px 0 #000;
  overflow-wrap:anywhere; user-select:text; -webkit-user-select:text; cursor:text; }
.pp-url::selection { background:#ffcf3a; color:#101024; text-shadow:none; }
.pp-close { position:absolute; padding:0; margin:0; border:0; background:none; cursor:pointer; border-radius:calc(var(--u) * 3); }
.pp-close:hover, .pp-close:focus-visible { background:rgba(255,230,150,0.16); outline:none; }
.pp-close canvas { pointer-events:none; }
.pp-led { position:absolute; border-radius:1px; background:#ffb020; box-shadow:0 0 calc(var(--u) * 3) rgba(255,176,32,0.8);
  animation:pp-blink 1s steps(1) infinite; }
.pp-linking .pp-led { background:#8890b0; box-shadow:none; }
.pp-joined .pp-led { background:#5ce07a; box-shadow:0 0 calc(var(--u) * 3) rgba(92,224,122,0.9); animation:none; }
.pp-joined .pp-qr { opacity:0.35; transition:opacity 0.3s; }
.pp-hit { position:absolute; display:none; padding:0; margin:0; border:0; pointer-events:auto; cursor:pointer;
  background:transparent; border-radius:calc(var(--u) * 2); }
.pp-hit:hover, .pp-hit:focus-visible { background:rgba(255,230,150,0.14); outline:var(--b) solid rgba(255,230,150,0.55); }
.pp-badge { display:none; opacity:0.85; pointer-events:none; }
.pp-linked > .pp-badge { display:block; animation:pp-pop 0.3s ease-out; }
@keyframes pp-in { from { transform:scale(0.96); opacity:0; } to { transform:none; opacity:1; } }
@keyframes pp-blink { 0% { opacity:1; } 55% { opacity:0.25; } }
@keyframes pp-pop { from { transform:scale(1.6); opacity:0; } to { transform:none; opacity:0.85; } }
`;

function injectStyles() {
  if (document.getElementById('pp-css')) return;
  const style = document.createElement('style');
  style.id = 'pp-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The phone icon at `px` device px per icon pixel, optionally with a label to its right.
export function renderPhoneBadge(px, label = '', style = 'white') {
  const cache = new SpriteCache();
  const pad = Math.ceil(px * 2);
  const iw = Math.round(PHONE_ICON.w * px);
  const ih = Math.round(PHONE_ICON.h * px);
  const gap = label ? Math.round(4 * px) : 0;
  const tw = label ? textWidth(SMALL_FONT, label, px) : 0;
  const th = Math.round(SMALL_FONT.height * px);
  const h = Math.max(ih, th);
  const c = makeCanvas(iw + gap + tw + pad * 2, h + pad * 2);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawIcon(ctx, cache, PHONE_ICON, 'phone', pad, pad + Math.round((h - ih) / 2), px);
  // Caps sit in the top 7 of the small font's 9 rows: centre those on the icon.
  if (label) drawText(ctx, cache, SMALL_FONT, label, pad + iw + gap, pad + Math.round((h - 7 * px) / 2), { px, style });
  return c;
}

// The QR code with its quiet zone, `modulePx` device px per module; null when not encodable.
export function renderQr(text, devicePx) {
  const m = qrMatrix(text);
  if (!m) return null;
  const mod = qrModulePx(devicePx, m.size);
  const n = m.size + 2 * QR_QUIET;
  const c = makeCanvas(n * mod, n * mod);
  const ctx = c.getContext('2d');
  ctx.fillStyle = QR_LIGHT;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = QR_DARK;
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) if (m.dark(x, y)) ctx.fillRect((x + QR_QUIET) * mod, (y + QR_QUIET) * mod, mod, mod);
  }
  return c;
}

export class PhonePanel {
  constructor(root, { remotePad = null, events = null, hud = null, canOpen = () => true } = {}) {
    this.remotePad = remotePad;
    this.events = events;
    this.hud = hud;
    this.canOpen = canOpen;
    this.isOpen = false;
    this.joined = false; // "PHONE CONNECTED!" is showing (a phone joined while open)
    this._joinTimer = 0;
    this._wasConnected = !!remotePad?.connected;
    this._unsubs = [];
    const on = (name, fn) => events && this._unsubs.push(events.on(name, fn));
    on('phonePad', () => this._onPadChange());
    on('pause', () => this._placeHit());
    on('unpause', () => this._placeHit());
    on('gameOver', () => this.close());
    on('gameStart', () => this._placeHit());
    this._syncEntry();

    if (typeof document === 'undefined' || !root) return; // logic-only use (node tests)
    injectStyles();
    this.root = root;
    this._build();
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey, true);
    this._resizeObserver = new ResizeObserver(() => this._layout());
    this._resizeObserver.observe(this.el);
    this._stopDpr = watchPixelRatio(() => this._layout());
    this._layout();
  }

  get available() {
    return !!this.remotePad?.available;
  }

  open() {
    if (this.isOpen || !this.available || !this.el) return false;
    this.isOpen = true;
    this.joined = false;
    this.el.classList.add('pp-open');
    this._layout();
    this._placeHit();
    this.events?.emit('sfx', { name: 'dialog_open' });
    return true;
  }

  close() {
    clearTimeout(this._joinTimer);
    this._joinTimer = 0;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.joined = false;
    this.el?.classList.remove('pp-open');
    this._placeHit();
    this.events?.emit('sfx', { name: 'dialog_close' });
  }

  // 30 Hz from the game tick while the panel is open on the pause screen.
  update(controller) {
    if (!this.isOpen) return;
    if (controller?.START?.pressed || controller?.B?.pressed) this.close();
  }

  dispose() {
    this.close();
    this._unsubs.forEach((off) => off?.());
    if (!this.el) return;
    window.removeEventListener('keydown', this._onKey, true);
    this._resizeObserver.disconnect();
    this._stopDpr();
    this.el.remove();
  }

  // ---- state ----------------------------------------------------------------------------------

  _status() {
    const rp = this.remotePad;
    if (this.joined) return 'joined';
    if (rp?.connected) return 'linked';
    return rp?.status === 'online' ? 'waiting' : 'linking';
  }

  _onPadChange() {
    const connected = !!this.remotePad?.connected;
    const arrived = connected && !this._wasConnected;
    this._wasConnected = connected;
    this._syncEntry();
    if (this.isOpen && arrived) {
      this.joined = true;
      clearTimeout(this._joinTimer);
      this._joinTimer = setTimeout(() => this.close(), JOINED_CLOSE_MS);
      this.events?.emit('sfx', { name: 'menu_select' });
    }
    if (this.isOpen && !connected && this.joined) {
      this.joined = false; // left again before the panel closed
      clearTimeout(this._joinTimer);
    }
    if (this.el) this._layout();
  }

  // The pause legend's phone row follows availability; repaint a pause screen that is up.
  _syncEntry() {
    const on = this.available;
    if (phoneEntry.enabled === on) return;
    phoneEntry.enabled = on;
    if (this.hud?.paused) this.hud.setPaused(true);
    this._placeHit();
  }

  // ---- input ----------------------------------------------------------------------------------

  _key(e) {
    if (!this.isOpen) {
      if (e.code !== 'KeyP' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!this.available || !this.canOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.open();
      return;
    }
    if (/^F\d+$/.test(e.code)) return; // browser / renderer keys (F2 filter, F11, F12...)
    // Modal: the game and the title card never see a key while the panel is up (a copy with
    // Ctrl+C still works: only the close keys have their default prevented).
    e.stopImmediatePropagation();
    if (!CLOSE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat) this.close();
  }

  // ---- DOM ------------------------------------------------------------------------------------

  _build() {
    const el = document.createElement('div');
    el.className = 'pp-root';
    // Inline: #ui > * would otherwise make the whole overlay catch the mouse.
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:15';
    this.el = el;

    const shade = document.createElement('div');
    shade.className = 'pp-shade';
    shade.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'pp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Phone controller');
    this.panel = panel;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pp-close';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    this.closeBtn = close;

    this.url = document.createElement('p');
    this.url.className = 'pp-url';
    // A click selects the whole address, ready to copy.
    this.url.addEventListener('click', () => {
      const sel = window.getSelection?.();
      if (!sel || !sel.isCollapsed) return;
      const range = document.createRange();
      range.selectNodeContents(this.url);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    this.led = document.createElement('div');
    this.led.className = 'pp-led';
    panel.append(close, this.url, this.led);

    // Click target over the pause legend's phone row.
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'pp-hit';
    hit.title = 'Use your phone as a controller (P)';
    hit.setAttribute('aria-label', 'Phone controller');
    hit.addEventListener('click', () => this.open());
    this.hit = hit;

    this.badge = document.createElement('canvas');
    this.badge.className = 'pp-badge';
    this.badge.title = 'Phone controller connected';

    el.append(shade, panel, hit, this.badge);
    this.root.appendChild(el);
    this.canvases = {}; // name -> { key, el }
  }

  // Put canvas `name` (re)rendered by render() when `key` changed; returns the element.
  _canvas(name, key, render, parent = this.panel) {
    let slot = this.canvases[name];
    if (!slot) {
      slot = this.canvases[name] = { key: null, el: document.createElement('canvas') };
      parent.appendChild(slot.el);
    }
    if (slot.key !== key) {
      const c = render();
      slot.el.width = c.width;
      slot.el.height = c.height;
      slot.el.getContext('2d').drawImage(c, 0, 0);
      slot.key = key;
    }
    return slot.el;
  }

  _layout() {
    const el = this.el;
    if (!el) return;
    const cw = el.clientWidth || innerWidth;
    const ch = el.clientHeight || innerHeight;
    const dpr = pixelRatio();
    const { scale: u, W, H } = hudMetrics(cw, ch);
    const px = u * dpr; // device px per logical px
    const snap = (v) => Math.round(v * dpr) / dpr; // CSS px on the device pixel grid
    el.style.setProperty('--u', `${u}px`);
    el.style.setProperty('--b', `${Math.max(1, Math.round(u)) / dpr}px`);
    const size = (c) => ({ w: c.width / dpr, h: c.height / dpr });
    // Canvas c whose content box starts `inset` device px in: glyph box top-left at (x, y).
    const put = (c, x, y, { align = 'left', inset = Math.ceil(px * 2) } = {}) => {
      const { w, h } = size(c);
      const left = align === 'center' ? x - w / 2 : x - inset / dpr;
      Object.assign(c.style, { left: `${snap(left)}px`, top: `${snap(y - inset / dpr)}px`, width: `${w}px`, height: `${h}px` });
    };

    this._layoutBadge(px, dpr, u, ch, put);
    this._placeHit();
    if (!this.isOpen) return;

    const L = panelLayout(W, H);
    const P = L.panel;
    Object.assign(this.panel.style, {
      left: `${snap(P.x * u)}px`,
      top: `${snap(P.y * u)}px`,
      width: `${snap(P.w * u)}px`,
      height: `${snap(P.h * u)}px`,
    });
    // Positions inside the panel are relative to its padding box (inside the border).
    const b = Math.max(1, Math.round(u)) / dpr;
    const at = (v) => v * u - b;
    const k = `${px}`;

    put(this._canvas('title', k, () => textCanvas(BIG_FONT, PHONE_TITLE, px, 'gold')), at(L.title.x + L.title.w / 2), at(L.title.y), { align: 'center' });
    put(this._canvas('scan', k, () => textCanvas(SMALL_FONT, PHONE_SCAN, px, 'white')), at(L.scan.x + L.scan.w / 2), at(L.scan.y), { align: 'center' });

    // The close button: a × in the top-right corner.
    const cb = L.close;
    Object.assign(this.closeBtn.style, { left: `${snap(at(cb.x))}px`, top: `${snap(at(cb.y))}px`, width: `${snap(cb.w * u)}px`, height: `${snap(cb.h * u)}px` });
    const x = this._canvas('x', k, () => textCanvas(BIG_FONT, '×', px, 'white'), this.closeBtn);
    const xs = size(x);
    Object.assign(x.style, { left: `${snap((cb.w * u - xs.w) / 2 + px / dpr)}px`, top: `${snap((cb.h * u - xs.h) / 2 + px / dpr)}px`, width: `${xs.w}px`, height: `${xs.h}px` });

    // QR code: whole device pixels per module, centred in its box.
    const url = this.remotePad?.padUrl || '';
    const qr = this._canvas('qr', `${px}|${url}`, () => renderQr(url, L.qr.w * px) || makeCanvas(1, 1));
    qr.className = 'pp-qr';
    const qs = size(qr);
    Object.assign(qr.style, {
      left: `${snap(at(L.qr.x) + (L.qr.w * u - qs.w) / 2)}px`,
      top: `${snap(at(L.qr.y) + (L.qr.h * u - qs.h) / 2)}px`,
      width: `${qs.w}px`,
      height: `${qs.h}px`,
    });

    put(this._canvas('open', k, () => textCanvas(SMALL_FONT, PHONE_OPEN, px, 'white')), at(L.open.x), at(L.open.y));
    // The address, selectable; line breaks preferred after "/" and before "?".
    if (this.url.dataset.href !== url) {
      this.url.dataset.href = url;
      this.url.replaceChildren();
      const parts = url.split(/(?<=\/)(?!\/)|(?=\?)/);
      parts.forEach((part, i) => {
        if (i) this.url.append(document.createElement('wbr'));
        this.url.append(part);
      });
    }
    Object.assign(this.url.style, { left: `${snap(at(L.url.x))}px`, top: `${snap(at(L.url.y))}px`, width: `${snap(L.url.w * u)}px`, minHeight: `${snap(L.url.h * u)}px` });

    put(this._canvas('roomLabel', k, () => textCanvas(SMALL_FONT, PHONE_ROOM, px, 'key')), at(L.roomLabel.x), at(L.roomLabel.y));
    const room = this.remotePad?.room || '----';
    put(this._canvas('room', `${k}|${room}`, () => textCanvas(BIG_FONT, room.split('').join(' '), 2 * px, 'gold'), this.panel), at(L.room.x), at(L.room.y), { inset: Math.ceil(2 * px * 2) });

    // Link state: an LED and a line; "PHONE CONNECTED!" in the big font when a phone joins.
    const status = this._status();
    this.panel.classList.toggle('pp-joined', status === 'joined' || status === 'linked');
    this.panel.classList.toggle('pp-linking', status === 'linking');
    const st = L.status;
    const ledSize = 5;
    Object.assign(this.led.style, { left: `${snap(at(st.x))}px`, top: `${snap(at(st.y + 1))}px`, width: `${snap(ledSize * u)}px`, height: `${snap(ledSize * u)}px` });
    const text = { joined: PHONE_JOINED, linked: PHONE_LINKED, waiting: PHONE_WAITING, linking: PHONE_LINKING }[status];
    const big = status === 'joined';
    const sc = this._canvas('status', `${k}|${status}`, () => textCanvas(big ? BIG_FONT : SMALL_FONT, text, px, big ? 'gold' : status === 'linked' ? 'key' : 'white'));
    put(sc, at(st.x + ledSize + 4), at(st.y + (big ? -1.5 : 0)));

    const foot = this._canvas('foot', k, () => textCanvas(SMALL_FONT, PHONE_CLOSE, px, 'white'));
    const fw = size(foot).w - (2 * Math.ceil(px * 2)) / dpr; // glyph width without the canvas padding
    put(foot, at(L.foot.x + L.foot.w) - fw, at(L.foot.y));
    foot.style.opacity = '0.75';
  }

  _layoutBadge(px, dpr, u, ch, put) {
    const badge = this.badge;
    const key = `${px}`;
    if (badge.dataset.key !== key) {
      const c = renderPhoneBadge(px);
      badge.width = c.width;
      badge.height = c.height;
      badge.getContext('2d').drawImage(c, 0, 0);
      badge.dataset.key = key;
    }
    const ih = PHONE_ICON.h * u;
    put(badge, BADGE.left * u, ch - BADGE.bottom * u - ih);
    this.el.classList.toggle('pp-linked', !!this.remotePad?.connected);
  }

  // Show the click target over the pause legend's phone row while the pause screen shows it.
  _placeHit() {
    const hit = this.hit;
    if (!hit) return;
    const hud = this.hud;
    const show = !this.isOpen && !!hud?.paused && hud.visible !== false && phoneEntry.enabled && hud.controls !== 'touch';
    const r = show ? this._hitRect() : null;
    hit.style.display = r ? 'block' : 'none';
    if (!r) return;
    Object.assign(hit.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  // The legend row's rect in CSS px, computed exactly as the HUD canvas lays it out.
  _hitRect() {
    const dpr = pixelRatio();
    const cw = Math.round((this.el.clientWidth || innerWidth) * dpr);
    const ch = Math.round((this.el.clientHeight || innerHeight) * dpr);
    const m = hudMetrics(cw, ch);
    const r = pauseItemRect(m.W, m.H, this.hud.controls, PHONE_CONTROL);
    if (!r) return null;
    const k = m.scale / dpr;
    return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
  }
}
