// Reusable castle features: round towers with conical roofs, battlements, arched and round
// windows, flagpoles. Each feature writes render faces into the kit's material builders
// (wall / trim / roof / wood / glass) and, where it matters, collider solids.
//
// kit = { wall, trim, roof, wood, glass: GeoBuilder, solids: SolidBuilder, flags: [] }

import {
  archContour,
  circleContour,
  conePolys,
  faceCentred,
  localBoxPolys,
  orientedBoxPolys,
  prismPolys,
  towerFrame,
} from './geom.js';

// Vertex tints (sRGB), multiplied with each material's texture.
export const TINT = {
  wall: 0xffffff,
  stone: 0xffffff,
  roofFlat: 0xc9c2b4, // flat walkway roofs (stone texture)
  pane: 0x34344e, // dark window recesses
  pole: 0x5a544e,
  gold: 0xffd75a,
  door: 0xd49a66,
  iron: 0x3a3634,
};

// Round tower: stone plinth, cream wall darkening under the eaves, corbelled stone band and a
// flared conical roof with a pennant. Returns the roof tip height.
//   t = { x, z, r, base, top, roofH, sides?, plinth?, pennant?, bands?: [y],
//         windows?: [{ angle, sill, w, h, border? }] }
export function roundTower(kit, t) {
  const { x, z, r, base, top, roofH, sides = 16, plinth = true, pennant = true, bands = [] } = t;
  const { wall, trim, roof, solids } = kit;
  const band = 34; // corbel band overhang
  const R = r + Math.max(70, r * 0.26); // roof eave radius
  const eave = top - 26;
  const tipY = top + roofH;
  const a0 = faceCentred(sides); // windows sit on faces centred at yaw 0, 45, 90...
  kit.towers?.push({ x, z, r, sides, base, top, plinth, bands, windows: t.windows ?? [] });

  trim.color(TINT.stone);
  if (plinth) trim.lathe(x, z, [[r + 30, base, 0.7], [r + 30, base + 120], [r, base + 150]], sides, { a0 });
  trim.lathe(x, z, [[r, top - 130, 0.8], [r + band, top - 95, 0.8], [r + band, top - 95], [r + band, top, 0.85]], sides, { a0 });
  for (const y of bands) trim.lathe(x, z, [[r, y - 30, 0.8], [r + 14, y - 18], [r + 14, y + 18], [r, y + 26]], sides, { a0 });

  wall.color(TINT.wall);
  wall.lathe(x, z, [[r, plinth ? base + 140 : base], [r, top - 280], [r, top - 130, 0.68]], sides, { a0 });

  // Soffit (dark underside), fascia, then a flared cone: shallow at the eave, steep above.
  roof.color(TINT.wall);
  roof.lathe(
    x,
    z,
    [
      [r + band, top, 0.42],
      [R, eave, 0.5],
      [R, eave, 0.9],
      [R, eave + 24, 0.9],
      [R, eave + 24],
      [R * 0.74, eave + 24 + roofH * 0.15],
      [0, tipY],
    ],
    sides,
    { vMode: 'len', a0 },
  );

  for (const win of t.windows ?? []) {
    archWindow(kit, towerFrame(x, z, r, sides, win.angle, win.sill), win.w, win.h, { w0: -10, border: win.border });
  }
  if (pennant) flagpole(kit, x, z, tipY - 30, tipY + 260, { kind: 'pennant', len: 190, height: 80 });

  solids.solid(prismPolys(x, z, r, 12, base, top), 'stone');
  if (plinth) solids.solid(prismPolys(x, z, r + 30, 12, base, base + 150), 'stone');
  solids.solid(conePolys(x, z, R, 12, eave, tipY), 'stone');
  return tipY;
}

// Stone string course: a thin moulded band wrapped around a rectangular block at height y.
export function stringCourse(kit, x0, x1, z0, z1, y) {
  kit.trim.color(TINT.stone);
  kit.trim.box(x0 - 14, x1 + 14, y - 18, y + 18, z0 - 14, z1 + 14, { faceShade: (n) => (n[1] < -0.5 ? 0.6 : 1) });
}

// Merlons along the wall-top edge a -> b ([x, z]) at height y, flush with the wall face;
// `out` is the outward wall normal [x, z]. Evenly spaced with a merlon at each end.
export function merlonRow(kit, a, b, y, out, { h = 120, w = 110, gap = 95, t = 64 } = {}) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round((len + gap) / (w + gap)));
  const step = n > 1 ? (len - w) / (n - 1) : 0;
  kit.wall.color(TINT.wall);
  kit.trim.color(TINT.stone);
  for (let i = 0; i < n; i++) {
    const s = n > 1 ? w / 2 + i * step : len / 2;
    const c = [a[0] + (dx / len) * s - out[0] * (t / 2 - 8), 0, a[1] + (dz / len) * s - out[1] * (t / 2 - 8)];
    kit.wall.solid(orientedBoxPolys(c, [dx, 0, dz], w, y, y + h - 14, t, { bottom: false, top: false }));
    // Thin stone coping on each merlon.
    kit.trim.solid(orientedBoxPolys(c, [dx, 0, dz], w + 10, y + h - 14, y + h, t + 10), { shade: 0.95 });
    // Solid: the hero can't walk through the battlements (the crenels between them are narrower
    // than he is), and the camera sees them.
    kit.solids?.solid(orientedBoxPolys(c, [dx, 0, dz], w + 10, y, y + h, t + 10, { bottom: false }), 'stone');
  }
}

// Tall arched window: a dark recess with a protruding stone surround and a sill. `frame` is a
// wall frame whose origin is the window's bottom centre on the wall surface.
export function archWindow(kit, frame, width, height, { border = 24, depth = 20, w0 = -4 } = {}) {
  const hw = width / 2;
  const spring = height - hw;
  const inner = archContour(hw, spring, 6);
  const outer = archContour(hw + border, spring, 6);
  kit.trim.color(TINT.stone);
  kit.trim.moulding(frame, inner, outer, depth, { w0, revealShade: 0.45 });
  kit.trim.solid(localBoxPolys(frame, -hw - border - 10, hw + border + 10, -24, 0, w0, depth + 10), { shade: 0.95 });
  // Recess: dark pane, a touch lighter at the top like a faint reflection of the sky. It
  // glows in AI RACE mode, brightest low down (a light somewhere inside).
  kit.trim.color(TINT.pane);
  const shade = inner.map(([, v]) => 0.8 + 0.5 * (v / height));
  const sill = frame.at(0, 0, 0)[1];
  kit.trim.glow = (x, y) => 1 - 0.4 * Math.min(1, Math.max(0, (y - sill) / height));
  kit.trim.panel(frame, inner, 2, { shade });
  kit.trim.glow = 0;
}

// Round window (oculus) with a stone ring; the pane is dark unless `glass` is true, in which
// case it is a stained-glass disc from the glass texture.
export function roundWindow(kit, frame, cy, r, { border = 40, depth = 34, glass = false, segs = 20 } = {}) {
  const inner = circleContour(0, cy, r, segs);
  const outer = circleContour(0, cy, r + border, segs);
  kit.trim.color(TINT.stone);
  kit.trim.moulding(frame, inner, outer, depth, { closed: true, w0: -4, revealShade: 0.5 });
  if (glass) {
    kit.glass.color(0xffffff);
    const uvs = inner.map(([u, v]) => [0.5 + u / (2 * r), 0.5 + (v - cy) / (2 * r)]);
    kit.glass.panel(frame, inner, 3, { uvs });
  } else {
    kit.trim.color(TINT.pane);
    kit.trim.glow = 1;
    kit.trim.panel(frame, inner, 3);
    kit.trim.glow = 0;
  }
}

// Thin flagpole with a golden ball finial; registers a waving flag at its top.
export function flagpole(kit, x, z, y0, y1, flag) {
  kit.trim.color(TINT.pole);
  kit.trim.lathe(x, z, [[9, y0], [7, y1 - 24]], 6, { flat: true });
  kit.trim.color(TINT.gold, 1.2);
  kit.trim.lathe(x, z, [[0, y1 - 26], [14, y1 - 12], [0, y1 + 4]], 6, { flat: true });
  kit.flags.push({ ...flag, x, z, top: y1 - 32 });
}
