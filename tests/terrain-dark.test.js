// AI RACE mode on the terrain part: setDarkness crossfades by uniforms only (no geometry is
// touched), the grade reaches every ground material and the water, the shader patch finds its
// anchors in three.js's basic shader, and the scorch decals are pooled, draped on the ground,
// kept off the water, fade in, and clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as L from '../src/world/layout.js';
import { buildTerrain, DARK_GRADES } from '../src/world/terrain.js';
import { DarkGrade, applyGrade } from '../src/world/terrain/darkGrade.js';
import { MAX_SCORCHES, SCORCH_FADE_IN } from '../src/world/terrain/scorch.js';

const part = buildTerrain(L);
const meshes = [];
part.object3D.traverse((o) => o.isMesh && meshes.push(o));
const byName = (n) => meshes.find((m) => m.name === n);

const basicShader = () => ({ vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} });

// The grade as the shader applies it at full darkness (linear rgb in, linear rgb out).
function graded(rgb, { sat, mul, add = [0, 0, 0] }) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((c, i) => (l + (c - l) * sat) * mul[i] + add[i]);
}
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const saturation = (c) => (Math.max(...c) - Math.min(...c)) / (Math.max(...c) || 1);

test('setDarkness only moves uniforms: every ground material and the water follow it smoothly', () => {
  const snap = () => meshes.map((m) => Object.values(m.geometry.attributes).map((a) => a.array.slice()));
  const before = snap();
  const graded = meshes.filter((m) => m.material.userData.darkGrade);
  for (const n of ['grass', 'paths', 'courtyard', 'bed', 'cliffs', 'masonry', 'water', 'waterGlint']) {
    assert.ok(graded.some((m) => m.name === n), `${n} is graded`);
  }
  const t = (m) => m.material.userData.darkGrade.darkT.value;
  part.setDarkness(0);
  assert.ok(graded.every((m) => t(m) === 0));
  let last = 0;
  for (let k = 1; k <= 90; k++) {
    part.setDarkness(k / 90); // a 3 s crossfade at 30 Hz
    const v = t(graded[0]);
    assert.ok(v >= last && v - last < 0.03, `step ${k}: ${last} -> ${v}`);
    assert.ok(graded.every((m) => t(m) === v), 'one shared crossfade');
    last = v;
  }
  assert.equal(last, 1);
  const water = byName('water');
  assert.ok(water.material.opacity > 0.8, 'darker water is more opaque');
  part.update(3);
  assert.deepEqual(snap(), before, 'no geometry changed');
  part.setDarkness(0);
  assert.equal(water.material.opacity, 0.72);
});

test('storm grades: dead olive grass, dark mud paths, charcoal rock; dark but never black', () => {
  const grass = graded([0.13, 0.4, 0.05], DARK_GRADES.grass);
  assert.ok(luma(grass) < 0.12 && luma(grass) > 0.02, `grass ${grass}`);
  assert.ok(saturation(grass) < 0.7 * saturation([0.13, 0.4, 0.05]), 'grass loses much of its colour');
  assert.ok(grass[1] >= grass[2] && grass[0] > grass[2], 'olive: green-yellow over blue');
  const path = graded([0.3, 0.19, 0.08], DARK_GRADES.paths);
  assert.ok(luma(path) < 0.05 && path[0] > path[2], `mud ${path}`);
  const rock = graded([0.4, 0.38, 0.35], DARK_GRADES.cliffs);
  assert.ok(luma(rock) < 0.08 && saturation(rock) < 0.15, `charcoal ${rock}`);
});

test('the grade patch finds its anchors in three.js and chains onto an existing patch', () => {
  for (const m of meshes.filter((x) => x.material.userData.darkGrade)) {
    const s = basicShader();
    m.material.onBeforeCompile(s);
    assert.match(s.fragmentShader, /uniform float darkT;/, m.name);
    assert.match(s.fragmentShader, /if \(darkT > 0\.0\)/, m.name);
    assert.match(s.fragmentShader, /#include <specularmap_fragment>/, `${m.name}: anchor kept`);
    assert.equal(s.uniforms.darkT, m.material.userData.darkGrade.darkT);
  }
  // Oil sheen on the highlights only.
  const s = basicShader();
  byName('waterGlint').material.onBeforeCompile(s);
  assert.match(s.fragmentShader, /Thin-film/);
  // Chaining: a material with its own patch keeps it; keys combine.
  const mat = new THREE.MeshBasicMaterial();
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = `// mine\n${sh.fragmentShader}`;
  };
  mat.customProgramCacheKey = () => 'mine';
  new DarkGrade().patch(mat, { sat: 0.5 });
  const c = basicShader();
  mat.onBeforeCompile(c);
  assert.ok(c.fragmentShader.startsWith('// mine') && /uniform float darkT;/.test(c.fragmentShader));
  assert.equal(mat.customProgramCacheKey(), 'mine|dark-grade-');
  // Glow and ragged variants.
  const g = basicShader();
  applyGrade(g, {}, { glow: true, ragged: true });
  assert.match(g.vertexShader, /attribute float darkGlow;/);
  assert.match(g.fragmentShader, /discard;/);
  assert.match(g.fragmentShader, /fogFactor \* \(1\.0 - 0\.75 \* darkShine\)/);
});

const scorches = () => byName('scorches');

test('scorch marks: pooled, draped on the ground, off the water, oldest reused, cleared', () => {
  const mesh = scorches();
  assert.ok(mesh, 'scorch mesh');
  // Drawn once, empty, with the level's first frame (its shader compiles then), then hidden.
  assert.equal(mesh.visible, true);
  assert.equal(mesh.geometry.drawRange.count, 0);
  mesh.onAfterRender();
  assert.equal(mesh.visible, false, 'nothing drawn without scorches');
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.polygonOffsetFactor, 0);
  assert.ok(mesh.material.polygonOffsetUnits < byName('paths').material.polygonOffsetUnits, 'drawn over the path decal');
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const info = geo.attributes.scorch;
  const per = pos.count / MAX_SCORCHES;
  const perIdx = geo.index.count / MAX_SCORCHES;

  part.update(10);
  // Lawn, path, the east hill's slope.
  const spots = [
    [0, 4700, 220],
    [-1600, 4500, 300],
    [5600, -1900, 300],
  ];
  for (const [x, z, r] of spots) part.addScorch(x, z, r);
  assert.equal(mesh.visible, true);
  assert.equal(geo.drawRange.count, 3 * perIdx);
  spots.forEach(([x, z, r], s) => {
    for (let k = s * per; k < (s + 1) * per; k++) {
      const px = pos.getX(k);
      const pz = pos.getZ(k);
      assert.ok(Math.hypot(px - x, pz - z) <= r * Math.SQRT2 + 1, 'within the decal square');
      const lift = pos.getY(k) - L.groundHeight(px, pz);
      assert.ok(lift > 2 && lift < 10, `scorch ${s}: ${lift.toFixed(1)} above the ground`);
      assert.equal(info.getX(k), 10, 'born now (fades in from here)');
      assert.equal(info.getZ(k), 1, 'fully drawn on open ground');
    }
  });
  // At the moat's edge: the vertices over the water are masked.
  part.addScorch(L.MOAT.maxX, 0, 300);
  let wet = 0;
  for (let k = 3 * per; k < 4 * per; k++) {
    if (L.waterLevelAt(pos.getX(k), pos.getZ(k)) > L.groundHeight(pos.getX(k), pos.getZ(k))) {
      wet++;
      assert.equal(info.getZ(k), 0, 'no scorch on the water');
    }
  }
  assert.ok(wet > 0, 'the moat test decal reaches over the water');
  // The pool: at most MAX_SCORCHES; the next one replaces the oldest (slot 0).
  for (let i = 0; i < MAX_SCORCHES; i++) part.addScorch(-3000 + i * 100, 5600, 120);
  assert.equal(geo.drawRange.count, MAX_SCORCHES * perIdx);
  const last = -3000 + (MAX_SCORCHES - 1) * 100;
  let cx = 0;
  let cz = 0;
  for (let k = 3 * per; k < 4 * per; k++) {
    cx += pos.getX(k) / per;
    cz += pos.getZ(k) / per;
  }
  assert.ok(Math.hypot(cx - last, cz - 5600) < 5, 'the oldest slots were reused in order');
  part.clearScorches();
  assert.equal(mesh.visible, false);
  assert.equal(geo.drawRange.count, 0);
  part.addScorch(0, 4700, 200);
  assert.equal(geo.drawRange.count, perIdx, 'starts over after clearing');
  part.clearScorches();
});

test('scorch shader: fades in over SCORCH_FADE_IN of game time, a charred disc with an ember rim', () => {
  const s = basicShader();
  scorches().material.onBeforeCompile(s);
  assert.match(s.vertexShader, /attribute vec3 scorch;/);
  assert.ok(s.fragmentShader.includes(`age / ${SCORCH_FADE_IN.toFixed(3)}`));
  assert.match(s.fragmentShader, /vec3\(1\.0, 0\.3, 0\.035\)/, 'ember orange');
  assert.ok(!s.fragmentShader.includes('#include <map_fragment>'), 'replaces the map lookup');
  assert.ok(s.uniforms.scorchTime);
  part.update(20);
  assert.equal(s.uniforms.scorchTime.value, 20);
});

test('water ripples speed up in the storm without jumping', () => {
  const water = byName('water');
  const tex = water.material.map;
  part.setDarkness(0);
  part.update(100);
  const a = tex.offset.clone();
  part.setDarkness(1);
  part.update(100 + 1 / 30);
  const b = tex.offset.clone();
  const step = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(step > 0 && step < 0.01, `one frame moves the ripples ${step}`);
  part.update(100 + 2 / 30);
  const c = tex.offset.clone();
  const calm = Math.hypot(0.035, 0.021) / 30;
  assert.ok(Math.hypot(c.x - b.x, c.y - b.y) > 1.5 * calm, 'faster in the storm');
  part.setDarkness(0);
});
