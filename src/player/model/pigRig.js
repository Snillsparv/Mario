// Grisen. Local +Z points out through the snout, the soles stand at y=0.
// All decoration on a moving joint is batched into one vertex-coloured mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bodyMaterial, paint } from './palette.js';
import { buildHatMesh } from './rig.js';
import { pigTorso, pigHead, pigSnout, pigEar, faceDepth, faceStroke, eyeDisc, eyelid, scarfBand, neckerchief, scarfEnd } from './pigGeometry.js';

const SKIN = 0xf4a0a0;
const HOOF = 0x8c5c68;
const BROW = new THREE.Color(0xa36a72);
const MOUTH = new THREE.Color(0xa26067);
const FRECKLE = new THREE.Color(0xd78084);
export const PIG_CENTER = 51;

function ball(x, y, z, rx, ry, rz, color, yaw = 0) {
  const g = new THREE.SphereGeometry(1, 16, 10);
  return paint(g.scale(rx, ry, rz).rotateY(yaw).translate(x, y, z), color);
}

function legProfile(rings, depth, offset, color) {
  const g = new THREE.LatheGeometry(rings.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  return paint(g.scale(1, 1, depth).translate(0, 0, offset), color);
}

function curlyTail() {
  const points = [[0,0,2], [0,2,-5], [3,5,-10], [9,9,-13], [11,16,-15],
    [7,22,-17], [0,23,-18], [-5,19,-19], [-4,13,-21], [1,12,-22], [4,16,-23], [2.5,18,-24]];
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const g = paint(new THREE.TubeGeometry(path, 36, 3.4, 9, false), SKIN);
  const pos = g.attributes.position, colors = g.attributes.color;
  const a = new THREE.Color(SKIN), b = new THREE.Color(0xe88d95), c = new THREE.Color();
  const centre = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    path.getPointAt(t, centre);
    const radius = (1 - .49 * t) * (1 - .96 * THREE.MathUtils.smoothstep(t, .95, 1));
    c.copy(a).lerp(b, t);
    for (let j = i * 10; j < (i + 1) * 10; j++) {
      v.fromBufferAttribute(pos, j).sub(centre).multiplyScalar(radius).add(centre);
      pos.setXYZ(j, v.x, v.y, v.z);
      colors.setXYZ(j, c.r, c.g, c.b);
    }
  }
  return g;
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
  const ear = joint(head, side > 0 ? 'earL' : 'earR', side * 21, 25.3, 1.5, [pigEar()]);
  ear.scale.x = side;
  ear.rotation.y = side * 0.38;
  return ear;
}

function makeEye(head, side) {
  const x = side * 18.3, y = 10.5;
  const eye = joint(head, side > 0 ? 'eyeL' : 'eyeR', x, y, faceDepth(x, y) - 0.65);
  // Align the eye to the cheek. Work on a sphere inside this scaled socket so
  // the upper lid rolls over the iris even when the gaze turns to the side.
  const normal = new THREE.Vector3(faceDepth(x-.5,y) - faceDepth(x+.5,y), faceDepth(x,y-.5) - faceDepth(x,y+.5), 1).normalize();
  eye.rotation.set(-Math.asin(normal.y), Math.atan2(normal.x, normal.z), -side * .075, 'YXZ');
  eye.scale.set(8.8, 9.4, 3.65);
  const centre = -side * .09;
  const gaze = joint(eye, 'gaze', 0, 0, 0, [
    paint(new THREE.SphereGeometry(1, 32, 20), 0xffefd9),
    eyeDisc(centre, .055, .64, .67, [
      [0,0x332532],[.35,0x382634],[.58,0x3e2935],[.63,0x573643,0xb37c54],
      [.8,0x66414a,0xc38b5a],[.94,0x68454c,0xa26c50],[1,0x543b44],
    ], .025),
    eyeDisc(centre-.17, .315, .147, .153, [[0,0xfff9e6],[.6,0xfff9e6],[1,0xfff5dc]], .047),
    eyeDisc(centre+.14, -.205, .056, .051, [[0,0xffe4bd],[1,0xeac999]], .046),
  ]);
  const lid = joint(eye, 'upperLid', 0, 0, 0, [eyelid(true)]);
  const lowerLid = joint(eye, 'lowerLid', 0, 0, 0, [eyelid(false)]);
  lid.rotation.x = -1.03;
  lowerLid.rotation.x = 1.28;
  return { gaze, lid, lowerLid };
}

function faceDetails() {
  const parts = [faceStroke([[-12,-14.5,.12],[-9,-15.35,.65],[-4,-15.75,.76],
    [1,-15.68,.78],[6.5,-15.62,.66],[10.6,-16.12,.15]], MOUTH)];
  for (const s of [-1, 1]) {
    const inner = s > 0 ? 0.6 : 0;
    parts.push(faceStroke([[s*9.1,24.0+inner,.12],[s*12.3,24.7+inner,1.03],
      [s*16.6,23.4,1.1],[s*21.7,20.9,.85],[s*24.4,20.45,.10]], BROW, .38));
    for (const [x,y,w] of [[22,-2.2,.66],[25.2,-.6,.74],[26.8,-3.4,.55]]) {
      parts.push(faceStroke([[s*x-.77,y,.13],[s*x,y+.18,w],[s*x+.77,y,.12]], FRECKLE, .19));
    }
  }
  return parts;
}

function clovenHoof() {
  const g = legProfile([[0,-14],[6.4,-13.7],[7.7,-12.4],[8,-10.1],[7.6,-7.5],[6.7,-5.2],[0,-5.1]], 1.27, 1.65, HOOF);
  const pos = g.attributes.position, colors = g.attributes.color;
  const heel = new THREE.Color(HOOF), toe = new THREE.Color(0xac767c), cleft = new THREE.Color(0x704957), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const front = THREE.MathUtils.smoothstep(z, 4, 11);
    const split = front * Math.exp(-x*x / 3.4);
    pos.setZ(i, z - 2.5 * split);
    c.copy(heel).lerp(toe, .48 * front).lerp(cleft, split);
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  g.computeVertexNormals();
  return g;
}

function makeLeg(hips, side, front) {
  const name = (front ? 'front' : 'hind') + (side > 0 ? 'L' : 'R');
  const upper = joint(hips, name, side * 20.5, -18, front ? 19 : -39);
  const hoof = joint(upper, name + 'Hoof', 0, -16, 0, [clovenHoof()]);
  const profile = [[0,-24.6],[6.2,-23.5],[6.7,-21.2],[6.8,-19.2],[7.0,-17.3],[7.3,-15.4],
    [7.6,-13],[8.2,-10],[9.1,-5],[10.5,1],[11.2,6.5],[9.5,12],[0,16]];
  const g = legProfile(profile, front ? 1.02 : 1.16, 0, SKIN);
  upper.add(new THREE.Mesh(g, hips.userData.bodyMaterial));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -5, 0), 34);
  const pos = g.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const normal = g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const rest = pos.array.slice(), restNormal = normal.array.slice();
  const weights = profile.map(([, y]) => 1 - THREE.MathUtils.smoothstep(y, -21, -10));
  let lastBend = 0;

  // Bend a single leg surface. The rows nearest the hoof follow it completely;
  // the knee shares its bend across several rings so the skin closes on a tuck.
  function setBend(angle) {
    if (angle === lastBend) return;
    lastBend = angle;
    hoof.rotation.x = angle;
    for (let row = 0; row < weights.length && weights[row] > 0; row++) {
      const a = angle * weights[row], sin = Math.sin(a), cos = Math.cos(a);
      for (let i = row; i < pos.count; i += profile.length) {
        const k = i * 3, dy = rest[k+1] - hoof.position.y, z = rest[k+2];
        pos.setY(i, hoof.position.y + dy * cos - z * sin);
        pos.setZ(i, dy * sin + z * cos);
        const ny = restNormal[k+1], nz = restNormal[k+2];
        normal.setY(i, ny * cos - nz * sin);
        normal.setZ(i, ny * sin + nz * cos);
      }
    }
    pos.needsUpdate = normal.needsUpdate = true;
  }
  return { upper, hoof, setBend };
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
  const hips = joint(body, 'body', 0, 48, 0, [pigTorso()]);
  const head = joint(hips, 'head', 0, 19, 15, [pigHead(), pigSnout(), ...faceDetails()]);
  const ears = [makeEar(head, 1), makeEar(head, -1)];
  const eyes = [makeEye(head, 1), makeEye(head, -1)];

  const scarf = joint(hips, 'scarf', 0, 15.5, 14, [scarfBand(), neckerchief(),
    ball(24.6, 12.2, -14.9, 6.7, 6.2, 7, 0x48b4a8)]);
  const ribbon = joint(scarf, 'scarfEnds', 25.2, 13.6, -16.1, [
    scarfEnd(37, 2.6, -4.7), scarfEnd(24, 10, -7).rotateZ(-.55).translate(1,-1,1),
  ]);
  const tail = joint(hips, 'curlyTail', 0, 7.7, -60, [curlyTail()]);
  const frontL = makeLeg(hips, 1, true), frontR = makeLeg(hips, -1, true);
  const hindL = makeLeg(hips, 1, false), hindR = makeLeg(hips, -1, false);
  // The actual pickup cap sits between the ears and comes off with its wings.
  const hat = joint(head, 'wingCap', 0, 28, 8);
  hat.scale.setScalar(0.76);
  hat.rotation.x = -0.19;
  hat.add(buildHatMesh(material));
  hat.visible = false;
  return { object3D, orient, lift, body, hips, head, ears, eyes, tail, ribbon, hat, material,
    frontL, frontR, hindL, hindR, wind: 0, gazeYaw: 0, eyeOpen: 1 };
}
