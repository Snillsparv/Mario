// The lane's lazy chunk's numbers (objects/laneBoss/*): the movable bins (BINS_TUNING; the
// player's side of the grab is player/physics/tuning.js BIN_*).
//
//   PUSH        a bin pushed by Jonas walking into it slides this far a tick (the Player's own
//               WALL_PUSH_SPEED: he keeps pace with it, his `push` anim showing)
//   TOUCH       ...when his feet circle is within PLAYER_RADIUS + this of its box
//   FACE_COS    ...and he faces it within acos(this) (45 degrees)
//   LEVEL       ...on its level (his feet within this of its floor)
//   FLOOR       a spot is free for a bin when the floor under its four corners is within this of
//               its own floor (no kerbs, no steps) ...
//   FIT         ...and walls stay this clear of its box (a few circles along it)
//   HOME_NEAR   a bin within this of home counts as home
//   HOME_WAIT   left alone this many ticks (12 s), with Jonas HOME_AWAY away, a bin trundles home
//   HOME_SPEED  ...this fast (along x then z, or z then x, whichever is free)
//   HOME_SNAP   still not home this many ticks later (blocked: the other bin home before it, the
//               car), it is put home where the camera does not look (HOME_VIEW: within this of
//               its forward is in view)
//   TIP, TIP_RATE   pulled, the drawn bin tips toward him onto its wheels this far (radians),
//               this much a tick (player/model/anims/bin.js eases his mittens by as much)
//   PARK        a held bin's collider waits this far under the world (moveSurfaces)

export const BINS_TUNING = Object.freeze({
  PUSH: 6,
  TOUCH: 4,
  FACE_COS: 0.7,
  LEVEL: 30,
  FLOOR: 8,
  FIT: 2,
  HOME_NEAR: 40,
  HOME_WAIT: 360,
  HOME_AWAY: 700,
  HOME_SPEED: 5,
  HOME_SNAP: 300,
  HOME_VIEW: 1.1,
  TIP: 0.26,
  TIP_RATE: 0.26 / 6,
  PARK: -60000,
});
