// Renderer side of AI RACE's meltdown (src/render/post/meltdown.js, N64Renderer.setMeltdown):
// the warning reddens the storm fog, the fire turns the fog, the actor lights and the grade
// orange, the white-out raises the exposure, bleaches and ends in pure white with a white fog
// pulled in; the glare sits on the fireball's place on screen; everything is exactly the storm
// again at 0, and the grade's branches are skipped then. The WebGL passes themselves are
// checked with /preview.html?m=fx&melt=42 (and 48, 51 ...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { N64Renderer, FOG_COLOR, FOG_NEAR, FOG_FAR } from '../src/render/N64Renderer.js';
import { STORM_FOG } from '../src/render/post/storm.js';
import { UnderwaterFog } from '../src/render/post/underwater.js';
import { N64Pass } from '../src/render/post/N64Pass.js';
import { GradePass } from '../src/render/post/GradePass.js';
import { FIRE_FOG, WHITE_FOG, MELT_GLSL, MELT_OFF, MELT_GRADE, meltGradeColor, meltFogRange, fireGradeOf } from '../src/render/post/meltdown.js';
import { meltdownLevels } from '../src/fx/Meltdown.js';

// The storm and meltdown state of an N64Renderer without WebGL (as render-storm.test.js).
function renderer() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  scene.background = new THREE.Color(FOG_COLOR);
  const r = Object.create(N64Renderer.prototype);
  r.scene = scene;
  N64Renderer.prototype.addLights.call(r);
  r.underwater = new UnderwaterFog(scene);
  r.camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
  r.initStorm();
  return r;
}

const hex = (c) => c.getHex();
const levels = (o) => ({ ...meltdownLevels(), ...o });
const snap = (r) => ({
  fog: hex(r.scene.fog.color),
  bg: hex(r.scene.background),
  near: r.scene.fog.near,
  far: r.scene.fog.far,
  sun: r.sun.intensity,
  sunColor: hex(r.sun.color),
  amb: r.ambient.intensity,
  sky: hex(r.ambient.color),
  key: hex(r.stormKey.color),
});

test('setMeltdown: the warning reddens the storm fog, the fire turns fog and lights orange, the white-out white and close; 0 = the storm exactly', () => {
  const r = renderer();
  r.setDarkness(1);
  const storm = snap(r);
  assert.equal(storm.fog, STORM_FOG.color);
  r.setMeltdown(levels({ warn: 0.8 }));
  const warn = r.scene.fog.color;
  const stormC = new THREE.Color(STORM_FOG.color);
  assert.ok(warn.r > stormC.r && warn.b < stormC.b, 'a red haze');
  assert.equal(r.meltOn, true);
  r.setMeltdown(levels({ warn: 1, fire: 1 }));
  assert.equal(hex(r.scene.fog.color), FIRE_FOG.color);
  assert.equal(hex(r.scene.background), FIRE_FOG.color);
  assert.equal(r.scene.fog.near, FIRE_FOG.near);
  assert.equal(r.scene.fog.far, FIRE_FOG.far);
  assert.ok(r.sun.color.r > r.sun.color.b * 1.5 && r.ambient.color.r > r.ambient.color.b * 1.5, 'lit by fire');
  assert.ok(r.stormKey.color.r > r.stormKey.color.b, 'the key light warms too');
  r.setMeltdown(levels({ warn: 1, fire: 1, white: 1 }));
  assert.equal(hex(r.scene.fog.color), WHITE_FOG.color);
  assert.equal(r.scene.fog.far, WHITE_FOG.far);
  assert.ok(r.sun.intensity > storm.sun * 2, 'blinding light');
  r.setMeltdown(levels());
  assert.deepEqual(snap(r), storm, 'the storm exactly, once it is all 0');
  assert.equal(r.meltOn, false);
  // And the sunny values after both are gone.
  r.setDarkness(0);
  assert.equal(hex(r.scene.fog.color), FOG_COLOR);
  assert.equal(r.scene.fog.far, FOG_FAR);
});

test('meltFogRange: the fire shortens the fog, the white pulls it right in', () => {
  assert.deepEqual(meltFogRange(1200, 15000, 0, 0), { near: 1200, far: 15000 });
  assert.deepEqual(meltFogRange(1200, 15000, 1, 0), { near: FIRE_FOG.near, far: FIRE_FOG.far });
  const half = meltFogRange(1200, 15000, 1, 0.5);
  assert.ok(half.far < FIRE_FOG.far && half.far > WHITE_FOG.far);
  assert.deepEqual(meltFogRange(1200, 15000, 1, 1), { near: WHITE_FOG.near, far: WHITE_FOG.far });
});

test('grade: identity at 0; the fire tints orange (highlights keep more of their hue); the white-out brightens to pure white', () => {
  const grass = [0.3, 0.45, 0.25];
  assert.deepEqual(meltGradeColor(grass, 0, 0), grass);
  const [r, g, b] = meltGradeColor([0.4, 0.4, 0.4], 1);
  assert.ok(r > g && g > b && r > 0.45, `grey turns orange: ${[r, g, b]}`);
  // A bright yellow flame keeps more of its green than the tint alone would leave it.
  const flame = [1, 0.85, 0.35];
  const tinted = meltGradeColor(flame, 1);
  const l = 0.2126 + 0.7152 * 0.85 + 0.0722 * 0.35;
  assert.ok(tinted[1] > l * MELT_GRADE.fireTint[1] + 0.05, 'highlights keep their yellow');
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let last = lum(grass);
  for (let w = 0.1; w <= 1.0001; w += 0.1) {
    const c = meltGradeColor(grass, 1, w);
    assert.ok(lum(c) >= last - 1e-9, `brighter at white ${w.toFixed(1)}`);
    last = lum(c);
  }
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat(meltGradeColor([0.8, 0.1, 0.1], 0, 0.3)) < sat([0.8, 0.1, 0.1]) * 0.4, 'saturated colours bleach');
  for (const c of [grass, [0.05, 0.02, 0.01], [0.9, 0.1, 0.1]]) {
    for (const v of meltGradeColor(c, 1, 1)) assert.ok(Math.abs(v - 1) < 1e-9, 'pure white');
  }
  assert.equal(fireGradeOf(0, 0), 0);
  assert.ok(Math.abs(fireGradeOf(1, 0) - MELT_GRADE.warnFire) < 1e-9, 'the warning is a share of the fire grade');
  assert.equal(fireGradeOf(1, 1), 1);
});

test('GLSL: the meltdown grade is skipped at 0 and both passes use it (with the heat shimmer where they sample)', () => {
  for (const branch of [/if \(uFire > 0\.0\)/, /if \(uWhite > 0\.0\)/, /if \(uGlare > 0\.0\)/, /if \(uShimmer <= 0\.0\) return vec2\(0\.0\);/]) assert.match(MELT_GLSL, branch);
  const pass = new N64Pass();
  const fs = pass.material.fragmentShader;
  assert.ok(fs.includes('stormGrade(color)') && fs.includes('meltGrade(color, vUv)') && fs.includes('heatShimmer(vUv)'));
  pass.setMeltdown({ ...MELT_OFF, fire: 0.5, white: 0.25, glare: 0.75, glareX: 0.2, glareY: 0.9, shimmer: 0.4, time: 47 });
  const u = pass.material.uniforms;
  assert.deepEqual([u.uFire.value, u.uWhite.value, u.uGlare.value, u.uGlarePos.value.x, u.uGlarePos.value.y, u.uShimmer.value, u.uMeltTime.value], [0.5, 0.25, 0.75, 0.2, 0.9, 0.4, 47]);
  pass.setMeltdown();
  assert.equal(u.uFire.value, 0);
  pass.dispose();
  const grade = new GradePass();
  assert.ok(grade.material.fragmentShader.includes('meltGrade(stormGrade(c), uv)') && grade.material.fragmentShader.includes('heatShimmer(uv)'));
  grade.dispose();
});

test('the glare sits on the fireball on screen (fainter far off screen, none behind the camera); none while it is all 0', () => {
  const r = renderer();
  r.camera.position.set(0, 500, 7000);
  r.camera.lookAt(0, 500, 0);
  r.camera.updateMatrixWorld();
  assert.equal(r.meltGradeState(), MELT_OFF);
  const lit = (x, y, z) => r.setMeltdown(levels({ fire: 1, glow: 1, glare: 1, lit: true, lx: x, ly: y, lz: z }));
  lit(0, 500, -12000);
  let g = r.meltGradeState();
  assert.ok(Math.abs(g.glareX - 0.5) < 1e-6 && Math.abs(g.glareY - 0.5) < 1e-6 && g.glare === 1, 'centred');
  assert.equal(g.fire, 1);
  lit(6000, 4000, -12000);
  g = r.meltGradeState();
  assert.ok(g.glareX > 0.6 && g.glareY > 0.6, 'up and to the right');
  lit(60000, 500, -12000);
  assert.ok(r.meltGradeState().glare < 1, 'far off screen: fainter');
  lit(0, 500, 30000);
  assert.equal(r.meltGradeState().glare, 0, 'behind the camera: none');
});

test('F1 overlay marks the meltdown', () => {
  const describe = (state) => N64Renderer.prototype.describeMode.call(state);
  const base = { internal: { width: 427, height: 240 }, viewport: { width: 1280, height: 720 }, pixelRatio: 1, n64: true, pillarbox: false, isUnderwater: false, darkness: 1 };
  assert.equal(describe({ ...base, meltOn: true }), 'Retro 427x240 storm meltdown');
  assert.equal(describe({ ...base, meltOn: false }), 'Retro 427x240 storm');
});
