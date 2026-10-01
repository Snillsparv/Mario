// Midsummer Skerries' land (area 'skerries', see skerries/layout.js): a WorldPart built in the
// course's local frame, which world/area.js places at its origin. The sea is its own part
// (skerries/sea.js); the lighthouse and the signal mast are written into this one's kit by
// skerries/lighthouse.js.
//
//   buildSkerries(layout) -> { object3D, colliders, update(time), reset(), setLit(on), lit }
//
// Pink-grey granite rising out of the sea on sheer sides that flare out under the water (rock():
// a convex top outline and its foot on the seabed): Home Island (a meadow in its middle, a
// sand beach on its north-east edge), the stepping skerries and the low reef rocks (regular
// polygons, skerry()), and the lighthouse islet, whose first terrace drops into the sea like
// a skerry while the two above stand on it behind sheer rock faces, with a sand beach up out
// of the Sound, two stone blocks up to the second terrace and a wooden stair (on a stone base)
// up to the third. The jetty on its stone crib with the red-sailed boat alongside. Outside the
// enclosure, drawn only: the mainland cliffs (faceted granite under a grass cap with dark
// firs) and the net-drying racks along the outer reef. The seabed: sand under the bay, sinking
// away and darkening out to sea.
//
// Unlit worldMaterial meshes with the lighting baked into vertex colours under a low golden
// sun (SKERRIES_SUN; rock darker where it is wet and under water), one mesh per material, ten
// here (and the sea's two): skerries-granite (the terrain's rock texture, tinted pink-grey),
// -meadow (grass, and the firs), -sand (the beaches and the seabed), -wood (the castle's planks:
// the jetty, the boat's deck and spars, the stair, the racks; the gallery's iron, tinted dark),
// -paint (painted planks: the lighthouse, the boat's hull), -cloth (sails), -nets
// (alpha-tested), -signs, and the lighthouse's -lamp and -beam (lighthouse.js).
//
// Colliders, all { positions, terrain[, surface] } (world/area.js shifts them): the enclosure
// (four walls from the seabed to BAY.wallTop), the seabed, every rock's flanks and top (stone,
// a meadow's grass, a beach's sand), the terraces' rock faces, the blocks, the stair (a smooth
// not_slippery ramp on a solid base) and its landing, the jetty and the boat (solid to the
// seabed), the lighthouse (lighthouse.js), the signposts. The two masts are climbable poles
// (layout.POLES).

import * as THREE from 'three';
import { worldMaterial, bakeLighting } from '../../render/materials.js';
import { GeoBuilder, SolidBuilder, orientedBoxPolys } from '../castle/geom.js';
import { woodTexture } from '../castle/textures.js';
import { grassTexture, pathTexture, rockTexture } from '../terrainTextures.js';
import { MeshBuilder, bakedMesh } from '../props/geom.js';
import { addSignpost } from '../props/decor.js';
import { woodTexture as signWoodTexture } from '../props/textures.js';
import { makeRng } from '../../core/math.js';
import { faluPlankTexture, netTexture, sailTexture } from './textures.js';
import { buildLighthouse } from './lighthouse.js';

// World units per texture repeat (projected UVs); the cloth's and the nets' UVs are set per face.
const REPEAT = { granite: 1600, meadow: 480, sand: 560, wood: 300, paint: 300, cloth: 1, nets: 1 };
const NET_TILE = 160; // world size of one repeat of the net texture

// Vertex tints (sRGB).
const TINT = {
  granite: 0xf6dade,
  reef: 0xeed8dc,
  blocks: 0xf4ecea,
  meadow: 0xf4f4d8,
  fir: 0x4a6a46,
  beach: 0xffeedd,
  seabed: 0x8a8c78,
  deep: 0x203848,
  deck: 0xd8dcdc,
  crib: 0xc0c4c4,
  hull: 0x2a3f6a,
  strake: 0xf2ecdc,
  spar: 0xa07850,
  sail: 0xd0342c,
  jib: 0xf2ecdc,
  stair: 0xb08a64,
  stringer: 0x6a4a32,
  post: 0x7a6650,
};

const UP = [0, 1, 0];
const GAIN = 1.3; // the granite's tints brighten the rock texture (a warm grey-brown) to pink-grey
const LIGHT = { ambient: 0.58, diffuse: 0.55, maxBright: 1.1, tint: [1.06, 1.0, 0.92] }; // golden hour
const MEADOW_LIFT = 2; // the meadow and the jetty's deck are drawn this far over their colliders
const GRID = 420; // tessellation of the meadows and the seabed (their swaths)
const SEABED_EXTENT = 36000; // the seabed reaches as far out as the sea
const DEEP_SLOPE = 0.06; // ...sinking away outside the bay
const HULL = { gunwale: 24, waterline: -40, keel: -300 }; // the boat's hull: its drawn depth
const SHEER = { toe: -60, batter: 10 }; // rocks' sheer sides: down to the toe, leaning out this far
const STRINGER = 30; // the stair's stringers, outside its steps

export function buildSkerries(layout) {
  const kit = { solids: new SolidBuilder(), signs: { wood: new MeshBuilder(), colliders: { wood: [] }, shadow: () => {} }, rng: makeRng(0x5ce77) };
  for (const name of Object.keys(REPEAT)) kit[name] = new GeoBuilder(REPEAT[name]);
  enclosure(kit, layout);
  seabed(kit, layout);
  home(kit, layout);
  jetty(kit, layout);
  boat(kit, layout);
  for (const s of layout.SKERRIES) skerry(kit, layout, s, layout.SKERRY.sides, TINT.granite);
  for (const s of layout.REEF) skerry(kit, layout, s, layout.SKERRY.reefSides, TINT.reef);
  islet(kit, layout);
  blocks(kit, layout);
  stair(kit, layout);
  const light = buildLighthouse(kit, layout);
  cliffs(kit, layout);
  nets(kit, layout);
  for (const sign of layout.SIGNS) addSignpost(kit.signs, layout, sign);
  return assemble(kit, layout, light);
}

// ---------------------------------------------------------------- meshes

function assemble(kit, layout, light) {
  const lit = { ...LIGHT, sun: layout.SKERRIES_SUN };
  const group = new THREE.Group();
  group.name = 'skerries';
  const add = (name, builder, material) => {
    const mesh = new THREE.Mesh(bakeLighting(builder.toGeometry(), lit), material);
    mesh.name = `skerries-${name}`;
    group.add(mesh);
  };
  add('granite', kit.granite, worldMaterial({ map: rockTexture() }));
  add('meadow', kit.meadow, worldMaterial({ map: grassTexture() }));
  add('sand', kit.sand, worldMaterial({ map: pathTexture() }));
  add('wood', kit.wood, worldMaterial({ map: woodTexture() }));
  add('paint', kit.paint, worldMaterial({ map: faluPlankTexture() }));
  add('cloth', kit.cloth, worldMaterial({ map: sailTexture(), side: THREE.DoubleSide }));
  add('nets', kit.nets, worldMaterial({ map: netTexture(), side: THREE.DoubleSide, alphaTest: 0.5 }));
  group.add(bakedMesh('skerries-signs', kit.signs.wood, worldMaterial({ map: signWoodTexture() }), lit));
  for (const mesh of light.meshes) group.add(mesh);

  const colliders = kit.solids.colliders();
  colliders.push({ positions: kit.signs.colliders.wood, terrain: 'wood' });
  return {
    name: 'skerries',
    object3D: group,
    colliders,
    update(time) {
      light.update(time);
    },
    // A new game: the lighthouse's lamp goes out again.
    reset() {
      light.reset();
    },
    setLit: light.setLit,
    get lit() {
      return light.lit;
    },
  };
}

// ---------------------------------------------------------------- outlines ([x, z] corners)

// Corners of a regular polygon round (cx, cz): `sides` corners at radius r, at yaw (0 = +z)
// (i + phase) / sides turns (phase 0.5: an edge faces +z).
function ngon(cx, cz, r, sides, phase = 0.5) {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((i + phase) / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  });
}

// Each edge's outward unit normal of a convex outline (either winding).
function normals(outline) {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % n];
    area += ax * bz - bx * az;
  }
  const s = area > 0 ? 1 : -1;
  return outline.map(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az);
    return [(s * (bz - az)) / l, (-s * (bx - ax)) / l];
  });
}

// A convex outline moved out by d: each edge along its outward normal, each corner where its
// two moved edges meet.
function grow(outline, d) {
  const ns = normals(outline);
  const n = outline.length;
  return outline.map(([x, z], i) => {
    const [ax, az] = ns[(i + n - 1) % n];
    const [bx, bz] = ns[i];
    const k = d / (1 + ax * bx + az * bz);
    return [x + (ax + bx) * k, z + (az + bz) * k];
  });
}

// A convex outline shrunk toward its middle by factor k.
function inset(outline, k) {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  return outline.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
}

const at = (outline, y) => outline.map(([x, z]) => [x, y, z]);

// The part of convex polygon `poly` ([x, z]) inside convex outline `clip` (Sutherland-Hodgman).
function clipPoly(poly, clip) {
  const ns = normals(clip);
  let out = poly;
  for (let e = 0; e < clip.length && out.length; e++) {
    const [px, pz] = clip[e];
    const [nx, nz] = ns[e];
    const side = ([x, z]) => (x - px) * nx + (z - pz) * nz; // > 0: outside this edge
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      const sa = side(a);
      const sb = side(b);
      if (sa <= 0) next.push(a);
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
        const t = sa / (sa - sb);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out = next;
  }
  return out;
}

// A flat convex outline at height y drawn as grid cells (so its vertex colours can vary:
// shade(x, z) -> multiplier).
function gridPoly(builder, outline, y, step, shade) {
  const xs = outline.map((p) => p[0]);
  const zs = outline.map((p) => p[1]);
  for (let x = Math.floor(Math.min(...xs) / step) * step; x < Math.max(...xs); x += step) {
    for (let z = Math.floor(Math.min(...zs) / step) * step; z < Math.max(...zs); z += step) {
      const cell = clipPoly([[x, z], [x + step, z], [x + step, z + step], [x, z + step]], outline);
      if (cell.length >= 3) builder.poly(at(cell, y), { facing: UP, shade: cell.map(([px, pz]) => shade(px, pz)) });
    }
  }
}

// Soft light and dark swaths over a meadow (or the seabed).
const swath = (x, z) => 0.9 + 0.1 * Math.sin(x / 530 + Math.cos(z / 610)) * Math.cos(z / 470 - x / 900);

// ---------------------------------------------------------------- rocks

// Granite shading by height: full light up top, darker where the sea wets it, darker still
// down toward the seabed.
const wet = (x, y) => (y > 30 ? 1 : y > -30 ? 0.74 : 0.6 + 0.14 * Math.max(0, 1 + y / 800));

// A rock rising out of the sea: its convex top outline at height `top`, its sides dropping
// sheer (leaning out by SHEER.batter) to the toe a little under the water, then flaring out
// to the foot outline on the seabed (as many corners). Sheer above the water, so a water jump
// slides up them onto the top and a hop that falls short grabs the edge (a sloping flank would
// be a floor too steep to stand on: it would catch him and slide him back in). Its top is
// granite (its corners flecked a little lighter and darker) with, given `meadow`, a meadow on
// that share of it toward the middle (grass); edges listed in `open` get no sides (a beach
// takes their place).
function rock(kit, { BAY }, { outline, top, foot, tint, tone = 1, meadow = 0, open = [] }) {
  const { granite, solids } = kit;
  const n = outline.length;
  const hi = at(outline, top);
  const toe = at(grow(outline, SHEER.batter), SHEER.toe);
  const lo = at(foot, BAY.bedY);
  const sides = [];
  for (let i = 0; i < n; i++) {
    if (open.includes(i)) continue;
    const j = (i + 1) % n;
    sides.push([hi[i], hi[j], toe[j], toe[i]], [toe[i], toe[j], lo[j], lo[i]]);
  }
  granite.color(tint, tone * GAIN);
  granite.shade = wet;
  // The sides face away from the rock's middle (a convex solid: drawn as one).
  const c = [...hi, ...lo].reduce((s, p) => [s[0] + p[0] / (2 * n), s[1] + p[1] / (2 * n), s[2] + p[2] / (2 * n)], [0, 0, 0]);
  for (const f of sides) {
    const fc = f.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
    granite.poly(f, { facing: [fc[0] - c[0], fc[1] - c[1], fc[2] - c[2]] });
  }
  granite.shade = null;
  for (const f of sides) solids.face(f, [f[0][0] + f[1][0] - 2 * c[0], 0, f[0][2] + f[1][2] - 2 * c[2]], 'stone');
  // The top (and the meadow on it).
  granite.color(tint, tone * GAIN);
  granite.poly(hi, { facing: UP, shade: hi.map((_, i) => (i % 3 === 0 ? 1.06 : 0.97)) });
  if (!meadow) {
    solids.face(hi, UP, 'stone');
    return;
  }
  rimmed(kit, outline, top, meadow, false);
}

// A stepping skerry or a reef rock: a regular polygon of `sides` (turned a little at random:
// regular, so the hops' gaps between tops stay as measured), its top SKERRY.topK of its size r,
// its foot SKERRY.footK.
function skerry(kit, layout, { x, z, r, top }, sides, tint) {
  const { SKERRY } = layout;
  const phase = kit.rng();
  rock(kit, layout, {
    outline: ngon(x, z, r * SKERRY.topK, sides, phase),
    top,
    foot: ngon(x, z, r * SKERRY.footK, sides, phase),
    tint,
    tone: 0.92 + kit.rng() * 0.14,
  });
}

// ---------------------------------------------------------------- Home Island, the jetty, the boat

function home(kit, layout) {
  const { HOME, HOME_BEACH: B, SHORE, MEADOW } = layout;
  rock(kit, layout, {
    outline: HOME.outline,
    top: HOME.top,
    foot: grow(HOME.outline, SHORE.foot),
    tint: TINT.granite,
    meadow: MEADOW,
    open: [B.edge],
  });
  // The beach along the open edge: a sand slope from the top's edge out under the water, its
  // sides and its far end down to the seabed.
  const p = HOME.outline[B.edge];
  const q = HOME.outline[(B.edge + 1) % HOME.outline.length];
  const [nx, nz] = normals(HOME.outline)[B.edge];
  beach(kit, layout, [p, q], [nx, nz], HOME.top);
}

// A sand beach: from edge [p, q] at height `top` out along the outward normal n for run, down
// to foot; its sides and far end drop to the seabed. Drawn in sand, with sand colliders.
function beach(kit, { BAY, HOME_BEACH: B }, [p, q], [nx, nz], top, run = B.run, foot = B.foot) {
  const P = [p[0], top, p[1]];
  const Q = [q[0], top, q[1]];
  const Pf = [p[0] + nx * run, foot, p[1] + nz * run];
  const Qf = [q[0] + nx * run, foot, q[1] + nz * run];
  const bed = (v) => [v[0], BAY.bedY, v[2]];
  const polys = [
    [P, Q, Qf, Pf],
    [Pf, Qf, bed(Qf), bed(Pf)],
    [P, Pf, bed(Pf), bed(P)],
    [Q, Qf, bed(Qf), bed(Q)],
    [P, Q, bed(Q), bed(P)],
  ];
  kit.sand.color(TINT.beach);
  kit.sand.shade = wet;
  kit.sand.solid(polys.slice(0, 4));
  kit.sand.shade = null;
  kit.solids.solid(polys, 'sand');
}

// The jetty: a plank deck (drawn just over its collider) on a stone crib boarded with planks
// down to the water, piles along its sides; solid to the seabed.
function jetty(kit, { JETTY: J, BOAT, BAY }) {
  const { wood, granite, solids } = kit;
  wood.color(TINT.deck);
  wood.poly([[J.x0, J.top + MEADOW_LIFT, J.z0], [J.x1, J.top + MEADOW_LIFT, J.z0], [J.x1, J.top + MEADOW_LIFT, J.z1], [J.x0, J.top + MEADOW_LIFT, J.z1]], { facing: UP, shade: 1.08 });
  wood.color(TINT.crib);
  wood.solid(
    [
      [[J.x0, -60, J.z0], [J.x1, -60, J.z0], [J.x1, J.top, J.z0], [J.x0, J.top, J.z0]],
      [[J.x0, -60, J.z0], [J.x0, -60, J.z1], [J.x0, J.top, J.z1], [J.x0, J.top, J.z0]],
      [[J.x1, -60, J.z0], [J.x1, -60, J.z1], [J.x1, J.top, J.z1], [J.x1, J.top, J.z0]],
      [[J.x0, -60, J.z1], [J.x1, -60, J.z1], [J.x1, J.top, J.z1], [J.x0, J.top, J.z1]],
    ],
    { shade: 0.86 },
  );
  granite.color(TINT.reef, GAIN);
  granite.shade = wet;
  granite.box(J.x0 - 10, J.x1 + 10, BAY.bedY, -60, J.z0 - 10, J.z1, { bottom: false, top: false });
  granite.shade = null;
  wood.color(TINT.post);
  for (let z = J.z0 + 20; z < J.z1 - 100; z += 350) {
    for (const x of [J.x0 - 14, J.x1 + 14]) {
      if (x < J.x0 && z > BOAT.z0 && z < BOAT.z1) continue; // (the boat lies alongside there)
      wood.lathe(x, z, [[22, -200], [22, J.top + 6], [0, J.top + 6]], 6, { flat: true });
    }
  }
  solids.box(J.x0, J.x1, BAY.bedY, J.top, J.z0, J.z1, 'wood');
}

// The red-sailed boat alongside the jetty (the one in the bottle, full size): a blue hull with
// a white top strake, a plank deck, its mast (the climbable pole), a boom, a red mainsail and a
// white jib, both well above Jonas's head on deck. Solid to the seabed.
function boat(kit, { BOAT: B, BOAT_MAST: M, BAY }) {
  const { paint, wood, cloth, solids } = kit;
  const cx = (B.x0 + B.x1) / 2;
  const deck = [[cx, B.z0], [B.x1, B.z0 + 260], [B.x1, B.z1 - 120], [B.x1 - 50, B.z1], [B.x0 + 50, B.z1], [B.x0, B.z1 - 120], [B.x0, B.z0 + 260]];
  const cz = (B.z0 + B.z1) / 2;
  const n = deck.length;
  const top = at(deck, B.deck + HULL.gunwale);
  const floor = at(deck, B.deck);
  const strake = at(deck, B.deck - 30);
  const water = at(deck, HULL.waterline);
  const bottom = at(inset(deck, 0.35), HULL.keel);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out = [(deck[i][0] + deck[j][0]) / 2 - cx, 0, (deck[i][1] + deck[j][1]) / 2 - cz];
    paint.color(TINT.strake);
    paint.poly([strake[i], strake[j], top[j], top[i]], { facing: out });
    paint.color(TINT.hull);
    paint.poly([water[i], water[j], strake[j], strake[i]], { facing: out });
    paint.poly([bottom[i], bottom[j], water[j], water[i]], { facing: [out[0], -400, out[2]], shade: 0.7 });
  }
  paint.poly(bottom, { facing: [0, -1, 0], shade: 0.5 });
  wood.color(TINT.deck);
  wood.poly(floor, { facing: UP });
  // The gunwale's inside, a little darker.
  paint.color(TINT.strake, 0.8);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    paint.poly([floor[i], floor[j], top[j], top[i]], { facing: [cx - deck[i][0], 0, cz - deck[i][1]] });
  }
  const keel = at(deck, BAY.bedY);
  solids.solid([floor, ...floor.map((p, i) => [keel[i], keel[(i + 1) % n], floor[(i + 1) % n], p])], 'wood');

  // The mast (its climbable pole is layout.POLES), the boom, the sails.
  wood.color(TINT.spar);
  wood.lathe(M.x, M.z, [[M.radius - 4, M.y0], [M.radius - 10, M.y1 - 10], [0, M.y1]], 8);
  const boomY = B.deck + 300;
  wood.solid(orientedBoxPolys([M.x, 0, (M.z + B.z1 - 60) / 2], [0, 0, 1], B.z1 - 60 - M.z, boomY - 10, boomY + 10, 20));
  cloth.color(TINT.sail);
  const main = [[M.x, boomY + 14, M.z + 20], [M.x, boomY + 14, B.z1 - 80], [M.x, M.y1 - 80, M.z + 20]];
  cloth.poly(main, { facing: [1, 0, 0], uvs: main.map(([, y, z]) => [(z - M.z) / (B.z1 - M.z), (y - boomY) / (M.y1 - boomY)]) });
  cloth.color(TINT.jib);
  const jib = [[M.x, boomY + 30, M.z - 30], [M.x, M.y1 - 160, M.z - 20], [M.x, boomY + 30, B.z0 + 40]];
  cloth.poly(jib, { facing: [1, 0, 0], uvs: jib.map(([, y, z]) => [(M.z - z) / (M.z - B.z0), (y - boomY) / (M.y1 - boomY)]) });
}

// ---------------------------------------------------------------- the islet

// The lighthouse islet: the first terrace a rock dropping into the sea (granite round a meadow),
// the second and third standing on it behind sheer rock faces (meadow tops in a granite rim),
// Great Rock (one of the SKERRIES) its west spur, the sand beach up out of the Sound.
function islet(kit, layout) {
  const { ISLET, TERRACES, SHORE_ISLET, ISLET_BEACH: B } = layout;
  const [t1, ...upper] = TERRACES;
  const outline = ngon(ISLET.x, ISLET.z, t1.r, t1.sides);
  rock(kit, layout, {
    outline,
    top: t1.top,
    foot: grow(outline, SHORE_ISLET.foot),
    tint: TINT.granite,
    meadow: 0.85,
  });
  let below = t1.top;
  for (const t of upper) {
    terrace(kit, ngon(ISLET.x, ISLET.z, t.r, t.sides), below - 20, t.top);
    below = t.top;
  }
  // The south beach: up from under the Sound onto the first terrace.
  const { x0, x1, z0, z1, top, foot } = B;
  beach(kit, layout, [[x0, z0], [x1, z0]], [0, 1], top, z1 - z0, foot);
}

// A terrace standing on the one below: sheer granite faces from y0 up to its top, a meadow on
// top inside a granite rim.
function terrace(kit, outline, y0, top) {
  const { granite, solids } = kit;
  const n = outline.length;
  const faces = outline.map((p, i) => {
    const q = outline[(i + 1) % n];
    return [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]];
  });
  granite.color(TINT.granite, GAIN);
  granite.shade = (x, y) => 0.8 + 0.2 * Math.min(1, (y - y0) / (top - y0));
  granite.solid(faces);
  granite.shade = null;
  solids.solid(faces, 'stone');
  rimmed(kit, outline, top, 0.8);
}

// A flat top: a granite rim round a meadow (the share `k` of it toward the middle), as
// colliders (stone, grass) and drawn (the rim only with `drawRim`: rock() draws its whole top
// in granite under the meadow).
function rimmed(kit, outline, top, k, drawRim = true) {
  const { granite, solids } = kit;
  const n = outline.length;
  const green = inset(outline, k);
  granite.color(TINT.granite, GAIN);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const quad = [[outline[i][0], top, outline[i][1]], [outline[j][0], top, outline[j][1]], [green[j][0], top, green[j][1]], [green[i][0], top, green[i][1]]];
    if (drawRim) granite.poly(quad, { facing: UP, shade: [1.04, 1.04, 0.96, 0.96] });
    solids.face(quad, UP, 'stone');
  }
  solids.face(at(green, top), UP, 'grass');
  kit.meadow.color(TINT.meadow);
  gridPoly(kit.meadow, green, top + MEADOW_LIFT, GRID, swath);
}

// The two stone blocks up the second terrace's east face (dressed stone, lighter than the rock).
function blocks(kit, { BLOCKS, TERRACES }) {
  const { granite, solids } = kit;
  granite.color(TINT.blocks, GAIN);
  for (const b of BLOCKS) {
    const y0 = TERRACES[0].top - 20;
    granite.box(b.x0, b.x1, y0, b.top, b.z0, b.z1, { bottom: false, faceShade: (n) => (n[1] > 0.5 ? 1.05 : 0.85) });
    solids.box(b.x0, b.x1, y0, b.top, b.z0, b.z1, 'stone');
  }
}

// The wooden stair from the second terrace up to the third: drawn steps between two stringers
// along a smooth ramp collider (not slippery), all on a stone base down to the second terrace;
// at its head a stone landing flush with the third terrace's top, reaching into it.
function stair(kit, { STAIR: S, TERRACES }) {
  const { wood, granite, solids } = kit;
  const { foot, head, width, steps, landing } = S;
  const dx = head.x - foot.x;
  const dz = head.z - foot.z;
  const run = Math.hypot(dx, dz);
  const ux = dx / run;
  const uz = dz / run;
  const sx = uz; // across the stair (to its right going up)
  const sz = -ux;
  const base = TERRACES[1].top - 20;
  const rise = head.y - foot.y;
  // A point s along the stair (from its foot), w across it, at height y.
  const P = (s, w, y) => [foot.x + ux * s + sx * w, y, foot.z + uz * s + sz * w];
  const hw = width / 2;
  const W = hw + STRINGER; // the stair's whole width, its stringers included
  const surf = (s) => foot.y + (rise * s) / run;

  // The ramp on its base: one convex wedge, as wide as the stringers.
  const wedge = [
    [P(0, -W, foot.y), P(0, W, foot.y), P(run, W, head.y), P(run, -W, head.y)],
    [P(0, -W, base), P(0, -W, foot.y), P(run, -W, head.y), P(run, -W, base)],
    [P(0, W, base), P(0, W, foot.y), P(run, W, head.y), P(run, W, base)],
    [P(0, -W, base), P(0, W, base), P(0, W, foot.y), P(0, -W, foot.y)],
    [P(run, -W, base), P(run, W, base), P(run, W, head.y), P(run, -W, head.y)],
  ];
  solids.solid(wedge, 'wood', 'not_slippery');
  // The base's stone sides, under the stringers.
  granite.color(TINT.blocks, GAIN);
  granite.shade = (x, y) => 0.72 + 0.24 * Math.min(1, (y - base) / rise);
  for (const w of [-W, W]) granite.poly([P(0, w, base), P(run, w, base), P(run, w, surf(run) - 70), P(0, w, surf(0) - 70)], { facing: [sx * w, 0, sz * w] });
  granite.shade = null;

  // Drawn steps: each tread's middle on the ramp, between the stringers.
  const tread = run / steps;
  const step = rise / steps;
  wood.color(TINT.stair);
  for (let i = 0; i < steps; i++) {
    const y = foot.y + step * (i + 1);
    const s0 = tread * (i + 0.5);
    const s1 = i === steps - 1 ? run : s0 + tread;
    wood.poly([P(s0, -hw, y - step), P(s0, hw, y - step), P(s0, hw, y), P(s0, -hw, y)], { facing: [-ux, 0, -uz], shade: 0.55 });
    wood.poly([P(s0, -hw, y), P(s0, hw, y), P(s1, hw, y), P(s1, -hw, y)], { facing: UP, shade: 1.1 });
  }
  // The stringers either side, dark, their tops along the ramp.
  wood.color(TINT.stringer);
  for (const k of [-1, 1]) {
    const face = (w) => [P(0, w, surf(0) - 70), P(run, w, surf(run) - 70), P(run, w, surf(run) + 20), P(0, w, surf(0) + 20)];
    const inner = face(k * hw);
    const outer = face(k * W);
    wood.poly(outer, { facing: [sx * k, 0, sz * k], shade: 0.8 });
    wood.poly(inner, { facing: [-sx * k, 0, -sz * k], shade: 0.6 });
    wood.poly([inner[3], inner[2], outer[2], outer[3]], { facing: UP, shade: 1.05 });
  }

  // The landing at its head: a stone slab out of the third terrace, flush with its top.
  const L = orientedBoxPolys([head.x + (ux * landing) / 2, 0, head.z + (uz * landing) / 2], [ux, 0, uz], landing, base, head.y, 2 * W + 20);
  granite.color(TINT.blocks, GAIN);
  granite.solid(L.filter((p) => p.some((v) => v[1] > base)), { faceShade: (n) => (n[1] > 0.5 ? 1.05 : 0.8) });
  solids.solid(L, 'stone');
}

// ---------------------------------------------------------------- the seabed and the enclosure

// Sand under the bay (darker with depth seen through the water), and outside it the seabed
// sinking away and darkening to deep water as far out as the sea reaches. Its collider is the
// bay's floor.
function seabed(kit, { BAY }) {
  const { sand, solids } = kit;
  sand.color(TINT.seabed);
  gridPoly(sand, [[BAY.x0, BAY.z0], [BAY.x1, BAY.z0], [BAY.x1, BAY.z1], [BAY.x0, BAY.z1]], BAY.bedY, GRID * 3, swath);
  // Four skirts round the bay, sinking outward.
  const E = SEABED_EXTENT;
  const deep = BAY.bedY - (E - 6000) * DEEP_SLOPE;
  sand.color(TINT.deep);
  const corners = [[BAY.x0, BAY.z0], [BAY.x1, BAY.z0], [BAY.x1, BAY.z1], [BAY.x0, BAY.z1]];
  const far = [[-E, -E], [E, -E], [E, E], [-E, E]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    sand.poly([[corners[i][0], BAY.bedY, corners[i][1]], [corners[j][0], BAY.bedY, corners[j][1]], [far[j][0], deep, far[j][1]], [far[i][0], deep, far[i][1]]], { facing: UP, shade: [2.2, 2.2, 1, 1] });
  }
  solids.box(BAY.x0, BAY.x1, BAY.bedY - 200, BAY.bedY, BAY.z0, BAY.z1, 'sand');
}

// The enclosure: four walls round the bay from the seabed up to wallTop (invisible: the
// cliffs and the net racks are drawn just outside them).
function enclosure(kit, { BAY }) {
  const { solids } = kit;
  const T = 200;
  const { x0, x1, z0, z1, bedY: y0, wallTop: y1 } = BAY;
  const open = { bottom: false, top: false };
  solids.box(x0 - T, x0, y0, y1, z0 - T, z1 + T, 'stone', open);
  solids.box(x1, x1 + T, y0, y1, z0 - T, z1 + T, 'stone', open);
  solids.box(x0, x1, y0, y1, z0 - T, z0, 'stone', open);
  solids.box(x0, x1, y0, y1, z1, z1 + T, 'stone', open);
}

// ---------------------------------------------------------------- outside the bay (drawn only)

// The mainland cliffs just outside the west, south and east walls: a face of granite slabs
// (each column leaning back from the wall, some set back a little) under a grass cap rising
// inland, dark firs on it. The side cliffs run on north past the reef, sinking toward their tips.
function cliffs(kit, { BAY, CLIFFS: C }) {
  const { granite, meadow, rng } = kit;
  const sides = [
    // [start (x, z), along, outward]
    { from: [BAY.x0, C.northZ], to: [BAY.x0, BAY.z1 + C.cap], out: [-1, 0] },
    { from: [BAY.x0 - C.cap, BAY.z1], to: [BAY.x1 + C.cap, BAY.z1], out: [0, 1] },
    { from: [BAY.x1, BAY.z1 + C.cap], to: [BAY.x1, C.northZ], out: [1, 0] },
  ];
  for (const { from, to, out } of sides) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.ceil(len / C.step);
    const cols = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = from[0] + (to[0] - from[0]) * k;
      const z = from[1] + (to[1] - from[1]) * k;
      // North of the bay the cliff sinks toward its tip.
      const tip = Math.min(1, Math.max(0, (BAY.z0 - z) / (BAY.z0 - C.northZ)));
      const h = (C.top - 150 + rng() * 300) * (1 - tip) + C.tipTop * tip;
      const back = rng() * C.recess;
      cols.push({ x: x + out[0] * back, z: z + out[1] * back, h });
    }
    for (let i = 0; i < n; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      const lean = 160;
      const A = (c, y, d = 0) => [c.x + out[0] * d, y, c.z + out[1] * d];
      granite.color(TINT.granite, (0.92 + rng() * 0.12) * GAIN);
      granite.shade = wet;
      granite.poly([A(a, BAY.bedY - 50), A(b, BAY.bedY - 50), A(b, b.h, lean), A(a, a.h, lean)], { facing: [-out[0], 0, -out[1]] });
      granite.shade = null;
      // The grass cap: over the top edge, rising inland.
      meadow.color(TINT.meadow, 0.9);
      meadow.poly([A(a, a.h, lean), A(b, b.h, lean), A(b, b.h + 160, C.cap), A(a, a.h + 160, C.cap)], { facing: UP, shade: [0.85, 0.85, 1, 1] });
      meadow.poly([A(a, a.h + 160, C.cap), A(b, b.h + 160, C.cap), A(b, b.h + 600, C.cap * 2.6), A(a, a.h + 600, C.cap * 2.6)], { facing: UP, shade: 0.9 });
    }
    // Firs on the cap.
    meadow.color(TINT.fir);
    for (let f = 0; f < C.firs / sides.length; f++) {
      const c = cols[Math.floor(rng() * cols.length)];
      const d = 500 + rng() * (C.cap * 1.6);
      const slide = (rng() - 0.5) * C.step;
      const fx = c.x + out[0] * d + out[1] * slide;
      const fz = c.z + out[1] * d + -out[0] * slide;
      const base = c.h + 160 * Math.min(1, d / C.cap) + Math.max(0, d - C.cap) * (440 / (C.cap * 1.6));
      const h = 520 + rng() * 420;
      const r = 150 + rng() * 90;
      meadow.lathe(fx, fz, [[r, base], [r * 0.5, base + h * 0.45], [r * 0.78, base + h * 0.45], [0, base + h]], 6, { flat: true, a0: rng() });
    }
  }
}

// The net-drying racks along the outer reef, just outside the north wall: tarred posts every
// NETS.every with a top and a bottom rail, nets hung between them (sagging a little; now and
// then a rack stands empty).
function nets(kit, { NETS: N }) {
  const { wood, nets: net } = kit;
  wood.color(TINT.stringer);
  const posts = [];
  for (let x = N.x0; x <= N.x1; x += N.every) posts.push(x);
  for (const x of posts) wood.box(x - 12, x + 12, -300, N.height, N.z - 12, N.z + 12, { bottom: false });
  for (const y of [N.netHigh, N.netLow - 16]) wood.box(N.x0, N.x1, y, y + 16, N.z - 7, N.z + 7);
  net.color(0xffffff);
  for (let i = 0; i + 1 < posts.length; i++) {
    if (i % 4 === 3) continue;
    const xa = posts[i] + 14;
    const xb = posts[i + 1] - 14;
    const sag = 50 + (i % 3) * 25;
    const pts = [[xa, N.netHigh, N.z], [xb, N.netHigh, N.z], [xb, N.netLow + 30, N.z], [(xa + xb) / 2, N.netLow + 30 - sag, N.z], [xa, N.netLow + 30, N.z]];
    net.poly(pts, { facing: [0, 0, 1], uvs: pts.map(([x, y]) => [x / NET_TILE, y / NET_TILE]) });
  }
}
