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
// Collision uses the same walls and floors, except that flat-enough stretches of ground are
// merged into large blocks (floorBlocks.js) to keep camera raycasts cheap.

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

const STEP = 100; // fine grid cell size
const FAR = 13000; // half-size of the cliff-top plateau
const FAR_STEP = 500;
const PLATEAU = 800; // fine grid margin beyond the perimeter (covers the cliff rim's swell)
const CLIFF_COLLIDE = 400; // cliff-top collision reaches this far beyond the perimeter
const TOL = 3; // merged collision floors lie at most this far above the rendered ground
const SHORE = 55; // pond bank: grass above WATER_LEVEL + SHORE, sandy beach/bed below

// World size of one texture tile.
const TILE = { grass: 384, path: 448, flagstone: 520, sand: 400 };

// Fields used to split the grid (<= 0 is inside), in clip order.
const F = { PERIMETER: 0, ISLAND: 1, WATER: 2, COURTYARD: 3, SHORE: 4 };

// Piece labels -> region (height function) and ground material.
const LABELS = {
  cliff: { region: 'cliff', material: 'grass', terrain: 'grass' },
  island: { region: 'island', material: 'grass', terrain: 'grass' },
  courtyard: { region: 'island', material: 'flagstone', terrain: 'stone' },
  lawn: { region: 'lawn', material: 'grass', terrain: 'grass' },
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

  const groundVertex = (v, label) => {
    const { region, material } = LABELS[label];
    const p = surface(v, region);
    const rgb = material === 'grass' ? grassTint(v.x, p.y, v.z, p.nx, p.ny, p.nz) : groundTint(v.x, p.y, v.z);
    const t = TILE[material];
    const col = rgbOf(applyUnderwater(rgb, p.y));
    return { x: v.x, y: p.y, z: v.z, nx: p.nx, ny: p.ny, nz: p.nz, u: v.x / t, v: v.z / t, ...col };
  };

  const fields = [
    (x, z) => L.sdRoundRect(x, z, L.PERIMETER),
    (x, z) => L.sdRoundRect(x, z, L.ISLAND),
    (x, z) => L.sdWater(x, z),
    (x, z) => L.sdRoundRect(x, z, L.COURTYARD),
    (x, z) => L.waterFloorHeight(x, z) - (L.WATER_LEVEL + SHORE),
  ];
  // Fine grid over the playable area and the cliff rim (aligned to FAR_STEP so the far ring
  // abuts it exactly).
  const bounds = {
    minX: Math.floor((L.PERIMETER.minX - PLATEAU) / FAR_STEP) * FAR_STEP,
    maxX: Math.ceil((L.PERIMETER.maxX + PLATEAU) / FAR_STEP) * FAR_STEP,
    minZ: Math.floor((L.PERIMETER.minZ - PLATEAU) / FAR_STEP) * FAR_STEP,
    maxZ: Math.ceil((L.PERIMETER.maxZ + PLATEAU) / FAR_STEP) * FAR_STEP,
  };
  const grid = {
    minX: bounds.minX,
    minZ: bounds.minZ,
    cols: (bounds.maxX - bounds.minX) / STEP,
    rows: (bounds.maxZ - bounds.minZ) / STEP,
    step: STEP,
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

  // Rendered ground, path decal, collision floors (where no block covers them) and walls.
  const emit = (a, b, c, tags, label) => {
    const info = LABELS[label];
    const verts = [a, b, c];
    const gv = verts.map((v) => groundVertex(v, label));
    const buf = buffers[info.material];
    // Contour vertices are shared by regions at different heights: key by vertex + region.
    const rk = REGION_KEY[info.region];
    buf.tri(...verts.map((v, i) => buf.vertex(gv[i], v.id * 4 + rk)));

    const masks = verts.map((v) => decalMask(label, v.x, v.z));
    if (Math.max(...masks) > 0.004) {
      const decal = verts.map((v, i) => ({
        ...gv[i],
        ...rgbOf(groundTint(v.x, gv[i].y, v.z)),
        u: v.x / TILE.path,
        v: v.z / TILE.path,
        a: masks[i],
      }));
      pathOverlay.tri(...verts.map((v, i) => pathOverlay.vertex(decal[i], v.id)));
    }

    // Collision (CCW from above = floor facing up).
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    if (floorLike(gv) && !blocks.covers(cx, cz) && (label !== 'cliff' || L.sdRoundRect(cx, cz, L.PERIMETER) < CLIFF_COLLIDE)) {
      const path = label === 'lawn' ? (masks[0] + masks[1] + masks[2]) / 3 : 0;
      colliders[floorTerrain(label, path)].push(...gv.flatMap((g) => [g.x, g.y, g.z]));
    }

    // Walls along region contours, built once from the side that knows both regions.
    for (let k = 0; k < 3; k++) {
      const wall = wallAcross(tags[k], info.region, verts[k], verts[(k + 1) % 3]);
      if (wall) addWall(wall, info.region, verts[k], verts[(k + 1) % 3]);
    }
  };

  // What lies across a contour edge of a piece in `region`, or null when this piece does not
  // own that wall: returns { other, style, contour }.
  const wallAcross = (tag, region, p, q) => {
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
  };

  const addWall = ({ other, style, contour }, region, p, q) => {
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
  };

  tessellate({ ...grid, fields, decide, emit });
  for (const [terrain, positions] of Object.entries(blocks.positions)) colliders[terrain].push(...positions);

  buildFarRing(L, buffers.grass, bounds);

  // Meshes, one per material.
  const group = new THREE.Group();
  group.name = 'terrain';
  const addMesh = (name, buffer, map) => {
    const geo = buffer.toGeometry();
    bakeLighting(geo);
    const mesh = new THREE.Mesh(geo, worldMaterial({ map }));
    mesh.name = name;
    group.add(mesh);
  };
  addMesh('grass', buffers.grass, tex.grassTexture());
  addMesh('courtyard', buffers.flagstone, tex.flagstoneTexture());
  addMesh('bed', buffers.sand, tex.sandTexture());
  addMesh('cliffs', buffers.rock, tex.rockTexture());
  addMesh('masonry', buffers.masonry, tex.masonryTexture());
  addPathOverlay(group, pathOverlay);

  const water = buildWater(L);
  group.add(water.object3D);

  return {
    object3D: group,
    colliders: [
      { positions: new Float32Array(colliders.grass), terrain: 'grass' },
      { positions: new Float32Array(colliders.stone), terrain: 'stone' },
      { positions: new Float32Array(colliders.sand), terrain: 'sand' },
    ],
    update(time) {
      water.update(time);
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

function rgbOf(c) {
  return { r: c[0], g: c[1], b: c[2] };
}

// Dirt path decal: the lawn triangles under a path, drawn again with the path texture and a
// per-vertex alpha from pathMask so the path edges blend softly into the grass.
function addPathOverlay(group, buffer) {
  const geo = buffer.toGeometry();
  const rgba = geo.attributes.color;
  const alpha = Array.from({ length: rgba.count }, (_, i) => rgba.getW(i));
  bakeLighting(geo); // rewrites colour as RGB
  const rgb = geo.attributes.color;
  const out = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) out.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), alpha[i]], i * 4);
  geo.setAttribute('color', new THREE.BufferAttribute(out, 4));
  const mat = worldMaterial({ map: tex.pathTexture(), transparent: true, depthWrite: false });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -4;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'paths';
  group.add(mesh);
}

// Coarse cliff-top plateau and distant rolling hills around the fine grid (visual only).
function buildFarRing(L, buffer, b) {
  const n = (2 * FAR) / FAR_STEP;
  const key = (i, j) => -1 - (j * (n + 1) + i);
  const vert = (i, j) => {
    const x = -FAR + i * FAR_STEP;
    const z = -FAR + j * FAR_STEP;
    const h = (px, pz) => L.cliffHeight(px, pz);
    const e = 60;
    const dx = (h(x + e, z) - h(x - e, z)) / (2 * e);
    const dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    const y = h(x, z);
    const nx = -dx / l;
    const ny = 1 / l;
    const nz = -dz / l;
    const c = grassTint(x, y, z, nx, ny, nz);
    return buffer.vertex({ x, y, z, nx, ny, nz, u: x / TILE.grass, v: z / TILE.grass, ...rgbOf(c) }, key(i, j));
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -FAR + i * FAR_STEP;
      const z0 = -FAR + j * FAR_STEP;
      if (x0 >= b.minX && x0 + FAR_STEP <= b.maxX && z0 >= b.minZ && z0 + FAR_STEP <= b.maxZ) continue;
      const v00 = vert(i, j);
      const v10 = vert(i + 1, j);
      const v01 = vert(i, j + 1);
      const v11 = vert(i + 1, j + 1);
      buffer.tri(v00, v01, v10);
      buffer.tri(v10, v01, v11);
    }
  }
}
