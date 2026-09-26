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
//
// AI RACE mode ('darkMode' { on }): over DARK_FADE seconds the birds and the pastoral bed
// fade out and the storm (rain, wind, drone; storm.js) fades in, the dark track takes the
// music slot, and an alarm stings once; switching off (or a game over) crossfades back.
// 'lightning' { strength } schedules thunder a moment later (sooner for a close strike).
//
// Winged hat ('wingHat' { on }): its flying theme takes the music slot while the hat is on
// ('fly', or 'fly_dark' in AI RACE mode, over the storm beds), fading in under the power-up
// fanfare; when the hat comes off the grounds get their own music back (the dark track in
// the storm, otherwise silence). Switching the storm on or off mid-flight swaps the two
// flying themes, and a hat grabbed again while its theme is still fading out brings that
// theme back rather than starting a second copy over it. Some stings (power-up, the locked
// castle's laugh, the minions' stinger) duck the music and ambience while they play
// (SFX_INFO duck). The first minion to surface in a storm ('minion_emerge') brings the
// minions' stinger, once per storm. The locked castle's laugh rings in one shared hall
// reverb, made ahead at idle time (see prepare).
//
// AI RACE's meltdown (fx/Meltdown.js): the klaxon comes as 'sfx' meltdown_klaxon. On
// 'meltdown' { phase: 'fire' } the sky catching fire whoomphs (meltdown_ignite), the storm's
// rain beds and the dark track fade out and the inferno (inferno.js: a roaring blaze, crackles,
// a deep rumble) rises with setMeltdown(levels) (called by the Meltdown each tick while its look
// changes); 'light' booms (meltdown_flash) and the roar swells with levels.light; 'shock' (the
// shockwave passing) blasts; 'white' collapses the roar into a high, fading ring (meltdown_ring).
// No music starts again until the meltdown ends (levels back to 0, or a new game).

import { SONGS } from './songs.js';
import { compileSong } from './compile.js';
import { createMixer, LEVELS } from './mixer.js';
import { Sequencer } from './Sequencer.js';
import { SFX, SFX_INFO, footstepLevel, landLevel, prepareSfx } from './sfx.js';
import { Ambience } from './ambience.js';
import { Storm } from './storm.js';
import { Inferno } from './inferno.js';
import { hallImpulse, smoothRamp } from './synth.js';
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
const JAB_CHAIN = 0.35; // a plain 'punch' this soon after a first jab is the combo's second jab
const FULL_VOLUME_DIST = 1400; // positional sounds are full volume within this range
const SILENT_DIST = 9000;
const PAUSE_DUCK = 0.35;
const FANFARE_SECONDS = 2.8;
const GAME_OVER_AMB_DUCK = 0.3; // the frozen world's ambience drops back under the jingle
const DARK_FADE = 3; // AI RACE mode crossfade, as long as the picture's
const MELT_RAIN_FADE = 2.5; // the meltdown: the rain beds fade as the sky catches fire...
const MELT_MUSIC_FADE = 3; // ...and the dark track with them
const FLY_TRACKS = new Set(['fly', 'fly_dark']); // the winged hat's themes (sunny, storm)
const FLY_OUT_FADE = 2.5; // the flying theme fading out as the hat comes off in sunny weather
const PREPARE_IDLE_MS = 3000; // each step of prepare() runs within this long of the one before
// Sounds that mark Pip leaving the ground: a landing's weight follows the air time since.
const TAKEOFFS = new Set(['jump', 'double_jump', 'triple_jump', 'backflip', 'sideflip', 'long_jump', 'wallkick', 'water_exit']);
const NO_INFO = {};

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
    this.storm = null;
    this.inferno = null; // the meltdown's blaze (inferno.js)
    this.melt = { fire: 0, light: 0, doom: false }; // the meltdown's levels; doom: past 40 s
    this.dark = false; // AI RACE mode (kept while there is no context, applied when one is made)
    this.flying = false; // the winged hat is on (its theme has the music slot)
    this.minionsHeard = false; // the minions' stinger has played in this storm
    this.groundedAt = -Infinity; // context time Pip was last known on the ground
    this.failed = false; // context setup failed once; stay silent from then on
    this.warned = false;
    this.track = null; // { name, gain, seq, started, fadeEnd, stopTimer }
    this.fading = []; // tracks fading out, until their sequencer stops (see startMusic)
    this.hall = null; // the castle hall's reverb, shared by every laugh (see hallReverb)
    this.wantMusic = null; // latest requested track (also before the context exists)
    this.unlockPress = null; // key code or 'pointer' of the press that created the context, while held
    this.active = []; // sounding one-shots: { end (context time), node }
    this.lastPlayed = new Map();
    this.jab = { name: null, at: -Infinity }; // last jab played for a plain 'punch'
    this.terrain = 'grass'; // last terrain seen in footstep/land events
    this.duck = { pause: 1, fanfare: 1, gameOver: 1, sting: 1, stingAmb: 1 };
    this.fanfareTimer = 0;
    this.gameOverTimer = 0;
    this.stingEnd = 0; // context time the current sting duck ends (0: none)
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
      this.attach(ctx, mix);
    } catch (err) {
      Object.assign(this, { ctx: null, mix: null, ambience: null, storm: null, inferno: null, hall: null });
      this.failed = true;
      this.warnOnce(err);
      Promise.resolve()
        .then(() => ctx?.close())
        .catch(() => {});
      return false;
    }
    if (!this.unlockPress) this.startPendingMusic();
    return true;
  }

  // Build the ambience and storm on a context and its mixer (also used by the offline
  // renders in the preview), in the current dark/sunny state.
  attach(ctx, mix) {
    const ambience = new Ambience(ctx, mix.amb, {
      playAt: (recipe, pos, volume) => this.voice(recipe, { pos, volume }, mix.amb),
      spatial: (pos) => this.spatial(pos),
    });
    const storm = new Storm(ctx, mix.amb);
    const inferno = new Inferno(ctx, mix.amb);
    Object.assign(this, { ctx, mix, ambience, storm, inferno, hall: null });
    if (this.dark) {
      ambience.setDark(true, 0);
      ambience.birds = 0;
      if (!this.melt.doom) storm.set(true, 1);
    }
    if (this.melt.fire > 0 || this.melt.light > 0) inferno.set(this.melt.fire, this.melt.light);
    this.applyLevels();
    this.prepare(ctx);
  }

  // Work done ahead, each step in an idle moment of its own after the context is made: the
  // castle hall's impulse, the convolver taking it (hallReverb), and the buffers and waves
  // the rarer sounds use (prepareSfx). Each takes several ms, too long for a frame mid-game
  // (the laugh starts on the frame the door's dialog opens). A sound that needs one of them
  // sooner makes it on the spot.
  prepare(ctx) {
    const steps = [() => hallImpulse(ctx), () => this.hallReverb(), () => prepareSfx(ctx)];
    const idle = (fn) =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: PREPARE_IDLE_MS }) : setTimeout(fn, PREPARE_IDLE_MS / 3);
    const next = () => {
      if (this.ctx !== ctx || ctx.state === 'closed' || !steps.length) return;
      this.guard(steps.shift());
      idle(next);
    };
    idle(next);
  }

  // The castle hall's reverb (SFX_INFO hall: the locked door's laugh): one convolver on the
  // sfx bus, shared by every laugh (made by prepare(), or by the first laugh if that comes
  // sooner). Null if it cannot be made (the laugh then brings its own).
  hallReverb() {
    if (!this.hall && this.ctx) {
      try {
        const hall = this.ctx.createConvolver();
        hall.buffer = hallImpulse(this.ctx);
        hall.connect(this.mix.sfx);
        this.hall = hall;
      } catch (err) {
        this.warnOnce(err);
      }
    }
    return this.hall;
  }

  // Play a named sound effect. opts: { pos, volume, pitch, terrain, big, index, ... }.
  // Unknown names are ignored. Sounds without a terrain use the last one walked on.
  // SFX_INFO may space a sound's plays out (gap), cap how many sound at once (max) and
  // let it carry farther (range). Returns whether it played.
  play(name, opts = {}) {
    let recipe = own(SFX, name);
    if (!recipe || !this.ctx) return false;
    const now = this.ctx.currentTime;
    const info = own(SFX_INFO, name) ?? NO_INFO;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < Math.max(DEDUPE_SECONDS, info.gap ?? 0)) return false;
    if (info.max && this.countActive(name) >= info.max) return false;
    if (name === 'punch') recipe = SFX[this.comboJab(now)];
    const o = { ...opts, terrain: opts.terrain || this.terrain, range: info.range ?? 1 };
    if (info.hall) o.hall = this.hallReverb();
    if (!this.voice(recipe, o, this.mix.sfx, name)) return false;
    this.lastPlayed.set(name, now);
    if (info.duck) this.sting(info.duck);
    return true;
  }

  // A sting that must be heard over the beds (SFX_INFO duck { music, amb, seconds }): the
  // music and ambience drop to its levels while it plays. Overlapping stings keep the
  // deeper duck until the last of them has ended. Released by update() on the audio clock,
  // like the voices (so a suspended context holds it).
  sting({ music = 1, amb = 1, seconds = 1 }) {
    const now = this.ctx.currentTime;
    const d = this.duck;
    const active = now < this.stingEnd;
    d.sting = Math.min(active ? d.sting : 1, music);
    d.stingAmb = Math.min(active ? d.stingAmb : 1, amb);
    this.stingEnd = Math.max(active ? this.stingEnd : 0, now + seconds);
    this.applyLevels();
  }

  endSting() {
    this.stingEnd = 0;
    this.duck.sting = 1;
    this.duck.stingAmb = 1;
    this.applyLevels();
  }

  // AI RACE mode on/off: the storm replaces the pastoral ambience and the dark track takes
  // the music slot, both over DARK_FADE (the picture's crossfade); an alarm stings as it
  // starts. Off fades the dark track out (nothing replaces it: the grounds have no music)
  // and the birds back in. In flight, the flying theme swaps to its other variant instead.
  setDark(on) {
    on = !!on;
    if (on === this.dark) return;
    this.dark = on;
    this.minionsHeard = false;
    if (on) {
      this.play('alarm');
      this.playMusic(this.flying ? 'fly_dark' : 'dark');
    } else if (this.wantMusic === 'dark') this.stopMusic(DARK_FADE);
    else if (this.wantMusic === 'fly_dark') this.playMusic('fly');
    this.ambience?.setDark(on, DARK_FADE);
    this.storm?.set(on, DARK_FADE);
  }

  // The winged hat on/off: its flying theme (the storm variant in AI RACE mode) takes the
  // music slot while it is on. Off gives the grounds their own music back, the dark track in
  // the storm, or fades to none, but only if a flying theme still has the slot (a game-over
  // jingle or the title that took over since stays).
  setFlying(on) {
    on = !!on;
    if (on === this.flying) return;
    this.flying = on;
    if (this.melt.doom) return; // the burning sky has the stage: no music
    if (on) this.playMusic(this.dark ? 'fly_dark' : 'fly');
    else if (FLY_TRACKS.has(this.wantMusic)) {
      if (this.dark) this.playMusic('dark');
      else this.stopMusic(FLY_OUT_FADE);
    }
  }

  // AI RACE's meltdown levels (fx/Meltdown.js, each tick while they change): the inferno's
  // level follows the fire, its swell the light. All 0 ends the meltdown (a new game).
  setMeltdown(levels) {
    const fire = levels?.fire > 0 ? Math.min(1, levels.fire) : 0;
    const light = levels?.light > 0 ? Math.min(1, levels.light) : 0;
    if (fire === this.melt.fire && light === this.melt.light) return; // (called every tick)
    this.melt.fire = fire;
    this.melt.light = light;
    if (!fire && !light) this.melt.doom = false;
    this.inferno?.set(fire, light);
  }

  // The meltdown's moments ('meltdown' { phase }).
  meltdownPhase(phase) {
    if (phase === 'fire') {
      this.melt.doom = true;
      this.play('meltdown_ignite');
      this.storm?.set(false, MELT_RAIN_FADE);
      if (this.wantMusic && !own(SONGS, this.wantMusic)?.finalBar) this.stopMusic(MELT_MUSIC_FADE);
    } else if (phase === 'light') this.play('meltdown_flash');
    else if (phase === 'shock') this.play('meltdown_blast');
    else if (phase === 'white') {
      this.inferno?.collapse();
      this.play('meltdown_ring');
    }
  }

  // The first minion to surface in a storm brings the minions' stinger (once per storm).
  minionsSurfaced() {
    if (!this.dark || this.minionsHeard) return;
    this.minionsHeard = true;
    this.play('minions_stinger');
  }

  // Thunder for a lightning flash of `strength` (0..1): a close, strong strike is heard
  // after ~0.3 s with a crack, a weak (far) one up to 2.5 s later as a low roll only.
  thunder(strength = 0.7) {
    if (!this.ctx) return;
    const s = clamp(Number.isFinite(strength) ? strength : 0.7, 0, 1);
    if (this.countActive('thunder') >= SFX_INFO.thunder.max) return;
    const delay = clamp(0.3 + (1 - s) * 1.7 + Math.random() * 0.5, 0.3, 2.5);
    const pan = (Math.random() * 2 - 1) * 0.4;
    this.voice(SFX.thunder, { strength: s, delay, pan, volume: 0.55 + 0.45 * s }, this.mix.amb, 'thunder');
  }

  // One-shots of this name still sounding.
  countActive(tag) {
    if (!this.ctx) return 0;
    this.releaseVoices();
    let n = 0;
    for (const v of this.active) if (v.tag === tag) n++;
    return n;
  }

  // The ground combo may send both of its jabs as a plain 'punch': one that closely follows
  // a first jab plays as the second jab ('punch2'), so each step of the combo sounds its own.
  comboJab(now) {
    const second = this.jab.name === 'punch1' && now - this.jab.at < JAB_CHAIN;
    this.jab = { name: second ? 'punch2' : 'punch1', at: now };
    return this.jab.name;
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

  stopMusic(fade = 0.8) {
    this.wantMusic = null;
    if (this.track) this.fadeOutTrack(this.track, fade);
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
      if (this.stingEnd && this.ctx.currentTime >= this.stingEnd) this.endSting();
      if (this.track && this.ctx.currentTime >= this.track.seq.endTime) this.endTrack();
      this.ambience.update(dt, this.listener);
      this.storm.update(dt);
      this.inferno.update(dt);
    });
  }

  // ---------------------------------------------------------------- internals

  subscribe(events) {
    // Every handler is fenced off: an audio failure must never reach the emitter.
    const on = (name, fn) => events.on(name, (e = {}) => this.guard(() => fn(e)));
    const now = () => this.ctx?.currentTime ?? 0;
    on('sfx', (e) => {
      if (TAKEOFFS.has(e.name)) this.groundedAt = now();
      this.play(e.name, e);
      if (e.name === 'minion_emerge') this.minionsSurfaced();
    });
    // Footsteps: tiptoe soft, walk clearly under a run (level and brightness by speed).
    on('footstep', (e) => {
      if (e.terrain) this.terrain = e.terrain;
      this.groundedAt = now();
      this.play('footstep', { ...e, ...footstepLevel(e.speed) });
    });
    // Landings weigh what the fall did: a hop or a step down lands softly (air time since
    // the last takeoff or step, or the event's `fall` height when given); hard ones in full.
    on('land', (e) => {
      if (e.terrain) this.terrain = e.terrain;
      const level = e.hard ? {} : landLevel(now() - this.groundedAt, e.fall);
      this.groundedAt = now();
      this.play(e.hard ? 'land_hard' : 'land', { ...e, ...level });
    });
    on('splash', (e) => this.play('splash', e));
    on('hurt', (e) => {
      this.play('hurt', e);
      if (e.fire) this.play('burn', e);
    });
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
      this.flying = false; // nor flying (Pip starts without the winged hat)
      if (FLY_TRACKS.has(this.wantMusic)) this.stopMusic();
      this.clearDucks(); // a new game is never paused, fanfaring or over
      this.setDark(false); // nor stormy (main resets it after a game over; this is a backstop)
      this.melt.doom = false; // nor burning
      this.melt.fire = this.melt.light = 0;
      this.inferno?.stop();
      if (hasUserActivation()) this.unlock();
    });
    // GAME OVER card: a short original jingle cuts in on the music slot (and through any
    // fanfare duck) while the ambience of the frozen world drops back; the title track then
    // crossfades in from the jingle's last chord, and the ambience returns.
    // Without a context (muted, or audio never unlocked) nothing is queued: the jingle is a
    // cue, which playMusic() drops rather than let it turn up later.
    // In AI RACE mode the jingle cuts the dark track; the storm plays on (ducked) under the
    // card over the frozen dark world and crossfades back to the sunny ambience after it.
    on('gameOver', () => {
      this.clearDucks();
      this.flying = false; // the jingle takes the slot from a flying theme too
      this.playMusic('game_over');
      this.setDuck('gameOver', GAME_OVER_AMB_DUCK);
      this.gameOverTimer = setTimeout(() => {
        this.setDuck('gameOver', 1);
        this.guard(() => this.setDark(false));
      }, GAME_OVER_SECONDS * 1000);
    });
    // AI RACE mode and its storm (emitted by main, objects and effects).
    on('darkMode', (e) => this.setDark(e.on));
    on('meltdown', (e) => this.meltdownPhase(e.phase));
    on('lightning', (e) => this.thunder(e.strength));
    on('kaijuRoar', (e) => this.play('kaiju_roar', e));
    on('aiRaceButton', (e) => this.play('button_press', e)); // deduped with an sfx of it
    // The winged hat (emitted by the player): its flying theme while it is on.
    on('wingHat', (e) => this.setFlying(e.on));
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

  // Stereo pan, distance attenuation and distance of a world position for the current
  // listener; `range` stretches the attenuation distances (huge sounds carry farther).
  spatial(pos, range = 1) {
    if (!pos) return { gain: 1, pan: 0, dist: 0 };
    const L = this.listener;
    const dx = pos.x - L.x;
    const dz = pos.z - L.z;
    const dist = Math.hypot(dx, pos.y - L.y, dz);
    const horiz = Math.hypot(dx, dz);
    const full = FULL_VOLUME_DIST * range;
    const gain = clamp(1 - (dist - full) / (SILENT_DIST * range - full), 0, 1) ** 2;
    if (horiz < 1) return { gain, pan: 0, dist };
    // Listener's right vector for yaw (forward = (sin yaw, cos yaw)) is (-cos yaw, sin yaw).
    const side = (-dx * Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / horiz;
    return { gain, pan: side * 0.8 * clamp(horiz / 600, 0, 1), dist };
  }

  // Run a one-shot recipe through its own gain + panner into a bus. opts: pos (and range),
  // volume, pitch, pan (overrides the position's), delay (seconds, on the audio clock), plus
  // whatever the recipe reads; the recipe also gets `dist` from the listener and `outGain`,
  // the gain of its output (volume x distance: for sends that bypass it, like the hall's).
  // `tag` names the voice for countActive(). Returns whether it played.
  voice(recipe, opts, bus, tag = null) {
    const ctx = this.ctx;
    if (ctx?.state !== 'running' || this._muted) return false;
    this.releaseVoices();
    if (this.active.length >= MAX_VOICES) return false;
    const { gain, pan, dist } = this.spatial(opts.pos, opts.range);
    const volume = (opts.volume ?? 1) * gain;
    if (volume < 0.01) return false;
    const p = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    const delay = Math.max(0, opts.delay ?? 0);
    let panner = null;
    let dur = 1;
    try {
      const out = ctx.createGain();
      out.gain.value = volume;
      panner = ctx.createStereoPanner();
      panner.pan.value = opts.pan ?? pan;
      out.connect(panner).connect(bus);
      dur = recipe(ctx, out, ctx.currentTime + 0.005 + delay, { ...opts, p, dist, outGain: volume });
    } catch (err) {
      this.warnOnce(err);
    }
    if (panner) this.active.push({ end: ctx.currentTime + delay + dur + VOICE_TAIL, node: panner, tag });
    return !!panner;
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
  // A loop asked for again while it is still fading out (the winged hat grabbed again just
  // after the last one ran out; the storm's dark track back after a short flight) comes back
  // up from where its fade has got to, in time, instead of a second copy starting over it.
  startMusic(name) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const old = this.track;
    const song = compiled(name);
    const crossfade = !!old && !song.jingle && now - old.started >= YOUNG_TRACK;
    // A song with its own fadeIn (the dark track) always fades in over it.
    const fadeIn = song.fadeIn || (crossfade ? MUSIC_FADE : 0);
    if (old) this.fadeOutTrack(old, crossfade ? Math.max(MUSIC_FADE, fadeIn) : QUICK_CUT);
    const back = song.endBeat === null ? this.fading.find((tr) => tr.name === name && now < tr.fadeEnd) : null;
    if (back) {
      this.unfade(back);
      const g = back.gain.gain;
      const left = clamp(1 - g.value / song.level, 0, 1); // the share of the level it has lost
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(song.level, now + Math.max(QUICK_CUT, (song.fadeIn || MUSIC_FADE) * left));
      this.track = back;
      return;
    }
    const gain = ctx.createGain();
    gain.connect(this.mix.music);
    gain.gain.value = 0;
    gain.gain.setValueAtTime(fadeIn ? 0 : song.level, now);
    // A song's own fade-in (the dark track, with the picture's 3 s crossfade) creeps in;
    // a plain crossfade stays linear.
    if (song.fadeIn) smoothRamp(gain.gain, now, song.level, fadeIn);
    else if (fadeIn) gain.gain.linearRampToValueAtTime(song.level, now + fadeIn);
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

  // Fade a track out and stop it once silent; until then startMusic() may bring it back.
  fadeOutTrack(track, seconds) {
    const now = this.ctx.currentTime;
    const g = track.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    this.unfade(track);
    this.fading.push(track);
    track.fadeEnd = now + seconds;
    track.stopTimer = setTimeout(() => {
      this.unfade(track);
      track.seq.stop();
      track.gain.disconnect();
    }, seconds * 1000 + 300);
  }

  // Take a track off the fading list, cancelling its stop.
  unfade(track) {
    clearTimeout(track.stopTimer);
    const i = this.fading.indexOf(track);
    if (i >= 0) this.fading.splice(i, 1);
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
    this.stingEnd = 0;
    for (const key of Object.keys(this.duck)) this.duck[key] = 1;
    this.applyLevels();
  }

  applyLevels() {
    if (!this.mix) return;
    const t = this.ctx.currentTime;
    const { pause, fanfare, gameOver, sting, stingAmb } = this.duck;
    this.mix.music.gain.setTargetAtTime(LEVELS.music * pause * fanfare * sting, t, 0.12);
    this.mix.amb.gain.setTargetAtTime(LEVELS.amb * pause * gameOver * stingAmb, t, 0.12);
  }
}
