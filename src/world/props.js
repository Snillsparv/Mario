// Castle-grounds props: billboard trees and bushes, wooden fences and a signpost, boulders,
// flower patches, soft ground shadows and the waterfall (see src/world/props/*).
//
// Everything of one material is merged into one mesh, so the whole part costs 7 draw
// calls: foliage (trees + bushes), flowers, wood, rock, shadows, waterfall sheets and
// waterfall splash. Colliders are raw triangle lists (trunks/fences/sign = wood, rocks =
// stone, bushes = grass); every tree trunk is also a climbable pole.

import * as THREE from 'three';
import { worldMaterial } from '../render/materials.js';
import { MeshBuilder, bakedMesh } from './props/geom.js';
import { BillboardBatch } from './props/billboards.js';
import { buildTrees } from './props/trees.js';
import { buildFences } from './props/fences.js';
import { buildDecor } from './props/decor.js';
import { buildWaterfall } from './props/waterfall.js';
import { foliageAtlas, rockTexture, shadowTexture, woodTexture } from './props/textures.js';

export function buildProps(layout) {
  // Shared builders the sub-modules add to.
  const kit = {
    foliage: [], // billboard sprites (see BillboardBatch)
    wood: new MeshBuilder(),
    rock: new MeshBuilder(),
    shadows: new MeshBuilder({ alpha: true }),
    colliders: { wood: [], stone: [], grass: [] },
    shadow: (x, z, radius, strength) => addShadow(kit.shadows, layout, x, z, radius, strength),
  };

  const poles = buildTrees(layout, kit);
  buildFences(layout, kit);
  const decor = buildDecor(layout, kit);
  const waterfall = buildWaterfall(layout, kit);
  const foliage = new BillboardBatch('foliage', kit.foliage, worldMaterial({ map: foliageAtlas(), alphaTest: 0.5 }));

  const group = new THREE.Group();
  group.name = 'props';
  group.add(
    foliage.mesh,
    decor.flowers,
    bakedMesh('wood', kit.wood, worldMaterial({ map: woodTexture() })),
    bakedMesh('rocks', kit.rock, worldMaterial({ map: rockTexture() })),
    shadowMesh(kit.shadows),
    waterfall.sheets,
    waterfall.splash,
  );

  return {
    object3D: group,
    colliders: Object.entries(kit.colliders).map(([terrain, positions]) => ({
      positions: new Float32Array(positions),
      terrain,
    })),
    poles,
    update(time, camera) {
      foliage.update(camera);
      decor.update(camera);
      waterfall.update(time, camera);
    },
  };
}

// Soft round shadow draped over the ground under a prop: a disc of rings whose vertices sit
// just above groundHeight, faded by the shadow texture; strength goes in the vertex alpha.
const SHADOW_RINGS = [0, 0.35, 0.7, 1];
const SHADOW_SEGS = 14;
function addShadow(builder, layout, cx, cz, radius, strength) {
  const vert = (ring, seg) => {
    const f = SHADOW_RINGS[ring];
    const a = (seg / SHADOW_SEGS) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius * f;
    const z = cz + Math.sin(a) * radius * f;
    const u = 0.5 + (x - cx) / (2 * radius);
    const v = 0.5 + (z - cz) / (2 * radius);
    return { x, y: layout.groundHeight(x, z) + 3, z, u, v, r: 0, g: 0, b: 0, a: strength };
  };
  for (let r = 0; r + 1 < SHADOW_RINGS.length; r++) {
    for (let s = 0; s < SHADOW_SEGS; s++) {
      builder.facingQuad(vert(r, s), vert(r + 1, s), vert(r + 1, s + 1), vert(r, s + 1), [0, 1, 0]);
    }
  }
}

function shadowMesh(builder) {
  const mat = worldMaterial({ map: shadowTexture(), color: 0x000000, transparent: true, depthWrite: false });
  mat.opacity = 0.42;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -8;
  const mesh = new THREE.Mesh(builder.toGeometry(), mat);
  mesh.name = 'shadows';
  return mesh;
}
