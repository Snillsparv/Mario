// The sea of Midsummer Skerries (skerries/layout.js): a WorldPart of two translucent sheets at
// SEA_LEVEL, the grounds' water layers (world/water.js: a base ripple layer and a sparkly
// highlight layer, the same two textures scrolling in different directions), reaching from the
// bay out to the far horizon, where the fog (complete by 28000) melts them into the sky dome.
//
//   buildSea(layout) -> { object3D, colliders: [], update(time) }
//
// Inside the bay the sheet is a fine grid whose vertex colours carry slow broad light and
// dark swaths (the tiling never shows); out at sea the cells grow and the water darkens (deep
// water). The base layer is double-sided, so it shows from under the water too.

import * as THREE from 'three';
import { worldMaterial } from '../../render/materials.js';
import { waterGlintTexture, waterTexture } from '../terrainTextures.js';

const EXTENT = 36000; // the sheets reach this far out (past the fog's end from anywhere in the bay)
const STEP = 1300; // grid step over the bay
const TILE = 1400; // world size of one base ripple tile (as the moat's)
const GLINT_TILE = 820;
const OPACITY = { base: 0.74, glint: 0.6 };
const DEEP = 0.72; // the colour out at sea (the bay's swaths average 1)

// Grid lines over [lo, hi]: the bay's in STEP cells, then two rings out to EXTENT.
function lines(lo, hi) {
  const out = [-EXTENT, -EXTENT / 3 + lo / 2];
  const n = Math.ceil((hi - lo) / STEP);
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
  out.push(EXTENT / 3 + hi / 2, EXTENT);
  return out;
}

export function buildSea({ BAY, SEA_LEVEL: y }) {
  const xs = lines(BAY.x0, BAY.x1);
  const zs = lines(BAY.z0, BAY.z1);
  const inBay = (x, z) => x >= BAY.x0 && x <= BAY.x1 && z >= BAY.z0 && z <= BAY.z1;
  const base = { pos: [], uv: [], col: [] };
  const glint = { pos: [], uv: [], col: [] };
  const vertex = (x, z) => {
    // Broad swaths in the bay; deep, darker water outside.
    const k = inBay(x, z) ? 0.88 + 0.12 * Math.sin(x / 1700 + z / 2300) * Math.cos(z / 1900 - x / 3100) + 0.06 : DEEP;
    base.pos.push(x, y, z);
    base.uv.push((x * 0.94 + z * 0.34) / TILE, (z * 0.94 - x * 0.34) / TILE);
    base.col.push(0.92 * k, 0.98 * k, k);
    glint.pos.push(x, y + 3, z);
    glint.uv.push((x * 0.8 - z * 0.6) / GLINT_TILE, (z * 0.8 + x * 0.6) / GLINT_TILE);
    glint.col.push(1, 1, 1);
  };
  for (const z of zs) for (const x of xs) vertex(x, z);
  const index = [];
  const w = xs.length;
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i;
      // Counter-clockwise seen from above (+y).
      index.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const geometry = (layer) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(layer.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(layer.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(layer.col, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  };

  const baseTex = waterTexture();
  const glintTex = waterGlintTexture();
  const baseMat = worldMaterial({ map: baseTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  baseMat.opacity = OPACITY.base;
  const glintMat = worldMaterial({ map: glintTex, transparent: true, depthWrite: false, vertexColors: false });
  glintMat.opacity = OPACITY.glint;
  const baseMesh = new THREE.Mesh(geometry(base), baseMat);
  const glintMesh = new THREE.Mesh(geometry(glint), glintMat);
  baseMesh.name = 'skerries-sea';
  glintMesh.name = 'skerries-glint';
  // Drawn after the opaque world, base before highlights (as the moat's).
  baseMesh.renderOrder = 1;
  glintMesh.renderOrder = 2;
  const group = new THREE.Group();
  group.name = 'sea';
  group.add(baseMesh, glintMesh);
  return {
    name: 'sea',
    object3D: group,
    colliders: [],
    // The ripples scroll by game time (the textures are the moat's: only the area Jonas is in
    // updates them).
    update(time) {
      baseTex.offset.set((time * 0.035) % 1, (time * 0.021) % 1);
      glintTex.offset.set((-time * 0.027) % 1, (time * 0.043) % 1);
    },
  };
}
