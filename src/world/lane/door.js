// The dad's black front door (lane/layout.js DAD.door), written into the course's kit
// (lane/build.js; kit.paint, render's builder in the classic look): its dark frame and threshold
// in the wall's opening (houses.js leaves it; its foot `sill` over the floor, on the landing in
// front: layout.LANDING), the lantern beyond the side light, the dark vestibule behind it, and
// the leaf itself, built apart to swing.
//
//   frontDoor(kit, layout) -> leaf    // { builder, hinge, turn }: the leaf's own GeoBuilder (in
//                                     // the course's frame, shut), the point it turns about
//                                     // and its way round +y (into the house)
//   doorLeaf(leaf, material, bake) -> { mesh, setOpen(t) }   // its mesh ('lane-door', baked
//                                     // where it stands shut, then set about its hinge);
//                                     // setOpen: 0 shut .. 1 standing open, eased
//
// One leaf of near-black vertical boards (grooves between them, a bronze kick plate at its foot,
// a silver lever on its west side; no glass) hinged on its left (seen from the path: its east
// side), swinging in through VESTIBULE.swing onto a dark little hall (its sides, ceiling, back and floor facing in, darker the deeper in), deep
// enough for the leaf. The house's collider is solid behind it: the door is a way out of the
// course (objects/Door.js), never a room. setOpen runs every frame while the door moves: no
// allocation.

import * as THREE from 'three';
import { GeoBuilder, localBoxPolys, wallFrame } from '../castle/geom.js';
import { wallLamp } from './houses.js';

const TINT = { leaf: 0x1c1d24, groove: 0x0c0c0e, frame: 0x2a2a2c, realFrame: 0x1a1b1d, hall: 0x2a2420, handle: 0xb4b6b6, kick: 0x6a4a32, threshold: 0x9a968e };
const FRAME = { w: 16, out: 6 };
const VESTIBULE = { depth: 170, fade: 0.55, swing: 1.35 }; // swing: radians, standing open
const LEAF = { thick: 5 };
const BOARDS = 7; // (the leaf's boards)
// The lantern: west of the side light (u along the face from the door's middle), its foot v up.
const LAMP = { u: 230, v: 300 };

export function frontDoor(kit, { DAD }) {
  const { paint } = kit;
  const D = DAD.door;
  const hw = D.w / 2;
  const v0 = D.sill ?? 0;
  // The door's wall frame: on the house's front face at its middle, looking out at the street.
  const f = wallFrame([D.x, DAD.floor, D.faceZ], [0, 0, -1]);
  // The dark frame round the opening and the grey threshold (where the realistic look draws the
  // house itself the frame is black, and the glazed side light beside it in the same frame:
  // world/lane/real/house.js draws that); the lantern beyond the side light (LAMP: along the
  // face from the door's middle, up).
  const real = kit.drawn('chain') !== kit;
  paint.color(real ? TINT.realFrame : TINT.frame);
  paint.solid(localBoxPolys(f, -hw - FRAME.w, -hw, v0, D.h, -4, FRAME.out));
  paint.solid(localBoxPolys(f, hw, hw + FRAME.w, v0, D.h, -4, FRAME.out));
  paint.solid(localBoxPolys(f, -hw - FRAME.w, hw + FRAME.w, D.h, D.h + FRAME.w, -4, FRAME.out));
  paint.color(TINT.threshold);
  paint.poly([f.at(-hw, v0 + 1, FRAME.out), f.at(hw, v0 + 1, FRAME.out), f.at(hw, v0 + 1, -LEAF.thick), f.at(-hw, v0 + 1, -LEAF.thick)], { facing: [0, 1, 0] });
  wallLamp(paint, f, LAMP.u, LAMP.v);
  vestibule(paint, f, hw, D.h, v0);
  // The leaf: near-black boards (grooves between them), a bronze kick plate at its foot, a silver
  // lever and lock on its west side; its back and edges for when it stands open.
  const builder = new GeoBuilder(paint.repeat);
  builder.color(TINT.leaf);
  builder.solid(localBoxPolys(f, -hw, hw, v0, D.h, -LEAF.thick, 0), { faceShade: (n) => (n[2] > 0.5 ? 0.6 : 1) });
  builder.color(TINT.groove);
  for (let k = 1; k < BOARDS; k++) {
    const u = -hw + (D.w * k) / BOARDS;
    builder.panel(f, [[u - 1, v0 + 26], [u + 1, v0 + 26], [u + 1, D.h - 2], [u - 1, D.h - 2]], 0.6);
  }
  builder.color(TINT.kick);
  builder.panel(f, [[-hw + 2, v0 + 2], [hw - 2, v0 + 2], [hw - 2, v0 + 26], [-hw + 2, v0 + 26]], 0.8);
  builder.color(TINT.handle);
  builder.solid(localBoxPolys(f, hw - 34, hw - 10, v0 + 150, v0 + 156, 0, 9));
  builder.solid(localBoxPolys(f, hw - 16, hw - 10, v0 + 128, v0 + 160, 0, 3));
  // Hinged on its left seen from the path (u -hw), turning in (+z) about +y.
  return { builder, hinge: f.at(-hw, 0, 0), turn: 1 };
}

export function doorLeaf({ builder, hinge, turn }, material, bake) {
  const geo = bake(builder.toGeometry());
  geo.translate(-hinge[0], -hinge[1], -hinge[2]);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'lane-door';
  mesh.position.set(hinge[0], hinge[1], hinge[2]);
  return {
    mesh,
    setOpen(t) {
      const k = t > 0 ? (t < 1 ? t * t * (3 - 2 * t) : 1) : 0;
      mesh.rotation.y = turn * VESTIBULE.swing * k;
    },
  };
}

// The dark hall behind the leaf (seen only while it stands open): sides, ceiling, back and
// floor facing in, darker the deeper in.
function vestibule(b, f, hw, height, v0 = 0) {
  const o = f.at(0, 0, 0);
  const out = f.out;
  const back = -VESTIBULE.depth;
  b.color(TINT.hall);
  b.shade = (x, y, z) => 1 - (VESTIBULE.fade * ((o[0] - x) * out[0] + (o[2] - z) * out[2])) / VESTIBULE.depth;
  const quad = (a, c, d, e, facing) => b.poly([f.at(...a), f.at(...c), f.at(...d), f.at(...e)], { facing });
  quad([-hw, v0, -1], [-hw, v0, back], [-hw, height, back], [-hw, height, -1], f.dir(1, 0, 0));
  quad([hw, v0, -1], [hw, v0, back], [hw, height, back], [hw, height, -1], f.dir(-1, 0, 0));
  quad([-hw, height, -1], [hw, height, -1], [hw, height, back], [-hw, height, back], [0, -1, 0]);
  quad([-hw, v0 + 1, -1], [hw, v0 + 1, -1], [hw, v0 + 1, back], [-hw, v0 + 1, back], [0, 1, 0]);
  quad([-hw, v0, back], [hw, v0, back], [hw, height, back], [-hw, height, back], out);
  b.shade = null;
}
