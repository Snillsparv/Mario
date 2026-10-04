// The realistic looks' service (main.js makes one for core/AreaSwitch.js): the tier this device
// draws them at, whether they may run, the texture store, and an area's realistic build
// (world/areas.js def.real: Sparrow Lane's world/lane/real/jobs.js, its build in the lazily
// loaded realLook chunk: world/lane/real/look.js), made in the background as soon as its sets,
// its geometry and its code are in, so it is usually ready before Jonas gets there. This module
// and the tiers and the texture store (tier.js, textureStore.js) are the realistic looks' part
// of the game's main chunk; the rest of their main-thread code is the realLook chunk's.
//
//   const real = new RealAreas({ view, search, test })   // search: location.search
//                        // (?look=real|classic, ?tier=high|mid|low); test: ?test=1, where the
//                        // realistic looks are opt-in (?look=real or a ?tier=): a scripted run
//                        // stays deterministic, its frames never changing look mid-script (and
//                        // a look swaps in without a crossfade there)
//   real.tier            // tier.js TIERS[...]: the guess, or ?tier=
//   real.wanted          // realistic looks are on: not classic by choice, nothing has failed
//   real.reason          // why not ('' while wanted): 'chosen' (?look=classic or the toggle),
//                        // or what failed (the workers, a build)
//   real.fade            // seconds a look takes to cross-fade in or out where the picture shows
//                        // (FADE; 0 under ?test=1)
//   real.prefetch(defs) -> Promise   // the workers start on every def.real's texture sets and
//                        // geometry, its code's chunk starts loading (def.real.load), and its
//                        // build follows them (build); resolves once the
//                        // workers run (main.js waits for that, a moment, before the rest of
//                        // its boot: a worker only starts while the main thread is free, so they
//                        // then work beside the boot)
//   real.build(def) -> Promise<{ part, look }>   // an area's build, once a session: its sets and
//                        // geometry from the workers, its build (def.real.build: a generator, run
//                        // a few ms at a time), its textures uploaded, its programs compiled
//                        // (view.compileLook) and linked, its post chain's too, its reflection
//                        // probes taken (a task each), then its far shadow map: all between
//                        // frames, no task over a few ms but a program's link, a probe and the
//                        // far map (where the browser waits for the GPU), so nothing hitches as
//                        // it swaps in
//   real.done            // Map: area name -> its build, once ready (core/AreaSwitch.js shows it
//                        // from an area's first frame when it is)
//   real.setClassic(on)  // the "Classic street" choice (G, this session only)
//   real.governed        // its looks' tiers are governed (tier.js Governor: not under ?test=1,
//                        // nor with ?tier=); real.onChange: called when they stop being wanted
//                        // (the governor found even its last level too slow: reason 'too slow')
//   real.ms[area]        // how long its build's steps took ({ textures (waiting for the workers
//                        // and the chunk),
//                        // build, compile, upload, probe, far, ready (ms after the page started) },
//                        // ms), and real.store.ms each worker job's; real.longest: the longest
//                        // stretch of build work between two frames, ms
//
// Fallbacks to the classic look (the area simply keeps it): ?look=classic (and ?test=1 unless
// asked for), the toggle, the governor finding even its last level too slow (real.slow), the
// workers failing, the realLook chunk failing to load (offline, a 404: reason 'chunk') or a
// build throwing (logged once); without float
// render targets (EXT_color_buffer_float) the tier drops to low, whose direct path needs none,
// and retro over realistic is off.

import * as THREE from 'three';
import { TIERS, deviceOf, pickTier, Governor, savedLevel } from './tier.js';
import { TextureStore } from './textureStore.js';

const SLICE = 6; // ms of the build's work between frames
const FADE = 0.4; // seconds of a look's cross-fade
const MAPS = ['map', 'normalMap', 'roughnessMap', 'aoMap'];

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

export class RealAreas {
  constructor({ view, search = '', test = false, store = null }) {
    this.view = view;
    this.store = store ?? new TextureStore();
    const renderer = view.renderer;
    this.float = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const tier = pickTier(search, deviceOf(renderer));
    this.tier = TIERS[this.float ? tier : 'low'];
    this.anisotropy = Math.min(this.tier.anisotropy, renderer.capabilities.getMaxAnisotropy());
    const params = new URLSearchParams(search);
    const asked = params.get('look');
    this.classic = asked === 'classic' || (test && asked !== 'real' && !params.has('tier'));
    this.fade = test ? 0 : FADE;
    this.governed = !test && !params.has('tier'); // (a tier asked for is drawn as asked)
    this.onChange = null; // () => after the looks stop being wanted (core/AreaSwitch.js)
    this.failed = '';
    this.builds = new Map(); // area name -> its build's promise
    this.done = new Map(); // area name -> its build ({ part, look }) once ready
    this.ms = {}; // { area: { textures, build, compile, upload, probe, ready } }
    this.longest = 0; // ms: the longest run of the builds' work between two frames (slices)
  }

  get wanted() {
    return !this.classic && !this.failed;
  }

  get reason() {
    if (this.classic) return 'chosen';
    return this.failed;
  }

  setClassic(on) {
    this.classic = !!on;
  }

  prefetch(defs) {
    if (this.classic) return Promise.resolve();
    for (const def of Object.values(defs)) {
      if (!def.real) continue;
      this.store.detail(def.real.detail(this.tier)).catch(() => {});
      this.store.load(def.real.jobs(this.tier)).catch(() => {});
      def.real.load().catch(() => {});
      this.build(def).catch(() => {});
    }
    return this.store.started();
  }

  // Runs `step` (returning true while it has more to do) SLICE ms at a time, a frame let
  // through between slices.
  async slices(step) {
    let t0 = performance.now();
    let more = true;
    while (more) {
      more = step();
      const t = performance.now() - t0;
      if (more && t < SLICE) continue;
      this.longest = Math.max(this.longest, Math.round(t));
      if (!more) break;
      await pause();
      t0 = performance.now();
    }
  }

  build(def) {
    let p = this.builds.get(def.name);
    if (!p) {
      p = this.make(def);
      this.builds.set(def.name, p);
    }
    return p;
  }

  async make(def) {
    const real = def.real;
    const ms = (this.ms[def.name] = {});
    let t0 = performance.now();
    const lap = (name) => {
      ms[name] = Math.round(performance.now() - t0);
      t0 = performance.now();
    };
    try {
      const code = real.load().catch((e) => {
        console.warn(`realistic look: its code did not load (${e?.message ?? e})`);
        throw new Error('chunk');
      });
      const [, detail, build] = await Promise.all([this.store.load(real.jobs(this.tier)), this.store.detail(real.detail(this.tier)), code]);
      lap('textures');
      await pause();
      t0 = performance.now();
      const steps = build(def.layout, { store: this.store, tier: this.tier, origin: def.origin, anisotropy: this.anisotropy, canRetro: this.float, detail });
      let step = steps.next();
      await this.slices(() => !(step = steps.next()).done);
      const built = step.value;
      lap('build');
      const { part, look } = built;
      if (this.governed) {
        // The governor, from this device's last good level.
        const level = Math.min(savedLevel(this.tier), look.levels.length - 1);
        look.governor = new Governor({ levels: look.levels, level });
        look.setLevel(level);
        look.onSlow = () => this.slow();
      }
      // Its probe is taken where the area will stand (under a group at its origin, in the scene
      // only meanwhile: the classic warm-ups compile whatever hangs in it, hidden or not).
      const holder = new THREE.Group();
      holder.position.set(def.origin.x, def.origin.y, def.origin.z);
      holder.add(part.object3D);
      const meshes = [];
      part.object3D.traverse((o) => o.isMesh && meshes.push(o));
      const { view } = this;
      // In an order that keeps each program's link (where the browser makes the main thread
      // wait for it) from waiting on uploads queued before it: the programs (and the post
      // chain's), the textures, then the probe (the first frame of the street: it uploads its
      // buffers, makes the sun's shadow programs), then the far shadow map (the street from the
      // sun once more, at its own size), each in a task of its own.
      look.warmProbe(view.renderer);
      await pause();
      await this.link(look, meshes);
      await look.compilePost(view.renderer);
      lap('compile');
      await this.upload(meshes);
      lap('upload');
      // (Each probe a task of its own: the cars' clusters', then the windows'.)
      for (const name of look.probeNames()) {
        view.withLook(look, holder, [part.object3D], () => look.takeProbe(view, name));
        await pause();
      }
      view.withLook(look, holder, [part.object3D], () => look.takeProbe(view));
      lap('probe');
      await pause();
      t0 = performance.now();
      view.withLook(look, holder, [part.object3D], () => look.takeFar(view));
      part.object3D.removeFromParent();
      lap('far');
      await pause();
      ms.ready = Math.round(performance.now());
      this.done.set(def.name, built);
      return built;
    } catch (e) {
      if (!this.failed) console.warn(`realistic look unavailable (${def.name}): ${e?.message ?? e}`);
      this.failed = String(e?.message ?? e);
      throw e;
    }
  }

  // The meshes' programs compiled as `look` draws them, a mesh at a time, then each linked a
  // slice at a time (where the browser cannot link them in the background, the first frame
  // would wait for all of them).
  async link(look, meshes) {
    const programs = new Set();
    const compiled = [];
    const list = [...meshes];
    await this.slices(() => {
      if (list.length) compiled.push(this.view.compileLook(look, [list.shift()], programs));
      return list.length > 0;
    });
    await Promise.all(compiled);
    const links = [...programs];
    await this.slices(() => {
      links.shift()?.getUniforms();
      return links.length > 0;
    });
  }

  // Even the governor's last level is too slow here: the classic look from now on (the F1 line
  // says why).
  slow() {
    console.warn('realistic look: too slow on this device, classic from now on');
    this.failed = 'too slow';
    this.onChange?.();
  }

  // The build's textures uploaded a few at a time (clones share their image's upload).
  async upload(meshes) {
    const renderer = this.view.renderer;
    const textures = new Set();
    for (const o of meshes) {
      for (const m of [].concat(o.material)) for (const key of MAPS) if (m[key]) textures.add(m[key]);
    }
    const list = [...textures];
    await this.slices(() => {
      const t = list.shift();
      if (t) renderer.initTexture(t);
      return list.length > 0;
    });
  }
}
