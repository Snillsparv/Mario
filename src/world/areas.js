// The places Jonas can be in, each with a collision world of its own (core/AreaSwitch.js moves
// him between them): 'grounds', the castle grounds (world/level.js, built at boot), 'hall', the
// Great Hall inside the castle (world/hall/*), 'skerries', Midsummer Skerries, the first course,
// through the ship in the bottle (world/skerries/*), and 'lane', Sparrow Lane, the second
// course, through the hall's east door with the little house on it (world/lane/*);
// world/area.js builds the hall and the courses the first time he goes in. Data and builder
// references only.
//
//   AREA_DEFS[name] = AreaDef
//   groundsArea(level, objects) -> Area   // the grounds as an Area (world/area.js), wrapping
//                                         // what boot already built
//   HALL_ATMOSPHERE, SKERRIES_ATMOSPHERE, LANE_ATMOSPHERE   // their looks (view.setAtmosphere)
//
// AreaDef = {
//   name,
//   origin: { x, y, z },         // world = local + origin (areas are authored in local coords)
//   builders: [build(layout)],   // WorldParts (level.js); colliders must be { positions }
//   layout,                      // local anchors: ENTRIES, DOORS, COINS, ONE_UP, SIGNS, POLES
//                                // (and later STAR, ...)
//   entries: { id: { x, y, z, yaw, drop?, camYaw?, walkIn?, sfx?, door? } }   // local
//                                //   drop: he falls in from that high (action 'spawn');
//                                //   camYaw: the camera's orbit yaw (default: behind him);
//                                //   walkIn: ticks he walks on along yaw as the picture opens;
//                                //   sfx: the sound of arriving there, as the picture opens;
//                                //   door: the id of the swinging door he comes out of there
//                                //   (Area.setDoorOpen's: the one that stands open, then shuts)
//   respawn: { entry, drop },    // where a lost life drops him back in
//   waterLevelAt(x, z),          // local water surface, or NO_WATER
//   probeY,                      // local height the ground probe starts from (under the ceiling)
//   sky,                         // the grounds' sky dome shows (else the fog colour is the sky)
//   atmosphere,                  // view.setAtmosphere preset (null: the grounds' own look)
//   audio: { music, ambience, reverb, fires?, gulls?, seaLevel? },   // AudioEngine.setArea (on
//                                //   'areaChange'): its own track, its ambience profile
//                                //   (audio/ambience.js PROFILES), whether sound effects ring
//                                //   in the hall reverb, and where the ambience's own sounds
//                                //   come from (local; world/area.js shifts them): fires
//                                //   [{ x, y, z }], gulls [{ x, y, z, radius }], the sea's level
//   leave, starExit,             // where the pause screen's leave and the course's star take
//                                // him ({ to, entry }; null: nowhere)
//   card,                        // a course: its name shows as a title card on its first
//                                // entry in a game (HUD.showCourse)
//   lamp,                        // the course whose star, once won, lights this area's lamp
//                                // too (a course's own star lights its own: Area.setLit)
//   real,                        // a realistic look ({ jobs(tier), detail(tier), load() ->
//                                // Promise<build(layout, ctx)>: the build from the lazily
//                                // loaded realLook chunk}: render/real/RealAreas.js builds it in
//                                // the background; the lane's world/lane/real/jobs.js and
//                                // look.js); absent: classic only
// }
//
// Entries rule: every entry has at least 1300 of clear floor behind him for the camera's orbit
// (it trails ~1250 back), or a camYaw that puts the camera where there is room.

import { NO_WATER } from '../core/constants.js';
import * as hallLayout from './hall/layout.js';
import { buildHall } from './hall/hall.js';
import * as skerriesLayout from './skerries/layout.js';
import { buildSkerries } from './skerries/build.js';
import { buildSea } from './skerries/sea.js';
import * as laneLayout from './lane/layout.js';
import { buildLane } from './lane/build.js';
import { LANE_REAL_AREA } from './lane/real/jobs.js';

// The warm hall: a golden haze (its fog, and the clear colour: the hall has no sky) that the far
// end of the room melts into, not a brown murk, the actors lit by a warm key from the bake's
// own sun (HALL_SUN: from high in the south-west) under a warm hemisphere. No light is added
// (render/N64Renderer.js: the actors' programs never change).
export const HALL_ATMOSPHERE = Object.freeze({
  fog: 0x6a4a34,
  near: 4500,
  far: 20000,
  sun: 0xffe2b8,
  sunIntensity: 0.55 * Math.PI,
  sunDir: hallLayout.HALL_SUN,
  sky: 0xfff2dc,
  ground: 0x7a5038,
  ambientIntensity: 0.55 * Math.PI,
});

// Midsummer evening on the skerries: the grounds' sky and fog colour (the shared sky dome
// shows), the fog pushed out a little for the open sea, the actors lit by a low golden sun
// from the west-south-west (the bake's SKERRIES_SUN) under the grounds' hemisphere.
export const SKERRIES_ATMOSPHERE = Object.freeze({
  near: 7000,
  far: 28000,
  sun: 0xffe2b4,
  sunIntensity: 0.66 * Math.PI,
  sunDir: skerriesLayout.SKERRIES_SUN,
});

// A golden October afternoon in Sparrow Lane: the grounds' fog colour (the shared sky dome
// shows; the lane is ringed by forest, so the horizon mostly hides), the fog a little nearer
// than out on the sea, the actors lit by a low warm sun from the south-west (the bake's LANE_SUN)
// under a warm sky and a green ground.
export const LANE_ATMOSPHERE = Object.freeze({
  near: 6000,
  far: 24000,
  sun: 0xffdcb0,
  sunIntensity: 0.66 * Math.PI,
  sunDir: laneLayout.LANE_SUN,
  sky: 0xfff0d8,
  ground: 0x6a7a4a,
  ambientIntensity: 0.6 * Math.PI,
});

// Arriving on the porch from the hall: this far in front of the door's face, on the landing
// under open sky (the entrance ramp starts 50 further out, a balcony roofs the first 100).
const PORCH_OUT = 174;

export const AREA_DEFS = {
  grounds: {
    name: 'grounds',
    origin: { x: 0, y: 0, z: 0 },
    sky: true,
    atmosphere: null,
    audio: { music: null, ambience: 'grounds', reverb: false },
    leave: null,
    starExit: null,
  },
  hall: {
    name: 'hall',
    origin: { x: 0, y: 0, z: -60000 },
    builders: [buildHall],
    layout: hallLayout,
    entries: hallLayout.ENTRIES,
    respawn: hallLayout.RESPAWN,
    waterLevelAt: () => NO_WATER,
    probeY: hallLayout.PROBE_Y,
    sky: false,
    atmosphere: HALL_ATMOSPHERE,
    // "Compass and Candle" (audio/songs.js), the room tone and the fire in the hearth, every
    // sound ringing in the hall.
    audio: { music: 'castle_hall', ambience: 'hall', reverb: true, fires: [hallLayout.HEARTH_FIRE] },
    leave: null,
    starExit: null,
    // The little lighthouse in the bottle lights up with the course's own once its star is won.
    lamp: 'skerries',
  },
  skerries: {
    name: 'skerries',
    origin: { x: 60000, y: 0, z: 0 },
    builders: [buildSkerries, buildSea],
    layout: skerriesLayout,
    entries: skerriesLayout.ENTRIES,
    respawn: skerriesLayout.RESPAWN,
    waterLevelAt: skerriesLayout.waterLevelAt,
    probeY: skerriesLayout.PROBE_Y,
    sky: true,
    atmosphere: SKERRIES_ATMOSPHERE,
    // "Skerry Polska", the wind, waves lapping on the open sea and the gulls overhead.
    audio: { music: 'skerries', ambience: 'sea', reverb: false, seaLevel: skerriesLayout.SEA_LEVEL, gulls: skerriesLayout.BIRD_CIRCLES },
    // Out of the course (the pause screen's leave, or the star): back out of the bottle.
    leave: { to: 'hall', entry: 'bottle' },
    starExit: { to: 'hall', entry: 'bottle' },
    card: true,
  },
  lane: {
    name: 'lane',
    origin: { x: -60000, y: 0, z: 0 },
    builders: [buildLane],
    layout: laneLayout,
    entries: laneLayout.ENTRIES,
    respawn: laneLayout.RESPAWN,
    waterLevelAt: () => NO_WATER,
    probeY: laneLayout.PROBE_Y,
    sky: true,
    atmosphere: LANE_ATMOSPHERE,
    // "Skerry Polska" again (a bright folk loop suits a summer street), the grounds' birds,
    // leaves and breeze without their waterfall and moat.
    audio: { music: 'skerries', ambience: 'lane', reverb: false },
    // Out of the course (the pause screen's leave, or the star): back into the hall, in front of
    // the east door with the little house on it.
    leave: { to: 'hall', entry: 'east_2' },
    starExit: { to: 'hall', entry: 'east_2' },
    card: true,
    // Its realistic look (physically lit, its own sky and shadows), swapped in once built.
    real: LANE_REAL_AREA,
  },
};

// The grounds as an Area: boot built them (level.js) and their objects (objects: the grounds'
// ObjectManager). Entries: 'start' (the spawn, falling in from the sky) and 'porch' (in front of
// the castle door, his back to it and the camera in front of him, walking out 8 ticks). Showing
// or hiding them toggles every part but the sky (areas share the one sky dome) and the objects.
// Their swinging door is the castle's front door (the castle part's setDoorOpen; the door's id
// is no matter: it is the grounds' only one).
export function groundsArea(level, objects) {
  const sky = level.parts.find((p) => p.name === 'sky') ?? null;
  const castle = level.parts.find((p) => p.name === 'castle') ?? null;
  const shown = level.parts.filter((p) => p !== sky && p.object3D);
  const door = objects.door;
  const entries = { start: { ...level.spawn } };
  if (door) entries.porch = { x: door.x, y: door.porchY, z: door.faceZ + PORCH_OUT, yaw: 0, camYaw: 0, walkIn: 8 };
  return {
    name: 'grounds',
    def: AREA_DEFS.grounds,
    root: null,
    collision: level.collision,
    parts: level.parts,
    sky,
    objects,
    entries,
    audio: AREA_DEFS.grounds.audio,
    respawn: level.spawn,
    signs: level.layout.SIGNS,
    groundAt: level.layout.groundHeight,
    objectsLayout: level.layout,
    waterFn: (x, z) => level.collision.waterLevelAt(x, z),
    update(time, camera) {
      level.update(time, camera);
    },
    reset() {},
    setVisible(on) {
      for (const p of shown) p.object3D.visible = !!on;
      objects.group.visible = !!on;
    },
    setDoorOpen(t) {
      castle?.setDoorOpen?.(t);
    },
  };
}
