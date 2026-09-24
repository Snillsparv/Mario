// The pad page's game-code screen, shown when pad.html is opened without a valid ?room=ABCD
// (typed in by hand instead of scanned): four slots and big letter keys, so no system keyboard
// is needed (a hardware keyboard works too: letters, Backspace, Enter).
//
//   const entry = new CodeEntry(parent, { onSubmit(code) })
//   entry.show({ code?, message? }); entry.hide(); entry.code; entry.shown

import { isRoomCode } from '../net/protocol.js';

// The letters a game code can have: as makeRoomCode (src/net/protocol.js), no I, O or L.
export const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

// The room code in a query string (?room=abcd works too), or null when missing or invalid.
export function roomFromSearch(search) {
  let v = '';
  try {
    v = new URLSearchParams(search).get('room') ?? '';
  } catch {
    return null;
  }
  v = v.trim().toUpperCase();
  return isRoomCode(v) ? v : null;
}

// The code after pressing `key`: a letter (case-insensitive, look-alikes I/O/L ignored),
// 'Backspace' or 'Clear'. Never longer than CODE_LENGTH.
export function editCode(code, key) {
  if (key === 'Backspace') return code.slice(0, -1);
  if (key === 'Clear') return '';
  if (typeof key !== 'string' || key.length !== 1) return code;
  const k = key.toUpperCase();
  return code.length < CODE_LENGTH && ROOM_LETTERS.includes(k) ? code + k : code;
}

const CSS = `
.pad-code { position:fixed; inset:0; z-index:40; display:none; box-sizing:border-box;
  padding: max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  background: radial-gradient(120% 80% at 50% 0%, #2c2f3d 0, #1b1d25 55%, #121318 100%);
  color:#d9dcea; font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  flex-direction:column; align-items:center; justify-content:center; gap: clamp(10px, 2.6vh, 22px); }
.pad-code.pad-on { display:flex; }
.pad-code * { box-sizing:border-box; }
.pad-code-head { text-align:center; }
.pad-code-brand { display:inline-flex; align-items:center; gap:0.6em; font-weight:800; letter-spacing:0.16em;
  font-size:11px; color:#8e94ad; text-shadow: 0 -1px 0 rgba(0,0,0,0.7); }
.pad-code-brand i { width:7px; height:7px; border-radius:50%; background:#e3a82b; box-shadow:0 0 6px 1px rgba(227,168,43,0.7); }
.pad-code h1 { margin:6px 0 4px; font-size: clamp(19px, 5.4vw, 26px); font-weight:800; color:#eef0f8; letter-spacing:0.01em; }
.pad-code p { margin:0; font-size:14px; line-height:1.35; color:#a3a8bf; max-width:30em; }
.pad-code .pad-code-msg { color:#f0b35a; min-height:1.35em; margin:-4px 0; }
.pad-code-slots { display:flex; gap: clamp(8px, 2.4vw, 14px); }
.pad-code-slot { width: clamp(46px, 14vw, 62px); height: clamp(56px, 17vw, 74px); border-radius:12px;
  display:flex; align-items:center; justify-content:center; font-size: clamp(28px, 9vw, 40px); font-weight:800; color:#f4f5fb;
  background:#15161d; box-shadow: inset 0 3px 7px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.10); }
.pad-code-slot.pad-next { box-shadow: inset 0 3px 7px rgba(0,0,0,0.75), 0 0 0 2px rgba(111,232,216,0.7); }
.pad-code-keys { display:grid; grid-template-columns: repeat(6, 1fr); gap: clamp(6px, 1.8vw, 10px); width: min(100%, 440px); }
.pad-code button { font: inherit; border:0; margin:0; padding:0; cursor:pointer; -webkit-tap-highlight-color:transparent;
  touch-action:manipulation; user-select:none; -webkit-user-select:none; }
.pad-code-key { height: clamp(42px, 12.5vw, 56px); border-radius:11px; font-size: clamp(19px, 5.6vw, 24px); font-weight:800; color:#eceef7;
  background: linear-gradient(180deg, #555a6d 0, #3d4152 55%, #2e313e 100%);
  box-shadow: 0 3px 0 #17181f, 0 5px 8px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.28);
  transition: transform 50ms ease-out, box-shadow 50ms ease-out; }
.pad-code-key:active, .pad-code-key.pad-hit { transform: translateY(2px);
  box-shadow: 0 1px 0 #17181f, 0 2px 4px rgba(0,0,0,0.45), 0 0 10px 2px rgba(120,240,225,0.45), inset 0 1px 1px rgba(255,255,255,0.2); }
.pad-code-key.pad-del { color:#c8cce0; }
.pad-code-key.pad-del svg { width:1.1em; height:1.1em; vertical-align:-0.15em; fill:none; stroke:currentColor; stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
.pad-code-go { width: min(100%, 440px); height: clamp(48px, 13vw, 58px); border-radius:999px; font-size:18px; font-weight:800; letter-spacing:0.08em;
  color:#fff; background: radial-gradient(circle at 36% 28%, #7de8da 0, #18a293 46%, #0a5a52 100%);
  box-shadow: 0 4px 0 #073f3a, 0 7px 10px rgba(0,0,0,0.5), inset 0 2px 2px rgba(255,255,255,0.45);
  text-shadow: 0 -1px 0 rgba(0,0,0,0.35); transition: transform 50ms, filter 120ms, opacity 120ms; }
.pad-code-go:active { transform: translateY(3px); }
.pad-code-go:disabled { filter: grayscale(1) brightness(0.55); opacity:0.7; cursor:default; }
/* Portrait: header, slots, keys, then CONNECT at the bottom (nearest the thumbs). */
.pad-code-side { display:contents; }
.pad-code-head { order:0; } .pad-code-slots { order:1; } .pad-code-msg { order:2; } .pad-code-keys { order:3; } .pad-code-go { order:4; }
@media (orientation: landscape) and (max-height: 560px) {
  .pad-code { flex-direction:row; gap: 4vw; }
  .pad-code-side { display:flex; flex-direction:column; align-items:center; gap: clamp(8px, 2.6vh, 18px); flex: 0 1 44%; }
  .pad-code-keys { grid-template-columns: repeat(8, 1fr); width: min(52%, 480px); gap:8px; }
  .pad-code-key { height: clamp(40px, 13vh, 54px); font-size:20px; }
  .pad-code-slot { width:52px; height:62px; font-size:34px; }
  .pad-code h1 { font-size:21px; }
  .pad-code p { font-size:13px; }
  .pad-code-go { height:48px; width:100%; }
}
`;

const DEL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';

export class CodeEntry {
  constructor(parent, { onSubmit } = {}) {
    this.onSubmit = onSubmit;
    this.code = '';
    this.shown = false;
    if (!document.getElementById('pad-code-css')) {
      const style = document.createElement('style');
      style.id = 'pad-code-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = (this.root = document.createElement('div'));
    root.className = 'pad-code';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Enter the game code');
    root.innerHTML = `
      <div class="pad-code-side">
        <div class="pad-code-head">
          <div class="pad-code-brand"><i></i><span>CASTLE GROUNDS</span></div>
          <h1>Phone controller</h1>
          <p>Enter the 4-letter code shown in the game on your computer.</p>
        </div>
        <div class="pad-code-slots" aria-live="polite"></div>
        <p class="pad-code-msg"></p>
        <button type="button" class="pad-code-go" disabled>CONNECT</button>
      </div>
      <div class="pad-code-keys"></div>`;
    this.slots = [];
    const slotsEl = root.querySelector('.pad-code-slots');
    for (let i = 0; i < CODE_LENGTH; i++) {
      const d = document.createElement('div');
      d.className = 'pad-code-slot';
      slotsEl.appendChild(d);
      this.slots.push(d);
    }
    this.msg = root.querySelector('.pad-code-msg');
    this.go = root.querySelector('.pad-code-go');
    const keys = root.querySelector('.pad-code-keys');
    this.keys = {};
    for (const ch of ROOM_LETTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad-code-key';
      b.textContent = ch;
      b.dataset.key = ch;
      keys.appendChild(b);
      this.keys[ch] = b;
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pad-code-key pad-del';
    del.dataset.key = 'Backspace';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = DEL_SVG;
    keys.appendChild(del);
    this.keys.Backspace = del;

    keys.addEventListener('click', (e) => {
      const b = e.target.closest?.('button[data-key]');
      if (b) this.press(b.dataset.key);
    });
    this.go.addEventListener('click', () => this.submit());
    this._onKey = (e) => {
      if (!this.shown || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') this.submit();
      else if (e.key === 'Backspace' || e.key === 'Escape') this.press(e.key === 'Escape' ? 'Clear' : 'Backspace');
      else if (e.key.length === 1) this.press(e.key);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', this._onKey);
    parent.appendChild(root);
    this._paint();
  }

  show({ code = '', message = '' } = {}) {
    this.code = '';
    for (const ch of String(code)) this.code = editCode(this.code, ch);
    this.msg.textContent = message;
    this.shown = true;
    this.root.classList.add('pad-on');
    this._paint();
  }

  hide() {
    this.shown = false;
    this.root.classList.remove('pad-on');
  }

  press(key) {
    const next = editCode(this.code, key);
    const k = this.keys[key.length === 1 ? key.toUpperCase() : key];
    if (k) {
      // A visible press for hardware keys too.
      k.classList.add('pad-hit');
      setTimeout(() => k.classList.remove('pad-hit'), 90);
    }
    if (next === this.code) return;
    this.code = next;
    this.msg.textContent = '';
    this._paint();
  }

  submit() {
    if (!isRoomCode(this.code)) return;
    this.onSubmit?.(this.code);
  }

  _paint() {
    for (let i = 0; i < CODE_LENGTH; i++) {
      this.slots[i].textContent = this.code[i] ?? '';
      this.slots[i].classList.toggle('pad-next', i === this.code.length);
    }
    this.go.disabled = this.code.length !== CODE_LENGTH;
  }
}
