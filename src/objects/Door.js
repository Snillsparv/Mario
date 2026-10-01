// A door Jonas walks into (layout.DOORS; the castle's front door is one too, CastleDoor.js).
// Walking up to it (in front of its face, within REACH of it, on its floor, facing it or
// pushing against it) takes him to another area, or tells him why it will not open.
//
//   new Door({ id, x, z, yaw, width, floorY, to, entry, kind, locked, sealedSign, laugh, events })
//     x, z         the middle of the door's face; yaw: the way the face looks (0 = +Z), so Jonas
//                  walks in facing yaw + pi
//     width        the doorway (the trigger reaches SIDE_MARGIN past either side of it)
//     floorY       the floor in front of it (his feet from BELOW under it to ABOVE over it)
//     to, entry    the area and the entry in it that the door leads to; to null: locked
//     kind         'door' (default) or 'bottle', handed on with the warp (and its sound)
//     locked       the sign ({ id, pages }, like a layout sign) a locked door shows
//     sealedSign   the sign an open door shows while it is sealed (null: it stays quiet)
//     laugh        the evil laugh plays with those signs (default true)
//   update(player, sealed = false) -> true on the tick it triggers   (30 Hz; sealed: AI RACE)
//   atDoor(player)  the hero is at the door and facing it (or pushing against it)
//   near(player)    the hero is within its re-arm range (below)
//   disarm()        quiet until the hero has left its re-arm range
//   reset()         armed again
//
// An open door emits its sound (OPEN_SFX by kind: 'door_open', the creak and latch; the ship in
// the bottle's mouth 'bottle_dive') and 'warpRequest' { to, entry, kind, from } (from: the door
// itself; core/AreaSwitch.js walks him through it) and re-arms once he is off its apron (APRON
// past its trigger, in front and at either side), so he can come straight back through it. A
// locked one, or an open one while sealed, plays sfx 'evil_laugh' (if `laugh`) and opens the
// dialog box through 'signRead' with a fresh copy of its sign (main freezes Jonas until it is
// closed), then stays quiet until he has walked more than REARM away, so it does not go off
// again while he stands there.
//
// Allocation: nothing per tick while nothing happens (the facing test uses the sine and cosine
// of the door's yaw, worked out once); no Math.hypot / max / min or iterators on this path
// (tests/objects-door.test.js guards the source).

export const DOOR = {
  REACH: 200, // feet axis to the door face (the hero's front within ~150)
  SIDE_MARGIN: 60, // beyond the door's half width
  FACING: 0.5, // cos of the largest angle between his facing and the door (60 degrees)
  REARM: 500, // after a message: re-armed once he is this far from the door
  APRON: 60, // after a warp: re-armed once he is this far off the trigger (in front, at the sides)
  RECESS: 56, // the castle door (CastleDoor.js): its face stands this far in front of frontZ...
  PORCH: 140, // ...over a porch this high above baseY, unless the collision world says otherwise
  BELOW: 60, // feet may be this far below the door's floor (the top step)
  ABOVE: 260, // or this far above it (jumping at the door)
};

// Actions in which walking up to a door means nothing (flying past it, among others).
const IGNORED = new Set(['death', 'spawn', 'reading', 'flying']);
// The sound an open door makes as he goes through it, by kind.
export const OPEN_SFX = Object.freeze({ door: 'door_open', bottle: 'bottle_dive' });

export class Door {
  constructor({ id = 'door', x, z, yaw = 0, width = 420, floorY = 0, to = null, entry = null, kind = 'door', locked = null, sealedSign = null, laugh = true, events }) {
    this.events = events;
    this.id = id;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.sin = Math.sin(yaw); // the face's outward direction (sin, cos)
    this.cos = Math.cos(yaw);
    this.halfWidth = width / 2;
    this.floorY = floorY;
    this.to = to;
    this.entry = entry;
    this.kind = kind;
    this.locked = locked;
    this.sealedSign = sealedSign;
    this.laugh = laugh;
    this.armed = true;
    this.far = to === null; // re-armed past REARM (after a message) rather than off the apron
    this.triggers = 0;
    // Where its sounds come from, and the dialog's sign stands (a fresh copy per trigger).
    this.pos = { x, y: floorY + 300, z };
  }

  reset() {
    this.armed = true;
    this.far = this.to === null;
  }

  disarm() {
    this.armed = false;
  }

  // Is the hero within the re-arm range: REARM of the door after a message, else its apron?
  near(player) {
    const p = player.pos;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    if (this.far) return dx * dx + dz * dz <= DOOR.REARM * DOOR.REARM;
    const out = dx * this.sin + dz * this.cos;
    if (out < -DOOR.APRON || out > DOOR.REACH + DOOR.APRON) return false;
    const across = dx * this.cos - dz * this.sin;
    const w = this.halfWidth + DOOR.SIDE_MARGIN + DOOR.APRON;
    return across <= w && across >= -w;
  }

  // Is the hero at the door and facing it (or pushing against it)?
  atDoor(player) {
    const p = player.pos;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    // Out: in front of the face along its normal; across: along the face.
    const out = dx * this.sin + dz * this.cos;
    if (out < -20 || out > DOOR.REACH) return false;
    const across = dx * this.cos - dz * this.sin;
    const w = this.halfWidth + DOOR.SIDE_MARGIN;
    if (across > w || across < -w) return false;
    if (p.y < this.floorY - DOOR.BELOW || p.y > this.floorY + DOOR.ABOVE) return false;
    const a = player.action;
    // Not while flying past: the door is for walking up to.
    if (IGNORED.has(a)) return false;
    if (a === 'push') return true;
    // Facing the door: his forward (sin, cos of faceYaw) against the face's outward direction.
    const yaw = player.faceYaw ?? this.yaw + Math.PI;
    return -(Math.sin(yaw) * this.sin + Math.cos(yaw) * this.cos) >= DOOR.FACING;
  }

  update(player, sealed = false) {
    if (!this.armed) {
      if (!this.near(player)) this.armed = true;
      return false;
    }
    if (!this.atDoor(player)) return false;
    this.armed = false;
    this.triggers++;
    const pos = this.pos;
    if (this.to !== null && !sealed) {
      this.far = false;
      this.events.emit('sfx', { name: OPEN_SFX[this.kind] ?? OPEN_SFX.door, pos: { x: pos.x, y: pos.y, z: pos.z } });
      this.events.emit('warpRequest', { to: this.to, entry: this.entry, kind: this.kind, from: this });
      return true;
    }
    this.far = true;
    const sign = this.to === null ? this.locked : this.sealedSign;
    if (this.laugh) this.events.emit('sfx', { name: 'evil_laugh', pos: { x: pos.x, y: pos.y, z: pos.z } });
    if (sign) this.events.emit('signRead', { sign: { id: sign.id, pages: [...sign.pages], x: this.x, z: this.z, yaw: this.yaw } });
    return true;
  }
}
