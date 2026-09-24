// Small WebAudio building blocks shared by the instruments and sound effects. Every helper
// takes the context, a destination node and a start time, schedules everything up front
// and lets the nodes stop themselves, so the same code runs live and in an
// OfflineAudioContext.

const noiseCache = new WeakMap();

// 2 s of white noise, cached per context.
function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

const brownCache = new WeakMap();

// 2 s of brown (integrated, leaky) noise normalised to about full scale: nearly all of its
// energy is below a few hundred Hz, so a low-passed rumble made from it stays loud with a
// modest gain (white noise loses most of its power to the filter). Cached per context.
function brownBuffer(ctx) {
  let buf = brownCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    let peak = 1e-9;
    for (let i = 0; i < d.length; i++) {
      v = v * 0.996 + (Math.random() * 2 - 1) * 0.06;
      d[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    // Normalise, and fade the loop ends into each other so the wrap is click-free.
    const fade = Math.floor(ctx.sampleRate * 0.02);
    for (let i = 0; i < d.length; i++) d[i] /= peak;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
    }
    brownCache.set(ctx, buf);
  }
  return buf;
}

// Looping noise source starting at a random offset (so repeats never sound identical).
// kind 'brown' gives the low rumble buffer instead of white noise.
export function noiseSource(ctx, t, dur, kind = 'white') {
  const src = ctx.createBufferSource();
  src.buffer = kind === 'brown' ? brownBuffer(ctx) : noiseBuffer(ctx);
  src.loop = true;
  src.start(t, Math.random() * 1.9);
  src.stop(t + dur);
  return src;
}

const curveCache = new Map();

// Waveshaper curve for a soft (tanh) overdrive; `drive` 1 is nearly clean, 6 is heavy.
// The curve is normalised so full-scale input still maps to full scale.
export function driveCurve(drive) {
  let curve = curveCache.get(drive);
  if (!curve) {
    const n = 1025;
    curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(drive * ((2 * i) / (n - 1) - 1)) / norm;
    curveCache.set(drive, curve);
  }
  return curve;
}

// Overdrive stage feeding `out`; returns its input node.
export function overdrive(ctx, out, drive) {
  const ws = ctx.createWaveShaper();
  ws.curve = driveCurve(drive);
  ws.oversample = '2x';
  ws.connect(out);
  return ws;
}

// Gain node that is silent until automated. (A fresh GainNode is 1 until its first
// automation event, which can leak a full-level sample when a source starts mid-sample.)
export function silentGain(ctx) {
  const g = ctx.createGain();
  g.gain.value = 0;
  return g;
}

// Glide a param from its current value to `to` over `seconds` along a smoothstep curve (a
// few linear segments), so a long fade creeps in and settles instead of jumping most of the
// way in its first second as a linear gain ramp sounds. Replaces anything scheduled from t.
export function smoothRamp(param, t, to, seconds, steps = 8) {
  const from = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  for (let k = 1; k <= steps; k++) {
    const x = k / steps;
    param.linearRampToValueAtTime(from + (to - from) * x * x * (3 - 2 * x), t + seconds * x);
  }
}

// Gain node shaped as attack -> optional hold -> exponential decay to silence at t + dur.
export function envelope(ctx, out, t, { peak, dur, attack = 0.004, hold = 0 }) {
  const g = silentGain(ctx);
  const top = Math.max(peak, 1e-4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(top, t + attack);
  if (hold > 0) g.gain.setValueAtTime(top, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(dur, attack + hold + 0.005));
  g.connect(out);
  return g;
}

// Automate a frequency param: a constant, a start/end sweep over `glide` seconds, or a
// list of [secondsFromStart, hz] points joined by exponential ramps.
export function sweep(param, t, freq, to, glide) {
  if (Array.isArray(freq)) {
    param.setValueAtTime(freq[0][1], t + freq[0][0]);
    for (const [dt, hz] of freq.slice(1)) param.exponentialRampToValueAtTime(hz, t + dt);
  } else {
    param.setValueAtTime(freq, t);
    if (to) param.exponentialRampToValueAtTime(to, t + glide);
  }
}

// Oscillator with a pitch sweep and a percussive envelope. `wave` is an OscillatorType or a
// PeriodicWave. Returns the oscillator so callers can modulate it further.
export function tone(ctx, out, t, o) {
  const { wave = 'sine', freq, to, dur, gain, attack, hold, glide = dur, detune = 0 } = o;
  const osc = ctx.createOscillator();
  if (typeof wave === 'string') osc.type = wave;
  else osc.setPeriodicWave(wave);
  osc.detune.value = detune;
  sweep(osc.frequency, t, freq, to, glide);
  osc.connect(envelope(ctx, out, t, { peak: gain, dur, attack, hold }));
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

// Filtered noise burst with an optional filter sweep; `kind: 'brown'` for a low rumble.
export function noise(ctx, out, t, o) {
  const { filter = 'bandpass', freq, to, q = 1, dur, gain, attack, hold, glide = dur, kind } = o;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  sweep(f.frequency, t, freq, to, glide);
  noiseSource(ctx, t, dur + 0.02, kind).connect(f);
  f.connect(envelope(ctx, out, t, { peak: gain, dur, attack, hold }));
  return f;
}

// Periodic modulation of an AudioParam, or of several with one oscillator (vibrato,
// tremolo, wobble). depth is in the params' units; `fadeIn` delays the modulation onset like
// a player's natural vibrato; `decay` (a time constant, seconds) lets it die away after that,
// like a struck spring settling.
export function lfo(ctx, param, t, dur, { rate, depth, fadeIn = 0, decay = 0, wave = 'sine' }) {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = rate;
  const g = silentGain(ctx);
  g.gain.setValueAtTime(fadeIn ? 0 : depth, t);
  if (fadeIn) g.gain.linearRampToValueAtTime(depth, t + fadeIn);
  if (decay) g.gain.setTargetAtTime(0, t + fadeIn, decay);
  osc.connect(g);
  for (const p of Array.isArray(param) ? param : [param]) g.connect(p);
  osc.start(t);
  osc.stop(t + dur);
}

// Struck-metal bell/chime: inharmonic partials [ratio, relative gain, relative decay].
const BELL_PARTIALS = [
  [1, 1, 1],
  [2.76, 0.32, 0.4],
  [5.4, 0.1, 0.18],
];
export function bell(ctx, out, t, { freq, dur, gain, partials = BELL_PARTIALS }) {
  for (const [ratio, g, d] of partials) {
    // Partials near Nyquist would alias (and are inaudible anyway).
    if (freq * ratio > ctx.sampleRate * 0.4) continue;
    tone(ctx, out, t, { freq: freq * ratio, dur: dur * d, gain: gain * g, attack: 0.002 });
  }
}

const waveCache = new WeakMap();

// PeriodicWave from harmonic amplitudes [h1, h2, ...], cached per context and key.
export function harmonicWave(ctx, key, amps) {
  let map = waveCache.get(ctx);
  if (!map) waveCache.set(ctx, (map = new Map()));
  if (!map.has(key)) {
    const real = new Float32Array(amps.length + 1);
    const imag = new Float32Array([0, ...amps]);
    map.set(key, ctx.createPeriodicWave(real, imag));
  }
  return map.get(key);
}
