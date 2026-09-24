// Movement tuning for the hero. Units: world units (~cm) and 30 Hz ticks, so velocities
// are units/tick and accelerations units/tick^2. Grouped by the move they affect.

const DEG = Math.PI / 180;

// Gravity / air
export const GRAVITY = 4;
export const LONG_JUMP_GRAVITY = 2;
export const TERMINAL_VY = -75;
export const LONG_JUMP_TERMINAL_VY = -37.5; // long jumps float down at half the usual speed
// Air steering (facing fixed): the stick's forward component sets a target forward speed
// (full forward = the move's top speed, full back = AIR_MAX_BACK_SPEED) that the speed eases
// toward at one of these rates; its sideways component eases a strafe drift.
export const AIR_SPEEDUP = 1.2; // pushing toward a faster target
export const AIR_BRAKE = 1.8; // pulling back
export const AIR_DRAG = 0.35; // coasting (stick neutral or sideways)
export const AIR_OVERSPEED_DECAY = 1; // speeds beyond the move's top speed bleed off this fast
export const AIR_MAX_SPEED = 32;
export const AIR_MAX_BACK_SPEED = -16;
export const AIR_STRAFE = 10; // full-stick sideways drift speed
export const AIR_STRAFE_ACCEL = 2.5; // drift eases in / out this fast
export const JUMP_CUT_MIN_VY = 20; // releasing A while rising faster than this cuts vy
export const JUMP_CUT_FACTOR = 0.25;

// Ground
export const MAX_TARGET_SPEED = 32; // intendedMag = stickMag^2 * 32
export const MAX_FORWARD_VEL = 48;
// Starting from rest eases in (an S-curve): the first tick moves at the stick's speed up to
// WALK_START_SPEED, then the speed gains START_ACCEL per tick near a standstill (a few ticks
// of tiptoe), rising (smoothstep) to START_PEAK_ACCEL by START_PEAK_SPEED (a brisk walk),
// which blends (smoothstep) into the running curve by START_BLEND_SPEED. The running curve
// eases toward the stick's target (+1.1 - fv / 43 per tick: an exponential curve with this
// asymptote and time constant), clamped at the target. Full stick from rest: tiptoe for ~4
// ticks, the run shows from tick ~11 (0.37 s), 32 at tick ~38 (1.27 s). (Round 3: was the
// run at tick ~19 and 32 at ~49, which felt "hard" to get going.)
export const WALK_START_SPEED = 2;
export const START_ACCEL = 0.7;
export const START_PEAK_ACCEL = 1.8;
export const START_PEAK_SPEED = 10;
export const START_BLEND_SPEED = 24;
export const START_UPHILL_BLEND = 0.5; // uphill pull (u/tick^2) at which starts use the running curve
export const PIVOT_START_SPEED = 8; // the pivot after a turnaround skid runs off at once
export const RUN_ACCEL_LIMIT = 47.3;
export const RUN_ACCEL_TICKS = 43;
export const RUN_OVERSPEED_DRAG = 0.08; // fraction of the excess over the target lost per tick
export const WALK_TURN_RATE = 11.25 * DEG; // per tick
export const STICK_BACK_ANGLE = 100 * DEG; // stick this far from facing = "held back"
export const SKID_MIN_SPEED = 16; // turnaround / braking skid threshold (skid braking: slopes.js)
export const TURNAROUND_FINISH_TICKS = 4; // pivot after a turnaround skid (A still side-flips)
export const STOP_DECEL = 1;
export const STEEP_WALK_ACCEL = 4; // slope pull on floors too steep to walk up (walkable: slopes.js)
export const WALL_PUSH_SPEED = 6; // forward speed cap when running into a wall
export const TIPTOE_SPEED = 8; // gait speeds (see gaitSpeed in actions/common.js): tiptoe below this,
export const RUN_SPEED = 18; // walk below this, run above
export const GAIT_LEAD = 2; // the gait shows at most this much above the forward speed
export const STRIDE = { tiptoe: 80, walk: 150, run: 240, crawl: 70 }; // units per anim cycle
export const CRAWL_SPEED_FACTOR = 0.1; // crawl target = walking target * this (~3.2 max)
export const CROUCH_SLIDE_MIN_SPEED = 10;
export const GROUND_DIVE_MIN_SPEED = 29;
export const AIR_DIVE_MIN_SPEED = 28;
export const DIVE_BOOST = 15;
// Signs (layout.SIGNS): B reads one instead of punching when Pip is within SIGN_REACH of the
// board centre (horizontally, feet within SIGN_REACH_Y of its foot), in front of its face
// (within SIGN_FRONT_ANGLE of the direction the face looks, so never beside or behind it) and
// facing the board within SIGN_FACING_ANGLE; while reading he turns to it.
export const SIGN_REACH = 140;
export const SIGN_REACH_Y = 150;
export const SIGN_FRONT_ANGLE = 80 * DEG;
export const SIGN_FACING_ANGLE = 75 * DEG;
export const READ_TURN_RATE = 22.5 * DEG; // per tick
export const IDLE_LOOK_TICKS = 150; // 5 s
export const IDLE_SLEEP_TICKS = 450; // 15 s

// Jumps: vy = base + fv * scale at take-off
export const JUMP_VY = 42;
export const DOUBLE_JUMP_VY = 52;
export const JUMP_FV_SCALE = 0.25;
export const JUMP_KEEP_FV = 0.8;
export const TRIPLE_JUMP_VY = 69;
export const TRIPLE_JUMP_MIN_SPEED = 20;
export const FLIP_VY = 62; // backflip, side flip, wall kick
export const BACKFLIP_FV = -16;
export const SIDEFLIP_FV = 8;
export const LONG_JUMP_VY = 30;
export const LONG_JUMP_SCALE = 1.5;
export const LONG_JUMP_WINDOW = 30; // ticks into a crouch slide where A long-jumps
// Long jump from a keyboard (round 3): running at LONG_JUMP_COMBO_SPEED or more, Z and A
// pressed on the same tick, or A then Z within LONG_JUMP_COMBO_TICKS (the jump that A started
// turns into the long jump), also long-jump. (Z then A was already one: the crouch slide.)
export const LONG_JUMP_COMBO_SPEED = 16;
export const LONG_JUMP_COMBO_TICKS = 4;
export const WALL_KICK_FV = 24; // minimum; a faster incoming speed is kept
export const HARD_BONK_SPEED = 38; // un-kicked wall contacts this fast knock the hero back hard
export const WALL_KICK_MIN_SPEED = 16;
export const WALL_KICK_WINDOW = 5; // ticks after touching a wall
export const WALL_HEAD_ON_COS = Math.cos(45 * DEG);
export const ROLLOUT_VY = 30;
export const JUMP_CHAIN_WINDOW = 5; // ticks after landing for double / triple jumps
export const GROUND_DIVE_VY = 20;

// Ground pound: the wind-up hop starts at POUND_HOP_VY and shrinks by POUND_HOP_DECAY per tick.
export const POUND_SPIN_TICKS = 10;
export const POUND_HOP_VY = 20;
export const POUND_HOP_DECAY = 2;
export const POUND_START_VY = -50;
export const POUND_LAND_TICKS = 12;

// Landing / fall damage
export const LAND_TICKS = 4;
export const FLIP_LAND_TICKS = 6;
export const HARD_LAND_TICKS = 12;
// Falls beyond HARD_FALL_HEIGHT hurt when landing faster than FALL_DAMAGE_MIN_VY (so a
// long jump's slow descent never does); slippery floors only cushion falls up to BIG_FALL_HEIGHT.
export const HARD_FALL_HEIGHT = 1150;
export const HARD_FALL_DAMAGE = 3;
export const BIG_FALL_HEIGHT = 3000;
export const BIG_FALL_DAMAGE = 4;
export const FALL_DAMAGE_MIN_VY = 55;
// A fall that starts on a tree (climbing it, the handstand on its tip, jumping, dropping or
// being knocked off it) counts from the tree's foot (pole.y0): a tree's height never hurts,
// only a landing below its foot does.

// Ledges and poles
// A ledge is grabbed when its top passes through arm's reach (this far above the feet)
// while falling past the wall; lower tops just slide by, and the hero lands on them once
// the feet clear the lip.
export const LEDGE_MIN_RISE = 100;
export const LEDGE_MAX_RISE = 160;
export const HANG_DEPTH = 160; // feet this far below the ledge top while hanging
export const HANG_SETTLE_SPEED = 30; // units/tick the body sinks into the hang after a grab
export const LEDGE_CLIMB_TICKS = 15;
export const GRAB_COOLDOWN = 15;
export const POLE_BODY = 40; // hero keeps this far from a pole's surface on the ground
// Airborne hero within this of a pole's surface grabs it; covers trunk colliders around the
// pole that hold the body further out (e.g. an octagonal prism: up to ~60 past the pole).
export const POLE_GRAB_REACH = 65;
// ...and while touching a wall, within this: a trunk's collider can hold a fast hero out
// past POLE_GRAB_REACH (running into a prism's corner), and that contact still grabs.
export const POLE_WALL_REACH = 85;
export const POLE_HOLD_DIST = 30; // distance from the pole surface while holding
export const POLE_FOOT_BLEND = 80; // near the floor the hold eases out to where he'll stand
export const POLE_LET_GO_TICKS = 4; // Z: eases off the trunk over this many ticks, then falls
export const POLE_CLIMB_SPEED = 7;
export const POLE_SLIDE_SPEED = 16;
// Climbing on past the top of the climb (hands at the pole's tip, feet HANG_DEPTH below it)
// swings the hero up into a handstand on the tip (action 'pole_top', anim 'pole_handstand').
// A springs off in a big flip; the stick pulled down (after POLE_TOP_SETTLE_TICKS, the swing
// up) climbs back onto the trunk; Z lets go.
export const POLE_TOP_SETTLE_TICKS = 8;
export const POLE_TOP_DOWN_STICK = -0.5; // raw stick Y at or below this climbs back down
// Stick left/right turns the handstand on a tree top around the pole (radians per tick at
// full stick), like the classic tree-top handstand.
export const POLE_TOP_TURN_RATE = 0.1;
export const POLE_TOP_JUMP_VY = 66;
export const POLE_TOP_JUMP_FV = 14; // toward the stick when held, else the facing

// Water
export const WATER_ENTER_DEPTH = 100; // feet this far under the surface -> swimming
export const WATER_EXIT_DEPTH = 95; // standing on a floor above surface - this -> wading
export const SURFACE_FLOAT_DEPTH = 80; // feet depth while floating at the surface
export const SWIM_TURN_RATE = 7 * DEG;
export const SWIM_MAX_PITCH = 75 * DEG;
export const SWIM_PITCH_RATE = 4 * DEG;
export const STROKE_TICKS = 18;
export const RESTROKE_TICKS = 10; // A re-strokes from this far into a stroke
export const STROKE_BURST_TICKS = 6;
export const STROKE_ACCEL = 3.5;
export const STROKE_MAX_SPEED = 28;
export const FLUTTER_SPEED = 16;
export const SURFACE_PADDLE_SPEED = 12;
export const BUOYANCY = 1.2; // slow upward drift underwater
export const PLUNGE_DAMPING = 5; // entry vertical speed decays toward buoyancy by this per tick
export const WATER_JUMP_VY = 62;
export const WATER_JUMP_WALL_FV = 12; // forward speed kept while a water jump rises along a wall
export const BREATHING_DEPTH = 140; // feet shallower than this below the surface = head above water
export const DROWN_TICKS = 256; // one wedge lost per ~8.5 s with the head under water
export const SURFACE_HEAL_TICKS = 10; // one wedge back per this many ticks while breathing

// Health
export const MAX_HEALTH = 8;
export const INVINCIBLE_TICKS = 60;
export const KNOCKBACK_FV = -16;
export const KNOCKBACK_VY = 24;
// Fire damage (takeDamage(n, from, { fire: true })): a hot-foot hop straight up, running in
// the air away from the fire, steerable a little (turn rate, stick speed range up to
// BURN_MAX_SPEED), then an ordinary landing.
export const BURN_VY = 50;
export const BURN_FV = 12;
export const BURN_MAX_SPEED = 20;
export const BURN_TURN_RATE = 5 * DEG; // per tick
export const DEATH_TICKS = 60;
export const OUT_OF_BOUNDS_Y = -3000;
export const INTRO_DROP = 1600;

// Star celebration
export const STAR_DANCE_TICKS = 80;
export const STAR_GRAB_MAX_VY = 10; // a star grabbed while rising only carries on up this fast
