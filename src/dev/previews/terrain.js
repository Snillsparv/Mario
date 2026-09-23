// Terrain + water preview: /preview.html?m=terrain[&cam=x,y,z&look=x,y,z]
//   &castle=1  adds a plain stand-in block at the castle footprint for scale
//   &tex=1     shows the terrain textures side by side instead of the level
//   &nofog=1   disables fog (aerial overviews)
import * as layout from '../../world/layout.js';
import { buildTerrain } from '../../world/terrain.js';
import * as tex from '../../world/terrainTextures.js';

export async function setup({ scene, THREE, params }) {
  scene.background = new THREE.Color(0x7fb2ff);
  if (params.get('tex')) return textureSheet(scene, THREE);

  if (!params.get('nofog')) scene.fog = new THREE.Fog(0xa0c8ff, 9000, 30000);
  const terrain = buildTerrain(layout);
  scene.add(terrain.object3D);
  if (params.get('castle')) {
    const C = layout.CASTLE;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(C.halfWidth * 2, C.mainHeight, C.frontZ - C.backZ),
      new THREE.MeshBasicMaterial({ color: 0xe0d6b8 }),
    );
    box.position.set(C.x, C.baseY + C.mainHeight / 2, (C.frontZ + C.backZ) / 2);
    scene.add(box);
  }
  const spawnY = layout.groundHeight(0, 6400);
  return {
    camera: { pos: [0, spawnY + 300, 6400], look: [0, 400, -2000] },
    update(dt, t) {
      terrain.update(t);
    },
  };
}

function textureSheet(scene, THREE) {
  const maps = [
    tex.grassTexture(),
    tex.pathTexture(),
    tex.flagstoneTexture(),
    tex.masonryTexture(),
    tex.rockTexture(),
    tex.sandTexture(),
    tex.waterTexture(),
    tex.waterGlintTexture(),
  ];
  maps.forEach((map, i) => {
    const tall = map.image && map.image.height > map.image.width;
    const mat = new THREE.MeshBasicMaterial({ map: map.clone(), transparent: i === 7 });
    mat.map.repeat.set(2, 2);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200, tall ? 400 : 200), mat);
    mesh.position.set((i % 4) * 230 - 345, i < 4 ? 130 : -170, 0);
    scene.add(mesh);
  });
  return { camera: { pos: [0, 0, 900], look: [0, 0, 0] } };
}
