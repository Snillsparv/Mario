// PLACEHOLDER — replaced by the original hero model + procedural animation.
import * as THREE from 'three';

export class PlayerModel {
  constructor() {
    this.object3D = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(45, 70, 4, 8), new THREE.MeshLambertMaterial({ color: 0x20a0a0 }));
    body.position.y = 80;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(18), new THREE.MeshLambertMaterial({ color: 0xffcc88 }));
    nose.position.set(0, 120, 45);
    this.object3D.add(body, nose);
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(50, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.object3D.add(this.shadow);
  }

  update(rs, dt) {
    this.object3D.position.set(rs.pos.x, rs.pos.y, rs.pos.z);
    this.object3D.rotation.set(0, rs.yaw, 0);
    this.shadow.position.set(0, rs.floorY - rs.pos.y + 2, 0);
  }
}
