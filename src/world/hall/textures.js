// Procedural textures of the Great Hall (small canvases, N64-style; the rest of the hall reuses
// the castle's and the courtyard's). Each returns an empty THREE.Texture in node
// (texgen.canvasTexture handles that).

import { canvasTexture, paintPixels, tileableFbm } from '../../render/texgen.js';

const clamp255 = (c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])];

// Hanging banner (32 x 64, the whole sheet, top of the canvas = top of the banner): a crimson
// field with a woven grain, a gold border, a gold bar near the top and the castle's golden sun
// (as on the keep's banner) in the upper half.
export function bannerTexture() {
  return canvasTexture(
    32,
    64,
    (ctx, w, h) => {
      const weave = tileableFbm(w, h, 8, 2, 71);
      const crimson = [150, 20, 36];
      const gold = [236, 182, 58];
      const deep = [176, 108, 30];
      paintPixels(ctx, w, h, (x, y) => {
        const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
        if (edge < 2) return gold;
        if (edge < 3) return deep;
        if (y >= 7 && y < 9) return gold;
        const dx = x + 0.5 - w / 2;
        const dy = y + 0.5 - 22;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const ray = 7.5 + 3.5 * Math.max(0, Math.cos(a * 8)) ** 3;
        if (r < 4.2) return [255, 214, 80];
        if (r < 5.2) return deep;
        if (r < ray) return gold;
        const k = 0.88 + weave(x, y) * 0.24 + ((x + y) % 2) * 0.04;
        return clamp255(crimson.map((c) => c * k));
      });
    },
    { repeat: false },
  );
}
