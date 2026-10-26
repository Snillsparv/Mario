// Sparrow Lane's own realistic geometry (world/lane/real/*, built in the realistic look's worker):
// deterministic, its faces wound the way their normals point (the tile courses' first try was
// culled away on both slopes), no wall left across a window or a door, the tile courses lying
// on the classic roof plane the colliders are (within the rolls' height: Jonas walks on that
// plane) under ridge caps no higher, the firs where the classic forest's cones stood, the
// grass's mask growing on the lawns only (never on the roads, paths, drives, the corner bed, the
// mailbox, the bushes, the walls' steps), the cars standing on their wheels inside their
// colliders (their bodies and tyres closed: no hole to see through), every tyre's patch on the
// drive's drawn surface and each car level on it, the bonnets and roofs on the colliders Jonas
// stands on, no plate or badge, the bird on the mailbox's ridge; the red-leaf tree's pale trunk
// inside its pole, its leader rounded off at the pole's top (W3 fix); the double garage's rust under
// its downpipes' clips and the balcony's geraniums (not on low); the store room's things behind
// the garage doors (D1: in the room, clear of its middle, painted dim, the tube glowing, each
// tier's share); every tier within its triangle
// budget (section 7 of the plan: high <= 900k a frame with the grass and the shadow pass, so the
// detail itself far under), the low tier's halved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as lane from '../src/world/lane/layout.js';
import { buildLane } from '../src/world/lane/build.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';
import { forestSpots } from '../src/world/lane/real/spots.js';
import { firGeometry, FIR_SHAPES } from '../src/world/lane/real/foliage.js';
import { lawnMask, GRASS } from '../src/world/lane/real/grass.js';
import { frameOf } from '../src/world/lane/real/house.js';
import { cars, carOf, carFrame, carClusters } from '../src/world/lane/real/cars.js';
import { Geo } from '../src/world/lane/real/geo.js';
import { roadPieces, inside } from '../src/world/lane/real/plan.js';
import { FACADES, GARAGE_SET, DOOR_SET, FLOOR_SET } from '../src/world/lane/facades.js';

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
      // (W6: a north villa's program, facades.js: its plain windows and one on each of its
      // `sides`, the round-headed window, the loggia, the oriel's opening, the niche, the board
      // door and the garage's opening, each open in the wall; the west end's (rendered to its
      // eaves) are over its garage doors.)
      const y0 = h.y0 ?? 22;
      const P = FACADES[h.id];
      if (P) {
        for (const w of P.windows ?? []) {
          const [u, , sill, ht] = Array.isArray(w) ? w : [w, 220, 520, 200];
          openings.push([front, u, sill + 10, sill + ht - 10]);
        }
        for (const name of h.sides ?? []) openings.push([frameOf(h).face(name).f, 0, 530, 700]);
        for (const o of [P.arch, P.loggia].filter(Boolean)) openings.push([front, o.u, o.sill + 10, o.crown - o.w / 2]);
        if (P.oriel) openings.push([front, P.oriel.u, P.oriel.v0 + 40, P.oriel.v0 + 200]);
        for (const o of [P.niche, P.door].filter(Boolean)) openings.push([front, o.u, 10, o.h - o.w / 2 - 10]);
        if (P.garage) openings.push([front, P.garage.u, 10, P.garage.h - 60]);
      } else for (const name of ['left', 'right']) openings.push([frameOf(h).face(name).f, 0, h.eave - y0 - 220, h.eave - y0 - 40]);
    }
    for (const u of h.kit === 'chain' ? (h.windows ?? []) : []) openings.push([front, u, 170, 300]);
    for (const u of h.kit === 'chain' ? (h.backWindows ?? (h.windows ?? []).map((w) => -w)) : []) openings.push([back, u, 170, 300]);
    if (typeof h.door === 'object') openings.push([front, h.door.u, 1, h.door.h - 1]);
    else if (typeof h.door === 'number' && h.kit === 'chain') openings.push([front, h.door, 1, 214]);
    for (const [f, u, v0, v1] of openings) {
      // A point in the opening's middle, on the wall's plane (and on the plinth's, 2 proud);
      // (south_2's and south_west's back windows where their wings stand against them are inside
      // the wings: no matter).
      for (const w of [0, 2]) {
        const [x, y, z] = f.at(u, (v0 + v1) / 2, w);
        // (In the other house's own frame: the west houses stand turned to the west leg.)
        const within = (o) => {
          const [c, sn] = [Math.cos(o.yaw ?? 0), Math.sin(o.yaw ?? 0)];
          const [dx, dz] = [x - o.cx, z - o.cz];
          return Math.abs(dx * c - dz * sn) < o.w / 2 + 5 && Math.abs(dx * sn + dz * c) < o.d / 2 + 5;
        };
        if (lane.HOUSES.some((o) => o !== h && within(o))) continue;
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
  // (W5: every wing's courses plain, each running into its house's back slope: its ridge cap and
  // verge rolls, in the tiles, are checked with the wings' below.)
  const roofOf = (h) => ({ h, F: frameOf(h), o: h.overhang ?? 60, A: h.w / 2, B: h.d / 2, tan: (h.ridge - h.eave) / (h.d / 2) });
  const roofs = lane.LANE_REAL.tiles.map((id) => roofOf(lane.HOUSES.find((o) => o.id === id)));
  const wings = lane.HOUSES.filter((h) => h.join);
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
    // (W3: the wings' ridge caps run on over their house's back slope to the valleys' apex:
    // theirs; W5: the neighbours' wings too.)
    const wing = wings.some((wg) => Math.abs(p[i] - wg.cx) < wg.d / 2 + 30 && p[i + 2] > wg.cz - wg.join.apex - 30);
    if (!overs.length || cap || wing) continue;
    assert.ok(overs.some((over) => over > -10.5 && over <= 1.55), `a tile vertex ${overs.map((v) => v.toFixed(2))} off its roof's plane`);
    crown = Math.max(crown, Math.min(...overs.map((v) => (v > -10.5 ? v : Infinity))));
    checked++;
  }
  assert.ok(checked > 10000, `${checked} vertices`);
  assert.ok(crown > 1 && crown <= 1.55, `the highest crown ${crown.toFixed(2)} over the plane`);
  // The ridge caps (and the verge rolls' tops at its ends) sit low on the ridge line Jonas walks
  // along (his feet sinking no deeper there than on the crowns).
  for (const { h, F, A, o } of [...roofs, ...wings.map(roofOf)]) {
    let top = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const [dx, dz] = [p[i] - h.cx, p[i + 2] - h.cz];
      const [ux, , uz] = F.dir(1, 0, 0);
      if (Math.abs(dx * ux + dz * uz) < A + o + 10 && Math.abs(-dx * uz + dz * ux) < 20) top = Math.max(top, p[i + 1]);
    }
    assert.ok(top > h.ridge && top <= h.ridge + 2.5, `${h.id}: the ridge cap's top ${(top - h.ridge).toFixed(1)} over the ridge`);
  }
});

test('the firs stand where the classic forest\'s cones stood, the classic build drawing the same spots; on high the edge\'s firs a second spruce (more tiers, a hanging skirt, gaps); W7: a mixed canopy, its tops under the shadows\' box, the side yards\' trunks solid', (t) => {
  const { firs, bank, broad, pines, birches } = forestSpots(lane);
  // (On high the bank's firs, then the edge's, a spruce of their own; on low one set.)
  const all = new Float32Array([...high.firs.matrices, ...high.firs.edge.matrices]);
  assert.equal(high.firs.matrices.length / 16, bank, 'the bank\'s');
  assert.equal(all.length / 16, firs.length);
  assert.equal(low.firs.edge, null, 'one spruce on low');
  assert.equal(low.firs.matrices.length / 16, firs.length);
  assert.deepEqual([...low.firs.matrices.slice(0, 16 * bank)], [...high.firs.matrices].map((v) => v), 'the same places on every tier');
  assert.deepEqual([...low.firs.colors.slice(3 * bank)], [...high.firs.edge.colors], 'each its own tint');
  // (W4: none of the forest in the edge's clear sector over the garage row; W7: the mix, the
  // photos' ~55 % broadleaf, ~30 % pine, ~15 % spruce on the bank, every top 16-21 m over the
  // street and under the shadows' box's top, only the side yards' trees inside the boundary and
  // their trunks solid.)
  const C = lane.EDGE_FOREST.clear;
  const trees = [...firs, ...broad, ...pines, ...birches];
  assert.ok(trees.length >= 110 && trees.every((s) => !(s.x > C.x0 && s.x < C.x1 && s.z > C.z0)), `${trees.length} trees`);
  const share = (list) => list.length / trees.length;
  assert.ok(share(broad) + share(birches) > 0.45 && share(pines) > 0.2 && share(firs) < 0.35, `broadleaf ${share(broad) + share(birches)}, pine ${share(pines)}, spruce ${share(firs)}`);
  assert.ok(trees.every((s) => s.base + s.h <= lane.FOREST.top[1] + 1), 'under the shadows\' box');
  const yard = trees.filter((s) => s.solid);
  assert.equal(yard.length, lane.FOREST.yards.length);
  assert.ok(trees.every((s) => s.solid || !lane.inBounds(s.x, s.z)), 'the rest outside the boundary');
  const classicCols = buildLane(lane).colliders;
  for (const s of yard) assert.ok(classicCols.some((c) => c.terrain === 'wood' && Array.from({ length: c.positions.length / 3 }, (_, i) => Math.hypot(c.positions[i * 3] - s.x, c.positions[i * 3 + 2] - s.z)).some((d) => d < 45)), `the side yard's trunk at ${s.x}, ${s.z} solid`);
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
  // (W7: the far tree line the low tier's plainer spruce on high: fewer triangles, the same materials.)
  assert.ok(count(high.firs.far.parts) < a, 'the far line plainer');
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

test('the firs read as dense spruces, not a net of cards (R fixes: the dad\'s "shadowy raster" was the forest, a smooth cone in a sparse lattice of feather cards under a bare trunk spike): each whorl an opaque skirt out over half its branches\' reach and down over the whorl below; no bare trunk over the crown, needles to the top', () => {
  for (const tier of ['high', 'low']) {
    for (const [name, shape, seed] of [['A', FIR_SHAPES.A, 7], ['B', FIR_SHAPES.B, 11]]) {
      const { leaves, core } = firGeometry(tier, seed, shape);
      const pts = (g) => {
        const out = [];
        for (let i = 0; i < g.pos.length; i += 3) out.push([Math.hypot(g.pos[i], g.pos[i + 2]), g.pos[i + 1]]);
        return out;
      };
      const [L, C] = [pts(leaves), pts(core)];
      const reach = (list, y, dy = 0.08) => Math.max(0, ...list.filter(([, v]) => Math.abs(v - y) <= dy).map(([r]) => r));
      // (The old smooth cone: under a third of the branches' reach halfway up, a seventh near the
      // top; the skirts about half of it all the way up.)
      const ratios = [];
      for (let y = 0.15; y <= 0.78; y += 0.03) ratios.push(reach(C, y) / reach(L, y));
      assert.ok(Math.min(...ratios) >= 0.25 && ratios.reduce((s, r) => s + r, 0) / ratios.length >= 0.4, `${name} (${tier}): the skirts' reach over the branches' ${ratios.map((r) => r.toFixed(2))}`);
      // (Down over the next whorl: no band between two skirts where only cards are. The core's
      // triangles cut at each height: out to some reach there.)
      const cut = (g, y) => {
        let r = 0;
        for (let i = 0; i < g.pos.length; i += 9) {
          const v = [0, 1, 2].map((k) => [g.pos[i + k * 3], g.pos[i + k * 3 + 1], g.pos[i + k * 3 + 2]]);
          for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
            if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
            const t = (y - a[1]) / (b[1] - a[1]);
            r = Math.max(r, Math.hypot(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t));
          }
        }
        return r;
      };
      for (let y = 0.12; y <= 0.8; y += 0.01) assert.ok(cut(core, y) > (y <= 0.72 ? 0.08 : 0.035), `${name} (${tier}): the crown solid at ${y.toFixed(2)} (${cut(core, y).toFixed(3)})`);
      const trunkTop = Math.max(...C.filter(([r]) => r < 0.035).map(([, v]) => v));
      const top = Math.max(...L.map(([, v]) => v));
      assert.ok(top >= 0.99 && trunkTop <= 0.9, `${name} (${tier}): needles to ${top.toFixed(2)}, the trunk inside to ${trunkTop.toFixed(2)}`);
    }
  }
});

test('the grass\'s mask: blades on the lawns and the gardens (at their height), none on the road, the turning area, the pavement, the paths, the drives, the dad\'s corner bed, the mailbox, the bushes, the houses, the walls or the steps up them', () => {
  const m = lawnMask(lane);
  // (W2: the 1.3 plan's lawns, a cell still ~17 square.)
  assert.deepEqual([m.width, m.height], [1280, 608]);
  const at = (x, z) => {
    const i = Math.floor(((x - m.x0) / (m.x1 - m.x0)) * m.width);
    const j = Math.floor(((z - m.z0) / (m.z1 - m.z0)) * m.height);
    return [m.data[(j * m.width + i) * 4], m.data[(j * m.width + i) * 4 + 1] * 4];
  };
  const { DAD, SOUTH_EDGE, HEDGES, PLOTS_N, APRON, wallZAt } = lane;
  const lawns = [[DAD.x0 + 360, SOUTH_EDGE + 150], [600, 1050], [400, 1150], [-2500, HEDGES[0].z1 + 200], [(PLOTS_N[1].steps[1] + PLOTS_N[1].x1) / 2, -1000], [(PLOTS_N[2].steps[1] + PLOTS_N[2].x1) / 2, -1000], [2000, -1100], [-2000, 3000], [5480, 1900]]; // (W5: south_2's front a gravel garden, W5 fix: slabs east of its path too: the lawn past its east end)
  for (const [x, z] of lawns) {
    const [grow, y] = at(x, z);
    assert.equal(grow, 255, `a lawn at ${x}, ${z}`);
    assert.ok(Math.abs(y - lane.groundHeight(x, z)) <= 2, `its height at ${x}, ${z}: ${y}`);
  }
  const bare = {
    road: [0, lane.ROAD.line.at(-1)[1]],
    'turning area': [APRON.ring.x, APRON.ring.z + 800],
    pavement: [-1000, (lane.ROAD.line.at(-1)[1] - lane.ROAD.half + wallZAt(-1000)) / 2],
    path: [DAD.door.x, (SOUTH_EDGE + lane.DAD_PATH.z1) / 2],
    landing: [(lane.LANDING.x0 + lane.LANDING.x1) / 2, (lane.LANDING.z0 + lane.LANDING.z1) / 2],
    drive: [2000, 900],
    'red-leaf bed': [lane.RED_TREE.x, lane.RED_TREE.z],
    "red-leaf bed's corner": [lane.BED.x1 - 60, lane.BED.z0 + 60],
    "red-leaf bed's back corner": [lane.BED.x0 + 50, lane.BED.z1 - 50],
    steps: [(lane.PLOTS_N[3].steps[0] + lane.PLOTS_N[3].steps[1]) / 2, lane.wallZAt(lane.PLOTS_N[3].steps[0]) - 130],
    mailbox: [lane.MAILBOX.x, lane.MAILBOX.z],
    rhododendron: [lane.RHODODENDRON.x, lane.RHODODENDRON.z],
    ivy: [lane.IVY.x, lane.IVY.z],
    rose: [lane.ROSE.x, lane.ROSE.z],
    hedge: [-2500, (HEDGES[0].z0 + HEDGES[0].z1) / 2],
    house: [0, 2000],
    'drive notch': [(PLOTS_N[2].drive[0] + PLOTS_N[2].drive[1]) / 2, wallZAt(PLOTS_N[2].drive[0]) - 240],
    "terrace's wall": [-2000, wallZAt(-2000) - 5],
    forecourt: [lane.FORECOURT.x0 + 300, (lane.FORECOURT.z0 + lane.FORECOURT.z1) / 2],
    footway: [(lane.FOOTWAY.x0 + lane.FOOTWAY.x1) / 2, 0],
    // (W5: south_2's gravel garden, its raised bed and its path; the young beech row's soil.)
    gravel: [3500, 1600],
    'raised bed': [(lane.S2_GARDEN.raised.x0 + lane.S2_GARDEN.raised.x1) / 2, (lane.S2_GARDEN.raised.z0 + lane.S2_GARDEN.raised.z1) / 2],
    "south_2's path": [(lane.S2_GARDEN.path.x0 + lane.S2_GARDEN.path.x1) / 2, 1600],
    // (W5 fix: the slabs east of the path and their beds, round the apron's corner.)
    "south_2's slabs": [5000, 1570],
    "south_2's slabs by the corner": [5100, 1200],
    "south_2's beds": [5300, 1800],
    'beech row': [(lane.BEECH_ROW.x0 + lane.BEECH_ROW.x1) / 2, lane.BEECH_ROW.z],
    'outside the boundary': [-3000, 4450],
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
  // The red-leaf bed's stones (R fixes: the photos' round field stones; W3: its rectangle):
  // close set along all four edges (on the road along the street's, on the drive along his
  // drive's, along the back and the path's side), no granite kerb along it.
  const granite = mesh(high, 'granite').position;
  const B = lane.BED;
  const bins = { street: new Set(), drive: new Set(), back: new Set(), path: new Set(), kerb: 0 };
  for (let i = 0; i < granite.length; i += 3) {
    const [x, y, z] = [granite[i], granite[i + 1], granite[i + 2]];
    if (z > B.z0 - 2 && z < B.z0 + 70 && x > B.x0 + 40 && x < B.x1 - 40) bins.street.add(Math.floor((B.x1 - x) / 100));
    if (x > B.x1 - 70 && x < B.x1 + 2 && z > B.z0 + 40 && z < B.z1 - 40) bins.drive.add(Math.floor((z - B.z0) / 100));
    if (z > B.z1 - 70 && z < B.z1 + 2 && x > B.x0 + 40 && x < B.x1 - 40) bins.back.add(Math.floor((x - B.x0) / 100));
    if (x > B.x0 - 2 && x < B.x0 + 70 && z > B.z0 + 40 && z < B.z1 - 40) bins.path.add(Math.floor((z - B.z0) / 100));
    // (No kerb stone's flat top along the bed's street edge.)
    if (z > B.z0 - 1 && z < B.z0 + 31 && x > B.x0 + 10 && x < B.x1 - 10 && Math.abs(y - lane.GROUND - 1.5) < 0.01) bins.kerb++;
  }
  assert.ok(bins.street.size >= 3 && bins.drive.size >= 5 && bins.back.size >= 3 && bins.path.size >= 5, `stones along the street (${bins.street.size}), the drive (${bins.drive.size}), the back (${bins.back.size}), the path (${bins.path.size})`);
  assert.equal(bins.kerb, 0, 'no kerb along the bed');
});

test('the red-leaf tree (W3 fix): its trunk pale (a light tint over the bark set\'s dark brown) and inside the pole up to the fork, as a lamppost\'s post is; its leader rounded off at the pole\'s top, where Jonas stands', () => {
  const T = lane.RED_TREE;
  for (const [tier, d] of [['high', high], ['low', low]]) {
    const { position: p, color: c } = mesh(d, 'bark');
    let [n, tint, wide, top] = [0, 0, 0, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      const r = Math.hypot(p[i] - T.x, p[i + 2] - T.z);
      if (r < 40 && p[i + 1] < lane.GROUND + T.fork - 30) {
        n++;
        tint += (c[i] + c[i + 1] + c[i + 2]) / 3;
        wide = Math.max(wide, r);
      }
      if (r < 16) top = Math.max(top, p[i + 1]);
    }
    assert.ok(n > 0 && wide <= T.radius, `${tier}: the trunk within the pole's ${T.radius} (${wide.toFixed(1)})`);
    assert.ok(tint / n > 1.5, `${tier}: the trunk's tint pale over the dark bark (${(tint / n).toFixed(2)})`);
    assert.ok(Math.abs(top - T.y1) <= 12, `${tier}: the leader's top at the pole's (${top.toFixed(1)} vs ${T.y1})`);
  }
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
  assert.deepEqual(clusters.map((g) => g.cars), [[0, 1], [2], [3, 4, 5, 6], [7]]); // (W2: the van on north_4's drive with the north drives)
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
  const pieces = roadPieces(lane);
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
      // (Never out in the middle of the street or the turning area: within 100 of an edge.)
      if (onRoad) assert.ok(Array.from({ length: 8 }, (_, k) => [Math.cos(k * 0.785) * 100, Math.sin(k * 0.785) * 100]).some(([dx, dz]) => !pieces.some((piece) => inside(piece, x + dx, z + dz))), `${tier}: a leaf on the road's middle at ${x.toFixed(0)}, ${z.toFixed(0)}`);
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

test('G3\'s details: the double garage\'s downpipes with faint rust under their clips (contact: a rust tint at a streak\'s head fading to nothing at its foot; not on low), the loggias\' iron boxes of flowers (W6; not on low)', () => {
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
  // (W6: north_3's balcony dark-stained wood, photo 17: no boxes on it; the flowers in the iron
  // boxes on the loggias' sills, north_1's and north_3's.) Each loggia box's tufts: not on low.
  for (const id of ['north_1', 'north_3']) {
    const villa = lane.HOUSES.find((h) => h.id === id);
    const l = FACADES[id].loggia;
    const f = frameOf(villa).face('front').f;
    const at = f.at(0, 0, 0);
    const planted = (d) => {
      const p = positionsOf(d, 'foliage');
      let n = 0;
      for (let i = 0; i < p.length; i += 3) {
        const w = (p[i] - at[0]) * f.out[0] + (p[i + 2] - at[2]) * f.out[2];
        const u = (p[i] - at[0]) * f.right[0] + (p[i + 2] - at[2]) * f.right[2];
        const v = p[i + 1] - at[1];
        if (w > -40 && w < 30 && Math.abs(u - l.u) < l.w / 2 && v > l.sill && v < l.sill + 90) n++;
      }
      return n;
    };
    assert.ok(planted(high) > 150 && planted(mid) > 100, `${id}'s loggia box's tufts (${planted(high)} / ${planted(mid)} vertices)`);
    assert.equal(planted(low), 0, `${id}: none on low`);
  }
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

test('D1: the store room\'s things behind the garage doors: inside the room under the slab, clear of its middle (the tube overhead), the tube\'s diffuser glowing (drl; gloss on low), painted dim (darker than their tints), drawn before the dad\'s car; within each tier\'s share', async () => {
  const { garageRoom } = await import('../src/world/lane/real/garage.js');
  const { ROOM } = await import('../src/world/lane/garage.js');
  const G = lane.GARAGE;
  const C = lane.CARPORT;
  for (const [tier, most] of [['high', 3200], ['mid', 2200], ['low', 1500]]) {
    const kit = { tier };
    for (const n of ['paint', 'boards', 'steel', 'metal', 'tyre', 'drl', 'gloss']) kit[n] = new Geo();
    if (tier === 'low') Object.assign(kit, { drl: kit.gloss, steel: kit.metal });
    garageRoom(kit, lane);
    const geos = [...new Set(Object.values(kit).filter((g) => g instanceof Geo))];
    const tris = geos.reduce((n, g) => n + g.count / 3, 0);
    assert.ok(tris > 500 && tris <= most, `${tier}: ${tris} triangles (at most ${most})`);
    for (const g of geos) {
      for (let v = 0; v < g.count; v++) {
        const [x, y, z] = [g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]];
        assert.ok(x >= C.x0 + G.lining && x <= C.x1 - G.lining && z >= G.wall + G.thick && z <= C.z1 - 20 && y >= lane.GROUND - 0.01 && y <= G.under, `${tier}: in the room (${x}, ${y}, ${z})`);
        if (y < ROOM.tube.y) assert.ok(x < 1700 || x > 2380 || z < 2010 || z > 2370, `${tier}: the room's middle free (${x}, ${y}, ${z})`);
        // (Every colour under its tint: the room's light, at most 1.)
        for (let c = 0; c < 3; c++) assert.ok(g.col[v * 3 + c] <= 1.0001, `${tier}: lit no brighter than its tint`);
      }
    }
    // The diffuser: white in drl (gloss on low), under the tube's housing.
    const d = kit.drl;
    let glow = 0;
    for (let v = 0; v < d.count; v++) if (d.col[v * 3] > 0.99 && Math.abs(d.pos[v * 3 + 2] - ROOM.tube.z) < 6) glow++;
    assert.ok(glow >= 24, `${tier}: the tube's diffuser glows (${glow})`);
  }
  // In the detail: drawn before the dad's car in every mesh they share (its hide range intact).
  const at = high.hide.dad_ev;
  assert.ok(at && Object.keys(at).length > 3, 'the dad\'s car still hideable');
});

// A segment from a to b against a triangle soup (flat [x, y, z] x 3 per face): does any face
// turned toward a cut it short of b (Möller–Trumbore)?
function blocked(a, b, tris) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  for (let i = 0; i < tris.length; i += 9) {
    const e1 = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
    const e2 = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (det < 1e-9) continue; // (a face seen from behind is culled: the cars' materials are one-sided)
    const s = [a[0] - tris[i], a[1] - tris[i + 1], a[2] - tris[i + 2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 1e-4 && t < 0.995) return true;
  }
  return false;
}

test('W4 fix: the SUV parked tail out stands on its rear tyres seen tail on from a standing eye (photo 37: its tyres show under the bumper\'s swept-up corners; the deep box of a bumper had hidden them, the car looked afloat); its underside black', () => {
  const suv = lane.CARS.find((c) => c.kind === 'suv' && Math.abs(c.yaw) < 0.01);
  assert.ok(suv, 'the dad\'s SUV, nose in');
  const K = lane.CAR_KINDS.suv;
  for (const tier of ['high', 'mid', 'low']) {
    const kit = { tier };
    for (const name of ['carPaint', 'carGlass', 'tyre', 'rim', 'trim', 'lamp', 'tail', 'metal']) kit[name] = new Geo();
    carOf(kit, lane, suv);
    const tris = [...['carPaint', 'carGlass', 'trim', 'lamp', 'tail', 'metal'].flatMap((n) => kit[n].pos)];
    const { y0, R, axles, at } = carFrame(lane, suv);
    // Photo 37's eye: ~1.8 m up, ~5 m behind the tail, a little toward the gap.
    const eye = at(-117, y0 + 269, -K.l / 2 - 765);
    const yC = y0 + R;
    for (const s of [-1, 1]) {
      // Points up each rear tyre's tread on its tail side, its outer half: the highest seen (the
      // old bumper hid all but its lowest 8, lost in the contact shadow).
      let top = 0;
      for (const du of [4, 10, 16]) {
        for (const h of [8, 16, 24, 32, 40]) {
          const w = axles[1] - Math.sqrt(R * R - (yC - (y0 + h)) ** 2) - 0.5;
          if (!blocked(eye, at(s * (K.w / 2 - 3 - du), y0 + h, w), tris)) top = Math.max(top, h);
        }
      }
      assert.ok(top >= 32, `${tier}: the ${s > 0 ? 'left' : 'right'} rear tyre shows tail on up to ${top} (of its ${Math.round(2 * R)})`);
    }
    // The paint's faces under the floor's knee are covered by the black skin: no paint face low
    // behind the rear arch faces down without trim under it (sampled by rays straight up).
    const paint = kit.carPaint.pos;
    for (const u of [-100, -60, 0, 60, 100]) {
      const w = -K.l / 2 + 20;
      const from = at(u, y0 + 1, w);
      const to = at(u, y0 + K.belt, w);
      assert.ok(blocked(from, to, kit.trim.pos), `${tier}: the bumper's black underside over (${u}, ${w})`);
      assert.ok(blocked(from, to, paint), `${tier}: the body's floor there too`);
    }
  }
});

test('W4 fix: the columnar tree is a lacy poplar (photo 37), not a frustum: leaf cards over its whole crown, out to its width and up to its top, the sky through them; no solid core in it', () => {
  const [t] = lane.COLUMN_TREES;
  const y0 = lane.groundHeight(t.x, t.z);
  for (const [tier, d] of [['high', high], ['low', low]]) {
    const near = (p) => {
      const out = [];
      for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - t.x, p[i + 2] - t.z) < t.r * 1.6) out.push([Math.hypot(p[i] - t.x, p[i + 2] - t.z), p[i + 1] - y0]);
      return out;
    };
    const leaves = near(positionsOf(d, 'foliage'));
    assert.ok(leaves.length / 6 >= (tier === 'high' ? 3000 : 1500), `${tier}: ${leaves.length / 6} cards`);
    assert.ok(Math.max(...leaves.map(([, y]) => y)) > t.h * 0.97, `${tier}: up to its top`);
    const band = (f0, f1) => leaves.filter(([, y]) => y > t.h * f0 && y < t.h * f1).map(([r]) => r);
    assert.ok(Math.max(...band(0.35, 0.5)) > t.r * 0.85, `${tier}: out to its widest low`);
    assert.ok(Math.max(...band(0.8, 0.9)) < t.r * 0.8, `${tier}: slim above`);
    // No core: nothing of the dark cores' mesh in its crown.
    assert.equal(near(positionsOf(d, 'core')).filter(([, y]) => y > t.h * 0.2).length, 0, `${tier}: no solid core`);
  }
});

test('W6 fix: nothing but its door in a recess at the floor: no lawn crossing a garage\'s, a niche\'s or a board door\'s opening in either build (the terraces\' lawn behind a drive drawn from FLOOR_SET behind its villa\'s front, under the house), the garages\' ribs on a plate (no joint shows what is behind the door), north_2\'s garage flat-headed (photo 13)', () => {
  assert.ok(!FACADES.north_2.garage.rise && !FACADES.north_2.garage.round, 'north_2\'s garage: a flat head');
  // Each programmed villa's openings at the floor: its x range and how deep its door stands back.
  const recesses = [];
  for (const plot of lane.PLOTS_N) {
    const h = lane.villaOf(plot);
    const P = FACADES[h.id];
    for (const [o, depth] of [[P.garage, GARAGE_SET], [P.niche, P.niche?.depth], [P.door, DOOR_SET]]) {
      if (!o) continue;
      const [x0, x1] = [h.cx + o.u - o.w / 2, h.cx + o.u + o.w / 2];
      assert.ok(x0 > plot.drive[0] && x1 < plot.drive[1], `${h.id}: its opening at the floor over its drive (${x0} .. ${x1})`);
      assert.ok(depth > 0 && depth < FLOOR_SET - 10, `${h.id}: its door ${depth} back, the lawn ${FLOOR_SET}`);
      recesses.push({ id: h.id, x0, x1, front: h.front, depth });
    }
  }
  assert.ok(recesses.length >= 9, `the floors' openings (${recesses.length})`);
  // A lawn triangle at the terrace's height over (x, z)?
  const covers = (p, x, z) => {
    for (let i = 0; i < p.length; i += 9) {
      if (![1, 4, 7].every((k) => Math.abs(p[i + k] - lane.TERRACE) < 1)) continue;
      const t = [0, 3, 6].map((k) => [p[i + k] - x, p[i + k + 2] - z]);
      const s = [0, 1, 2].map((k) => t[k][0] * t[(k + 1) % 3][1] - t[k][1] * t[(k + 1) % 3][0]);
      if (s.every((q) => q > 0) || s.every((q) => q < 0)) return true;
    }
    return false;
  };
  for (const look of ['classic', 'real']) {
    const part = buildLane(lane, { look, materials: {} });
    let grass = null;
    part.object3D.traverse((o) => o.isMesh && o.name === 'lane-grass' && (grass = o.geometry));
    assert.ok(grass, `${look}: the lawn`);
    const g = grass.index ? grass.toNonIndexed() : grass;
    const p = g.attributes.position.array;
    for (const r of recesses) {
      for (const k of [0.1, 0.5, 0.9]) for (const d of [0.5, r.depth / 2, r.depth - 0.5]) assert.ok(!covers(p, r.x0 + (r.x1 - r.x0) * k, r.front - d), `${look}: ${r.id}'s lawn across its opening ${d.toFixed(1)} in`);
    }
    // (The lawn still reaches the villa's walls beside and behind it: under the house, past them.)
    for (const plot of lane.PLOTS_N) assert.ok(covers(p, (plot.drive[0] + plot.drive[1]) / 2, lane.villaOf(plot).front - FLOOR_SET - 20), `${look}: ${plot.id}'s lawn under its house`);
  }
  // The garages' plates: on the door's plane, under every joint between its ribs.
  for (const [tier, d] of [['high', high], ['low', low]]) {
    const paint = positionsOf(d, 'paint');
    for (const plot of lane.PLOTS_N) {
      const h = lane.villaOf(plot);
      const gd = FACADES[h.id].garage;
      if (!gd) continue;
      const f = frameOf(h).face('front').f;
      const o = f.at(0, 0, 0);
      const local = (i) => [(paint[i] - o[0]) * f.right[0] + (paint[i + 2] - o[2]) * f.right[2], paint[i + 1] - o[1], (paint[i] - o[0]) * f.out[0] + (paint[i + 2] - o[2]) * f.out[2]];
      const tris = [];
      for (let i = 0; i < paint.length; i += 9) {
        const t = [0, 3, 6].map((k) => local(i + k));
        if (t.every(([, , w]) => Math.abs(w + GARAGE_SET) < 0.05)) tris.push(t);
      }
      const spring = gd.h - (gd.rise || gd.round || 0);
      for (const v of [3, spring * 0.26, spring * 0.51, spring * 0.77, spring - 3]) {
        for (const u of [gd.u - gd.w * 0.4, gd.u + 7.3, gd.u + gd.w * 0.4]) {
          const hit = tris.some((t) => {
            const s = [0, 1, 2].map((k) => (t[k][0] - u) * (t[(k + 1) % 3][1] - v) - (t[k][1] - v) * (t[(k + 1) % 3][0] - u));
            return s.every((q) => q > 0) || s.every((q) => q < 0);
          });
          assert.ok(hit, `${tier}: ${h.id}'s garage door's plate at (${u.toFixed(0)}, ${v.toFixed(0)})`);
        }
      }
    }
  }
});
