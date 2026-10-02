// The realistic look's performance tiers: what a device draws the look with. A first guess from
// the device (R3 adds the governor that steps down or up from measured frame times).
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
//   texSize(tier, kind) -> px     // a texture set's size (512 or 256)
//
// Settings: pixelRatio (cap), maxPixels, samples (the HDR target's MSAA; low draws straight to
// the canvas, `direct`: no HDR target, three tone maps per material), shadow (map size), box
// (the shadow camera's half size round the focus), tex (the big sets' size) and small (the
// rest), anisotropy, probe (the reflection probe's cube size).

export const TIERS = Object.freeze({
  high: Object.freeze({ name: 'high', pixelRatio: 1.5, maxPixels: 2.4e6, samples: 4, direct: false, shadow: 2048, box: 2600, tex: 512, small: 256, anisotropy: 8, probe: 256 }),
  mid: Object.freeze({ name: 'mid', pixelRatio: 1, maxPixels: 1.6e6, samples: 2, direct: false, shadow: 1024, box: 2200, tex: 512, small: 256, anisotropy: 4, probe: 128 }),
  low: Object.freeze({ name: 'low', pixelRatio: 1, maxPixels: 0.9e6, samples: 0, direct: true, shadow: 1024, box: 1600, tex: 256, small: 256, anisotropy: 2, probe: 64 }),
});

// The sets drawn at the big size on high (and mid, but for the lawn and the leaves there).
const BIG = new Set(['boards', 'brick', 'tiles', 'asphalt', 'grass', 'pavers']);
const MID_SMALL = new Set(['grass']);

export function texSize(tier, kind, opts = {}) {
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
