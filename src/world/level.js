// Assembles the castle grounds from the world builders and builds the collision world.
//
// Each builder returns a WorldPart:
//   {
//     object3D: THREE.Object3D,                 // added to the scene
//     colliders: Array<{ object3D?, positions?, surface?, terrain? }>,
//     poles?: Array<{ x, z, y0, y1, radius }>,  // climbable (tree trunks)
//     update?(time, camera)                     // per render frame animation (seconds)
//   }

import * as layout from './layout.js';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildTerrain } from './terrain.js';
import { buildCastle } from './castle.js';
import { buildProps } from './props.js';
import { buildSky } from './sky.js';

export function buildLevel(scene) {
  const collision = new CollisionWorld();
  const parts = [];
  for (const [name, build] of [
    ['terrain', buildTerrain],
    ['castle', buildCastle],
    ['props', buildProps],
    ['sky', buildSky],
  ]) {
    const part = build(layout);
    part.name = name;
    parts.push(part);
    if (part.object3D) scene.add(part.object3D);
    for (const c of part.colliders ?? []) collision.addCollider(c);
    for (const p of part.poles ?? []) collision.addPole(p);
  }
  collision.setWaterLevelFn(layout.waterLevelAt);
  collision.finalize();

  const spawnY = layout.groundHeight(layout.SPAWN.x, layout.SPAWN.z);
  return {
    layout,
    collision,
    parts,
    spawn: { x: layout.SPAWN.x, y: spawnY, z: layout.SPAWN.z, yaw: layout.SPAWN.yaw },
    update(time, camera) {
      for (const p of parts) p.update?.(time, camera);
    },
  };
}
