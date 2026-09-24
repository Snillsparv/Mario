// Storm ambience for AI RACE mode: heavy rain (a band-limited wash, a pattering mid band
// and a low body, plus live-scheduled droplet ticks), two gusting wind layers and a low,
// slowly breathing drone on D (the dark track's tonic). The graph is built when the mode
// first switches on, faded in and out as a whole, and torn down (sources stopped, graph
// disconnected) once it has faded out, so sunny weather costs nothing.

import { clamp } from '../core/math.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Resting levels of the layers (the whole storm is then faded 0..1 on its bus).
const RAIN = { wash: 0.03, patter: 0.035, body: 0.2 };
const DROP_RATE = 22; // droplet ticks per second
const DROP_GAIN = 0.11;
const WIND = [
  { freq: 380, q: 1.2, level: 0.16, pan: -0.45 }, // a broad, low blow
  { freq: 1050, q: 7, level: 0.05, pan: 0.5 }, // a thin howl
];
const GUST_RANGE = [0.3, 1.5];
const GUST_SECONDS = [1.2, 3.8];
const DRONE_LEVEL = 0.07;
// [hz, detune cents, wave, level]: two beating saws on D1, the fifth, and D2.
const DRONE_VOICES = [
  [36.71, -7, 'sawtooth', 0.5],
  [36.71, 6, 'sawtooth', 0.5],
  [55, 0, 'sine', 0.35],
  [73.42, 3, 'triangle', 0.3],
];

const bufferCache = new WeakMap();

// Stereo noise with independent channels (a wide image), pink when `pink`; the loop ends
// are crossfaded into each other so the wrap is seamless.
function stereoNoise(ctx, seconds, pink) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) {
        d[i] = w * 0.5;
        continue;
      }
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[n - fade + i] * (1 - k);
    }
  }
  return buf;
}

// Droplet ticks: a few tiny mono buffers, each a noise click and a fast-damped ring
// (1.8-5.2 kHz, chirping up a little as a drop does).
function dropBuffers(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.03);
  return Array.from({ length: 8 }, () => {
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const f = rand(1800, 5200);
    const tau = rand(0.003, 0.009) * sr;
    const chirp = rand(0, 0.4);
    const click = Math.floor(sr * 0.0015);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      phase += (2 * Math.PI * f * (1 + (chirp * i) / n)) / sr;
      d[i] = Math.exp(-i / tau) * (0.8 * Math.sin(phase) + (i < click ? (Math.random() * 2 - 1) * 0.6 : 0));
    }
    return buf;
  });
}

function buffers(ctx) {
  let b = bufferCache.get(ctx);
  if (!b) bufferCache.set(ctx, (b = { white: stereoNoise(ctx, 3, false), pink: stereoNoise(ctx, 4.3, true), drops: dropBuffers(ctx) }));
  return b;
}

export class Storm {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.on = false;
    this.graph = null; // the running nodes, while the storm is audible or fading
    this.offAt = Infinity; // context time the fade-out has finished by
    this.nextDrop = 0;
  }

  get active() {
    return !!this.graph;
  }

  // Fade the storm in (on) or out over `fade` seconds; switching back mid-fade reverses
  // from wherever the fade has got to.
  set(on, fade = 3) {
    const now = this.ctx.currentTime;
    this.on = !!on;
    if (this.on && !this.graph) this.graph = this.build(now);
    if (!this.graph) return;
    const g = this.graph.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.on ? 1 : 0, now + Math.max(fade, 0.02));
    this.offAt = this.on ? Infinity : now + Math.max(fade, 0.02) + 0.1;
  }

  // Per frame: gusts, droplets, and the teardown once faded out.
  update(dt) {
    if (!this.graph) return;
    const now = this.ctx.currentTime;
    if (!this.on && now >= this.offAt) {
      this.teardown();
      return;
    }
    this.updateGusts(dt, now);
    this.scheduleDrops(now);
  }

  build(now) {
    const ctx = this.ctx;
    const { white, pink, drops } = buffers(ctx);
    const sources = [];
    const gain = (value, dest) => {
      const g = ctx.createGain();
      g.gain.value = value;
      g.connect(dest);
      return g;
    };
    const filter = (type, freq, q, dest) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      f.connect(dest);
      return f;
    };
    const loop = (buf, dest, offset) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(dest);
      s.start(now, offset);
      sources.push(s);
    };
    const osc = (type, freq, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(dest);
      o.start(now);
      sources.push(o);
      return o;
    };

    const bus = gain(0, this.out);
    // Rain: the hiss of countless drops, the band where they hit leaves and grass (its
    // level drifts), and heavy rain's low roar.
    loop(white, filter('highpass', 600, 0.5, filter('lowpass', 7000, 0.5, gain(RAIN.wash, bus))), 0);
    const patter = gain(RAIN.patter, bus);
    loop(white, filter('bandpass', 2200, 0.7, patter), 1.7);
    loop(pink, filter('lowpass', 450, 0.6, gain(RAIN.body, bus)), 1.1);
    // Wind: gusting layers, each drifting in level, pitch and position.
    const winds = WIND.map((w, i) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = w.pan;
      pan.connect(bus);
      const g = gain(w.level * 0.6, pan);
      const f = filter('bandpass', w.freq, w.q, g);
      loop(pink, f, 0.4 + i * 2.1);
      return { ...w, gain: g, filter: f, panner: pan, timer: i * 0.7 };
    });
    // Drone: beating saws on D1, the fifth and D2 under a low-pass that breathes slowly,
    // one saw drifting in pitch and the level swelling, so it never sits still.
    const droneOut = gain(DRONE_LEVEL, bus);
    const lp = filter('lowpass', 170, 1.8, droneOut);
    const voices = DRONE_VOICES.map(([hz, detune, type, level]) => {
      const o = osc(type, hz, gain(level, lp));
      o.detune.value = detune;
      return o;
    });
    osc('sine', 0.07, gain(60, lp.frequency));
    osc('sine', 0.045, gain(9, voices[0].detune));
    osc('sine', 0.11, gain(DRONE_LEVEL * 0.35, droneOut.gain));
    // Droplets: four fixed stereo positions to drop into.
    const dropPans = [-0.8, -0.3, 0.3, 0.8].map((v) => {
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      p.connect(bus);
      return p;
    });
    this.nextDrop = now + 0.05;
    return { bus, sources, patter, patterTimer: 0, winds, dropPans, drops };
  }

  updateGusts(dt, now) {
    const gr = this.graph;
    for (const w of gr.winds) {
      w.timer -= dt;
      if (w.timer > 0) continue;
      w.timer = rand(...GUST_SECONDS);
      const gust = rand(...GUST_RANGE);
      const glide = rand(0.5, 1.4);
      w.gain.gain.setTargetAtTime(w.level * gust, now, glide);
      w.filter.frequency.setTargetAtTime(w.freq * (0.7 + 0.45 * gust), now, glide);
      w.panner.pan.setTargetAtTime(clamp(w.pan + rand(-0.35, 0.35), -1, 1), now, glide * 2);
    }
    gr.patterTimer -= dt;
    if (gr.patterTimer <= 0) {
      gr.patterTimer = rand(1, 3);
      gr.patter.gain.setTargetAtTime(RAIN.patter * rand(0.65, 1.3), now, rand(0.4, 1));
    }
  }

  // Droplets as a Poisson stream, scheduled a little ahead on the audio clock. Each is one
  // short buffer source and its gain, disconnected when it ends; a few are fat, low drops
  // on puddles and leaves.
  scheduleDrops(now) {
    if (this.nextDrop < now) this.nextDrop = now + rand(0, 0.02); // after a stall: no burst
    const gr = this.graph;
    while (this.nextDrop < now + 0.15) {
      const src = this.ctx.createBufferSource();
      src.buffer = pick(gr.drops);
      const fat = Math.random() < 0.2;
      src.playbackRate.value = fat ? rand(0.35, 0.55) : rand(0.75, 1.3);
      const g = this.ctx.createGain();
      g.gain.value = DROP_GAIN * (fat ? rand(0.5, 1) : rand(0.15, 1) ** 2);
      src.connect(g).connect(pick(gr.dropPans));
      src.onended = () => g.disconnect();
      src.start(this.nextDrop);
      this.nextDrop += -Math.log(1 - Math.random()) / DROP_RATE;
    }
  }

  teardown() {
    const gr = this.graph;
    this.graph = null;
    for (const s of gr.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    gr.bus.disconnect();
  }
}
