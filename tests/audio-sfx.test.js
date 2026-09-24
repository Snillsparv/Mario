// Sound-effect recipes run against a recording fake WebAudio context: every recipe schedules
// cleanly and reports its length; the level budget of each sound (the summed peak gain of its
// voices) stays in its class, so the soft dialog sounds sit under the gameplay sounds and a
// single effect cannot reach full scale on its own; the combo hits and the jumps are built
// the way their design says (swish before impact, one step per combo hit, springy rise);
// text_blip, which plays every few characters, is a single cheap oscillator with a varying
// pitch. Measured levels (offline renders) are in src/dev/previews/audio.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFX } from '../src/audio/sfx.js';
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
  // Voices: envelope gains (fed by a source chain, feeding audio nodes, not a parameter).
  const voices = ctx.nodes
    .filter((n) => n.kind === 'gain' && n !== out && n.ins.length && n.outs.every((d) => d instanceof Node))
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

test('the combo, flying-kick and sign-dialog sounds exist', () => {
  for (const n of [...GAMEPLAY_HITS, ...DIALOG]) assert.equal(typeof SFX[n], 'function', n);
});

test('every recipe schedules cleanly and reports a sane length', () => {
  for (const name of Object.keys(SFX)) {
    for (const terrain of ['grass', 'stone', 'wood', 'sand', 'water']) {
      const { dur, ctx, voices } = run(name, { terrain });
      assert.ok(Number.isFinite(dur) && dur > 0 && dur <= 3, `${name} length ${dur}`);
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
