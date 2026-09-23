// PLACEHOLDER — replaced by the N64-style HUD.
export class HUD {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:16px;top:12px;color:#fff;font:bold 24px sans-serif;text-shadow:2px 2px #000';
    root.appendChild(this.el);
  }
  update(s) {
    this.el.textContent = `x${s.lives}  coins ${s.coins}  stars ${s.stars}  hp ${s.health}`;
  }
  setPaused(p) {}
}
