// The locked castle door (layout.CASTLE: the door is centred on x in the front facade at
// frontZ, above a porch with steps). Walking up to it (in front of the door, within REACH of
// its face, on the porch, facing it) plays an original evil laugh (sfx 'evil_laugh') and opens
// the dialog box through 'signRead' with a sign of its own (id 'castle_locked'); main freezes
// Pip until it is closed. It then stays quiet until Pip has walked more than REARM away from
// the door, so it does not fire again while he stands there. Works in both normal and AI RACE
// mode (it only reads the hero).
//
//   new CastleDoor({ castle: layout.CASTLE, collision, events })
//   update(player) -> true on the tick it triggers     (30 Hz)
//   reset()        armed again
//
// The door's face and the porch height are found from the collision world at construction
// (a ray toward the facade along the door's axis; the floor in front of it), falling back to
// frontZ + RECESS and baseY + PORCH.

export const DOOR = {
  REACH: 200, // feet axis to the door face (the hero's front within ~150)
  SIDE_MARGIN: 60, // beyond the door's half width
  FACING: 0.5, // cos of the largest angle between his facing and the door (60 degrees)
  REARM: 500, // re-armed once he is this far from the door
  RECESS: 56, // default: the door face stands this far in front of frontZ
  PORCH: 140, // default porch height above baseY
  BELOW: 60, // feet may be this far below the porch (the top step)
  ABOVE: 260, // or this far above it (jumping at the door)
};

export const CASTLE_LOCKED = Object.freeze({
  id: 'castle_locked',
  pages: Object.freeze(['The castle door is sealed shut...', 'You cannot enter the castle without a key!']),
});

export class CastleDoor {
  constructor({ castle, collision, events }) {
    this.events = events;
    this.x = castle.x ?? 0;
    this.halfWidth = (castle.doorWidth ?? 420) / 2;
    const base = castle.baseY ?? 0;
    let face = castle.frontZ + DOOR.RECESS;
    let porch = base + DOOR.PORCH;
    if (collision?.raycast) {
      const hit = collision.raycast({ x: this.x, y: base + DOOR.PORCH + 120, z: castle.frontZ + 1500 }, { x: 0, y: 0, z: -1 }, 2000, { floors: false, ceilings: false });
      if (hit && hit.point.z > castle.frontZ - 100 && hit.point.z < castle.frontZ + 400) face = hit.point.z;
    }
    if (collision?.findFloor) {
      const f = collision.findFloor(this.x, base + 1000, face + 100);
      if (f.surface && f.y > base - 50 && f.y < base + 600) porch = f.y;
    }
    this.faceZ = face;
    this.porchY = porch;
    this.armed = true;
    this.triggers = 0;
    // The sign handed to the dialog (a fresh copy per trigger, like a layout sign entry).
    this.pos = { x: this.x, y: porch + 300, z: face };
  }

  reset() {
    this.armed = true;
  }

  // Is the hero at the door and facing it (or pushing against it)?
  atDoor(player) {
    const p = player.pos;
    const dz = p.z - this.faceZ;
    if (dz < -20 || dz > DOOR.REACH) return false;
    const dx = p.x - this.x;
    const w = this.halfWidth + DOOR.SIDE_MARGIN;
    if (dx > w || dx < -w) return false;
    if (p.y < this.porchY - DOOR.BELOW || p.y > this.porchY + DOOR.ABOVE) return false;
    const a = player.action;
    // Not while flying past: the message is for walking up to the door.
    if (a === 'death' || a === 'spawn' || a === 'reading' || a === 'flying') return false;
    // Facing the door: forward (sin yaw, cos yaw) toward -Z.
    const yaw = player.faceYaw ?? Math.PI;
    return -Math.cos(yaw) >= DOOR.FACING || a === 'push';
  }

  update(player) {
    const p = player.pos;
    if (!this.armed) {
      const dx = p.x - this.x;
      const dz = p.z - this.faceZ;
      if (dx * dx + dz * dz > DOOR.REARM * DOOR.REARM) this.armed = true;
      return false;
    }
    if (!this.atDoor(player)) return false;
    this.armed = false;
    this.triggers++;
    this.events.emit('sfx', { name: 'evil_laugh', pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z } });
    this.events.emit('signRead', { sign: { id: CASTLE_LOCKED.id, pages: [...CASTLE_LOCKED.pages], x: this.x, z: this.faceZ, yaw: 0 } });
    return true;
  }
}
