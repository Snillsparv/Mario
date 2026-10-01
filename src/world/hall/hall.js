// The Great Hall's building (area 'hall', see hall/layout.js): a WorldPart built in the hall's
// local frame, which world/area.js places at the hall's origin.
//
// The plain hall: a long stone room with cream plaster walls over a stone base course, stone
// pilasters, a flagstone floor and a dark timber ceiling, and in the south wall the inside of
// the castle's front door (castle/building.js door(), the same door the grounds see: its
// collider fills the surround, so the face stands at FRONT_DOOR.faceZ). Unlit worldMaterial
// meshes with the lighting baked into vertex colours (castle-style flat faces under HALL_SUN,
// the floor darker along the walls), one mesh per material: hall-floor, hall-wall, hall-trim,
// hall-wood. Colliders: thick stone slabs for the floor, the ceiling and the four walls, the
// pilasters and the door's surround, all { positions, terrain } (world/area.js shifts them).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder, boxPolys, wallFrame } from '../castle/geom.js';
import { door } from '../castle/building.js';
import { stoneTexture, wallTexture, woodTexture } from '../castle/textures.js';
import { flagstoneTexture } from '../terrainTextures.js';

// World units per texture repeat (as the castle's; flagstones as the courtyard's).
const REPEAT = { floor: 520, wall: 384, trim: 320, wood: 288 };
const TEXTURES = { floor: flagstoneTexture, wall: wallTexture, trim: stoneTexture, wood: woodTexture };

// Vertex tints (sRGB): warm plaster, warm grey flagstones, dark oak.
const TINT = { floor: 0xd9ccb6, plaster: 0xfff0d6, stone: 0xece4d6, oak: 0x8a6446, beam: 0x5a3e2a };
const FLOOR_STEP = 200; // floor tessellation (the bake darkens it along the walls)
const EDGE_SHADE = { dist: 400, dark: 0.75 }; // the floor this near a wall, and its shade there
const BEAM_EVERY = 1200; // dark tie-beam bands across the ceiling (painted on its planks)
const BEAM_WIDTH = 200;

const LIGHT = { ambient: 0.55, diffuse: 0.45, maxBright: 1.05 };

export function buildHall(layout) {
  const { HALL, PILASTERS, FRONT_DOOR, HALL_SUN } = layout;
  const kit = { solids: new SolidBuilder() };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);
  const X = HALL.halfX;
  const N = HALL.northZ;
  const S = HALL.southZ;
  const H = HALL.ceilingY;
  const T = HALL.thick;

  shell(kit, HALL);
  // Stone pilasters up the side walls.
  kit.trim.color(TINT.stone);
  for (const z of PILASTERS.zs) {
    const hw = PILASTERS.width / 2;
    for (const [x0, x1] of [[-X, -X + PILASTERS.depth], [X - PILASTERS.depth, X]]) {
      kit.trim.solid(boxPolys(x0, x1, 0, H, z - hw, z + hw, { bottom: false, top: false }));
      kit.solids.box(x0, x1, 0, H, z - hw, z + hw, 'stone', { bottom: false, top: false });
    }
  }
  // The front door's inside, on the south wall's face (facing north into the hall).
  door(kit, wallFrame([FRONT_DOOR.x, 0, FRONT_DOOR.wallZ], [0, 0, -1]), FRONT_DOOR.width, FRONT_DOOR.height);

  // Thick slabs round the room: its faces are the boxes' outward faces.
  const { solids } = kit;
  solids.box(-X - T, X + T, -T, 0, N - T, S + T, 'stone');
  solids.box(-X - T, X + T, H, H + T, N - T, S + T, 'stone', { bottom: true, top: false });
  solids.box(-X - T, -X, 0, H, N - T, S + T, 'stone', { bottom: false, top: false });
  solids.box(X, X + T, 0, H, N - T, S + T, 'stone', { bottom: false, top: false });
  solids.box(-X, X, 0, H, N - T, N, 'stone', { bottom: false, top: false });
  solids.box(-X, X, 0, H, S, S + T, 'stone', { bottom: false, top: false });

  // Baked light: the key from HALL_SUN; the floor dims toward the walls.
  const edge = (x, z) => Math.min(X - Math.abs(x), z - N, S - z);
  const occlusion = (x, y, z, nx, ny) => (ny > 0.5 && y < 1 ? 1 - (1 - EDGE_SHADE.dark) * Math.max(0, 1 - edge(x, z) / EDGE_SHADE.dist) : 1);
  const group = new THREE.Group();
  group.name = 'hall';
  for (const name of Object.keys(REPEAT)) {
    const geo = kit[name].toGeometry();
    bakeLighting(geo, { ...LIGHT, sun: HALL_SUN, occlusion });
    const mesh = new THREE.Mesh(geo, worldMaterial({ map: TEXTURES[name]() }));
    mesh.name = `hall-${name}`;
    group.add(mesh);
  }
  return { object3D: group, colliders: solids.colliders() };
}

// The room's faces toward its inside: the floor on a grid, plaster walls over a stone base
// course, and the timber ceiling with dark beam bands across it.
function shell(kit, { halfX: X, northZ: N, southZ: S, ceilingY: H, baseCourse: B }) {
  const { floor, wall, trim, wood } = kit;
  floor.color(TINT.floor);
  for (let x = -X; x < X; x += FLOOR_STEP) {
    for (let z = N; z < S; z += FLOOR_STEP) {
      const x1 = Math.min(x + FLOOR_STEP, X);
      const z1 = Math.min(z + FLOOR_STEP, S);
      floor.poly([[x, 0, z], [x1, 0, z], [x1, 0, z1], [x, 0, z1]], { facing: [0, 1, 0] });
    }
  }
  // Walls: [corner a, corner b (x, z), facing].
  const walls = [
    [[-X, S], [-X, N], [1, 0, 0]],
    [[X, N], [X, S], [-1, 0, 0]],
    [[-X, N], [X, N], [0, 0, 1]],
    [[X, S], [-X, S], [0, 0, -1]],
  ];
  for (const [[ax, az], [bx, bz], facing] of walls) {
    const quad = (y0, y1) => [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]];
    trim.color(TINT.stone);
    trim.shade = (px, py) => 0.72 + 0.28 * Math.min(1, py / B); // darker where it meets the floor
    trim.poly(quad(0, B), { facing });
    trim.shade = null;
    wall.color(TINT.plaster);
    wall.shade = (px, py) => 1 - 0.18 * (py / H); // the light falls off toward the roof
    wall.poly(quad(B, H), { facing });
    wall.shade = null;
  }
  // The ceiling: oak planks, a dark tie-beam band every BEAM_EVERY along the hall.
  const band = (z0, z1, tint) => {
    wood.color(tint);
    wood.poly([[-X, H, z0], [X, H, z0], [X, H, z1], [-X, H, z1]], { facing: [0, -1, 0] });
  };
  for (let z = N; z < S; z += BEAM_EVERY) {
    band(z, z + BEAM_WIDTH, TINT.beam);
    band(z + BEAM_WIDTH, Math.min(z + BEAM_EVERY, S), TINT.oak);
  }
}
