// The realistic look's performance tiers: what a device draws the look with. A first guess from
// the device, then a governor that steps the drawing down a ladder (or back up) from the frame
// times it measures.
//
//   TIERS.high | .mid | .low      // the settings (below)
//   guessTier({ coarse, touchPoints, shortSide, gpu }) -> 'high' | 'mid' | 'low'
//       phones and tablets (a coarse pointer, touch points and a short side <= 1024 CSS px):
//       low; a discrete or Apple-silicon GPU (the renderer string names Apple M, NVIDIA, AMD or
//       Radeon): high; other desktops (Intel UHD / Iris, software): mid
//   pickTier(search, env) -> name // ?tier=high|mid|low overrides the guess
//   deviceOf(renderer) -> env     // the guess's inputs from the browser and the GL context
//   lookPixelRatio(tier, dpr, width, height) -> ratio   // the render size's pixel ratio for a
//                                 // width x height CSS picture: min(dpr, cap) and at most
//                                 // maxPixels drawn
//   texSize(tier, kind) -> px     // a texture set's size (512 or 256; the leaf atlas, four
//                                 // sets in one, 1024 on high)
//   ladder(tier) -> [level]       // what the governor steps through, the tier itself first:
//                                 // each tier's own render size, MSAA, shadow and grass from
//                                 // this one down, each then at 85 % of its render size;
//                                 // level { name, pixelRatio, maxPixels, samples, shadow, box,
//                                 // grass (a share of the build's blades' reach), scale }. What
//                                 // was built (textures, geometry) stays: these only draw it.
//   new Governor({ levels, level }) // gov.frame(ms) per frame drawn, ms since the one before ->
//                                 // the level to step to (levels.length: below the ladder, the
//                                 // classic look) or null: frames over budget for a window (2 s:
//                                 // the 90th percentile over 20 ms, 50 fps; on a low level 36 ms,
//                                 // 28 fps) step down; every frame keeping 60 fps (17.5 ms) for
//                                 // 5 s steps back up, and a step up that fails doubles the wait
//                                 // before the next (up to a minute). Stalls (over 250 ms: a
//                                 // hidden tab, a build; but five in a row count) and the
//                                 // second after a step are not counted.
//   savedLevel(tier), saveLevel(tier, level)   // the last good level on this device (local
//                                 // storage; a convenience: unavailable, the tier's own)
//
// Settings: pixelRatio (cap), maxPixels, samples (the HDR target's MSAA; low draws straight to
// the canvas, `direct`: no HDR target, three tone maps per material), shadow (map size), box
// (the shadow camera's half size round the focus), tex (the big sets' size) and small (the
// rest), anisotropy, probe (the reflection probe's cube size; 0 on low: none, the glass reflects
// the sky's environment: a phone is spared the capture and every program compiled a second
// time for it, its half-float cube drawn where nothing else draws to a target).

export const TIERS = Object.freeze({
  high: Object.freeze({ name: 'high', pixelRatio: 1.5, maxPixels: 2.4e6, samples: 4, direct: false, shadow: 2048, box: 2600, tex: 512, small: 256, anisotropy: 8, probe: 256 }),
  mid: Object.freeze({ name: 'mid', pixelRatio: 1, maxPixels: 1.6e6, samples: 2, direct: false, shadow: 1024, box: 2200, tex: 512, small: 256, anisotropy: 4, probe: 128 }),
  low: Object.freeze({ name: 'low', pixelRatio: 1, maxPixels: 0.9e6, samples: 0, direct: true, shadow: 1024, box: 1600, tex: 256, small: 256, anisotropy: 2, probe: 0 }),
});

// The sets drawn at the big size on high (and mid, but for the lawn and the leaves there).
const BIG = new Set(['boards', 'brick', 'tiles', 'asphalt', 'grass', 'pavers']);
const MID_SMALL = new Set(['grass']);

export function texSize(tier, kind, opts = {}) {
  if (kind === 'leaves') return tier.name === 'high' ? 1024 : 512; // (an atlas of four)
  if (!BIG.has(kind) || (opts.leaves === 0 && kind === 'grass')) return tier.small;
  if (tier.name === 'mid' && MID_SMALL.has(kind)) return tier.small;
  return tier.tex;
}

export function guessTier({ coarse = false, touchPoints = 0, shortSide = 1080, gpu = '' } = {}) {
  if (coarse && touchPoints > 0 && shortSide <= 1024) return 'low';
  if (/Apple M|NVIDIA|AMD|Radeon/i.test(gpu)) return 'high';
  return 'mid';
}

export function pickTier(search = '', env = {}) {
  const asked = new URLSearchParams(search).get('tier');
  return TIERS[asked] ? asked : guessTier(env);
}

export function deviceOf(renderer) {
  const env = { coarse: false, touchPoints: 0, shortSide: 1080, gpu: '' };
  if (typeof window !== 'undefined') {
    env.coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    env.touchPoints = navigator.maxTouchPoints || 0;
    env.shortSide = Math.min(window.screen?.width || 1080, window.screen?.height || 1080);
  }
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    env.gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    // (no context: the guess goes by the pointer alone)
  }
  return env;
}

export function lookPixelRatio(tier, dpr, width, height) {
  const ratio = Math.min(dpr || 1, tier.pixelRatio);
  const pixels = width * height * ratio * ratio;
  return pixels > tier.maxPixels ? Math.sqrt(tier.maxPixels / (width * height)) : ratio;
}

// The blades' reach on each tier's level (a share of the built grid's: GRASS in
// world/lane/real/grass.js, high's 760 and mid's 480; none on low).
const GRASS_REACH = { high: 1, mid: 480 / 760, low: 0 };
const NAMES = ['high', 'mid', 'low'];

export function ladder(tier) {
  const out = [];
  for (const name of NAMES.slice(NAMES.indexOf(tier.name))) {
    const t = TIERS[name];
    const level = { name, pixelRatio: t.pixelRatio, maxPixels: t.maxPixels, samples: tier.direct ? 0 : t.samples, shadow: t.shadow, box: t.box, grass: GRASS_REACH[name], scale: 1 };
    out.push(level, { ...level, name: `${name} 85%`, scale: 0.85 });
  }
  return out;
}

const WINDOW = 2000; // ms of frames a verdict is made on
const BUDGET = 20; // ms: the 90th percentile above it steps down (50 fps)
const LOW_BUDGET = 36; // ...on a low level (28 fps: phones aim at 30)
const FAST = 17.5; // ms: every frame keeping 60 fps
const UP_WAIT = 5000; // ms of fast frames before a step up (doubled after one that fails)
const MAX_WAIT = 60000;
const STALL = 250; // ms: a frame this late is a stall (a hidden tab, a build), not the GPU...
const STALLS = 5; // ...unless this many come in a row
const SETTLE = 1000; // ms after a step not counted (the crossfade, the targets made again)

export class Governor {
  constructor({ levels, level = 0 }) {
    this.levels = levels;
    this.level = level;
    this.times = [];
    this.span = 0;
    this.settle = SETTLE;
    this.calm = 0; // ms of fast windows in a row
    this.wait = UP_WAIT;
    this.raised = -1; // the level the last step up went to (until it holds a window)
    this.stalls = 0; // stalls in a row
  }

  frame(ms) {
    if (this.level >= this.levels.length) return null; // (off the ladder: classic, for good)
    // A stall (a hidden tab, a build) is not the GPU: the window starts again, unless the stalls
    // go on (a device this slow: they count, as late frames).
    this.stalls = ms > STALL ? this.stalls + 1 : 0;
    if (this.stalls > 0 && this.stalls < STALLS) {
      this.times.length = 0;
      this.span = 0;
      return null;
    }
    if (this.settle > 0) {
      this.settle -= ms;
      return null;
    }
    this.times.push(ms);
    this.span += ms;
    if (this.span < WINDOW) return null;
    const p90 = this.times.sort((a, b) => a - b)[Math.floor(this.times.length * 0.9)];
    this.times.length = 0;
    this.span = 0;
    const raised = this.raised === this.level;
    this.raised = -1;
    if (p90 > (this.levels[this.level].name.startsWith('low') ? LOW_BUDGET : BUDGET)) {
      this.calm = 0;
      if (raised) this.wait = Math.min(this.wait * 2, MAX_WAIT); // (it could not hold: wait longer)
      return this.go(this.level + 1);
    }
    this.calm = p90 <= FAST ? this.calm + WINDOW : 0;
    if (this.calm < this.wait || this.level === 0) return null;
    this.calm = 0;
    this.raised = this.level - 1;
    return this.go(this.level - 1);
  }

  go(level) {
    this.level = level;
    this.settle = SETTLE;
    return level;
  }
}

const SAVED = 'castleGrounds.realLevel.v1';

export function savedLevel(tier) {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED));
    return saved?.tier === tier.name ? saved.level : 0;
  } catch {
    return 0;
  }
}

export function saveLevel(tier, level) {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ tier: tier.name, level }));
  } catch {
    // (no storage: the next visit starts at the tier's own level)
  }
}
