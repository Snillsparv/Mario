// Small dark low-poly birds circling high over the grounds in loose flocks, alternating bouts
// of flapping with glides. Purely decorative: the pose is a function of time, and every bird is
// written into one dynamic flat-shaded mesh (one draw call). animate() allocates nothing: each
// bird's local-space vertices go through a typed-array scratch and are transformed inline (no
// helper calls taking doubles, which lower JIT tiers would box).
//
// A circle may pass over the castle, so at startup each bird's ring is checked against the
// scenery: a bird whose path would clip a tower moves to the nearest clear radius at its
// altitude, or (if there is none) climbs over the tallest scenery under its ring.

import * as THREE from 'three';
import { TAU } from '../core/math.js';

const BANK = 0.32;
const SWAY = 140; // the circle's radius breathes by this much
const BOB = 90; // altitude bob
const DIP = 60; // lowest wing tip below the body centre
const REACH = 160; // horizontal clearance from scenery (wing half-span ~110 + margin)
const HEADROOM = 250; // vertical clearance over the scenery under the path
const RADIUS_RANGE = [0.75, 1.3]; // radii (x circle radius) a bird may move to
const ROW = 50; // radial step of the scenery profile
const ARC = 100; // sample spacing along a profile ring
const WALL_PROBES = [-300, 0, 300]; // wall probe heights around the circle's altitude
const SKY = 1e5;
const INNER_SPAN = 48;
const OUTER_SPAN = 56;

// Static body triangles in local space (forward +Z, up +Y), flattened to x, y, z per vertex.
const NOSE = [0, 0, 42];
const TAIL = [0, 2, -28];
const TOP = [0, 9, 4];
const BOTTOM = [0, -8, 2];
const LEFT = [-9, 0, 4];
const RIGHT = [9, 0, 4];
const BODY = new Float32Array(
  [
    [NOSE, TOP, LEFT], [NOSE, RIGHT, TOP], [NOSE, LEFT, BOTTOM], [NOSE, BOTTOM, RIGHT],
    [TAIL, LEFT, TOP], [TAIL, TOP, RIGHT], [TAIL, BOTTOM, LEFT], [TAIL, RIGHT, BOTTOM],
    [[0, 2, -24], [-15, 1, -52], [15, 1, -52]], // fanned tail
  ].flat(2),
);
// Each wing is 3 triangles over 5 points (root front/back, elbow front/back, tip) that are
// recomputed every frame into WING_PTS; WING_TRIS indexes them.
const ROOT_F = 0;
const ROOT_B = 1;
const ELBOW_F = 2;
const ELBOW_B = 3;
const TIP = 4;
const WING_TRIS = new Uint8Array([ROOT_F, ROOT_B, ELBOW_B, ROOT_F, ELBOW_B, ELBOW_F, ELBOW_F, ELBOW_B, TIP]);
const WING_PTS = new Float32Array(5 * 3);
const VERTS_PER_BIRD = BODY.length / 3 + 2 * WING_TRIS.length;
// One bird's vertices in local space: the static body, then the right and left wings
// (rewritten per bird every frame).
const LOCAL = new Float32Array(VERTS_PER_BIRD * 3);
LOCAL.set(BODY);
const BODY_RGB = [0.3, 0.26, 0.24];
const WING_RGB = [0.22, 0.2, 0.2];
const GLIDE_LO = 0.1; // glide = smoothstep(GLIDE_LO, GLIDE_HI, sin(...))
const GLIDE_HI = 0.5;

// Flat per-face normals of a non-indexed triangle list, (c - b) x (a - b) like three.js.
function faceNormals(P, N) {
  for (let i = 0; i < P.length; i += 9) {
    const bx = P[i + 3];
    const by = P[i + 4];
    const bz = P[i + 5];
    const ux = P[i + 6] - bx;
    const uy = P[i + 7] - by;
    const uz = P[i + 8] - bz;
    const vx = P[i] - bx;
    const vy = P[i + 1] - by;
    const vz = P[i + 2] - bz;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < 9; k += 3) {
      N[i + k] = nx;
      N[i + k + 1] = ny;
      N[i + k + 2] = nz;
    }
  }
}

// Highest scenery near each ring of circle c, for radii rMin + k * ROW across the radii its
// birds may use: roofs (floor tops) plus the tops of walls standing at the flock's altitude.
// The birds sweep every angle of their ring, so only the radius matters.
function sceneryProfile(c, collision) {
  const rMin = Math.max(0, c.radius * RADIUS_RANGE[0] - SWAY - REACH);
  const rMax = c.radius * RADIUS_RANGE[1] + SWAY + REACH;
  const tops = [];
  for (let r = rMin; r <= rMax; r += ROW) {
    const n = Math.max(12, Math.ceil((TAU * r) / ARC));
    let top = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = c.x + Math.cos((k / n) * TAU) * r;
      const z = c.z + Math.sin((k / n) * TAU) * r;
      top = Math.max(top, collision.findFloor(x, SKY, z).y);
      for (const dy of WALL_PROBES) {
        for (const w of collision.findWalls(x, c.y + dy, z, 0, ARC).walls) top = Math.max(top, w.maxY);
      }
    }
    tops.push(top);
  }
  // Highest scenery within reach of a ring of radius r (with its sway).
  return (r) => {
    const k0 = Math.max(0, Math.floor((r - SWAY - REACH - rMin) / ROW));
    const k1 = Math.min(tops.length - 1, Math.ceil((r + SWAY + REACH - rMin) / ROW));
    let top = -Infinity;
    for (let k = k0; k <= k1; k++) top = Math.max(top, tops[k]);
    return top;
  };
}

// Moves bird b off the scenery: to the nearest radius whose ring stays HEADROOM above
// everything under the bird's lowest point, else it climbs over its ring's tallest scenery.
function clearOfScenery(b, topNear) {
  const margin = BOB + DIP + HEADROOM;
  const lo = b.c.radius * RADIUS_RANGE[0];
  const hi = b.c.radius * RADIUS_RANGE[1];
  for (let d = 0; d <= hi - lo; d += ROW) {
    for (const r of [b.radius + d, b.radius - d]) {
      if (r >= lo && r <= hi && topNear(r) + margin < b.alt) {
        b.radius = r;
        return;
      }
    }
  }
  b.alt = topNear(b.radius) + margin;
}

export class Birds {
  // collision: CollisionWorld (findFloor, findWalls) used once to keep the rings clear.
  constructor(circles, { collision, rng }) {
    this.birds = [];
    circles.forEach((c, ci) => {
      const n = 3 + Math.floor(rng() * 3);
      const dir = ci % 2 ? -1 : 1;
      const topNear = sceneryProfile(c, collision);
      for (let i = 0; i < n; i++) {
        const b = {
          c,
          dir,
          angle0: i * 0.28 + rng() * 0.15, // bunched into a loose flock
          radius: c.radius * (0.85 + rng() * 0.3),
          alt: c.y + (rng() - 0.5) * 300,
          speed: (430 + rng() * 90) / c.radius, // rad/s
          flapRate: 3 + rng() * 1.2,
          phase: rng() * TAU,
          glidePhase: ci * 1.7 + rng() * 0.6,
          pos: { x: 0, y: 0, z: 0 }, // body centre, written by animate()
        };
        clearOfScenery(b, topNear);
        this.birds.push(b);
      }
    });
    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const verts = this.birds.length * VERTS_PER_BIRD;
    this.positions = new Float32Array(verts * 3);
    this.normals = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    for (let i = 0; i < verts; i++) colors.set(i % VERTS_PER_BIRD < BODY.length / 3 ? BODY_RGB : WING_RGB, i * 3);
    const geo = new THREE.BufferGeometry();
    for (const [name, array] of [['position', this.positions], ['normal', this.normals]]) {
      const attr = new THREE.BufferAttribute(array, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  animate(clock) {
    const P = this.positions;
    const L = LOCAL;
    const W = WING_PTS;
    const birds = this.birds;
    let o = 0;
    for (let n = 0; n < birds.length; n++) {
      const b = birds[n];
      // Position on a slightly breathing circle.
      const th = b.angle0 + b.dir * b.speed * clock;
      const r = b.radius + SWAY * Math.sin(clock * 0.23 + b.phase);
      let g = (Math.sin(clock * 0.42 + b.glidePhase) - GLIDE_LO) / (GLIDE_HI - GLIDE_LO);
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      const glide = g * g * (3 - 2 * g); // 1 = gliding
      const fp = clock * b.flapRate * TAU + b.phase;
      const flap = 1 - glide;
      const yaw = Math.atan2(-Math.sin(th) * b.dir, Math.cos(th) * b.dir);
      const roll = BANK * b.dir; // bank into the turn: the wing on the circle's inside dips
      const pitch = 0.08 * glide; // nose slightly down while gliding
      const x = b.c.x + Math.cos(th) * r;
      const y = b.alt + BOB * Math.sin(clock * 0.31 + b.phase) - 6 * flap * Math.sin(fp);
      const z = b.c.z + Math.sin(th) * r;
      b.pos.x = x;
      b.pos.y = y;
      b.pos.z = z;

      // Two-segment wings: the outer segment lags the inner one for a rolling stroke.
      const a1 = flap * 0.65 * Math.sin(fp) + glide * 0.14;
      const a2 = a1 + flap * 0.5 * Math.sin(fp - 0.9) - glide * 0.2;
      const ex = 6 + INNER_SPAN * Math.cos(a1);
      const ey = 3 + INNER_SPAN * Math.sin(a1);
      const tx = ex + OUTER_SPAN * Math.cos(a2);
      const ty = ey + OUTER_SPAN * Math.sin(a2);
      let w = BODY.length;
      for (let side = 1; side >= -1; side -= 2) {
        W[ROOT_F * 3] = side * 6;
        W[ROOT_F * 3 + 1] = 3;
        W[ROOT_F * 3 + 2] = 14;
        W[ROOT_B * 3] = side * 6;
        W[ROOT_B * 3 + 1] = 3;
        W[ROOT_B * 3 + 2] = -12;
        W[ELBOW_F * 3] = side * ex;
        W[ELBOW_F * 3 + 1] = ey;
        W[ELBOW_F * 3 + 2] = 10;
        W[ELBOW_B * 3] = side * ex;
        W[ELBOW_B * 3 + 1] = ey;
        W[ELBOW_B * 3 + 2] = -16;
        W[TIP * 3] = side * tx;
        W[TIP * 3 + 1] = ty;
        W[TIP * 3 + 2] = -26;
        for (let i = 0; i < WING_TRIS.length; i++) {
          const p = WING_TRIS[i] * 3;
          L[w] = W[p];
          L[w + 1] = W[p + 1];
          L[w + 2] = W[p + 2];
          w += 3;
        }
      }

      // Local (forward +Z, up +Y) to world: roll about Z, pitch about X, yaw about Y, place.
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      for (let i = 0; i < L.length; i += 3) {
        const px = L[i];
        const py = L[i + 1];
        const pz = L[i + 2];
        const x1 = px * cr - py * sr;
        const y1 = px * sr + py * cr;
        const y2 = y1 * cp - pz * sp;
        const z2 = pz * cp + y1 * sp;
        P[o] = x + x1 * cy + z2 * sy;
        P[o + 1] = y + y2;
        P[o + 2] = z - x1 * sy + z2 * cy;
        o += 3;
      }
    }
    faceNormals(P, this.normals);
    const attrs = this.mesh.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.normal.needsUpdate = true;
  }
}
