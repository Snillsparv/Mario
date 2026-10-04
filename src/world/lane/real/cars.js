// The realistic look's cars (lane/layout.js CARS, CAR_KINDS), built in the worker
// (world/lane/real/detail.js) in place of lane/props.js car()'s boxes (its colliders, the body's
// and the cabin's, stay): modern crossovers, hatches, an estate and a van; generic, plate-less,
// badge-less.
//
//   cars(kit, L)          // kit: detail.js's Geo per material (carPaint, carGlass, tyre, rim,
//                         // trim, lamp, tail, metal, contact; a cluster's own carPaint@k and
//                         // carGlass@k where the kit has them: each cluster's paint and glass
//                         // reflect its own probe)
//   carClusters(L) -> [{ cars, at }]   // the parked cars in clusters (the dad's drive, the west
//                         // link, the north drives, the east end: cars on the same side of the
//                         // street within CLUSTER of another of theirs), each with its
//                         // reflection probe's place (world/lane local:
//                         // over the cluster's middle, a little over its roofs)
//   carFrame(L, c) -> { y0, R, axles, at(u, y, w) }   // a car's ground, wheel radius, axles
//                         // and frame (u across, + its right; w along, + its nose) (tests)
//
// The body: one closed loft through sections along the car (stations denser toward its ends),
// each section a tucked floor corner, a lower side swelling out (haunches over the rear wheel),
// a crisp shoulder crease and a deck tumbling in; the plan's corners rounded, the bonnet's
// leading edge rounded down into a nearly upright face (a modern crossover's), the floor level
// at the kind's ground clearance and raised over each wheel into a round arch. Its top stays on
// the collider Jonas stands on (the bonnet and the boot at the belt, the roof at the roof: lane/
// props.js car). On it the greenhouse: a lower band of dark glass, black A and B pillars (a
// floating roof; the rear quarters black on the crossovers, body colour on the others), the
// belt seal and drip rails, the roof panel, a spoiler lip, roof rails on posts (black on the
// crossovers and the van, silver on the estate), a fin antenna, wipers. Details lie on the body's
// own surface (`side`: its section's outline at that height): the nose's slim headlamps (a pale
// light guide along their top, a projector) wrapping round the corners, a black grille with
// slats, the bumper, a black lower intake and a silver skid plate (crossovers); the tail's slim
// lamps wrapping round onto the sides, a black lower bumper with reflectors and a silver insert,
// no plate and no badge (a blank plate reads as a plate); door shut lines, flush handles, mirrors
// on black stalks, black arch flares and sill cladding on the crossovers and the van. Wheels
// fill their arches (a black liner closes each arch round the tyre): tyres with a bulging
// sidewall, flattened where they stand on the drive (a contact patch: the tread's lowest ring
// lies on the ground), ten-spoke rims (five on mid and low) over a dark barrel and a brake disc.
// Under each car a soft contact shadow (`contact`: a darkening, lighter toward its edges; darker
// still round each tyre's patch): the car sits on its drive. Each kind keeps its proportions
// (layout.js: the van tall and short-nosed, the estate's long roof, the SUV's square tail).

import { sub, cross, dot, norm } from './geo.js';

// Per kind: a crossover (black flares and cladding, skid plates), its ground clearance, the
// bonnet's leading edge's and the tail's radii, the plan's corner radii at the nose and tail,
// its roof rails, whether its rear quarters are black, the shoulder crease under the deck, and
// how far the window line rises over the bonnet behind it (the cowl: a high belt line, a low
// greenhouse).
const STYLE = {
  suv: { tall: true, clear: 30, noseR: 14, tailR: 10, front: 40, rear: 28, rails: 'black', blackRear: true, crease: 17, rise: 13 },
  cross: { tall: true, clear: 28, noseR: 16, tailR: 12, front: 42, rear: 32, rails: 'black', blackRear: true, crease: 16, rise: 13 },
  hatch: { tall: false, clear: 22, noseR: 18, tailR: 16, front: 46, rear: 38, rails: null, blackRear: false, crease: 15, rise: 9 },
  estate: { tall: false, clear: 22, noseR: 18, tailR: 12, front: 44, rear: 30, rails: 'silver', blackRear: false, crease: 15, rise: 9 },
  van: { tall: true, clear: 26, noseR: 12, tailR: 8, front: 30, rear: 20, rails: 'black', blackRear: false, crease: 18, rise: 6 },
};
// Per tier: body stations, wheel sides, spokes, arch segments, the fine details, the lamps and
// bumpers wrapping round the corners (on the body's own stations there).
const LOD = {
  high: { stations: 46, sides: 30, spokes: 10, arch: 14, fine: true, wrap: true },
  mid: { stations: 22, sides: 16, spokes: 5, arch: 6, fine: false, wrap: true },
  low: { stations: 16, sides: 12, spokes: 5, arch: 6, fine: false, wrap: false },
};
const WHEEL = 0.9; // the wheels to the bodies' scale (the classic ones are a size up: a real
// crossover's wheel is ~0.7 of its bonnet's height across)
const SQUASH = 1.2; // the tyre's flattening under the car's weight (its patch on the drive)
const ARCH = 7; // the arch's clearance round the tyre
const CLUSTER = 2800; // cars nearer than this to another of a cluster's share its probe
const PROBE_OVER = 40; // a cluster's probe this far over its highest roof

const TYRE = [0.026, 0.026, 0.028];
const RIM = [0.6, 0.61, 0.64];
const BARREL = [0.03, 0.03, 0.032];
const DISC = [0.22, 0.21, 0.2];
const BLACK = [0.008, 0.008, 0.009]; // gloss black (pillars, grille, seals)
const PLASTIC = [0.02, 0.02, 0.021]; // grained black plastic (flares, cladding, bumpers)
const SILVER = [0.42, 0.43, 0.45];
const LINER = [0.006, 0.006, 0.006];

export function carFrame(L, c) {
  const K = L.CAR_KINDS[c.kind];
  const y0 = L.groundHeight(c.x, c.z);
  const fw = [Math.sin(c.yaw), 0, Math.cos(c.yaw)];
  const ac = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
  const at = (u, y, w) => [c.x + ac[0] * u + fw[0] * w, y, c.z + ac[2] * u + fw[2] * w];
  const hl = K.l / 2;
  return { y0, R: K.wheel * WHEEL, axles: [hl - K.l * 0.19, -hl + K.l * 0.2], at, fw, ac };
}

export function carClusters(L) {
  // Single linkage: a car joins the cluster of any car nearer than CLUSTER.
  const of = L.CARS.map((_, i) => i);
  const root = (i) => (of[i] === i ? i : (of[i] = root(of[i])));
  L.CARS.forEach((a, i) => L.CARS.forEach((b, j) => {
    if (j > i && a.z > 0 === b.z > 0 && Math.hypot(a.x - b.x, a.z - b.z) < CLUSTER) of[root(j)] = root(i);
  }));
  const groups = new Map();
  L.CARS.forEach((_, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  return [...groups.values()].map((cars) => {
    const x = cars.reduce((s, i) => s + L.CARS[i].x, 0) / cars.length;
    const z = cars.reduce((s, i) => s + L.CARS[i].z, 0) / cars.length;
    const top = Math.max(...cars.map((i) => L.groundHeight(L.CARS[i].x, L.CARS[i].z) + L.CAR_KINDS[L.CARS[i].kind].roof));
    return { cars, at: [x, top + PROBE_OVER, z] };
  });
}

export function cars(kit, L) {
  const cluster = new Map();
  carClusters(L).forEach((g, k) => g.cars.forEach((i) => cluster.set(i, k)));
  L.CARS.forEach((c, i) => car(kit, L, c, cluster.get(i)));
}

// A rounded rectangle (half sizes a, b, corner radius r) as `per` + 1 points a corner,
// counter-clockwise from its lower right; each [x, y, corner] (corner: inside a corner's arc).
function roundRect(a, b, r, per) {
  const pts = [];
  const corners = [[a - r, -b + r, -Math.PI / 2], [a - r, b - r, 0], [-a + r, b - r, Math.PI / 2], [-a + r, -b + r, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const t = a0 + (i / per) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, i > 0 && i < per]);
    }
  }
  return pts;
}

// A plan corner's inset at `end` from the car's end (a quarter circle of radius r).
const corner = (end, r) => (end < r ? r - Math.sqrt(Math.max(0, r * r - (r - end) * (r - end))) : 0);

function car(kit, L, c, probe) {
  const K = L.CAR_KINDS[c.kind];
  const S = STYLE[c.kind];
  const D = LOD[kit.tier] ?? LOD.high;
  const { y0, R, axles, at: W, fw, ac } = carFrame(L, c);
  const paint = kit[`carPaint@${probe}`] ?? kit.carPaint;
  const glass = kit[`carGlass@${probe}`] ?? kit.carGlass;
  const { tyre, rim, trim, lamp, tail, metal, contact } = kit;
  const [hl, hw] = [K.l / 2, K.w / 2];
  const deck = y0 + K.belt; // the bonnet's sides and the boot (the collider's top: Jonas stands
  // there; the bonnet's crown 3 over it)
  const roofY = y0 + K.roof; // the roof (the cabin collider's top)
  const floor = y0 + S.clear;
  const yC = y0 + R - SQUASH; // the wheels' axis
  const ra = R + ARCH; // the arches' radius
  const van = c.kind === 'van';
  // A quad (corners in order round it) wound to face along `out` (world).
  const orient = (g, q, out) => {
    if (dot(cross(sub(q[1], q[0]), sub(q[2], q[0])), out) >= 0) g.quad(q[0], q[1], q[2], q[3]);
    else g.quad(q[1], q[0], q[3], q[2]);
  };
  const orientTri = (g, t, out) => {
    if (dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), out) >= 0) g.tri(t[0], t[1], t[2]);
    else g.tri(t[0], t[2], t[1]);
  };
  const dirW = (u, y, w) => [ac[0] * u + fw[0] * w, y, ac[2] * u + fw[2] * w];

  // ---------------------------------------------------------------- the body's sections
  const halfAt = (w) => hw - 1 - corner(hl - w, S.front) * (w > 0 ? 1 : 0) - corner(hl + w, S.rear) * (w < 0 ? 1 : 0);
  const cowl = hl - K.hood; // the bonnet's rear edge (the collider's windscreen starts there)
  const windowLine = deck + S.rise;
  const topAt = (w) => {
    let top = deck;
    const t = Math.max(0, Math.min(1, (cowl - 4 - w) / 26));
    top += S.rise * t * t * (3 - 2 * t); // (rising behind the cowl to the window line)
    if (w > hl - S.noseR) top -= S.noseR - Math.sqrt(Math.max(0, S.noseR ** 2 - (w - (hl - S.noseR)) ** 2));
    if (w < -hl + S.tailR) top -= S.tailR - Math.sqrt(Math.max(0, S.tailR ** 2 - (-hl + S.tailR - w) ** 2));
    return top - (hw - 1 - halfAt(w)) * 0.12;
  };
  const bottomAt = (w) => {
    let b = floor;
    if (w > hl - 50) b += 9 * ((w - (hl - 50)) / 50) ** 2; // (the approach angle)
    if (w < -hl + 55) b += 11 * ((-hl + 55 - w) / 55) ** 2; // (the departure angle)
    for (const wc of axles) {
      const d = Math.abs(w - wc);
      if (d < ra) b = Math.max(b, yC + Math.sqrt(ra * ra - d * d));
    }
    return b;
  };
  const swellAt = (w) => 1.2 + 2.6 * Math.exp(-(((w - axles[1]) / (R * 1.5)) ** 2)) + 1.3 * Math.exp(-(((w - axles[0]) / (R * 1.4)) ** 2));
  // The right half of a section, from the floor's edge up to the deck's: [u, y].
  const sideOf = (w) => {
    const a = halfAt(w);
    const top = topAt(w);
    const bottom = bottomAt(w);
    const h = Math.max(14, top - bottom);
    const sw = swellAt(w) * Math.min(1, h / 40);
    const yc = top - Math.min(S.crease, h * 0.45);
    // (Every point over the one before: the side under the crease shares out what is left.)
    const hb = Math.max(2, yc - 2 - bottom);
    const rb = Math.min(6, hb * 0.3);
    const pts = [[a - 7, bottom], [a - 2.6, bottom + rb * 0.3], [a - 0.6, bottom + rb], [a + sw * 0.55, bottom + rb + (hb - rb) * 0.35], [a + sw, bottom + rb + (hb - rb) * 0.7], [a + sw * 0.8, yc - 1.6], [a + sw * 0.6, yc - 0.4], [a - 1.8, yc + 0.8], [a - 4.6, top - 3.6], [a - 7.2, top - 1.1], [a - 10.5, top]];
    if (!D.fine) return [pts[0], pts[2], pts[4], pts[6], pts[7], pts[9], pts[10]];
    return pts;
  };
  const ringOf = (w) => {
    const right = sideOf(w);
    const top = right[right.length - 1][1];
    const left = right.map(([u, y]) => [-u, y]).reverse();
    return [[0, right[0][1]], ...right, [right[right.length - 1][0] * 0.5, top + 2.2], [0, top + 3], [-right[right.length - 1][0] * 0.5, top + 2.2], ...left];
  };
  // The side's u at height y (on its outline from the tucked corner up), and the plan's outward
  // normal there (u, w): decals lie on the body.
  const sideU = (w, y) => {
    const p = sideOf(w).slice(D.fine ? 2 : 1);
    if (y <= p[0][1]) return p[0][0];
    for (let i = 0; i + 1 < p.length; i++) {
      const [[ua, ya], [ub, yb]] = [p[i], p[i + 1]];
      if (y <= yb) return ua + ((ub - ua) * (y - ya)) / Math.max(1e-6, yb - ya);
    }
    return p[p.length - 1][0];
  };
  const planN = (w) => {
    const e = 0.25;
    const d = (halfAt(Math.min(hl, w + e)) - halfAt(Math.max(-hl, w - e))) / (Math.min(hl, w + e) - Math.max(-hl, w - e));
    const l = Math.hypot(1, d);
    return [1 / l, -d / l];
  };
  // A point on the body's side s (+1 right, -1 left) at (w, y), `off` out from it (y kept on the
  // body there: near the ends its floor rises, and a strip must not hang under it).
  const onSide = (s, w, y, off = 0.5) => {
    const [nu, nw] = planN(w);
    const yy = Math.min(Math.max(y, bottomAt(w) + 0.3), topAt(w) - 0.3);
    return W(s * (sideU(w, yy) + nu * off), yy, w + nw * off);
  };
  // A strip on side s over a grid of stations (ws) and heights (ys).
  const sideStrip = (g, s, ws, ys, off = 0.5) => {
    for (let j = 0; j + 1 < ws.length; j++) {
      const out = (() => {
        const [nu, nw] = planN((ws[j] + ws[j + 1]) / 2);
        return dirW(s * nu, 0, nw);
      })();
      for (let i = 0; i + 1 < ys.length; i++) orient(g, [onSide(s, ws[j], ys[i], off), onSide(s, ws[j + 1], ys[i], off), onSide(s, ws[j + 1], ys[i + 1], off), onSide(s, ws[j], ys[i + 1], off)], out);
    }
  };
  // A quad on an end face (e = 1 the nose, -1 the tail), [u, y] corners, `off` proud of it.
  const endFace = (g, e, pts, off = 0.5) => orient(g, pts.map(([u, y]) => W(u, y, e * (hl + off))), dirW(0, 0, e));
  // Stations: denser toward the ends, and at each arch's edges.
  const ws = [];
  for (let k = 0; k <= D.stations; k++) {
    const t = k / D.stations;
    ws.push(-hl + 2 * hl * (0.62 * (0.5 - 0.5 * Math.cos(Math.PI * t)) + 0.38 * t));
  }
  for (const wc of axles) for (const d of [-ra, -ra + 0.5, ra - 0.5, ra]) ws.push(wc + d);
  ws.sort((p, q) => p - q);
  const stations = ws.filter((w, i) => i === 0 || w - ws[i - 1] > 0.2);
  paint.color(c.tint);
  paint.loft(stations.map((w) => ringOf(w).map(([u, y]) => W(u, y, w))), { capStart: true, capEnd: true });
  // A wrap's stations round a corner, from w0 to w1: the body's own there (and both ends), so the
  // strip lies on the loft's facets (stations of its own cut inside them where the plan curves
  // and the body has few: a step on mid).
  const along = (w0, w1) => {
    const [a, b] = w0 < w1 ? [w0, w1] : [w1, w0];
    return [a, ...stations.filter((w) => w > a + 0.5 && w < b - 0.5), b];
  };

  // ---------------------------------------------------------------- the greenhouse
  const per = D.fine ? 3 : 2;
  const roofTop = roofY - 0.4;
  const screen0 = cowl - 26; // the windscreen's foot (on the window line)
  const slice = (f, out = 0) => {
    const y = windowLine + 0.4 + (roofTop - windowLine - 0.4) * f;
    const front = screen0 - (K.screen - 26) * Math.pow(f, 0.92) + out;
    const rear = -hl + K.tail + (K.tailTop - K.tail) * Math.pow(f, 1.1) - out;
    const half = hw - 12 - (van ? 9 : 20) * Math.pow(f, 1.3) - (f > 0.88 ? 32 * (f - 0.88) : 0) + out;
    const mid = (front + rear) / 2;
    const rr = roundRect((front - rear) / 2, half, Math.min(S.tall ? 14 : 20, half * 0.45), per);
    return { ring: rr.map(([w, u]) => W(u, y, mid + w)), corner: rr.map((p) => p[2]), front: rr.map((p) => p[0] > 0), mid, half, y, frontW: front, rearW: rear };
  };
  const glassTop = 0.8;
  const fs = D.fine ? [0.04, 0.3, 0.56, glassTop] : [0.04, glassTop];
  const gs = fs.map((f) => slice(f));
  const n = gs[0].ring.length;
  const isCorner = (i) => gs[0].corner[i] || gs[0].corner[(i + 1) % n];
  const isFront = (i) => gs[0].front[i] && gs[0].front[(i + 1) % n];
  glass.rgb(0.004, 0.005, 0.006);
  glass.loft(gs.map((g) => g.ring), { segs: (i) => !isCorner(i) });
  trim.rgb(...BLACK);
  trim.loft(gs.map((g) => g.ring), { segs: (i) => isCorner(i) && (isFront(i) || S.blackRear) }); // (the A pillars; the crossovers' rear quarters)
  paint.loft(gs.map((g) => g.ring), { segs: (i) => isCorner(i) && !isFront(i) && !S.blackRear });
  paint.loft([glassTop, 0.92, 1].map((f) => slice(f).ring), { capEnd: true });
  // The seal round the belt, the drip rails over the side glass.
  trim.rgb(...BLACK);
  trim.loft([slice(0, 0.6).ring, slice(0.045, 0.6).ring]);
  trim.loft([slice(glassTop - 0.04, 0.5).ring, slice(glassTop + 0.005, 0.5).ring], { segs: (i) => !isCorner(i) });
  // Black B pillars (on the estate a C pillar too), flush with the glass.
  const pillars = van ? [0.5] : c.kind === 'estate' ? [0.6, 0.3] : [0.56];
  for (const s of [-1, 1]) {
    for (const p of pillars) {
      const strip = gs.map((g) => {
        const w = g.rearW + (g.frontW - g.rearW) * p;
        return [W(s * (g.half + 0.7), g.y, w - 8), W(s * (g.half + 0.7), g.y, w + 8)];
      });
      for (let k = 0; k + 1 < strip.length; k++) orient(trim, [strip[k][0], strip[k][1], strip[k + 1][1], strip[k + 1][0]], dirW(s, 0, 0));
    }
  }
  const top = slice(1);
  // A spoiler lip over the rear window (body colour), roof rails on posts, a fin antenna, wipers.
  if (D.fine && !van) {
    const g = slice(0.97);
    const lip = (s, back, dy) => W(s * (g.half - 12), g.y + dy, g.rearW - back);
    const down = (p, d) => [p[0], p[1] - d, p[2]];
    const [a0, a1, b0, b1] = [lip(-1, -2, 0), lip(1, -2, 0), lip(-1, 12, -3), lip(1, 12, -3)];
    orient(paint, [a0, a1, b1, b0], [0, 1, 0]);
    orient(paint, [b0, b1, down(b1, 3), down(b0, 3)], dirW(0, 0, -1));
    orient(paint, [down(a0, 5), down(a1, 5), down(b1, 3), down(b0, 3)], [0, -1, 0]);
  }
  if (S.rails) {
    metal.rgb(...(S.rails === 'black' ? [0.03, 0.03, 0.033] : [0.5, 0.5, 0.52]));
    for (const s of [-1, 1]) {
      const u = s * (top.half - 12);
      const wa = top.frontW - 22;
      const wb = top.rearW + 12;
      metal.tube(W(u, roofY + 7, wa), W(u, roofY + 7, wb), 2.4, 2.4, D.fine ? 6 : 4, { caps: true });
      for (const w of [wa, wb]) metal.tube(W(u, roofY - 1, w), W(u, roofY + 7, w), 3, 3, D.fine ? 5 : 4, { caps: true });
    }
  }
  if (D.fine) {
    trim.rgb(...BLACK);
    const f0 = top.rearW + 26;
    trim.quad(W(0.3, roofY, f0 + 15), W(0.3, roofY, f0 - 2), W(0.3, roofY + 10, f0 - 1), W(0.3, roofY + 3, f0 + 15));
    trim.quad(W(-0.3, roofY, f0 - 2), W(-0.3, roofY, f0 + 15), W(-0.3, roofY + 3, f0 + 15), W(-0.3, roofY + 10, f0 - 1));
    const base = slice(0.05);
    for (const s of [-1, 1]) trim.tube(W(s * 8, base.y + 1.5, base.frontW - 2), W(s * (hw * 0.58), base.y + 1, base.frontW - 7), 1.1, 1.1, 4);
  }

  // ---------------------------------------------------------------- the nose
  const noseTop = topAt(hl);
  const noseBottom = bottomAt(hl);
  const edgeU = (w, y) => sideU(w, y) - 0.4; // (inside the face's outline)
  const lampHi = noseTop - 3;
  const lampLo = lampHi - (S.tall ? 14 : 13);
  const grilleLo = lampLo - (S.tall ? 26 : 14);
  const lampIn = hw * (S.tall ? 0.43 : 0.4);
  // The headlamps: a glossy unit, its light guide along the top, a projector; wrapping round
  // the corner onto the side.
  for (const s of [-1, 1]) {
    const wrapW = along(hl - S.front * 0.9, hl);
    const faceStrip = (g, ya, yb, off) => {
      const ua = lampIn;
      const q = [[s * ua, ya + 1.5], [s * edgeU(hl, ya), ya + 2.5], [s * edgeU(hl, yb), yb], [s * ua, yb - 1]];
      endFace(g, 1, q, off);
      if (D.wrap) sideStrip(g, s, wrapW, [ya + 2.5, yb], off);
    };
    lamp.rgb(0.1, 0.105, 0.115);
    faceStrip(lamp, lampLo, lampHi, 0.5);
    lamp.rgb(0.72, 0.74, 0.78);
    faceStrip(lamp, lampHi - 3, lampHi - 1.4, 0.8);
    if (D.fine) {
      // Two projectors: chrome rings round dark lenses.
      for (const k of [0, 1]) {
        const cu = s * (lampIn + 9 + k * 13);
        const cy = (lampLo + lampHi - 3) / 2;
        const ringAt = (r, a) => [cu + Math.cos(a) * r, cy + Math.sin(a) * r];
        for (let i = 0; i < 8; i++) {
          const [a0, a1] = [(i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2];
          rim.rgb(...RIM);
          endFace(rim, 1, [ringAt(4.2, a0), ringAt(4.2, a1), ringAt(3, a1), ringAt(3, a0)], 0.9);
          trim.rgb(0.012, 0.012, 0.014);
          endFace(trim, 1, [ringAt(3, a0), ringAt(3, a1), ringAt(0.4, a1), ringAt(0.4, a0)], 0.85);
        }
      }
    }
  }
  // The grille between them, its slats; the bumper's band (the body), the lower intake, the skid
  // plate.
  trim.rgb(...BLACK);
  const gw = lampIn - 3;
  endFace(trim, 1, [[-gw * 0.9, grilleLo], [gw * 0.9, grilleLo], [gw, lampHi + 1], [-gw, lampHi + 1]], 0.5);
  if (D.fine) {
    // Its surround (silver on the crossovers: a thin frame).
    metal.rgb(...(S.tall ? SILVER : BLACK));
    for (const [a, b] of [[[-gw * 0.9 - 2, grilleLo - 2], [gw * 0.9 + 2, grilleLo - 2]], [[-gw - 2, lampHi + 3], [gw + 2, lampHi + 3]]]) endFace(metal, 1, [a, b, [b[0], b[1] + 2], [a[0], a[1] + 2]], 0.7);
    for (const e of [-1, 1]) endFace(metal, 1, [[e * gw * 0.9, grilleLo - 2], [e * (gw * 0.9 + 2), grilleLo - 2], [e * (gw + 2), lampHi + 3], [e * gw, lampHi + 3]], 0.7);
  }
  if (D.fine) {
    metal.rgb(0.1, 0.1, 0.105);
    const slats = S.tall ? 4 : 3;
    for (let k = 1; k <= slats; k++) {
      const y = grilleLo + ((lampHi - 1 - grilleLo) * k) / (slats + 1);
      const ww = gw * (0.9 + (0.1 * (y - grilleLo)) / (lampHi - 1 - grilleLo)) - 3;
      endFace(metal, 1, [[-ww, y - 1], [ww, y - 1], [ww, y + 1], [-ww, y + 1]], 1.0);
    }
  }
  // The lower bumper: a black band across the face's foot wrapping round the corners onto the
  // sides (the crossovers' cladding: as tall as the face's band, the edges meet), the intake
  // over its middle, a silver skid plate in it.
  const lowH = S.tall ? 13 : 7;
  const intakeHi = Math.min(grilleLo - 8, noseBottom + (S.tall ? 28 : 18));
  trim.rgb(...PLASTIC);
  const iw = (y) => Math.min(edgeU(hl, y) - 6, hw * 0.62);
  endFace(trim, 1, [[-edgeU(hl, noseBottom + 1), noseBottom + 0.5], [edgeU(hl, noseBottom + 1), noseBottom + 0.5], [edgeU(hl, noseBottom + lowH), noseBottom + lowH], [-edgeU(hl, noseBottom + lowH), noseBottom + lowH]], 0.5);
  endFace(trim, 1, [[-iw(noseBottom + lowH), noseBottom + lowH - 0.5], [iw(noseBottom + lowH), noseBottom + lowH - 0.5], [iw(intakeHi) - 6, intakeHi], [-iw(intakeHi) + 6, intakeHi]], 0.5);
  if (D.wrap) for (const s of [-1, 1]) sideStrip(trim, s, along(hl - S.front, hl), [noseBottom + 0.5, noseBottom + lowH], 0.5);
  if (S.tall) {
    metal.rgb(...SILVER);
    endFace(metal, 1, [[-hw * 0.36, noseBottom + 2], [hw * 0.36, noseBottom + 2], [hw * 0.34, noseBottom + 8], [-hw * 0.34, noseBottom + 8]], 0.9);
  }

  // ---------------------------------------------------------------- the tail
  const tailTop = topAt(-hl);
  const tailBottom = bottomAt(-hl);
  const tHi = tailTop - 3;
  const tLo = tHi - (S.tall ? 12 : 13);
  for (const s of [-1, 1]) {
    const wrapW = along(-hl, -hl + S.rear * 1.1);
    tail.rgb(0.36, 0.012, 0.01);
    const ua = hw * 0.34;
    endFace(tail, -1, [[s * ua, tLo + 2], [s * edgeU(-hl, tLo), tLo], [s * edgeU(-hl, tHi), tHi], [s * ua, tHi]], 0.5);
    if (D.wrap) sideStrip(tail, s, wrapW, [tLo, tHi], 0.5);
    // Its light guides: two brighter bars along it, a dark line between them.
    tail.rgb(0.62, 0.03, 0.02);
    for (const y of [tLo + 2.5, tHi - 4]) endFace(tail, -1, [[s * (ua + 3), y], [s * (edgeU(-hl, y) - 2), y], [s * (edgeU(-hl, y + 1.6) - 2), y + 1.6], [s * (ua + 3), y + 1.6]], 0.8);
    if (D.fine) {
      trim.rgb(0.05, 0.005, 0.005);
      const y = (tLo + tHi) / 2 - 0.6;
      endFace(trim, -1, [[s * (ua + 3), y], [s * (edgeU(-hl, y) - 2), y], [s * (edgeU(-hl, y) - 2), y + 1.2], [s * (ua + 3), y + 1.2]], 0.8);
    }
  }
  // The tailgate's handle strip (where a plate would sit: none), the black lower bumper with
  // reflectors and a silver insert.
  metal.rgb(...(S.tall ? BLACK : SILVER));
  endFace(metal, -1, [[-hw * 0.22, tLo - 8], [hw * 0.22, tLo - 8], [hw * 0.22, tLo - 5], [-hw * 0.22, tLo - 5]], 0.6);
  const bumperHi = tailBottom + (S.tall ? 30 : 20);
  trim.rgb(...PLASTIC);
  endFace(trim, -1, [[-edgeU(-hl, tailBottom + 1), tailBottom + 0.5], [edgeU(-hl, tailBottom + 1), tailBottom + 0.5], [edgeU(-hl, bumperHi), bumperHi], [-edgeU(-hl, bumperHi), bumperHi]], 0.5);
  if (D.wrap) for (const s of [-1, 1]) sideStrip(trim, s, along(-hl, -hl + S.rear * 1.2), [tailBottom + 0.5, bumperHi], 0.5);
  if (S.tall) {
    metal.rgb(...SILVER);
    endFace(metal, -1, [[-hw * 0.4, tailBottom + 3], [hw * 0.4, tailBottom + 3], [hw * 0.38, tailBottom + 9], [-hw * 0.38, tailBottom + 9]], 0.9);
  }
  tail.rgb(0.3, 0.01, 0.008);
  for (const s of [-1, 1]) endFace(tail, -1, [[s * (hw * 0.6), bumperHi - 12], [s * (edgeU(-hl, bumperHi) - 6), bumperHi - 12], [s * (edgeU(-hl, bumperHi) - 6), bumperHi - 8], [s * (hw * 0.6), bumperHi - 8]], 0.9);

  // ---------------------------------------------------------------- the sides
  const cladHi = floor + (S.tall ? 22 : 9);
  const between = (w0, w1, k) => Array.from({ length: k + 1 }, (_, i) => w0 + ((w1 - w0) * i) / k);
  for (const s of [-1, 1]) {
    // Sill cladding between the arches (black on the crossovers, a thin black sill strip on the
    // others).
    trim.rgb(...PLASTIC);
    sideStrip(trim, s, between(axles[1] + ra, axles[0] - ra, D.fine ? 6 : 2), [floor + 0.5, cladHi], 0.6);
    // Door shut lines, flush handles.
    trim.rgb(...BLACK);
    const doors = van ? [axles[0] - ra - 10] : [axles[0] - ra - 10, (gs[0].rearW + (gs[0].frontW - gs[0].rearW) * pillars[0]), axles[1] + ra + 8];
    for (const w of doors) sideStrip(trim, s, [w - 0.7, w + 0.7], [cladHi + 1, (cladHi + windowLine) / 2, windowLine - 5], 0.35);
    metal.rgb(...SILVER);
    for (const w of [doors[0] - 34, (doors[1] ?? doors[0] - 200) - 34]) sideStrip(metal, s, [w - 11, w + 11], [windowLine - 26, windowLine - 22], 0.6);
    // The mirror: a housing on a black stalk at the A pillar's foot (its axes kept
    // right-handed on either side).
    trim.rgb(...BLACK);
    const m = screen0 - 8;
    const base = onSide(s, m, windowLine - 6, 0);
    trim.tube(base, W(s * (hw + 4), windowLine + 6, m - 4), 2.6, 2.6, D.fine ? 5 : 4, { caps: true });
    const housing = S.tall ? trim : paint;
    housing.ellipsoid(W(s * (hw + 8), windowLine + 10, m - 6), dirW(s, 0, 0), [0, 1, 0], dirW(0, 0, s), 9.5, 7.5, 6, D.fine ? 10 : 6, D.fine ? 6 : 4);
  }

  // ---------------------------------------------------------------- the wheels
  const SIDES = D.sides;
  const tw = S.tall ? 34 : 30;
  const RR = R * 0.66; // (the rim: big wheels, low-profile tyres)
  for (const wc of axles) {
    for (const s of [-1, 1]) {
      const uc = s * (hw - tw / 2 - 3);
      // A ring round the axis at radius r, du out from the tyre's middle; the tread's lowest
      // points on the ground (the patch the car stands on).
      const disc = (r, du, flat = false) => Array.from({ length: SIDES }, (_, i) => {
        const a = (s * i * Math.PI * 2) / SIDES;
        const y = yC + Math.cos(a) * r;
        return W(uc + du * s, flat ? Math.max(y0, y) : y, wc + Math.sin(a) * r);
      });
      tyre.rgb(...TYRE);
      const prof = [[RR + 1, -tw / 2 + 2], [R - 8, -tw / 2 - 0.5], [R - 2, -tw / 2 + 3.5], [R, -tw / 2 + 9], [R, tw / 2 - 9], [R - 2, tw / 2 - 3.5], [R - 8, tw / 2 + 0.5], [RR + 1, tw / 2 - 1], [RR + 1, -tw / 2 + 2]];
      tyre.loft(prof.map(([r, du]) => disc(r, du, r >= R - 2.5)));
      // The barrel (dark, deep), the brake disc, the rim's lip and its spokes, the hub.
      trim.rgb(...BARREL);
      trim.loft([[RR, tw / 2 - 1], [RR - 1.5, tw / 2 - 12], [RR * 0.35, tw / 2 - 15]].map(([r, du]) => disc(r, du)), { capEnd: true });
      if (D.fine) {
        metal.rgb(...DISC);
        metal.loft([[RR * 0.8, tw / 2 - 10], [RR * 0.2, tw / 2 - 10]].map(([r, du]) => disc(r, du)));
      }
      rim.rgb(...RIM);
      rim.loft([[RR + 0.6, tw / 2 + 0.4], [RR - 1.2, tw / 2 + 1.4], [RR - 3.2, tw / 2 - 0.6]].map(([r, du]) => disc(r, du)));
      rim.loft([[RR * 0.22, tw / 2 + 1.6], [RR * 0.12, tw / 2 + 2.3], [0.1, tw / 2 + 2.4]].map(([r, du]) => disc(r, du)));
      for (let k = 0; k < D.spokes; k++) {
        const a = (k / D.spokes) * Math.PI * 2 + 0.2;
        const p = (r, du) => W(uc + s * du, yC + Math.cos(a) * r, wc + Math.sin(a) * r);
        rim.tube(p(RR * 0.2, tw / 2 + 1.4), p(RR - 2.4, tw / 2 - 0.8), D.spokes > 5 ? 2.6 : 3.8, D.spokes > 5 ? 1.8 : 2.6, 4);
      }
      // The arch's liner: a black half drum round the tyre and its sides down to the floor,
      // closed inboard (the arch reads deep, nothing seen through it).
      trim.rgb(...LINER);
      const ui = s * (hw - tw - 9);
      const uo = s * (hw - 1);
      const N = D.arch;
      const arc = (i) => -Math.PI / 2 + (Math.PI * i) / N;
      for (let i = 0; i < N; i++) {
        const [a0, a1] = [arc(i), arc(i + 1)];
        const P = (a, u) => W(u, yC + Math.cos(a) * (ra - 0.6), wc + Math.sin(a) * (ra - 0.6));
        orient(trim, [P(a0, ui), P(a1, ui), P(a1, uo), P(a0, uo)], dirW(0, -Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2)));
        orientTri(trim, [W(ui, yC, wc), P(a0, ui), P(a1, ui)], dirW(s, 0, 0));
      }
      for (const e of [-1, 1]) {
        const w = wc + e * (ra - 0.6);
        orient(trim, [W(ui, floor, w), W(uo, floor, w), W(uo, yC, w), W(ui, yC, w)], dirW(0, 0, -e));
        orient(trim, [W(ui, floor, wc), W(ui, floor, w), W(ui, yC, w), W(ui, yC, wc)], dirW(s, 0, 0));
      }
      // The arch's flare: a band round it, proud of the body (black on the crossovers).
      const flare = S.tall ? trim : paint;
      if (S.tall) trim.rgb(...PLASTIC);
      const fw0 = S.tall ? 11 : 4;
      const proud = S.tall ? 2.6 : 1;
      const fu = (w) => halfAt(w) + swellAt(w) + proud;
      for (let i = 0; i < N; i++) {
        const [a0, a1] = [arc(i), arc(i + 1)];
        const P = (a, r) => {
          const w = wc + Math.sin(a) * r;
          return W(s * fu(w), yC + Math.cos(a) * r, w);
        };
        orient(flare, [P(a0, ra), P(a1, ra), P(a1, ra + fw0), P(a0, ra + fw0)], dirW(s, 0, 0));
        // (Its lip into the arch.)
        const Q = (a) => W(s * (halfAt(wc + Math.sin(a) * ra) - 1), yC + Math.cos(a) * ra, wc + Math.sin(a) * ra);
        orient(trim, [Q(a0), Q(a1), P(a1, ra), P(a0, ra)], dirW(0, -Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2)));
      }
      // ...and down the arch's sides to the sill.
      for (const e of [-1, 1]) {
        const w = wc + e * ra;
        const ww = wc + e * (ra + fw0);
        orient(flare, [W(s * fu(w), floor, w), W(s * fu(ww), floor, ww), W(s * fu(ww), yC, ww), W(s * fu(w), yC, w)], dirW(s, 0, 0));
      }
    }
  }

  // ---------------------------------------------------------------- the contact shadow
  // Under the body (darkest under its middle, fading out a little past its outline) and round
  // each tyre's patch: a darkening of the drive (colour: what the ground's light is multiplied
  // by; materials.js contactMaterial).
  if (contact) {
    const y = y0 + 0.35;
    const us = [-hw - 16, -hw + 10, -hw * 0.45, 0, hw * 0.45, hw - 10, hw + 16];
    const wsC = [-hl - 18, -hl + 14, -hl * 0.55, 0, hl * 0.55, hl - 14, hl + 18];
    const k = (u, w) => {
      const du = Math.max(0, Math.abs(u) - (hw - 26)) / 42;
      const dw = Math.max(0, Math.abs(w) - (hl - 36)) / 54;
      const t = Math.min(1, Math.hypot(du, dw));
      return 0.42 + 0.58 * t * t * (3 - 2 * t);
    };
    for (let j = 0; j + 1 < wsC.length; j++) {
      for (let i = 0; i + 1 < us.length; i++) {
        const q = [[us[i], wsC[j]], [us[i + 1], wsC[j]], [us[i + 1], wsC[j + 1]], [us[i], wsC[j + 1]]];
        const shade = q.map(([u, w]) => k(u, w));
        const P = q.map(([u, w]) => W(u, y, w));
        contact.rgb(1, 1, 1);
        if (dot(cross(sub(P[1], P[0]), sub(P[2], P[0])), [0, 1, 0]) >= 0) contact.quad(P[0], P[1], P[2], P[3], { shade });
        else contact.quad(P[1], P[0], P[3], P[2], { shade: [shade[1], shade[0], shade[3], shade[2]] });
      }
    }
    for (const wc of axles) {
      for (const s of [-1, 1]) {
        const uc = s * (hw - tw / 2 - 3);
        const E = 10;
        for (let i = 0; i < E; i++) {
          const [a0, a1] = [(i / E) * Math.PI * 2, ((i + 1) / E) * Math.PI * 2];
          const P = (a) => W(uc + Math.cos(a) * (tw / 2 + 7), y + 0.05, wc + Math.sin(a) * 34);
          const tri = [W(uc, y + 0.05, wc), P(a0), P(a1)];
          const up = dot(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])), [0, 1, 0]) >= 0;
          contact.rgb(1, 1, 1);
          if (up) contact.tri(tri[0], tri[1], tri[2], { shade: [0.38, 1, 1] });
          else contact.tri(tri[0], tri[2], tri[1], { shade: [0.38, 1, 1] });
        }
      }
    }
  }
}
