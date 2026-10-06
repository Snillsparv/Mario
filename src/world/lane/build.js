// Sparrow Lane (area 'lane', see lane/layout.js): a WorldPart built in the course's local frame,
// which world/area.js places at its origin. The houses are written into its kit by
// lane/houses.js, the dad's front door by lane/door.js and the props (street furniture,
// greenery, the mailbox, the fences, the forest, the signposts) by lane/props.js.
//
//   buildLane(layout, { look, materials, replaced }?) -> { name: 'lane', object3D, colliders,
//                          update(time), setDoorOpen(t, id), reset() }
//   laneSteps(layout, options)   the same a step at a time: a generator whose next() runs a
//                   builder or two (a few ms) and whose return value is the part (the realistic
//                   build runs it over several frames; buildLane runs it through)
//     look          'classic' (the default: the baked N64 look below) or 'real' (the realistic
//                   look's visuals, world/lane/real/look.js: the same builders, unbaked, drawn with
//                   `materials`, a material per mesh name; its colliders are the classic build's
//                   to the byte, and only the classic build's are used)
//     replaced      the elements not drawn (default: REAL_DRAWN in the realistic look, none in
//                   the classic): the builders still make their colliders
//     round         the turning area drawn round (TURN_ROUND sides: world/lane/real/plan.js),
//                   the lawns and drives cut round it (default: in the realistic look); its
//                   colliders stay the 16-gon's
//   REAL_DRAWN      the elements the realistic look draws itself (world/lane/real/detail.js, in
//                   its worker); a builder asks kit.drawn(name) for the kit to draw one into: the
//                   kit, or one whose builders draw nothing (the same solids and signs)
//   REPEAT, REAL_REPEAT   world units a texture repeat spans in each mesh's uvs (the realistic
//                   look's own meshes in REAL_REPEAT)
//     update        per frame (world/area.js), the clock in seconds: the flags wave
//     setDoorOpen   the dad's front door (id 'lane_home', or none), 0 shut .. 1 standing open
//                   (core/AreaSwitch.js swings it as Jonas comes out of it and goes back in)
//
// The ground: the asphalt road (its west leg from the junction, the bend, the long straight) and
// the turning area at 0, granite kerbs along their edges (none at the drives); everything
// else a step up at GROUND: the north pavement (asphalt, paler), the drives, the dad's
// grass-paver path, the footpath, and lawn (the ground drawn as tiles with every road and hard
// surface cut out of them, so nothing lies over anything). Up the hill the villas' gardens are
// terraces (TERRACE) behind a retaining wall of split-face blocks (a paler coping along its
// top), cut by each villa's cobbled drive notch and its steps (drawn steps on a not-slippery
// ramp), their back gardens rising to the forest's bank. Out past the junction the road runs on
// into the fog with the side road; outside the boundary the forest bank (rising on far into the
// fog, so its crest never shows an edge against the sky) and a ring of firs (the drawn edge the
// camera sees).
//
// Unlit worldMaterial meshes with the lighting baked into vertex colours under the low golden
// sun (LANE_SUN, a warm tint), one mesh per material, thirteen: lane-asphalt (the road, the
// turning area, the pavement, the drives and the footpath), -grass (lawns, terraces, verges, the
// bank), -blocks (the terraces' walls, the steps, the kerbs, the corner bed's stones), -brick (the
// castle's stone bricks tinted: the villas' upper floors, the chain houses' white brick plinths
// and gable ends), -render (white render, and every flat-coloured detail by vertex tint: frames,
// panes, doors, poles, the bins, the mailbox and its sparrow, the cars, the hoop, the trampoline,
// the red-leaf tree's crown and the leaves fallen in its bed, soffits and fascias, the vestibule
// behind the dad's door), -boards (the skerries' painted planks upright: the chain
// houses' boards, gables, the fences), -roof (pan tiles, the flat roofs' felt), -cobbles (the
// drives' cobbles, the north-west villa's flagstones, the patio, the flower beds' soil), -leaves
// (hedges, thujas, canopies, firs), -wood (trunks, tree bark), -cloth (the flags, both faces,
// waving: props.js waveFlags), -signs, and -door (the dad's door's leaf, render's material,
// turning on its hinge).
//
// The realistic look (look 'real') builds the same faces without the bake (the vertex colours
// are the tints and the painted shades: the materials light them), with three meshes of its own
// that the classic look draws in render's and grass's builders: lane-glass (the panes; the
// houses hang a dim room behind each), lane-paint (frames, doors, fascias, soffits, poles, the
// railings...) and lane-path (the dad's grass-paver path); its roofs' uvs run along their slopes
// (the tile courses lie across them), its lawns' tints are made grey (the lawn texture is green
// itself) and its signs stay baked. It leaves out what it draws itself (REAL_DRAWN: the worker's
// world/lane/real/detail.js builds those: the chain houses, the plants and the forest, the cars,
// the kerbs, the posts, fences and bins, the villas' walls and windows, the garage doors, the
// toys, the motorhome, the cabinet, the mailbox) and draws its turning area round.
//
// Colliders, all { positions, terrain[, surface] } (world/area.js shifts them): the road and
// every hard surface (stone), the lawns and the terraces' tops (grass), the terraces' walls and
// the drives' sides (stone), the steps (a not-slippery ramp), the invisible boundary walls (from
// -200 up to BOUNDS_TOP, facing in), the houses (houses.js), the props (props.js), the signposts.
// The climbable poles are layout.POLES (world/area.js adds them).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder, polyArea, subtractConvex } from '../castle/geom.js';
import { stoneTexture, woodTexture } from '../castle/textures.js';
import { flagstoneTexture, grassTexture, masonryTexture } from '../terrainTextures.js';
import { MeshBuilder, bakedMesh } from '../props/geom.js';
import { leafTexture, woodTexture as signWoodTexture } from '../props/textures.js';
import { faluPlankTexture, sailTexture } from '../skerries/textures.js';
import { asphaltTexture, panTileTexture, renderTexture } from './textures.js';
import { frame, house, link, carport } from './houses.js';
import { doorLeaf, frontDoor } from './door.js';
import { propsSteps, waveFlags, dadCar } from './props.js';
import { normals, band, roadPieces, kerbRuns } from './real/plan.js';

// World units per texture repeat (projected UVs; the cloth's UVs are set per face).
export const REPEAT = { asphalt: 600, grass: 480, blocks: 240, brick: 180, render: 300, boards: 300, roof: 260, cobbles: 160, leaves: 260, wood: 300, cloth: 1 };

// Vertex tints (sRGB).
const TINT = {
  road: 0x76746f,
  pavement: 0x8a8780,
  drive: 0x7c7a74,
  footpath: 0x84827c,
  kerb: 0xb8b2a8,
  bedEdge: 0x4e3c30, // (the dad's corner bed's soil, at the asphalt's edge)
  lawn: 0x6e9a40,
  backLawn: 0x5f8a38,
  bank: 0x3e5a2a,
  path: 0x8a9a78, // the grass-paver path: grass tinted grey-green
  walls: 0xc2b8a8,
  coping: 0xd8d0c2,
  steps: 0xc8c2b8,
  cobbles: 0xb8ae9e,
  flags: 0xd8d4cc,
  railing: 0x2a2a2a,
  patio: 0xa8a6a0,
};

const UP = [0, 1, 0];
// Golden hour, a touch warmer than the skerries'.
export const LIGHT = { ambient: 0.6, diffuse: 0.55, maxBright: 1.1, tint: [1.07, 1.0, 0.9] };
const GROUND_RECT = { x0: -16000, x1: 16000, z0: -8000, z1: 10000, tile: 2000 };
const ARC_STEP = 300; // the terraces' fronts along the turning area: straight this long
const KERB_LIFT = 1.5; // the kerbs' tops over the lawn and the pavement beside them
// The bank: up to its top over `depth`, on a little higher `beyond`, then rising on `far` more
// to `crest` over its top, out in the fog.
const BANK = { depth: 1200, beyond: 2600, far: 200, out: 9000, crest: 2600 };
const CARPORT_SHADE = 0.62; // the drive's asphalt under the carport's roof
// The realistic look's own meshes (their repeats; the classic look draws them in render's and
// grass's builders).
export const REAL_REPEAT = { glass: 300, paint: 300, path: 240 };
export const REAL_DRAWN = Object.freeze(['mailbox', 'plants', 'forest', 'chain', 'cars', 'kerbs', 'posts', 'fences', 'bins', 'villas', 'villaWindows', 'garageDoors', 'toys', 'motorhome', 'cabinet', 'antennas']);

// A builder that draws nothing (every method a no-op, chainable).
const NOTHING = new Proxy({}, { get: () => () => NOTHING, set: () => true });

// A roof's builder in the realistic look: uvs along each slope (u along its contour, v up it from
// the eaves), so the tile texture's courses lie across every slope; flat and steep faces as any.
class SlopeBuilder extends GeoBuilder {
  project(p, n) {
    if (n[1] < 0.2 || n[1] > 0.995) return super.project(p, n);
    const s = 1 / this.repeat;
    const h = Math.hypot(n[0], n[2]);
    const hx = n[2] / h;
    const hz = -n[0] / h;
    // Up the slope: +y less its part along the normal.
    const ux = -n[0] * n[1];
    const uy = 1 - n[1] * n[1];
    const uz = -n[2] * n[1];
    const ul = Math.hypot(ux, uy, uz);
    return [(p[0] * hx + p[2] * hz) * s, ((p[0] * ux + p[1] * uy + p[2] * uz) / ul) * s];
  }
}

export function buildLane(layout, options) {
  const steps = laneSteps(layout, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// buildLane a step at a time (a generator: each next() runs a builder or two, a few ms; its
// return value the part): the realistic build runs it over several frames.
export function* laneSteps(layout, { look = 'classic', materials = null, replaced = look === 'real' ? REAL_DRAWN : [], round = look === 'real' } = {}) {
  const real = look === 'real';
  const kit = { look, solids: new SolidBuilder(), signs: { wood: new MeshBuilder(), colliders: { wood: [] }, shadow: () => {} }, groundAt: layout.groundHeight };
  for (const name of Object.keys(REPEAT)) kit[name] = new (real && name === 'roof' ? SlopeBuilder : GeoBuilder)(REPEAT[name]);
  kit.glass = real ? new GeoBuilder(REAL_REPEAT.glass) : kit.render;
  kit.paint = real ? new GeoBuilder(REAL_REPEAT.paint) : kit.render;
  kit.path = real ? new GeoBuilder(REAL_REPEAT.path) : kit.grass;
  // The movers (what objects move about: the bins, the charger's cable), each a builder of its
  // own drawn in its own frame (kit.mover(id); lane/build.js wraps them: part.movers).
  kit.movers = {};
  kit.mover = (id) => (kit.movers[id] ??= new GeoBuilder(real ? REAL_REPEAT.paint : REPEAT.render));
  const hidden = { ...kit };
  for (const name of [...Object.keys(REPEAT), ...Object.keys(REAL_REPEAT)]) hidden[name] = NOTHING;
  hidden.mover = () => NOTHING;
  kit.drawn = (name) => (replaced.includes(name) ? hidden : kit);
  hidden.drawn = kit.drawn;
  const road = roadPieces(layout);
  if (round) {
    // The realistic look draws the turning area round (the lawns and the drives cut round it)
    // and its own granite kerbs (world/lane/real/garden.js); the colliders keep the 16-gon.
    ground(hidden, layout, road);
    yield;
    ground({ ...kit, solids: NOTHING }, layout, roadPieces(layout, { round: true }));
  } else ground(kit, layout, road);
  yield;
  kerbs(kit.drawn('kerbs'), layout, road);
  terraces(kit, layout);
  yield;
  bank(kit, layout);
  boundary(kit, layout);
  yield;
  for (const h of layout.HOUSES) {
    house(kit, h);
    yield;
  }
  link(kit, layout.LINK);
  carport(kit, layout.CARPORT);
  const leaf = frontDoor(kit, layout);
  yield;
  yield* propsSteps(kit, layout);
  return real ? assembleReal(kit, layout, leaf, materials) : assemble(kit, layout, leaf);
}

// ---------------------------------------------------------------- meshes

function assemble(kit, layout, leaf) {
  const lit = { ...LIGHT, sun: layout.LANE_SUN };
  const group = new THREE.Group();
  group.name = 'lane';
  const materials = {};
  const add = (name, map, opts) => {
    const material = worldMaterial({ map, ...opts });
    const mesh = new THREE.Mesh(bakeLighting(kit[name].toGeometry(), lit), material);
    mesh.name = `lane-${name}`;
    group.add(mesh);
    materials[name] = material;
    return mesh;
  };
  add('asphalt', asphaltTexture());
  add('grass', grassTexture());
  add('blocks', masonryTexture());
  add('brick', stoneTexture());
  add('render', renderTexture());
  add('boards', faluPlankTexture());
  add('roof', panTileTexture());
  add('cobbles', flagstoneTexture());
  add('leaves', leafTexture());
  add('wood', woodTexture());
  const wave = waveFlags(add('cloth', sailTexture(), { side: THREE.DoubleSide }).geometry, layout);
  group.add(bakedMesh('lane-signs', kit.signs.wood, worldMaterial({ map: signWoodTexture() }), lit));
  // The dad's front door's leaf, in render's material, turning on its hinge (setDoorOpen).
  const door = doorLeaf(leaf, materials.render, (geo) => bakeLighting(geo, lit));
  group.add(door.mesh);
  // The movers in render's material, baked: the bins (one instanced mesh, each at home), the
  // charger's cable.
  const movers = {};
  if (kit.movers.bins) movers.bins = binsMesh(bakeLighting(kit.movers.bins.toGeometry(), lit), materials.render, layout);
  if (kit.movers.charger_cable) {
    movers.charger_cable = new THREE.Mesh(bakeLighting(kit.movers.charger_cable.toGeometry(), lit), materials.render);
    movers.charger_cable.name = 'lane-cable';
  }
  for (const m of Object.values(movers)) group.add(m);
  // The dad's car's faces are lane-render's last (props.js draws it last): hidden from there.
  const hide = {};
  for (const [id, at] of Object.entries(kit.hideAt ?? {})) hide[id] = { 'lane-render': at.paint };
  return lanePart(kit, group, wave, door, movers, hide, layout);
}

// The bins' instanced mesh (lane-bins): one bin drawn in its own frame (origin at its foot's
// middle), an instance for each of layout.BINS at home; its bounds cover the bins' leash (they
// move: objects/laneBoss/LaneBins.js writes the instances).
export function binsMesh(geometry, material, layout) {
  const mesh = new THREE.InstancedMesh(geometry, material, layout.BINS.length);
  mesh.name = 'lane-bins';
  const m = new THREE.Matrix4();
  layout.BINS.forEach((b, i) => mesh.setMatrixAt(i, m.makeTranslation(b.x, layout.GROUND, b.z)));
  mesh.instanceMatrix.needsUpdate = true;
  const L = layout.BIN_LEASH;
  const r = Math.hypot((L.x1 - L.x0) / 2 + layout.BIN.x, (L.z1 - L.z0) / 2 + layout.BIN.x, layout.BIN.h);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3((L.x0 + L.x1) / 2, layout.GROUND, (L.z0 + L.z1) / 2), r);
  return mesh;
}

// The realistic look's meshes: unbaked, in `materials` (by mesh name: the classic ones, glass,
// paint and path; signs, baked as in the classic look), every one but the ground and the glass
// casting the sun's shadow, all receiving it.
function assembleReal(kit, layout, leaf, materials) {
  const group = new THREE.Group();
  group.name = 'lane-real';
  greyLawns(kit.grass, TINT.lawn);
  const add = (name) => {
    if (!kit[name].pos.length) return null; // (the elements it draws itself only)
    const mesh = new THREE.Mesh(kit[name].toGeometry(), materials[name]);
    mesh.name = `lane-${name}`;
    mesh.castShadow = !REAL_FLAT.has(name);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const name of Object.keys(REPEAT)) if (name !== 'cloth') add(name);
  for (const name of Object.keys(REAL_REPEAT)) add(name);
  const wave = waveFlags(add('cloth').geometry, layout);
  const signs = bakedMesh('lane-signs', kit.signs.wood, materials.signs, { ...LIGHT, sun: layout.LANE_SUN });
  signs.castShadow = true;
  group.add(signs);
  const door = doorLeaf(leaf, materials.paint, (geo) => geo);
  door.mesh.castShadow = door.mesh.receiveShadow = true;
  group.add(door.mesh);
  // The charger's cable (a mover; the bins and the dad's car's hide range come with the
  // worker's detail: world/lane/real/look.js).
  const movers = {};
  if (kit.movers.charger_cable) {
    const cable = new THREE.Mesh(kit.movers.charger_cable.toGeometry(), materials.paint);
    cable.name = 'lane-cable';
    cable.castShadow = cable.receiveShadow = true;
    group.add(cable);
    movers.charger_cable = cable;
  }
  return lanePart(kit, group, wave, door, movers, {}, layout);
}

// The realistic look's meshes that cast no shadow: the ground's (nothing stands under them) and
// the glass.
const REAL_FLAT = new Set(['asphalt', 'grass', 'cobbles', 'path', 'glass']);

// The lawns' tints made grey for the realistic look (its lawn texture is green itself): each
// vertex the luminance of its tint over the lawn's, at most 1.2, so the back gardens, the bank
// and the soft swaths stay as much darker or lighter as they were.
function greyLawns(b, lawn) {
  const c = new THREE.Color(lawn);
  const ref = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const col = b.col;
  for (let i = 0; i < col.length; i += 3) {
    const k = Math.min(1.2, (0.2126 * col[i] + 0.7152 * col[i + 1] + 0.0722 * col[i + 2]) / ref);
    col[i] = col[i + 1] = col[i + 2] = k;
  }
}

function lanePart(kit, group, wave, door, movers, hide, layout) {
  const colliders = kit.solids.colliders();
  colliders.push({ positions: kit.signs.colliders.wood, terrain: 'wood' });
  return {
    name: 'lane',
    object3D: group,
    colliders,
    movers,
    hide,
    // A car with an id (the dad's) drawn in its own frame into `paint` (a GeoBuilder), telling
    // mark(zone) each part of the drawing (lane/props.js dadCar: the lane's boss's pieces), and the
    // classic look's bake (what lights it: the boss lights its robot the same way).
    ownCar: (id, paint, mark) => dadCar(paint, layout, layout.CARS.find((c) => c.id === id), mark),
    light: { ...LIGHT, sun: layout.LANE_SUN },
    // Per frame: the flags wave (no allocation).
    update(time) {
      wave(time);
    },
    // The dad's front door (the course's one swinging door), 0 shut .. 1 standing open.
    setDoorOpen(t, id = null) {
      if (id === null || id === 'lane_home') door.setOpen(t);
    },
    // A new game: nothing of the course's own changes (the pickups live in its objects).
    reset() {},
  };
}

// ---------------------------------------------------------------- 2D helpers ([x, z] outlines)

// Whether two convex outlines overlap (separating axes; touching is no overlap).
function overlaps(a, b) {
  for (const poly of [a, b]) {
    const ns = normals(poly);
    for (const [nx, nz] of ns) {
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const [x, z] of a) {
        const d = x * nx + z * nz;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const [x, z] of b) {
        const d = x * nx + z * nz;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (a1 <= b0 + 0.5 || b1 <= a0 + 0.5) return false;
    }
  }
  return true;
}

// The convex pieces of `poly` left once every hole that overlaps it is cut out (each without
// repeated corners: clipping leaves some).
function cutOut(poly, holes) {
  let pieces = [poly];
  for (const hole of holes) {
    const next = [];
    for (const p of pieces) {
      if (overlaps(p, hole)) next.push(...subtractConvex(p, hole).map(clean));
      else next.push(p);
    }
    pieces = next;
  }
  return pieces;
}

// An outline without corners repeated one after another.
function clean(poly) {
  return poly.filter(([x, z], i) => {
    const [px, pz] = poly[(i + poly.length - 1) % poly.length];
    return Math.abs(x - px) > 0.01 || Math.abs(z - pz) > 0.01;
  });
}

const rectOf = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const at = (outline, y) => outline.map(([x, z]) => [x, y, z]);

// ---------------------------------------------------------------- the ground

// The hard surfaces a step up at GROUND (each its outline, builder, tint and shade): the
// pavement, the drives and the notches' cobbles, the dad's grass-paver path, his drive (darker
// under the carport) and the link's, the drive east of the turning area to the double garage,
// the north-west villa's flagstones, the footpath, the dad's patio.
function hardSurfaces(L, road) {
  const out = [];
  const add = (outline, mat, tint, shade = 1) => {
    for (const piece of cutOut(outline, road)) out.push({ outline: piece, mat, tint, shade });
  };
  // The pavement: along the bend and the straight, on its north side, up to the turning area.
  const line = L.ROAD.line.slice(1);
  const pave = band(line, L.PAVEMENT.from, L.PAVEMENT.to);
  for (const q of pave) add(q.map(([x, z]) => [Math.min(x, L.PAVEMENT.x1), z]), 'asphalt', TINT.pavement);
  for (const p of L.PLOTS_N) {
    const v = L.villaOf(p);
    const [d0, d1] = p.drive;
    add([[d0, L.wallZAt(d0)], [d1, L.wallZAt(d1)], [d1, v.front], [d0, v.front]], 'cobbles', TINT.cobbles);
  }
  add(rectOf(L.DAD_PATH.x0, L.DAD_PATH.x1, L.DAD_PATH.z0, L.DAD_PATH.z1), 'path', TINT.path);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.DAD_DRIVE.z0, L.DAD_DRIVE.z1), 'asphalt', TINT.drive);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.DAD_DRIVE.z1, L.CARPORT.z1), 'asphalt', TINT.drive, CARPORT_SHADE);
  add(rectOf(L.LINK_DRIVE.x0, L.LINK_DRIVE.x1, L.LINK_DRIVE.z0, L.LINK_DRIVE.z1), 'asphalt', TINT.drive);
  add(rectOf(L.PATIO.x0, L.PATIO.x1, L.PATIO.z0, L.PATIO.z1), 'cobbles', TINT.patio);
  add(rectOf(L.TURN.x + 800, L.EAST_GARAGE.cx - L.EAST_GARAGE.d / 2, L.EAST_GARAGE.cz - L.EAST_GARAGE.w / 2, L.EAST_GARAGE.cz + L.EAST_GARAGE.w / 2), 'asphalt', TINT.drive);
  const F = frame(L.NORTH_WEST);
  const D = L.NORTH_WEST_DRIVE;
  add([[D.u0, D.w0], [D.u1, D.w0], [D.u1, D.w1], [D.u0, D.w1]].map(([u, w]) => {
    const p = F.at(u, 0, w);
    return [p[0], p[2]];
  }), 'cobbles', TINT.flags);
  const P = L.FOOTPATH;
  const fp = (t, s) => {
    const p = L.footpathAt(t, s);
    return [p.x, p.z];
  };
  add([fp(P.from, P.half), fp(P.from, -P.half), fp(P.len, -P.half), fp(P.len, P.half)], 'asphalt', TINT.footpath);
  return out;
}

// The ground: the road and the turning area at 0 (asphalt), the hard surfaces and the lawn at
// GROUND (the lawn drawn as tiles with the road, the hard surfaces and the terraces cut out),
// drawn over GROUND_RECT and solid where Jonas can be (inside the boundary's box).
function ground(kit, L, road) {
  const { asphalt, grass, solids } = kit;
  const G = L.GROUND;
  const xs = L.BOUNDS.map((p) => p[0]);
  const zs = L.BOUNDS.map((p) => p[1]);
  const reach = rectOf(Math.min(...xs) - 600, Math.max(...xs) + 600, Math.min(...zs) - 600, Math.max(...zs) + 600);
  const solid = (outline) => overlaps(outline, reach);
  // Soft light and dark swaths over the asphalt and the lawns.
  const swath = (x, z) => 0.93 + 0.07 * Math.sin(x / 530 + Math.cos(z / 610)) * Math.cos(z / 470 - x / 900);
  asphalt.color(TINT.road);
  for (const piece of road) {
    asphalt.poly(at(piece, 0), { facing: UP, shade: piece.map(([x, z]) => swath(x, z)) });
    if (solid(piece)) solids.face(at(piece, 0), UP, 'stone');
  }
  const hard = hardSurfaces(L, road);
  for (const { outline, mat, tint, shade } of hard) {
    kit[mat].color(tint, shade);
    kit[mat].poly(at(outline, G), { facing: UP, shade: outline.map(([x, z]) => swath(x, z)) });
    if (solid(outline)) solids.face(at(outline, G), UP, 'stone');
  }
  // The lawn, tile by tile, round everything else; the terraces' plots are cut out too (their
  // blocks stand there).
  const holes = [...road, ...hard.map((h) => h.outline)];
  for (const p of L.PLOTS_N) {
    let front = 0;
    for (let x = p.x0; x <= p.x1; x += 100) front = Math.max(front, -L.wallZAt(x));
    holes.push(rectOf(p.x0, p.x1, L.NORTH.backZ, -front));
  }
  const T = GROUND_RECT;
  for (let x = T.x0; x < T.x1; x += T.tile) {
    for (let z = T.z0; z < T.z1; z += T.tile) {
      for (const piece of cutOut(rectOf(x, x + T.tile, z, z + T.tile), holes)) {
        grass.color(lawnTint(L, piece));
        grass.poly(at(piece, G), { facing: UP, shade: piece.map(([px, pz]) => swath(px, pz)) });
        if (solid(piece)) solids.face(at(piece, G), UP, 'grass');
      }
    }
  }
}

// A lawn piece's tint: the back gardens behind the chain houses a little darker, the rest the
// front lawns' green.
function lawnTint(L, piece) {
  const z = piece.reduce((s, p) => s + p[1], 0) / piece.length;
  return z > L.DAD.z1 ? TINT.backLawn : TINT.lawn;
}

// The kerbs: along every edge of the road's pieces that is the road's edge (plan.js kerbRuns:
// clipped exactly where another piece begins, so no stub or gap where two meet), a granite face
// from the road up to GROUND and a strip along its top; none in front of the drives (the
// asphalt runs on up into them: a bevel from the road to the drive's edge) or along the dad's
// corner bed (its field stones edge the asphalt: its soil's face up to the bed's top, lane/
// props.js dadsGarden lays the stones along it).
function kerbs(kit, L, road) {
  const { blocks, asphalt, cobbles } = kit;
  const G = L.GROUND;
  for (const { p, q, n: [nx, nz], kind } of kerbRuns(L, road)) {
    if (kind === 'drop') {
      // (At a drive the asphalt runs on up into it: a bevel from the road to its edge.)
      const D = 22;
      asphalt.color(TINT.drive);
      asphalt.poly([[p[0] - nx * D, 0.4, p[1] - nz * D], [q[0] - nx * D, 0.4, q[1] - nz * D], [q[0], G, q[1]], [p[0], G, p[1]]], { facing: [-nx, 1, -nz], shade: 0.95 });
      continue;
    }
    const b = kind === 'kerb' ? blocks : cobbles;
    const top = kind === 'kerb' ? G + KERB_LIFT : G + L.BED.raise;
    b.color(kind === 'kerb' ? TINT.kerb : TINT.bedEdge);
    b.poly([[p[0], -2, p[1]], [q[0], -2, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], { facing: [-nx, 0, -nz], shade: 0.82 });
    if (kind === 'kerb') {
      const w = L.KERB.w;
      b.poly([[p[0], top, p[1]], [q[0], top, q[1]], [q[0] + nx * w, top, q[1] + nz * w], [p[0] + nx * w, top, p[1] + nz * w]], { facing: UP, shade: 1.05 });
    }
  }
}

// ---------------------------------------------------------------- the terraces

// The villas' gardens up the hill: per plot, convex blocks from under the ground up to the
// terrace (their tops grass, their fronts split-face blocks under a paler coping), each with a
// straight front (along the turning area, ARC_STEP long), cut by the steps (a ramp collider,
// drawn steps, a railing on their drive side) and the drive notch; where two blocks' fronts
// differ (a notch's sides, the wall's jog at the turning area) the deeper one's neighbour shows
// its side; behind them the back gardens' ramp up to the forest's edge.
function terraces(kit, L) {
  const { NORTH: N, STEPS: S } = L;
  for (const p of L.PLOTS_N) {
    const v = L.villaOf(p);
    const [s0, s1] = p.steps;
    const [d0, d1] = p.drive;
    const stepsZ = L.wallZAt(s0) - S.run;
    const spans = [
      [p.x0, s0, null],
      [s0, s1, stepsZ],
      [s1, d0, null],
      [d0, d1, v.front],
      [d1, p.x1, null],
    ];
    const blocks = [];
    for (const [xa, xb, notchZ] of spans) {
      // Cut where the wall's line bends round the turning area, and where it jogs back.
      const cuts = [xa, xb];
      const bend = L.PAVEMENT.x1;
      if (notchZ === null) {
        for (let x = Math.max(xa, bend) + ARC_STEP; x < xb; x += ARC_STEP) cuts.push(x);
        if (xa < bend && xb > bend) cuts.push(bend);
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [a, b] = [cuts[i], cuts[i + 1]];
        if (b - a < 1) continue;
        blocks.push({ a, b, za: notchZ ?? L.wallZAt(a + 0.01), zb: notchZ ?? L.wallZAt(b), notch: notchZ !== null });
      }
    }
    for (const b of blocks) block(kit, L, b);
    // The sides where neighbouring fronts differ: the one nearer the street shows its side.
    for (let i = 0; i + 1 < blocks.length; i++) {
      const [prev, next] = [blocks[i], blocks[i + 1]];
      if (Math.abs(prev.zb - next.za) < 1) continue;
      if (prev.zb > next.za) side(kit, L, prev.b, next.za, prev.zb, 1);
      else side(kit, L, next.a, prev.zb, next.za, -1);
    }
    // The plots' open ends (west of the first, east of the last).
    if (p === L.PLOTS_N[0]) side(kit, L, p.x0, N.flatZ, blocks[0].za, -1);
    if (p === L.PLOTS_N.at(-1)) side(kit, L, p.x1, N.flatZ, blocks.at(-1).zb, 1);
    steps(kit, L, p, stepsZ);
    // The back gardens' ramp up to the forest's edge: one wedge across the plot.
    const [x0, x1] = [p.x0, p.x1];
    const faces = [
      [[[x0, N.top, N.flatZ], [x1, N.top, N.flatZ], [x1, N.backTop, N.backZ], [x0, N.backTop, N.backZ]], [0, 1, (N.backTop - N.top) / (N.flatZ - N.backZ)], 'grass'],
      [[[x0, -100, N.backZ], [x1, -100, N.backZ], [x1, N.backTop, N.backZ], [x0, N.backTop, N.backZ]], [0, 0, -1], 'stone'],
      [[[x0, -100, N.flatZ], [x0, N.top, N.flatZ], [x0, N.backTop, N.backZ], [x0, -100, N.backZ]], [-1, 0, 0], 'stone'],
      [[[x1, -100, N.flatZ], [x1, N.top, N.flatZ], [x1, N.backTop, N.backZ], [x1, -100, N.backZ]], [1, 0, 0], 'stone'],
      [[[x0, -100, N.flatZ], [x1, -100, N.flatZ], [x1, N.top, N.flatZ], [x0, N.top, N.flatZ]], [0, 0, 1], 'stone'],
    ];
    for (const [f, facing, terrain] of faces) kit.solids.face(f, facing, terrain);
    kit.grass.color(TINT.backLawn);
    kit.grass.poly(faces[0][0], { facing: faces[0][1] });
    kit.blocks.color(TINT.walls);
    if (p === L.PLOTS_N[0]) kit.blocks.poly(faces[2][0], { facing: [-1, 0, 0] });
    if (p === L.PLOTS_N.at(-1)) kit.blocks.poly(faces[3][0], { facing: [1, 0, 0] });
  }
}

// One terrace block from x a to b, its front from (a, za) to (b, zb), back to NORTH.flatZ, from
// under the ground up to the terrace: its top (grass) and, unless it stands behind a notch (the
// villa's front or the steps' ramp hides it there), its front (blocks under a paler coping);
// solid (its sides and back too).
function block(kit, L, { a, b, za, zb, notch }) {
  const { grass, blocks, solids } = kit;
  const top = L.NORTH.top;
  const back = L.NORTH.flatZ;
  const y0 = -100;
  const footprint = [[a, za], [b, zb], [b, back], [a, back]];
  grass.color(TINT.lawn);
  grass.poly(at(footprint, top), { facing: UP });
  solids.face(at(footprint, top), UP, 'grass');
  const out = [-(zb - za), 0, b - a]; // (toward the street)
  const front = (ya, yb) => [[a, ya, za], [b, ya, zb], [b, yb, zb], [a, yb, za]];
  if (!notch) {
    blocks.color(TINT.walls);
    blocks.poly(front(0, top - 16), { facing: out, shade: [0.86, 0.86, 1, 1] });
    blocks.color(TINT.coping);
    blocks.poly(front(top - 16, top + 1), { facing: out });
    const l = Math.hypot(b - a, zb - za);
    const [ix, iz] = [(-out[0] / l) * 30, (-out[2] / l) * 30];
    blocks.poly([[a, top + 1, za], [b, top + 1, zb], [b + ix, top + 1, zb + iz], [a + ix, top + 1, za + iz]], { facing: UP, shade: 1.04 });
  }
  solids.face(front(y0, top), out, 'stone');
  solids.face([[a, y0, za], [a, y0, back], [a, top, back], [a, top, za]], [-1, 0, 0], 'stone');
  solids.face([[b, y0, zb], [b, y0, back], [b, top, back], [b, top, zb]], [1, 0, 0], 'stone');
  solids.face([[a, y0, back], [b, y0, back], [b, top, back], [a, top, back]], [0, 0, -1], 'stone');
}

// A terrace block's side showing at x between z0 and z1 (blocks), facing `s` along x.
function side(kit, L, x, z0, z1, s) {
  kit.blocks.color(TINT.walls);
  kit.blocks.poly([[x, 0, z0], [x, 0, z1], [x, L.NORTH.top, z1], [x, L.NORTH.top, z0]], { facing: [s, 0, 0], shade: [0.82, 0.82, 0.95, 0.95] });
}

// A villa's steps from the street up to its terrace: a smooth ramp collider (not slippery)
// under STEPS.n drawn steps, a dark railing along their drive side.
function steps(kit, L, p, stepsZ) {
  const { blocks, paint, solids } = kit;
  const { STEPS: S, GROUND: G, NORTH: N } = L;
  const [x0, x1] = p.steps;
  const z0 = L.wallZAt(x0);
  const top = N.top;
  const wedge = [
    [[x0, G, z0], [x1, G, z0], [x1, top, stepsZ], [x0, top, stepsZ]],
    [[x0, G - 30, z0], [x0, G, z0], [x0, top, stepsZ], [x0, G - 30, stepsZ]],
    [[x1, G - 30, z0], [x1, G, z0], [x1, top, stepsZ], [x1, G - 30, stepsZ]],
    [[x0, G - 30, stepsZ], [x1, G - 30, stepsZ], [x1, top, stepsZ], [x0, top, stepsZ]],
  ];
  solids.solid(wedge, 'stone', 'not_slippery');
  const tread = S.run / S.n;
  const step = (top - G) / S.n;
  blocks.color(TINT.steps);
  for (let i = 0; i < S.n; i++) {
    const y = G + step * (i + 1);
    const za = z0 - tread * (i + 0.5);
    const zb = i === S.n - 1 ? stepsZ : za - tread;
    blocks.poly([[x0, y - step, za], [x1, y - step, za], [x1, y, za], [x0, y, za]], { facing: [0, 0, 1], shade: 0.8 });
    blocks.poly([[x0, y, za], [x1, y, za], [x1, y, zb], [x0, y, zb]], { facing: UP, shade: 1.08 });
  }
  // The first step's riser from the street.
  blocks.poly([[x0, G, z0], [x1, G, z0], [x1, G + step, z0 - tread / 2], [x0, G + step, z0 - tread / 2]], { facing: [0, 0.3, 1], shade: 0.9 });
  // The railing: posts and a handrail up the drive side.
  paint.color(TINT.railing);
  const rail = S.rail;
  for (const k of [0, 0.5, 1]) {
    const z = z0 - 10 - (S.run - 20) * k;
    const y = G + (top - G) * Math.min(1, (z0 - z) / S.run);
    paint.box(x1 - 14, x1 - 6, y, y + rail, z - 4, z + 4, { bottom: false });
  }
  const yA = G + rail;
  const yB = top + rail;
  paint.solid([
    [[x1 - 16, yA, z0 - 10], [x1 - 4, yA, z0 - 10], [x1 - 4, yA + 8, z0 - 10], [x1 - 16, yA + 8, z0 - 10]],
    [[x1 - 16, yB, stepsZ + 10], [x1 - 4, yB, stepsZ + 10], [x1 - 4, yB + 8, stepsZ + 10], [x1 - 16, yB + 8, stepsZ + 10]],
    [[x1 - 16, yA + 8, z0 - 10], [x1 - 4, yA + 8, z0 - 10], [x1 - 4, yB + 8, stepsZ + 10], [x1 - 16, yB + 8, stepsZ + 10]],
    [[x1 - 16, yA, z0 - 10], [x1 - 4, yA, z0 - 10], [x1 - 4, yB, stepsZ + 10], [x1 - 16, yB, stepsZ + 10]],
    [[x1 - 16, yA, z0 - 10], [x1 - 16, yA + 8, z0 - 10], [x1 - 16, yB + 8, stepsZ + 10], [x1 - 16, yB, stepsZ + 10]],
    [[x1 - 4, yA, z0 - 10], [x1 - 4, yA + 8, z0 - 10], [x1 - 4, yB + 8, stepsZ + 10], [x1 - 4, yB, stepsZ + 10]],
  ]);
}

// ---------------------------------------------------------------- outside the boundary

// The forest's bank behind the back gardens: from their back edge up to NORTH.bankTop over
// BANK.depth, on beyond and then up again far out into the fog to its crest (and west of the
// plots, up from the lawn behind the north-west villa); its firs are props.js's.
function bank(kit, L) {
  const { grass } = kit;
  const N = L.NORTH;
  const strips = [
    { from: [-9600, -2200], to: [-6400, -4000], foot: L.GROUND },
    { from: [-6400, -4000], to: [L.PLOTS_N[0].x0, N.backZ], foot: L.GROUND },
    { from: [L.PLOTS_N[0].x0, N.backZ], to: [GROUND_RECT.x1, N.backZ], foot: N.backTop },
  ];
  const rowsOf = (foot) => [[0, foot], [BANK.depth * 0.5, foot + (N.bankTop - foot) * 0.75], [BANK.depth, N.bankTop], [BANK.depth + BANK.beyond, N.bankTop + BANK.far], [BANK.depth + BANK.beyond + BANK.out, N.bankTop + BANK.crest]];
  // A band of quads between two edges (a(r), b(r): the points r rows out) facing out along n.
  const band = (a, b, rows, n) => {
    for (let r = 0; r + 1 < rows.length; r++) {
      grass.color(r === 0 ? TINT.backLawn : TINT.bank);
      grass.poly([a(r), b(r), b(r + 1), a(r + 1)], { facing: [-n[0] * 0.4, 1, -n[1] * 0.4], shade: r === 0 ? [1, 1, 0.9, 0.9] : 0.9 });
    }
  };
  let last = null;
  for (const { from, to, foot } of strips) {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const l = Math.hypot(dx, dz);
    // Outward: the strip's left (north and west of the play space).
    const n = [dz / l, -dx / l];
    const rows = rowsOf(foot);
    const out = (x, z, m) => (r) => [x + m[0] * rows[r][0], rows[r][1], z + m[1] * rows[r][0]];
    const k = Math.ceil(l / 1500);
    for (let i = 0; i < k; i++) band(out(from[0] + (dx * i) / k, from[1] + (dz * i) / k, n), out(from[0] + (dx * (i + 1)) / k, from[1] + (dz * (i + 1)) / k, n), rows, n);
    // The wedge between this strip and the one before it where they turn a corner.
    if (last && (last[0] !== n[0] || last[1] !== n[1])) band(out(from[0], from[1], last), out(from[0], from[1], n), rows, [last[0] + n[0], last[1] + n[1]]);
    last = n;
  }
}

// The boundary: invisible walls along BOUNDS from under the ground up to BOUNDS_TOP, each facing
// into the play space.
function boundary(kit, { BOUNDS, BOUNDS_TOP }) {
  const s = polyArea(BOUNDS) > 0 ? 1 : -1;
  for (let i = 0; i < BOUNDS.length; i++) {
    const [ax, az] = BOUNDS[i];
    const [bx, bz] = BOUNDS[(i + 1) % BOUNDS.length];
    const l = Math.hypot(bx - ax, bz - az);
    // In: the left of each edge of an outline whose signed area (x, z) is positive.
    const facing = [(-s * (bz - az)) / l, 0, (s * (bx - ax)) / l];
    kit.solids.face([[ax, -200, az], [bx, -200, bz], [bx, BOUNDS_TOP, bz], [ax, BOUNDS_TOP, az]], facing, 'stone');
  }
}
