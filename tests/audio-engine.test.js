// AudioEngine behaviour against a fake WebAudio implementation: muting keeps synthesis off,
// a half-failed context setup leaves a clean silent engine, a track replaced right after it
// started is cut instead of crossfaded, terrain-less sounds use the last terrain, names
// inherited from Object.prototype are unknown, voice slots free on the audio clock, a cue
// ends by itself, a looping track requested before audio existed waits for the unlocking
// press while a cue asked for without audio (no context yet, or muted) is dropped instead
// of starting later, and game over plays a jingle over the card with the ambience ducked.
// AI RACE mode: darkMode swaps the birds and pastoral bed for the storm and fades the dark
// track in (and back, also after a game over), lightning thunders after a delay, footsteps
// and landings scale with speed and air time, and bursty sounds are rate-limited.
// Winged hat: 'wingHat' puts the flying theme (its storm variant in AI RACE mode) in the
// music slot and gives the grounds their music back when it comes off; stings duck the beds;
// the first minion of a storm brings the minions' stinger. A hat grabbed again while its
// theme is still fading out brings that same theme back (no second copy starts over it).
// The locked castle's laugh shares one hall reverb, made ahead at idle time.
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
import { Storm } from '../src/audio/storm.js';
import { smoothRamp } from '../src/audio/synth.js';

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

const NODE_TYPES = ['Gain', 'Oscillator', 'BiquadFilter', 'BufferSource', 'Convolver', 'Delay', 'DynamicsCompressor', 'WaveShaper', 'StereoPanner', 'PeriodicWave'];

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

// Replace some recipes with recorders of (volume, start delay, opts); returns the log and
// a restore function.
function recordSfx(names, dur = 0.3) {
  const saved = Object.fromEntries(names.map((n) => [n, SFX[n]]));
  const log = Object.fromEntries(names.map((n) => [n, []]));
  for (const n of names) {
    SFX[n] = (ctx, out, t, o) => {
      log[n].push({ volume: out.gain.value, delay: t - ctx.currentTime, o });
      return dur;
    };
  }
  return { log, restore: () => Object.assign(SFX, saved) };
}

// Advance the fake audio clock with engine updates at 60 Hz.
function run(audio, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    audio.ctx.currentTime += 1 / 60;
    audio.update(1 / 60);
  }
}

const lastRamp = (param) => param.calls.findLast(([m]) => m === 'linearRampToValueAtTime');

test('darkMode: the storm replaces the birds and pastoral bed, the dark track fades in, an alarm stings; off crossfades back', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['alarm']);
  const birds = [];
  const playAt = audio.ambience.playAt;
  audio.ambience.playAt = (recipe, pos, volume) => {
    if (volume !== undefined) birds.push(volume); // bird calls carry their fade level
    playAt(recipe, pos, volume);
  };
  try {
    run(audio, 5);
    assert.ok(birds.length > 3, 'birds sing in sunny weather');
    assert.equal(audio.storm.active, false, 'no storm graph while sunny');
    const t0 = audio.ctx.currentTime;
    events.emit('darkMode', { on: true });
    assert.equal(log.alarm.length, 1, 'alarm sting');
    assert.equal(audio.track?.name, 'dark');
    const fadeIn = lastRamp(audio.track.gain.gain);
    assert.ok(fadeIn[1] > 0 && Math.abs(fadeIn[2] - (t0 + 3)) < 1e-6, `dark track fades in over 3 s: ${fadeIn}`);
    assert.ok(audio.storm.active, 'storm built');
    assert.deepEqual(lastRamp(audio.storm.graph.bus.gain).slice(1), [1, t0 + 3]);
    assert.deepEqual(lastRamp(audio.ambience.pastoral.gain).slice(1), [0, t0 + 3]);
    events.emit('darkMode', { on: true }); // repeated: nothing new
    assert.equal(log.alarm.length, 1);
    run(audio, 3.2);
    birds.length = 0;
    run(audio, 20);
    assert.equal(birds.length, 0, 'no birds in the storm');
    // Off: back to the grounds' ambience, no music (the grounds have none in free roam).
    const dark = audio.track;
    const t1 = audio.ctx.currentTime;
    events.emit('darkMode', { on: false });
    assert.equal(audio.track, null);
    assert.deepEqual(lastRamp(dark.gain.gain).slice(1), [0, t1 + 3], 'dark track fades out over 3 s');
    assert.deepEqual(lastRamp(audio.storm.graph.bus.gain).slice(1), [0, t1 + 3]);
    assert.deepEqual(lastRamp(audio.ambience.pastoral.gain).slice(1), [1, t1 + 3]);
    run(audio, 3.5);
    assert.equal(audio.storm.active, false, 'storm torn down once faded out');
    birds.length = 0;
    run(audio, 10);
    assert.ok(birds.length > 3, 'birds are back');
    assert.equal(log.alarm.length, 1, 'no alarm when switching off');
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('the storm mode set before audio exists applies when the context is made', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  events.emit('darkMode', { on: true });
  assert.equal(audio.wantMusic, 'dark', 'the loop waits for audio');
  await audio.unlock();
  assert.ok(audio.storm.active && audio.ambience.dark);
  mock.timers.tick(700);
  assert.equal(audio.track?.name, 'dark');
  audio.stopMusic();
  mock.timers.tick(5000);
});

test('a game over in the storm: the jingle cuts the dark track, the storm ends after the card', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  events.emit('darkMode', { on: true });
  run(audio, 10);
  events.emit('gameOver');
  assert.equal(audio.track.name, 'game_over');
  assert.equal(audio.dark, true, 'the frozen dark world keeps its storm under the card');
  mock.timers.tick(3300);
  assert.equal(audio.dark, false);
  assert.equal(lastRamp(audio.storm.graph.bus.gain)[1], 0);
  assert.equal(audio.track.name, 'game_over', 'the jingle is not touched');
  // gameStart is a backstop too.
  events.emit('darkMode', { on: true });
  events.emit('gameStart');
  assert.equal(audio.dark, false);
  audio.stopMusic();
  mock.timers.tick(5000);
});

test('lightning: thunder after 0.3-2.5 s (sooner and fuller for a strong strike), two rolls at most', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['thunder'], 3.5);
  try {
    for (let i = 0; i < 20; i++) {
      audio.ctx.currentTime = 100 * i;
      events.emit('lightning', { strength: i % 2 ? 1 : 0.1 });
    }
    events.emit('lightning', {}); // no strength: a medium one
    const strong = log.thunder.filter((x) => x.o.strength === 1);
    const weak = log.thunder.filter((x) => x.o.strength === 0.1);
    assert.equal(strong.length, 10);
    for (const x of log.thunder) assert.ok(x.delay >= 0.3 && x.delay <= 2.51, `delay ${x.delay}`);
    assert.ok(Math.max(...strong.map((x) => x.delay)) < Math.min(...weak.map((x) => x.delay)), 'close strikes are heard sooner');
    assert.ok(strong[0].volume > weak[0].volume);
    // The voice slot covers the delay as well as the roll.
    const end = audio.active.at(-1).end;
    assert.ok(end >= audio.ctx.currentTime + log.thunder.at(-1).delay + 3.5);
    audio.ctx.currentTime = 5000;
    for (let i = 0; i < 5; i++) events.emit('lightning', { strength: 0.8 });
    assert.equal(log.thunder.filter((x) => x.o.strength === 0.8).length, 2);
  } finally {
    restore();
  }
});

test('footsteps grow louder and brighter with speed; landings weigh the air time', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['footstep', 'land', 'land_hard', 'jump']);
  try {
    const speeds = [1, 4, 7, 10, 13, 16, 19, 23, 27, 32, 40];
    speeds.forEach((speed, i) => {
      audio.ctx.currentTime = 1 + i * 0.2;
      events.emit('footstep', { terrain: 'grass', speed });
    });
    const steps = log.footstep;
    assert.equal(steps.length, speeds.length);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i].volume >= steps[i - 1].volume, 'volume rises with speed');
      assert.ok(steps[i].o.bright >= steps[i - 1].o.bright, 'brightness rises with speed');
    }
    const at = (speed) => steps[speeds.indexOf(speed)];
    assert.ok(at(4).volume < at(32).volume * 0.3, 'tiptoe');
    assert.ok(at(13).volume <= at(32).volume * 0.5, 'walk');
    assert.equal(at(32).volume, 1, 'run as before');
    // A hop (0.3 s in the air), a full jump (1 s), a step down after walking, a ground pound.
    const land = (t, e = {}) => {
      audio.ctx.currentTime = t;
      events.emit('land', { terrain: 'grass', hard: false, ...e });
    };
    audio.ctx.currentTime = 10;
    events.emit('sfx', { name: 'jump' });
    land(10.3);
    audio.ctx.currentTime = 20;
    events.emit('sfx', { name: 'jump' });
    land(21);
    audio.ctx.currentTime = 30;
    events.emit('footstep', { terrain: 'grass', speed: 12 });
    land(30.15);
    land(40, { hard: true });
    const [hop, jump, stepDown] = log.land;
    assert.ok(hop.volume < 0.7 && stepDown.volume < 0.6, `hop ${hop.volume}, step down ${stepDown.volume}`);
    assert.equal(jump.volume, 1);
    assert.ok(hop.o.bright < jump.o.bright);
    assert.equal(log.land_hard[0].volume, 1);
    land(60, { fall: 900 }); // a given fall height decides
    assert.equal(log.land.at(-1).volume, 1);
  } finally {
    restore();
  }
});

test('AI RACE events play their sounds; bursts are rate-limited; big sounds carry farther', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const names = ['kaiju_roar', 'button_press', 'burn', 'hurt', 'fire_crackle', 'jump', 'fireball_explode'];
  const { log, restore } = recordSfx(names, 2);
  try {
    audio.ctx.currentTime = 1;
    events.emit('kaijuRoar', {});
    events.emit('sfx', { name: 'kaiju_roar' }); // the same roar from two modules: once
    events.emit('aiRaceButton', { on: true });
    events.emit('sfx', { name: 'button_press' });
    events.emit('hurt', { amount: 1, fire: true });
    events.emit('sfx', { name: 'burn' });
    events.emit('sfx', { name: 'no_such_sound' });
    assert.equal(log.kaiju_roar.length, 1);
    assert.equal(log.button_press.length, 1);
    assert.equal(log.hurt.length, 1);
    assert.equal(log.burn.length, 1);
    // Crackles requested every tick of a burning fire: spaced out, three at most at once.
    for (let i = 0; i < 60; i++) {
      audio.ctx.currentTime = 10 + i / 30;
      events.emit('sfx', { name: 'fire_crackle', pos: { ...audio.listener } });
    }
    assert.equal(log.fire_crackle.length, 3);
    // Inaudible requests do not use up the gap.
    log.fire_crackle.length = 0;
    audio.ctx.currentTime = 100;
    events.emit('sfx', { name: 'fire_crackle', pos: { x: 1e6, y: 0, z: 0 } });
    audio.ctx.currentTime = 100.01;
    events.emit('sfx', { name: 'fire_crackle', pos: { ...audio.listener } });
    assert.equal(log.fire_crackle.length, 1);
    // The roar carries across the grounds; an ordinary sound from there is silent.
    const far = { x: audio.listener.x, y: audio.listener.y, z: audio.listener.z - 8500 };
    audio.ctx.currentTime = 200;
    events.emit('sfx', { name: 'kaiju_roar', pos: far });
    events.emit('sfx', { name: 'jump', pos: far });
    events.emit('sfx', { name: 'fireball_explode', pos: far });
    assert.ok(log.kaiju_roar.at(-1).volume > 0.4, `roar at 8500: ${log.kaiju_roar.at(-1).volume}`);
    assert.equal(log.jump.length, 0);
    assert.ok(log.fireball_explode[0].o.dist > 8000, 'recipes get the distance');
  } finally {
    restore();
  }
});

test('storm: a steady droplet stream of self-disconnecting nodes; torn down (every source stopped) once faded out', () => {
  const ctx = new FakeAudioContext();
  ctx.state = 'running';
  const sources = [];
  for (const type of ['BufferSource', 'Oscillator']) {
    const make = ctx[`create${type}`].bind(ctx);
    ctx[`create${type}`] = () => {
      const n = make();
      n.stopped = false;
      n.stop = () => (n.stopped = true);
      sources.push(n);
      return n;
    };
  }
  const storm = new Storm(ctx, ctx.destination);
  storm.update(1 / 60);
  assert.equal(sources.length, 0, 'nothing built until the storm starts');
  storm.set(true, 3);
  const beds = sources.length;
  assert.ok(beds >= 8 && beds <= 16, `bed sources ${beds}`);
  for (let i = 0; i < 600; i++) {
    ctx.currentTime += 1 / 60;
    storm.update(1 / 60);
  }
  const drops = sources.slice(beds);
  assert.ok(drops.length > 120 && drops.length < 350, `${drops.length} drops in 10 s`);
  assert.ok(drops.every((d) => typeof d.onended === 'function'), 'each drop frees its gain when it ends');
  // A stall (a background tab) does not bring a burst of drops afterwards.
  ctx.currentTime += 5;
  const before = sources.length;
  storm.update(1 / 60);
  assert.ok(sources.length - before < 10, 'no burst after a stall');
  storm.set(false, 3);
  assert.ok(storm.active, 'still fading out');
  for (let i = 0; i < 200; i++) {
    ctx.currentTime += 1 / 60;
    storm.update(1 / 60);
  }
  assert.equal(storm.active, false);
  assert.ok(sources.slice(0, beds).every((n) => n.stopped), 'every bed source stopped');
  // Switching back on mid-fade reverses the fade instead of rebuilding.
  storm.set(true, 3);
  const built = sources.length;
  storm.set(false, 3);
  ctx.currentTime += 1;
  storm.update(1 / 60);
  storm.set(true, 3);
  assert.ok(storm.active);
  assert.ok(sources.length - built < 10, 'no second graph');
});

test('smoothRamp glides from the current value along an S-curve to the target', () => {
  const p = fakeParam();
  p.value = 0.2;
  smoothRamp(p, 10, 1, 3);
  const ramps = p.calls.filter(([m]) => m === 'linearRampToValueAtTime');
  assert.deepEqual(p.calls[0], ['cancelScheduledValues', 10]);
  assert.deepEqual(p.calls[1], ['setValueAtTime', 0.2, 10]);
  assert.deepEqual(ramps.at(-1).slice(1), [1, 13]);
  for (let i = 1; i < ramps.length; i++) assert.ok(ramps[i][1] > ramps[i - 1][1] && ramps[i][2] > ramps[i - 1][2]);
  // Slow at the ends: the first step covers far less than an even share.
  assert.ok(ramps[0][1] - 0.2 < 0.8 / ramps.length / 2);
});

const busLevel = (audio, bus) => audio.mix[bus].gain.calls.findLast(([m]) => m === 'setTargetAtTime')[1];

test('winged hat: the flying theme fades in under the power-up (which ducks the beds), and fades out when the hat comes off', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['powerup'], 1.5);
  try {
    audio.ctx.currentTime = 20; // the arrival cue has long ended: the grounds have no music
    events.emit('wingHat', { on: true });
    events.emit('sfx', { name: 'powerup', pos: { ...audio.listener } });
    assert.equal(log.powerup.length, 1);
    assert.equal(audio.track?.name, 'fly');
    const fly = audio.track;
    const fadeIn = lastRamp(fly.gain.gain);
    assert.ok(fadeIn[1] > 0 && fadeIn[2] - 20 >= 1 && fadeIn[2] - 20 <= 2, `fades in: ${fadeIn}`);
    assert.ok(busLevel(audio, 'music') < LEVELS.music * 0.5, 'the fanfare is heard over the music');
    assert.ok(busLevel(audio, 'amb') < LEVELS.amb);
    run(audio, 1.2);
    assert.ok(busLevel(audio, 'music') < LEVELS.music * 0.5, 'still ducked');
    run(audio, 0.2);
    assert.equal(busLevel(audio, 'music'), LEVELS.music, 'duck released on the audio clock');
    assert.equal(busLevel(audio, 'amb'), LEVELS.amb);
    // A second pickup while flying changes nothing.
    events.emit('wingHat', { on: true });
    assert.equal(audio.track, fly);
    // Off: the theme fades out and nothing replaces it.
    audio.ctx.currentTime = 60;
    events.emit('wingHat', { on: false });
    assert.equal(audio.track, null);
    assert.equal(audio.wantMusic, null);
    const out = lastRamp(fly.gain.gain);
    assert.ok(out[1] === 0 && out[2] - 60 >= 2 && out[2] - 60 <= 3, `fades out: ${out}`);
    events.emit('wingHat', { on: false }); // repeated: nothing
    assert.equal(audio.track, null);
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('winged hat in the storm: the storm variant plays and the dark track returns; the storm switching mid-flight swaps the themes', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['alarm']);
  try {
    events.emit('darkMode', { on: true });
    audio.ctx.currentTime = 10;
    events.emit('wingHat', { on: true });
    assert.equal(audio.track.name, 'fly_dark');
    assert.ok(audio.storm.active, 'the storm beds play on under it');
    audio.ctx.currentTime = 30;
    events.emit('wingHat', { on: false });
    assert.equal(audio.track.name, 'dark', 'the dark track comes back');
    assert.ok(lastRamp(audio.track.gain.gain)[2] - 30 >= 2, 'fading in');
    // The storm switching on and off during a flight.
    audio.ctx.currentTime = 40;
    events.emit('darkMode', { on: false });
    events.emit('wingHat', { on: true });
    assert.equal(audio.track.name, 'fly');
    audio.ctx.currentTime = 50;
    events.emit('darkMode', { on: true });
    assert.equal(audio.track.name, 'fly_dark');
    assert.equal(log.alarm.length, 2, 'the alarm still stings');
    audio.ctx.currentTime = 60;
    events.emit('darkMode', { on: false });
    assert.equal(audio.track.name, 'fly');
    audio.ctx.currentTime = 70;
    events.emit('wingHat', { on: false });
    assert.equal(audio.track, null);
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('winged hat: a game over takes the slot for good, a new game starts without it, and no audio means nothing is left queued', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  events.emit('wingHat', { on: true }); // before audio exists: the loop waits...
  assert.equal(audio.wantMusic, 'fly');
  events.emit('wingHat', { on: false }); // ...and is forgotten when the hat comes off
  assert.equal(audio.wantMusic, null);
  await audio.unlock();
  mock.timers.tick(1000);
  assert.equal(audio.track, null);
  events.emit('wingHat', { on: true });
  audio.ctx.currentTime = 10;
  events.emit('gameOver');
  assert.equal(audio.track.name, 'game_over');
  events.emit('wingHat', { on: false }); // the player takes the hat off at the respawn
  assert.equal(audio.track.name, 'game_over', 'the jingle is not touched');
  mock.timers.tick(3300);
  audio.ctx.currentTime = 20;
  audio.playMusic('title');
  events.emit('wingHat', { on: false });
  assert.equal(audio.track.name, 'title');
  events.emit('gameStart');
  assert.equal(audio.flying, false);
  // Flying when a new game starts straight away (?skipTitle): the theme stops.
  events.emit('wingHat', { on: true });
  assert.equal(audio.wantMusic, 'fly');
  events.emit('gameStart');
  assert.equal(audio.wantMusic, null);
  assert.equal(audio.flying, false);
  audio.stopMusic();
  mock.timers.tick(5000);
});

test('the first minion of a storm brings the minions\' stinger, once per storm (never in sunny weather)', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['minions_stinger', 'minion_emerge', 'alarm']);
  try {
    const emerge = (t) => {
      audio.ctx.currentTime = t;
      events.emit('sfx', { name: 'minion_emerge', pos: { ...audio.listener } });
    };
    emerge(1);
    assert.equal(log.minions_stinger.length, 0, 'not while sunny');
    events.emit('darkMode', { on: true });
    emerge(12);
    emerge(17);
    emerge(22);
    assert.equal(log.minion_emerge.length, 4);
    assert.equal(log.minions_stinger.length, 1);
    assert.ok(busLevel(audio, 'music') < LEVELS.music, 'the stinger ducks the dark track');
    events.emit('darkMode', { on: false });
    events.emit('darkMode', { on: true });
    emerge(40);
    assert.equal(log.minions_stinger.length, 2, 'a new storm');
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('stings duck the beds for their length; overlapping stings keep the deeper duck until the last ends', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { restore } = recordSfx(['evil_laugh', 'powerup'], 2);
  try {
    audio.ctx.currentTime = 5;
    events.emit('sfx', { name: 'evil_laugh', pos: { ...audio.listener } });
    const laughAmb = busLevel(audio, 'amb');
    assert.ok(laughAmb < LEVELS.amb * 0.6, `the grounds hush for the laugh: ${laughAmb}`);
    events.emit('sfx', { name: 'evil_laugh' }); // repeated at once: plays once, no second duck
    run(audio, 0.5);
    events.emit('sfx', { name: 'powerup' }); // a shallower ambience duck, a deeper music one
    assert.equal(busLevel(audio, 'amb'), laughAmb, 'the deeper duck holds');
    assert.ok(busLevel(audio, 'music') <= LEVELS.music * 0.3 + 1e-9);
    run(audio, 1.5); // the powerup has ended, the laugh has not
    assert.equal(busLevel(audio, 'amb'), laughAmb);
    mock.timers.tick(5000); // wall-clock time alone releases nothing
    assert.equal(busLevel(audio, 'amb'), laughAmb);
    run(audio, 0.5);
    assert.equal(busLevel(audio, 'amb'), LEVELS.amb);
    assert.equal(busLevel(audio, 'music'), LEVELS.music);
    // A game over clears a sting duck at once.
    audio.ctx.currentTime = 20;
    events.emit('sfx', { name: 'evil_laugh' });
    events.emit('gameOver');
    assert.equal(busLevel(audio, 'music'), LEVELS.music);
    assert.equal(audio.stingEnd, 0);
    mock.timers.tick(3300);
    assert.equal(busLevel(audio, 'amb'), LEVELS.amb);
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('the new sounds play through the engine against the fake context without errors', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const warn = mock.method(console, 'warn', () => {});
  try {
    let t = 1;
    for (const name of ['box_hit', 'powerup', 'wing_flap', 'stomp', 'minion_emerge', 'minion_bite', 'minion_wreck', 'minions_stinger', 'evil_laugh']) {
      audio.ctx.currentTime = t += 5;
      assert.equal(audio.play(name, { pos: { ...audio.listener } }), true, name);
    }
    assert.equal(warn.mock.callCount(), 0);
    assert.ok(audio.ctx.created.Convolver >= 2 && audio.ctx.created.Delay >= 1, 'the laugh has its hall and echo');
  } finally {
    warn.mock.restore();
    mock.timers.tick(5000);
  }
});

// Sequencers still scheduling notes (a stopped one has no timer).
const running = (tracks) => tracks.filter((tr) => tr.seq.timer !== null).map((tr) => tr.name);

test('winged hat grabbed again while its theme fades out: the same theme comes back, in time, not a second copy', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  try {
    audio.ctx.currentTime = 20;
    events.emit('wingHat', { on: true });
    const fly = audio.track;
    audio.ctx.currentTime = 60;
    events.emit('wingHat', { on: false });
    assert.equal(audio.track, null);
    mock.timers.tick(1000); // 1 s into the 2.5 s fade-out
    audio.ctx.currentTime = 61;
    fly.gain.gain.value = 0.6 * compileSong(SONGS.fly).level; // where the fade has got to
    events.emit('wingHat', { on: true });
    assert.equal(audio.track, fly, 'the fading theme is back in the slot');
    assert.deepEqual(audio.fading, []);
    const up = lastRamp(fly.gain.gain);
    assert.equal(up[1], compileSong(SONGS.fly).level, 'back up to its level');
    assert.ok(up[2] > 61 && up[2] - 61 <= 0.5 * 1.2 + 1e-9, `quickly, from where it was: ${up}`);
    mock.timers.tick(5000); // the fade-out's stop never comes
    assert.deepEqual(running([fly]), ['fly']);
    // Off again, and back only after the fade has finished: a fresh start then.
    audio.ctx.currentTime = 80;
    events.emit('wingHat', { on: false });
    mock.timers.tick(2900);
    assert.deepEqual(running([fly]), []);
    audio.ctx.currentTime = 83;
    events.emit('wingHat', { on: true });
    assert.notEqual(audio.track, fly);
    assert.equal(audio.track.name, 'fly');
  } finally {
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('in the storm, the hat grabbed again as the dark track fades back in: one flying theme, the dark track cut', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { restore } = recordSfx(['alarm']);
  const tracks = [];
  const note = () => audio.track && !tracks.includes(audio.track) && tracks.push(audio.track);
  try {
    events.emit('darkMode', { on: true });
    audio.ctx.currentTime = 10;
    events.emit('wingHat', { on: true });
    note();
    const fly = audio.track;
    audio.ctx.currentTime = 30;
    events.emit('wingHat', { on: false }); // the dark track fades back in over it (3 s)
    note();
    assert.equal(audio.track.name, 'dark');
    audio.ctx.currentTime = 30.5;
    mock.timers.tick(500);
    events.emit('wingHat', { on: true });
    note();
    assert.equal(audio.track, fly);
    mock.timers.tick(1000);
    assert.deepEqual(running(tracks), ['fly_dark'], 'only the one flying theme plays on');
    // The same the other way: the dark track, just faded out by a pickup, comes back itself.
    audio.ctx.currentTime = 50;
    events.emit('wingHat', { on: false });
    const dark = audio.track;
    audio.ctx.currentTime = 55;
    mock.timers.tick(5000);
    events.emit('wingHat', { on: true });
    note();
    audio.ctx.currentTime = 56;
    mock.timers.tick(500);
    events.emit('wingHat', { on: false });
    assert.equal(audio.track, dark);
    mock.timers.tick(5000);
    note();
    assert.deepEqual(running(tracks).sort(), ['dark']);
  } finally {
    restore();
    audio.stopMusic();
    mock.timers.tick(5000);
  }
});

test('the castle hall reverb (and the stings\' waves) are made ahead at idle time; the hall is shared by every laugh', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const warn = mock.method(console, 'warn', () => {});
  try {
    const convolvers = () => audio.ctx.created.Convolver;
    assert.equal(convolvers(), 1, 'the mixer\'s room reverb only, at first');
    assert.equal(audio.hall, null);
    mock.timers.tick(1500); // the impulse...
    assert.equal(convolvers(), 1);
    mock.timers.tick(1500); // ...then, in an idle moment of its own, the convolver
    assert.equal(convolvers(), 2);
    const hall = audio.hall;
    assert.ok(hall?.buffer?.length > 0, 'its impulse is loaded');
    // Then, in a third idle moment, the waves the laugh and the minions would make on their
    // first play.
    const waves = () => audio.ctx.created.PeriodicWave ?? 0;
    const before = waves();
    mock.timers.tick(1500);
    assert.equal(waves(), before + 2, 'glottal and servo waves');
    let t = 5;
    for (let i = 0; i < 3; i++) {
      audio.ctx.currentTime = t += 5;
      assert.equal(audio.play('evil_laugh', { pos: { ...audio.listener } }), true);
    }
    assert.equal(convolvers(), 2, 'no convolver per laugh');
    assert.equal(audio.hall, hall);
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
    mock.timers.tick(5000);
  }
});

test('a laugh before the idle moment makes the shared hall on the spot; the idle step then makes no second one', async () => {
  const events = new Events();
  const audio = new AudioEngine(events);
  await audio.unlock();
  const { log, restore } = recordSfx(['evil_laugh']);
  try {
    audio.ctx.currentTime = 1;
    events.emit('sfx', { name: 'evil_laugh', pos: { ...audio.listener } });
    assert.ok(audio.hall, 'made for the laugh');
    assert.equal(log.evil_laugh[0].o.hall, audio.hall, 'and handed to it');
    assert.ok(Math.abs(log.evil_laugh[0].o.outGain - log.evil_laugh[0].volume) < 1e-9, 'with the voice\'s volume');
    mock.timers.tick(5000);
    assert.equal(audio.ctx.created.Convolver, 2);
    events.emit('sfx', { name: 'jump' }); // other sounds get no hall
    assert.equal(log.evil_laugh.length, 1);
  } finally {
    restore();
    mock.timers.tick(5000);
  }
});
