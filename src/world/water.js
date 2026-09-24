// Moat + pond water surface at WATER_LEVEL: a translucent blue-green sheet clipped to the
// water region (reaching a little under the walls), with two tiling textures scrolling in
// different directions — a base ripple layer and a sparkly highlight layer. Vertex colours
// make the shallows over the pond banks lighter and the deep water darker, and add slow
// broad light/dark swaths that break up the tiling.
//
// AI RACE mode (setDarkness): the water turns near-black green, a little more opaque, the
// highlights become an oily thin-film sheen, and the ripples run faster.

import * as THREE from 'three';
import { smoothstep } from '../core/math.js';
import { worldMaterial } from '../render/materials.js';
import { noise3 } from './terrain/shading.js';
import { tessellate } from './terrain/tessellate.js';
import { MeshBuffer } from './terrain/MeshBuffer.js';
import { waterGlintTexture, waterTexture } from './terrainTextures.js';

const STEP = 100;
const MARGIN = 40; // how far the sheet tucks under walls and banks
const TILE = 1400; // world size of one base ripple tile
const GLINT_TILE = 820;
// Storm grade (darkGrade.js) and look.
const DARK_WATER = { sat: 0.3, mul: [0.055, 0.11, 0.07] };
const DARK_OPACITY = { base: [0.72, 0.9], glint: [0.6, 0.5] };
const DARK_RIPPLE_SPEED = 2.2; // x the normal scroll speed at full storm

export function buildWater(layout, grade = null) {
  const L = layout;
  // Inside the moat/pond (grown by MARGIN), outside the island (shrunk by MARGIN), inside
  // the perimeter (grown by MARGIN).
  const field = (x, z) =>
    Math.max(
      L.sdWater(x, z) - MARGIN,
      -L.sdRoundRect(x, z, L.ISLAND) - MARGIN,
      L.sdRoundRect(x, z, L.PERIMETER) - MARGIN,
    );
  const minX = Math.floor((Math.max(L.PERIMETER.minX, L.POND.x - L.POND.radius) - 200) / STEP) * STEP;
  const maxX = Math.ceil((L.MOAT.maxX + 200) / STEP) * STEP;
  const minZ = Math.floor((L.PERIMETER.minZ - 200) / STEP) * STEP;
  const maxZ = Math.ceil((Math.max(L.MOAT.maxZ, L.POND.z + L.POND.radius) + 200) / STEP) * STEP;

  const base = new MeshBuffer();
  const glint = new MeshBuffer();
  const y = L.WATER_LEVEL;
  tessellate({
    minX,
    minZ,
    cols: (maxX - minX) / STEP,
    rows: (maxZ - minZ) / STEP,
    step: STEP,
    fields: [field],
    decide: (s) => (s[0] === undefined ? 0 : s[0] ? 'water' : null),
    emit(a, b, c) {
      const ib = [];
      const ig = [];
      for (const v of [a, b, c]) {
        // Shallow water (over the pond's banks) is lighter and greener; broad swaths vary.
        const shallow = 1 - smoothstep(60, 520, y - L.waterFloorHeight(v.x, v.z));
        const swath = 0.86 + 0.28 * noise3(v.x / 2000, 5.5, v.z / 2000);
        const col = { r: (0.9 + 0.25 * shallow) * swath, g: (0.95 + 0.2 * shallow) * swath, b: swath };
        const n = { nx: 0, ny: 1, nz: 0 };
        // Both layers run on axes rotated off the world grid (and off each other) so the
        // tiling never lines up with the moat's straight edges.
        const bu = (v.x * 0.94 + v.z * 0.34) / TILE;
        const bv = (v.z * 0.94 - v.x * 0.34) / TILE;
        ib.push(base.vertex({ x: v.x, y, z: v.z, ...n, u: bu, v: bv, ...col }, v.id));
        const gu = (v.x * 0.8 - v.z * 0.6) / GLINT_TILE;
        const gv = (v.z * 0.8 + v.x * 0.6) / GLINT_TILE;
        ig.push(glint.vertex({ x: v.x, y: y + 3, z: v.z, ...n, u: gu, v: gv, r: 1, g: 1, b: 1 }, v.id));
      }
      base.tri(...ib);
      glint.tri(...ig);
    },
  });

  const baseTex = waterTexture();
  const glintTex = waterGlintTexture();
  const baseMat = worldMaterial({ map: baseTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  baseMat.opacity = DARK_OPACITY.base[0];
  const glintMat = worldMaterial({ map: glintTex, transparent: true, depthWrite: false, vertexColors: false });
  glintMat.opacity = DARK_OPACITY.glint[0];
  if (grade) {
    grade.patch(baseMat, DARK_WATER);
    grade.patch(glintMat, { sat: 0.2, mul: [0.32, 0.32, 0.36], oil: true });
  }

  const baseMesh = new THREE.Mesh(base.toGeometry(), baseMat);
  const glintMesh = new THREE.Mesh(glint.toGeometry(), glintMat);
  baseMesh.name = 'water';
  glintMesh.name = 'waterGlint';
  // Draw after other transparent ground decals, base before highlights.
  baseMesh.renderOrder = 1;
  glintMesh.renderOrder = 2;
  const group = new THREE.Group();
  group.name = 'water';
  group.add(baseMesh, glintMesh);

  // The ripples run on a clock that goes faster in the storm: `extra` gathers the time gained
  // (0 while it never was dark, so the scroll is a plain function of time).
  let dark = 0;
  let extra = 0;
  let last = null;
  return {
    object3D: group,
    update(time) {
      if (last !== null && time > last && time - last < 1) extra += (time - last) * (DARK_RIPPLE_SPEED - 1) * dark;
      last = time;
      const t = time + extra;
      baseTex.offset.set((t * 0.035) % 1, (t * 0.021) % 1);
      glintTex.offset.set((-t * 0.027) % 1, (t * 0.043) % 1);
    },
    setDarkness(t) {
      dark = t;
      const e = t * t * (3 - 2 * t);
      baseMat.opacity = DARK_OPACITY.base[0] + (DARK_OPACITY.base[1] - DARK_OPACITY.base[0]) * e;
      glintMat.opacity = DARK_OPACITY.glint[0] + (DARK_OPACITY.glint[1] - DARK_OPACITY.glint[0]) * e;
    },
  };
}
