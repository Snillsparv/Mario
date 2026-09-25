// Tuning for the follow camera. Distances are world units, angles radians, rates are per
// 30 Hz tick unless noted otherwise.

const DEG = Math.PI / 180;

export const FOV = 45;
export const FOV_RATE = 0.3; // field of view easing per tick (the AI RACE look-up widens it)
export const LOOK_HEIGHT = 150; // the orbit centre (look point) is this far above the hero's feet

// Orbit modes. 'follow' is the default trailing camera, 'hero' the tighter R-button camera.
// dist/pitch/aim are per zoom step (index 0 = close, 1 = far).
//
// aim: the view is aimed this angle above the look point, so the hero stands in the lower
// middle of the screen and the castle, its roofs and the sky fill the rest (the classic opening
// view) instead of the hero sitting dead centre under a view tipped down at the lawn. Only the
// rendered target moves: the orbit, the collider's sight lines and getYaw() (horizontal) are
// unchanged. See also AIM_FADE / FEET_MAX_BELOW below.
export const ORBIT_MODES = {
  follow: {
    dist: [1250, 1800],
    pitch: [8 * DEG, 12 * DEG],
    aim: [7 * DEG, 9 * DEG],
    swingGain: 0.02, // fraction of the angle to "behind the hero" closed per tick at full run
    swingMax: 0.8 * DEG, // cap on that swing per tick
    faceCamera: [100 * DEG, 155 * DEG], // swing fades out as the hero turns to face the camera
  },
  hero: {
    dist: [800, 1250],
    pitch: [7 * DEG, 11 * DEG],
    aim: [4 * DEG, 6 * DEG], // closer camera: a smaller angle frames the hero as low
    swingGain: 0.08,
    swingMax: 3 * DEG,
    faceCamera: [150 * DEG, 175 * DEG],
  },
};

// The aim fades out as the orbit steepens (its pitch to the look point, before any lift for
// floor clearance): looking down from high above, the hero stays centred.
export const AIM_FADE = [20 * DEG, 45 * DEG];
// When the height limit lifts the camera over rising ground (the lawn climbs toward the cliffs
// behind the spawn), the aim rises by the same height at the look point, so the view keeps the
// orbit's pitch instead of tipping down. The hero's feet are never further below the view axis
// than this (half the vertical FOV is 22.5 deg): the aim gives way first, and a look point
// lagging far above a diving or falling hero is tilted below.
export const FEET_MAX_BELOW = 17 * DEG;
export const FEET_HARD_BELOW = 19 * DEG; // hard limit (the aim is eased toward the soft one)
export const AIM_RATE = 0.3; // aim easing: fraction of the gap per tick
export const AIM_MAX_UP = 30 * DEG; // the aimed view never looks up...
export const AIM_MAX_DOWN = 80 * DEG; // ...or down steeper than this
// Resting view: once the hero has stood still on the ground for REST_DELAY ticks the view tilts
// up by REST_AIM more (still within FEET_MAX_BELOW), so the castle's roofs, its flags and the
// sky come into the picture, as in the classic opening view; it tilts back as the hero sets off.
// A reset (level start, respawn) starts in the resting view, and the spawn drop keeps it.
export const REST_AIM = 3 * DEG;
export const REST_DELAY = 20;
export const REST_IN_RATE = 0.04; // easing per tick toward the resting view (~2 s)...
export const REST_OUT_RATE = 0.15; // ...and back once the hero moves (~0.5 s)
export const REST_ACTION = 'spawn'; // the drop into the spawn point counts as standing still

export const RUN_SPEED = 32; // hero run speed used to normalise the swing (units/tick)
export const MOVING_SPEED = 2; // below this the hero counts as standing still
export const AIR_SWING_SCALE = 0.35; // the camera barely swings while the hero is airborne
// While the hero holds a pole the orbit swings round to its back (so the trunk it hugs is not
// between them), even though it barely moves and faces the camera.
export const POLE_ACTION = /^pole(_top)?$/; // on the trunk, or in the handstand on its top
export const POLE_SWING_GAIN = 0.04;
export const POLE_SWING_MAX = 2 * DEG;
export const ZOOM_RATE = 0.2; // distance/pitch easing toward the current zoom step

// Horizontal follow lag: the orbit centre (and so the camera) closes this fraction of its gap
// to the hero per tick, the look point a larger one. The hero pulls away a little when it
// sets off and the camera drifts to a stop after it halts (~75 units behind at a full run).
export const PIVOT_RATE = 0.3;
export const LOOK_RATE = 0.8;

// C-left / C-right orbit rotation.
export const C_ROTATE_STEP = 45 * DEG;
export const C_ROTATE_TICKS = 6;
export const C_BLOCK_MIN_DIST = 350; // a rotation is refused if a wall is closer than this...
export const C_BLOCK_RATIO = 0.3; // ...or than this fraction of the orbit distance
// A rotation is also refused if the camera, run through it and this many ticks after it (time
// to dolly in front of a blocker), would still not see the hero (look point and chest), or not
// his chest all that time: it swung round behind a solid corner (the castle's front corner
// towers) and cannot get back in front without tunnelling, or a pillar or step hides his body.
export const C_TRAP_SETTLE = 10;

// Mouse drag orbit (pixels -> radians).
export const MOUSE_YAW = 0.006;
export const MOUSE_PITCH = 0.004;
export const PITCH_MIN = -5 * DEG;
export const PITCH_MAX = 65 * DEG;

// Vertical framing: while airborne the camera keeps the take-off height until the hero
// leaves this band, then follows the excess. Once grounded it catches up smoothly.
export const JUMP_BAND_UP = 300;
export const JUMP_BAND_DOWN = 40;
export const BAND_FOLLOW_UP = 0.5; // fraction of the excess followed per tick above the band
export const BAND_FOLLOW_DOWN = 0.35; // ...and below it (falling off a ledge)
export const FALL_MAX_LAG = 400;
export const FOCUS_CATCHUP = 0.25;
// Actions where the hero is off the floor but "standing" (poles, ledges): follow fully.
// Whole names only: 'pole_jump' is airborne.
export const ANCHORED_ACTION = /^(pole|pole_top|ledge_hang|ledge_climb)$/;
export const FOCUS_SNAP_DIST = 2500; // teleports snap instead of easing

// When walls squeeze the camera toward the hero it tilts down and slides along the wall.
export const SQUEEZE_PITCH = 25 * DEG;
export const SQUEEZE_RANGE = [0.35, 0.8]; // pull-in ratio at which the tilt is full / starts
export const SQUEEZE_RATE = 0.1;
export const WALL_SLIDE_START = 0.75; // pull-in ratio below which the camera slides
export const WALL_SLIDE_GAIN = 0.1;
export const WALL_SLIDE_MAX = 3 * DEG; // per tick, reached when fully squeezed
export const OCCLUDED_SLIDE = 0.6; // slide strength while a wall hides the hero (no pull-in)
export const CRAMPED_RATIO = 0.25; // squeezed this far in, the camera slides even if the hero idles
export const WALL_SLIDE_EASE = 0.25; // the slide rate eases toward its goal (no per-tick jerks)

// First-person look (C-up from the closest zoom step, only while standing still on the ground).
export const EYE_HEIGHT = 135;
export const EYE_FORWARD = 45; // push the eye in front of the face so the head is not in view
export const FP_LOOK_DIST = 1000; // distance of the look target in front of the eye
export const FP_TURN = 0.06;
export const FP_PITCH_RATE = 0.045;
export const FP_PITCH_MIN = -60 * DEG; // negative = looking up
export const FP_PITCH_MAX = 70 * DEG;
export const FP_START_PITCH = -4 * DEG; // a little above level: the castle roofs are in view

// First-person enter/exit: the camera glides between the orbit and a hand-over pose just
// behind and above the head (looking along the view) and cuts between that and the eye, so
// its path never passes through the head.
export const BLEND_TICKS = 14;
export const FP_HANDOVER_BACK = 150;
export const FP_HANDOVER_RISE = 60;

// Hero counts as "submerged" (camera may follow underwater) once its head is SUBMERGE_ENTER
// below the surface, and stops once it is SUBMERGE_EXIT above it (hysteresis: a hero bobbing
// at the surface does not flip the camera between the two height limits).
export const HEAD_HEIGHT = 140;
export const SUBMERGE_ENTER = 20;
export const SUBMERGE_EXIT = 15;

// Intro fly-in and title orbit.
export const INTRO_TICKS = 96;
export const TITLE_RADIUS = 7000;
export const TITLE_SWEEP = 100 * DEG; // swing either side of straight-in-front
export const TITLE_PERIOD = 90; // seconds per back-and-forth sweep

// Low cover over a swimmer (cover.js): the drawbridge deck's underside is only 80-140 above the
// moat, and its stringers and trestle caps hang down to a level soffit 85 above the water, just
// over a floating swimmer's head. With no room for the camera between the water and the deck,
// it ducks under the surface with the hero (as for a submerged hero) and looks at the waterline,
// so the deck and its timbers are not in the way. A ceiling less than COVER_GAP above the water
// counts; cover ends COVER_HOLD ticks after neither the hero nor the camera is under it any more.
export const COVER_GAP = 300;
export const COVER_HOLD = 12;
export const COVER_LOOK_DROP = 100; // the look point sinks this far (to ~30 below the water)...
export const COVER_DROP_RATE = 0.2; // ...easing by this fraction of the gap per tick
// Under the deck, COVER_CAM_DEPTH under the surface, the camera is below the soffit and above
// the trestles' ties and knee braces (220 and more under the water): only the four trestle posts
// and the stone abutments at the banks can still come between it and the hero. While the line
// from the hero's hips to the camera is blocked, the orbit turns (instead of sliding along walls)
// toward the nearest yaw, in COVER_STEP steps up to COVER_MAX_TURN either way, whose line to a
// camera COVER_SIGHT_DIST out, COVER_CAM_DEPTH under the surface, is clear: in practice along the
// moat, past the posts.
export const COVER_SIGHT_HEIGHT = 50;
export const COVER_SIGHT_DIST = 800;
export const COVER_CAM_DEPTH = 80;
export const COVER_STEP = 15 * DEG;
export const COVER_MAX_TURN = 135 * DEG;
export const COVER_SWING_GAIN = 0.25;
export const COVER_SWING_MAX = 5 * DEG;

// A swimmer hidden round a corner of the island (sight.js): once the line from his chest to
// the camera has been blocked for SWIM_HIDDEN_TICKS, the orbit turns toward the nearest yaw, in
// SWIM_STEP steps up to SWIM_MAX_TURN either way, with a clear line (along the moat). A camera
// the collider reports `trapped` behind something solid turns the same way, right away.
export const SWIM_HIDDEN_TICKS = 5;
export const SWIM_STEP = 15 * DEG;
export const SWIM_MAX_TURN = 90 * DEG;
export const TRAP_MAX_TURN = 180 * DEG; // (a trapped camera on dry land looks all the way round)
export const SWIM_SWING_GAIN = 0.25;
export const SWIM_SWING_MAX = 4 * DEG;
export const SWIM_SWING_EASE = 0.5; // the turn rate eases toward that by this fraction per tick

// Star celebration: while the hero dances (or drops to dance) the orbit swings round to a
// three-quarter front view and moves in, then swings back to where it was once the dance is
// over (unless the player moves the hero or turns the camera first).
export const CELEBRATE_ACTION = /^star_(fall|dance)$/;
export const CELEBRATE_SIDES = [30 * DEG, 55 * DEG, 80 * DEG]; // off the hero's front, tried in turn
export const CELEBRATE_DIST = 600; // camera distance for the close-up...
export const CELEBRATE_MIN_DIST = 420; // ...or closer, down to this, in front of a wall...
export const CELEBRATE_PAD = 100; // ...kept this far off it
export const CELEBRATE_PITCH = 5 * DEG;
export const CELEBRATE_AIM = 2 * DEG;
export const CELEBRATE_TICKS = 30; // swing to the front...
export const CELEBRATE_RETURN_TICKS = 24; // ...and back

// Winged-hat flight (flight.js): while the hero flies (action 'flying'), the orbit becomes a
// flight-follow camera, as in the classic flying levels. It swings to straight behind his heading
// (an eased turn rate: fairly quick, smooth, a touch of lag in a banked turn; no C-left/right
// steps), trails at FLY_DIST (C-down still zooms out) and partly follows his flight pitch: it looks
// down on him in a dive and sits level-ish behind him in a climb. His height is followed closely
// (no jump band). The flight camera blends in over FLY_IN_TICKS as he takes off and back out to the
// follow camera over FLY_OUT_TICKS once the flight ends (every setting eases, no pop). The collider
// is tolerant meanwhile (CameraCollider.tolerant): it lifts over a blocker rather than dollying in,
// and dollies gently when it must. A cannon shot ('cannon_shot', Pip flying head first along his
// arc) gets the same camera behind his heading.
export const FLY_ACTION = /^(flying|cannon_shot)$/;
export const FLY_IN_TICKS = 12;
export const FLY_OUT_TICKS = 30;
export const FLY_DIST = [1150, 1700]; // per zoom step (at speed the orbit centre's lag adds ~150)
export const FLY_PITCH_BASE = 9 * DEG; // orbit pitch (looking down) behind a level flight...
export const FLY_PITCH_FOLLOW = 0.5; // ...plus this fraction of his nose-down pitch (RenderState.pitch)...
export const FLY_PITCH_MIN = 3 * DEG; // ...never lower than this in a climb...
export const FLY_PITCH_MAX = 38 * DEG; // ...or steeper than this in a dive
export const FLY_PITCH_RATE = 0.12; // that pitch eases by this fraction of the gap per tick
export const FLY_AIM = 5 * DEG; // the view aims this far above the look point (fades out in a dive)
export const FLY_SWING_GAIN = 0.22; // turn rate toward straight behind: this fraction of the angle...
export const FLY_SWING_MAX = 5 * DEG; // ...at most this per tick...
export const FLY_SWING_EASE = 0.3; // ...eased toward by this fraction per tick...
export const FLY_SWING_ACCEL = 0.5 * DEG; // ...speeding up by at most this per tick (a long swing starts gently)...
export const FLY_SWING_BRAKE = 1.2 * DEG; // ...and slowing down by at most this (it ends gently, but in time)
export const FLY_SWING_KEEP = 150 * DEG; // past this off his back, a swing under way keeps its direction
export const FLY_FOCUS_RATE = 0.35; // vertical follow: fraction of the height gap closed per tick
// Rising over obstacles: while a wall stops or pushes the flight camera sideways or it is pulled
// in (CameraCollider.slid, ratio below FLY_RISE_RATIO), the orbit pitches up by FLY_RISE (eased in
// at FLY_RISE_IN), held FLY_RISE_HOLD ticks after it is clear, then eased back at FLY_RISE_OUT.
export const FLY_RISE = 14 * DEG;
export const FLY_RISE_RATIO = 0.97;
export const FLY_RISE_IN = 0.12;
export const FLY_RISE_OUT = 0.04;
export const FLY_RISE_HOLD = 20;
// Room (flight.js): the swing behind him goes only as far round as the camera has room: it stops
// FLY_ROOM_MARGIN short of the first orbit position (probed every FLY_ROOM_STEP or finer, at most
// FLY_ROOM_PROBES, the edge narrowed down to FLY_ROOM_EDGE by bisection) that is closer than
// FLY_ROOM_CLEAR to a wall (at least FLY_ROOM_FLOOR over the floor), has a floor that would lift it
// more than FLY_ROOM_BUMP, or whose view ray a blocker cuts short of the distance plus
// FLY_ROOM_PAD, unless a ray FLY_ROOM_SIDE to either side is clear (a trunk); a position with room
// only once lifted FLY_RISE counts (the flight camera then rises). When that leaves it more than
// FLY_ROOM_LONG from behind him and going the other way round gets it FLY_ROOM_BETTER closer, it
// goes that way; a swing under way faster than FLY_ROOM_KEEP_RATE keeps its direction while that
// way has room and is at most FLY_ROOM_KEEP longer than the other. An orbit position with no room
// turns (FLY_ROOM_ESCAPE_STEP steps, up to FLY_ROOM_ESCAPE) to the nearest one that has, if any.
export const FLY_ROOM_MARGIN = 12 * DEG;
export const FLY_ROOM_STEP = 10 * DEG;
export const FLY_ROOM_PROBES = 8;
export const FLY_ROOM_EDGE = 1.5 * DEG;
export const FLY_ROOM_PAD = 250;
export const FLY_ROOM_CLEAR = 200; // (at most the collision grid's wall margin)
export const FLY_ROOM_FLOOR = 150; // (the collider's floor clearance)
export const FLY_ROOM_BUMP = 60;
export const FLY_ROOM_LONG = 60 * DEG;
export const FLY_ROOM_BETTER = 45 * DEG;
export const FLY_ROOM_ESCAPE = 60 * DEG;
export const FLY_ROOM_ESCAPE_STEP = 15 * DEG;
export const FLY_ROOM_KEEP_RATE = 1 * DEG;
export const FLY_ROOM_KEEP = 90 * DEG;
export const FLY_ROOM_SIDE = 120;

// AI RACE look-up (lookup.js): while AI RACE mode is on ('darkMode' { on }) and the robot beast
// has risen onto the castle's front roof, a hero near the castle front with the camera facing the
// castle gets a view framed to take in the beast's head as well as himself: the orbit drops to
// about the hero's head height (LOOKUP_PITCH_DROP off the orbit pitch) and the view tilts up just
// enough to bring the head (LOOKUP_HEAD_UP over the island, LOOKUP_HEAD_OUT in front of the
// facade: where it lies on the roof, reaching out over the courtyard) down to LOOKUP_HEAD_NDC of
// the picture's height, with his feet down to LOOKUP_FEET_NDC (LOOKUP_FEET_HARD_NDC at most);
// where that is not enough the camera moves out (up to LOOKUP_DIST_MAX more) and the view widens
// (up to LOOKUP_FOV_MAX) just enough (LOOKUP_CAM_UP: the camera's height over his feet the fit
// assumes). The look-up starts LOOKUP_DELAY ticks after the mode switches on (the beast heaves
// itself up) and eases in and out as the hero enters or leaves the zone, the camera turns toward
// or away from the castle, he climbs high (the roofs), flies or dances for a star, or the mode
// ends. Without AI RACE mode nothing changes.
export const LOOKUP_DELAY = 15;
export const LOOKUP_PITCH_DROP = 8 * DEG;
export const LOOKUP_HEAD_UP = 3240;
export const LOOKUP_HEAD_OUT = 545;
export const LOOKUP_HEAD_NDC = 0.86;
export const LOOKUP_FEET_NDC = 0.88;
export const LOOKUP_FEET_HARD_NDC = 0.94;
export const LOOKUP_DIST_MAX = 800;
export const LOOKUP_FOV_MAX = 58;
export const LOOKUP_CAM_UP = 180;
// Zone: horizontal distance from the front of the castle (layout.CASTLE: x, frontZ; a hero beside
// the castle counts his distance across only) full up to [0], none beyond [1].
export const LOOKUP_ZONE = [3500, 4500];
export const LOOKUP_HEIGHT = [900, 1400]; // the framed feet height (above the island) fades it out
export const LOOKUP_TARGET_BACK = 200; // the camera faces a point this far behind the front facade...
export const LOOKUP_FACING = [22 * DEG, 42 * DEG]; // ...within [0] of its view yaw fully, [1] not at all
export const LOOKUP_IN_RATE = 0.04; // easing per tick in (~2 s)...
export const LOOKUP_OUT_RATE = 0.05; // ...and out...
export const LOOKUP_MIN_STEP = 0.002; // ...by at least this much of the weight per tick (it arrives)...
export const LOOKUP_ACCEL = 0.004; // ...its speed changing by at most this per tick (it sets off gently)

// Cannon view (cannon.js, CameraController mode 'cannon'): while Pip sits in the cannon the
// camera rides with the barrel, CANNON_CAM_BACK behind its pivot along the bore and
// CANNON_CAM_UP over it (square to the bore), looking along the barrel (at a point
// CANNON_LOOK_DIST out), kept CANNON_CAM_CLEAR over the floor; the HUD's reticle marks the
// middle of the picture. Blends in and out over BLEND_TICKS (the first-person glide's).
export const CANNON_CAM_BACK = 430;
export const CANNON_CAM_UP = 215;
export const CANNON_CAM_CLEAR = 90;
export const CANNON_LOOK_DIST = 4000;
