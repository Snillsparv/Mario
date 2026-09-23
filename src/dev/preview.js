// Isolated module preview harness: /preview.html?m=<name>
// Loads src/dev/previews/<name>.js which must export:
//   async function setup(ctx) -> { update?(dt, t), camera?: {pos:[x,y,z], look:[x,y,z]} }
// ctx = { THREE, scene, camera, renderer, container, ui, params }
// Camera can be overridden from the URL: &cam=x,y,z&look=x,y,z  (and &fov=45)
// Sets window.__ready = true after the first few frames have rendered.

import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const name = params.get('m') || 'world';
const container = document.getElementById('game');
const ui = document.getElementById('ui');

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fb2ff);
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') || 45), innerWidth / innerHeight, 20, 60000);

const parseVec = (s) => (s ? s.split(',').map(Number) : null);

async function main() {
  const mod = await import(`./previews/${name}.js`);
  const ctx = { THREE, scene, camera, renderer, container, ui, params };
  const handle = (await mod.setup(ctx)) || {};
  const camPos = parseVec(params.get('cam')) || handle.camera?.pos || [0, 2000, 6000];
  const look = parseVec(params.get('look')) || handle.camera?.look || [0, 0, 0];
  camera.position.set(...camPos);
  camera.lookAt(...look);
  if (params.get('fov')) camera.fov = Number(params.get('fov'));
  camera.updateProjectionMatrix();
  window.__preview = { handle, scene, camera, renderer };
  let t0 = performance.now();
  let frames = 0;
  const loop = (now) => {
    const t = (now - t0) / 1000;
    handle.update?.(1 / 60, t);
    if (handle.render) handle.render();
    else renderer.render(scene, camera);
    if (++frames === 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  console.error(e);
  window.__ready = true;
});
