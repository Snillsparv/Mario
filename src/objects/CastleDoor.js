// The castle's front door (layout.CASTLE: the door is centred on x in the front facade at
// frontZ, above a porch with steps), a Door (Door.js) facing +Z. With `castle.enter = { to,
// entry }` it opens: walking up to it (in front of the door, within REACH of its face, on the
// porch, facing it) creaks it open (sfx 'door_open') and asks for the warp into the castle
// ('warpRequest'; core/AreaSwitch.js). While it is sealed (update(player, true): AI RACE mode,
// see ObjectManager) it plays an original evil laugh (sfx 'evil_laugh') and opens the dialog box
// through 'signRead' with a sign of its own (id 'castle_sealed') instead. Without `enter` it is
// locked: the laugh and the 'castle_locked' sign, in both normal and AI RACE mode. After a
// message it stays quiet until Pip has walked more than REARM away from the door, so it does not
// fire again while he stands there; after a warp, until he is off its apron.
//
//   new CastleDoor({ castle: layout.CASTLE, collision, events })
//   update(player, sealed = false) -> true on the tick it triggers     (30 Hz)
//   reset()        armed again
//   near(player)   the hero is within its re-arm range (where it stays quiet once it went off)
//   disarm()       quiet as after a trigger, until the hero has left that range
//   faceZ, porchY  the door's face and the porch in front of it
//
// The door's face and the porch height are found from the collision world at construction
// (a ray toward the facade along the door's axis; the floor in front of it), falling back to
// frontZ + RECESS and baseY + PORCH.

import { DOOR, Door } from './Door.js';

export { DOOR };

export const CASTLE_LOCKED = Object.freeze({
  id: 'castle_locked',
  pages: Object.freeze(['The castle door is sealed shut...', 'You cannot enter the castle without a key!']),
});

// What the open door says while AI RACE mode (or its fade) seals it. The mode's name starts a
// short page of its own, so the box never breaks it over two lines (tests/ui-dialog.test.js).
export const CASTLE_SEALED = Object.freeze({
  id: 'castle_sealed',
  pages: Object.freeze(['The castle door is sealed shut...', 'The storm has sealed it!', 'Stop AI RACE and it will open again.']),
});

export class CastleDoor extends Door {
  constructor({ castle, collision, events }) {
    const x = castle.x ?? 0;
    const base = castle.baseY ?? 0;
    let face = castle.frontZ + DOOR.RECESS;
    let porch = base + DOOR.PORCH;
    if (collision?.raycast) {
      const hit = collision.raycast({ x, y: base + DOOR.PORCH + 120, z: castle.frontZ + 1500 }, { x: 0, y: 0, z: -1 }, 2000, { floors: false, ceilings: false });
      if (hit && hit.point.z > castle.frontZ - 100 && hit.point.z < castle.frontZ + 400) face = hit.point.z;
    }
    if (collision?.findFloor) {
      const f = collision.findFloor(x, base + 1000, face + 100);
      if (f.surface && f.y > base - 50 && f.y < base + 600) porch = f.y;
    }
    const enter = castle.enter ?? null;
    super({
      id: 'castle',
      x,
      z: face,
      yaw: 0,
      width: castle.doorWidth ?? 420,
      floorY: porch,
      to: enter?.to ?? null,
      entry: enter?.entry ?? null,
      locked: CASTLE_LOCKED,
      sealedSign: CASTLE_SEALED,
      events,
    });
    this.faceZ = face;
    this.porchY = porch;
  }
}
