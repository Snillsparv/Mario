// The north end of the Great Hall (hall/layout.js): the giant ship in a bottle on its stand in
// the apse, the little world inside it, and the way up to its mouth (the half-round dais, and a
// cork with two giant books to hop up on). Written into the hall's kit (hall/hall.js): render
// faces into its material builders, colliders into kit.solids.
//
//   buildBottle(kit, layout)
//
// The glass (kit.bottle, drawn transparent, its edges paler and more opaque where the view
// grazes it: hall.js) is the bottle's outer surface only, 16 sides round its axis, so it never
// lies over itself (a highlight stripe runs along it). Its collider is convex solids round the
// axis (body, shoulder frustum, neck and lip; slippery stone), each with a vertical face across
// its widest band (a wall the camera's path check stops at). It lies on a stand panelled in
// teal under a gold rail, set back under the glass, with two gold cradles across it (their
// blocks and caps soft-edged). No spot Jonas can stand on is lower than HEADROOM under the
// glass (layout.js): the stand runs the bottle's length and rises round the glass's underside
// to 45 degrees either side of straight down, where the glass is high enough over the floor
// beside it, and the cradles' cheeks rise round the glass into its widest band, so neither
// leaves a ledge under it.
// Inside lies a putty sea with a model of the first course (kit.paint): pink granite islets, a
// red cottage, a red-sailed boat and a white lighthouse with a red band, whose lamp (kit.lamp,
// its own mesh, turning about kit.lampAt: hall.js) is lit once that course's star is won: its
// lantern glowing warm gold, and two hazy beams sweeping round inside the glass, as the
// course's own lighthouse has (the beams' fade is their faces' glow). The mouth (the lip's end
// face) is the door Jonas walks into from the dais's top.
// The dais is a smooth half-cone collider (not slippery) under 11 drawn round steps (rose
// risers, cream treads with a rounded nosing, each tread's middle on the slope); the cork and
// the books are hall-paint over wooden colliders.

import { softBox, sweep } from '../castle/geom.js';

const TINT = {
  glass: 0xbfe3d6,
  shine: 0xffffff,
  brass: 0xe2b252, // the stand's rail and the cradles
  teal: 0x1f5754, // the stand's top
  putty: 0x2f62a8,
  sea: 0x3f8fd0,
  wave: 0x72b6e6,
  granite: 0xc99a8c,
  meadow: 0x7fb85e,
  falu: 0xa8322a,
  roof: 0x3a3a42,
  hull: 0x2a3f6a,
  mast: 0x7a5636,
  sail: 0xd0342c,
  jib: 0xf2ecdc,
  white: 0xf4f0e6,
  red: 0xc8282c,
  lantern: 0x2a2c34,
  lamp: 0xffa828, // (lit: a warm, deep gold that stands out from the headboard and the plaster behind)
  beam: 0xffb848,
  rose: 0xe3a08e, // the dais's risers (rose marble: the trim's pale marble tinted)
  cream: 0xf0e6d2, // its treads, top and back
  gold: 0xe8b84a,
  cork: 0xc89a62,
  corkRing: 0xa87a48,
  pages: 0xf0e6cc,
  pageLine: 0xd8ccae,
  books: [0x9c2a2a, 0x2a6662],
};

const SIDES = 16; // the glass round its axis
const SHINE = [0.45, 0.85]; // the highlight stripe: this far west of straight up (radians)
const KEEL = Math.PI / 4; // the stand rises round the glass this far either side of straight down
const GAP = 14; // its top's inner corners lie this far inside the glass (under the body: inside the putty)
const RAIL = 40; // the gold rail along the top of its sides
const STAND_INTO = 10; // its colliders' sides run this far up into the glass's (stand())
const CORK_TAPER = 30; // the cork narrows by this much from its foot to its top
const PANEL = { u: 640, v: 392 }; // one raised panel of the stand's sides (the panel texture), along and up
// The cradles' soft blocks and caps: their vertical edges' and top edges' radii.
const CRADLE_ROUND = { block: [40, 10], cap: [30, 20] };
// The dais (layout DAIS): its steps round in `sides` (smooth), each tread's nosing standing
// `nose` proud of its riser and rounding down `noseDrop` over its front; an inlay on its top (a
// gold ring r 470..500 round a Falu one, 420..470); a collider of `facets` facets.
const DAIS_DRAW = { sides: 24, nose: 6, noseDrop: 14, inlay: [[500, 470, 'gold'], [470, 420, 'falu']], facets: 12 };
// A book's boards, how far its page block is set in from their edges, its page lines (as parts
// of the block's height, and their thickness), its spine (proud of the north face, between the
// boards' edges) and the gold bands round the spine (from its west end, `band` wide).
const BOOK = { board: 18, inset: 8, lines: [1 / 3, 2 / 3], line: 4, spine: 26, spineSegs: 6, bands: [50, 110], band: 20 };
const SEA_Y = 420; // the putty sea's surface inside the body (the cradles' top)
const PUTTY_R = 512; // the putty's curved underside, just inside the glass
// The little lighthouse's beams (lit): from `near` the lamp out to `length` (inside the glass
// whichever way they point), `near` to `far` across, `glow` their opacity at the lamp.
const LAMP_BEAM = { near: 40, length: 380, far: 64, glow: 0.8 };
// Corners (degrees round the axis, 0 straight up, 90 east) of the colliders' cross-sections:
// one straight up and one straight down, and a vertical face across the widest band. With a
// corner at the widest point the faces either side would be a steep floor and a steep ceiling,
// and the follow camera's path check leaves floors to its height limit: a C-button swing could
// carry it into the glass. A wall stops it. The neck's ring has its corners where the stand's
// top meets it (KEEL either side of straight down).
const BODY_RING = [0, 30, 60, 75, 105, 120, 150, 180, 210, 240, 255, 285, 300, 330];
const NECK_RING = [0, 45, 70, 110, 135, 180, 225, 250, 290, 315];
// The shoulder's collider ends this much wider than the neck's, so its end face holds the
// neck's whole (their rings differ): no sliver of the neck's end is left standing out of it, a
// wall facing north whose push would shove the camera into the shoulder.
const NECK_COLLAR = 10;

export function buildBottle(kit, layout) {
  glass(kit, layout.BOTTLE);
  const halfX = stand(kit, layout);
  cradles(kit, layout, halfX);
  world(kit, layout.BOTTLE);
  dais(kit, layout);
  cork(kit, layout);
  books(kit, layout);
}

// ---------------------------------------------------------------- round the bottle's axis

// A point at radius r and angle a (0 straight up, pi / 2 east) round the axis, at z.
const onAxis = (axisY, r, a, z) => [Math.sin(a) * r, axisY + Math.cos(a) * r, z];

// Faces of revolution round the bottle's axis: `profile` [[r, z], ...] walked with z rising
// (north to south), its faces looking away from the axis (an end face: north or south as the
// walk turns); tint(a) colours each column of faces (a: its middle angle).
function revolve(builder, axisY, profile, sides, tint) {
  for (let s = 0; s + 1 < profile.length; s++) {
    const [r0, z0] = profile[s];
    const [r1, z1] = profile[s + 1];
    // The segment's normal in the (r, z) plane: (dz, -dr).
    const nr = z1 - z0;
    const nz = r0 - r1;
    for (let i = 0; i < sides; i++) {
      const aA = (i / sides) * Math.PI * 2;
      const aB = ((i + 1) / sides) * Math.PI * 2;
      const aM = (aA + aB) / 2;
      builder.color(tint(aM));
      builder.poly([onAxis(axisY, r0, aA, z0), onAxis(axisY, r0, aB, z0), onAxis(axisY, r1, aB, z1), onAxis(axisY, r1, aA, z1)], {
        facing: [Math.sin(aM) * nr, Math.cos(aM) * nr, nz],
      });
    }
  }
}

// Convex solid round the axis from z0 (radius r0) to z1 (radius r1), its cross-section's
// corners at the `ring` angles (degrees).
function axialSolid(axisY, r0, r1, z0, z1, ring) {
  const corners = (r, z) => ring.map((deg) => onAxis(axisY, r, (deg * Math.PI) / 180, z));
  const a = corners(r0, z0);
  const b = corners(r1, z1);
  const polys = [a, b];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    polys.push([a[i], a[j], b[j], b[i]]);
  }
  return polys;
}

// Points [x, y] up the east side of the drawn glass's underside (the body, SIDES round) from
// height y0 to y1 (both below the axis).
function glassUnderside({ axisY, bodyR }, y0, y1) {
  const corners = [];
  for (let i = SIDES / 2; i >= SIDES / 4; i--) {
    const a = (i / SIDES) * Math.PI * 2;
    corners.push([Math.sin(a) * bodyR, axisY + Math.cos(a) * bodyR]);
  }
  const at = (y) => {
    let k = 0;
    while (corners[k + 1][1] < y) k++;
    const [xa, ya] = corners[k];
    const [xb, yb] = corners[k + 1];
    return [xa + ((xb - xa) * (y - ya)) / (yb - ya), y];
  };
  return [at(y0), ...corners.filter(([, y]) => y > y0 && y < y1), at(y1)];
}

// The glass, and the bottle's colliders.
function glass(kit, B) {
  const { axisY: Y, bodyR, neckR, neckInnerR, lipR } = B;
  const profile = [
    [0, B.body[0]],
    [bodyR - 50, B.body[0]],
    [bodyR, B.body[0] + 50],
    [bodyR, B.shoulder[0]],
    [bodyR - 50, B.shoulder[0] + 150],
    [neckR + 120, B.shoulder[0] + 300],
    [neckR, B.neck[0]],
    [neckR, B.lip[0]],
    [lipR, B.lip[0]],
    [lipR, B.lip[1]],
    [neckInnerR, B.lip[1]],
  ];
  // West of the top, a bright stripe (the hall's light caught in the glass).
  const tint = (a) => {
    const off = Math.PI * 2 - a;
    return off > SHINE[0] && off < SHINE[1] ? TINT.shine : TINT.glass;
  };
  revolve(kit.bottle, Y, profile, SIDES, tint);

  // Slippery stone: he slides off the curved glass rather than standing on its side.
  const { solids } = kit;
  solids.solid(axialSolid(Y, bodyR, bodyR, B.body[0], B.body[1], BODY_RING), 'stone', 'slippery');
  solids.solid(axialSolid(Y, bodyR, neckR + NECK_COLLAR, B.shoulder[0], B.shoulder[1], BODY_RING), 'stone', 'slippery');
  solids.solid(axialSolid(Y, neckR, neckR, B.neck[0], B.lip[0], NECK_RING), 'stone', 'slippery');
  solids.solid(axialSolid(Y, lipR, lipR, B.lip[0], B.lip[1], NECK_RING), 'stone', 'slippery');
}

// The stand under the bottle, its whole length from its end to the dais: rising round the
// glass to its corners 45 degrees (KEEL) either side of straight down, its sides straight down
// from there to the floor, so its half-width follows the glass (the body, narrowing under the
// shoulder, the neck and lip). Beside it the glass is at least HEADROOM over the floor
// (layout.js). Its sides are teal raised panels (kit.dado) under a gold rail; its top is the
// glass's underside in deep teal (drawn a little inside it: under the body, inside the putty,
// which hides it); its colliders are flat-topped boxes whose sides run up into the glass's
// collider, so no slit is left between the two: a camera slipping through one over the stand's
// top would be lifted (its clearance over the floor under it wins over the ceiling) up through
// the glass. Returns its half-width under the body.
function stand(kit, { BOTTLE: B }) {
  const { dado, paint, solids } = kit;
  const Y = B.axisY;
  const k = Math.sin(KEEL);
  // [r0, r1, z0, z1] north to south: the body, the shoulder, the neck with its lip.
  const sections = [
    [B.bodyR, B.bodyR, B.body[0], B.body[1]],
    [B.bodyR, B.neckR, B.shoulder[0], B.shoulder[1]],
    [B.neckR, B.neckR, B.neck[0], B.lip[1]],
  ];
  const a0 = Math.PI - KEEL;
  const steps = Math.round((2 * KEEL) / ((Math.PI * 2) / SIDES)); // the glass's facets it covers
  const uv = (z, y) => [z / PANEL.u, y / PANEL.v];
  for (const [r0, r1, z0, z1] of sections) {
    const [w0, w1] = [r0 * k, r1 * k];
    const [h0, h1] = [Y - r0 * k, Y - r1 * k];
    // Its sides, panelled, darker toward the floor, under the rail.
    for (const s of [-1, 1]) {
      dado.color(0xffffff);
      dado.poly([[s * w0, 0, z0], [s * w1, 0, z1], [s * w1, h1 - RAIL, z1], [s * w0, h0 - RAIL, z0]], {
        facing: [s, 0, 0],
        shade: [0.85, 0.85, 1, 1],
        uvs: [uv(z0, 0), uv(z1, 0), uv(z1, h1 - RAIL), uv(z0, h0 - RAIL)],
      });
      paint.color(TINT.brass);
      paint.poly([[s * w0, h0 - RAIL, z0], [s * w1, h1 - RAIL, z1], [s * w1, h1, z1], [s * w0, h0, z0]], { facing: [s, 0, 0] });
    }
    // The top: the glass's facets, its inner corners sunk GAP toward the axis.
    paint.color(TINT.teal);
    const corner = (r, i, z) => onAxis(Y, i === 0 || i === steps ? r : r - GAP, a0 + (i * 2 * KEEL) / steps, z);
    for (let i = 0; i < steps; i++) {
      const aM = a0 + ((i + 0.5) * 2 * KEEL) / steps;
      const facing = [-Math.sin(aM) * (z1 - z0), -Math.cos(aM) * (z1 - z0), r1 - r0]; // toward the axis
      paint.poly([corner(r0, i, z0), corner(r0, i + 1, z0), corner(r1, i + 1, z1), corner(r1, i, z1)], { facing });
    }
    // Its collider: the footprint (narrowing under the shoulder) up to the highest of the
    // sides' tops (the neck's: there the glass's collider has its corners) and STAND_INTO over,
    // which lies inside the glass all along.
    const top = Y - B.neckR * k + STAND_INTO;
    const box = (y) => [[-w0, y, z0], [w0, y, z0], [w1, y, z1], [-w1, y, z1]];
    const [lo, hi] = [box(0), box(top)];
    const polys = [hi];
    for (let i = 0; i < 4; i++) polys.push([lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]]);
    solids.solid(polys, 'wood');
  }
  return B.bodyR * k;
}

// The two gold cradles across the stand: soft-edged side blocks out from it under a soft cap
// level with the putty sea, and on each side a cheek rising from the cap round the glass into
// its widest band, its outer side sloping in (drawn hugging the glass; its collider runs on
// across the cradle inside it).
function cradles(kit, { BOTTLE, CRADLES: C }, standX) {
  const { paint, solids } = kit;
  const h = C.top;
  const inner = glassUnderside(BOTTLE, h, C.cheekTop);
  const lip = inner[inner.length - 1];
  const outer = [[C.cheekFoot, h], [C.cheekX, C.cheekTop]];
  const profile = [...outer, ...[...inner].reverse()]; // a fan from the outer foot sees it all
  paint.color(TINT.brass);
  for (const z of C.zs) {
    const za = z - C.depth / 2;
    const zb = z + C.depth / 2;
    for (const s of [-1, 1]) {
      const at = ([x, y], zz) => [s * x, y, zz];
      // A side block (the middle is the stand) under a cap that overhangs it outward and along
      // the bottle.
      const [xa, xb] = s < 0 ? [-C.halfX, -standX] : [standX, C.halfX];
      softBox(paint, xa, xb, 0, h - 40, za, zb, ...CRADLE_ROUND.block);
      const [ca, cb] = s < 0 ? [xa - 20, xb] : [xa, xb + 20];
      softBox(paint, ca, cb, h - 44, h, za - 20, zb + 20, ...CRADLE_ROUND.cap);
      // The cheek: its two ends, its outer side and top, and its inner side along the glass.
      paint.poly(profile.map((p) => at(p, za)), { facing: [0, 0, -1] });
      paint.poly(profile.map((p) => at(p, zb)), { facing: [0, 0, 1] });
      paint.poly([at(outer[0], za), at(outer[0], zb), at(outer[1], zb), at(outer[1], za)], { facing: [s, 0, 0], shade: 0.9 });
      paint.poly([at(lip, za), at(outer[1], za), at(outer[1], zb), at(lip, zb)], { facing: [0, 1, 0] });
      for (let i = 0; i + 1 < inner.length; i++) {
        const [p, q] = [inner[i], inner[i + 1]];
        const facing = [-s * (p[0] + q[0]), 2 * BOTTLE.axisY - p[1] - q[1], 0]; // toward the axis
        paint.poly([at(p, za), at(q, za), at(q, zb), at(p, zb)], { facing, shade: 0.7 });
      }
    }
    solids.box(-C.halfX, C.halfX, 0, h, za, zb, 'wood');
    // The cheeks' collider: one prism across the cradle, its sides sloping in like theirs.
    const cheeks = (zz) => [[-C.cheekFoot, h, zz], [C.cheekFoot, h, zz], [C.cheekX, C.cheekTop, zz], [-C.cheekX, C.cheekTop, zz]];
    const [north, south] = [cheeks(za), cheeks(zb)];
    solids.solid([north, south, ...[0, 1, 2, 3].map((i) => [north[i], north[(i + 1) % 4], south[(i + 1) % 4], south[i]])], 'wood');
  }
}

// The putty sea in the bottle's body and the model of the first course on it.
function world(kit, B) {
  const { paint, lamp } = kit;
  const Y = B.axisY;
  // Putty: a chord of the body below the sea line, along the body.
  const z0 = B.body[0] + 60;
  const z1 = B.body[1] - 10;
  const top = Math.acos((SEA_Y - Y) / PUTTY_R); // angle off straight up where the putty meets the sea
  const arc = [];
  for (let i = 0; i <= 6; i++) {
    const a = top + ((Math.PI * 2 - 2 * top) * i) / 6;
    arc.push([Math.sin(a) * PUTTY_R, Y + Math.cos(a) * PUTTY_R]);
  }
  paint.color(TINT.putty);
  for (let i = 0; i + 1 < arc.length; i++) {
    const [xa, ya] = arc[i];
    const [xb, yb] = arc[i + 1];
    paint.poly([[xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]], { facing: [(xa + xb) / 2, (ya + yb) / 2 - Y, 0] });
  }
  const cap = (z, facing) => paint.poly(arc.map(([x, y]) => [x, y, z]), { facing });
  cap(z0, [0, 0, -1]);
  cap(z1, [0, 0, 1]);
  // The sea's surface in strips, every other one a lighter swell.
  const half = arc[0][0];
  const strips = 7;
  for (let i = 0; i < strips; i++) {
    const za = z0 + ((z1 - z0) * i) / strips;
    const zb = z0 + ((z1 - z0) * (i + 1)) / strips;
    paint.color(i % 2 ? TINT.wave : TINT.sea);
    paint.poly([[-half, SEA_Y, za], [half, SEA_Y, za], [half, SEA_Y, zb], [-half, SEA_Y, zb]], { facing: [0, 1, 0] });
  }

  // Islets (x, z, r, h): the skerries in the west, home with its meadow in the south, the
  // lighthouse's rock in the north.
  const islets = [
    [-60, -2560, 170, 36],
    [-250, -2860, 60, 24],
    [-280, -3110, 55, 30],
    [-240, -3360, 66, 24],
    [40, -3660, 150, 60],
  ];
  for (const [x, z, r, h] of islets) {
    paint.color(TINT.granite);
    paint.lathe(x, z, [[r, SEA_Y - 2], [r * 0.78, SEA_Y + h * 0.6], [r * 0.5, SEA_Y + h], [0, SEA_Y + h]], 7, { flat: true });
  }
  paint.color(TINT.meadow);
  paint.lathe(-60, -2560, [[100, SEA_Y + 36], [70, SEA_Y + 44], [0, SEA_Y + 46]], 7, { flat: true });

  // The red cottage on home's meadow.
  const cx = -90;
  const cz = -2540;
  const g = SEA_Y + 42;
  paint.color(TINT.falu);
  paint.box(cx - 40, cx + 40, g, g + 44, cz - 28, cz + 28, { bottom: false, top: false });
  paint.color(TINT.roof);
  paint.solid([
    [[cx - 46, g + 44, cz - 34], [cx + 46, g + 44, cz - 34], [cx + 46, g + 72, cz], [cx - 46, g + 72, cz]],
    [[cx - 46, g + 44, cz + 34], [cx + 46, g + 44, cz + 34], [cx + 46, g + 72, cz], [cx - 46, g + 72, cz]],
    [[cx - 46, g + 44, cz - 34], [cx - 46, g + 44, cz + 34], [cx - 46, g + 72, cz]],
    [[cx + 46, g + 44, cz - 34], [cx + 46, g + 44, cz + 34], [cx + 46, g + 72, cz]],
  ]);

  // The red-sailed boat in the middle of the bottle, bow to the lighthouse.
  const bx = 60;
  const stern = -2980;
  const bow = -3260;
  const keel = SEA_Y - 4;
  const deck = SEA_Y + 34;
  paint.color(TINT.hull);
  paint.solid([
    [[bx - 34, keel, stern], [bx + 34, keel, stern], [bx + 4, keel, bow + 40], [bx - 4, keel, bow + 40]],
    [[bx - 50, deck, stern + 10], [bx + 50, deck, stern + 10], [bx + 4, deck, bow], [bx - 4, deck, bow]],
    [[bx - 34, keel, stern], [bx + 34, keel, stern], [bx + 50, deck, stern + 10], [bx - 50, deck, stern + 10]],
    [[bx + 34, keel, stern], [bx + 4, keel, bow + 40], [bx + 4, deck, bow], [bx + 50, deck, stern + 10]],
    [[bx - 34, keel, stern], [bx - 4, keel, bow + 40], [bx - 4, deck, bow], [bx - 50, deck, stern + 10]],
    [[bx - 4, keel, bow + 40], [bx + 4, keel, bow + 40], [bx + 4, deck, bow], [bx - 4, deck, bow]],
  ]);
  const mz = (stern + bow) / 2 + 20;
  paint.color(TINT.mast);
  paint.box(bx - 5, bx + 5, deck, deck + 290, mz - 5, mz + 5, { bottom: false });
  // The sails, drawn from both sides: a red mainsail aft of the mast, a white jib forward.
  const sail = (pts, tint) => {
    paint.color(tint);
    paint.poly(pts, { facing: [1, 0, 0] });
    paint.poly(pts, { facing: [-1, 0, 0] });
  };
  sail([[bx, deck + 40, mz + 8], [bx, deck + 280, mz + 8], [bx, deck + 40, mz + 140]], TINT.sail);
  sail([[bx, deck + 30, mz - 8], [bx, deck + 250, mz - 8], [bx, deck + 30, bow + 14]], TINT.jib);

  // The lighthouse on its rock: white tower, red band, gallery, dark lantern (its lit lamp:
  // kit.lamp), red cap.
  const lx = 40;
  const lz = -3680;
  const foot = SEA_Y + 58;
  paint.color(TINT.white);
  paint.lathe(lx, lz, [[44, foot], [34, foot + 240]], 8, { flat: true });
  paint.color(TINT.red);
  paint.lathe(lx, lz, [[42, foot + 120], [40, foot + 160]], 8, { flat: true });
  paint.color(TINT.lantern);
  paint.lathe(lx, lz, [[0, foot + 240], [56, foot + 240], [56, foot + 250], [26, foot + 250], [26, foot + 292]], 8, { flat: true });
  paint.color(TINT.red);
  paint.lathe(lx, lz, [[26, foot + 292], [34, foot + 292], [0, foot + 334]], 8, { flat: true });
  // Lit: a glowing lamp swelling out of the lantern's dark frame, and the two beams, each a
  // horizontal and a vertical fan, thickest at the lamp and fading out (glow: the opacity).
  const ly = foot + 271;
  kit.lampAt = [lx, ly, lz];
  lamp.color(TINT.lamp);
  lamp.glow = 1;
  lamp.lathe(lx, lz, [[0, foot + 244], [32, foot + 250], [38, foot + 271], [32, foot + 292], [0, foot + 298]], 8, { flat: true });
  const { near, length, far, glow } = LAMP_BEAM;
  lamp.color(TINT.beam);
  lamp.glow = (x) => glow * (1 - Math.abs(x - lx) / length);
  for (const s of [1, -1]) {
    for (const up of [false, true]) {
      const at = (d, w) => (up ? [lx + s * d, ly + w, lz] : [lx + s * d, ly, lz + w]);
      lamp.poly([at(near, -near / 3), at(length, -far), at(length, far), at(near, near / 3)], { facing: up ? [0, 0, 1] : [0, 1, 0] });
    }
  }
  lamp.glow = 0;
}

// The dais in front of the bottle's mouth: a half-round stepped podium, its flat back on the
// mouth's plane. Drawn round (smooth, DAIS_DRAW.sides): each step a rose riser, darker toward
// the floor, under a cream tread with a rounded nosing; riser i stands half a tread out from
// where the collider's slope is at its height, so each tread's middle lies on the slope (he
// stands on the drawn treads, not a step under them); the top is the last tread, on into the
// middle, with a gold and Falu ring inlaid round it. The collider: a half-frustum of
// DAIS_DRAW.facets facets from the foot (rFoot, floor) to the top (rTop, top), not slippery.
// Between its corners a facet lies lower than the round slope (by the sagitta's share of the
// rise there), so every tread below the top is drawn half that much lower at its middle: his
// feet keep as near it in the middle of a facet as on a corner.
function dais(kit, { DAIS: D }) {
  const { trim, paint, solids } = kit;
  const { sides, nose, noseDrop, facets } = DAIS_DRAW;
  const run = (D.rFoot - D.rTop) / D.steps;
  const rise = D.top / D.steps;
  const sag = (r) => ((rise / run) * r * (1 / Math.cos(Math.PI / 2 / facets) - 1)) / 2;
  // From the west (-x) round the south (+z) to the east: the half toward the room.
  const half = { a0: -Math.PI / 2, arc: Math.PI };
  let y0 = 0;
  for (let i = 0; i < D.steps; i++) {
    const rOut = D.rFoot - run * (i + 0.5); // riser i
    const rIn = i + 1 === D.steps ? 0 : rOut - run; // riser i + 1 (the top runs on into the middle)
    const y1 = rise * (i + 1) - (rIn > 0 ? sag(rOut - run / 2) : 0);
    trim.color(TINT.rose);
    trim.shade = (px, py) => 0.86 + 0.14 * (py / D.top);
    trim.lathe(D.x, D.z, [[rOut + nose, y0], [rOut + nose, y1 - noseDrop]], sides, half);
    trim.shade = null;
    trim.color(TINT.cream);
    const tread = [[rOut + nose, y1 - noseDrop], [rOut + 2, y1 - 3], [rOut - 8, y1], [rIn > 0 ? rIn + nose : 0, y1]];
    trim.lathe(D.x, D.z, tread, sides, { ...half, smoothProfile: true, vMode: 'plan' });
    // Its share of the flat back, either side of the middle.
    for (const s of [-1, 1]) {
      const [ra, rb] = [rIn > 0 ? rIn + nose : 0, rOut + nose];
      trim.poly([[s * ra, 0, D.z], [s * rb, 0, D.z], [s * rb, y1, D.z], [s * ra, y1, D.z]], { facing: [0, 0, -1], shade: 0.85 });
    }
    y0 = y1;
  }
  for (const [r1, r0, tint] of DAIS_DRAW.inlay) {
    paint.color(TINT[tint]);
    paint.lathe(D.x, D.z, [[r1, D.top + 2], [r0, D.top + 2]], sides, half);
  }
  const ring = (r, y) => Array.from({ length: facets + 1 }, (_, k) => {
    const a = half.a0 + (half.arc * k) / facets;
    return [D.x + Math.sin(a) * r, y, D.z + Math.cos(a) * r];
  });
  const [foot, head] = [ring(D.rFoot, 0), ring(D.rTop, D.top)];
  const polys = [head, [foot[0], head[0], head[facets], foot[facets]]];
  for (let k = 0; k < facets; k++) polys.push([foot[k], foot[k + 1], head[k + 1], head[k]]);
  solids.solid(polys, 'stone', 'not_slippery');
}

// The giant cork standing upright in the apse's east flank (round, smooth: a darker ring round
// its foot where it was in the bottle's neck, a lighter top), an octagonal collider.
function cork(kit, { CORK }) {
  const { paint, solids } = kit;
  const { x, z, r, top } = CORK;
  paint.color(TINT.corkRing);
  paint.lathe(x, z, [[r, 0], [r - 4, 60]], 16);
  paint.color(TINT.cork);
  paint.lathe(x, z, [[r - 4, 60], [r - 22, top - 20]], 16);
  paint.color(TINT.cork, 1.08);
  paint.lathe(x, z, [[r - 22, top - 20], [r - CORK_TAPER, top], [0, top]], 16);
  const ring = (rr, y) => Array.from({ length: 8 }, (_, i) => [x + Math.sin((i * Math.PI) / 4) * rr, y, z + Math.cos((i * Math.PI) / 4) * rr]);
  const [foot, head] = [ring(r, 0), ring(r - CORK_TAPER, top)];
  solids.solid([head, ...foot.map((p, i) => [p, foot[(i + 1) % 8], head[(i + 1) % 8], head[i]])], 'wood');
}

// The two giant books stacked like steps up to the cork, each lying on the one below: cover
// boards top and bottom; the cream page block between them set in from their edges, so the
// covers overhang it, with two darker page lines, showing at the west end and along the south
// side toward the hall (the fore-edge); a rounded spine in the cover's colour along the north
// side, between the boards' edges, with two gold bands round it. A wooden box each as its
// collider.
function books(kit, { BOOKS }) {
  const { paint, solids } = kit;
  const { z0, z1, x1 } = BOOKS;
  const { board, inset } = BOOK;
  let base = 0;
  BOOKS.stack.forEach(({ x0, top }, i) => {
    const cover = TINT.books[i % TINT.books.length];
    paint.color(cover);
    paint.box(x0, x1, base, base + board, z0, z1, { bottom: false });
    paint.box(x0, x1, top - board, top, z0, z1, { bottom: false });
    // The page block's west end and south side, in bands: pages, a line, pages, a line, pages.
    const [ya, yb] = [base + board, top - board];
    const cuts = [ya];
    for (const t of BOOK.lines) cuts.push(ya + (yb - ya) * t - BOOK.line / 2, ya + (yb - ya) * t + BOOK.line / 2);
    cuts.push(yb);
    const [px, pz] = [x0 + inset, z1 - inset];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [c0, c1] = [cuts[k], cuts[k + 1]];
      paint.color(k % 2 ? TINT.pageLine : TINT.pages);
      paint.poly([[px, c0, z0], [px, c0, pz], [px, c1, pz], [px, c1, z0]], { facing: [-1, 0, 0] });
      paint.poly([[px, c0, pz], [x1, c0, pz], [x1, c1, pz], [px, c1, pz]], { facing: [0, 0, 1] });
    }
    // The spine: a half-ellipse swept (westward) along the north side, closed at its ends.
    const mid = (base + top) / 2;
    const rr = (top - base - board) / 2;
    const spine = Array.from({ length: BOOK.spineSegs + 1 }, (_, k) => {
      const a = (k / BOOK.spineSegs) * Math.PI;
      return [BOOK.spine * Math.sin(a), mid - rr * Math.cos(a)];
    });
    const along = (xa, xb, w) => [{ p: [xb, 0, z0 - w], n: [0, 0, -1], b: [0, 1, 0] }, { p: [xa, 0, z0 - w], n: [0, 0, -1], b: [0, 1, 0] }];
    paint.color(cover);
    sweep(paint, along(x0, x1, 0), spine, { caps: true });
    paint.color(TINT.gold);
    for (const u of BOOK.bands) sweep(paint, along(x0 + u, x0 + u + BOOK.band, 1), spine, { caps: true });
    solids.box(x0, x1, 0, top, z0, z1, 'wood');
    base = top;
  });
}
