// Bus layout shared by the live engine and offline renders:
//
//   music ─┬──────────────┐
//          └─ send ─┐     ├─> compressor -> soft clipper -> master -> destination
//   sfx ───┬────────┼─────┤
//          └─ send ─┴─> reverb (generated impulse)
//   amb ──────────────────┘
//
// The compressor evens out stacked sounds; the soft clipper after it is a hard ceiling
// (it passes everything below KNEE untouched) so even a pile-up never reaches full scale.

// A small outdoor-ish room: decorrelated stereo noise with an exponential decay that
// darkens over time (one-pole low-pass whose cutoff falls along the tail).
function makeImpulse(ctx, seconds = 1.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const predelay = Math.floor(ctx.sampleRate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = predelay; i < len; i++) {
      const x = (i - predelay) / (len - predelay);
      const smooth = 0.25 + 0.7 * x; // more smoothing (darker) later in the tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - smooth);
      d[i] = lp * Math.exp(-5 * x) * Math.min(1, (i - predelay) / 200);
    }
  }
  return buf;
}

// Resting bus levels; the engine ducks music/ambience relative to these.
export const LEVELS = { music: 0.6, sfx: 0.8, amb: 0.8 };

const KNEE = 0.6; // soft clipper: identity below this level...
const CEILING = 0.95; // ...then a tanh shoulder that never exceeds this
const CLIP_SPAN = 2; // the curve covers inputs up to +-2 (6 dB over full scale)

// WaveShaper curve over [-CLIP_SPAN, CLIP_SPAN] (the input is pre-scaled by 1 / CLIP_SPAN).
export function softClipCurve(n = 4097) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((2 * i) / (n - 1) - 1) * CLIP_SPAN;
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (CEILING - KNEE) * Math.tanh((a - KNEE) / (CEILING - KNEE));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function gain(ctx, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

export function createMixer(ctx) {
  const master = gain(ctx, 1, ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const clipper = ctx.createWaveShaper();
  clipper.curve = softClipCurve();
  comp.connect(gain(ctx, 1 / CLIP_SPAN, clipper));
  clipper.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  reverb.connect(gain(ctx, 0.9, comp));

  const music = gain(ctx, LEVELS.music, comp);
  music.connect(gain(ctx, 0.3, reverb));
  const sfx = gain(ctx, LEVELS.sfx, comp);
  sfx.connect(gain(ctx, 0.14, reverb));
  const amb = gain(ctx, LEVELS.amb, comp);
  return { master, music, sfx, amb };
}
