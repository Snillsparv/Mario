// The realistic look's touches on the villas up the hill (lane/houses.js villa(): their walls,
// bay windows, balconies and hipped roofs stay the classic builder's, drawn with the realistic
// materials), built in the worker (world/lane/real/detail.js) in place of their flat windows and
// garage doors:
//
//   villaWindows(kit, L)   // white casings standing proud of the wall round the glass (the
//                          // reflection probe's street over a dim room), sashes, a mullion and
//                          // a transom, a stone sill; plain or arched, where the classic ones are
//   garageDoors(kit, L)    // sectional doors (the villas' and the double garage's): four
//                          // sections in a white frame, a handle
//   hipTrim(kit, L)        // half-round gutters round the hipped roofs' eaves with a downpipe at
//                          // each front corner, rounded caps along the hips and the ridge
//
// kit: detail.js's Geo per material (paint, glass, core, metal, tiles, enamel).

import { add, mul, sub, norm } from './geo.js';
import { frameOf } from './house.js';

const WHITE = 0xf6f4ee;
const WIN = { w: 220, sill: 520, h: 200, frame: 12 };

// An opening's outline (u, v) on its wall: a rectangle, or one with a semicircular head;
// counter-clockwise seen from outside.
function outline(u, v0, hw, h, arched) {
  if (!arched) return [[u - hw, v0], [u + hw, v0], [u + hw, v0 + h], [u - hw, v0 + h]];
  const spring = v0 + h - hw;
  const pts = [[u - hw, v0], [u + hw, v0]];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    pts.push([u + hw * Math.cos(a), spring + hw * Math.sin(a)]);
  }
  return pts;
}

// A flat fan over an outline at w (it is convex).
function fan(g, f, pts, w) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    g.tri(f.at(c[0], c[1], w), f.at(a[0], a[1], w), f.at(b[0], b[1], w), { uvs: [c, a, b] });
  }
}

// A frame round an outline: a band `width` wide outside it, standing `depth` proud, its outer
// edge's side.
function surround(g, f, pts, width, w0, depth) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  const out = pts.map(([u, v], i) => {
    // Offset along the mean of the two edges' outward normals (mitred).
    const [pu, pv] = pts[(i + pts.length - 1) % pts.length];
    const [nu, nv] = pts[(i + 1) % pts.length];
    const n1 = norm([v - pv, -(u - pu), 0]);
    const n2 = norm([nv - v, -(nu - u), 0]);
    const m = norm(add(n1, n2));
    const k = width / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    const o = [u + m[0] * k, v + m[1] * k];
    // (Toward the outside: away from the middle.)
    return (o[0] - c[0]) * (u - c[0]) + (o[1] - c[1]) * (v - c[1]) >= 0 ? o : [u - m[0] * k, v - m[1] * k];
  });
  const W = w0 + depth;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    g.quad(f.at(pts[i][0], pts[i][1], W), f.at(out[i][0], out[i][1], W), f.at(out[j][0], out[j][1], W), f.at(pts[j][0], pts[j][1], W));
    g.quad(f.at(out[i][0], out[i][1], W), f.at(out[i][0], out[i][1], w0), f.at(out[j][0], out[j][1], w0), f.at(out[j][0], out[j][1], W));
    g.quad(f.at(pts[j][0], pts[j][1], W), f.at(pts[j][0], pts[j][1], w0), f.at(pts[i][0], pts[i][1], w0), f.at(pts[i][0], pts[i][1], W));
  }
}

function villaWindow({ paint, glass, core, enamel }, f, u, W, arched) {
  const hw = W.w / 2;
  const pts = outline(u, W.sill, hw, W.h, arched);
  core.rgb(0.1, 0.09, 0.08);
  fan(core, f, pts, 0.4);
  glass.color(0x9aa4a8);
  fan(glass, f, pts, 1.2);
  paint.color(WHITE);
  surround(paint, f, pts, W.frame, 0, 5);
  // The sashes: a mullion, a transom, a narrow frame inside the opening.
  const top = W.sill + W.h - (arched ? hw : 0);
  const bar = (u0, u1, v0, v1) => {
    paint.quad(f.at(u0, v0, 3), f.at(u1, v0, 3), f.at(u1, v1, 3), f.at(u0, v1, 3));
    paint.quad(f.at(u0, v1, 3), f.at(u1, v1, 3), f.at(u1, v1, 1), f.at(u0, v1, 1));
    paint.quad(f.at(u0, v0, 1), f.at(u1, v0, 1), f.at(u1, v0, 3), f.at(u0, v0, 3));
    paint.quad(f.at(u0, v0, 1), f.at(u0, v0, 3), f.at(u0, v1, 3), f.at(u0, v1, 1));
    paint.quad(f.at(u1, v0, 3), f.at(u1, v0, 1), f.at(u1, v1, 1), f.at(u1, v1, 3));
  };
  bar(u - 4, u + 4, W.sill, top);
  bar(u - hw, u + hw, W.sill + W.h * 0.68 - 3, W.sill + W.h * 0.68 + 3);
  // The sill: a pale stone slab under it, sloping out.
  enamel.color(0xd8d4cc);
  const [a, b] = [u - hw - W.frame - 10, u + hw + W.frame + 10];
  const v = W.sill - W.frame;
  enamel.quad(f.at(a, v, 12), f.at(b, v, 12), f.at(b, v + 3, 0), f.at(a, v + 3, 0));
  enamel.quad(f.at(a, v - 9, 12), f.at(b, v - 9, 12), f.at(b, v, 12), f.at(a, v, 12));
  enamel.quad(f.at(b, v - 9, 12), f.at(a, v - 9, 12), f.at(a, v - 9, 0), f.at(b, v - 9, 0));
  enamel.quad(f.at(a, v - 9, 0), f.at(a, v - 9, 12), f.at(a, v, 12), f.at(a, v + 3, 0));
  enamel.quad(f.at(b, v - 9, 12), f.at(b, v - 9, 0), f.at(b, v + 3, 0), f.at(b, v, 12));
}

export function villaWindows(kit, L) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const F = frameOf(h);
    const y0 = h.y0 ?? 22;
    const wallH = h.eave - y0;
    const front = F.face('front').f;
    if (h.render - y0 < wallH) {
      for (const u of h.windows ?? []) villaWindow(kit, front, u, WIN, false);
      for (const u of h.arches ?? []) villaWindow(kit, front, u, WIN, true);
      for (const name of ['back', 'left', 'right']) villaWindow(kit, F.face(name).f, 0, WIN, false);
    } else {
      const W = { ...WIN, sill: wallH - 230 };
      for (const u of [-550, 0, 550]) villaWindow(kit, front, u, W, false);
      for (const name of ['left', 'right']) villaWindow(kit, F.face(name).f, 0, W, false);
    }
  }
}

export function garageDoors({ paint, metal }, L) {
  for (const h of L.HOUSES) {
    const villa = h.kit === 'villa';
    const doors = villa ? (h.garages ?? (h.garage !== undefined ? [h.garage] : [])) : h.kit === 'garage' ? h.doors : [];
    const [w, ht, tint] = villa ? [520, 250, 0x5a6a72] : [440, 240, 0x3a3e42];
    const f = frameOf(h).face('front').f;
    for (const u of doors) {
      const [u0, u1] = [u - w / 2, u + w / 2];
      paint.color(WHITE);
      surround(paint, f, [[u0, 0], [u1, 0], [u1, ht], [u0, ht]], 14, 0, 3);
      // Four sections, each a shallow panel bevelled top and bottom.
      for (let k = 0; k < 4; k++) {
        const [v0, v1] = [(ht * k) / 4, (ht * (k + 1)) / 4];
        paint.color(tint, 1.1);
        paint.quad(f.at(u0, v0 + 3, 1), f.at(u1, v0 + 3, 1), f.at(u1, v1 - 3, 1), f.at(u0, v1 - 3, 1));
        paint.color(tint, 0.6);
        paint.quad(f.at(u0, v0, 0.5), f.at(u1, v0, 0.5), f.at(u1, v0 + 3, 1), f.at(u0, v0 + 3, 1));
        paint.color(tint, 1.3);
        paint.quad(f.at(u0, v1 - 3, 1), f.at(u1, v1 - 3, 1), f.at(u1, v1, 0.5), f.at(u0, v1, 0.5));
      }
      metal.color(0xb0aca4);
      metal.quad(f.at(u - 30, 40, 3), f.at(u + 30, 40, 3), f.at(u + 30, 48, 3), f.at(u - 30, 48, 3));
    }
  }
}

export function hipTrim({ metal, tiles }, L) {
  for (const h of L.HOUSES) {
    if (h.kit !== 'villa') continue;
    const F = frameOf(h);
    const tan = Math.tan((h.pitch * Math.PI) / 180);
    const o = h.overhang ?? 60;
    const [a, b] = [h.w / 2, h.d / 2];
    const lo = h.eave - o * tan;
    const ridge = h.eave + Math.min(a, b) * tan;
    const along = a >= b;
    const r = Math.abs(a - b);
    const [R0, R1] = along ? [F.at(-r, ridge, 0), F.at(r, ridge, 0)] : [F.at(0, ridge, -r), F.at(0, ridge, r)];
    const rim = [F.at(-a - o, lo, b + o), F.at(a + o, lo, b + o), F.at(a + o, lo, -b - o), F.at(-a - o, lo, -b - o)];
    // The gutters round the eaves (each side out from the roof's middle), a downpipe at each
    // front corner down the wall.
    metal.color(0x2a2c2e);
    const mid = F.at(0, lo, 0);
    for (let i = 0; i < 4; i++) {
      const [p, q] = [rim[i], rim[(i + 1) % 4]];
      const e = norm(sub(q, p));
      const c = mul(add(p, q), 0.5);
      const out = norm([c[0] - mid[0], 0, c[2] - mid[2]]);
      const at = (s) => add(add(s, mul(out, 10)), [0, -16, 0]);
      metal.tube(at(sub(p, mul(e, 6))), at(add(q, mul(e, 6))), 9, 9, 6, { a0: 0, arc: Math.PI });
      metal.tube(at(sub(p, mul(e, 6))), at(add(q, mul(e, 6))), 8.2, 8.2, 6, { a0: 0, arc: Math.PI, inside: true });
    }
    for (const s of [-1, 1]) {
      const wall = F.at(s * (a - 20), 0, b + 7);
      const top = add(F.at(s * (a - 20), lo - 22, b + o + 10), [0, 0, 0]);
      metal.tube(top, [wall[0], lo - 80, wall[2]], 5, 5, 6);
      metal.tube([wall[0], lo - 80, wall[2]], [wall[0], (h.y0 ?? 22) + 12, wall[2]], 5, 5, 6, { caps: true });
    }
    // The caps: rounded tiles along the hips (from the eaves' corners to the ridge's ends) and the
    // ridge.
    tiles.color(h.roof, 0.9);
    const ends = along ? [R0, R1, R1, R0] : [R1, R1, R0, R0];
    for (let i = 0; i < 4; i++) tiles.tube(add(rim[i], [0, 3, 0]), add(ends[i], [0, 3, 0]), 11, 11, 6, { a0: Math.PI, arc: Math.PI, caps: true });
    if (r > 1) tiles.tube(add(R0, [0, 3, 0]), add(R1, [0, 3, 0]), 13, 13, 8, { a0: Math.PI, arc: Math.PI, caps: true });
  }
}
