// Sound-effect recipes run against a recording fake WebAudio context: every recipe schedules
// cleanly and reports its length; the level budget of each sound (the summed peak gain of its
// voices) stays in its class, so the soft dialog sounds sit under the gameplay sounds and a
// single effect cannot reach full scale on its own; the combo hits and the jumps are built
// the way their design says (swish before impact, one step per combo hit, springy rise);
// text_blip, which plays every few characters, is a single cheap oscillator with a varying
// pitch; footsteps and landings get softer (quieter and duller) the gentler they are; the AI
// RACE sounds exist, fit the level budget and are shaped as designed (thunder by strength);
// so do the winged hat's, the mystery box's, the minions' and the locked castle's (the laugh
// is formant synthesis through an echo and a hall that die out within its length, and uses
// the engine's shared hall instead of making a convolver of its own when given one).
// Measured levels (offline renders) are in src/dev/previews/audio.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFX, SFX_INFO, footstepLevel, landLevel } from '../src/audio/sfx.js';
import { LEVELS } from '../src/audio/mixer.js';

class Param {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
}
for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) {
  Param.prototype[m] = function (...args) {
    this.events.push([m, ...args]);
    return this;
  };
}

class Node {
  constructor(ctx, kind, params = []) {
    this.kind = kind;
    this.outs = [];
    this.ins = [];
    for (const p of params) this[p] = new Param();
    ctx.nodes.push(this);
  }

  connect(dest) {
    this.outs.push(dest);
    if (dest instanceof Node) dest.ins.push(this);
    return dest;
  }

  disconnect() {}
  start(t) {
    this.startAt = t;
  }

  stop(t) {
    this.stopAt = t;
  }

  setPeriodicWave() {
    this.type = 'custom';
  }
}

class RecordingContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.nodes = [];
    this.destination = new Node(this, 'destination');
  }

  createOscillator() {
    const o = new Node(this, 'osc', ['frequency', 'detune']);
    o.type = 'sine';
    return o;
  }

  createBiquadFilter() {
    return new Node(this, 'filter', ['frequency', 'Q', 'gain']);
  }

  createGain() {
    const g = new Node(this, 'gain', ['gain']);
    g.gain.value = 1;
    return g;
  }

  createBufferSource() {
    return new Node(this, 'noise', ['playbackRate']);
  }

  createWaveShaper() {
    return new Node(this, 'shaper');
  }

  createConvolver() {
    return new Node(this, 'convolver');
  }

  createDelay() {
    return new Node(this, 'delay', ['delayTime']);
  }

  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (c) => data[c] };
  }

  createPeriodicWave() {
    return {};
  }
}

// Value of a recorded AudioParam automation at time x (the subset the recipes use).
function paramAt(param, x) {
  let v = param.value;
  let t = -Infinity;
  let target = null; // [value, start, timeConstant] of a running setTargetAtTime
  for (const [m, value, time, tc] of param.events) {
    if (m === 'cancelScheduledValues') continue;
    if (target) v = target[0] + (v - target[0]) * Math.exp(-(Math.min(time, x) - target[1]) / target[2]);
    if (time > x) {
      if (m === 'linearRampToValueAtTime') return v + (value - v) * ((x - t) / (time - t));
      if (m === 'exponentialRampToValueAtTime') return v * (value / v) ** ((x - t) / (time - t));
      return v;
    }
    if (m === 'setTargetAtTime') target = [value, time, tc];
    else {
      target = null;
      v = value;
    }
    t = time;
  }
  if (target) v = target[0] + (v - target[0]) * Math.exp(-(x - target[1]) / target[2]);
  return v;
}

const T0 = 1;
const OPTS = { p: 1, terrain: 'grass', big: true, index: 8 };

// Run a recipe into a fresh context; returns its reported length and what it built.
function run(name, opts = {}) {
  const ctx = new RecordingContext();
  const out = ctx.createGain();
  const dur = SFX[name](ctx, out, T0, { ...OPTS, ...opts });
  // Voices: envelope gains (automated, fed by a source chain, feeding audio nodes, not a
  // parameter). Static gains in a chain (mix levels, tremolo) scale by at most 1 and are
  // not voices of their own.
  const voices = ctx.nodes
    .filter((n) => n.kind === 'gain' && n !== out && n.ins.length && n.gain.events.length && n.outs.every((d) => d instanceof Node))
    .map((g) => {
      const ramps = g.gain.events.filter(([m]) => m === 'linearRampToValueAtTime');
      const peak = Math.max(0, ...ramps.map(([, v]) => v));
      const at = ramps.length ? ramps[0][2] : T0;
      const src = g.ins[0];
      return { peak, at, src, noise: src.kind === 'filter', gainAt: (x) => paramAt(g.gain, x) };
    });
  // Level budget: the loudest moment of all voices' envelopes summed (a worst case: every
  // voice in phase, filtered noise counted at full scale).
  let budget = 0;
  for (let x = T0; x < T0 + dur + 0.1; x += 0.0005) {
    budget = Math.max(budget, voices.reduce((a, v) => a + v.gainAt(x) * (v.noise ? 0.5 : 1), 0));
  }
  const count = (kind) => ctx.nodes.filter((n) => n.kind === kind).length;
  return { ctx, dur, voices, budget, count };
}

const firstFreq = (osc) => osc.frequency.events[0][1];

const GAMEPLAY_HITS = ['punch', 'punch1', 'punch2', 'kick', 'jump_kick'];
const JUMPS = ['jump', 'double_jump', 'triple_jump'];
const DIALOG = ['dialog_open', 'text_blip', 'dialog_next', 'dialog_close'];
const AI_RACE = ['button_press', 'alarm', 'kaiju_roar', 'fireball_charge', 'fireball_launch', 'fireball_explode', 'burn', 'fire_crackle', 'steam', 'thunder'];
const HAT_AND_MINIONS = ['box_hit', 'powerup', 'wing_flap', 'stomp', 'minion_emerge', 'minion_bite', 'minion_wreck', 'minions_stinger', 'evil_laugh'];
const LONG = { thunder: 4.1, evil_laugh: 3.5 }; // the rolling thunder and the echoing laugh may run past the usual 3 s

test('the combo, flying-kick, sign-dialog and AI RACE sounds exist', () => {
  for (const n of [...GAMEPLAY_HITS, ...DIALOG, ...AI_RACE, ...HAT_AND_MINIONS]) assert.equal(typeof SFX[n], 'function', n);
  for (const n of Object.keys(SFX_INFO)) assert.equal(typeof SFX[n], 'function', `SFX_INFO names a real sound: ${n}`);
});

test('every recipe schedules cleanly and reports a sane length', () => {
  for (const name of Object.keys(SFX)) {
    for (const terrain of ['grass', 'stone', 'wood', 'sand', 'water']) {
      const { dur, ctx, voices } = run(name, { terrain });
      assert.ok(Number.isFinite(dur) && dur > 0 && dur <= (LONG[name] ?? 3), `${name} length ${dur}`);
      assert.ok(voices.length > 0, `${name} makes a sound`);
      // Every source stops, and nothing starts before the requested time.
      for (const n of ctx.nodes.filter((x) => x.kind === 'osc' || x.kind === 'noise')) {
        assert.ok(n.startAt >= T0 - 1e-9 && n.stopAt > n.startAt, `${name}: a ${n.kind} starts at ${n.startAt}, stops at ${n.stopAt}`);
      }
      // All frequencies stay audible and below Nyquist.
      for (const n of ctx.nodes.filter((x) => x.kind === 'osc' || x.kind === 'filter')) {
        for (const [m, v] of n.frequency.events) {
          if (m === 'setTargetAtTime') continue;
          assert.ok(v >= 20 && v < ctx.sampleRate / 2, `${name}: ${n.kind} frequency ${v}`);
        }
      }
    }
  }
});

test('level budgets: no effect reaches full scale alone; dialog sounds sit under gameplay', () => {
  const budget = Object.fromEntries(Object.keys(SFX).map((n) => [n, run(n).budget]));
  // Through the sfx bus no single effect reaches the soft clipper's ceiling on its own.
  for (const [name, b] of Object.entries(budget)) assert.ok(b * LEVELS.sfx < 0.95, `${name} budget ${b.toFixed(2)}`);
  // The combo hits are punchy (in the jump's weight class or above), the kick the heaviest.
  for (const n of GAMEPLAY_HITS) assert.ok(budget[n] >= 0.7 && budget[n] <= 1.1, `${n} budget ${budget[n].toFixed(2)}`);
  assert.ok(budget.kick > budget.punch2 && budget.punch2 > budget.punch1);
  // Dialog sounds are soft: under half a combo hit and under the jump; the typing tick is
  // far below that (it repeats every few characters).
  const hardest = Math.min(...GAMEPLAY_HITS.map((n) => budget[n]));
  for (const n of DIALOG) {
    assert.ok(budget[n] < hardest * 0.5 && budget[n] < budget.jump * 0.5, `${n} budget ${budget[n].toFixed(2)}`);
  }
  assert.ok(budget.text_blip <= 0.12, `text_blip budget ${budget.text_blip}`);
  // Footsteps (constant while running) stay well under a landing.
  assert.ok(budget.footstep < budget.land * 0.6);
});

test('each combo hit is a swish that builds into a thwack, one step lower per hit', () => {
  const impact = {};
  for (const n of ['punch1', 'punch2', 'kick', 'jump_kick']) {
    const { voices, dur } = run(n);
    const swish = voices.find((v) => v.noise && v.src.type === 'bandpass' && v.at > T0 + 0.02);
    assert.ok(swish, `${n}: swish with a slow attack`);
    // The impact: sine voices with a 1 ms attack, all after the swish has built up.
    const hits = voices.filter((v) => !v.noise && v.at - T0 > 0.03);
    assert.ok(hits.length >= 2, `${n}: pitched thwack layers`);
    const body = hits.find((v) => v.src.type === 'sine');
    const start = body.at - 0.001;
    assert.ok(swish.at < start && swish.at > T0 + (start - T0) * 0.6, `${n}: swish peaks just before contact`);
    // A bright crack lands with the body.
    assert.ok(voices.some((v) => v.noise && Math.abs(v.at - body.at) < 1e-6 && v.src.frequency.events[0][1] >= 2000), `${n}: crack`);
    // The body drops in pitch (the punch of it).
    const f = body.src.frequency.events;
    assert.ok(f.at(-1)[1] < f[0][1] * 0.5, `${n}: body pitch drop`);
    impact[n] = { at: start - T0, pitch: firstFreq(body.src) };
    assert.ok(dur >= start - T0 + 0.1, `${n}: reported length covers the thwack`);
  }
  // Each step of the combo is its own: later, longer swing and lower body per hit.
  assert.ok(impact.punch1.pitch > impact.punch2.pitch && impact.punch2.pitch > impact.kick.pitch);
  assert.ok(impact.punch1.at < impact.punch2.at && impact.punch2.at < impact.kick.at);
  assert.notEqual(impact.jump_kick.pitch, impact.kick.pitch);
});

test('jumps are springy: a rising, overshooting body with a decaying wobble and a sub push-off', () => {
  for (const n of JUMPS) {
    const { ctx, voices } = run(n);
    const sines = voices.filter((v) => !v.noise && v.src.type === 'sine');
    // The spring body bends up past its target and settles (a point list, peak in the middle).
    const body = sines.find((v) => v.src.frequency.events.length === 3);
    assert.ok(body, `${n}: spring body`);
    const [a, b, c] = body.src.frequency.events.map((e) => e[1]);
    assert.ok(b > a * 2 && c < b && c > b * 0.9, `${n}: bend ${a} -> ${b} -> ${c}`);
    // A wobble on the body's detune that dies away.
    const wobble = ctx.nodes.find((x) => x.kind === 'gain' && x.outs.includes(body.src.detune));
    assert.ok(wobble?.gain.events.some(([m, v]) => m === 'setTargetAtTime' && v === 0), `${n}: decaying wobble`);
    // A sub-octave push-off under it.
    assert.ok(sines.some((v) => Math.abs(firstFreq(v.src) - a / 2) < 1), `${n}: sub push-off`);
  }
});

test('text_blip is one cheap oscillator whose pitch varies from blip to blip', () => {
  const pitches = new Set();
  for (let i = 0; i < 12; i++) {
    const { count, dur, voices } = run('text_blip');
    assert.equal(count('osc'), 1);
    assert.equal(count('noise'), 0);
    assert.equal(count('filter'), 0);
    assert.ok(dur <= 0.05);
    pitches.add(Math.round(firstFreq(voices[0].src)));
  }
  assert.ok(pitches.size >= 6, `pitches ${[...pitches]}`);
  for (const f of pitches) assert.ok(f > 1100 && f < 1400, `blip pitch ${f}`);
});

test('dialog open and close are mirror images: the pop bends up to open, down to close', () => {
  const pop = (n) => run(n).voices.find((v) => !v.noise && v.src.type === 'sine').src.frequency.events;
  const open = pop('dialog_open');
  const close = pop('dialog_close');
  assert.ok(open.at(-1)[1] > open[0][1]);
  assert.ok(close.at(-1)[1] < close[0][1]);
});

test('footsteps: level and brightness rise with speed; tiptoe soft, walk well under a run', () => {
  let prev = { volume: 0, bright: 0 };
  for (let speed = 0; speed <= 40; speed += 1) {
    const l = footstepLevel(speed);
    assert.ok(l.volume >= prev.volume && l.bright >= prev.bright, `monotonic at ${speed}`);
    assert.ok(l.volume > 0 && l.volume <= 1 && l.bright > 0 && l.bright <= 1);
    prev = l;
  }
  const full = footstepLevel(32).volume;
  assert.equal(full, 1, 'a full run plays as before');
  assert.ok(footstepLevel(6).volume <= 0.35 * full, 'tiptoe very soft (-9 dB and more)');
  assert.ok(footstepLevel(12).volume <= 0.5 * full, 'walking clearly quieter (-6 dB and more)');
  assert.ok(footstepLevel(17).volume < 0.62 * full, 'even a brisk walk');
  assert.ok(footstepLevel(12).bright < 0.6 && footstepLevel(6).bright < 0.4, 'and duller');
  assert.deepEqual(footstepLevel(undefined), footstepLevel(20), 'no speed: a jog');
  // Softer steps are also duller: the bright contact click drops more than the body.
  for (const terrain of ['grass', 'stone', 'wood', 'sand', 'water']) {
    const hi = run('footstep', { terrain, bright: 1 });
    const lo = run('footstep', { terrain, bright: footstepLevel(10).bright });
    assert.ok(lo.budget < hi.budget, `${terrain}: gentler step, smaller budget`);
  }
  const edge = (b) => {
    const { voices } = run('footstep', { terrain: 'grass', bright: b });
    return voices.find((v) => v.noise && v.src.type === 'highpass').peak;
  };
  assert.ok(edge(0.3) < edge(1) * 0.6, 'the click of a soft step is much quieter');
});

test('landings: a hop lands softly, a big fall in full; the land thump is gentler than a hard one', () => {
  const air = [0, 0.1, 0.25, 0.4, 0.6, 0.8, 1.5, Infinity].map((a) => landLevel(a));
  for (let i = 1; i < air.length; i++) assert.ok(air[i].volume >= air[i - 1].volume && air[i].bright >= air[i - 1].bright);
  assert.ok(landLevel(0.25).volume <= 0.6, 'a tiny hop');
  assert.equal(landLevel(0.7).volume, 1, 'a full jump lands as before');
  assert.equal(landLevel(Infinity).volume, 1, 'unknown air time: full');
  assert.equal(landLevel(0.1, 800).volume, 1, 'a given fall height wins over air time');
  assert.ok(landLevel(5, 60).volume < 0.6);
  const soft = run('land', { bright: landLevel(0.3).bright }).budget;
  const full = run('land').budget;
  assert.ok(soft < full, 'soft landing budget');
  assert.ok(full < run('land_hard').budget, 'hard landing is the heaviest');
});

test('AI RACE sounds: sane budgets and lengths, shaped as designed', () => {
  const budget = Object.fromEntries(AI_RACE.map((n) => [n, run(n).budget]));
  for (const [n, b] of Object.entries(budget)) assert.ok(b > 0.05 && b * LEVELS.sfx < 0.95, `${n} budget ${b.toFixed(2)}`);
  // The repeated crackle sits well under the one-off blasts.
  assert.ok(budget.fire_crackle < budget.fireball_explode * 0.5);
  // Lengths: a ~2 s roar, a ~0.8 s charge, a short crackle, an alarm of three pulses.
  const len = (n) => run(n).dur;
  assert.ok(len('kaiju_roar') >= 1.8 && len('kaiju_roar') <= 2.6);
  assert.ok(len('fireball_charge') >= 0.7 && len('fireball_charge') <= 1);
  assert.ok(len('fire_crackle') <= 0.5);
  const alarm = run('alarm');
  const pulses = new Set(alarm.ctx.nodes.filter((n) => n.kind === 'osc' && n.type === 'sawtooth').map((n) => n.startAt));
  assert.ok(pulses.size >= 2 && pulses.size <= 3, `alarm pulses ${pulses.size}`);
  // The roar is driven (waveshaper) and frequency-modulated.
  const roar = run('kaiju_roar');
  assert.ok(roar.count('shaper') >= 1, 'distortion');
  assert.ok(roar.ctx.nodes.some((n) => n.kind === 'gain' && n.outs.some((d) => d instanceof Param)), 'FM / modulation');
  // A far explosion is duller (less top end) than a near one.
  const top = (dist) => Math.max(...run('fireball_explode', { dist }).ctx.nodes.filter((n) => n.kind === 'filter' && n.type === 'lowpass').map((n) => n.frequency.events[0][1]));
  assert.ok(top(8000) < top(500));
  // Crackles vary from one to the next.
  const counts = new Set(Array.from({ length: 12 }, () => run('fire_crackle').count('noise')));
  assert.ok(counts.size > 1);
});

test('thunder: stronger strikes roll longer and louder, and only strong ones crack', () => {
  const weak = run('thunder', { strength: 0.2 });
  const strong = run('thunder', { strength: 1 });
  assert.ok(weak.dur >= 2 && weak.dur < strong.dur && strong.dur <= 4.1, `lengths ${weak.dur} ${strong.dur}`);
  assert.ok(strong.budget > weak.budget);
  const crack = (r) => r.voices.some((v) => v.noise && v.src.type === 'highpass');
  assert.ok(crack(strong) && !crack(weak));
  // The roll's level moves (several swells), rather than one decay.
  const roll = strong.voices.find((v) => v.src.type === 'lowpass' && v.src.ins[0]?.kind === 'noise' && v.src.frequency.events.length === 2);
  const ramps = roll.src.outs[0].gain.events.filter(([m]) => m === 'linearRampToValueAtTime');
  assert.ok(ramps.length >= 4, `roll swells ${ramps.length}`);
});

test('winged hat, box, stomp and minion sounds: sane budgets, lengths and rate limits', () => {
  const budget = Object.fromEntries(HAT_AND_MINIONS.map((n) => [n, run(n).budget]));
  for (const [n, b] of Object.entries(budget)) assert.ok(b > 0.1 && b * LEVELS.sfx < 0.95, `${n} budget ${b.toFixed(2)}`);
  // The wing beat repeats all through a climb: soft, well under a jump, and spaced out.
  assert.ok(budget.wing_flap < run('jump').budget * 0.5, `wing_flap budget ${budget.wing_flap}`);
  assert.ok(SFX_INFO.wing_flap.gap >= 0.15 && SFX_INFO.wing_flap.max <= 2);
  // Bursty minion sounds (several minions at once) are capped; the laugh never stacks.
  for (const n of ['minion_emerge', 'minion_bite', 'minion_wreck']) assert.ok(SFX_INFO[n].max <= 3 && SFX_INFO[n].gap > 0, n);
  assert.equal(SFX_INFO.evil_laugh.max, 1);
  assert.ok(SFX_INFO.evil_laugh.gap >= 2);
  // Stings that must be heard over the beds duck them for about their length.
  for (const n of ['powerup', 'evil_laugh', 'minions_stinger']) {
    const d = SFX_INFO[n].duck;
    assert.ok(d && d.music < 1 && d.amb <= 1 && d.seconds > 0.5 && d.seconds <= run(n).dur, `${n} duck`);
  }
  const len = (n) => run(n).dur;
  assert.ok(len('wing_flap') <= 0.4 && len('minion_bite') <= 0.3 && len('stomp') <= 0.4 && len('box_hit') <= 0.8);
  assert.ok(len('powerup') >= 1 && len('powerup') <= 2);
  assert.ok(len('minion_emerge') <= 1 && len('minion_wreck') <= 1.2);
});

test('box_hit is a bright crystal clink over a low bump; stomp a thunk that springs back up', () => {
  const box = run('box_hit');
  const sines = box.voices.filter((v) => !v.noise && v.src.type === 'sine');
  assert.ok(sines.some((v) => firstFreq(v.src) >= 1500), 'crystal clink');
  assert.ok(sines.some((v) => firstFreq(v.src) <= 300 && v.src.frequency.events.at(-1)[1] < firstFreq(v.src)), 'dropping bump');
  const stomp = run('stomp');
  const thunk = stomp.voices.find((v) => !v.noise && v.src.type === 'sine');
  assert.ok(thunk.src.frequency.events.at(-1)[1] < firstFreq(thunk.src) * 0.5, 'thunk drops');
  const spring = stomp.voices.find((v) => v.src.type === 'triangle');
  const f = spring.src.frequency.events.map((e) => e[1]);
  assert.ok(f[1] > f[0] * 2 && f[2] < f[1], `spring bends up and settles: ${f}`);
});

test('powerup: a rising run into a held D major chord (the flying theme\'s key)', () => {
  const { ctx } = run('powerup');
  const tri = ctx.nodes.filter((n) => n.kind === 'osc' && n.type === 'triangle').sort((a, b) => a.startAt - b.startAt);
  const run1 = tri.map((o) => firstFreq(o));
  assert.ok(run1.length >= 6);
  for (let i = 1; i < run1.length; i++) assert.ok(run1[i] > run1[i - 1], 'the run rises');
  // The last chord: every sawtooth that starts last is a D, F# or A.
  const saws = ctx.nodes.filter((n) => n.kind === 'osc' && n.type === 'sawtooth');
  const last = Math.max(...saws.map((o) => o.startAt));
  const pcs = new Set(saws.filter((o) => o.startAt === last).map((o) => Math.round(12 * Math.log2(o.frequency.value / 440) + 69) % 12));
  assert.deepEqual([...pcs].sort((a, b) => a - b), [2, 6, 9]);
});

test('minion sounds: a dirt burst with servo chitter, a steel jaw snap, a crunch with a spark fizz', () => {
  const emerge = run('minion_emerge');
  assert.ok(emerge.voices.some((v) => v.noise && v.src.type === 'lowpass'), 'dirt burst');
  const chirps = emerge.ctx.nodes.filter((n) => n.kind === 'osc' && n.type === 'custom' && n.startAt > T0 + 0.2);
  assert.ok(chirps.length >= 4, `servo chitter ${chirps.length}`);
  const bite = run('minion_bite');
  const metal = bite.voices.filter((v) => !v.noise && firstFreq(v.src) > 1000 && v.at > T0 + 0.05);
  assert.ok(metal.length >= 4, 'steel clack partials after the zip');
  const wreck = run('minion_wreck');
  assert.ok(wreck.voices.some((v) => v.noise && v.src.type === 'highpass' && firstFreq(v.src) >= 4000 && v.gainAt(T0 + 0.3) > 0.03), 'spark fizz rings on');
  assert.ok(wreck.count('shaper') === 0 && wreck.dur <= 1);
  // Chitter and crackles vary from one minion to the next.
  const pitches = new Set(Array.from({ length: 6 }, () => Math.round(firstFreq(run('minion_emerge').ctx.nodes.filter((n) => n.kind === 'osc' && n.type === 'custom').at(-1)))));
  assert.ok(pitches.size > 1);
});

test('evil_laugh: formant-filtered voiced bursts dropping in pitch, through an echo and a big hall', () => {
  const { ctx, dur, voices } = run('evil_laugh', { p: 1 });
  assert.ok(dur >= 2.5 && dur <= 3.5, `length ${dur}`);
  // A glottal buzz (a custom wave) and a growl an octave under it feed a bank of 4 band-pass
  // formants through one voiced envelope.
  const glottis = ctx.nodes.find((n) => n.kind === 'osc' && n.type === 'custom');
  const voiced = voices.find((v) => v.src === glottis);
  assert.ok(voiced, 'voiced envelope');
  const formants = voiced.src.outs[0].outs.filter((n) => n.kind === 'filter' && n.type === 'bandpass');
  assert.equal(formants.length, 4, 'four formants');
  // Five syllables ('mwa-ha-ha-ha-haaw'), each starting a burst of the voiced envelope.
  const g = voiced.src.outs[0].gain.events;
  const onsets = g.filter(([m, v], i) => m === 'setValueAtTime' && v === 0 && g[i + 1]?.[0] === 'linearRampToValueAtTime' && g[i + 1][1] > 0).map(([, , t]) => t);
  assert.equal(onsets.length, 5, `syllables at ${onsets}`);
  const voicedEnd = g.at(-1)[2] - T0;
  assert.ok(voicedEnd >= 1.5 && voicedEnd <= 2.2, `about 2 s of laughing: ${voicedEnd}`);
  // Deep, and every 'ha' starts lower than the one before and falls within itself.
  const f = glottis.frequency.events;
  const starts = f.filter(([m]) => m === 'setValueAtTime').map(([, v]) => v);
  assert.equal(starts.length, 5);
  for (let i = 2; i < starts.length; i++) assert.ok(starts[i] < starts[i - 1], `ha ${i} starts lower`);
  assert.ok(Math.max(...f.map(([, v]) => v)) < 130 && Math.min(...f.map(([, v]) => v)) >= 50, 'a deep voice');
  const syllableEnds = f.filter((e, i) => f[i + 1]?.[0] === 'setValueAtTime' || i === f.length - 1).map(([, v]) => v);
  syllableEnds.forEach((end, i) => assert.ok(end < starts[i], `syllable ${i} falls`));
  // The 'h' of each 'ha': a breath through the formants just before the voice.
  const breath = voices.find((v) => v.src.kind === 'noise' && v.src.outs[0].outs.some((n) => formants.includes(n)));
  assert.ok(breath, 'aspiration');
  // Big reverb and echo, both dying out within the reported length: a hall impulse of at most
  // 2 s after the voice ends, and a slapback delay whose feedback decays fast.
  const hall = ctx.nodes.find((n) => n.kind === 'convolver');
  assert.ok(hall?.buffer.length / ctx.sampleRate <= 2 && voicedEnd + hall.buffer.length / ctx.sampleRate <= dur + 0.3, 'hall rings out');
  const delay = ctx.nodes.find((n) => n.kind === 'delay');
  const loop = ctx.nodes.find((n) => n.kind === 'gain' && n.outs.includes(delay) && n.ins.some((x) => x.kind === 'filter'));
  assert.ok(loop && loop.gain.value <= 0.4, 'echo feedback');
  assert.ok(delay.delayTime.value >= 0.15 && delay.delayTime.value <= 0.35);
  const repeats = Math.log(1e-3) / Math.log(loop.gain.value); // to -60 dB
  assert.ok(voicedEnd + repeats * delay.delayTime.value <= dur + 0.5, 'echo dies within the voice slot');
});

test('evil_laugh: with the engine\'s shared hall it makes no convolver of its own and sends at its own volume', () => {
  const bare = run('evil_laugh', { p: 1 });
  const ownHall = bare.ctx.nodes.find((n) => n.kind === 'convolver');
  const bareSend = ownHall.ins[0];
  assert.equal(bareSend.kind, 'gain');
  assert.ok(ownHall.outs.includes(bare.ctx.nodes[1]), 'a bare render\'s own hall plays into its output'); // [0] is the destination
  const ctx = new RecordingContext();
  const hall = ctx.createConvolver();
  const nodes = ctx.nodes.length;
  const out = ctx.createGain();
  SFX.evil_laugh(ctx, out, T0, { ...OPTS, hall, outGain: 0.5 });
  assert.equal(ctx.nodes.slice(nodes).filter((n) => n.kind === 'convolver').length, 0, 'no convolver per laugh');
  assert.equal(hall.ins.length, 1, 'one send into the shared hall');
  assert.ok(Math.abs(hall.ins[0].gain.value - bareSend.gain.value * 0.5) < 1e-9, 'the send carries the voice\'s volume');
  assert.equal(hall.outs.length, 0, 'the shared hall is not routed through this voice');
});
