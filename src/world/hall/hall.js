// The Great Hall's building (area 'hall', see hall/layout.js): a WorldPart built in the hall's
// local frame, which world/area.js places at the hall's origin.
//
//   buildHall(layout) -> { object3D, colliders, update(time), setDoorOpen(t), setLit(on) }
//     setDoorOpen   the front door's leaves, 0 shut .. 1 standing open (core/AreaSwitch.js)
//     setLit        the lamp of the little lighthouse in the bottle
//   MIRROR      the polished floor's switch (hall-reflect under a see-through floor)
//   WOOD_MEAN   the castle wood texture's mean colour (linear RGB), its factor in the mirror
//
// A round gallery: the plan's shell (hall/shell.js: the tiled floor, the panelled and
// plastered walls with their trims, the vault and half-dome, the engaged columns, the
// windows), the features on and before the walls (hall/features.js: the front portal, the
// fireplace, the buttress and the banner pole, the east doors and the wheel, the chart table,
// the rugs, the candle rings), the ship in the bottle on its dais (hall/bottle.js) and the
// signposts (props/decor.js addSignpost), all written into one kit of builders (one per
// material) and solids, then assembled here.
//
// Unlit worldMaterial meshes with the light baked into their vertex colours (hall/light.js: the
// floor's light on the floor, the walls' on everything else but the full-bright glow and lamp
// and the raw glass; the rose window's coloured pool tinted into the floor first), one mesh per
// material, the front door's two leaves and the floor's reflection, fourteen in all: hall-floor
// (the glazed tiles and the border rings; with the mirror see-through, FLOOR_OPACITY, drawn
// first of the see-through meshes, renderOrder -2, still writing depth, so the lamp, the glass
// and every shadow lie on it), hall-wall (plaster: walls, vault, dome, the hood), hall-dado
// (teal raised panels: the wainscot, the headboard, the stand's sides, the niches, the panels
// on the breast and the buttress; explicit uvs, a panel a repeat), hall-trim (pale marble,
// tinted cream or rose: skirting, cornice, ribs, columns, window reveals and surrounds, the
// portal, the door surrounds, the architraves, the dais, the breast, the mantel, the buttress;
// glossy: its per-vertex 'sheen' weight, 1 on the rose shafts of the columns and the portal's
// pilasters and 0.6 on the hearth's surround, whitens a vertex toward a warm highlight by a
// Fresnel rim and a highlight from a light near the eye, so a shaft gleams in a stripe that
// slides round it as the camera moves; one program more, no draw call), hall-wood (oak and
// iron, the front door's passage), hall-door-left and hall-door-right (the leaves, the wood's
// material, each turning about its hinge), hall-paint (untextured vertex colours: gold work,
// cradles, the stand's rail and top, rugs and inlays, crest, plaques, chart, candles, cork,
// books, the model in the bottle), hall-cloth (the banners), hall-glow (full-bright: the rose
// window's glass, from the rose texture, and the window panes, the hearth's glowing back, embers
// and flames, which all sample the rose's pale gold middle), hall-bottle (the glass:
// transparent, front faces only, no depth write, paler and more opaque where the view grazes
// it, so its outline reads), hall-signs, hall-lamp (the lamp of the lighthouse in the bottle and
// its two hazy beams, hidden until that course's star is won: setLit(on); see-through like the
// course's beams, the beams fading out, drawn before the glass round them, and turning about
// the lighthouse's axis with update(time) while lit) and hall-reflect.
// The flames flicker: the glow mesh's 'flame' attribute (0 steady, else the flame's phase)
// scales their colour by a wobble of the time set in update(time) (one uniform, no allocation).
//
// The polished floor (MIRROR): hall-reflect is the room's lower part mirrored under the floor
// (scale.y -1), one untextured mesh made once from the baked wall, dado, trim, wood, paint and
// cloth and the glow's steady faces: every face from the floor up (above the rugs and inlays,
// REFLECT.foot) whose lowest corner is at most REFLECT.top high (higher ones mirror far under
// the floor, seen only through the floor near the eye). Its colours are the baked ones times
// the mean colour of the source's texture (each hall texture's userData.mean, the castle wood's
// WOOD_MEAN: nothing reads a canvas back), dimmed to REFLECT.dim (the glow's as they are). Over
// them a lid at the cornice stands in for everything higher (the upper walls, the cornice, the
// vault), in the mean colour of the faces it stands in for, reaching REFLECT.reach past the
// walls, so every look through the floor meets the mirrored room, never the dark clear colour
// behind it. It is static: Jonas, the coins, the flames, the swinging leaves, the glass, the
// lamp and the signs are not in it, which goes unseen through 1 - FLOOR_OPACITY of the floor.
// With MIRROR false the floor is opaque and there are thirteen meshes.
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

// The polished floor: its reflection under it (see the file header), shown through this much
// of the floor. Off (false), the floor is opaque and hall-reflect is not made.
export const MIRROR = true;
const FLOOR_OPACITY = 0.82;
// What is mirrored: faces reaching `foot` above the floor (not the rugs and inlays) whose
// lowest corner is at most `top` high, their colours dimmed to `dim`; and the lid over them at
// the cornice (HALL.ceilingY, above every mirrored face), `reach` past the room's walls every
// way (a look through the floor that goes on out through a gap in the walls, at least `top`
// up and at most the room's diagonal, 8400, from the eye, climbs at least 1 in 5.3: it meets
// the lid within 5300 of them).
const REFLECT = { foot: 8, top: 1600, dim: 0.9, reach: 6000 };
// The mean colour of the castle's wood texture (castle/textures.js woodTexture, linear RGB: the
// mean of its linearised pixels, as hall/textures.js works out its own), measured once in the
// browser. It has none of its own, and nothing in the game reads a canvas back.
export const WOOD_MEAN = [0.166, 0.074, 0.025];
// The marble's sheen (hall-trim, weighted per vertex): a Fresnel rim (rim * (1 - |n.v|)^3, its
// base clamped at 0: |n.v| of two unit vectors can round past 1, and pow of a negative is
// undefined, NaN on many GPUs, which would reach every trim vertex through the weight) and a
// highlight (spot * (r.light)^power, r the view reflected about the normal) from a light in
// view space near the eye, a little left of it and above it, nearly level (on an upright shaft
// the reflected view has no up in it, so a higher light could never make it shine), whitening
// the colour toward `white` by `mix` of the sum (at most 1). Worked out per vertex.
const SHEEN = { rim: 0.35, spot: 1.1, power: 10, light: unit(-0.35, 0.15, 0.92), white: [1, 0.96, 0.88], mix: 0.75 };

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

  const floorGeo = kit.floor.toGeometry();
  tintRosePool(floorGeo, layout);
  const floor = add('floor', bakeHall(floorGeo, light.floor), worldMaterial({ map: floorTexture(), transparent: MIRROR }));
  if (MIRROR) {
    // Over its reflection, before the lamp (-1), the blob shadows (0.5) and his shadow (1).
    floor.material.opacity = FLOOR_OPACITY;
    floor.renderOrder = -2;
  }
  // The baked meshes the reflection is made from, each with its colours' factor there.
  const mirrored = [];
  const looks = [
    ['wall', plasterTexture()],
    ['dado', panelTexture()],
    ['trim', marbleTexture()],
    ['wood', woodTexture(), WOOD_MEAN],
    ['paint', null, [1, 1, 1]],
  ];
  const materials = {};
  for (const [name, map, mean = map.userData.mean] of looks) {
    const geo = bakeHall(kit[name].toGeometry(), light.wall);
    if (name === 'trim') {
      geo.setAttribute('sheen', geo.getAttribute('darkGlow'));
      geo.deleteAttribute('darkGlow');
    }
    materials[name] = add(name, geo, name === 'trim' ? sheenMaterial(map) : worldMaterial({ map })).material;
    mirrored.push({ geo, k: mean.map((c) => c * REFLECT.dim) });
  }
  // The front door's leaves, swinging on their hinges (setDoorOpen) with the wood's look.
  const leaves = doorLeaves(kit.leaves, materials.wood, (geo) => bakeHall(geo, light.wall), 'hall-door');
  for (const mesh of leaves.meshes) group.add(mesh);
  const banners = bannerTexture();
  const clothGeo = bakeHall(kit.cloth.toGeometry(), light.wall);
  add('cloth', clothGeo, worldMaterial({ map: banners }));
  mirrored.push({ geo: clothGeo, k: banners.userData.mean.map((c) => c * REFLECT.dim) });

  // The glow: every face but the rose window's samples the rose texture's pale gold middle.
  const { glow, glass } = kit;
  const steady = glow.pos.length / 3; // (the rose window's glass, from its texture, is not mirrored)
  glow.uv.fill(0.5);
  for (const key of ['pos', 'nrm', 'uv', 'col', 'glows']) glow[key].push(...glass[key]);
  const glowGeo = bakeLighting(glow.toGeometry(), FULL_BRIGHT);
  glowGeo.setAttribute('flame', glowGeo.getAttribute('darkGlow'));
  glowGeo.deleteAttribute('darkGlow');
  const flicker = flickerMaterial(roseTexture());
  add('glow', glowGeo, flicker.material);
  mirrored.push({ geo: glowGeo, k: [1, 1, 1], count: steady });

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

  // The floor's reflection, drawn with the room's opaque meshes before the floor over it
  // (three turns its faces round for the flip).
  if (MIRROR) add('reflect', reflection(mirrored, layout), worldMaterial()).scale.y = -1;

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

// The marble's material: worldMaterial with the sheen (see SHEEN) worked out per vertex from
// its 'sheen' weight, its normal and the view.
function sheenMaterial(map) {
  const material = worldMaterial({ map });
  const v3 = (c) => `vec3(${c.map((x) => x.toFixed(3)).join(', ')})`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sheen;\nvarying float vSheen;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec3 sheenN = normalize(normalMatrix * normal);
vec3 sheenV = normalize(-mvPosition.xyz);
float sheenRim = pow(max(1.0 - abs(dot(sheenN, sheenV)), 0.0), 3.0);
float sheenSpot = pow(max(dot(reflect(-sheenV, sheenN), ${v3(SHEEN.light)}), 0.0), ${SHEEN.power.toFixed(1)});
vSheen = sheen * (${SHEEN.rim.toFixed(2)} * sheenRim + ${SHEEN.spot.toFixed(2)} * sheenSpot);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSheen;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(SHEEN.white)}, min(vSheen, 1.0) * ${SHEEN.mix.toFixed(2)});`,
      );
  };
  material.customProgramCacheKey = () => 'hall-sheen';
  return material;
}

// The floor's reflection (see the file header): the faces of each source { geo, k, count? }
// (its first `count` vertices; the glow's flames left out) within REFLECT, their baked colours
// times k, and the lid over them (two faces looking down) in the mean of the colours (times k)
// of the faces left out above REFLECT.top, by their area; in one untextured geometry (in the
// room's frame: the mesh flips it).
function reflection(sources, { HALL }) {
  const pos = [];
  const col = [];
  const above = [0, 0, 0]; // the left-out faces' colour (times k) times their area, summed
  let aboveArea = 0;
  for (const { geo, k, count = geo.attributes.position.count } of sources) {
    const p = geo.attributes.position;
    const c = geo.attributes.color;
    const flame = geo.attributes.flame;
    for (let i = 0; i + 2 < count; i += 3) {
      const [y0, y1, y2] = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
      const low = Math.min(y0, y1, y2);
      if (low < 0 || Math.max(y0, y1, y2) < REFLECT.foot) continue;
      if (flame && (flame.getX(i) > 0 || flame.getX(i + 1) > 0 || flame.getX(i + 2) > 0)) continue;
      if (low > REFLECT.top) {
        const area = faceArea(p, i);
        for (let j = i; j < i + 3; j++) for (let d = 0; d < 3; d++) above[d] += (area / 3) * c.getComponent(j, d) * k[d];
        aboveArea += area;
        continue;
      }
      for (let j = i; j < i + 3; j++) {
        pos.push(p.getX(j), p.getY(j), p.getZ(j));
        col.push(c.getX(j) * k[0], c.getY(j) * k[1], c.getZ(j) * k[2]);
      }
    }
  }
  const [x0, x1, z0, z1] = [-HALL.halfX - REFLECT.reach, HALL.halfX + REFLECT.reach, HALL.northZ - REFLECT.reach, HALL.southZ + REFLECT.reach];
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) {
    pos.push(x, HALL.ceilingY, z);
    col.push(above[0] / aboveArea, above[1] / aboveArea, above[2] / aboveArea);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

// The area of the face whose first corner is vertex i of position attribute p.
function faceArea(p, i) {
  const [ax, ay, az] = [p.getX(i + 1) - p.getX(i), p.getY(i + 1) - p.getY(i), p.getZ(i + 1) - p.getZ(i)];
  const [bx, by, bz] = [p.getX(i + 2) - p.getX(i), p.getY(i + 2) - p.getY(i), p.getZ(i + 2) - p.getZ(i)];
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
}

function unit(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
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
