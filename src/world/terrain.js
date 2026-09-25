// Castle-grounds terrain: the rolling lawn with its paths and hills, the moat and pond beds,
// the island top with its flagstone courtyard, the perimeter cliffs with the cliff-top
// plateau and distant hills, and the water surface (see water.js).
//
// Technique: a fine grid (STEP units) over the playable area is split along the region
// contours (layout SDFs) by tessellate(), so every piece belongs to exactly one region and
// takes that region's height (layout.regionHeight). Where two regions meet at different
// heights, a truly vertical wall is built between the shared contour vertices (walls.js),
// so the ground and walls are crack-free and the walls are clean collision walls. A coarse
// ring of hills beyond the cliffs keeps the world's edge out of sight.
//
// The open lawn and the cliff top are low-poly: layout makes their heights linear over the
// triangles of a coarse FACET lattice, the fine grid splits its cells along the same
// diagonals, and those facets are lit with flat normals so they read as big N64 facets.
// Lattice cells that no contour, path or smooth blend touches are drawn as whole facets.
//
// Collision uses the same walls and floors, except that flat-enough stretches of ground are
// merged into large blocks (floorBlocks.js) to keep camera raycasts cheap.
//
// AI RACE mode: setDarkness(t) crossfades every ground material to its storm grade
// (DARK_GRADES, darkGrade.js: dead olive grass, wet dark mud paths, charcoal rock) and the
// water to near-black with an oily sheen; addScorch / clearScorches draw burn marks
// (scorch.js). Uniforms only: no geometry is rebuilt.
//
// Tech takeover (objects/ServerHalls.js): addCircuit(x, z, radius, { grow }) -> id spreads
// glowing circuit traces over the ground around a landed server hall, growing out to `radius`
// over `grow` seconds; fadeCircuit(id, seconds) fades one out, clearCircuits() removes all at
// once. Drawn by the grass, courtyard and path materials themselves (buildCircuits below: a
// uniform array of up to MAX_CIRCUITS discs), so they cost no draw call.

import * as THREE from 'three';
import { smoothstep } from '../core/math.js';
import { bakeLighting, worldMaterial } from '../render/materials.js';
import { tessellate } from './terrain/tessellate.js';
import { MeshBuffer } from './terrain/MeshBuffer.js';
import { WallBuilder } from './terrain/walls.js';
import { floorBlocks } from './terrain/floorBlocks.js';
import { applyUnderwater, circleParam, grassTint, groundTint, roundRectParam } from './terrain/shading.js';
import * as tex from './terrainTextures.js';
import { buildWater } from './water.js';
import { DarkGrade } from './terrain/darkGrade.js';
import { buildScorches } from './terrain/scorch.js';

export const MAX_CIRCUITS = 32;
const STEP = 100; // fine grid cell size
const FAR = 13000; // half-size of the cliff-top plateau
const PLATEAU = 800; // fine grid margin beyond the perimeter (covers the cliff rim's swell)
const CLIFF_COLLIDE = 400; // cliff-top collision reaches this far beyond the perimeter
const TOL = 3; // merged collision floors lie at most this far above the rendered ground
const SHORE = 55; // pond bank: grass above WATER_LEVEL + SHORE, sandy beach/bed below
const DECAL_MIN = 0.004; // path decal strength below which no decal is drawn
const SLIVER = 15; // collision triangles narrower than this get the ground's tangent plane

// World size of one texture tile.
const TILE = { grass: 640, path: 448, flagstone: 520, sand: 400 };

// AI RACE mode grade per mesh (see darkGrade.js): colour kept (sat), then tint * brightness.
// Tuned together with the renderer's own storm fog and grade (render/post/storm.js), which
// darken the frame further: on their own these read a little light.
export const DARK_GRADES = {
  grass: { sat: 0.22, mul: [0.42, 0.41, 0.26] }, // dead grey-green / olive
  paths: { sat: 0.5, mul: [0.24, 0.18, 0.145] }, // wet dark mud
  courtyard: { sat: 0.1, mul: [0.22, 0.22, 0.245] }, // dark slate flagstones
  bed: { sat: 0.2, mul: [0.16, 0.17, 0.13] },
  cliffs: { sat: 0.06, mul: [0.17, 0.17, 0.19] }, // charcoal
  masonry: { sat: 0.08, mul: [0.18, 0.18, 0.2] },
};

// Fields used to split the grid (<= 0 is inside), in clip order.
const F = { PERIMETER: 0, ISLAND: 1, WATER: 2, COURTYARD: 3, SHORE: 4 };

// Piece labels -> region (height function), ground material, and whether it is faceted.
const LABELS = {
  cliff: { region: 'cliff', material: 'grass', terrain: 'grass', faceted: true },
  island: { region: 'island', material: 'grass', terrain: 'grass' },
  courtyard: { region: 'island', material: 'flagstone', terrain: 'stone' },
  lawn: { region: 'lawn', material: 'grass', terrain: 'grass', faceted: true },
  bed: { region: 'water', material: 'sand', terrain: 'sand' },
  bank: { region: 'water', material: 'grass', terrain: 'grass' },
};

const REGION_KEY = { cliff: 0, island: 1, water: 2, lawn: 3 };

// Faint trodden trails on the island lawn, from the courtyard around both sides of the
// castle to meet behind it (drawn with the path decal at partial strength).
const TRAIL_EAST = [
  { x: 820, z: 60 },
  { x: 2350, z: -350 },
  { x: 2850, z: -1400 },
  { x: 2900, z: -4300 },
  { x: 2500, z: -5300 },
  { x: 1100, z: -5850 },
  { x: 0, z: -5950 },
];
const TRAILS = [TRAIL_EAST, TRAIL_EAST.map((p) => ({ x: -p.x, z: p.z }))].map((points) => ({ width: 300, points }));
const TRAIL_STRENGTH = 0.7;

// Region classification as a decision list over the field sides (see tessellate()).
function decide(s) {
  if (s[F.PERIMETER] === undefined) return F.PERIMETER;
  if (!s[F.PERIMETER]) return 'cliff';
  if (s[F.ISLAND] === undefined) return F.ISLAND;
  if (s[F.ISLAND]) {
    if (s[F.COURTYARD] === undefined) return F.COURTYARD;
    return s[F.COURTYARD] ? 'courtyard' : 'island';
  }
  if (s[F.WATER] === undefined) return F.WATER;
  if (!s[F.WATER]) return 'lawn';
  if (s[F.SHORE] === undefined) return F.SHORE;
  return s[F.SHORE] ? 'bed' : 'bank';
}

export function buildTerrain(layout) {
  const L = layout;
  const buffers = {
    grass: new MeshBuffer(),
    flagstone: new MeshBuffer(),
    sand: new MeshBuffer(),
    rock: new MeshBuffer(),
    masonry: new MeshBuffer(),
  };
  const pathOverlay = new MeshBuffer({ alpha: true });
  const colliders = { grass: [], stone: [], sand: [] };
  const walls = new WallBuilder(buffers, colliders.stone);

  // Wall outlines: SDF, arc-length parameter (texture u) and distance to the other outlines
  // (plus, for the perimeter, to the waterfall's spillway, where the cliff face stays flat).
  const shapes = {
    perimeter: [(x, z) => L.sdRoundRect(x, z, L.PERIMETER), (x, z) => roundRectParam(L.PERIMETER, x, z)],
    island: [(x, z) => L.sdRoundRect(x, z, L.ISLAND), (x, z) => roundRectParam(L.ISLAND, x, z)],
    moat: [(x, z) => L.sdRoundRect(x, z, L.MOAT), (x, z) => roundRectParam(L.MOAT, x, z)],
    pond: [(x, z) => L.sdCircle(x, z, L.POND), (x, z) => circleParam(L.POND, x, z)],
  };
  const WF = L.WATERFALL;
  const spillway = (x, z) => Math.hypot(x - WF.x, Math.max(0, Math.abs(z - WF.z) - WF.width / 2));
  const contours = {};
  for (const [name, [sdf, param]] of Object.entries(shapes)) {
    const others = Object.keys(shapes).filter((k) => k !== name).map((k) => shapes[k][0]);
    const junction = (x, z) =>
      Math.min(...others.map((f) => Math.abs(f(x, z))), name === 'perimeter' ? spillway(x, z) : Infinity);
    contours[name] = { sdf, param, junction };
  }

  // Per-vertex, per-region cached surface point: height + smooth normal.
  const surface = (v, region) => {
    v.s ??= {};
    let p = v.s[region];
    if (!p) {
      const h = (x, z) => L.regionHeight(region, x, z);
      const e = 15;
      const dx = (h(v.x + e, v.z) - h(v.x - e, v.z)) / (2 * e);
      const dz = (h(v.x, v.z + e) - h(v.x, v.z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      p = { y: h(v.x, v.z), nx: -dx / l, ny: 1 / l, nz: -dz / l };
      v.s[region] = p;
    }
    return p;
  };

  const facets = facetLattice(L);

  // A ground vertex of a piece with the given label (and facet, for faceted ground).
  const groundVertex = (v, label, facet) => {
    const { region, material } = LABELS[label];
    const p = surface(v, region);
    const n = facet ? facets.normal(region, facet) : p;
    const rgb = material === 'grass' ? grassTint(v.x, p.y, v.z, n.nx, n.ny, n.nz) : groundTint(v.x, p.y, v.z);
    const t = TILE[material];
    const col = rgbOf(applyUnderwater(rgb, p.y));
    return { x: v.x, y: p.y, z: v.z, nx: n.nx, ny: n.ny, nz: n.nz, u: v.x / t, v: v.z / t, ...col };
  };
  // Vertices are shared per region (contour vertices border regions at different heights)
  // and, on faceted ground, per facet (flat lighting).
  const vertexKey = (v, label, facet) => (v.id * 4 + REGION_KEY[LABELS[label].region]) * 8 + (facet ? facet.slot : 0);
  const facetFor = (label, verts) =>
    LABELS[label].faceted ? facets.at((verts[0].x + verts[1].x + verts[2].x) / 3, (verts[0].z + verts[1].z + verts[2].z) / 3) : null;

  const fields = [
    (x, z) => L.sdRoundRect(x, z, L.PERIMETER),
    (x, z) => L.sdRoundRect(x, z, L.ISLAND),
    (x, z) => L.sdWater(x, z),
    (x, z) => L.sdRoundRect(x, z, L.COURTYARD),
    (x, z) => L.waterFloorHeight(x, z) - (L.WATER_LEVEL + SHORE),
  ];
  // Fine grid over the playable area and the cliff rim, aligned to the facet lattice (so its
  // cells split along the facets and the far ring abuts it exactly).
  const FACET = L.FACET;
  const bounds = {
    minX: Math.floor((L.PERIMETER.minX - PLATEAU) / FACET) * FACET,
    maxX: Math.ceil((L.PERIMETER.maxX + PLATEAU) / FACET) * FACET,
    minZ: Math.floor((L.PERIMETER.minZ - PLATEAU) / FACET) * FACET,
    maxZ: Math.ceil((L.PERIMETER.maxZ + PLATEAU) / FACET) * FACET,
  };
  const K = FACET / STEP; // fine cells per facet cell side
  const grid = {
    minX: bounds.minX,
    minZ: bounds.minZ,
    cols: (bounds.maxX - bounds.minX) / STEP,
    rows: (bounds.maxZ - bounds.minZ) / STEP,
    step: STEP,
    flip: (i, j) => L.facetFlip(Math.floor((bounds.minX + i * STEP) / FACET), Math.floor((bounds.minZ + j * STEP) / FACET)),
  };

  // Paths sound like stone.
  const floorTerrain = (label, pathiness) => (label === 'lawn' && pathiness > 0.5 ? 'stone' : LABELS[label].terrain);

  // Merged collision floors where the ground is flat (see floorBlocks.js). The label comes
  // from the same decision list as the tessellation; `clear` is the smallest |field| among
  // the fields that decided it (SDFs, so no contour comes nearer than that). Only the rim of
  // the unreachable cliff-top plateau gets collision.
  const blocks = floorBlocks({
    ...grid,
    maxCells: 16,
    tol: TOL,
    minClear: 0.75 * STEP, // > half a cell diagonal: no contour crosses the block's cells
    sample(x, z) {
      const sides = [];
      let clear = Infinity;
      let d = decide(sides);
      while (typeof d === 'number') {
        const f = fields[d](x, z);
        clear = Math.min(clear, Math.abs(f));
        sides[d] = f <= 0;
        d = decide(sides);
      }
      const terrain = floorTerrain(d, L.pathMask(x, z));
      return { key: `${d}:${terrain}`, terrain, y: L.regionHeight(LABELS[d].region, x, z), clear };
    },
  });

  // Dirt decal strength: the lawn's paths and the island's trails.
  const decalMask = (label, x, z) => {
    if (label === 'lawn') return L.pathMask(x, z);
    if (label !== 'island') return 0;
    let m = 0;
    for (const t of TRAILS) m = Math.max(m, 1 - smoothstep(t.width * 0.2, t.width * 0.5, L.distToPath(x, z, t)));
    return m * TRAIL_STRENGTH;
  };

  // Split the grid into labelled pieces, and note which fine cells stayed whole (exactly two
  // triangles of one label).
  const pieces = [];
  const cellPieces = new Uint16Array(grid.cols * grid.rows);
  const cellLabel = new Array(grid.cols * grid.rows);
  const cellOf = (verts) => {
    const i = Math.floor(((verts[0].x + verts[1].x + verts[2].x) / 3 - grid.minX) / STEP);
    const j = Math.floor(((verts[0].z + verts[1].z + verts[2].z) / 3 - grid.minZ) / STEP);
    return j * grid.cols + i;
  };
  const tess = tessellate({
    ...grid,
    fields,
    decide,
    emit(a, b, c, tags, label) {
      const verts = [a, b, c];
      const cell = cellOf(verts);
      cellPieces[cell]++;
      cellLabel[cell] = cellLabel[cell] === undefined || cellLabel[cell] === label ? label : 'mixed';
      pieces.push({ verts, tags, label, cell });
    },
  });

  // Facet cells drawn as whole facets: every fine cell whole and of one faceted label, no
  // decal, and the ground exactly planar over each facet.
  const ccols = grid.cols / K;
  const crows = grid.rows / K;
  const coarse = new Uint8Array(ccols * crows);
  const coarseLabel = [];
  for (let cj = 0; cj < crows; cj++) {
    for (let ci = 0; ci < ccols; ci++) {
      let label = null;
      let ok = true;
      for (let j = cj * K; ok && j < (cj + 1) * K; j++) {
        for (let i = ci * K; ok && i < (ci + 1) * K; i++) {
          const k = j * grid.cols + i;
          label ??= cellLabel[k];
          ok = cellPieces[k] === 2 && cellLabel[k] === label && LABELS[label]?.faceted === true;
        }
      }
      for (let j = cj * K; ok && j <= (cj + 1) * K; j++) {
        for (let i = ci * K; ok && i <= (ci + 1) * K; i++) {
          const v = tess.grid[j][i];
          const region = LABELS[label].region;
          ok = decalMask(label, v.x, v.z) <= DECAL_MIN && Math.abs(surface(v, region).y - facets.height(region, v.x, v.z)) < 0.25;
        }
      }
      if (ok) {
        coarse[cj * ccols + ci] = 1;
        coarseLabel[cj * ccols + ci] = label;
      }
    }
  }
  const inCoarse = (cell) => coarse[Math.floor(Math.floor(cell / grid.cols) / K) * ccols + Math.floor((cell % grid.cols) / K)] === 1;

  // The bridge deck's footprint: the deck rests only ~2 units above the lawn at its south end,
  // so the ground under it is never seen and gets no decal.
  const B = L.BRIDGE;
  const underDeck = (v) => Math.abs(v.x - B.x) <= B.width / 2 && v.z >= B.northZ && v.z <= B.southZ;

  // Rendered ground triangle (with its path decal) for three vertices of a labelled piece.
  const renderTri = (verts, label) => {
    const facet = facetFor(label, verts);
    const buf = buffers[LABELS[label].material];
    buf.tri(...verts.map((v) => buf.keyed(vertexKey(v, label, facet), () => groundVertex(v, label, facet))));

    const masks = verts.map((v) => decalMask(label, v.x, v.z));
    if (Math.max(...masks) > DECAL_MIN && !verts.every(underDeck)) {
      const decal = (v, i) => {
        const g = groundVertex(v, label, facet);
        return { ...g, ...rgbOf(groundTint(v.x, g.y, v.z)), u: v.x / TILE.path, v: v.z / TILE.path, a: masks[i] };
      };
      pathOverlay.tri(...verts.map((v, i) => pathOverlay.keyed(vertexKey(v, label, facet), () => decal(v, i))));
    }
    return masks;
  };

  // Fine pieces: ground (unless drawn as a whole facet), collision floors (where no merged
  // block covers them) and walls.
  for (const { verts, tags, label, cell } of pieces) {
    const info = LABELS[label];
    const masks = inCoarse(cell) ? [0, 0, 0] : renderTri(verts, label);

    // Collision (CCW from above = floor facing up). A thin sliver cut off by a contour takes
    // the ground's tangent plane at its centre: its own vertices are too close together to
    // pin down the slope across it, which could otherwise read as a steep, slippery floor.
    let pos = verts.map((v) => ({ x: v.x, y: surface(v, info.region).y, z: v.z }));
    if (minAltitude(pos) < SLIVER) pos = tangentPlane(pos, (x, z) => L.regionHeight(info.region, x, z));
    const cx = (pos[0].x + pos[1].x + pos[2].x) / 3;
    const cz = (pos[0].z + pos[1].z + pos[2].z) / 3;
    if (floorLike(pos) && !blocks.covers(cx, cz) && (label !== 'cliff' || L.sdRoundRect(cx, cz, L.PERIMETER) < CLIFF_COLLIDE)) {
      const path = label === 'lawn' ? (masks[0] + masks[1] + masks[2]) / 3 : 0;
      colliders[floorTerrain(label, path)].push(...pos.flatMap((g) => [g.x, g.y, g.z]));
    }

    // Walls along region contours, built once from the side that knows both regions.
    for (let k = 0; k < 3; k++) {
      const wall = wallAcross(tags[k], info.region, verts[k], verts[(k + 1) % 3]);
      if (wall) addWall(wall, info.region, verts[k], verts[(k + 1) % 3]);
    }
  }

  // Whole facet cells: two triangles, or, when a neighbour is drawn with fine cells, a fan
  // from the centre through every fine vertex on the shared sides (no T-junctions). Each fan
  // triangle lies within one facet, so the surface is unchanged.
  let nextId = tess.vertexCount;
  const isCoarse = (ci, cj) => ci >= 0 && cj >= 0 && ci < ccols && cj < crows && coarse[cj * ccols + ci] === 1;
  for (let cj = 0; cj < crows; cj++) {
    for (let ci = 0; ci < ccols; ci++) {
      if (!isCoarse(ci, cj)) continue;
      const label = coarseLabel[cj * ccols + ci];
      const g = (a, b) => tess.grid[cj * K + b][ci * K + a];
      // Boundary loop, counter-clockwise from above: -X side (+Z), +Z side (+X), +X side (-Z),
      // -Z side (-X); only the corners on sides shared with another whole facet cell.
      const sides = [
        [isCoarse(ci - 1, cj), (t) => g(0, t)],
        [isCoarse(ci, cj + 1), (t) => g(t, K)],
        [isCoarse(ci + 1, cj), (t) => g(K, K - t)],
        [isCoarse(ci, cj - 1), (t) => g(K - t, 0)],
      ];
      if (sides.every(([whole]) => whole)) {
        const flip = L.facetFlip(Math.floor(g(0, 0).x / FACET), Math.floor(g(0, 0).z / FACET));
        const [v00, v10, v01, v11] = [g(0, 0), g(K, 0), g(0, K), g(K, K)];
        const tris = flip ? [[v00, v01, v10], [v10, v01, v11]] : [[v00, v11, v10], [v00, v01, v11]];
        for (const t of tris) renderTri(t, label);
        continue;
      }
      const loop = [];
      for (const [whole, at] of sides) for (let t = 0; t < K; t += whole ? K : 1) loop.push(at(t));
      const centre = { id: nextId++, x: g(0, 0).x + FACET / 2, z: g(0, 0).z + FACET / 2 };
      loop.forEach((p, k) => renderTri([centre, p, loop[(k + 1) % loop.length]], label));
    }
  }

  // What lies across a contour edge of a piece in `region`, or null when this piece does not
  // own that wall: returns { other, style, contour }.
  function wallAcross(tag, region, p, q) {
    if (tag === F.PERIMETER && region !== 'cliff') return { other: 'cliff', style: 'cliff', contour: contours.perimeter };
    if (tag === F.ISLAND && region !== 'island') return { other: 'island', style: 'masonry', contour: contours.island };
    if (tag === F.WATER && region === 'water') {
      // The water outline is the union of the moat and the pond: masonry along the moat,
      // natural rock along the pond.
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const pond = Math.abs(contours.pond.sdf(mx, mz)) < Math.abs(contours.moat.sdf(mx, mz));
      return pond
        ? { other: 'lawn', style: 'bank', contour: contours.pond }
        : { other: 'lawn', style: 'masonry', contour: contours.moat };
    }
    return null;
  }

  function addWall({ other, style, contour }, region, p, q) {
    const selfP = surface(p, region).y;
    const selfQ = surface(q, region).y;
    const otherP = surface(p, other).y;
    const otherQ = surface(q, other).y;
    if (Math.abs(otherP - selfP) < 1 && Math.abs(otherQ - selfQ) < 1) return; // flush (pond bank)
    // A segment p->q faces away from this piece; flip it when this piece is the low side.
    if (otherP + otherQ > selfP + selfQ) {
      walls.add({ style, contour, p: q, q: p, loP: selfQ, hiP: otherQ, loQ: selfP, hiQ: otherP });
    } else {
      walls.add({ style, contour, p, q, loP: otherP, hiP: selfP, loQ: otherQ, hiQ: selfQ });
    }
  }

  for (const [terrain, positions] of Object.entries(blocks.positions)) colliders[terrain].push(...positions);

  buildFarRing(L, buffers.grass, bounds);

  // Meshes, one per material.
  const group = new THREE.Group();
  group.name = 'terrain';
  const grade = new DarkGrade();
  const circuits = buildCircuits();
  const CIRCUIT_MESHES = { grass: true, courtyard: true };
  const addMesh = (name, buffer, map) => {
    const geo = buffer.toGeometry();
    bakeLighting(geo);
    const base = worldMaterial({ map });
    if (CIRCUIT_MESHES[name]) circuits.patch(base);
    const mesh = new THREE.Mesh(geo, grade.patch(base, DARK_GRADES[name]));
    mesh.name = name;
    group.add(mesh);
  };
  addMesh('grass', buffers.grass, tex.grassTexture());
  addMesh('courtyard', buffers.flagstone, tex.flagstoneTexture());
  addMesh('bed', buffers.sand, tex.sandTexture());
  addMesh('cliffs', buffers.rock, tex.rockTexture());
  addMesh('masonry', buffers.masonry, tex.masonryTexture());
  addPathOverlay(group, pathOverlay, grade, circuits);

  const water = buildWater(L, grade);
  group.add(water.object3D);
  const scorches = buildScorches(L);
  group.add(scorches.mesh);

  return {
    object3D: group,
    colliders: [
      { positions: new Float32Array(colliders.grass), terrain: 'grass' },
      { positions: new Float32Array(colliders.stone), terrain: 'stone' },
      { positions: new Float32Array(colliders.sand), terrain: 'sand' },
    ],
    update(time) {
      water.update(time);
      grade.tick(time);
      scorches.update(time);
      circuits.update(time);
    },
    // AI RACE mode crossfade: 0 = sunny grounds .. 1 = storm.
    setDarkness(t) {
      const k = Math.min(1, Math.max(0, t));
      grade.set(k * k * (3 - 2 * k));
      water.setDarkness(k);
    },
    addScorch(x, z, radius) {
      scorches.add(x, z, radius);
    },
    clearScorches() {
      scorches.clear();
    },
    addCircuit(x, z, radius, opts) {
      return circuits.add(x, z, radius, opts);
    },
    fadeCircuit(id, seconds) {
      circuits.fade(id, seconds);
    },
    clearCircuits() {
      circuits.clear();
    },
    circuits,
  };
}

// The layout's facet lattice: which facet a point lies in, and each facet's plane (the
// region's heights at its three lattice corners) for flat lighting.
function facetLattice(L) {
  const S = L.FACET;
  const planes = new Map();
  const at = (x, z) => {
    const i = Math.floor(x / S);
    const j = Math.floor(z / S);
    const u = x / S - i;
    const v = z / S - j;
    const flip = L.facetFlip(i, j);
    const half = flip ? (u + v > 1 ? 1 : 0) : u < v ? 1 : 0;
    // slot tells apart the (up to 8) facets that share a vertex.
    return { i, j, flip, half, slot: ((i & 1) << 2) | ((j & 1) << 1) | half };
  };
  const plane = (region, f) => {
    const key = `${region}:${f.i}:${f.j}:${f.half}`;
    let p = planes.get(key);
    if (!p) {
      const corners = f.flip ? (f.half ? [[1, 1], [0, 1], [1, 0]] : [[0, 0], [1, 0], [0, 1]]) : f.half ? [[0, 0], [1, 1], [0, 1]] : [[0, 0], [1, 0], [1, 1]];
      const [a, b, c] = corners.map(([di, dj]) => {
        const x = (f.i + di) * S;
        const z = (f.j + dj) * S;
        return { x, y: L.regionHeight(region, x, z), z };
      });
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.sign(ny) * Math.hypot(nx, ny, nz); // facing up
      nx /= l;
      ny /= l;
      nz /= l;
      p = { nx, ny, nz, a };
      planes.set(key, p);
    }
    return p;
  };
  return {
    at,
    normal: (region, f) => plane(region, f),
    // Height of the facet plane through (x, z).
    height(region, x, z) {
      const p = plane(region, at(x, z));
      return p.a.y - (p.nx * (x - p.a.x) + p.nz * (z - p.a.z)) / p.ny;
    },
  };
}

// Ground triangle faces clearly upward (guards collision against numerically noisy slivers).
function floorLike([a, b, c]) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const ny = uz * vx - ux * vz;
  return ny > 0.5 * Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
}

// Smallest altitude of a triangle in XZ (its width across the longest edge).
function minAltitude([a, b, c]) {
  const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
  const longest = Math.max(Math.hypot(b.x - a.x, b.z - a.z), Math.hypot(c.x - b.x, c.z - b.z), Math.hypot(a.x - c.x, a.z - c.z));
  return area2 / longest;
}

// The triangle's points lifted onto the tangent plane of height(x, z) at its centre.
function tangentPlane(pts, height) {
  const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
  const cz = (pts[0].z + pts[1].z + pts[2].z) / 3;
  const e = 4;
  const gx = (height(cx + e, cz) - height(cx - e, cz)) / (2 * e);
  const gz = (height(cx, cz + e) - height(cx, cz - e)) / (2 * e);
  const h = height(cx, cz);
  return pts.map((p) => ({ x: p.x, y: h + gx * (p.x - cx) + gz * (p.z - cz), z: p.z }));
}

function rgbOf(c) {
  return { r: c[0], g: c[1], b: c[2] };
}

// Dirt path decal: the lawn triangles under a path, drawn again with the path texture and a
// per-vertex alpha from pathMask so the path edges blend softly into the grass.
//
// The decal repeats the ground's own triangles, so it needs only a constant depth bias
// (units) to win over them; a slope bias (factor) would grow with the pixel size at grazing
// angles (several world units at the N64 mode's 240 lines) and let the dirt show through
// opaque things lying just above the ground, such as the bridge deck's lawn end.
function addPathOverlay(group, buffer, grade, circuits = null) {
  const geo = buffer.toGeometry();
  const rgba = geo.attributes.color;
  const alpha = Array.from({ length: rgba.count }, (_, i) => rgba.getW(i));
  bakeLighting(geo); // rewrites colour as RGB
  const rgb = geo.attributes.color;
  const out = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) out.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), alpha[i]], i * 4);
  geo.setAttribute('color', new THREE.BufferAttribute(out, 4));
  const base = worldMaterial({ map: tex.pathTexture(), transparent: true, depthWrite: false });
  circuits?.patch(base);
  const mat = grade.patch(base, DARK_GRADES.paths);
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 0;
  mat.polygonOffsetUnits = -4;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'paths';
  group.add(mesh);
}

// Faceted cliff-top plateau and distant rolling hills around the fine grid (visual only),
// one flat-lit triangle per facet.
function buildFarRing(L, buffer, b) {
  const S = L.FACET;
  const n0 = -Math.round(FAR / S);
  const n1 = Math.round(FAR / S);
  const corner = (i, j) => ({ x: i * S, y: L.cliffHeight(i * S, j * S), z: j * S });
  for (let j = n0; j < n1; j++) {
    for (let i = n0; i < n1; i++) {
      if (i * S >= b.minX && (i + 1) * S <= b.maxX && j * S >= b.minZ && (j + 1) * S <= b.maxZ) continue;
      const [v00, v10, v01, v11] = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)];
      const tris = L.facetFlip(i, j) ? [[v00, v01, v10], [v10, v01, v11]] : [[v00, v11, v10], [v00, v01, v11]];
      for (const [p, q, r] of tris) {
        const ux = q.x - p.x;
        const uy = q.y - p.y;
        const uz = q.z - p.z;
        const vx = r.x - p.x;
        const vy = r.y - p.y;
        const vz = r.z - p.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        const n = { nx: nx / l, ny: ny / l, nz: nz / l };
        const idx = [p, q, r].map((v) => {
          const c = grassTint(v.x, v.y, v.z, n.nx, n.ny, n.nz);
          return buffer.vertex({ ...v, ...n, u: v.x / TILE.grass, v: v.z / TILE.grass, ...rgbOf(c) });
        });
        buffer.tri(...idx);
      }
    }
  }
}

// Circuit traces spreading over the ground around the server halls (AI RACE mode's tech
// takeover). Each circuit is a ragged disc (centre, radius, strength) in a uniform array; the
// patched ground materials darken the ground inside toward a black-green board and draw
// glowing cyan traces on it (two layers of long straight traces broken into segments, pads at
// their ends, some blinking red), with rings of light pulsing out from the centre and a bright
// rim while it spreads. Far away (a trace under ~1 px) the traces fade into their average glow.
// No draw calls of their own; with no circuit the shader skips it all on a uniform branch.
//   add(x, z, radius, { grow = 4 }) -> id, fade(id, seconds = 2), clear(), update(timeSeconds)
function buildCircuits() {
  const data = Array.from({ length: MAX_CIRCUITS }, () => new THREE.Vector4());
  const uniforms = {
    uCircuits: { value: data },
    uCircuitCount: { value: 0 },
    uCircuitTime: { value: 0 },
  };
  const list = Array.from({ length: MAX_CIRCUITS }, () => ({ id: 0, x: 0, z: 0, radius: 0, born: 0, grow: 4, fadeAt: Infinity, fadeFor: 2 }));
  let nextId = 1;
  let now = 0;
  let count = 0;
  const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

  // Packs the live circuits into the uniforms (per render frame while any: no allocation).
  const write = () => {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.id) continue;
      const age = now - c.born;
      const g = smooth(age / c.grow);
      let strength = age < 0.4 ? Math.max(0, age) / 0.4 : 1;
      if (now > c.fadeAt) strength *= Math.max(0, 1 - (now - c.fadeAt) / c.fadeFor);
      if (strength <= 0 && now > c.fadeAt) {
        c.id = 0;
        continue;
      }
      const front = Math.round((1 - g) * 15);
      data[n++].set(c.x, c.z, c.radius * (0.06 + 0.94 * g), Math.min(1, strength) + front * 2);
    }
    count = n;
    uniforms.uCircuitCount.value = n;
  };

  return {
    uniforms,
    get count() {
      return count;
    },
    // Live circuits (tests): [{ id, x, z, radius, strength }] as the shader sees them now.
    live() {
      return list.filter((c) => c.id).map((c) => ({ id: c.id, x: c.x, z: c.z, radius: c.radius }));
    },
    patch(material) {
      const prev = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
      material.onBeforeCompile = (shader, renderer) => {
        prev?.call(material, shader, renderer);
        patchCircuitShader(shader, uniforms);
      };
      material.customProgramCacheKey = () => 'terrain-circuits';
      return material;
    },
    add(x, z, radius, { grow = 4 } = {}) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius > 0)) return null;
      // A free slot, else the one that fades out soonest (else the oldest).
      let slot = list.find((c) => !c.id);
      if (!slot) slot = list.reduce((a, b) => (b.fadeAt < a.fadeAt || (b.fadeAt === a.fadeAt && b.born < a.born) ? b : a));
      Object.assign(slot, { id: nextId++, x, z, radius, born: now, grow: Math.max(0.05, grow), fadeAt: Infinity, fadeFor: 2 });
      write();
      return slot.id;
    },
    fade(id, seconds = 2) {
      const c = list.find((k) => k.id === id && id);
      if (!c || c.fadeAt !== Infinity) return;
      c.fadeAt = now;
      c.fadeFor = Math.max(0.05, seconds);
    },
    clear() {
      for (const c of list) c.id = 0;
      write();
    },
    update(t) {
      if (!Number.isFinite(t)) return;
      // The clock went back (the title after a game over): keep every circuit's age.
      if (t < now - 0.5) {
        for (const c of list) {
          c.born += t - now;
          if (c.fadeAt !== Infinity) c.fadeAt += t - now;
        }
      }
      now = t;
      uniforms.uCircuitTime.value = t;
      if (count > 0) write();
    },
  };
}

function patchCircuitShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec2 vCircuitXZ;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vCircuitXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform vec4 uCircuits[${MAX_CIRCUITS}];
uniform int uCircuitCount;
uniform float uCircuitTime;
varying vec2 vCircuitXZ;
float ciHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// One layer of straight traces along x: rows 'pitch' apart, broken into segments 'len' long
// (some rows empty, ends cut back at random), a pad at each segment's start and some ends.
// Returns (trace, pad, hash of the segment).
vec3 ciLayer(vec2 p, float len, float pitch, float aa, float salt) {
  vec2 q = vec2(p.x / len, p.y / pitch);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float h = ciHash(id + salt);
  float on = step(0.35, h);
  float dy = abs(f.y - 0.5) * pitch;
  float x = f.x * len;
  float end = len * (0.6 + 0.35 * fract(h * 7.13));
  float line = on * (1.0 - smoothstep(11.0, 11.0 + aa, dy)) * step(40.0, x) * step(x, end);
  float pad = on * (1.0 - smoothstep(22.0, 22.0 + aa, length(vec2(x - 40.0, dy))));
  pad = max(pad, on * step(0.45, fract(h * 3.7)) * (1.0 - smoothstep(18.0, 18.0 + aa, length(vec2(x - end, dy)))));
  return vec3(line, pad, h);
}`,
    )
    .replace(
      '#include <opaque_fragment>',
      `if (uCircuitCount > 0) {
  vec2 cp = vCircuitXZ;
  float cover = 0.0;
  float rim = 0.0;
  float best = 0.0;
  vec2 centre = vec2(0.0);
  float reach = 1.0;
  for (int i = 0; i < ${MAX_CIRCUITS}; i++) {
    if (i >= uCircuitCount) break;
    vec4 c = uCircuits[i];
    vec2 d = cp - c.xy;
    float r = length(d);
    if (r > c.z * 1.1 + 20.0) continue;
    float front = floor(c.w * 0.5);
    float strength = c.w - front * 2.0;
    float ang = atan(d.y, d.x);
    float edge = c.z * (0.86 + 0.08 * sin(ang * 5.0 + c.x * 0.013) + 0.06 * sin(ang * 13.0 - c.y * 0.021));
    float m = (1.0 - smoothstep(edge * 0.7, edge, r)) * strength;
    rim = max(rim, strength * (front / 15.0) * (1.0 - smoothstep(0.0, 45.0, abs(r - edge * 0.97))));
    if (m > best) {
      best = m;
      centre = c.xy;
      reach = max(c.z, 1.0);
    }
    cover = max(cover, m);
  }
  if (cover > 0.002 || rim > 0.002) {
    float aa = max(fwidth(cp.x), fwidth(cp.y));
    // Board traces: two layers crossing at right angles.
    vec3 a = ciLayer(cp, 700.0, 150.0, aa, 17.0);
    vec3 b = ciLayer(cp.yx + vec2(41.0, 23.0), 820.0, 190.0, aa, 71.0);
    float trace = max(a.x, b.x);
    float pad = max(a.y, b.y);
    // Data buses radiating from the unit, with pulses running out along them.
    vec2 d = cp - centre;
    float r = length(d);
    float turns = atan(d.y, d.x) / 6.2832 * 16.0;
    float hs = ciHash(vec2(floor(turns), floor(centre.x * 0.01)));
    float side = abs(fract(turns) - 0.5) * 6.2832 / 16.0 * r;
    float bus = step(0.3, hs) * (1.0 - smoothstep(16.0, 16.0 + aa, side)) * smoothstep(60.0, 160.0, r);
    float pulse = pow(fract(r / 520.0 - uCircuitTime * 0.8 + hs), 5.0) * (1.0 - smoothstep(reach * 0.6, reach * 0.95, r));
    // Far away (a trace under a pixel) the pattern thins into its average glow.
    float far = smoothstep(24.0, 70.0, aa);
    // a black-green circuit board under the traces
    outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.14, 0.2, 0.21) + vec3(0.0, 0.01, 0.012), cover * 0.94);
    vec3 cyan = vec3(0.1, 0.78, 1.0);
    // some pads blink red
    float red = pad * step(0.78, fract(a.z * 11.3 + b.z * 5.1)) * step(0.5, fract(uCircuitTime * (0.7 + a.z) + a.z * 9.0));
    float lit = mix(0.6 * trace + 1.0 * pad + bus * (0.75 + 2.6 * pulse), 0.14 + 0.5 * pulse, far);
    vec3 glow = cyan * lit + vec3(1.0, 0.08, 0.05) * red * 1.5 * (1.0 - far);
    outgoingLight += glow * cover + cyan * rim * 1.2;
  }
}
#include <opaque_fragment>`,
    );
  return shader;
}
