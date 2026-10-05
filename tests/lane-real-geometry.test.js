// Sparrow Lane's own realistic geometry (world/lane/real/*, built in the realistic look's worker):
// deterministic, its faces wound the way their normals point (the tile courses' first try was
// culled away on both slopes), no wall left across a window or a door, the tile courses lying
// on the classic roof plane the colliders are (within the rolls' height: Jonas walks on that
// plane) under ridge caps no higher, the firs where the classic forest's cones stood, the
// grass's mask growing on the lawns only (never on the roads, paths, drives, the round bed, the
// mailbox, the bushes, the walls' steps), the cars standing on their wheels inside their
// colliders (their bodies and tyres closed: no hole to see through), every tyre's patch on the
// drive's drawn surface and each car level on it, the bonnets and roofs on the colliders Jonas
// stands on, no plate or badge, the bird on the mailbox's ridge; the double garage's rust under
// its downpipes' clips and the balcony's geraniums (not on low); every tier within its triangle
// budget (section 7 of the plan: high <= 900k a frame with the grass and the shadow pass, so the
// detail itself far under), the low tier's halved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as lane from '../src/world/lane/layout.js';
import { buildLane } from '../src/world/lane/build.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';
import { forestSpots } from '../src/world/lane/real/spots.js';
import { lawnMask, GRASS } from '../src/world/lane/real/grass.js';
import { frameOf } from '../src/world/lane/real/house.js';
import { cars, carOf, carFrame, carClusters } from '../src/world/lane/real/cars.js';
import { Geo } from '../src/world/lane/real/geo.js';
import { roadPieces, inside } from '../src/world/lane/real/plan.js';

const t0 = performance.now();
const high = buildLaneDetail(lane, 'high');
const ms = performance.now() - t0;
const low = buildLaneDetail(lane, 'low');
const mesh = (d, name) => d.meshes.find((m) => m.name === name).buffers;
// Every mesh's positions in a material (a probe's own meshes too: carPaint@car0...), joined.
const positionsOf = (d, material) => {
  const parts = d.meshes.filter((m) => m.material === material).map((m) => m.buffers.position);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
// A car's own vertices among `p` (within `pad` of its box), in its frame: [across, y, along].
const ownOf = (c, p, pad = 60) => {
  const K = lane.CAR_KINDS[c.kind];
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const out = [];
  for (let i = 0; i < p.length; i += 3) {
    const along = (p[i] - c.x) * fx + (p[i + 2] - c.z) * fz;
    const across = (p[i] - c.x) * fz - (p[i + 2] - c.z) * fx;
    if (Math.abs(along) < K.l / 2 + pad && Math.abs(across) < K.w / 2 + pad) out.push([across, p[i + 1], along]);
  }
  return out;
};
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

test('the walls are open at every window and door of the chain houses and the villas: no wall triangle across an opening', () => {
  const walls = [mesh(high, 'boards'), mesh(high, 'brick'), mesh(high, 'render')];
  for (const h of lane.HOUSES.filter((o) => o.kit === 'chain' || o.kit === 'villa')) {
    const front = frameOf(h).face('front').f;
    const back = frameOf(h).face('back').f;
    const openings = [];
    if (h.kit === 'villa') {
      // The upper floor's windows (plain, arched, behind a bay), one on each other face; the
      // arched door at the garden's floor; the west end's (rendered to its eaves) are over its
      // garage doors.
      const y0 = h.y0 ?? 22;
      if (h.render < h.eave) {
        for (const u of [...(h.windows ?? []), ...(h.arches ?? []), ...(h.bays ?? [])]) openings.push([front, u, 530, 600]);
        for (const name of ['back', 'left', 'right']) openings.push([frameOf(h).face(name).f, 0, 530, 700]);
      } else for (const name of ['left', 'right']) openings.push([frameOf(h).face(name).f, 0, h.eave - y0 - 220, h.eave - y0 - 40]);
      if (h.door !== undefined) openings.push([front, h.door, lane.TERRACE - y0 + 5, lane.TERRACE - y0 + 150]);
    }
    for (const u of h.kit === 'chain' ? (h.windows ?? []) : []) openings.push([front, u, 170, 300], [back, -u, 170, 300]);
    if (typeof h.door === 'object') openings.push([front, h.door.u, 1, h.door.h - 1]);
    else if (typeof h.door === 'number' && h.kit === 'chain') openings.push([front, h.door, 1, 214]);
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

test('the tile courses lie in the classic roof planes (the colliders Jonas walks on): their crowns at most 1.5 over them (he stands on the crowns), the troughs under them', () => {
  const { position: p } = mesh(high, 'tiles');
  const roofs = lane.LANE_REAL.tiles.map((id) => {
    const h = lane.HOUSES.find((o) => o.id === id);
    return { h, F: frameOf(h), o: h.overhang ?? 60, A: h.w / 2, B: h.d / 2, tan: (h.ridge - h.eave) / (h.d / 2) };
  });
  let checked = 0;
  let crown = -Infinity;
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
    assert.ok(overs.some((over) => over > -10.5 && over <= 1.55), `a tile vertex ${overs.map((v) => v.toFixed(2))} off its roof's plane`);
    crown = Math.max(crown, Math.min(...overs.map((v) => (v > -10.5 ? v : Infinity))));
    checked++;
  }
  assert.ok(checked > 10000, `${checked} vertices`);
  assert.ok(crown > 1 && crown <= 1.55, `the highest crown ${crown.toFixed(2)} over the plane`);
  // The ridge caps (and the verge rolls' tops at its ends) sit low on the ridge line Jonas walks
  // along (his feet sinking no deeper there than on the crowns).
  for (const { h, F, A, o } of roofs) {
    let top = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const [dx, dz] = [p[i] - h.cx, p[i + 2] - h.cz];
      const [ux, , uz] = F.dir(1, 0, 0);
      if (Math.abs(dx * ux + dz * uz) < A + o + 10 && Math.abs(-dx * uz + dz * ux) < 20) top = Math.max(top, p[i + 1]);
    }
    assert.ok(top > h.ridge && top <= h.ridge + 2.5, `${h.id}: the ridge cap's top ${(top - h.ridge).toFixed(1)} over the ridge`);
  }
});

test('the firs stand where the classic forest\'s cones stood, the classic build drawing the same spots; on high the edge\'s firs a second spruce (more tiers, a hanging skirt, gaps)', (t) => {
  const { firs } = forestSpots(lane);
  // (On high the bank's firs, then the edge's, a spruce of their own; on low one set.)
  const all = new Float32Array([...high.firs.matrices, ...high.firs.edge.matrices]);
  assert.equal(high.firs.matrices.length / 16, lane.FOREST.count, 'the bank\'s');
  assert.equal(all.length / 16, firs.length);
  assert.equal(low.firs.edge, null, 'one spruce on low');
  assert.equal(low.firs.matrices.length / 16, firs.length);
  assert.deepEqual([...low.firs.matrices.slice(0, 16 * lane.FOREST.count)], [...high.firs.matrices].map((v) => v), 'the same places on every tier');
  assert.deepEqual([...low.firs.colors.slice(3 * lane.FOREST.count)], [...high.firs.edge.colors], 'each its own tint');
  assert.ok(firs.length >= lane.FOREST.count + lane.EDGE_FOREST.count - 5, `${firs.length} firs`);
  // The edge's spruce: more tiers, its lowest branches hanging lower, under 1.6 x the forest's.
  const count = (parts) => parts.find((p) => p.material === 'fir-leaves').buffers.position.length / 9;
  const lowest = (parts) => {
    const p = parts.find((q) => q.material === 'fir-leaves').buffers.position;
    let y = Infinity;
    for (let i = 1; i < p.length; i += 3) y = Math.min(y, p[i]);
    return y;
  };
  const [a, b] = [count(high.firs.parts), count(high.firs.edge.parts)];
  t.diagnostic(`fir leaves: forest ${a}, edge ${b} triangles`);
  assert.ok(b > a && b < 1.6 * a, `the edge's spruce ${b} triangles, the forest's ${a}`);
  assert.ok(lowest(high.firs.edge.parts) < lowest(high.firs.parts) - 0.03, 'a hanging skirt');
  firs.forEach((s, i) => {
    const m = all.subarray(i * 16, i * 16 + 16);
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
  const paint = positionsOf(high, 'carPaint');
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
    for (const c of lane.CARS) if (c.id) carOf(kit, lane, c); // (the dad's, drawn last by detail.js)
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

// The drawn ground's height under (x, z) (the realistic build's asphalt, cobbles, path and lawn
// meshes: a vertical ray), the highest under `below`.
function surfaceAt(meshes, x, z, below) {
  let best = -Infinity;
  for (const m of meshes) {
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (y < below && y > best) best = y;
    }
  }
  return best;
}

test('every car sits flat on its drive: each tyre\'s patch on the drawn surface (neither floating nor sunk), the four patches level, the sill level, and a contact shadow under it', () => {
  const ground = [];
  buildLane(lane, { look: 'real', materials: {} }).object3D.traverse((o) => o.isMesh && ['lane-asphalt', 'lane-cobbles', 'lane-path', 'lane-grass'].includes(o.name) && ground.push(o));
  assert.ok(ground.length >= 3, 'the ground\'s meshes');
  for (const d of [high, low]) {
    const tyres = mesh(d, 'tyre').position;
    const paint = positionsOf(d, 'carPaint');
    const contact = d.meshes.find((m) => m.name === 'contact')?.buffers;
    assert.ok(contact, `${d === high ? 'high' : 'low'}: the contact shadows`);
    for (const c of lane.CARS) {
      const K = lane.CAR_KINDS[c.kind];
      const F = carFrame(lane, c);
      const t = ownOf(c, tyres);
      const patches = [];
      for (const wc of F.axles) {
        for (const s of [-1, 1]) {
          // This wheel's tread (within its radius of its axis, on its side).
          const own = t.filter(([u, , w]) => Math.abs(w - wc) < F.R + 2 && Math.sign(u) === s);
          assert.ok(own.length > 20, `${c.kind}: a tyre at ${wc}, ${s}`);
          const lowest = Math.min(...own.map((v) => v[1]));
          const patch = own.filter((v) => v[1] < lowest + 0.01);
          // Where it stands: the patch's middle, in the world.
          const um = patch.reduce((a, v) => a + v[0], 0) / patch.length;
          const wm = patch.reduce((a, v) => a + v[2], 0) / patch.length;
          const [x, , z] = F.at(um, 0, wm);
          const surface = surfaceAt(ground, x, z, F.y0 + 50);
          assert.ok(Number.isFinite(surface), `${c.kind} at ${c.x}: ground under its wheel`);
          assert.ok(Math.abs(lowest - surface) <= 0.25, `${c.kind} at ${c.x}: its tyre ${(lowest - surface).toFixed(2)} off the drive's surface`);
          assert.ok(patch.length >= 2, `${c.kind}: a flat patch where it stands (${patch.length} points)`);
          patches.push(lowest);
        }
      }
      assert.ok(Math.max(...patches) - Math.min(...patches) < 0.01, `${c.kind} at ${c.x}: level on its four patches`);
      // The sill: the body's lowest points between the arches, level from front to back.
      const between = ownOf(c, paint, 0).filter(([, , w]) => w < F.axles[0] - F.R - 12 && w > F.axles[1] + F.R + 12);
      const floor = Math.min(...between.map((v) => v[1]));
      const front = between.filter(([, , w]) => w > (F.axles[0] + F.axles[1]) / 2);
      const rear = between.filter(([, , w]) => w <= (F.axles[0] + F.axles[1]) / 2);
      for (const half of [front, rear]) assert.ok(Math.abs(Math.min(...half.map((v) => v[1])) - floor) < 0.01, `${c.kind}: the sill level`);
      assert.ok(floor - F.y0 >= 15 && floor - F.y0 <= 35, `${c.kind}: its ground clearance ${(floor - F.y0).toFixed(1)}`);
      // Its contact shadow: under it, on the drive, darkest under its middle.
      const shade = [];
      for (let i = 0; i < contact.position.length; i += 3) {
        const [x, y, z] = contact.position.subarray(i, i + 3);
        const along = (x - c.x) * Math.sin(c.yaw) + (z - c.z) * Math.cos(c.yaw);
        const across = (x - c.x) * Math.cos(c.yaw) - (z - c.z) * Math.sin(c.yaw);
        if (Math.abs(along) < K.l / 2 + 30 && Math.abs(across) < K.w / 2 + 30) {
          assert.ok(y > F.y0 && y < F.y0 + 1, `${c.kind}: its contact shadow just over the drive`);
          shade.push(contact.color[i]);
        }
      }
      assert.ok(shade.length > 40 && Math.min(...shade) < 0.45 && Math.max(...shade) === 1, `${c.kind}: a contact shadow fading out (${shade.length})`);
    }
  }
});

test('the cars\' bonnets and roofs lie on the colliders Jonas stands on (within 4), their parts in the probes\' clusters, no plate or badge on either end', () => {
  const clusters = carClusters(lane);
  assert.equal(clusters.length, 4, 'the dad\'s drive, the west link, the north drives, the east end');
  assert.deepEqual(clusters.map((g) => g.cars), [[0, 1], [2], [3, 4, 5], [6, 7]]);
  assert.deepEqual(high.probes.map((p) => p.name), ['car0', 'car1', 'car2', 'car3', 'north']);
  assert.deepEqual(low.probes, [], 'no probes on low');
  for (const [k, g] of clusters.entries()) {
    assert.ok(high.meshes.some((m) => m.name === `carPaint@${k}` && m.probe === `car${k}`), `cluster ${k}: its own paint`);
    const roofs = g.cars.map((i) => lane.groundHeight(lane.CARS[i].x, lane.CARS[i].z) + lane.CAR_KINDS[lane.CARS[i].kind].roof);
    assert.ok(g.at[1] > Math.max(...roofs), 'its probe over the roofs');
  }
  for (const d of [high, low]) {
    const paint = positionsOf(d, 'carPaint');
    for (const c of lane.CARS) {
      const K = lane.CAR_KINDS[c.kind];
      const { y0 } = carFrame(lane, c);
      const own = ownOf(c, paint, 0);
      const hl = K.l / 2;
      // The bonnet: along the middle, from the windscreen's foot to 45 short of the nose (the
      // collider's top runs to there).
      // Its top surface: the highest of its paint's triangles over points along the bonnet's
      // middle (from the windscreen's foot to 45 short of the nose: the collider's top runs to
      // there) and over the roof (the cabin collider's top, in from its edges).
      const F = carFrame(lane, c);
      const tris = [];
      for (let i = 0; i < paint.length; i += 9) {
        const [x, , z] = paint.subarray(i, i + 3);
        if (Math.hypot(x - c.x, z - c.z) < hl + 40) tris.push(paint.subarray(i, i + 9));
      }
      const soup = Float32Array.from(tris.flatMap((t) => [...t]));
      const hit = (u, w) => {
        const [x, , z] = F.at(u, 0, w);
        return surfaceAt([{ geometry: { attributes: { position: { array: soup } } } }], x, z, Infinity);
      };
      for (let w = hl - K.hood + 10; w <= hl - 45; w += 15) {
        const y = hit(0, w);
        assert.ok(Math.abs(y - (y0 + K.belt)) <= 4, `${c.kind}: the bonnet ${(y - y0 - K.belt).toFixed(1)} off the collider's top at ${w}`);
      }
      for (let w = -hl + K.tailTop + 20; w <= hl - K.hood - K.screen - 20; w += 40) {
        for (const u of [-(K.w / 2 - 60), 0, K.w / 2 - 60]) {
          const y = hit(u, w);
          assert.ok(Math.abs(y - (y0 + K.roof)) <= 4, `${c.kind}: the roof ${(y - y0 - K.roof).toFixed(1)} off the collider's top at ${u}, ${w}`);
        }
      }
    }
    // No plate and no badge: nothing plate-shaped (a rectangle 55 to 95 wide, 10 to 26 high, 3.5
    // to 6 times as wide as high: a plate's 520 x 110 at the cars' scale) on the middle of either
    // end.
    for (const name of ['metal', 'trim', 'lamp', 'tail', 'enamel', 'gloss']) {
      const m = d.meshes.find((o) => o.name === name);
      if (!m) continue;
      const p = m.buffers.position;
      for (const c of lane.CARS) {
        const K = lane.CAR_KINDS[c.kind];
        const own = ownOf(c, p, 4);
        for (let i = 0; i + 5 < own.length; i += 6) {
          const q = own.slice(i, i + 6);
          const end = q.every(([, , w]) => Math.abs(Math.abs(w) - K.l / 2) < 4);
          if (!end) continue;
          const us = q.map((v) => v[0]);
          const ys = q.map((v) => v[1]);
          const [wd, ht] = [Math.max(...us) - Math.min(...us), Math.max(...ys) - Math.min(...ys)];
          const mid = Math.abs((Math.max(...us) + Math.min(...us)) / 2) < 30;
          assert.ok(!(mid && wd >= 55 && wd <= 95 && ht >= 10 && ht <= 26 && wd / ht >= 3.5 && wd / ht <= 6), `${c.kind}: a plate-shaped ${name} part (${wd.toFixed(0)} x ${ht.toFixed(0)}) on an end`);
        }
      }
    }
  }
});

test('the clutter lies on the ground: every fallen leaf within 2 of the ground (none under a collider, none on the road\'s middle 60 %), weeds only in the kerbs\' joints, at the walls\' feet and on the path, the grit in the gutters; the street sign\'s plate blank; within each tier\'s share', async () => {
  const { clutter, streetSign, STREET_SIGN, SHARE } = await import('../src/world/lane/real/clutter.js');
  const { CollisionWorld } = await import('../src/collision/CollisionWorld.js');
  const world = new CollisionWorld();
  for (const c of buildLane(lane).colliders) world.addCollider(c);
  world.finalize();
  const ground = lawnMask(lane);
  const pieces = roadPieces(lane, { round: true });
  const kitOf = (tier) => {
    const kit = { tier };
    for (const name of ['foliage', 'core', 'patch', 'granite', 'paint', 'steel', 'enamel']) kit[name] = new Geo();
    clutter(kit, lane, ground);
    return kit;
  };
  const tris = (g) => g.count / 3;
  const counts = {};
  for (const tier of ['high', 'mid', 'low']) {
    const kit = kitOf(tier);
    counts[tier] = ['foliage', 'core', 'patch', 'granite', 'paint'].reduce((n, k) => n + tris(kit[k]), 0);
    // (The leaves: the core's flat triangles, normals up; its others the weeds' blades.)
    const { pos: p, nrm: n } = kit.core;
    const flat = (i) => [0, 1, 2].every((k) => n[i + k * 3] === 0 && n[i + k * 3 + 1] === 1 && n[i + k * 3 + 2] === 0);
    let leaves = 0;
    for (let i = 0; i < p.length; i += 9) {
      if (!flat(i)) continue;
      leaves++;
      const [x, y, z] = [(p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3];
      // (On the drawn road: in one of its pieces, or overhanging a kerb's foot by a little.)
      const near = (a, b) => [[0, 0], [a, 0], [-a, 0], [0, b], [0, -b]].some(([dx, dz]) => pieces.some((piece) => inside(piece, x + dx, z + dz)));
      const onRoad = near(12, 12);
      const g = onRoad ? 0 : lane.groundHeight(x, z);
      assert.ok(Math.abs(y - g) <= 2, `${tier}: a leaf at ${x.toFixed(0)}, ${z.toFixed(0)} ${(y - g).toFixed(1)} off the ground`);
      // (The straight's end, where its south half meets the turning area at a kerb, aside.)
      const end = lane.ROAD.line[lane.ROAD.line.length - 1][0];
      if (g === 0 && lane.roadDistance(x, z) <= lane.ROAD.half && x < end - 100) assert.ok(lane.roadDistance(x, z) > 0.6 * lane.ROAD.half || Math.hypot(x - lane.TURN.x, z - lane.TURN.z) <= lane.TURN.r, `${tier}: a leaf on the road's middle at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      if (Math.hypot(x - lane.TURN.x, z - lane.TURN.z) <= lane.TURN.r) assert.ok(Math.hypot(x - lane.TURN.x, z - lane.TURN.z) > 0.6 * lane.TURN.r, `${tier}: a leaf in the turning area's middle`);
      const hit = world.raycast({ x, y: 5000, z }, { x: 0, y: -1, z: 0 }, 6000);
      assert.ok(hit && hit.point.y <= y + 0.5 && y - hit.point.y <= 3.5, `${tier}: a leaf at ${x.toFixed(0)}, ${z.toFixed(0)} under a collider (${hit?.point.y.toFixed(1)} vs ${y.toFixed(1)})`);
    }
    assert.ok(leaves > (tier === 'high' ? 6000 : tier === 'mid' ? 3500 : 1200), `${tier}: ${leaves} leaf triangles`);
    // The weeds' blades (core): in a kerb's joint (at the road's edge), at a wall's foot, on the path.
    const c = kit.core.pos;
    if (tier === 'low') assert.equal(c.length / 9 - leaves, 0, 'no weeds on low');
    const P = lane.DAD_PATH;
    for (let i = 0; i < c.length; i += 9) {
      if (flat(i)) continue;
      const [x, z] = [c[i], c[i + 2]];
      // (At a kerb: on the drawn road, the road's edge within 15.)
      const onRoad = (px, pz) => pieces.some((piece) => inside(piece, px, pz));
      const kerb = onRoad(x, z) && Array.from({ length: 8 }, (_, k) => [Math.cos(k * 0.785) * 15, Math.sin(k * 0.785) * 15]).some(([dx, dz]) => !onRoad(x + dx, z + dz));
      const wall = lane.PLOTS_N.some((pl) => x > pl.x0 && x < pl.x1) && Math.abs(z - lane.wallZAt(x) - 7) < 12;
      const plinth = lane.HOUSES.some((h) => h.kit === 'chain' && ['front', 'back', 'left', 'right'].some((name) => {
        const { f, half } = frameOf(h).face(name);
        const o = f.at(0, 0, 0);
        const u = (x - o[0]) * f.right[0] + (z - o[2]) * f.right[2];
        const w = (x - o[0]) * f.out[0] + (z - o[2]) * f.out[2];
        return Math.abs(u) <= half + 40 && w > 0 && w < 20;
      }));
      const path = x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1;
      assert.ok(kerb || wall || plinth || path, `${tier}: a weed at ${x.toFixed(0)}, ${z.toFixed(0)} in no joint, at no wall`);
    }
    // The grit: in the gutters (on the road, its edge within 40: the grit 4 to 18 wide, and where
    // the straight meets the turning area a sliver of kerb between them).
    const g = kit.patch.pos;
    assert.ok(g.length > 0);
    const road = (px, pz) => pieces.some((piece) => inside(piece, px, pz));
    for (let i = 0; i < g.length; i += 3) {
      assert.ok(Math.abs(g[i + 1] - 0.45) < 1e-4, 'the grit just over the road');
      const [x, z] = [g[i], g[i + 2]];
      const ring = (r) => Array.from({ length: 8 }, (_, k) => [x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r]);
      assert.ok(ring(1).some(([px, pz]) => road(px, pz)) && [5, 10, 15, 20, 25, 30, 35, 40].some((r) => ring(r).some(([px, pz]) => !road(px, pz))), `grit at ${x.toFixed(0)}, ${z.toFixed(0)} in the gutter`);
    }
  }
  assert.ok(counts.high <= 30000, `high: ${counts.high} clutter triangles`);
  assert.ok(counts.mid <= counts.high * 0.75 && counts.low <= counts.high * 0.4, `mid ${counts.mid}, low ${counts.low} (high ${counts.high})`);
  assert.deepEqual(SHARE, { high: 1, mid: 0.6, low: 0.25 });
  // The street sign: a post, a plate white on both faces with a black border, nothing else on it.
  const kit = { tier: 'high' };
  for (const name of ['steel', 'enamel', 'paint', 'lamp', 'gloss', 'metal']) kit[name] = new Geo();
  streetSign(kit, lane);
  assert.equal(kit.enamel.count, 36, 'the plate: one box');
  const white = new Set();
  for (let i = 0; i < kit.enamel.col.length; i += 3) white.add(kit.enamel.col.slice(i, i + 3).join());
  assert.equal(white.size, 1, 'one colour: blank');
  assert.ok(kit.enamel.col[0] > 0.85 && kit.enamel.col[1] > 0.85 && kit.enamel.col[2] > 0.85, 'white');
  assert.equal(kit.paint.count, 4 * 2 * 6, 'its black border on both faces, nothing more');
  for (let i = 0; i < kit.paint.col.length; i++) assert.ok(kit.paint.col[i] < 0.01, 'black');
  assert.equal(kit.lamp.count + kit.gloss.count + kit.metal.count, 0, 'no lettering, no reflectors');
  const y0 = lane.groundHeight(STREET_SIGN.x, STREET_SIGN.z);
  assert.ok(Math.min(...kit.steel.pos.filter((_, i) => i % 3 === 1)) < y0, 'its post in the ground');
  assert.ok(lane.roadDistance(STREET_SIGN.x, STREET_SIGN.z) > lane.ROAD.half + lane.KERB.w + 40, 'on the verge');
});

test('the walls\' weathering: a wear attribute on the houses\' walls (how far under the sill or eave over it, how high over the ground, the streaks\' length), in range; none on the other meshes but theirs', () => {
  for (const d of [high, low]) {
    for (const m of d.meshes) {
      const w = m.buffers.wear;
      if (!['boards', 'brick', 'render'].includes(m.name)) {
        assert.equal(w, undefined, `${m.name}: no wear attribute`);
        continue;
      }
      assert.ok(w && w.length === m.buffers.position.length, `${m.name}: a wear attribute`);
      let worn = 0;
      for (let i = 0; i < w.length; i += 3) {
        if (w[i + 2] === 0) continue; // (a quad drawn without: the mailbox's boards)
        worn++;
        assert.ok(w[i] >= 0 && w[i] <= 1100, `${m.name}: under its sill or eave ${w[i]}`);
        assert.ok(w[i + 1] >= -200 && w[i + 1] <= 1300, `${m.name}: over the ground ${w[i + 1]}`);
        assert.ok(w[i + 2] >= 0.5 && w[i + 2] <= 1.3, `${m.name}: its streaks' length ${w[i + 2]}`);
      }
      assert.ok(worn >= 300, `${m.name}: its walls worn (${worn} vertices)`);
    }
  }
  // Under the dad's front windows the boards' streaks hang from the sills (under 0 at a sill's
  // line), the plinth's foot is at the ground.
  const boards = mesh(high, 'boards');
  const dad = lane.DAD;
  const front = frameOf(dad).face('front').f;
  let underSill = 0;
  for (let i = 0; i < boards.position.length; i += 3) {
    const [x, y, z] = boards.position.subarray(i, i + 3);
    const o = front.at(0, 0, 0);
    if (Math.abs((x - o[0]) * front.out[0] + (z - o[2]) * front.out[2]) > 0.5) continue;
    const u = (x - o[0]) * front.right[0] + (z - o[2]) * front.right[2];
    if (Math.abs(u) > dad.w / 2) continue;
    if (boards.wear[i] < 0.01 && y - o[1] < 200) underSill++;
  }
  assert.ok(underSill >= (dad.windows?.length ?? 1), `the boards' streaks hang from the dad's sills (${underSill})`);
  const brick = mesh(high, 'brick');
  let foot = Infinity;
  for (let i = 0; i < brick.wear.length; i += 3) if (brick.wear[i + 2] > 0) foot = Math.min(foot, brick.wear[i + 1]);
  assert.ok(foot < 0 && foot > -10, `the plinths' feet at the ground (${foot})`);
});

test('G3\'s details: the double garage\'s downpipes with faint rust under their clips (contact: a rust tint at a streak\'s head fading to nothing at its foot; not on low), the balcony\'s boxes of geraniums (not on low)', () => {
  const mid = buildLaneDetail(lane, 'mid');
  const G = lane.HOUSES.find((h) => h.kit === 'garage');
  const F = frameOf(G);
  const gable = F.face('front').f;
  const o = gable.at(0, 0, 0);
  // The streaks on the gable's render, 0.4 proud.
  const rust = (d) => {
    const c = mesh(d, 'contact');
    const out = [];
    for (let i = 0; i < c.position.length; i += 3) {
      const [x, y, z] = c.position.subarray(i, i + 3);
      const w = (x - o[0]) * gable.out[0] + (z - o[2]) * gable.out[2];
      const u = (x - o[0]) * gable.right[0] + (z - o[2]) * gable.right[2];
      if (Math.abs(w - 0.4) < 0.05 && Math.abs(u) <= G.w / 2) out.push({ u, y, rgb: [...c.color.subarray(i, i + 3)] });
    }
    return out;
  };
  for (const d of [high, mid]) {
    const r = rust(d);
    assert.ok(r.length >= 2 * 3 * 2 * 6, `streaks under both pipes' three clips (${r.length / 6})`);
    for (const p of r) {
      assert.ok(Math.abs(Math.abs(p.u) - (G.w / 2 - 16)) < 13, `beside a pipe at the gable's corner (${p.u.toFixed(1)})`);
      assert.ok(p.rgb[0] >= p.rgb[1] && p.rgb[1] >= p.rgb[2] && p.rgb[2] >= 0.5 && p.rgb[0] <= 1, `a rust tint, or none: ${p.rgb}`);
    }
    assert.ok(r.some((p) => p.rgb[2] < 0.7) && r.some((p) => p.rgb.every((v) => v === 1)), 'from rust at a head to nothing at a foot');
  }
  assert.equal(rust(low).length, 0, 'none on low');
  // The boxes hung outside the balcony's front rail: geraniums in leafy tufts.
  const villa = lane.HOUSES.find((h) => h.balcony);
  const left = frameOf(villa).face('left').f;
  const at = left.at(0, 0, 0);
  const planted = (d) => {
    const p = positionsOf(d, 'foliage');
    let n = 0;
    for (let i = 0; i < p.length; i += 3) {
      const w = (p[i] - at[0]) * left.out[0] + (p[i + 2] - at[2]) * left.out[2];
      const u = (p[i] - at[0]) * left.right[0] + (p[i + 2] - at[2]) * left.right[2];
      if (w > 140 && w < 190 && Math.abs(u) < 270 && p[i + 1] > at[1] + 400) n++;
    }
    return n;
  };
  assert.ok(planted(high) > 300 && planted(mid) > 200, `the tufts (${planted(high)} / ${planted(mid)} vertices)`);
  assert.equal(planted(low), 0, 'none on low');
});

test('the dad\'s crossover (CARS style ev): drawn last into every mesh it shares, `hide` at its first vertex in each (hiding from there removes exactly its faces), on every tier', () => {
  const c = lane.CARS.find((k) => k.id === 'dad_ev');
  assert.ok(c && c.style === 'ev' && c.kind === 'cross', 'CARS[0], the cross kind\'s body');
  const K = lane.CAR_KINDS[c.kind];
  const inBox = (p, i, pad) => Math.abs(p[i] - c.x) < K.w / 2 + pad && Math.abs(p[i + 2] - c.z) < K.l / 2 + pad;
  for (const [tier, d] of [['high', high], ['low', low]]) {
    const hide = d.hide.dad_ev;
    assert.ok(hide && Object.keys(hide).length >= 5, `${tier}: its meshes ${Object.keys(hide ?? {})}`);
    for (const m of d.meshes) {
      const p = m.buffers.position;
      const from = hide[m.name];
      if (from === undefined) {
        for (let i = 0; i < p.length; i += 3) if (inBox(p, i, 8) && p[i + 1] > c.y0 + 5) assert.fail(`${tier} ${m.name}: a vertex of it outside its hide range`);
        continue;
      }
      assert.ok(from > 0 || m.name === 'drl', `${tier} ${m.name}: others' faces before it`);
      for (let i = from * 3; i < p.length; i += 3) assert.ok(inBox(p, i, 30), `${tier} ${m.name}: its range only the car's`);
      for (let i = 0; i < from * 3; i += 3) assert.ok(!(inBox(p, i, 4) && p[i + 1] > lane.GROUND + 5), `${tier} ${m.name}: none of it before its range`);
    }
  }
});

test('the dad\'s crossover looks like his car: a gloss black roof, two sideways-T lights on the nose that glow, tall tail lamps, the closed panel with nothing badge-sized in its middle, the bonnet sloping toward the nose', () => {
  const c = lane.CARS.find((k) => k.id === 'dad_ev');
  const K = lane.CAR_KINDS[c.kind];
  const F = carFrame(lane, c);
  const hl = K.l / 2;
  const at = (d, name) => {
    const b = d.meshes.find((m) => m.name === name).buffers;
    const from = d.hide.dad_ev[name] * 3;
    const out = [];
    for (let i = from; i < b.position.length; i += 3) {
      const [x, y, z] = b.position.subarray(i, i + 3);
      out.push({ u: (x - c.x) * Math.cos(c.yaw) - (z - c.z) * Math.sin(c.yaw), y: y - F.y0, w: (x - c.x) * Math.sin(c.yaw) + (z - c.z) * Math.cos(c.yaw), col: b.color.subarray(i, i + 3) });
    }
    return out;
  };
  const paint = at(high, 'carPaint@0');
  const roof = paint.filter((v) => v.y > K.roof - 3);
  assert.ok(roof.length > 20 && roof.every((v) => Math.max(...v.col) < 0.05), 'the roof black (the lacquer in black)');
  const body = paint.filter((v) => v.y < K.belt - 10 && v.y > 40);
  assert.ok(body.some((v) => v.col[2] > v.col[0] * 1.3), 'the body blue');
  // Two T's of light on the nose, one each side: a bar across and a stroke down its outer end.
  const drl = at(high, 'drl');
  assert.ok(drl.length >= 24 && drl.every((v) => v.w > hl - 70 && v.y > K.belt * 0.6), 'the T lights high on the nose');
  for (const s of [-1, 1]) {
    const side = drl.filter((v) => Math.sign(v.u) === s);
    const ys = side.map((v) => v.y);
    const us = side.map((v) => Math.abs(v.u));
    assert.ok(Math.max(...us) - Math.min(...us) > 30 && Math.max(...ys) - Math.min(...ys) > 8, `side ${s}: a bar across and a stroke down`);
  }
  assert.ok(high.meshes.find((m) => m.name === 'drl').material === 'drl');
  // Tall tail lamps: taller than wide on each corner of the tail.
  const tail = at(high, 'tail').filter((v) => v.w < -hl + 40);
  for (const s of [-1, 1]) {
    const side = tail.filter((v) => Math.sign(v.u) === s);
    const h = Math.max(...side.map((v) => v.y)) - Math.min(...side.map((v) => v.y));
    const w = Math.max(...side.map((v) => Math.abs(v.u))) - Math.min(...side.map((v) => Math.abs(v.u)));
    assert.ok(h > 1.5 * w && h > 60, `tail lamp ${s}: ${h.toFixed(0)} tall, ${w.toFixed(0)} wide`);
  }
  // The closed panel: nothing of any other part in its middle (no badge).
  for (const name of ['trim', 'metal', 'lamp', 'rim', 'drl', 'tail']) {
    for (const v of at(high, name)) assert.ok(!(v.w > hl - 30 && Math.abs(v.u) < 26 && v.y > 60 && v.y < K.belt), `${name}: a part in the panel's middle at ${v.u.toFixed(0)}, ${v.y.toFixed(0)}`);
  }
  // The bonnet sloping down toward the nose (and its leading edge lower still).
  const crown = (w0) => Math.max(...paint.filter((v) => Math.abs(v.u) < 8 && Math.abs(v.w - w0) < 12).map((v) => v.y));
  assert.ok(crown(hl - K.hood + 20) - crown(hl - 50) > 4 && crown(hl - 50) - crown(hl - 8) > 4, `the bonnet slopes: ${crown(hl - K.hood + 20).toFixed(1)}, ${crown(hl - 50).toFixed(1)}, ${crown(hl - 8).toFixed(1)}`);
});
