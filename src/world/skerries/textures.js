// Procedural textures of Midsummer Skerries (small canvases, N64-style; the rest of the course
// reuses the terrain's rock, grass, sand and water and the castle's wood). Each returns an empty
// THREE.Texture in node (texgen.canvasTexture handles that).

import { canvasTexture, paintPixels } from '../../render/texgen.js';
import { faluPlankTexture, sailTexture } from '../courseKit.js';

export { faluPlankTexture, sailTexture }; // (world/courseKit.js: Sparrow Lane paints with them too)

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
