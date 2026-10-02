// Sparrow Lane (area 'lane', see lane/layout.js): a WorldPart built in the course's local frame,
// which world/area.js places at its origin. The houses are written into its kit by
// lane/houses.js, the dad's front door by lane/door.js and the props (street furniture,
// greenery, the mailbox, the fences, the forest, the signposts) by lane/props.js.
//
//   buildLane(layout) -> { name: 'lane', object3D, colliders, setDoorOpen(t, id), reset() }
//     setDoorOpen   the dad's front door (id 'lane_home', or none), 0 shut .. 1 standing open
//                   (core/AreaSwitch.js swings it as Jonas comes out of it and goes back in)
//
// The ground: the asphalt road (its west leg from the junction, the bend, the long straight) and
// the turning area at 0, granite kerbs along their edges (dropped at the drives); everything
// else a step up at GROUND: the north pavement (asphalt, paler), the drives, the dad's
// grass-paver path, the footpath, and lawn (the ground drawn as tiles with every road and hard
// surface cut out of them, so nothing lies over anything). Up the hill the villas' gardens are
// terraces (TERRACE) behind a retaining wall of split-face blocks (a paler coping along its
// top), cut by each villa's cobbled drive notch and its steps (drawn steps on a not-slippery
// ramp), their back gardens rising to the forest's bank. Out past the junction the road runs on
// into the fog with the side road; outside the boundary the forest bank and a ring of firs (the
// drawn edge the camera sees).
//
// Unlit worldMaterial meshes with the lighting baked into vertex colours under the low golden
// sun (LANE_SUN, a warm tint), one mesh per material, twelve: lane-asphalt (the road, the
// turning area, the pavement, the drives and the footpath), -grass (lawns, terraces, verges, the
// bank), -blocks (the terraces' walls, the steps, the kerbs, the round bed's stones), -brick (the
// castle's stone bricks tinted: the villas' upper floors, the chain houses' white brick plinths
// and gable ends), -render (white render, and every flat-coloured detail by vertex tint: frames,
// panes, doors, poles, the bins, the mailbox, soffits and fascias, the vestibule behind the dad's
// door), -boards (the skerries' painted planks upright: the chain houses' boards, gables, the
// fences), -roof (pan tiles, the flat roofs' felt), -cobbles (the drives' cobbles, the north-west
// villa's flagstones, the round bed's soil), -leaves (hedges, thujas, canopies, firs), -wood
// (trunks, tree bark), -signs, and -door (the dad's door's leaf, render's material, turning on
// its hinge).
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
import { faluPlankTexture } from '../skerries/textures.js';
import { asphaltTexture, panTileTexture, renderTexture } from './textures.js';
import { frame, house, link, carport } from './houses.js';
import { doorLeaf, frontDoor } from './door.js';
import { buildProps } from './props.js';

// World units per texture repeat (projected UVs).
const REPEAT = { asphalt: 600, grass: 480, blocks: 240, brick: 180, render: 300, boards: 300, roof: 260, cobbles: 160, leaves: 260, wood: 300 };

// Vertex tints (sRGB).
const TINT = {
  road: 0x76746f,
  pavement: 0x8a8780,
  drive: 0x7c7a74,
  footpath: 0x84827c,
  kerb: 0xb8b2a8,
  dropped: 0x6e6c68,
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
};

const UP = [0, 1, 0];
// Golden hour, a touch warmer than the skerries'.
const LIGHT = { ambient: 0.6, diffuse: 0.55, maxBright: 1.1, tint: [1.07, 1.0, 0.9] };
const GROUND_RECT = { x0: -16000, x1: 16000, z0: -8000, z1: 10000, tile: 2000 };
const SAMPLE = 150; // the kerbs' run is tested for the road's edge this often
const ARC_STEP = 300; // the terraces' fronts along the turning area: straight this long
const KERB_LIFT = 1.5; // the kerbs' tops over the lawn and the pavement beside them
const BANK = { depth: 1200, beyond: 2600, far: 200 }; // the bank: up to its top, then on

export function buildLane(layout) {
  const kit = { solids: new SolidBuilder(), signs: { wood: new MeshBuilder(), colliders: { wood: [] }, shadow: () => {} }, groundAt: layout.groundHeight };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);
  const road = roadPieces(layout);
  ground(kit, layout, road);
  kerbs(kit, layout, road);
  terraces(kit, layout);
  bank(kit, layout);
  boundary(kit, layout);
  for (const h of layout.HOUSES) house(kit, h);
  link(kit, layout.LINK);
  carport(kit, layout.CARPORT);
  const leaf = frontDoor(kit, layout);
  buildProps(kit, layout);
  return assemble(kit, layout, leaf);
}

// ---------------------------------------------------------------- meshes

function assemble(kit, layout, leaf) {
  const lit = { ...LIGHT, sun: layout.LANE_SUN };
  const group = new THREE.Group();
  group.name = 'lane';
  const materials = {};
  const add = (name, map) => {
    const material = worldMaterial({ map });
    const mesh = new THREE.Mesh(bakeLighting(kit[name].toGeometry(), lit), material);
    mesh.name = `lane-${name}`;
    group.add(mesh);
    materials[name] = material;
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
  group.add(bakedMesh('lane-signs', kit.signs.wood, worldMaterial({ map: signWoodTexture() }), lit));
  // The dad's front door's leaf, in render's material, turning on its hinge (setDoorOpen).
  const door = doorLeaf(leaf, materials.render, (geo) => bakeLighting(geo, lit));
  group.add(door.mesh);

  const colliders = kit.solids.colliders();
  colliders.push({ positions: kit.signs.colliders.wood, terrain: 'wood' });
  return {
    name: 'lane',
    object3D: group,
    colliders,
    // The dad's front door (the course's one swinging door), 0 shut .. 1 standing open.
    setDoorOpen(t, id = null) {
      if (id === null || id === 'lane_home') door.setOpen(t);
    },
    // A new game: nothing of the course's own changes (the pickups live in its objects).
    reset() {},
  };
}

// ---------------------------------------------------------------- 2D helpers ([x, z] outlines)

// Each edge's outward unit normal of a convex outline (either winding).
function normals(outline) {
  const s = polyArea(outline) > 0 ? 1 : -1;
  return outline.map(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(s * (bz - az)) / l, (-s * (bx - ax)) / l];
  });
}

// Whether (x, z) lies inside convex outline `poly` (either winding).
function inside(poly, x, z) {
  const s = polyArea(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    if (s * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 0) return false;
  }
  return true;
}

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

// A band either side of a polyline, from offset `from` to `to` along each segment's left normal
// (dz, -dx) (negative offsets: its right), mitred at the joints: one convex quad per segment.
function band(line, from, to) {
  const n = line.length;
  const segN = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dz = line[i + 1][1] - line[i][1];
    const l = Math.hypot(dx, dz);
    segN.push([dz / l, -dx / l]);
  }
  // Each joint's mitre: the mean of its segments' normals, lengthened to keep the offset.
  const mitre = line.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    const mx = a[0] + b[0];
    const mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    const k = 1 / ((mx / ml) * a[0] + (mz / ml) * a[1]);
    return [(mx / ml) * k, (mz / ml) * k];
  });
  const off = (i, d) => [line[i][0] + mitre[i][0] * d, line[i][1] + mitre[i][1] * d];
  const quads = [];
  for (let i = 0; i + 1 < n; i++) quads.push([off(i, from), off(i + 1, from), off(i + 1, to), off(i, to)]);
  return quads;
}

// ---------------------------------------------------------------- the ground

// The road's pieces (convex outlines at 0): the carriageway (on past the junction into the fog),
// the turning area, the side road.
function roadPieces({ ROAD, ROAD_DRAWN, TURN, SIDE_ROAD: S }) {
  const pieces = band(ROAD_DRAWN, -ROAD.half, ROAD.half);
  const disc = Array.from({ length: TURN.sides }, (_, i) => {
    const a = ((i + 0.5) / TURN.sides) * Math.PI * 2;
    return [TURN.x + Math.sin(a) * TURN.r, TURN.z + Math.cos(a) * TURN.r];
  });
  pieces.push(disc);
  const [dx, dz] = S.dir;
  const end = [S.x + dx * S.len, S.z + dz * S.len];
  pieces.push(...band([[S.x - dx * 300, S.z - dz * 300], end], -S.half, S.half));
  return pieces;
}

// The hard surfaces a step up at GROUND (each its outline, builder and tint): the pavement, the
// drives and the notches' cobbles, the dad's grass-paver path and his drive, the drive east of
// the turning area to the double garage, the north-west villa's flagstones, the footpath.
function hardSurfaces(L, road) {
  const out = [];
  const add = (outline, mat, tint) => {
    for (const piece of cutOut(outline, road)) out.push({ outline: piece, mat, tint });
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
  add(rectOf(L.DAD_PATH.x0, L.DAD_PATH.x1, L.DAD_PATH.z0, L.DAD_PATH.z1), 'grass', TINT.path);
  add(rectOf(L.DAD_DRIVE.x0, L.DAD_DRIVE.x1, L.DAD_DRIVE.z0, L.CARPORT.z1), 'asphalt', TINT.drive);
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
  for (const { outline, mat, tint } of hard) {
    kit[mat].color(tint);
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

// The kerbs: along every edge of the road's pieces that is the road's edge (not inside another
// piece), a granite face from the road up to GROUND and a strip along its top, both dropped
// (asphalt grey) in front of the drives.
function kerbs(kit, L, road) {
  const { blocks, asphalt } = kit;
  const G = L.GROUND;
  const drops = [
    { x0: L.DAD_DRIVE.x0, x1: L.DAD_DRIVE.x1, south: true },
    ...L.PLOTS_N.map((p) => ({ x0: p.drive[0], x1: p.drive[1], south: false })),
    { x0: L.TURN.x + 800, x1: L.TURN.x + 2000, south: false, z0: -900, z1: 150 },
  ];
  const dropped = (x, z) => drops.some((d) => x >= d.x0 && x <= d.x1 && (d.z0 !== undefined ? z >= d.z0 && z <= d.z1 : d.south === z > 0));
  for (const piece of road) {
    const ns = normals(piece);
    for (let i = 0; i < piece.length; i++) {
      const [ax, az] = piece[i];
      const [bx, bz] = piece[(i + 1) % piece.length];
      const [nx, nz] = ns[i];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / SAMPLE));
      // Runs of samples on the road's edge, each of one kind (kerb or dropped).
      let run = null;
      const flush = () => {
        if (!run) return;
        const [t0, t1, drop] = run;
        const p = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const q = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const b = drop ? asphalt : blocks;
        b.color(drop ? TINT.dropped : TINT.kerb);
        b.poly([[p[0], -2, p[1]], [q[0], -2, q[1]], [q[0], G + (drop ? 0 : KERB_LIFT), q[1]], [p[0], G + (drop ? 0 : KERB_LIFT), p[1]]], { facing: [-nx, 0, -nz], shade: 0.82 });
        if (!drop) {
          const w = L.KERB.w;
          b.poly([[p[0], G + KERB_LIFT, p[1]], [q[0], G + KERB_LIFT, q[1]], [q[0] + nx * w, G + KERB_LIFT, q[1] + nz * w], [p[0] + nx * w, G + KERB_LIFT, p[1] + nz * w]], { facing: UP, shade: 1.05 });
        }
        run = null;
      };
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const mx = ax + (bx - ax) * (t0 + t1) / 2;
        const mz = az + (bz - az) * (t0 + t1) / 2;
        const edge = !road.some((o) => o !== piece && inside(o, mx + nx * 5, mz + nz * 5));
        if (!edge) {
          flush();
          continue;
        }
        const drop = dropped(mx, mz);
        if (run && run[2] === drop) run[1] = t1;
        else {
          flush();
          run = [t0, t1, drop];
        }
      }
      flush();
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
  const { blocks, render, solids } = kit;
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
  render.color(TINT.railing);
  const rail = S.rail;
  for (const k of [0, 0.5, 1]) {
    const z = z0 - 10 - (S.run - 20) * k;
    const y = G + (top - G) * Math.min(1, (z0 - z) / S.run);
    render.box(x1 - 14, x1 - 6, y, y + rail, z - 4, z + 4, { bottom: false });
  }
  const yA = G + rail;
  const yB = top + rail;
  render.solid([
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
// BANK.depth and on beyond (and west of the plots, up from the lawn behind the north-west
// villa); its firs are props.js's.
function bank(kit, L) {
  const { grass } = kit;
  const N = L.NORTH;
  const strips = [
    { from: [L.PLOTS_N[0].x0, N.backZ], to: [GROUND_RECT.x1, N.backZ], foot: N.backTop },
    { from: [-9600, -2200], to: [-6400, -4000], foot: L.GROUND },
    { from: [-6400, -4000], to: [L.PLOTS_N[0].x0, N.backZ], foot: L.GROUND },
  ];
  for (const { from, to, foot } of strips) {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const l = Math.hypot(dx, dz);
    // Outward: the strip's left (north and west of the play space).
    const [nx, nz] = [dz / l, -dx / l];
    const n = Math.ceil(l / 1500);
    const rows = [[0, foot], [BANK.depth * 0.5, foot + (N.bankTop - foot) * 0.75], [BANK.depth, N.bankTop], [BANK.depth + BANK.beyond, N.bankTop + BANK.far]];
    for (let i = 0; i < n; i++) {
      const p = (k, r) => {
        const t = (i + k) / n;
        return [from[0] + dx * t + nx * rows[r][0], rows[r][1], from[1] + dz * t + nz * rows[r][0]];
      };
      for (let r = 0; r + 1 < rows.length; r++) {
        grass.color(r === 0 ? TINT.backLawn : TINT.bank);
        grass.poly([p(0, r), p(1, r), p(1, r + 1), p(0, r + 1)], { facing: [-nx * 0.4, 1, -nz * 0.4], shade: r === 0 ? [1, 1, 0.9, 0.9] : 0.9 });
      }
    }
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
