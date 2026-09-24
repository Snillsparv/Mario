// The foliage atlas painted in node through a minimal stand-in canvas (texgen only needs
// getContext('2d') with createImageData / putImageData): every tree and bush is painted
// inside its cell with a clear margin, so no canopy is cut off flat at a cell edge.
// (Playtest: the two tree canopies had opaque texels in their cells' top row.)
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
const { FOLIAGE, FOLIAGE_CELL, FOLIAGE_MARGIN, BUSH_CELL_HEIGHT, canopyProfile, foliageAtlas } = await import(
  '../src/world/props/textures.js'
);

const atlas = foliageAtlas().image.getContext('2d').image;
const W = FOLIAGE_CELL * 2;
// Opaque bounds of cell i: rows from the cell's top edge, columns from its left edge.
function bounds(i) {
  const ox = (i % 2) * FOLIAGE_CELL;
  const oy = Math.floor(i / 2) * FOLIAGE_CELL;
  const b = { top: Infinity, bottom: -1, left: Infinity, right: -1 };
  for (let y = 0; y < FOLIAGE_CELL; y++) {
    for (let x = 0; x < FOLIAGE_CELL; x++) {
      if (atlas.data[((oy + y) * W + ox + x) * 4 + 3] === 0) continue;
      b.top = Math.min(b.top, y);
      b.bottom = Math.max(b.bottom, y);
      b.left = Math.min(b.left, x);
      b.right = Math.max(b.right, x);
    }
  }
  return b;
}

test('foliage sprites keep a clear margin inside their atlas cells (no flat-cut canopies)', () => {
  assert.equal(atlas.width, W);
  for (const i of [...FOLIAGE.tree, ...FOLIAGE.bush]) {
    const b = bounds(i);
    assert.ok(b.top >= FOLIAGE_MARGIN + 1, `cell ${i}: first opaque row ${b.top}`);
    assert.ok(b.left >= FOLIAGE_MARGIN && b.right <= FOLIAGE_CELL - 1 - FOLIAGE_MARGIN, `cell ${i}: columns ${b.left}..${b.right}`);
  }
  // Trees stand on their trunk at the cell's bottom; bushes sit inside the part of the cell
  // their quads show.
  for (const i of FOLIAGE.tree) assert.equal(bounds(i).bottom, FOLIAGE_CELL - 1, `tree ${i} reaches the ground`);
  for (const i of FOLIAGE.bush) assert.ok(bounds(i).top >= Math.ceil((1 - BUSH_CELL_HEIGHT) * FOLIAGE_CELL) + FOLIAGE_MARGIN);
});

test('canopy profiles match the painted canopies: empty above the top clump', () => {
  for (const i of FOLIAGE.tree) {
    const rows = canopyProfile(i, FOLIAGE_CELL);
    const top = FOLIAGE_CELL - 1 - rows.findLastIndex((h) => h > 0); // profile rows are bottom first
    assert.ok(Math.abs(top - bounds(i).top) <= 2, `cell ${i}: profile top row ${top}, painted ${bounds(i).top}`);
  }
});
