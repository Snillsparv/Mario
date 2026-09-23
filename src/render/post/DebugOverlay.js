// Small F1 performance readout (fps, draw calls, triangles, render mode). The DOM element
// is only created when the overlay is first shown, so this module is safe to import in node.

const REFRESH_SECONDS = 0.5;

export class DebugOverlay {
  constructor() {
    this.el = null;
    this.visible = false;
    this.frames = 0;
    this.windowStart = 0;
    this.fps = 0;
  }

  setVisible(on) {
    this.visible = on;
    if (on && !this.el) {
      this.el = document.createElement('div');
      this.el.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:1000;padding:4px 7px;pointer-events:none;' +
        'font:12px/1.35 ui-monospace,monospace;color:#e8ffe8;background:rgba(0,0,0,0.6);white-space:pre';
      document.body.appendChild(this.el);
    }
    if (this.el) this.el.style.display = on ? 'block' : 'none';
    this.frames = 0;
    this.windowStart = 0;
  }

  // Call once per rendered frame with a timestamp in seconds, renderer.info and a function
  // describing the render mode. Text is refreshed a couple of times per second.
  frame(now, info, describeMode) {
    if (!this.visible) return;
    if (!this.windowStart) {
      this.windowStart = now;
      return;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < REFRESH_SECONDS) return;
    this.fps = this.frames / elapsed;
    this.frames = 0;
    this.windowStart = now;
    const tris = info.render.triangles;
    this.el.textContent =
      `${this.fps.toFixed(0)} fps\n` +
      `${info.render.calls} calls  ${tris >= 1000 ? (tris / 1000).toFixed(1) + 'k' : tris} tris\n` +
      describeMode();
  }

  dispose() {
    this.el?.remove();
    this.el = null;
  }
}
