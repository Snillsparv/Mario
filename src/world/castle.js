// Castle + drawbridge world part (see docs/ARCHITECTURE.md, "World parts").
//
// An original fairy-tale castle on the moated island: cream ashlar walls, grey stone trims,
// deep red conical roofs, a tall central keep with a waving banner, and a wooden drawbridge.
// Geometry is generated per material into a handful of merged meshes (unlit worldMaterial,
// lighting baked into vertex colours), plus one animated flag mesh. Colliders are simplified
// convex solids tagged 'stone' (castle, abutments) and 'wood' (bridge deck, rails, trestles).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../render/materials.js';
import { GeoBuilder, SolidBuilder } from './castle/geom.js';
import { buildCastleBody } from './castle/building.js';
import { buildBridge } from './castle/bridge.js';
import { buildFlags } from './castle/flags.js';
import { flagTexture, roofTexture, roseTexture, stoneTexture, wallTexture, woodTexture } from './castle/textures.js';

// World units per texture repeat (32 px tiles -> ~9-12 units per texel, as on the N64).
const REPEAT = { wall: 384, trim: 320, roof: 320, wood: 288, glass: 1 };

// Baked key light: the world sun swung toward the facade, so the front (+Z) and east (+X)
// faces bake ~17% apart instead of ~3% (with SUN_DIR itself their corners vanish).
const KEY = new THREE.Vector3(0.25, 0.8, 0.55).normalize();

// Faces turned away from the key both sit at ambient; dim the west side a little more than
// the back so those corners separate too.
const faceShade = (x, y, z, nx) => 1 - 0.1 * Math.max(0, -nx);

// Baked lighting per material; the stained glass glows at full brightness.
const LIT = { sun: KEY, occlusion: faceShade };
const LIGHT = {
  wall: { ...LIT, ambient: 0.62, diffuse: 0.5, maxBright: 1.08 },
  trim: { ...LIT, ambient: 0.6, diffuse: 0.5, maxBright: 1.05 },
  roof: { ...LIT, ambient: 0.58, diffuse: 0.58, maxBright: 1.1 },
  wood: { ...LIT, ambient: 0.6, diffuse: 0.5, maxBright: 1.05 },
  glass: { ambient: 1, diffuse: 0 },
};

const TEXTURES = { wall: wallTexture, trim: stoneTexture, roof: roofTexture, wood: woodTexture, glass: roseTexture };

export function buildCastle(layout) {
  const kit = { solids: new SolidBuilder(), flags: [] };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);

  buildCastleBody(kit, layout.CASTLE);
  buildBridge(kit, layout);

  const group = new THREE.Group();
  group.name = 'castle';
  for (const name of Object.keys(REPEAT)) {
    const geo = kit[name].toGeometry();
    bakeLighting(geo, LIGHT[name]);
    const mesh = new THREE.Mesh(geo, worldMaterial({ map: TEXTURES[name]() }));
    mesh.name = `castle-${name}`;
    group.add(mesh);
  }
  const flags = buildFlags(kit.flags, worldMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
  group.add(flags.mesh);

  return {
    object3D: group,
    colliders: kit.solids.colliders(),
    update(time) {
      flags.update(time);
    },
  };
}
