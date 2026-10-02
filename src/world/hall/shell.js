// The Great Hall's shell (hall/layout.js; the plan as runs of wall: hall/plan.js), written into
// the hall's kit (hall/hall.js): the floor, the walls in their bands, the vault and half-dome
// over them, the engaged columns and the windows, and the colliders of the room itself.
//
//   shell(kit, layout)                  kit.runs (planRuns) and kit.windows (windowSpots) set
//   windowSpots(layout, runs) -> [spot] each window: { run, i (its facet), u (along the facet),
//                                       sill, hw, height, x, z (its foot's middle on the wall),
//                                       n: [nx, nz] (into the room) }
//   vaultY(layout, x, z) -> y           the vault's (or the half-dome's) underside over (x, z)
//
// The floor (hall-floor): glazed tiles on a 200 grid inside a rose border ring and an ivory
// fillet that follow the walls round. The walls, bottom to top (layout ELEVATION): a marble
// skirting, teal raised panels (hall-dado, one panel per ~640 of each free stretch of wall)
// under a gold chair rail, cream plaster (tessellated so the bake can grade it) up to a marble
// cornice: a bead at the collision ceiling and a cove out to the vault's spring, unbroken round
// the room. The skirting and the dado stop at the front portal's pilaster bases (the skirting
// running into them) and the east doors' niches (the rail runs on over them), and die into the
// chimney breast and the buttress (the slot's back wall keeps its own), running a little into
// them, as each facet's plaster runs on behind its neighbours: no hairline of the void behind
// the walls shows at a corner or a joint. Behind the bottle the panelling rises to the
// headboard, its rail stepped up with gold returns either side: plain panelling, forever (no
// picture, emblem, window or light). Above the collision ceiling, out of the camera's reach
// and drawn only: an elliptical barrel vault over the nave and a half-dome over the apse,
// plaster strips up to the vault over the south rounds and the lunette over the door, marble
// ribs across the vault (the first, over the apse's mouth, a heavy gold-edged arch) and on the
// dome, on corbels. Six engaged columns: marble bases, rose-marble shafts (their sheen weight
// 1: hall.js), gold capitals, round over 210 degrees and smooth; 8-sided prisms as colliders.
// Eight round-headed windows, recessed in splayed marble reveals behind the wall's plane (no
// sill to stand on) with a moulded surround, a glowing pane and iron bars.

import { archContour, clipConvex, localBoxPolys, polyArea, prismPolys, sweep, wallFrame } from '../castle/geom.js';
import { archHole, facetPanel, planPolygon, planRuns, runPath, wallColliders } from './plan.js';

const TINT = {
  floor: 0xffffff,
  band: 0xc4745e, // the floor's rose border
  fillet: 0xf2e2b8,
  plaster: 0xfff0d6,
  vault: 0xfff4e2,
  panel: 0xffffff, // the dado (its texture is the panel)
  cream: 0xf0e6d2, // the trims, on the pale marble
  rose: 0xe3a08e, // rose marble: the column shafts
  gold: 0xe8b84a,
  iron: 0x3a3634,
  pane: 0xffe6a0,
};

const FLOOR = { step: 200, border: 260, fillet: 300, under: 6, drop: 0.5 }; // the field's grid; the rings' inner edges (inset); the fillet's strip under the field
const PROFILE = {
  skirting: [[30, 0], [30, 100], [34, 118], [30, 136], [16, 152], [0, 160]],
  rail: [[0, 990], [22, 996], [38, 1015], [42, 1035], [38, 1055], [22, 1072], [0, 1080]],
  // The cornice's bead at the collision ceiling, then a quarter-round cove of radius 200 out to
  // the vault's spring.
  cornice: [[0, 2550], [16, 2556], [26, 2570], [26, 2582], [16, 2594], [0, 2600], ...Array.from({ length: 6 }, (_, i) => {
    const t = ((i + 1) / 6) * (Math.PI / 2);
    return [200 - 200 * Math.cos(t), 2600 + 200 * Math.sin(t)];
  })],
};
// The bands' tessellation (along, up) and the dado's panels: about one per `panel` of wall.
const TESS = { plaster: [320, 380], dado: [320, 430] };
const DADO = { from: 150, to: 1002, panel: 640 }; // (overlapping the skirting and the rail a little)
const INTO = 4; // a band dying into the buttress or the chimney breast runs this far into it (no hairline at the corner)
const SEAM = 2; // each facet's plaster runs this far on behind its neighbours (no hairline at the joints)
const HEADBOARD = { facets: [6, 9], returns: { half: 30, depth: 40, over: 90 }, plasterGap: 70 };
const ROUND_WINDOW = { hw: 140, sill: 1200, height: 1200 }; // the south rounds' (their facets are 375 wide)
const WINDOW_TRIM = { narrow: 40, surround: 44, surroundDepth: 28, bar: 6, barDepth: [2, 12], transom: 0.36 };
const RIB = { heavy: { half: 160, depth: 150, bead: 30 }, light: { half: 70, depth: 90 }, corbel: 230, apse: { half: 70, depth: 90, segs: 6 } };
const DOME_RINGS = 6;
const COLUMN_PROFILE = [
  [200, 0], [200, 110], [186, 124], [196, 150], [206, 172], [196, 196], [172, 212], [146, 222], [136, 240], [126, 262],
  [122, 1200], [116, 2240], [132, 2252], [134, 2270], [124, 2284], [128, 2300], [156, 2390], [190, 2470], [212, 2520], [216, 2540], [216, 2610],
];
const COLUMN_PARTS = { base: [0, 10], shaft: [9, 12], capital: [11, COLUMN_PROFILE.length], spread: (105 * Math.PI) / 180, sides: 12 };

export function shell(kit, L) {
  kit.runs = planRuns(L);
  kit.windows = windowSpots(L, kit.runs);
  floor(kit, L);
  walls(kit, L);
  vault(kit, L);
  columns(kit, L);
  windows(kit, L);
}

// ---------------------------------------------------------------- the floor

function floor(kit, L) {
  const { floor: f, solids } = kit;
  const { HALL } = L;
  const outer = planPolygon(L, 0);
  const fillet = planPolygon(L, FLOOR.border);
  const field = planPolygon(L, FLOOR.fillet);
  f.color(TINT.floor);
  const S = FLOOR.step;
  for (let x = -HALL.halfX; x < HALL.halfX; x += S) {
    for (let z = HALL.northZ; z < HALL.southZ; z += S) {
      const cell = clipConvex([[x, z], [x + S, z], [x + S, z + S], [x, z + S]], field);
      if (cell.length < 3 || Math.abs(polyArea(cell)) < 1) continue;
      f.poly(cell.map(([px, pz]) => [px, 0, pz]), { facing: [0, 1, 0] });
    }
  }
  // The rings: their uvs on a plain grout texel of the tile, so they show their tint.
  const ring = (a, b, tint, y = 0) => {
    f.color(tint);
    const uvs = [[0.02, 0.25], [0.02, 0.25], [0.02, 0.25], [0.02, 0.25]];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      f.poly([[a[i][0], y, a[i][1]], [a[j][0], y, a[j][1]], [b[j][0], y, b[j][1]], [b[i][0], y, b[i][1]]], { facing: [0, 1, 0], uvs });
    }
  };
  ring(outer, fillet, TINT.band);
  ring(fillet, field, TINT.fillet);
  // ...and the fillet on in under the field's edge (the clipped cells' edges there have corners
  // the ring's lack: no hairline shows through between them).
  ring(field, planPolygon(L, FLOOR.fillet + FLOOR.under), TINT.fillet, -FLOOR.drop);
  // The floor and ceiling slabs under and over everything (the plan's walls: wallColliders).
  const { halfX: X, thick: T, northZ: N, southZ: Sz, ceilingY: H } = HALL;
  solids.box(-X - 1500, X + 1500, -T, 0, N - 1500, Sz + 700, 'stone');
  solids.box(-X - 1500, X + 1500, H, H + T, N - 1500, Sz + 700, 'stone', { bottom: true, top: false });
}

// ---------------------------------------------------------------- the walls

// Where each band runs: per run, the stretches (arc length) of free wall the skirting runs
// along (each end dying into something solid: a pilaster's base, a niche's architrave, a pier)
// and the dado's stretches (the free wall's, and the door regions' behind the portal and the
// niches, the front door's opening cut out).
function wallSpans(L, runs) {
  const by = Object.fromEntries(runs.map((r) => [r.name, r]));
  const end = (name) => by[name].s[by[name].s.length - 1];
  const full = (name) => ({ skirting: [[0, end(name)]], dado: [[0, end(name)]] });
  const spans = { sw: full('sw'), apse: full('apse'), se: full('se') };
  // South: the front door (its middle `u` along the run), the portal's pilasters either side
  // (the skirting runs into their bases).
  const u = L.ROUNDS.x - L.FRONT_DOOR.x;
  const p = L.PORTAL.pilasterU + L.PORTAL.baseR;
  const q = L.PORTAL.pilasterU;
  const hw = L.FRONT_DOOR.width / 2;
  spans.south = {
    skirting: [[0, u - q], [u + q, end('south')]],
    dado: [[0, u - p], [u - p, u + p, [archHole(u, 0, hw, L.FRONT_DOOR.height - hw, 16)]], [u + p, end('south')]],
  };
  // West (from the south round north): the chimney breast, the slot, the buttress.
  const west = (z) => L.ROUNDS.z - z;
  const [slot0, slot1, buttress] = [west(L.SLOT.z1) - INTO, west(L.SLOT.z0) + INTO, west(L.BUTTRESS.z0) - INTO];
  spans.west = {
    skirting: [[slot0, slot1], [buttress, end('west')]],
    dado: [[slot0, slot1], [buttress, end('west')]],
  };
  // East (from the apse south): the two doors' niches (the open door's opening cut out).
  const east = (z) => z - L.APSE.z;
  const D = L.EAST_DOORS;
  const niche = D.width / 2 + 150;
  spans.east = { skirting: [], dado: [] };
  let s = 0;
  D.zs.forEach((z, i) => {
    const hole = i === D.open ? [archHole(east(z), 0, D.width / 2, D.height - D.width / 2, 16)] : [];
    spans.east.skirting.push([s, east(z) - niche]);
    spans.east.dado.push([s, east(z) - niche], [east(z) - niche, east(z) + niche, hole]);
    s = east(z) + niche;
  });
  spans.east.skirting.push([s, end('east')]);
  spans.east.dado.push([s, end('east')]);
  return spans;
}

function walls(kit, L) {
  const { wall, dado, trim, paint, solids, runs } = kit;
  const E = L.ELEVATION;
  const spans = wallSpans(L, runs);
  // The windows' holes in the plaster, by facet.
  const holes = {};
  for (const w of kit.windows) (holes[`${w.run}:${w.i}`] ??= []).push(archHole(w.u, w.sill, w.hw, w.height - w.hw, 16));
  const [h0, h1] = HEADBOARD.facets;
  for (const run of runs) {
    const headboard = run.name === 'apse';
    for (let i = 0; i + 1 < run.pts.length; i++) {
      const behind = headboard && i >= h0 && i <= h1;
      wall.color(TINT.plaster);
      const from = behind ? E.headboard + HEADBOARD.plasterGap : E.railTop - 10;
      const len = run.s[i + 1] - run.s[i];
      facetPanel(wall, run, i, from, E.corniceY, { du: TESS.plaster[0], dv: TESS.plaster[1], holes: holes[`${run.name}:${i}`] ?? [], u0: -SEAM, u1: len + SEAM });
      if (behind) {
        // The headboard: the panelling on up behind the bottle, one panel a facet.
        dado.color(TINT.panel);
        const uv = (s, v) => [(s - run.s[i]) / len, (v - E.dadoTop) / (E.headboard - E.dadoTop)];
        facetPanel(dado, run, i, E.dadoTop, E.headboard, { du: TESS.dado[0], dv: TESS.dado[1], uv });
      }
    }
    trim.color(TINT.cream);
    for (const [s0, s1] of spans[run.name].skirting) if (s1 - s0 > 5) sweep(trim, runPath(run, s0, s1), PROFILE.skirting);
  }
  // The dado, group by group (each fitted with whole panels, about one per DADO.panel along it,
  // running on round the room's joints), stretch by stretch, facet by facet.
  dado.color(TINT.panel);
  for (const group of dadoGroups(runs, spans)) {
    const total = group.reduce((sum, p) => sum + p.s1 - p.s0, 0);
    const n = Math.max(1, Math.round(total / DADO.panel));
    let along = 0;
    for (const { run, s0, s1, holes } of group) {
      const start = along;
      const uv = (s, v) => [((start + s - s0) * n) / total, (v - E.skirting) / (E.dadoTop - E.skirting)];
      for (let i = 0; i + 1 < run.pts.length; i++) {
        const [a, b] = [run.s[i], run.s[i + 1]];
        if (b <= s0 || a >= s1) continue;
        const local = holes.map((hole) => hole.map(([hu, hv]) => [hu - a, hv]));
        facetPanel(dado, run, i, DADO.from, DADO.to, { du: TESS.dado[0], dv: TESS.dado[1], holes: local, uv, u0: Math.max(0, s0 - a), u1: Math.min(b, s1) - a });
      }
      along += s1 - s0;
    }
  }
  // The chair rail: unbroken from the buttress round the apse, the east wall, the rounds and
  // the south wall to the chimney breast; and along the slot's back wall.
  const by = Object.fromEntries(runs.map((r) => [r.name, r]));
  const end = (name) => by[name].s[by[name].s.length - 1];
  const west = (z) => L.ROUNDS.z - z;
  paint.color(TINT.gold);
  sweep(paint, loopPath([[by.west, west(L.BUTTRESS.z0) - INTO, end('west')], ...['apse', 'east', 'se', 'south', 'sw'].map((n) => [by[n], 0, end(n)])]), PROFILE.rail);
  sweep(paint, runPath(by.west, west(L.SLOT.z1) - INTO, west(L.SLOT.z0) + INTO), PROFILE.rail);
  // The headboard's rail, stepped up, and its gold returns down to the chair rail.
  const apse = by.apse;
  const up = E.headboard - PROFILE.rail[0][1];
  sweep(paint, runPath(apse, apse.s[h0], apse.s[h1 + 1]), PROFILE.rail.map(([w, v]) => [w, v + up]));
  const R = HEADBOARD.returns;
  for (const k of [h0, h1 + 1]) {
    const [x, z] = apse.pts[k];
    const frame = wallFrame([x, 0, z], [apse.nrm[k][0], 0, apse.nrm[k][1]]);
    paint.solid(localBoxPolys(frame, -R.half, R.half, PROFILE.rail[0][1], E.headboard + R.over, 0, R.depth));
  }
  // The cornice, unbroken round the whole room.
  trim.color(TINT.cream);
  sweep(trim, loopPath(runs.map((run) => [run, 0, end(run.name)])), PROFILE.cornice, { closed: true });
  wallColliders(L, solids);
}

// The dado's stretches in groups: a stretch ending at its run's end and the next run's first,
// starting at its start, are one group (the wall runs on smoothly round the joint), the last
// run's joining the first's. [[{ run, s0, s1, holes }]]
function dadoGroups(runs, spans) {
  const parts = runs.flatMap((run) => spans[run.name].dado.map(([s0, s1, holes = []]) => ({ run, s0, s1, holes })));
  const atEnd = (p) => p.s1 >= p.run.s[p.run.s.length - 1] - 1e-6;
  const next = (p, q) => runs.indexOf(q.run) === (runs.indexOf(p.run) + 1) % runs.length && q.s0 < 1e-6 && atEnd(p);
  const groups = [];
  for (const p of parts) {
    const group = groups[groups.length - 1];
    if (group && next(group[group.length - 1], p)) group.push(p);
    else groups.push([p]);
  }
  const [first, last] = [groups[0], groups[groups.length - 1]];
  if (groups.length > 1 && next(last[last.length - 1], first[0])) groups[0] = [...groups.pop(), ...first];
  return groups;
}

// One sweep path along several runs' stretches in a row (each starting where the last ends;
// the points they share once).
function loopPath(stretches) {
  const path = [];
  for (const [run, s0, s1] of stretches) {
    for (const P of runPath(run, s0, s1)) {
      const last = path[path.length - 1];
      if (!last || Math.hypot(last.p[0] - P.p[0], last.p[2] - P.p[2]) > 1e-6) path.push(P);
    }
  }
  const [a, b] = [path[0], path[path.length - 1]];
  if (Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) < 1e-6) path.pop();
  return path;
}

// ---------------------------------------------------------------- the vault

export function vaultY({ HALL, APSE, VAULT }, x, z) {
  const a = HALL.halfX - 200;
  const r = z < APSE.z ? Math.hypot(x - APSE.x, z - APSE.z) : Math.abs(x);
  return VAULT.spring + VAULT.rise * Math.sqrt(Math.max(0, 1 - (r / a) ** 2));
}

function vault(kit, L) {
  const { wall, trim, paint } = kit;
  const { HALL, APSE, ROUNDS, VAULT } = L;
  const a = HALL.halfX - 200; // the springing's half-width (the cornice cove's inner edge)
  const { spring, rise, segments: n } = VAULT;
  const zS = HALL.southZ - 200; // the lunette's plane over the front door
  const zN = APSE.z;
  // Point k of the barrel's section (west to east over the top) and its normal (down into the
  // room).
  const section = (k) => {
    const phi = Math.PI - (k / n) * Math.PI;
    const x = a * Math.cos(phi);
    const y = spring + rise * Math.sin(phi);
    const nx = -x / (a * a);
    const ny = -(y - spring) / (rise * rise);
    const l = Math.hypot(nx, ny) || 1;
    return { x, y, nx: nx / l, ny: ny / l, phi };
  };
  // The barrel, in rows along z every ~600.
  const zs = [zN];
  for (let z = zN + 600; z < zS; z += 600) zs.push(z);
  zs.push(zS);
  wall.color(TINT.vault);
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let k = 0; k < n; k++) {
      const [p, q] = [section(k), section(k + 1)];
      const V = (e, z) => ({ p: [e.x, e.y, z], n: [e.nx, e.ny, 0], t: [(e.phi * 1500) / wall.repeat, z / wall.repeat], s: 1 });
      const facing = [p.nx + q.nx, p.ny + q.ny, 0];
      wall._triV(V(p, zs[j]), V(q, zs[j]), V(q, zs[j + 1]), facing);
      wall._triV(V(p, zs[j]), V(q, zs[j + 1]), V(p, zs[j + 1]), facing);
    }
  }
  // The half-dome over the apse: a spheroid quarter, radius a across and `rise` up.
  const dome = (ring, k) => {
    const phi = (ring / DOME_RINGS) * (Math.PI / 2);
    const th = (k / n) * Math.PI; // east (0) round through north to west
    const h = a * Math.cos(phi);
    const x = h * Math.cos(th);
    const y = spring + rise * Math.sin(phi);
    const z = zN - h * Math.sin(th);
    const nn = [-x / (a * a), -(y - spring) / (rise * rise), -(z - zN) / (a * a)];
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    return { p: [x, y, z], n: [nn[0] / l, nn[1] / l, nn[2] / l], t: [(th * a) / wall.repeat / 2, (phi * 1300) / wall.repeat], s: 1 };
  };
  for (let r = 0; r < DOME_RINGS; r++) {
    for (let k = 0; k < n; k++) {
      const [A0, B0, A1, B1] = [dome(r, k), dome(r, k + 1), dome(r + 1, k), dome(r + 1, k + 1)];
      const facing = [A0.n[0] + B1.n[0], A0.n[1] + B1.n[1], A0.n[2] + B1.n[2]];
      wall._triV(A0, B0, B1, facing);
      if (r + 1 < DOME_RINGS) wall._triV(A0, B1, A1, facing);
    }
  }
  // Plaster strips up to the vault where the cornice's inner edge lies inside its springing:
  // over the south rounds, and the lunette over the front door.
  const inner = planPolygon(L, 200);
  wall.color(TINT.plaster);
  for (let i = 0; i < inner.length; i++) {
    const [x0, z0] = inner[i];
    const [x1, z1] = inner[(i + 1) % inner.length];
    if (z0 < ROUNDS.z - 1 && z1 < ROUNDS.z - 1) continue;
    const pieces = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 250));
    const facing = [-(x0 + x1) / 2, 0, -(z0 + z1) / 2 + 400];
    for (let p = 0; p < pieces; p++) {
      const [ta, tb] = [p / pieces, (p + 1) / pieces];
      const [xa, za] = [x0 + (x1 - x0) * ta, z0 + (z1 - z0) * ta];
      const [xb, zb] = [x0 + (x1 - x0) * tb, z0 + (z1 - z0) * tb];
      const ya = vaultY(L, xa, Math.min(za, zS));
      const yb = vaultY(L, xb, Math.min(zb, zS));
      if (ya < spring + 2 && yb < spring + 2) continue;
      for (let r = 0; r < 3; r++) {
        const y = (top, t) => spring + ((top - spring) * t) / 3;
        wall.poly([[xa, y(ya, r), za], [xb, y(yb, r), zb], [xb, y(yb, r + 1), zb], [xa, y(ya, r + 1), za]], { facing });
      }
    }
  }
  // The ribs across the vault, following its section (the first, over the apse's mouth, heavy
  // with a gold bead along each face), each end on a corbel.
  for (const z of VAULT.ribs) {
    const heavy = z === APSE.z;
    const { half, depth } = heavy ? RIB.heavy : RIB.light;
    trim.color(TINT.cream);
    for (let k = 0; k < n; k++) {
      const [p, q] = [section(k), section(k + 1)];
      const pi = [p.x + p.nx * depth, p.y + p.ny * depth];
      const qi = [q.x + q.nx * depth, q.y + q.ny * depth];
      for (const s of [-1, 1]) {
        const zz = z + s * half;
        trim.poly([[p.x, p.y, zz], [q.x, q.y, zz], [qi[0], qi[1], zz], [pi[0], pi[1], zz]], { facing: [0, 0, s], shade: 0.92 });
      }
      const [np, nq] = [[p.nx, p.ny, 0], [q.nx, q.ny, 0]];
      trim.tri([pi[0], pi[1], z - half], [qi[0], qi[1], z - half], [qi[0], qi[1], z + half], { normals: [np, nq, nq] });
      trim.tri([pi[0], pi[1], z - half], [qi[0], qi[1], z + half], [pi[0], pi[1], z + half], { normals: [np, nq, np] });
      if (heavy) {
        paint.color(TINT.gold);
        const b = RIB.heavy.bead;
        for (const s of [-1, 1]) {
          const zz = z + s * (half + 8);
          paint.poly([[pi[0], pi[1], zz], [qi[0], qi[1], zz], [qi[0] - q.nx * b, qi[1] - q.ny * b, zz], [pi[0] - p.nx * b, pi[1] - p.ny * b, zz]], { facing: [0, 0, s] });
        }
      }
    }
    trim.color(TINT.cream);
    for (const s of [-1, 1]) {
      const [xa, xb] = [s * (HALL.halfX - RIB.corbel), s * HALL.halfX].sort((u, v) => u - v);
      trim.box(xa, xb, HALL.ceilingY, spring, z - half - 10, z + half + 10, { bottom: true, faceShade: (nn) => (nn[1] < -0.5 ? 0.6 : 1) });
      // The rib's foot, closed underneath where it stands out past its corbel.
      const e = section(s < 0 ? 0 : n);
      const [ex, ey] = [e.x + e.nx * depth, e.y + e.ny * depth];
      trim.poly([[e.x, e.y, z - half], [ex, ey, z - half], [ex, ey, z + half], [e.x, e.y, z + half]], { facing: [0, -1, 0], shade: 0.6 });
    }
  }
  // Ribs on the dome's meridians.
  const R = RIB.apse;
  trim.color(TINT.cream);
  for (const deg of VAULT.apseRibs) {
    const th = (deg * Math.PI) / 180;
    const w = R.half / a;
    for (let r = 0; r < R.segs; r++) {
      const P = (rr, dth, inset) => {
        const phi = (rr / R.segs) * (Math.PI / 2);
        const h = (a - inset) * Math.cos(phi);
        return [h * Math.cos(th + dth), spring + (rise - inset) * Math.sin(phi), zN - h * Math.sin(th + dth)];
      };
      const down = (rr) => {
        const phi = (rr / R.segs) * (Math.PI / 2);
        return [-Math.cos(phi) * Math.cos(th), -Math.sin(phi) * 2, Math.cos(phi) * Math.sin(th)];
      };
      trim.poly([P(r, -w, R.depth), P(r, w, R.depth), P(r + 1, w, R.depth), P(r + 1, -w, R.depth)], { facing: down(r + 0.5) });
      if (r === 0) trim.poly([P(0, -w, 0), P(0, w, 0), P(0, w, R.depth), P(0, -w, R.depth)], { facing: [0, -1, 0], shade: 0.6 }); // its foot, closed
      for (const s of [-1, 1]) {
        const side = [P(r, s * w, 0), P(r + 1, s * w, 0), P(r + 1, s * w, R.depth), P(r, s * w, R.depth)];
        trim.poly(side, { facing: [-Math.sin(th) * s, 0, -Math.cos(th) * s], shade: 0.9 });
      }
    }
  }
}

// ---------------------------------------------------------------- the columns

function columns(kit, L) {
  const { trim, paint, solids } = kit;
  const { base, shaft, capital, spread, sides } = COLUMN_PARTS;
  for (const c of L.COLUMNS) {
    // Facing into the room: toward the apse's middle in the apse, across the nave elsewhere.
    const [ox, oz] = c.z < L.APSE.z ? [L.APSE.x - c.x, L.APSE.z - c.z] : [-Math.sign(c.x), 0];
    const half = { a0: Math.atan2(ox, oz) - spread, arc: 2 * spread, smoothProfile: true };
    trim.color(TINT.cream);
    trim.lathe(c.x, c.z, COLUMN_PROFILE.slice(...base), sides, half);
    trim.color(TINT.rose);
    trim.glow = 1; // the shaft's sheen weight (hall.js)
    trim.lathe(c.x, c.z, COLUMN_PROFILE.slice(...shaft), sides, { ...half, uRepeats: 2 });
    trim.glow = 0;
    paint.color(TINT.gold);
    paint.lathe(c.x, c.z, COLUMN_PROFILE.slice(...capital), sides, half);
    solids.solid(prismPolys(c.x, c.z, L.COLUMN.r, 8, 0, L.HALL.ceilingY, { top: false }), 'stone');
  }
}

// ---------------------------------------------------------------- the windows

export function windowSpots(L, runs) {
  const by = Object.fromEntries(runs.map((r) => [r.name, r]));
  const W = L.WINDOW;
  return L.WINDOWS.map((w) => {
    let spot;
    if (w.apseFacet !== undefined) {
      const run = by.apse;
      spot = { run: 'apse', i: w.apseFacet, u: (run.s[w.apseFacet + 1] - run.s[w.apseFacet]) / 2, sill: W.sill, hw: W.width / 2, height: W.height };
    } else if (w.round !== undefined) {
      const run = by[w.round > 0 ? 'se' : 'sw'];
      const i = Math.floor(L.ROUNDS.facets / 2);
      spot = { run: run.name, i, u: (run.s[i + 1] - run.s[i]) / 2, ...ROUND_WINDOW };
    } else {
      const west = w.x < 0;
      spot = { run: west ? 'west' : 'east', i: 0, u: west ? L.ROUNDS.z - w.z : w.z - L.APSE.z, sill: W.sill, hw: W.width / 2, height: W.height };
    }
    const run = by[spot.run];
    const [a, b] = [run.pts[spot.i], run.pts[spot.i + 1]];
    const t = spot.u / (run.s[spot.i + 1] - run.s[spot.i]);
    const [na, nb] = [run.nrm[spot.i], run.nrm[spot.i + 1]];
    const l = Math.hypot(na[0] + nb[0], na[1] + nb[1]);
    return { ...spot, x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, n: [(na[0] + nb[0]) / l, (na[1] + nb[1]) / l] };
  });
}

// Each window: a splayed reveal back to the pane (narrowing on all sides), a sill inside it, a
// moulded surround standing out of the wall, the glowing pane, an iron mullion and transoms.
function windows(kit, L) {
  const { trim, glow, wood } = kit;
  const D = L.WINDOW.splay;
  const T = WINDOW_TRIM;
  for (const w of kit.windows) {
    const frame = wallFrame([w.x, w.sill, w.z], [w.n[0], 0, w.n[1]]);
    const spring = w.height - w.hw;
    const hole = archContour(w.hw, spring, 16);
    const back = archContour(w.hw - T.narrow, spring, 16);
    trim.color(TINT.cream);
    for (let k = 0; k + 1 < hole.length; k++) {
      const mu = (hole[k][0] + hole[k + 1][0]) / 2;
      const mv = (hole[k][1] + hole[k + 1][1]) / 2;
      const facing = frame.dir(-mu, spring - mv, 60); // into the opening and out of the wall
      const [a, b, c, d] = [hole[k], hole[k + 1], back[k + 1], back[k]];
      trim.poly([frame.at(a[0], a[1], 0), frame.at(b[0], b[1], 0), frame.at(c[0], c[1], -D), frame.at(d[0], d[1], -D)], { facing, shade: 0.8 });
    }
    trim.poly([frame.at(-w.hw, 0, 0), frame.at(w.hw, 0, 0), frame.at(w.hw - T.narrow, 0, -D), frame.at(-w.hw + T.narrow, 0, -D)], { facing: [0, 1, 0], shade: 1.05 });
    trim.moulding(frame, hole, archContour(w.hw + T.surround, spring, 16), T.surroundDepth, { w0: -4, revealShade: 0.7 });
    glow.color(TINT.pane);
    glow.panel(frame, back, -D, { shade: back.map(([, v]) => 0.8 + 0.32 * (v / w.height)) }); // (on the reveal's back edge: no gap round it)
    wood.color(TINT.iron);
    const [b0, b1] = [-D + T.barDepth[0], -D + T.barDepth[1]];
    wood.solid(localBoxPolys(frame, -T.bar, T.bar, 0, w.height - T.narrow, b0, b1, { bottom: false }));
    for (const v of [w.height * T.transom, spring]) wood.solid(localBoxPolys(frame, -w.hw + T.narrow, w.hw - T.narrow, v - T.bar, v + T.bar, b0, b1));
  }
}
