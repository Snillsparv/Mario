// The dad's black front door (lane/layout.js DAD.door), written into the course's kit
// (lane/build.js; kit.paint, render's builder in the classic look): its white frame and
// threshold in the wall's opening (houses.js leaves it), a wall lamp beside it, the dark
// vestibule behind it, and the leaf itself, built apart to swing.
//
//   frontDoor(kit, layout) -> leaf    // { builder, hinge, turn }: the leaf's own GeoBuilder (in
//                                     // the course's frame, shut), the point it turns about
//                                     // and its way round +y (into the house)
//   doorLeaf(leaf, material, bake) -> { mesh, setOpen(t) }   // its mesh ('lane-door', baked
//                                     // where it stands shut, then set about its hinge);
//                                     // setOpen: 0 shut .. 1 standing open, eased
//
// One leaf hinged on its left (seen from the path), swinging in through VESTIBULE.swing onto a
// dark little hall (its sides, ceiling, back and floor facing in, darker the deeper in), deep
// enough for the leaf. The house's collider is solid behind it: the door is a way out of the
// course (objects/Door.js), never a room. setOpen runs every frame while the door moves: no
// allocation.

import * as THREE from 'three';
import { GeoBuilder, localBoxPolys, wallFrame } from '../castle/geom.js';
import { wallLamp } from './houses.js';

const TINT = { leaf: 0x222222, frame: 0xf2f0ea, realFrame: 0x1a1b1d, hall: 0x2a2420, handle: 0xc8a050, threshold: 0x9a968e, glass: 0x4a5a66 };
const FRAME = { w: 16, out: 6 };
const VESTIBULE = { depth: 170, fade: 0.55, swing: 1.35 }; // swing: radians, standing open
const LEAF = { thick: 5 };

export function frontDoor(kit, { DAD }) {
  const { paint } = kit;
  const D = DAD.door;
  const hw = D.w / 2;
  // The door's wall frame: on the house's front face at its middle, looking out at the street.
  const f = wallFrame([D.x, DAD.floor, D.faceZ], [0, 0, -1]);
  // The white frame round the opening and the grey threshold (where the realistic look draws the
  // house itself the frame is black, as the real one is, and a glazed side light stands beside
  // it: world/lane/real/house.js draws that, the lamp beyond it).
  const real = kit.drawn('chain') !== kit;
  paint.color(real ? TINT.realFrame : TINT.frame);
  paint.solid(localBoxPolys(f, -hw - FRAME.w, -hw, 0, D.h, -4, FRAME.out));
  paint.solid(localBoxPolys(f, hw, hw + FRAME.w, 0, D.h, -4, FRAME.out));
  paint.solid(localBoxPolys(f, -hw - FRAME.w, hw + FRAME.w, D.h, D.h + FRAME.w, -4, FRAME.out));
  paint.color(TINT.threshold);
  paint.poly([f.at(-hw, 1, FRAME.out), f.at(hw, 1, FRAME.out), f.at(hw, 1, -LEAF.thick), f.at(-hw, 1, -LEAF.thick)], { facing: [0, 1, 0] });
  wallLamp(paint, f, hw + FRAME.w + (real ? 125 : 50), 220);
  vestibule(paint, f, hw, D.h);
  // The leaf: black boards, a narrow pane, a brass handle; its back and edges for when it
  // stands open.
  const builder = new GeoBuilder(paint.repeat);
  builder.color(TINT.leaf);
  builder.solid(localBoxPolys(f, -hw, hw, 0, D.h, -LEAF.thick, 0), { faceShade: (n) => (n[2] > 0.5 ? 0.6 : 1) });
  builder.color(TINT.glass);
  builder.panel(f, [[-hw + 30, D.h - 120], [-hw + 50, D.h - 120], [-hw + 50, D.h - 30], [-hw + 30, D.h - 30]], 1);
  builder.color(TINT.handle);
  builder.solid(localBoxPolys(f, hw - 34, hw - 14, 140, 150, 0, 10));
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
function vestibule(b, f, hw, height) {
  const o = f.at(0, 0, 0);
  const out = f.out;
  const back = -VESTIBULE.depth;
  b.color(TINT.hall);
  b.shade = (x, y, z) => 1 - (VESTIBULE.fade * ((o[0] - x) * out[0] + (o[2] - z) * out[2])) / VESTIBULE.depth;
  const quad = (a, c, d, e, facing) => b.poly([f.at(...a), f.at(...c), f.at(...d), f.at(...e)], { facing });
  quad([-hw, 0, -1], [-hw, 0, back], [-hw, height, back], [-hw, height, -1], f.dir(1, 0, 0));
  quad([hw, 0, -1], [hw, 0, back], [hw, height, back], [hw, height, -1], f.dir(-1, 0, 0));
  quad([-hw, height, -1], [hw, height, -1], [hw, height, back], [-hw, height, back], [0, -1, 0]);
  quad([-hw, 1, -1], [hw, 1, -1], [hw, 1, back], [-hw, 1, back], [0, 1, 0]);
  quad([-hw, 0, back], [hw, 0, back], [hw, height, back], [-hw, height, back], out);
  b.shade = null;
}
