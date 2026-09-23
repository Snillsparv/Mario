// Layout-level terrain checks: heights that keep the sky and the moat in view, collectibles
// that sit where their comments say, and the low-poly facet lattice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/world/layout.js';

// Highest ground inside the perimeter (on a 50-unit grid).
function summit(minX, maxX, minZ, maxZ) {
  let best = { y: -Infinity };
  for (let x = minX; x <= maxX; x += 50) {
    for (let z = minZ; z <= maxZ; z += 50) {
      if (L.regionAt(x, z) === 'cliff') continue;
      const y = L.groundHeight(x, z);
      if (y > best.y) best = { x, y, z };
    }
  }
  return best;
}

test('cliffs stay below the castle walls but out of reach, and the moat shows from the lawn', () => {
  const rimTop = L.CLIFF_TOP + 300; // cliffHeight's crest swell
  assert.ok(rimTop < L.CASTLE.baseY + L.CASTLE.mainHeight, 'the castle walls rise above the cliff rim');
  const P = L.PERIMETER;
  const top = summit(P.minX, P.maxX, P.minZ, P.maxZ);
  assert.ok(L.CLIFF_TOP - top.y > 650, `cliff top ${L.CLIFF_TOP} vs highest ground ${top.y.toFixed(0)}`);
  assert.ok(L.LAWN_BASE - L.WATER_LEVEL <= 150, 'moat water close enough below the rim to be seen from the path');
  // The pond's lawn edge stays a little above the water, so its bank is a beach.
  const edge = L.lawnHeight(L.POND.x, L.POND.z - L.POND.radius);
  assert.ok(edge > L.WATER_LEVEL + 20 && edge < L.WATER_LEVEL + 80, `pond edge ${edge.toFixed(0)}`);
});

test('coins without an explicit height sit on dry ground', () => {
  for (const c of [...L.COINS, ...L.RED_COINS]) {
    if (c.y !== undefined) continue;
    assert.notEqual(L.regionAt(c.x, c.z), 'water', `coin at ${c.x},${c.z} is over the water`);
    assert.ok(L.groundHeight(c.x, c.z) > L.WATER_LEVEL, `coin at ${c.x},${c.z} is under water`);
  }
});

test('the hill-top red coin is on the east hill summit and the coin line climbs toward it', () => {
  const H = L.EAST_HILL;
  const top = summit(H.x - H.radius, H.x + H.radius, H.z - H.radius, H.z + H.radius);
  const red = L.RED_COINS.find((c) => Math.hypot(c.x - top.x, c.z - top.z) < 200);
  assert.ok(red, `a red coin at the summit ${top.x},${top.z}`);
  assert.ok(top.y - L.groundHeight(red.x, red.z) < 5, 'red coin on the very top');
  // The coins nearest the hill form a line rising toward the summit.
  const line = L.COINS.filter((c) => Math.hypot(c.x - H.x, c.z - H.z) < H.radius && c.y === undefined);
  assert.ok(line.length >= 5, `${line.length} coins on the hill`);
  const heights = line.map((c) => L.groundHeight(c.x, c.z));
  heights.forEach((y, i) => i && assert.ok(y > heights[i - 1] + 40, `coin ${i} climbs (${heights[i - 1].toFixed(0)} -> ${y.toFixed(0)})`));
  assert.ok(heights.at(-1) > top.y - 200, 'the line ends near the top');
});

test('open lawn and cliff top are planar over each facet of the lattice', () => {
  const S = L.FACET;
  let checked = 0;
  for (let i = -14; i < 14; i++) {
    for (let j = -14; j < 14; j++) {
      const x0 = i * S;
      const z0 = j * S;
      // Only facet cells well away from the water (where the lawn blends to smooth).
      if (L.sdWater(x0 + S / 2, z0 + S / 2) < 1200) continue;
      const region = L.sdRoundRect(x0 + S / 2, z0 + S / 2, L.PERIMETER) > 0 ? 'cliff' : 'lawn';
      const h = (u, v) => L.regionHeight(region, x0 + u * S, z0 + v * S);
      // A point inside each half matches the plane through that half's corners.
      const [a, b] = L.facetFlip(i, j) ? [[0.2, 0.2], [0.8, 0.8]] : [[0.8, 0.2], [0.2, 0.8]];
      const planes = L.facetFlip(i, j)
        ? [h(0, 0) + a[0] * (h(1, 0) - h(0, 0)) + a[1] * (h(0, 1) - h(0, 0)), h(1, 1) + (1 - b[0]) * (h(0, 1) - h(1, 1)) + (1 - b[1]) * (h(1, 0) - h(1, 1))]
        : [h(0, 0) + a[0] * (h(1, 0) - h(0, 0)) + a[1] * (h(1, 1) - h(1, 0)), h(0, 0) + b[1] * (h(0, 1) - h(0, 0)) + b[0] * (h(1, 1) - h(0, 1))];
      assert.ok(Math.abs(h(...a) - planes[0]) < 1e-6 && Math.abs(h(...b) - planes[1]) < 1e-6, `cell ${i},${j}`);
      checked++;
    }
  }
  assert.ok(checked > 200, `${checked} cells`);
});
