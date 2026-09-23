// Builds Pip from low-poly primitives and exposes the joint hierarchy:
//   object3D (feet, yaw) -> orient (physical pitch/roll) -> lift (root offset + flips about
//   CENTER) -> body (squash) -> hips -> torso -> head (face, hair, hat) / shoulders ->
//   upper arm -> forearm -> hand;  hips -> thigh -> shin -> boot.
// Parts are authored as separate primitives, then every bone's static parts are merged
// into one vertex-coloured mesh (one material, ~20 draw calls for the whole hero). Scarf
// tails hang off the torso and are driven by scarf.js; the blob shadow is separate.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as D from './dims.js';
import { bodyMaterial, paint } from './palette.js';

// ---- geometry helpers ------------------------------------------------------------------

let BODY = null; // the shared vertex-colour material of the rig being built

// A primitive in one palette colour (see palette.js), placed in its parent's space.
function mesh(geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(paint(geo, color), BODY);
  m.position.set(x, y, z);
  return m;
}

function group(x = 0, y = 0, z = 0, order = 'XYZ') {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.order = order;
  return g;
}

const ellipsoid = (rx, ry, rz, w = 8, h = 6) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

// Lathe from [radius, y] pairs listed bottom to top.
const lathe = (profile, segs) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);

// A limb segment hanging down from its joint (tapering from r0 at the joint to r1).
const limb = (r0, r1, len, segs = 7) => new THREE.CylinderGeometry(r0, r1, len, segs, 1, true).translate(0, -len / 2, 0);

// ---- body parts --------------------------------------------------------------------------

function buildHips() {
  const hips = group(0, D.HIP_Y, 0);
  hips.add(mesh(ellipsoid(15, 9, 12), 'trousers', 0, -3, 0));
  // Lower tunic: a flared skirt that follows the pelvis, so leg swings do not tear it.
  hips.add(mesh(lathe([[16, -9], [22.5, -8], [21, -2], [19.2, 5], [18.6, 9]], 12).scale(1, 1, 0.9), 'tunic'));
  hips.add(mesh(new THREE.CylinderGeometry(19.8, 20.3, 5, 12, 1, true).scale(1, 1, 0.9), 'belt', 0, 6, 0));
  hips.add(mesh(new THREE.BoxGeometry(7, 6, 2.5), 'buckle', 0, 6, 18.4));
  return hips;
}

function buildTorso() {
  const torso = group(0, D.SPINE_Y, 0);
  // Upper tunic. Its hem reaches ~10 units down inside the skirt so the waist never opens
  // up when the spine bends or twists (up to ~0.45 rad).
  const tunic = [[17.8, -10], [18.6, 0], [18.8, 10], [18, 20], [15.5, 28], [10, 33], [0.1, 35]];
  torso.add(mesh(lathe(tunic, 12).scale(1, 1, 0.88), 'tunic'));
  torso.add(mesh(new THREE.CylinderGeometry(7, 8, 8, 8, 1, true), 'skin', 0, 36, 0));
  // Scarf wrapped around the neck, dipping slightly at the front, knotted at the back.
  const ring = mesh(new THREE.TorusGeometry(12, 4.8, 5, 12).rotateX(Math.PI / 2), 'scarf', 0, 34, 0);
  ring.rotation.x = 0.14;
  ring.scale.set(1.02, 1, 0.94);
  torso.add(ring, mesh(ellipsoid(5.5, 4.8, 4.2), 'scarf', -4, 32.5, -12.5));
  return torso;
}

function buildHat() {
  const hat = group(0, 14, -1);
  hat.rotation.x = -0.16;
  hat.rotation.z = 0.05;
  const brim = lathe([[12, 1.4], [44, 1.2], [50, 0], [45, -1.4], [12, -1.2]], 18);
  // Safari brim: sides curl up a little, front and back stay low.
  const pos = brim.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 20) pos.setY(i, pos.getY(i) + 6 * ((x * x) / (r * r)) * ((r - 20) / 30));
  }
  // Oval: full width at the sides, shorter front and back, so the brim stays near the
  // 50-unit collision radius when Pip leans forward toward a wall.
  brim.scale(1, 1, 0.88).computeVertexNormals();
  hat.add(mesh(brim, 'hat'));
  hat.add(mesh(lathe([[25.5, 0], [25, 9], [23.5, 17], [19.5, 22], [11, 24], [0.1, 22.5]], 12), 'hat'));
  hat.add(mesh(new THREE.CylinderGeometry(25.8, 26.2, 6, 12, 1, true), 'hatBand', 0, 3.4, 0));
  // Leaf sprig tucked into the band on Pip's left side.
  const sprig = group(19, 6, -15);
  sprig.rotation.set(-0.35, 0.8, -0.3);
  const leafA = mesh(ellipsoid(3.6, 10, 1.1, 6, 4), 'leaf', 0, 8, 0);
  leafA.rotation.z = -0.35;
  const leafB = mesh(ellipsoid(3, 8, 1, 6, 4), 'leafDark', 4, 5.5, -1);
  leafB.rotation.z = -1.0;
  sprig.add(leafA, leafB);
  hat.add(sprig);
  return hat;
}

function buildHead(faceMaterial) {
  const head = group(0, D.NECK_Y, 0);
  const c = group(0, D.HEAD_CY, 2); // head centre
  head.add(c);
  // The skull carries the painted face texture, so it keeps its own material.
  const skull = new THREE.SphereGeometry(D.HEAD_R, 16, 12).scale(1.07, 0.97, 1);
  c.add(new THREE.Mesh(skull, faceMaterial));
  c.add(mesh(ellipsoid(5, 4.3, 4.3), 'nose', 0, -5.5, 30.5));
  for (const s of [-1, 1]) c.add(mesh(ellipsoid(3.2, 6, 4.4, 6, 5), 'skin', s * 31.5, -3, -2));
  // Hair: a cap over the back and top, tilted so it reaches low at the nape and stays
  // above the ears, plus a few swoopy locks of fringe peeking out under the brim.
  const cap = new THREE.SphereGeometry(D.HEAD_R + 1.2, 12, 5, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.52);
  const capMesh = mesh(cap.scale(1.07, 0.97, 1), 'hair');
  capMesh.rotation.x = -0.45;
  c.add(capMesh);
  const fringe = [[-0.55, 0.95, 0.35], [-0.2, 0.9, 0.1], [0.15, 0.93, -0.15], [0.48, 1.0, -0.4]];
  for (const [yaw, tilt, twist] of fringe) {
    const pivot = group(0, 0, 0, 'YXZ');
    pivot.rotation.set(tilt, yaw, 0);
    const lock = mesh(ellipsoid(5.5, 2.6, 9, 6, 4), 'hair', 0, D.HEAD_R + 0.5, 3);
    lock.rotation.y = twist;
    pivot.add(lock);
    c.add(pivot);
  }
  c.add(buildHat());
  return head;
}

function buildArm(side) {
  const shoulder = group(side * D.SHOULDER_X, D.SHOULDER_Y, 0);
  shoulder.add(mesh(ellipsoid(7, 7.5, 7), 'tunic'));
  shoulder.add(mesh(limb(5.4, 4.8, D.UPPER_ARM), 'tunic'));
  const elbow = group(0, -D.UPPER_ARM, 0);
  shoulder.add(elbow);
  elbow.add(mesh(ellipsoid(4.9, 4.9, 4.9, 7, 5), 'tunic'));
  elbow.add(mesh(limb(4.8, 4.4, D.FOREARM - 4), 'tunic'));
  elbow.add(mesh(new THREE.CylinderGeometry(5, 7, 6, 8, 1, true), 'glove', 0, -D.FOREARM + 2, 0)); // flared cuff
  const hand = group(0, -D.FOREARM - D.HAND_OFFSET, 0);
  hand.name = 'hand'; // marker at the mitten centre (its mesh merges into the forearm)
  elbow.add(hand);
  hand.add(mesh(ellipsoid(D.HAND_R, 8.2, 7), 'glove'));
  hand.add(mesh(ellipsoid(3, 3.8, 3, 6, 4), 'glove', -side * 3.5, 2.5, 5.5)); // thumb
  return { shoulder, elbow, hand };
}

function buildLeg(side) {
  const thigh = group(side * D.HIP_X, -D.HIP_DROP, 0);
  thigh.add(mesh(limb(6.6, 5.6, D.THIGH), 'trousers'));
  const shin = group(0, -D.THIGH, 0);
  thigh.add(shin);
  shin.add(mesh(ellipsoid(5.7, 5.7, 5.7, 7, 5), 'trousers'));
  shin.add(mesh(limb(5.5, 5.2, D.SHIN), 'trousers'));
  const boot = group(0, -D.SHIN, 0);
  shin.add(boot);
  boot.add(mesh(new THREE.CylinderGeometry(7.4, 7.8, 15, 9, 1, true), 'boot', 0, 2, 0.5));
  boot.add(mesh(new THREE.CylinderGeometry(9, 8.4, 4.5, 9, 1, true), 'bootCuff', 0, 10, 0.5));
  boot.add(mesh(ellipsoid(9.6, 8.6, 15, 10, 7), 'boot', 0, -7.6, 5));
  boot.add(mesh(ellipsoid(10.2, 2.6, 15.6, 10, 4), 'sole', 0, -14, 5));
  return { thigh, shin, boot };
}

// Collapses every body-material mesh below `joint` (down to, not including, the next
// animated joint) into a single mesh in the joint's space. Expects current world matrices.
function mergeBone(joint, joints) {
  const inv = joint.matrixWorld.clone().invert();
  const pieces = [];
  const visit = (o) => {
    for (const child of [...o.children]) {
      if (joints.has(child)) continue;
      visit(child);
      if (child.isMesh && child.material === BODY) {
        pieces.push(child.geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld)));
        child.removeFromParent();
      } else if (!child.isMesh && !child.name && child.children.length === 0) {
        child.removeFromParent(); // decoration group emptied by the merge (named markers stay)
      }
    }
  };
  visit(joint);
  if (pieces.length) joint.add(new THREE.Mesh(mergeGeometries(pieces), BODY));
  for (const g of pieces) g.dispose();
}

// ---- rig -----------------------------------------------------------------------------------

export function buildRig(faceMaterial) {
  BODY = bodyMaterial();
  const object3D = new THREE.Group();
  object3D.name = 'Pip';
  const orient = group(0, D.CENTER, 0, 'YXZ');
  const lift = group(0, 0, 0, 'YXZ');
  const body = group(0, -D.CENTER, 0);
  object3D.add(orient);
  orient.add(lift);
  lift.add(body);

  const hips = buildHips();
  const torso = buildTorso();
  const head = buildHead(faceMaterial);
  body.add(hips);
  hips.add(torso);
  torso.add(head);

  const armL = buildArm(1);
  const armR = buildArm(-1);
  torso.add(armL.shoulder, armR.shoulder);
  const legL = buildLeg(1);
  const legR = buildLeg(-1);
  hips.add(legL.thigh, legR.thigh);

  const bones = [hips, torso, head];
  hips.name = 'hips';
  torso.name = 'torso';
  head.name = 'head';
  for (const [s, a, l] of [['L', armL, legL], ['R', armR, legR]]) {
    for (const k of ['shoulder', 'elbow']) a[k].name = k + s;
    for (const k of ['thigh', 'shin', 'boot']) l[k].name = k + s;
    bones.push(a.shoulder, a.elbow, l.thigh, l.shin, l.boot);
  }
  const joints = new Set(bones);
  object3D.updateMatrixWorld(true);
  for (const b of bones) mergeBone(b, joints);
  const material = BODY;
  BODY = null;

  return {
    object3D, orient, lift, body, hips, torso, head, armL, armR, legL, legR, material,
    // Scarf tails hang from the back of the scarf knot.
    scarfAnchors: [new THREE.Vector3(-6, 31, -14), new THREE.Vector3(-1.5, 31.5, -15)],
  };
}

// Applies a pose (see pose.js for channel meanings) plus the physical tilt and optional
// look-around from the RenderState. Pose values are mapped onto three.js rotations per
// side here, so pose code never has to think about mirrored axes.
export function applyPose(rig, p, pitch, roll, headYaw) {
  // Physical tilt pivots about the belly in the air and water, about the feet on the floor
  // (floorPivot 1), so floor-aligned slides lie on the slope instead of sinking into it.
  const pivot = D.CENTER * (1 - p.floorPivot);
  rig.orient.position.y = pivot;
  rig.orient.rotation.set(pitch, 0, roll);
  rig.lift.position.set(p.rootX, p.rootY + D.CENTER - pivot, p.rootZ);
  rig.lift.rotation.set(p.flipPitch, p.flipYaw, p.flipRoll);
  const sy = Math.max(0.3, 1 + p.squash);
  const sxz = 1 / Math.sqrt(sy);
  rig.body.scale.set(sxz, sy, sxz);

  rig.hips.position.y = D.HIP_Y + p.hipsY;
  rig.hips.rotation.set(p.hipsPitch, p.hipsYaw, p.hipsRoll);
  rig.torso.rotation.set(p.spinePitch, p.spineYaw, p.spineRoll);
  rig.head.rotation.set(p.headPitch, p.headYaw + headYaw, p.headRoll);

  rig.armL.shoulder.rotation.set(-p.armLSwing, -p.armLSweep, p.armLRaise);
  rig.armR.shoulder.rotation.set(-p.armRSwing, p.armRSweep, -p.armRRaise);
  rig.armL.elbow.rotation.x = -p.elbowL;
  rig.armR.elbow.rotation.x = -p.elbowR;

  rig.legL.thigh.rotation.set(-p.legLSwing, 0, p.legLSpread);
  rig.legR.thigh.rotation.set(-p.legRSwing, 0, -p.legRSpread);
  rig.legL.shin.rotation.x = p.kneeL;
  rig.legR.shin.rotation.x = p.kneeR;
  rig.legL.boot.rotation.x = p.ankleL;
  rig.legR.boot.rotation.x = p.ankleR;
}
