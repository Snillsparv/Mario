// Grisen. Local +Z points out through the snout, the soles stand at y=0.
// All decoration on a moving joint is batched into one vertex-coloured mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bodyMaterial, paint } from './palette.js';
import { buildHatMesh } from './rig.js';

const SKIN = 0xffa6ad;
const CREAM = 0xffbfbb;
const EAR = 0xd97688;
const ROSE = 0xef8895;
const INK = 0x382536;
const HOOF = 0x865368;
const TEAL = 0x188e92;
const AQUA = 0x59d4c2;
export const PIG_CENTER = 51;

function ball(x, y, z, rx, ry, rz, color, yaw = 0) {
  const g = new THREE.SphereGeometry(1, 16, 10);
  return paint(g.scale(rx, ry, rz).rotateY(yaw).translate(x, y, z), color);
}

function skull() {
  const g = paint(new THREE.SphereGeometry(1, 24, 16).scale(35, 32, 31).translate(0, 3, 8), SKIN);
  const pos = g.attributes.position, colors = g.attributes.color;
  const skin = new THREE.Color(SKIN), blush = new THREE.Color(0xf18595), color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = (Math.abs(pos.getX(i)) - 26) / 8, y = (pos.getY(i) + 2) / 5.5, z = (pos.getZ(i) - 27) / 9;
    color.copy(skin).lerp(blush, Math.exp(-(x * x + y * y + z * z)));
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  return g;
}

// Depress the nostrils into the front of the snout. Their shadow follows the
// curved surface, including in profile when only the near nostril is visible.
function snout() {
  const g = paint(new THREE.SphereGeometry(1, 56, 36).scale(17.8, 11.8, 6), 0xf698a4);
  const pos = g.attributes.position, colors = g.attributes.color;
  const pink = new THREE.Color(0xf698a4), dark = new THREE.Color(0x804657), color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) <= 0) continue;
    const x = (Math.abs(pos.getX(i)) - 7.25) / 3.1, y = (pos.getY(i) - 0.6) / 4.7;
    const well = 1 - THREE.MathUtils.smoothstep(x * x + y * y, 0.53, 1.38);
    pos.setZ(i, pos.getZ(i) - 2.9 * well);
    color.copy(pink).lerp(dark, well);
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  g.computeVertexNormals();
  return g.translate(0, -0.5, 43);
}

function legProfile(rings, depth, offset, color) {
  const g = new THREE.LatheGeometry(rings.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  return paint(g.scale(1, 1, depth).translate(0, 0, offset), color);
}

function cord(points, radius, color, segments = 12) {
  const path = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return paint(new THREE.TubeGeometry(path, segments, radius, 6, false), color);
}

// A low convex shell with a raised central ridge, used for the ears and cloth.
function shell(rim, front, back, color) {
  const positions = [front, back, ...rim].flat();
  const indices = [];
  for (let i = 0; i < rim.length; i++) {
    const a = 2 + i;
    const b = 2 + (i + 1) % rim.length;
    indices.push(0, a, b, 1, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return paint(g, color);
}

function joint(parent, name, x, y, z, parts = []) {
  const bone = new THREE.Group();
  bone.name = name;
  bone.position.set(x, y, z);
  if (parts.length) {
    const merged = mergeGeometries(parts);
    bone.add(new THREE.Mesh(merged, parent.userData.bodyMaterial));
    for (const part of parts) part.dispose();
  }
  bone.userData.bodyMaterial = parent.userData.bodyMaterial;
  parent.add(bone);
  return bone;
}

function makeEar(head, side) {
  // Counter-clockwise rim viewed from +Z; the inner lobe sits on the front face.
  const rim = [[-8, -3, 0], [6, -4, 0], [11, 4, -1], [10, 17, -2],
    [5, 29, 0], [1, 31, 2], [-6, 21, 1], [-11, 8, 0]];
  const lobe = rim.map(([x, y]) => [x * 0.63, 2 + y * 0.72, 4.5]);
  const ear = joint(head, side > 0 ? 'earL' : 'earR', side * 21, 25, 4, [
    shell(rim, [0, 11, 7], [0, 13, -6], SKIN),
    shell(lobe, [0, 11, 8.2], [0, 11, 3.8], EAR),
  ]);
  ear.rotation.y = side * 0.32;
  return ear;
}

function makeEye(head, side) {
  const eye = joint(head, side > 0 ? 'eyeL' : 'eyeR', side * 18.3, 11, 32.6, [
    ball(0, 0, 0, 8.4, 9.5, 2.2, 0x855964),
    ball(0, 0.25, 0.65, 8, 9.1, 2.6, 0xfff4de),
    ball(-side * 0.8, -0.3, 2.5, 4.9, 6, 1.25, 0x593945),
    ball(-side * 0.85, 0.05, 3.15, 3.6, 4.9, 0.95, INK),
    ball(-1.55, 2.45, 3.95, 1.6, 1.75, 0.66, 0xfffbea),
  ]);
  eye.rotation.set(-0.22, side * 0.52, 0, 'YXZ');
  return eye;
}

function makeLeg(hips, side, front) {
  const name = (front ? 'front' : 'hind') + (side > 0 ? 'L' : 'R');
  const upper = joint(hips, name, side * 21, -18, front ? 19 : -30, [
    legProfile([[0,-19], [6.8,-18], [7.6,-14], [8.1,-10], [9.4,-4], [10.3,2], [9,9], [0,13]], 1.06, 0, SKIN),
  ]);
  const hoof = joint(upper, name + 'Hoof', 0, -16, 0, [
    legProfile([[0,-9], [6.6,-8], [7,-5], [7.4,-1], [7.5,3], [6.8,6], [0,9]], 1.04, 0, SKIN),
    legProfile([[0,-14], [6.7,-13.7], [7.7,-12], [8,-9], [7.2,-6.3], [6.7,-5.5], [0,-5.4]], 1.21, 1.5, HOOF),
    cord([[0,-13,9.1], [0,-11.5,10.8], [0,-10.2,11.2]], 0.55, 0x5c394b, 4),
  ]);
  return { upper, hoof };
}

export function buildPigRig() {
  const material = bodyMaterial();
  const object3D = new THREE.Group();
  object3D.name = 'Grisen';
  object3D.userData.bodyMaterial = material;
  const orient = joint(object3D, 'orientation', 0, PIG_CENTER, 0);
  const lift = joint(orient, 'flip', 0, 0, 0);
  orient.rotation.order = lift.rotation.order = 'YXZ';
  const body = joint(lift, 'stretch', 0, -PIG_CENTER, 0);
  const hips = joint(body, 'body', 0, 48, 0, [ball(0, 0, -8, 35, 32, 42, SKIN)]);
  const head = joint(hips, 'head', 0, 23, 10, [
    skull(),
    ball(0, -5, 24, 26.5, 18.5, 15.5, CREAM),
    ball(0, -0.5, 34.5, 17.4, 13, 10.5, ROSE),
    snout(),
    cord([[-11, -12, 35], [-6, -14.5, 36.4], [0, -15.5, 36.6], [6, -14.5, 36.4], [11, -12, 35]], 1.4, 0x945969),
    ...[-1, 1].map(s => cord([[s * 13, 22.7, 29.1], [s * 17.7, 23.7, 26.3], [s * 22, 21.6, 24.3]], 1.05, 0xb7767e)),
  ]);
  const ears = [makeEar(head, 1), makeEar(head, -1)];
  const eyes = [makeEye(head, 1), makeEye(head, -1)];

  const collar = paint(new THREE.TorusGeometry(28.6, 5.3, 8, 28)
    .scale(1.17, 1, 1).rotateX(-0.83), TEAL);
  const seam = paint(new THREE.TorusGeometry(29.5, 1.45, 6, 28)
    .scale(1.17, 1, 1).rotateX(-0.83).translate(0, 2.8, 2.6), AQUA);
  const scarf = joint(hips, 'scarf', 0, 18, 10, [collar, seam, ball(24, 13, -15, 8, 7, 8, AQUA)]);
  const ribbon = joint(scarf, 'scarfEnds', 24, 15, -16, [
    shell([[-6, 0, 1], [-2, -4, 1], [8, -7, -9], [15, -10, -25], [9, -5, -24], [4, -6, -29], [0, -1, -14]], [3, 2, -11], [4, -4, -11], TEAL),
    shell([[-4, 1, 1], [3, -2, 0], [8, 1, -12], [8, 6, -30], [4, 5, -27], [0, 7, -32], [-2, 4, -13]], [3, 6, -14], [3, 1, -14], AQUA),
  ]);
  const tail = joint(hips, 'curlyTail', 0, 5, -43, [
    cord([[0, 0, 0], [2, 4, -7], [8, 8, -11], [11, 16, -14],
      [7, 22, -16], [0, 22, -17], [-4, 17, -18], [-2, 12, -19], [3, 13, -20], [5, 17, -20]], 2.9, ROSE, 26),
    ball(5, 17, -20, 2.8, 2.8, 2.8, ROSE),
  ]);
  const frontL = makeLeg(hips, 1, true), frontR = makeLeg(hips, -1, true);
  const hindL = makeLeg(hips, 1, false), hindR = makeLeg(hips, -1, false);
  // The actual pickup cap sits between the ears and comes off with its wings.
  const hat = joint(head, 'wingCap', 0, 28, 8);
  hat.scale.setScalar(0.76);
  hat.rotation.x = -0.19;
  hat.add(buildHatMesh(material));
  hat.visible = false;
  return { object3D, orient, lift, body, hips, head, ears, eyes, tail, ribbon, hat, material,
    frontL, frontR, hindL, hindR, wind: 0 };
}
