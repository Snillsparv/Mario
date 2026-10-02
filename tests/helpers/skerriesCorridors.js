// The ways Jonas goes through Midsummer Skerries (course-local coordinates), for the critters'
// placement checks (tests/skerries.test.js): every route a player takes (the scripted routes of
// tests/skerries-routes.test.js and the walks between them), each at the height of its floor.
// A corridor is a polyline (`points` in order) or, with `pointy`, a set of spots (each a place
// he stands, approaches or swims round). Not a test file itself (the npm test glob matches
// *.test.js only).
import * as sk from '../../src/world/skerries/layout.js';

// The swimming rings round the stepping skerries and the reef rocks (500 out from each top).
const swimRings = [...sk.SKERRIES, ...sk.REEF].flatMap((s) => {
  const out = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    out.push([s.x + Math.sin(a) * (s.r + 500), s.z + Math.cos(a) * (s.r + 500)]);
  }
  return out;
});

export const CORRIDORS = [
  { name: 'jetty lane', y: 150, points: [[-830, 600], [-830, 2000]] },
  { name: 'arrival', y: 150, points: [[-830, 1700]] },
  { name: 'welcome sign', y: 150, points: [[-990, 1200], [-990, 1330]] },
  { name: 'hops', y: 200, points: [[-1617, 2283], [-1900, 2000], [-2450, 1450], [-3150, 750], [-3450, -350], [-3300, -1500], [-2650, -3150], [-2000, -4300]] },
  { name: 'sound', y: 0, points: [[0, 400], [0, -2400]] },
  { name: 'islet beach walk', y: 150, points: [[0, -1900], [0, -2400]] },
  { name: 'blocks', y: 450, points: [[1825, -3700], [1825, -4300], [1100, -4300]] },
  { name: 'stair', y: 950, points: [[-1141, -3509], [-850, -4420], [0, -3600]] },
  { name: 'mast approaches', y: 1150, pointy: true, points: [[-850, -4420], [-300, -3750], [500, -3700], [-500, -3700], [0, -3460], [0, -3850]] },
  { name: 'boardwalk', y: 120, points: [[1500, 2300], [2700, 2300], [2700, -660]] },
  { name: 'chimney', y: 150, points: [[2720, -800], [2720, -1500]] },
  { name: 'net mast', y: 150, points: [[3200, -600], [3200, -850]] },
  { name: 'loft-bridge', y: 1100, points: [[3200, -1400], [2720, -1700], [1040, -3370]] },
  { name: 'dives', y: -400, pointy: true, points: [[611, -362], [-489, -862], [111, -1462], [811, -1162], [111, -862]] },
  { name: 'maypole', y: 150, pointy: true, points: [[-500, 3000], [-500, 3800], [-900, 3400], [-100, 3400]] },
  { name: 'flagpole', y: 150, points: [[1900, 2900], [1900, 2600]] },
  { name: 'great rock', y: 300, points: [[-2000, -4300]] },
  { name: 'swim rings', y: 0, pointy: true, points: swimRings },
];

// Horizontal distance from (x, z) to corridor c (its nearest spot, or its polyline).
export function corridorDistance(c, x, z) {
  let d = Infinity;
  if (c.pointy || c.points.length === 1) {
    for (const [px, pz] of c.points) d = Math.min(d, Math.hypot(x - px, z - pz));
    return d;
  }
  for (let i = 0; i + 1 < c.points.length; i++) {
    const [ax, az] = c.points[i];
    const [bx, bz] = c.points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return d;
}
