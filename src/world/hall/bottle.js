// The north end of the Great Hall (hall/layout.js): the giant ship in a bottle on its oak stand,
// the little world inside it, and the way up to its mouth (the landing, the stairs, and a cork
// and a stack of books to hop up on). Written into the hall's kit (hall/hall.js): render faces
// into its material builders, colliders into kit.solids.
//
//   buildBottle(kit, layout)
//
// The glass (kit.bottle, drawn transparent, its edges paler and more opaque where the view
// grazes it: hall.js) is the bottle's outer surface only, 16 sides round its axis, so it never
// lies over itself (a highlight stripe runs along it). Its collider is convex solids round the
// axis (body, shoulder frustum, neck and lip; slippery stone), each with a vertical face across
// its widest band (a wall the camera's path check stops at). It lies on a dark oak stand, set
// back under the glass, with two lighter carved cradles across it. No spot Jonas can stand on
// is lower than HEADROOM under the glass (layout.js): the stand runs the bottle's length and
// rises round the glass's underside to 45 degrees either side of straight down, where the
// glass is high enough over the floor beside it, and the cradles' cheeks rise round the glass
// into its widest band, so neither leaves a ledge under it.
// Inside lies a putty sea with a model of the first course (kit.paint): pink granite islets, a
// red cottage, a red-sailed boat and a white lighthouse with a red band, whose lamp (kit.lamp,
// its own mesh) is lit once that course's star is won. The mouth (the lip's end face) is the
// door Jonas walks into from the landing. The stairs are a smooth ramp collider (not slippery)
// under 11 drawn steps between two sloping stringers.

const TINT = {
  glass: 0xbfe3d6,
  shine: 0xffffff,
  oak: 0xd2a070,
  stand: 0x6a4630,
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
  lamp: 0xffe08a,
  cork: 0xc89a62,
  corkRing: 0xa87a48,
  pages: 0xf0e6cc,
  gold: 0xe0b040,
  books: [0x9c2a2a, 0x2a4a8c, 0x2f6b3f],
};

const DECK = 1.7; // the landing's and the stairs' light oak (the wood texture is dark brown)
const SIDES = 16; // the glass round its axis
const SHINE = [0.45, 0.85]; // the highlight stripe: this far west of straight up (radians)
const KEEL = Math.PI / 4; // the stand rises round the glass this far either side of straight down
const GAP = 14; // its top's inner corners lie this far inside the glass (under the body: inside the putty)
const RAIL = 40; // the lighter rail along the top of its sides
const CORK_TAPER = 30; // the cork narrows by this much from its foot to its top
const SEA_Y = 420; // the putty sea's surface inside the body (the cradles' top)
const PUTTY_R = 512; // the putty's curved underside, just inside the glass
// Corners (degrees round the axis, 0 straight up, 90 east) of the colliders' cross-sections:
// one straight up and one straight down, and a vertical face across the widest band. With a
// corner at the widest point the faces either side would be a steep floor and a steep ceiling,
// and the follow camera's path check leaves floors to its height limit: a C-button swing could
// carry it into the glass. A wall stops it.
const BODY_RING = [0, 30, 60, 75, 105, 120, 150, 180, 210, 240, 255, 285, 300, 330];
const NECK_RING = [0, 45, 70, 110, 135, 180, 225, 250, 290, 315];

export function buildBottle(kit, layout) {
  glass(kit, layout.BOTTLE);
  const halfX = stand(kit, layout);
  cradles(kit, layout, halfX);
  world(kit, layout.BOTTLE);
  landing(kit, layout);
  toys(kit, layout);
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
  solids.solid(axialSolid(Y, bodyR, neckR, B.shoulder[0], B.shoulder[1], BODY_RING), 'stone', 'slippery');
  solids.solid(axialSolid(Y, neckR, neckR, B.neck[0], B.lip[0], NECK_RING), 'stone', 'slippery');
  solids.solid(axialSolid(Y, lipR, lipR, B.lip[0], B.lip[1], NECK_RING), 'stone', 'slippery');
}

// The stand under the bottle, its whole length from its end to the landing: dark oak rising
// round the glass to its corners 45 degrees (KEEL) either side of straight down, its sides
// straight down from there to the floor, so its half-width follows the glass (the body,
// narrowing under the shoulder, the neck and lip). Beside it the glass is at least HEADROOM
// over the floor (layout.js). Its top is the glass's underside (drawn a little inside it: under
// the body, inside the putty, which hides it); its colliders are flat-topped boxes whose tops
// lie inside the glass (at worst a sliver under it, far too low to stand in). Dark, in the
// glass's shadow, so the glass's curve reads over it. Returns its half-width under the body.
function stand(kit, { BOTTLE: B }) {
  const { wood, solids } = kit;
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
  for (const [r0, r1, z0, z1] of sections) {
    const [w0, w1] = [r0 * k, r1 * k];
    const [h0, h1] = [Y - r0 * k, Y - r1 * k];
    // Its sides, dark below a lighter rail along their top.
    for (const s of [-1, 1]) {
      wood.color(TINT.stand);
      wood.poly([[s * w0, 0, z0], [s * w1, 0, z1], [s * w1, h1 - RAIL, z1], [s * w0, h0 - RAIL, z0]], { facing: [s, 0, 0], shade: [0.5, 0.5, 0.75, 0.75] });
      wood.color(TINT.oak, 1.3);
      wood.poly([[s * w0, h0 - RAIL, z0], [s * w1, h1 - RAIL, z1], [s * w1, h1, z1], [s * w0, h0, z0]], { facing: [s, 0, 0] });
    }
    // The top: the glass's facets, its inner corners sunk GAP toward the axis.
    wood.color(TINT.stand);
    const corner = (r, i, z) => onAxis(Y, i === 0 || i === steps ? r : r - GAP, a0 + (i * 2 * KEEL) / steps, z);
    for (let i = 0; i < steps; i++) {
      const aM = a0 + ((i + 0.5) * 2 * KEEL) / steps;
      const facing = [-Math.sin(aM) * (z1 - z0), -Math.cos(aM) * (z1 - z0), r1 - r0]; // toward the axis
      wood.poly([corner(r0, i, z0), corner(r0, i + 1, z0), corner(r1, i + 1, z1), corner(r1, i, z1)], { facing });
    }
    // Its collider: the footprint (narrowing under the shoulder) up to its sides' highest top.
    const top = Y - Math.min(r0, r1) * k;
    const box = (y) => [[-w0, y, z0], [w0, y, z0], [w1, y, z1], [-w1, y, z1]];
    const [lo, hi] = [box(0), box(top)];
    const polys = [hi];
    for (let i = 0; i < 4; i++) polys.push([lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]]);
    solids.solid(polys, 'wood');
  }
  return B.bodyR * k;
}

// The two carved cradles across the stand: side blocks out from it under a moulded cap level
// with the putty sea, and on each side a cheek rising from the cap round the glass into its
// widest band, its outer side sloping in (drawn hugging the glass; its collider runs on across
// the cradle inside it).
function cradles(kit, { BOTTLE, CRADLES: C }, standX) {
  const { wood, solids } = kit;
  const h = C.top;
  const inner = glassUnderside(BOTTLE, h, C.cheekTop);
  const lip = inner[inner.length - 1];
  const outer = [[C.cheekFoot, h], [C.cheekX, C.cheekTop]];
  const profile = [...outer, ...[...inner].reverse()]; // a fan from the outer foot sees it all
  for (const z of C.zs) {
    const za = z - C.depth / 2;
    const zb = z + C.depth / 2;
    for (const s of [-1, 1]) {
      const at = ([x, y], zz) => [s * x, y, zz];
      wood.color(TINT.oak, 1.3);
      // A side block (the middle is the stand) under a cap that overhangs it outward and along
      // the bottle.
      const [xa, xb] = s < 0 ? [-C.halfX, -standX] : [standX, C.halfX];
      wood.box(xa, xb, 0, h - 40, za, zb, { bottom: false, top: false, shade: 0.8 });
      const [ca, cb] = s < 0 ? [xa - 20, xb] : [xa, xb + 20];
      wood.box(ca, cb, h - 40, h, za - 20, zb + 20, { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
      // The cheek: its two ends, its outer side and top, and its inner side along the glass.
      wood.poly(profile.map((p) => at(p, za)), { facing: [0, 0, -1] });
      wood.poly(profile.map((p) => at(p, zb)), { facing: [0, 0, 1] });
      wood.poly([at(outer[0], za), at(outer[0], zb), at(outer[1], zb), at(outer[1], za)], { facing: [s, 0, 0], shade: 0.9 });
      wood.poly([at(lip, za), at(outer[1], za), at(outer[1], zb), at(lip, zb)], { facing: [0, 1, 0] });
      for (let i = 0; i + 1 < inner.length; i++) {
        const [p, q] = [inner[i], inner[i + 1]];
        const facing = [-s * (p[0] + q[0]), 2 * BOTTLE.axisY - p[1] - q[1], 0]; // toward the axis
        wood.poly([at(p, za), at(q, za), at(q, zb), at(p, zb)], { facing, shade: 0.7 });
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
  lamp.color(TINT.lamp);
  lamp.lathe(lx, lz, [[28, foot + 252], [28, foot + 290]], 8, { flat: true });
}

// The landing in front of the bottle's mouth and the stairs up to it.
function landing(kit, { LANDING: L, STAIRS: S }) {
  const { wood, solids } = kit;
  wood.color(0xffffff, DECK);
  wood.shade = (px, py) => 0.62 + 0.38 * Math.min(1, py / L.top);
  wood.box(L.x0, L.x1, 0, L.top, L.z0, L.z1, { bottom: false });
  solids.box(L.x0, L.x1, 0, L.top, L.z0, L.z1, 'wood');

  // Drawn steps: each tread's middle on the ramp, the last one the landing's edge.
  const run = S.z0 - S.z1;
  const rise = S.top / S.steps;
  const tread = run / S.steps;
  for (let i = 0; i < S.steps; i++) {
    const y = rise * (i + 1);
    const front = S.z0 - tread * (i + 0.5);
    const back = i === S.steps - 1 ? S.z1 : front - tread;
    wood.poly([[S.x0, y - rise, front], [S.x1, y - rise, front], [S.x1, y, front], [S.x0, y, front]], { facing: [0, 0, 1], shade: 0.5 });
    wood.poly([[S.x0, y, front], [S.x1, y, front], [S.x1, y, back], [S.x0, y, back]], { facing: [0, 1, 0], shade: 1.12 });
  }
  wood.shade = null;
  // The stringers either side, dark, their tops along the ramp (the stair's slope reads from
  // the front), its collider running on under them.
  const { z0, z1, top } = S;
  wood.color(TINT.stand);
  for (const [xi, xo] of [[S.x0, S.x0 - S.stringer], [S.x1, S.x1 + S.stringer]]) {
    wood.poly([[xo, 0, z0], [xo, top, z1], [xo, 0, z1]], { facing: [xo - xi, 0, 0], shade: 0.8 });
    wood.poly([[xi, 0, z0], [xi, top, z1], [xi, 0, z1]], { facing: [xi - xo, 0, 0], shade: 0.6 });
    wood.poly([[xi, 0, z0], [xo, 0, z0], [xo, top, z1], [xi, top, z1]], { facing: [0, z0 - z1, top], shade: 1.1 });
  }
  // The ramp: a wedge from the floor at z0 up to the landing at z1, as wide as the stringers.
  const x0 = S.x0 - S.stringer;
  const x1 = S.x1 + S.stringer;
  const ramp = [
    [[x0, 0, z0], [x1, 0, z0], [x1, top, z1], [x0, top, z1]],
    [[x0, 0, z0], [x0, 0, z1], [x0, top, z1]],
    [[x1, 0, z0], [x1, 0, z1], [x1, top, z1]],
    [[x0, 0, z1], [x1, 0, z1], [x1, top, z1], [x0, top, z1]],
  ];
  solids.solid(ramp, 'wood', 'not_slippery');
}

// The cork (an octagonal prism, standing on its wide end, a darker ring round its foot where
// it was in the bottle's neck) and the stack of books by the landing.
function toys(kit, { CORK, BOOKS }) {
  const { paint, solids } = kit;
  const { x, z, r, top } = CORK;
  paint.color(TINT.corkRing);
  paint.lathe(x, z, [[r, 0], [r - 4, 60]], 8, { flat: true });
  paint.color(TINT.cork);
  paint.lathe(x, z, [[r - 4, 60], [r - 22, top - 20]], 8, { flat: true });
  paint.color(TINT.cork, 1.08);
  paint.lathe(x, z, [[r - 22, top - 20], [r - CORK_TAPER, top], [0, top]], 8, { flat: true });
  const ring = (rr, y) => Array.from({ length: 8 }, (_, i) => [x + Math.sin((i * Math.PI) / 4) * rr, y, z + Math.cos((i * Math.PI) / 4) * rr]);
  const [foot, head] = [ring(r, 0), ring(r - CORK_TAPER, top)];
  solids.solid([head, ...foot.map((p, i) => [p, foot[(i + 1) % 8], head[(i + 1) % 8], head[i]])], 'wood');

  // Each book lies on the one below: boards top and bottom, the page block between them (inset
  // at the ends and the back), the spine toward the hall with two gold bands.
  const { z0, z1, x1 } = BOOKS;
  let base = 0;
  BOOKS.stack.forEach(({ x0, top: t }, i) => {
    const cover = TINT.books[i % TINT.books.length];
    paint.color(cover);
    paint.box(x0, x1, base, base + 18, z0, z1, { bottom: false });
    paint.box(x0, x1, t - 18, t, z0, z1, { bottom: false });
    paint.box(x0, x1, base + 18, t - 18, z1 - 22, z1, { bottom: false, top: false });
    paint.color(TINT.pages);
    paint.box(x0 + 14, x1, base + 18, t - 18, z0 + 14, z1 - 22, { bottom: false, top: false, shade: 0.95 });
    paint.color(TINT.gold);
    for (const bx of [x0 + 50, x1 - 70]) {
      paint.poly([[bx, base + 22, z1 + 1], [bx + 20, base + 22, z1 + 1], [bx + 20, t - 22, z1 + 1], [bx, t - 22, z1 + 1]], { facing: [0, 0, 1] });
    }
    solids.box(x0, x1, 0, t, z0, z1, 'wood');
    base = t;
  });
}
