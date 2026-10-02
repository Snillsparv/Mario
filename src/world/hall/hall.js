// The Great Hall's building (area 'hall', see hall/layout.js): a WorldPart built in the hall's
// local frame, which world/area.js places at the hall's origin.
//
//   buildHall(layout) -> { object3D, colliders, update(time), setDoorOpen(t), setLit(on) }
//     setDoorOpen   the front door's leaves, 0 shut .. 1 standing open (core/AreaSwitch.js)
//     setLit        the lamp of the little lighthouse in the bottle
//
// A round gallery: the plan's shell (hall/shell.js: the tiled floor, the panelled and
// plastered walls with their trims, the vault and half-dome, the engaged columns, the
// windows), the features on and before the walls (hall/features.js: the front portal, the
// fireplace, the buttress and the banner pole, the east doors and the wheel, the chart table,
// the rugs, the candle rings), the ship in the bottle on its dais (hall/bottle.js) and the
// signposts (props/decor.js addSignpost), all written into one kit of builders (one per
// material) and solids, then assembled here.
//
// Unlit worldMaterial meshes with the light baked into their vertex colours (hall/light.js:
// the floor's light on the floor, the walls' on everything else but the full-bright glow and
// lamp and the raw glass; the rose window's coloured pool tinted into the floor first), one
// mesh per material, and the front door's two leaves, thirteen in all: hall-floor (the glazed
// tiles and the border rings), hall-wall (plaster: walls, vault, dome, the hood), hall-dado
// (teal raised panels: the wainscot, the headboard, the stand's sides, the niches, the panels
// on the breast and the buttress; explicit uvs, a panel a repeat), hall-trim (pale marble,
// tinted cream or rose: skirting, cornice, ribs, columns, window reveals and surrounds, the
// portal, the door surrounds, the architraves, the dais, the breast, the mantel, the buttress;
// its per-vertex 'darkGlow' carries the sheen's weight, 1 on the rose shafts and 0.6 on the
// hearth's surround, for the glossy marble still to come), hall-wood (oak and iron, the front
// door's passage), hall-door-left and hall-door-right (the leaves, the wood's material, each
// turning about its hinge), hall-paint (untextured vertex colours: gold work, cradles, the
// stand's rail and top, rugs and inlays, crest, plaques, chart, candles, cork, books, the
// model in the bottle), hall-cloth (the banners), hall-glow (full-bright: the rose window's
// glass, from the rose texture, and the window panes, the hearth's glowing back, embers and
// flames, which all sample the rose's pale gold middle), hall-bottle (the glass: transparent,
// front faces only, no depth write, paler and more opaque where the view grazes it, so its
// outline reads), hall-signs and hall-lamp (the lamp of the lighthouse in the bottle and its
// two hazy beams, hidden until that course's star is won: setLit(on); see-through like the
// course's beams, the beams fading out, drawn before the glass round them, and turning about
// the lighthouse's axis with update(time) while lit).
// The flames flicker: the glow mesh's 'flame' attribute (0 steady, else the flame's phase)
// scales their colour by a wobble of the time set in update(time) (one uniform, no allocation).
//
// Colliders, all { positions, terrain[, surface] } (world/area.js shifts them): stone slabs
// for the floor and the ceiling, the plan's walls (hall/plan.js wallColliders), the columns,
// the doors' surrounds and the east doors' piers, the chimney breast (the hearth is drawn only),
// the hood and the buttress, the dais and the bottle with its stand and cradles (bottle.js),
// the chart table, the cork and the books, the signposts.

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder } from '../castle/geom.js';
import { doorLeaves } from '../castle/building.js';
import { roseTexture, woodTexture } from '../castle/textures.js';
import { MeshBuilder, bakedMesh } from '../props/geom.js';
import { addSignpost } from '../props/decor.js';
import { woodTexture as signWoodTexture } from '../props/textures.js';
import { bannerTexture, floorTexture, marbleTexture, panelTexture, plasterTexture } from './textures.js';
import { shell } from './shell.js';
import { features } from './features.js';
import { buildBottle } from './bottle.js';
import { bakeHall, makeHallLight } from './light.js';

// World units per texture repeat (the floor's: one tile). The dado's, the glow's, the rose
// window's glass and the cloth's UVs are set per face; the paint, the bottle and the lamp are
// untextured.
const REPEAT = { floor: 560, wall: 512, dado: 1, trim: 512, wood: 288, paint: 256, glow: 1, glass: 1, cloth: 1, bottle: 1, lamp: 1 };

// The signs' light (props' bakedMesh: castle-style flat faces under HALL_SUN).
const SIGN_LIGHT = { ambient: 0.55, diffuse: 0.45, maxBright: 1.05 };
const FULL_BRIGHT = { ambient: 1, diffuse: 0 };
const ROSE_POOL = { out: 700, r: 650, k: 0.22 }; // the rose window's light on the floor before the door
// The bottle's glass: this see-through face on, paler and more opaque where the view grazes it
// (rim: (1 - |cos|)^2 of the angle between the face and the view), so its outline reads from
// every side against the cream walls and the dark stand.
const GLASS = { opacity: 0.22, rimOpacity: 0.62, rimWhite: 0.45 };
const FLICKER = { fast: 9, slow: 23 }; // the flames' wobble (rad/s)
const LAMP_SWEEP = 0.55; // the lit lamp's beams turning round (rad/s, as the course's)

export function buildHall(layout) {
  const kit = { solids: new SolidBuilder(), signs: { wood: new MeshBuilder(), colliders: { wood: [] }, shadow: () => {} } };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);
  shell(kit, layout);
  features(kit, layout);
  buildBottle(kit, layout);
  for (const sign of layout.SIGNS) addSignpost(kit.signs, layout, sign);
  return assemble(kit, layout);
}

// ---------------------------------------------------------------- meshes

function assemble(kit, layout) {
  const light = makeHallLight(layout, kit.windows);
  const group = new THREE.Group();
  group.name = 'hall';
  const add = (name, geo, material) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `hall-${name}`;
    group.add(mesh);
    return mesh;
  };

  const floor = kit.floor.toGeometry();
  tintRosePool(floor, layout);
  add('floor', bakeHall(floor, light.floor), worldMaterial({ map: floorTexture() }));
  const materials = {};
  for (const [name, map] of [['wall', plasterTexture], ['dado', panelTexture], ['trim', marbleTexture], ['wood', woodTexture], ['paint', null]]) {
    materials[name] = add(name, bakeHall(kit[name].toGeometry(), light.wall), worldMaterial({ map: map ? map() : null })).material;
  }
  // The front door's leaves, swinging on their hinges (setDoorOpen) with the wood's look.
  const leaves = doorLeaves(kit.leaves, materials.wood, (geo) => bakeHall(geo, light.wall), 'hall-door');
  for (const mesh of leaves.meshes) group.add(mesh);
  add('cloth', bakeHall(kit.cloth.toGeometry(), light.wall), worldMaterial({ map: bannerTexture() }));

  // The glow: every face but the rose window's samples the rose texture's pale gold middle.
  const { glow, glass } = kit;
  glow.uv.fill(0.5);
  for (const key of ['pos', 'nrm', 'uv', 'col', 'glows']) glow[key].push(...glass[key]);
  const glowGeo = bakeLighting(glow.toGeometry(), FULL_BRIGHT);
  glowGeo.setAttribute('flame', glowGeo.getAttribute('darkGlow'));
  glowGeo.deleteAttribute('darkGlow');
  const flicker = flickerMaterial(roseTexture());
  add('glow', glowGeo, flicker.material);

  add('bottle', kit.bottle.toGeometry(), glassMaterial());
  group.add(bakedMesh('hall-signs', kit.signs.wood, worldMaterial({ map: signWoodTexture() }), { ...SIGN_LIGHT, sun: layout.HALL_SUN }));
  // The lamp: its faces' glow (bottle.js: 1 on the lantern, fading out along the beams) is its
  // vertex colours' alpha. The beams' material is the course's (skerries/lighthouse.js: one
  // shader for both). Set about the lighthouse's axis to turn round it.
  const lampGeo = bakeLighting(kit.lamp.toGeometry(), FULL_BRIGHT);
  const rgb = lampGeo.attributes.color;
  const fade = lampGeo.attributes.darkGlow;
  const rgba = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) rgba.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), fade.getX(i)], i * 4);
  lampGeo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  lampGeo.deleteAttribute('darkGlow');
  const [lx, ly, lz] = kit.lampAt;
  lampGeo.translate(-lx, -ly, -lz);
  const lamp = add('lamp', lampGeo, worldMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  lamp.position.set(lx, ly, lz);
  lamp.renderOrder = -1; // (inside the bottle: drawn before its glass)
  lamp.visible = false;

  const colliders = kit.solids.colliders();
  colliders.push({ positions: kit.signs.colliders.wood, terrain: 'wood' });
  return {
    object3D: group,
    colliders,
    update(time) {
      flicker.time.value = time;
      if (lamp.visible) lamp.rotation.y = time * LAMP_SWEEP;
    },
    // The front door, 0 shut .. 1 standing open (core/AreaSwitch.js swings it as Jonas goes out
    // through it and comes in).
    setDoorOpen(t) {
      leaves.setOpen(t);
    },
    // The lamp of the lighthouse in the bottle: lit once the course's star is won (AreaSwitch,
    // AREA_DEFS.hall.lamp).
    setLit(on) {
      lamp.visible = !!on;
    },
  };
}

// The glow's material: worldMaterial with the flames' flicker (see the file header).
function flickerMaterial(map) {
  const material = worldMaterial({ map });
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flameTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flame;\nuniform float flameTime;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
if (flame > 0.0) vColor.rgb *= 0.86 + 0.09 * sin(flameTime * ${FLICKER.fast.toFixed(1)} + flame * 41.0) + 0.05 * sin(flameTime * ${FLICKER.slow.toFixed(1)} + flame * 17.0);`,
      );
  };
  material.customProgramCacheKey = () => 'hall-flame';
  material.userData.flameTime = time;
  return { material, time };
}

// The glass's material: worldMaterial, transparent (front faces, no depth write), with the rim
// (see GLASS) worked out per vertex from the face's normal and the view.
function glassMaterial() {
  const material = worldMaterial({ transparent: true, depthWrite: false });
  material.opacity = GLASS.opacity;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassRim;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGlassRim = 1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassRim;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float glassRim = vGlassRim * vGlassRim;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), glassRim * ${GLASS.rimWhite.toFixed(2)});
diffuseColor.a = mix(diffuseColor.a, ${GLASS.rimOpacity.toFixed(2)}, glassRim);`,
      );
  };
  material.customProgramCacheKey = () => 'hall-glass';
  return material;
}

// The rose window's light falls in front of the front door: a faint pool, its colour turning
// with the angle round it (the glass's red, gold, blue and green), tinted into the floor's
// vertex colours before the bake.
function tintRosePool(geo, { FRONT_DOOR }) {
  const cx = FRONT_DOOR.x;
  const cz = FRONT_DOOR.wallZ - ROSE_POOL.out;
  const hues = [[1, 0.55, 0.55], [1, 0.85, 0.45], [0.6, 0.7, 1], [0.6, 1, 0.7]];
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx;
    const dz = pos.getZ(i) - cz;
    const d = Math.hypot(dx, dz) / ROSE_POOL.r;
    if (d >= 1) continue;
    const hue = hues[Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * 8) % hues.length];
    const k = ROSE_POOL.k * (1 - d * d);
    col.setXYZ(i, col.getX(i) * (1 + k * hue[0]), col.getY(i) * (1 + k * hue[1]), col.getZ(i) * (1 + k * hue[2]));
  }
}
