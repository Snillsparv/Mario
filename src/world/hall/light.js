// The Great Hall's light, baked into the vertex colours of every mesh but the full-bright
// ones (the glow, the lamp) and the glass (hall/hall.js assemble()): two pure functions of a
// vertex's position and normal, one for the floor and one for everything else.
//
//   makeHallLight(L, windowSpots) -> { floor, wall }
//     floor(x, y, z, nx, ny, nz, out?) -> [r, g, b]   the light on the floor at a vertex
//     wall(x, y, z, nx, ny, nz, out?) -> [r, g, b]    on everything else (walls, trims, wood,
//                                                     paint, cloth, the door's leaves)
//     (windowSpots: hall/shell.js windowSpots(), each window's foot on its wall and its normal)
//   bakeHall(geo, light, max = 1.15) -> geo   multiplies geo's colours by light(...), clamped
//                                             to max as one (so a bright pool keeps its hue)
//
// 1. A base of 0.62 plus 0.38 of the key light (layout HALL_SUN: from high in the south-west,
//    so the long walls bake apart), and on the walls a weak fill from the apse's side (so the
//    south wall, turned from the sun, still shades round) and a warm bounce on the down-facing
//    vault and dome (else they would bake grey).
// 2. Ambient occlusion: the floor darker within 500 of the walls; the walls darker at their
//    foot and under the cornice; the vault darker at its springing.
// 3. Warm coloured pools, added: under each candle ring, a big one round the fire (and one more
//    on the floor before it), a halo round each window and a patch of floor in front of it.
//    Off the floor each counts as much as the face turns toward it (at least a quarter).
// 4. The floor's light, all told, scaled down (FLOOR): it faces the key light square on and
//    lies under every pool, so unscaled it would bake brighter than any wall (flat white).
// 5. A warm/cool ramp: bright parts warm, dim parts cool, the vault never cool.

import { planPolygon } from './plan.js';

const BASE = 0.62;
const KEY = 0.38;
const FILL = { k: 0.14, dir: unit(0, 0.45, -0.89) }; // the apse side's fill (walls only)
const BOUNCE = { k: 0.2, tint: [1, 0.86, 0.66] }; // above the collision ceiling (walls only)
const CEILING = 2600; // the bounce and the vault's warm ramp above it
const AO = { floor: 0.24, floorReach: 500, foot: 0.72, footHeight: 320, cornice: 0.14, corniceFrom: 2000, corniceOver: 600 };
const VAULT_AO = { below: 2650, spring: 2800, dark: 0.8, over: 1100 };
// Pools: radius, strength (k (1 - d^2)^2 at d = distance / radius) and colour.
const POOL = {
  candles: { r: 1900, k: 0.28, c: [1, 0.84, 0.58] },
  fire: { dx: 60, y: 260, r: 2400, k: 0.9, c: [1, 0.55, 0.22] },
  hearth: { dx: 300, r: 1100, k: 0.35, c: [1, 0.62, 0.3] }, // the floor before the fire
  halo: { out: 60, at: 0.55, r: 1100, k: 0.3, c: [1, 0.93, 0.74] }, // round each window (at that much of its height)
  sill: { out: 800, r: 750, k: 0.2, c: [1, 0.94, 0.78] }, // the floor in front of each window
};
const FLOOR = 0.72; // the floor's light, all told (4. above)
const RAMP = { from: 0.45, over: 0.6, vault: 0.7, lumMax: 1.2 };

function unit(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export function makeHallLight(L, windowSpots) {
  const { HALL_SUN: sun, CHANDELIERS, HEARTH_FIRE } = L;
  const pool = (x, y, z, { r, k, c }, floorOnly = false) => ({ x, y, z, r2: r * r, k, c, floorOnly });
  const pools = [];
  for (const { x, z } of CHANDELIERS.spots) pools.push(pool(x, CHANDELIERS.y, z, POOL.candles));
  pools.push(pool(HEARTH_FIRE.x + POOL.fire.dx, POOL.fire.y, HEARTH_FIRE.z, POOL.fire));
  pools.push(pool(HEARTH_FIRE.x + POOL.hearth.dx, 0, HEARTH_FIRE.z, POOL.hearth, true));
  for (const w of windowSpots) {
    const [nx, nz] = w.n;
    pools.push(pool(w.x + nx * POOL.halo.out, w.sill + w.height * POOL.halo.at, w.z + nz * POOL.halo.out, POOL.halo));
    pools.push(pool(w.x + nx * POOL.sill.out, 0, w.z + nz * POOL.sill.out, POOL.sill, true));
  }
  // The plan's edges, for the floor's distance to the walls.
  const plan = planPolygon(L, 0);
  const edges = plan.map(([ax, az], i) => {
    const [bx, bz] = plan[(i + 1) % plan.length];
    const ex = bx - ax;
    const ez = bz - az;
    return { ax, az, ex, ez, inv: 1 / (ex * ex + ez * ez) };
  });
  const wallDistance = (x, z) => {
    let best = Infinity;
    for (const e of edges) {
      const t = Math.max(0, Math.min(1, ((x - e.ax) * e.ex + (z - e.az) * e.ez) * e.inv));
      const dx = x - e.ax - e.ex * t;
      const dz = z - e.az - e.ez * t;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };

  const light = (floor) => (x, y, z, nx, ny, nz, out = [0, 0, 0]) => {
    let l = BASE + KEY * Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
    if (!floor) l += FILL.k * Math.max(0, nx * FILL.dir[0] + ny * FILL.dir[1] + nz * FILL.dir[2]);
    let r = l;
    let g = l;
    let b = l;
    if (!floor && y > CEILING) {
      const k = BOUNCE.k * Math.max(0, -ny);
      r += k * BOUNCE.tint[0];
      g += k * BOUNCE.tint[1];
      b += k * BOUNCE.tint[2];
    }
    let ao;
    if (floor) {
      ao = 1 - AO.floor * Math.max(0, 1 - wallDistance(x, z) / AO.floorReach);
    } else if (y < VAULT_AO.below) {
      ao = AO.foot + (1 - AO.foot) * Math.min(1, y / AO.footHeight);
      ao *= 1 - AO.cornice * Math.max(0, Math.min(1, (y - AO.corniceFrom) / AO.corniceOver));
    } else {
      ao = VAULT_AO.dark + (1 - VAULT_AO.dark) * Math.min(1, (y - VAULT_AO.spring) / VAULT_AO.over);
    }
    r *= ao;
    g *= ao;
    b *= ao;
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      if (p.floorOnly && !floor) continue;
      const dx = p.x - x;
      const dy = floor ? 0 : p.y - y;
      const dz = p.z - z;
      const d2 = (dx * dx + dy * dy + dz * dz) / p.r2;
      if (d2 >= 1) continue;
      let k = p.k * (1 - d2) * (1 - d2);
      if (!floor) k *= Math.max(0.25, (nx * dx + ny * dy + nz * dz) / (Math.hypot(dx, dy, dz) || 1));
      r += k * p.c[0];
      g += k * p.c[1];
      b += k * p.c[2];
    }
    if (floor) {
      r *= FLOOR;
      g *= FLOOR;
      b *= FLOOR;
    }
    let t = Math.max(0, Math.min(1, (Math.min(RAMP.lumMax, (r + g + b) / 3) - RAMP.from) / RAMP.over));
    if (y > CEILING) t = Math.max(t, RAMP.vault);
    out[0] = r * (0.82 + 0.18 * t);
    out[1] = g * (0.8 + 0.16 * t);
    out[2] = b * (0.94 - 0.08 * t);
    return out;
  };
  return { floor: light(true), wall: light(false) };
}

export function bakeHall(geo, light, max = 1.15) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = geo.attributes.color;
  const c = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    light(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), c);
    const r = col.getX(i) * c[0];
    const g = col.getY(i) * c[1];
    const b = col.getZ(i) * c[2];
    const k = Math.min(1, max / Math.max(r, g, b));
    col.setXYZ(i, r * k, g * k, b * k);
  }
  col.needsUpdate = true;
  return geo;
}
