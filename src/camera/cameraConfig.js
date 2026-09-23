// Tuning for the follow camera. Distances are world units, angles radians, rates are per
// 30 Hz tick unless noted otherwise.

const DEG = Math.PI / 180;

export const FOV = 45;
export const LOOK_HEIGHT = 120; // the camera looks at this point above the hero's feet

// Orbit modes. 'lakitu' is the default trailing camera, 'hero' the tighter R-button camera.
// dist/pitch are per zoom step (index 0 = close, 1 = far).
export const ORBIT_MODES = {
  lakitu: {
    dist: [1250, 1800],
    pitch: [17 * DEG, 21 * DEG],
    swingGain: 0.02, // fraction of the angle to "behind the hero" closed per tick at full run
    swingMax: 0.8 * DEG, // cap on that swing per tick
    faceCamera: [100 * DEG, 155 * DEG], // swing fades out as the hero turns to face the camera
  },
  hero: {
    dist: [800, 1250],
    pitch: [13 * DEG, 18 * DEG],
    swingGain: 0.08,
    swingMax: 3 * DEG,
    faceCamera: [150 * DEG, 175 * DEG],
  },
};

export const RUN_SPEED = 32; // hero run speed used to normalise the swing (units/tick)
export const MOVING_SPEED = 2; // below this the hero counts as standing still
export const AIR_SWING_SCALE = 0.35; // the camera barely swings while the hero is airborne
// While the hero holds a pole the orbit swings round to its back (so the trunk it hugs is not
// between them), even though it barely moves and faces the camera.
export const POLE_ACTION = 'pole';
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
export const ANCHORED_ACTION = /^(pole|ledge_hang|ledge_climb)$/;
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
export const FP_START_PITCH = 5 * DEG;

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
