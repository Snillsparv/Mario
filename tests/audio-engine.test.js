// AudioEngine behaviour against a fake WebAudio implementation: muting keeps synthesis off,
// a half-failed context setup leaves a clean silent engine, a track replaced right after it
// started is cut instead of crossfaded, and terrain-less sounds use the last terrain.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../src/core/events.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { SFX } from '../src/audio/sfx.js';

// AudioParam-like function: callable (so node.connect(x) returns x for chaining) and
// records its automation calls.
function fakeParam() {
  const p = (x) => x;
  p.value = 0;
  p.calls = [];
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) {
    p[m] = (...args) => {
      p.calls.push([m, ...args]);
      return p;
    };
  }
  return p;
}

// Any property of a fake node is a fakeParam, created on first access.
const fakeNode = () =>
  new Proxy({}, {
    get: (node, key) => (key in node ? node[key] : (node[key] = fakeParam())),
  });

const NODE_TYPES = ['Gain', 'Oscillator', 'BiquadFilter', 'BufferSource', 'Convolver', 'DynamicsCompressor', 'WaveShaper', 'StereoPanner', 'PeriodicWave'];

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 4000; // small buffers keep the generated noise/impulses cheap
    this.destination = fakeNode();
    this.created = {};
    FakeAudioContext.instances.push(this);
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }

  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (c) => data[c] };
  }
}
for (const type of NODE_TYPES) {
  FakeAudioContext.prototype[`create${type}`] = function () {
    this.created[type] = (this.created[type] || 0) + 1;
    return fakeNode();
  };
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  globalThis.window = { AudioContext: FakeAudioContext, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {} };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
  delete globalThis.document;
});

test('while muted no context is created; unmuting starts audio, muting suspends it', async () => {
  const audio = new AudioEngine(new Events());
  audio.muted = true;
  assert.equal(await audio.unlock(), false);
  assert.equal(FakeAudioContext.instances.length, 0);
  audio.muted = false; // the page has been interacted with, so this may create the context
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(await audio.unlock(), true);
  audio.muted = true;
  mock.timers.tick(200); // after the fade-out
  assert.equal(audio.ctx.state, 'suspended');
  audio.muted = false;
  assert.equal(audio.ctx.state, 'running');
});

test('a context that fails half-way through setup is discarded and audio stays silent', async () => {
  delete FakeAudioContext.prototype.createStereoPanner; // e.g. an old WebKit
  const warn = mock.method(console, 'warn', () => {});
  try {
    const events = new Events();
    const audio = new AudioEngine(events);
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.ctx, null);
    assert.equal(FakeAudioContext.instances[0].state, 'closed');
    events.emit('sfx', { name: 'jump', pos: { x: 0, y: 0, z: 0 } });
    events.emit('footstep', { terrain: 'grass', speed: 10 });
    audio.update(1 / 60);
    assert.equal(await audio.unlock(), false, 'does not retry every gesture');
    assert.equal(FakeAudioContext.instances.length, 1);
    assert.equal(warn.mock.callCount(), 1);
  } finally {
    warn.mock.restore();
    FakeAudioContext.prototype.createStereoPanner = function () {
      return fakeNode();
    };
  }
});

test('errors inside a sound never reach the event emitter', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const jump = SFX.jump;
  SFX.jump = () => {
    throw new Error('boom');
  };
  const warn = mock.method(console, 'warn', () => {});
  try {
    events.emit('sfx', { name: 'jump' });
    events.emit('sfx', { name: 'jump' });
    assert.equal(warn.mock.callCount(), 1, 'logged once');
  } finally {
    SFX.jump = jump;
    warn.mock.restore();
  }
});

test('the first track waits for a newer request, and a just-started track is cut, not crossfaded', async () => {
  const audio = new AudioEngine(new Events());
  audio.playMusic('title'); // requested before the context exists (title screen)
  await audio.unlock();
  const ctx = audio.ctx;
  ctx.currentTime = 0.4;
  audio.playMusic('castle_grounds'); // the same click also started the game
  mock.timers.tick(700);
  assert.equal(audio.track.name, 'castle_grounds');
  const castle = audio.track;
  assert.ok(!castle.gain.gain.calls.some(([m]) => m === 'linearRampToValueAtTime'), 'castle starts at full level');

  // A track that has played for a while is crossfaded.
  ctx.currentTime = 10;
  audio.playMusic('title');
  const ramps = castle.gain.gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
  assert.deepEqual(ramps.at(-1), ['linearRampToValueAtTime', 0, 10 + 1.2]);
  // ...but replacing that one again straight away cuts it quickly.
  const title = audio.track;
  ctx.currentTime = 10.3;
  audio.playMusic('castle_grounds');
  const cut = title.gain.gain.calls.filter(([m]) => m === 'linearRampToValueAtTime').at(-1);
  assert.ok(cut[2] - 10.3 < 0.2, `cut over ${cut[2] - 10.3} s`);
  audio.stopMusic();
  mock.timers.tick(2000);
});

test('sounds without a terrain use the terrain last walked on', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const skid = SFX.skid;
  const seen = [];
  SFX.skid = (ctx, out, t, o) => {
    seen.push(o.terrain);
    return 0.3;
  };
  try {
    events.emit('sfx', { name: 'skid' });
    events.emit('footstep', { terrain: 'stone', speed: 20 });
    audio.ctx.currentTime = 1;
    events.emit('sfx', { name: 'skid' });
    events.emit('land', { terrain: 'sand', hard: false });
    audio.ctx.currentTime = 2;
    events.emit('sfx', { name: 'skid', terrain: 'wood' });
    audio.ctx.currentTime = 3;
    events.emit('sfx', { name: 'skid' });
  } finally {
    SFX.skid = skid;
  }
  assert.deepEqual(seen, ['grass', 'stone', 'wood', 'sand']);
});
