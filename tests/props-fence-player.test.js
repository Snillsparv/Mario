// The real Player against the composed level's collision at the fence posts where the fence
// bends (the diagonal runs around the moat's corners, and the layout corners): running into
// a post along +-x and +-z, with small sideways offsets, never gets the hero through the
// fence or inside it. (The open ends are left out: walking around them is allowed.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as L from '../src/world/layout.js';
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/Player.js';
import { ScriptedController } from '../src/player/physics/testCourse.js';
import { SLAB_HALF, fenceRuns } from '../src/world/props/fences.js';

// Signed distance from a fence polyline (positive on the side its segments' (dz, -dx)
// normals point to; at a post, the side of the two neighbouring normals' sum).
function signedDistance(posts, x, z) {
  let best = { d: Infinity, sign: 0 };
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i];
    const b = posts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d >= best.d - 1e-9) continue;
    let nx = ez;
    let nz = -ex;
    const c = t === 1 ? posts[i + 2] : t === 0 ? posts[i - 1] : null;
    if (c && t === 1) [nx, nz] = [nx + c.z - b.z, nz - (c.x - b.x)];
    if (c && t === 0) [nx, nz] = [nx + a.z - c.z, nz - (a.x - c.x)];
    best = { d, sign: Math.sign((x - px) * nx + (z - pz) * nz) };
  }
  return best.d * best.sign;
}

// Whether the fence turns at the interior post i.
function isBend(posts, i) {
  if (i === 0 || i === posts.length - 1) return false;
  const [a, b, c] = [posts[i - 1], posts[i], posts[i + 1]];
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
  return Math.abs(cross) > 0.01 * Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z);
}

test('running into the fence where it bends never gets the hero through or inside', () => {
  const level = buildLevel(new THREE.Scene());
  const col = level.collision;
  const player = new Player({ collision: col, events: null, spawn: level.spawn });
  const ctl = new ScriptedController();
  const leaks = [];
  let runs = 0;
  for (const posts of fenceRuns(L)) {
    posts.forEach((post, i) => {
      if (!isBend(posts, i)) return;
      for (const [ax, az] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        for (let side = -24; side <= 24; side += 3) {
          const x = post.x - ax * 200 + az * side;
          const z = post.z - az * 200 + ax * side;
          if (L.regionAt(x, z) !== 'lawn') continue;
          const start = signedDistance(posts, x, z);
          if (Math.abs(start) < 80) continue;
          const floor = col.findFloor(x, 30000, z, 0);
          const yaw = Math.atan2(ax, az);
          player.teleport(x, floor.y, z, yaw);
          player.setAction('idle');
          runs++;
          for (let t = 0; t < 30; t++) player.update(ctl.next({ stickY: 1 }), yaw);
          const end = signedDistance(posts, player.pos.x, player.pos.z);
          if (Math.sign(end) !== Math.sign(start) || Math.abs(end) < SLAB_HALF) {
            const at = `${post.x.toFixed(0)}, ${post.z.toFixed(0)}`;
            leaks.push(`post (${at}) dir ${ax},${az} side ${side}: ${end.toFixed(0)}`);
          }
        }
      }
    });
  }
  assert.ok(runs > 200, `only ${runs} run-ups`);
  assert.deepEqual(leaks.slice(0, 10), []);
});
