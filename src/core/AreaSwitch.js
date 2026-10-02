// Moving Jonas between areas (world/areas.js): the castle grounds, the Great Hall inside the
// castle, Midsummer Skerries (the first course, through the ship in the bottle) and Sparrow Lane
// (the second, through the hall's east door with the little house on it), each with a
// collision world, objects and a look of their own, all in the one scene (each area's root
// group shows only while he is in it; hidden ones cost no draw calls, and only the current area
// is updated and animated).
//
//   const areas = new AreaSwitch({ scene, view, events, input, player, cam, hud, dialog, defs,
//                                  grounds: { level, objects }, canWarp, onSwap, real })
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
//                                      // lights its lamps (below) and (def.starExit) takes
//                                      // him out once his dance is over
//   areas.resetCourses()               // GAME OVER: every area built so far gets its pickups
//                                      // and its star back (and takes the star off his count),
//                                      // its lamps go out, and its course card shows again on
//                                      // the next entry
//   areas.update(time, camera, alpha)  // per render frame: the current area's animation, and
//                                      // the door leaves swinging (alpha: the frame's way into
//                                      // the next tick)
//   areas.heroScale(alpha) -> scale    // per render frame: Jonas's size (main scales his model
//                                      // by it): 1, but for the dive into the bottle (below)
//   areas.heroOffset(alpha) -> { x, z }   // per render frame: how far his model is drawn off
//                                      // where he stands (main moves it by that): nothing, but
//                                      // for his step into a door's opening (below); reused
//   areas.setClassic(on)               // the "Classic street" choice (G, this session): an
//                                      // area with a realistic look drawn classic, or back
//   areas.busy, .name, .current, .objects (the current area's), .phase, .warp,
//   .buildMs ({ name: ms of its first build }), .carry (a stick held through a door, below),
//   .still (one held out of a course, below), .won (the courses whose star he has won)
//
// Realistic looks (`real`: render/real/RealAreas.js, absent in the node tests): an area whose def
// has one (def.real: Sparrow Lane) starts its realistic build as it is built (get), in the
// background; once ready the area holds it (Area.setReal) and, while it is the current area and
// realistic looks are wanted, shows it and the renderer draws through its look (_look:
// view.setLook; the grounds' sky dome hides for the look's own sky; else view.setLookNote says
// why not: 'building', 'chosen' or what failed). A failed build leaves it classic.
//
// Switching (_swap, the only place that points the game at another area), in this order: an
// open dialog closes; the old area hides and the new one shows; the renderer drops any
// realistic look (restoring itself) and takes the new area's look (setAtmosphere, then _look:
// its realistic one if ready, and the grounds' sky dome where def.sky) and water; Jonas its world,
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
//         many ticks, then the stick is his
// Through a door (kind 'door') its leaves swing (Area.setDoorOpen(t, doorId): the castle's front
// door on the grounds, its inside or the east door to the lane in the hall, the dad's front door
// in the lane; the id is the door's he walks into, warp.from.id, until the switch, then the one
// his entry names, entry.door): the door he walks into opens as the wipe closes (and shuts again
// with the wipe if the warp is called off), and once its leaves have swung aside
// he steps on into its opening (heroOffset: WARP.STEP, his model only, the door's collider
// stays solid; back out with a warp called off). At the switch that door is shut (its area
// hidden) and the one he comes out of stands open; it stays open while the iris is still small
// on him (SHUT_FROM ticks into the open), then shuts behind him in view, the leaves meeting on
// the open's last tick but one as 'door_close' plays. Into the bottle (kind 'bottle') Jonas
// shrinks to WARP.SHRINK of his size as the wipe closes on him (heroScale), full size again at
// the switch. All of it is worked out per tick and drawn between ticks (the frame's alpha).
//
// Lamps: a course's own star, once won, lights its lamp (Area.setLit: the lighthouse) and that
// of every area whose def.lamp names the course (the lighthouse in the hall's bottle), at once
// and for the rest of the game: an area built later comes lit. resetCourses() puts them out.
//
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
// reused carried (or stilled) one, one reused neutral one, one reused wipe state), nor do the
// per-frame update, heroScale and heroOffset (one reused offset).

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
  SHRINK: 0.35, // Jonas's size by the time the wipe has closed on him diving into the bottle
  STEP: 120, // walking into a door, he steps this far on into its opening as the wipe closes...
  STEP_AT: 0.4, // ...from this far into the close (its leaves swung aside by then) to its end
  SHUT_FROM: 4, // ticks into the open the door he comes out of stands open, then it shuts
};
// The open's tick the leaves of the door he comes out of meet on, as 'door_close' plays (the
// last but one: the transition is over on the last).
const SHUT_AT = WARP.OPEN - 1;

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
  constructor({ scene, view, events, input, player, cam, hud, dialog, defs, grounds, canWarp = () => true, onSwap = () => {}, real = null }) {
    Object.assign(this, { scene, view, events, input, player, cam, hud, dialog, defs, canWarp, onSwap, real });
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
    // The door leaves swinging (a door's warp): the area whose door they are, the door's id (an
    // area may have more than one: Area.setDoorOpen swings the one named), and how far open they
    // stand after this tick and after the one before (frames are drawn between the two).
    this.leafArea = null;
    this.leafDoor = null;
    this.leaf = 0;
    this.leafWas = 0;
    this.offset = { x: 0, z: 0 }; // heroOffset's, reused
    this.won = new Set(); // courses whose own star he has won this game (their lamps lit)
    this.realBuilding = new Set(); // areas whose realistic build is under way
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
    this._light(area);
    if (this.real?.wanted && def.real) this._buildReal(area);
    return area;
  }

  setClassic(on) {
    if (!this.real) return;
    this.real.setClassic(on);
    const area = this.current;
    if (!on && area.def.real && !area.real && !this.realBuilding.has(area)) this._buildReal(area);
    this._look(area);
  }

  // An area's realistic build, in the background: once ready the area holds it, and shows it at
  // once if it is the current one.
  _buildReal(area) {
    this.realBuilding.add(area);
    this.real.build(area).then(
      ({ part, look }) => {
        this.realBuilding.delete(area);
        area.setReal(part, look);
        if (this.current === area) this._look(area);
      },
      () => {
        this.realBuilding.delete(area); // (RealAreas says why; the area stays classic)
        if (this.current === area) this._look(area);
      },
    );
  }

  // The area's look: its realistic one where ready and wanted (its realistic part shown), else
  // classic; the grounds' sky dome where def.sky and no realistic sky draws.
  _look(area) {
    const look = this.real?.wanted && area.look ? area.look : null;
    area.showReal?.(look !== null);
    if (this.sky?.object3D) this.sky.object3D.visible = !!area.def.sky && look === null;
    this.view.setLook?.(look);
    // (The F1 line: why an area with a realistic look draws classic.)
    this.view.setLookNote?.(this.real && area.def.real && !look ? this.real.reason || 'building' : '');
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

  // Only the current area's own star (not Rustmaw's) lights its lamps and ends a course with a
  // star exit.
  onStar(e) {
    if (e?.boss || e?.area !== this.current.name) return false;
    if (!this.won.has(e.area)) {
      this.won.add(e.area);
      for (const name of Object.keys(this.built)) this._light(this.built[name]);
    }
    const exit = this.current.def.starExit;
    if (!exit || this.phase !== null || !this._hasEntry(exit.to, exit.entry)) return false;
    this.warp = { to: exit.to, entry: exit.entry, kind: 'star', from: null };
    this.phase = 'star';
    this.t = 0;
    this.danceOver = -1;
    this.swim = !!this.player.inWater;
    return true;
  }

  step(controller) {
    const c = this._step(controller);
    this._swing();
    return c;
  }

  _step(controller) {
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
        // The door he came out of shuts behind him (_swing).
        if (this.t === SHUT_AT && w.kind === 'door' && this.arrival !== null) this.events.emit('sfx', { name: 'door_close' });
        if (this.t >= WARP.OPEN) this._stop();
        if (this.walk > 0) {
          this.walk--;
          return this._toward(this.walkYaw);
        }
        return this._his(controller);
    }
  }

  // The wipe for a frame `alpha` of the way into the next tick.
  wipe(alpha = 1) {
    const s = this.wipeState;
    s.amount = this._amount(alpha);
    return s;
  }

  // Jonas's size for a frame `alpha` of the way into the next tick: diving into the bottle he
  // shrinks to SHRINK as the wipe closes (eased), and grows back with it if the dive is called
  // off; from the switch on he is his full size.
  heroScale(alpha = 1) {
    const w = this.warp;
    if (w === null || w.kind !== 'bottle' || this.arrival !== null) return 1;
    const k = this._amount(alpha);
    return 1 - (1 - WARP.SHRINK) * k * k * (3 - 2 * k);
  }

  // Where Jonas's model is drawn, a frame `alpha` of the way into the next tick, off where he
  // stands: walking into a door, once its leaves have swung aside (STEP_AT of the close), he
  // steps on into its opening as the wipe closes on him (STEP, eased; the door stays solid, so
  // only his model goes), and back out with the wipe if the warp is called off; from the switch
  // on, nothing. { x, z } (reused).
  heroOffset(alpha = 1) {
    const o = this.offset;
    o.x = o.z = 0;
    const w = this.warp;
    if (w === null || w.kind !== 'door' || !w.from || this.arrival !== null) return o;
    const k = (this._amount(alpha) - WARP.STEP_AT) / (1 - WARP.STEP_AT);
    if (k <= 0) return o;
    const d = k < 1 ? WARP.STEP * k * k * (3 - 2 * k) : WARP.STEP;
    // Into the door: against its face's outward direction.
    o.x = -w.from.sin * d;
    o.z = -w.from.cos * d;
    return o;
  }

  resetCourses() {
    this.won.clear();
    for (const name of Object.keys(this.built)) {
      const area = this.built[name];
      if (area === this.grounds) continue;
      area.reset();
      area.objects.reset();
      this._light(area);
    }
    this.carded.clear();
  }

  update(time, camera, alpha = 1) {
    const a = this.current;
    a.update(time, camera);
    if (a !== this.grounds && a.def.sky) this.sky?.update(time, camera); // (the grounds update it themselves)
    const leaves = this.leafArea;
    if (leaves !== null) leaves.setDoorOpen?.(this.leafWas + (this.leaf - this.leafWas) * alpha, this.leafDoor);
  }

  // How far the wipe covers the screen a frame `alpha` of the way into the next tick.
  _amount(alpha) {
    const k = this.t - 1 + alpha;
    let a = 0;
    if (this.phase === 'close') a = k / this.closeTicks;
    else if (this.phase === 'hold') a = 1;
    else if (this.phase === 'open') a = 1 - k / WARP.OPEN;
    return a > 1 ? 1 : a > 0 ? a : 0;
  }

  // The door leaves after this tick (see the header): open with the wipe closing through a
  // door, shut with it if the warp was called off; standing open at the switch in the area he
  // arrives in, and SHUT_FROM ticks into the open shutting behind him, to meet on SHUT_AT (as
  // 'door_close' plays). Which door: the one he walks into (its id, warp.from.id) until the
  // switch, then the one his entry names (entry.door), so an area with more than one swinging
  // door swings the right one.
  _swing() {
    const w = this.warp;
    let area = null;
    let door = null;
    let open = 0;
    if (w !== null && w.kind === 'door') {
      area = this.current;
      door = this.arrival !== null ? (this.arrival.door ?? null) : (w.from?.id ?? null);
      if (this.phase === 'close') open = this.t / this.closeTicks;
      else if (this.arrival === null) open = 1 - this.t / WARP.OPEN; // (no switch: covered, or called off)
      else if (this.phase === 'hold') open = 1;
      else {
        open = (SHUT_AT - this.t) / (SHUT_AT - WARP.SHUT_FROM);
        open = open < 1 ? (open > 0 ? open : 0) : 1;
      }
    }
    if (area !== this.leafArea || door !== this.leafDoor) {
      // A new door: the last one shuts (its area hidden now); the one he walks into opens from
      // shut, the one he comes out of stands open from the switch (the screen covered).
      if (this.leafArea !== null) this.leafArea.setDoorOpen?.(0, this.leafDoor);
      this.leafArea = area;
      this.leafDoor = door;
      this.leafWas = this.phase === 'close' ? 0 : open;
    } else this.leafWas = this.leaf;
    this.leaf = open;
  }

  // An area's lamp: lit if its own star is won, or that of the course its def.lamp names.
  _light(area) {
    area.setLit?.(this.won.has(area.name) || (!!area.def.lamp && this.won.has(area.def.lamp)));
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
    this.arrival = null; // (set at the switch)
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
    // A door still swinging (a switch at once, enter()) shuts.
    if (this.leafArea !== null) this.leafArea.setDoorOpen?.(0, this.leafDoor);
    this.leafArea = null;
    this.leafDoor = null;
    this.leaf = this.leafWas = 0;
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
    this.view.setLook?.(null);
    this.view.setAtmosphere(to.def.atmosphere ?? null);
    this._look(to);
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
