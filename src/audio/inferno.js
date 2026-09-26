// The meltdown's ambience (AI RACE's 40-second clock, fx/Meltdown.js): once the sky catches
// fire, a roaring blaze (low-passed pink noise fluttering like flames, and a rush of burning
// air above it), live-scheduled crackles and a deep, rolling rumble (two sub tones and brown
// noise). As the light grows the roar swells, opens up and the rumble deepens; at full white
// it collapses (collapse(): gone in a moment, while the engine rings the meltdown_ring sfx).
// Like the storm (storm.js) the graph is built when it is first needed, faded as a whole and
// torn down (sources stopped, graph disconnected) once it has faded out.
//
//   const inferno = new Inferno(ctx, ambBus)
//   inferno.set(fire, light)   0..1 each, per simulation tick while they change
//   inferno.collapse()         the roar cuts out (until set(0, 0) ends this meltdown)
//   inferno.stop(fade?)        fade out and tear down
//   inferno.update(dt)         per frame: crackles, teardown

import { noiseSource } from './synth.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Resting levels of the layers (the whole blaze is faded 0..1 on its bus by `fire`).
export const INFERNO_MIX = {
  roar: 0.2, // the blaze (low-passed pink-ish noise)
  rush: 0.05, // burning air (band-passed noise)
  rumble: 0.34, // brown noise under 90 Hz
  sub: 0.12, // the sub tones
  crackle: 0.1, // peak gain of one crackle
};
export const INFERNO_SWELL = {
  roar: 2.2, // the roar's level x (1 + this x light^2)
  rush: 4, // the rush's
  rumble: 0.8,
  roarHz: [520, 3200], // the roar's low-pass at light 0 / 1
};
const CRACKLE_RATE = 16; // crackles per second at full fire
const LEVEL_TC = 0.3; // time constant of level changes (s)
const TEARDOWN = 1.6; // s after going silent

const bufferCache = new WeakMap();

// Crackle buffers: a sharp noise tick and a short band-limited decay (a few with a low pop).
function crackleBuffers(ctx) {
  let list = bufferCache.get(ctx);
  if (list) return list;
  const sr = ctx.sampleRate;
  list = Array.from({ length: 8 }, (_, k) => {
    const n = Math.max(8, Math.floor(sr * rand(0.02, 0.05)));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const tau = rand(0.002, 0.008) * sr;
    const pop = k % 3 === 0 ? rand(90, 180) : 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.55;
      const env = Math.exp(-i / tau);
      d[i] = env * (i % 2 ? lp : w) * 0.8 + (pop ? Math.sin((2 * Math.PI * pop * i) / sr) * Math.exp(-i / (tau * 2)) * 0.5 : 0);
    }
    return buf;
  });
  bufferCache.set(ctx, list);
  return list;
}

export class Inferno {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.graph = null;
    this.fire = 0;
    this.light = 0;
    this.collapsed = false;
    this.offAt = Infinity; // context time the fade-out has finished by
    this.nextCrackle = 0;
  }

  get active() {
    return !!this.graph;
  }

  set(fire, light) {
    const f = fire > 0 ? Math.min(1, fire) : 0;
    const l = light > 0 ? Math.min(1, light) : 0;
    this.fire = f;
    this.light = l;
    const now = this.ctx.currentTime;
    const on = f > 0 || l > 0;
    if (!on) this.collapsed = false;
    if (on && !this.graph) this.graph = this.build(now);
    const g = this.graph;
    if (!g) return;
    this.offAt = on ? Infinity : now + TEARDOWN;
    g.bus.gain.setTargetAtTime(this.collapsed ? 0 : f, now, LEVEL_TC);
    const sw = l * l;
    const S = INFERNO_SWELL;
    g.roar.gain.setTargetAtTime(INFERNO_MIX.roar * (1 + S.roar * sw), now, 0.2);
    g.roarFilter.frequency.setTargetAtTime(S.roarHz[0] + (S.roarHz[1] - S.roarHz[0]) * sw, now, 0.25);
    g.rush.gain.setTargetAtTime(INFERNO_MIX.rush * (1 + S.rush * sw), now, 0.2);
    g.rumble.gain.setTargetAtTime(INFERNO_MIX.rumble * (1 + S.rumble * sw), now, 0.3);
  }

  // The roar cuts out at the white-out (stays out until this meltdown ends).
  collapse() {
    this.collapsed = true;
    const g = this.graph;
    if (!g) return;
    const now = this.ctx.currentTime;
    const p = g.bus.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + 0.18);
  }

  stop(fade = 0.5) {
    const g = this.graph;
    this.fire = this.light = 0;
    this.collapsed = false;
    if (!g) return;
    const now = this.ctx.currentTime;
    g.bus.gain.setTargetAtTime(0, now, Math.max(0.02, fade / 3));
    this.offAt = now + fade + 0.2;
  }

  update() {
    if (!this.graph) return;
    const now = this.ctx.currentTime;
    if (now >= this.offAt) {
      this.teardown();
      return;
    }
    if (!this.collapsed && this.fire > 0) this.scheduleCrackles(now);
  }

  build(now) {
    const ctx = this.ctx;
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
    const src = (node) => {
      sources.push(node);
      return node;
    };
    const osc = (type, freq, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(dest);
      o.start(now);
      return src(o);
    };
    const bus = gain(0, this.out);
    const long = 1e5; // the loops run until teardown stops them
    // The roar: low-passed noise whose level flutters like flames (two fast wobbles).
    const roar = gain(INFERNO_MIX.roar, bus);
    const flutter = gain(0.75, roar);
    const roarFilter = filter('lowpass', INFERNO_SWELL.roarHz[0], 0.7, flutter);
    src(noiseSource(ctx, now, long)).connect(roarFilter);
    osc('sine', 7.3, gain(0.14, flutter.gain));
    osc('sine', 11.1, gain(0.09, flutter.gain));
    // The rush of burning air above it, slowly breathing.
    const rush = gain(INFERNO_MIX.rush, bus);
    src(noiseSource(ctx, now, long)).connect(filter('bandpass', 1300, 0.8, rush));
    osc('sine', 0.21, gain(INFERNO_MIX.rush * 0.4, rush.gain));
    // The rumble: brown noise and two sub tones, rolling.
    const rumble = gain(INFERNO_MIX.rumble, bus);
    src(noiseSource(ctx, now, long, 'brown')).connect(filter('lowpass', 90, 0.9, rumble));
    const sub = gain(INFERNO_MIX.sub, rumble);
    osc('sine', 34, sub);
    osc('triangle', 51, gain(0.4, sub));
    osc('sine', 0.13, gain(INFERNO_MIX.rumble * 0.3, rumble.gain));
    // Crackles: four fixed stereo positions to crackle in.
    const pans = [-0.7, -0.25, 0.25, 0.7].map((v) => {
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      p.connect(bus);
      return p;
    });
    this.nextCrackle = now + 0.05;
    return { bus, sources, roar, roarFilter, rush, rumble, pans, crackles: crackleBuffers(ctx) };
  }

  // Crackles as a Poisson stream at a rate by the fire, scheduled a little ahead; each is one
  // short buffer source and its gain, disconnected when it ends.
  scheduleCrackles(now) {
    if (this.nextCrackle < now) this.nextCrackle = now + rand(0, 0.03); // after a stall: no burst
    const g = this.graph;
    const rate = CRACKLE_RATE * this.fire;
    while (this.nextCrackle < now + 0.15) {
      const s = this.ctx.createBufferSource();
      s.buffer = pick(g.crackles);
      s.playbackRate.value = rand(0.6, 1.4);
      const v = this.ctx.createGain();
      v.gain.value = INFERNO_MIX.crackle * rand(0.2, 1) ** 2;
      s.connect(v).connect(pick(g.pans));
      s.onended = () => v.disconnect();
      s.start(this.nextCrackle);
      this.nextCrackle += -Math.log(1 - Math.random()) / rate;
    }
  }

  teardown() {
    const g = this.graph;
    this.graph = null;
    this.offAt = Infinity;
    for (const s of g.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    g.bus.disconnect();
  }
}
