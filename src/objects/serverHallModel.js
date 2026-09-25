// Models and materials for the AI RACE "tech takeover" (ServerHalls.js): three original unit
// types in a dark sci-fi style, all low-poly boxes and tubes with baked vertex lighting.
//
//   tower  a single tall server-rack monolith on a hazard-striped plinth: rack fronts front and
//          back, vent grilles on the sides, glowing corner rails, a cap with two red beacons,
//          two cable bundles diving into the ground behind it
//   row    four racks side by side on a skirt, a ladder cable tray along the top with glowing
//          cables in it, light strips at both ends, cables into the ground at the ends
//   hall   a data-hall module the size of a shipping container: five racks behind each long
//          side, a header band with a light strip, big vent grilles and beacons on the ends,
//          three cooling fans on the roof, four thick cable bundles running into the ground
//
// Every unit type is one BufferGeometry (drawn instanced, one draw call per type) sharing one
// material: MeshBasicMaterial with vertex colours, patched so a per-vertex `aLed` (u, v, kind,
// id) selects what the fragment draws on top of the baked colour:
//   0 body     plain
//   1 rack     rack units (v counts them from the bottom): face plates and blanking panels,
//              blinking status LEDs (cyan, red, some green and amber) and a flickering activity
//              LED per server; each LED's colour, rate and phase come from a hash of the row,
//              the panel id and the instance's seed, so every unit twinkles on its own
//   2 cable    light pulses running down the cable into the ground
//   3 fan      spinning blades over a hot red glow
//   4 strip    a cyan light bar with a red scanner light running along it
//   5 beacon   a slow red blink
//   6 vent     slats with a dull heat glow behind them
//   7 hazard   yellow and black stripes
// Per instance (`aHall`: seed, power): power 0..1 dims every light (the boot flicker when a
// unit arrives, the shutdown when it sinks). Far away (a rack unit under ~2 px) the LED detail
// fades into its average glow, so nothing shimmers. The lights partly shine through the fog.
//
// The landing warning marker (buildMarkerGeometry / makeMarkerMaterial) is one more instanced
// draw: a red outline of the footprint with hazard stripes and pulsing echoes on the ground,
// and a column of red light rising from it, pulsing faster as the impact nears.
//
// Local space of every unit: origin at the centre of its base, +Y up, the front (+Z) and back
// (-Z) are its long, rack-lined sides. HALL_TYPES are the collider sizes (the outer box).

import * as THREE from 'three';
import { bakeLighting } from '../render/materials.js';
import { scaledFog } from './robotBeastModel.js';

export const HALL_TYPES = {
  tower: { w: 260, d: 260, h: 720 },
  row: { w: 740, d: 260, h: 460 },
  hall: { w: 920, d: 540, h: 420 },
};

export const LED = { BODY: 0, RACK: 1, CABLE: 2, FAN: 3, STRIP: 4, BEACON: 5, VENT: 6, HAZARD: 7 };

const U = 34; // one rack unit (world units)

// Linear vertex colours.
const COL = {
  steel: [0.12, 0.13, 0.155],
  steelLight: [0.2, 0.21, 0.24],
  dark: [0.045, 0.048, 0.056],
  panel: [0.07, 0.075, 0.09],
  trim: [0.028, 0.03, 0.036],
  cable: [0.03, 0.035, 0.04],
  vent: [0.1, 0.105, 0.12],
  fan: [0.05, 0.05, 0.055],
  hazard: [0.5, 0.36, 0.03],
};

// ---------------------------------------------------------------- geometry builder

class HallGeo {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.led = [];
  }

  // A triangle facing (nx, ny, nz) (its winding is fixed to face it); l*: [u, v, kind, id].
  tri(a, b, c, color, la, lb, lc, nx, ny, nz) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let cx = uy * vz - uz * vy;
    let cy = uz * vx - ux * vz;
    let cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz < 0) {
      [b, c] = [c, b];
      [lb, lc] = [lc, lb];
      cx = -cx;
      cy = -cy;
      cz = -cz;
    }
    const l = Math.hypot(cx, cy, cz) || 1;
    for (const [p, q] of [[a, la], [b, lb], [c, lc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(cx / l, cy / l, cz / l);
      this.col.push(color[0], color[1], color[2]);
      this.led.push(q[0], q[1], q[2], q[3]);
    }
  }

  quad(a, b, c, d, color, la, lb, lc, ld, nx, ny, nz) {
    this.tri(a, b, c, color, la, lb, lc, nx, ny, nz);
    this.tri(a, c, d, color, la, lc, ld, nx, ny, nz);
  }

  // Axis-aligned box. faces: { px, nx, pz, nz, py } (a face left out is not built; the bottom
  // never is), each { color?, kind?, id?, rows? (rack faces: v in rack units from y0) }.
  box(x0, x1, y0, y1, z0, z1, { color = COL.steel, faces = {} } = {}) {
    const face = (name) => (faces[name] === false ? null : { color, kind: 0, id: 0, ...(faces[name] ?? {}) });
    // Per-kind (u, v) of a side face point at fraction t across it (length `len`) and height y:
    // racks count rack units up from y0, vents their slats, hazard stripes run on world units,
    // strips put u along their longer side (the scanner runs along it).
    const led = (f, t, len, y) => {
      const k = f.kind;
      if (k === LED.RACK) return [t, (y - y0) / (f.unit ?? U), k, f.id];
      if (k === LED.VENT) return [t, (y - y0) / 22, k, f.id];
      if (k === LED.HAZARD) return [(t * len) / 60, y / 60, k, f.id];
      const v = (y - y0) / (y1 - y0);
      if (k === LED.STRIP && y1 - y0 > len) return [v, t, k, f.id];
      return [t, v, k, f.id];
    };
    const side = (f, a, b, c, d, len, nx, nz) =>
      this.quad(a, b, c, d, f.color, led(f, 0, len, y0), led(f, 1, len, y0), led(f, 1, len, y1), led(f, 0, len, y1), nx, 0, nz);
    let f = face('pz');
    if (f) side(f, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x1 - x0, 0, 1);
    f = face('nz');
    if (f) side(f, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], x1 - x0, 0, -1);
    f = face('px');
    if (f) side(f, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], z1 - z0, 1, 0);
    f = face('nx');
    if (f) side(f, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z1 - z0, -1, 0);
    f = face('py');
    if (f) {
      const L = (u, v) => [u, v, f.kind, f.id];
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], f.color, L(0, 0), L(1, 0), L(1, 1), L(0, 1), 0, 1, 0);
    }
  }

  // A vertical n-sided cylinder (sides + top) centred on (cx, cz); the top face is `top`.
  cylinder(cx, cz, r, y0, y1, n, color, top = null) {
    const P = (k, y) => {
      const a = (k / n) * Math.PI * 2;
      return [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    };
    const b = [0, 0, LED.BODY, 0];
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      this.quad(P(k, y0), P(k + 1, y0), P(k + 1, y1), P(k, y1), color, b, b, b, b, Math.cos(a), 0, Math.sin(a));
    }
    const t = top ?? { color, kind: 0, id: 0 };
    const c = [cx, y1, cz];
    const lc = [0.5, 0.5, t.kind, t.id];
    for (let k = 0; k < n; k++) {
      const p = P(k, y1);
      const q = P(k + 1, y1);
      const lp = [0.5 + ((p[0] - cx) / r) * 0.5, 0.5 + ((p[2] - cz) / r) * 0.5, t.kind, t.id];
      const lq = [0.5 + ((q[0] - cx) / r) * 0.5, 0.5 + ((q[2] - cz) / r) * 0.5, t.kind, t.id];
      this.tri(c, p, q, t.color ?? color, lc, lp, lq, 0, 1, 0);
    }
  }

  // A cable bundle: an n-sided tube of radius r through `points` ([x, y, z]); u runs 0 -> 1
  // along it (the pulses run toward u = 1, its end in the ground).
  tube(points, r, n, id) {
    let total = 0;
    const len = [0];
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
      len.push(total);
    }
    // A frame per point: the tangent and two normals.
    const rings = points.map((p, i) => {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const side = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(side, t).normalize();
      const ring = [];
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const dx = side.x * Math.cos(ang) + up.x * Math.sin(ang);
        const dy = side.y * Math.cos(ang) + up.y * Math.sin(ang);
        const dz = side.z * Math.cos(ang) + up.z * Math.sin(ang);
        ring.push({ p: [p[0] + dx * r, p[1] + dy * r, p[2] + dz * r], n: [dx, dy, dz] });
      }
      return ring;
    });
    for (let i = 0; i + 1 < points.length; i++) {
      const u0 = len[i] / total;
      const u1 = len[i + 1] / total;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        const a = rings[i][k];
        const b = rings[i][k1];
        const c = rings[i + 1][k1];
        const d = rings[i + 1][k];
        const nx = a.n[0] + b.n[0] + c.n[0] + d.n[0];
        const ny = a.n[1] + b.n[1] + c.n[1] + d.n[1];
        const nz = a.n[2] + b.n[2] + c.n[2] + d.n[2];
        this.quad(a.p, b.p, c.p, d.p, COL.cable, [u0, k / n, LED.CABLE, id], [u0, (k + 1) / n, LED.CABLE, id], [u1, (k + 1) / n, LED.CABLE, id], [u1, k / n, LED.CABLE, id], nx, ny, nz);
      }
    }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aLed', new THREE.Float32BufferAttribute(this.led, 4));
    bakeLighting(g, { ambient: 0.72, diffuse: 0.5, maxBright: 1.1 });
    g.deleteAttribute('normal');
    g.computeBoundingSphere();
    return g;
  }
}

// A curve from a point on the unit (x, y, z) out along (dx, dz) and down into the ground.
function cablePath(x, y, z, dx, dz, out, dip = 60) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const reach = out * t;
    // leaves the wall level, sags to the ground, then dives under it
    const h = y * (1 - t) * (1 - t) - dip * t * t * t;
    pts.push([x + dx * reach, h, z + dz * reach]);
  }
  return pts;
}

// Rack-face spec for a box face.
const rack = (id, extra = {}) => ({ color: COL.panel, kind: LED.RACK, id, ...extra });

// ---------------------------------------------------------------- unit types

function buildTower() {
  const g = new HallGeo();
  const T = HALL_TYPES.tower;
  const hw = T.w / 2;
  const PL = 70; // plinth top
  const TOP = T.h - 30; // body top, under the cap
  const B = hw - 16; // body half size
  g.box(-hw, hw, 0, PL, -hw, hw, { color: COL.dark, faces: { pz: { color: COL.hazard, kind: LED.HAZARD }, nz: { color: COL.hazard, kind: LED.HAZARD }, px: { color: COL.hazard, kind: LED.HAZARD }, nx: { color: COL.hazard, kind: LED.HAZARD } } });
  g.box(-B, B, PL, TOP, -B, B, { color: COL.steel, faces: { pz: rack(1), nz: rack(2), px: { color: COL.vent, kind: LED.VENT }, nx: { color: COL.vent, kind: LED.VENT }, py: false } });
  // Corner rails with light strips on their outer faces.
  const R = 11;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * B;
      const z = sz * B;
      const strip = { color: COL.trim, kind: LED.STRIP, id: 3 + (sx + 1) + (sz + 1) / 2 };
      g.box(x - R, x + R, PL, TOP + 8, z - R, z + R, { color: COL.trim, faces: { pz: sz > 0 ? strip : {}, nz: sz < 0 ? strip : {}, py: false } });
    }
  }
  g.box(-hw, hw, TOP, T.h, -hw, hw, { color: COL.steelLight, faces: { pz: { color: COL.trim, kind: LED.STRIP, id: 9 }, nz: { color: COL.trim, kind: LED.STRIP, id: 10 } } });
  // Beacons on the cap.
  for (const s of [-1, 1]) g.box(s * (hw - 40) - 14, s * (hw - 40) + 14, T.h, T.h + 16, -14, 14, { color: COL.trim, faces: { pz: { kind: LED.BEACON, id: s }, nz: { kind: LED.BEACON, id: s }, px: { kind: LED.BEACON, id: s }, nx: { kind: LED.BEACON, id: s }, py: { kind: LED.BEACON, id: s } } });
  // Cable bundles out of the back into the ground.
  g.tube(cablePath(-50, 150, -B, -0.25, -1, 240), 13, 5, 1);
  g.tube(cablePath(45, 110, -B, 0.3, -1, 210), 11, 5, 2);
  return g.toGeometry();
}

function buildRow() {
  const g = new HallGeo();
  const T = HALL_TYPES.row;
  const hw = T.w / 2;
  const hd = T.d / 2;
  const SK = 50; // skirt top
  const TOP = T.h - 20; // rack tops (the tray rails reach T.h)
  g.box(-hw, hw, 0, SK, -hd, hd, { color: COL.dark, faces: { pz: { color: COL.hazard, kind: LED.HAZARD }, nz: { color: COL.hazard, kind: LED.HAZARD } } });
  const N = 4;
  const gap = 8;
  const rw = (T.w - 20 - gap * (N - 1)) / N;
  const rd = hd - 10;
  for (let i = 0; i < N; i++) {
    const x0 = -hw + 10 + i * (rw + gap);
    const x1 = x0 + rw;
    const ends = { px: i === N - 1 ? { color: COL.vent, kind: LED.VENT } : false, nx: i === 0 ? { color: COL.vent, kind: LED.VENT } : false };
    g.box(x0, x1, SK, TOP, -rd, rd, { color: COL.steel, faces: { pz: rack(10 + i), nz: rack(20 + i), ...ends } });
    // a thin frame lip on top of each rack
    g.box(x0 - 2, x1 + 2, TOP - 12, TOP, -rd - 3, rd + 3, { color: COL.trim, faces: { px: i === N - 1 ? {} : false, nx: i === 0 ? {} : false } });
  }
  // Light strips down both ends.
  for (const s of [-1, 1]) {
    const x = s * (hw - 4);
    g.box(x - 6, x + 6, SK, TOP, -rd - 6, -rd + 6, { color: COL.trim, faces: { px: s > 0 ? { kind: LED.STRIP, id: 30 + s } : false, nx: s < 0 ? { kind: LED.STRIP, id: 31 + s } : false, pz: false } });
    g.box(x - 6, x + 6, SK, TOP, rd - 6, rd + 6, { color: COL.trim, faces: { px: s > 0 ? { kind: LED.STRIP, id: 33 + s } : false, nx: s < 0 ? { kind: LED.STRIP, id: 34 + s } : false, nz: false } });
  }
  // Ladder cable tray along the top, with glowing cables in it.
  for (const s of [-1, 1]) g.box(-hw + 6, hw - 6, TOP, T.h, s * 70 - 7, s * 70 + 7, { color: COL.trim });
  for (let x = -hw + 40; x < hw - 20; x += 95) g.box(x - 5, x + 5, TOP, T.h - 6, -70, 70, { color: COL.trim, faces: { px: false, nx: false } });
  g.tube([[-hw - 20, TOP + 4, -30], [hw + 20, TOP + 4, -30]], 9, 4, 5);
  g.tube([[-hw - 20, TOP + 4, 25], [hw + 20, TOP + 4, 25]], 9, 4, 6);
  // ... and down the ends into the ground.
  g.tube(cablePath(-hw - 12, TOP, -30, -1, 0.15, 230, 80), 11, 5, 7);
  g.tube(cablePath(hw + 12, TOP, 25, 1, -0.1, 230, 80), 11, 5, 8);
  return g.toGeometry();
}

function buildHall() {
  const g = new HallGeo();
  const T = HALL_TYPES.hall;
  const hw = T.w / 2;
  const hd = T.d / 2;
  const SK = 60;
  const HEAD = T.h - 44; // header band bottom
  const W = hw - 10;
  const D = hd - 10;
  g.box(-hw, hw, 0, SK, -hd, hd, { color: COL.dark, faces: { pz: { color: COL.hazard, kind: LED.HAZARD }, nz: { color: COL.hazard, kind: LED.HAZARD }, px: { color: COL.hazard, kind: LED.HAZARD }, nx: { color: COL.hazard, kind: LED.HAZARD } } });
  g.box(-W, W, SK, HEAD, -D, D, { color: COL.dark, faces: { py: false } });
  // Rack fronts behind both long sides, between pillars.
  const N = 5;
  const pw = (2 * W - 40) / N;
  for (let i = 0; i < N; i++) {
    const x0 = -W + 20 + i * pw + 8;
    const x1 = x0 + pw - 16;
    g.box(x0, x1, SK + 18, HEAD - 14, D - 2, D + 3, { color: COL.panel, faces: { pz: rack(40 + i), px: false, nx: false, py: false } });
    g.box(-x1, -x0, SK + 18, HEAD - 14, -D - 3, -D + 2, { color: COL.panel, faces: { nz: rack(50 + i), px: false, nx: false, py: false } });
  }
  for (let i = 0; i <= N; i++) {
    const x = -W + 20 + i * pw;
    for (const s of [-1, 1]) g.box(x - 9, x + 9, SK, HEAD, s > 0 ? D - 2 : -D - 8, s > 0 ? D + 8 : -D + 2, { color: COL.steel, faces: { py: false } });
  }
  // Header band with a light strip along both long sides.
  g.box(-hw, hw, HEAD, T.h, -hd, hd, { color: COL.steel, faces: { py: { color: COL.steelLight } } });
  g.box(-hw + 20, hw - 20, HEAD + 14, HEAD + 26, hd - 2, hd + 5, { color: COL.trim, faces: { pz: { kind: LED.STRIP, id: 60 }, nz: false, py: false } });
  g.box(-hw + 20, hw - 20, HEAD + 14, HEAD + 26, -hd - 5, -hd + 2, { color: COL.trim, faces: { nz: { kind: LED.STRIP, id: 61 }, pz: false, py: false } });
  // Vent grilles and beacons on the ends.
  for (const s of [-1, 1]) {
    const x = s * W;
    g.box(s > 0 ? x - 2 : x - 6, s > 0 ? x + 6 : x + 2, SK + 30, HEAD - 20, -D + 50, D - 50, { color: COL.vent, faces: { px: s > 0 ? { kind: LED.VENT } : false, nx: s < 0 ? { kind: LED.VENT } : false, pz: false, nz: false, py: false } });
    for (const z of [-D + 25, D - 25]) g.box(s > 0 ? hw - 2 : -hw - 14, s > 0 ? hw + 14 : -hw + 2, HEAD - 60, HEAD - 30, z - 12, z + 12, { color: COL.trim, faces: { px: { kind: LED.BEACON, id: z }, nx: { kind: LED.BEACON, id: z }, pz: { kind: LED.BEACON, id: z }, nz: { kind: LED.BEACON, id: z }, py: { kind: LED.BEACON, id: z } } });
  }
  // Cooling fans on the roof.
  for (const x of [-hw * 0.62, 0, hw * 0.62]) {
    g.cylinder(x, 0, 118, T.h, T.h + 34, 10, COL.steel, { color: COL.fan, kind: LED.FAN, id: x });
  }
  // Roof edge rails.
  for (const s of [-1, 1]) g.box(-hw, hw, T.h, T.h + 14, s > 0 ? hd - 12 : -hd, s > 0 ? hd : -hd + 12, { color: COL.trim, faces: { px: false, nx: false } });
  // Cable bundles from the skirt into the ground, two per long side.
  for (const s of [-1, 1]) {
    g.tube(cablePath(-hw * 0.55, SK + 20, s * hd, -0.2, s, 260, 70), 17, 5, 70 + s);
    g.tube(cablePath(hw * 0.4, SK + 20, s * hd, 0.25, s, 230, 70), 14, 5, 73 + s);
  }
  return g.toGeometry();
}

export function buildHallGeometry(type) {
  if (type === 'tower') return buildTower();
  if (type === 'row') return buildRow();
  return buildHall();
}

// ---------------------------------------------------------------- material

const HASH = /* glsl */ `
float hallHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}`;

// Shared uniforms of every unit material: { uHallTime, uHallDark } (seconds, darkness 0..1).
export function makeHallUniforms() {
  return { uHallTime: { value: 0 }, uHallDark: { value: 1 } };
}

export function makeHallMaterial(uniforms) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aLed;
attribute vec2 aHall;
varying vec4 vLed;
varying vec2 vHall;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLed = aLed;
vHall = aHall;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHallTime;
uniform float uHallDark;
varying vec4 vLed;
varying vec2 vHall;
float hallShine = 0.0;
${HASH}
const vec3 HALL_CYAN = vec3(0.12, 0.85, 1.0);
const vec3 HALL_RED = vec3(1.0, 0.07, 0.05);
const vec3 HALL_GREEN = vec3(0.25, 1.0, 0.35);
const vec3 HALL_AMBER = vec3(1.0, 0.55, 0.08);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 hallGlow = vec3(0.0);
{
  float kind = floor(vLed.z + 0.5);
  float seed = vHall.x;
  float power = vHall.y;
  float t = uHallTime;
  if (kind == 1.0) {
    // Rack units: v counts them from the bottom of the panel.
    float row = floor(vLed.y);
    float fy = fract(vLed.y);
    float hr = hallHash(vec3(row, vLed.w, seed * 97.0));
    float fw = max(fwidth(vLed.y), fwidth(vLed.x) * 5.0);
    float detail = 1.0 - smoothstep(0.3, 0.8, fw);
    float blank = step(hr, 0.16);
    float seam = smoothstep(0.0, 0.1, fy) * (1.0 - smoothstep(0.9, 1.0, fy));
    float plate = mix(0.55 + 0.5 * hr, 0.35, blank) * mix(0.5, 1.0, seam);
    diffuseColor.rgb *= mix(0.8, plate, detail);
    // this row powers up once the unit's power passes its own threshold
    float live = step(hr * 0.9, power) * (1.0 - blank);
    vec3 leds = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float hk = hallHash(vec3(row * 7.0 + float(k), vLed.w * 3.0 + 1.7, seed * 57.0));
      if (hk < 0.22) continue;
      vec3 c = hk < 0.62 ? HALL_CYAN : (hk < 0.85 ? HALL_RED : (hk < 0.93 ? HALL_GREEN : HALL_AMBER));
      float on;
      if (k == 3) {
        on = step(0.4, hallHash(vec3(floor(t * (7.0 + 9.0 * fract(hk * 5.3))), hk * 91.0, row)));
      } else {
        float rate = 0.25 + 3.5 * fract(hk * 13.7);
        on = step(fract(t * rate + hk * 11.0), 0.3 + 0.65 * fract(hk * 3.1));
      }
      vec2 ctr = vec2(k == 3 ? 0.86 : 0.1 + 0.085 * float(k), 0.5);
      vec2 dd = abs(vec2(vLed.x, fy) - ctr) / vec2(0.028, 0.22);
      leds += c * on * (1.0 - smoothstep(0.7, 1.3, max(dd.x, dd.y)));
    }
    // a thin light pipe across the drive bays
    float pipe = (1.0 - smoothstep(0.03, 0.07, abs(fy - 0.5))) * step(0.42, vLed.x) * step(vLed.x, 0.76) * step(0.55, fract(hr * 7.3));
    leds += HALL_CYAN * pipe * 0.35 * (0.7 + 0.3 * sin(t * 3.0 + hr * 40.0));
    // far away: the panel's average glow, shimmering row by row
    vec3 avg = mix(HALL_CYAN, HALL_RED, step(0.72, fract(hr * 5.1))) * (0.3 + 0.25 * step(0.5, fract(t * (0.5 + hr) + hr * 9.0)));
    hallGlow = mix(avg, leds * 2.2, detail) * live;
    hallGlow += HALL_CYAN * 0.035 * power;
  } else if (kind == 2.0) {
    float pulse = pow(fract(vLed.x * 2.5 - t * 1.4 + vLed.w * 0.37), 7.0);
    vec3 c = mod(vLed.w, 3.0) < 1.0 ? HALL_RED : HALL_CYAN;
    hallGlow = c * (0.28 + 1.9 * pulse) * power;
  } else if (kind == 3.0) {
    vec2 q = vLed.xy - 0.5;
    float r = length(q) * 2.0;
    float a = atan(q.y, q.x) + t * (4.0 + 3.0 * fract(vLed.w * 0.013 + seed));
    float blade = smoothstep(-0.25, 0.25, sin(a * 5.0 + r * 2.2));
    float hub = step(r, 0.24);
    diffuseColor.rgb = mix(vec3(0.015), vec3(0.2, 0.21, 0.23), max(blade, hub * 0.6));
    hallGlow = HALL_RED * 0.55 * (1.0 - blade) * (1.0 - hub) * step(r, 0.96) * (0.6 + 0.4 * power);
    hallGlow += HALL_CYAN * 0.6 * (1.0 - smoothstep(0.02, 0.06, abs(r - 0.97))) * power;
  } else if (kind == 4.0) {
    float scan = fract(t * 0.3 + seed + vLed.w * 0.071) * 1.6 - 0.3;
    hallGlow = (HALL_CYAN * 0.9 + HALL_RED * 2.2 * exp(-abs(vLed.x - scan) * 18.0)) * power;
  } else if (kind == 5.0) {
    float blink = step(fract(t * 0.85 + seed * 3.0 + vLed.w * 0.17), 0.14);
    hallGlow = HALL_RED * (0.25 + 3.0 * blink) * power;
  } else if (kind == 6.0) {
    float slat = smoothstep(0.3, 0.45, fract(vLed.y)) * (1.0 - smoothstep(0.8, 0.95, fract(vLed.y)));
    diffuseColor.rgb *= mix(0.25, 1.25, slat);
    hallGlow = vec3(1.0, 0.25, 0.08) * 0.22 * (1.0 - slat) * (0.75 + 0.25 * sin(t * 2.3 + seed * 20.0)) * power;
  } else if (kind == 7.0) {
    float s = step(0.5, fract((vLed.x + vLed.y) * 0.5));
    diffuseColor.rgb = mix(vec3(0.02, 0.02, 0.022), diffuseColor.rgb, s);
  }
  hallGlow *= 0.55 + 0.45 * uHallDark;
  hallShine = clamp(max(hallGlow.r, max(hallGlow.g, hallGlow.b)), 0.0, 1.0);
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += hallGlow;
#include <opaque_fragment>`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * (1.0 - 0.65 * hallShine));
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'serverHall';
  return mat;
}

// ---------------------------------------------------------------- warning marker

export const MARKER = { MARGIN: 90, BEAM: 1700 };

// Unit square on the ground (x, z in -0.5..0.5, uv 0..1) plus the four walls of a column above
// it (y 0..BEAM, both windings), part 0 = ground, 1 = column.
export function buildMarkerGeometry() {
  const pos = [];
  const uv = [];
  const part = [];
  const push = (x, y, z, u, v, p) => {
    pos.push(x, y, z);
    uv.push(u, v);
    part.push(p);
  };
  const quad = (a, b, c, d, p) => {
    for (const q of [a, b, c, a, c, d]) push(...q, p);
  };
  quad([-0.5, 0, 0.5, 0, 0], [0.5, 0, 0.5, 1, 0], [0.5, 0, -0.5, 1, 1], [-0.5, 0, -0.5, 0, 1], 0);
  const H = MARKER.BEAM;
  // (the vertex shader moves the column's walls onto the footprint's outline)
  const c = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i];
    const [x1, z1] = c[(i + 1) % 4];
    const a = [x0, 0, z0, i, 0];
    const b = [x1, 0, z1, i + 1, 0];
    const t1 = [x1, H, z1, i + 1, 1];
    const t0 = [x0, H, z0, i, 1];
    quad(a, b, t1, t0, 1);
    quad(b, a, t0, t1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.computeBoundingSphere();
  return g;
}

// Additive red: per instance `aMark` (progress 0..1, half width, half depth, fade), the
// instance matrix scaling the unit square to the footprint plus MARKER.MARGIN each side.
export function makeMarkerMaterial(uniforms) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
  mat.forceSinglePass = true;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -6;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aMark;
attribute float aPart;
varying vec4 vMark;
varying vec2 vMarkUv;
varying float vPart;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMark = aMark;
vMarkUv = uv;
vPart = aPart;
// the column stands on the footprint (the instance scales the square to footprint + margin)
if (aPart > 0.5) transformed.xz = sign(position.xz) * aMark.yz / (2.0 * (aMark.yz + ${MARKER.MARGIN.toFixed(1)}));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHallTime;
varying vec4 vMark;
varying vec2 vMarkUv;
varying float vPart;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float prog = vMark.x;
  vec2 halfSize = vMark.yz + ${MARKER.MARGIN.toFixed(1)};
  float fade = vMark.w;
  float rate = mix(1.2, 5.5, prog * prog);
  float blink = 0.65 + 0.35 * step(0.5, fract(uHallTime * rate));
  float a = 0.0;
  if (vPart < 0.5) {
    vec2 p = (vMarkUv - 0.5) * 2.0 * halfSize;
    vec2 q = abs(p) - vMark.yz;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float line = 1.0 - smoothstep(7.0, 16.0, abs(sd));
    float inside = 1.0 - step(0.0, sd);
    float stripes = step(0.5, fract((p.x + p.y) / 110.0 - uHallTime * 0.9)) * inside;
    float echoT = fract(uHallTime * rate * 0.5);
    float echo = (1.0 - smoothstep(5.0, 14.0, abs(sd - (1.0 - echoT) * ${MARKER.MARGIN.toFixed(1)}))) * echoT * step(0.0, sd);
    // corner brackets, brighter
    vec2 cq = abs(p) - (vMark.yz - 70.0);
    float bracket = step(0.0, min(cq.x, cq.y)) * line;
    a = line * 0.9 + stripes * (0.16 + 0.22 * prog) + echo * 0.8 + bracket * 0.8;
    a *= blink;
  } else {
    float h = vMarkUv.y;
    float bands = 0.55 + 0.45 * step(0.5, fract(h * 16.0 + uHallTime * 2.5));
    a = pow(1.0 - h, 2.5) * 0.55 * bands * (0.35 + 0.65 * prog) * blink;
  }
  diffuseColor = vec4(vec3(1.0, 0.08, 0.04) * 1.6, a * fade);
}`,
      )
      .replace('#include <fog_fragment>', scaledFog('0.5', true));
  };
  mat.customProgramCacheKey = () => 'serverHallMarker';
  return mat;
}
