// Procedural textures of the Great Hall (small canvases, N64-style; the wood and the rose
// window's glass reuse the castle's, the signs the props'): the floor's glazed tiles, the
// plaster, the panelling, the marble and the banners. Each is painted once and cached, and
// carries the mean of its pixels (texture.userData.mean, linear RGB), worked out in JS from
// the same values it paints, so it is there in node too (where texgen.canvasTexture returns an
// empty texture without painting) and nothing ever reads a canvas back.

import { canvasTexture, paintPixels, tileableFbm } from '../../render/texgen.js';

const clamp255 = (c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const cache = new Map();

// A w x h texture painted per pixel by the painter setup() returns, fn(x, y) -> [r, g, b] (sRGB
// 0..255; y from the top), once per name: its pixels are worked out first (as bytes, as the
// canvas stores them), then painted and averaged.
function painted(name, w, h, setup, opts) {
  if (cache.has(name)) return cache.get(name);
  const fn = setup();
  const px = new Uint8ClampedArray(w * h * 3);
  const sum = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) {
        px[i + k] = c[k];
        sum[k] += linear(px[i + k] / 255);
      }
    }
  }
  const tex = canvasTexture(w, h, (ctx) => paintPixels(ctx, w, h, (x, y) => px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)), opts);
  tex.userData.mean = sum.map((s) => s / (w * h));
  cache.set(name, tex);
  return tex;
}

// The floor (64 x 64, one tile a repeat): a calm cream-peach glazed octagon, lighter toward its
// top-left with a soft highlight, in light grout, a small muted-rose dot where four tiles meet.
export function floorTexture() {
  return painted('floor', 64, 64, () => {
    const grain = tileableFbm(64, 64, 8, 2, 501);
    const [lo, hi] = [[202, 177, 146], [215, 197, 171]];
    const shine = [240, 232, 216];
    const grout = [232, 226, 212];
    const dot = [200, 136, 112];
    return (x, y) => {
      const u = (x + 0.5) / 64 - 0.5;
      const v = (y + 0.5) / 64 - 0.5;
      const oct = Math.max(Math.abs(u), Math.abs(v), (Math.abs(u) + Math.abs(v)) / 1.38);
      const g = 0.97 + 0.06 * grain(x, y);
      if (oct > 0.47) {
        const corner = Math.abs(0.5 - Math.abs(u)) + Math.abs(0.5 - Math.abs(v));
        if (corner < 0.1) return clamp255(scale(dot, g * (corner < 0.075 ? 1.04 : 0.95)));
        return clamp255(scale(grout, g));
      }
      if (oct > 0.45) return clamp255(scale(grout, g));
      let c = mix(lo, hi, Math.max(0, Math.min(1, 0.5 - 0.9 * (u + v))));
      const d = Math.hypot(u + 0.14, v + 0.14);
      if (d < 0.2) c = mix(c, shine, 0.4 * (1 - d / 0.2));
      return clamp255(scale(c, g));
    };
  });
}

// Warm cream plaster (64 x 64): a soft mottle.
export function plasterTexture() {
  return painted('plaster', 64, 64, () => {
    const f = tileableFbm(64, 64, 6, 3, 77);
    const base = [250, 240, 222];
    return (x, y) => clamp255(scale(base, 0.95 + 0.08 * f(x, y)));
  });
}

// One raised panel of the wainscot (64 x 64, the whole of it, top of the canvas = top of the
// panel): a deep teal frame, a gold bead, a bevelled field lit from the top left.
export function panelTexture() {
  return painted('panel', 64, 64, () => {
    const f = tileableFbm(64, 64, 8, 2, 91);
    const frame = [30, 86, 84];
    const field = [42, 116, 110];
    const gold = [232, 184, 80];
    return (x, y) => {
      const u = (x + 0.5) / 64;
      const v = 1 - (y + 0.5) / 64;
      const g = 0.95 + 0.1 * f(x, y);
      const du = Math.min(u, 1 - u);
      const dv = Math.min(v, 1 - v);
      const edge = Math.min(du, dv / 0.9);
      if (edge < 0.1) return clamp255(scale(frame, g));
      if (edge < 0.125) return clamp255(scale(gold, g));
      if (edge < 0.2) return clamp255(scale(field, g * (dv < du ? (v > 0.5 ? 1.18 : 0.78) : u < 0.5 ? 1.1 : 0.84)));
      return clamp255(scale(field, g * (1.04 - 0.08 * (1 - v))));
    };
  });
}

// Pale polished marble (64 x 64): soft warm veins, no dark cracks (tinted cream for the trims,
// rose for the column shafts, the risers and the hearth's surround).
export function marbleTexture() {
  return painted('marble', 64, 64, () => {
    const veins = tileableFbm(64, 64, 4, 4, 55);
    const grain = tileableFbm(64, 64, 8, 2, 56);
    const base = [248, 242, 232];
    const vein = [212, 194, 180];
    return (x, y) => {
      const s = Math.abs(Math.sin((x / 64) * Math.PI * 2 + 6 * veins(x, y) + (y / 64) * Math.PI * 2));
      return clamp255(mix(scale(base, 0.95 + 0.08 * grain(x, y)), vein, 0.55 * Math.max(0, 1 - 8 * s)));
    };
  });
}

// Hanging banner (32 x 64, the whole sheet, top of the canvas = top of the banner): a crimson
// field with a woven grain, a gold border, a gold bar near the top and the castle's golden sun
// (as on the keep's banner) in the upper half.
export function bannerTexture() {
  return painted(
    'banner',
    32,
    64,
    () => {
      const [w, h] = [32, 64];
      const weave = tileableFbm(w, h, 8, 2, 71);
      const crimson = [150, 20, 36];
      const gold = [236, 182, 58];
      const deep = [176, 108, 30];
      return (x, y) => {
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
      };
    },
    { repeat: false },
  );
}
