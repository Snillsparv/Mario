// Sparrow Lane's own realistic geometry (world/lane/real/*, built in the realistic look's worker):
// deterministic, its faces wound the way their normals point (the tile courses' first try was
// culled away on both slopes), no wall left across a window or a door, the tile courses lying
// on the classic roof plane the colliders are (within the rolls' height: Jonas walks on that
// plane) under ridge caps no higher, the firs where the classic forest's cones stood, the
// grass's mask growing on the lawns only (never on the roads, paths, drives, the round bed, the
// mailbox, the bushes, the walls' steps), the cars standing on their wheels inside their
// colliders (their bodies and tyres closed: no hole to see through), the bird on the mailbox's
// ridge; every tier within its triangle budget (section 7 of the plan: high <= 900k a frame with
// the grass and the shadow pass, so the detail itself far under), the low tier's halved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as lane from '../src/world/lane/layout.js';
import { buildLane } from '../src/world/lane/build.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';
import { forestSpots } from '../src/world/lane/real/spots.js';
import { lawnMask, GRASS } from '../src/world/lane/real/grass.js';
import { frameOf } from '../src/world/lane/real/house.js';
import { cars } from '../src/world/lane/real/cars.js';
import { Geo } from '../src/world/lane/real/geo.js';

const t0 = performance.now();
const high = buildLaneDetail(lane, 'high');
const ms = performance.now() - t0;
const low = buildLaneDetail(lane, 'low');
const mesh = (d, name) => d.meshes.find((m) => m.name === name).buffers;
const sha = (d) => {
  const h = crypto.createHash('sha1');
  for (const m of d.meshes) for (const a of Object.values(m.buffers)) h.update(Buffer.from(a.buffer));
  return h.digest('hex');
};

test('deterministic, finite, and each tier within its triangle budget', (t) => {
  t.diagnostic(`high: ${Math.round(high.triangles)} triangles in ${high.meshes.length} meshes and ${high.firs.matrices.length / 16} firs, built in ${ms.toFixed(0)} ms; low: ${Math.round(low.triangles)}`);
  assert.equal(sha(buildLaneDetail(lane, 'high')), sha(high), 'the same buffers every time');
  for (const d of [high, low]) {
    for (const m of d.meshes) {
      const b = m.buffers;
      const n = b.position.length / 3;
      assert.ok(n > 0 && n % 3 === 0, `${m.name}: whole triangles`);
      assert.equal(b.normal.length, n * 3);
      assert.equal(b.uv.length, n * 2);
      assert.equal(b.color.length, n * 3);
      if (b.sway) assert.equal(b.sway.length, n);
      for (const a of Object.values(b)) for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${m.name}: finite`);
    }
  }
  assert.ok(high.triangles < 400000, `high: ${high.triangles}`);
  assert.ok(low.triangles < 0.5 * high.triangles, `low: ${low.triangles} (high ${high.triangles})`);
  assert.equal(low.grass, null, 'no blades on low');
  assert.ok(!low.meshes.some((m) => m.name === 'tiles' && m.buffers.position.length / 9 > 3000), 'no tile courses on low (their caps only)');
  assert.ok(low.meshes.filter((m) => m.cast).length <= 8, 'on low only the houses and the cars cast');
});

test('every face is wound the way its normals point (but the leaf cards, lit through both faces): the tile courses face out of their roofs', () => {
  for (const d of [high, low]) {
    for (const m of d.meshes) {
      if (m.name === 'foliage') continue;
      const { position: p, normal: n } = m.buffers;
      let bad = 0;
      for (let i = 0; i < p.length; i += 9) {
        const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const v = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let s = 0;
        for (let k = 0; k < 3; k++) s += g[0] * n[i + k * 3] + g[1] * n[i + k * 3 + 1] + g[2] * n[i + k * 3 + 2];
        if (s < -1e-6) bad++;
      }
      assert.equal(bad, 0, `${m.name}: ${bad} triangles wound against their normals`);
    }
  }
});

test('the walls are open at every window and door of the chain houses: no wall triangle across an opening', () => {
  const walls = [mesh(high, 'boards'), mesh(high, 'brick')];
  for (const h of lane.HOUSES.filter((o) => o.kit === 'chain')) {
    const front = frameOf(h).face('front').f;
    const back = frameOf(h).face('back').f;
    const openings = [];
    for (const u of h.windows ?? []) openings.push([front, u, 170, 300], [back, -u, 170, 300]);
    if (typeof h.door === 'object') openings.push([front, h.door.u, 1, h.door.h - 1]);
    else if (typeof h.door === 'number') openings.push([front, h.door, 1, 214]);
    for (const [f, u, v0, v1] of openings) {
      // A point in the opening's middle, on the wall's plane (and on the plinth's, 2 proud);
      // (south_2's back window where its wing stands against it is inside the wing: no matter).
      for (const w of [0, 2]) {
        const [x, y, z] = f.at(u, (v0 + v1) / 2, w);
        if (lane.HOUSES.some((o) => o !== h && Math.abs(x - o.cx) < (Math.abs(Math.sin(o.yaw ?? 0)) > 0.5 ? o.d : o.w) / 2 + 5 && Math.abs(z - o.cz) < (Math.abs(Math.sin(o.yaw ?? 0)) > 0.5 ? o.w : o.d) / 2 + 5)) continue;
        for (const { position: p } of walls) {
          for (let i = 0; i < p.length; i += 9) {
            const tri = [0, 1, 2].map((k) => [p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]]);
            // On that plane, and covering the point?
            const off = tri.map(([px, , pz]) => (px - x) * f.out[0] + (pz - z) * f.out[2]);
            if (off.some((o) => Math.abs(o) > 0.5)) continue;
            const uv = tri.map(([px, py, pz]) => [(px - x) * f.right[0] + (pz - z) * f.right[2], py - y]);
            const side = (a, b) => (b[0] - a[0]) * -a[1] - (b[1] - a[1]) * -a[0];
            const s = [side(uv[0], uv[1]), side(uv[1], uv[2]), side(uv[2], uv[0])];
            assert.ok(!(s.every((q) => q > 0) || s.every((q) => q < 0)), `${h.id}: a wall across the opening at u ${u}`);
          }
        }
      }
    }
  }
});

test('the tile courses lie on the classic roof planes (the colliders Jonas walks on): never under them, at most the rolls\' height over them', () => {
  const { position: p } = mesh(high, 'tiles');
  const roofs = lane.LANE_REAL.tiles.map((id) => {
    const h = lane.HOUSES.find((o) => o.id === id);
    return { h, F: frameOf(h), o: h.overhang ?? 60, A: h.w / 2, B: h.d / 2, tan: (h.ridge - h.eave) / (h.d / 2) };
  });
  let checked = 0;
  for (let i = 0; i < p.length; i += 3) {
    // On one of the roofs it lies within (in each house's frame: u along its ridge, w across
    // it; where two roofs meet, the wing's eave under its house's, either will do), leaving out
    // the caps along the ridges and the rolls up the verges.
    const overs = [];
    let cap = false;
    for (const { h, F, o, A, B, tan } of roofs) {
      const [dx, dz] = [p[i] - h.cx, p[i + 2] - h.cz];
      const [ux, , uz] = F.dir(1, 0, 0);
      const u = Math.abs(dx * ux + dz * uz);
      const w = Math.abs(-dx * uz + dz * ux);
      if (u > A + o + 20 || w > B + o + 20) continue;
      if (u > A + o - 20 || w < 30) cap = true;
      if (u > A + o - 20 || w > B + o + 4 || w < 30) continue; // (the eave's nose stands a little out)
      overs.push((p[i + 1] - (h.ridge - w * tan)) * Math.cos(Math.atan(tan)));
    }
    if (!overs.length || cap) continue;
    assert.ok(overs.some((over) => over > -3.5 && over < 9.5), `a tile vertex ${overs.map((v) => v.toFixed(2))} off its roof's plane`);
    checked++;
  }
  assert.ok(checked > 10000, `${checked} vertices`);
  // The ridge caps sit low on the ridge line Jonas walks along (his feet sinking no deeper there
  // than between the rolls).
  for (const { h, F, A } of roofs) {
    let top = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const [dx, dz] = [p[i] - h.cx, p[i + 2] - h.cz];
      const [ux, , uz] = F.dir(1, 0, 0);
      if (Math.abs(dx * ux + dz * uz) < A - 50 && Math.abs(-dx * uz + dz * ux) < 20) top = Math.max(top, p[i + 1]);
    }
    assert.ok(top > h.ridge && top <= h.ridge + 10.5, `${h.id}: the ridge cap's top ${(top - h.ridge).toFixed(1)} over the ridge`);
  }
});

test('the firs stand where the classic forest\'s cones stood, the classic build drawing the same spots', () => {
  const { firs } = forestSpots(lane);
  assert.equal(high.firs.matrices.length / 16, firs.length);
  assert.ok(firs.length >= lane.FOREST.count + lane.EDGE_FOREST.count - 5, `${firs.length} firs`);
  firs.forEach((s, i) => {
    const m = high.firs.matrices.subarray(i * 16, i * 16 + 16);
    assert.deepEqual([m[12], m[13], m[14]].map((v) => v.toFixed(3)), [s.x, s.base, s.z].map((v) => Math.fround(v).toFixed(3)));
    assert.ok(Math.abs(m[5] - s.h) < 1e-3, 'scaled to its height');
  });
  // Each classic cone's tip (lane/props.js forest: skerries' fir, its lathe closing at base + h).
  const classic = buildLane(lane);
  const leaves = classic.object3D.getObjectByName('lane-leaves').geometry.attributes.position;
  const tips = new Set();
  for (let i = 0; i < leaves.count; i++) tips.add([leaves.getX(i), leaves.getY(i), leaves.getZ(i)].map((v) => v.toFixed(1)).join());
  for (const s of firs) assert.ok(tips.has([s.x, s.base + s.h, s.z].map((v) => Math.fround(v).toFixed(1)).join()), `a classic cone's tip at ${s.x}, ${s.z}`);
});

test('the grass\'s mask: blades on the lawns and the gardens (at their height), none on the road, the turning area, the pavement, the paths, the drives, the round bed, the mailbox, the bushes, the houses or the walls\' steps', () => {
  const m = lawnMask(lane);
  assert.deepEqual([m.width, m.height], [1024, 512]);
  const at = (x, z) => {
    const i = Math.floor(((x - m.x0) / (m.x1 - m.x0)) * m.width);
    const j = Math.floor(((z - m.z0) / (m.z1 - m.z0)) * m.height);
    return [m.data[(j * m.width + i) * 4], m.data[(j * m.width + i) * 4 + 1] * 4];
  };
  const lawns = [[-500, 900], [600, 1050], [1400, 1100], [-2500, 1000], [-900, -1500], [2000, -1100], [-2000, 3000]];
  for (const [x, z] of lawns) {
    const [grow, y] = at(x, z);
    assert.equal(grow, 255, `a lawn at ${x}, ${z}`);
    assert.ok(Math.abs(y - lane.groundHeight(x, z)) <= 2, `its height at ${x}, ${z}: ${y}`);
  }
  const bare = {
    road: [0, 0],
    'turning area': [lane.TURN.x, lane.TURN.z + 800],
    pavement: [-1000, -560],
    path: [0, 900],
    drive: [2000, 900],
    'round bed': [lane.ROUND_BED.x, lane.ROUND_BED.z],
    mailbox: [lane.MAILBOX.x, lane.MAILBOX.z],
    rhododendron: [lane.RHODODENDRON.x, lane.RHODODENDRON.z],
    hedge: [-2500, 640],
    house: [0, 2000],
    'drive notch': [650, -1000],
    "terrace's wall": [-2000, lane.NORTH.wallZ - 5],
    'outside the boundary': [-3000, 3700],
  };
  for (const [what, [x, z]] of Object.entries(bare)) assert.equal(at(x, z)[0], 0, `none on the ${what}`);
  assert.equal(GRASS.high.side ** 2, 16384, 'the plan\'s 16,384 clumps on high');
  assert.equal(high.grass.clump.position.length / 9, GRASS.high.blades * GRASS.high.segs * 2, 'a clump\'s triangles');
});

test('the cars stand on their wheels inside their colliders; the bird stands on the mailbox\'s ridge; the bed\'s stones ring it', () => {
  const tyres = mesh(high, 'tyre').position;
  const paint = mesh(high, 'carPaint').position;
  for (const c of lane.CARS) {
    const K = lane.CAR_KINDS[c.kind];
    const y0 = lane.groundHeight(c.x, c.z);
    const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
    // Its own (within 60 of its box: the next car stands farther off).
    const near = (p) => {
      const out = [];
      for (let i = 0; i < p.length; i += 3) {
        const along = (p[i] - c.x) * fx + (p[i + 2] - c.z) * fz;
        const across = (p[i] - c.x) * fz - (p[i + 2] - c.z) * fx;
        if (Math.abs(along) < K.l / 2 + 60 && Math.abs(across) < K.w / 2 + 60) out.push([p[i], p[i + 1], p[i + 2]]);
      }
      return out;
    };
    const t = near(tyres);
    assert.ok(t.length > 0, `${c.kind} at ${c.x}: its tyres`);
    const lowest = Math.min(...t.map((v) => v[1]));
    assert.ok(Math.abs(lowest - y0) < 1, `${c.kind}: its tyres on the ground (${lowest} vs ${y0})`);
    // Inside the classic body's box (along and across the car), with the mirrors' reach.
    for (const [x, y, z] of near(paint)) {
      const along = (x - c.x) * fx + (z - c.z) * fz;
      const across = (x - c.x) * fz - (z - c.z) * fx;
      assert.ok(Math.abs(along) <= K.l / 2 + 2 && Math.abs(across) <= K.w / 2 + 18 && y <= y0 + K.roof + 2, `${c.kind}: inside its collider (${along.toFixed(0)}, ${across.toFixed(0)}, ${(y - y0).toFixed(0)})`);
    }
  }
  const bird = mesh(high, 'bird').position;
  let lowest = Infinity;
  for (let i = 1; i < bird.length; i += 3) lowest = Math.min(lowest, bird[i]);
  assert.ok(lowest > lane.MAILBOX.ridge - 1 && lowest < lane.MAILBOX.ridge + 12, `the bird on the ridge: ${lowest}`);
  // The stones: a ring round the bed's middle.
  const granite = mesh(high, 'granite').position;
  const B = lane.ROUND_BED;
  const angles = new Set();
  for (let i = 0; i < granite.length; i += 3) {
    const d = Math.hypot(granite[i] - B.x, granite[i + 2] - B.z);
    if (d < B.r + 40 && d > B.r - 60) angles.add(Math.round((Math.atan2(granite[i] - B.x, granite[i + 2] - B.z) / (Math.PI * 2)) * B.stones));
  }
  assert.ok(angles.size >= B.stones - 1, `stones round the bed (${angles.size})`);
});

test('the cars\' bodies and tyres are closed: every edge of each shared by exactly two of its faces, once each way', () => {
  // The cars built alone, each body (the loft capped at both ends) and each tyre kept apart.
  for (const tier of ['high', 'low']) {
    const kit = { tier };
    for (const name of ['carPaint', 'carGlass', 'tyre', 'rim', 'trim', 'lamp', 'tail', 'metal']) kit[name] = new Geo();
    const pieces = [];
    for (const name of ['carPaint', 'tyre']) {
      const g = kit[name];
      const loft = g.loft.bind(g);
      g.loft = (rings, o = {}) => {
        const from = g.pos.length;
        loft(rings, o);
        if (name === 'tyre' || (o.capStart && o.capEnd)) pieces.push({ name, p: g.pos.slice(from) });
      };
    }
    cars(kit, lane);
    assert.equal(pieces.length, lane.CARS.length * 5, `${tier}: a body and four tyres a car`);
    for (const { name, p } of pieces) {
      const key = (i) => `${p[i]},${p[i + 1]},${p[i + 2]}`;
      const edges = new Map();
      for (let i = 0; i < p.length; i += 9) {
        const v = [key(i), key(i + 3), key(i + 6)];
        for (let k = 0; k < 3; k++) {
          const e = `${v[k]}>${v[(k + 1) % 3]}`;
          edges.set(e, (edges.get(e) ?? 0) + 1);
        }
      }
      for (const [e, n] of edges) {
        const [a, b] = e.split('>');
        assert.ok(n === 1 && edges.get(`${b}>${a}`) === 1, `${tier} ${name}: the edge ${e} has ${n} face(s) one way, ${edges.get(`${b}>${a}`) ?? 0} the other`);
      }
    }
  }
});
