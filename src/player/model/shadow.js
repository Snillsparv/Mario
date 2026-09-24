// N64-style blob shadow: a soft dark disc laid on the floor under the hero. It lives inside
// the hero's object3D (so the scene only needs one object) but cancels the hero's yaw and
// ignores pitch/roll/flips: it is oriented to the floor normal only. Its local matrix is
// composed directly (matrixAutoUpdate off), so the per-frame update runs no Object3D
// quaternion/euler change callbacks.

import * as THREE from 'three';
import { canvasTexture, HAS_CANVAS } from '../../render/texgen.js';
import { clamp } from '../../core/math.js';

const RADIUS = 44;
const OPACITY = 0.55;
const FADE_HEIGHT = 1800; // units above the floor at which the shadow is smallest/faintest
const NO_FLOOR = -10000;

const UP = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(); // detached quaternions: no change callbacks
const alignQ = new THREE.Quaternion();

function blobTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}

export class BlobShadow {
  constructor() {
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: HAS_CANVAS ? blobTexture() : null,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 16).rotateX(-Math.PI / 2), material);
    this.mesh.name = 'blobShadow';
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
  }

  // rs: RenderState; parentQuat: world rotation of the object3D that holds the shadow.
  // Hidden when there is no floor, and faded/shrunk as the hero rises above it.
  update(rs, parentQuat) {
    const m = this.mesh;
    const height = rs.pos.y - rs.floorY;
    m.visible = rs.floorY > NO_FLOOR && height > -40;
    if (!m.visible) return;
    const k = clamp(height / FADE_HEIGHT, 0, 1);
    m.scale.setScalar(1 - 0.55 * k);
    m.material.opacity = OPACITY * (1 - 0.7 * k);
    const n = rs.floorNormal;
    tmpN.set(n.x, n.y, n.z);
    if (tmpN.lengthSq() < 1e-6 || tmpN.y <= 0) tmpN.copy(UP);
    tmpN.normalize();
    // Lie along the floor normal, expressed in the parent's (yawed) frame. (The disc is
    // round, so its twist about the normal does not matter.)
    tmpN.applyQuaternion(tmpQ.copy(parentQuat).invert());
    alignQ.setFromUnitVectors(UP, tmpN);
    // Straight down to the floor (the vertical axis is unaffected by yaw), lifted 2 units.
    m.position.set(0, rs.floorY - rs.pos.y, 0).addScaledVector(tmpN, 2);
    m.matrix.compose(m.position, alignQ, m.scale);
    m.matrixWorldNeedsUpdate = true;
  }
}
