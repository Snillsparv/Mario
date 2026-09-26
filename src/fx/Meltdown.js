// AI RACE's doomsday clock: if the race is not stopped within 40 seconds the sky catches fire,
// a blinding light blooms over the horizon and the whole world burns white, then GAME OVER.
// An original cartoon apocalypse (no real-world imagery or text).
//
//   const meltdown = new Meltdown({ events, targets: { view, level, fx, audio, shake }, trees })
//   meltdown.update(camPos?, camYaw?) -> 'over' on the tick the white hold ends (once), else null
//                                  30 Hz, only while playing (paused time does not count)
//   meltdown.setMode(on)          AI RACE mode on / off (it listens to 'darkMode' itself)
//   meltdown.reset()              everything off at once (a new game after GAME OVER)
//   meltdown.skipTo(seconds)      tests: jump the race clock ahead (phases crossed fire on the
//                                  next update(), in order)
//   meltdown.levels               the current look (below), shared by every target
//   meltdown.phase / seconds / doomed / running
//
// Timeline (MELTDOWN, seconds since AI RACE mode turned on; the clock only runs while playing):
//   0     the race clock starts ('darkMode' { on: true }); phase 'race'
//   30    'warning': the AlertBanner warns, a klaxon repeats (sfx meltdown_klaxon), the storm
//         sky glows red-orange from the horizon, stronger and stronger toward 40 s
//   40    'fire', the point of no return: the sky dome turns to roiling flames, the fog and the
//         light grade go fiery orange, the rain turns into drifting embers and ash, lightning
//         stops, trees catch fire, a roaring fire and a deep rumble rise, the AI RACE button's
//         cap light dies (STOP does nothing any more). Only a game over ends it now.
//   46    'light': a blinding point of light blooms far off in the view (just right of where the
//         camera looks, over the horizon, so it rises beside or behind the castle from the
//         spawn), swells into a rising fireball over a pillar of light, and a shockwave wall
//         of glowing dust races out across the ground ('shock' as it passes the camera: a big
//         jolt); the picture brightens exponentially and bleaches toward white, with a heat
//         shimmer; the sound swells to a roar
//   53    'white': the whole picture is white; the roar collapses into a high, fading ring
//   54    'over': the white has held a second: update() returns 'over' and main runs the game's
//         GAME OVER (the card, then the title; lives reset as for any game over), whatever the
//         lives left. main's game-over reset calls reset().
// Before 40 s the mode turning off (STOP, Rustmaw's defeat, a game over) cancels the clock
// ('cancelled'; the warning glow fades out over CANCEL_FADE); turning AI RACE on again starts a
// fresh 40 s. From 40 s on setMode(false) is ignored (and main keeps the mode on).
//
// Events: 'meltdown' { phase, seconds } for 'warning', 'fire', 'light', 'shock', 'white', 'over'
// and 'cancelled'; 'sfx' meltdown_klaxon (every KLAXON_EVERY s from the warning until the
// light) and tree_ignite (a tree catching fire).
//
// Targets (each optional) get setMeltdown(levels) whenever the look changes (not while all of it
// stays 0): the renderer (fire grade, white-out, glare, shimmer, fog), the level (the sky's
// warning glow, flames and the light's bloom), the effects (embers, no lightning, the fireball,
// pillar and shockwave), the audio (roaring fire, rumble, the swell) and the camera shake
// (setRumble). The effects also get ignite() calls for the burning trees.

import { FRAME_DT } from '../core/constants.js';
import { makeRng } from '../core/math.js';

export const MELTDOWN = Object.freeze({
  WARN: 30, // s: the warning
  DOOM: 40, // s: the sky catches fire (the point of no return)
  LIGHT: 46, // s: the light blooms
  WHITE: 53, // s: all white
  HOLD: 1, // s the white holds before GAME OVER
  WARN_IN: 1, // s for the first glow of the warning to show
  WARN_START: 0.4, // the warning glow at once (it then grows to 1 by DOOM)
  FIRE_SPREAD: 1.6, // s for the flames to sweep up over the whole sky
  CANCEL_FADE: 1.5, // s for a cancelled warning's glow to fade out
  KLAXON_EVERY: 1.5, // s between klaxon blasts (warning and fire)
  WHITE_CURVE: 4.2, // exponential growth of the white-out over the light phase
  GLARE_IN: 0.4, // s for the point of light to flare up to full brightness
  FLASH_DECAY: 0.9, // s: its first blinding flash settles (time constant)...
  GLARE_REST: 0.35, // ...to this share of the glare while the fireball rises, then grows with the white
  // Where the light blooms, fixed when it appears: LIGHT_DIST away from the camera (well past
  // the grounds' perimeter), LIGHT_BEARING radians right of its look direction, rising from
  // ORB_ELEV[0] to ORB_ELEV[1] (elevation seen from the camera) as it swells from ORB_RADIUS[0]
  // to ORB_RADIUS[1].
  LIGHT_DIST: 19000,
  LIGHT_BEARING: 0.32,
  ORB_ELEV: [0.1, 0.34],
  ORB_RADIUS: [220, 2600],
  RING_DELAY: 0.35, // s after the light before the shockwave leaves its foot
  RING_SPEED: 5200, // units/s: from LIGHT_DIST it reaches the camera ~4 s after the light
  SHOCK_KICK: 2.6, // camera jolt when the shockwave passes the camera (CameraShake strength)
  LIGHT_KICK: 0.9, // camera jolt as the light blooms
  TREE_FIRE_EVERY: 0.45, // s between trees catching fire (fire and light phases)
  TREE_FIRES: 14, // at most this many trees burn
  TREE_REACH: 7000, // trees within this distance of the hero catch fire first
  TREE_FIRE_SECONDS: 90, // they burn until the game over clears them
});

// Phase order (each entered once per race, in order; skipTo() may cross several at once).
const PHASES = [
  ['warning', MELTDOWN.WARN],
  ['fire', MELTDOWN.DOOM],
  ['light', MELTDOWN.LIGHT],
  ['white', MELTDOWN.WHITE],
  ['over', MELTDOWN.WHITE + MELTDOWN.HOLD],
];
const PHASE_INDEX = { idle: -1, race: 0, warning: 1, fire: 2, light: 3, white: 4, over: 5 };
const ticksOf = (s) => Math.round(s / FRAME_DT);

const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (v) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};

// A fresh levels object (all off).
export function meltdownLevels() {
  return {
    seconds: 0, // on the race clock
    warn: 0, // the warning's red-orange horizon glow, 0..1 (1 from DOOM on)
    fire: 0, // the sky on fire, fiery fog and grade, 0..1
    light: 0, // progress of the light phase, 0..1 (LIGHT .. WHITE)
    white: 0, // the white-out, 0..1 (exponential over the light phase)
    glow: 0, // brightness of the fireball and its pillar, 0..1
    glare: 0, // the light's glare on screen and bloom in the sky: a flash, then with the white
    shimmer: 0, // heat shimmer, 0..1
    embers: 0, // the rain turned to embers and ash, 0..1
    rumble: 0, // continuous camera rumble, 0..1
    lit: false, // the light's place is known (the fields below are valid)
    gx: 0, // the ground point under the light (the shockwave's centre)
    gy: 0,
    gz: 0,
    lx: 0, // the fireball's centre and radius
    ly: 0,
    lz: 0,
    lr: 0,
    ring: 0, // the shockwave's radius (0: not out yet)
  };
}

// The time-only part of the look at `seconds` on the race clock, written into `out` (pure).
export function levelsAt(seconds, out = meltdownLevels()) {
  const M = MELTDOWN;
  const s = seconds;
  out.seconds = s;
  if (s < M.WARN) out.warn = 0;
  else if (s < M.DOOM) {
    const u = (s - M.WARN) / (M.DOOM - M.WARN);
    out.warn = Math.min(1, (s - M.WARN) / M.WARN_IN) * M.WARN_START + (1 - M.WARN_START) * u ** 1.6;
  } else out.warn = 1;
  out.fire = s < M.DOOM ? 0 : smooth((s - M.DOOM) / M.FIRE_SPREAD);
  out.light = s < M.LIGHT ? 0 : clamp01((s - M.LIGHT) / (M.WHITE - M.LIGHT));
  const k = M.WHITE_CURVE;
  out.white = out.light <= 0 ? 0 : out.light >= 1 ? 1 : (Math.exp(k * out.light) - 1) / (Math.exp(k) - 1);
  out.glow = s < M.LIGHT ? 0 : smooth((s - M.LIGHT) / M.GLARE_IN);
  const flash = s < M.LIGHT ? 0 : Math.exp(-(s - M.LIGHT) / M.FLASH_DECAY);
  out.glare = out.glow * (M.GLARE_REST + (1 - M.GLARE_REST) * Math.max(flash, out.white));
  out.shimmer = 0.3 * out.fire + 0.7 * out.light;
  out.embers = out.fire;
  out.rumble = 0.12 * out.fire + 0.55 * out.light * out.light;
  out.ring = s < M.LIGHT + M.RING_DELAY ? 0 : (s - M.LIGHT - M.RING_DELAY) * M.RING_SPEED;
  return out;
}

// Where the light blooms for a camera at (x, y, z) looking along yaw: { gx, gy, gz, y0 } (the
// ground point under it and the camera height it is measured from). Pure.
export function lightAnchor(x, y, z, yaw) {
  const b = yaw - MELTDOWN.LIGHT_BEARING; // (a smaller yaw turns right)
  const d = MELTDOWN.LIGHT_DIST;
  return { gx: x + Math.sin(b) * d, gy: 0, gz: z + Math.cos(b) * d, y0: y };
}

// The fireball for light progress `light` over an anchor: writes lx, ly, lz, lr into `out`.
export function placeOrb(light, anchor, out) {
  const M = MELTDOWN;
  const u = 1 - (1 - clamp01(light)) ** 2.2; // rises and swells fast, then slows
  const elev = M.ORB_ELEV[0] + (M.ORB_ELEV[1] - M.ORB_ELEV[0]) * u;
  out.lx = anchor.gx;
  out.lz = anchor.gz;
  out.ly = anchor.y0 + Math.tan(elev) * M.LIGHT_DIST;
  out.lr = M.ORB_RADIUS[0] + (M.ORB_RADIUS[1] - M.ORB_RADIUS[0]) * u;
  return out;
}

export class Meltdown {
  constructor({ events = null, targets = {}, trees = [], seed = 0x3e17d0 } = {}) {
    this.events = events;
    this.targets = targets;
    this.trees = trees;
    this.rng = makeRng(seed);
    this.levels = meltdownLevels();
    this._phase = 'idle';
    this.ticks = 0; // race clock
    this.entered = 0; // how many of PHASES have been entered this race
    this.anchor = null; // where the light blooms (set as it does)
    this.shocked = false; // the shockwave has passed the camera
    this.fading = 0; // a cancelled warning's glow, fading out
    this.shown = false; // the targets were last given a look that is not all 0
    this.klaxonAt = 0; // race tick of the next klaxon blast
    this.treeAt = 0; // race tick of the next tree fire
    this.burning = new Set(); // trees set alight this race
    this.firesLit = 0;
    events?.on?.('darkMode', (e) => this.setMode(!!e?.on));
  }

  get phase() {
    return this._phase;
  }

  get seconds() {
    return this.ticks * FRAME_DT;
  }

  // Past the point of no return (the sky is on fire): nothing but a game over ends it.
  get doomed() {
    return PHASE_INDEX[this._phase] >= PHASE_INDEX.fire;
  }

  // The race clock is counting.
  get running() {
    return this._phase !== 'idle' && this._phase !== 'over';
  }

  setMode(on) {
    if (on) {
      if (this._phase !== 'idle') return; // already racing (or doomed)
      this.start();
      return;
    }
    if (this._phase === 'idle' || this.doomed) return; // not racing, or too late to stop
    const warned = this._phase === 'warning';
    const seconds = this.seconds;
    this.fading = this.levels.warn;
    this._phase = 'idle';
    this.ticks = 0;
    this.events?.emit('meltdown', { phase: 'cancelled', seconds, warned });
  }

  start() {
    this._phase = 'race';
    this.ticks = 0;
    this.entered = 0;
    this.anchor = null;
    this.shocked = false;
    this.fading = 0;
    this.burning.clear();
    this.firesLit = 0;
    this.klaxonAt = ticksOf(MELTDOWN.WARN);
    this.treeAt = ticksOf(MELTDOWN.DOOM) + 8;
  }

  // Tests: jump the race clock to `seconds` (only while it runs). Phases crossed are entered on
  // the next update(), in order.
  skipTo(seconds) {
    if (!this.running) return false;
    const t = Math.max(this.ticks, ticksOf(seconds) - 1);
    this.ticks = t;
    this.klaxonAt = Math.max(this.klaxonAt, t);
    this.treeAt = Math.max(this.treeAt, t);
    return true;
  }

  // Everything off at once (update() does not run behind the title screen).
  reset() {
    this._phase = 'idle';
    this.ticks = 0;
    this.entered = 0;
    this.anchor = null;
    this.shocked = false;
    this.fading = 0;
    this.burning.clear();
    this.firesLit = 0;
    const L = this.levels;
    Object.assign(L, meltdownLevels());
    this.apply(true);
  }

  // One 30 Hz tick while playing. camPos: the rendered camera's position, camYaw its look yaw
  // (forward = (sin yaw, cos yaw)): the light blooms in view, the shockwave jolts it as it
  // passes. Returns 'over' on the tick the white hold ends (main then ends the game).
  update(camPos = null, camYaw = 0) {
    const L = this.levels;
    if (this._phase === 'over') return null;
    if (this._phase === 'idle') {
      if (this.fading > 0) {
        this.fading = Math.max(0, this.fading - FRAME_DT / MELTDOWN.CANCEL_FADE);
        L.warn = this.fading;
        this.apply(this.fading === 0);
      }
      return null;
    }
    this.ticks++;
    levelsAt(this.ticks * FRAME_DT, L);
    let result = null;
    while (this.entered < PHASES.length && this.ticks >= ticksOf(PHASES[this.entered][1])) {
      const [name] = PHASES[this.entered++];
      this._phase = name;
      if (name === 'light') this.bloom(camPos, camYaw);
      if (name === 'over') result = 'over';
      this.emit(name);
    }
    if (this.anchor) {
      L.lit = true;
      L.gx = this.anchor.gx;
      L.gy = this.anchor.gy;
      L.gz = this.anchor.gz;
      placeOrb(L.light, this.anchor, L);
      if (!this.shocked && camPos && L.ring > 0 && Math.hypot(camPos.x - L.gx, camPos.z - L.gz) <= L.ring) {
        this.shocked = true;
        this.targets.shake?.kick?.(MELTDOWN.SHOCK_KICK);
        this.emit('shock');
      }
    }
    this.klaxon();
    this.spreadFire(camPos);
    this.apply(false);
    return result;
  }

  // The light appears in view (see MELTDOWN.LIGHT_*): fix its place.
  bloom(camPos, camYaw) {
    const p = camPos ?? { x: 0, y: 500, z: 7000 };
    this.anchor = lightAnchor(p.x, p.y, p.z, camPos ? camYaw : Math.PI);
    this.targets.shake?.kick?.(MELTDOWN.LIGHT_KICK);
  }

  // The klaxon repeats from the warning until the light blooms.
  klaxon() {
    const i = PHASE_INDEX[this._phase];
    if (i < PHASE_INDEX.warning || i >= PHASE_INDEX.light) return;
    if (this.ticks < this.klaxonAt) return;
    this.klaxonAt = this.ticks + ticksOf(MELTDOWN.KLAXON_EVERY);
    this.events?.emit('sfx', { name: 'meltdown_klaxon' });
  }

  // Trees catch fire from the burning sky, one every TREE_FIRE_EVERY, the ones near the hero
  // (the camera) first.
  spreadFire(camPos) {
    const i = PHASE_INDEX[this._phase];
    if (i < PHASE_INDEX.fire || i >= PHASE_INDEX.white) return;
    if (this.ticks < this.treeAt || this.firesLit >= MELTDOWN.TREE_FIRES) return;
    this.treeAt = this.ticks + ticksOf(MELTDOWN.TREE_FIRE_EVERY);
    const fx = this.targets.fx;
    if (!fx?.ignite || !this.trees.length) return;
    const near = [];
    const far = [];
    for (const tree of this.trees) {
      if (this.burning.has(tree) || !tree.canopy) continue;
      const c = tree.canopy;
      const d = camPos ? Math.hypot(c.x - camPos.x, c.z - camPos.z) : 0;
      (d <= MELTDOWN.TREE_REACH ? near : far).push(tree);
    }
    const pool = near.length ? near : far;
    if (!pool.length) return;
    const tree = pool[Math.floor(this.rng() * pool.length) % pool.length];
    const c = tree.canopy;
    this.burning.add(tree);
    this.firesLit++;
    fx.ignite(c.x, c.y, c.z, { radius: c.radius * 0.95, duration: MELTDOWN.TREE_FIRE_SECONDS, intensity: 1 });
    this.events?.emit('sfx', { name: 'tree_ignite', pos: { x: c.x, y: c.y, z: c.z } });
  }

  // Hand the look to every target, unless it is and was all 0.
  apply(force) {
    const L = this.levels;
    const on = L.warn > 0 || L.fire > 0 || L.white > 0 || L.glow > 0 || L.light > 0;
    if (!on && !this.shown && !force) return;
    this.shown = on;
    if (!on) {
      L.lit = false;
      L.ring = 0;
    }
    const t = this.targets;
    t.view?.setMeltdown?.(L);
    t.level?.setMeltdown?.(L);
    t.fx?.setMeltdown?.(L);
    t.audio?.setMeltdown?.(L);
    t.shake?.setRumble?.(L.rumble);
  }

  emit(phase) {
    this.events?.emit('meltdown', { phase, seconds: this.seconds });
  }
}
