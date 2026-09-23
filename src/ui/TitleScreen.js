// PLACEHOLDER — replaced by the title screen.
export class TitleScreen {
  constructor(root) {
    this.root = root;
  }
  show() {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:bold 40px sans-serif;background:#0008;cursor:pointer';
      el.textContent = 'Click to start';
      const go = () => {
        el.remove();
        removeEventListener('keydown', go);
        resolve();
      };
      el.addEventListener('click', go);
      addEventListener('keydown', go);
      this.root.appendChild(el);
    });
  }
}
