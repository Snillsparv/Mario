// Castle + drawbridge world part (see docs/ARCHITECTURE.md, "World parts").
//
// An original fairy-tale castle on the moated island: cream ashlar walls, grey stone trims,
// deep red conical roofs, a tall central keep with a waving banner, and a wooden drawbridge.
// Geometry is generated per material into a handful of merged meshes (unlit worldMaterial,
// lighting baked into vertex colours), plus one animated flag mesh. Colliders are simplified
// convex solids tagged 'stone' (castle, abutments) and 'wood' (bridge deck, rails, trestles).
//
// AI RACE mode (setDarkness(t)): every material crossfades to its storm grade (DARK_GRADES,
// ../terrain/darkGrade.js): dark grey stone, dark crimson roofs, the window panes (the
// 'darkGlow' vertex attribute) and the rose window glowing a pulsing sick red / magenta, the
// flags turning to ragged black rags, and thin glowing red circuit cables fading in on the
// towers (castle/circuits.js, one extra draw call while it shows). Uniforms only.

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../render/materials.js';
import { GeoBuilder, SolidBuilder } from './castle/geom.js';
import { buildCastleBody } from './castle/building.js';
import { buildBridge } from './castle/bridge.js';
import { buildFlags } from './castle/flags.js';
import { buildCircuits } from './castle/circuits.js';
import { DarkGrade } from './terrain/darkGrade.js';
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

// AI RACE mode grades per material (darkGrade.js). Linear colours. Tuned together with the
// renderer's storm fog and grade (render/post/storm.js), which darken the frame further.
const GLOW = [1.0, 0.07, 0.24]; // sick red, toward magenta
export const DARK_GRADES = {
  wall: { sat: 0.08, mul: [0.125, 0.12, 0.145] },
  trim: { sat: 0.08, mul: [0.16, 0.155, 0.185], glow: 'attribute', glowColor: GLOW },
  roof: { sat: 0.55, mul: [0.36, 0.05, 0.075] },
  wood: { sat: 0.3, mul: [0.18, 0.14, 0.125] },
  glass: { sat: 0, mul: [1.2, 0.04, 0.25], add: [0.18, 0.0, 0.03] },
  flags: { sat: 0, mul: [0.045, 0.043, 0.05], ragged: true },
};

export function buildCastle(layout) {
  const kit = { solids: new SolidBuilder(), flags: [], towers: [] };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);

  buildCastleBody(kit, layout.CASTLE);
  buildBridge(kit, layout);

  const group = new THREE.Group();
  group.name = 'castle';
  const grade = new DarkGrade();
  for (const name of Object.keys(REPEAT)) {
    const geo = kit[name].toGeometry();
    bakeLighting(geo, LIGHT[name]);
    const mesh = new THREE.Mesh(geo, grade.patch(worldMaterial({ map: TEXTURES[name]() }), DARK_GRADES[name]));
    mesh.name = `castle-${name}`;
    group.add(mesh);
  }
  const flags = buildFlags(kit.flags, grade.patch(worldMaterial({ map: flagTexture(), side: THREE.DoubleSide }), DARK_GRADES.flags));
  group.add(flags.mesh);
  const C = layout.CASTLE;
  const circuits = buildCircuits(kit.towers, [C.x, (C.frontZ + C.backZ) / 2]);
  group.add(circuits.mesh);
  // The rose window's glow pulses with the windows'.
  const glass = group.getObjectByName('castle-glass').material.userData.darkGrade;
  const glassMul = glass.darkMul.value.clone();
  const glassAdd = glass.darkAdd.value.clone();

  return {
    object3D: group,
    colliders: kit.solids.colliders(),
    update(time) {
      flags.update(time);
      grade.tick(time);
      circuits.update(time);
      if (grade.t.value > 0) {
        const pulse = 0.82 + 0.13 * Math.sin(time * 1.7) + 0.05 * Math.sin(time * 6.1);
        glass.darkMul.value.copy(glassMul).multiplyScalar(pulse);
        glass.darkAdd.value.copy(glassAdd).multiplyScalar(pulse);
      }
    },
    // AI RACE mode crossfade: 0 = sunny grounds .. 1 = storm.
    setDarkness(t) {
      const k = Math.min(1, Math.max(0, t));
      grade.set(k * k * (3 - 2 * k));
      circuits.setDarkness(k);
    },
  };
}
