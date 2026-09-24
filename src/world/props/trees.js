// Round bushy low-poly 3D trees at layout.TREES, N64 style: a tapered seven-sided bark trunk
// with a flared foot, under a full round canopy of overlapping leafy blobs (canopy.js). Size,
// shape and tint vary per tree from a seeded RNG. Everything is static: trunks go into the
// shared bark builder and canopies into the leaf builder (props.js), one mesh each, and every
// canopy and trunk is a fade group (foliageFade.js).
//
// Each tree also gets a solid trunk collider (an octagonal prism, walls only, up to the
// canopy) and a climbable pole as thick as the visible trunk that runs on up through the
// leaves to the crown: the top of the canopy right over the trunk (measured on the built
// leaves), so the hero climbs up through the canopy and out on top (a handstand on the
// crown, like the classics). The canopy sits high enough (about three times his height)
// that a trunk grabbed from a running jump still leaves a real climb below the leaves.

import { makeRng, smoothstep } from '../../core/math.js';
import { SUN_DIR } from '../layout.js';
import { prismWalls } from './geom.js';
import { addCanopy, blobUnderside, fadeBlobs } from './canopy.js';

export const TRUNK_RADIUS = 45; // collider (the octagon's corners)
export const POLE_RADIUS = 40; // ~ the visible trunk where he climbs
// Canopy size at scale 1: centre height above the ground, main blob radii.
// (Review: at 550 the trunk grabbed from a running jump left ~7 units to climb.)
const CANOPY_Y = 740;
const CANOPY_R = 262;
const CANOPY_RY = 222;
const TRUNK_SIDES = 7;
// Horizontal reach around the trunk axis where the climbing hero is (70 out) and his hat.
const CLIMB_REACH = 120;

// Visible trunk radius at height h above the ground: a flared foot, then a gentle taper
// (within a few units of POLE_RADIUS all the way up the climb).
export function trunkRadius(h, scale = 1) {
  const k = scale ** 0.3;
  return k * (41.5 + 20 * Math.exp(-Math.max(0, h) / 28) - 0.006 * Math.max(0, h));
}

// Deterministic shape of every tree: { x, z, ground, scale, tint, blobs, centre, radii,
// bottom, top, base (canopy underside over the trunk), reach, trunkTop }.
export function treeShapes(layout) {
  return layout.TREES.map((t, i) => {
    const rng = makeRng(4242 + i * 7919);
    const ground = layout.groundHeight(t.x, t.z);
    const s = 0.9 + 0.2 * rng();
    const R = CANOPY_R * s;
    const centre = { x: t.x + (rng() - 0.5) * 24, y: ground + CANOPY_Y * s, z: t.z + (rng() - 0.5) * 24 };
    let seed = 1000 + i * 50;
    const blob = (x, y, z, r, squash, detail = 1) => ({
      x,
      y,
      z,
      rx: r * (0.94 + 0.12 * rng()),
      ry: r * squash,
      rz: r * (0.94 + 0.12 * rng()),
      yaw: rng() * Math.PI * 2,
      seed: seed++,
      detail,
    });
    // Clumps on the main blob at azimuth az, elevation el (radians), distance d x R.
    const around = (az, el, d, r, squash, detail = 1) =>
      blob(
        centre.x + Math.cos(el) * Math.cos(az) * d * R,
        centre.y + Math.sin(el) * d * R * 0.85,
        centre.z + Math.cos(el) * Math.sin(az) * d * R,
        r * R,
        squash,
        detail,
      );
    const blobs = [blob(centre.x, centre.y, centre.z, R, CANOPY_RY / CANOPY_R, 2)];
    // A lower ring of clumps bulging out round the middle, a smaller upper ring, a crown.
    const lower = rng() < 0.5 ? 6 : 7;
    let phase = rng() * Math.PI * 2;
    for (let k = 0; k < lower; k++) {
      const az = phase + (k / lower) * Math.PI * 2 + (rng() - 0.5) * 0.45;
      blobs.push(around(az, -0.3 + 0.35 * rng(), 0.6 + 0.1 * rng(), 0.5 + 0.12 * rng(), 0.82, 2));
    }
    const upper = rng() < 0.5 ? 3 : 4;
    phase = rng() * Math.PI * 2;
    for (let k = 0; k < upper; k++) {
      const az = phase + (k / upper) * Math.PI * 2 + (rng() - 0.5) * 0.6;
      blobs.push(around(az, 0.45 + 0.3 * rng(), 0.58 + 0.08 * rng(), 0.46 + 0.1 * rng(), 0.85));
    }
    blobs.push(around(rng() * Math.PI * 2, 1.2 + 0.25 * rng(), 0.48, 0.5 + 0.08 * rng(), 0.85));
    const bottom = Math.min(...blobs.map((b) => b.y - b.ry));
    const top = Math.max(...blobs.map((b) => b.y + b.ry));
    const reach = Math.max(...blobs.map((b) => Math.hypot(b.x - t.x, b.z - t.z) + Math.max(b.rx, b.rz)));
    const base = Math.min(...blobs.map((b) => blobUnderside(b, t.x, t.z, CLIMB_REACH)));
    // Slight per-tree tint: some a bit yellower, some a bit bluer/darker.
    const warm = rng() - 0.5;
    const bright = 0.92 + 0.12 * rng();
    const tint = [bright * (1 + 0.08 * warm), bright, bright * (1 - 0.12 * warm)];
    return {
      x: t.x,
      z: t.z,
      ground,
      scale: s,
      tint,
      blobs,
      centre,
      radii: { x: reach, y: (top - bottom) / 2, z: reach },
      bottom,
      top,
      base,
      reach,
      trunkTop: base + 0.6 * (centre.y - base), // the trunk runs up into the canopy
    };
  });
}

// kit: shared builders from props.js ({ leaves, bark, fade, colliders, shadow }). Returns
// { poles: the climbable poles (ground to crown), trees: [{ x, z, groundY, trunkTop, crown,
// canopy: { x, y, z, radius } }] } (the canopy as a sphere round its leaves, e.g. for fires).
export function buildTrees(layout, kit) {
  const poles = [];
  const trees = [];
  treeShapes(layout).forEach((tree, i) => {
    const { x, z, ground, scale } = tree;
    kit.bark.fadeGroup = kit.fade.addTrunk({ x, z, y0: ground - 50, y1: innerTrunkTop(tree), r: trunkRadius(100, scale) }, `trunk:${i}`);
    addTrunk(kit.bark, layout, tree, i);
    kit.leaves.fadeGroup = kit.fade.addCanopy(fadeBlobs(tree.blobs), `tree:${i}`);
    const first = kit.leaves.pos.length;
    addCanopy(kit.leaves, tree.blobs, {
      centre: { x: tree.centre.x, y: (tree.top + tree.bottom) / 2, z: tree.centre.z },
      radii: tree.radii,
      bottom: tree.bottom,
      top: tree.top,
      tint: tree.tint,
    });
    prismWalls(kit.colliders.wood, x, z, ground - 100, tree.base, TRUNK_RADIUS);
    kit.shadow(x, z, 0.95 * tree.reach, 0.9);
    const crown = Math.round(topOfLeaves(kit.leaves.pos, first, x, z) ?? tree.top);
    poles.push({ x, z, y0: ground, y1: crown, radius: POLE_RADIUS });
    const mid = (tree.top + tree.bottom) / 2;
    trees.push({
      x,
      z,
      groundY: ground,
      trunkTop: tree.trunkTop,
      crown,
      canopy: { x: tree.centre.x, y: mid, z: tree.centre.z, radius: Math.max(tree.reach, (tree.top - tree.bottom) / 2) },
    });
  });
  return { poles, trees };
}

// Height of the highest leaf triangle over (x, z) among the builder positions `pos` from
// float index `first` on (9 per triangle), or null when none covers that point.
export function topOfLeaves(pos, first, x, z) {
  let top = null;
  for (let k = first; k + 8 < pos.length; k += 9) {
    const ax = pos[k] - x;
    const az = pos[k + 2] - z;
    const bx = pos[k + 3] - x;
    const bz = pos[k + 5] - z;
    const cx = pos[k + 6] - x;
    const cz = pos[k + 8] - z;
    // Barycentric weights of the origin in the triangle's XZ projection.
    const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(d) < 1e-9) continue;
    const wb = ((0 - ax) * (cz - az) - (cx - ax) * (0 - az)) / d;
    const wc = ((bx - ax) * (0 - az) - (0 - ax) * (bz - az)) / d;
    const wa = 1 - wb - wc;
    if (wa < 0 || wb < 0 || wc < 0) continue;
    const y = wa * pos[k + 1] + wb * pos[k + 4] + wc * pos[k + 7];
    if (top === null || y > top) top = y;
  }
  return top;
}

// Top of the bark inside the canopy: just under the crown, where the climb ends.
function innerTrunkTop(tree) {
  return Math.max(tree.trunkTop, tree.top - 40);
}

// Tapered trunk: rings of TRUNK_SIDES corners from below the lowest ground around its foot
// up into the canopy, a little irregular, lit by the sun, dark at the foot (grass occlusion)
// and in the canopy's shade.
function addTrunk(builder, layout, tree, index) {
  const { x, z, ground, scale } = tree;
  const rng = makeRng(77 + index * 131);
  let foot = ground;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    foot = Math.min(foot, layout.groundHeight(x + Math.cos(a) * 60, z + Math.sin(a) * 60));
  }
  const upper = tree.base - ground - 60;
  // Above the canopy's underside the trunk carries on inside the leaves up to just under the
  // crown, so a climber seen through a faded canopy still hugs visible bark all the way up.
  const inner = innerTrunkTop(tree);
  const heights = [
    foot - 40 - ground, 0, 22, 60, 130, 230, (230 + upper) / 2, upper,
    tree.trunkTop - ground, (tree.trunkTop + inner) / 2 - ground, inner - ground,
  ];
  const jitter = Array.from({ length: TRUNK_SIDES }, () => 0.94 + 0.12 * rng());
  const twist = rng() * Math.PI * 2;
  const rings = heights.map((h, r) =>
    Array.from({ length: TRUNK_SIDES + 1 }, (_, k) => {
      const a = twist + ((k % TRUNK_SIDES) / TRUNK_SIDES) * Math.PI * 2 + r * 0.06;
      const rad = trunkRadius(h, scale) * jitter[k % TRUNK_SIDES];
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const y = ground + h;
      const sun = Math.max(0, nx * SUN_DIR.x + nz * SUN_DIR.z);
      let l = 0.52 + 0.62 * sun;
      l *= 0.6 + 0.4 * smoothstep(0, 90, h); // grass and roots at the foot
      l *= 1 - 0.5 * smoothstep(tree.base - 220, tree.base, y); // canopy shade
      return { x: x + nx * rad, y, z: z + nz * rad, nx, ny: 0, nz, u: (k / TRUNK_SIDES) * 2, v: h / 170, r: l, g: l * 0.96, b: l * 0.92 };
    }),
  );
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let k = 0; k < TRUNK_SIDES; k++) {
      // Counter-clockwise seen from outside: corners run from +x toward +z.
      const a = rings[r][k];
      const b = rings[r][k + 1];
      const c = rings[r + 1][k + 1];
      const d = rings[r + 1][k];
      builder.quad(a, d, c, b);
    }
  }
  // Cap the top (seen when the canopy around it fades out).
  const rim = rings[rings.length - 1];
  const mid = { ...rim[0], x, z, nx: 0, ny: 1, nz: 0, u: 0.5, v: 0 };
  for (let k = 0; k < TRUNK_SIDES; k++) builder.facingTri(mid, rim[k], rim[k + 1], [0, 1, 0]);
}
