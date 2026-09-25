// Assembles the castle grounds from the world builders and builds the collision world.
//
// Each builder returns a WorldPart:
//   {
//     object3D: THREE.Object3D,                 // added to the scene
//     colliders: Array<{ object3D?, positions?, surface?, terrain? }>,
//     poles?: Array<{ x, z, y0, y1, radius }>,  // climbable (tree trunks)
//     update?(time, camera)                     // per render frame animation (seconds)
//     setDarkness?(t)                           // AI RACE mode crossfade, 0 = normal .. 1 = dark
//     addScorch?(x, z, radius)                  // terrain: a burn mark on the ground
//     clearScorches?()                          // terrain: remove all burn marks
//     addCircuit?(x, z, radius, { grow }) -> id // terrain: glowing circuit traces spreading out
//     fadeCircuit?(id, seconds)                 //   (AI RACE mode's server halls); fade one out,
//     clearCircuits?()                          //   or remove them all at once
//     trees?: Array<{ x, z, groundY, trunkTop, canopy: { x, y, z, radius } }>  // props
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
    // Tree trunks and canopies (from props), e.g. for fires in AI RACE mode.
    trees: parts.find((p) => p.trees)?.trees ?? [],
    update(time, camera) {
      for (const p of parts) p.update?.(time, camera);
    },
    // AI RACE mode: 0 = the sunny grounds, 1 = the stormy sci-fi horror version.
    setDarkness(t) {
      for (const p of parts) p.setDarkness?.(t);
    },
    addScorch(x, z, radius) {
      for (const p of parts) p.addScorch?.(x, z, radius);
    },
    clearScorches() {
      for (const p of parts) p.clearScorches?.();
    },
    // Circuit traces on the ground (objects/ServerHalls.js); returns the terrain's id, or null.
    addCircuit(x, z, radius, opts) {
      let id = null;
      for (const p of parts) {
        const r = p.addCircuit?.(x, z, radius, opts);
        if (r !== undefined && r !== null) id = r;
      }
      return id;
    },
    fadeCircuit(id, seconds) {
      for (const p of parts) p.fadeCircuit?.(id, seconds);
    },
    clearCircuits() {
      for (const p of parts) p.clearCircuits?.();
    },
  };
}
