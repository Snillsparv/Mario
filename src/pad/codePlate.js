// A recessed label plate on the portrait controller body (layout.panel: the room above the
// controls) showing the game code, lit while connected, and a hint that the phone can be
// turned for the wide layout. Touches pass through it.
//
//   const plate = new CodePlate(parent); plate.place(layout.panel | null); plate.set(room, status)

const CSS = `
.pad-plate { position:fixed; z-index:25; display:none; box-sizing:border-box; pointer-events:none;
  flex-direction:column; align-items:center; justify-content:center; gap:0.35em; border-radius:18px; overflow:hidden;
  background: linear-gradient(180deg, #191a22 0, #1f212b 100%);
  box-shadow: inset 0 3px 9px rgba(0,0,0,0.75), inset 0 -1px 0 rgba(255,255,255,0.05), 0 1px 0 rgba(255,255,255,0.09);
  font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif; color:#7d8399; text-align:center; }
.pad-plate.pad-on { display:flex; }
.pad-plate-cap { font-size:0.26em; font-weight:800; letter-spacing:0.24em; text-indent:0.24em; }
.pad-plate-code { font-size:1em; line-height:1; font-weight:800; letter-spacing:0.16em; text-indent:0.16em; color:#555a6e;
  text-shadow: 0 -1px 0 rgba(0,0,0,0.6); transition: color 200ms, text-shadow 200ms; }
.pad-plate[data-link="connected"] .pad-plate-code { color:#e6fbf7; text-shadow: 0 0 14px rgba(111,232,216,0.55), 0 -1px 0 rgba(0,0,0,0.5); }
.pad-plate[data-link="waiting"] .pad-plate-code { color:#b39a62; }
.pad-plate-hint { font-size:0.24em; letter-spacing:0.03em; color:#6a6f84; }
.pad-plate-hint svg { width:1.2em; height:1.2em; vertical-align:-0.28em; margin-right:0.35em; fill:none; stroke:currentColor; stroke-width:1.6;
  stroke-linecap:round; stroke-linejoin:round; }
`;

// A phone outline with a turn arrow (original line icon).
const TURN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="5" width="7" height="10" rx="1.4"/><path d="M8 2.2a5.5 5.5 0 0 1 5.8 5.3"/><path d="M12.2 6.2l1.6 1.4 1.4-1.7"/></svg>';

export class CodePlate {
  constructor(parent) {
    if (!document.getElementById('pad-plate-css')) {
      const style = document.createElement('style');
      style.id = 'pad-plate-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = (this.root = document.createElement('div'));
    root.className = 'pad-plate';
    root.setAttribute('aria-hidden', 'true'); // the strip reads out the same
    root.innerHTML = `<div class="pad-plate-cap">GAME CODE</div><div class="pad-plate-code"></div>
      <div class="pad-plate-hint">${TURN_ICON}Turn sideways for the wide layout</div>`;
    this.code = root.querySelector('.pad-plate-code');
    this.hint = root.querySelector('.pad-plate-hint');
    this.rect = null;
    this.visible = false;
    parent.appendChild(root);
  }

  // rect: layout.panel (null: no room for the plate).
  place(rect) {
    this.rect = rect;
    if (rect) {
      const s = this.root.style;
      s.left = `${Math.round(rect.x)}px`;
      s.top = `${Math.round(rect.y)}px`;
      s.width = `${Math.round(rect.w)}px`;
      s.height = `${Math.round(rect.h)}px`;
      s.fontSize = `${Math.round(Math.min(rect.h * 0.34, rect.w * 0.16))}px`;
      this.hint.style.display = rect.h >= 110 ? '' : 'none';
    }
    this._show();
  }

  set(room, status) {
    this.code.textContent = room ?? '';
    this.root.dataset.link = status ?? '';
  }

  setVisible(on) {
    this.visible = !!on;
    this._show();
  }

  _show() {
    this.root.classList.toggle('pad-on', this.visible && !!this.rect);
  }
}
