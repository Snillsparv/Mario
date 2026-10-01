// Builds an area other than the grounds (world/areas.js AREA_DEFS: the Great Hall, ...) into
// the one shared scene: its own root group, its own collision world, and its layout in world
// coordinates for the objects and the player. The grounds themselves are built by level.js and
// wrapped by areas.js groundsArea().
//
//   buildArea(scene, def) -> Area
//   shiftPositions(positions, origin) -> a new flat [x, y, z, ...] array moved by origin
//
// Areas are authored in local coordinates (their layout and builders never see world ones)
// and placed at def.origin (world = local + origin), far from the grounds and from each other,
// so nothing that still reads the grounds' layout (ambience, shake falloff, the AI RACE look-up
// zone) reaches them. Each builder follows the WorldPart contract (level.js); its colliders
// must be { positions, terrain?, surface? } (SolidBuilder.colliders()): an { object3D }
// collider is refused, as it would be added where the builder left it rather than moved.
//
// Area = {
//   name, def,
//   root,                  // THREE.Group 'area-<name>' at the origin, hidden until entered
//   collision,             // its own CollisionWorld (water from def.waterLevelAt)
//   parts,                 // the builders' WorldParts
//   update(time, camera),  // per render frame, while it is the current area
//   reset(),               // a new game (nothing to undo yet: the pickups live in its objects)
//   setVisible(on),
//   entries,               // { id: { x, y, z, yaw, drop?, camYaw?, walkIn?, sfx? } } (world)
//   respawn,               // the entry def.respawn names, with its drop: player.setWorld's spawn
//   signs,                 // layout.SIGNS (world), for player.setWorld
//   groundAt(x, z),        // the floor under (x, z), probed from def.probeY (under the ceiling)
//   objectsLayout,         // what an ObjectManager reads: COINS, STAR, ONE_UP, DOORS, ... (world)
//   waterFn(x, z),         // the water surface (collision.waterLevelAt): the renderer's water
//   objects,               // its ObjectManager, once core/AreaSwitch.js has made it (else null);
//                          // setVisible() shows and hides its group with the root
// }

import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { NO_WATER } from '../core/constants.js';

// Layout lists and points the objects read (each item's x, y, z are shifted).
const POINT_LISTS = ['COINS', 'RED_COINS', 'SIGNS', 'BUTTERFLY_SPOTS', 'BIRD_CIRCLES'];
const POINTS = ['STAR', 'ONE_UP'];

// A copy of `p` moved by origin (only the coordinates it has; a door's floorY with its y).
function shifted(p, o) {
  const q = { ...p };
  if (Number.isFinite(p.x)) q.x = p.x + o.x;
  if (Number.isFinite(p.y)) q.y = p.y + o.y;
  if (Number.isFinite(p.z)) q.z = p.z + o.z;
  if (Number.isFinite(p.floorY)) q.floorY = p.floorY + o.y;
  return q;
}

// The spawn player.setWorld keeps: the entry's point and facing, and the drop-in's height.
function respawnPoint(e, drop) {
  return { x: e.x, y: e.y, z: e.z, yaw: e.yaw ?? 0, drop };
}

export function shiftPositions(positions, o) {
  const out = new Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i] + o.x;
    out[i + 1] = positions[i + 1] + o.y;
    out[i + 2] = positions[i + 2] + o.z;
  }
  return out;
}

export function buildArea(scene, def) {
  const o = def.origin;
  const layout = def.layout;
  const root = new THREE.Group();
  root.name = `area-${def.name}`;
  root.position.set(o.x, o.y, o.z);
  root.visible = false;
  scene.add(root);

  const collision = new CollisionWorld();
  const parts = [];
  for (const build of def.builders) {
    const part = build(layout);
    parts.push(part);
    if (part.object3D) root.add(part.object3D);
    for (const c of part.colliders ?? []) {
      if (!c.positions || c.object3D) throw new Error(`area ${def.name}: colliders must be { positions } (got an object3D)`);
      collision.addCollider({ ...c, positions: shiftPositions(c.positions, o) });
    }
    for (const p of part.poles ?? []) collision.addPole({ ...p, x: p.x + o.x, z: p.z + o.z, y0: p.y0 + o.y, y1: p.y1 + o.y });
  }
  for (const p of layout.POLES ?? []) collision.addPole({ ...p, x: p.x + o.x, z: p.z + o.z, y0: p.y0 + o.y, y1: p.y1 + o.y });
  const water = def.waterLevelAt;
  collision.setWaterLevelFn((x, z) => {
    const h = water(x - o.x, z - o.z);
    return h === NO_WATER ? NO_WATER : h + o.y;
  });
  collision.finalize();

  const probeY = def.probeY + o.y;
  const groundAt = (x, z) => collision.findFloor(x, probeY, z).y;
  const entries = {};
  for (const id of Object.keys(def.entries)) entries[id] = shifted(def.entries[id], o);
  const objectsLayout = { groundHeight: groundAt, DOORS: (layout.DOORS ?? []).map((d) => shifted(d, o)) };
  for (const key of POINT_LISTS) if (layout[key]) objectsLayout[key] = layout[key].map((p) => shifted(p, o));
  for (const key of POINTS) if (layout[key]) objectsLayout[key] = shifted(layout[key], o);

  return {
    name: def.name,
    def,
    root,
    collision,
    parts,
    entries,
    respawn: respawnPoint(entries[def.respawn.entry], def.respawn.drop),
    signs: objectsLayout.SIGNS ?? [],
    groundAt,
    objectsLayout,
    waterFn: (x, z) => collision.waterLevelAt(x, z),
    objects: null,
    update(time, camera) {
      for (const p of parts) p.update?.(time, camera);
    },
    reset() {
      for (const p of parts) p.reset?.();
    },
    setVisible(on) {
      root.visible = !!on;
      if (this.objects) this.objects.group.visible = !!on;
    },
  };
}
