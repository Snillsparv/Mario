// The places Jonas can be in, each with a collision world of its own (core/AreaSwitch.js moves
// him between them): 'grounds', the castle grounds (world/level.js, built at boot), and
// 'hall', the Great Hall inside the castle (world/hall/*, built by world/area.js the first time
// he goes in). Data and builder references only.
//
//   AREA_DEFS[name] = AreaDef
//   groundsArea(level, objects) -> Area   // the grounds as an Area (world/area.js), wrapping
//                                         // what boot already built
//   HALL_ATMOSPHERE                       // the Great Hall's look (view.setAtmosphere)
//
// AreaDef = {
//   name,
//   origin: { x, y, z },         // world = local + origin (areas are authored in local coords)
//   builders: [build(layout)],   // WorldParts (level.js); colliders must be { positions }
//   layout,                      // local anchors: ENTRIES, DOORS, and later COINS, SIGNS, ...
//   entries: { id: { x, y, z, yaw, drop?, camYaw?, walkIn? } }   // local
//                                //   drop: he falls in from that high (action 'spawn');
//                                //   camYaw: the camera's orbit yaw (default: behind him);
//                                //   walkIn: ticks he walks on along yaw as the picture opens
//   respawn: { entry, drop },    // where a lost life drops him back in
//   waterLevelAt(x, z),          // local water surface, or NO_WATER
//   probeY,                      // local height the ground probe starts from (under the ceiling)
//   sky,                         // the grounds' sky dome shows (else the fog colour is the sky)
//   atmosphere,                  // view.setAtmosphere preset (null: the grounds' own look)
//   audio: { music, ambience, reverb },   // AudioEngine.setArea (on 'areaChange')
//   leave, starExit,             // where the pause screen's leave and the course's star take
//                                // him ({ to, entry }; null: nowhere)
// }
//
// Entries rule: every entry has at least 1300 of clear floor behind him for the camera's orbit
// (it trails ~1250 back), or a camYaw that puts the camera where there is room.

import { NO_WATER } from '../core/constants.js';
import * as hallLayout from './hall/layout.js';
import { buildHall } from './hall/hall.js';

// The warm hall: brown-amber fog (and clear colour: the hall has no sky), the actors lit by a
// soft warm key from high up and a warm hemisphere.
export const HALL_ATMOSPHERE = Object.freeze({
  fog: 0x3b2a1d,
  near: 3500,
  far: 16000,
  sun: 0xffe0b0,
  sunIntensity: 0.5 * Math.PI,
  sunDir: Object.freeze({ x: 0, y: 0.72, z: 0.69 }),
  sky: 0xfff0da,
  ground: 0x6e5038,
  ambientIntensity: 0.55 * Math.PI,
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
    audio: { music: 'castle_hall', ambience: 'hall', reverb: true },
    leave: null,
    starExit: null,
  },
};

// The grounds as an Area: boot built them (level.js) and their objects (objects: the grounds'
// ObjectManager). Entries: 'start' (the spawn, falling in from the sky) and 'porch' (in front of
// the castle door, his back to it and the camera in front of him, walking out 8 ticks). Showing
// or hiding them toggles every part but the sky (areas share the one sky dome) and the objects.
export function groundsArea(level, objects) {
  const sky = level.parts.find((p) => p.name === 'sky') ?? null;
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
  };
}
