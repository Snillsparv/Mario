// Outdoor ambience, which carries the grounds on its own (there is no music in free roam):
// a steady bed of air and rustling leaves drifting with slow gusts, a chorus of distant
// birds all around, nearer birdsong from the trees (nearer trees sing more often), a
// positional waterfall roar and water lapping at the nearest moat/pond edge.
// In AI RACE mode (setDark) the pastoral part, the leaves bed and the birds, fades away
// (the storm beds in storm.js take over); the water keeps sounding.
// Areas (setProfile, from AudioEngine.setArea, with the area's def.audio in world coordinates
// for where its own sounds come from): 'grounds' is all of the above. Indoors ('hall') the
// pastoral bed fades out under a low room tone, there are no birds, no distant chorus, no
// waterfall and no lapping water, and a fire crackles in the hearth (spots.fires). On the open
// sea ('sea') the low air layer of the bed carries the wind while its leaves fall quiet (hardly
// a tree out there), waves lap at the sea's level on the open water round the listener
// (spots.seaLevel, spots.isWater: never on dry land, so they thin out and fade inland) and now
// and then a gull calls from over one of the gulls' circles (spots.gulls); no tree birds, no
// distant chorus, no waterfall. Setting the profile and spots already in force changes nothing
// (a fade under way, such as the storm lifting, runs on).

import { WATERFALL, WATER_LEVEL, MOAT, ISLAND, POND, TREES, groundHeight, sdRoundRect, sdCircle } from '../world/layout.js';
import { clamp, TAU } from '../core/math.js';
import { harmonicWave, lfo, noise, smoothRamp, tone } from './synth.js';
import { SFX } from './sfx.js';

const rand = (a, b) => a + Math.random() * (b - a);

const PARAM_INTERVAL = 0.1; // seconds between waterfall level/pan updates
const WATERFALL_RANGE = 9000; // silent beyond this distance
const LAP_RANGE = 3500;
const LAP_EVERY = { moat: [0.9, 2.2], sea: [0.5, 1.3] }; // seconds between laps (the open sea's busier)
const BIRD_RANGE = 6000;
const FAR_BIRD_DIST = 1200; // distant chorus: horizontal offset from the listener...
const FAR_BIRD_RISE = 400; // ...and height above it (inside full-volume range, so only pan)

// Air/leaves bed layers: band-pass centre (Hz), Q, stereo pan and resting gain. Each
// layer drifts on its own gust envelope, so the bed breathes instead of hissing flat. The
// leaves layers go through a fader of their own as well (an area without trees: profile.leaves).
const BED_LAYERS = [
  { freq: 520, q: 0.6, pan: 0, level: 0.03, leaves: false }, // low air
  { freq: 1700, q: 0.9, pan: -0.65, level: 0.018, leaves: true }, // leaves, left
  { freq: 2100, q: 0.9, pan: 0.65, level: 0.018, leaves: true }, // leaves, right
];
const GUST_RANGE = [0.6, 1.45]; // gust level multipliers
const GUST_SECONDS = [1.2, 3.5]; // time between new gust targets

// Indoors: a still, big room's low murmur (low-passed noise) under everything.
const ROOM_TONE = { freq: 220, q: 0.5, level: 0.035 };
const FIRE_EVERY = [0.15, 0.55]; // seconds between two crackles of a fire
const FIRE_VOLUME = 0.9;
// On the open sea waves lap on the water within SEA_LAP_SPREAD of the listener (so they pan),
// else farther out: SEA_LAP_TRIES spots tried, out to LAP_RANGE (see seaLap).
const SEA_LAP_SPREAD = 900;
const SEA_LAP_TRIES = 8;
const GULL_EVERY = [4, 10]; // seconds between two gull calls
const GULL_RANGE = 12000; // gulls circling farther off than this are not heard
const GULL_VOLUME = [0.6, 1];

// What each area's ambience plays (setProfile); unknown names are the grounds'. pastoral: the
// air and leaves bed (leaves: its leaves layers too); laps: 'moat' (at the grounds' moat or
// pond edge nearest the listener), 'sea' (on the open sea round him) or null; room: the indoor
// room tone; fires and gulls sound at the area's spots.
export const PROFILES = {
  grounds: { pastoral: true, leaves: true, birds: true, chorus: true, waterfall: true, laps: 'moat', room: false, fires: false, gulls: false },
  hall: { pastoral: false, leaves: false, birds: false, chorus: false, waterfall: false, laps: null, room: true, fires: true, gulls: false },
  sea: { pastoral: true, leaves: false, birds: false, chorus: false, waterfall: false, laps: 'sea', room: false, fires: false, gulls: true },
};

// An area's spots (setProfile) when it names none (isWater null: open water all round).
const NO_SPOTS = Object.freeze({ fires: Object.freeze([]), gulls: Object.freeze([]), seaLevel: 0, isWater: null });

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

// How likely a gull call comes from over circle c: nearer circles much more so, none beyond
// GULL_RANGE.
function gullWeight(c, listener) {
  const d = Math.hypot(c.x - listener.x, c.z - listener.z);
  return d < GULL_RANGE ? (1 - d / GULL_RANGE) ** 2 : 0;
}

// A point on one of the gulls' circles ({ x, y, z, radius }) for a call; null if none is in
// range.
function gullSpot(circles, listener) {
  let total = 0;
  for (const c of circles) total += gullWeight(c, listener);
  let r = Math.random() * total;
  for (const c of circles) {
    const w = gullWeight(c, listener);
    r -= w;
    if (w > 0 && r <= 0) {
      const a = Math.random() * TAU;
      return { x: c.x + Math.sin(a) * c.radius, y: c.y, z: c.z + Math.cos(a) * c.radius };
    }
  }
  return null;
}

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
    this.profile = PROFILES.grounds; // what this area plays (setProfile)
    this.spots = NO_SPOTS; // where its own sounds come from: { fires, gulls, seaLevel, isWater }
    this.birds = 1; // bird call level, eased toward 0 while dark (or in an area without birds)
    this.birdFade = 3; // seconds for a full bird fade
    this.paramTimer = 0;
    this.lapTimer = 0.5;
    this.birdTimer = rand(0.5, 1.5);
    this.farBirdTimer = rand(0.1, 0.4);
    this.fireTimer = rand(0.1, 0.4);
    this.gullTimer = rand(1, 3);

    // One long noise loop feeds everything (at different offsets), so no repeat is audible.
    const buf = pinkBuffer(ctx, 6);
    const loop = (dest, offset) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(dest);
      src.start(0, offset);
    };

    // Air and leaves bed, behind its own fader for dark mode; the leaves behind one more.
    this.pastoral = ctx.createGain();
    this.pastoral.gain.value = 1;
    this.pastoral.connect(out);
    this.leaves = ctx.createGain();
    this.leaves.gain.value = 1;
    this.leaves.connect(this.pastoral);
    this.bed = BED_LAYERS.map((layer, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = layer.freq;
      filter.Q.value = layer.q;
      const gain = ctx.createGain();
      gain.gain.value = layer.level;
      const pan = ctx.createStereoPanner();
      pan.pan.value = layer.pan;
      filter.connect(gain).connect(pan).connect(layer.leaves ? this.leaves : this.pastoral);
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

    // Room tone (indoors), faded in and out with the profile.
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    this.room.connect(out);
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = ROOM_TONE.freq;
    roomFilter.Q.value = ROOM_TONE.q;
    roomFilter.connect(this.room);
    loop(roomFilter, 4.6);
  }

  // Fade the pastoral bed and the birds out (dark) or back in over `fade` seconds.
  setDark(on, fade = 3) {
    this.dark = !!on;
    this.fadePastoral(fade);
  }

  // Switch to an area's ambience (PROFILES; unknown names are the grounds'), its own sounds at
  // `spots` ({ fires: [{ x, y, z }], gulls: [{ x, y, z, radius }], seaLevel, isWater(x, z) },
  // world coordinates: the area's Area.audio; missing ones are none, isWater: all open water):
  // its pastoral bed, leaves, room tone and birds fade in or out over `fade` seconds, the rest
  // follows at once. The profile and spots already in force change nothing, so a fade under way
  // (the storm lifting as GAME OVER puts Jonas back on the grounds) keeps its own pace.
  setProfile(name, fade = 1, spots = null) {
    const profile = Object.hasOwn(PROFILES, name) ? PROFILES[name] : PROFILES.grounds;
    const fires = spots?.fires ?? NO_SPOTS.fires;
    const gulls = spots?.gulls ?? NO_SPOTS.gulls;
    const seaLevel = spots?.seaLevel ?? NO_SPOTS.seaLevel;
    const isWater = spots?.isWater ?? NO_SPOTS.isWater;
    const s = this.spots;
    if (profile === this.profile && fires === s.fires && gulls === s.gulls && seaLevel === s.seaLevel && isWater === s.isWater) return;
    this.profile = profile;
    this.spots = { fires, gulls, seaLevel, isWater };
    this.fadePastoral(fade);
    const t = this.ctx.currentTime;
    smoothRamp(this.leaves.gain, t, profile.leaves ? 1 : 0, Math.max(fade, 0.01));
    smoothRamp(this.room.gain, t, profile.room ? ROOM_TONE.level : 0, Math.max(fade, 0.01));
  }

  // The pastoral bed plays in an area that has it, while not dark.
  fadePastoral(fade) {
    this.birdFade = Math.max(fade, 0.01);
    smoothRamp(this.pastoral.gain, this.ctx.currentTime, this.dark || !this.profile.pastoral ? 0 : 1, this.birdFade);
  }

  update(dt, listener) {
    const prof = this.profile;
    this.birds = clamp(this.birds + (this.dark || !prof.birds ? -dt : dt) / this.birdFade, 0, 1);
    this.paramTimer -= dt;
    if (this.paramTimer <= 0) {
      this.paramTimer = PARAM_INTERVAL;
      this.updateWaterfall(listener);
    }
    this.updateGusts(dt);

    this.lapTimer -= dt;
    if (this.lapTimer <= 0 && prof.laps) {
      this.lapTimer = rand(...LAP_EVERY[prof.laps]);
      const pos = prof.laps === 'sea' ? this.seaLap(listener) : nearestWater(listener.x, listener.z);
      if (pos && Math.hypot(listener.x - pos.x, listener.y - pos.y, listener.z - pos.z) < LAP_RANGE) this.playAt(slosh, pos);
    }

    // A fire crackling (the hall's hearth).
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && prof.fires) {
      this.fireTimer = rand(...FIRE_EVERY);
      const fires = this.spots.fires;
      if (fires.length) this.playAt(SFX.fire_crackle, fires[Math.floor(Math.random() * fires.length)], FIRE_VOLUME);
    }

    // Now and then a gull calls from over one of their circles (the first one in range, as soon
    // as there is one).
    this.gullTimer -= dt;
    if (this.gullTimer <= 0 && prof.gulls) {
      const pos = gullSpot(this.spots.gulls, listener);
      if (pos) {
        this.gullTimer = rand(...GULL_EVERY);
        this.playAt(SFX.gull, pos, rand(...GULL_VOLUME));
      }
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
    if (this.farBirdTimer <= 0 && prof.chorus) {
      this.farBirdTimer = rand(0.2, 0.6);
      const a = Math.random() * TAU;
      const pos = { x: listener.x + Math.sin(a) * FAR_BIRD_DIST, y: listener.y + FAR_BIRD_RISE, z: listener.z + Math.cos(a) * FAR_BIRD_DIST };
      this.playAt(farBird, pos, this.birds);
    }
  }

  // A wave lapping on the open sea near the listener, at the sea's level: the first of
  // SEA_LAP_TRIES random spots round him that is open water (spots.isWater), each tried within
  // a wider circle than the one before (SEA_LAP_SPREAD out to LAP_RANGE). Out on the water the
  // first one nearly always is; inland the waves come from the shore, farther off and quieter,
  // or not at all (null: every spot tried was dry land).
  seaLap(listener) {
    const { isWater, seaLevel } = this.spots;
    for (let i = 0; i < SEA_LAP_TRIES; i++) {
      const r = SEA_LAP_SPREAD + ((LAP_RANGE - SEA_LAP_SPREAD) * i) / (SEA_LAP_TRIES - 1);
      const a = Math.random() * TAU;
      const d = r * Math.sqrt(Math.random()); // evenly over the circle
      const x = listener.x + Math.sin(a) * d;
      const z = listener.z + Math.cos(a) * d;
      if (!isWater || isWater(x, z)) return { x, y: seaLevel, z };
    }
    return null;
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
    const near = this.profile.waterfall ? clamp(1 - (d - 800) / (WATERFALL_RANGE - 800), 0, 1) ** 2 : 0;
    this.fallGain.gain.setTargetAtTime(0.25 * near, t, 0.15);
    this.hissGain.gain.setTargetAtTime(0.15 * near * near, t, 0.15);
    this.fallFilter.frequency.setTargetAtTime(350 + 2600 * near, t, 0.15);
    this.fallPan.pan.setTargetAtTime(this.spatial(pos).pan, t, 0.15);
  }
}
