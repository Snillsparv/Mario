// PLACEHOLDER — replaced by the N64-look renderer.
import * as THREE from 'three';

export class N64Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa0c8ff, 9000, 26000);
    this.camera = new THREE.PerspectiveCamera(45, 4 / 3, 20, 40000);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
