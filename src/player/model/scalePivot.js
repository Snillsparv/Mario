// Where Jonas's model is scaled about when it is drawn smaller than he is (a realistic look's
// view.heroScale, Sparrow Lane's 0.85: main.js). Scaled about his feet, his hands would let go
// of a ledge: hanging from the dad's eave they would sink some 25 units below the gutter (his
// head hidden behind it). So the pivot is where he holds on:
//   * his feet (walking, running, jumping...; the handstand on a pole's tip, whose rs.pos is the
//     tip under his hands, the same);
//   * hanging from a ledge (ledge_hang) and pulling up onto it (ledge_climb): the ledge's lip
//     under his hands (its top, on the wall's face WALL_DIST in front of where he hung): his
//     mittens stay on the lip, the smaller body hangs from them;
//   * holding a wheelie bin (bin_hold): the bin's face (BIN_HOLD ahead of his feet) on the
//     floor: his mittens stay on it and his boots on the floor.
// Holding a pole his feet are the right pivot too (measured, tests/hero-scale.test.js): his
// mittens wrap the trunk at his sides, so as the smaller body draws back from the trunk they
// close in by as much: on a tree's trunk their distance from its axis stays exactly as at full
// size and nothing sinks into the bark (scaled about the trunk's surface or its axis instead,
// the mittens sink 1.5 to 3 units into it).
// Only the model moves: his collider, the camera and everything he does stay where they are.
//
//   heroPivot(action, player, feet, out) -> out   // the pivot for `action` (world: { x, y, z });
//       player: the Player (its ledge, climbFrom); feet: where his model stands (rs.pos)
//   const pivot = new ScalePivot()
//   pivot.shift(rs, scale, player, dt)   // per frame, before model.update(rs): moves rs.pos so
//       the model, drawn at `scale` about its feet, is scaled about the pivot instead ((1 - s) x
//       (pivot - feet)); a change of pivot (an action changing) eases over PIVOT_BLEND seconds
//       of play, so nothing pops as he grabs or lets go. The floor stays (rs.floorY): his blob
//       shadow keeps to it. Nothing at scale 1. No allocation.

import { WALL_DIST } from './physicsLink.js';
import { BIN_HOLD } from '../physics/tuning.js';

export const PIVOT_BLEND = 0.15; // seconds a change of pivot eases over (an anim's blend)

export function heroPivot(action, player, feet, out) {
  // Holding a wheelie bin: the bin's face on the floor under his mittens (they stay on it, his
  // boots on the floor).
  if (action === 'bin_hold') {
    out.x = feet.x + Math.sin(player.faceYaw) * BIN_HOLD;
    out.y = feet.y;
    out.z = feet.z + Math.cos(player.faceYaw) * BIN_HOLD;
    return out;
  }
  const ledge = player.ledge;
  if ((action === 'ledge_hang' || action === 'ledge_climb') && ledge) {
    const from = action === 'ledge_climb' && player.climbFrom ? player.climbFrom : feet;
    out.x = from.x - ledge.hn.x * WALL_DIST;
    out.y = ledge.y;
    out.z = from.z - ledge.hn.z * WALL_DIST;
    return out;
  }
  out.x = feet.x;
  out.y = feet.y;
  out.z = feet.z;
  return out;
}

export class ScalePivot {
  constructor() {
    this.action = '';
    this.t = PIVOT_BLEND; // seconds into the ease from `from`
    this.from = { x: 0, y: 0, z: 0 }; // the offset when the pivot last changed
    this.now = { x: 0, y: 0, z: 0 }; // the offset drawn
    this.point = { x: 0, y: 0, z: 0 }; // heroPivot's, reused
  }

  shift(rs, scale, player, dt) {
    const now = this.now;
    if (scale === 1 && now.x === 0 && now.y === 0 && now.z === 0) {
      this.action = rs.action;
      return;
    }
    if (rs.action !== this.action) {
      this.action = rs.action;
      this.t = 0;
      Object.assign(this.from, now);
    }
    this.t = Math.min(PIVOT_BLEND, this.t + dt);
    const p = heroPivot(rs.action, player, rs.pos, this.point);
    const k = 1 - scale;
    let e = this.t / PIVOT_BLEND;
    e = e * e * (3 - 2 * e);
    const f = this.from;
    now.x = f.x + (k * (p.x - rs.pos.x) - f.x) * e;
    now.y = f.y + (k * (p.y - rs.pos.y) - f.y) * e;
    now.z = f.z + (k * (p.z - rs.pos.z) - f.z) * e;
    rs.pos.x += now.x;
    rs.pos.y += now.y;
    rs.pos.z += now.z;
  }
}
