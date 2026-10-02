// The realistic looks' service (main.js makes one for core/AreaSwitch.js): the tier this device
// draws them at, whether they may run, the texture store, and an area's realistic build
// (world/areas.js def.real: Sparrow Lane's world/lane/real/look.js).
//
//   const real = new RealAreas({ view, search, test })   // search: location.search
//                        // (?look=real|classic, ?tier=high|mid|low); test: ?test=1, where the
//                        // realistic looks are opt-in (?look=real or a ?tier=): a scripted run
//                        // stays deterministic, its frames never changing look mid-script
//   real.tier            // tier.js TIERS[...]: the guess, or ?tier=
//   real.wanted          // realistic looks are on: not classic by choice, nothing has failed
//   real.reason          // why not ('' while wanted): 'chosen' (?look=classic or the toggle),
//                        // or what failed (the worker, a build)
//   real.prefetch(defs)  // the worker starts on every def.real's texture sets, at idle priority
//   real.build(area) -> Promise<{ part, look }>   // its sets (usually there already), its build
//                        // (def.real.build), its textures uploaded a slice at a time, its
//                        // programs compiled for the look (view.compileLook)
//   real.setClassic(on)  // the "Classic street" choice (G, this session only)
//   real.ms[area]        // how long its build's steps took ({ textures (waiting for the worker),
//                        // build, upload, compile }, ms)
//
// Fallbacks to the classic look (the area simply keeps it): ?look=classic (and ?test=1 unless
// asked for), the toggle, the worker failing or a build throwing (logged once); without float
// render targets (EXT_color_buffer_float) the tier drops to low, whose direct path needs none,
// and retro over realistic is off.

import { TIERS, deviceOf, pickTier } from './tier.js';
import { TextureStore } from './textureStore.js';

const UPLOAD_SLICE = 4; // ms of texture uploads between frames
const MAPS = ['map', 'normalMap', 'roughnessMap', 'aoMap'];

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
    this.failed = '';
    this.ms = {}; // { area: { textures, build, upload, compile } } ms of each realistic build's steps
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
    if (this.classic) return;
    const start = () => {
      for (const def of Object.values(defs)) if (def.real) this.store.load(def.real.jobs(this.tier)).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 2000 });
    else setTimeout(start, 0);
  }

  // The build's textures uploaded a few at a time, a frame let through every UPLOAD_SLICE ms,
  // rather than all at once in the first frame the look draws (clones share their image's
  // upload).
  async upload(object) {
    const renderer = this.view.renderer;
    const textures = new Set();
    object.traverse((o) => {
      for (const m of o.material ? [].concat(o.material) : []) for (const key of MAPS) if (m[key]) textures.add(m[key]);
    });
    let t0 = performance.now();
    for (const t of textures) {
      renderer.initTexture(t);
      if (performance.now() - t0 < UPLOAD_SLICE) continue;
      await new Promise((resolve) => setTimeout(resolve, 0));
      t0 = performance.now();
    }
  }

  async build(area) {
    const real = area.def.real;
    const ms = (this.ms[area.name] = {});
    const lap = (name, t0) => (ms[name] = Math.round(performance.now() - t0));
    try {
      let t0 = performance.now();
      await this.store.load(real.jobs(this.tier));
      lap('textures', t0);
      t0 = performance.now();
      const built = real.build(area.def.layout, { store: this.store, tier: this.tier, origin: area.def.origin, anisotropy: this.anisotropy, canRetro: this.float });
      lap('build', t0);
      t0 = performance.now();
      await this.upload(built.part.object3D);
      lap('upload', t0);
      t0 = performance.now();
      await this.view.compileLook(built.look, [built.part.object3D]);
      lap('compile', t0);
      return built;
    } catch (e) {
      if (!this.failed) console.warn(`realistic look unavailable (${area.name}): ${e?.message ?? e}`);
      this.failed = String(e?.message ?? e);
      throw e;
    }
  }
}
