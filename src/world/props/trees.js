// Round bushy billboard trees at layout.TREES: one camera-facing quad each, added to the
// shared foliage batch (props.js). Each tree also gets a solid trunk collider (an octagonal
// prism, walls only) and a climbable pole.

import { makeRng } from '../../core/math.js';
import { prismWalls } from './geom.js';
import { FOLIAGE, cellUV } from './textures.js';

export const TREE_HEIGHT = 800; // nominal billboard height (each tree varies +-10 %)
export const TRUNK_RADIUS = 45;
export const TRUNK_HEIGHT = 350;
export const POLE_HEIGHT = 600; // climbable part of the trunk (scaled with the tree)
export const POLE_RADIUS = 40;
const SINK = 30; // quads start below the ground so the trunk never floats on slopes

// kit: shared builders from props.js ({ foliage, colliders, shadow(x, z, radius) }).
// Returns the climbable poles.
export function buildTrees(layout, kit) {
  const rng = makeRng(4242);
  return layout.TREES.map((t, i) => {
    const ground = layout.groundHeight(t.x, t.z);
    const scale = 0.9 + 0.2 * rng();
    const h = TREE_HEIGHT * scale;
    // Slight per-tree tint: some a bit yellower, some a bit bluer/darker.
    const warm = rng() - 0.5;
    const bright = 0.92 + 0.12 * rng();
    kit.foliage.push({
      x: t.x,
      y: ground - SINK,
      z: t.z,
      w: h,
      h: h + SINK,
      uv: cellUV(FOLIAGE.tree[i % FOLIAGE.tree.length]),
      tint: [bright * (1 + 0.08 * warm), bright, bright * (1 - 0.1 * warm)],
    });
    prismWalls(kit.colliders.wood, t.x, t.z, ground - 100, ground + TRUNK_HEIGHT, TRUNK_RADIUS);
    kit.shadow(t.x, t.z, 330 * scale, 0.9);
    return { x: t.x, z: t.z, y0: ground, y1: ground + Math.round(POLE_HEIGHT * scale), radius: POLE_RADIUS };
  });
}
