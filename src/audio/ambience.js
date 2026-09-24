// Outdoor ambience, which carries the grounds on its own (there is no music in free roam):
// a steady bed of air and rustling leaves drifting with slow gusts, a chorus of distant
// birds all around, nearer birdsong from the trees (nearer trees sing more often), a
// positional waterfall roar and water lapping at the nearest moat/pond edge.
// In AI RACE mode (setDark) the pastoral part, the leaves bed and the birds, fades away
// (the storm beds in storm.js take over); the water keeps sounding.

import { WATERFALL, WATER_LEVEL, MOAT, ISLAND, POND, TREES, groundHeight, sdRoundRect, sdCircle } from '../world/layout.js';
import { clamp, TAU } from '../core/math.js';
import { harmonicWave, lfo, noise, tone } from './synth.js';

const rand = (a, b) => a + Math.random() * (b - a);

const PARAM_INTERVAL = 0.1; // seconds between waterfall level/pan updates
const WATERFALL_RANGE = 9000; // silent beyond this distance
const LAP_RANGE = 3500;
const BIRD_RANGE = 6000;
const FAR_BIRD_DIST = 1200; // distant chorus: horizontal offset from the listener...
const FAR_BIRD_RISE = 400; // ...and height above it (inside full-volume range, so only pan)

// Air/leaves bed layers: band-pass centre (Hz), Q, stereo pan and resting gain. Each
// layer drifts on its own gust envelope, so the bed breathes instead of hissing flat.
const BED_LAYERS = [
  { freq: 520, q: 0.6, pan: 0, level: 0.03 }, // low air
  { freq: 1700, q: 0.9, pan: -0.65, level: 0.018 }, // leaves, left
  { freq: 2100, q: 0.9, pan: 0.65, level: 0.018 }, // leaves, right
];
const GUST_RANGE = [0.6, 1.45]; // gust level multipliers
const GUST_SECONDS = [1.2, 3.5]; // time between new gust targets

// Seamless pink-ish noise (Paul Kellet's filter) for the waterfall body.
function pinkBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return buf;
}

// Signed horizontal distance to open water (moat ring or pond); negative over water.
function waterDistance(x, z) {
  const moat = Math.max(sdRoundRect(x, z, MOAT), -sdRoundRect(x, z, ISLAND));
  return Math.min(moat, sdCircle(x, z, POND));
}

// Closest point on the water surface to (x, z), found by stepping down the distance field.
function nearestWater(x, z) {
  const d = waterDistance(x, z);
  if (d <= 0) return { x, y: WATER_LEVEL, z };
  const e = 20;
  const gx = waterDistance(x + e, z) - waterDistance(x - e, z);
  const gz = waterDistance(x, z + e) - waterDistance(x, z - e);
  const len = Math.hypot(gx, gz) || 1;
  return { x: x - (gx / len) * d, y: WATER_LEVEL, z: z - (gz / len) * d };
}

// Gentle slosh against the bank: a slow band-pass swell.
function slosh(ctx, out, t) {
  const f = rand(320, 420);
  noise(ctx, out, t, { freq: [[0, f], [0.5, f * 2], [1.1, f]], q: 1.4, dur: 1.2, gain: 0.12, attack: 0.4 });
  if (Math.random() < 0.5) tone(ctx, out, t + rand(0.3, 0.9), { freq: 700, to: 1300, glide: 0.04, dur: 0.05, gain: 0.03 });
  return 1.25;
}

const BIRD_GAIN = 0.22;

// A few bird call shapes around a base pitch, with an optional non-sine timbre. Returns the
// call's length in seconds.
function birdCall(ctx, out, t, base, gain, wave = 'sine') {
  switch (Math.floor(Math.random() * 4)) {
    case 0: {
      // tweet-tweet
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        tone(ctx, out, t + i * 0.13, { wave, freq: base * 0.8, to: base * 1.25, glide: 0.05, dur: 0.08, hold: 0.03, gain });
      }
      return n * 0.13 + 0.05;
    }
    case 1: {
      // trill
      const o = tone(ctx, out, t, { wave, freq: base, to: base * 0.85, dur: 0.4, gain: gain * 0.7, attack: 0.03 });
      lfo(ctx, o.frequency, t, 0.4, { rate: 28, depth: base * 0.08 });
      return 0.45;
    }
    case 2: // two-note call
      tone(ctx, out, t, { wave, freq: base * 1.1, to: base * 0.95, dur: 0.12, hold: 0.05, gain: gain * 0.9 });
      tone(ctx, out, t + 0.18, { wave, freq: base * 1.35, to: base * 1.1, dur: 0.2, hold: 0.08, gain: gain * 0.8 });
      return 0.42;
    default: {
      // a little song: quick notes hopping around the base pitch, each sliding into place
      const steps = [0.89, 1, 1.12, 1.26, 1.33];
      let dt = 0;
      for (let i = 0; i < 5; i++) {
        const f = base * steps[Math.floor(Math.random() * steps.length)];
        const d = rand(0.05, 0.1);
        tone(ctx, out, t + dt, { wave, freq: f * 1.08, to: f, glide: d * 0.6, dur: d, hold: d * 0.4, gain: gain * 0.8 });
        dt += d + 0.03;
      }
      return dt + 0.05;
    }
  }
}

// A bird in one of the trees: clear sine calls at full level.
const treeBird = (ctx, out, t) => birdCall(ctx, out, t, rand(2800, 4200), BIRD_GAIN * rand(0.7, 1));

// Timbres of the distant chorus, so the far birds do not all sound like one sine species:
// pure, hollow (triangle), and two reedier harmonic mixes.
const FAR_TIMBRES = ['sine', 'triangle', [1, 0.35], [1, 0.2, 0.12]];

// A soft call from somewhere far off, over a wider pitch range.
function farBird(ctx, out, t) {
  const timbre = FAR_TIMBRES[Math.floor(Math.random() * FAR_TIMBRES.length)];
  const wave = typeof timbre === 'string' ? timbre : harmonicWave(ctx, `bird${timbre}`, timbre);
  return birdCall(ctx, out, t, rand(1700, 5200), BIRD_GAIN * rand(0.16, 0.32), wave);
}

// The same recipe started `delay` seconds later (for birds answering each other).
const delayed = (recipe, delay) => (ctx, out, t, o) => delay + recipe(ctx, out, t + delay, o);

// A random tree within BIRD_RANGE, nearer trees much more likely; null if none.
function pickTree(listener) {
  let total = 0;
  const weights = TREES.map((p) => {
    const d = Math.hypot(p.x - listener.x, p.z - listener.z);
    const w = d < BIRD_RANGE ? (1 - d / BIRD_RANGE) ** 2 : 0;
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < TREES.length; i++) {
    r -= weights[i];
    if (weights[i] > 0 && r <= 0) return TREES[i];
  }
  return null;
}

export class Ambience {
  // playAt(recipe, pos, volume?) plays a one-shot recipe spatialized on the ambience bus;
  // spatial(pos) -> { gain, pan } as seen from the current listener.
  constructor(ctx, out, { playAt, spatial }) {
    this.ctx = ctx;
    this.playAt = playAt;
    this.spatial = spatial;
    this.dark = false;
    this.birds = 1; // bird call level, eased toward 0 while dark
    this.birdFade = 3; // seconds for a full bird fade
    this.paramTimer = 0;
    this.lapTimer = 0.5;
    this.birdTimer = rand(0.5, 1.5);
    this.farBirdTimer = rand(0.1, 0.4);

    // One long noise loop feeds everything (at different offsets), so no repeat is audible.
    const buf = pinkBuffer(ctx, 6);
    const loop = (dest, offset) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(dest);
      src.start(0, offset);
    };

    // Air and leaves bed, behind its own fader for dark mode.
    this.pastoral = ctx.createGain();
    this.pastoral.gain.value = 1;
    this.pastoral.connect(out);
    this.bed = BED_LAYERS.map((layer, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = layer.freq;
      filter.Q.value = layer.q;
      const gain = ctx.createGain();
      gain.gain.value = layer.level;
      const pan = ctx.createStereoPanner();
      pan.pan.value = layer.pan;
      filter.connect(gain).connect(pan).connect(this.pastoral);
      loop(filter, 0.7 + i * 1.9);
      return { ...layer, filter, gain, timer: 0 };
    });

    // Waterfall: roar (low-passed pink noise, darker with distance) + near-field hiss.
    this.fallPan = ctx.createStereoPanner();
    this.fallPan.connect(out);
    this.fallGain = ctx.createGain();
    this.fallGain.gain.value = 0;
    this.fallGain.connect(this.fallPan);
    this.fallFilter = ctx.createBiquadFilter();
    this.fallFilter.type = 'lowpass';
    this.fallFilter.connect(this.fallGain);
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.hissGain.connect(this.fallPan);
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 3200;
    hissFilter.Q.value = 0.5;
    hissFilter.connect(this.hissGain);
    loop(this.fallFilter, 0);
    loop(hissFilter, 3.3);
  }

  // Fade the pastoral bed and the birds out (dark) or back in over `fade` seconds.
  setDark(on, fade = 3) {
    this.dark = !!on;
    this.birdFade = Math.max(fade, 0.01);
    const t = this.ctx.currentTime;
    const g = this.pastoral.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.dark ? 0 : 1, t + this.birdFade);
  }

  update(dt, listener) {
    this.birds = clamp(this.birds + (this.dark ? -dt : dt) / this.birdFade, 0, 1);
    this.paramTimer -= dt;
    if (this.paramTimer <= 0) {
      this.paramTimer = PARAM_INTERVAL;
      this.updateWaterfall(listener);
    }
    this.updateGusts(dt);

    this.lapTimer -= dt;
    if (this.lapTimer <= 0) {
      this.lapTimer = rand(0.9, 2.2);
      const pos = nearestWater(listener.x, listener.z);
      if (Math.hypot(listener.x - pos.x, listener.y - pos.y, listener.z - pos.z) < LAP_RANGE) this.playAt(slosh, pos);
    }

    // Birds fall silent while dark (calls get quieter through the fade, then stop).
    if (this.birds < 0.02) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(0.8, 3);
      // Usually one bird; now and then one or two more answer from other trees.
      const count = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let i = 0; i < count; i++) {
        const tree = pickTree(listener);
        if (!tree) break;
        const call = i ? delayed(treeBird, rand(0.15, 0.9)) : treeBird;
        this.playAt(call, { x: tree.x, y: groundHeight(tree.x, tree.z) + 700, z: tree.z }, this.birds);
      }
    }

    // Distant chorus: a few soft calls a second from random directions.
    this.farBirdTimer -= dt;
    if (this.farBirdTimer <= 0) {
      this.farBirdTimer = rand(0.2, 0.6);
      const a = Math.random() * TAU;
      const pos = { x: listener.x + Math.sin(a) * FAR_BIRD_DIST, y: listener.y + FAR_BIRD_RISE, z: listener.z + Math.cos(a) * FAR_BIRD_DIST };
      this.playAt(farBird, pos, this.birds);
    }
  }

  // Each bed layer glides to a new random gust level now and then; the leaves also get
  // brighter as they swell.
  updateGusts(dt) {
    const t = this.ctx.currentTime;
    for (const layer of this.bed) {
      layer.timer -= dt;
      if (layer.timer > 0) continue;
      layer.timer = rand(...GUST_SECONDS);
      const gust = rand(...GUST_RANGE);
      const glide = rand(0.4, 1);
      layer.gain.gain.setTargetAtTime(layer.level * gust, t, glide);
      layer.filter.frequency.setTargetAtTime(layer.freq * (0.8 + 0.25 * gust), t, glide);
    }
  }

  // Louder, brighter and panned toward the closest point of the falling water sheet.
  updateWaterfall(listener) {
    const t = this.ctx.currentTime;
    const w = WATERFALL;
    const pos = {
      x: w.x + 150,
      y: clamp(listener.y, WATER_LEVEL, w.topY),
      z: clamp(listener.z, w.z - w.width / 2, w.z + w.width / 2),
    };
    const d = Math.hypot(listener.x - pos.x, listener.y - pos.y, listener.z - pos.z);
    const near = clamp(1 - (d - 800) / (WATERFALL_RANGE - 800), 0, 1) ** 2;
    this.fallGain.gain.setTargetAtTime(0.25 * near, t, 0.15);
    this.hissGain.gain.setTargetAtTime(0.15 * near * near, t, 0.15);
    this.fallFilter.frequency.setTargetAtTime(350 + 2600 * near, t, 0.15);
    this.fallPan.pan.setTargetAtTime(this.spatial(pos).pan, t, 0.15);
  }
}
