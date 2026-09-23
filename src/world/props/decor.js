// Lawn decoration: boulders, stepping stones and round bushes (bushes are billboards in the
// foliage batch; boulders and bushes get solid colliders you bump into and can hop onto,
// stepping stones are walked over), small flower patches
// (billboards, no collision) and a wooden signpost near the spawn. Positions are
// props-internal (not gameplay anchors) and all lie on open lawn away from the paths, trees
// and fences (tests/props.test.js checks this).

import * as THREE from 'three';
import { makeRng, smoothstep } from '../../core/math.js';
import { worldMaterial } from '../../render/materials.js';
import { BillboardBatch } from './billboards.js';
import { addSolid, cone, footprintRadii, lumpyDome, solidBox, solidMound } from './geom.js';
import { BUSH_CELL_HEIGHT, FLOWER_VARIANTS, FOLIAGE, ROCK_TILE, cellUV, flowerAtlas } from './textures.js';

// Boulders and bushes: radius r, height h. Boulders stand well clear of the ground around
// them (at least ~85 above its highest point) so they are real obstacles; the small ones
// (h 55) are stepping stones. Some sit on the pond's banks, one stands in the shallows.
export const ROCKS = [
  { x: -5600, z: -3950, r: 190, h: 185 },
  { x: -5380, z: -4080, r: 100, h: 55 },
  { x: -6500, z: 150, r: 170, h: 230 },
  { x: -4700, z: -300, r: 140, h: 150 },
  { x: -5400, z: -3280, r: 200, h: 300 }, // in the pond's shallows, breaking the surface
  { x: 3500, z: 6200, r: 210, h: 185 },
  { x: 3720, z: 6020, r: 100, h: 55 },
  { x: -1500, z: 6400, r: 150, h: 160 },
  { x: 6800, z: 800, r: 230, h: 190 },
  { x: 4700, z: -5600, r: 170, h: 130 },
];

export const BUSHES = [
  { x: -4200, z: 1900, r: 170, h: 190 },
  { x: -4020, z: 2120, r: 120, h: 140 },
  { x: 4300, z: 1800, r: 170, h: 190 },
  { x: -1200, z: 3900, r: 150, h: 170 },
  { x: 1500, z: 4700, r: 160, h: 180 },
  { x: 6600, z: 6200, r: 180, h: 200 },
  { x: -6600, z: 6000, r: 190, h: 210 },
];

// Flower patches: centre, radius, count, the variants that grow there.
export const FLOWER_PATCHES = [
  { x: -1600, z: 5600, radius: 260, count: 14, kinds: [0, 1] },
  { x: 1500, z: 5900, radius: 240, count: 12, kinds: [2, 1] },
  { x: -3000, z: 3000, radius: 300, count: 16, kinds: [3, 1, 0] },
  { x: 2400, z: 3300, radius: 260, count: 14, kinds: [0, 2] },
  { x: -2250, z: 1700, radius: 140, count: 9, kinds: [1, 3] },
  { x: 5200, z: 1200, radius: 260, count: 13, kinds: [2, 0] },
  { x: 6000, z: 5800, radius: 240, count: 12, kinds: [3, 2] },
  { x: -5600, z: 1600, radius: 280, count: 14, kinds: [0, 1, 2] },
];

// Signpost ahead and to the right of the spawn, its blank board turned toward the spawn.
export const SIGNPOST = { x: 430, z: 5150 };
// Its collider, in the sign's frame (local +z = the board's front): a box around post and
// board (local z -16..24, x across the board), flat on top at the board's top edge.
export const SIGN_BOX = { centreZ: 4, halfWidth: 88, halfDepth: 20, top: 191 };

const BOULDER_SIDES = 12;
const BOULDER_INSET = 15;
const BODY_PROBE = 60; // height of the hero's upper wall probe above his feet
// Bush sprite width per unit of bush radius: the painted bush fills ~84 % of the cell's
// width, so it ends up ~2 r wide.
const BUSH_SPRITE_W = 2.4;

// Lowest and highest ground on a circle around (x, z) (and at its centre).
function rimGround(layout, x, z, r) {
  let min = layout.groundHeight(x, z);
  let max = min;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const y = layout.groundHeight(x + Math.cos(a) * r, z + Math.sin(a) * r);
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max };
}

const placement = (x, y, z, rotY, sx, sy, sz) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  );

// One boulder into the rock builder, sunk a little into the ground (on slopes down to the
// low side, but never by more than about a third of its height), and its solid collider.
function addBoulder(kit, layout, { x, z, r, h, seed }, rng) {
  const ground = layout.groundHeight(x, z);
  const base = Math.max(rimGround(layout, x, z, r * 0.8).min, ground - 0.35 * h) - 0.12 * h;
  const geo = lumpyDome({ detail: 1, jitter: 0.22, flatBottom: 0.2, seed });
  const depth = 0.75 + 0.25 * rng();
  const m = placement(x, base, z, rng() * Math.PI * 2, r, h, r * depth);
  const tone = 0.9 + 0.15 * rng();
  const warm = rng() * 0.08;
  const colorFn = (px, py) => {
    const ao = 0.62 + 0.38 * smoothstep(base, base + h * 0.7, py);
    return [tone * ao * (1 + warm), tone * ao, tone * ao * (1 - warm)];
  };
  addSolid(kit.rock, geo, m, { tile: ROCK_TILE, colorFn });
  // Collider walls hug the drawn rock's widest reach where the hero's body meets it: from
  // the ground he walks up on from that side (on a bank, high above the rock's foot) up to
  // his upper wall probe; less a little, so his hands still touch the rock.
  const band = (a) => {
    const g = layout.groundHeight(x + Math.cos(a) * (r + HERO_REACH), z + Math.sin(a) * (r + HERO_REACH));
    return [g - 10, g + BODY_PROBE];
  };
  const fit = (phase) =>
    footprintRadii(geo, m, x, z, { sides: BOULDER_SIDES, phase, band }).map((q) => q - BOULDER_INSET);
  const top = base + h;
  moundCollider(kit.colliders.stone, layout, x, z, fit(0), top, ground + 0.55 * (top - ground));
}

// Collider for a round lump (rock, bush) of the given radius (or per-corner radii, see
// geom.js ring) and top height. The collider:
// - Stepping stone, when the top is within step-up reach of the ground all around it: a
//   floor-only cone from the ground up, walked straight over.
// - Otherwise walls up to a shoulder, then a low cone. The shoulder stands WALL_CLEAR above
//   the highest ground the hero can touch it from, so his upper wall probe (60 above his
//   feet) meets it from every side, even from uphill; it never rises past `top` - CAP_RISE,
//   so a rock flush with the ground uphill (one set into the pond bank) gets a nearly flat
//   cap he walks onto from there. Either way nobody ends up under the collider's top.
const HERO_REACH = 50; // the hero's wall probe radius
const WALL_CLEAR = 70;
const CAP_RISE = 15;
const STEP_UP = 70; // under the player's 78-unit floor snap
function moundCollider(out, layout, x, z, radius, top, minShoulder) {
  const reach = Array.isArray(radius) ? Math.max(...radius) : radius;
  const rim = rimGround(layout, x, z, reach + HERO_REACH);
  const edge = rimGround(layout, x, z, reach);
  if (top - Math.min(rim.min, edge.min) < STEP_UP) {
    cone(out, x, z, top, radius, 8, (px, pz) => layout.groundHeight(px, pz) - 2);
    return;
  }
  const shoulder = Math.min(top - CAP_RISE, Math.max(Math.max(rim.max, edge.max) + WALL_CLEAR, minShoulder));
  const foot = Math.min(rim.min, edge.min) - 80;
  solidMound(out, x, z, foot, shoulder, top, radius);
}

export function buildDecor(layout, kit) {
  const rng = makeRng(9001);

  ROCKS.forEach((r, i) => {
    addBoulder(kit, layout, { ...r, seed: 100 + i }, rng);
    if (layout.groundHeight(r.x, r.z) > layout.WATER_LEVEL) kit.shadow(r.x, r.z, r.r * 1.35, 0.7);
  });

  BUSHES.forEach((b, i) => {
    const ground = layout.groundHeight(b.x, b.z);
    const w = b.r * BUSH_SPRITE_W;
    const tint = 0.9 + 0.15 * rng();
    kit.foliage.push({
      x: b.x,
      y: ground - 20,
      z: b.z,
      w,
      h: w * BUSH_CELL_HEIGHT,
      uv: cellUV(FOLIAGE.bush[i % FOLIAGE.bush.length], BUSH_CELL_HEIGHT),
      tint: [tint, tint, tint * 0.95],
    });
    moundCollider(kit.colliders.grass, layout, b.x, b.z, b.r * 0.8, ground + b.h, ground + 0.5 * b.h);
    kit.shadow(b.x, b.z, b.r * 1.4, 0.85);
  });

  addSignpost(kit, layout);

  const sprites = [];
  for (const patch of FLOWER_PATCHES) {
    for (let i = 0; i < patch.count; i++) {
      const a = rng() * Math.PI * 2;
      const d = patch.radius * Math.sqrt(rng());
      const x = patch.x + Math.cos(a) * d;
      const z = patch.z + Math.sin(a) * d;
      const h = 46 + rng() * 18;
      const kind = patch.kinds[Math.floor(rng() * patch.kinds.length)] % FLOWER_VARIANTS;
      const t = 0.9 + 0.12 * rng();
      sprites.push({ x, y: layout.groundHeight(x, z) - 4, z, w: h, h, uv: cellUV(kind), tint: [t, t, t] });
    }
  }
  const flowers = new BillboardBatch('flowers', sprites, worldMaterial({ map: flowerAtlas(), alphaTest: 0.5 }));
  return { flowers: flowers.mesh, update: (camera) => flowers.update(camera) };
}

// Square post with a blank plank board, into the wood builder, and its SIGN_BOX collider.
function addSignpost(kit, layout) {
  const { x, z } = SIGNPOST;
  const ground = layout.groundHeight(x, z);
  const face = Math.atan2(layout.SPAWN.x - x, layout.SPAWN.z - z); // local +z looks at the spawn
  const frame = placement(x, ground, z, face, 1, 1, 1);
  // Box centred at local (cx, cy, cz); uv = face uv * scale, optionally swapped so the grain
  // (texture v) runs along the box's width.
  const box = (cx, cy, cz, hx, hy, hz, [su, sv], swap = false) => {
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2).toNonIndexed();
    geo.applyMatrix4(frame.clone().multiply(new THREE.Matrix4().makeTranslation(cx, cy, cz)));
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const vert = (i) => {
      const u = uv.getX(i) * su;
      const v = uv.getY(i) * sv;
      return { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), u: swap ? v : u, v: swap ? u : v };
    };
    for (let i = 0; i < pos.count; i += 3) kit.wood.tri(vert(i), vert(i + 1), vert(i + 2));
  };
  box(0, 72, 0, 13, 112, 13, [0.27, 1.17]); // post, from 40 below the ground to 184 above
  box(0, 145, 14, 85, 46, 6, [0.89, 0.96], true); // board with horizontal planks
  const { centreZ, halfWidth, halfDepth, top } = SIGN_BOX;
  const cx = x + Math.sin(face) * centreZ;
  const cz = z + Math.cos(face) * centreZ;
  solidBox(kit.colliders.wood, cx, cz, face, halfWidth, halfDepth, ground - 80, ground + top);
  kit.shadow(x, z, 110, 0.6);
}
