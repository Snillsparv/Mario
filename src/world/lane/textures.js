// Procedural textures of Sparrow Lane (small canvases, N64-style; painted in code, never from a
// photograph): asphalt, render and concrete pan tiles. The rest of the course reuses the
// terrain's grass, masonry and flagstones, the castle's stone and wood, the skerries' painted
// planks and the trees' leaves. Each returns an empty THREE.Texture in node
// (texgen.canvasTexture handles that).

import { canvasTexture, paintPixels, tileableFbm, tileableNoise } from '../../render/texgen.js';
import { makeRng } from '../../core/math.js';

const clamp255 = (c) => [Math.min(255, Math.max(0, c[0])), Math.min(255, Math.max(0, c[1])), Math.min(255, Math.max(0, c[2]))];

// Asphalt (64 x 64): a fine grey aggregate (light and dark grains over a soft mottle) with a
// few darker patches where it has been mended; no lines. Near white-grey, so the vertex colours
// set its shade (the road, the paler pavement, the drives).
export function asphaltTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const mottle = tileableFbm(w, h, 4, 3, 1201);
    const patch = tileableNoise(w, h, 3, 1203);
    const rng = makeRng(1207);
    paintPixels(ctx, w, h, (x, y) => {
      const r = rng();
      const grain = r < 0.08 ? 1.18 : r < 0.18 ? 0.8 : 0.96 + rng() * 0.08;
      const mended = patch(x, y) > 0.8 ? 0.93 : 1;
      const k = grain * mended * (0.9 + mottle(x, y) * 0.16);
      return clamp255([206 * k, 204 * k, 200 * k]);
    });
  });
}

// Render (32 x 32): fine plaster grain, nearly white (the vertex colours give the walls, frames,
// doors and every flat-coloured detail their colour).
export function renderTexture() {
  return canvasTexture(32, 32, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 8, 2, 1211);
    const rng = makeRng(1213);
    paintPixels(ctx, w, h, (x, y) => {
      const k = 0.92 + grain(x, y) * 0.08 + (rng() - 0.5) * 0.04;
      return clamp255([250 * k, 248 * k, 244 * k]);
    });
  });
}

// Concrete pan tiles (64 x 64): four rows of wavy tiles (eight across, each a wave lighter on its
// crown), each row overlapping the one below it with a dark lap at its foot; neutral grey,
// tinted per roof (black, dark brown, light grey). v = 0 at the eave.
export function panTileTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 8, 2, 1221);
    const rng = makeRng(1223);
    const rows = 4;
    const rh = h / rows;
    const tones = Array.from({ length: rows * 8 }, () => 0.9 + rng() * 0.14);
    paintPixels(ctx, w, h, (x, y) => {
      // Canvas y grows down; v = 0 (the eave) is the canvas's bottom row.
      const fromEave = h - 1 - y;
      const row = Math.floor(fromEave / rh);
      const ly = fromEave - row * rh; // 0 at the row's foot (its lap), up to rh at its head
      const tile = Math.floor(((x + (row % 2) * 4) % w) / 8);
      const wave = Math.cos(((x + (row % 2) * 4) / 8) * Math.PI * 2); // a crown a tile
      let k = tones[row * 8 + tile] * (0.86 + 0.14 * wave) * (0.92 + grain(x, y) * 0.12);
      if (ly < 2) k *= 0.55; // the lap's shadow
      else if (ly > rh - 2) k *= 0.85;
      return clamp255([222 * k, 222 * k, 220 * k]);
    });
  });
}
