// AudioEngine behaviour against a fake WebAudio implementation: muting keeps synthesis off,
// a half-failed context setup leaves a clean silent engine, a track replaced right after it
// started is cut instead of crossfaded, terrain-less sounds use the last terrain, names
// inherited from Object.prototype are unknown, voice slots free on the audio clock, a cue
// ends by itself, a looping track requested before audio existed waits for the unlocking
// press while a cue asked for without audio (no context yet, or muted) is dropped instead
// of starting later, and game over plays a jingle over the card with the ambience ducked.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../src/core/events.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { SFX } from '../src/audio/sfx.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import { Sequencer } from '../src/audio/Sequencer.js';
import { INSTRUMENTS } from '../src/audio/instruments.js';
import { LEVELS } from '../src/audio/mixer.js';

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

test('names inherited from Object.prototype are unknown sounds and songs', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const warn = mock.method(console, 'warn', () => {});
  try {
    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
      events.emit('sfx', { name });
      audio.play(name);
      audio.playMusic(name);
    }
    assert.equal(audio.active.length, 0, 'no voice allocated');
    assert.equal(audio.track, null);
    assert.equal(audio.wantMusic, null);
    assert.equal(warn.mock.callCount(), 0, 'nothing logged');
  } finally {
    warn.mock.restore();
  }
});

test("a plain 'punch' plays the combo's first jab, or its second right after a first jab", async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const saved = { punch1: SFX.punch1, punch2: SFX.punch2 };
  const heard = [];
  for (const n of ['punch1', 'punch2']) {
    SFX[n] = () => {
      heard.push(n);
      return 0.2;
    };
  }
  const at = (t, name = 'punch') => {
    audio.ctx.currentTime = t;
    events.emit('sfx', { name });
  };
  try {
    at(0); // the combo: jab, jab 7 ticks later
    at(0.233);
    at(2); // a lone punch
    at(2.5); // too late to chain: a first jab again
    at(2.7); // chains
    at(2.9); // after a second jab, a new first jab
    at(3.5, 'punch2'); // explicit names play as asked
    at(3.6, 'punch2');
  } finally {
    Object.assign(SFX, saved);
  }
  assert.deepEqual(heard, ['punch1', 'punch2', 'punch1', 'punch1', 'punch2', 'punch1', 'punch2', 'punch2']);
});

test('voice slots are freed on the audio clock, not by wall-clock timers', async () => {
  const audio = new AudioEngine(new Events());
  await audio.unlock();
  let played = 0;
  const recipe = () => {
    played++;
    return 1; // seconds
  };
  for (let i = 0; i < 40; i++) audio.voice(recipe, {}, audio.mix.sfx);
  assert.equal(played, 32, 'capped');
  mock.timers.tick(60000); // wall-clock time alone (e.g. a suspended context) frees nothing
  audio.voice(recipe, {}, audio.mix.sfx);
  assert.equal(played, 32);
  audio.ctx.currentTime = 2; // past each voice's length + tail
  audio.voice(recipe, {}, audio.mix.sfx);
  assert.equal(played, 33);
  assert.equal(audio.active.length, 1);
});

test('a cue plays once: the sequencer stops at its end and the engine frees the track', async () => {
  const song = compileSong(SONGS.castle_grounds);
  const scheduled = [];
  const originals = { ...INSTRUMENTS };
  for (const inst of Object.keys(INSTRUMENTS)) INSTRUMENTS[inst] = (ctx, out, t) => scheduled.push(t);
  try {
    const ctx = new FakeAudioContext();
    const seq = new Sequencer(ctx, song, ctx.destination);
    seq.start(0, { realtime: false, endBeat: song.endBeat });
    seq.scheduleUntil(1000);
    const spb = 60 / song.bpm;
    assert.equal(scheduled.length, song.events.filter((e) => e.beat < song.endBeat).length);
    assert.ok(Math.max(...scheduled) <= song.endBeat * spb);
    assert.ok(seq.endTime > song.endBeat * spb && seq.endTime < song.endBeat * spb + 5, `fades by ${seq.endTime}`);
  } finally {
    Object.assign(INSTRUMENTS, originals);
  }

  const audio = new AudioEngine(new Events());
  await audio.unlock();
  audio.playMusic('castle_grounds');
  const { seq } = audio.track;
  audio.ctx.currentTime = seq.endTime - 0.1;
  audio.update(1 / 60);
  assert.equal(audio.track?.name, 'castle_grounds', 'still fading');
  audio.ctx.currentTime = seq.endTime + 0.01;
  audio.update(1 / 60);
  assert.equal(audio.track, null);
  assert.equal(audio.wantMusic, null);
  audio.playMusic('castle_grounds'); // can be played again
  assert.equal(audio.track?.name, 'castle_grounds');
  audio.stopMusic();
  mock.timers.tick(2000);
});

test('the menu track stops when the game starts', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  audio.playMusic('title');
  assert.equal(audio.track.name, 'title');
  events.emit('gameStart');
  assert.equal(audio.track, null);
  assert.equal(audio.wantMusic, null);
  mock.timers.tick(2000);
});

// A window whose listeners can be fired, for the gesture hooks.
function fakeWindow() {
  const listeners = {};
  globalThis.window.addEventListener = (type, fn) => (listeners[type] ??= []).push(fn);
  globalThis.window.removeEventListener = (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
  };
  return (type, e = {}) => [...(listeners[type] || [])].forEach((fn) => fn({ type, ...e }));
}

test('music requested before audio existed waits until the unlocking press is released', async () => {
  const fire = fakeWindow();
  const events = new Events();
  const audio = new AudioEngine(events);
  audio.playMusic('title'); // the title screen, before any gesture
  fire('keydown', { code: 'Enter' }); // Start, held down: creates the context
  await audio.unlock();
  mock.timers.tick(1500);
  assert.equal(audio.track, null, 'nothing starts while the press is held');
  fire('keyup', { code: 'Space' }); // another key does not count
  mock.timers.tick(200);
  assert.equal(audio.track, null);
  // Released: the title resolves and the game starts before the pending title track.
  fire('keyup', { code: 'Enter' });
  events.emit('gameStart');
  audio.playMusic('castle_grounds');
  mock.timers.tick(1000);
  assert.equal(audio.track.name, 'castle_grounds');
  assert.equal(audio.track.gain.gain.calls.filter(([m]) => m === 'linearRampToValueAtTime').length, 0, 'no crossfade');
  audio.stopMusic();
  mock.timers.tick(2000);
});

test('with nothing newer requested, the pending track starts a moment after the release', async () => {
  const fire = fakeWindow();
  const audio = new AudioEngine(new Events());
  audio.playMusic('title');
  fire('pointerdown');
  await audio.unlock();
  mock.timers.tick(900);
  fire('pointerup'); // a click: the title only starts its fade-out now
  mock.timers.tick(500);
  assert.equal(audio.track, null, 'the scene may still change');
  mock.timers.tick(200);
  assert.equal(audio.track?.name, 'title');
  audio.stopMusic();
  mock.timers.tick(2000);
});

test('game over: a jingle takes the music slot, the ambience drops back for the card, the title crossfades in', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  events.emit('gameOver'); // no context (muted or never unlocked): no jingle turns up later
  assert.equal(audio.wantMusic, null);
  mock.timers.tick(4000);
  await audio.unlock();
  const level = (bus) => audio.mix[bus].gain.calls.findLast(([m]) => m === 'setTargetAtTime')[1];
  audio.playMusic('castle_grounds');
  const castle = audio.track;
  audio.ctx.currentTime = 10; // castle music still playing (an unusually quick game over)
  events.emit('gameOver');
  assert.equal(audio.track.name, 'game_over');
  const { seq, gain } = audio.track;
  assert.ok(castle.gain.gain.calls.some(([m, v, t]) => m === 'linearRampToValueAtTime' && v === 0 && t <= 10.2), 'castle music cut');
  assert.ok(!gain.gain.calls.some(([m]) => m === 'linearRampToValueAtTime'), 'the jingle cuts in at full level');
  audio.ctx.currentTime = 30;
  assert.ok(seq.endBeat * seq.spb >= 1.5 && seq.endBeat * seq.spb <= 2.8, 'final chord lands during the card');
  assert.ok(level('amb') < LEVELS.amb * 0.5, 'ambience ducked');
  assert.equal(level('music'), LEVELS.music, 'the jingle is not ducked');
  mock.timers.tick(3300); // the card is gone: the title is back
  assert.equal(level('amb'), LEVELS.amb);
  audio.ctx.currentTime = 33.2;
  audio.playMusic('title');
  assert.equal(audio.track.name, 'title');
  assert.ok(gain.gain.calls.some(([m, v]) => m === 'linearRampToValueAtTime' && v === 0), 'jingle fades out');
  assert.ok(audio.track.gain.gain.calls.some(([m]) => m === 'linearRampToValueAtTime'), 'title fades in (crossfade)');
  // A new game starts from resting levels, whatever was ducked before.
  events.emit('pause');
  events.emit('gameOver');
  events.emit('gameStart');
  assert.equal(level('music'), LEVELS.music);
  assert.equal(level('amb'), LEVELS.amb);
  audio.stopMusic();
  mock.timers.tick(5000);
  assert.equal(level('amb'), LEVELS.amb, 'no stale duck release');
});

test('a cue asked for without audio is dropped, not started when a press unlocks audio later', async () => {
  // A gamepad-only start: no user gesture, so no context. Minutes later the player's first
  // click creates it; the 8-bar arrival cue must not start then, in the middle of play.
  let active = false;
  Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ hasBeenActive: active, isActive: false }) });
  try {
    const fire = fakeWindow();
    const events = new Events();
    const audio = new AudioEngine(events);
    audio.playMusic('title'); // the title screen, still locked: a loop waits for the context
    assert.equal(audio.wantMusic, 'title');
    events.emit('gameStart'); // pad Start: the menu track stops, nothing unlocks
    audio.playMusic('castle_grounds');
    assert.equal(FakeAudioContext.instances.length, 0);
    assert.equal(audio.wantMusic, null, 'the cue is not queued');
    events.emit('gameOver'); // nor is the game-over jingle
    assert.equal(audio.wantMusic, null);
    mock.timers.tick(120000);
    events.emit('gameStart');
    audio.playMusic('castle_grounds');
    mock.timers.tick(90000);
    active = true;
    fire('pointerdown'); // the first click, mid-game
    assert.equal(await audio.unlock(), true);
    fire('pointerup');
    mock.timers.tick(3000);
    assert.equal(audio.track, null, 'no arrival cue mid-game');
    assert.equal(audio.wantMusic, null);

    // A cue asked for while muted is dropped as well (the suspended context would otherwise
    // play it on unmute) and replaces what played before; looping tracks still start.
    audio.playMusic('title');
    const title = audio.track;
    assert.equal(title?.name, 'title');
    audio.ctx.currentTime = 5;
    audio.muted = true;
    audio.playMusic('castle_grounds');
    assert.equal(audio.track, null);
    assert.equal(audio.wantMusic, null);
    assert.ok(title.gain.gain.calls.some(([m, v]) => m === 'linearRampToValueAtTime' && v === 0), 'the title fades out');
    audio.playMusic('title');
    assert.equal(audio.track?.name, 'title', 'a loop is not dropped while muted');
    audio.muted = false;
    mock.timers.tick(3000);
    assert.equal(audio.track?.name, 'title');

    // With audio running a cue plays straight away, as before.
    audio.ctx.currentTime = 20;
    audio.playMusic('castle_grounds');
    assert.equal(audio.track?.name, 'castle_grounds');
    audio.stopMusic();
    mock.timers.tick(3000);
  } finally {
    delete navigator.userActivation;
  }
});

test('a looping track asked for before audio exists still starts once audio does', async () => {
  const fire = fakeWindow();
  const audio = new AudioEngine(new Events());
  audio.playMusic('title');
  mock.timers.tick(60000);
  fire('keydown', { code: 'KeyA' });
  await audio.unlock();
  fire('keyup', { code: 'KeyA' });
  mock.timers.tick(700);
  assert.equal(audio.track?.name, 'title');
  audio.stopMusic();
  mock.timers.tick(2000);
});
