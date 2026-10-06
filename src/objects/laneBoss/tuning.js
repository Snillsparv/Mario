// The lane's lazy chunk's numbers (objects/laneBoss/*): the movable bins (BINS_TUNING; the
// player's side of the grab is player/physics/tuning.js BIN_*) and STOMPWATT, the dad's car
// standing up into a robot (BOSS: LaneBoss.js; its rig and poses are rig.js). (The store room's
// doors' numbers are LaneGarage.js's own: module constants, inlined by the minifier.)
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
//   SHOVE       shoved by STOMPWATT, a bin slides this far a tick (LaneBins.shove)
//   KNOCK_GAP   his attack on a bin (a punch, a kick, a dive, a pound beside it) knocks it at
//               most once in this many ticks: JOLT, JOLT_TICKS: it rocks on its wheels away from
//               him this far (radians), this long (also stopping after rolling), its lid
//               clacking (bin_lid); it stays where it is
//   ROLL_EVERY  rolling, its wheels' rumble (bin_roll) this often (ticks)

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
  SHOVE: 12,
  KNOCK_GAP: 10,
  JOLT: 0.09,
  JOLT_TICKS: 12,
  ROLL_EVERY: 8,
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
//   MOOD         its eyes' expressions (LaneBoss._mood): [how far narrowed, each turned in its face
//                (radians: + the inner ends down)]: calm, set (fighting: ready), angry (its tells and
//                attacks), tired (its battery low, charging), bored (watching him out of reach),
//                sheepish (beaten); dizzy (zapped, dizzy, short-circuiting): [their length, their
//                spin a tick]
//   ROCK         rocking on its wheels as it rises (and settles back): this far (radians)
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
  MOOD: { calm: [0, 0], set: [0.18, 0.12], angry: [0.45, 0.34], tired: [0.5, -0.26], bored: [0.55, -0.1], sheepish: [0.3, -0.24], dizzy: [0.45, 0.45] },
  ROCK: 0.035,
  BUMP: { foot: 70, body: 115, step: 48, kneel: 120, heel: 60 },
  PARK: -60000,
});

// The fight (B3: fight.js), in ticks and lane units; every number a difficulty knob (a family
// with young children: kind, readable, a whole fight about two to three minutes).
//   PHASES       one per power light (3 hits win): its attack set in order, its tells' length,
//                its walking speed, its charging window (the hatch open: 8, 7, 6 s) and how far
//                its stomp's shockwave runs. 'swipe' when he is not in front within its reach,
//                and 'dash' when he is too near or too far, are a stomp instead.
//   GAP          ticks between two attacks (it guards, facing him)
//   LOCK         an attack's target stops following him this long before the tell ends (R2)
//   STOMP        the Wheel Stomp: started within `reach` (it walks in to `near`); its ring under
//                him grows from ring[0] to ring[1] across (orange); `hop` ticks onto the locked
//                spot (at most `far` from where it stood, `peak` high); its foot hurts within
//                `foot` of where it lands (his feet circle); `land` ticks squatting; then the
//                shockwave runs out `wave` a tick (to the phase's `wave` reach), a band `band`
//                wide and `high` tall, hurting him only standing on the ground within `level`
//                of its floor (any jump clears it)
//   DASH         the Roll Dash: when he is min .. max away (it walks in to `near`); `speed` a tick
//                along the locked line for at most `ticks`; its body (r `r`, up to `top`) hurts
//                and knocks him sideways off its line; a wall stops it (`bonk` ticks wobbling),
//                else it skids `skid` ticks; the chevrons show its line on the ground, `lane`
//                wide (wider than it hurts: off the chevrons he is safe)
//   SWIPE        the Wheel Swipe: he within `reach` in front (within `half` of its facing); the
//                arc locks `lock` before the swipe; the fist sweeps the arc in `ticks`, hurting
//                him there with his feet under `high` over its floor (a jump clears it), or
//                within `slack` of the fist's way
//   TURN         its turn toward him or its goal (radians a tick); STRIDE: a step carries it this
//                far (its steps' ticks: STRIDE / its speed, 16 at 7 a tick: its feet planted)
//   FEET         its feet circle against walls as it walks (and its body's top for headroom)
//   LOW .. UNPLUG   the charging loop's beats: low battery (slumped), kneel, plug in, the
//                hatch opening (then the window), zapped, dizzy, unplugging (no hit)
//   SHORT        the defeat's short-circuit before it walks off to fold back, sheepish
//   CELLS        the battery cells' sphere while it kneels (its frame: `up` over its ground,
//                `back` behind its middle), r; any of his attacks touching it is a hit
//   COINS        coins dropped by each hit (in a fan behind it, FAN apart)
//   PERCH        his floor more than this over the drive (the bins, the carport, a roof): out
//                of its reach (no attack; it watches him)
//   OUT          he more than the arena's r + this from its middle: out of the fight
//   WATCH        out or away this long: it goes home (the fight kept: hits stay)
//   REVERSE      beaten: folded back into the car in front of its slot, it reverses in this
//                fast; WAIT ticks it waits (honking) for him to step out of its slot
//   KNOCK        a hurt's knockback probed here (near, far along it; a floor within `dy` of
//                his): unsafe, he is knocked toward the arena's middle instead
//   TINK_GAP     a hit on its body outside the window: a metal tink at most this often
//   HATCH        the battery bay's hatch opens this far (radians)
//   EASY         the easier fight (layout.LANE_BOSS.easy, off; boss.setEasy): every tell this much
//                longer, every window this much longer, and no dash in the second round
//   SHOVE        a bin in its way is shoved this far aside (LaneBins.shove)
export const FIGHT = Object.freeze({
  PHASES: [
    { set: ['stomp', 'stomp'], tell: 30, walk: 7, window: 240, wave: 500 },
    { set: ['stomp', 'dash', 'stomp'], tell: 26, walk: 8, window: 210, wave: 600 },
    { set: ['dash', 'swipe', 'dash', 'stomp'], tell: 22, walk: 9, window: 180, wave: 700 },
  ],
  GAP: 40,
  LOCK: 12,
  STOMP: { reach: 900, near: 700, ring: [140, 200], hop: 20, far: 450, peak: 160, foot: 140, land: 24, wave: 12, band: 40, high: 50, level: 60 },
  DASH: { min: 300, max: 1100, near: 900, speed: 30, ticks: 30, r: 95, lane: 220, top: 450, bonk: 40, skid: 10 },
  SWIPE: { reach: 380, half: 1.05, lock: 10, ticks: 8, high: 90, slack: 0.3 },
  TURN: 0.08,
  STRIDE: 112,
  FEET: 120,
  LOW: 30,
  KNEEL: 20,
  PLUG: 12,
  OPEN: 12,
  ZAPPED: 20,
  DIZZY: 60,
  UNPLUG: 30,
  SHORT: 90,
  CELLS: { up: 172, back: 70, r: 95 },
  COINS: 3,
  FAN: 110,
  PERCH: 60,
  OUT: 200,
  WATCH: 300,
  REVERSE: 6,
  WAIT: 300,
  KNOCK: { near: 145, far: 290, dy: 60, from: 100 },
  TINK_GAP: 12,
  HATCH: 1.35,
  SHOVE: 220,
  EASY: { tell: 8, window: 90 },
});
