// PLACEHOLDER — replaced by coins, red coins, star, butterflies, birds.
import * as THREE from 'three';

export class ObjectManager {
  constructor({ scene, collision, events, layout }) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }
  update(ctx) {}
  animate(time, alpha, camera) {}
}
