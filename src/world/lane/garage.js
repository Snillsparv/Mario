// Sparrow Lane's store room, behind the garage doors (layout.GARAGE: its walls, its leaves and
// its things' colliders, which the game's main chunk builds): what only the room's insides need,
// shared by the lane's lazy chunk (objects/laneBoss/garageRoom.js draws the things in the
// classic look, LaneGarage.js keeps the 1-up and the room camera) and the realistic look's worker
// (world/lane/real/garage.js draws them finer). Never imported by main (tests/net-relay-
// build.test.js: none of it in the game's bundle).
//
//   ROOM.props     the kinds of layout.GARAGE.props, in its order (each drawn inside its box)
//   ROOM.tube      the fluorescent tube under the slab: x0..x1 at z, its underside at y
//   ROOM.oneUp     the 1-up's place over the workbench (local)
//   ROOM.middle    the room's middle on the floor (x, z): the room camera circles it
//   ROOM.light     the room's painted light (roomLight): a dim base, the tube's pool, the
//                  daylight through the doorways
//   roomLight(x, y, z) -> 0.12 .. 1   the light at a point in the room (both looks paint it into
//                  their vertex tints: no light object, see docs/ARCHITECTURE.md)

export const ROOM = {
  props: ['bench', 'shelves', 'tyres', 'boxes', 'mower', 'bike', 'tools'],
  tube: { x0: 1950, x1: 2250, z: 2300, y: 331 },
  oneUp: { x: 2090, y: 212, z: 2585 },
  middle: { x: 2050, z: 2300 },
  light: { base: 0.12, tube: 0.6, reach: 220, door: 0.28, from: 1970, depth: 450, lintel: 302 },
};

// base + tube * 1 / (1 + (d / reach)^2) (d: the distance to the tube) + door * (1 - the depth
// into the room / depth)^2 (less over the lintels' height).
export function roomLight(x, y, z) {
  const { tube: T, light: L } = ROOM;
  const dx = x < T.x0 ? T.x0 - x : x > T.x1 ? x - T.x1 : 0;
  const d2 = (dx * dx + (y - T.y) * (y - T.y) + (z - T.z) * (z - T.z)) / (L.reach * L.reach);
  const k = 1 - Math.min(1, Math.max(0, (z - L.from) / L.depth));
  return L.base + L.tube / (1 + d2) + L.door * k * k * (y < L.lintel ? 1 : 0.6);
}
