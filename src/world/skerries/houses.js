// The houses of Midsummer Skerries (skerries/layout.js: the cottage on Home Island, the
// boathouse and the net shed on East Rock, the keeper's hut on the islet), written into the
// course's kit (skerries/build.js): render faces into its material builders, colliders into
// kit.solids.
//
//   house(kit, h)
//   h = { x0, x1, z0, z1, y0,      // the walls' footprint and the floor they stand on
//         eaves, ridge?,          // the walls' top; with a ridge, a gable roof whose ridge runs
//                                 // along the longer side; without, a flat roof at eaves (a
//                                 // loft deck to walk on)
//         door: face, windows: { face: n }, hatch?: face, chimney? }   // face: 'n'|'s'|'e'|'w'
//
// Falu-red board walls (the painted planks' boards run upright), white corner boards, white
// window frames round dark panes with a cross, a door of dark green boards in a white frame;
// a roof of tarred boards (near black) with white barge boards along the gables, or a plank
// deck edged with a white fascia; a hatch is a loft door high up under a hoist beam, a chimney
// a white one on the ridge. Colliders: one convex solid, the walls and the roof (wood).

import { wallFrame } from '../castle/geom.js';

const TINT = {
  falu: 0x9c2a1c,
  white: 0xf2ece0,
  pane: 0x24303a,
  door: 0x2e4a38,
  roof: 0x3a3a3a,
  deck: 0xc8c0b4,
  beam: 0x6a4a32,
};
const CORNER = 14; // corner boards' half width
const WINDOW = { w: 90, h: 100, sill: 120, frame: 12 };
const DOOR = { w: 120, h: 210, frame: 12 };
const HATCH = { w: 140, h: 160, below: 90 }; // under the eaves (or the deck)
const OVERHANG = 40; // the roof past the walls (eaves and gables)
const ROOF_THICK = 16;

// A face's wall frame (origin at its middle on the floor, u to the right seen from outside) and
// its half width.
function faceFrame(h, f) {
  const cx = (h.x0 + h.x1) / 2;
  const cz = (h.z0 + h.z1) / 2;
  if (f === 's') return { frame: wallFrame([cx, h.y0, h.z1], [0, 0, 1]), half: (h.x1 - h.x0) / 2 };
  if (f === 'n') return { frame: wallFrame([cx, h.y0, h.z0], [0, 0, -1]), half: (h.x1 - h.x0) / 2 };
  if (f === 'e') return { frame: wallFrame([h.x1, h.y0, cz], [1, 0, 0]), half: (h.z1 - h.z0) / 2 };
  return { frame: wallFrame([h.x0, h.y0, cz], [-1, 0, 0]), half: (h.z1 - h.z0) / 2 };
}

const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

export function house(kit, h) {
  const { paint, wood, solids } = kit;
  const { x0, x1, z0, z1, y0, eaves, ridge } = h;
  const alongX = x1 - x0 >= z1 - z0; // the ridge's direction
  const wallH = eaves - y0;

  // The walls: the long sides up to the eaves, the gable ends up to the ridge.
  paint.color(TINT.falu);
  for (const f of ['n', 's', 'e', 'w']) {
    const { frame, half } = faceFrame(h, f);
    const gable = ridge && (alongX ? f === 'e' || f === 'w' : f === 'n' || f === 's');
    const outline = gable ? [[-half, 0], [half, 0], [half, wallH], [0, ridge - y0], [-half, wallH]] : rect(-half, 0, half, wallH);
    paint.panel(frame, outline, 0, { shade: outline.map(([, v]) => 0.8 + 0.2 * Math.min(1, v / wallH)) });
  }
  // White corner boards.
  paint.color(TINT.white);
  for (const f of ['n', 's', 'e', 'w']) {
    const { frame, half } = faceFrame(h, f);
    for (const s of [-1, 1]) paint.panel(frame, rect(s * half - CORNER, 0, s * half + CORNER, wallH), 1);
  }

  // The door, the windows, the hatch.
  const opening = (f, u, v0, w, ht, inner, frameW) => {
    const { frame } = faceFrame(h, f);
    paint.color(TINT.white);
    paint.panel(frame, rect(u - w / 2 - frameW, v0 - frameW, u + w / 2 + frameW, v0 + ht + frameW), 2);
    paint.color(inner);
    paint.panel(frame, rect(u - w / 2, v0, u + w / 2, v0 + ht), 3);
    return frame;
  };
  if (h.door) opening(h.door, 0, 0, DOOR.w, DOOR.h, TINT.door, DOOR.frame);
  for (const [f, n] of Object.entries(h.windows ?? {})) {
    const { half } = faceFrame(h, f);
    for (let i = 0; i < n; i++) {
      // Spread along the face (round the door, if the face has one).
      const u = n === 1 ? (h.door === f ? half * 0.55 : 0) : -half * 0.55 + (half * 1.1 * i) / (n - 1);
      const frame = opening(f, u, WINDOW.sill, WINDOW.w, WINDOW.h, TINT.pane, WINDOW.frame);
      paint.color(TINT.white);
      paint.panel(frame, rect(u - 4, WINDOW.sill, u + 4, WINDOW.sill + WINDOW.h), 4);
      paint.panel(frame, rect(u - WINDOW.w / 2, WINDOW.sill + WINDOW.h / 2 - 4, u + WINDOW.w / 2, WINDOW.sill + WINDOW.h / 2 + 4), 4);
    }
  }
  if (h.hatch) {
    const frame = opening(h.hatch, 0, wallH - HATCH.below - HATCH.h, HATCH.w, HATCH.h, TINT.door, DOOR.frame);
    // The hoist beam over it, out from the wall.
    wood.color(TINT.beam);
    const a = frame.at(-10, wallH - 40, -20);
    const b = frame.at(10, wallH - 16, 110);
    wood.box(Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1], b[1], Math.min(a[2], b[2]), Math.max(a[2], b[2]));
  }

  if (ridge) gableRoof(kit, h, alongX);
  else flatRoof(kit, h);

  // The collider: the walls and the roof, one convex solid.
  if (ridge) {
    const r = alongX
      ? [[x0, ridge, (z0 + z1) / 2], [x1, ridge, (z0 + z1) / 2]]
      : [[(x0 + x1) / 2, ridge, z0], [(x0 + x1) / 2, ridge, z1]];
    const top = [[x0, eaves, z0], [x1, eaves, z0], [x1, eaves, z1], [x0, eaves, z1]];
    const bot = top.map(([x, , z]) => [x, y0, z]);
    const polys = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      polys.push([bot[i], bot[j], top[j], top[i]]);
    }
    if (alongX) {
      polys.push([top[0], top[1], r[1], r[0]], [top[3], top[2], r[1], r[0]], [top[1], top[2], r[1]], [top[0], top[3], r[0]]);
    } else {
      polys.push([top[1], top[2], r[1], r[0]], [top[0], top[3], r[1], r[0]], [top[0], top[1], r[0]], [top[3], top[2], r[1]]);
    }
    solids.solid(polys, 'wood');
  } else {
    solids.box(x0, x1, y0, eaves, z0, z1, 'wood', { bottom: false });
  }
}

// A gable roof of tarred boards (a thin slab past the walls), white barge boards along the
// gables, a white chimney on the ridge if asked.
function gableRoof(kit, h, alongX) {
  const { paint } = kit;
  const { x0, x1, z0, z1, eaves, ridge } = h;
  // Work in (a: along the ridge, b: across it) and map back.
  const P = alongX ? (a, y, b) => [a, y, b] : (a, y, b) => [b, y, a];
  const [a0, a1] = alongX ? [x0 - OVERHANG, x1 + OVERHANG] : [z0 - OVERHANG, z1 + OVERHANG];
  const [b0, b1] = alongX ? [z0, z1] : [x0, x1];
  const bm = (b0 + b1) / 2;
  const half = (b1 - b0) / 2;
  const k = (ridge - eaves) / half; // rise per unit across
  const lo = eaves - k * OVERHANG;
  for (const s of [-1, 1]) {
    const edge = bm + s * (half + OVERHANG);
    const facing = alongX ? [0, 1, s * k] : [s * k, 1, 0];
    paint.color(TINT.roof);
    paint.poly([P(a0, lo, edge), P(a1, lo, edge), P(a1, ridge, bm), P(a0, ridge, bm)], { facing, shade: [0.9, 0.9, 1.05, 1.05] });
    // The underside (dark) and the eaves' edge.
    paint.poly([P(a0, lo - ROOF_THICK, edge), P(a1, lo - ROOF_THICK, edge), P(a1, ridge - ROOF_THICK, bm), P(a0, ridge - ROOF_THICK, bm)], { facing: [-facing[0], -facing[1], -facing[2]], shade: 0.4 });
    paint.poly([P(a0, lo - ROOF_THICK, edge), P(a1, lo - ROOF_THICK, edge), P(a1, lo, edge), P(a0, lo, edge)], { facing: alongX ? [0, 0, s] : [s, 0, 0], shade: 0.7 });
    // White barge boards along both gables.
    paint.color(TINT.white);
    for (const a of [a0, a1]) {
      const out = alongX ? [Math.sign(a - (x0 + x1) / 2), 0, 0] : [0, 0, Math.sign(a - (z0 + z1) / 2)];
      paint.poly([P(a, lo - ROOF_THICK - 6, edge), P(a, ridge - ROOF_THICK - 6, bm), P(a, ridge + 4, bm), P(a, lo + 4, edge)], { facing: out });
    }
  }
  if (h.chimney) {
    const cx = alongX ? x0 + (x1 - x0) * 0.7 : (x0 + x1) / 2;
    const cz = alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * 0.7;
    paint.color(TINT.white);
    paint.box(cx - 40, cx + 40, ridge - 60, ridge + 110, cz - 40, cz + 40, { bottom: false });
    paint.color(TINT.roof);
    paint.box(cx - 46, cx + 46, ridge + 110, ridge + 122, cz - 46, cz + 46, { bottom: false });
  }
}

// A flat roof: a plank deck to walk on (drawn a little over the collider's top) edged with a
// white fascia board.
function flatRoof(kit, h) {
  const { paint, wood } = kit;
  const { x0, x1, z0, z1, eaves } = h;
  wood.color(TINT.deck);
  wood.poly([[x0, eaves + 2, z0], [x1, eaves + 2, z0], [x1, eaves + 2, z1], [x0, eaves + 2, z1]], { facing: [0, 1, 0] });
  paint.color(TINT.white);
  paint.box(x0 - 8, x1 + 8, eaves - 40, eaves + 6, z0 - 8, z1 + 8, { bottom: false, top: false });
}
