// The pad page's status strip: a small pill with the connection state, a button back to the
// game-code screen and (where the browser has it) a fullscreen toggle. It sits in the band the
// controller layout keeps free (layout.strip), so it never covers a control.
//
//   const strip = new StatusStrip(parent, { onCode, onFullscreen, onRetry, fullscreen: bool })
//   strip.place(rect); strip.set(status, { room, failures }); strip.setVisible(bool)

// Text and tone for a PadLink status (tone: 'ok' | 'wait' | 'busy' | 'off'). `action`:
// tapping the text retries ('retry').
export function statusView(status, { room = '', failures = 0 } = {}) {
  switch (status) {
    case 'connected':
      return { text: `Connected to game ${room}`, tone: 'ok' };
    case 'waiting':
      return { text: `Game ${room} not found, waiting...`, tone: 'wait' };
    case 'reconnecting':
      return { text: failures >= 3 ? 'Reconnecting... is the game running?' : 'Reconnecting...', tone: 'off' };
    case 'replaced':
      return { text: 'Another phone took over. Tap to rejoin', tone: 'off', action: 'retry' };
    case 'stopped':
      return { text: 'Disconnected', tone: 'off' };
    default:
      return { text: 'Connecting...', tone: 'busy' };
  }
}

const CSS = `
.pad-strip { position:fixed; left:0; top:0; z-index:30; display:none; align-items:center; justify-content:center;
  pointer-events:none; box-sizing:border-box; font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif; }
.pad-strip.pad-on { display:flex; }
.pad-strip > * { pointer-events:auto; }
.pad-strip-pill { display:flex; align-items:center; gap:8px; height:100%; max-width:100%; min-width:0; padding:0 4px 0 12px;
  border-radius:999px; background:rgba(12,13,18,0.72); color:#d6d9e6; font-size:13px; font-weight:700; letter-spacing:0.01em;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.08); }
.pad-strip-text { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:none; border:0;
  color:inherit; font:inherit; padding:0; text-align:left; -webkit-tap-highlight-color:transparent; }
.pad-strip-dot { flex:none; width:8px; height:8px; border-radius:50%; background:#7c8198; }
.pad-strip[data-tone="ok"] .pad-strip-dot { background:#4be0a0; box-shadow:0 0 6px 1px rgba(75,224,160,0.8); }
.pad-strip[data-tone="wait"] .pad-strip-dot { background:#e3a82b; box-shadow:0 0 6px 1px rgba(227,168,43,0.7); animation: pad-blink 1.2s steps(2, jump-none) infinite; }
.pad-strip[data-tone="busy"] .pad-strip-dot { background:#8fa4d8; animation: pad-blink 0.8s steps(2, jump-none) infinite; }
.pad-strip[data-tone="off"] .pad-strip-dot { background:#e0604b; box-shadow:0 0 6px 1px rgba(224,96,75,0.6); }
.pad-strip[data-tone="off"] .pad-strip-text { color:#f0c2b8; }
.pad-strip[data-action="retry"] .pad-strip-text { text-decoration: underline; text-underline-offset:3px; cursor:pointer; }
@keyframes pad-blink { 50% { opacity:0.25; } }
.pad-strip-btn { flex:none; width:30px; height:24px; border-radius:999px; border:0; padding:0; margin:0; cursor:pointer;
  display:flex; align-items:center; justify-content:center; color:#aeb3c9; background:rgba(255,255,255,0.07);
  -webkit-tap-highlight-color:transparent; }
.pad-strip-btn:active { background:rgba(111,232,216,0.3); color:#fff; }
.pad-strip-btn svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.pad-strip-btn[hidden] { display:none; }
`;

// Original line icons: a 2x2 key grid (game code) and four corner brackets (fullscreen).
const CODE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg>';
const FULL_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';

export class StatusStrip {
  constructor(parent, { onCode, onFullscreen, onRetry, fullscreen = false } = {}) {
    if (!document.getElementById('pad-strip-css')) {
      const style = document.createElement('style');
      style.id = 'pad-strip-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = (this.root = document.createElement('div'));
    root.className = 'pad-strip';
    root.innerHTML = `
      <div class="pad-strip-pill" role="status" aria-live="polite">
        <span class="pad-strip-dot"></span>
        <button type="button" class="pad-strip-text"></button>
        <button type="button" class="pad-strip-btn pad-strip-code" aria-label="Change game code" title="Change game code">${CODE_ICON}</button>
        <button type="button" class="pad-strip-btn pad-strip-full" aria-label="Fullscreen" title="Fullscreen">${FULL_ICON}</button>
      </div>`;
    this.text = root.querySelector('.pad-strip-text');
    this.full = root.querySelector('.pad-strip-full');
    this.full.hidden = !fullscreen;
    root.querySelector('.pad-strip-code').addEventListener('click', () => onCode?.());
    this.full.addEventListener('click', () => onFullscreen?.());
    this.text.addEventListener('click', () => {
      if (root.dataset.action === 'retry') onRetry?.();
    });
    // Taps on the strip are not the controller's (it sits above the controller's touch zones).
    root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    parent.appendChild(root);
  }

  place(rect) {
    if (!rect) return;
    const s = this.root.style;
    s.left = `${Math.round(rect.x)}px`;
    s.top = `${Math.round(rect.y)}px`;
    s.width = `${Math.round(rect.w)}px`;
    s.height = `${Math.round(rect.h)}px`;
  }

  set(status, info) {
    const v = statusView(status, info);
    this.text.textContent = v.text;
    this.root.dataset.tone = v.tone;
    if (v.action) this.root.dataset.action = v.action;
    else delete this.root.dataset.action;
    this.root.dataset.status = status;
  }

  setVisible(on) {
    this.root.classList.toggle('pad-on', !!on);
  }
}
