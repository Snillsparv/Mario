// The Great Hall (area 'hall', course name THE GREAT HALL): a warm, tall, timber-roofed hall
// inside the castle, entered through the castle's front door. At its far end a giant ship in a
// bottle lies on two cradles; walking up the stairs into the bottle's neck is the way to the
// first course. Everything here is in the hall's own local frame: 1 unit = 1 cm, the origin at
// the middle of the floor, +x east, -z north (toward the bottle), the floor at y 0.
// world/areas.js places the hall at its origin (world = local + origin); world/area.js shifts
// these anchors into world coordinates for the collision world, the objects and the player.
//
//                    -Z (north)
//          ┌───────── bottle on cradles ─────────┐
//          │              landing                │
//   west   │ buttress        stairs         door │  east
//   (-X)   │ fireplace                      door │  (+X)
//          │                   chart table       │
//          │                                     │
//          └──────────── front door ─────────────┘
//                    +Z (south, the courtyard)
//
// Ownership: like world/layout.js, the anchors are shared contract: the builder
// (hall/hall.js), the objects (doors; coins and signs to come) and the entries all read them.
// The builder owns everything drawn around them.

// ---------------------------------------------------------------- the room

// Inner walls at x ±halfX, z northZ..southZ; the ceiling's underside (the collision ceiling)
// at ceilingY, more than 300 above any walkable spot so the follow camera never runs out of
// room under it. Walls, floor and ceiling are `thick` solid slabs (their faces toward the room
// are the boxes' outward faces).
export const HALL = { halfX: 2200, northZ: -4200, southZ: 3000, ceilingY: 2600, thick: 200, baseCourse: 140 };

// Stone pilasters on the side walls (120 along the wall, standing 60 out of it).
export const PILASTERS = { zs: [2500, 1300, -2900, -3700], width: 120, depth: 60 };

// Sun direction for the baked lighting (warm light from high up and a little from the south).
export const HALL_SUN = (() => {
  const v = { x: 0.1, y: 0.8, z: 0.6 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// ---------------------------------------------------------------- south wall: the way out

// The inside of the castle's front door, in the south wall (its face stands `face` in front
// of the wall: the door's collider fills its surround), with a rose window above it.
export const FRONT_DOOR = { x: 0, wallZ: HALL.southZ, faceZ: HALL.southZ - 56, width: 420, height: 620 };
export const ROSE_WINDOW = { y: 1800, r: 420 };
export const BANNERS = { xs: [-700, 700], top: 2400, bottom: 1200 };

// ---------------------------------------------------------------- side walls

// Two tall arched windows per side wall.
export const SIDE_WINDOWS = { zs: [1900, 700], width: 320, height: 1000, sill: 600 };

// West wall: the chimney breast (its top is the mantel), a buttress beside it and the wall-kick
// slot between them (open toward +x), and a climbable banner pole whose tip is 150 under the
// buttress top.
export const CHIMNEY = { x0: -2200, x1: -1750, z0: -1260, z1: -200, top: 1700, hearth: { z: -730, width: 700, height: 600 } };
export const CREST = { x: -1748, y: 1150, z: -730, r: 160 }; // a white pi on a red disc
export const BUTTRESS = { x0: -2200, x1: -1750, z0: -2080, z1: -1620, top: 1700 };
export const SLOT = { z0: BUTTRESS.z1, z1: CHIMNEY.z0 }; // 360 wide
export const BANNER_POLE = { x: -1600, z: -2380, y0: 0, y1: 1550, radius: 30 };

// East wall: two arched alcoves with doors that are still being built (the next courses).
export const EAST_DOORS = { faceX: 2144, yaw: -Math.PI / 2, width: 300, height: 520, depth: 80, zs: [-600, -2000] };
export const CHART_TABLE = { x: 1100, z: 700, r: 320, top: 90 };

// ---------------------------------------------------------------- north end: the ship in the bottle

// The bottle lies along x 0 with its axis at axisY: body, shoulder cone, neck, lip ring
// (z ranges north to south).
export const BOTTLE = {
  axisY: 760,
  bodyR: 520,
  body: [-4000, -2300],
  shoulder: [-2300, -1900],
  neckR: 240,
  neckInnerR: 210,
  neck: [-1900, -1400],
  lipR: 270,
  lip: [-1440, -1400],
};
export const CRADLES = { zs: [-3600, -2600], halfX: 700, top: 420 };
// The landing in front of the neck (its top is the neck's inner floor, 760 - 210) and the
// stairs up to it (a smooth 28.8 degree ramp as a collider, 11 steps drawn).
export const LANDING = { x0: -450, x1: 450, z0: -1400, z1: -900, top: 550 };
export const STAIRS = { x0: -320, x1: 320, z0: 100, z1: LANDING.z1, top: LANDING.top, steps: 11 };
export const CORK = { x: 700, z: -1150, r: 190, top: 380 };
export const BOOKS = { x: -750, tops: [150, 300, 450] };

export const CHANDELIERS = { spots: [{ x: 0, z: 1500 }, { x: 0, z: -300 }], y: 2050, r: 380, candles: 8 };

// ---------------------------------------------------------------- entries, doors

// Where Jonas arrives (see world/area.js): through the front door he is put well inside it,
// facing north with the room behind him for the camera, and walks on for walkIn ticks; out of
// the bottle he pops out onto the landing facing south, the camera in front of him (camYaw).
export const ENTRIES = {
  front: { x: 0, y: 0, z: 1550, yaw: Math.PI, walkIn: 10 },
  bottle: { x: 0, y: LANDING.top, z: -1230, yaw: 0, drop: 250, camYaw: 0 },
};
// A respawn drops him in at the front entry from `drop` above (under the 2600 ceiling).
export const RESPAWN = { entry: 'front', drop: 400 };
// Height the ground probe starts from (below the ceiling, so it finds the floor, not the roof).
export const PROBE_Y = 2400;

// The doors (objects/Door.js): the front door's inside leads back out onto the porch.
export const DOORS = [{ id: 'hall_front', x: FRONT_DOOR.x, z: FRONT_DOOR.faceZ, yaw: Math.PI, width: FRONT_DOOR.width, floorY: 0, to: 'grounds', entry: 'porch' }];
