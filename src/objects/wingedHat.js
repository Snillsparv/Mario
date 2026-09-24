// The winged hat that the mystery box releases: Pip's own teal wide-brim explorer hat (mustard
// band) with a pair of white feathered wings on the sides of the crown. Stand-in built here
// while the hero model has no buildWingedHat() of its own (MysteryBox prefers that one).
//
//   buildPlaceholderWingedHat() -> THREE.Group   origin at the hat's base, front +Z, ~110 wide
//     userData.wings = [left, right]  pivots at the wing roots (flap with flapWings)
//   flapWings(hat, clock, strength = 1)            beats the wings (render clock, seconds)
//
// Three draw calls: the hat (brim, crown, band merged, vertex colours) and the two wings (one
// shared geometry, the right one mirrored). Lambert-lit like the hero.

import * as THREE from 'three';

const TEAL = new THREE.Color(0x1d948c);
const TEAL_DARK = new THREE.Color(0x157068);
const MUSTARD = new THREE.Color(0xd9a93a);
const WHITE = new THREE.Color(0xf7f7f2);
const TIP = new THREE.Color(0xc9d3dc);

export const HAT_SCALE = 1.2; // the pickup is a little bigger than the hat Pip wears

// Non-indexed copy of `geo` with a per-vertex colour from colorAt(x, y, z).
function colored(geo, colorAt) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = colorAt(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Concatenates non-indexed geometries with position, normal and color.
function merge(list) {
  const n = list.reduce((k, g) => k + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arr = new Float32Array(n * 3);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}

const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

function buildHatGeometry() {
  // Brim: wide and thin, the sides curling up a little; crown: a rounded dome; band: mustard.
  const brim = lathe([[12, 1.4], [44, 1.2], [50, 0], [45, -1.4], [12, -1.2]], 18);
  const p = brim.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const side = r > 1e-3 ? (x / r) ** 2 : 0;
    p.setY(i, p.getY(i) + side * Math.max(0, r - 30) * 0.28);
    p.setZ(i, z * 0.9);
  }
  brim.computeVertexNormals();
  const crown = lathe([[25.5, 0], [25, 9], [23.5, 17], [19.5, 22], [11, 24], [0.1, 22.5]], 12);
  const band = new THREE.CylinderGeometry(26, 26.4, 6, 12, 1, true).translate(0, 3.4, 0);
  const parts = [
    colored(brim, (x, y) => (y < 0 ? TEAL_DARK : TEAL)),
    colored(crown, () => TEAL),
    colored(band, () => MUSTARD),
  ];
  const geo = merge(parts);
  geo.scale(HAT_SCALE, HAT_SCALE, HAT_SCALE);
  return geo;
}

// One wing in its own frame: root at the origin, spanning +X, four long flight feathers fanned
// from up-and-out to out-and-back, over a rounded covert at the root. Flat, two-sided.
function buildWingGeometry() {
  const pos = [];
  const col = [];
  const push = (v, c) => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
  };
  const feather = (angle, len, width, z) => {
    // An elongated hexagon along direction (cos a, sin a), slightly tilted back (z).
    const d = new THREE.Vector3(Math.cos(angle), Math.sin(angle), -0.25).normalize();
    const n = new THREE.Vector3(-d.y, d.x, 0).normalize();
    const at = (u, v) => new THREE.Vector3(d.x * u + n.x * v, d.y * u + n.y * v, d.z * u + n.z * v + z);
    const w = width / 2;
    const ring = [at(0, 0), at(len * 0.2, w), at(len * 0.85, w * 0.8), at(len, 0), at(len * 0.85, -w * 0.8), at(len * 0.2, -w)];
    const tint = (i) => (i === 3 || i === 2 || i === 4 ? TIP : WHITE);
    for (let i = 1; i < ring.length - 1; i++) {
      push(ring[0], WHITE);
      push(ring[i], tint(i));
      push(ring[i + 1], tint(i + 1));
    }
  };
  const fan = [
    [1.15, 46, 17, -2],
    [0.85, 58, 18, -4],
    [0.55, 62, 18, -6],
    [0.25, 56, 17, -8],
    [0.0, 44, 15, -10],
  ];
  for (const [a, l, w, z] of fan) feather(a, l, w, z);
  // Covert: a rounded fan over the feather roots.
  const c = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 6; i++) {
    const a0 = -0.1 + (i / 6) * 1.4;
    const a1 = -0.1 + ((i + 1) / 6) * 1.4;
    push(c, WHITE);
    push(new THREE.Vector3(Math.cos(a0) * 26, Math.sin(a0) * 26, 1), WHITE);
    push(new THREE.Vector3(Math.cos(a1) * 26, Math.sin(a1) * 26, 1), WHITE);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.scale(HAT_SCALE, HAT_SCALE, HAT_SCALE);
  geo.computeBoundingSphere();
  return geo;
}

export function buildPlaceholderWingedHat() {
  const group = new THREE.Group();
  group.name = 'wingedHat';
  const hatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hat = new THREE.Mesh(buildHatGeometry(), hatMat);
  hat.name = 'wingedHatBody';
  const wingGeo = buildWingGeometry();
  const wingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const wings = [1, -1].map((s) => {
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.name = s > 0 ? 'wingL' : 'wingR';
    w.position.set(s * 23 * HAT_SCALE, 13 * HAT_SCALE, -3 * HAT_SCALE);
    w.scale.x = s;
    return w;
  });
  group.add(hat, ...wings);
  group.userData.wings = wings;
  return group;
}

// Beats the wings (up and down about their roots); `strength` 0..1 scales the beat.
export function flapWings(hat, clock, strength = 1) {
  const wings = hat.userData.wings;
  if (!wings) return;
  const a = (0.25 + 0.45 * Math.sin(clock * 11)) * strength + 0.15;
  wings[0].rotation.z = a;
  wings[1].rotation.z = -a;
}
