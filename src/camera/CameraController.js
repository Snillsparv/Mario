// PLACEHOLDER — replaced by the SM64-style camera.
import * as THREE from 'three';
import { approachAngle } from '../core/math.js';

export class CameraController {
  constructor({ collision, camera }) {
    this.collision = collision;
    this.camera = camera;
    this.yaw = Math.PI;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.prevTarget = new THREE.Vector3();
  }

  reset(player) {
    this.yaw = player.faceYaw;
    this.update(null, player);
    this.prev.copy(this.pos);
    this.prevTarget.copy(this.target);
  }

  getYaw() {
    return this.yaw;
  }

  update(input, player) {
    this.prev.copy(this.pos);
    this.prevTarget.copy(this.target);
    if (player.forwardVel > 4) this.yaw = approachAngle(this.yaw, player.faceYaw, 0.03);
    const dist = 1100;
    this.target.set(player.pos.x, player.pos.y + 120, player.pos.z);
    this.pos.set(player.pos.x - Math.sin(this.yaw) * dist, player.pos.y + 450, player.pos.z - Math.cos(this.yaw) * dist);
  }

  apply(alpha) {
    this.camera.position.lerpVectors(this.prev, this.pos, alpha);
    const t = new THREE.Vector3().lerpVectors(this.prevTarget, this.target, alpha);
    this.camera.lookAt(t);
  }
}
