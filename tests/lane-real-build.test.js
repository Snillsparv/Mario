// Sparrow Lane's realistic build (world/lane/real/look.js, lane/build.js look 'real'): visuals
// only. Its colliders are the classic build's to the byte (so the routes, the camera's world and
// every lane test hold whichever look is drawn), it draws exactly the classic faces (plus a dim
// room behind each pane), split into the realistic look's meshes by part (the panes in glass,
// the painted parts in paint, the dad's path), unbaked, its lawns' tints grey, its roofs' uvs up
// their slopes, no NaN anywhere, within the triangle budget; every mesh gets its catalogue
// material, the glass the reflection probe, the signs the classic look; the pause legend's
// retro row names G there; and the realistic sources stay private and original (no image
// files, nothing loaded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import * as lane from '../src/world/lane/layout.js';
import { buildLane, REPEAT } from '../src/world/lane/build.js';
import { buildLaneReal, laneJobs } from '../src/world/lane/real/look.js';
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
const meshes = (part) => {
  const out = {};
  part.object3D.traverse((o) => o.isMesh && (out[o.name] = o));
  return out;
};
const C = meshes(classic);
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

test('it draws exactly the classic faces, the panes in glass, the painted parts in paint and the dad\'s path in path, plus a dim room behind every pane; unbaked, no NaN', () => {
  assert.deepEqual(Object.keys(R).sort(), [...Object.keys(C), 'lane-glass', 'lane-paint', 'lane-path'].sort());
  for (const name of Object.keys(C)) {
    if (name === 'lane-render' || name === 'lane-grass') continue;
    assert.deepEqual(triangles(R[name]).sort(), triangles(C[name]).sort(), name);
  }
  const split = [...triangles(R['lane-render']), ...triangles(R['lane-glass']), ...triangles(R['lane-paint'], ROOM)];
  assert.deepEqual(split.sort(), triangles(C['lane-render']).sort(), 'render = render + glass + paint');
  assert.deepEqual([...triangles(R['lane-grass']), ...triangles(R['lane-path'])].sort(), triangles(C['lane-grass']).sort(), 'grass = grass + path');
  const rooms = triangles(R['lane-paint']).length - triangles(R['lane-paint'], ROOM).length;
  const panes = R['lane-glass'].geometry.attributes.position.count / 3;
  assert.ok(rooms >= 100 && rooms <= panes, `${rooms} room triangles behind ${panes} pane triangles`);
  // The glass: only the panes' and glints' tints (both look through to a room).
  const glass = R['lane-glass'].geometry.attributes.color;
  const tints = [0x2c3a46, 0x6c7c8a].map(linear);
  for (let i = 0; i < glass.count; i++) {
    const ok = tints.some((t) => [glass.getX(i) / t.r, glass.getY(i) / t.g, glass.getZ(i) / t.b].every((k, _, a) => Math.abs(k - a[0]) < 1e-4));
    assert.ok(ok, `glass vertex ${i}: a pane's tint`);
  }
  // Unbaked: the boards' Falu red is the dad's tint itself (the bake's light is not in it).
  const boards = R['lane-boards'].geometry.attributes;
  const falu = linear(lane.DAD.boards);
  const D = lane.DAD;
  let max = 0;
  for (let i = 0; i < boards.color.count; i++) {
    const [x, z] = [boards.position.getX(i), boards.position.getZ(i)];
    if (x > D.x0 + 1 && x < D.x1 - 1 && z > D.z0 - 1 && z < D.z1 + 1) max = Math.max(max, boards.color.getX(i) / falu.r);
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

test('the realistic lane: each mesh in its catalogue material, shadows cast by all but the ground and the glass, the glass on the probe, the signs classic', () => {
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
    assert.equal(m.castShadow, !['lane-asphalt', 'lane-grass', 'lane-cobbles', 'lane-path', 'lane-glass'].includes(name), `${name} casts`);
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

test('privacy and originality: the realistic look\'s sources load no image, read no photograph and fetch nothing (every texture is painted in code)', () => {
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
  assert.ok(files.length >= 13, `${files.length} files`);
  for (const f of files) {
    assert.ok(f.pathname.endsWith('.js'), `${f.pathname}: code only`);
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\.(png|jpe?g|webp|gif|hdr|exr|ktx2?)['"`]/i.test(src), `${f.pathname}: no image files`);
    assert.ok(!/TextureLoader|RGBELoader|new Image\b|ImageLoader|\bfetch\(|XMLHttpRequest/.test(src), `${f.pathname}: nothing loaded`);
    assert.ok(!/\b[A-Z]{3} ?\d{2}[0-9A-Z]\b/.test(src), `${f.pathname}: no licence plates`);
  }
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
