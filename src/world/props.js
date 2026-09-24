// Castle-grounds props: low-poly 3D trees and bushes, wooden fences and signposts, boulders,
// flower patches, soft ground shadows and the waterfall (see src/world/props/*).
//
// Everything of one material is merged into one static mesh, so the whole part costs 8 draw
// calls: leaves (canopies + bushes), bark (trunks), flowers, wood, rock, shadows, waterfall
// sheets and waterfall splash. Colliders are raw triangle lists (trunks/fences/signs = wood,
// rocks = stone, bushes = grass); every tree is also a climbable pole, from the ground up
// through its leaves to the crown, and `trees` lists the trunks and canopies (for fires).
//
// AI RACE mode (setDarkness(t)): every material crossfades to its storm grade (DARK_GRADES,
// terrain/darkGrade.js): withered dark brown-green canopies that also shrink and go ragged
// (foliageFade.js wither), near-black bark, dead grey wilting flowers, dark fences, signs and
// rocks, murky waterfall. Uniforms only (the flowers' few quads are resized).

import * as THREE from 'three';
import { worldMaterial } from '../render/materials.js';
import { MeshBuilder, bakedMesh } from './props/geom.js';
import { FoliageFade, heroLocator } from './props/foliageFade.js';
import { buildTrees } from './props/trees.js';
import { buildFences } from './props/fences.js';
import { buildDecor } from './props/decor.js';
import { buildWaterfall } from './props/waterfall.js';
import { DarkGrade } from './terrain/darkGrade.js';
import { LEAF_TILE, barkTexture, leafTexture, rockTexture, shadowTexture, woodTexture } from './props/textures.js';

// AI RACE mode grades per mesh (see terrain/darkGrade.js). Linear colours. Tuned together with
// the renderer's storm fog and grade (render/post/storm.js), which darken the frame further.
export const DARK_GRADES = {
  leaves: { sat: 0.08, mul: [0.34, 0.27, 0.17] }, // withered, dark brown-green
  bark: { sat: 0.15, mul: [0.1, 0.09, 0.09] }, // near-black
  flowers: { sat: 0, mul: [0.34, 0.33, 0.32] }, // dead grey
  wood: { sat: 0.25, mul: [0.26, 0.22, 0.2] },
  rocks: { sat: 0.08, mul: [0.21, 0.21, 0.23] },
  waterfall: { sat: 0.25, mul: [0.2, 0.26, 0.24] },
  waterfallSplash: { sat: 0.1, mul: [0.42, 0.44, 0.46] },
};

export function buildProps(layout) {
  // Shared builders the sub-modules add to.
  const kit = {
    leaves: new MeshBuilder({ fadeGroups: true }), // canopies and bushes (canopy.js)
    bark: new MeshBuilder({ fadeGroups: true }), // tree trunks
    fade: new FoliageFade(), // one fade group per canopy, bush and trunk
    wood: new MeshBuilder(),
    rock: new MeshBuilder(),
    shadows: new MeshBuilder({ alpha: true }),
    colliders: { wood: [], stone: [], grass: [] },
    shadow: (x, z, radius, strength) => addShadow(kit.shadows, layout, x, z, radius, strength),
  };

  const { poles, trees } = buildTrees(layout, kit);
  buildFences(layout, kit);
  const decor = buildDecor(layout, kit);
  const waterfall = buildWaterfall(layout, kit);
  // Foliage thins out (screen-door dither) when the camera is right up against it or a
  // canopy stands between the camera and the hero it frames.
  // The leaves are mapped tri-planar (world axes, blended by their normals): seamless.
  const leafMaterial = kit.fade.patch(worldMaterial({ map: leafTexture() }), { triplanar: LEAF_TILE });
  const leaves = foliageMesh('leaves', kit.leaves, leafMaterial, { normals: true });
  const bark = foliageMesh('bark', kit.bark, kit.fade.patch(worldMaterial({ map: barkTexture() })));
  const locateHero = heroLocator((x, z) => Math.max(layout.groundHeight(x, z), layout.waterLevelAt(x, z)));

  const group = new THREE.Group();
  group.name = 'props';
  group.add(
    leaves,
    bark,
    decor.flowers,
    bakedMesh('wood', kit.wood, worldMaterial({ map: woodTexture() })),
    bakedMesh('rocks', kit.rock, worldMaterial({ map: rockTexture() })),
    shadowMesh(kit.shadows),
    waterfall.sheets,
    waterfall.splash,
  );
  const grade = new DarkGrade();
  for (const mesh of group.children) if (DARK_GRADES[mesh.name]) grade.patch(mesh.material, DARK_GRADES[mesh.name]);

  return {
    object3D: group,
    colliders: Object.entries(kit.colliders).map(([terrain, positions]) => ({
      positions: new Float32Array(positions),
      terrain,
    })),
    poles,
    trees,
    update(time, camera) {
      kit.fade.update(camera, locateHero, time);
      decor.update(camera);
      waterfall.update(time, camera);
    },
    // AI RACE mode crossfade: 0 = sunny grounds .. 1 = storm.
    setDarkness(t) {
      const k = Math.min(1, Math.max(0, t));
      const e = k * k * (3 - 2 * k);
      grade.set(e);
      kit.fade.wither(e);
      decor.wilt(e);
    },
  };
}

// Static foliage mesh: colours are baked by the builders (canopy.js, trees.js); the unlit
// material only needs normals for a tri-planar map.
function foliageMesh(name, builder, material, { normals = false } = {}) {
  const geo = builder.toGeometry();
  if (!normals) geo.deleteAttribute('normal');
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return mesh;
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
