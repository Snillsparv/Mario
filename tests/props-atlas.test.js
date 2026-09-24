// The props' leaf and bark textures painted in node through a minimal stand-in canvas (texgen
// only needs getContext('2d') with createImageData / putImageData): both tile seamlessly (the
// canopies and trunks repeat them), the leaves are a dense pile of clumps in greens, and the
// bark is brown.
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
const { LEAF_SIZE, barkTexture, leafTexture } = await import('../src/world/props/textures.js');

const pixels = (tex) => tex.image.getContext('2d').image;
const px = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// Mean colour difference across the wrap seam vs between neighbouring columns (rows) inside.
function seams(img) {
  const { width: w, height: h } = img;
  let seamX = 0;
  let innerX = 0;
  for (let y = 0; y < h; y++) {
    seamX += diff(px(img, w - 1, y), px(img, 0, y));
    for (let x = 0; x + 1 < w; x++) innerX += diff(px(img, x, y), px(img, x + 1, y)) / (w - 1);
  }
  let seamY = 0;
  let innerY = 0;
  for (let x = 0; x < w; x++) {
    seamY += diff(px(img, x, h - 1), px(img, x, 0));
    for (let y = 0; y + 1 < h; y++) innerY += diff(px(img, x, y), px(img, x, y + 1)) / (h - 1);
  }
  return { x: seamX / innerX, y: seamY / innerY };
}

test('leaves: a tileable, opaque, green pile of clumps', () => {
  const img = pixels(leafTexture());
  assert.equal(img.width, LEAF_SIZE);
  const s = seams(img);
  assert.ok(s.x < 1.6 && s.y < 1.6, `wrap seams ${s.x.toFixed(2)} / ${s.y.toFixed(2)} x an inner edge`);
  let dark = 0;
  let sum = [0, 0, 0];
  const tones = new Set();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = px(img, x, y);
      assert.equal(a, 255, 'opaque');
      assert.ok(g > r && g > b, `green at ${x},${y}: ${r},${g},${b}`);
      if (g < 70) dark++;
      sum = [sum[0] + r, sum[1] + g, sum[2] + b];
      tones.add(`${r},${g},${b}`);
    }
  }
  const n = img.width * img.height;
  assert.ok(dark / n < 0.25, `gaps between clumps: ${((100 * dark) / n).toFixed(0)} %`);
  assert.ok(tones.size >= 4, 'several leaf tones');
  const mean = sum.map((v) => v / n);
  assert.ok(mean[1] > 90 && mean[1] < 160, `mean green ${mean[1].toFixed(0)}`);
});

test('bark: a tileable brown', () => {
  const img = pixels(barkTexture());
  const s = seams(img);
  assert.ok(s.x < 1.6 && s.y < 1.6, `wrap seams ${s.x.toFixed(2)} / ${s.y.toFixed(2)} x an inner edge`);
  for (let y = 0; y < img.height; y += 3) {
    for (let x = 0; x < img.width; x += 3) {
      const [r, g, b] = px(img, x, y);
      assert.ok(r > g && g > b, `brown at ${x},${y}: ${r},${g},${b}`);
    }
  }
});
