// The lighthouse on the islet's top terrace and the signal mast in front of it (Midsummer
// Skerries, skerries/layout.js LIGHTHOUSE and MAST), written into the course's kit
// (skerries/build.js): render faces into its material builders, colliders into kit.solids.
//
//   buildLighthouse(kit, layout) -> { meshes, setLit(on), lit, update(time), reset() }
//
// A tapering white tower of painted planks with a red band, a door and small windows; the lamp
// gallery round its top, a dark iron floor behind a railing that stays open over LIGHTHOUSE.gap
// facing south, toward the mast (the jump from it comes down over the railing; a walk off the
// gap drops him onto the mast); the lantern room (eight corner posts round dark glass over a low
// white wall) under a red domed cap with a gold finial. The signal mast is a tall wooden pole
// with a gold knob on its tip (its climbable pole is layout.POLES).
// The lamp (`meshes`: 'skerries-lamp', full-bright glass and a lamp inside it, and
// 'skerries-beam', two hazy light beams sweeping round) stays dark until setLit(true),
// once the course's star is won; reset() puts it out again.
//
// Colliders: the tower (a 12-sided frustum), the gallery floor (a 16-sided slab), its railing
// (a thin wall along each of the gallery's edges but those in the gap), the lantern room (an
// eight-sided prism, an edge facing south: what stops an overshooting jump from the mast) and
// the cap (an eight-sided cone).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, beamPolys, conePolys, orientedBoxPolys } from '../castle/geom.js';

const TINT = {
  white: 0xf6f2e8,
  red: 0xc42a26,
  iron: 0x34363a,
  ironFloor: 0x55585a,
  door: 0x6a2a20,
  pane: 0x2c3a4c,
  gold: 0xe8b84a,
  mast: 0x8a6446,
  glow: 0xfff0b0,
  lamp: 0xffd870,
  beam: 0xffdc84,
};
const FULL_BRIGHT = { ambient: 1, diffuse: 0 };
const BEAM = { length: 5200, near: 40, far: 380, glow: 0.5, speed: 0.55, y: 3080 }; // the beams' size, light and sweep (rad/s)
const BRACKET = 300; // the gallery's struts start this far under its floor, on the tower
const POSTS = 8; // the lantern room's corner posts
const PARAPET = 100; // the lantern room's low wall under its glass

// Corners of a regular polygon round (cx, cz): `sides` corners at radius r, at yaw (0 = +z)
// (i + 0.5) / sides turns, so an edge faces +z (south).
function ring(cx, cz, r, sides, y) {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
}

// Convex solid between two such rings (a prism or frustum), with its top and bottom if asked.
function frustum(cx, cz, r0, y0, r1, y1, sides, { top = true, bottom = false } = {}) {
  const lo = ring(cx, cz, r0, sides, y0);
  const hi = ring(cx, cz, r1, sides, y1);
  const polys = lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]]);
  if (top) polys.push(hi);
  if (bottom) polys.push(lo);
  return polys;
}

export function buildLighthouse(kit, layout) {
  tower(kit, layout);
  gallery(kit, layout);
  lantern(kit, layout);
  mast(kit, layout);
  return lamp(layout);
}

// The tower: white planks, the red band, a door facing the mast, small windows up the south
// side; its foot a granite plinth on the terrace.
function tower(kit, { LIGHTHOUSE: L }) {
  const { paint, granite, solids } = kit;
  const { x, z, foot, r0, r1, sides, band, gallery: top } = L;
  const r = (y) => r0 + ((r1 - r0) * (y - foot)) / (top - foot);
  granite.color(0xe8d8d4, 1.2);
  granite.solid(frustum(x, z, r0 + 40, foot - 30, r0 + 30, foot + 40, sides));
  const sections = [[foot + 40, band[0], TINT.white], [band[0], band[1], TINT.red], [band[1], top, TINT.white]];
  for (const [y0, y1, tint] of sections) {
    paint.color(tint);
    paint.lathe(x, z, [[r(y0), y0], [r(y1), y1]], sides, { a0: Math.PI / sides });
  }
  // The door and three windows on the south face (just proud of it).
  const face = (y0, y1, hw, tint) => {
    paint.color(tint);
    const lean = (y) => r(y) * Math.cos(Math.PI / sides) + 3;
    paint.poly([[x - hw, y0, z + lean(y0)], [x + hw, y0, z + lean(y0)], [x + hw, y1, z + lean(y1)], [x - hw, y1, z + lean(y1)]], { facing: [0, 0, 1] });
  };
  face(foot + 40, foot + 260, 60, TINT.door);
  for (const y of [1700, 2000, 2560]) face(y, y + 90, 26, TINT.pane);
  solids.solid(frustum(x, z, r0 + 40, foot - 30, r0 + 30, foot + 40, sides), 'stone');
  solids.solid(frustum(x, z, r(foot + 40), foot + 40, r1, top, sides, { top: false }), 'stone');
}

// The lamp gallery: an iron floor round the top of the tower on brackets, behind a railing of
// posts and a top rail, open over the gap facing south.
function gallery(kit, { LIGHTHOUSE: L }) {
  const { wood, solids } = kit;
  const { x, z, gallery: y, galleryR: R, galleryThick: t, rail, railThick, gap, r1 } = L;
  const sides = 16;
  wood.color(TINT.ironFloor);
  wood.solid(frustum(x, z, R, y - t, R, y, sides, { bottom: true }), { faceShade: (n) => (n[1] < -0.5 ? 0.5 : n[1] > 0.5 ? 1 : 0.8) });
  solids.solid(frustum(x, z, R, y - t, R, y, sides, { bottom: true }), 'stone');
  // Brackets under it: struts from the tower up and out to the floor's rim.
  wood.color(TINT.iron);
  for (let i = 0; i < sides; i += 2) {
    const a = (i / sides) * Math.PI * 2;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    const rr = r1 + 8;
    wood.solid(beamPolys([x + s * rr, y - t - BRACKET, z + c * rr], [x + s * (R - 30), y - t - 8, z + c * (R - 30)], [c, 0, -s], 22, 22));
  }
  // The railing: a top rail and a middle rail along every edge but the gap's, a post at each
  // of their corners.
  const corners = ring(x, z, R - railThick / 2, sides, y);
  const posts = new Set();
  for (let i = 0; i < sides; i++) {
    const a = ((i + 1) / sides) * Math.PI * 2; // the edge's middle (yaw)
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < gap / 2) continue;
    const p = corners[i];
    const q = corners[(i + 1) % sides];
    const mid = [(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2];
    const dir = [q[0] - p[0], 0, q[2] - p[2]];
    const len = Math.hypot(dir[0], dir[2]);
    wood.solid(orientedBoxPolys(mid, dir, len + 6, y + rail - 14, y + rail, railThick + 4));
    wood.solid(orientedBoxPolys(mid, dir, len, y + rail * 0.45, y + rail * 0.45 + 8, railThick - 6));
    posts.add(i).add((i + 1) % sides);
    solids.solid(orientedBoxPolys(mid, dir, len, y, y + rail, railThick), 'stone');
  }
  for (const i of posts) {
    const [px, , pz] = corners[i];
    wood.box(px - 7, px + 7, y, y + rail - 14, pz - 7, pz + 7, { bottom: false, top: false });
  }
}

// The lantern room: a low white wall, dark glass between eight corner posts, a top ring; the
// red domed cap with a vent and a gold finial.
function lantern(kit, { LIGHTHOUSE: L }) {
  const { paint, wood, solids } = kit;
  const { x, z, gallery: y, lanternR: R, lanternTop: top, capR, capTop } = L;
  paint.color(TINT.white);
  paint.solid(frustum(x, z, R, y, R, y + PARAPET, POSTS, { top: false }));
  paint.color(TINT.pane);
  paint.solid(frustum(x, z, R - 6, y + PARAPET, R - 6, top - 40, POSTS, { top: false }));
  wood.color(TINT.iron);
  for (const [px, , pz] of ring(x, z, R, POSTS, 0)) wood.box(px - 12, px + 12, y + PARAPET, top - 40, pz - 12, pz + 12, { bottom: false, top: false });
  wood.solid(frustum(x, z, R + 8, top - 40, R + 8, top, POSTS));
  solids.solid(frustum(x, z, R, y, R, top, POSTS), 'stone');
  paint.color(TINT.red);
  paint.lathe(x, z, [[0, top], [capR, top], [capR, top + 30], [capR * 0.86, top + 110], [capR * 0.58, top + 210], [capR * 0.25, capTop - 20], [0, capTop]], POSTS * 2);
  paint.color(TINT.iron);
  paint.lathe(x, z, [[44, capTop - 20], [44, capTop + 40], [0, capTop + 40]], 8, { flat: true });
  paint.color(TINT.gold);
  paint.lathe(x, z, [[0, capTop + 40], [22, capTop + 52], [26, capTop + 76], [12, capTop + 98], [0, capTop + 102]], 8);
  solids.solid(conePolys(x, z, capR, POSTS * 2, top, capTop, { bottom: true }), 'stone');
}

// The signal mast: a wooden pole on an iron foot ring, a gold knob on its tip.
function mast(kit, { MAST: M }) {
  const { wood, paint } = kit;
  wood.color(TINT.iron);
  wood.lathe(M.x, M.z, [[64, M.y0], [64, M.y0 + 12], [M.radius + 4, M.y0 + 24]], 8, { flat: true });
  wood.color(TINT.mast);
  wood.lathe(M.x, M.z, [[M.radius, M.y0 + 20], [M.radius - 8, M.y1 - 16]], 8);
  paint.color(TINT.gold);
  paint.lathe(M.x, M.z, [[M.radius - 8, M.y1 - 16], [M.radius, M.y1 - 8], [M.radius - 4, M.y1], [0, M.y1]], 8, { flat: true });
}

// The lamp and its beams (hidden until lit): full-bright glass over the dark panes and a lamp
// inside; two beams on opposite sides, each a horizontal and a vertical fan fading out along
// its length, turning round the lantern.
function lamp({ LIGHTHOUSE: L }) {
  const { x, z, gallery: y, lanternR: R, lanternTop: top } = L;
  const glow = new GeoBuilder(1);
  glow.color(TINT.glow);
  glow.solid(frustum(x, z, R - 4, y + PARAPET, R - 4, top - 40, POSTS, { top: false }));
  glow.color(TINT.lamp);
  glow.lathe(x, z, [[0, BEAM.y - 80], [60, BEAM.y - 40], [70, BEAM.y + 20], [40, BEAM.y + 80], [0, BEAM.y + 100]], 8);
  const lampMesh = new THREE.Mesh(bakeLighting(glow.toGeometry(), FULL_BRIGHT), worldMaterial());
  lampMesh.name = 'skerries-lamp';

  // Each fan a warm haze, thickest at the lamp and fading out to nothing at its far end: the
  // fade is the vertex colours' alpha.
  const beam = new GeoBuilder(1);
  beam.color(TINT.beam);
  for (const s of [1, -1]) {
    for (const up of [false, true]) {
      const at = (d, w) => (up ? [s * d, w, 0] : [s * d, 0, w]);
      beam.poly([at(BEAM.near, -BEAM.near), at(BEAM.length, -BEAM.far), at(BEAM.length, BEAM.far), at(BEAM.near, BEAM.near)], { facing: up ? [0, 0, 1] : [0, 1, 0] });
    }
  }
  const beamGeo = beam.toGeometry();
  const rgb = beamGeo.attributes.color;
  const rgba = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) {
    rgba.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), BEAM.glow * (1 - Math.abs(beamGeo.attributes.position.getX(i)) / BEAM.length)], i * 4);
  }
  beamGeo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  // (Unfogged: the fade already thins it out with distance.)
  const beamMesh = new THREE.Mesh(beamGeo, worldMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beamMesh.name = 'skerries-beam';
  beamMesh.position.set(x, BEAM.y, z);
  beamMesh.renderOrder = 3;

  let lit = false;
  const setLit = (on) => {
    lit = !!on;
    lampMesh.visible = lit;
    beamMesh.visible = lit;
  };
  setLit(false);
  return {
    meshes: [lampMesh, beamMesh],
    setLit,
    get lit() {
      return lit;
    },
    update(time) {
      if (lit) beamMesh.rotation.y = time * BEAM.speed;
    },
    reset() {
      setLit(false);
    },
  };
}
