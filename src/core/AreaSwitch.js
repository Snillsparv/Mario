// Moving Jonas between areas (world/areas.js): the castle grounds, the Great Hall inside the
// castle and Midsummer Skerries (the first course, through the ship in the bottle), each with a
// collision world, objects and a look of their own, all in the one scene (each area's root
// group shows only while he is in it; hidden ones cost no draw calls, and only the current area
// is updated and animated).
//
//   const areas = new AreaSwitch({ scene, view, events, input, player, cam, hud, dialog, defs,
//                                  grounds: { level, objects }, canWarp, onSwap })
//   areas.get(name) -> Area | null     // built on first use (world/area.js buildArea plus an
//                                      // ObjectManager of its own), then kept for the session
//   areas.enter(name, entryId?)        // switch at once, no wipe (GAME OVER, ?area=, tests);
//                                      // entryId defaults to the area's respawn entry
//   areas.request({ to, entry, kind, from }) -> accepted   // walk through a door: the
//                                      // 'warpRequest' event (objects/Door.js) calls it
//   areas.step(controller) -> controller   // 30 Hz in play, before Jonas's update: runs the
//                                      // transition and returns the controller Jonas and the
//                                      // camera use this tick (also outside one: a stick held
//                                      // through a door or the approach cut, below)
//   areas.wipe(alpha) -> { amount, kind, color }   // the screen wipe now (ui/ScreenWipe.js)
//   areas.leave(), areas.canLeave()    // the pause screen's way out of a course (def.leave),
//                                      // and whether it can be taken now (main offers it
//                                      // only then; a sign he is reading closes first)
//   areas.onStar(e)                    // 'starCollected': the current course's own star
//                                      // (def.starExit) takes him out once his dance is over
//   areas.resetCourses()               // GAME OVER: every area built so far gets its pickups
//                                      // and its star back (and takes the star off his count),
//                                      // and its course card shows again on the next entry
//   areas.update(time, camera)         // per render frame: the current area's animation
//   areas.busy, .name, .current, .objects (the current area's), .phase, .warp,
//   .buildMs ({ name: ms of its first build }), .carry (a stick held through a door, below),
//   .still (one held out of a course, below)
//
// Switching (_swap, the only place that points the game at another area), in this order: an
// open dialog closes; the old area hides and the new one shows (the grounds' sky dome only
// where def.sky); the renderer takes its look (setAtmosphere) and water; Jonas its world,
// respawn point and signs (player.setWorld), then stands at the entry (placeAt); the camera
// its world, snapping to the entry's camYaw (default: behind him); the area's objects forget
// his last tick and keep a door he arrives at quiet (objects.enter); the HUD names the course,
// and on a course's first entry in a game (def.card) shows its name as a title card; held
// input is flushed; then onSwap() (main: the arrival is no respawn) and 'areaChange'
// { from, to, entry, audio } (Area.audio: the area's def.audio in world coordinates and its
// water test; the audio's music, ambience and reverb follow it).
//
// Transitions run on the simulation clock inside play (no mode of their own; pause freezes
// them, START is ignored while busy):
//   close (CLOSE ticks; STAR_CLOSE for the star exit): the wipe closes; through a door Jonas
//         keeps pushing toward it (the stick scripted along the door's yaw + pi); a camera
//         still between him and that door (he backed into it) cuts to the room side behind him
//   hold  (HOLD ticks): the screen is covered; the first tick switches (building the area if
//         it is new, so the build hides behind the covered frame); the stick is neutral
//   open  (OPEN ticks): the wipe opens (an entry with a sound of its own plays it now: entry.sfx,
//         popping out of the bottle); with entry.walkIn he walks on along entry.yaw for that
//         many ticks (then a door shuts behind him: sfx 'door_close'), then the stick is his
// A request is refused while a transition runs, while canWarp() says no (main: not playing,
// AI RACE on or fading, the meltdown running) or a dialog is up, while Jonas dies, respawns,
// reads or sits in the cannon, and for an unknown area or entry. Dying (or a respawn) during
// close opens the wipe again from where it was, without switching; so does a warp no longer
// allowed by the time the screen is covered (AI RACE switched on during close: it stays on the
// grounds). The wipe is a black circle iris on Jonas; the star exit a gold-white fade.
//
// A stick held through a door keeps its way across the camera cut: the camera on the other
// side may face the other way (the porch: in front of him, looking at the door), where the
// same push would walk him straight back in. So from the switch on, for as long as the stick
// stays pushed the way it was (within CARRY_TURN), it is read against the old camera's yaw
// turned through the door (carryYaw); after the walk-in it walks him on the way he was going,
// A and the other buttons his own. Letting go, or turning it clearly, hands it back to the
// new camera.
//
// Out of a course (the star, the pause screen's leave: no door to walk through) a stick still
// held at the switch waits to be let go before it moves him: pushed on from the course, it
// would walk him straight back into the bottle he pops out of (whose mouth is armed: the
// arrival stands off its apron, so a fresh push toward it takes him back in at once).
//
// The approach cut: walking toward the camera into a door that leads somewhere (the inner
// door, right after arriving through it), the camera backs up to the wall the door is in and
// would have him walk into its lens with the door never in view. So once he is within
// APPROACH of the door's face, lined up with it and heading for it, with the camera between
// him and it, the camera cuts round to the room side behind him, looking at the door, and the
// stick he holds is carried across that cut the same way (so he walks on into the door, and
// out of it on the other side the way he was going).
//
// Allocation: the timeline allocates nothing per tick (one reused scripted controller, one
// reused carried (or stilled) one, one reused neutral one, one reused wipe state).

import { wrapAngle } from './math.js';
import { neutralController } from './input.js';
import { ObjectManager } from '../objects/ObjectManager.js';
import { DOOR } from '../objects/Door.js';
import { buildArea } from '../world/area.js';
import { groundsArea } from '../world/areas.js';

export const WARP = {
  CLOSE: 14, // ticks the wipe takes to close
  STAR_CLOSE: 18, // ...for the star exit's fade
  HOLD: 4, // ticks it stays covered (the switch is on the first)
  OPEN: 14, // ticks it takes to open again
  STAR_SWIM: 45, // the star exit waits this long for a swimmer (no dance in the water)...
  STAR_AFTER: 20, // ...and this long after the dance before the fade
  CARRY_TURN: 0.77, // a carried stick is let go once turned further than this cos (~40 deg)
  APPROACH: 800, // walking toward the camera into a door: cut round to the room side this far out
};

// Actions a warp never starts from (the door ignores most of them already).
const REFUSE = new Set(['death', 'spawn', 'reading', 'cannon']);
// ...and those the pause screen's way out is not offered in (dying, dropping in: the wipe's
// close would call it off; a sign he is reading is no bar, leave() closes it first).
const NO_LEAVE = new Set(['death', 'spawn', 'cannon']);
// Actions that call a transition off before its switch (a life lost).
const CANCEL = new Set(['death', 'spawn']);
const DANCE = new Set(['star_dance', 'star_fall']);
const IRIS_COLOR = '#000000';
const STAR_COLOR = '#fff4d0';

export class AreaSwitch {
  constructor({ scene, view, events, input, player, cam, hud, dialog, defs, grounds, canWarp = () => true, onSwap = () => {} }) {
    Object.assign(this, { scene, view, events, input, player, cam, hud, dialog, defs, canWarp, onSwap });
    this.grounds = groundsArea(grounds.level, grounds.objects);
    this.sky = this.grounds.sky; // the one sky dome (a grounds part), shown where def.sky
    this.built = { grounds: this.grounds };
    this.current = this.grounds;
    this.buildMs = {};
    this.carded = new Set(); // courses whose title card has shown this game
    // The transition: its request ({ to, entry, kind, from }), phase and ticks into it.
    this.warp = null;
    this.phase = null; // 'star' (waiting out the dance) | 'close' | 'hold' | 'open' | null
    this.t = 0;
    this.closeTicks = WARP.CLOSE;
    this.walk = 0; // walk-in ticks left (open)
    this.walkYaw = 0;
    this.danceOver = -1; // star exit: the tick the dance ended (-1: still dancing)
    this.swim = false;
    // A stick held through the switch: its direction then (unit), and the camera yaw it is read
    // against (the old camera's, turned through the door).
    this.carry = false;
    this.carryX = 0;
    this.carryY = 0;
    this.carryYaw = 0;
    this.still = false; // out of a course: a stick held through the switch, waiting to be let go
    this.arrival = null; // the entry the transition's switch put him at
    this.scripted = neutralController(); // the scripted stick, reused
    this.carried = neutralController(); // the carried or stilled stick (his buttons), reused
    this.neutral = neutralController();
    this.wipeState = { amount: 0, kind: 'iris', color: IRIS_COLOR };
    events.on('warpRequest', (w) => this.request(w));
    events.on('starCollected', (e) => this.onStar(e));
  }

  get busy() {
    return this.phase !== null;
  }

  get name() {
    return this.current.name;
  }

  get objects() {
    return this.current.objects;
  }

  // The area, built (with its objects) the first time it is asked for; null if unknown.
  get(name) {
    const have = this.built[name];
    if (have) return have;
    const def = this.defs[name];
    if (!def?.builders) return null;
    const t0 = performance.now();
    const area = buildArea(this.scene, def);
    area.objects = new ObjectManager({ scene: this.scene, collision: area.collision, events: this.events, layout: area.objectsLayout, player: this.player, fx: null, level: null, area: name });
    area.setVisible(false);
    // Compile its shaders ahead of the first frame it shows.
    this.view.prewarm?.(area.root);
    this.view.prewarm?.(area.objects.group);
    this.buildMs[name] = performance.now() - t0;
    this.built[name] = area;
    return area;
  }

  // Switch at once, cancelling any transition (the wipe opens straight away).
  enter(name, entryId) {
    this._stop();
    this.carry = false;
    this.still = false;
    const id = entryId ?? (name === 'grounds' ? 'start' : this.defs[name]?.respawn?.entry);
    return this._swap(name, id);
  }

  request({ to, entry, kind = 'door', from = null } = {}) {
    if (this.phase !== null || !this._free() || REFUSE.has(this.player.action)) return false;
    if (!this._hasEntry(to, entry)) return false;
    this.warp = { to, entry, kind, from };
    if (!from) this.carry = false; // (through a door, the switch reads a stick carried up to it)
    this._close(WARP.CLOSE, 'iris', IRIS_COLOR);
    if (from) this._doorShot(from);
    return true;
  }

  // The pause screen's way out of a course (def.leave), open while nothing is under way, play
  // allows a warp and Jonas is not dying, dropping in or in the cannon. A sign he is reading
  // is no bar: leave() closes it first (its 'dialogClosed' ends the read, main).
  canLeave() {
    return this.phase === null && !!this.current.def.leave && this.canWarp() && !NO_LEAVE.has(this.player.action);
  }

  leave() {
    if (!this.canLeave()) return false;
    const l = this.current.def.leave;
    if (this.dialog?.isOpen) this.dialog.close();
    return this.request({ to: l.to, entry: l.entry, kind: 'leave' });
  }

  // Only the current area's own star (not Rustmaw's) ends a course with a star exit.
  onStar(e) {
    const exit = this.current.def.starExit;
    if (!exit || e?.boss || e?.area !== this.current.name || this.phase !== null || !this._hasEntry(exit.to, exit.entry)) return false;
    this.warp = { to: exit.to, entry: exit.entry, kind: 'star', from: null };
    this.phase = 'star';
    this.t = 0;
    this.danceOver = -1;
    this.swim = !!this.player.inWater;
    return true;
  }

  step(controller) {
    if (this.carry) this._keepCarry(controller);
    if (this.still && controller.stickMag === 0) this.still = false;
    if (this.phase === null) {
      if (!this.carry) this._approach(controller);
      return this._his(controller);
    }
    const p = this.player;
    const w = this.warp;
    this.t++;
    switch (this.phase) {
      case 'star':
        if (CANCEL.has(p.action)) this._stop();
        else {
          if (this.danceOver < 0 && (this.swim ? this.t >= WARP.STAR_SWIM : !DANCE.has(p.action))) this.danceOver = this.t;
          if (this.danceOver >= 0 && this.t - this.danceOver >= WARP.STAR_AFTER && this._free()) this._close(WARP.STAR_CLOSE, 'fade', STAR_COLOR);
        }
        return controller;
      case 'close':
        if (CANCEL.has(p.action)) {
          // Open again from where the wipe got to, without switching.
          const t = Math.round(WARP.OPEN * (1 - (this.t - 1) / this.closeTicks));
          this._open(0, t);
          return controller;
        }
        if (this.t >= this.closeTicks) this._next('hold');
        return w.from ? this._toward(w.from.yaw + Math.PI) : this.neutral;
      case 'hold':
        if (this.t === 1) {
          // Still allowed now the screen is covered? (AI RACE may have come on during close.)
          if (!this._free()) {
            this._open(0, 0);
            return this.neutral;
          }
          // The stick's frame before the cut (a stick carried across the approach cut: the
          // frame it was carried in).
          const camYaw = this.carry ? this.carryYaw : this.cam.getYaw();
          this.arrival = null;
          if (this._swap(w.to, w.entry)) {
            const entry = (this.arrival = this.current.entries[w.entry]);
            this.walk = entry.walkIn > 0 ? entry.walkIn : 0;
            this.walkYaw = entry.yaw ?? 0;
            // Through a door, 'into the door' (its yaw + pi) comes out along the entry's yaw;
            // out of a course, a stick still held waits to be let go.
            if (w.from) this._startCarry(controller, camYaw + this.walkYaw - w.from.yaw - Math.PI);
            else this.still = controller.stickMag > 0;
          }
        }
        if (this.t >= WARP.HOLD) {
          this._open(this.walk, 0);
          // His arrival's own sound (out of the bottle), now the listener has followed him there.
          const e = this.arrival;
          if (e?.sfx) this.events.emit('sfx', { name: e.sfx, pos: { x: e.x, y: e.y, z: e.z } });
        }
        return this.neutral;
      default: // 'open'
        if (this.t >= WARP.OPEN) this._stop();
        if (this.walk > 0) {
          this.walk--;
          if (this.walk === 0 && w.kind === 'door') this.events.emit('sfx', { name: 'door_close' });
          return this._toward(this.walkYaw);
        }
        return this._his(controller);
    }
  }

  // The wipe for a frame `alpha` of the way into the next tick.
  wipe(alpha = 1) {
    const s = this.wipeState;
    const k = this.t - 1 + alpha;
    let a = 0;
    if (this.phase === 'close') a = k / this.closeTicks;
    else if (this.phase === 'hold') a = 1;
    else if (this.phase === 'open') a = 1 - k / WARP.OPEN;
    s.amount = a > 1 ? 1 : a > 0 ? a : 0;
    return s;
  }

  resetCourses() {
    for (const name of Object.keys(this.built)) {
      const area = this.built[name];
      if (area === this.grounds) continue;
      area.reset();
      area.objects.reset();
    }
    this.carded.clear();
  }

  update(time, camera) {
    const a = this.current;
    a.update(time, camera);
    if (a !== this.grounds && a.def.sky) this.sky?.update(time, camera); // (the grounds update it themselves)
  }

  // Play allows a warp (canWarp) and no dialog is up.
  _free() {
    return !this.dialog?.isOpen && this.canWarp();
  }

  _hasEntry(name, id) {
    const area = this.built[name];
    if (area) return !!area.entries[id];
    return !!this.defs[name]?.builders && !!this.defs[name].entries?.[id];
  }

  _close(ticks, kind, color) {
    this.phase = 'close';
    this.t = 0;
    this.closeTicks = ticks;
    this.wipeState.kind = kind;
    this.wipeState.color = color;
  }

  _next(phase) {
    this.phase = phase;
    this.t = 0;
  }

  _open(walk, t) {
    this.phase = 'open';
    this.t = t;
    this.walk = walk;
  }

  _stop() {
    this.phase = null;
    this.warp = null;
    this.t = 0;
    this.walk = 0;
  }

  // The scripted stick: full push toward world yaw `yaw` (the inverse of stickToWorldYaw for
  // the camera's current yaw).
  _toward(yaw) {
    const c = this.scripted;
    const a = wrapAngle(this.cam.getYaw() - yaw);
    c.stickX = Math.sin(a);
    c.stickY = Math.cos(a);
    c.stickMag = 1;
    c.rawStickMag = 1;
    return c;
  }

  // A door walked into with the camera between Jonas and it (he came toward the camera, the
  // door behind it, the camera pressed to the wall over him): cut to the room side, behind him
  // looking at the door, so the wipe closes on him at the door rather than on his cap. (Free:
  // the stick is scripted along the door's yaw while it closes.)
  _doorShot(door) {
    const p = this.player.pos;
    const c = this.cam.pos;
    // How far in front of the door's face each stands.
    const hero = (p.x - door.x) * door.sin + (p.z - door.z) * door.cos;
    const cam = (c.x - door.x) * door.sin + (c.z - door.z) * door.cos;
    if (cam < hero) this.cam.reset(this.player, { yaw: door.yaw });
  }

  // Walking toward the camera into a door that leads somewhere (the door behind the camera,
  // which presses to the wall over him and has him walk into its lens): once he is within
  // APPROACH of its face, lined up with it, on its floor and heading for it, cut round to the
  // room side behind him, looking at the door, and carry the stick he holds across the cut, so
  // he walks on into the door with it in view. (Per tick while nothing runs: a few products
  // per door, no allocation.)
  _approach(controller) {
    const doors = this.current.objects?.doors;
    const p = this.player;
    if (!doors || !p.grounded || p.forwardVel <= 0 || REFUSE.has(p.action)) return;
    const fx = Math.sin(p.faceYaw);
    const fz = Math.cos(p.faceYaw);
    const c = this.cam.pos;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.to === null || !d.armed) continue;
      const dx = p.pos.x - d.x;
      const dz = p.pos.z - d.z;
      const front = dx * d.sin + dz * d.cos; // in front of its face
      const side = dx * d.cos - dz * d.sin; // along it
      if (front <= 0 || front > WARP.APPROACH || side > d.halfWidth || -side > d.halfWidth) continue;
      if (p.pos.y - d.floorY > DOOR.ABOVE || d.floorY - p.pos.y > DOOR.BELOW) continue;
      if (-(fx * d.sin + fz * d.cos) < DOOR.FACING) continue; // not heading for it
      if ((c.x - d.x) * d.sin + (c.z - d.z) * d.cos >= front) continue; // the camera is behind him
      const yaw = this.cam.getYaw();
      this.cam.reset(p, { yaw: d.yaw });
      this._startCarry(controller, yaw);
      return;
    }
  }

  // The stick held at the switch (if any) is carried, read against camera yaw `yaw`.
  _startCarry(controller, yaw) {
    const m = controller.stickMag;
    this.carry = m > 0;
    if (!this.carry) return;
    this.carryX = controller.stickX / m;
    this.carryY = controller.stickY / m;
    this.carryYaw = yaw;
  }

  // The carry ends once the stick is let go or turned away (or Jonas loses a life).
  _keepCarry(c) {
    const m = c.stickMag;
    if (m === 0 || CANCEL.has(this.player.action) || c.stickX * this.carryX + c.stickY * this.carryY < WARP.CARRY_TURN * m) this.carry = false;
  }

  // His own controller as Jonas gets it: a carried stick turned, a still one held at rest (the
  // buttons his either way).
  _his(controller) {
    if (this.carry) return this._carried(controller);
    if (!this.still) return controller;
    const c = Object.assign(this.carried, controller);
    c.stickX = c.stickY = c.stickMag = c.rawStickMag = 0;
    return c;
  }

  // His controller with the stick turned from carryYaw's frame into the camera's: the world
  // direction it pushes is the one it pushed before the cut.
  _carried(controller) {
    const c = Object.assign(this.carried, controller);
    const d = this.cam.getYaw() - this.carryYaw;
    const cos = Math.cos(d);
    const sin = Math.sin(d);
    c.stickX = controller.stickX * cos + controller.stickY * sin;
    c.stickY = controller.stickY * cos - controller.stickX * sin;
    return c;
  }

  _swap(name, entryId) {
    const to = this.get(name);
    const entry = to?.entries[entryId];
    if (!entry) return false;
    const from = this.current;
    const { player, cam } = this;
    if (this.dialog?.isOpen) this.dialog.close();
    from.setVisible(false);
    to.setVisible(true);
    if (this.sky?.object3D) this.sky.object3D.visible = !!to.def.sky;
    this.view.setAtmosphere(to.def.atmosphere ?? null);
    this.view.setWaterLevelFn(to.waterFn);
    player.setWorld({ collision: to.collision, spawn: to.respawn, signs: to.signs, groundAt: to.groundAt });
    player.placeAt(entry);
    cam.setCollision(to.collision);
    cam.reset(player, { yaw: entry.camYaw });
    to.objects.enter(player);
    this.hud?.setCourse?.(to.name);
    if (to.def.card && !this.carded.has(to.name)) {
      this.carded.add(to.name);
      this.hud?.showCourse?.(to.name);
    }
    this.input?.flush();
    this.current = to;
    this.onSwap();
    this.events.emit('areaChange', { from: from.name, to: to.name, entry: entryId, audio: to.audio });
    return true;
  }
}
