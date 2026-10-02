// The Great Hall's WOOD_MEAN (world/hall/hall.js: the castle wood texture's mean colour, the
// wood's factor in the polished floor's mirror) is typed in, measured once in the browser, as
// the game never reads a canvas back: here the castle's woodTexture is painted in node through a
// minimal stand-in canvas (texgen only needs getContext('2d') with createImageData /
// putImageData; set before anything imports texgen, which looks for a canvas once) and the mean
// of its linearised pixels, worked out as hall/textures.js works out its own, still matches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeContext {
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(img) {
    this.image = img;
  }
}
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.ctx = new FakeContext();
  }
  getContext() {
    return this.ctx;
  }
};
const { woodTexture } = await import('../src/world/castle/textures.js');
const { WOOD_MEAN } = await import('../src/world/hall/hall.js');

const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

test("WOOD_MEAN is the castle wood texture's mean colour (linear RGB, within 0.002)", () => {
  const img = woodTexture().image.getContext('2d').image;
  const sum = [0, 0, 0];
  for (let i = 0; i < img.width * img.height; i++) for (let k = 0; k < 3; k++) sum[k] += linear(img.data[i * 4 + k] / 255);
  const mean = sum.map((s) => s / (img.width * img.height));
  assert.ok(mean.every((m, k) => Math.abs(m - WOOD_MEAN[k]) < 0.002), `measured ${mean.map((m) => m.toFixed(4))} vs WOOD_MEAN ${WOOD_MEAN}`);
});
