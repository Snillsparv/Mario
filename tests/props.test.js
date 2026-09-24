// Props + sky in node: trunks, fences, boulders, bushes and the signpost block the hero
// (quarter-step walks with the same wall probes the player uses), solid props are closed on
// top (a hero lands on them, never inside), stepping stones are walked over, every tree is a
// climbable pole, decoration sits on open lawn, billboards face the camera, and the
// draw-call budget holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as layout from '../src/world/layout.js';
import { buildProps } from '../src/world/props.js';
import { buildSky, SKY_HORIZON_COLOR } from '../src/world/sky.js';
import { CollisionWorld } from '../src/collision/CollisionWorld.js';
import { COLLIDER_TOP, SLAB_HALF, fenceRuns } from '../src/world/props/fences.js';
import { BUSHES, FLOWER_PATCHES, ROCKS, SIGNPOST, SIGN_BOX } from '../src/world/props/decor.js';
import { POLE_HEIGHT, POLE_RADIUS, TRUNK_RADIUS } from '../src/world/props/trees.js';
import { FADE_SNAP, OCCLUDER_ALPHA, heroLocator } from '../src/world/props/billboards.js';
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

test('every tree is a climbable pole from the ground up', () => {
  assert.equal(part.poles.length, L.TREES.length);
  for (const t of L.TREES) {
    const p = part.poles.find((q) => q.x === t.x && q.z === t.z);
    assert.ok(p, `pole at tree ${t.x},${t.z}`);
    assert.ok(Math.abs(p.y0 - L.groundHeight(t.x, t.z)) < 1, 'pole starts on the ground');
    const len = p.y1 - p.y0;
    assert.ok(len > POLE_HEIGHT * 0.85 && len < POLE_HEIGHT * 1.15, `pole length ${len}`);
    assert.equal(p.radius, POLE_RADIUS);
  }
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

test('the signpost is a solid box you can stand on', () => {
  const ground = L.groundHeight(SIGNPOST.x, SIGNPOST.z);
  assert.ok(Math.abs(landingHeight(SIGNPOST.x, SIGNPOST.z) - (ground + SIGN_BOX.top)) < 1, 'sign top');
  const face = Math.atan2(L.SPAWN.x - SIGNPOST.x, L.SPAWN.z - SIGNPOST.z);
  const c = { x: SIGNPOST.x + Math.sin(face) * SIGN_BOX.centreZ, z: SIGNPOST.z + Math.cos(face) * SIGN_BOX.centreZ };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const end = walk({ x: c.x + Math.cos(a) * 400, z: c.z + Math.sin(a) * 400 }, c, 8);
    // Distance outside the box, in the sign's frame (soft corners allowed for).
    const dx = end.x - c.x;
    const dz = end.z - c.z;
    const lx = dx * Math.cos(face) - dz * Math.sin(face);
    const lz = dx * Math.sin(face) + dz * Math.cos(face);
    const out = Math.max(Math.abs(lx) - SIGN_BOX.halfWidth, Math.abs(lz) - SIGN_BOX.halfDepth);
    assert.ok(out > 30 && end.inside < 1, `signpost from ${k}: ${out.toFixed(1)} outside`);
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
  clear(SIGNPOST.x, SIGNPOST.z, 45, 'signpost');
});

test('billboards turn to face the camera', () => {
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
    for (const name of ['foliage', 'flowers']) {
      const p = part.object3D.getObjectByName(name).geometry.attributes.position;
      const a = new THREE.Vector3().fromBufferAttribute(p, 0);
      const b = new THREE.Vector3().fromBufferAttribute(p, 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, 3);
      const n = b.sub(a).cross(c.sub(a)).normalize(); // quad front
      const facing = -(n.x * fwd.x + n.z * fwd.z) / Math.hypot(fwd.x, fwd.z);
      assert.ok(facing > 0.999 && Math.abs(n.y) < 1e-6, `${name} faces the camera (${facing})`);
    }
  }
});

// Foliage screen-door fade (playtest: a canopy the trailing camera passed behind filled the
// screen and hid the hero). Camera poses are the in-game ones: the view is aimed a little
// above the hero, 1250-1450 units behind him.
function foliageFades(camPos, aimAt, focus) {
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  camera.position.set(...camPos);
  camera.lookAt(...aimAt);
  camera.updateMatrixWorld();
  if (focus !== undefined) camera.userData.focus = focus && { x: focus[0], y: focus[1] + LOOK_HEIGHT, z: focus[2] };
  part.update(1, camera);
  const a = part.object3D.getObjectByName('foliage').geometry.attributes.spriteFade.array;
  return (i) => {
    assert.ok(a[i * 4] === a[i * 4 + 1] && a[i * 4] === a[i * 4 + 3], 'one fade per sprite');
    return a[i * 4];
  };
}
const treeIndex = (x, z) => L.TREES.findIndex((t) => t.x === x && t.z === z);

test('foliage between the camera and the hero thins out to a screen door', () => {
  const tree = treeIndex(-2600, 5200);
  const hero = [-2480, L.groundHeight(-2480, 4502), 4502];
  // With the camera's published focus and with the props' own estimate of where he is.
  for (const focus of [hero, undefined]) {
    for (const camZ of [6007, 5815]) {
      const fade = foliageFades([-2480, 450, camZ], [-2480, 437, 4502], focus);
      assert.ok(fade(tree) <= OCCLUDER_ALPHA + 0.01, `canopy in front of the hero (cam z ${camZ}): ${fade(tree)}`);
    }
  }
  // Nothing to keep in view (first person): only the near fade applies, and a tree ~800
  // ahead is solid.
  assert.equal(foliageFades([-2480, 450, 6007], [-2480, 437, 4502], null)(tree), 1);
  // A bush hiding his legs fades; one in the foreground below his feet does not.
  const bush = L.TREES.length + BUSHES.findIndex((b) => b.x === -1200 && b.z === 3900);
  const behindBush = [-1200, L.groundHeight(-1200, 3620), 3620];
  assert.ok(foliageFades([-1200, 430, 4870], [-1200, 417, 3620], behindBush)(bush) <= OCCLUDER_ALPHA + 0.01);
  assert.equal(foliageFades([-1200, 432, 4488], [-1200, 419, 3250], [-1200, L.groundHeight(-1200, 3250), 3250])(bush), 1);
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
  const { dist, pitch } = ORBIT_MODES.lakitu;
  camera.position.set(0, LOOK_HEIGHT + dist[0] * Math.tan(pitch[0]), dist[0]);
  camera.updateMatrixWorld();
  assert.equal(locate(camera, 0, -1, hero), true);
  assert.ok(Math.abs(hero.z) < 2 && hero.x === 0 && hero.y === 0, `estimate ${hero.x}, ${hero.y}, ${hero.z}`);
});

test('foliage beside or behind the hero stays solid, foliage at the lens is gone', () => {
  const tree = treeIndex(-2600, 5200);
  // Running north past the tree: once he is in front of it, it stays solid (also with the
  // estimate, on the lawn that slopes away from the camera here).
  for (const focus of [[-2600, L.groundHeight(-2600, 5526), 5526], undefined]) {
    assert.equal(foliageFades([-2600, 499, 6817], [-2600, 485, 5526], focus)(tree), 1);
  }
  // Hero just beside the canopy: not hidden, not faded.
  const beside = foliageFades([-1981, 450, 5622], [-2600, 437, 4550], [-2600, L.groundHeight(-2600, 4550), 4550]);
  assert.ok(beside(tree) > 0.9, `tree beside the hero: ${beside(tree)}`);
  // Camera 150 in front of the tree's plane: fully faded.
  assert.equal(foliageFades([-2600, 450, 5350], [-2600, 437, 4000], null)(tree), 0);
});

// Playtest: behind the castle, a camera ~400 from the tree at (2900, -6200) left its canopy
// at fade 0.037, i.e. 1 pixel in 16: a sparse, perfectly regular dot grid over the sky and
// the cliff that read as a screen overlay. Fades now skip the lowest and highest levels.
test('foliage fades never leave a sparse dot grid: only 4/16 .. 12/16 dither levels show', () => {
  const tree = treeIndex(2900, -6200);
  const heroAt = (x, z) => [x, L.groundHeight(x, z), z];
  const near = foliageFades([3238, 498, -6000], [2000, L.groundHeight(2000, -6000) + 137, -6000], heroAt(2000, -6000));
  assert.equal(near(tree), 0, 'canopy right at the lens is gone, not a 1-in-16 dot grid');
  // Sweep the trailing camera past trees and bushes all over the grounds: every sprite is
  // gone, solid, or in the band of dense, even screen doors.
  const n = L.TREES.length + BUSHES.length;
  let partial = 0;
  for (const t of [...L.TREES, ...BUSHES]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (const d of [150, 300, 450, 600, 900]) {
        const cam = [t.x + Math.cos(a) * d, L.groundHeight(t.x, t.z) + 300, t.z + Math.sin(a) * d];
        const hero = heroAt(cam[0] - Math.cos(a) * 1250, cam[2] - Math.sin(a) * 1250);
        const fade = foliageFades(cam, [hero[0], hero[1] + 137, hero[2]], hero);
        for (let i = 0; i < n; i++) {
          const f = fade(i);
          if (f > 0 && f < 1) partial++;
          assert.ok(f === 0 || f === 1 || (f >= FADE_SNAP[0] && f <= FADE_SNAP[1]), `sprite ${i}: fade ${f}`);
        }
      }
    }
  }
  assert.ok(partial > 0, 'some sprites are part faded');
  // The shader keeps a fragment when fade * 16 > Bayer + 0.5: 4 and 12 of 16 at the ends.
  const kept = (f) => [...Array(16).keys()].filter((b) => f * 16 > b + 0.5).length;
  assert.equal(kept(FADE_SNAP[0]), 4);
  assert.equal(kept(FADE_SNAP[1]), 12);
  assert.equal(kept(OCCLUDER_ALPHA) >= 4 && kept(OCCLUDER_ALPHA) <= 12, true);
});

test('the foliage material patch finds its anchors in the three.js shaders', () => {
  const mat = part.object3D.getObjectByName('foliage').material;
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  mat.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vSpriteFade = spriteFade;/);
  assert.match(shader.fragmentShader, /if \(vSpriteFade \* 16\.0 <= BAYER4/);
  assert.ok(!part.object3D.getObjectByName('flowers').geometry.attributes.spriteFade, 'flowers never fade');
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

test('draw calls: props + sky stay within 10 meshes', () => {
  const sky = buildSky(L);
  let meshes = 0;
  for (const root of [part.object3D, sky.object3D]) root.traverse((o) => o.isMesh && meshes++);
  assert.ok(meshes <= 10, `${meshes} meshes`);
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
