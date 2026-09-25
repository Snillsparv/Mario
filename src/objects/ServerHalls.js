// "Tech takeover" for AI RACE mode: server racks and data-hall modules drop out of the storm or
// grind up out of the ground, one every few seconds, until the castle grounds are overrun; the
// ground around each one turns into glowing circuitry. Original designs (serverHallModel.js).
//
//   new ServerHalls({ collision, events, fx?, level?, layout, sparkles?, rng?, view?, slots? })
//   setMode(on)                  AI RACE mode: the takeover starts / every unit sinks back
//   update(player, tick, hold?)  30 Hz: schedule, arrivals, colliders, the hero's safety
//   animate(alpha, clock)        render: instance poses, lights, warning markers
//   setDarkness(t)               the lights dim a little as the storm fades
//   clear()                      everything gone at once (a new game): colliders parked,
//                                circuits cleared (level.clearCircuits), mode off
//   arrive(i, style)             starts slot i now (1 = drop, 2 = rise; tests, previews)
//   onClaim(u)                   optional hook (ObjectManager): unit u takes its ground (a drop
//                                lands, a rise starts); whatever else stands there is crushed
//                                or moved (minions, dropped coins); near(u, x, z, margin) tells
//   slots, units, outCount, stateOf(i), hits
//
// Planning (planSlots, at construction, deterministic for a layout): candidate spots on a
// jittered grid over the grounds, each with a facing (its rack-lined long sides toward the
// spawn, the way the player looks), accepted greedily per unit type (halls first: they need
// the most room; then rows; towers fill up to SLOT_RULES.MAX) when the footprint keeps clear of
// everything that matters (SLOT_RULES: the spawn, the castle door and courtyard, the AI RACE
// button, the mystery box, the cannon, signs, trees and their canopies, the star, coins and
// red coins, the 1-up gem, both paths, the fences, water, the island's edges and the castle,
// the perimeter cliffs, steep ground) and a wide corridor from every other unit. The collision
// world confirms each footprint (and a margin round it): bare ground, no walls, no object
// floors (rocks, bushes, trunks, signs, the button, the box). Arrival order: outward from the
// moat's front, so the takeover spreads from the castle toward the spawn and the corners.
//
// Schedule (HALL): FIRST_DELAY ticks after the mode turns on, then a new unit every EVERY
// ticks, each gap SPEEDUP shorter down to EVERY_MIN, at the first free slot (in planned order)
// clear of the hero (SAFE from where he is, was last tick and will be LOOKAHEAD ticks on); none
// while a dialog holds him or he is dying / respawning. Styles alternate at random (never more
// than MAX_STREAK alike in a row; the first one drops):
//   drop  a red marker (the footprint outlined on the ground, hazard stripes, pulsing echoes and
//         a column of light) shows where it lands while it falls from DROP_HEIGHT for
//         WARN_TICKS (sfx hall_warn); the impact throws up dust, sparks and debris (fx.dust,
//         dirt clods), plays hall_impact and emits 'hallImpact' { pos, strength: 1, kind }
//         (the camera shakes); the lights flicker on
//   rise  it grinds up out of the ground over RISE_TICKS (sfx hall_rise, 'hallImpact'
//         strength 0.35, dirt thrown up along its edges), its lights powering up
// Once down, level.addCircuit spreads circuit traces over the ground around it (terrain.js).
// When the mode ends every unit sinks over SINK_TICKS (one hall_rise, pitched down, for the one
// nearest the hero), its circuit fading; one still falling lands first, then sinks.
//
// Colliders: each slot's box (four walls to the base, a flat top) is added to the collision
// world at construction and parked PARK below the world; arriving and sinking move it by
// rewriting the surfaces' heights in place (like the mystery box: the grid is x/z only), one
// tick ahead of the picture, so everything that uses the collision world (the hero, the
// minions, fireballs, the camera) meets it. A drop's collider appears the tick before it
// lands.
//
// The hero is never shut inside one:
//   * arrivals start away from him (above);
//   * a falling unit sweeping through his body, or landing on him, hurts him DAMAGE wedges
//     (player.takeDamage(2, centre), like a fireball blast; not while a dialog holds him) and
//     pushes him out of its nearest side with open ground (player.teleport);
//   * a rising top lifts him (the physics steps him up onto it); every tick, a hero found inside
//     a unit's box below its top (a ledge climb on a moving edge, say) is lifted onto the top or
//     pushed out, and one hanging from a moving unit's edge is shaken off it (the player's
//     ledge hang holds a fixed height);
//   * a sinking top carries him down (it drops slower than he snaps down to the floor).
//
// Rendering: one InstancedMesh per unit type (three draw calls at most while units show, none
// while none does) and one for the warning markers; per-instance seed and power drive the
// lights in the shader. The per-tick and per-frame paths allocate nothing but event payloads
// (and the rare push-out).

import * as THREE from 'three';
import { FRAME_DT, PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/constants.js';
import { makeRng } from '../core/math.js';
import { tri } from './AiButton.js';
import { TINT } from './Sparkles.js';
import { HALL_TYPES, MARKER, buildHallGeometry, buildMarkerGeometry, makeHallMaterial, makeHallUniforms, makeMarkerMaterial } from './serverHallModel.js';

// Footprint clearances (units, from the footprint rectangle).
export const SLOT_RULES = {
  SPAWN: 1200,
  DOOR: 1800, // the castle door (CASTLE.x, CASTLE.frontZ)
  STAR: 900,
  BUTTON: 800,
  BOX: 850,
  CANNON: 1100, // the cannon's centre (its drum, loading pad and exit spot reach ~800 out)
  SIGN: 550,
  TREE: 160, // beyond the canopy radius
  TREE_CANOPY: 360, // canopy radius when the level's trees are not known
  COIN: 300,
  RED_COIN: 350,
  ONE_UP: 650,
  ROCK: 280, // beyond a rock's or bush's radius
  PATH: 220, // beyond a path's half width
  FENCE: 420,
  WATER: 350,
  PERIMETER: 700,
  ISLAND_EDGE: 700, // back-garden units keep this far inside the island's retaining wall
  CASTLE: 1000, // ... and this far from the castle's walls
  SLOPE: 150, // most ground height difference under a footprint
  SPACING: 650, // corridor between two units' footprints
  SAMPLE: 150, // footprint sample spacing for the ground checks
  OBSTACLE_PAD: 150, // the collision check covers the footprint grown by this much ...
  OBSTACLE_SAMPLE: 110, // ... sampled this finely (rocks, bushes, trunks, fences, signs)
  GRID: 220, // candidate grid step
  JITTER: 70,
  ORIGIN: { x: 0, z: 1400 }, // the takeover spreads out from here (the moat's front)
  MIX: { hall: 0.3, row: 0.35 }, // shares of MAX (towers fill the rest)
  SPREAD: { hall: 1700, row: 1000, tower: 650 }, // corridor between two units of one type
  MAX: 30,
};

// Distance from point (px, pz) to an oriented rectangle (centre x, z; half sizes hw, hd along
// its local x / z; yaw as in the rest of the game: local +z = (sin yaw, cos yaw)).
export function rectPointDistance(r, px, pz) {
  const dx = px - r.x;
  const dz = pz - r.z;
  // local coordinates: lx along (cos yaw, -sin yaw), lz along (sin yaw, cos yaw)
  const lx = dx * r.cos - dz * r.sin;
  const lz = dx * r.sin + dz * r.cos;
  const ox = Math.abs(lx) - r.hw;
  const oz = Math.abs(lz) - r.hd;
  const ex = ox > 0 ? ox : 0;
  const ez = oz > 0 ? oz : 0;
  return Math.sqrt(ex * ex + ez * ez);
}

// World corners of a rectangle, counter-clockwise from above.
function corners(r) {
  const out = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * r.hw;
    const lz = sz * r.hd;
    out.push({ x: r.x + lx * r.cos + lz * r.sin, z: r.z - lx * r.sin + lz * r.cos });
  }
  return out;
}

// Do two oriented rectangles overlap (separating axis test)?
function rectsOverlap(a, b) {
  const ca = corners(a);
  const cb = corners(b);
  for (const r of [a, b]) {
    for (const [ax, az] of [[r.cos, -r.sin], [r.sin, r.cos]]) {
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const p of ca) {
        const d = p.x * ax + p.z * az;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const p of cb) {
        const d = p.x * ax + p.z * az;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

// Distance between two oriented rectangles (0 when they overlap).
export function rectDistance(a, b) {
  if (rectsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const p of corners(a)) best = Math.min(best, rectPointDistance(b, p.x, p.z));
  for (const p of corners(b)) best = Math.min(best, rectPointDistance(a, p.x, p.z));
  return best;
}

function segDistance(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / l2)) : 0;
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function polylineDistance(px, pz, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) best = Math.min(best, segDistance(px, pz, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z));
  return best;
}

// Points over the rectangle grown by `pad`, about `step` apart (edges included).
function samplePoints(r, pad, step) {
  const pts = [];
  const w = r.hw + pad;
  const d = r.hd + pad;
  const nx = Math.max(1, Math.ceil((2 * w) / step));
  const nz = Math.max(1, Math.ceil((2 * d) / step));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const lx = -w + (2 * w * i) / nx;
      const lz = -d + (2 * d * j) / nz;
      pts.push({ x: r.x + lx * r.cos + lz * r.sin, z: r.z - lx * r.sin + lz * r.cos, edge: i === 0 || j === 0 || i === nx || j === nz });
    }
  }
  return pts;
}

export function makeRect(x, z, yaw, type) {
  const T = HALL_TYPES[type];
  return { x, z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), hw: T.w / 2, hd: T.d / 2, type };
}

// Everything a footprint must keep clear of, from the layout (and the level's trees): point
// anchors with a clearance, and polylines with a clearance.
function protectedSpots(layout, trees, rules, extra) {
  const R = rules;
  const pts = [];
  const add = (p, clear) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && pts.push({ x: p.x, z: p.z, clear });
  add(layout.SPAWN, R.SPAWN);
  if (layout.CASTLE) add({ x: layout.CASTLE.x, z: layout.CASTLE.frontZ }, R.DOOR);
  add(layout.STAR, R.STAR);
  add(layout.AI_BUTTON, R.BUTTON);
  add(layout.MYSTERY_BOX, R.BOX);
  add(layout.CANNON, R.CANNON);
  for (const s of layout.SIGNS ?? []) add(s, R.SIGN);
  if (trees?.length) for (const t of trees) add(t, (t.canopy?.radius ?? R.TREE_CANOPY) + R.TREE);
  else for (const t of layout.TREES ?? []) add(t, R.TREE_CANOPY + R.TREE);
  for (const c of layout.COINS ?? []) add(c, R.COIN);
  for (const c of layout.RED_COINS ?? []) add(c, R.RED_COIN);
  const c = layout.CASTLE;
  add(layout.ONE_UP ?? (c ? { x: c.x, z: c.backZ - 800 } : null), R.ONE_UP);
  for (const e of extra) add(e, (e.r ?? 0) + R.ROCK);
  return pts;
}

// Point rules alone (the candidate centre; every footprint sample must pass them too).
function pointOk(p, region, ctx) {
  const L = ctx.layout;
  const R = ctx.rules;
  if (L.sdWater(p.x, p.z) < R.WATER) return 'water';
  if (-L.sdRoundRect(p.x, p.z, L.PERIMETER) < R.PERIMETER) return 'perimeter';
  for (const path of L.PATHS ?? []) if (polylineDistance(p.x, p.z, path.points) < path.width / 2 + R.PATH) return 'path';
  for (const f of L.FENCES ?? []) if (polylineDistance(p.x, p.z, f.points) < R.FENCE) return 'fence';
  if (region === 'island') {
    if (-L.sdRoundRect(p.x, p.z, L.ISLAND) < R.ISLAND_EDGE) return 'islandEdge';
    if (ctx.castleBox && L.sdRoundRect(p.x, p.z, ctx.castleBox) < R.CASTLE) return 'castle';
  }
  return null;
}

// Is a unit of rect r's size allowed there? Analytic checks against the layout (cheap), then
// the collision world (bare ground: the floor found is the canonical ground, no walls).
function footprintOk(r, ctx) {
  const L = ctx.layout;
  const R = ctx.rules;
  const why = (k) => {
    if (ctx.stats) ctx.stats[k] = (ctx.stats[k] ?? 0) + 1;
    return null;
  };
  for (const p of ctx.spots) if (rectPointDistance(r, p.x, p.z) < p.clear) return why('spot:' + p.clear);
  const pts = samplePoints(r, 0, R.SAMPLE);
  const outer = samplePoints(r, R.PATH, R.SAMPLE * 1.5).filter((p) => p.edge);
  let region = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const reg = L.regionAt(p.x, p.z);
    if (reg !== 'lawn' && reg !== 'island') return why('region');
    if (region && reg !== region) return why('mixed');
    region = reg;
    const g = L.groundHeight(p.x, p.z);
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  if (hi - lo > R.SLOPE) return why('slope');
  for (const p of [...pts, ...outer]) {
    const bad = pointOk(p, region, ctx);
    if (bad) return why(bad);
  }
  const col = ctx.collision;
  if (col) {
    for (const p of samplePoints(r, R.OBSTACLE_PAD, R.OBSTACLE_SAMPLE)) {
      const g = L.groundHeight(p.x, p.z);
      const f = col.findFloor(p.x, g + 400, p.z);
      if (!f.surface || Math.abs(f.y - g) > 20) return why('floor');
      if (col.findWalls(p.x, g, p.z, 60, 60).walls.length) return why('walls');
      if (col.findWalls(p.x, g, p.z, 220, 60).walls.length) return why('walls');
    }
  }
  return { region, lo, hi };
}

// Plans the unit slots (deterministic for a layout). Returns [{ index, type, x, z, yaw, cos,
// sin, hw, hd, h, region, groundLo, groundHi }] in arrival order (nearest the origin first);
// none for a layout without the level's shape functions (test worlds).
//   collision  the collision world (bare-ground check; without it, the layout rules only)
//   trees      the level's trees ({ x, z, canopy: { radius } }); else layout.TREES
//   extra      more spots to keep clear of: [{ x, z, r }] (r + SLOT_RULES.ROCK)
//   stats      an object to count rejections by rule in (tuning)
export function planSlots(layout, { collision = null, trees = null, extra = [], rules = SLOT_RULES, seed = 0x7ec4, stats = null } = {}) {
  const L = layout;
  if (!L || typeof L.regionAt !== 'function' || typeof L.groundHeight !== 'function' || typeof L.sdWater !== 'function' || !L.PERIMETER || typeof L.sdRoundRect !== 'function') return [];
  const R = rules;
  const rng = makeRng(seed);
  const C = L.CASTLE;
  const ctx = {
    layout: L,
    rules: R,
    collision,
    spots: protectedSpots(L, trees, R, extra),
    stats,
    castleBox: C ? { minX: C.x - C.halfWidth, maxX: C.x + C.halfWidth, minZ: C.backZ, maxZ: C.frontZ, radius: 0 } : null,
  };
  const P = L.PERIMETER;
  const cands = [];
  for (let z = P.minZ; z <= P.maxZ; z += R.GRID) {
    for (let x = P.minX; x <= P.maxX; x += R.GRID) {
      const cx = x + (rng() - 0.5) * 2 * R.JITTER;
      const cz = z + (rng() - 0.5) * 2 * R.JITTER;
      const reg = L.regionAt(cx, cz);
      const pick = rng();
      const turn = rng();
      if (reg !== 'lawn' && reg !== 'island') continue;
      // (the centre must pass the point rules itself: most candidates end here, cheaply)
      if (pointOk({ x: cx, z: cz }, reg, ctx)) continue;
      cands.push({ x: cx, z: cz, pick, turn, d: Math.hypot(cx - R.ORIGIN.x, cz - R.ORIGIN.z) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const view = L.SPAWN ?? { x: 0, z: 0 };
  const slots = [];
  // One pass per type, biggest first (they need the most room): each takes the free spots
  // nearest the origin up to its share, keeping its own kind spread out (SPREAD); the towers
  // fill up the rest.
  for (const type of ['hall', 'row', 'tower']) {
    const quota = type === 'tower' ? R.MAX : Math.round(R.MAX * (R.MIX[type] ?? 0));
    let placed = 0;
    for (const c of cands) {
      if (placed >= quota || slots.length >= R.MAX) break;
      // Facing: the long, rack-lined sides toward the spawn (the way the player looks),
      // snapped to 15 degrees with a little turn of its own.
      let yaw = Math.atan2(view.x - c.x, view.z - c.z);
      yaw = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12) + (c.turn - 0.5) * 0.2;
      if (yaw > Math.PI / 2) yaw -= Math.PI;
      if (yaw <= -Math.PI / 2) yaw += Math.PI;
      const r = makeRect(c.x, c.z, yaw, type);
      const spread = R.SPREAD[type] ?? 0;
      const crowded = (s) => {
        const gap = s.type === type ? Math.max(spread, R.SPACING) : R.SPACING;
        return Math.hypot(s.x - r.x, s.z - r.z) < s.hw + s.hd + r.hw + r.hd + gap && rectDistance(s, r) < gap;
      };
      if (slots.some(crowded)) continue;
      const ok = footprintOk(r, ctx);
      if (!ok) continue;
      placed++;
      slots.push({ ...r, index: 0, h: HALL_TYPES[type].h, region: ok.region, groundLo: ok.lo, groundHi: ok.hi, d: c.d });
    }
  }
  // Arrival order: outward from the origin.
  slots.sort((a, b) => a.d - b.d);
  slots.forEach((s, i) => (s.index = i));
  return slots;
}

// ---------------------------------------------------------------- runtime

// Timings in ticks (30 per second), distances in units.
export const HALL = {
  PARK: -60000, // colliders wait this far below the world (out of every query's reach)
  FIRST_DELAY: 120, // ticks after the mode turns on before the first unit arrives
  EVERY: 105, // ticks between the first two arrivals ...
  SPEEDUP: 3, // ... each gap this much shorter than the last ...
  EVERY_MIN: 45, // ... down to this
  RETRY: 12, // ticks to wait when no slot is free of the hero
  DROP_CHANCE: 0.55, // arrival style: drop from the sky (else rise out of the ground) ...
  MAX_STREAK: 2, // ... never more than this many of one style in a row
  WARN_TICKS: 45, // a drop's red marker shows this long before the impact (the fall itself)
  DROP_HEIGHT: 4200,
  RISE_TICKS: 45,
  SINK_TICKS: 80,
  SINK_DELAY: 12, // a unit landing after the mode ended waits this long before sinking
  BOOT_TICKS: 40, // lights flickering on after an arrival
  SETTLE_TICKS: 10, // the landing jolt
  SETTLE: 22,
  BURY: 30, // the base sits this far under the lowest ground of the footprint
  SAFE: 450, // an arrival never starts with the hero this close to its footprint ...
  LOOKAHEAD: 15, // ... where he is, was last tick, or will be this many ticks on
  DAMAGE: 2, // a drop landing on the hero (like a fireball blast)
  EJECT: 45, // pushed out this far past the footprint (plus his radius)
  STEP_UP: 70, // a rising top this close above his feet lifts him instead
  INSET: 8, // (closer to the edge than this the unit's walls push him out themselves)
  LIFT_REACH: 260, // stuck this close under the top of a standing unit: put on top
  CIRCUIT_REACH: 560, // circuits spread this far beyond the footprint's half diagonal ...
  CIRCUIT_GROW: 4, // ... over this many seconds
  CIRCUIT_FADE: 2.5,
  MARKERS: 4, // warning markers at once
  CLODS_EVERY: 3,
};

const STATE = { IDLE: 0, DROP: 1, RISE: 2, ON: 3, SINK: 4 };
const TYPE_ORDER = ['tower', 'row', 'hall'];
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pos = { x: 0, y: 0, z: 0 }; // scratch position for sparkles (they copy it)

// Height of a drop `t` ticks into its fall (0 = landed).
export function dropLift(t) {
  const u = t / HALL.WARN_TICKS;
  return u >= 1 ? 0 : HALL.DROP_HEIGHT * (1 - u * u);
}

export class ServerHalls {
  // layout: the level layout (slots are planned from it); level: addCircuit / fadeCircuit /
  // clearCircuits (terrain) and trees; slots: planned slots to use instead (tests).
  constructor({ collision, events, fx = null, level = null, layout = null, sparkles = null, rng = makeRng(0x5e7e7), view = null, slots = null }) {
    this.collision = collision;
    this.events = events;
    this.fx = fx;
    this.level = level;
    this.sparkles = sparkles;
    this.rng = rng;
    this.groundAt = typeof layout?.groundHeight === 'function' ? layout.groundHeight : null;
    this.slots = slots ?? planSlots(layout, { collision, trees: level?.trees ?? null });
    this.on = false;
    this.activeTicks = 0;
    this.nextAt = HALL.FIRST_DELAY;
    this.arrivals = 0; // since the mode last turned on
    this.lastStyle = 0;
    this.streak = 0;
    this.tick = 0;
    this.hold = false;
    this.hits = 0; // drops that landed on the hero (tests, debugging)
    this.onClaim = null; // (u) => void: unit u takes its ground (see the header)
    this.hero = { x: 0, y: 0, z: 0, vx: 0, vz: 0, valid: false };

    this.uniforms = makeHallUniforms();
    this.mesh = new THREE.Group();
    this.mesh.name = 'serverHalls';
    this.types = {};
    const perType = { tower: 0, row: 0, hall: 0 };
    for (const s of this.slots) perType[s.type]++;
    const mat = this.slots.length ? makeHallMaterial(this.uniforms) : null;
    for (const type of TYPE_ORDER) {
      const n = perType[type];
      if (!n) continue;
      const geo = buildHallGeometry(type);
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aHall', attr);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = `serverHalls-${type}`;
      mesh.frustumCulled = false; // spread over the grounds
      mesh.visible = false;
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, ZERO);
      this.types[type] = { mesh, attr, dirty: false, shown: 0 };
      this.mesh.add(mesh);
      view?.prewarm?.(mesh);
    }
    if (this.slots.length) {
      const geo = buildMarkerGeometry();
      this.markAttr = new THREE.InstancedBufferAttribute(new Float32Array(HALL.MARKERS * 4), 4);
      this.markAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aMark', this.markAttr);
      this.markers = new THREE.InstancedMesh(geo, makeMarkerMaterial(this.uniforms), HALL.MARKERS);
      this.markers.name = 'serverHallMarkers';
      this.markers.frustumCulled = false;
      this.markers.renderOrder = 0.6; // with the other ground markers: after the path decal, before water
      this.markers.visible = false;
      this.markers.count = 0;
      for (let i = 0; i < HALL.MARKERS; i++) this.markers.setMatrixAt(i, ZERO);
      this.mesh.add(this.markers);
      view?.prewarm?.(this.markers);
    } else {
      this.markers = null;
    }

    const next = { tower: 0, row: 0, hall: 0 };
    this.units = this.slots.map((s) => this._makeUnit(s, next[s.type]++));
  }

  _makeUnit(s, k) {
    const ground = (x, z) => {
      if (this.groundAt) return this.groundAt(x, z);
      const f = this.collision.findFloor(x, 1e5, z);
      return f.surface ? f.y : 0;
    };
    // The ground plane under the footprint (for the warning marker) from its corners.
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lx = a * s.hw;
      const lz = b * s.hd;
      const x = s.x + lx * s.cos + lz * s.sin;
      const z = s.z - lx * s.sin + lz * s.cos;
      return new THREE.Vector3(x, ground(x, z), z);
    });
    const d1 = cs[2].clone().sub(cs[0]);
    const d2 = cs[3].clone().sub(cs[1]);
    const normal = new THREE.Vector3().crossVectors(d1, d2).normalize();
    if (normal.y < 0) normal.negate();
    let lo = Number.isFinite(s.groundLo) ? s.groundLo : Infinity;
    let hi = Number.isFinite(s.groundHi) ? s.groundHi : -Infinity;
    for (const c of cs) {
      lo = Math.min(lo, c.y);
      hi = Math.max(hi, c.y);
    }
    const base = lo - HALL.BURY;
    const u = {
      i: s.index,
      slot: s,
      type: s.type,
      k,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      cos: s.cos,
      sin: s.sin,
      hw: s.hw,
      hd: s.hd,
      h: s.h,
      base,
      top: base + s.h,
      // fully buried: the top under the lowest ground, with a little to spare
      hide: -(s.h + (hi - base) + 40),
      planeY: (cs[0].y + cs[1].y + cs[2].y + cs[3].y) / 4,
      nx: normal.x,
      ny: normal.y,
      nz: normal.z,
      reach: Math.sqrt(s.hw * s.hw + s.hd * s.hd) + HALL.CIRCUIT_REACH,
      state: STATE.IDLE,
      t: 0,
      lift: 0,
      plift: 0,
      col: 0, // collider lift now
      power: 0,
      ppower: 0,
      drop: false,
      sinkAfter: false,
      sinkFrom: 0,
      struck: false,
      circuit: null,
      shown: false,
      seed: this.rng(),
      surfaces: [],
      restY: null,
    };
    u.surfaces = this._addCollider(u);
    u.restY = new Float64Array(u.surfaces.length * 3);
    for (let j = 0; j < u.surfaces.length; j++) {
      const f = u.surfaces[j];
      u.restY[j * 3] = f.a[1];
      u.restY[j * 3 + 1] = f.b[1];
      u.restY[j * 3 + 2] = f.c[1];
    }
    this._setCollider(u, HALL.PARK);
    const T = this.types[s.type];
    if (T) T.attr.setX(k, u.seed);
    return u;
  }

  // A solid box at the rest pose: four walls down to the base and a flat top, wound to face
  // outward. Returns its surfaces (moved by _setCollider).
  _addCollider(u) {
    const col = this.collision;
    if (!col?.addTriangles) return [];
    const out = [];
    const P = (lx, y, lz) => [u.x + lx * u.cos + lz * u.sin, y, u.z - lx * u.sin + lz * u.cos];
    const quad = (a, b, c, d, nx, ny, nz) => {
      tri(out, a, b, c, nx, ny, nz);
      tri(out, a, c, d, nx, ny, nz);
    };
    const { hw, hd, base, top } = u;
    const c = u.cos;
    const s = u.sin;
    quad(P(-hw, top, -hd), P(hw, top, -hd), P(hw, top, hd), P(-hw, top, hd), 0, 1, 0);
    // walls: local +x, -x, +z, -z (their world normals)
    quad(P(hw, base, -hd), P(hw, top, -hd), P(hw, top, hd), P(hw, base, hd), c, 0, -s);
    quad(P(-hw, base, -hd), P(-hw, top, -hd), P(-hw, top, hd), P(-hw, base, hd), -c, 0, s);
    quad(P(-hw, base, hd), P(hw, base, hd), P(hw, top, hd), P(-hw, top, hd), s, 0, c);
    quad(P(-hw, base, -hd), P(hw, base, -hd), P(hw, top, -hd), P(-hw, top, -hd), -s, 0, -c);
    const list = col.surfaces;
    const first = list ? list.length : 0;
    col.addTriangles(out, { terrain: 'stone' });
    return list ? list.slice(first) : [];
  }

  // Moves unit u's collider to `lift` above its rest pose (the documented Surface fields a/b/c,
  // d, minY/maxY and, on walls, ys; the grid cells are x/z only, so they stay valid).
  _setCollider(u, lift) {
    if (lift === u.col && u.restY) return;
    u.col = lift;
    const list = u.surfaces;
    const rest = u.restY;
    if (!rest) return;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const ya = rest[i * 3] + lift;
      const yb = rest[i * 3 + 1] + lift;
      const yc = rest[i * 3 + 2] + lift;
      f.a[1] = ya;
      f.b[1] = yb;
      f.c[1] = yc;
      f.minY = ya < yb ? (ya < yc ? ya : yc) : yb < yc ? yb : yc;
      f.maxY = ya > yb ? (ya > yc ? ya : yc) : yb > yc ? yb : yc;
      f.d = -(f.normal.x * f.a[0] + f.normal.y * ya + f.normal.z * f.a[2]);
      const ys = f.ys;
      if (ys) {
        ys[0] = ya;
        ys[1] = yb;
        ys[2] = yc;
      }
    }
  }

  // ------------------------------------------------------------------ queries

  get outCount() {
    let n = 0;
    for (let i = 0; i < this.units.length; i++) if (this.units[i].state !== STATE.IDLE) n++;
    return n;
  }

  // 'idle' | 'drop' | 'rise' | 'on' | 'sink' of unit i.
  stateOf(i) {
    return ['idle', 'drop', 'rise', 'on', 'sink'][this.units[i].state];
  }

  // Is the point (x, z) within `margin` of unit u's footprint?
  near(u, x, z, margin) {
    const dx = x - u.x;
    const dz = z - u.z;
    let lx = dx * u.cos - dz * u.sin;
    let lz = dx * u.sin + dz * u.cos;
    lx = lx < 0 ? -lx : lx;
    lz = lz < 0 ? -lz : lz;
    const ox = lx - u.hw;
    const oz = lz - u.hd;
    if (ox <= 0 && oz <= 0) return true;
    const ex = ox > 0 ? ox : 0;
    const ez = oz > 0 ? oz : 0;
    return ex * ex + ez * ez < margin * margin;
  }

  // ------------------------------------------------------------------ mode

  // AI RACE mode on: the takeover starts after FIRST_DELAY; off: every unit sinks back.
  // (Switching off again, or with the mode already off, still sinks whatever is out.)
  setMode(on) {
    if (on && this.on) return;
    this.on = on;
    this.activeTicks = 0;
    this.nextAt = HALL.FIRST_DELAY;
    this.arrivals = 0;
    this.streak = 0;
    if (on) return;
    let nearest = null;
    let best = Infinity;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state === STATE.DROP) u.sinkAfter = true;
      else if (u.state === STATE.RISE || u.state === STATE.ON) this._startSink(u);
      else continue;
      const dx = u.x - this.hero.x;
      const dz = u.z - this.hero.z;
      if (dx * dx + dz * dz < best) {
        best = dx * dx + dz * dz;
        nearest = u;
      }
    }
    if (nearest && this.hero.valid) this.events.emit('sfx', { name: 'hall_rise', pos: { x: nearest.x, y: nearest.top, z: nearest.z }, pitch: 0.8 });
  }

  setDarkness(t) {
    this.uniforms.uHallDark.value = t;
  }

  // Everything gone at once (a new game): colliders parked, circuits cleared, mode off.
  clear() {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      u.state = STATE.IDLE;
      u.t = 0;
      u.sinkAfter = false;
      u.struck = false;
      u.power = u.ppower = 0;
      u.circuit = null;
      this._setCollider(u, HALL.PARK);
    }
    this.level?.clearCircuits?.();
    this.on = false;
    this.activeTicks = 0;
    this.nextAt = HALL.FIRST_DELAY;
    this.arrivals = 0;
    this.streak = 0;
    this.hero.valid = false;
    this._hideAll();
  }

  _hideAll() {
    for (const type of TYPE_ORDER) {
      const T = this.types[type];
      if (!T) continue;
      for (let i = 0; i < T.mesh.count; i++) T.mesh.setMatrixAt(i, ZERO);
      T.mesh.instanceMatrix.needsUpdate = true;
      T.mesh.visible = false;
      T.shown = 0;
    }
    for (let i = 0; i < this.units.length; i++) this.units[i].shown = false;
    if (this.markers) {
      this.markers.count = 0;
      this.markers.visible = false;
    }
  }

  // ------------------------------------------------------------------ tick

  // Gap (ticks) after the n-th arrival.
  gapAfter(n) {
    const g = HALL.EVERY - HALL.SPEEDUP * n;
    return g > HALL.EVERY_MIN ? g : HALL.EVERY_MIN;
  }

  update(player, tick, hold = false) {
    this.tick = tick;
    this.hold = hold;
    const p = player.pos;
    if (this.on && this.units.length) {
      this.activeTicks++;
      if (this.activeTicks >= this.nextAt) {
        const u = hold || heroAway(player) ? null : this._pickSlot(player);
        if (u !== null) {
          this._arrive(u, this._pickStyle());
          this.nextAt = this.activeTicks + this.gapAfter(this.arrivals);
          this.arrivals++;
        } else {
          this.nextAt = this.activeTicks + HALL.RETRY;
        }
      }
    }
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const s = u.state;
      if (s === STATE.IDLE) continue;
      u.t++;
      u.plift = u.lift;
      u.ppower = u.power;
      if (s === STATE.DROP) this._stepDrop(u, player);
      else if (s === STATE.RISE) this._stepRise(u, player);
      else if (s === STATE.ON) this._stepOn(u, player);
      else this._stepSink(u, player);
    }
    const h = this.hero;
    if (p) {
      const vx = player.vel ? player.vel.x : 0;
      const vz = player.vel ? player.vel.z : 0;
      h.x = p.x;
      h.y = p.y;
      h.z = p.z;
      h.vx = vx;
      h.vz = vz;
      h.valid = true;
    }
  }

  // The first free slot (in planned order) clear of the hero: where he is, where he was last
  // tick and where he is heading.
  _pickSlot(player) {
    const p = player.pos;
    const h = this.hero;
    const vx = player.vel ? player.vel.x : 0;
    const vz = player.vel ? player.vel.z : 0;
    const ax = p.x + vx * HALL.LOOKAHEAD;
    const az = p.z + vz * HALL.LOOKAHEAD;
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.state !== STATE.IDLE) continue;
      if (this.near(u, p.x, p.z, HALL.SAFE) || this.near(u, ax, az, HALL.SAFE)) continue;
      if (h.valid && this.near(u, h.x, h.z, HALL.SAFE)) continue;
      return u;
    }
    return null;
  }

  // 1 = drop, 2 = rise; the first arrival always drops.
  _pickStyle() {
    let style = this.arrivals === 0 ? 1 : this.rng() < HALL.DROP_CHANCE ? 1 : 2;
    if (style === this.lastStyle && this.streak >= HALL.MAX_STREAK) style = 3 - style;
    this.streak = style === this.lastStyle ? this.streak + 1 : 1;
    this.lastStyle = style;
    return style;
  }

  // Starts unit u's arrival: 1 = a drop from the sky, 2 = rising out of the ground.
  arrive(i, style = 1) {
    const u = this.units[i];
    if (!u || u.state !== STATE.IDLE) return false;
    this._arrive(u, style);
    return true;
  }

  _arrive(u, style) {
    u.t = 0;
    u.struck = false;
    u.sinkAfter = false;
    u.drop = style === 1;
    const pos = { x: u.x, y: u.planeY + 40, z: u.z };
    if (u.drop) {
      u.state = STATE.DROP;
      u.lift = u.plift = dropLift(0);
      u.power = u.ppower = 0.5;
      this.events.emit('sfx', { name: 'hall_warn', pos });
    } else {
      u.state = STATE.RISE;
      u.lift = u.plift = u.hide;
      u.power = u.ppower = 0;
      this._setCollider(u, this._riseLift(u, 1));
      this.onClaim?.(u);
      this.events.emit('sfx', { name: 'hall_rise', pos });
      this.events.emit('hallImpact', { pos, strength: 0.35, kind: 'rise' });
      this.fx?.dust?.(u.x, u.planeY, u.z, { hw: u.hw, hd: u.hd, yaw: u.yaw, radius: 160, count: 14, sparks: 0, debris: 6 });
    }
  }

  _riseLift(u, t) {
    return u.hide * (1 - smooth(t / HALL.RISE_TICKS));
  }

  _sinkLift(u, t) {
    return u.sinkFrom + (u.hide - u.sinkFrom) * smooth(t / HALL.SINK_TICKS);
  }

  _stepDrop(u, player) {
    const T = HALL.WARN_TICKS;
    u.lift = dropLift(u.t);
    // The falling unit sweeps through the hero's body?
    if (!u.struck && u.t < T - 1 && this._inBody(player, u, u.base + u.lift, u.top + u.plift, PLAYER_RADIUS)) this._strike(u, player);
    if (u.t === T - 1) {
      // The collider lands a tick ahead of the picture (the next physics step is drawn with
      // the unit down): whoever is under it now is hit and pushed out.
      this._setCollider(u, 0);
      if (this._inBody(player, u, u.base, u.top + dropLift(T - 2), PLAYER_RADIUS)) {
        if (!u.struck) this._strike(u, player);
        else this._eject(u, player);
      }
    }
    if (u.t >= T) this._impact(u);
  }

  // Hero's body (feet .. feet + PLAYER_HEIGHT, `margin` around his axis) overlapping the unit's
  // footprint between heights y0 and y1?
  _inBody(player, u, y0, y1, margin) {
    const p = player.pos;
    if (!p) return false;
    if (p.y + PLAYER_HEIGHT <= y0 || p.y >= y1) return false;
    return this.near(u, p.x, p.z, margin);
  }

  // A drop hits the hero: 2 wedges (no damage while a dialog holds him or he is not in play)
  // and out of the footprint.
  _strike(u, player) {
    u.struck = true;
    this.hits++;
    this._eject(u, player);
    const a = player.action;
    if (!this.hold && a !== 'death' && a !== 'spawn') player.takeDamage?.(HALL.DAMAGE, { x: u.x, y: u.base + u.h * 0.5, z: u.z });
  }

  // Moves the hero just outside the nearest side of unit u's footprint (the first side with
  // open ground there), keeping his height if he is in the air.
  _eject(u, player) {
    const p = player.pos;
    const dx = p.x - u.x;
    const dz = p.z - u.z;
    const lx = dx * u.cos - dz * u.sin;
    const lz = dx * u.sin + dz * u.cos;
    const m = PLAYER_RADIUS + HALL.EJECT;
    const cl = (v, a) => (v < -a ? -a : v > a ? a : v);
    const sides = [
      { d: u.hw - lx, x: u.hw + m, z: cl(lz, u.hd) },
      { d: u.hw + lx, x: -u.hw - m, z: cl(lz, u.hd) },
      { d: u.hd - lz, x: cl(lx, u.hw), z: u.hd + m },
      { d: u.hd + lz, x: cl(lx, u.hw), z: -u.hd - m },
    ].sort((a, b) => a.d - b.d);
    const col = this.collision;
    for (const s of sides) {
      const x = u.x + s.x * u.cos + s.z * u.sin;
      const z = u.z - s.x * u.sin + s.z * u.cos;
      const g = this.groundAt ? this.groundAt(x, z) : p.y;
      const f = col.findFloor(x, g + 100, z);
      if (!f.surface) continue;
      if (col.waterLevelAt && col.waterLevelAt(x, z) > f.y) continue;
      if (col.findWalls(x, f.y, z, 60, PLAYER_RADIUS).walls.length) continue;
      if (col.findWalls(x, f.y, z, 140, PLAYER_RADIUS).walls.length) continue;
      const y = p.y > f.y && p.y < u.top ? p.y : f.y;
      this._place(player, x, y, z);
      return true;
    }
    // Nowhere open (never seen in the level): the nearest side all the same, on the ground.
    const s = sides[0];
    const x = u.x + s.x * u.cos + s.z * u.sin;
    const z = u.z - s.x * u.sin + s.z * u.cos;
    const g = this.groundAt ? this.groundAt(x, z) : p.y;
    const f = col.findFloor(x, g + 100, z);
    this._place(player, x, f.surface ? f.y : g, z);
    return false;
  }

  _place(player, x, y, z) {
    const p = player.pos;
    if (typeof player.teleport === 'function') player.teleport(x, y, z);
    else {
      p.x = x;
      p.y = y;
      p.z = z;
    }
  }

  _impact(u) {
    u.state = STATE.ON;
    u.t = 0;
    u.lift = 0;
    u.power = 0.15;
    const y = u.planeY;
    const pos = { x: u.x, y, z: u.z };
    this.onClaim?.(u);
    this.events.emit('sfx', { name: 'hall_impact', pos });
    this.events.emit('hallImpact', { pos, strength: 1, kind: 'drop' });
    this.fx?.dust?.(u.x, y, u.z, { hw: u.hw, hd: u.hd, yaw: u.yaw, radius: 380, count: 40, sparks: 36, debris: 16 });
    this._clods(u, 10, 1.3);
    this._landed(u);
  }

  // Arrived (landed or fully risen): the ground around it starts turning into circuitry.
  _landed(u) {
    if (u.circuit === null) {
      const id = this.level?.addCircuit?.(u.x, u.z, u.reach, { grow: HALL.CIRCUIT_GROW });
      u.circuit = id ?? null;
    }
  }

  _stepRise(u, player) {
    const T = HALL.RISE_TICKS;
    u.lift = this._riseLift(u, u.t);
    u.power = smooth((u.t - T * 0.3) / (T * 0.7));
    const lead = u.t < T ? this._riseLift(u, u.t + 1) : 0;
    this._setCollider(u, lead);
    this._rescue(u, player, true);
    if (u.t % HALL.CLODS_EVERY === 0 && u.t < T - 6) this._clods(u, 3, 0.9);
    if (u.t >= T) {
      u.state = STATE.ON;
      u.t = 0;
      u.lift = 0;
      this._landed(u);
    }
  }

  // Never shut inside: a hero whose feet are inside unit u's box (the collider where it is
  // now), further below its top than he can step up, is lifted onto the top when he was
  // climbing onto it (or is just under it in the air), else pushed out of its nearest side.
  // While it moves (`moving`), a hero hanging from its edge or climbing over it is shaken off:
  // the ledge he holds would slide away from under his hands.
  _rescue(u, player, moving) {
    const p = player.pos;
    if (!p) return;
    const a = player.action;
    const ledge = a === 'ledge_hang' || a === 'ledge_climb';
    if (moving && ledge && this.near(u, p.x, p.z, PLAYER_RADIUS + 40)) {
      this._shakeOff(u, player);
      return;
    }
    const top = u.top + u.col;
    if (p.y >= top - HALL.STEP_UP || p.y + PLAYER_HEIGHT <= u.base + u.col) return;
    if (!this.insideBy(u, p.x, p.z, HALL.INSET)) return;
    if (ledge || (top - p.y < HALL.LIFT_REACH && !moving)) this._liftOnto(u, player);
    else this._eject(u, player);
  }

  // Is (x, z) inside unit u's footprint by at least `inset`?
  insideBy(u, x, z, inset) {
    const dx = x - u.x;
    const dz = z - u.z;
    const lx = dx * u.cos - dz * u.sin;
    const lz = dx * u.sin + dz * u.cos;
    return lx < u.hw - inset && lx > inset - u.hw && lz < u.hd - inset && lz > inset - u.hd;
  }

  // Puts the hero on unit u's top (at his spot, kept a body's width in from its edges).
  _liftOnto(u, player) {
    const p = player.pos;
    const dx = p.x - u.x;
    const dz = p.z - u.z;
    const m = PLAYER_RADIUS + 10;
    const cl = (v, e) => (v < m - e ? m - e : v > e - m ? e - m : v);
    const lx = cl(dx * u.cos - dz * u.sin, u.hw);
    const lz = cl(dx * u.sin + dz * u.cos, u.hd);
    const x = u.x + lx * u.cos + lz * u.sin;
    const z = u.z - lx * u.sin + lz * u.cos;
    this._place(player, x, u.top + u.col, z);
    if (typeof player.setAction === 'function' && player.action !== 'death') player.setAction('idle');
  }

  // Lets go of a moving unit's edge: nudged off its wall into a fall (and not grabbing it again
  // for a moment).
  _shakeOff(u, player) {
    const p = player.pos;
    const dx = p.x - u.x;
    const dz = p.z - u.z;
    const lx = dx * u.cos - dz * u.sin;
    const lz = dx * u.sin + dz * u.cos;
    // outward normal of the nearest side (local), to world
    const onX = u.hw - (lx < 0 ? -lx : lx) < u.hd - (lz < 0 ? -lz : lz);
    const nx = onX ? (lx < 0 ? -1 : 1) : 0;
    const nz = onX ? 0 : lz < 0 ? -1 : 1;
    p.x += (nx * u.cos + nz * u.sin) * 15;
    p.z += (-nx * u.sin + nz * u.cos) * 15;
    if (typeof player.grabCooldownUntil === 'number' && typeof player.tick === 'number') player.grabCooldownUntil = player.tick + 20;
    if (typeof player.setAction === 'function') player.setAction('freefall');
  }

  _stepOn(u, player) {
    // boot flicker, then steady
    const b = HALL.BOOT_TICKS;
    if (u.t <= b) {
      const flick = (u.t * 7 + ((u.seed * 13) | 0)) % 5 === 0 ? 0.25 : 1;
      u.power = (u.drop ? 0.15 + 0.85 * smooth(u.t / b) : 1) * flick;
    } else u.power = 1;
    u.lift = u.drop && u.t < HALL.SETTLE_TICKS ? HALL.SETTLE * Math.sin((Math.PI * u.t) / HALL.SETTLE_TICKS) * (1 - u.t / HALL.SETTLE_TICKS) : 0;
    if (u.sinkAfter && u.t >= HALL.SINK_DELAY) this._startSink(u);
    else this._rescue(u, player, false);
  }

  _startSink(u) {
    u.state = STATE.SINK;
    u.t = 0;
    u.sinkAfter = false;
    u.sinkFrom = u.col === HALL.PARK ? u.lift : u.col;
    if (u.circuit !== null) {
      this.level?.fadeCircuit?.(u.circuit, HALL.CIRCUIT_FADE);
      u.circuit = null;
    }
  }

  _stepSink(u, player) {
    const T = HALL.SINK_TICKS;
    u.lift = this._sinkLift(u, u.t);
    const k = 1 - u.t / (T * 0.6);
    u.power = k > 0 ? k * ((u.t & 3) === 1 ? 0.5 : 1) : 0;
    if (u.t === 1 || u.t % 6 === 0) this._clods(u, 2, 0.7);
    if (u.t >= T) {
      u.state = STATE.IDLE;
      u.t = 0;
      u.power = 0;
      this._setCollider(u, HALL.PARK);
      return;
    }
    this._setCollider(u, this._sinkLift(u, u.t + 1));
    this._rescue(u, player, true);
  }

  // Dirt thrown up from `n` random spots along the footprint's edge.
  _clods(u, n, speed) {
    const sp = this.sparkles;
    if (!sp) return;
    const t0 = this.tick * FRAME_DT;
    for (let k = 0; k < n; k++) {
      const a = this.rng() * 4;
      const e = a - Math.floor(a);
      const side = a | 0;
      const lx = side === 0 ? u.hw : side === 1 ? -u.hw : (e * 2 - 1) * u.hw;
      const lz = side === 2 ? u.hd : side === 3 ? -u.hd : (e * 2 - 1) * u.hd;
      _pos.x = u.x + lx * u.cos + lz * u.sin;
      _pos.z = u.z - lx * u.sin + lz * u.cos;
      _pos.y = u.planeY;
      sp.clods(_pos, t0, TINT.dirt, 3, speed);
    }
  }

  // ------------------------------------------------------------------ render

  animate(alpha, clock) {
    this.uniforms.uHallTime.value = clock;
    const units = this.units;
    let marks = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const T = this.types[u.type];
      if (u.state === STATE.IDLE) {
        if (u.shown) {
          T.mesh.setMatrixAt(u.k, ZERO);
          T.dirty = true;
          T.shown--;
          u.shown = false;
        }
        continue;
      }
      const lift = u.plift + (u.lift - u.plift) * alpha;
      _qy.setFromAxisAngle(UP, u.yaw);
      _m.compose(_p.set(u.x, u.base + lift, u.z), _qy, _s.set(1, 1, 1));
      T.mesh.setMatrixAt(u.k, _m);
      T.attr.setY(u.k, u.ppower + (u.power - u.ppower) * alpha);
      T.dirty = true;
      if (!u.shown) {
        u.shown = true;
        T.shown++;
      }
      if (u.state === STATE.DROP && marks < HALL.MARKERS && this.markers !== null) {
        const prog = (u.t - 1 + alpha) / HALL.WARN_TICKS;
        _n.set(u.nx, u.ny, u.nz);
        _q.setFromUnitVectors(UP, _n).multiply(_qy);
        _m.compose(_p.set(u.x, u.planeY + 6, u.z), _q, _s.set(2 * (u.hw + MARKER.MARGIN), 1, 2 * (u.hd + MARKER.MARGIN)));
        this.markers.setMatrixAt(marks, _m);
        const fade = u.t < 6 ? u.t / 6 : 1;
        this.markAttr.setXYZW(marks, prog < 0 ? 0 : prog > 1 ? 1 : prog, u.hw, u.hd, fade);
        marks++;
      }
    }
    for (let j = 0; j < TYPE_ORDER.length; j++) {
      const T = this.types[TYPE_ORDER[j]];
      if (!T || !T.dirty) continue;
      T.dirty = false;
      T.mesh.instanceMatrix.needsUpdate = true;
      T.attr.needsUpdate = true;
      T.mesh.visible = T.shown > 0;
    }
    const mk = this.markers;
    if (mk !== null && (marks > 0 || mk.count > 0)) {
      mk.count = marks;
      mk.visible = marks > 0;
      mk.instanceMatrix.needsUpdate = true;
      this.markAttr.needsUpdate = true;
    }
  }
}

// The hero is not in play (dying, respawning): no new arrivals.
function heroAway(player) {
  const a = player.action;
  return a === 'death' || a === 'spawn';
}
