// The screen wipe between areas (core/AreaSwitch.js): a black circle iris closing on Jonas (a
// door, a course's way out) or a flat fade (the star exit's gold-white), drawn into a canvas of
// its own over the picture. main adds it to the UI root before the HUD, so the HUD's counters
// and the pause screen stay on top of it.
//
//   const wipe = new ScreenWipe(uiRoot)
//   wipe.draw({ amount, kind, color }, heroPos, camera, scale = 1)   // every render frame
//     amount   0 (nothing: the canvas is display: none) .. 1 (the screen covered)
//     kind     'iris' (a hole round the hero's chest, shrinking to nothing) | 'fade'
//     heroPos  the hero model's feet (world); camera: the world camera it is projected with;
//     scale    the hero model's size (shrinking into the bottle: his chest comes down with it)
//
// The iris is drawn at the HUD's logical resolution (hudLogic.js hudMetrics: 240 lines) and
// scaled up pixelated, so its edge steps like the rest of the pixel art; each row is two solid
// spans either side of the hole (no antialiased grey). A hero off screen (or behind the camera)
// gets it centred. The recorder (ui/Recorder.js) captures it like any UI canvas.

import * as THREE from 'three';
import { hudMetrics } from './hudLogic.js';

const CHEST = 100; // the iris centres this far above his feet

export class ScreenWipe {
  constructor(root) {
    this.shown = false;
    this.v = new THREE.Vector3();
    this.canvas = null;
    if (typeof document === 'undefined') return; // logic-only use (node tests)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cg-wipe';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated;display:none';
    this.canvas.width = this.canvas.height = 1;
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  draw({ amount, kind, color }, heroPos, camera, scale = 1) {
    const canvas = this.canvas;
    if (!canvas) return;
    if (!(amount > 0)) {
      if (this.shown) canvas.style.display = 'none';
      this.shown = false;
      return;
    }
    if (!this.shown) canvas.style.display = '';
    this.shown = true;
    this._fit();
    const { ctx } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    if (kind === 'fade') {
      ctx.globalAlpha = amount;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    // The hole's centre: the hero's chest on screen (clamped onto it).
    let cx = w / 2;
    let cy = h / 2;
    if (heroPos && camera) {
      camera.updateMatrixWorld();
      const v = this.v.set(heroPos.x, heroPos.y + CHEST * scale, heroPos.z).project(camera);
      if (v.z < 1 && Number.isFinite(v.x) && Number.isFinite(v.y)) {
        cx = Math.min(w, Math.max(0, ((v.x + 1) / 2) * w));
        cy = Math.min(h, Math.max(0, ((1 - v.y) / 2) * h));
      }
    }
    // From the farthest corner at 0 down to nothing at 1.
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    const r = far * (1 - amount);
    for (let y = 0; y < h; y++) {
      const dy = y + 0.5 - cy;
      const half = r * r - dy * dy;
      if (half <= 0) {
        ctx.fillRect(0, y, w, 1);
        continue;
      }
      const dx = Math.sqrt(half);
      const x0 = Math.round(cx - dx);
      const x1 = Math.round(cx + dx);
      if (x0 > 0) ctx.fillRect(0, y, x0, 1);
      if (x1 < w) ctx.fillRect(x1, y, w - x1, 1);
    }
  }

  // One canvas pixel per HUD logical pixel of the box it fills.
  _fit() {
    const canvas = this.canvas;
    const cw = canvas.clientWidth || innerWidth;
    const ch = canvas.clientHeight || innerHeight;
    const { W, H } = hudMetrics(cw, ch);
    const w = Math.max(1, Math.round(W));
    const h = Math.max(1, Math.round(H));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
}
