// Owns the WebGL renderer, the scene, the main camera and the overall "N64 capture" look.
//
//   N64 mode (default, F2): the scene is drawn into a low-resolution target and one
//     fullscreen pass (post/N64Pass.js) quantises it like a 16-bit framebuffer, applies a
//     soft horizontal video filter and upscales bilinearly. Off = native resolution.
//   F3: 4:3 pillarbox (the canvas shrinks to a centred 4:3 rectangle; `viewport` says where,
//     onViewportChange/alignOverlay keep DOM overlays such as the HUD inside it).
//   F1: debug overlay (fps, draw calls, triangles).
//   Underwater: when the camera is below the water surface the fog switches to a short
//     blue-green one and the sky dome is tinted toward it (surface heights from
//     layout.waterLevelAt unless setWaterLevelFn overrides it).
//
// World geometry is unlit (baked vertex colours). The sun and hemisphere lights below only
// shade dynamic actors (hero, coins, star) that use Lambert/Phong materials.

import * as THREE from 'three';
import * as sky from '../world/sky.js';
import { SUN_DIR, waterLevelAt } from '../world/layout.js';
import { N64Pass } from './post/N64Pass.js';
import { fitViewport, internalResolution, overlayStyle, PILLARBOX_ASPECT } from './post/screen.js';
import { loadSettings, saveSettings } from './post/settings.js';
import { UnderwaterFog, isBelowWater } from './post/underwater.js';
import { DebugOverlay } from './post/DebugOverlay.js';

// The fog and the clear colour are the sky's horizon colour, so distant terrain melts
// into the bottom of the sky dome.
export const FOG_COLOR = sky.SKY_HORIZON_COLOR ?? 0xa8c8f0;
export const FOG_NEAR = 8000;
export const FOG_FAR = 30000;

// Scanlines of the low-resolution render in N64 mode: the console's 240-line output.
// Polygon edges are smoothed by MSAA (like the console's coverage anti-aliasing), and the
// post pass filters and upscales bilinearly, so non-integer scales look even too.
export const N64_INTERNAL_HEIGHT = 240;
export const N64_MSAA_SAMPLES = 4;

// three.js lighting is physically based: a Lambert surface returns
// albedo * (sun * cos + ambient) / PI, hence the PI factors. With these values a white
// actor reads ~0.6 in shadow and 1.0+ in full sun, like the baked world lighting
// (materials.bakeLighting: ambient 0.58, diffuse 0.55).
export const SUN_COLOR = 0xfff3e0;
export const SUN_INTENSITY = 0.6 * Math.PI;
export const AMBIENT_SKY_COLOR = 0xffffff;
export const AMBIENT_GROUND_COLOR = 0x9a9a88;
export const AMBIENT_INTENSITY = 0.62 * Math.PI;

const MAX_PIXEL_RATIO = 2;

export class N64Renderer {
  constructor(container, { internalHeight = N64_INTERNAL_HEIGHT, storage } = {}) {
    this.container = container;
    this.internalHeight = internalHeight;
    this.storage = storage;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // one frame = scene + post pass
    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR); // a sky dome draws over it
    this.scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 45000);
    this.addLights();

    // sRGB storage keeps 8 bits of perceptual precision for the linear scene colour. The
    // pass reads the MSAA-resolved texture.
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      samples: N64_MSAA_SAMPLES,
      colorSpace: THREE.SRGBColorSpace,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.pass = new N64Pass();
    this.underwater = new UnderwaterFog(this.scene);
    this.compileObject = (object) => this.renderer.compile(object, this.camera, this.scene);
    this.debug = new DebugOverlay();
    this.waterLevelFn = waterLevelAt;
    this.viewport = { x: 0, y: 0, width: 1, height: 1 }; // CSS px inside the container
    this.viewportListeners = new Set();
    this.pixelRatio = 1;

    const settings = loadSettings(storage);
    this.n64 = settings.n64;
    this.pillarbox = settings.pillarbox;

    this.sizeKey = '';
    this.resize();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onResize = () => this.refit();
    window.addEventListener('keydown', this.onKeyDown);
    // Follow the container's size (it fills the window in the game).
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', this.onResize);
    } else {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(container);
    }
  }

  addLights() {
    this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    this.sun.name = 'sun';
    this.sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).multiplyScalar(10000);
    this.ambient = new THREE.HemisphereLight(AMBIENT_SKY_COLOR, AMBIENT_GROUND_COLOR, AMBIENT_INTENSITY);
    this.ambient.name = 'ambient';
    this.scene.add(this.sun, this.ambient);
  }

  // fn(x, z) -> water surface height or NO_WATER (e.g. collision.waterLevelAt).
  setWaterLevelFn(fn) {
    this.waterLevelFn = fn;
  }

  // Calls fn(viewport) now and whenever the picture rectangle changes (window resize, F3).
  // Returns an unsubscribe function.
  onViewportChange(fn) {
    this.viewportListeners.add(fn);
    fn(this.viewport);
    return () => this.viewportListeners.delete(fn);
  }

  // Keeps a fixed-position DOM overlay (e.g. the HUD root) exactly over the picture, so in
  // 4:3 mode it sits inside the frame instead of over the black bars.
  alignOverlay(element) {
    return this.onViewportChange((vp) => Object.assign(element.style, overlayStyle(vp)));
  }

  get isUnderwater() {
    return this.underwater.active;
  }

  setN64Mode(on) {
    this.n64 = !!on;
    this.saveSettings();
    this.refit();
  }

  setPillarbox(on) {
    this.pillarbox = !!on;
    this.saveSettings();
    this.refit();
  }

  setDebugOverlay(on) {
    this.debug.setVisible(!!on);
  }

  saveSettings() {
    saveSettings({ n64: this.n64, pillarbox: this.pillarbox }, this.storage);
  }

  onKeyDown(e) {
    const actions = {
      F1: () => this.setDebugOverlay(!this.debug.visible),
      F2: () => this.setN64Mode(!this.n64),
      F3: () => this.setPillarbox(!this.pillarbox),
    };
    const action = actions[e.code];
    if (!action) return;
    e.preventDefault(); // F1 = browser help, F3 = find
    if (!e.repeat) action();
  }

  // Resizing reallocates (and clears) the drawing buffer. A ResizeObserver callback runs
  // after this frame's requestAnimationFrame, so without an immediate redraw the cleared
  // canvas would be composited (a black flash on every step of a window drag).
  refit() {
    if (this.resize()) this.draw();
  }

  // Applies the container size and display modes. Returns true if the canvas changed.
  resize() {
    const { renderer, camera, container } = this;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const vp = fitViewport(width, height, this.pillarbox ? PILLARBOX_ASPECT : null);
    // N64 mode upscales a small image anyway, so the canvas stays at CSS resolution.
    const pixelRatio = this.n64 ? 1 : Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.lastDevicePixelRatio = window.devicePixelRatio;
    // Re-assigning the canvas size clears it, so skip redundant resizes.
    const key = `${vp.x},${vp.y},${vp.width},${vp.height},${pixelRatio},${this.n64}`;
    if (key === this.sizeKey) return false;
    this.sizeKey = key;
    this.viewport = vp;
    this.pixelRatio = pixelRatio;

    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(vp.width, vp.height);
    renderer.domElement.style.left = `${vp.x}px`;
    renderer.domElement.style.top = `${vp.y}px`;

    camera.aspect = vp.width / vp.height;
    camera.updateProjectionMatrix();

    this.internal = internalResolution(vp.width, vp.height, this.internalHeight);
    this.target.setSize(this.internal.width, this.internal.height);
    for (const fn of this.viewportListeners) fn(vp);
    return true;
  }

  // One game frame.
  render() {
    // Moving the window to a screen with another pixel density fires no resize event.
    if (window.devicePixelRatio !== this.lastDevicePixelRatio) this.resize();
    this.draw();
    this.debug.frame(performance.now() / 1000, this.renderer.info, () => this.describeMode());
  }

  // Draws the current scene and camera state (also used to repaint after a resize).
  draw() {
    const { renderer, scene, camera } = this;
    this.underwater.update(isBelowWater(camera.position, this.waterLevelFn));

    renderer.info.reset();
    if (this.n64) {
      renderer.setRenderTarget(this.target);
      this.underwater.warm(this.compileObject, 'n64'); // programs depend on the bound target
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      this.pass.render(renderer, this.target.texture, this.internal.width, this.internal.height);
    } else {
      this.underwater.warm(this.compileObject, 'native');
      renderer.render(scene, camera);
    }
  }

  describeMode() {
    const size = this.n64
      ? `N64 ${this.internal.width}x${this.internal.height}`
      : `native ${Math.round(this.viewport.width * this.pixelRatio)}x${Math.round(this.viewport.height * this.pixelRatio)}`;
    return size + (this.pillarbox ? ' 4:3' : '') + (this.isUnderwater ? ' underwater' : '');
  }

  dispose() {
    this.viewportListeners.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.debug.dispose();
    this.underwater.dispose();
    this.pass.dispose();
    this.target.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
