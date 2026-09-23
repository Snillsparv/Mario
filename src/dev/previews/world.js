// Whole level (terrain + castle + props + sky), no player. Useful for world screenshots.
import { buildLevel } from '../../world/level.js';

export async function setup({ scene, THREE }) {
  scene.fog = new THREE.Fog(0xa0c8ff, 9000, 30000);
  const level = buildLevel(scene);
  return {
    camera: { pos: [0, 900, 7200], look: [0, 600, -2000] },
    update(dt, t) {
      level.update(t, window.__preview?.camera);
    },
  };
}
