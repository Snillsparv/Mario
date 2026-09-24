// Renderer side of AI RACE mode: storm fog/lights crossfade, the colour grade, the lightning
// flash envelope, and the fog handover with the underwater fog. The WebGL passes themselves
// are checked with /preview.html?m=render&dark=1 (and &flash=1, &under=1, &n64=0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { N64Renderer, FOG_COLOR, FOG_NEAR, FOG_FAR, SUN_INTENSITY, AMBIENT_INTENSITY } from '../src/render/N64Renderer.js';
import { STORM_FOG, STORM_UNDERWATER_FOG, STORM_LIGHTS, flashEnvelope, gradeColor, stormFogRange, GRADE_GLSL } from '../src/render/post/storm.js';
import { UnderwaterFog, UNDERWATER_FOG } from '../src/render/post/underwater.js';
import { N64Pass } from '../src/render/post/N64Pass.js';
import { GradePass } from '../src/render/post/GradePass.js';

// The storm state of an N64Renderer without WebGL: the real methods on a stand-in `this`.
function stormRenderer() {
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

test('flash envelope: bright stroke, dark gap, return stroke, gone after ~0.45 s', () => {
  assert.equal(flashEnvelope(0), 1);
  assert.equal(flashEnvelope(-0.1), 0);
  assert.ok(flashEnvelope(0.06) < 0.5, 'gap');
  assert.ok(flashEnvelope(0.1) > 0.7, 'second stroke');
  assert.ok(flashEnvelope(0.3) < 0.1 && flashEnvelope(0.3) > 0);
  assert.equal(flashEnvelope(0.46), 0);
  for (let t = 0; t < 1; t += 0.005) assert.ok(flashEnvelope(t) >= 0 && flashEnvelope(t) <= 1);
});

test('grade: identity at 0; the storm desaturates, darkens and cools; the flash brightens', () => {
  const grass = [0.35, 0.7, 0.25];
  assert.deepEqual(gradeColor(grass, 0, 0), grass);
  const [r, g, b] = gradeColor(grass, 1);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum([r, g, b]) < lum(grass) * 0.85, 'darker');
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat([r, g, b]) < sat(grass) * 0.75, 'desaturated');
  const grey = gradeColor([0.5, 0.5, 0.5], 1);
  assert.ok(grey[2] > grey[0] && grey[1] > grey[0], 'cold teal tint');
  const shadow = gradeColor([0.1, 0.1, 0.1], 1);
  assert.ok(shadow[0] < 0.07, 'deep shadows');
  const half = gradeColor(grass, 0.5);
  assert.ok(lum(half) < lum(grass) && lum(half) > lum([r, g, b]), 'scales with t');
  const flash = gradeColor(shadow, 1, 1);
  assert.ok(flash[0] > 0.3 && flash[2] > flash[0], 'lightning: bright white-blue');
});

test('GLSL grade matches the exported constants and is skipped at 0', () => {
  assert.match(GRADE_GLSL, /uniform float uStorm;/);
  assert.match(GRADE_GLSL, /if \(uStorm > 0\.0\)/);
  assert.match(GRADE_GLSL, /if \(uFlash > 0\.0\)/);
  const pass = new N64Pass();
  assert.ok(pass.material.fragmentShader.includes('stormGrade(color)'));
  pass.setGrade(0.5, 0.25);
  assert.equal(pass.material.uniforms.uStorm.value, 0.5);
  assert.equal(pass.material.uniforms.uFlash.value, 0.25);
  pass.dispose();
  const grade = new GradePass();
  assert.ok(grade.material.fragmentShader.includes('stormGrade('));
  assert.equal(grade.target, null, 'no full-size target until native mode needs one');
  grade.release();
  grade.dispose();
});

test('stormFogRange crossfades near/far above and under water', () => {
  const day = { near: FOG_NEAR, far: FOG_FAR };
  const r0 = stormFogRange(0, day, UNDERWATER_FOG);
  assert.deepEqual([r0.near, r0.far, r0.uwNear, r0.uwFar], [FOG_NEAR, FOG_FAR, UNDERWATER_FOG.near, UNDERWATER_FOG.far]);
  const r1 = stormFogRange(2, day, UNDERWATER_FOG);
  assert.deepEqual([r1.near, r1.far, r1.uwFar], [STORM_FOG.near, STORM_FOG.far, STORM_UNDERWATER_FOG.far]);
  assert.ok(STORM_FOG.far < FOG_FAR / 1.5, 'shorter range');
});

test('setDarkness: storm fog, background and actor lights at 1, exactly the sunny values at 0', () => {
  const r = stormRenderer();
  const { scene } = r;
  const day = { fog: hex(scene.fog.color), sun: r.sun.intensity, amb: r.ambient.intensity, sunColor: hex(r.sun.color) };
  r.setDarkness(1);
  assert.equal(hex(scene.fog.color), STORM_FOG.color);
  assert.equal(hex(scene.background), STORM_FOG.color);
  assert.equal(scene.fog.near, STORM_FOG.near);
  assert.equal(scene.fog.far, STORM_FOG.far);
  assert.ok(Math.abs(r.sun.intensity - STORM_LIGHTS.sunIntensity) < 1e-9);
  assert.ok(r.sun.intensity < SUN_INTENSITY && r.ambient.intensity < AMBIENT_INTENSITY);
  r.setDarkness(0.5);
  assert.ok(scene.fog.far < FOG_FAR && scene.fog.far > STORM_FOG.far);
  r.setDarkness(0);
  assert.equal(hex(scene.fog.color), day.fog);
  assert.equal(scene.fog.near, FOG_NEAR);
  assert.equal(scene.fog.far, FOG_FAR);
  assert.equal(r.sun.intensity, day.sun);
  assert.equal(r.ambient.intensity, day.amb);
  assert.equal(hex(r.sun.color), day.sunColor);
  assert.equal(r.darkness, 0);
});

test('setDarkness under water: the underwater fog darkens now, the storm fog waits for surfacing', () => {
  const r = stormRenderer();
  const { scene } = r;
  r.underwater.update(true);
  assert.equal(hex(scene.fog.color), UNDERWATER_FOG.color);
  r.setDarkness(1);
  assert.equal(hex(scene.fog.color), STORM_UNDERWATER_FOG.color, 'murky storm water at once');
  assert.equal(scene.fog.far, STORM_UNDERWATER_FOG.far);
  r.underwater.update(false);
  assert.equal(hex(scene.fog.color), STORM_FOG.color, 'surfacing into the storm, not the old sunny fog');
  assert.equal(scene.fog.far, STORM_FOG.far);
  r.setDarkness(0);
  r.underwater.update(true);
  assert.equal(hex(scene.fog.color), UNDERWATER_FOG.color);
  r.underwater.update(false);
  assert.equal(hex(scene.fog.color), FOG_COLOR);
});

test('flash: starts on the next frame drawn, follows the envelope, a weaker strike does not cut a stronger one', () => {
  const r = stormRenderer();
  assert.equal(r.updateFlash(10), 0);
  r.flash(0.8);
  assert.equal(r.updateFlash(100), 0.8, 'peak on the first frame, whenever it comes');
  assert.ok(Math.abs(r.updateFlash(100.1) - 0.8 * flashEnvelope(0.1)) < 1e-9);
  r.flash(0.3); // weaker than what is showing: ignored
  assert.ok(Math.abs(r.updateFlash(100.12) - 0.8 * flashEnvelope(0.12)) < 1e-9);
  assert.equal(r.updateFlash(100.6), 0);
  assert.equal(r.flashStrength, 0);
  r.flash(0);
  r.flash(-1);
  assert.equal(r.updateFlash(101), 0);
});

test('the renderer registers itself on scene.userData.view, hidden from serialisation', () => {
  const r = stormRenderer();
  assert.equal(r.scene.userData.view, r);
  assert.equal(JSON.stringify(r.scene.userData), '{}');
  assert.ok(!Object.keys(r.scene.userData).includes('view'));
});

test('F1 overlay marks the storm', () => {
  const describe = (state) => N64Renderer.prototype.describeMode.call(state);
  const base = { internal: { width: 427, height: 240 }, viewport: { width: 1280, height: 720 }, pixelRatio: 1, n64: true, pillarbox: false, isUnderwater: false };
  assert.equal(describe({ ...base, darkness: 0.4 }), 'Retro 427x240 storm');
  assert.equal(describe({ ...base, darkness: 0 }), 'Retro 427x240');
});

test('storm key light: off in the sun, a cool light from the camera side in the storm, flashes with lightning', () => {
  const r = stormRenderer();
  const lights = [];
  r.scene.traverse((o) => o.isDirectionalLight && lights.push(o.name));
  assert.deepEqual(lights.sort(), ['stormKey', 'sun'], 'present from the start: no program change later');
  r.updateStormKey(0);
  assert.equal(r.stormKey.intensity, 0);
  r.setDarkness(1);
  r.camera.position.set(0, 700, 7000);
  r.camera.lookAt(0, 300, 0); // looking toward -z
  r.updateStormKey(0);
  assert.ok(Math.abs(r.stormKey.intensity - STORM_LIGHTS.keyIntensity) < 1e-9);
  const dir = r.stormKey.position.clone().normalize();
  assert.ok(dir.z > 0.5 && dir.y > 0.2 && dir.x < 0, 'from behind the camera, above, a little left');
  r.updateStormKey(1);
  assert.ok(r.stormKey.intensity > STORM_LIGHTS.keyIntensity * 3, 'lightning lights the hero too');
  r.setDarkness(0);
  r.updateStormKey(0);
  assert.equal(r.stormKey.intensity, 0);
  assert.ok(STORM_LIGHTS.ambientIntensity > 0.8 * AMBIENT_INTENSITY, 'actors keep most of their light');
});

test('storm fog colour is the storm sky horizon (world/sky.js)', async () => {
  const sky = await import('../src/world/sky.js');
  if (sky.SKY_STORM_HORIZON_COLOR === undefined) return;
  assert.equal(STORM_FOG.color, sky.SKY_STORM_HORIZON_COLOR);
});
