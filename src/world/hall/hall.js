// The Great Hall's building (area 'hall', see hall/layout.js): a WorldPart built in the hall's
// local frame, which world/area.js places at the hall's origin.
//
//   buildHall(layout) -> { object3D, colliders, update(time), setDoorOpen(t), setLit(on) }
//     setDoorOpen   the front door's leaves, 0 shut .. 1 standing open (core/AreaSwitch.js)
//     setLit        the lamp of the little lighthouse in the bottle
//
// A long stone room under an open timber roof: cream plaster walls over a stone base course,
// stone pilasters, a flagstone floor, and above the collision ceiling (out of the camera's
// reach) oak tie beams carrying king-post trusses, purlins and a ridge beam under plaster
// panels. South wall: the inside of the castle's front door (castle/building.js door(), the
// same door the grounds see: its collider fills the surround, so the face stands at
// FRONT_DOOR.faceZ; its leaves swing into the wall onto a dark passage, setDoorOpen(t)) under a
// stained-glass rose window, between two crimson banners. Side and north walls: tall arched
// windows glowing pale gold. West wall: the chimney breast (its top is the mantel, with the
// 1-up) with a burning hearth and Jonas's pi crest, a buttress beside it with the wall-kick
// slot between them, and a climbable banner pole. East wall: two arched alcoves with doors
// still being built (a snowflake and a cog on their plaques) and, out in the room, a round
// chart table painted with a chart of the first course. Two iron candle rings hang from the tie
// beams. The north end, the ship in the bottle with its landing, stairs, cork and books, is
// hall/bottle.js. The signposts are props/decor.js addSignpost's.
//
// Unlit worldMaterial meshes with the lighting baked into vertex colours (castle-style flat
// faces under HALL_SUN; the floor darker along the walls, brighter in pools under the windows
// and the candle rings, faintly coloured under the rose window), one mesh per material, and the
// front door's two leaves, twelve in all: hall-floor, hall-wall, hall-trim, hall-wood (with the
// front door's passage), hall-door-left and hall-door-right (the leaves, the wood's material,
// each turning about its hinge), hall-paint (untextured vertex colours: the model in the
// bottle, the crest, plaques, chart, candles, cork and books), hall-glow (full-bright: the rose
// window's glass, from the rose texture, and the window panes, embers and flames, which all
// sample the rose's pale gold middle), hall-cloth (the banners), hall-bottle (the glass:
// transparent, front faces only, no depth write, paler and more opaque where the view grazes
// it, so its outline reads), hall-signs and hall-lamp (the lamp of the lighthouse in the bottle
// and its two hazy beams, hidden until that course's star is won: setLit(on); see-through like
// the course's beams, the beams fading out, drawn before the glass round them, and turning
// about the lighthouse's axis with update(time) while lit).
// The flames flicker: the glow mesh's 'flame' attribute (0 steady, else the flame's phase)
// scales their colour by a wobble of the time set in update(time) (one uniform, no allocation).
//
// Colliders, all { positions, terrain[, surface] } (world/area.js shifts them): thick stone
// slabs for the floor, the ceiling and the four walls, the pilasters, the doors' surrounds and
// the east alcoves' piers, the chimney breast (the hearth is drawn only) and its flue, the
// buttress, the bottle and its stand (bottle.js), the chart table, the signposts.

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder, archContour, beamPolys, boxPolys, circleContour, localBoxPolys, openingPolys, prismPolys, wallFrame } from '../castle/geom.js';
import { door, doorContour, doorLeaves } from '../castle/building.js';
import { archWindow, roundWindow } from '../castle/parts.js';
import { roseTexture, stoneTexture, wallTexture, woodTexture } from '../castle/textures.js';
import { flagstoneTexture } from '../terrainTextures.js';
import { MeshBuilder, bakedMesh } from '../props/geom.js';
import { addSignpost } from '../props/decor.js';
import { woodTexture as signWoodTexture } from '../props/textures.js';
import { bannerTexture } from './textures.js';
import { buildBottle } from './bottle.js';

// World units per texture repeat (as the castle's; flagstones as the courtyard's). The glow's,
// the rose window's glass and the cloth's UVs are set per face; the paint, the bottle and the
// lamp are untextured.
const REPEAT = { floor: 520, wall: 384, trim: 320, wood: 288, paint: 256, glow: 1, glass: 1, cloth: 1, bottle: 1, lamp: 1 };

// Vertex tints (sRGB): warm plaster, warm grey flagstones, oak, iron, the crest's red.
const TINT = {
  floor: 0xd9ccb6,
  plaster: 0xfff0d6,
  stone: 0xece4d6,
  oak: 0x8a6446,
  beam: 0x6a4a32,
  iron: 0x3a3634,
  soot: 0x4a2c1c,
  hearth: 0xd08a5a,
  log: 0x5a3a24,
  ember: 0xff6a20,
  flame: 0xffa83a,
  core: 0xfff0a0,
  pane: 0xffe6a0,
  wax: 0xf2e6c8,
  gold: 0xe8b84a,
  crest: 0xc8202a,
  white: 0xf8f4ea,
  parchment: 0xe8dcb4,
  chartSea: 0x9cc4cc,
  chartLand: 0xd9a58f,
  chartMeadow: 0x9cc480,
  ink: 0x5a3a2a,
  plaques: { snowflake: 0x3a6ab0, cog: 0x9a6a3a },
};

const FLOOR_STEP = 200; // floor tessellation (the bake shades it along the walls and in pools)
const EDGE_SHADE = { dist: 400, dark: 0.75 }; // the floor this near a wall, and its shade there
const POOLS = { window: 0.15, candles: 0.08, rose: 0.22 }; // extra light in the floor's pools
const LIGHT = { ambient: 0.55, diffuse: 0.45, maxBright: 1.05 };
const FULL_BRIGHT = { ambient: 1, diffuse: 0 };
// The bottle's glass: this see-through face on, paler and more opaque where the view grazes it
// (rim: (1 - |cos|)^2 of the angle between the face and the view), so its outline reads from
// every side against the cream walls and the dark stand.
const GLASS = { opacity: 0.22, rimOpacity: 0.62, rimWhite: 0.45 };
const HEARTH_DEPTH = 120; // the hearth's recess behind the breast's face (drawn only)
const FLICKER = { fast: 9, slow: 23 }; // the flames' wobble (rad/s)
const LAMP_SWEEP = 0.55; // the lit lamp's beams turning round (rad/s, as the course's)

export function buildHall(layout) {
  const kit = { solids: new SolidBuilder(), signs: { wood: new MeshBuilder(), colliders: { wood: [] }, shadow: () => {} } };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);
  shell(kit, layout);
  roof(kit, layout);
  southWall(kit, layout);
  windows(kit, layout);
  fireplace(kit, layout);
  eastWall(kit, layout);
  chartTable(kit, layout);
  chandeliers(kit, layout);
  buildBottle(kit, layout);
  for (const sign of layout.SIGNS) addSignpost(kit.signs, layout, sign);
  return assemble(kit, layout);
}

// ---------------------------------------------------------------- meshes

function assemble(kit, layout) {
  const { HALL_SUN } = layout;
  const lit = { ...LIGHT, sun: HALL_SUN };
  const group = new THREE.Group();
  group.name = 'hall';
  const add = (name, geo, material) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `hall-${name}`;
    group.add(mesh);
    return mesh;
  };

  const floor = kit.floor.toGeometry();
  tintRosePool(floor, layout);
  bakeLighting(floor, { ...lit, occlusion: floorLight(layout) });
  add('floor', floor, worldMaterial({ map: flagstoneTexture() }));
  const materials = {};
  for (const [name, map] of [['wall', wallTexture], ['trim', stoneTexture], ['wood', woodTexture], ['paint', null]]) {
    materials[name] = add(name, bakeLighting(kit[name].toGeometry(), lit), worldMaterial({ map: map ? map() : null })).material;
  }
  // The front door's leaves, swinging on their hinges (setDoorOpen) with the wood's look.
  const leaves = doorLeaves(kit.leaves, materials.wood, (geo) => bakeLighting(geo, lit), 'hall-door');
  for (const mesh of leaves.meshes) group.add(mesh);
  add('cloth', bakeLighting(kit.cloth.toGeometry(), lit), worldMaterial({ map: bannerTexture() }));

  // The glow: every face but the rose window's samples the rose texture's pale gold middle.
  const { glow, glass } = kit;
  glow.uv.fill(0.5);
  for (const key of ['pos', 'nrm', 'uv', 'col', 'glows']) glow[key].push(...glass[key]);
  const glowGeo = bakeLighting(glow.toGeometry(), FULL_BRIGHT);
  glowGeo.setAttribute('flame', glowGeo.getAttribute('darkGlow'));
  glowGeo.deleteAttribute('darkGlow');
  const flicker = flickerMaterial(roseTexture());
  add('glow', glowGeo, flicker.material);

  add('bottle', kit.bottle.toGeometry(), glassMaterial());
  group.add(bakedMesh('hall-signs', kit.signs.wood, worldMaterial({ map: signWoodTexture() }), lit));
  // The lamp: its faces' glow (bottle.js: 1 on the lantern, fading out along the beams) is its
  // vertex colours' alpha. The beams' material is the course's (skerries/lighthouse.js: one
  // shader for both). Set about the lighthouse's axis to turn round it.
  const lampGeo = bakeLighting(kit.lamp.toGeometry(), FULL_BRIGHT);
  const rgb = lampGeo.attributes.color;
  const fade = lampGeo.attributes.darkGlow;
  const rgba = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) rgba.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), fade.getX(i)], i * 4);
  lampGeo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  lampGeo.deleteAttribute('darkGlow');
  const [lx, ly, lz] = kit.lampAt;
  lampGeo.translate(-lx, -ly, -lz);
  const lamp = add('lamp', lampGeo, worldMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  lamp.position.set(lx, ly, lz);
  lamp.renderOrder = -1; // (inside the bottle: drawn before its glass)
  lamp.visible = false;

  const colliders = kit.solids.colliders();
  colliders.push({ positions: kit.signs.colliders.wood, terrain: 'wood' });
  return {
    object3D: group,
    colliders,
    update(time) {
      flicker.time.value = time;
      if (lamp.visible) lamp.rotation.y = time * LAMP_SWEEP;
    },
    // The front door, 0 shut .. 1 standing open (core/AreaSwitch.js swings it as Jonas goes out
    // through it and comes in).
    setDoorOpen(t) {
      leaves.setOpen(t);
    },
    // The lamp of the lighthouse in the bottle: lit once the course's star is won (AreaSwitch,
    // AREA_DEFS.hall.lamp).
    setLit(on) {
      lamp.visible = !!on;
    },
  };
}

// The glow's material: worldMaterial with the flames' flicker (see the file header).
function flickerMaterial(map) {
  const material = worldMaterial({ map });
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flameTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flame;\nuniform float flameTime;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
if (flame > 0.0) vColor.rgb *= 0.86 + 0.09 * sin(flameTime * ${FLICKER.fast.toFixed(1)} + flame * 41.0) + 0.05 * sin(flameTime * ${FLICKER.slow.toFixed(1)} + flame * 17.0);`,
      );
  };
  material.customProgramCacheKey = () => 'hall-flame';
  material.userData.flameTime = time;
  return { material, time };
}

// The glass's material: worldMaterial, transparent (front faces, no depth write), with the rim
// (see GLASS) worked out per vertex from the face's normal and the view.
function glassMaterial() {
  const material = worldMaterial({ transparent: true, depthWrite: false });
  material.opacity = GLASS.opacity;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassRim;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGlassRim = 1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassRim;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float glassRim = vGlassRim * vGlassRim;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), glassRim * ${GLASS.rimWhite.toFixed(2)});
diffuseColor.a = mix(diffuseColor.a, ${GLASS.rimOpacity.toFixed(2)}, glassRim);`,
      );
  };
  material.customProgramCacheKey = () => 'hall-glass';
  return material;
}

// The floor's light (bakeLighting's occlusion): darker toward the walls, brighter in pools
// under the windows and the candle rings.
function floorLight({ HALL, SIDE_WINDOWS, NORTH_WINDOWS, CHANDELIERS }) {
  const X = HALL.halfX;
  const pools = [];
  for (const z of SIDE_WINDOWS.zs) for (const s of [-1, 1]) pools.push({ x: s * (X - 650), z: z + 150, r: 520, k: POOLS.window });
  for (const x of NORTH_WINDOWS.xs) pools.push({ x, z: HALL.northZ + 650, r: 520, k: POOLS.window });
  for (const c of CHANDELIERS.spots) pools.push({ x: c.x, z: c.z, r: 700, k: POOLS.candles });
  return (x, y, z) => {
    const edge = Math.min(X - Math.abs(x), z - HALL.northZ, HALL.southZ - z);
    let k = 1 - (1 - EDGE_SHADE.dark) * Math.max(0, 1 - edge / EDGE_SHADE.dist);
    for (const p of pools) {
      const d = Math.hypot(x - p.x, z - p.z) / p.r;
      if (d < 1) k *= 1 + p.k * (1 - d * d);
    }
    return k;
  };
}

// The rose window's light falls in front of the front door: a faint pool, its colour turning
// with the angle round it (the glass's red, gold, blue and green), tinted into the floor's
// vertex colours before the bake.
function tintRosePool(geo, { FRONT_DOOR }) {
  const cx = FRONT_DOOR.x;
  const cz = FRONT_DOOR.wallZ - 700;
  const r = 650;
  const hues = [[1, 0.55, 0.55], [1, 0.85, 0.45], [0.6, 0.7, 1], [0.6, 1, 0.7]];
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx;
    const dz = pos.getZ(i) - cz;
    const d = Math.hypot(dx, dz) / r;
    if (d >= 1) continue;
    const hue = hues[Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * 8) % hues.length];
    const k = POOLS.rose * (1 - d * d);
    col.setXYZ(i, col.getX(i) * (1 + k * hue[0]), col.getY(i) * (1 + k * hue[1]), col.getZ(i) * (1 + k * hue[2]));
  }
}

// ---------------------------------------------------------------- the room

// The faces toward the room: the floor on a grid, plaster walls over a stone base course up to
// the eaves (the end walls up into the gables), stone pilasters; and the thick slabs round it
// as colliders (their faces toward the room are the boxes' outward faces).
function shell(kit, { HALL, ROOF, PILASTERS, FRONT_DOOR }) {
  const { floor, wall, trim, solids } = kit;
  const { halfX: X, northZ: N, southZ: S, ceilingY: H, thick: T, baseCourse: B } = HALL;
  const { eaveY: E, ridgeY: R } = ROOF;
  floor.color(TINT.floor);
  for (let x = -X; x < X; x += FLOOR_STEP) {
    for (let z = N; z < S; z += FLOOR_STEP) {
      const x1 = Math.min(x + FLOOR_STEP, X);
      const z1 = Math.min(z + FLOOR_STEP, S);
      floor.poly([[x, 0, z], [x1, 0, z], [x1, 0, z1], [x, 0, z1]], { facing: [0, 1, 0] });
    }
  }
  // Walls: [corner a, corner b (x, z), facing, gable, door]. The south wall leaves the front
  // door's opening (its leaves swing into it: southWall()); `door` is that door's wall frame.
  const doorFrame = frontDoorFrame(FRONT_DOOR);
  const walls = [
    [[-X, S], [-X, N], [1, 0, 0], false, null],
    [[X, N], [X, S], [-1, 0, 0], false, null],
    [[-X, N], [X, N], [0, 0, 1], true, null],
    [[X, S], [-X, S], [0, 0, -1], true, doorFrame],
  ];
  const opening = doorContour(FRONT_DOOR.width, FRONT_DOOR.height);
  for (const [[ax, az], [bx, bz], facing, gable, door] of walls) {
    // The wall from height y0 to y1: one face, or the faces round the door's opening (u: across
    // the door's frame).
    const band = (builder, y0, y1) => {
      if (!door) {
        builder.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], { facing });
        return;
      }
      const o = door.at(0, 0, 0);
      const u = (x, z) => (x - o[0]) * door.right[0] + (z - o[2]) * door.right[2];
      const [u0, u1] = [u(ax, az), u(bx, bz)].sort((p, q) => p - q);
      for (const p of openingPolys(door, u0, u1, y0 - o[1], y1 - o[1], opening)) builder.poly(p, { facing });
    };
    trim.color(TINT.stone);
    trim.shade = (px, py) => 0.72 + 0.28 * Math.min(1, py / B); // darker where it meets the floor
    band(trim, 0, B);
    trim.shade = null;
    wall.color(TINT.plaster);
    wall.shade = (px, py) => 1 - 0.24 * (py / R); // the light falls off toward the roof
    band(wall, B, E);
    if (gable) wall.poly([[bx, E, bz], [(ax + bx) / 2, R, (az + bz) / 2], [ax, E, az]], { facing });
    wall.shade = null;
  }
  // Stone pilasters up the side walls.
  trim.color(TINT.stone);
  for (const z of PILASTERS.zs) {
    const hw = PILASTERS.width / 2;
    for (const [x0, x1] of [[-X, -X + PILASTERS.depth], [X - PILASTERS.depth, X]]) {
      trim.solid(boxPolys(x0, x1, 0, E, z - hw, z + hw, { bottom: false, top: false }));
      solids.box(x0, x1, 0, H, z - hw, z + hw, 'stone', { bottom: false, top: false });
    }
  }
  solids.box(-X - T, X + T, -T, 0, N - T, S + T, 'stone');
  solids.box(-X - T, X + T, H, H + T, N - T, S + T, 'stone', { bottom: true, top: false });
  solids.box(-X - T, -X, 0, H, N - T, S + T, 'stone', { bottom: false, top: false });
  solids.box(X, X + T, 0, H, N - T, S + T, 'stone', { bottom: false, top: false });
  solids.box(-X, X, 0, H, N - T, N, 'stone', { bottom: false, top: false });
  solids.box(-X, X, 0, H, S, S + T, 'stone', { bottom: false, top: false });
}

// The open roof (drawn only, above the collision ceiling): plaster panels under both slopes,
// a ridge beam and a purlin down each slope, and a king-post truss on every tie beam.
function roof(kit, { HALL, ROOF }) {
  const { wall, wood } = kit;
  const { halfX: X, northZ: N, southZ: S, ceilingY: H } = HALL;
  const { eaveY: E, ridgeY: R } = ROOF;
  const slope = (x) => E + (R - E) * (1 - Math.abs(x) / X); // the roof's underside over x
  wall.color(TINT.plaster);
  wall.shade = (px, py) => 0.6 + 0.16 * ((R - py) / (R - E)); // dim up under the ridge
  for (const s of [-1, 1]) wall.poly([[s * X, E, N], [s * X, E, S], [0, R, S], [0, R, N]], { facing: [-s * (R - E), -X, 0] });
  wall.shade = null;

  wood.color(TINT.beam);
  const under = (n) => (n[1] < -0.5 ? 0.7 : 1);
  wood.box(-80, 80, R - 170, R, N, S, { top: false, faceShade: under });
  for (const s of [-1, 1]) {
    const cx = (s * X) / 2;
    wood.box(cx - 70, cx + 70, slope(cx) - 170, slope(cx) + 20, N, S, { top: false, faceShade: under });
  }
  wood.color(TINT.oak);
  for (let z = ROOF.firstTruss; z < S; z += ROOF.trussEvery) {
    wood.box(-X, X, H, E, z - 100, z + 100, { top: false, faceShade: under });
    wood.box(-80, 80, E, R - 170, z - 80, z + 80, { bottom: false, top: false });
    for (const s of [-1, 1]) {
      // Principal rafter (just under the roof's underside) and a strut from the king post's foot.
      wood.solid(beamPolys([s * X, E - 100, z], [s * 70, slope(70) - 100, z], [0, 0, 1], 160, 180), { faceShade: under });
      wood.solid(beamPolys([s * 70, E + 70, z], [s * X * 0.5, slope(X * 0.5) - 180, z], [0, 0, 1], 120, 120));
    }
  }
}

// ---------------------------------------------------------------- walls

// The front door's wall frame in the south wall, on its threshold, looking into the room.
function frontDoorFrame(FRONT_DOOR) {
  return wallFrame([FRONT_DOOR.x, 0, FRONT_DOOR.wallZ], [0, 0, -1]);
}

// South wall: the front door's inside under the rose window, a banner either side. The door
// swings (kit.leaves: assemble() makes their meshes) onto a dark passage drawn in with the wood
// (behind the shut leaves it never shows), in the opening shell() leaves in the wall.
function southWall(kit, { FRONT_DOOR, ROSE_WINDOW, BANNERS }) {
  const frame = frontDoorFrame(FRONT_DOOR);
  kit.leaves = door(kit, frame, FRONT_DOOR.width, FRONT_DOOR.height, { passage: kit.wood });
  roundWindow(kit, frame, ROSE_WINDOW.y, ROSE_WINDOW.r, { glass: true });
  for (const x of BANNERS.xs) {
    banner(kit, wallFrame([x, 0, FRONT_DOOR.wallZ], [0, 0, -1]), 300, BANNERS.top, BANNERS.bottom);
  }
}

// A banner hanging from an iron rod just off a wall: the cloth in gentle pleats, its foot cut
// to a point (the whole banner texture across it).
function banner(kit, frame, width, top, bottom) {
  const { cloth, wood, paint } = kit;
  const hw = width / 2;
  const cols = 6;
  const point = 150; // the point's depth below the sides
  const foot = (u) => bottom + point * (Math.abs(u) / hw);
  cloth.color(0xffffff);
  for (let c = 0; c < cols; c++) {
    const u0 = -hw + (width * c) / cols;
    const u1 = -hw + (width * (c + 1)) / cols;
    const w0 = 22 + (c % 2) * 12;
    const w1 = 22 + ((c + 1) % 2) * 12;
    const v = (u, y) => [(u + hw) / width, (y - bottom) / (top - bottom)];
    cloth.poly([frame.at(u0, foot(u0), w0), frame.at(u1, foot(u1), w1), frame.at(u1, top, w1), frame.at(u0, top, w0)], {
      facing: frame.out,
      uvs: [v(u0, foot(u0)), v(u1, foot(u1)), v(u1, top), v(u0, top)],
      shade: c % 2 ? 0.86 : 1,
    });
  }
  wood.color(TINT.iron);
  wood.solid(localBoxPolys(frame, -hw - 40, hw + 40, top, top + 16, 14, 34));
  paint.color(TINT.gold);
  for (const u of [-hw - 52, hw + 52]) paint.solid(localBoxPolys(frame, u - 12, u + 12, top - 4, top + 20, 12, 36));
}

// Tall arched windows (castle/parts.js), two in each side wall and two in the north wall, their
// panes glowing pale gold behind iron bars.
function windows(kit, { HALL, SIDE_WINDOWS: W, NORTH_WINDOWS }) {
  const { glow, wood } = kit;
  const hw = W.width / 2;
  const pane = archContour(hw, W.height - hw, 6);
  const frames = [];
  for (const s of [-1, 1]) for (const z of W.zs) frames.push(wallFrame([s * HALL.halfX, W.sill, z], [-s, 0, 0]));
  for (const x of NORTH_WINDOWS.xs) frames.push(wallFrame([x, W.sill, HALL.northZ], [0, 0, 1]));
  for (const frame of frames) {
    archWindow(kit, frame, W.width, W.height);
    glow.color(TINT.pane);
    glow.panel(frame, pane, 6, { shade: pane.map(([, v]) => 0.82 + 0.3 * (v / W.height)) });
    wood.color(TINT.iron);
    wood.solid(localBoxPolys(frame, -7, 7, 0, W.height - 10, 4, 14, { bottom: false }));
    for (const v of [W.height * 0.35, W.height * 0.62]) wood.solid(localBoxPolys(frame, -hw, hw, v - 7, v + 7, 4, 14));
  }
}

// West wall: the chimney breast with its hearth (a fire on its logs), the pi crest and the
// mantel; its flue up the wall; the buttress with the wall-kick slot between them; the banner
// pole with a small banner at its top.
function fireplace(kit, { CHIMNEY: C, CREST, BUTTRESS: Bt, BANNER_POLE: P, HALL, ROOF }) {
  const { trim, wood, paint, glow, solids } = kit;
  const { x0, x1, z0, z1, top } = C;
  const hz0 = C.hearth.z - C.hearth.width / 2;
  const hz1 = C.hearth.z + C.hearth.width / 2;
  const hh = C.hearth.height;
  const back = x1 - HEARTH_DEPTH;
  trim.color(TINT.stone);
  trim.shade = (px, py) => 0.78 + 0.22 * Math.min(1, py / top);
  const east = (za, zb, ya, yb) => trim.poly([[x1, ya, za], [x1, ya, zb], [x1, yb, zb], [x1, yb, za]], { facing: [1, 0, 0] });
  east(z0, hz0, 0, top);
  east(hz1, z1, 0, top);
  east(hz0, hz1, hh, top);
  trim.poly([[x0, 0, z0], [x1, 0, z0], [x1, top, z0], [x0, top, z0]], { facing: [0, 0, -1] });
  trim.poly([[x0, 0, z1], [x1, 0, z1], [x1, top, z1], [x0, top, z1]], { facing: [0, 0, 1] });
  trim.poly([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], { facing: [0, 1, 0] });
  // The hearth: its reveals and sooty back lit warm by the fire from below; a stone shelf under
  // the mantel's edge; a hearthstone.
  const firelit = (px, py) => 1.25 - 0.85 * (py / hh);
  trim.color(TINT.hearth);
  trim.shade = firelit;
  trim.poly([[back, 0, hz0], [x1, 0, hz0], [x1, hh, hz0], [back, hh, hz0]], { facing: [0, 0, 1] });
  trim.poly([[back, 0, hz1], [x1, 0, hz1], [x1, hh, hz1], [back, hh, hz1]], { facing: [0, 0, -1] });
  trim.poly([[back, hh, hz0], [x1, hh, hz0], [x1, hh, hz1], [back, hh, hz1]], { facing: [0, -1, 0], shade: 0.5 });
  trim.shade = null;
  trim.color(TINT.stone);
  trim.solid(boxPolys(x1 - 10, x1 + 30, top - 50, top, z0, z1, { bottom: true }), { faceShade: (n) => (n[1] < -0.5 ? 0.55 : 1) });
  trim.solid(boxPolys(back, x1 + 90, 0, 4, hz0 - 40, hz1 + 40, { bottom: false }), { shade: 0.8 });
  paint.color(TINT.soot);
  paint.shade = firelit;
  paint.poly([[back, 0, hz0], [back, 0, hz1], [back, hh, hz1], [back, hh, hz0]], { facing: [1, 0, 0] });
  paint.shade = null;
  solids.box(x0, x1, 0, top, z0, z1, 'stone');

  // The fire: logs on glowing embers, flames licking up in front of them.
  wood.color(TINT.log);
  for (const [xa, xb, y] of [[back + 20, back + 60, 4], [back + 64, back + 104, 4], [back + 42, back + 82, 44]]) {
    wood.box(xa, xb, y, y + 40, hz0 + 90, hz1 - 90);
  }
  glow.color(TINT.ember);
  glow.glow = 0.37;
  glow.poly([[back + 4, 5, hz0 + 60], [x1 + 10, 5, hz0 + 60], [x1 + 10, 5, hz1 - 60], [back + 4, 5, hz1 - 60]], { facing: [0, 1, 0] });
  for (let i = 0; i < 4; i++) {
    const fz = hz0 + 170 + i * 120;
    const fh = 150 + (i % 2) * 60;
    for (const [tint, w, h, dx] of [[TINT.flame, 70, fh, 0], [TINT.core, 40, fh * 0.6, 3]]) {
      const fx = x1 - 40 + dx;
      glow.color(tint);
      glow.glow = 0.1 + i * 0.21;
      const tongue = [[fx, 30, fz - w * 0.4], [fx, 30, fz + w * 0.4], [fx, 30 + h * 0.3, fz + w / 2], [fx, 30 + h, fz], [fx, 30 + h * 0.3, fz - w / 2]];
      glow.poly(tongue, { facing: [1, 0, 0] });
    }
  }
  glow.glow = 0;

  // The crest: a red disc with a gold rim and Jonas's white pi.
  const crest = wallFrame([CREST.x, CREST.y, CREST.z], [1, 0, 0]);
  paint.color(TINT.gold);
  paint.panel(crest, circleContour(0, 0, CREST.r + 14, 16), 0);
  paint.color(TINT.crest);
  paint.panel(crest, circleContour(0, 0, CREST.r, 16), 1);
  paint.color(TINT.white);
  const quad = (u0, v0, u1, v1, slant = 0) => paint.panel(crest, [[u0, v0], [u1, v0], [u1 + slant, v1], [u0 + slant, v1]], 2);
  quad(-100, 50, 100, 82);
  quad(-60, -92, -34, 50, 14);
  quad(34, -80, 60, 50);
  quad(34, -100, 92, -74);

  // The flue up the wall above the mantel (solid: he stands on the mantel beside it).
  const fz0 = C.hearth.z - 320;
  const fz1 = C.hearth.z + 320;
  trim.color(TINT.stone);
  trim.solid(boxPolys(x0, x0 + 60, top, ROOF.eaveY, fz0, fz1, { bottom: false, top: false }));
  solids.box(x0, x0 + 60, top, HALL.ceilingY, fz0, fz1, 'stone', { bottom: false, top: false });

  // The buttress, the slot's far side.
  trim.shade = (px, py) => 0.78 + 0.22 * Math.min(1, py / Bt.top);
  trim.box(Bt.x0, Bt.x1, 0, Bt.top, Bt.z0, Bt.z1, { bottom: false });
  trim.shade = null;
  solids.box(Bt.x0, Bt.x1, 0, Bt.top, Bt.z0, Bt.z1, 'stone');

  // The banner pole (its climbable pole is layout.POLES) on an iron foot, a gold cap at its tip
  // and a small banner from a crossbar near the top, drawn from both sides.
  wood.color(TINT.iron);
  wood.lathe(P.x, P.z, [[70, 0], [70, 16], [P.radius + 6, 30]], 8, { flat: true });
  wood.color(TINT.beam);
  wood.lathe(P.x, P.z, [[P.radius, 20], [P.radius - 6, P.y1 - 20]], 8);
  paint.color(TINT.gold);
  paint.lathe(P.x, P.z, [[P.radius - 6, P.y1 - 20], [P.radius, P.y1 - 10], [P.radius - 2, P.y1], [0, P.y1]], 8, { flat: true });
  wood.color(TINT.iron);
  const bar = P.y1 - 90;
  wood.box(P.x, P.x + 170, bar - 8, bar + 8, P.z - 8, P.z + 8);
  const u = (x) => (x - P.x - 20) / 140;
  const pts = [[P.x + 20, bar - 230, P.z], [P.x + 160, bar - 230, P.z], [P.x + 160, bar, P.z], [P.x + 20, bar, P.z]];
  const uvs = pts.map(([x, y]) => [u(x), (y - bar + 230) / 230]);
  kit.cloth.color(0xffffff);
  kit.cloth.poly(pts, { facing: [0, 0, 1], uvs });
  kit.cloth.poly(pts, { facing: [0, 0, -1], uvs, shade: 0.85 });
}

// East wall: two arched stone alcoves standing out of the wall, each with a door still being
// built (castle/building.js door(), its face at EAST_DOORS.faceX) and a plaque above it.
function eastWall(kit, { HALL, EAST_DOORS: D }) {
  const { trim, paint, solids } = kit;
  const hw = D.width / 2;
  const spring = D.height - hw;
  const inner = archContour(hw + 70, spring, 8);
  const outer = archContour(hw + 120, spring, 8);
  D.zs.forEach((z, i) => {
    const frame = wallFrame([HALL.halfX, 0, z], [-1, 0, 0]);
    door(kit, frame, D.width, D.height);
    trim.color(TINT.stone);
    trim.moulding(frame, inner, outer, D.depth, { w0: -4, revealShade: 0.5 });
    for (const s of [-1, 1]) {
      const [u0, u1] = s < 0 ? [-hw - 120, -hw - 70] : [hw + 70, hw + 120];
      solids.solid(localBoxPolys(frame, u0, u1, 0, spring, 0, D.depth, { bottom: false }), 'stone');
    }
    plaque(paint, frame, D.plaques[i], spring + hw + 220);
  });
}

// A round plaque on a wall frame at height v: a gold rim, a coloured field and its sign (a white
// snowflake, or a bronze cog).
function plaque(paint, frame, kind, v) {
  paint.color(TINT.gold);
  paint.panel(frame, circleContour(0, v, 78, 12), 3);
  paint.color(TINT.plaques[kind]);
  paint.panel(frame, circleContour(0, v, 66, 12), 4);
  const bar = (a, len, w, at) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const [cu, cv] = at;
    const p = (du, dv) => [cu + du * c - dv * s, cv + du * s + dv * c];
    paint.panel(frame, [p(-len, -w), p(len, -w), p(len, w), p(-len, w)], 5);
  };
  if (kind === 'snowflake') {
    paint.color(TINT.white);
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3 + Math.PI / 2;
      bar(a, 52, 5, [0, v]);
      for (const t of [-34, 34]) {
        const at = [Math.cos(a) * t, v + Math.sin(a) * t];
        bar(a + 0.8, 14, 4, at);
        bar(a - 0.8, 14, 4, at);
      }
    }
  } else {
    paint.color(0xd8b070);
    const ring = (r) => circleContour(0, v, r, 8);
    const out = ring(40);
    const inside = ring(20);
    for (let k = 0; k < 8; k++) {
      const j = (k + 1) % 8;
      paint.panel(frame, [inside[k], out[k], out[j], inside[j]], 5);
      const a = ((k + 0.5) * Math.PI) / 4;
      bar(a, 9, 9, [Math.cos(a) * 47, v + Math.sin(a) * 47]);
    }
  }
}

// The round chart table: an oak top on a pedestal, a chart of the first course on it (a sea
// with home island, the skerries, the lighthouse's islet, a dotted route and a compass mark).
function chartTable(kit, { CHART_TABLE: T }) {
  const { wood, paint, solids } = kit;
  const { x, z, r, top } = T;
  wood.color(TINT.oak);
  wood.lathe(x, z, [[0, top - 30], [r, top - 30], [r, top], [0, top]], 8, { flat: true });
  wood.color(TINT.beam);
  wood.lathe(x, z, [[120, 0], [120, 16], [60, 40], [44, top - 30]], 8, { flat: true });
  solids.solid(prismPolys(x, z, r, 8, 0, top), 'wood');

  // The chart, turned a little on the table: sheet (s, t) in -1..1 -> table top.
  const yaw = 0.18;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const hs = 210;
  const ht = 160;
  const at = (s, t, lift) => [x + s * hs * c + t * ht * sn, top + lift, z - s * hs * sn + t * ht * c];
  const flat = (pts, lift) => paint.poly(pts.map(([s, t]) => at(s, t, lift)), { facing: [0, 1, 0] });
  paint.color(TINT.parchment);
  flat([[-1, -1], [1, -1], [1, 1], [-1, 1]], 1);
  paint.color(TINT.chartSea);
  flat([[-0.9, -0.88], [0.9, -0.88], [0.9, 0.88], [-0.9, 0.88]], 2);
  const blob = (s, t, rs, tint) => {
    paint.color(tint);
    flat(Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return [s + Math.cos(a) * rs, t + Math.sin(a) * rs * 1.3];
    }), 3);
  };
  blob(0, 0.58, 0.3, TINT.chartLand);
  blob(0, 0.6, 0.18, TINT.chartMeadow);
  blob(0.02, -0.58, 0.22, TINT.chartLand);
  for (const [s, t] of [[-0.42, 0.42], [-0.55, 0.15], [-0.52, -0.12], [-0.4, -0.36]]) blob(s, t, 0.07, TINT.chartLand);
  blob(0.56, -0.08, 0.13, TINT.chartLand);
  blob(0.02, -0.62, 0.05, TINT.crest);
  // The route: dashes from home round the skerries to the lighthouse.
  paint.color(TINT.crest);
  const route = [[-0.12, 0.4], [-0.32, 0.3], [-0.46, 0.02], [-0.34, -0.3], [-0.12, -0.5]];
  for (let i = 0; i + 1 < route.length; i++) {
    const [s0, t0] = route[i];
    const [s1, t1] = route[i + 1];
    const ms = (s0 + s1) / 2;
    const mt = (t0 + t1) / 2;
    const ds = (s1 - s0) * 0.3;
    const dt = (t1 - t0) * 0.3;
    const len = Math.hypot(s1 - s0, t1 - t0);
    const ps = (-(t1 - t0) / len) * 0.016; // half its width, across it
    const pt = ((s1 - s0) / len) * 0.016;
    flat([[ms - ds - ps, mt - dt - pt], [ms + ds - ps, mt + dt - pt], [ms + ds + ps, mt + dt + pt], [ms - ds + ps, mt - dt + pt]], 4);
  }
  // A compass mark in the corner: a dark needle, north toward the lighthouse.
  paint.color(TINT.ink);
  flat([[0.72, -0.62], [0.76, -0.48], [0.8, -0.62], [0.76, -0.76]], 4);
}

// The two iron candle rings hanging on chains from their tie beams: eight candles each, their
// flames flickering.
function chandeliers(kit, { HALL, CHANDELIERS: CH }) {
  const { wood, paint, glow } = kit;
  const { y, r, candles: n } = CH;
  const hookY = y + 330;
  CH.spots.forEach(({ x, z }, k) => {
    const at = (i, rr = r) => {
      const a = (i / n) * Math.PI * 2;
      return [x + Math.sin(a) * rr, y, z + Math.cos(a) * rr];
    };
    wood.color(TINT.iron);
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      wood.solid(beamPolys(at(i), at(i + 1), [Math.sin(a), 0, Math.cos(a)], 24, 24));
    }
    for (let i = 0; i < n; i += 2) {
      const p = at(i);
      wood.solid(beamPolys([p[0], y + 10, p[2]], [x, hookY, z], [Math.cos((i / n) * Math.PI * 2), 0, -Math.sin((i / n) * Math.PI * 2)], 8, 8));
    }
    wood.box(x - 7, x + 7, hookY - 10, HALL.ceilingY, z - 7, z + 7, { top: false });
    for (let i = 0; i < n; i++) {
      const [cx, , cz] = at(i);
      wood.color(TINT.iron);
      wood.lathe(cx, cz, [[0, y + 10], [26, y + 10], [26, y + 18], [0, y + 18]], 6, { flat: true });
      paint.color(TINT.wax);
      paint.lathe(cx, cz, [[13, y + 18], [12, y + 74], [0, y + 76]], 6, { flat: true });
      glow.color(TINT.flame);
      glow.glow = 0.05 + ((i * 7 + k * 3) % 16) / 17;
      glow.lathe(cx, cz, [[0, y + 80], [10, y + 96], [0, y + 132]], 4, { flat: true });
    }
  });
  glow.glow = 0;
}
