// Sparrow Lane's realistic build (world/lane/real/look.js, lane/build.js look 'real'): visuals
// only. Its colliders are the classic build's to the byte (so the routes, the camera's world and
// every lane test hold whichever look is drawn), it draws exactly the classic faces but the
// elements it draws itself (REAL_DRAWN: the worker's world/lane/real/detail.js) with its turning
// area drawn round (plus a dim room behind each bay window's pane), split into the realistic
// look's meshes by part (the panes in glass, the painted parts in paint, the dad's path),
// unbaked, its lawns' tints grey, its roofs' uvs up their slopes, no NaN anywhere, within the
// triangle budget; every mesh gets its catalogue material (the worker's its detail material:
// leaf cards, lacquer, the flat shadow stand-in, the grass), the glass the reflection probe, the
// signs the classic look; the plants sway and the grass follows the camera; the pause legend's
// retro row names G there; and the realistic sources stay private and original (no image files,
// nothing loaded).
import { test } from 'node:test';
import { GRASS } from '../src/world/lane/real/grassTiers.js';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import * as lane from '../src/world/lane/layout.js';
import { buildLane, REPEAT, REAL_DRAWN } from '../src/world/lane/build.js';
import { streetWear } from '../src/world/lane/surface.js';
import { bedSpots } from '../src/world/lane/facades.js';
import { terraceSpans } from '../src/world/lane/real/plan.js';
import { buildLaneReal, laneJobs } from '../src/world/lane/real/look.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';
import { TextureStore } from '../src/render/real/textureStore.js';
import { generate } from '../src/render/real/texgen/sets.js';
import { jobKey } from '../src/render/real/texgen/jobs.js';
import { TIERS } from '../src/render/real/tier.js';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import { KEY_CONTROLS, PAD_CONTROLS, REAL_LOOK_ROW, CLASSIC_LOOK_ROW, pauseLayout, phoneEntry } from '../src/ui/hudLogic.js';
import { controlsLegend } from '../src/ui/pauseScreen.js';
import { SMALL_FONT, measureText } from '../src/ui/bitmapFont.js';

const classic = buildLane(lane);
const real = buildLane(lane, { look: 'real', materials: {} });
// The classic look without what the realistic one draws itself, its turning area drawn round.
const kept = buildLane(lane, { replaced: REAL_DRAWN });
const meshes = (part) => {
  const out = {};
  part.object3D.traverse((o) => o.isMesh && (out[o.name] = o));
  return out;
};
const C = meshes(kept);
const R = meshes(real);
const linear = (hex) => new THREE.Color(hex);
const ROOM = linear(0x4a4640);

// The triangles of a mesh as sorted strings of their corners (positions to 0.01), optionally
// leaving out those whose first vertex's colour is `skip`.
function triangles(mesh, skip = null) {
  const p = mesh.geometry.attributes.position;
  const c = mesh.geometry.attributes.color;
  const out = [];
  for (let i = 0; i < p.count; i += 3) {
    if (skip && Math.abs(c.getX(i) - skip.r) < 1e-6 && Math.abs(c.getY(i) - skip.g) < 1e-6 && Math.abs(c.getZ(i) - skip.b) < 1e-6) continue;
    const v = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)].map((x) => x.toFixed(2)).join(','));
    out.push(v.sort().join(' '));
  }
  return out;
}

test('the realistic build\'s colliders are the classic build\'s to the byte, and as an area its collision, entries, coins, signs, doors, poles and bounds are the same', () => {
  assert.equal(JSON.stringify(real.colliders), JSON.stringify(classic.colliders));
  assert.equal(real.colliders.length, classic.colliders.length);
  assert.deepEqual(Object.keys(real).sort(), Object.keys(classic).sort());
  assert.equal(real.poles, classic.poles);
  // As world/area.js places them: the realistic part as the area's builder gives the same world.
  const def = AREA_DEFS.lane;
  const a = buildArea(new THREE.Scene(), def);
  const b = buildArea(new THREE.Scene(), { ...def, builders: [(L) => buildLane(L, { look: 'real', materials: {} })] });
  const world = (area) =>
    JSON.stringify({
      floor: [[0, 1156], [1050, 850], [-3000, -2000], [4580, -1650]].map(([x, z]) => area.groundAt(x + def.origin.x, z + def.origin.z)),
      entries: area.entries,
      respawn: area.respawn,
      layout: area.objectsLayout,
      signs: area.signs,
    });
  assert.equal(world(b), world(a));
  assert.ok(a.collision.surfaces.length > 1000);
  assert.equal(JSON.stringify(b.collision.surfaces), JSON.stringify(a.collision.surfaces), 'the collision worlds\' surfaces');
  assert.equal(JSON.stringify(b.collision.poles), JSON.stringify(a.collision.poles), 'the poles');
});

test('it draws exactly the classic faces but those it draws itself, the panes in glass, the painted parts in paint and the dad\'s path in path, and no room of its own (every window\'s is the worker\'s); unbaked, no NaN', () => {
  // (The classic meshes the realistic look draws nothing of are left out: the leaves and the wood.)
  const drawn = Object.keys(C).filter((name) => C[name].geometry.attributes.position.count > 0);
  assert.deepEqual(Object.keys(R).sort(), [...drawn, 'lane-glass', 'lane-paint', 'lane-path'].sort());
  assert.deepEqual(Object.keys(C).filter((name) => !drawn.includes(name)).sort(), ['lane-leaves', 'lane-wood']);
  for (const name of drawn) {
    if (name === 'lane-render' || name === 'lane-grass') continue;
    assert.deepEqual(triangles(R[name]).sort(), triangles(C[name]).sort(), name);
  }
  const split = [...triangles(R['lane-render']), ...triangles(R['lane-glass']), ...triangles(R['lane-paint'], ROOM)];
  assert.deepEqual(split.sort(), triangles(C['lane-render']).sort(), 'render = render + glass + paint');
  assert.deepEqual([...triangles(R['lane-grass']), ...triangles(R['lane-path'])].sort(), triangles(C['lane-grass']).sort(), 'grass = grass + path');
  // No room panel: every window with a room behind it, the villas' bays too, is the worker's (its
  // rooms are boxes behind real openings).
  const rooms = triangles(R['lane-paint']).length - triangles(R['lane-paint'], ROOM).length;
  assert.equal(rooms, 0, `${rooms} room triangles`);
  // What it draws itself is drawn by nobody else: the classic build's own (the realistic one
  // keeps a round turning area's faces, not the 16-gon's; the forest's cones, the hedges' boxes,
  // the cars' boxes and the chain houses' walls are gone).
  const all = (part) => {
    let n = 0;
    part.object3D.traverse((o) => o.isMesh && (n += o.geometry.attributes.position.count / 3));
    return n;
  };
  assert.ok(all(real) < 0.7 * all(classic), `${all(real)} of the classic build's ${all(classic)} triangles`);
  // The glass: only the panes' and glints' tints (both look through to a room).
  const glass = R['lane-glass'].geometry.attributes.color;
  const tints = [0x2c3a46, 0x6c7c8a].map(linear);
  for (let i = 0; i < glass.count; i++) {
    const ok = tints.some((t) => [glass.getX(i) / t.r, glass.getY(i) / t.g, glass.getZ(i) / t.b].every((k, _, a) => Math.abs(k - a[0]) < 1e-4));
    assert.ok(ok, `glass vertex ${i}: a pane's tint`);
  }
  // Unbaked: the link's yellow boards are its tint itself (the bake's light is not in it).
  const boards = R['lane-boards'].geometry.attributes;
  const K = lane.LINK;
  const yellow = linear(K.boards);
  let max = 0;
  for (let i = 0; i < boards.color.count; i++) {
    const [x, z] = [boards.position.getX(i), boards.position.getZ(i)];
    if (x > K.x0 - 1 && x < K.x1 + 1 && z > K.z0 - 1 && z < K.z1 + 1) max = Math.max(max, boards.color.getX(i) / yellow.r);
  }
  assert.ok(max > 0.99 && max < 1.01, `the brightest board vertex is the tint: ${max}`);
  for (const [name, m] of Object.entries(R)) {
    for (const attr of Object.values(m.geometry.attributes)) {
      for (let i = 0; i < attr.array.length; i++) assert.ok(Number.isFinite(attr.array[i]), `${name}: finite`);
    }
  }
});

test('its lawns are grey tints (the lawn texture is green), its roofs\' uvs run up their slopes, and it stays within the triangle budget', () => {
  const g = R['lane-grass'].geometry.attributes.color;
  for (let i = 0; i < g.count; i++) assert.ok(g.getX(i) === g.getY(i) && g.getY(i) === g.getZ(i) && g.getX(i) <= 1.2, 'grey');
  // A slope's v grows up it, its u along the contour; flat roofs keep their projected uvs.
  const roof = R['lane-roof'].geometry;
  const p = roof.attributes.position;
  const uv = roof.attributes.uv;
  const n = roof.attributes.normal;
  let slopes = 0;
  for (let i = 0; i < p.count; i += 3) {
    if (n.getY(i) < 0.2 || n.getY(i) > 0.995) continue;
    slopes++;
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      const dy = p.getY(i + b) - p.getY(i + a);
      const dv = uv.getY(i + b) - uv.getY(i + a);
      const run = Math.hypot(p.getX(i + b) - p.getX(i + a), dy, p.getZ(i + b) - p.getZ(i + a));
      // Up the slope by dy means dv = dy / sin(pitch) / repeat, never against it.
      if (Math.abs(dy) > 1) assert.ok(Math.sign(dv) === Math.sign(dy), `roof triangle ${i / 3}: v up the slope`);
      assert.ok(Math.abs(dv) * REPEAT.roof <= run + 0.01, 'v in world units');
    }
  }
  assert.ok(slopes > 20, `${slopes} slope triangles`);
  let tris = 0;
  for (const m of Object.values(R)) tris += m.geometry.attributes.position.count / 3;
  let classicTris = 0;
  for (const m of Object.values(C)) classicTris += m.geometry.attributes.position.count / 3;
  // (R1: the classic geometry; section 7's budgets are for the frame, the shadow pass included.)
  assert.ok(tris < classicTris * 1.05 && tris < 100000, `${tris} triangles (classic ${classicTris})`);
});

test('P3: the street worn and patched in both looks: the patches and long seal bands one dark tint (~0.6 of the road\'s, drifting with place) at one height under the litter\'s lip, ~28 % of the carriageway, islands of the old asphalt, the covers grey-rust and grated; the bed walls\' faces in finer, longer slabs than the steps', () => {
  const W = streetWear(lane);
  const area = (p) => Math.abs(p.reduce((s, [x, z], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * z, 0)) / 2;
  const len = lane.ROAD.line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - lane.ROAD.line[i][0], p[1] - lane.ROAD.line[i][1]), 0);
  const A = lane.APRON;
  const share = W.patches.reduce((s, p) => s + area(p), 0) / (len * 2 * lane.ROAD.half + (A.x1 - A.x0) * (A.z1 - A.z0));
  assert.ok(W.patches.length >= 40 && W.patches.length <= 60 && share > 0.25 && share < 0.33, `${W.patches.length} patches, ${share.toFixed(3)} of the carriageway`);
  assert.ok(W.patches.every((p) => p.length >= 16 && p.every(([x, z]) => lane.inApron(x, z) || Math.abs(z - lane.ROAD.line.at(-1)[1]) < lane.ROAD.half || x < lane.ROAD.line.at(-2)[0])), 'ragged, on the carriageway');
  assert.equal(W.long.length, 3);
  assert.ok(W.islands.length > 5 && W.covers.length === 9);
  const lum = (c, i) => 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
  for (const [look, part] of [['classic', classic], ['realistic', real]]) {
    const g = meshes(part)['lane-asphalt'].geometry;
    const [p, c] = [g.attributes.position.array, g.attributes.color.array];
    const at = (y, x0 = -7000, x1 = 2700) => {
      const out = [];
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 1] - y) < 0.01 && p[i] > x0 && p[i] < x1 && Math.abs(p[i + 2] + 90) < lane.ROAD.half) out.push(lum(c, i));
      return out.sort((u, v) => u - v);
    };
    const road = at(0);
    const r = road[road.length >> 1];
    const patch = at(0.5);
    assert.ok(patch.length > 600, `${look}: the patches' and long bands' vertices (${patch.length})`);
    const [lo, hi] = [patch[0] / r, patch.at(-1) / r];
    if (look === 'realistic') assert.ok(lo > 0.4 && hi < 0.75 && hi - lo > 0.1, `${look}: the patches ${lo.toFixed(2)} .. ${hi.toFixed(2)} the road's (linear)`);
    else assert.ok(hi < 0.85 && hi - lo > 0.1, `${look}: the patches ${lo.toFixed(2)} .. ${hi.toFixed(2)} the road's, baked`);
    const island = at(0.55);
    assert.ok(island.length > 50 && island[island.length >> 1] > patch[patch.length >> 1] * 1.3, `${look}: islands lighter than the patches round them`);
    // The covers' faces (at 0.95) grey-rust, near the road's own tone; the slots darker.
    const face = [];
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 1] - 0.95) < 0.01) face.push([c[i], c[i + 1], c[i + 2]]);
    assert.ok(face.length > 9 * 20, `${look}: the covers' faces`);
    for (const [cr, cg, cb] of face) assert.ok(cr > cg && cg > cb, `${look}: a cover rusty grey (${cr.toFixed(3)}, ${cg.toFixed(3)}, ${cb.toFixed(3)})`);
  }
  // The bed walls' faces: v per unit 2.8 times the steps' risers' (W6's courses ~2.8x finer), u 1.1.
  const b = meshes(classic)['lane-blocks'].geometry.attributes;
  const rate = (pick) => {
    for (let i = 0; i < b.position.count; i += 3) {
      if (![0, 1, 2].every((k) => pick(i + k))) continue;
      for (const [u, v] of [[0, 1], [1, 2], [0, 2]]) {
        const dy = b.position.getY(i + v) - b.position.getY(i + u);
        if (Math.abs(dy) > 20) return ((b.uv.getY(i + v) - b.uv.getY(i + u)) / dy) * REPEAT.blocks;
      }
    }
    return 0;
  };
  // (A face's triangle over 20 high: the wall's under its 13-high cap; a step's riser 25.6.)
  const wallZ = (i) => Math.abs(b.position.getZ(i) - lane.wallZAt(b.position.getX(i))) < 0.5 && Math.abs(b.normal.getZ(i)) > 0.9;
  const plot = lane.PLOTS_N[2];
  const wall = rate((i) => wallZ(i) && b.position.getX(i) >= plot.x0 - 1 && b.position.getX(i) <= plot.drive[0] + 1);
  const riser = rate((i) => b.position.getX(i) >= plot.steps[0] - 1 && b.position.getX(i) <= plot.steps[1] + 1 && Math.abs(b.normal.getZ(i)) > 0.9 && b.position.getY(i) > lane.GROUND - 1 && b.position.getZ(i) < lane.wallZAt(plot.steps[0]) - 5);
  assert.ok(Math.abs(Math.abs(wall) - 2.8) < 0.01 && Math.abs(Math.abs(riser) - 1) < 0.01, `the wall's courses ${wall}, the steps' ${riser}`);
});

test('P3: the beds each plot\'s own (north_5\'s cosmos and coneflowers from north_4\'s steps on, north_3\'s and north_4\'s grasses, box balls and hostas, north_2\'s yews, boulders and box), every plant inside its strip\'s span (clear of the steps\' railings and the drives), the maple and pink plumes behind north_2\'s hedge clear of its top and of F1', () => {
  const spans = terraceSpans(lane);
  for (const step of [95, 140, 165, 900]) {
    const spots = bedSpots(lane, spans, step);
    const strip = spots.filter((p) => !p.behind);
    for (const p of strip) {
      const span = spans.flatMap((t) => t.spans).find((q) => q.kind === 'wall' && p.x > q.a && p.x < q.b);
      assert.ok(span && Math.abs(p.room - Math.min(p.x - span.a, span.b - p.x)) < 1e-6, `${step}: a plant at ${p.x.toFixed(0)} inside its span`);
      assert.ok(p.z < lane.wallZAt(p.x) - 30 && p.z > lane.wallZAt(p.x) - lane.NORTH.top, 'in the strip');
    }
    if (step > 200) continue;
    const share = (x0, x1, kinds) => strip.filter((p) => p.x > x0 && p.x < x1 && kinds.includes(p.kind)).length / strip.filter((p) => p.x > x0 && p.x < x1).length;
    assert.ok(share(4400, 1e5, [5, 6]) > 0.6, `${step}: north_5's flowers`);
    assert.ok(share(-2022, 4400, [0, 2, 7]) > 0.6, `${step}: the grasses, box and hostas`);
    assert.ok(share(-5261, -2022, [1, 8, 0, 7, 2, 3, 9]) === 1, `${step}: north_2's`);
    const H = lane.HEDGES.find((h) => h.clipped);
    const F = lane.FLAGPOLES.find((f) => f.id === 'F1');
    const behind = spots.filter((p) => p.behind);
    assert.equal(behind.length, 4);
    for (const p of behind) assert.ok(p.x > H.x0 && p.x < H.x1 && p.z < H.z0 - 60 && p.y === H.y0 && Math.hypot(p.x - F.x, p.z - F.z) > 300, 'behind the hedge on its terrace');
  }
});

test("south_2's flush edging (W5 fix) in the kerbs' light grey in both looks, never a colour left over from what was drawn before it", () => {
  const E = lane.S2_GARDEN.edging;
  const tops = (part, y) => {
    const m = meshes(part)['lane-blocks'];
    const [p, c, n] = ['position', 'color', 'normal'].map((k) => m.geometry.attributes[k]);
    const out = [];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - y) > 0.01 || n.getY(i) < 0.99) continue; // (the tops only)
      const inside = p.getX(i) > E.x0 - 1 && p.getX(i) < E.x1 + 1 && p.getZ(i) > E.z - 1 && p.getZ(i) < E.z + E.w + 1;
      out.push({ inside, rgb: [c.getX(i), c.getY(i), c.getZ(i)] });
    }
    return out;
  };
  const G = lane.GROUND;
  // (Classic: baked as the kerbs' tops, at 0.95 of their tint where theirs is 1.05.)
  const kerb = tops(classic, G + 1.5).filter((v) => !v.inside).map((v) => v.rgb);
  assert.ok(kerb.length > 100, 'the kerbs\' tops');
  const want = [0, 1, 2].map((k) => (kerb.map((v) => v[k]).sort((a, b) => a - b)[kerb.length >> 1] * 0.95) / 1.05);
  for (const [look, part, rgb] of [['classic', classic, want], ['realistic', real, linear(0xb8b2a8).multiplyScalar(0.95).toArray()]]) {
    const edge = tops(part, G + 1.2).filter((v) => v.inside);
    assert.ok(edge.length >= 4, `${look}: the edging's top`);
    for (const v of edge) assert.ok(v.rgb.every((x, k) => Math.abs(x - rgb[k]) < 0.01), `${look}: the edging's top ${v.rgb.map((x) => x.toFixed(3))} for ${rgb.map((x) => x.toFixed(3))}`);
  }
});

test('the realistic lane: each mesh in its catalogue material, shadows cast by all but the ground and the glass (on low not by the small things either), the glass on the probe, the signs classic', () => {
  const tier = TIERS.low;
  const store = new TextureStore({ worker: { postMessage() {}, terminate() {} } });
  for (const job of laneJobs(tier)) store.sets.set(jobKey(job), generate({ ...job, size: 16 }));
  const origin = AREA_DEFS.lane.origin;
  const { part, look } = buildLaneReal(lane, { store, tier, origin, anisotropy: 2 });
  assert.equal(JSON.stringify(part.colliders), JSON.stringify(classic.colliders));
  const M = meshes(part);
  for (const [name, m] of Object.entries(M)) {
    const mat = m.material;
    if (name === 'lane-signs') {
      assert.ok(mat.isMeshBasicMaterial, 'the signs stay unlit');
      assert.equal(mat.toneMapped, false, 'not tone mapped on the low tier\'s direct path');
      continue;
    }
    assert.ok(mat.isMeshStandardMaterial, `${name}: physically based`);
    assert.equal(mat.fog, false, `${name}: hazed, not fogged`);
    assert.match(mat.customProgramCacheKey(), /^real-/, name);
    assert.equal(m.receiveShadow, true, name);
    // (On low the small things cast none: the signs, the flags, the door's leaf, the cable.)
    assert.equal(m.castShadow, !['lane-asphalt', 'lane-grass', 'lane-cobbles', 'lane-path', 'lane-glass', 'lane-signs', 'lane-cloth', 'lane-door', 'lane-cable'].includes(name), `${name} casts`);
  }
  assert.ok(M['lane-glass'].material.isMeshStandardMaterial && M['lane-glass'].material.transparent && M['lane-glass'].material.userData.ior === 2.2);
  assert.deepEqual(look.probeMaterials, [M['lane-glass'].material], 'the glass reflects the probe');
  assert.deepEqual(look.probeAt, { x: origin.x, y: 260, z: 250 });
  // Textured materials repeat their set over the catalogue's cover: the boards' 240 units.
  const boards = M['lane-boards'].material;
  assert.ok(Math.abs(boards.map.repeat.x - REPEAT.boards / 240) < 1e-9 && boards.map.repeat.x === boards.normalMap.repeat.x);
  assert.equal(boards.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(boards.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(boards.aoMap, boards.roughnessMap, 'one ORM map');
  // The flags still wave, the dad's door still turns.
  const flags = M['lane-cloth'].geometry.attributes.position.array.slice();
  part.update(1.3);
  assert.notDeepEqual(M['lane-cloth'].geometry.attributes.position.array, flags);
  part.setDoorOpen(1, 'lane_home');
  assert.ok(M['lane-door'].rotation.y > 1.2);
  look.dispose();
});

test('the worker\'s detail in the realistic lane: every mesh in its detail material (leaf cards alpha-tested and swaying, the cars lacquered, the tiles casting through their flat stand-in), the firs instanced, the grass following the camera, every caster under the near shadow camera\'s heights (W1 fix)', () => {
  for (const tierName of ['high', 'low']) {
    const tier = TIERS[tierName];
    const store = new TextureStore({ worker: { postMessage() {}, terminate() {} } });
    for (const job of laneJobs(tier)) store.sets.set(jobKey(job), generate({ ...job, size: 16 }));
    const detail = buildLaneDetail(lane, tierName);
    const { part, look } = buildLaneReal(lane, { store, tier, origin: AREA_DEFS.lane.origin, anisotropy: 2, detail });
    const D = {};
    part.object3D.getObjectByName('lane-detail').traverse((o) => o.isMesh && (D[o.name] = o));
    assert.equal(Object.keys(D).length, detail.meshes.length + 2 + (detail.grass ? 1 : 0) + 1, `${tierName}: a mesh each (the far canopy's among them), the firs' two parts (P1: one spruce, no far tree line), the grass, the bins`);
    // The bins: a mover, one bin instanced at each home, in the detail's paint, casting.
    const bins = D['lane-detail-bins'];
    assert.ok(bins.isInstancedMesh && bins.count === lane.BINS.length && bins === part.movers.bins && bins.material === D['lane-detail-paint'].material && bins.castShadow, `${tierName}: the bins' mover`);
    // (P1: the far canopy in the foliage material itself, no program or draw call more but its
    // own, casting none: drawn once a frame.)
    const canopy = D['lane-detail-canopy'];
    assert.ok(canopy && canopy.material === D['lane-detail-foliage'].material && !canopy.castShadow, 'the far canopy: the foliage material, casting none');
    // (W1 fix) Every caster under the top of the heights the near shadow camera's depth holds
    // (RealLook shadowFar: shadowBox's, over the bank's firs' tops), the build's own boxes.
    part.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let top = -Infinity;
    part.object3D.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      if (o.isInstancedMesh) o.computeBoundingBox();
      else o.geometry.computeBoundingBox();
      box.copy(o.isInstancedMesh ? o.boundingBox : o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      top = Math.max(top, box.max.y + AREA_DEFS.lane.origin.y);
    });
    assert.deepEqual(look.heights, [AREA_DEFS.lane.origin.y - 100, AREA_DEFS.lane.origin.y + 3200]);
    assert.ok(top > (tierName === 'high' ? 3000 : 1000) && top < look.heights[1], `${tierName}: the casters' top ${top}`);
    for (const [name, m] of Object.entries(D)) {
      if (name === 'lane-detail-shadow') {
        assert.ok(m.material.isMeshBasicMaterial && !m.material.colorWrite && !m.material.depthWrite && m.castShadow, 'the stand-in only casts');
        continue;
      }
      if (name === 'lane-detail-contact') {
        // The cars' contact shadows: multiplying what is drawn under them, writing no depth,
        // casting none.
        const c = m.material;
        assert.ok(c.isMeshBasicMaterial && c.transparent && !c.depthWrite && c.blending === THREE.CustomBlending && c.blendSrc === THREE.ZeroFactor && c.blendDst === THREE.SrcColorFactor && !m.castShadow);
        assert.equal(c.customProgramCacheKey(), 'real-contact');
        continue;
      }
      assert.ok(m.material.isMeshStandardMaterial && m.material.fog === false, `${name}: physically based, hazed`);
      assert.match(m.material.customProgramCacheKey(), /^real-/, name);
      for (const attr of Object.values(m.geometry.attributes)) for (const v of attr.array) assert.ok(Number.isFinite(v), `${name}: finite`);
    }
    const leaves = D['lane-detail-foliage'].material;
    // (Its own program with the far shadow map: high, not low.)
    const far = tier.far > 0 ? '-far' : '';
    assert.equal(leaves.customProgramCacheKey(), `real-foliage${far}`);
    assert.ok(leaves.alphaTest > 0 && leaves.side === THREE.DoubleSide && leaves.map.mipmaps.length > 1, 'alpha-tested cards, coverage mips');
    assert.equal(leaves.alphaToCoverage, tier.samples > 0, 'alpha to coverage with MSAA');
    assert.ok(D['lane-detail-foliage'].geometry.attributes.sway, 'the cards sway');
    // The cars' lacquer (each cluster's on its own probe; on low one paint on the sky's
    // environment), the villas' windows on theirs.
    const paints = Object.entries(D).filter(([name]) => name.startsWith('lane-detail-carPaint'));
    assert.equal(paints.length, tierName === 'low' ? 1 : 4, `${tierName}: the cars' paints`);
    for (const [name, m] of paints) {
      assert.equal(m.material.customProgramCacheKey(), `real-coat${far}`, `${name}: lacquer`);
      assert.ok(m.material.defines.USE_CLEARCOAT !== undefined);
    }
    if (tierName === 'high') {
      const names = look.probeNames();
      assert.deepEqual(names, ['car0', 'car1', 'car2', 'car3', 'street', 'north'], 'the cars\' probes first');
      for (let k = 0; k < 4; k++) {
        const p = look.probes.get(`car${k}`);
        assert.equal(p.size, 128);
        assert.deepEqual(p.materials, [D[`lane-detail-carPaint@${k}`].material, D[`lane-detail-carGlass@${k}`].material], `cluster ${k}: its paint and glass on its probe`);
      }
      assert.deepEqual(look.probes.get('north').materials, [D['lane-detail-glass@north'].material], 'the villas\' windows on theirs');
      assert.ok(look.probes.get('north').at.z < AREA_DEFS.lane.origin.z, 'over the street in front of them');
    } else assert.deepEqual(look.probeNames(), [], 'no probes on low');
    const firs = D['lane-detail-fir-leaves'];
    assert.ok(firs.isInstancedMesh && firs.count === detail.firs.matrices.length / 16, `${firs.count} firs`);
    // (W7: the forest a mixed canopy; P1: ~6 % of the bank's and ~15 % of the ring's trees
    // spruces, one spruce on every tier: real/spots.js.)
    assert.ok(firs.count >= 8 && firs.count <= 25, `${firs.count} firs`);
    assert.ok(!Object.keys(D).some((n) => /-far$|-edge$/.test(n)), 'no far tree line, no second spruce');
    assert.equal(firs.castShadow, tierName !== 'low', 'the firs cast but on low');
    assert.ok(look.probeMaterials.includes(D['lane-detail-glass'].material), 'the detail\'s windows reflect the probe');
    if (tierName === 'high') {
      assert.equal(D['lane-detail-tiles'].castShadow, false, 'the tile courses cast none themselves');
      // The grass: its grid moves with the camera, a cell at a time; the wind's phase with the clock.
      const grass = D['lane-detail-grass'];
      assert.ok(grass.geometry.isInstancedBufferGeometry && grass.geometry.attributes.cell.count === 128 * 128 && grass.frustumCulled === false);
      // Its cells nearest the grid's middle first: drawn, the disc within the blades' reach (the
      // corners beyond it faded out anyway); a shorter reach (the governor's) draws fewer.
      const cells = grass.geometry.attributes.cell;
      const off = (i) => (cells.getX(i) - 63.5) ** 2 + (cells.getY(i) - 63.5) ** 2;
      for (let i = 1; i < cells.count; i++) assert.ok(off(i) >= off(i - 1), 'nearest first');
      const all = grass.geometry.instanceCount;
      assert.ok(all < 128 * 128 && all > Math.PI * (GRASS.high.radius / 12) ** 2, `${all} cells within reach`); // (W7: the radius 735, the far ring's lever; W8: 725)
      look.grass(0.5);
      assert.ok(grass.geometry.instanceCount < all * 0.3 && grass.visible, 'half the reach: a quarter the cells');
      look.grass(0);
      assert.ok(grass.geometry.instanceCount === 0 && !grass.visible, 'none');
      look.grass(1);
      assert.equal(grass.geometry.instanceCount, all);
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(AREA_DEFS.lane.origin.x + 500, 300, AREA_DEFS.lane.origin.z + 900);
      camera.lookAt(AREA_DEFS.lane.origin.x + 500, 0, AREA_DEFS.lane.origin.z + 2000);
      camera.updateMatrixWorld();
      const root = new THREE.Group();
      root.position.set(AREA_DEFS.lane.origin.x, AREA_DEFS.lane.origin.y, AREA_DEFS.lane.origin.z);
      root.add(part.object3D);
      root.updateMatrixWorld(true);
      const grid = [];
      part.update(2, camera);
      const shader = { uniforms: {}, vertexShader: '#include <color_vertex>\n#include <begin_vertex>', fragmentShader: '#include <fog_fragment>' };
      grass.material.onBeforeCompile(shader);
      grid.push(shader.uniforms.uGrid.value.clone(), shader.uniforms.uWind.value.z);
      assert.ok(Math.abs(grid[0].x / 12 - Math.round(grid[0].x / 12)) < 1e-9, 'snapped to whole cells');
      // (Its middle ahead of the camera: 500 across, from z 900 toward 2000.)
      assert.ok(Math.abs(shader.uniforms.uGridMiddle.value.x - 500) < 1 && shader.uniforms.uGridMiddle.value.y > 900, 'ahead of the camera');
      assert.ok(grid[1] > 0, 'the wind\'s phase runs');
    }
    look.dispose();
  }
});

test('B4, the fight\'s budgets: on mid the front door\'s leaf, the charger\'s cable, the cars\' lamps, T lights, tail lamps, rims and trim, the sills\' pots and the mailbox\'s bird cast no sun shadow; the cars\' bodies, glass and tyres, the houses and the bins still do', () => {
  const tier = TIERS.mid;
  const store = new TextureStore({ worker: { postMessage() {}, terminate() {} } });
  for (const job of laneJobs(tier)) store.sets.set(jobKey(job), generate({ ...job, size: 16 }));
  const detail = buildLaneDetail(lane, 'mid');
  const { part, look } = buildLaneReal(lane, { store, tier, origin: AREA_DEFS.lane.origin, anisotropy: 2, detail });
  const M = {};
  part.object3D.traverse((o) => o.isMesh && (M[o.name] = o));
  for (const name of ['lane-door', 'lane-cable', 'lane-detail-drl', 'lane-detail-lamp', 'lane-detail-tail', 'lane-detail-rim', 'lane-detail-trim', 'lane-detail-enamel', 'lane-detail-bird']) assert.equal(M[name]?.castShadow, false, `${name} casts none`);
  for (const name of ['lane-signs', 'lane-cloth', 'lane-boards', 'lane-detail-carPaint@0', 'lane-detail-carGlass@0', 'lane-detail-tyre', 'lane-detail-bins', 'lane-detail-paint', 'lane-detail-roof']) assert.equal(M[name]?.castShadow, true, `${name} casts`);
  look.dispose();
});

test('privacy and originality: the realistic look\'s sources load no image, read no photograph and fetch nothing (every texture is painted in code), name no street and letter nothing', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = new URL(f, dir);
      if (statSync(p).isDirectory()) walk(new URL(`${f}/`, dir));
      else files.push(p);
    }
  };
  walk(new URL('../src/render/real/', import.meta.url));
  walk(new URL('../src/world/lane/real/', import.meta.url));
  walk(new URL('../src/objects/laneBoss/', import.meta.url)); // (the lane's lazy chunk too)
  assert.ok(files.length >= 13, `${files.length} files`);
  for (const f of files) {
    assert.ok(f.pathname.endsWith('.js'), `${f.pathname}: code only`);
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\.(png|jpe?g|webp|gif|hdr|exr|ktx2?)['"`]/i.test(src), `${f.pathname}: no image files`);
    assert.ok(!/TextureLoader|RGBELoader|new Image\b|ImageLoader|\bfetch\(|XMLHttpRequest/.test(src), `${f.pathname}: nothing loaded`);
    assert.ok(!/\b[A-Z]{3} ?\d{2}[0-9A-Z]\b/.test(src), `${f.pathname}: no licence plates`);
    // No real street's name (a Swedish street's: ...vägen, ...gatan) and no lettering drawn
    // anywhere in the look (the street sign's plate and the mailbox's stay blank).
    assert.ok(!/[A-ZÅÄÖ][a-zåäö]+(vägen|gatan|stigen|gränd|backen|allén|torget|vagen)\b/.test(src), `${f.pathname}: no street names`);
    assert.ok(!/fillText|strokeText|bitmapFont|measureText/.test(src), `${f.pathname}: no lettering`);
  }
  // The new detail's sources are among those scanned.
  assert.ok(files.some((f) => f.pathname.endsWith('/clutter.js')) && files.some((f) => f.pathname.endsWith('/hardware.js')), 'clutter.js and hardware.js scanned');
  assert.ok(files.some((f) => f.pathname.endsWith('/LaneBins.js')), 'the lane\'s chunk scanned');
});

test('the pause legend in a course with a realistic look: its retro row names G too (retro TV and classic, or the retro filter and realistic), the same rows at the same places; pads and touch unchanged', () => {
  const measure = (t) => measureText(SMALL_FONT, t);
  for (const phone of [false, true]) {
    const was = phoneEntry.enabled;
    phoneEntry.enabled = phone;
    try {
      const plain = controlsLegend('keys');
      for (const [look, row] of [['real', REAL_LOOK_ROW], ['classic', CLASSIC_LOOK_ROW]]) {
        const legend = controlsLegend('keys', look);
        assert.equal(legend.length, plain.length);
        assert.equal(controlsLegend('keys', look), legend, 'made once');
        assert.deepEqual(legend.filter((r) => r !== row), plain.filter((r) => r[0] !== 'R / F2'), 'only the retro row swapped');
        assert.ok(legend.includes(row));
        // The same geometry (its rows' text aside).
        const geometry = (lay) => ({ ...lay, legend: { ...lay.legend, columns: lay.legend.columns.map(({ keyWidth, width, items }) => ({ keyWidth, width, rows: items.length })) } });
        for (const [W, H] of [[320, 240], [1920 / 4.5, 240]]) assert.deepEqual(geometry(pauseLayout(W, H, measure, legend)), geometry(pauseLayout(W, H, measure, plain)), `${look} ${W}: the same layout`);
      }
      assert.equal(controlsLegend('pad', 'real'), controlsLegend('pad'));
      assert.equal(controlsLegend('keys', null), plain);
    } finally {
      phoneEntry.enabled = was;
    }
  }
  assert.ok(KEY_CONTROLS.some((r) => r[0] === 'R / F2') && PAD_CONTROLS.length > 0);
});
