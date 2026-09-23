// The waterfall at layout.WATERFALL: a stream on the cliff-top plateau runs between two
// rock banks into a rocky spillway notch built out from the cliff rim, tips over the lip at
// WATERFALL.topY and falls in layered translucent sheets into the pond, where animated
// spray, foam and a light mist hide the impact. Visual only: no collision.
//
// Geometry is authored in a local frame: o = distance out from the cliff face (along
// faceNormalX), s = sideways along the face, y = height.

import * as THREE from 'three';
import { makeRng, smoothstep } from '../../core/math.js';
import { worldMaterial } from '../../render/materials.js';
import { MeshBuilder, addSolid, lumpyDome } from './geom.js';
import { puffTexture, waterfallTexture } from './textures.js';

const LIP = 300; // how far the spillway lip juts out from the cliff face
const CHUTE_TOP = 20; // where the chute leaves the rim
const STREAM_BACK = -760; // start of the visible stream on the plateau
const BULGE = 170; // how far the falling sheet drifts outward by the bottom
const FALL_ROWS = 12;
const FLOW_SPEED = 1.1; // texture repeats per second
const ROCK_TINT = [1.04, 0.93, 0.78]; // warm the grey rock toward the tan cliffs

export function buildWaterfall(layout, kit) {
  const WF = layout.WATERFALL;
  const nx = WF.faceNormalX;
  const width = WF.width;
  const rim = layout.CLIFF_TOP;
  const lipY = WF.topY;
  const water = layout.WATER_LEVEL;
  // Local -> world. For faceNormalX = -1 this is a 180 degree turn, so winding is kept.
  const W = (o, y, s) => ({ x: WF.x + o * nx, y, z: WF.z + s * nx });
  const outDir = (o, y, s) => [o * nx, y, s * nx];

  // Falling profile below the lip: t = 0..1 from the lip to the pond surface.
  const fall = (t) => ({ o: LIP + 14 + BULGE * Math.sqrt(t), y: lipY - t * (lipY - water - 2) });

  // ------------------------------------------------------------ water sheets
  const sheets = new MeshBuilder({ alpha: true });
  const rng = makeRng(5150);
  // A ribbon along a profile of { o, y, width, alpha, dv } rows (dv = texture v per unit
  // length, i.e. slower flow where it is larger).
  const ribbon = (rows, { uScale, uOffset, rgb, depth = 0, cols = 7, ragged = 40 }) => {
    let v = 0;
    const edge = rows.map(() => [(rng() - 0.5) * ragged, (rng() - 0.5) * ragged]);
    const grid = rows.map((row, k) => {
      if (k > 0) v += Math.hypot(row.o - rows[k - 1].o, row.y - rows[k - 1].y) * row.dv;
      return Array.from({ length: cols + 1 }, (_, c) => {
        const f = c / cols;
        const s = (f - 0.5) * row.width + (c === 0 ? edge[k][0] : c === cols ? edge[k][1] : 0);
        const side = smoothstep(0, 0.2, Math.min(f, 1 - f));
        return { ...W(row.o + depth, row.y, s), u: s / uScale + uOffset, v, r: rgb[0], g: rgb[1], b: rgb[2], a: row.alpha * side };
      });
    });
    for (let k = 0; k + 1 < grid.length; k++) {
      for (let c = 0; c < cols; c++) sheets.quad(grid[k][c], grid[k][c + 1], grid[k + 1][c + 1], grid[k + 1][c]);
    }
  };
  const fallRows = (widthScale, alpha, dv) =>
    Array.from({ length: FALL_ROWS + 1 }, (_, k) => {
      const t = (k / FALL_ROWS) ** 1.4;
      const p = fall(t);
      return { ...p, width: width * widthScale * (1 + 0.28 * t), alpha: alpha * (1 - 0.25 * smoothstep(0.85, 1, t)), dv };
    });
  const streamY = rim + 30;
  // Back body: bluer and denser, slowest.
  ribbon(fallRows(0.94, 0.85, 1 / 800), { uScale: 520, uOffset: 0.37, rgb: [0.72, 0.85, 0.98], depth: -22 });
  // Main sheet, continuous from the plateau stream down the chute and over the lip.
  ribbon(
    [
      { o: STREAM_BACK, y: streamY, width: width * 0.8, alpha: 0.9, dv: 1 / 380 },
      { o: CHUTE_TOP, y: streamY, width: width * 0.84, alpha: 0.92, dv: 1 / 380 },
      { o: (CHUTE_TOP + LIP) / 2, y: (streamY + lipY) / 2 + 20, width: width * 0.86, alpha: 0.95, dv: 1 / 700 },
      ...fallRows(0.86, 0.8, 1 / 1100),
    ],
    { uScale: 600, uOffset: 0, rgb: [0.88, 0.95, 1] },
  );
  // Front veil: whiter, thinner, fastest.
  ribbon(fallRows(0.68, 0.55, 1 / 1500), { uScale: 440, uOffset: 0.71, rgb: [1, 1, 1], depth: 28, cols: 5, ragged: 80 });

  const sheetTex = waterfallTexture();
  const sheetMat = worldMaterial({ map: sheetTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const sheetMesh = new THREE.Mesh(sheets.toGeometry(), sheetMat);
  sheetMesh.name = 'waterfall';
  sheetMesh.renderOrder = 3; // after the pond surface (1, 2)

  // ------------------------------------------------------------ rock notch
  buildSpillway(kit.rock, { W, outDir, width, rim, lipY });
  const rockColor = (bottom, top) => (x, y) => {
    const ao = 0.6 + 0.4 * smoothstep(bottom, top, y);
    return ROCK_TINT.map((c) => c * ao);
  };
  // Craggy buttress: a jittered, rounded-bottom ellipsoid half sunk into the cliff face.
  const crag = (o, s, bottom, top, ro, rs, seed) => {
    const S = (top - bottom) / 1.7; // lumpyDome spans y = -0.7 .. 1 with flatBottom 0.7
    const geo = lumpyDome({ detail: 1, jitter: 0.3, flatBottom: 0.7, seed });
    const p = W(o, bottom + 0.7 * S, s);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, p.y, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), seed),
      new THREE.Vector3(ro, S, rs),
    );
    addSolid(kit.rock, geo, m, { tile: 360, colorFn: rockColor(bottom, top) });
  };
  // Tall buttresses framing the notch (their tops rise above the rim), smaller ones lower
  // down beside the lip, and low banks along the stream on the plateau.
  for (const side of [-1, 1]) {
    crag(-30, side * (width / 2 + 170), lipY - 750, rim + 170, 210, 270, 7 + side);
    crag(110, side * (width / 2 + 60), lipY - 520, lipY + 90, 150, 160, 11 + side);
    crag(-420, side * (width * 0.43 + 90), rim - 60, rim + 150, 360, 130, 17 + side);
  }

  // ------------------------------------------------------------ spray, foam, mist
  const impact = fall(1);
  const splash = new SplashSprites({ W, width, impactO: impact.o, water, rng });

  return {
    sheets: sheetMesh,
    splash: splash.mesh,
    update(time, camera) {
      sheetTex.offset.y = -((time * FLOW_SPEED) % 1);
      splash.update(time, camera);
    },
  };
}

// Rocky spillway under the chute: a wedge extruded along the notch width whose top carries
// the water (just under the sheet), whose front is the lip, and whose underside slopes back
// into the cliff face. Its back sits inside the cliff (the cliff face is recessed up to
// ~120 units in places).
function buildSpillway(builder, { W, outDir, width, rim, lipY }) {
  const rng = makeRng(8080);
  const back = -150;
  const profile = [
    { o: back, y: rim + 18 },
    { o: CHUTE_TOP, y: rim + 18 },
    { o: LIP + 8, y: lipY - 14 },
    { o: LIP + 26, y: lipY - 120 },
    { o: 150, y: lipY - 330 },
    { o: back, y: lipY - 560 },
  ];
  const half = width / 2 + 90;
  const segs = 6;
  const cols = Array.from({ length: segs + 1 }, (_, i) => -half + (2 * half * i) / segs);
  // Jitter the lower (visible from below) profile points per column for a rough face.
  const point = (k, i) => {
    const p = profile[k];
    const rough = k >= 3 && i > 0 && i < segs ? 1 : 0;
    return { o: p.o + rough * (rng() - 0.5) * 60, y: p.y + rough * (rng() - 0.5) * 50 };
  };
  const grid = cols.map((s, i) => profile.map((_, k) => ({ ...point(k, i), s })));
  const shade = (y) => {
    const ao = 0.55 + 0.45 * smoothstep(lipY - 560, lipY, y);
    return { r: ROCK_TINT[0] * ao, g: ROCK_TINT[1] * ao, b: ROCK_TINT[2] * ao };
  };
  const vert = (p, u, v) => ({ ...W(p.o, p.y, p.s), u, v, ...shade(p.y) });
  const TILE = 360;
  // Profile runs clockwise in (o, y), so each edge's outward normal is (-dy, do).
  for (let k = 0; k < profile.length; k++) {
    const k1 = (k + 1) % profile.length;
    for (let i = 0; i < segs; i++) {
      const a = grid[i][k];
      const b = grid[i][k1];
      const c = grid[i + 1][k1];
      const d = grid[i + 1][k];
      const along = (p) => (p.o + p.y) / TILE;
      const out = outDir(-(b.y - a.y), b.o - a.o, 0);
      builder.facingQuad(vert(a, a.s / TILE, along(a)), vert(b, b.s / TILE, along(b)), vert(c, c.s / TILE, along(c)), vert(d, d.s / TILE, along(d)), out);
    }
  }
  // End caps (mostly hidden inside the crags): fan over the profile polygon.
  for (const [i, dir] of [
    [0, -1],
    [segs, 1],
  ]) {
    const ring = grid[i];
    for (let k = 1; k + 1 < ring.length; k++) {
      builder.facingTri(vert(ring[0], ring[0].o / TILE, ring[0].y / TILE), vert(ring[k], ring[k].o / TILE, ring[k].y / TILE), vert(ring[k + 1], ring[k + 1].o / TILE, ring[k + 1].y / TILE), outDir(0, 0, dir));
    }
  }
}

// Animated sprites at the foot of the fall, all in one mesh: rising spray puffs and slow
// mist (camera-facing) and foam patches drifting out over the pond (flat on the water).
// Each sprite loops on its own period; update() rewrites positions and vertex alpha.
class SplashSprites {
  constructor({ W, width, impactO, water, rng }) {
    this.W = W;
    this.water = water;
    const make = (kind, count, f) => Array.from({ length: count }, (_, i) => ({ kind, ...f(i) }));
    const across = () => (rng() - 0.5) * width * 1.05;
    this.sprites = [
      ...make('foam', 26, () => ({
        o: impactO + (rng() - 0.3) * 120,
        s: across(),
        driftO: 350 + rng() * 650,
        driftS: (rng() - 0.5) * 700,
        size: [240 + rng() * 120, 520 + rng() * 260],
        period: 3 + rng() * 2.5,
        phase: rng(),
        alpha: 0.75,
        rot: rng() * Math.PI * 2,
      })),
      ...make('spray', 28, () => ({
        o: impactO + (rng() - 0.5) * 90,
        s: across(),
        driftO: 60 + rng() * 180,
        rise: 160 + rng() * 260,
        size: [150 + rng() * 60, 320 + rng() * 180],
        period: 1.2 + rng() * 0.9,
        phase: rng(),
        alpha: 0.9,
      })),
      // Light mist hugging the impact: small, faint, never drifting far from the fall.
      ...make('mist', 7, () => ({
        o: impactO + 50 + rng() * 100,
        s: (rng() - 0.5) * width * 0.9,
        driftO: rng() * 100,
        rise: 150 + rng() * 150,
        size: [300 + rng() * 100, 480 + rng() * 120],
        period: 4.5 + rng() * 3,
        phase: rng(),
        alpha: 0.18,
      })),
    ];
    const n = this.sprites.length;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 12), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 16), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(n * 8);
    const index = [];
    for (let i = 0; i < n; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    const c = W(impactO, water, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.x, c.y, c.z), width + 1800);
    const mat = worldMaterial({ map: puffTexture(), transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'waterfallSplash';
    this.mesh.renderOrder = 4;
    this.right = { x: 1, z: 0 };
    this.fwd = new THREE.Vector3();
    this.update(0, null);
  }

  update(time, camera) {
    if (camera) {
      camera.getWorldDirection(this.fwd);
      const l = Math.hypot(this.fwd.x, this.fwd.z);
      if (l > 1e-3) this.right = { x: -this.fwd.z / l, z: this.fwd.x / l };
    }
    const { x: rx, z: rz } = this.right;
    const p = this.pos.array;
    const c = this.col.array;
    this.sprites.forEach((sp, i) => {
      const a = (time / sp.period + sp.phase) % 1;
      const size = sp.size[0] + (sp.size[1] - sp.size[0]) * a;
      const h = size / 2;
      let alpha;
      if (sp.kind === 'foam') {
        const ctr = this.W(sp.o + sp.driftO * a, this.water + 4, sp.s + sp.driftS * a);
        const cr = Math.cos(sp.rot + a) * h;
        const sr = Math.sin(sp.rot + a) * h;
        // Flat quad, wound to face up: corners c -+ U -+ V with U = (cos, sin), V = (sin, -cos).
        p.set(
          [
            ctr.x - cr - sr, ctr.y, ctr.z - sr + cr,
            ctr.x + cr - sr, ctr.y, ctr.z + sr + cr,
            ctr.x + cr + sr, ctr.y, ctr.z + sr - cr,
            ctr.x - cr + sr, ctr.y, ctr.z - sr - cr,
          ],
          i * 12,
        );
        alpha = sp.alpha * smoothstep(0, 0.12, a) * (1 - a);
      } else {
        const lift = 1 - (1 - a) * (1 - a);
        const ctr = this.W(sp.o + sp.driftO * a, this.water + h * 0.55 + sp.rise * lift, sp.s);
        const hx = rx * h;
        const hz = rz * h;
        p.set(
          [
            ctr.x - hx, ctr.y - h, ctr.z - hz,
            ctr.x + hx, ctr.y - h, ctr.z + hz,
            ctr.x + hx, ctr.y + h, ctr.z + hz,
            ctr.x - hx, ctr.y + h, ctr.z - hz,
          ],
          i * 12,
        );
        alpha = sp.alpha * Math.sin(Math.PI * a) ** 0.8;
      }
      const tint = sp.kind === 'mist' ? [0.92, 0.96, 1] : [1, 1, 1];
      for (let k = 0; k < 4; k++) c.set([...tint, alpha], i * 16 + k * 4);
    });
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
