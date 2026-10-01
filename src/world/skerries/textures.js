// Procedural textures of Midsummer Skerries (small canvases, N64-style; the rest of the course
// reuses the terrain's rock, grass, sand and water and the castle's wood). Each returns an empty
// THREE.Texture in node (texgen.canvasTexture handles that).

import { canvasTexture, paintPixels, tileableFbm } from '../../render/texgen.js';
import { makeRng } from '../../core/math.js';

const clamp255 = (c) => [Math.min(255, Math.max(0, c[0])), Math.min(255, Math.max(0, c[1])), Math.min(255, Math.max(0, c[2]))];

// Painted planks (64 x 64): four boards running up the texture (v), light paint over a soft
// grain with dark seams between the boards and a few knots showing through. Nearly white, so
// the vertex colours give the paint its colour: the lighthouse's white and red, the boat's
// blue hull (and Falu red with white trim on the cottages).
export function faluPlankTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 6, 3, 911);
    const wear = tileableFbm(w, h, 3, 2, 913);
    const rng = makeRng(917);
    const boards = 4;
    const bw = w / boards;
    const tones = Array.from({ length: boards }, () => 0.9 + rng() * 0.1);
    const knots = Array.from({ length: 5 }, () => ({ x: rng() * w, y: rng() * h, r: 1 + rng() * 1.4 }));
    paintPixels(ctx, w, h, (x, y) => {
      const b = Math.floor(x / bw);
      const lx = x - b * bw;
      if (lx < 1) return [88, 80, 76];
      const streak = 0.94 + 0.06 * Math.sin(lx * 1.3 + grain(x, y) * 10 + b);
      let k = tones[b] * streak * (0.92 + wear(x, y) * 0.1) * (lx === 1 || lx === bw - 1 ? 0.88 : 1);
      for (const kn of knots) {
        if (Math.hypot(x + 0.5 - kn.x, (y + 0.5 - kn.y) * 0.6) < kn.r) k *= 0.8;
      }
      return clamp255([236 * k, 232 * k, 226 * k]);
    });
  });
}

// Sailcloth (32 x 32): cream canvas with its seams running across every 8 px and a soft weave,
// tinted by the vertex colours (the red sail, the white jib, the pennants).
export function sailTexture() {
  return canvasTexture(32, 32, (ctx, w, h) => {
    const weave = tileableFbm(w, h, 4, 2, 931);
    paintPixels(ctx, w, h, (x, y) => {
      const k = (y % 8 === 0 ? 0.84 : 1) * (0.92 + weave(x, y) * 0.12);
      return clamp255([246 * k, 240 * k, 226 * k]);
    });
  });
}

// Fishing net (32 x 32, tiling): pale tarred twine two pixels thick in diamonds 8 px across on
// transparent (drawn alpha-tested: far off, where its mipmaps blur the strands into the holes,
// the net fades away and the racks' posts and rails remain), a darker knot where the strands
// cross.
export function netTexture() {
  return canvasTexture(32, 32, (ctx, w, h) => {
    paintPixels(ctx, w, h, (x, y) => {
      const a = (x + y) % 8 < 2;
      const b = (x - y + 32) % 8 < 2;
      if (a && b) return [96, 86, 66, 255];
      return a || b ? [150, 138, 106, 255] : [150, 138, 106, 0];
    });
  });
}
