// Wooden drawbridge over the moat (layout.BRIDGE): plank deck sloping gently from the lawn
// (south) up to the island (north), stone abutments and end pillars at both banks, low
// wooden rails over the water, and stringers / cross beams / trestles visible from below.

import { beamPolys, boxPolys, hexaPolys } from './geom.js';
import { TINT } from './parts.js';

const DECK_T = 40; // deck thickness
const RAIL_H = 95; // rail top above the deck: low enough to jump over
const PILLAR_H = 170;
const RAIL_HALF = 16; // half-width of the rail collider: the visible posts and rails
// Clearance of the timbers under the deck over the moat surface. A hero floating at the
// surface has his feet 80 under it and is 160 tall, so his head (and his collision top)
// reaches 80 above the water; the stringers and caps stay a little higher.
const SWIM_HEADROOM = 85;

export function buildBridge(kit, L) {
  const Br = L.BRIDGE;
  const X = Br.x;
  const hw = Br.width / 2;
  const zN = Br.northZ;
  const zS = Br.southZ;
  // Moat banks under the bridge: the island's front edge and the lawn's retaining wall.
  const bankN = L.ISLAND.maxZ;
  const bankS = L.MOAT.maxZ;
  // Deck surface: level just above the island plateau and the lawn where it rests on them,
  // a gentle slope across the moat in between, so both ends are seamless to walk onto.
  const yS = Math.max(...[-hw, 0, hw].map((dx) => L.groundHeight(X + dx, zS))) + 2;
  const yN = L.ISLAND_TOP + 2;
  const top = (z) => yN + (yS - yN) * Math.min(1, Math.max(0, (z - bankN) / (bankS - bankN)));
  const { wood, trim, solids } = kit;
  const waterBands = [L.WATER_LEVEL - 40, L.WATER_LEVEL + 60]; // vertex rows for waterline shading

  // Deck in three pieces (island, span, lawn); planks run across (texture v along x).
  wood.color(TINT.wall);
  const breaks = [zN, bankN, bankS, zS];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const za = breaks[i];
    const zb = breaks[i + 1];
    const deck = hexaPolys([
      [X - hw, top(za) - DECK_T, za],
      [X + hw, top(za) - DECK_T, za],
      [X + hw, top(zb) - DECK_T, zb],
      [X - hw, top(zb) - DECK_T, zb],
      [X - hw, top(za), za],
      [X + hw, top(za), za],
      [X + hw, top(zb), zb],
      [X - hw, top(zb), zb],
    ]);
    wood.solid(deck, {
      uv: (p) => [p[2] / wood.repeat, p[0] / wood.repeat],
      faceShade: (n) => (n[1] < -0.5 ? 0.5 : n[1] > 0.5 ? 1 : 0.75),
    });
    solids.solid(deck, 'wood');
  }

  // Abutments and end pillars where the deck leaves each bank.
  const pillars = [];
  for (const [bank, into] of [
    [bankN, 1],
    [bankS, -1],
  ]) {
    const z0 = Math.min(bank - into * 20, bank + into * 90);
    const z1 = Math.max(bank - into * 20, bank + into * 90);
    const yTop = Math.min(top(z0), top(z1)) - DECK_T;
    trim.color(TINT.stone);
    trim.shade = waterlineShade(L.WATER_LEVEL);
    trim.box(X - hw - 80, X + hw + 80, L.MOAT_FLOOR, yTop, z0, z1, { bottom: false, ys: waterBands });
    trim.shade = null;
    solids.box(X - hw - 80, X + hw + 80, L.MOAT_FLOOR, yTop, z0, z1, 'stone');
    const zc = (z0 + z1) / 2;
    const pTop = top(zc) + PILLAR_H;
    for (const s of [-1, 1]) {
      const px0 = Math.min(X + s * hw, X + s * (hw + 80));
      const px1 = Math.max(X + s * hw, X + s * (hw + 80));
      trim.color(TINT.stone);
      trim.box(px0, px1, yTop, pTop, z0 + 5, z1 - 5, { bottom: false, top: false });
      // Pyramid cap with a small overhang.
      const cap = [[0, pTop - 16], [64, pTop - 16], [64, pTop + 4], [0, pTop + 58]];
      trim.lathe((px0 + px1) / 2, zc, cap, 4, { flat: true, a0: Math.PI / 4 });
      solids.box(px0, px1, yTop, pTop + 30, z0 + 5, z1 - 5, 'stone');
    }
    pillars.push(into > 0 ? z1 - 5 : z0 + 5);
  }

  // Rails between the pillars: posts, a top rail and a lower rail.
  const [rz0, rz1] = pillars;
  const bays = Math.max(2, Math.round((rz1 - rz0) / 240));
  wood.color(TINT.door, 0.95);
  for (const s of [-1, 1]) {
    const rx = X + s * (hw - 16);
    for (let i = 1; i < bays; i++) {
      const z = rz0 + ((rz1 - rz0) * i) / bays;
      wood.box(rx - 13, rx + 13, top(z) - 2, top(z) + RAIL_H + 6, z - 13, z + 13, { bottom: false });
    }
    for (const [h, t] of [
      [RAIL_H - 11, 24],
      [RAIL_H * 0.45, 14],
    ]) {
      wood.solid(beamPolys([rx, top(rz0) + h, rz0], [rx, top(rz1) + h, rz1], [1, 0, 0], t, t));
    }
    // The collider hugs the visible rail; the hero's wall push ignores the far face of a
    // thin wall he started behind, so a thin rail cannot pull him through.
    const cx0 = rx - RAIL_HALF;
    const cx1 = rx + RAIL_HALF;
    solids.solid(
      hexaPolys([
        [cx0, top(rz0), rz0],
        [cx1, top(rz0), rz0],
        [cx1, top(rz1), rz1],
        [cx0, top(rz1), rz1],
        [cx0, top(rz0) + RAIL_H, rz0],
        [cx1, top(rz0) + RAIL_H, rz0],
        [cx1, top(rz1) + RAIL_H, rz1],
        [cx0, top(rz1) + RAIL_H, rz1],
      ]),
      'wood',
    );
  }

  // Under-structure: two stringers, cross beams, and two trestles standing in the moat.
  // The deck slopes down to the lawn, leaving little room over the water at the south end, so
  // everything under the deck stops at a level soffit just over a floating swimmer's head:
  // only the trestle posts (and knee braces well under the surface) reach lower. A swimmer can
  // paddle anywhere under the bridge, and no timber clips through his head.
  const under = (z) => top(z) - DECK_T;
  const soffit = L.WATER_LEVEL + SWIM_HEADROOM;
  const trestles = [1 / 3, 2 / 3].map((f) => bankN + (bankS - bankN) * f);
  wood.color(TINT.door, 0.7);
  // Every timber below the deck collides too, so a swimmer cannot pass through them.
  const timber = (polys) => {
    wood.solid(polys);
    solids.solid(polys, 'wood');
  };
  const timberBox = (x0, x1, y0, y1, z0, z1) => timber(boxPolys(x0, x1, y0, y1, z0, z1));
  // Timber hanging from the deck's underside (its top follows the slope) down to height y0.
  const hanger = (x0, x1, z0, z1, y0) =>
    timber(
      hexaPolys(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
          [x0, under(z0), z0],
          [x1, under(z0), z0],
          [x1, under(z1), z1],
          [x0, under(z1), z1],
        ],
        { top: false },
      ),
    );
  // Stringers: from inside the north abutment to the far side of the last trestle's cap,
  // deep at the island end and tapering toward the lawn along the level soffit.
  const capHalf = 36;
  for (const s of [-1, 1]) {
    const sx = X + s * (hw - 120);
    hanger(sx - 25, sx + 25, bankN, trestles[1] + capHalf, soffit);
  }
  // Cross beams under the planks, where there is room for them and clear of the caps.
  for (let z = bankN + 60; z < bankS - 40; z += 170) {
    const y0 = Math.max(under(z) - 26, soffit);
    if (under(z) - y0 < 12 || trestles.some((zt) => Math.abs(z - zt) < 60)) continue;
    wood.box(X - hw + 12, X + hw - 12, y0, under(z), z - 16, z + 16, { top: false });
  }
  wood.shade = waterlineShade(L.WATER_LEVEL);
  const tieY0 = L.WATER_LEVEL - 260;
  const tieY1 = L.WATER_LEVEL - 220;
  for (const zt of trestles) {
    // Cap under the deck, on the same soffit as the stringers.
    hanger(X - hw + 40, X + hw - 40, zt - capHalf, zt + capHalf, soffit);
    for (const s of [-1, 1]) {
      const px = X + s * (hw - 120);
      wood.box(px - 30, px + 30, L.MOAT_FLOOR, soffit, zt - 30, zt + 30, { bottom: false, top: false, ys: waterBands });
      solids.box(px - 30, px + 30, L.MOAT_FLOOR, soffit, zt - 30, zt + 30, 'wood');
      // Knee brace from low on the post in to the tie: the middle of the bent stays open
      // (the red coin hangs under the tie there) and the surface stays clear.
      timber(beamPolys([px, tieY0 - 200, zt], [X + s * (hw - 250), (tieY0 + tieY1) / 2, zt], [0, 0, 1], 22, 30));
    }
    // Tie between the posts under the water.
    timberBox(X - hw + 100, X + hw - 100, tieY0, tieY1, zt - 24, zt + 24);
  }
  wood.shade = null;
}

// Masonry and timber below the waterline look wet and dark; a band just above is damp.
function waterlineShade(waterY) {
  return (x, y) => (y < waterY - 20 ? 0.55 : y < waterY + 50 ? 0.8 : 1);
}
