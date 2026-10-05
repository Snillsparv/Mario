// STOMPWATT's rig (Sparrow Lane's boss: LaneBoss.js, model.js): its bones, where each of the car's
// pieces (world/lane/real/pieces.js) sits on it standing up, the order they fly there in, and its
// poses. Pure data and a few pure helpers.
//
// Frames: the robot's own (x across, + its left; y up from its feet; z forward, its face) is the
// car's own frame (pieces.js: u, y, w; its nose forward), so the robot stands up where the car
// stood, facing where its nose pointed.
//
//   BONES                      the frame's bones: [name, parent, rest position (the robot's frame,
//                              standing)], each after its parent; 'frame' (the whole frame's
//                              growth while it unfolds) under the root
//   BONE                       every bone's index in the skeleton: the pieces first (pieces.js
//                              PIECES: a car triangle's `part` is its bone), then 'root', then BONES
//   ATTACH[piece]              [bone, offset from it, the images of the piece's x, y, z axes,
//                              its scale along them]: where the piece sits standing up
//   STAGGER[piece], ARC[piece] when in the morph (0 .. 1) each piece leaves the car (it takes
//                              SPAN of it to arrive) and how high its arc swings on the way
//   FOLLOW                     the pieces that ride on another (the eyes on the head, the hatch
//                              on the tail)
//   LIGHTS, BAY, CELLS         the power lights' bones (lit while it has that many hits left),
//                              the battery bay's hatch (on its lower back: open by `hatch`) and
//                              the cells' (shown while it is open)
//   POSES[name]                bone -> [x, y, z] turns (radians, three.js Euler XYZ) over the
//                              standing rest; bones left out stand at rest
//   pivotsOf(K, hl)            each piece's pivot in the car's frame (from its cuts, pieces.js):
//                              what turns and lands on ATTACH
//   unfold(m), grow(m), rise(m)    the frame during the morph: how far it has unfolded from FOLD
//                              (0 .. 1), its scale, its pelvis's height (0: in the car's floor)
//   arrive(piece, m)           a piece's way from the car to its place (0 .. 1, eased)

import { PIECES } from '../../world/lane/real/pieces.js';

export const BONES = [
  ['frame', 'root', [0, 0, 0]],
  ['pelvis', 'frame', [0, 268, 0]],
  ['chest', 'pelvis', [0, 330, 0]],
  ['neck', 'chest', [0, 572, 16]],
  ['shL', 'chest', [152, 520, 0]],
  ['elL', 'shL', [164, 424, 6]],
  ['wrL', 'elL', [164, 334, 20]],
  ['shR', 'chest', [-152, 520, 0]],
  ['elR', 'shR', [-164, 424, 6]],
  ['wrR', 'elR', [-164, 334, 20]],
  ['hipL', 'pelvis', [72, 252, 0]],
  ['knL', 'hipL', [76, 150, 14]],
  ['anL', 'knL', [76, 54, -4]],
  ['hipR', 'pelvis', [-72, 252, 0]],
  ['knR', 'hipR', [-76, 150, 14]],
  ['anR', 'knR', [-76, 54, -4]],
  // (Its three power lights on its chest, each going out with a hit on it; its battery in its
  // belt, where the car's floor keeps it: the bay's hatch on its lower back, hinged at its top,
  // and the cells behind it, shown while it is open.)
  ['pw0', 'chest', [44, 449, 72]],
  ['pw1', 'chest', [44, 470, 72]],
  ['pw2', 'chest', [44, 491, 72]],
  ['bay', 'pelvis', [0, 300, -64]],
  ['cells', 'pelvis', [0, 268, -58]],
];
export const BONE = Object.freeze(Object.fromEntries([...PIECES, 'root', ...BONES.map((b) => b[0])].map((name, i) => [name, i])));
export const BONE_COUNT = PIECES.length + 1 + BONES.length;
export const LIGHTS = ['pw0', 'pw1', 'pw2'];
export const BAY = 'bay';
export const CELLS = 'cells';
// Each frame bone's rest position (the robot's frame).
export const REST = Object.freeze(Object.fromEntries([['root', [0, 0, 0]], ...BONES.map(([name, , at]) => [name, at])]));

// The images of the x, y and z axes under a turn (three.js Euler XYZ: about z, then y, then x).
export function axesOf(ax, ay, az) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // (The matrix Rx Ry Rz, its columns.)
  return [
    [cb * cc, ca * sc + sa * sb * cc, sa * sc - ca * sb * cc],
    [-cb * sc, ca * cc - sa * sb * sc, sa * cc + ca * sb * sc],
    [sb, -sa * cb, ca * cb],
  ];
}
const I = axesOf(0, 0, 0);
const Y_L = axesOf(0, -Math.PI / 2, 0); // (+x to +z: the left side's outer faces forward)
const Y_R = axesOf(0, Math.PI / 2, 0); // (-x to +z: the right side's)
const UPRIGHT = axesOf(Math.PI / 2, 0, 0); // (the greenhouse stood up: its roof forward)
// (A front door on a shoulder: its outer face turned forward and out, tipped up a little.)
const PAULDRON_L = axesOf(0, -0.25, 0.28);
const PAULDRON_R = axesOf(0, 0.25, -0.28);

export const ATTACH = {
  head: ['neck', [0, 64, 16], I, [1.08, 1.3, 0.82]],
  canopy: ['chest', [0, 120, 66], UPRIGHT, [0.8, 0.9, 0.5]],
  tail: ['chest', [0, 136, -98], I, [0.92, 1.25, 0.62]],
  core: ['pelvis', [0, -4, 2], I, [0.66, 0.6, 0.42]],
  doorFL: ['shL', [36, -8, 2], PAULDRON_L, [1, 0.8, 0.78]],
  doorFR: ['shR', [-36, -8, 2], PAULDRON_R, [1, 0.8, 0.78]],
  doorRL: ['knL', [0, -50, 42], Y_L, [1, 0.85, 1.3]],
  doorRR: ['knR', [0, -50, 42], Y_R, [1, 0.85, 1.3]],
  wheelFL: ['wrL', [0, -48, 20], Y_L, [1.2, 1.2, 1.2]],
  wheelFR: ['wrR', [0, -48, 20], Y_R, [1.2, 1.2, 1.2]],
  wheelRL: ['anL', [0, -2, -70], I, [0.95, 0.95, 0.95]],
  wheelRR: ['anR', [0, -2, -70], I, [0.95, 0.95, 0.95]],
};
export const FOLLOW = { eyeL: 'head', eyeR: 'head', hatch: 'tail' };

export const SPAN = 0.5;
export const STAGGER = { core: 0, tail: 0.08, wheelRL: 0.12, wheelRR: 0.12, doorRL: 0.16, doorRR: 0.16, canopy: 0.24, wheelFL: 0.3, wheelFR: 0.3, doorFL: 0.34, doorFR: 0.34, head: 0.42 };
export const ARC = { core: 60, tail: 160, wheelRL: 90, wheelRR: 90, doorRL: 120, doorRR: 120, canopy: 220, wheelFL: 140, wheelFR: 140, doorFL: 160, doorFR: 160, head: 260 };

// Poses over the rest (standing straight, arms hanging). Left and right mirror: a left bone's
// y and z turns are the right one's negated.
const mirror = (pose) => {
  const out = { ...pose };
  for (const [bone, [x, y, z]] of Object.entries(pose)) {
    if (bone.endsWith('L')) out[bone.slice(0, -1) + 'R'] ??= [x, -y, -z];
  }
  return out;
};
export const POSES = {
  // Folded up inside the car: legs tucked under it, arms folded, leaning far forward.
  fold: mirror({ pelvis: [0, 0, 0], chest: [1.15, 0, 0], neck: [-0.6, 0, 0], shL: [0.6, 0, 0.1], elL: [-2.3, 0, 0], wrL: [0.4, 0, 0], hipL: [-1.75, 0, 0.1], knL: [2.6, 0, 0], anL: [-0.85, 0, 0] }),
  // Standing easy: feet apart, knees soft, arms a little out from its sides.
  stand: mirror({ chest: [0.04, 0, 0], neck: [-0.04, 0, 0], shL: [0.08, 0, 0.16], elL: [-0.32, 0, 0], wrL: [0.1, 0, 0], hipL: [-0.08, 0, 0.06], knL: [0.16, 0, 0], anL: [-0.08, 0, -0.06] }),
  // Both fists up (the intro's last beat): a proud double flex.
  flex: mirror({ chest: [-0.08, 0, 0], neck: [-0.1, 0, 0], shL: [-0.1, 0, 1.25], elL: [0, 0, 1.75], wrL: [0, 0, 0.2], hipL: [-0.04, 0, 0.12], knL: [0.1, 0, 0], anL: [-0.06, 0, -0.12] }),
  // A friendly wave (its left arm up, the hand swung by `wave`).
  wave: mirror({ chest: [0, 0, -0.04], neck: [0, 0, 0.08], shL: [0, 0, 2.35], elL: [0, 0, 0.55], wrL: [0, 0, 0], shR: [0.08, 0, -0.16], elR: [-0.32, 0, 0], hipL: [-0.08, 0, 0.06], knL: [0.16, 0, 0], anL: [-0.08, 0, -0.06] }),
  // Shooing him off its spot: an arm out, palm forward, the other on its hip.
  shoo: mirror({ chest: [0.1, 0, 0], neck: [0.1, 0, 0], shL: [-1.2, 0, 0.25], elL: [-0.5, 0, 0], wrL: [-0.6, 0, 0], shR: [0.25, 0, -0.55], elR: [-1.9, 0, 0], hipL: [-0.08, 0, 0.06], knL: [0.16, 0, 0], anL: [-0.08, 0, -0.06] }),
  // Looking round, hands on its hips.
  hips: mirror({ chest: [0, 0, 0], shL: [0.3, 0, 0.55], elL: [-1.9, 0, 0], wrL: [0, 0, 0], hipL: [-0.08, 0, 0.08], knL: [0.14, 0, 0], anL: [-0.06, 0, -0.08] }),
  // The fight (B3). Fists up, knees bent, ready: between its attacks and walking.
  guard: mirror({ chest: [0.12, 0, 0], neck: [0.04, 0, 0], shL: [-0.35, 0, 0.32], elL: [-1.25, 0, 0], wrL: [0.1, 0, 0], hipL: [-0.22, 0, 0.1], knL: [0.42, 0, 0], anL: [-0.2, 0, -0.1] }),
  // The Wheel Stomp's tell: its right leg raised high (the heel wheel spinning up), arms out to
  // balance, leaning back a little ...
  stompTell: mirror({ chest: [-0.12, 0, 0.05], neck: [0.12, 0, -0.05], shL: [-0.2, 0, 0.75], elL: [-0.9, 0, 0], shR: [-0.2, 0, -0.75], elR: [-0.9, 0, 0], hipL: [-0.12, 0, 0.12], knL: [0.24, 0, 0], anL: [-0.12, 0, -0.12], hipR: [-1.7, 0, -0.1], knR: [1.45, 0, 0], anR: [0.2, 0, 0] }),
  // ... in the air (both knees up, fists over its head) ...
  stompHop: mirror({ chest: [0.1, 0, 0], neck: [0.15, 0, 0], shL: [-2.4, 0, 0.3], elL: [-0.5, 0, 0], hipL: [-1.1, 0, 0.12], knL: [1.5, 0, 0], anL: [-0.3, 0, 0] }),
  // ... and the landing: a deep squat, both fists down on the ground.
  stompLand: mirror({ chest: [0.55, 0, 0], neck: [-0.35, 0, 0], shL: [-0.9, 0, 0.35], elL: [-0.25, 0, 0], wrL: [0.3, 0, 0], hipL: [-0.95, 0, 0.18], knL: [1.45, 0, 0], anL: [-0.5, 0, -0.18] }),
  // The Roll Dash's tell: crouched low, arms swept back, head up at him ...
  crouch: mirror({ chest: [0.45, 0, 0], neck: [-0.4, 0, 0], shL: [0.85, 0, 0.3], elL: [-0.3, 0, 0], hipL: [-0.75, 0, 0.12], knL: [1.25, 0, 0], anL: [-0.5, 0, -0.12] }),
  // ... and skating on its heel rollers: leaning forward, arms back, one foot ahead.
  skate: mirror({ chest: [0.35, 0, 0], neck: [-0.3, 0, 0], shL: [0.95, 0, 0.25], elL: [-0.2, 0, 0], hipL: [-0.45, 0, 0.14], knL: [0.55, 0, 0], anL: [-0.1, 0, -0.14], hipR: [0.05, 0, -0.14], knR: [0.45, 0, 0], anR: [-0.35, 0, 0.14] }),
  // The Wheel Swipe's tell: its right arm drawn back, the torso wound up ...
  swipeTell: mirror({ chest: [0.08, -0.5, 0], neck: [0, 0.45, 0], shL: [-0.5, 0, 0.45], elL: [-1.2, 0, 0], shR: [0.55, 0, -1.25], elR: [-0.6, 0, 0], hipL: [-0.2, 0, 0.14], knL: [0.38, 0, 0], anL: [-0.18, 0, -0.14] }),
  // ... and the swipe: the arm swung round in front, low, the torso unwound.
  swipe: mirror({ chest: [0.2, 0.55, 0], neck: [0, -0.4, 0], shL: [0.4, 0, 0.35], elL: [-0.9, 0, 0], shR: [-1.15, 0, -1.2], elR: [-0.1, 0, 0], hipL: [-0.25, 0, 0.14], knL: [0.42, 0, 0], anL: [-0.18, 0, -0.14] }),
  // Its battery low: slumped, arms hanging, head down, knees sagging.
  lowbat: mirror({ chest: [0.32, 0, 0], neck: [0.45, 0, 0], shL: [-0.12, 0, 0.06], elL: [-0.08, 0, 0], wrL: [0.1, 0, 0], hipL: [-0.28, 0, 0.06], knL: [0.5, 0, 0], anL: [-0.22, 0, -0.06] }),
  // Kneeling at the wall charger: its right knee down, the left foot planted ahead, leaning in,
  // its left hand at the charger, the right on its knee (its pelvis lowered: footLift, ~97).
  kneel: mirror({ chest: [0.36, 0, 0], neck: [-0.22, 0, 0], shL: [-1.1, 0, 0.12], elL: [-0.55, 0, 0], wrL: [0.2, 0, 0], shR: [-0.55, 0, -0.1], elR: [-0.9, 0, 0], hipL: [-1.4, 0, 0.12], knL: [1.3, 0, 0], anL: [0.1, 0, -0.12], hipR: [0.12, 0, -0.08], knR: [1.45, 0, 0], anR: [1.2, 0, 0.08] }),
  // Zapped: arched back, arms flung out, head back.
  zapped: mirror({ chest: [-0.35, 0, 0], neck: [-0.4, 0, 0], shL: [-0.3, 0, 1.75], elL: [0, 0, 0.3], wrL: [0, 0, 0], hipL: [0.05, 0, 0.22], knL: [0.05, 0, 0], anL: [0, 0, -0.22] }),
  // Dizzy: arms loose, head lolling (its sway added as it stands there).
  dizzy: mirror({ chest: [0.18, 0, 0], neck: [0.25, 0, 0.25], shL: [0.05, 0, 0.35], elL: [-0.15, 0, 0], hipL: [-0.18, 0, 0.12], knL: [0.36, 0, 0], anL: [-0.18, 0, -0.12] }),
  // Beaten and sheepish: head tilted, its right hand rubbing the back of its head.
  sheepish: mirror({ chest: [0.12, 0, 0], neck: [0.2, 0, 0.3], shL: [0.02, 0, 0.12], elL: [-0.25, 0, 0], shR: [0.25, 0, -2.4], elR: [-1.95, 0, 0], wrR: [0.4, 0, 0], hipL: [-0.06, 0, 0.04], knL: [0.12, 0, 0], anL: [-0.06, 0, -0.04] }),
};
// A walking step (the stepping side's leg; `k` 0 .. 1 .. 0 over a step) and the arms' swing.
export const WALK = { hip: [-0.7, 0, 0], kn: [1.05, 0, 0], an: [-0.35, 0, 0], back: [0.32, 0, 0], arm: 0.42, bob: 14 };
// About how far its pelvis drops kneeling (footLift's; past half of it its bump is the kneeling body's).
export const KNEEL_DROP = 96;
// How far a leg's ankle rises with its hip and knee turned (about x, radians) from where it
// stands straight: the pelvis is lowered by the lower foot's (fight.js: a crouch's bent legs with
// its soles on the ground, not floating).
const THIGH = [REST.knL[1] - REST.hipL[1], REST.knL[2] - REST.hipL[2]];
const SHIN = [REST.anL[1] - REST.knL[1], REST.anL[2] - REST.knL[2]];
const LEG = -(THIGH[0] + SHIN[0]);
export function footLift(hip, knee) {
  const b = hip + knee;
  const up = LEG + THIGH[0] * Math.cos(hip) - THIGH[1] * Math.sin(hip) + SHIN[0] * Math.cos(b) - SHIN[1] * Math.sin(b);
  return up > 0 ? up : 0;
}
// A step while it turns on the spot (the stepping foot's side; `k` 0 .. 1 .. 0 over a step).
export const STEP_UP = { hip: [-0.55, 0, 0], kn: [0.95, 0, 0], an: [-0.4, 0, 0] };

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const unfold = (m) => smooth((m - 0.22) / 0.62);
export const grow = (m) => 0.02 + 0.98 * smooth(m / 0.32);
export const rise = (m) => smooth((m - 0.08) / 0.62);
export const arrive = (piece, m) => smooth((m - STAGGER[piece]) / SPAN);

// Each piece's pivot in the car's frame, from its cuts (pieces.js): the middle of its stretch of
// the car (the wheels' their axes; the eyes and the hatch are found on the geometry: model.js).
export function pivotsOf(K, hl) {
  const mid = (a, b) => (a + b) / 2;
  const yMid = mid(K.floor, K.belt);
  const doorY = mid(K.floor, K.roof - 20);
  const wu = K.hw - K.tread / 2 - 3;
  return {
    core: [0, yMid, mid(K.tail, K.head)],
    head: [0, yMid, mid(K.head, hl)],
    canopy: [0, mid(K.belt, K.roof), mid(-hl + 35, K.head - 40)],
    tail: [0, yMid, mid(-hl, K.tail)],
    doorFL: [K.hw - 4, doorY, mid(K.pillar, K.head)],
    doorFR: [-(K.hw - 4), doorY, mid(K.pillar, K.head)],
    doorRL: [K.hw - 4, doorY, mid(K.tail, K.pillar)],
    doorRR: [-(K.hw - 4), doorY, mid(K.tail, K.pillar)],
    wheelFL: [wu, K.yC, K.axles[0]],
    wheelFR: [-wu, K.yC, K.axles[0]],
    wheelRL: [wu, K.yC, K.axles[1]],
    wheelRR: [-wu, K.yC, K.axles[1]],
  };
}
