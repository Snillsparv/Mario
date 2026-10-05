// The lane's lazy chunk's numbers (objects/laneBoss/*): the movable bins (BINS_TUNING; the
// player's side of the grab is player/physics/tuning.js BIN_*) and STOMPWATT, the dad's car
// standing up into a robot (BOSS: LaneBoss.js; its rig and poses are rig.js).
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

// STOMPWATT (LaneBoss.js), in ticks (30 a second) and lane units. (Its wake's reach and dwell,
// and its notice's, are layout.LANE_BOSS.)
//   INTRO        the first wake of a game (Jonas held, the camera its own): BLINK (the T lights
//                blink twice, a lock chirp), then RISE (it rocks up on its wheels, a rising hum),
//                then MORPH (the panels fly up, the frame unfolds), then FLEX (it stands tall,
//                eyes bright, a horn chord and its name card)
//   QUICK        a later wake: the same, shorter, nothing held
//   UNMORPH      folding back into the car (head first), then SETTLE down onto its wheels
//   LIFT         how high the body rises off its wheels before it parts
//   NOTICE_EVERY at most one notice blink (and chirp) this often while he is near
//   SHOW         it stands and watches him this long after waking, then folds back and parks
//   AWAY         ...sooner when he has been out of its reach (FAR away, or up off the drive)
//                this long
//   FAR          ...this far from it
//   REARM        once parked again it wakes no more until he has been this far from it
//   SHOO_EVERY   folding back with him on its parking spot: a horn honk this often, ...
//   SHOO_MAX     ...and after this long it parks anyway and lifts him onto its roof
//   TURN         its turn toward him (radians a tick), on the spot, stepping
//   STEP         a step's ticks while it turns (each foot down: a footfall)
//   LOOK         its head following him: at most this far round (radians) and this far up/down,
//                and close by tilted this far (curious)
//   BLINK_EVERY  its eyes blink about this often (BLINK_LEN ticks shut)
//   IDLE_EVERY   an idle move (a wave, a flex, a look round, a foot tap) about this often
//   BUMP         he cannot walk through it: his feet are pushed out of its feet (BUMP.foot round
//                each) and body (BUMP.body round its middle), at most BUMP.step a tick
//   PARK         the car's collider waits this far under the world while it is a robot
export const BOSS = Object.freeze({
  INTRO: { BLINK: 20, RISE: 25, MORPH: 75, FLEX: 30 },
  QUICK: { BLINK: 8, RISE: 7, MORPH: 45, FLEX: 0 },
  UNMORPH: 60,
  SETTLE: 12,
  LIFT: 50,
  NOTICE_EVERY: 150,
  SHOW: 600,
  AWAY: 300,
  FAR: 1300,
  REARM: 720,
  SHOO_EVERY: 45,
  SHOO_MAX: 300,
  TURN: 0.045,
  STEP: 14,
  LOOK: { yaw: 0.85, up: 0.35, down: 0.3, tilt: 0.14 },
  BLINK_EVERY: 110,
  BLINK_LEN: 4,
  IDLE_EVERY: 150,
  BUMP: { foot: 70, body: 115, step: 48 },
  PARK: -60000,
});
