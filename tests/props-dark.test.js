// AI RACE mode on the props and the sky: canopies wither (squeeze + holes) and darken by
// uniforms, flowers wilt and go grey, nothing else moves; the storm sky crossfades by
// uniforms, scrolls with game time only while it shows, and survives the renderer's
// underwater copy of the dome's material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as L from '../src/world/layout.js';
import { buildProps, DARK_GRADES } from '../src/world/props.js';
import { WITHER } from '../src/world/props/foliageFade.js';
import { buildSky, SkyMaterial, SKY_STORM_HORIZON_COLOR } from '../src/world/sky.js';
import { STORM_FOG } from '../src/render/post/storm.js';

const part = buildProps(L);
const meshes = part.object3D.children.filter((o) => o.isMesh);
const byName = (n) => meshes.find((m) => m.name === n);
const basicShader = () => ({ vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} });

function graded(rgb, { sat, mul, add = [0, 0, 0] }) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((c, i) => (l + (c - l) * sat) * mul[i] + add[i]);
}

test('props darken by uniforms: withered leaves, near-black bark, dead grey flowers', () => {
  for (const n of Object.keys(DARK_GRADES)) assert.ok(byName(n)?.material.userData.darkGrade, `${n} graded`);
  const snap = () => meshes.filter((m) => m.name !== 'flowers' && m.name !== 'waterfallSplash').map((m) => Object.values(m.geometry.attributes).map((a) => a.array.slice()));
  const before = snap();
  const fade = byName('leaves').material.userData.foliageFade;
  part.setDarkness(0.5);
  assert.equal(byName('leaves').material.userData.darkGrade.darkT.value, 0.5);
  assert.equal(fade.witherUniform.value, 0.5);
  part.setDarkness(1);
  assert.equal(fade.witherUniform.value, 1);
  assert.deepEqual(snap(), before, 'no geometry rebuilt');
  const leaf = graded([0.1, 0.35, 0.06], DARK_GRADES.leaves);
  assert.ok(leaf[0] > leaf[2] && leaf[1] > leaf[2] && Math.max(...leaf) < 0.12, `brown-green leaves ${leaf}`);
  const bark = graded([0.35, 0.2, 0.1], DARK_GRADES.bark);
  assert.ok(Math.max(...bark) < 0.03, `bark ${bark}`);
  const flower = graded([0.9, 0.2, 0.3], DARK_GRADES.flowers);
  assert.ok(Math.max(...flower) - Math.min(...flower) < 0.01, 'grey flowers');
  part.setDarkness(0);
});

test('flowers wilt with the storm and stand up again after it', () => {
  const flowers = byName('flowers').geometry.attributes.position;
  const heights = () => {
    const h = [];
    for (let i = 0; i < flowers.count; i += 4) h.push(flowers.getY(i + 2) - flowers.getY(i));
    return h;
  };
  part.setDarkness(0);
  const tall = heights();
  part.setDarkness(1);
  const low = heights();
  low.forEach((h, i) => assert.ok(Math.abs(h - 0.55 * tall[i]) < 1e-3, `flower ${i}`));
  part.setDarkness(0);
  assert.deepEqual(heights(), tall);
});

test('withering: canopies squeeze toward their middles and open holes; trunks and bushes too little', () => {
  const leaves = byName('leaves');
  const fade = leaves.material.userData.foliageFade;
  const s = basicShader();
  leaves.material.onBeforeCompile(s);
  assert.match(s.vertexShader, /uniform vec4 propCentre\[\d+\];/);
  assert.match(s.vertexShader, /transformed = wc\.xyz \+ \(transformed - wc\.xyz\) \* vec3\(across, up, across\);/);
  assert.match(s.fragmentShader, /witherNoise\(vLeafPos/);
  assert.match(s.fragmentShader, /uniform float darkT;/, 'and the grade on top');
  assert.equal(s.uniforms.propWither, fade.witherUniform);
  const centres = s.uniforms.propCentre.value;
  assert.equal(centres.length, fade.groups.length);
  fade.groups.forEach((g, i) => {
    const w = centres[i].w;
    if (g.kind === 'trunk') assert.equal(w, 0, `${g.name} never withers`);
    else if (g.name.startsWith('bush')) assert.ok(w > 0 && w < 1, g.name);
    else {
      assert.equal(w, 1, g.name);
      assert.ok(Math.hypot(centres[i].x - g.x, centres[i].y - g.y, centres[i].z - g.z) < 1e-6);
    }
  });
  // Withered trees keep the crown near the pole top (his handstand), within the squeeze.
  part.trees.forEach((t, i) => {
    const g = fade.groups.find((q) => q.name === `tree:${i}`);
    const drop = (t.crown - g.y) * WITHER.up;
    assert.ok(drop < 30, `tree ${i}: the crown sinks ${drop.toFixed(0)} at full wither`);
  });
  // The bark shader has no holes (no tri-planar leaves).
  const b = basicShader();
  byName('bark').material.onBeforeCompile(b);
  assert.ok(!b.fragmentShader.includes('witherNoise'));
});

test('storm sky: crossfades by uniforms, scrolls on game time while it shows, survives the underwater copy', () => {
  const sky = buildSky(L);
  const mesh = sky.object3D.getObjectByName('skyDome');
  const mat = mesh.material;
  assert.ok(mat instanceof SkyMaterial);
  const s = basicShader();
  mat.onBeforeCompile(s);
  assert.match(s.fragmentShader, /uniform sampler2D stormMap;/);
  assert.match(s.fragmentShader, /if \(stormT > 0\.0\)/);
  assert.equal(s.uniforms.stormT, mat.storm.stormT);
  // Storm horizon = the renderer's storm fog, so the ground melts into it.
  assert.equal(SKY_STORM_HORIZON_COLOR, STORM_FOG.color);

  const scroll = mat.storm.stormScroll.value;
  sky.update(1, null);
  sky.update(2, null);
  assert.equal(scroll.length(), 0, 'no scrolling while sunny');
  sky.setDarkness(1);
  assert.equal(mat.storm.stormT.value, 1);
  sky.update(3, null);
  const a = scroll.clone();
  assert.ok(a.length() > 0);
  sky.update(3, null);
  assert.deepEqual(scroll.toArray(), a.toArray(), 'paused: no game time, no scroll');
  sky.update(3.5, null);
  const moved = scroll.clone().sub(a).length();
  assert.ok(moved > 0 && moved < 0.02, `a smooth roll: ${moved}`);

  // The renderer's underwater tint clones the material and sets its own onBeforeCompile:
  // the copy keeps the storm (shared uniforms) and runs the tint after it.
  const copy = mat.clone();
  copy.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', '// tinted');
  };
  copy.customProgramCacheKey = () => 'underwaterSky';
  const c = basicShader();
  copy.onBeforeCompile(c);
  assert.match(c.fragmentShader, /if \(stormT > 0\.0\)/);
  assert.match(c.fragmentShader, /\/\/ tinted/);
  assert.equal(c.uniforms.stormT, mat.storm.stormT);
  assert.equal(copy.customProgramCacheKey(), 'underwaterSky');
  sky.setDarkness(0);
  assert.equal(mat.storm.stormT.value, 0);
});
