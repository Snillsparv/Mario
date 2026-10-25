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
// the turning area's apron at 0, granite kerbs along their north edges and round the apron (none
// at the drives; along the south edge none: the asphalt's bevelled edge); everything else a step
// up at GROUND: the north pavement (asphalt, paler), the drives and forecourts, the dad's
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
// bank), -blocks (the terraces' walls, the steps, the kerbs, the corner bed's stones), -brick (fine
// running-bond brick, lane/textures.js, tinted: the villas' upper floors, the chain houses' white brick plinths
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
// toys, the motorhome, the cabinet, the mailbox).
//
// Colliders, all { positions, terrain[, surface] } (world/area.js shifts them): the road and
// every hard surface (stone), the lawns and the terraces' tops (grass), the terraces' walls and
// the drives' sides (stone), the steps (a not-slippery ramp), the invisible boundary walls (from
// -200 up to BOUNDS_TOP, facing in), the houses (houses.js), the props (props.js), the signposts.
// The climbable poles are layout.POLES (world/area.js adds them).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder, polyArea, subtractConvex } from '../castle/geom.js';
import { woodTexture } from '../castle/textures.js';
import { flagstoneTexture, grassTexture, masonryTexture } from '../terrainTextures.js';
import { MeshBuilder, bakedMesh } from '../props/geom.js';
import { leafTexture, woodTexture as signWoodTexture } from '../props/textures.js';
import { faluPlankTexture, sailTexture } from '../courseKit.js';
import { asphaltTexture, brickTexture, panTileTexture, renderTexture } from './textures.js';
import { frame, house, link, carport } from './houses.js';
import { doorLeaf, frontDoor } from './door.js';
import { propsSteps, waveFlags, dadCar } from './props.js';
import { normals, band, roadPieces, kerbRuns, terraceSpans } from './real/plan.js';

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
  lawn: 0xc8a050, // (over the green lawn texture: an autumn olive, as the photos' lawns: W1)
  backLawn: 0xb38f47,
  bank: 0x775e2c,
  path: 0xb0a47a, // the grass-paver path: grass tinted grey-olive
  walls: 0xc2b8a8,
  coping: 0xd8d0c2,
  steps: 0xc8c2b8,
  cobbles: 0xb8ae9e,
  flags: 0xd8d4cc,
  railing: 0x2a2a2a,
  patio: 0xa8a6a0,
  floor: 0x9a9890, // (the store room's concrete)
};
// The realistic look's asphalt tints (its light worn set, world/lane/real/jobs.js: the road a
// light neutral grey, the pavement a shade lighter, the drives darker: W1, against the photos).
const REAL_GROUND = { ...TINT, road: 0xf0e8de, pavement: 0xf4eeea, drive: 0xaeaaa6, footpath: 0xeae4dc, floor: 0xcfcdc6 };

const UP = [0, 1, 0];
// Golden hour, warmer than the skerries' (the photos' low sun: W1); the ambient a little up for
// the lower sun's weaker light on the ground.
export const LIGHT = { ambient: 0.64, diffuse: 0.55, maxBright: 1.1, tint: [1.1, 1.0, 0.86] };
const GROUND_RECT = { x0: -16000, x1: 16000, z0: -8000, z1: 10000, tile: 2000 };
const KERB_LIFT = 1.5; // the kerbs' tops over the lawn and the pavement beside them
// The bank: up to its top over NORTH.bank, on a little higher `beyond`, then rising on `far`
// more to `crest` over its top, out in the fog.
const BANK = { beyond: 2600, far: 200, out: 9000, crest: 2600 };
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
export function* laneSteps(layout, { look = 'classic', materials = null, replaced = look === 'real' ? REAL_DRAWN : [] } = {}) {
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
  ground(kit, layout, road);
  yield;
  kerbs(kit.drawn('kerbs'), layout, road, kit);
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
  carport(kit, layout.CARPORT, layout.GARAGE);
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
  add('brick', brickTexture());
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
    // The store room's leaves as pieces (houses.js carport: each board's vertex ranges in the
    // meshes its builders became; the lane's chunk throws them: objects/laneBoss/LaneGarage.js).
    garage: kit.garage,
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
// pavement (along the west leg, the bend and the straight, then narrowing over the apron's kerb S
// to the terraces' wall), the drives and the notches' cobbles, the dad's grass-paver path, his
// drive (darker under the carport's edge, the store room's concrete floor behind its door wall)
// and the link's, the double garage's forecourt east of the apron and the footway behind its east
// kerb, the north-west villa's flagstones (cut at the pavement), the footpath, the dad's patio.
function hardSurfaces(L, road, tints) {
  const out = [];
  const pavement = [];
  const add = (outline, mat, tint, shade = 1, cut = road) => {
    for (const piece of cutOut(outline, cut)) out.push({ outline: piece, mat, tint, shade });
  };
  // The pavement: on the line from the junction (its first point PAVEMENT.start along the west
  // leg) to x1, then over the kerb's S to the wall.
  const P = L.PAVEMENT;
  const [W0, W1] = L.ROAD.line;
  const t = (P.start - W1[0]) / (W0[0] - W1[0]);
  const line = [[W1[0] + (W0[0] - W1[0]) * t, W1[1] + (W0[1] - W1[1]) * t], ...L.ROAD.line.slice(1)];
  const A = L.APRON;
  const [c0, c1] = A.curve;
  const zEnd = L.wallZAt(c1);
  line[line.length - 1] = [P.x1, line.at(-1)[1]];
  const quads = band(line, P.from, P.to);
  // (Over the S: from its start, past its middle, to its end at the wall's next bend.)
  const bend = L.NORTH.wall.find(([x]) => x > P.x1);
  quads.push([[P.x1, A.kerb], [c0 + (c1 - c0) / 2, A.kerb], [c1, A.z0], [c1, zEnd], bend, [P.x1, L.wallZAt(P.x1)]]);
  for (const q of quads) {
    const before = out.length;
    add(q, 'asphalt', tints.pavement);
    pavement.push(...out.slice(before).map((h) => h.outline));
  }
  const cutPave = [...road, ...pavement];
  for (const p of L.PLOTS_N) {
    const v = L.villaOf(p);
    const [d0, d1] = p.drive;
    add([[d0, L.wallZAt(d0 + 0.01)], [d1, L.wallZAt(d1 - 0.01)], [d1, v.front], [d0, v.front]], 'cobbles', tints.cobbles, 1, cutPave);
  }
  add(rectOf(L.DAD_PATH.x0, L.DAD_PATH.x1, L.DAD_PATH.z0, L.DAD_PATH.z1), 'path', tints.path);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.DAD_DRIVE.z0, L.DAD_DRIVE.z1), 'asphalt', tints.drive);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.DAD_DRIVE.z1, L.GARAGE.wall), 'asphalt', tints.drive, CARPORT_SHADE);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.GARAGE.wall, L.CARPORT.z1), 'asphalt', tints.floor, 0.4);
  add(rectOf(L.LINK_DRIVE.x0, L.LINK_DRIVE.x1, L.LINK_DRIVE.z0, L.LINK_DRIVE.z1), 'asphalt', tints.drive);
  add(rectOf(L.PATIO.x0, L.PATIO.x1, L.PATIO.z0, L.PATIO.z1), 'cobbles', tints.patio);
  const C = L.FORECOURT;
  add(rectOf(C.x0, C.x1, C.z0, C.z1), 'asphalt', tints.drive);
  const F = frame(L.NORTH_WEST);
  add(L.northWestDrive().map(([u, w]) => {
    const p = F.at(u, 0, w);
    return [p[0], p[2]];
  }), 'cobbles', tints.flags, 1, cutPave);
  const FP = L.FOOTPATH;
  const fp = (t, s) => {
    const p = L.footpathAt(t, s);
    return [p.x, p.z];
  };
  add([fp(FP.from, FP.half), fp(FP.from, -FP.half), fp(FP.len, -FP.half), fp(FP.len, FP.half)], 'asphalt', tints.footpath);
  // The footway: from the forecourt down behind the east kerb to the footpath's east edge.
  const W = L.FOOTWAY;
  const [ex, ez] = fp(0, -FP.half);
  const along = (x) => ez + ((x - ex) * FP.dir[1]) / FP.dir[0];
  add([[W.x0, C.z1], [W.x1, C.z1], [W.x1, along(W.x1)], [W.x0, along(W.x0)]], 'asphalt', tints.footpath);
  return out;
}

// The ground: the road and the apron at 0 (asphalt), the hard surfaces and the lawn at GROUND
// (the lawn drawn as tiles with the road, the hard surfaces and the terraces cut out), drawn over
// GROUND_RECT and solid where Jonas can be (inside the boundary's box).
function ground(kit, L, road) {
  const { asphalt, grass, solids } = kit;
  const tints = kit.look === 'real' ? REAL_GROUND : TINT;
  const G = L.GROUND;
  const xs = L.BOUNDS.map((p) => p[0]);
  const zs = L.BOUNDS.map((p) => p[1]);
  const reach = rectOf(Math.min(...xs) - 600, Math.max(...xs) + 600, Math.min(...zs) - 600, Math.max(...zs) + 600);
  const solid = (outline) => overlaps(outline, reach);
  // Soft light and dark swaths over the asphalt and the lawns.
  const swath = (x, z) => 0.93 + 0.07 * Math.sin(x / 530 + Math.cos(z / 610)) * Math.cos(z / 470 - x / 900);
  asphalt.color(tints.road);
  for (const piece of road) {
    asphalt.poly(at(piece, 0), { facing: UP, shade: piece.map(([x, z]) => swath(x, z)) });
    if (solid(piece)) solids.face(at(piece, 0), UP, 'stone');
  }
  const hard = hardSurfaces(L, road, tints);
  for (const { outline, mat, tint, shade } of hard) {
    kit[mat].color(tint, shade);
    kit[mat].poly(at(outline, G), { facing: UP, shade: outline.map(([x, z]) => swath(x, z)) });
    if (solid(outline)) solids.face(at(outline, G), UP, 'stone');
  }
  // The lawn, tile by tile, round everything else; the terraces' blocks, their steps and their
  // back gardens' ramp are cut out too (they stand there).
  const holes = [...road, ...hard.map((h) => h.outline), ...terraceHoles(L)];
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
// asphalt runs on up into them: a bevel from the road to the drive's edge), along the south edge
// (the asphalt's edge bevelled up to the lawns) or along the dad's corner bed (its field stones
// edge the asphalt: its soil's face up to the bed's top, lane/props.js dadsGarden lays the
// stones along it).
function kerbs(kit, L, road, all = kit) {
  const { blocks, cobbles } = kit;
  const G = L.GROUND;
  for (const { p, q, n: [nx, nz], kind } of kerbRuns(L, road)) {
    if (kind === 'drop' || kind === 'edge') {
      // (At a drive the asphalt runs on up into it, and along the south edge up to the lawn: a
      // bevel from the road to its edge; the south edge's in both looks, the road's own
      // asphalt: `all`, the kit drawing everything.)
      const D = 22;
      const asphalt = kind === 'edge' ? all.asphalt : kit.asphalt;
      asphalt.color(kind === 'drop' ? TINT.drive : all.look === 'real' ? REAL_GROUND.road : TINT.road);
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

// The terraces' blocks (per plot, west to east: plan.js terraceSpans, each its front from (a, za)
// to (b, zb), back to the gardens' flat's end flatZAt; behind the drive the villa's front, behind
// the steps their ramp's top) and the plots' back gardens' ramps, as the lawn's holes too.
function terraceBlocks(L) {
  return terraceSpans(L).map(({ plot, spans }) => {
    const stepsZ = L.wallZAt(plot.steps[0]) - L.STEPS.run;
    const front = L.villaOf(plot).front;
    const blocks = spans.map(({ a, b, za, zb, kind }) => (kind === 'wall' ? { a, b, za, zb, notch: false } : { a, b, za: kind === 'steps' ? stepsZ : front, zb: kind === 'steps' ? stepsZ : front, notch: true, kind, wa: za, wb: zb }));
    return { plot, blocks, stepsZ };
  });
}
function terraceHoles(L) {
  const holes = [];
  for (const { plot: p, blocks } of terraceBlocks(L)) {
    for (const { a, b, za, zb, notch, kind, wa, wb } of blocks) {
      holes.push([[a, za], [b, zb], [b, L.flatZAt(b)], [a, L.flatZAt(a)]]);
      // (The steps' ramp up to their block: no lawn under it.)
      if (notch && kind === 'steps') holes.push([[a, wa], [b, wb], [b, za], [a, za]]);
    }
    holes.push([[p.x0, L.flatZAt(p.x0)], [p.x1, L.flatZAt(p.x1)], [p.x1, L.backZAt(p.x1)], [p.x0, L.backZAt(p.x0)]]);
  }
  return holes;
}

// The villas' gardens up the hill: per plot, convex blocks from under the ground up to the
// terrace (their tops grass, their fronts split-face blocks under a paler coping), each with a
// straight front (the wall's line cut where it bends), cut by the steps (a ramp collider, drawn
// steps, a railing on their drive side) and the drive notch; where two blocks' fronts differ (a
// notch's sides, the wall's jogs) the deeper one's neighbour shows its side; behind them the back
// gardens' ramp up to the forest's edge.
function terraces(kit, L) {
  const N = L.NORTH;
  for (const { plot: p, blocks, stepsZ } of terraceBlocks(L)) {
    for (const b of blocks) block(kit, L, b);
    // The sides where neighbouring fronts differ: the one nearer the street shows its side.
    for (let i = 0; i + 1 < blocks.length; i++) {
      const [prev, next] = [blocks[i], blocks[i + 1]];
      if (Math.abs(prev.zb - next.za) < 1) continue;
      if (prev.zb > next.za) side(kit, L, prev.b, next.za, prev.zb, 1);
      else side(kit, L, next.a, prev.zb, next.za, -1);
    }
    // The plots' open ends (west of the first, east of the last).
    if (p === L.PLOTS_N[0]) side(kit, L, p.x0, L.flatZAt(p.x0), blocks[0].za, -1);
    if (p === L.PLOTS_N.at(-1)) side(kit, L, p.x1, L.flatZAt(p.x1), blocks.at(-1).zb, 1);
    steps(kit, L, p, stepsZ);
    // The back gardens' ramp up to the forest's edge: one wedge across the plot (its flat end and
    // its top follow the forest's sloping line: still planar).
    const [x0, x1] = [p.x0, p.x1];
    const [f0, f1, b0, b1] = [L.flatZAt(x0), L.flatZAt(x1), L.backZAt(x0), L.backZAt(x1)];
    const rise = N.backTop - N.top;
    const up = [-rise * N.slope, N.ramp, rise];
    const faces = [
      [[[x0, N.top, f0], [x1, N.top, f1], [x1, N.backTop, b1], [x0, N.backTop, b0]], up, 'grass'],
      [[[x0, -100, b0], [x1, -100, b1], [x1, N.backTop, b1], [x0, N.backTop, b0]], [N.slope, 0, -1], 'stone'],
      [[[x0, -100, f0], [x0, N.top, f0], [x0, N.backTop, b0], [x0, -100, b0]], [-1, 0, 0], 'stone'],
      [[[x1, -100, f1], [x1, N.top, f1], [x1, N.backTop, b1], [x1, -100, b1]], [1, 0, 0], 'stone'],
      [[[x0, -100, f0], [x1, -100, f1], [x1, N.top, f1], [x0, N.top, f0]], [-N.slope, 0, 1], 'stone'],
    ];
    for (const [f, facing, terrain] of faces) kit.solids.face(f, facing, terrain);
    kit.grass.color(TINT.backLawn);
    kit.grass.poly(faces[0][0], { facing: faces[0][1] });
    kit.blocks.color(TINT.walls);
    if (p === L.PLOTS_N[0]) kit.blocks.poly(faces[2][0], { facing: [-1, 0, 0] });
    if (p === L.PLOTS_N.at(-1)) kit.blocks.poly(faces[3][0], { facing: [1, 0, 0] });
  }
}

// One terrace block from x a to b, its front from (a, za) to (b, zb), back to the flat's end, from
// under the ground up to the terrace: its top (grass) and, unless it stands behind a notch (the
// villa's front or the steps' ramp hides it there), its front (blocks under a paler coping);
// solid (its sides and back too).
function block(kit, L, { a, b, za, zb, notch }) {
  const { grass, blocks, solids } = kit;
  const top = L.NORTH.top;
  const [ba, bb] = [L.flatZAt(a), L.flatZAt(b)];
  const y0 = -100;
  const footprint = [[a, za], [b, zb], [b, bb], [a, ba]];
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
  solids.face([[a, y0, za], [a, y0, ba], [a, top, ba], [a, top, za]], [-1, 0, 0], 'stone');
  solids.face([[b, y0, zb], [b, y0, bb], [b, top, bb], [b, top, zb]], [1, 0, 0], 'stone');
  solids.face([[a, y0, ba], [b, y0, bb], [b, top, bb], [a, top, ba]], [L.NORTH.slope, 0, -1], 'stone');
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
  const z0 = L.wallZAt(x0 + 0.01);
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
  // The railing: posts and a handrail up the drive's side (the steps' west side when the drive is
  // west of them).
  paint.color(TINT.railing);
  const rail = S.rail;
  const r = p.drive[1] <= x0 ? x0 + 16 : x1;
  for (const k of [0, 0.5, 1]) {
    const z = z0 - 10 - (S.run - 20) * k;
    const y = G + (top - G) * Math.min(1, (z0 - z) / S.run);
    paint.box(r - 14, r - 6, y, y + rail, z - 4, z + 4, { bottom: false });
  }
  const yA = G + rail;
  const yB = top + rail;
  paint.solid([
    [[r - 16, yA, z0 - 10], [r - 4, yA, z0 - 10], [r - 4, yA + 8, z0 - 10], [r - 16, yA + 8, z0 - 10]],
    [[r - 16, yB, stepsZ + 10], [r - 4, yB, stepsZ + 10], [r - 4, yB + 8, stepsZ + 10], [r - 16, yB + 8, stepsZ + 10]],
    [[r - 16, yA + 8, z0 - 10], [r - 4, yA + 8, z0 - 10], [r - 4, yB + 8, stepsZ + 10], [r - 16, yB + 8, stepsZ + 10]],
    [[r - 16, yA, z0 - 10], [r - 4, yA, z0 - 10], [r - 4, yB, stepsZ + 10], [r - 16, yB, stepsZ + 10]],
    [[r - 16, yA, z0 - 10], [r - 16, yA + 8, z0 - 10], [r - 16, yB + 8, stepsZ + 10], [r - 16, yB, stepsZ + 10]],
    [[r - 4, yA, z0 - 10], [r - 4, yA + 8, z0 - 10], [r - 4, yB + 8, stepsZ + 10], [r - 4, yB, stepsZ + 10]],
  ]);
}

// ---------------------------------------------------------------- outside the boundary

// The forest's bank behind the back gardens: from their back edge (backZAt, sloping) up to
// NORTH.bankTop over NORTH.bank, on beyond and then up again far out into the fog to its crest
// (and west of the plots, up from the lawn behind the north-west villa and its wing); its firs
// are props.js's.
function bank(kit, L) {
  const { grass } = kit;
  const N = L.NORTH;
  const x0 = L.PLOTS_N[0].x0;
  const strips = [
    { from: [-12900, -3000], to: [-10500, -4900], foot: L.GROUND },
    { from: [-10500, -4900], to: [x0, L.backZAt(x0)], foot: L.GROUND },
    { from: [x0, L.backZAt(x0)], to: [GROUND_RECT.x1, L.backZAt(GROUND_RECT.x1)], foot: N.backTop },
  ];
  const rowsOf = (foot) => [[0, foot], [N.bank * 0.5, foot + (N.bankTop - foot) * 0.75], [N.bank, N.bankTop], [N.bank + BANK.beyond, N.bankTop + BANK.far], [N.bank + BANK.beyond + BANK.out, N.bankTop + BANK.crest]];
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
