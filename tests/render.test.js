// Pure renderer helpers: viewport fitting, internal resolution, dither matrix, persisted
// settings and the underwater fog switch. The WebGL parts are checked by the preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitViewport, internalResolution, bayerMatrix, overlayStyle, PILLARBOX_ASPECT } from '../src/render/post/screen.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/render/post/settings.js';
import { UnderwaterFog, isBelowWater, UNDERWATER_FOG } from '../src/render/post/underwater.js';
import { N64Pass } from '../src/render/post/N64Pass.js';
import { NO_WATER } from '../src/core/constants.js';
import * as sky from '../src/world/sky.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('quota');
  },
};

test('renderer module imports in node without touching the DOM', async () => {
  const mod = await import('../src/render/N64Renderer.js');
  assert.equal(typeof mod.N64Renderer, 'function');
  assert.ok(mod.FOG_NEAR < mod.FOG_FAR);
});

test('fog colour is the sky horizon colour, so distant terrain melts into the sky', async () => {
  const { FOG_COLOR } = await import('../src/render/N64Renderer.js');
  if (sky.SKY_HORIZON_COLOR === undefined) return; // sky without the constant: fallback colour
  assert.equal(FOG_COLOR, sky.SKY_HORIZON_COLOR);
});

test('N64 mode renders the console line count with MSAA edges', async () => {
  const { N64_INTERNAL_HEIGHT, N64_MSAA_SAMPLES } = await import('../src/render/N64Renderer.js');
  assert.equal(N64_INTERNAL_HEIGHT, 240);
  assert.ok(N64_MSAA_SAMPLES >= 2);
  assert.deepEqual(internalResolution(1920, 1080, N64_INTERNAL_HEIGHT), { width: 427, height: 240 });
  assert.deepEqual(internalResolution(1440, 1080, N64_INTERNAL_HEIGHT), { width: 320, height: 240 });
});

test('fitViewport fills the area without an aspect', () => {
  assert.deepEqual(fitViewport(1280, 720), { x: 0, y: 0, width: 1280, height: 720 });
  assert.deepEqual(fitViewport(0, 0), { x: 0, y: 0, width: 1, height: 1 });
});

test('fitViewport pillarboxes wide areas and letterboxes tall ones at 4:3', () => {
  assert.deepEqual(fitViewport(1920, 1080, PILLARBOX_ASPECT), { x: 240, y: 0, width: 1440, height: 1080 });
  assert.deepEqual(fitViewport(800, 1000, PILLARBOX_ASPECT), { x: 0, y: 200, width: 800, height: 600 });
  const exact = fitViewport(640, 480, PILLARBOX_ASPECT);
  assert.deepEqual(exact, { x: 0, y: 0, width: 640, height: 480 });
});

test('internalResolution keeps the viewport aspect at the target line count', () => {
  assert.deepEqual(internalResolution(1920, 1080, 360), { width: 640, height: 360 });
  assert.deepEqual(internalResolution(1440, 1080, 360), { width: 480, height: 360 });
  // Never more lines than the viewport has.
  assert.deepEqual(internalResolution(400, 300, 360), { width: 400, height: 300 });
  // Degenerate and extreme sizes stay valid.
  assert.deepEqual(internalResolution(0, 0, 360), { width: 1, height: 1 });
  assert.ok(internalResolution(100000, 400, 360).width <= 2048);
});

test('overlayStyle pins an overlay to the viewport rectangle', () => {
  const vp = fitViewport(960, 540, PILLARBOX_ASPECT);
  assert.deepEqual(overlayStyle(vp), {
    left: '120px',
    top: '0px',
    width: '720px',
    height: '540px',
    right: 'auto',
    bottom: 'auto',
  });
});

test('bayerMatrix(4) is the classic ordered-dither matrix, centred on zero', () => {
  const m = bayerMatrix(4);
  const ranks = m.map((v) => Math.round((v + 0.5) * 16 - 0.5));
  assert.deepEqual(ranks, [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  assert.ok(Math.abs(mean) < 1e-9);
  assert.ok(Math.min(...m) >= -0.5 && Math.max(...m) < 0.5);
  assert.equal(bayerMatrix(2).length, 4);
});

test('settings default to N64 mode on, pillarbox off', () => {
  assert.deepEqual(loadSettings(memoryStorage()), { n64: true, pillarbox: false });
  assert.deepEqual(loadSettings(null), { ...DEFAULT_SETTINGS });
});

test('settings round-trip through storage', () => {
  const storage = memoryStorage();
  assert.equal(saveSettings({ n64: false, pillarbox: true }, storage), true);
  assert.deepEqual(loadSettings(storage), { n64: false, pillarbox: true });
});

test('settings survive corrupt data and throwing storage', () => {
  const corrupt = memoryStorage({ 'castleGrounds.render.v1': '{not json' });
  assert.deepEqual(loadSettings(corrupt), { ...DEFAULT_SETTINGS });
  const wrongTypes = memoryStorage({ 'castleGrounds.render.v1': '{"n64":"no","pillarbox":1}' });
  assert.deepEqual(loadSettings(wrongTypes), { ...DEFAULT_SETTINGS });
  assert.deepEqual(loadSettings(throwingStorage), { ...DEFAULT_SETTINGS });
  assert.equal(saveSettings({ n64: false }, throwingStorage), false);
  assert.equal(saveSettings({ n64: false }, null), false);
});

test('isBelowWater compares against the surface at the camera xz', () => {
  const fn = (x) => (x < 0 ? -420 : NO_WATER);
  assert.equal(isBelowWater({ x: -10, y: -500, z: 0 }, fn), true);
  assert.equal(isBelowWater({ x: -10, y: -300, z: 0 }, fn), false);
  assert.equal(isBelowWater({ x: 10, y: -20000, z: 0 }, fn), false, 'no water here');
  assert.equal(isBelowWater({ x: -10, y: -500, z: 0 }, null), false);
});

test('UnderwaterFog swaps fog and colour background, then restores them', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa8c8f0, 8000, 30000);
  scene.background = new THREE.Color(0x7fb2ff);
  const uw = new UnderwaterFog(scene);

  assert.equal(uw.update(false), false, 'no change while dry');
  assert.equal(uw.update(true), true);
  assert.equal(scene.fog.color.getHex(), UNDERWATER_FOG.color);
  assert.equal(scene.fog.near, UNDERWATER_FOG.near);
  assert.equal(scene.fog.far, UNDERWATER_FOG.far);
  assert.equal(scene.background.getHex(), UNDERWATER_FOG.color);
  assert.equal(uw.update(true), false, 'stays submerged');

  assert.equal(uw.update(false), true);
  assert.equal(scene.fog.color.getHex(), 0xa8c8f0);
  assert.equal(scene.fog.near, 8000);
  assert.equal(scene.fog.far, 30000);
  assert.equal(scene.background.getHex(), 0x7fb2ff);
});

test('UnderwaterFog tolerates scenes without fog or with a non-colour background', () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Texture();
  const uw = new UnderwaterFog(scene);
  uw.update(true);
  uw.update(false);
  assert.equal(scene.fog, null);
  assert.ok(scene.background.isTexture);
});

test('N64Pass builds its material in node with the dither table inlined', () => {
  const pass = new N64Pass();
  const src = pass.material.fragmentShader;
  const table = src.match(/float\[16\]\(([^)]*)\)/);
  assert.ok(table, 'Bayer table present');
  assert.equal(table[1].split(',').length, 16);
  pass.dispose();
});
