// Props + sky in node: trunks, fences, boulders, bushes and the signposts block the hero
// (quarter-step walks with the same wall probes the player uses), solid props are closed on
// top (a hero lands on them, never inside), stepping stones are walked over, every tree is a
// climbable pole as thick as its 3D trunk, the trees and bushes are static closed 3D meshes
// that fade (screen door) exactly when they hide the hero or the camera is inside them,
// decoration and signs sit on open lawn, flower billboards face the camera, and the
// draw-call budget holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as layout from '../src/world/layout.js';
import { buildProps } from '../src/world/props.js';
import { buildSky, SKY_HORIZON_COLOR } from '../src/world/sky.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { COLLIDER_TOP, SLAB_HALF, fenceRuns } from '../src/world/props/fences.js';
import { BUSHES, FLOWER_PATCHES, ROCKS, SIGN_BOX } from '../src/world/props/decor.js';
import { POLE_RADIUS, TRUNK_RADIUS, treeShapes, trunkRadius } from '../src/world/props/trees.js';
import { FADE_SNAP, FADE_TIME, NEAR_FADE, OCCLUDER_ALPHA, heroLocator } from '../src/world/props/foliageFade.js';
import { LOOK_HEIGHT, ORBIT_MODES } from '../src/camera/cameraConfig.js';

const L = layout;
const part = buildProps(L);
const world = new CollisionWorld();
for (const c of part.colliders) world.addCollider(c);
world.finalize();

const RADIUS = 50; // hero collision radius

const STEP_UP = 78; // the ground step snaps the feet up onto floors this close above them

// Walks the hero's feet from `from` to `to` in steps of `step` units, resolving walls like
// the player's ground quarter step (probes at +30 / r 24 and +60 / r 50) and following the
// terrain or props floors within step-up reach. Also returns how far the feet ever got
// below the props' top surface at the hero's position (> 0: inside a prop).
function walk(from, to, step) {
  let { x, z } = from;
  let y = L.groundHeight(x, z);
  let inside = 0;
  const n = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / step);
  for (let i = 0; i < n; i++) {
    x += (to.x - from.x) / n;
    z += (to.z - from.z) / n;
    let w = world.findWalls(x, y, z, 30, 24);
    w = world.findWalls(w.x, y, w.z, 60, RADIUS);
    x = w.x;
    z = w.z;
    y = Math.max(L.groundHeight(x, z), world.findFloor(x, y, z, STEP_UP).y);
    const top = world.findFloor(x, 1e5, z, 0);
    if (top.surface) inside = Math.max(inside, top.y - y);
  }
  return { x, y, z, inside };
}

// Height of the first props floor under (x, z) when dropping from high above, or null.
function landingHeight(x, z) {
  const f = world.findFloor(x, 1e5, z, 0);
  return f.surface ? f.y : null;
}

const TREES = treeShapes(L);
const leaves = part.object3D.getObjectByName('leaves');
const bark = part.object3D.getObjectByName('bark');
const fade = leaves.material.userData.foliageFade;
const ray = new THREE.Raycaster();
// First leaves (or `mesh`) hit from `from` toward `to` (arrays or {x,y,z}), within `far`.
function firstHit(from, to, mesh = leaves, far = Infinity) {
  const o = Array.isArray(from) ? new THREE.Vector3(...from) : new THREE.Vector3(from.x, from.y, from.z);
  const t = Array.isArray(to) ? new THREE.Vector3(...to) : new THREE.Vector3(to.x, to.y, to.z);
  const d = t.clone().sub(o);
  ray.set(o, d.clone().normalize());
  ray.far = Math.min(far, d.length());
  return ray.intersectObject(mesh, false)[0] ?? null;
}
// Fade group of a hit on the leaves.
const groupOf = (hit) => hit && leaves.geometry.attributes.fadeGroup.getX(hit.face.a);
const groupIndex = (name) => fade.groups.findIndex((g) => g.name === name);
// The leaves of each fade group on their own (cheaper to raycast than the whole mesh).
const groupLeaves = (() => {
  const pos = leaves.geometry.attributes.position.array;
  const grp = leaves.geometry.attributes.fadeGroup.array;
  const lists = fade.groups.map(() => []);
  for (let v = 0; v < grp.length; v += 3) lists[grp[v]].push(...pos.subarray(v * 3, v * 3 + 9));
  return lists.map((l) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(l, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  });
})();

test('every tree is a climbable pole as thick as its trunk, running up through the leaves to the crown', () => {
  assert.equal(part.poles.length, L.TREES.length);
  assert.equal(part.trees.length, L.TREES.length);
  TREES.forEach((t, i) => {
    const p = part.poles.find((q) => q.x === t.x && q.z === t.z);
    assert.ok(p, `pole at tree ${t.x},${t.z}`);
    assert.ok(Math.abs(p.y0 - L.groundHeight(t.x, t.z)) < 1, 'pole starts on the ground');
    assert.equal(p.radius, POLE_RADIUS);
    const len = p.y1 - p.y0;
    // A long climb: past the canopy's underside (~450..550 up) and on through the leaves.
    assert.ok(len > 800 && len < 1150, `tree ${i}: pole length ${len.toFixed(0)}`);
    // The pole is as thick as the bark where his hands go (between the foot's flare and the
    // top of the visible trunk, inside the canopy).
    for (let h = 80; h < t.trunkTop - t.ground; h += 40) {
      const r = trunkRadius(h, t.scale);
      assert.ok(Math.abs(r - POLE_RADIUS) < 5, `tree ${i}: trunk radius ${r.toFixed(1)} at ${h}`);
    }
    // The pole tops out on the crown: the leaves' top right over the trunk (where his hands
    // go for a handstand on top), within a unit.
    const top = firstHit([t.x, p.y1 + 3000, t.z], [t.x, p.y0, t.z]);
    assert.ok(top && groupOf(top) === groupIndex(`tree:${i}`), `tree ${i}: no canopy over the trunk`);
    assert.ok(Math.abs(top.point.y - p.y1) <= 1, `tree ${i}: crown at ${top.point.y.toFixed(1)}, pole top ${p.y1}`);
    // ... and that is the top of the canopy near the trunk: no leaves stand much higher
    // around where he climbs out (70 out from the axis).
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hit = firstHit([t.x + Math.cos(a) * 70, p.y1 + 3000, t.z + Math.sin(a) * 70], [t.x + Math.cos(a) * 70, p.y0, t.z + Math.sin(a) * 70]);
      assert.ok(hit && hit.point.y < p.y1 + 40, `tree ${i} dir ${k}: leaves ${(hit?.point.y - p.y1).toFixed(0)} over the crown`);
    }
    // Exported for the objects (fires): trunk and canopy sphere.
    const e = part.trees[i];
    assert.equal(e.x, t.x);
    assert.equal(e.z, t.z);
    assert.equal(e.groundY, t.ground);
    assert.ok(e.trunkTop > t.base && e.trunkTop < p.y1);
    assert.ok(Math.hypot(e.canopy.x - t.x, e.canopy.z - t.z) < 50);
    assert.ok(e.canopy.y > t.base && e.canopy.y < p.y1 && e.canopy.radius > 250 && e.canopy.radius < 450);
  });
});

test('trees and bushes are static 3D meshes, closed and leafy from every side', () => {
  const camera = new THREE.PerspectiveCamera();
  const snap = () => [leaves, bark].map((m) => m.geometry.attributes.position.array.slice());
  camera.position.set(0, 800, 6000);
  camera.lookAt(0, 400, 0);
  camera.updateMatrixWorld();
  part.update(1, camera);
  const before = snap();
  camera.position.set(-5000, 600, 2000);
  camera.lookAt(3000, 500, -3000);
  camera.updateMatrixWorld();
  part.update(2, camera);
  assert.deepEqual(snap(), before, 'nothing turns to face the camera');
  // Rays at every canopy and bush from all round, above and below hit its own leaves.
  const dirs = [];
  for (let el = -2; el <= 2; el++) {
    for (let k = 0; k < (Math.abs(el) === 2 ? 1 : 8); k++) {
      const e = (el * Math.PI) / 4.2;
      const a = (k / 8) * Math.PI * 2;
      dirs.push([Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]);
    }
  }
  fade.groups.forEach((g, i) => {
    if (g.kind !== 'canopy') return;
    const bush = g.name.startsWith('bush');
    for (const [dx, dy, dz] of dirs) {
      if (bush && dy < -0.1) continue; // a bush sits on the ground
      const from = [g.x + dx * 2000, g.y + dy * 2000, g.z + dz * 2000];
      assert.ok(firstHit(from, [g.x, g.y, g.z], groupLeaves[i]), `${g.name}: no leaves seen from ${dx.toFixed(1)},${dy.toFixed(1)},${dz.toFixed(1)}`);
    }
  });
  // Trunks: the bark is seen from all round below the canopy.
  TREES.forEach((t, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const y = t.ground + 150;
      const hit = firstHit([t.x + Math.cos(a) * 800, y, t.z + Math.sin(a) * 800], [t.x, y, t.z], bark);
      assert.ok(hit && Math.abs(hit.distance - (800 - trunkRadius(150, t.scale))) < 8, `trunk ${i} from ${k}`);
    }
  });
});

test('tree trunks block walking from every direction', () => {
  // Convex corners of wall-only prisms are slightly soft (the wall inside-test ignores the
  // radius; the player also pushes itself out of poles), so allow some overlap there.
  const minDist = TRUNK_RADIUS + 30;
  for (const t of L.TREES) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const from = { x: t.x + Math.cos(a) * 300, z: t.z + Math.sin(a) * 300 };
      const end = walk(from, t, 8);
      const d = Math.hypot(end.x - t.x, end.z - t.z);
      assert.ok(d > minDist, `tree ${t.x},${t.z} from ${k}: reached ${d.toFixed(1)}`);
    }
  }
});

test('fences block from both sides, even at speed', () => {
  for (const posts of fenceRuns(L)) {
    for (const p of posts) assert.equal(L.regionAt(p.x, p.z), 'lawn', `fence post ${p.x},${p.z} on the lawn`);
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = (b.z - a.z) / len;
      const nz = -(b.x - a.x) / len;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      for (const side of [1, -1]) {
        const from = { x: mid.x + side * nx * 250, z: mid.z + side * nz * 250 };
        const to = { x: mid.x - side * nx * 250, z: mid.z - side * nz * 250 };
        if (L.regionAt(from.x, from.z) !== 'lawn') continue; // the moat side (terrain walls)
        for (const step of [8, 30]) {
          const end = walk(from, to, step);
          const off = (end.x - mid.x) * nx + (end.z - mid.z) * nz;
          assert.ok(off * side > SLAB_HALF + RADIUS - 2, `fence interval ${i} side ${side} step ${step}: ${off.toFixed(1)}`);
        }
      }
    }
    // The open ends can't be walked through along the fence line either.
    for (const [end, inner] of [
      [posts[0], posts[1]],
      [posts[posts.length - 1], posts[posts.length - 2]],
    ]) {
      const dx = end.x - inner.x;
      const dz = end.z - inner.z;
      const l = Math.hypot(dx, dz);
      const from = { x: end.x + (dx / l) * 300, z: end.z + (dz / l) * 300 };
      const stop = walk(from, inner, 8);
      assert.ok(Math.hypot(stop.x - end.x, stop.z - end.z) > RADIUS, 'fence end post is solid');
    }
  }
});

test('fences are closed on top: coming down on one lands on it', () => {
  for (const posts of fenceRuns(L)) {
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = (b.z - a.z) / len;
      const nz = -(b.x - a.x) / len;
      for (const t of [0.1, 0.5, 0.9]) {
        for (const off of [-SLAB_HALF + 2, 0, SLAB_HALF - 2]) {
          const x = a.x + (b.x - a.x) * t + nx * off;
          const z = a.z + (b.z - a.z) * t + nz * off;
          const want = a.y + (b.y - a.y) * t + COLLIDER_TOP;
          const got = landingHeight(x, z);
          assert.ok(got !== null && Math.abs(got - want) < 1, `fence ${i} t ${t} off ${off}: top ${got} vs ${want}`);
        }
      }
    }
    for (const p of posts.filter((q) => q.corner)) {
      assert.ok(Math.abs(landingHeight(p.x, p.z) - (p.y + COLLIDER_TOP)) < 1, `corner post ${p.x},${p.z} capped`);
    }
  }
});

// Whether the walk from `from` to `to` passes clear of every rock and bush other than `to`.
function pathClear(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  return [...ROCKS, ...BUSHES].every((o) => {
    if (o === to) return true;
    const t = Math.max(0, Math.min(1, ((o.x - from.x) * dx + (o.z - from.z) * dz) / len2));
    return Math.hypot(from.x + dx * t - o.x, from.z + dz * t - o.z) > o.r + RADIUS + 20;
  });
}

// Whether `from` lies clear of every rock and bush other than `target`.
function startsClear(from, target) {
  return [...ROCKS, ...BUSHES].every((o) => o === target || Math.hypot(from.x - o.x, from.z - o.z) > o.r + RADIUS);
}

test('boulders and bushes block, stepping stones are walked over, nobody ends up inside', () => {
  for (const r of ROCKS) {
    const ground = L.groundHeight(r.x, r.z);
    const f = world.findFloor(r.x, ground + 2000, r.z);
    assert.ok(f.surface && f.y > ground + 0.3 * r.h, `rock top at ${r.x},${r.z}: ${f.y} vs ground ${ground}`);
    assert.equal(f.surface.terrain, 'stone');
  }
  for (const t of [...ROCKS, ...BUSHES]) {
    const stone = t.h < 60;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const from = { x: t.x + Math.cos(a) * (t.r + 300), z: t.z + Math.sin(a) * (t.r + 300) };
      if (L.groundHeight(from.x, from.z) < L.WATER_LEVEL) continue; // swims in from the pond
      if (!startsClear(from, t)) continue; // would start inside a neighbouring rock
      const end = walk(from, t, 8);
      assert.ok(end.inside < 1, `${t.x},${t.z} from ${k}: feet ${end.inside.toFixed(1)} inside the collider`);
      const d = Math.hypot(end.x - t.x, end.z - t.z);
      if (!stone && L.regionAt(t.x, t.z) === 'lawn') assert.ok(d > t.r * 0.5, `${t.x},${t.z} from ${k} blocks: ${d.toFixed(0)}`);
      if (stone && pathClear(from, t)) assert.ok(d < 10, `stepping stone ${t.x},${t.z} from ${k}: stopped ${d.toFixed(0)} short`);
    }
  }
});

test('boulder colliders hug the drawn rock: the hero neither sinks into it nor stops far off', () => {
  const rocks = part.object3D.getObjectByName('rocks');
  const ray = new THREE.Raycaster();
  for (const t of ROCKS.filter((r) => r.h > 60)) {
    const gaps = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const from = { x: t.x + Math.cos(a) * (t.r + 300), z: t.z + Math.sin(a) * (t.r + 300) };
      if (L.groundHeight(from.x, from.z) < L.WATER_LEVEL || !startsClear(from, t)) continue;
      const end = walk(from, t, 8);
      if (end.y > L.groundHeight(end.x, end.z) + 5) continue; // walked up onto it
      // Distance from the hero's centre to the drawn rock ahead, at knee height.
      const dx = t.x - end.x;
      const dz = t.z - end.z;
      const d = Math.hypot(dx, dz);
      const back = 300;
      const dir = new THREE.Vector3(dx / d, 0, dz / d);
      ray.set(new THREE.Vector3(end.x - dir.x * back, end.y + 30, end.z - dir.z * back), dir);
      const hit = ray.intersectObject(rocks, false)[0];
      assert.ok(hit, `rock ${t.x},${t.z} from ${k}: no rock ahead`);
      gaps.push(hit.distance - back);
    }
    assert.ok(gaps.length >= 4, `rock ${t.x},${t.z}: only ${gaps.length} approaches`);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const closest = Math.min(...gaps);
    assert.ok(closest > 25, `rock ${t.x},${t.z}: the hero's centre gets ${closest.toFixed(0)} from the rock`);
    // (A rock set into the pond bank is walled at its wide underwater foot on the pond side,
    // which also pushes the corners toward the bank out a little.)
    if (L.regionAt(t.x, t.z) === 'lawn') {
      assert.ok(mean < 90, `rock ${t.x},${t.z}: the hero stops ${mean.toFixed(0)} from the rock on average`);
    }
  }
});

test('a signpost at every layout.SIGNS entry: a solid box you can stand on', () => {
  assert.ok(L.SIGNS.length >= 5);
  for (const sign of L.SIGNS) {
    const face = sign.yaw;
    const c = { x: sign.x + Math.sin(face) * SIGN_BOX.centreZ, z: sign.z + Math.cos(face) * SIGN_BOX.centreZ };
    const ground = L.groundHeight(sign.x, sign.z);
    assert.ok(Math.abs(landingHeight(c.x, c.z) - (ground + SIGN_BOX.top)) < 1, `${sign.id}: sign top`);
    assert.equal(world.findFloor(c.x, ground + 1000, c.z).surface?.terrain, 'wood', `${sign.id}: wooden top`);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const end = walk({ x: c.x + Math.cos(a) * 400, z: c.z + Math.sin(a) * 400 }, c, 8);
      // Distance outside the box, in the sign's frame (soft corners allowed for).
      const dx = end.x - c.x;
      const dz = end.z - c.z;
      const lx = dx * Math.cos(face) - dz * Math.sin(face);
      const lz = dx * Math.sin(face) + dz * Math.cos(face);
      const out = Math.max(Math.abs(lx) - SIGN_BOX.halfWidth, Math.abs(lz) - SIGN_BOX.halfDepth);
      assert.ok(out > 30 && end.inside < 1, `${sign.id} from ${k}: ${out.toFixed(1)} outside`);
    }
  }
});

test('every sign board faces its yaw and carries dark writing strokes on its front', () => {
  const wood = part.object3D.getObjectByName('wood');
  const col = wood.geometry.attributes.color;
  const pos = wood.geometry.attributes.position;
  for (const sign of L.SIGNS) {
    const fx = Math.sin(sign.yaw);
    const fz = Math.cos(sign.yaw);
    const y = L.groundHeight(sign.x, sign.z) + 125; // between the writing lines
    const hit = firstHit([sign.x + fx * 300, y, sign.z + fz * 300], [sign.x, y, sign.z], wood);
    assert.ok(hit, `${sign.id}: board seen from the front`);
    const n = hit.face.normal;
    assert.ok(n.x * fx + n.z * fz > 0.99, `${sign.id}: board front faces yaw`);
    assert.ok(Math.abs(hit.distance - 280) < 4, `${sign.id}: board front 20 in front of the post: ${hit.distance}`);
    // Writing: dark wood vertices floating just in front of the board.
    let ink = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - sign.x;
      const dz = pos.getZ(i) - sign.z;
      const front = dx * fx + dz * fz;
      if (Math.abs(dx * fz - dz * fx) < 85 && front > 20.5 && front < 23 && col.getX(i) < 0.3) ink++;
    }
    assert.ok(ink > 150, `${sign.id}: ${ink} ink vertices`);
  }
});

test('decoration sits on open lawn, clear of paths, trees, fences and the spawn', () => {
  const fencePts = fenceRuns(L).flat();
  const clear = (x, z, r, what) => {
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const d = k === 8 ? 0 : r;
      assert.ok(L.pathMask(x + Math.cos(a) * d, z + Math.sin(a) * d) < 0.05, `${what} at ${x},${z} is on a path`);
    }
    for (const t of L.TREES) assert.ok(Math.hypot(t.x - x, t.z - z) > r + 250, `${what} at ${x},${z} hits a tree`);
    for (const p of fencePts) assert.ok(Math.hypot(p.x - x, p.z - z) > r + 150, `${what} at ${x},${z} hits a fence`);
    assert.ok(Math.hypot(L.SPAWN.x - x, L.SPAWN.z - z) > r + 300, `${what} at ${x},${z} blocks the spawn`);
  };
  for (const r of ROCKS) {
    assert.ok(['lawn', 'water'].includes(L.regionAt(r.x, r.z)), `rock region at ${r.x},${r.z}`);
    if (L.regionAt(r.x, r.z) === 'water') assert.ok(L.groundHeight(r.x, r.z) > L.WATER_LEVEL - 150, 'rock in shallows');
    clear(r.x, r.z, r.r, 'rock');
  }
  for (const b of BUSHES) {
    assert.equal(L.regionAt(b.x, b.z), 'lawn');
    clear(b.x, b.z, b.r, 'bush');
  }
  for (const f of FLOWER_PATCHES) {
    assert.equal(L.regionAt(f.x, f.z), 'lawn');
    clear(f.x, f.z, f.radius, 'flowers');
  }
  // Signs: on open ground, not under a canopy, clear of rocks, bushes and flowers.
  for (const sign of L.SIGNS) {
    assert.ok(['lawn', 'island'].includes(L.regionAt(sign.x, sign.z)), `${sign.id} region`);
    clear(sign.x, sign.z, 90, `sign ${sign.id}`);
    for (const t of TREES) {
      assert.ok(Math.hypot(t.x - sign.x, t.z - sign.z) > t.reach + 90, `sign ${sign.id} under the tree at ${t.x},${t.z}`);
    }
    for (const o of [...ROCKS, ...BUSHES]) {
      assert.ok(Math.hypot(o.x - sign.x, o.z - sign.z) > o.r + 90 + 150, `sign ${sign.id} by the lump at ${o.x},${o.z}`);
    }
    for (const f of FLOWER_PATCHES) {
      assert.ok(Math.hypot(f.x - sign.x, f.z - sign.z) > f.radius + 90 + 60, `sign ${sign.id} in the flowers at ${f.x},${f.z}`);
    }
    for (const other of L.SIGNS) {
      if (other !== sign) assert.ok(Math.hypot(other.x - sign.x, other.z - sign.z) > 500, `signs ${sign.id} and ${other.id}`);
    }
  }
});

test('flower billboards turn to face the camera', () => {
  const camera = new THREE.PerspectiveCamera();
  for (const [pos, look] of [
    [
      [0, 800, 6000],
      [0, 400, 0],
    ],
    [
      [-5000, 600, 2000],
      [3000, 500, -3000],
    ],
  ]) {
    camera.position.set(...pos);
    camera.lookAt(...look);
    camera.updateMatrixWorld();
    part.update(1, camera);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const p = part.object3D.getObjectByName('flowers').geometry.attributes.position;
    const a = new THREE.Vector3().fromBufferAttribute(p, 0);
    const b = new THREE.Vector3().fromBufferAttribute(p, 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, 3);
    const n = b.sub(a).cross(c.sub(a)).normalize(); // quad front
    const facing = -(n.x * fwd.x + n.z * fwd.z) / Math.hypot(fwd.x, fwd.z);
    assert.ok(facing > 0.999 && Math.abs(n.y) < 1e-6, `flowers face the camera (${facing})`);
  }
});

// Foliage screen-door fade (playtest: a canopy the trailing camera passed behind filled the
// screen and hid the hero). `focus`: the hero's feet [x, y, z] (published as the camera's
// focus, LOOK_HEIGHT above them), null (no hero: first person) or undefined (no focus
// published: the props estimate where he is). `hold`: seconds of game time the view is held
// (long enough by default for any fade to play out).
let clock = 100;
function foliageFades(camPos, aimAt, focus, hold = 1) {
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  camera.position.set(...camPos);
  camera.lookAt(...aimAt);
  camera.updateMatrixWorld();
  if (focus !== undefined) camera.userData.focus = focus && { x: focus[0], y: focus[1] + LOOK_HEIGHT, z: focus[2] };
  clock += hold;
  part.update(clock, camera);
  return (name) => fade.fade(name);
}
const treeName = (x, z) => `tree:${L.TREES.findIndex((t) => t.x === x && t.z === z)}`;
const heroAt = (x, z) => [x, L.groundHeight(x, z), z];

// The fade's hidden test (ellipsoids) against the real leaves: trailing cameras at canopy
// height around every tree and bush, the hero on the far side. Where rays from the camera to
// most of his body pass through that canopy's leaves, it is a screen door; where no ray does,
// it stays solid. The fade tests smooth ellipsoids: sight lines grazing the lumpy underside
// (cameras above the canopy's middle looking down past it) may come out either way, so a few
// in a hundred such cases may disagree, never more.
test('a canopy or bush hides the hero exactly when its leaves cover him: then it thins out', () => {
  let hiddenCases = 0;
  let clearCases = 0;
  let grazing = 0;
  const missed = [];
  const false_ = [];
  fade.groups.forEach((g, gi) => {
    if (g.kind !== 'canopy') return;
    const bush = g.name.startsWith('bush');
    const ground = L.groundHeight(g.x, g.z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (const H of bush ? [230, 330] : [600, 700, 800]) {
        for (const side of [0, 120, 260]) {
          const D = bush ? 480 : 640;
          const back = bush ? 450 : 700;
          const hero = heroAt(g.x - dx * back - dz * side, g.z - dz * back + dx * side);
          if (L.regionAt(hero[0], hero[2]) === 'water' || L.regionAt(hero[0], hero[2]) === 'cliff') continue;
          const cam = [g.x + dx * D, ground + H, g.z + dz * D];
          const f = foliageFades(cam, [hero[0], hero[1] + 137, hero[2]], hero)(g.name);
          // Nine points on him: ankles to hat, and both sides of his middle.
          let hidden = 0;
          for (const [up, lat] of [[40, 0], [90, 0], [140, 0], [165, 0], [60, 40], [60, -40], [120, 40], [120, -40], [100, 0]]) {
            const p = [hero[0] - dz * lat, hero[1] + up, hero[2] + dx * lat];
            if (firstHit(cam, p, groupLeaves[gi])) hidden++;
          }
          const where = `${g.name} dir ${k} H ${H} side ${side}`;
          if (hidden >= 6) {
            hiddenCases++;
            if (f > OCCLUDER_ALPHA + 0.01) missed.push(`${where}: hides ${hidden}/9, fade ${f.toFixed(2)}`);
          } else if (hidden === 0) {
            clearCases++;
            if (f < 1) grazing++;
            if (f <= OCCLUDER_ALPHA + 0.1) false_.push(`${where}: hides nothing, fade ${f.toFixed(2)}`);
          }
        }
      }
    }
  });
  assert.ok(hiddenCases > 100 && clearCases > 300, `${hiddenCases} hidden, ${clearCases} clear cases`);
  assert.ok(missed.length <= hiddenCases * 0.02, `hidden but solid: ${missed.join('; ')}`);
  assert.ok(false_.length <= clearCases * 0.01, `clear but faded: ${false_.join('; ')}`);
  assert.ok(grazing <= clearCases * 0.02, `${grazing} of ${clearCases} clear cases thinned`);
});

// Climbing: the pole runs up through the leaves to the crown. While he climbs inside the
// canopy (and at the top of the climb, hat at the crown) the trailing camera's view of him
// passes through the leaves from any side and pitch, so the canopy must thin out around him;
// once he is up on top (a handstand on the crown) a camera above him sees him over it.
test('a hero climbing up through a canopy stays in view, all the way up to the crown', () => {
  const bad = [];
  let cases = 0;
  TREES.forEach((t, i) => {
    const pole = part.poles[i];
    const name = `tree:${i}`;
    for (const feet of [t.base - 60, (t.base + pole.y1 - 160) / 2, pole.y1 - 160]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.3;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        // He holds the trunk 70 out on the camera's side.
        const hero = [t.x + dx * 70, feet, t.z + dz * 70];
        for (const pitch of [ORBIT_MODES.follow.pitch[0], 0.45]) {
          const d = 1250;
          const cam = [hero[0] + dx * d, feet + LOOK_HEIGHT + d * Math.tan(pitch), hero[2] + dz * d];
          const f = foliageFades(cam, [hero[0], feet + LOOK_HEIGHT, hero[2]], hero)(name);
          cases++;
          if (f > OCCLUDER_ALPHA + 0.01) bad.push(`tree ${i} feet +${(feet - t.ground).toFixed(0)} dir ${k} pitch ${pitch.toFixed(2)}: fade ${f.toFixed(2)}`);
        }
      }
    }
    // Up on the crown (standing or on his hands there), seen from the trailing camera above:
    // the canopy below him stays solid.
    const top = [t.x, pole.y1, t.z];
    const cam = [t.x, pole.y1 + LOOK_HEIGHT + 1250 * Math.tan(0.3), t.z + 1250];
    const f = foliageFades(cam, [t.x, pole.y1 + LOOK_HEIGHT, t.z], top)(name);
    if (f !== 1) bad.push(`tree ${i} on top: fade ${f}`);
  });
  assert.ok(cases > 800, `${cases} cases`);
  assert.deepEqual(bad, []);
});

test('the fade also works from the props\' own estimate of where the hero is', () => {
  // A trailing camera 1250 behind him, lifted well above the default pitch (the default one
  // sees under the canopy), a tree in between.
  const tree = treeName(-2600, 5200);
  const hero = heroAt(-2600, 4500);
  const cam = [-2600, hero[1] + LOOK_HEIGHT + 1250 * Math.tan(ORBIT_MODES.follow.pitch[0]) + 500, 4500 + 1250];
  const look = [hero[0], hero[1] + LOOK_HEIGHT, hero[2]];
  const withFocus = foliageFades(cam, look, hero)(tree);
  const estimated = foliageFades(cam, look, undefined)(tree);
  assert.ok(withFocus <= OCCLUDER_ALPHA + 0.01, `with focus: ${withFocus}`);
  assert.ok(estimated <= OCCLUDER_ALPHA + 0.01, `estimated: ${estimated}`);
});

// The locator shares the camera's tuning (cameraConfig.js) rather than a private copy: the
// published focus is LOOK_HEIGHT above the hero's feet, and without one the default trailing
// camera's pitch and distance place him.
test('the hero locator uses the camera config: focus height, trailing pitch and distance', () => {
  const locate = heroLocator(() => 0); // flat ground at y = 0
  const camera = new THREE.PerspectiveCamera();
  const hero = { x: 0, y: 0, z: 0 };
  camera.position.set(0, 900, 3000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.userData.focus = { x: 12, y: 480, z: -34 };
  assert.equal(locate(camera, 0, -1, hero), true);
  assert.deepEqual(hero, { x: 12, y: 480 - LOOK_HEIGHT, z: -34 });
  camera.userData.focus = null;
  assert.equal(locate(camera, 0, -1, hero), false, 'no hero to keep in view');
  // No published focus: a camera where the default orbit puts it, `dist` behind the hero
  // and dist * tan(pitch) above his look point, finds him at his feet.
  delete camera.userData.focus;
  const { dist, pitch } = ORBIT_MODES.follow;
  camera.position.set(0, LOOK_HEIGHT + dist[0] * Math.tan(pitch[0]), dist[0]);
  camera.updateMatrixWorld();
  assert.equal(locate(camera, 0, -1, hero), true);
  assert.ok(Math.abs(hero.z) < 2 && hero.x === 0 && hero.y === 0, `estimate ${hero.x}, ${hero.y}, ${hero.z}`);
});

test('foliage beside or behind the hero stays solid; inside a canopy it is gone; from under it, leafy', () => {
  const i = L.TREES.findIndex((t) => t.x === -2600 && t.z === 5200);
  const tree = `tree:${i}`;
  const t = TREES[i];
  // Running north past the tree: once he is in front of it, it stays solid.
  for (const focus of [heroAt(-2600, 5526), undefined]) {
    assert.equal(foliageFades([-2600, 499, 6817], [-2600, 485, 5526], focus)(tree), 1);
  }
  // Hero just beside the canopy: not hidden, not faded.
  const beside = foliageFades([-1981, 450, 5622], [-2600, 437, 4550], heroAt(-2600, 4550));
  assert.equal(beside(tree), 1);
  // Camera inside the canopy: gone (canopy and nothing else).
  const inside = foliageFades([t.centre.x + 60, t.centre.y, t.centre.z], [-2600, 437, 4000], null);
  assert.equal(inside(tree), 0);
  assert.equal(inside(`trunk:${i}`), 1, 'the trunk below is not in the way');
  // First-person look up from beside the trunk (his eyes ~140 up, 95 from the axis, where
  // the trunk's collider stops him): the canopy's underside and the trunk are solid.
  const up = foliageFades([t.x + 95, t.ground + 140, t.z], [t.x, t.ground + 1500, t.z], null);
  assert.equal(up(tree), 1, 'canopy seen from under it');
  assert.equal(up(`trunk:${i}`), 1, 'trunk beside him');
  // A camera pressed against the bark: the trunk is gone.
  assert.equal(foliageFades([t.x + 45, t.ground + 200, t.z], [t.x - 1000, t.ground + 200, t.z], null)(`trunk:${i}`), 0);
});

// Playtest: behind the castle, a camera ~400 from the tree at (2900, -6200) left its canopy
// at fade 0.037, i.e. 1 pixel in 16: a sparse, perfectly regular dot grid over the sky and
// the cliff that read as a screen overlay. Fades now skip the lowest and highest levels.
test('foliage fades never leave a sparse dot grid: only 4/16 .. 12/16 dither levels show', () => {
  let partial = 0;
  for (const t of [...L.TREES, ...BUSHES]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (const d of [100, 200, 300, 450, 600, 900]) {
        for (const h of [150, 300, 500]) {
          const cam = [t.x + Math.cos(a) * d, L.groundHeight(t.x, t.z) + h, t.z + Math.sin(a) * d];
          const hero = heroAt(cam[0] - Math.cos(a) * 1250, cam[2] - Math.sin(a) * 1250);
          foliageFades(cam, [hero[0], hero[1] + 137, hero[2]], hero);
          fade.groups.forEach((g, i) => {
            const f = fade.fade(i);
            if (f > 0 && f < 1) partial++;
            assert.ok(f === 0 || f === 1 || (f >= FADE_SNAP[0] && f <= FADE_SNAP[1]), `${g.name}: fade ${f}`);
          });
        }
      }
    }
  }
  assert.ok(partial > 0, 'some groups are part faded');
  // The shader keeps a fragment when fade * 16 > Bayer + 0.5: 4 and 12 of 16 at the ends.
  const kept = (f) => [...Array(16).keys()].filter((b) => f * 16 > b + 0.5).length;
  assert.equal(kept(FADE_SNAP[0]), 4);
  assert.equal(kept(FADE_SNAP[1]), 12);
  assert.equal(kept(OCCLUDER_ALPHA) >= 4 && kept(OCCLUDER_ALPHA) <= 12, true);
});

// Review: the follow camera parked 30..50 units outside a canopy (not hiding the hero) left it
// half faded: a regular see-through dot grid over half the frame. The near fade is now all or
// nothing (with a little hysteresis) and only passes through the dither levels while it
// plays out (FADE_TIME).
test('a canopy or trunk beside the camera is never left half faded', () => {
  let gone = 0;
  let solid = 0;
  TREES.forEach((t, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.1;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (const [d, h] of [[-40, 0], [0, 0], [20, 0], [40, 0], [60, 0], [80, 0], [100, 0], [130, 0], [160, 0], [0, -120], [40, -150]]) {
        // Beside the canopy at its middle (h: lower), the hero out behind the camera.
        const r = t.reach + d;
        const cam = [t.centre.x + dx * r, t.centre.y + h, t.centre.z + dz * r];
        const hero = heroAt(t.x + dx * (r + 1250), t.z + dz * (r + 1250));
        for (const approach of [0, 1]) {
          // From far away and from inside the canopy (the hysteresis's two sides).
          if (approach) foliageFades([t.centre.x, t.centre.y, t.centre.z], [hero[0], hero[1] + 137, hero[2]], hero);
          else foliageFades([t.x + dx * 3000, t.centre.y, t.z + dz * 3000], [t.x, t.centre.y, t.z], hero);
          const f = foliageFades(cam, [t.x - dx * 1000, t.centre.y, t.z - dz * 1000], hero)(`tree:${i}`);
          assert.ok(f === 0 || f === 1, `tree ${i} dir ${k} ${d} out, ${h} up: fade ${f}`);
          if (f === 0) gone++;
          else solid++;
        }
      }
    }
  });
  assert.ok(gone > 100 && solid > 100, `${gone} gone, ${solid} solid`);
  // Trunks likewise, the camera closing in on the bark and backing off.
  const t = TREES[0];
  for (const d of [80, 60, 40, 30, 20, 10, 20, 30, 40, 50, 60]) {
    const f = foliageFades([t.x + trunkRadius(200, t.scale) + d, t.ground + 200, t.z], [t.x - 1000, t.ground + 150, t.z], null)('trunk:0');
    assert.ok(f === 0 || f === 1, `trunk at ${d}: ${f}`);
    if (d <= 20) assert.equal(f, 0, `trunk at ${d}`);
    if (d >= 50) assert.equal(f, 1, `trunk at ${d}`);
  }
});

test('near fades dissolve over FADE_TIME of game time, hold while it stands still, and have hysteresis', () => {
  const t = TREES[0];
  const tree = 'tree:0';
  const out = [t.x + 3000, t.centre.y, t.z];
  const look = [t.x, t.centre.y, t.z];
  // The point out along +x at distance d from the nearest blob's surface (as the fade
  // measures it: along the line to each ellipsoid's centre).
  const g = fade.groups[groupIndex(tree)];
  const dist = (x) =>
    Math.min(
      ...g.blobs.map((b) => {
        const v = [x - b.x, t.centre.y - b.y, t.centre.z - b.z];
        const q = Math.hypot(v[0] / b.rh, v[1] / b.ry, v[2] / b.rh);
        return Math.hypot(...v) * (1 - 1 / q);
      }),
    );
  const surface = (d) => {
    let lo = t.centre.x;
    let hi = t.centre.x + 2000;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (dist(mid) < d) lo = mid;
      else hi = mid;
    }
    return [lo, t.centre.y, t.centre.z];
  };
  assert.equal(foliageFades(out, look, null)(tree), 1);
  // Into the canopy, 30 ticks a second: gone within FADE_TIME (+ a tick), through the
  // coarse dither levels only.
  const seen = [];
  for (let k = 0; k < 10; k++) seen.push(foliageFades(surface(-60), look, null, 1 / 30)(tree));
  const ticks = Math.ceil(FADE_TIME * 30) + 1;
  assert.ok(seen[0] > 0 && seen.slice(ticks).every((f) => f === 0), `dissolve ${seen.map((f) => f.toFixed(2))}`);
  assert.ok(seen.every((f) => f === 0 || f === 1 || (f >= FADE_SNAP[0] && f <= FADE_SNAP[1])));
  // Render frames between ticks (no game time passes) hold the fade.
  foliageFades(out, look, null);
  const held = foliageFades(surface(-60), look, null, 0)(tree);
  assert.equal(held, 1, 'no time passed');
  // Hysteresis: gone within NEAR_FADE[0] of the surface; stays gone until beyond NEAR_FADE[1].
  foliageFades(surface(NEAR_FADE[0] - 25), look, null);
  assert.equal(fade.fade(tree), 0);
  assert.equal(foliageFades(surface((NEAR_FADE[0] + NEAR_FADE[1]) / 2), look, null)(tree), 0, 'still gone backing off');
  assert.equal(foliageFades(surface(NEAR_FADE[1] + 25), look, null)(tree), 1, 'back');
  assert.equal(foliageFades(surface((NEAR_FADE[0] + NEAR_FADE[1]) / 2), look, null)(tree), 1, 'still solid closing in');
});

test('the foliage material patch finds its anchors in the three.js shaders; both materials share the fades', () => {
  for (const mesh of [leaves, bark]) {
    const mat = mesh.material;
    const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
    mat.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute float fadeGroup;/);
    assert.match(shader.vertexShader, /vPropFade = c == 0 \? f4\.x/);
    assert.match(shader.fragmentShader, /if \(vPropFade \* 16\.0 <= BAYER4/);
    assert.equal(shader.uniforms.propFade.value, fade.fades, `${mesh.name}: shared fade array`);
    assert.ok(fade.fades.length >= fade.groups.length && fade.fades.length % 4 === 0);
    const groups = mesh.geometry.attributes.fadeGroup.array;
    assert.ok(groups.every((g) => g >= 0 && g < fade.groups.length && Number.isInteger(g)));
    // Review: per-face box UVs broke the leaves at every triangle edge. The leaves are mapped
    // tri-planar in world space (seamless across faces and blobs); the bark keeps its UVs.
    const tri = mesh === leaves;
    assert.equal(/texture2D\(map, vLeafPos\.zy\)/.test(shader.fragmentShader), tri, `${mesh.name}: tri-planar map`);
    assert.equal(shader.fragmentShader.includes('#include <map_fragment>'), !tri, `${mesh.name}: UV map`);
    assert.equal(!!mesh.geometry.attributes.normal, tri, `${mesh.name}: normals for the blend`);
  }
  // Leaf normals: unit length, and smooth (each blob's shared corners agree).
  const nrm = leaves.geometry.attributes.normal;
  const pos = leaves.geometry.attributes.position;
  const byCorner = new Map();
  for (let v = 0; v < nrm.count; v++) {
    const n = [nrm.getX(v), nrm.getY(v), nrm.getZ(v)];
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-3);
    const key = [pos.getX(v), pos.getY(v), pos.getZ(v)].map((c) => c.toFixed(2)).join();
    const seen = byCorner.get(key);
    if (seen) assert.ok(n[0] * seen[0] + n[1] * seen[1] + n[2] * seen[2] > 0.999, `normals split at ${key}`);
    else byCorner.set(key, n);
  }
  assert.ok(!part.object3D.getObjectByName('flowers').geometry.attributes.fadeGroup, 'flowers never fade');
  // Every canopy / bush / trunk group has geometry of its own kind.
  const used = new Set([...leaves.geometry.attributes.fadeGroup.array, ...bark.geometry.attributes.fadeGroup.array]);
  assert.equal(used.size, fade.groups.length);
});

test('waterfall splash only animates while it can be seen', () => {
  const splash = part.object3D.getObjectByName('waterfallSplash').geometry.attributes.position;
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  const WF = L.WATERFALL;
  camera.position.set(WF.x + 3000, 600, WF.z + 2500);
  camera.lookAt(WF.x, 300, WF.z);
  camera.updateMatrixWorld();
  part.update(2, camera);
  const seen = splash.array.slice();
  camera.lookAt(WF.x + 6000, 300, WF.z + 8000); // turned away
  camera.updateMatrixWorld();
  part.update(3, camera);
  assert.deepEqual(splash.array, seen, 'no update while out of view');
  camera.lookAt(WF.x, 300, WF.z);
  camera.updateMatrixWorld();
  part.update(3, camera);
  assert.notDeepEqual(splash.array, seen, 'animates again in view');
});

test('draw calls and triangles: props + sky stay within 10 meshes and 40k triangles', () => {
  const sky = buildSky(L);
  let meshes = 0;
  let tris = 0;
  for (const root of [part.object3D, sky.object3D]) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      if (o.name !== 'skyDome') tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
  }
  assert.ok(meshes <= 10, `${meshes} meshes`);
  assert.ok(tris < 40000, `${tris} props triangles`);
});

test('sky: behind everything, follows the camera, sets the scene background', () => {
  const sky = buildSky(L);
  assert.equal(typeof SKY_HORIZON_COLOR, 'number');
  const mesh = sky.object3D.getObjectByName('skyDome');
  assert.equal(mesh.renderOrder, -1);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.fog, false);
  const scene = new THREE.Scene();
  scene.add(sky.object3D);
  assert.equal(scene.background.getHex(), new THREE.Color(SKY_HORIZON_COLOR).getHex());
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1234, 567, -890);
  sky.update(10, camera);
  assert.deepEqual(sky.object3D.position.toArray(), [1234, 567, -890]);
  const r = mesh.geometry.boundingSphere?.radius ?? mesh.geometry.parameters.radius;
  assert.ok(r > 5000 && r < 40000, 'sky sphere inside the game camera far plane (~45000)');
});
