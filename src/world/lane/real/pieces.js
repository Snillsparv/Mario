// The dad's car's pieces (STOMPWATT, Sparrow Lane's boss: objects/laneBoss/*): which piece of the
// robot each of the car's triangles becomes. Shared by the realistic look's worker (detail.js:
// the realistic car, cars.js) and the lane's lazy chunk (objects/laneBoss/model.js: the classic
// car, lane/props.js), so both looks part the same way. Pure: no three.js.
//
//   PIECES, PIECE                      // the pieces' names in bone order, and name -> index
//   pieceOf(zone, c, n, K, eye) -> index | -1
//       zone: the part of the car's drawing the triangle came from ('body' the shell, 'nose',
//       'tail', 'sides', 'greenhouse', 'wheels', 'caps', 'contact': the builders mark them);
//       c, n: its middle and normal in the car's own frame [u, y, w] (u across, + its left; y up
//       from the ground; w along, + its nose); K: the car's cuts (below); eye: it is one of the T
//       lights (drawn white on the nose). -1: not part of the robot (the contact shadow: the
//       classic look keeps its soft shadow as the 'shadow' piece, fading as the car parts).
//
// The cuts (K): hw (half width), head (w: the front clip ahead of it: the head), tail (w: the rear
// clip behind it: the backpack), pillar (w: the front doors ahead of it, the rear doors behind),
// axles [front, rear], R (the wheels' radius), yC (their axis's height), tread (their width),
// mirror (w of the mirrors), belt (y: the window line), hatch (y: the tailgate over it, the
// battery's hatch).
//
// The robot (docs/ARCHITECTURE.md "STOMPWATT"): the front clip is its head (its T lights its
// eyes), the greenhouse its chest (the black roof forward), the rear clip its backpack (the
// tailgate its battery hatch), the front doors its pauldrons, the rear doors its shin guards, the
// front wheels its fists, the rear wheels its heel rollers, the floor (core) its belt.

export const PIECES = ['core', 'head', 'canopy', 'tail', 'doorFL', 'doorFR', 'doorRL', 'doorRR', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR', 'eyeL', 'eyeR', 'hatch', 'shadow'];
export const PIECE = Object.freeze(Object.fromEntries(PIECES.map((name, i) => [name, i])));

const side = (c) => (c[0] > 0 ? 'L' : 'R');
const door = (c, K) => PIECE[`door${c[2] > K.pillar ? 'F' : 'R'}${side(c)}`];
// The nearest axle (0 front, 1 rear) and the distance from its axis in the side's plane.
function axle(c, K) {
  let best = 0;
  let d = Infinity;
  for (let a = 0; a < 2; a++) {
    const e = Math.hypot(c[1] - K.yC, c[2] - K.axles[a]);
    if (e < d) {
      d = e;
      best = a;
    }
  }
  return [best, d];
}

export function pieceOf(zone, c, n, K, eye = false) {
  const [u, y, w] = c;
  const au = Math.abs(u);
  if (zone === 'contact') return -1;
  if (zone === 'wheels') {
    const [a, d] = axle(c, K);
    if (d <= K.R + 1.5 && au >= K.hw - K.tread - 6) return PIECE[`wheel${a ? 'R' : 'F'}${side(c)}`];
    return a ? PIECE.tail : PIECE.head; // (the arches' liners and flares)
  }
  if (zone === 'nose') return eye ? PIECE[`eye${side(c)}`] : PIECE.head;
  if (zone === 'tail') return PIECE.tail;
  if (zone === 'greenhouse') return PIECE.canopy;
  if (zone === 'doors') return door(c, K);
  if (zone === 'sides') {
    if (au > K.hw - 8 && Math.abs(w - K.mirror) < 26 && y > K.belt - 25) return PIECE[`doorF${side(c)}`]; // (the mirrors)
    if (w > K.head) return PIECE.head;
    if (w < K.tail) return PIECE.tail;
    return door(c, K);
  }
  if (zone === 'caps') return w > K.head - 8 ? PIECE.head : w < K.tail + 8 ? PIECE.tail : PIECE.canopy;
  // The shell: by where along the car (a face at a cut belongs to the side it faces away from);
  // between the clips its sides are the doors, its floor and deck the core; the tail's end face
  // over the bumper is the hatch.
  const wi = w - n[2];
  if (wi > K.head) return PIECE.head;
  if (wi < K.tail) return n[2] < -0.6 && y > K.hatch && au < K.hw - 6 ? PIECE.hatch : PIECE.tail;
  return Math.abs(n[0]) > 0.45 ? door(c, K) : PIECE.core;
}
