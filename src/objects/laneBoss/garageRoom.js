// The store room's things in the classic look (LaneGarage.js shows them once a door breaks): a
// workbench under a tool board, steel shelves of boxes and tins, winter tyres, moving boxes, a
// lawn mower, a bike leaning on the wall, garden tools in a corner and the fluorescent tube, each
// inside its box of layout.GARAGE.props (world/lane/garage.js ROOM names them), drawn N64-plain
// in one mesh (lane-garage-room) in lane-render's material, baked with the lane's light and
// darkened by the room's painted light (roomLight: dim, brighter under the tube and toward the
// doorways). The realistic look's are the worker's (world/lane/real/garage.js). No brand, label,
// letter or number on anything.
//
//   classicRoom(part, G, ground) -> mesh   part: the lane's classic part (its group gets the
//                                          mesh, hidden), G: layout.GARAGE, ground: its floor
//
// BOXES: each kind's boxes [tint, x0, x1, y0, y1, z0, z1] in its prop's frame (from its box's
// x0, z0 corner; y over the floor), the tint an index into TINTS.

import * as THREE from 'three';
import { GeoBuilder, boxPolys, beamPolys, prismPolys } from '../../world/castle/geom.js';
import { bakeLighting } from '../../render/materials.js';
import { ROOM, roomLight } from '../../world/lane/garage.js';

// Wood, dark wood, steel, pegboard, red, black, grey, cardboard, white, terracotta, rubber, rim,
// pale cardboard, mower green, bike blue, handle wood, tape.
const TINTS = [0x9a7a52, 0x5a4a3a, 0x55585c, 0x8a7a5e, 0xa83024, 0x2a2a2a, 0x80848a, 0xb08850, 0xe8e4dc, 0xb0603a, 0x1c1c1e, 0x8a8c90, 0xb8955e, 0x2f7a3a, 0x2a5aa8, 0x9a7040, 0xd8c8a0];
const BOXES = {
  // The bench: its top, its legs (a frame at each end), low shelf and vice; the tool board over
  // it with a hammer, a saw, a spanner.
  bench: [[0, 0, 200, 135, 150, 0, 70], [1, 4, 12, 0, 135, 4, 66], [1, 188, 196, 0, 135, 4, 66], [1, 8, 192, 40, 46, 8, 62], [2, 166, 194, 150, 172, 2, 26], [3, 10, 190, 160, 290, 66, 70], [4, 30, 36, 190, 250, 62, 66], [5, 22, 44, 245, 258, 61, 66], [11, 60, 110, 200, 240, 64, 66], [2, 145, 150, 195, 255, 63, 66]],
  // The shelving (uprights, four shelves) and what stands on it.
  shelves: [[6, 0, 6, 0, 230, 0, 55], [6, 244, 250, 0, 230, 0, 55], [6, 0, 250, 10, 15, 0, 55], [6, 0, 250, 85, 90, 0, 55], [6, 0, 250, 160, 165, 0, 55], [6, 0, 250, 225, 230, 0, 55], [7, 10, 70, 15, 60, 6, 49], [4, 90, 125, 15, 75, 12, 45], [4, 140, 200, 90, 120, 14, 43], [12, 15, 95, 165, 215, 6, 49]],
  tyres: [],
  // Two moving boxes stacked (a tape strip).
  boxes: [[12, 0, 80, 0, 60, 0, 75], [7, 6, 74, 60, 110, 6, 66], [16, 34, 46, 110, 111, 6, 66]],
  // The mower's deck, wheels and grass bag.
  mower: [[13, 10, 120, 12, 47, 20, 110], [5, 6, 14, 0, 22, 20, 40], [5, 116, 124, 0, 22, 20, 40], [5, 6, 14, 0, 22, 88, 108], [5, 116, 124, 0, 22, 88, 108], [5, 25, 105, 20, 75, 110, 160]],
  bike: [[5, 15, 27, 112, 118, 90, 120]],
  // The broom's head, the rake's and the spade's.
  tools: [[4, 10, 26, 0, 32, 5, 30], [2, 2, 24, 0, 30, 2, 8], [11, 2, 22, 0, 28, 19, 31]],
};
// Thin round things as beams [tint, from, to] (the prop's frame): the mower's handle, the bike's
// frame and bars, the tools' handles.
const BEAMS = {
  mower: [[2, [20, 45, 110], [20, 140, 170]], [2, [110, 45, 110], [110, 140, 170]], [2, [20, 140, 167], [110, 140, 167]]],
  bike: [[14, [23, 48, 55], [21, 100, 130]], [14, [21, 100, 130], [18, 105, 175]], [14, [18, 105, 175], [17, 48, 205]], [14, [23, 48, 55], [21, 100, 105]], [14, [21, 100, 105], [18, 105, 175]], [11, [8, 132, 173], [26, 132, 173]]],
  tools: [[15, [4, 0, 6], [12, 175, 4]], [15, [8, 20, 29], [14, 165, 25]], [15, [20, 30, 17], [26, 170, 21]]],
};

export function classicRoom(part, G, ground) {
  const b = new GeoBuilder(300);
  b.shade = roomLight;
  G.props.forEach(([x0, x1, z0, z1], i) => {
    const kind = ROOM.props[i];
    const at = (p) => [x0 + p[0], ground + p[1], z0 + p[2]];
    for (const [t, a, c, y0, y1, d, e] of BOXES[kind]) b.color(TINTS[t]).solid(boxPolys(x0 + a, x0 + c, ground + y0, ground + y1, z0 + d, z0 + e));
    for (const [t, p, q] of BEAMS[kind] ?? []) b.color(TINTS[t]).solid(beamPolys(at(p), at(q), [p[2] === q[2] ? 0 : 1, 0, p[2] === q[2] ? 1 : 0], 5, 5));
    const prism = (t, x, z, r, y0, y1, n) => b.color(TINTS[t]).solid(prismPolys(x, z, r, n, ground + y0, ground + y1, { bottom: true }));
    if (kind === 'shelves') for (let k = 0; k < 5; k++) prism(8, x0 + 22 + k * 22, z0 + 27, 9, 90, 115, 6);
    if (kind === 'tyres') for (let k = 0; k < 4; k++) prism(10, (x0 + x1) / 2, (z0 + z1) / 2, 38, k * 25, k * 25 + 23, 8);
    if (kind === 'bike') {
      // Its wheels upright along the wall: rings of beams.
      for (const [x, z] of [[x0 + 23, z0 + 55], [x0 + 17, z1 - 55]]) {
        for (let k = 0; k < 8; k++) {
          const [s, c] = [(k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2];
          b.color(TINTS[5]).solid(beamPolys([x, ground + 48 + 44 * Math.cos(s), z + 44 * Math.sin(s)], [x, ground + 48 + 44 * Math.cos(c), z + 44 * Math.sin(c)], [1, 0, 0], 6, 8));
        }
      }
    }
  });
  // The fluorescent tube under the slab: its white housing, its bright diffuser.
  const T = ROOM.tube;
  b.color(TINTS[8]).solid(boxPolys(T.x0, T.x1, T.y + 3, G.under, T.z - 7, T.z + 7));
  b.shade = null;
  b.color(0xffffff).solid(boxPolys(T.x0 + 5, T.x1 - 5, T.y, T.y + 3, T.z - 4, T.z + 4), { shade: 1.3 });
  const mesh = new THREE.Mesh(bakeLighting(b.toGeometry(), part.light), part.object3D.getObjectByName('lane-render').material);
  mesh.name = 'lane-garage-room';
  part.object3D.add(mesh);
  return mesh;
}
