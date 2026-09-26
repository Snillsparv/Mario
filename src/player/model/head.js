// Jonas's head parts in head-centre space (origin at the centre of the skull, +Y up, front
// +Z): the round nose, the ears, rowdy brown hair (a mass over the back and sides, messy tufts
// sticking out from under the cap at the sides and the nape, a few locks over the forehead),
// thin dark round glasses, and the plain light blue baseball cap (no letter, emblem or logo).
// Shared by the in-game rig (rig.js buildHead, low-poly) and the face screen's big stretchy
// head (ui/face/pipHead.js: the same shapes, sizes and placement at a much higher density).
//
//   buildHeadParts(centre, kit)   adds everything but the skull to the head-centre group
//   buildCap(kit)                 the cap alone: a group named 'hat' at HAT_POS / HAT_ROT
//   kit = { hi, mesh(geometry, colourName) -> THREE.Mesh }   hi: face screen density

import * as THREE from 'three';
import { HEAD_R } from './dims.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// The skull ellipsoid's radii (a HEAD_R sphere scaled 1.07, 0.97, 1).
export const SKULL = Object.freeze([HEAD_R * 1.07, HEAD_R * 0.97, HEAD_R]);

// ---- the cap ----------------------------------------------------------------------------------
// Cap space (the 'hat' marker; the winged cap's wings hang off it): origin at the centre of the
// band (the plane of the cap's opening), +Y up the crown, front +Z. It sits tipped back: the
// front of the band on the forehead above the brows, the back low over the nape.
export const HAT_POS = [0, 8.2, -3];
export const HAT_ROT = [-0.32, 0, 0];
// The crown is the part of this ellipsoid (head-centre space, axis-aligned) above the band's
// plane: a round dome a few units over the skull and the hair.
export const CAP_SHELL = Object.freeze([35.2, 33.4, 33.2]);
// The bill: spans +-PHI (rad) of the band's front, reaches LEN forward, pitched down by PITCH
// from the band's plane, its sides drooping by DROOP; THICK thick; attached H up the crown.
const BILL = { PHI: 1.12, LEN: 17.5, PITCH: 0.52, DROOP: 6.5, THICK: 1.7, H: 0.8 };

// The crown's cross-section at cap height h (a plane parallel to the band): an ellipse
// x = ax sin(phi), z = zc + az cos(phi) in cap space, or null above the top.
export function capSection(h) {
  const [A, B, C] = CAP_SHELL;
  const s = Math.sin(HAT_ROT[0]);
  const c = Math.cos(HAT_ROT[0]);
  // Head space: y = a0 - s z, z' = b0 + c z for cap-space (x, h, z).
  const a0 = HAT_POS[1] + h * c;
  const b0 = HAT_POS[2] + h * s;
  const P = (s * s) / (B * B) + (c * c) / (C * C);
  const Q = (-a0 * s) / (B * B) + (b0 * c) / (C * C);
  const K = 1 - (a0 * a0) / (B * B) - (b0 * b0) / (C * C) + (Q * Q) / P;
  if (K <= 0) return null;
  return { zc: -Q / P, ax: A * Math.sqrt(K), az: Math.sqrt(K / P) };
}

// Height of the crown's top in cap space.
export const CAP_TOP = (() => {
  let lo = 0;
  let hi = 80;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (capSection(m)) lo = m;
    else hi = m;
  }
  return lo;
})();

// The crown's front panels stand a little taller than the dome (fading out toward the top),
// and its band hugs the head (the lowest TUCK_H units drawn in by up to TUCK).
const FRONT_LIFT = 0.13;
const TUCK = 0.962;
const TUCK_H = 6;
// A point of the crown at cap height h (0 .. CAP_TOP) and angle phi (0 = the front, + his
// left), written into out.
function crownPoint(h, phi, out) {
  const { zc, ax, az } = capSection(Math.min(h, CAP_TOP * 0.9999));
  const u = h / CAP_TOP;
  const lift = 1 + FRONT_LIFT * Math.max(0, Math.cos(phi)) ** 2 * (1 - u * u);
  const tuck = 1 - (1 - TUCK) * Math.max(0, 1 - h / TUCK_H) ** 2;
  return out.set(ax * tuck * Math.sin(phi), h * lift, zc + az * tuck * Math.cos(phi));
}
// Heights of the crown's rings: closer together toward the top (the last one is the apex).
const ringHeight = (k, rows) => CAP_TOP * Math.sin(((k / rows) * Math.PI) / 2);

// The crown: rings of cap-height sections closed by an apex.
function crownGeometry(rows, segs) {
  const pos = [];
  const p = new THREE.Vector3();
  for (let k = 0; k < rows; k++) {
    for (let j = 0; j < segs; j++) pos.push(...crownPoint(ringHeight(k, rows), (j / segs) * TAU, p).toArray());
  }
  pos.push(...crownPoint(CAP_TOP, 0, p).toArray());
  const apex = rows * segs;
  const index = [];
  for (let k = 0; k < rows; k++) {
    for (let j = 0; j < segs; j++) {
      const a = k * segs + j;
      const b = k * segs + ((j + 1) % segs);
      if (k === rows - 1) {
        index.push(a, b, apex);
        continue;
      }
      index.push(a, b, b + segs, a, b + segs, a + segs);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The six panels' seams: thin darker stitch lines from the band up to the button (front
// centre, and every 60 degrees round), laid just over the crown.
function seamGeometry(rows, width) {
  const pos = [];
  const index = [];
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const across = new THREE.Vector3();
  const up = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (let s = 0; s < 6; s++) {
    const phi = (s * TAU) / 6;
    const first = pos.length / 3;
    for (let k = 0; k <= rows; k++) {
      const h = Math.max(BILL.H + 0.6, ringHeight(k, rows)); // (starting over the bill's root)
      crownPoint(h, phi, p);
      across.subVectors(crownPoint(h, phi + 0.01, a), crownPoint(h, phi - 0.01, b)).normalize();
      up.subVectors(crownPoint(Math.min(CAP_TOP, h + 0.3), phi, a), crownPoint(Math.max(0, h - 0.3), phi, b)).normalize();
      out.crossVectors(across, up).normalize();
      for (const side of [-1, 1]) pos.push(...a.copy(p).addScaledVector(across, (side * width) / 2).addScaledVector(out, 0.3).toArray());
    }
    for (let k = 0; k < rows; k++) {
      const i = first + k * 2;
      index.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A point of the bill's top surface: phi across it (0 = the front), t from the crown (0) to
// the front edge (1). Written into out ([x, y, z], cap space).
const billInner = new THREE.Vector3();
function billPoint(phi, t, out) {
  const inner = crownPoint(BILL.H, phi, billInner);
  const u = Math.cos(((phi / BILL.PHI) * Math.PI) / 2);
  const len = BILL.LEN * Math.sqrt(Math.max(0, u));
  const w = Math.sin(phi) / Math.sin(BILL.PHI);
  out[0] = inner.x * (1 + 0.05 * t) + t * len * Math.sin(phi) * 0.3;
  out[1] = inner.y - t * len * Math.sin(BILL.PITCH) - BILL.DROOP * t * w * w;
  out[2] = inner.z + t * len * Math.cos(BILL.PITCH);
  return out;
}

// The bill as three pieces: its top, its underside (THICK lower, thinning to the edge) and
// the rim along the front edge.
function billGeometries(across, along) {
  const p = [0, 0, 0];
  const grid = (dy) => {
    const pos = [];
    for (let i = 0; i <= along; i++) {
      for (let j = 0; j <= across; j++) {
        const t = i / along;
        billPoint(-BILL.PHI + (2 * BILL.PHI * j) / across, t, p);
        pos.push(p[0], p[1] - dy * (1 - 0.35 * t), p[2]);
      }
    }
    return pos;
  };
  const surface = (pos, up) => {
    const index = [];
    const row = across + 1;
    for (let i = 0; i < along; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * row + j;
        const b = a + 1;
        const c = a + row + 1;
        const d = a + row;
        if (up) index.push(a, c, b, a, d, c);
        else index.push(a, b, c, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const top = grid(0);
  const bottom = grid(BILL.THICK);
  // Rim: the front edges of both surfaces joined.
  const rimPos = [];
  const last = along * (across + 1) * 3;
  for (let j = 0; j <= across; j++) rimPos.push(...top.slice(last + j * 3, last + j * 3 + 3));
  for (let j = 0; j <= across; j++) rimPos.push(...bottom.slice(last + j * 3, last + j * 3 + 3));
  const rimIndex = [];
  const n = across + 1;
  for (let j = 0; j < across; j++) rimIndex.push(j, n + j, j + 1, j + 1, n + j, n + j + 1);
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rim.setIndex(rimIndex);
  rim.computeVertexNormals();
  return { top: surface(top, true), bottom: surface(bottom, false), rim };
}

const place = (m, x, y, z) => {
  m.position.set(x, y, z);
  return m;
};

// The plain light blue baseball cap in cap space, as a group named 'hat' placed on the head.
export function buildCap(kit) {
  const n = (lo, hi) => (kit.hi ? hi : lo);
  const cap = new THREE.Group();
  cap.name = 'hat';
  cap.position.set(...HAT_POS);
  cap.rotation.set(...HAT_ROT);
  const rows = n(5, 28);
  cap.add(kit.mesh(crownGeometry(rows, n(12, 96)), 'cap'));
  cap.add(kit.mesh(seamGeometry(rows, n(0.8, 0.6)), 'capSeam'));
  const bill = billGeometries(n(8, 56), n(1, 10));
  cap.add(kit.mesh(bill.top, 'capBill'), kit.mesh(bill.bottom, 'capUnder'), kit.mesh(bill.rim, 'capBill'));
  // The button on top.
  const top = crownPoint(CAP_TOP, 0, new THREE.Vector3());
  const button = new THREE.SphereGeometry(1, n(6, 20), n(3, 10), 0, TAU, 0, Math.PI / 2).scale(3.6, 2.2, 3.6);
  cap.add(place(kit.mesh(button, 'cap'), 0, top.y - 0.9, top.z));
  return cap;
}

// ---- hair ---------------------------------------------------------------------------------------
// Directions from the head centre: lon 0 = the front, +90 = his left (+X); lat 0 = the centre's
// height, +90 = the top.
const dirOf = (lon, lat) => new THREE.Vector3(
  Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG),
);

// The skull's surface point in direction d (scaled by k), and its outward normal there.
function skullPoint(d, k = 1) {
  const [A, B, C] = SKULL;
  const t = 1 / Math.hypot(d.x / A, d.y / B, d.z / C);
  return d.clone().multiplyScalar(t * k);
}
const skullNormal = (p) => new THREE.Vector3(p.x / SKULL[0] ** 2, p.y / SKULL[1] ** 2, p.z / SKULL[2] ** 2).normalize();

// Tufts and locks: [from lon, lat, to lon, lat, lift (units off the skull at the tip), base
// radius, flatness]. Each is a pointed clump from under the hair (its base inside it) out to
// its tip. Deliberately not quite mirrored: a bit rowdy.
const TUFTS = [
  // Locks over the forehead, peeking out under the bill (clear of the brows and glasses).
  [-4, 40, 1, 17, 1.4, 3.3, 0.42],
  [9, 40, 5, 23, 1.3, 2.7, 0.42],
  [-27, 36, -34, 19, 1.2, 2.7, 0.45],
  // His left side: above the ear, behind it, and a sideburn in front of it.
  [72, 15, 86, 5, 6.5, 4.2, 0.5],
  [100, 15, 113, 3, 7.5, 4.4, 0.5],
  [124, 8, 136, -8, 6, 4.0, 0.5],
  [77, 5, 79, -10, 1.6, 2.7, 0.5],
  // His right side.
  [-74, 14, -88, 3, 7, 4.3, 0.5],
  [-102, 16, -112, 5, 6.5, 4.2, 0.5],
  [-122, 6, -135, -10, 6.5, 4.0, 0.5],
  [-77, 4, -78, -11, 1.6, 2.7, 0.5],
  // The back of the neck, flicking out under the cap.
  [178, -18, 180, -38, 5, 4.4, 0.5],
  [154, -14, 148, -33, 5.5, 4.2, 0.5],
  [-156, -16, -148, -33, 4.5, 4.2, 0.5],
  [140, -2, 144, -19, 6, 4.0, 0.5],
  [-138, -4, -144, -21, 5.5, 4.0, 0.5],
];

function tuftGeometry(spec, kit) {
  const [lon0, lat0, lon1, lat1, lift, r, flat] = spec;
  const base = skullPoint(dirOf(lon0, lat0), 0.97);
  const tipOn = skullPoint(dirOf(lon1, lat1));
  const tip = tipOn.clone().addScaledVector(skullNormal(tipOn), lift);
  const axis = tip.clone().sub(base);
  const len = axis.length();
  axis.divideScalar(len);
  // Thin across the skull's surface normal, wide along the surface.
  const across = skullNormal(base.clone().add(tip).multiplyScalar(0.5));
  across.addScaledVector(axis, -across.dot(axis)).normalize();
  const side = new THREE.Vector3().crossVectors(across, axis);
  const g = new THREE.ConeGeometry(r, len, kit.hi ? 14 : 4, kit.hi ? 6 : 1, true).translate(0, len / 2, 0);
  g.scale(flat, 1, 1);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(across, axis, side).setPosition(base));
  return g;
}

// ---- glasses ------------------------------------------------------------------------------------
// Thin dark round frames in front of the eyes (clear lenses): a ring round each eye, turned to
// follow the face, a bridge over the nose and short temples back into the hair.
export const GLASSES = Object.freeze({ x: 9.3, y: 2.4, z: 30.4, r: 8.2, tube: 0.72, yaw: 0.26 });

// A thin rod from a to b (head space).
function rod(a, b, radius, segs) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(radius, radius, d.length(), segs, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

// A point on the ring of side s (+1 his left) at angle a (0 = its outer side, up +).
function ringPoint(s, a, out = new THREE.Vector3()) {
  const { x, y, z, r, yaw } = GLASSES;
  const lx = s * r * Math.cos(a);
  const ly = r * Math.sin(a);
  const ry = s * yaw;
  return out.set(s * x + lx * Math.cos(ry), y + ly, z - lx * Math.sin(ry));
}

function addGlasses(c, kit) {
  const n = (lo, hi) => (kit.hi ? hi : lo);
  const { x, y, z, r, tube, yaw } = GLASSES;
  for (const s of [-1, 1]) {
    const ring = kit.mesh(new THREE.TorusGeometry(r, tube, n(3, 10), n(14, 56)), 'glasses');
    ring.position.set(s * x, y, z);
    ring.rotation.y = s * yaw;
    c.add(ring);
    // Temple: from the frame's upper outer side back past the temple, into the side hair.
    const a = ringPoint(s, 0.18);
    const mid = new THREE.Vector3(s * 25.6, y + 1.2, 20.5);
    const end = new THREE.Vector3(s * 30.7, y + 0.9, 11);
    c.add(kit.mesh(rod(a, mid, 0.55, n(4, 12)), 'glasses'), kit.mesh(rod(mid, end, 0.55, n(4, 12)), 'glasses'));
  }
  // Bridge between the rings' inner sides, a little above their middles.
  const l = ringPoint(-1, Math.PI - 0.3);
  const rr = ringPoint(1, Math.PI - 0.3);
  const top = new THREE.Vector3(0, (l.y + rr.y) / 2 + 0.7, (l.z + rr.z) / 2 + 0.2);
  c.add(kit.mesh(rod(l, top, 0.6, n(4, 12)), 'glasses'), kit.mesh(rod(top, rr, 0.6, n(4, 12)), 'glasses'));
}

// ---- the whole head -------------------------------------------------------------------------------

// Everything but the skull, added to the head-centre group c.
export function buildHeadParts(c, kit) {
  const n = (lo, hi) => (kit.hi ? hi : lo);
  const ellipsoid = (rx, ry, rz, w, h) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
  c.add(place(kit.mesh(ellipsoid(5, 4.3, 4.3, n(8, 40), n(6, 30)), 'nose'), 0, -5.5, 30.5));
  for (const s of [-1, 1]) c.add(place(kit.mesh(ellipsoid(3.2, 6, 4.4, n(6, 24), n(5, 18)), 'skin'), s * 31.5, -3, -2));
  // Hair: a mass over the back and top (under the cap), tilted so it reaches low at the nape
  // and stays above the ears, and the tufts and locks.
  const mass = new THREE.SphereGeometry(HEAD_R + 1.2, n(12, 72), n(5, 30), Math.PI * 0.745, Math.PI * 1.51, 0, Math.PI * 0.52);
  const hair = kit.mesh(mass.scale(1.07, 0.97, 1), 'hair');
  hair.rotation.x = -0.45;
  c.add(hair);
  TUFTS.forEach((spec, i) => c.add(kit.mesh(tuftGeometry(spec, kit), i % 2 ? 'hairTuft' : 'hair')));
  addGlasses(c, kit);
  c.add(buildCap(kit));
}
