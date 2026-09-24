// Game audio: synthesized sound effects, original music and outdoor ambience, all built
// with WebAudio at runtime (no audio files). See docs/ARCHITECTURE.md for the contract.
//
// The AudioContext is created lazily by unlock() (browsers require a user gesture), which
// also happens automatically on the first pointer/key press. Until then every call is a
// silent no-op, so the engine is safe in node and in tests. While muted no context is
// created, and an existing one is suspended, so no synthesis runs at all.
// Audio must never break gameplay: event handlers and voices swallow (and log once) errors.
//
// Music: a looping track plays until replaced; a cue (a song with finalBar) plays once and
// frees the music slot when it has faded out. Only looping tracks are queued until the
// context exists; a cue asked for without audio is dropped. A menu track stops when the
// game starts, and the game-over jingle plays over the GAME OVER card.

import { SONGS } from './songs.js';
import { compileSong } from './compile.js';
import { createMixer, LEVELS } from './mixer.js';
import { Sequencer } from './Sequencer.js';
import { SFX } from './sfx.js';
import { Ambience } from './ambience.js';
import { SPAWN, LAWN_BASE } from '../world/layout.js';
import { clamp } from '../core/math.js';
import { GAME_OVER_SECONDS } from '../core/constants.js';

const MUSIC_FADE = 1.2; // crossfade seconds
const YOUNG_TRACK = 1.5; // a track replaced before this age is cut quickly, not crossfaded
const QUICK_CUT = 0.12;
// The gesture that creates the context often also changes the track (the title's Start
// starts the game, on press or on click release, then fades out), so a track requested
// before then starts only this long after that press is released, giving the new scene's
// playMusic() the chance to replace it.
const FIRST_MUSIC_DELAY = 0.6;
const MAX_VOICES = 32; // concurrent one-shots; extra ones are dropped
const VOICE_TAIL = 0.5; // a one-shot's slot is held this long past its reported length
const PITCH_JITTER = 0.03; // +-3% random pitch per sound
const DEDUPE_SECONDS = 0.02; // the same sound requested twice at once plays once
const FULL_VOLUME_DIST = 1400; // positional sounds are full volume within this range
const SILENT_DIST = 9000;
const PAUSE_DUCK = 0.35;
const FANFARE_SECONDS = 2.8;
const GAME_OVER_AMB_DUCK = 0.3; // the frozen world's ambience drops back under the jingle

// Only a table's own entries count: names like 'toString' or '__proto__' are unknown.
const own = (table, name) => (typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : null);

const compiledSongs = new Map();
function compiled(name) {
  if (!compiledSongs.has(name)) compiledSongs.set(name, compileSong(SONGS[name]));
  return compiledSongs.get(name);
}

// Whether the page has had a user gesture (sticky activation), so creating or resuming an
// AudioContext is allowed. Assumed true where the browser does not report it.
const hasUserActivation = () => typeof navigator === 'undefined' || navigator.userActivation?.hasBeenActive !== false;

export class AudioEngine {
  constructor(events) {
    this.ctx = null;
    this.mix = null;
    this.ambience = null;
    this.failed = false; // context setup failed once; stay silent from then on
    this.warned = false;
    this.track = null; // { name, gain, seq, started }
    this.wantMusic = null; // latest requested track (also before the context exists)
    this.unlockPress = null; // key code or 'pointer' of the press that created the context, while held
    this.active = []; // sounding one-shots: { end (context time), node }
    this.lastPlayed = new Map();
    this.terrain = 'grass'; // last terrain seen in footstep/land events
    this.duck = { pause: 1, fanfare: 1, gameOver: 1 };
    this.fanfareTimer = 0;
    this.gameOverTimer = 0;
    this.suspendTimer = 0;
    this._muted = false;
    this.listener = { x: SPAWN.x, y: LAWN_BASE + 500, z: SPAWN.z + 1200, yaw: SPAWN.yaw };
    if (events) this.subscribe(events);
    if (typeof window !== 'undefined') this.installBrowserHooks();
  }

  get muted() {
    return this._muted;
  }

  set muted(v) {
    this._muted = !!v;
    clearTimeout(this.suspendTimer);
    if (!this.ctx) {
      if (!this._muted && hasUserActivation()) this.unlock();
      return;
    }
    this.mix.master.gain.setTargetAtTime(this._muted ? 0 : 1, this.ctx.currentTime, 0.02);
    // Suspend once the fade-out has finished; resume straight away.
    if (this._muted) this.suspendTimer = setTimeout(() => this.syncRunning(), 150);
    else this.syncRunning();
  }

  // Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly.
  // Resolves to true once audio is running (never rejects). Does nothing while muted.
  unlock() {
    if (this._muted || this.failed) return Promise.resolve(false);
    try {
      if (!this.ctx && !this.createContext()) return Promise.resolve(false);
      if (this.ctx.state === 'running') return Promise.resolve(true);
      return this.ctx.resume().then(
        () => this.ctx.state === 'running',
        () => false,
      );
    } catch (err) {
      this.warnOnce(err);
      return Promise.resolve(false);
    }
  }

  // Build the context, mixer and ambience; they are only kept if all of them succeed.
  createContext() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    let ctx = null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
      const mix = createMixer(ctx);
      mix.master.gain.value = 1;
      const ambience = new Ambience(ctx, mix.amb, {
        playAt: (recipe, pos) => this.voice(recipe, { pos }, mix.amb),
        spatial: (pos) => this.spatial(pos),
      });
      Object.assign(this, { ctx, mix, ambience });
    } catch (err) {
      this.failed = true;
      this.warnOnce(err);
      Promise.resolve()
        .then(() => ctx?.close())
        .catch(() => {});
      return false;
    }
    this.applyLevels();
    if (!this.unlockPress) this.startPendingMusic();
    return true;
  }

  // Play a named sound effect. opts: { pos, volume, pitch, terrain, big, index }.
  // Unknown names are ignored. Sounds without a terrain use the last one walked on.
  play(name, opts = {}) {
    const recipe = own(SFX, name);
    if (!recipe || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < DEDUPE_SECONDS) return;
    this.lastPlayed.set(name, now);
    this.voice(recipe, opts.terrain ? opts : { ...opts, terrain: this.terrain }, this.mix.sfx);
  }

  // A looping track requested before the context exists waits for it (see
  // startPendingMusic). A cue (a song with finalBar: the arrival cue, the game-over jingle)
  // belongs to the moment it is asked for, so without audio to play it now (no context yet,
  // e.g. after a gamepad-only start, or muted) it is dropped, not queued: it must not turn
  // up minutes later when the first key or click finally unlocks audio. Like any newer
  // request, it still replaces the track asked for before it.
  playMusic(name) {
    const song = own(SONGS, name);
    if (!song) return;
    if (song.finalBar && (!this.ctx || this._muted)) {
      this.stopMusic();
      return;
    }
    this.wantMusic = name;
    if (this.ctx && this.track?.name !== name) this.guard(() => this.startMusic(name));
  }

  stopMusic() {
    this.wantMusic = null;
    if (this.track) this.fadeOutTrack(this.track, 0.8);
    this.track = null;
  }

  // Camera position and look yaw, called every simulation tick.
  setListener(pos, yaw) {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.yaw = yaw;
  }

  update(dt) {
    if (this.ctx?.state !== 'running' || this._muted) return;
    this.guard(() => {
      this.releaseVoices();
      if (this.track && this.ctx.currentTime >= this.track.seq.endTime) this.endTrack();
      this.ambience.update(dt, this.listener);
    });
  }

  // ---------------------------------------------------------------- internals

  subscribe(events) {
    // Every handler is fenced off: an audio failure must never reach the emitter.
    const on = (name, fn) => events.on(name, (e = {}) => this.guard(() => fn(e)));
    const speedVolume = (speed = 20) => 0.55 + 0.45 * clamp(speed / 30, 0, 1);
    on('sfx', (e) => this.play(e.name, e));
    on('footstep', (e) => {
      if (e.terrain) this.terrain = e.terrain;
      this.play('footstep', { ...e, volume: speedVolume(e.speed) });
    });
    on('land', (e) => {
      if (e.terrain) this.terrain = e.terrain;
      this.play(e.hard ? 'land_hard' : 'land', e);
    });
    on('splash', (e) => this.play('splash', e));
    on('hurt', (e) => this.play('hurt', e));
    on('coin', (e) => this.play(e.red ? 'red_coin' : 'coin', e));
    on('redCoinsComplete', () => this.play('star_appear'));
    on('starCollected', () => this.starFanfare());
    on('oneUp', () => this.play('one_up'));
    on('lifeLost', () => this.play('life_lost'));
    on('pause', () => {
      this.play('pause');
      this.setDuck('pause', PAUSE_DUCK);
    });
    on('unpause', () => {
      this.play('unpause');
      this.setDuck('pause', 1);
    });
    // gameStart normally follows a click on the title screen; with ?skipTitle it does not,
    // and then the first key/pointer press unlocks instead (no autoplay warning).
    on('gameStart', () => {
      if (this.wantMusic && own(SONGS, this.wantMusic).menu) this.stopMusic();
      this.clearDucks(); // a new game is never paused, fanfaring or over
      if (hasUserActivation()) this.unlock();
    });
    // GAME OVER card: a short original jingle cuts in on the music slot (and through any
    // fanfare duck) while the ambience of the frozen world drops back; the title track then
    // crossfades in from the jingle's last chord, and the ambience returns.
    // Without a context (muted, or audio never unlocked) nothing is queued: the jingle is a
    // cue, which playMusic() drops rather than let it turn up later.
    on('gameOver', () => {
      this.clearDucks();
      this.playMusic('game_over');
      this.setDuck('gameOver', GAME_OVER_AMB_DUCK);
      this.gameOverTimer = setTimeout(() => this.setDuck('gameOver', 1), GAME_OVER_SECONDS * 1000);
    });
  }

  installBrowserHooks() {
    // First user gesture unlocks audio, even if nobody calls unlock() explicitly. The
    // hooks stay until audio actually runs (e.g. while muted no context is made yet).
    const types = ['pointerdown', 'keydown', 'touchend'];
    const pressId = (e) => (e.type.startsWith('key') ? e.code : 'pointer');
    const onGesture = (e) => {
      if (!this.ctx && e.type !== 'touchend') this.unlockPress = pressId(e);
      this.unlock().then((running) => {
        if (running) for (const type of types) window.removeEventListener(type, onGesture, true);
      });
    };
    for (const type of types) window.addEventListener(type, onGesture, true);
    const onRelease = (e) => {
      if (!this.unlockPress || (e.type !== 'blur' && pressId(e) !== this.unlockPress)) return;
      this.unlockPress = null;
      this.startPendingMusic();
    };
    for (const type of ['keyup', 'pointerup', 'pointercancel']) window.addEventListener(type, onRelease, true);
    window.addEventListener('blur', onRelease);
    // Background tabs throttle timers; suspend instead of letting the music stutter.
    document.addEventListener('visibilitychange', () => this.syncRunning());
  }

  // Run the context only while audible: not muted and the page visible.
  syncRunning() {
    if (!this.ctx) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    try {
      (this._muted || hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
    } catch (err) {
      this.warnOnce(err);
    }
  }

  // Run fn, logging (once) instead of throwing if it fails.
  guard(fn) {
    try {
      fn();
    } catch (err) {
      this.warnOnce(err);
    }
  }

  warnOnce(err) {
    if (this.warned) return;
    this.warned = true;
    console.warn('audio disabled after an error:', err);
  }

  // Stereo pan and distance attenuation of a world position for the current listener.
  spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.x;
    const dz = pos.z - L.z;
    const dist = Math.hypot(dx, pos.y - L.y, dz);
    const horiz = Math.hypot(dx, dz);
    const gain = clamp(1 - (dist - FULL_VOLUME_DIST) / (SILENT_DIST - FULL_VOLUME_DIST), 0, 1) ** 2;
    if (horiz < 1) return { gain, pan: 0 };
    // Listener's right vector for yaw (forward = (sin yaw, cos yaw)) is (-cos yaw, sin yaw).
    const side = (-dx * Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / horiz;
    return { gain, pan: side * 0.8 * clamp(horiz / 600, 0, 1) };
  }

  // Run a one-shot recipe through its own gain + panner into a bus.
  voice(recipe, opts, bus) {
    const ctx = this.ctx;
    if (ctx?.state !== 'running' || this._muted) return;
    this.releaseVoices();
    if (this.active.length >= MAX_VOICES) return;
    const { gain, pan } = this.spatial(opts.pos);
    const volume = (opts.volume ?? 1) * gain;
    if (volume < 0.01) return;
    const p = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    let panner = null;
    let dur = 1;
    try {
      const out = ctx.createGain();
      out.gain.value = volume;
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out.connect(panner).connect(bus);
      dur = recipe(ctx, out, ctx.currentTime + 0.005, { ...opts, p });
    } catch (err) {
      this.warnOnce(err);
    }
    if (panner) this.active.push({ end: ctx.currentTime + dur + VOICE_TAIL, node: panner });
  }

  // Free the slots (and graph) of finished one-shots. Timed on the audio clock, so it
  // stays right while the context is suspended or rendering faster than real time.
  releaseVoices() {
    const now = this.ctx.currentTime;
    let n = 0;
    for (const v of this.active) {
      if (v.end > now) this.active[n++] = v;
      else v.node.disconnect();
    }
    this.active.length = n;
  }

  // Start the track requested before the context existed, unless a newer scene has
  // started or replaced it by then (see FIRST_MUSIC_DELAY).
  startPendingMusic() {
    setTimeout(() => {
      if (this.ctx && !this.unlockPress && this.wantMusic && !this.track) this.guard(() => this.startMusic(this.wantMusic));
    }, FIRST_MUSIC_DELAY * 1000);
  }

  // Crossfade from the current track, or cut it quickly if it has only just started
  // (then the new track comes in at full level instead of overlapping a clashing key).
  // A jingle always cuts in: fading in would swallow half of it.
  startMusic(name) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const old = this.track;
    const song = compiled(name);
    const crossfade = !!old && !song.jingle && now - old.started >= YOUNG_TRACK;
    if (old) this.fadeOutTrack(old, crossfade ? MUSIC_FADE : QUICK_CUT);
    const gain = ctx.createGain();
    gain.connect(this.mix.music);
    gain.gain.setValueAtTime(crossfade ? 0 : song.level, now);
    if (crossfade) gain.gain.linearRampToValueAtTime(song.level, now + MUSIC_FADE);
    const seq = new Sequencer(ctx, song, gain);
    seq.start(now + (old && !crossfade ? QUICK_CUT : 0.06), { endBeat: song.endBeat });
    this.track = { name, gain, seq, started: now };
  }

  // A cue has faded out: free the music slot (a later playMusic() of it plays it again).
  endTrack() {
    this.track.seq.stop();
    this.track.gain.disconnect();
    this.track = null;
    this.wantMusic = null;
  }

  fadeOutTrack(track, seconds) {
    const now = this.ctx.currentTime;
    const g = track.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    setTimeout(() => {
      track.seq.stop();
      track.gain.disconnect();
    }, seconds * 1000 + 300);
  }

  // Music drops out for the fanfare, then comes back.
  starFanfare() {
    this.play('star_get');
    this.setDuck('fanfare', 0);
    clearTimeout(this.fanfareTimer);
    this.fanfareTimer = setTimeout(() => this.setDuck('fanfare', 1), FANFARE_SECONDS * 1000);
  }

  setDuck(key, value) {
    this.duck[key] = value;
    this.applyLevels();
  }

  // Back to resting levels, cancelling pending duck releases.
  clearDucks() {
    clearTimeout(this.fanfareTimer);
    clearTimeout(this.gameOverTimer);
    for (const key of Object.keys(this.duck)) this.duck[key] = 1;
    this.applyLevels();
  }

  applyLevels() {
    if (!this.mix) return;
    const t = this.ctx.currentTime;
    const { pause, fanfare, gameOver } = this.duck;
    this.mix.music.gain.setTargetAtTime(LEVELS.music * pause * fanfare, t, 0.12);
    this.mix.amb.gain.setTargetAtTime(LEVELS.amb * pause * gameOver, t, 0.12);
  }
}
