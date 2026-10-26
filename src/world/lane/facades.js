// The north villas' street faces and roofs (W6, as photos 9-13, 16, 17, 23 and 25-29 have them),
// data and shared geometry for both looks: lane/houses.js (the classic build, the lane's chunk)
// and world/lane/real/villas.js (the realistic look's worker) read it; layout.js never imports
// it (it is builders' data: kept out of the main chunk).
//
//   FACADES[id]      a villa block's program (the east blocks, `<id>_west` the set-back ones):
//                    u along its front from the middle (+ east), v over its floor
//       garage       the sectional door's opening: w wide, h to its crown, a segmental head
//                    `rise` high (or `round`: its top corners rounded; neither: a flat head, as
//                    north_2's, photo 13), the door's tint
//       oriel        a canted oriel over the garage: w at the wall, `front` its front face, `out`
//                    standing out (its cheeks at 45 degrees and more), from v0 up to the soffit, its
//                    glass from v0 + 20; on a corbelled brick base
//       arch         a round-headed window (w, sill, crown) under a brick rowlock ring, a black iron
//                    flower grille across its foot (`grille`)
//       loggia       an open round-headed loggia in the brick (w, sill, crown, `depth` deep): its
//                    lining boards (`boards`) or white, `bars` dark bars across it or an iron flower
//                    box on its sill (`box`)
//       niche        a round-headed recess at the floor (w x h, `depth` deep) with a board door
//                    (`leaves` 1 or 2) set back in it, in its tint
//       door         a plain board door at the floor (w x h, tint; `vent` a grille over it)
//       windows      plain windows on the upper floor: u, or [u, w, sill, h]
//       lamps        [u, v, kind]: 'globe' (a white globe), 'lantern' (a black one), 'wall'
//       pipes        the front corners with a downpipe (-1 west, 1 east)
//       render       the white render's top over the floor (default the layout's)
//       frame        the frames' tint (default FRAME)
//       drive        'asphalt': its drive open asphalt behind a strip of setts (else setts)
//   ROOF            the villas' hipped roofs: `pitch`, the eaves' depth at the front and the
//                    sides and back, the fascia, the rim's height over the eave (the soffit boxed
//                    level under it), the tints (pantiles, soffit boards, fascia, gutters)
//   hipOf(h)         a villa block's roof in its own frame (u, y, w): the rim rectangle, its height,
//                    the ridge's ends, each slope's corners and up direction (the classic shape for
//                    a house without a program: its planes through its walls' tops)
//   hipSolid(h, at)  its collider: the walls up under the drawn slopes, clipped at the walls (the
//                    eaves are drawn only), as convex polys through `at(u, y, w)`
//   WALL_DRAWN, wallDrawnAt(x)   the terraces' walls drawn lower than their colliders (TERRACE):
//                    each plot's height over GROUND from x on (photos 10, 13, 16, 17, 23, 28: low
//                    stacked-slab bed walls, stepping up by north_4), a planted strip `STRIP` deep
//                    behind the coping rising to the terrace
//   GARAGE_SET, DOOR_SET   how far the realistic look sets a garage's door and a board door back
//                    in their openings (a niche's door its `depth`)
//   FLOOR_SET        the terraces' lawn behind a drive's notch drawn from this far behind its
//                    villa's front (lane/build.js block: under the house, behind every door at
//                    the floor), so no recess shows the lawn's top crossing it

export const FRAME = 0x34363a;
export const GARAGE_SET = 22;
export const DOOR_SET = 8;
export const FLOOR_SET = 80;
export const ROOF = { pitch: 34, front: 200, side: 90, fascia: 30, lift: 20, tint: 0x4e3b2f, soffit: 0x4e3626, board: 0x3e2a1e, gutter: 0x5a4535 };

const WEST = (windows) => ({ windows, pipes: [-1] });
export const FACADES = {
  north_1: { garage: { u: 250, w: 380, h: 290, rise: 45, tint: 0x8696a0 }, oriel: { u: 200, w: 260, front: 120, out: 60, v0: 470 }, loggia: { u: -347, w: 200, sill: 560, crown: 770, depth: 100, box: true }, door: { u: -150, w: 130, h: 300, tint: 0x35261c }, lamps: [[470, 270, 'wall'], [-560, 740, 'globe']], pipes: [1] },
  north_2: { drive: 'asphalt', garage: { u: 265, w: 383, h: 336, tint: 0x3c3e42 }, oriel: { u: 267, w: 280, front: 130, out: 65, v0: 503 }, arch: { u: -371, w: 162, sill: 513, crown: 775, grille: true }, niche: { u: -259, w: 157, h: 342, depth: 35, tint: 0x121418, leaves: 1 }, lamps: [[521, 335, 'globe']], pipes: [-1] },
  north_3: { garage: { u: 250, w: 360, h: 320, rise: 45, tint: 0x3a3838 }, oriel: { u: 160, w: 260, front: 120, out: 60, v0: 470 }, loggia: { u: -400, w: 200, sill: 507, crown: 765, depth: 100, box: true }, door: { u: -400, w: 120, h: 320, tint: 0x353335, vent: true }, lamps: [[490, 280, 'lantern']], pipes: [-1] },
  north_4: { garage: { u: 300, w: 382, h: 343, round: 55, tint: 0x3a302e }, oriel: { u: 318, w: 261, front: 120, out: 70, v0: 490 }, loggia: { u: -404, w: 171, sill: 538, crown: 759, depth: 100, bars: 4, boards: true }, door: { u: -321, w: 156, h: 345, tint: 0x574239, vent: true }, lamps: [[528, 304, 'globe']], pipes: [-1, 1], frame: 0x4a3428 },
  north_5: { niche: { u: -432, w: 195, h: 360, depth: 60, tint: 0x574137, leaves: 2 }, windows: [-430, 150], lamps: [[-290, 250, 'wall']], pipes: [-1, 1] },
  north_1_west: WEST([-250, 250]),
  north_2_west: WEST([-200, 250]),
  north_3_west: WEST([0]),
  north_4_west: WEST([-200, 250]),
  north_5_west: { windows: [[-209, 150, 470, 150], [-440, 40, 420, 200]], render: 260, pipes: [-1] },
};

// An opening's outline (u, v) on its wall, counter-clockwise seen from outside from its foot's
// west corner: a rectangle w x h, with a round head (`rise` its half width), a segmental one
// (`rise` lower) or its top corners rounded (`round`); `segs` the arc's.
export function outlineOf(u, v0, w, h, { rise = 0, round = 0 } = {}, segs = 8) {
  const hw = w / 2;
  const top = v0 + h;
  const pts = [[u - hw, v0], [u + hw, v0]];
  if (round > 0) {
    const n = Math.max(2, segs >> 1);
    for (let i = 0; i <= n; i++) pts.push([u + hw - round + round * Math.cos((Math.PI / 2) * (i / n)), top - round + round * Math.sin((Math.PI / 2) * (i / n))]);
    for (let i = 0; i <= n; i++) pts.push([u - hw + round - round * Math.sin((Math.PI / 2) * (i / n)), top - round + round * Math.cos((Math.PI / 2) * (i / n))]);
    return pts;
  }
  if (rise <= 0) return [...pts, [u + hw, top], [u - hw, top]];
  // The arc through both springings and the crown: radius R, its middle under the crown.
  const R = (hw * hw + rise * rise) / (2 * rise);
  const cy = top - R;
  const a0 = Math.atan2(top - rise - cy, hw);
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / segs;
    pts.push([u + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

// ---------------------------------------------------------------- the roofs

// A villa block's hipped roof in its frame (u along its w, w along its d, y up): the rim
// rectangle U0..U1 x W0..W1 at height Y (a programmed block's: the eaves deep at the front,
// ROOF.side elsewhere, the rim ROOF.lift over the eave, every slope at the pitch; else the old
// shape: `overhang` all round, the slopes through the walls' tops), the ridge (along the longer
// side; a point over a square) R0..R1 at `ridge`, and the four slopes (front, right, back, left:
// corners counter-clockwise from outside, the up-slope normal's direction in the frame).
export function hipOf(h) {
  const P = FACADES[h.id];
  const pitch = P ? ROOF.pitch : h.pitch;
  const t = Math.tan((pitch * Math.PI) / 180);
  const [a, b] = [h.w / 2, h.d / 2];
  const o = P ? [ROOF.front, ROOF.side, ROOF.side, ROOF.side] : Array(4).fill(h.overhang ?? 60);
  const Y = P ? h.eave + ROOF.lift : h.eave - o[0] * t;
  const [U0, U1, W0, W1] = [-a - o[3], a + o[1], -b - o[2], b + o[0]];
  const [A, B, cu, cw] = [(U1 - U0) / 2, (W1 - W0) / 2, (U0 + U1) / 2, (W0 + W1) / 2];
  const ridge = Y + Math.min(A, B) * t;
  const along = A >= B;
  const r = Math.abs(A - B);
  const R0 = along ? [cu - r, ridge, cw] : [cu, ridge, cw - r];
  const R1 = along ? [cu + r, ridge, cw] : [cu, ridge, cw + r];
  const rim = [[U0, Y, W1], [U1, Y, W1], [U1, Y, W0], [U0, Y, W0]];
  const up = (du, dw) => [du * t, 1, dw * t];
  const slopes = along
    ? [[[rim[0], rim[1], R1, R0], up(0, 1)], [[rim[1], rim[2], R1], up(1, 0)], [[rim[2], rim[3], R0, R1], up(0, -1)], [[rim[3], rim[0], R0], up(-1, 0)]]
    : [[[rim[0], rim[1], R1], up(0, 1)], [[rim[1], rim[2], R0, R1], up(1, 0)], [[rim[2], rim[3], R0], up(0, -1)], [[rim[3], rim[0], R1, R0], up(-1, 0)]];
  // Each slope's height at (u, w) (the roof the lowest of them).
  const planes = [(u, w) => Y + (W1 - w) * t, (u) => Y + (U1 - u) * t, (u, w) => Y + (w - W0) * t, (u) => Y + (u - U0) * t];
  return { t, a, b, o, Y, U0, U1, W0, W1, ridge, R0, R1, rim, slopes, planes, along, deep: !!P };
}

// The roof's collider: the walls up to the slopes and the slopes inside the walls (each the wall
// rectangle clipped to where it is the lowest), convex; `at` the house frame's (u, y, w) -> world.
export function hipSolid(h, at, y0) {
  const R = hipOf(h);
  const { a, b, planes } = R;
  const roof = (u, w) => Math.min(...planes.map((p) => p(u, w)));
  const polys = [];
  // The walls: front (w b, u -a..a), right, back, left; each top edge the roof's profile along it.
  const walls = [[[-a, b], [a, b]], [[a, b], [a, -b]], [[a, -b], [-a, -b]], [[-a, -b], [-a, b]]];
  for (const [p, q] of walls) {
    const ks = [0, 1];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      // Where planes i and j cross along p..q.
      const f = (k) => planes[i](p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k) - planes[j](p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k);
      const [f0, f1] = [f(0), f(1)];
      if (f0 * f1 < 0) ks.push(f0 / (f0 - f1));
    }
    ks.sort((x, y) => x - y);
    const top = ks.map((k) => {
      const [u, w] = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
      return at(u, roof(u, w), w);
    });
    polys.push([at(p[0], y0, p[1]), at(q[0], y0, q[1]), ...top.reverse()]);
  }
  // The slopes: the wall rectangle clipped to each plane's share.
  for (let i = 0; i < 4; i++) {
    let poly = [[-a, b], [a, b], [a, -b], [-a, -b]];
    for (let j = 0; j < 4 && poly.length; j++) if (j !== i) poly = clip(poly, (u, w) => planes[j](u, w) - planes[i](u, w));
    if (poly.length >= 3) polys.push(poly.map(([u, w]) => at(u, planes[i](u, w), w)));
  }
  return polys;
}

// A convex polygon [[u, w]] clipped to where s(u, w) >= 0 (s linear).
function clip(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    const [sp, sq] = [s(...p), s(...q)];
    if (sp >= 0) out.push(p);
    if (sp * sq < 0) {
      const k = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out.filter((p, i) => Math.hypot(p[0] - out[(i + 1) % out.length][0], p[1] - out[(i + 1) % out.length][1]) > 0.01);
}

// ---------------------------------------------------------------- the bed walls

// [x from, height over GROUND]: north_1 85, north_2 its bed wall 100, north_3 80, north_4 stepping
// up from 48 by north_3's steps to 92 (photo 23), north_5's bed 75 (photo 28).
export const WALL_DRAWN = [[-1e5, 85], [-5261, 100], [-2022, 80], [1070, 48], [1220, 62], [1320, 77], [1470, 85], [1610, 92], [4655, 75]];
export const STRIP = 110;
export function wallDrawnAt(x) {
  let h = WALL_DRAWN[0][1];
  for (const [x0, v] of WALL_DRAWN) if (x >= x0) h = v;
  return h;
}

// The planted strips' plants (both looks): along every wall span of the terraces (real/plan.js
// terraceSpans) but under north_2's hedge, every ~`step` a plant { x, z, y (the strip's drawn
// height there), kind (0 a leafy mound, 1 a dark yew mass, 2 grass plumes, 3 a purple heuchera,
// 4 a pink rose), s (its size, 1 .. 1.55) }, seeded.
export function bedSpots(L, spans, step) {
  let seed = 90127;
  const R = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const hedges = L.HEDGES.filter((h) => h.clipped);
  const out = [];
  for (const { spans: list } of spans) {
    for (const { a, b, kind } of list) {
      if (kind !== 'wall') continue;
      for (let x = a + step * 0.4; x < b - 25; x += step * (0.75 + 0.5 * R())) {
        const k = R();
        const d = 42 + R() * 55;
        const z = L.wallZAt(x) - d;
        if (hedges.some((h) => x > h.x0 - 30 && x < h.x1 + 30)) continue;
        const wt = L.GROUND + wallDrawnAt(x) + 1;
        const y = wt + (L.NORTH.top - wt) * Math.max(0, Math.min(1, (d - 30) / (STRIP - 30)));
        out.push({ x, z, y, kind: k < 0.38 ? 0 : k < 0.58 ? 1 : k < 0.74 ? 2 : k < 0.88 ? 3 : 4, s: 1 + 0.55 * R() });
      }
    }
  }
  return out;
}
