// The castle building: an original fairy-tale design laid out around layout.CASTLE.
//
//   front (+Z)  corner tower · wing · entrance tower · hall (door, balcony, rose window,
//               gable roof) · entrance tower · wing · corner tower; a porch with broad steps
//               before the door that the two entrance towers stand on
//   middle      side towers rising where the wings meet the taller rear block
//   centre      square keep with a round upper tower, conical roof and banner
//   back (-Z)   rear block with two rear corner towers
//
// All sizes derive from the CASTLE anchors so the silhouette scales with the layout.

import { archContour, hexaPolys, localBoxPolys, wallFrame } from './geom.js';
import { TINT, archWindow, flagpole, merlonRow, roundTower, roundWindow, stringCourse } from './parts.js';

const PLINTH_H = 140; // stone base course; the door threshold sits on top of it
// Door steps: a porch on the base course that the entrance towers stand on, then three steps
// down to the courtyard (see steps()).
const STEPS = { landing: 290, tread: 70 };
const COURSE_1 = 880; // string courses (above baseY), continuous across walls and towers
const COURSE_2 = 1480;
// Window sizes: few, varied openings; the roofs and towers carry the silhouette.
const WIN = {
  tall: { w: 130, h: 400 },
  std: { w: 120, h: 360 },
  large: { w: 150, h: 440 },
  slit: { w: 50, h: 180, border: 16 },
};
const SLIT = WIN.slit;

export function buildCastleBody(kit, C) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;
  const MH = C.mainHeight;
  const d = {
    hallHW: 600,
    hallTop: B + MH,
    hallBackZ: F - 1300,
    wingTop: B + Math.round(MH * 0.84),
    wingBackZ: F - 1600,
    cornerR: 350,
    cornerX: C.halfWidth - 350,
    cornerZ: F - 100,
    entryX: 720,
    entryR: 190,
    sideX: 1250,
    sideR: 250,
    rearX: C.halfWidth - 500,
    rearBackZ: C.backZ + 200,
    rearTop: B + MH + 300,
    rearTowerR: 330,
    bayR: 320,
    keepHW: 600,
    keepBase: B + Math.round(MH / 2),
    keepBackZ: F - 2600,
    keepTop: B + MH + 1200,
    keepTowerTop: B + MH + 1900,
  };
  blocks(kit, C, d);
  towers(kit, C, d);
  entrance(kit, C, d);
  windows(kit, C, d);
}

// ---------------------------------------------------------------- volumes

// Stone base course with a dark foot (fake ambient occlusion where it meets the ground).
function plinth(kit, x0, x1, z0, z1, y, o = 30) {
  kit.trim.color(TINT.stone);
  kit.trim.shade = (px, py) => 0.7 + 0.3 * Math.min(1, Math.max(0, (py - y) / PLINTH_H));
  kit.trim.box(x0 - o, x1 + o, y, y + PLINTH_H, z0 - o, z1 + o, { bottom: false });
  kit.trim.shade = null;
  kit.solids.box(x0 - o, x1 + o, y, y + PLINTH_H, z0 - o, z1 + o, 'stone');
}

// Stone cornice band at a wall top; with `walkway` its top is the flat stone roof.
function cornice(kit, x0, x1, z0, z1, y, { walkway = true, o = 18 } = {}) {
  kit.trim.color(TINT.stone);
  kit.trim.box(x0 - o, x1 + o, y - 50, y, z0 - o, z1 + o, { bottom: true, top: false });
  if (!walkway) return;
  kit.trim.color(TINT.roofFlat);
  kit.trim.poly(
    [
      [x0 - o, y, z0 - o],
      [x1 + o, y, z0 - o],
      [x1 + o, y, z1 + o],
      [x0 - o, y, z1 + o],
    ],
    { facing: [0, 1, 0] },
  );
}

// Cream wall block (no top/bottom faces) plus its collider.
function wallBlock(kit, x0, x1, y0, y1, z0, z1) {
  kit.wall.color(TINT.wall);
  kit.wall.box(x0, x1, y0, y1, z0, z1, { bottom: false, top: false });
  kit.solids.box(x0, x1, y0, y1, z0, z1, 'stone', { bottom: false, top: true });
}

function blocks(kit, C, d) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;

  // Front wings either side of the hall, and the base course under the whole front block.
  for (const s of [-1, 1]) {
    const xa = X + s * d.hallHW;
    const xb = X + s * d.cornerX;
    wallBlock(kit, Math.min(xa, xb), Math.max(xa, xb), B, d.wingTop, d.wingBackZ, F);
    cornice(kit, Math.min(xa, xb), Math.max(xa, xb), d.wingBackZ, F, d.wingTop);
    // Battlements on the front and outer side edges, clear of the towers.
    const entryOuter = d.entryX + d.entryR + 30;
    const cornerInner = d.cornerX - d.cornerR - 25;
    merlonRow(kit, [X + s * entryOuter, F], [X + s * cornerInner, F], d.wingTop, [0, 1]);
    merlonRow(kit, [X + s * d.cornerX, d.cornerZ - d.cornerR - 25], [X + s * d.cornerX, d.wingBackZ], d.wingTop, [s, 0]);
  }
  plinth(kit, X - d.cornerX, X + d.cornerX, d.wingBackZ, F, B);
  stringCourse(kit, X - d.cornerX, X + d.cornerX, d.wingBackZ, F, B + COURSE_1);

  // Hall: taller central block with a steep gable roof running back into the keep.
  wallBlock(kit, X - d.hallHW, X + d.hallHW, B, d.hallTop, d.hallBackZ, F);
  cornice(kit, X - d.hallHW, X + d.hallHW, d.hallBackZ, F, d.hallTop, { walkway: false });
  gableRoof(kit, C, d);

  // Rear block: taller still, with battlements and its own base course.
  const rz0 = d.rearBackZ;
  const rz1 = d.wingBackZ;
  wallBlock(kit, X - d.rearX, X + d.rearX, B, d.rearTop, rz0, rz1);
  cornice(kit, X - d.rearX, X + d.rearX, rz0, rz1, d.rearTop);
  plinth(kit, X - d.rearX, X + d.rearX, rz0, rz1, B);
  for (const y of [COURSE_1, COURSE_2]) stringCourse(kit, X - d.rearX, X + d.rearX, rz0, rz1, B + y);
  const rearTowerInner = C.halfWidth - d.rearTowerR - d.rearTowerR - 30;
  for (const s of [-1, 1]) {
    merlonRow(kit, [X + s * (d.keepHW + 30), rz1], [X + s * (d.sideX - d.sideR - 30), rz1], d.rearTop, [0, 1]);
    merlonRow(kit, [X + s * (d.sideX + d.sideR + 30), rz1], [X + s * d.rearX, rz1], d.rearTop, [0, 1]);
    merlonRow(kit, [X + s * d.rearX, rz1], [X + s * d.rearX, C.backZ + 2 * d.rearTowerR + 30], d.rearTop, [s, 0]);
  }
  for (const s of [-1, 1]) merlonRow(kit, [X + s * rearTowerInner, rz0], [X + s * (d.bayR + 40), rz0], d.rearTop, [0, -1]);

  // Keep: square tower rising from the middle, battlements around its top.
  const kz0 = d.keepBackZ;
  const kz1 = d.hallBackZ;
  wallBlock(kit, X - d.keepHW, X + d.keepHW, d.keepBase, d.keepTop, kz0, kz1);
  cornice(kit, X - d.keepHW, X + d.keepHW, kz0, kz1, d.keepTop);
  const k = [
    [X - d.keepHW, kz1],
    [X + d.keepHW, kz1],
    [X + d.keepHW, kz0],
    [X - d.keepHW, kz0],
  ];
  const outs = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (let i = 0; i < 4; i++) merlonRow(kit, k[i], k[(i + 1) % 4], d.keepTop, outs[i]);
}

// Steep two-slope roof over the hall with a cream gable above the rose window.
function gableRoof(kit, C, d) {
  const X = C.x;
  const F = C.frontZ;
  const over = 60;
  const EW = d.hallHW + over; // eave half-width
  const EY = d.hallTop - 40; // eave height (top surface)
  const pitch = 1.05;
  const RY = EY + EW * pitch; // ridge height
  const th = 30;
  const zf = F + over;
  const zb = d.hallBackZ;
  const slope = Math.hypot(1, pitch);
  const { roof, wall, solids } = kit;
  roof.color(TINT.wall);
  for (const s of [-1, 1]) {
    const ex = X + s * EW;
    const corners = [
      [X, RY - th, zf],
      [ex, EY - th, zf],
      [ex, EY - th, zb],
      [X, RY - th, zb],
      [X, RY, zf],
      [ex, EY, zf],
      [ex, EY, zb],
      [X, RY, zb],
    ];
    roof.solid(hexaPolys(corners), {
      // Tile rows run along the ridge; v climbs from the eave to the ridge.
      uv: (p) => [(p[2] * s) / roof.repeat, ((EW - Math.abs(p[0] - X)) * slope) / roof.repeat],
      faceShade: (n) => (n[1] < -0.3 ? 0.45 : n[2] > 0.9 ? 0.75 : 1),
    });
  }
  // Ridge capping.
  roof.color(TINT.wall, 0.8);
  roof.box(X - 26, X + 26, RY - 16, RY + 22, zb, zf + 8, { bottom: false });
  // Gable wall (its corners tuck into the roof slabs).
  wall.color(TINT.wall);
  wall.poly(
    [
      [X - d.hallHW, d.hallTop, F],
      [X + d.hallHW, d.hallTop, F],
      [X, RY - th, F],
    ],
    { facing: [0, 0, 1] },
  );
  solids.solid(
    [
      [
        [X - EW, EY, zf],
        [X + EW, EY, zf],
        [X, RY, zf],
      ],
      [
        [X - EW, EY, zb],
        [X + EW, EY, zb],
        [X, RY, zb],
      ],
      [
        [X - EW, EY, zf],
        [X, RY, zf],
        [X, RY, zb],
        [X - EW, EY, zb],
      ],
      [
        [X + EW, EY, zf],
        [X, RY, zf],
        [X, RY, zb],
        [X + EW, EY, zb],
      ],
    ],
    'stone',
  );
}

// ---------------------------------------------------------------- towers

function towers(kit, C, d) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;
  const MH = C.mainHeight;
  const half = Math.PI / 2;
  for (const s of [-1, 1]) {
    // Front corner towers.
    roundTower(kit, {
      x: X + s * d.cornerX,
      z: d.cornerZ,
      r: d.cornerR,
      base: B,
      top: B + MH + 350,
      roofH: 1000,
      bands: [B + COURSE_1],
      windows: [
        { angle: 0, sill: B + 480, w: 110, h: 300 },
        { angle: s * half, sill: B + 520, ...SLIT },
        { angle: 0, sill: B + 1180, w: 110, h: 300 },
        { angle: s * half, sill: B + 1180, w: 110, h: 300 },
        { angle: (s * Math.PI) / 4, sill: B + 1820, w: 90, h: 240 },
      ],
    });
    // Slim towers flanking the entrance.
    roundTower(kit, {
      x: X + s * d.entryX,
      z: F + 20,
      r: d.entryR,
      sides: 12,
      base: B,
      top: B + MH + 400,
      roofH: 720,
      bands: [B + COURSE_1],
      windows: [
        { angle: 0, sill: B + 1180, w: 70, h: 210 },
        { angle: s * half, sill: B + 1760, w: 70, h: 210 },
      ],
    });
    // Side towers where the wings meet the rear block.
    roundTower(kit, {
      x: X + s * d.sideX,
      z: d.wingBackZ,
      r: d.sideR,
      sides: 12,
      base: d.wingTop - 100,
      top: B + MH + 1000,
      roofH: 820,
      plinth: false,
      windows: [
        { angle: 0, sill: d.rearTop + 150, w: 90, h: 250 },
        { angle: s * half, sill: d.rearTop + 150, w: 90, h: 250 },
      ],
    });
    // Rear corner towers.
    roundTower(kit, {
      x: X + s * (C.halfWidth - d.rearTowerR),
      z: C.backZ + d.rearTowerR,
      r: d.rearTowerR,
      base: B,
      top: B + MH + 700,
      roofH: 950,
      bands: [B + COURSE_1, B + COURSE_2],
      windows: [
        { angle: Math.PI, sill: B + 480, ...SLIT },
        { angle: Math.PI, sill: B + 1100, w: 100, h: 280 },
        { angle: s * half, sill: B + 1120, ...SLIT },
        { angle: (s * Math.PI * 3) / 4, sill: B + 2250, w: 90, h: 240 },
      ],
    });
  }
  // Round bay in the middle of the back wall, breaking up the long rear facade.
  roundTower(kit, {
    x: X,
    z: d.rearBackZ,
    r: d.bayR,
    base: B,
    top: d.rearTop + 450,
    roofH: 880,
    bands: [B + COURSE_1, B + COURSE_2],
    windows: [
      { angle: Math.PI, sill: B + 960, w: 140, h: 420 },
      { angle: Math.PI, sill: B + 1640, w: 90, h: 260 },
      { angle: Math.PI * 0.75, sill: B + 420, ...SLIT },
      { angle: Math.PI * 1.25, sill: B + 420, ...SLIT },
    ],
  });
  // Round upper keep with the tallest roof; the banner pole reaches keepTopY.
  const keepZ = (d.keepBackZ + d.hallBackZ) / 2;
  const roofTip = C.keepTopY - 380;
  roundTower(kit, {
    x: X,
    z: keepZ,
    r: 420,
    base: d.keepTop,
    top: d.keepTowerTop,
    roofH: roofTip - d.keepTowerTop,
    plinth: false,
    pennant: false,
    windows: [0, 1, 2, 3].map((i) => ({ angle: (i * Math.PI) / 2, sill: d.keepTop + 200, w: 100, h: 280 })),
  });
  flagpole(kit, X, keepZ, roofTip - 40, C.keepTopY, { kind: 'banner', len: 380, height: 230 });
}

// ---------------------------------------------------------------- entrance

function entrance(kit, C, d) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;
  const facade = wallFrame([X, B, F], [0, 0, 1]);
  const doorSill = PLINTH_H;
  steps(kit, C, d);
  door(kit, wallFrame([X, B + doorSill, F], [0, 0, 1]), C.doorWidth, C.doorHeight);
  const balconyY = doorSill + C.doorHeight + 100;
  balcony(kit, facade, balconyY, 360, 170);
  // Rose window centred between the balcony parapet and the gable.
  const roseR = 250;
  const roseCY = balconyY + 130 + 46 + roseR + 40;
  roundWindow(kit, facade, roseCY, roseR, { border: 46, depth: 40, glass: true, segs: 24 });
  // Small oculus in the gable.
  roundWindow(kit, facade, d.hallTop - B + 230, 75, { border: 28, depth: 26, segs: 12 });
}

// Porch (landing) on the base course plus three steps down to the courtyard, all as wide as
// the pair of entrance towers, which stand on the porch: the porch runs far enough past each
// tower's round base (in front and on its outer side) to walk round it on top. (Narrower
// door steps left a crack between the landing or the ramp's side and each tower's base,
// narrower than the hero, which he dropped into or was shoved sideways out of.) The collider
// is a smooth ramp so walking up never snags on the risers.
function steps(kit, C, d) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;
  const { landing, tread } = STEPS;
  const hw = d.entryX + d.entryR + 90;
  const rise = PLINTH_H / 4;
  kit.trim.color(TINT.stone);
  kit.trim.shade = (px, py) => (py <= B + 1 ? 0.75 : 1);
  kit.trim.box(X - hw, X + hw, B, B + PLINTH_H, F - 10, F + landing, { bottom: false });
  for (let i = 1; i <= 3; i++) {
    const z0 = F + landing + (i - 1) * tread;
    kit.trim.box(X - hw, X + hw, B, B + PLINTH_H - i * rise, z0 - 2, z0 + tread, { bottom: false });
  }
  kit.trim.shade = null;
  // Landing and ramp are one convex solid (a trapezoid in profile, extruded across). As two
  // solids, the landing's front face and the ramp's back face met at zTop facing opposite
  // ways: beside the steps they shoved the hero along z and masked the side face.
  const zTop = F + landing;
  const zFoot = zTop + 3 * tread + 20;
  kit.solids.solid(
    hexaPolys(
      [
        [X - hw, B, F],
        [X + hw, B, F],
        [X + hw, B, zFoot],
        [X - hw, B, zFoot],
        [X - hw, B + PLINTH_H, F],
        [X + hw, B + PLINTH_H, F],
        [X + hw, B + PLINTH_H, zTop],
        [X - hw, B + PLINTH_H, zTop],
      ],
      { bottom: false },
    ),
    'stone',
  );
}

// Grand closed double door of planks with iron bands, under a stone voussoir arch.
function door(kit, frame, width, height) {
  const hw = width / 2;
  const spring = height - hw;
  const inner = archContour(hw, spring, 8);
  const outer = archContour(hw + 70, spring, 8);
  const { trim, wood, solids } = kit;
  trim.color(TINT.stone);
  const voussoirs = inner.slice(0, -1).map((_, i) => (i % 2 ? 0.9 : 1.04));
  trim.moulding(frame, inner, outer, 56, { w0: -4, revealShade: 0.45, frontShade: voussoirs });
  trim.solid(localBoxPolys(frame, -36, 36, height - 10, height + 84, -4, 66, { bottom: true }));

  // Leaves: darker toward the top where the arch and balcony shade them.
  wood.color(TINT.door);
  wood.panel(frame, inner, 6, { shade: inner.map(([, v]) => 0.95 - 0.35 * (v / height)) });
  wood.color(TINT.iron);
  wood.solid(localBoxPolys(frame, -5, 5, 0, height - 3, 6, 12, { bottom: false }));
  for (const v of [70, 300]) wood.solid(localBoxPolys(frame, -hw + 3, hw - 3, v, v + 26, 6, 12, { bottom: false }));
  // Ring handles either side of the seam.
  for (const s of [-1, 1]) {
    const ring = (r) => Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 2 - (i / 8) * Math.PI * 2;
      return [s * 40 + r * Math.cos(a), 220 + r * Math.sin(a)];
    });
    wood.moulding(frame, ring(13), ring(22), 16, { w0: 6, closed: true, revealShade: 0.8 });
  }
  // The recessed door is solid: the collider fills the arch surround.
  solids.solid(localBoxPolys(frame, -hw - 70, hw + 70, 0, height + 70, 0, 56, { bottom: false }), 'stone');
}

// Small balcony over the door: stone slab on stepped corbels with a balustrade.
function balcony(kit, frame, y, hw, depth) {
  const { trim, solids } = kit;
  trim.color(TINT.stone);
  trim.solid(localBoxPolys(frame, -hw, hw, y - 44, y, -4, depth), { faceShade: (n) => (n[1] < -0.5 ? 0.55 : 1) });
  for (const u of [-hw + 45, hw - 45]) {
    for (let i = 0; i < 3; i++) {
      const w = 34 - i * 4;
      trim.solid(localBoxPolys(frame, u - w, u + w, y - 44 - (i + 1) * 36, y - 44 - i * 36, -4, depth - 20 - i * 45), {
        faceShade: (n) => (n[1] < -0.5 ? 0.5 : 0.9),
      });
    }
  }
  // Balustrade: base course, posts and a handrail along the front and both sides.
  const railH = 110;
  const inset = 14;
  const runs = [
    [[-hw + inset, depth - inset], [hw - inset, depth - inset]],
    [[-hw + inset, 0], [-hw + inset, depth - inset]],
    [[hw - inset, 0], [hw - inset, depth - inset]],
  ];
  for (const [[u0, w0], [u1, w1]] of runs) {
    const along = (t) => [u0 + (u1 - u0) * t, w0 + (w1 - w0) * t];
    const len = Math.hypot(u1 - u0, w1 - w0);
    const rail = (v0, v1, t) =>
      localBoxPolys(frame, Math.min(u0, u1) - t, Math.max(u0, u1) + t, v0, v1, Math.min(w0, w1) - t, Math.max(w0, w1) + t);
    trim.solid(rail(y, y + 16, 12));
    trim.solid(rail(y + railH - 18, y + railH, 13));
    const n = Math.max(2, Math.round(len / 48));
    for (let i = 0; i <= n; i++) {
      const [u, w] = along(i / n);
      const post = localBoxPolys(frame, u - 8, u + 8, y + 16, y + railH - 18, w - 8, w + 8, { bottom: false, top: false });
      trim.solid(post, { shade: 0.92 });
    }
  }
  // Collide as one solid block: a thin balustrade would be thinner than the player.
  solids.solid(localBoxPolys(frame, -hw, hw, y - 44, y + railH, 0, depth, { bottom: true }), 'stone');
}

// ---------------------------------------------------------------- windows

// Block walls get about twenty openings in all, leaving broad plain wall between the
// string courses.
function windows(kit, C, d) {
  const B = C.baseY;
  const F = C.frontZ;
  const X = C.x;
  const at = (frame, { w, h, border }) => archWindow(kit, frame, w, h, { border });
  for (const s of [-1, 1]) {
    // Wing fronts (the facade seen from the spawn): tall lower row, shorter upper row.
    for (const x of [1080, 1430]) {
      at(wallFrame([X + s * x, B + 380, F], [0, 0, 1]), WIN.tall);
      at(wallFrame([X + s * x, B + 1020, F], [0, 0, 1]), WIN.std);
    }
    // Wing outer sides: one window and one slit in the upper row.
    at(wallFrame([X + s * d.cornerX, B + 1000, F - 850], [s, 0, 0]), WIN.std);
    at(wallFrame([X + s * d.cornerX, B + 1060, F - 1300], [s, 0, 0]), WIN.slit);
    // Rear block sides: a pair of large windows in the middle band.
    for (const z of [F - 2150, F - 2750]) at(wallFrame([X + s * d.rearX, B + 960, z], [s, 0, 0]), WIN.large);
    // Back wall: one window either side of the bay, in the middle band.
    at(wallFrame([X + s * 800, B + 1000, d.rearBackZ], [0, 0, -1]), WIN.std);
    // Keep: a pair on the front face (seen over the gable), one on each side.
    const keepSill = d.keepTop - 520;
    at(wallFrame([X + s * 300, keepSill, d.hallBackZ], [0, 0, 1]), WIN.std);
    at(wallFrame([X + s * d.keepHW, keepSill, (d.keepBackZ + d.hallBackZ) / 2], [s, 0, 0]), WIN.std);
  }
  at(wallFrame([X, d.keepTop - 560, d.keepBackZ], [0, 0, -1]), WIN.large);
}
