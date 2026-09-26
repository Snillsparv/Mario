// Builds Jonas (the hero: a cartoon avatar of the player) from low-poly primitives and
// exposes the joint hierarchy:
//   object3D (feet, yaw) -> orient (physical pitch/roll) -> lift (root offset + flips about
//   CENTER) -> body (squash) -> hips -> torso -> head (face, glasses, hair, cap) / shoulders ->
//   upper arm -> forearm -> wrist (hand);  hips -> thigh -> shin -> boot (sock and sneaker).
// Parts are authored as separate primitives, then every bone's static parts are merged
// into one vertex-coloured mesh (one material, 16 draw calls for the whole hero: 15 bones and
// the painted face); the blob shadow is separate. The head's parts are built in head.js.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as D from './dims.js';
import { bodyMaterial, paint } from './palette.js';
import { buildCap, buildHeadParts } from './head.js';

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
  hips.add(mesh(ellipsoid(15, 9, 12), 'jeans', 0, -3, 0));
  // The t-shirt's lower half hangs loose over the jeans and follows the pelvis, so leg swings
  // do not tear it.
  hips.add(mesh(lathe([[17.5, -5.6], [21.4, -5.2], [22.3, -2], [22.1, 4], [21.3, 9]], 12).scale(1, 1, 0.94), 'shirt'));
  return hips;
}

// The torso's t-shirt profile ([radius, y] bottom to top; scaled SHIRT_DEPTH front to back),
// round at the belly. Its hem reaches ~10 units down inside the lower half so the waist never
// opens up when the spine bends or twists (up to ~0.45 rad).
const SHIRT = [[20.2, -10], [21.6, 0], [21.2, 9], [19.2, 18], [16, 27], [10, 33], [0.1, 35]];
const SHIRT_DEPTH = 0.93;

// The front of the shirt (torso space) at (x, y): the faceted 12-sided lathe's surface.
function shirtFrontZ(x, y) {
  let r = SHIRT[0][0];
  for (let i = 0; i < SHIRT.length - 1; i++) {
    const [r0, y0] = SHIRT[i];
    const [r1, y1] = SHIRT[i + 1];
    if (y >= y0 && y <= y1) r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  const step = (2 * Math.PI) / 12;
  const phi = Math.asin(Math.max(-1, Math.min(1, x / r)));
  const k = Math.floor(phi / step);
  const [xa, za] = [r * Math.sin(k * step), r * Math.cos(k * step)];
  const [xb, zb] = [r * Math.sin((k + 1) * step), r * Math.cos((k + 1) * step)];
  return (za + ((zb - za) * (x - xa)) / (xb - xa)) * SHIRT_DEPTH;
}

// The white pi sign on the chest: three brush strokes (the bar, the left leg curling out to
// the left, the right leg hooking out to the right) as ribbons laid on the shirt's surface.
const PI_STROKES = [
  { w: 3.6, pts: [[-11.2, 18.9], [-9.4, 21.2], [-6, 21.7], [11, 21.9]] },
  { w: 3.5, pts: [[-4.8, 21.2], [-4.9, 15.5], [-5.6, 10.8], [-8.2, 7.6]] },
  { w: 3.5, pts: [[4.6, 21.2], [4.6, 13], [5.3, 9.2], [7.6, 7.8], [10, 9.1]] },
];
function piGlyph() {
  const pos = [];
  for (const { w, pts } of PI_STROKES) {
    // Resample the polyline every ~1.6 units so the ribbon bends with the faceted chest.
    const line = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.6));
      for (let j = 0; j < k; j++) line.push([x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k]);
    }
    line.push(pts.at(-1));
    const edge = line.map(([x, y], i) => {
      const [ax, ay] = line[Math.max(0, i - 1)];
      const [bx, by] = line[Math.min(line.length - 1, i + 1)];
      const l = Math.hypot(bx - ax, by - ay);
      const nx = (-(by - ay) / l) * (w / 2);
      const ny = ((bx - ax) / l) * (w / 2);
      return [[x + nx, y + ny], [x - nx, y - ny]];
    });
    const v = ([x, y]) => [x, y, shirtFrontZ(x, y) + 0.55];
    for (let i = 0; i < edge.length - 1; i++) {
      const [a, b] = edge[i];
      const [d, c] = edge[i + 1];
      for (const tri of [[a, b, c], [a, c, d]]) {
        // Front faces toward +Z (counter-clockwise seen from the front).
        const [p, q, r] = tri;
        const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        for (const pt of cross > 0 ? [p, q, r] : [p, r, q]) pos.push(...v(pt));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex([...Array(pos.length / 3).keys()]); // (the bone merge needs every piece indexed)
  return g;
}

function buildTorso() {
  const torso = group(0, D.SPINE_Y, 0);
  torso.add(mesh(lathe(SHIRT, 12).scale(1, 1, SHIRT_DEPTH), 'shirt'));
  torso.add(mesh(piGlyph(), 'pi'));
  torso.add(mesh(new THREE.CylinderGeometry(7, 8, 8, 8, 1, true), 'skin', 0, 36, 0));
  // Crew-neck collar.
  torso.add(mesh(new THREE.TorusGeometry(8.3, 1.4, 3, 10).rotateX(Math.PI / 2), 'shirtCollar', 0, 33.8, 0));
  return torso;
}

// The head's parts (and the cap's placement, HAT_POS / HAT_ROT) live in head.js, shared with
// the face screen's big head; here they are built low-poly into the rig's body material.
const KIT = { hi: false, mesh: (geo, color) => mesh(geo, color) };

function buildHead(faceMaterial) {
  const head = group(0, D.NECK_Y, 0);
  const c = group(0, D.HEAD_CY, 2); // head centre
  head.add(c);
  // The skull carries the painted face texture, so it keeps its own material.
  const skull = new THREE.SphereGeometry(D.HEAD_R, 16, 12).scale(1.07, 0.97, 1);
  c.add(new THREE.Mesh(skull, faceMaterial));
  // Nose, ears, hair, glasses and the cap (named 'hat': the marker stays in the rig after the
  // merge, and the winged cap's wings hang off it, see wings.js).
  buildHeadParts(c, KIT);
  return head;
}

function buildArm(side) {
  const shoulder = group(side * D.SHOULDER_X, D.SHOULDER_Y, 0);
  shoulder.add(mesh(ellipsoid(7, 7.5, 7), 'shirt'));
  // Short sleeve, a little flared at its hem; bare arms below it.
  shoulder.add(mesh(new THREE.CylinderGeometry(6.6, 7.1, 8, 8, 1, true).translate(0, -4, 0), 'shirt'));
  shoulder.add(mesh(limb(4.6, 4.3, D.UPPER_ARM), 'skin'));
  const elbow = group(0, -D.UPPER_ARM, 0);
  shoulder.add(elbow);
  elbow.add(mesh(ellipsoid(4.4, 4.4, 4.4, 7, 5), 'skin'));
  elbow.add(mesh(limb(4.3, 3.9, D.FOREARM - 4), 'skin'));
  // The hand and its wrist hang off their own joint, which punches swell.
  const wrist = group(0, -D.FOREARM, 0);
  elbow.add(wrist);
  // White cartoon gloves with a flared cuff at the wrist.
  wrist.add(mesh(new THREE.CylinderGeometry(4.6, 6.9, 6.5, 8, 1, true), 'glove', 0, 1, 0));
  const hand = group(0, -D.HAND_OFFSET, 0);
  hand.name = 'hand'; // marker at the hand's centre (its mesh merges into the wrist)
  wrist.add(hand);
  const k = D.HAND_R / 9.4;
  hand.add(mesh(ellipsoid(D.HAND_R, 10.4 * k, 8.9 * k), 'glove'));
  hand.add(mesh(ellipsoid(3.8 * k, 4.8 * k, 3.8 * k, 6, 4), 'glove', -side * 4.5 * k, 3.2 * k, 7 * k)); // thumb
  return { shoulder, elbow, wrist, hand };
}

function buildLeg(side) {
  const thigh = group(side * D.HIP_X, -D.HIP_DROP, 0);
  thigh.add(mesh(limb(6.6, 5.6, D.THIGH), 'jeans'));
  const shin = group(0, -D.THIGH, 0);
  thigh.add(shin);
  shin.add(mesh(ellipsoid(5.7, 5.7, 5.7, 7, 5), 'jeans'));
  shin.add(mesh(limb(5.5, 5.3, D.SHIN), 'jeans'));
  // The jeans' hem, a little wider, above the sock.
  shin.add(mesh(new THREE.CylinderGeometry(5.8, 6.4, 3.5, 9, 1, true), 'jeans', 0, -D.SHIN + 5, 0));
  const boot = group(0, -D.SHIN, 0);
  shin.add(boot);
  // An ankle sock in odd colours (blue on the left foot, yellow on the right), tapering up
  // inside the jeans, and a sneaker: white upper, grey tongue, red sole.
  boot.add(mesh(new THREE.CylinderGeometry(5.0, 6.1, 13, 9, 1, true), side > 0 ? 'sockL' : 'sockR', 0, 2, 0));
  boot.add(mesh(ellipsoid(9.4, 6.6, 15, 10, 7), 'shoe', 0, -9.6, 5));
  const tongue = mesh(ellipsoid(5.2, 2.2, 7.5, 6, 4), 'shoeLace', 0, -4.1, 8.2);
  tongue.rotation.x = 0.32;
  boot.add(tongue);
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

// The light blue cap on its own, merged into one vertex-coloured mesh in cap space (origin at
// the centre of the band, +Y up, front +Z; ~70 units across). Used by the standalone winged
// cap (wings.js buildWingedHat).
export function buildHatMesh(material) {
  const prev = BODY;
  BODY = material;
  const hat = buildCap(KIT);
  hat.position.set(0, 0, 0);
  hat.rotation.set(0, 0, 0);
  hat.updateMatrixWorld(true);
  mergeBone(hat, new Set());
  BODY = prev;
  const mesh = hat.children.find((o) => o.isMesh);
  mesh.removeFromParent();
  mesh.name = 'hat';
  return mesh;
}

// ---- rig -----------------------------------------------------------------------------------

export function buildRig(faceMaterial) {
  BODY = bodyMaterial();
  const object3D = new THREE.Group();
  object3D.name = 'Jonas';
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
    for (const k of ['shoulder', 'elbow', 'wrist']) a[k].name = k + s;
    for (const k of ['thigh', 'shin', 'boot']) l[k].name = k + s;
    bones.push(a.shoulder, a.elbow, a.wrist, l.thigh, l.shin, l.boot);
  }
  const joints = new Set(bones);
  object3D.updateMatrixWorld(true);
  for (const b of bones) mergeBone(b, joints);
  const material = BODY;
  BODY = null;

  return {
    object3D, orient, lift, body, hips, torso, head, armL, armR, legL, legR, material,
    hat: head.getObjectByName('hat'), // empty marker in cap space (its meshes merged into the head)
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

  // Attack swells: hands grow about the wrist; feet about BOOT_PIVOT_Y above the ankle.
  rig.armL.wrist.scale.setScalar(swellScale(p.handLSwell));
  rig.armR.wrist.scale.setScalar(swellScale(p.handRSwell));
  swellBoot(rig.legL.boot, swellScale(p.footLSwell), p.ankleL);
  swellBoot(rig.legR.boot, swellScale(p.footRSwell), p.ankleR);
}

const swellScale = (v) => 1 + Math.min(Math.max(v, -0.5), 1.5);

// Scales a boot by s about the point BOOT_PIVOT_Y up its (ankle-rotated) axis: the joint
// moves by (1 - s) times that offset so the pivot stays put on the shin.
function swellBoot(boot, s, ankle) {
  const k = (1 - s) * D.BOOT_PIVOT_Y;
  boot.position.set(0, -D.SHIN + k * Math.cos(ankle), k * Math.sin(ankle));
  boot.scale.setScalar(s);
}
