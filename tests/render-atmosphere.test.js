// Renderer side of areas (setAtmosphere): an area's day look (fog colour and range, the clear
// colour, the underwater fog's colour, the actor sun and hemisphere) replaces the grounds', the
// storm and the meltdown crossfade from it and back to it, the underwater fog hands it over on
// surfacing, null restores the grounds exactly, and no light is ever added or removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  N64Renderer, FOG_COLOR, FOG_NEAR, FOG_FAR, SUN_COLOR, SUN_INTENSITY, AMBIENT_SKY_COLOR, AMBIENT_GROUND_COLOR, AMBIENT_INTENSITY,
} from '../src/render/N64Renderer.js';
import { STORM_FOG } from '../src/render/post/storm.js';
import { UnderwaterFog, UNDERWATER_FOG } from '../src/render/post/underwater.js';
import { SUN_DIR } from '../src/world/layout.js';

// The storm state of an N64Renderer without WebGL (as in render-storm.test.js).
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

// A warm, hall-like look: every field given.
const HALL = Object.freeze({
  fog: 0x3b2a1d,
  near: 3500,
  far: 16000,
  water: 0x2a4a50,
  sun: 0xffe0b0,
  sunIntensity: 0.5 * Math.PI,
  sunDir: Object.freeze({ x: 0, y: 0.72, z: 0.69 }),
  sky: 0xfff0da,
  ground: 0x6e5038,
  ambientIntensity: 0.55 * Math.PI,
});

const hex = (c) => c.getHex();

// Everything setAtmosphere and the storm touch, as plain numbers (exact comparisons).
function look(r) {
  const { fog, background } = r.scene;
  return {
    fog: fog.color.toArray(),
    near: fog.near,
    far: fog.far,
    background: background.toArray(),
    water: r.underwater.color.toArray(),
    uwNear: r.underwater.near,
    uwFar: r.underwater.far,
    sun: r.sun.color.toArray(),
    sunIntensity: r.sun.intensity,
    sunPos: r.sun.position.toArray(),
    sky: r.ambient.color.toArray(),
    ground: r.ambient.groundColor.toArray(),
    ambientIntensity: r.ambient.intensity,
  };
}

function assertHall(r) {
  const { scene } = r;
  assert.equal(hex(scene.fog.color), HALL.fog);
  assert.equal(hex(scene.background), HALL.fog, 'the clear colour is the fog colour');
  assert.equal(scene.fog.near, HALL.near);
  assert.equal(scene.fog.far, HALL.far);
  assert.equal(hex(r.underwater.color), HALL.water);
  assert.equal(hex(r.sun.color), HALL.sun);
  assert.equal(r.sun.intensity, HALL.sunIntensity);
  assert.deepEqual(r.sun.position.toArray(), [HALL.sunDir.x * 10000, HALL.sunDir.y * 10000, HALL.sunDir.z * 10000]);
  assert.equal(hex(r.ambient.color), HALL.sky);
  assert.equal(hex(r.ambient.groundColor), HALL.ground);
  assert.equal(r.ambient.intensity, HALL.ambientIntensity);
}

test('setAtmosphere: fog colour, range and background, underwater colour, sun and hemisphere', () => {
  const r = stormRenderer();
  r.setAtmosphere(HALL);
  assertHall(r);
  assert.equal(r.underwater.near, UNDERWATER_FOG.near, 'the underwater range stays');
  assert.equal(r.underwater.far, UNDERWATER_FOG.far);
});

test('a field left out keeps the grounds value', () => {
  const r = stormRenderer();
  const grounds = look(r);
  r.setAtmosphere({ near: 7000, far: 28000, sun: 0xffe2b4, sunIntensity: 0.66 * Math.PI, sunDir: { x: -0.5, y: 0.45, z: 0.74 } });
  const now = look(r);
  assert.equal(now.near, 7000);
  assert.equal(now.far, 28000);
  assert.equal(hex(r.sun.color), 0xffe2b4);
  assert.equal(now.sunIntensity, 0.66 * Math.PI);
  assert.deepEqual(now.sunPos, [-5000, 4500, 7400]);
  for (const key of ['fog', 'background', 'water', 'sky', 'ground', 'ambientIntensity']) assert.deepEqual(now[key], grounds[key], key);
});

test('the storm and the meltdown crossfade from the area look and back to it', () => {
  const r = stormRenderer();
  r.setAtmosphere(HALL);
  const hall = look(r);
  r.setDarkness(0.5);
  assert.notEqual(hex(r.scene.fog.color), HALL.fog);
  assert.ok(r.scene.fog.far < HALL.far && r.scene.fog.far > STORM_FOG.far, 'the range crossfades from the hall range');
  assert.ok(r.scene.fog.near < HALL.near && r.scene.fog.near > STORM_FOG.near);
  r.setDarkness(1);
  assert.equal(hex(r.scene.fog.color), STORM_FOG.color);
  assert.equal(r.scene.fog.far, STORM_FOG.far);
  r.setDarkness(0);
  assert.deepEqual(look(r), hall, 'back to the hall, not to the grounds');
  r.setMeltdown({ warn: 1, fire: 0.6, white: 0.2 });
  assert.notDeepEqual(look(r).fog, hall.fog);
  r.setMeltdown({});
  assert.deepEqual(look(r), hall);
});

test('setAtmosphere(null) restores the grounds exactly', () => {
  const r = stormRenderer();
  const grounds = look(r);
  r.setAtmosphere(HALL);
  r.setDarkness(0.3);
  r.setDarkness(0);
  r.setAtmosphere(null);
  assert.deepEqual(look(r), grounds);
  const { scene } = r;
  assert.equal(hex(scene.fog.color), FOG_COLOR);
  assert.equal(hex(scene.background), FOG_COLOR);
  assert.equal(scene.fog.near, FOG_NEAR);
  assert.equal(scene.fog.far, FOG_FAR);
  assert.equal(hex(r.underwater.color), UNDERWATER_FOG.color);
  assert.equal(hex(r.sun.color), SUN_COLOR);
  assert.equal(r.sun.intensity, SUN_INTENSITY);
  assert.deepEqual(r.sun.position.toArray(), [SUN_DIR.x * 10000, SUN_DIR.y * 10000, SUN_DIR.z * 10000]);
  assert.equal(hex(r.ambient.color), AMBIENT_SKY_COLOR);
  assert.equal(hex(r.ambient.groundColor), AMBIENT_GROUND_COLOR);
  assert.equal(r.ambient.intensity, AMBIENT_INTENSITY);
  r.setAtmosphere(); // (no argument: the grounds too)
  assert.deepEqual(look(r), grounds);
});

test('switching under water: the new surface fog waits for surfacing, the water colour is at once', () => {
  const r = stormRenderer();
  const { scene } = r;
  r.underwater.update(true);
  assert.equal(hex(scene.fog.color), UNDERWATER_FOG.color);
  r.setAtmosphere(HALL);
  assert.equal(hex(scene.fog.color), HALL.water, 'under water the area water colour shows');
  assert.equal(scene.fog.far, UNDERWATER_FOG.far);
  r.underwater.update(false);
  assertHall(r);
  r.underwater.update(true);
  r.setAtmosphere(null);
  r.underwater.update(false);
  assert.equal(hex(scene.fog.color), FOG_COLOR, 'surfacing into the grounds, not the hall');
  assert.equal(scene.fog.near, FOG_NEAR);
});

test('no light is added or removed: the actor shader programs never change', () => {
  const r = stormRenderer();
  const lights = () => {
    const out = [];
    r.scene.traverse((o) => o.isLight && out.push(`${o.type}:${o.name}`));
    return out.sort();
  };
  const before = lights();
  r.setAtmosphere(HALL);
  r.setDarkness(1);
  r.setAtmosphere(null);
  const dirs = [];
  r.scene.traverse((o) => o.isDirectionalLight && dirs.push(o.name));
  assert.deepEqual(dirs.sort(), ['stormKey', 'sun']);
  assert.deepEqual(lights(), before);
  assert.deepEqual(before, ['DirectionalLight:stormKey', 'DirectionalLight:sun', 'HemisphereLight:ambient']);
});
