// Wooden fences along layout.FENCES: square posts every ~220 units joined by two rails,
// following the ground and the moat's rim. All fence wood goes into the shared wood builder.
//
// Collision: every post interval gets a closed slab (two walls facing away from each other,
// SLAB_HALF from the centre line, and a flat top) and every post where the fence ends or
// bends a capped octagonal post. The bend posts matter: on the outer side of a bend the two
// slabs' faces do not meet, and CollisionWorld tests a wall's extent along one axis only, so
// without the post a hero could slip into the gap between them. The slab must be thick:
// SM64-style wall pushes act on points up to `radius` *behind* a wall too, so a paper-thin
// double wall would pull a fast hero through to the far side. With a 2 x 20 slab the far
// wall only engages once the hero's centre is 20 units from the centre line, i.e. after
// penetrating 50 units in one quarter step, which never happens. The tops matter as much: a
// hero coming down between the walls lands on the fence instead of inside it (where the
// walls, facing away from him, would not hold him).

import { makeRng } from '../../core/math.js';
import { floorPolygon, solidMound, wallQuad } from './geom.js';

export const POST_SPACING = 220;
export const FENCE_HEIGHT = 150; // post top above the ground
const POST_HALF = 12;
const POST_FOOT = 40; // posts reach this far below the ground
const CAP = 16; // pointed post top
const RAILS = [
  { y: 58, halfH: 9 },
  { y: 116, halfH: 9 },
];
const RAIL_HALF_W = 6;
const WOOD_U = 96; // world size of one wood texture repeat across the grain
const WOOD_V = 192; // ... and along the grain
export const SLAB_HALF = 20;
export const COLLIDER_TOP = 135; // just above the top rail: a hero standing on the fence
const COLLIDER_FOOT = 80;
const CORNER_RADIUS = 40;

export function buildFences(layout, kit) {
  const rng = makeRng(777);
  for (const posts of fenceRuns(layout)) {
    for (const p of posts) addPost(kit.wood, p, 0.9 + 0.15 * rng());
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      for (const rail of RAILS) addRail(kit.wood, a, b, rail, 0.92 + 0.12 * rng());
      addSlab(kit.colliders.wood, a, b);
    }
    posts.forEach((p, i) => {
      if (!p.corner && !bends(posts[i - 1], p, posts[i + 1])) return;
      const top = p.y + COLLIDER_TOP;
      solidMound(kit.colliders.wood, p.x, p.z, p.y - COLLIDER_FOOT, top, top, CORNER_RADIUS);
    });
  }
}

// Whether the fence turns at post b (by more than about half a degree).
function bends(a, b, c) {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vz = c.z - b.z;
  return Math.abs(ux * vz - uz * vx) > 0.01 * Math.hypot(ux, uz) * Math.hypot(vx, vz);
}

// Posts of every layout fence: evenly spaced along the polyline (corners and ends are posts
// too), kept MOAT_CLEARANCE outside the moat's rim - the layout's diagonal runs cut across
// the moat's rounded corners, so posts there are pushed out and the fence follows the
// curve. Each post has the ground height and the horizontal direction of its rails.
export function fenceRuns(layout) {
  return layout.FENCES.map((fence) => {
    const posts = [];
    fence.points.forEach((p, i) => {
      const prev = fence.points[i - 1];
      if (prev) {
        const n = Math.max(1, Math.round(Math.hypot(p.x - prev.x, p.z - prev.z) / POST_SPACING));
        for (let k = 1; k < n; k++) {
          posts.push({ x: prev.x + ((p.x - prev.x) * k) / n, z: prev.z + ((p.z - prev.z) * k) / n, corner: false });
        }
      }
      posts.push({ x: p.x, z: p.z, corner: true });
    });
    for (const p of posts) {
      Object.assign(p, clearOfMoat(layout, p.x, p.z));
      p.y = layout.groundHeight(p.x, p.z);
    }
    // Rails run from neighbour to neighbour; corner posts end up bisecting the turn.
    posts.forEach((p, i) => {
      const a = posts[Math.max(0, i - 1)];
      const b = posts[Math.min(posts.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      p.dir = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    });
    return posts;
  });
}

const MOAT_CLEARANCE = 110;
function clearOfMoat(layout, x, z) {
  const sd = (px, pz) => layout.sdRoundRect(px, pz, layout.MOAT);
  for (let it = 0; it < 4; it++) {
    const d = sd(x, z);
    if (d >= MOAT_CLEARANCE) break;
    const gx = sd(x + 1, z) - sd(x - 1, z);
    const gz = sd(x, z + 1) - sd(x, z - 1);
    const g = Math.hypot(gx, gz) || 1;
    x += (gx / g) * (MOAT_CLEARANCE - d);
    z += (gz / g) * (MOAT_CLEARANCE - d);
  }
  return { x, z };
}

// Square post aligned with its rails, with a low pyramid cap.
function addPost(builder, p, shade) {
  const ax = p.dir.x * POST_HALF;
  const az = p.dir.z * POST_HALF;
  const sx = p.dir.z * POST_HALF; // side axis (perpendicular to the rails)
  const sz = -p.dir.x * POST_HALF;
  const y0 = p.y - POST_FOOT;
  const y1 = p.y + FENCE_HEIGHT - CAP;
  const corners = [
    [ax + sx, az + sz],
    [-ax + sx, -az + sz],
    [-ax - sx, -az - sz],
    [ax - sx, az - sz],
  ];
  const col = { r: shade, g: shade, b: shade };
  const faceU = (2 * POST_HALF) / WOOD_U;
  const v = (x, z, y, u) => ({ x: p.x + x, y, z: p.z + z, u, v: y / WOOD_V, ...col });
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    const out = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
    const u0 = i * faceU;
    builder.facingQuad(v(x0, z0, y0, u0), v(x1, z1, y0, u0 + faceU), v(x1, z1, y1, u0 + faceU), v(x0, z0, y1, u0), out);
    const apex = v(0, 0, y1 + CAP, u0 + faceU / 2);
    builder.facingTri(v(x0, z0, y1, u0), v(x1, z1, y1, u0 + faceU), apex, [out[0], POST_HALF, out[2]]);
  }
}

// Rail between two posts: a 4-sided beam whose ends sit inside the posts, sheared to follow
// the ground heights at both posts.
function addRail(builder, a, b, rail, shade) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const sx = (dz / len) * RAIL_HALF_W;
  const sz = (-dx / len) * RAIL_HALF_W;
  const col = { r: shade, g: shade, b: shade };
  const ya = a.y + rail.y;
  const yb = b.y + rail.y;
  const h = rail.halfH;
  const vA = 0;
  const vB = len / WOOD_V;
  const at = (p, y, side, up, v) => ({ x: p.x + sx * side, y: y + h * up, z: p.z + sz * side, u: 0, v, ...col });
  // Cross-section corners [side, up], going around the beam; texture u runs around it too.
  const ring = [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  for (let i = 0; i < 4; i++) {
    const [side0, up0] = ring[i];
    const [side1, up1] = ring[(i + 1) % 4];
    const out = [(sx * (side0 + side1)) / 2, (up0 + up1) / 2, (sz * (side0 + side1)) / 2];
    const faceWidth = i % 2 ? 2 * RAIL_HALF_W : 2 * h; // sides are tall, top/bottom narrow
    const p0 = at(a, ya, side0, up0, vA);
    const p1 = at(a, ya, side1, up1, vA);
    const p2 = at(b, yb, side1, up1, vB);
    const p3 = at(b, yb, side0, up0, vB);
    p1.u = p2.u = faceWidth / WOOD_U;
    builder.facingQuad(p0, p1, p2, p3, out);
  }
}

// Collider slab between two posts: one wall on each side of the centre line and a flat top.
function addSlab(out, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const nx = (dz / len) * SLAB_HALF; // wallQuad(A -> B) faces (dz, -dx)
  const nz = (-dx / len) * SLAB_HALF;
  const a0 = a.y - COLLIDER_FOOT;
  const a1 = a.y + COLLIDER_TOP;
  const b0 = b.y - COLLIDER_FOOT;
  const b1 = b.y + COLLIDER_TOP;
  wallQuad(out, a.x + nx, a.z + nz, b.x + nx, b.z + nz, a0, a1, b0, b1);
  wallQuad(out, b.x - nx, b.z - nz, a.x - nx, a.z - nz, b0, b1, a0, a1);
  floorPolygon(out, [
    [a.x + nx, a1, a.z + nz],
    [b.x + nx, b1, b.z + nz],
    [b.x - nx, b1, b.z - nz],
    [a.x - nx, a1, a.z - nz],
  ]);
}
