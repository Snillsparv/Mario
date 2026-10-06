// The store room's things in the realistic look (world/lane/real/detail.js builds them in the
// worker, before the cars: the dad's car stays last in every mesh it shares), behind the garage
// doors (layout.GARAGE: its walls, its leaves and the things' colliders are the classic
// builders'; the lane's chunk breaks the doors). Each thing inside its box of GARAGE.props (world/
// lane/garage.js ROOM names them), drawn into the detail's existing materials (no draw call of
// its own): a workbench (its top in boards) with a vice and a tool board over it (a hammer, a saw,
// spanners, pliers, a coiled cable), grey steel shelving (cardboard boxes, paint tins, a red jerry
// can and toolbox, flower pots), four winter tyres on their rims, two moving boxes, a green lawn
// mower, a blue bike leaning on the wall, a rake, a spade and a broom in the corner, and the
// fluorescent tube under the slab (its diffuser in `drl`: it glows and blooms; `gloss` on low).
// No brand, label, letter or number on anything.
//
//   garageRoom(kit, L)   kit: detail.js's Geo per material (paint, boards, steel, metal, tyre,
//                        drl), kit.tier; L: layout.js
//
// The room's light is painted into the vertex tints (roomLight: dim, a pool under the tube, the
// daylight from the doorways), as the classic look's are (objects/laneBoss/garageRoom.js): the
// sky's light is not occluded indoors, and a light object would change every lit material's
// program. Per tier: high 12-sided round things (the tyres 24), 8 spokes a wheel; mid 8 and 4; low
// 6, no spokes, no tools on the board, fewer tins.

import { ROOM, roomLight } from '../garage.js';

export function garageRoom(kit, L) {
  const { paint, boards, steel, metal, tyre, drl } = kit;
  const G = L.GARAGE;
  const y0 = L.GROUND;
  const tier = kit.tier ?? 'high';
  const low = tier === 'low';
  const sides = low ? 6 : tier === 'mid' ? 8 : 12;
  const spokes = low ? 0 : tier === 'mid' ? 4 : 8;
  // Each material's vertices before the room (its light is painted onto what it adds).
  const geos = [...new Set([paint, boards, steel, metal, tyre, drl])];
  const from = geos.map((g) => g.count);
  const box = (g, tint, x0, x1, a, b, z0, z1, skip = 'b') => g.color(tint).box(x0, x1, y0 + a, y0 + b, z0, z1, { skip });
  const tube = (g, tint, p, q, r, n = 5) => g.color(tint).tube([p[0], y0 + p[1], p[2]], [q[0], y0 + q[1], q[2]], r, r, n);
  // A wheel upright in the plane x: its tyre a ring of short tubes, its rim, its spokes, its hub.
  const wheel = (x, y, z, r) => {
    const n = sides;
    const at = (i, k) => [x, y + Math.cos((i / n) * Math.PI * 2) * k, z + Math.sin((i / n) * Math.PI * 2) * k];
    for (let i = 0; i < n; i++) {
      tube(tyre, 0x1a1a1a, at(i, r), at(i + 1, r), 3.5, 5);
      tube(metal, 0xb0b4b8, at(i, r - 5), at(i + 1, r - 5), 1.2, 3);
    }
    for (let i = 0; i < spokes; i++) tube(metal, 0xc8ccd0, [x, y, z], at((i * n) / spokes, r - 5), 0.4, 3);
    tube(metal, 0x8a8c90, [x - 4, y, z], [x + 4, y, z], 3, 5);
  };
  G.props.forEach(([x0, x1, z0, z1], i) => {
    const kind = ROOM.props[i];
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (kind === 'bench') {
      box(boards, 0xa0805a, x0, x1, 135, 150, z0, z1, '');
      for (const x of [x0 + 4, x1 - 12]) for (const z of [z0 + 4, z1 - 12]) box(paint, 0x4a4038, x, x + 8, 0, 135, z, z + 8);
      box(boards, 0x8a6e4e, x0 + 8, x1 - 8, 40, 45, z0 + 8, z1 - 8, '');
      // The vice at its east end, its screw's bar.
      box(steel, 0x3e5a7a, x1 - 34, x1 - 8, 150, 168, z0 + 6, z0 + 30);
      box(steel, 0x3e5a7a, x1 - 30, x1 - 12, 168, 178, z0 + 2, z0 + 12);
      tube(metal, 0xa8acb0, [x1 - 21, 160, z0 - 6], [x1 - 21, 160, z0 + 4], 1.5);
      // The tool board on the wall (pegboard) and its tools.
      box(boards, 0x9a8a6a, x0 + 10, x1 - 10, 160, 290, z1 - 4, z1, '');
      if (!low) {
        const w = z1 - 5;
        tube(paint, 0x8a5a30, [x0 + 33, 190, w], [x0 + 33, 245, w], 2.2);
        box(steel, 0x55585c, x0 + 22, x0 + 46, 245, 256, w - 6, w);
        box(steel, 0xb8bcc0, x0 + 62, x0 + 108, 205, 240, w - 1, w);
        box(paint, 0xa03020, x0 + 108, x0 + 128, 214, 228, w - 4, w);
        for (const [x, l] of [[x0 + 142, 60], [x0 + 154, 48], [x0 + 166, 40]]) tube(steel, 0x9aa0a6, [x, 260 - l, w - 2], [x, 260, w - 2], 2.2, 5);
        tube(paint, 0xa03020, [x0 + 184, 205, w - 2], [x0 + 186, 235, w - 2], 2.5, 5);
        tube(paint, 0xa03020, [x0 + 192, 205, w - 2], [x0 + 190, 235, w - 2], 2.5, 5);
        // A coiled cable on a hook.
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const b = ((k + 1) / 10) * Math.PI * 2;
          tube(tyre, 0x2a6a2a, [x1 - 30 + 16 * Math.sin(a), 230 - 16 * Math.cos(a), w - 3], [x1 - 30 + 16 * Math.sin(b), 230 - 16 * Math.cos(b), w - 3], 1.6, 4);
        }
      }
    } else if (kind === 'shelves') {
      for (const x of [x0, x1 - 5]) for (const z of [z0 + 1, z1 - 6]) box(steel, 0x7a7e84, x, x + 5, 0, 232, z, z + 5, '');
      for (const y of [10, 85, 160, 225]) box(steel, 0x8a8e94, x0, x1, y, y + 4, z0, z1, '');
      box(paint, 0xb08850, x0 + 10, x0 + 72, 14, 62, z0 + 6, z1 - 6);
      box(paint, 0xd8c8a0, x0 + 38, x0 + 44, 62, 62.5, z0 + 6, z1 - 6);
      // The red jerry can (its handle) and a box beside it.
      box(paint, 0xb02a20, x0 + 88, x0 + 124, 14, 72, z0 + 12, z1 - 12);
      tube(paint, 0xb02a20, [x0 + 96, 80, cz], [x0 + 116, 80, cz], 3, 5);
      box(paint, 0xa8844e, x0 + 140, x1 - 10, 14, 58, z0 + 6, z1 - 6);
      // Paint tins (white, coloured lids), the red toolbox.
      const tins = low ? 3 : 6;
      for (let k = 0; k < tins; k++) {
        const x = x0 + 18 + k * 20;
        paint.color(0xe8e6e0).cyl('y', y0 + 89, y0 + 113, x, cz + (k % 2) * 12 - 6, 8.5, 6);
        paint.color([0x2a5aa8, 0xc8a020, 0x2f7a3a, 0xb03a2a][k % 4]).cyl('y', y0 + 113, y0 + 115, x, cz + (k % 2) * 12 - 6, 8.8, 6, { caps: true });
      }
      box(paint, 0xc0302a, x0 + 140, x0 + 200, 89, 118, z0 + 14, z1 - 12, '');
      tube(steel, 0x2a2a2a, [x0 + 150, 124, cz], [x0 + 190, 124, cz], 2);
      // Cardboard boxes and flower pots on the upper shelves.
      box(paint, 0xb8955e, x0 + 12, x0 + 95, 164, 214, z0 + 6, z1 - 6);
      box(paint, 0xa08050, x0 + 30, x0 + 110, 229, 268, z0 + 8, z1 - 8);
      for (let k = 0; k < 3; k++) paint.color(0xb0603a).tube([x0 + 135 + k * 30, y0 + 164, cz], [x0 + 135 + k * 30, y0 + 186 + k * 4, cz], 8, 11, 6);
    } else if (kind === 'tyres') {
      // Four winter tyres stacked flat on their rims.
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * 25;
        tyre.color(0x1c1c1e).cyl('y', y + 1, y + 23, cx, cz, 38, sides * 2);
        tyre.color(0x18181a).tube([cx, y + 23, cz], [cx, y + 24, cz], 38, 20, sides * 2);
        metal.color(0x9a9ea2).cyl('y', y + 22, y + 24.5, cx, cz, 20, sides, { caps: true });
      }
    } else if (kind === 'boxes') {
      box(paint, 0xb8955e, x0, x1, 0, 60, z0, z0 + 75);
      box(paint, 0xc4a26a, x0 + 6, x1 - 6, 60, 110, z0 + 6, z0 + 66);
      box(paint, 0xd8c8a0, cx - 6, cx + 6, 110, 110.5, z0 + 6, z0 + 66);
      box(paint, 0xd8c8a0, cx - 6, cx + 6, 60, 60.5, z0, z0 + 75);
      box(paint, 0xa88a54, x0 + 4, x1, 0, 70, z0 + 80, z1);
    } else if (kind === 'mower') {
      // Its deck, its engine cover, its wheels, the grass bag and the handle.
      box(paint, 0x2f7a3a, x0 + 10, x1 - 10, 12, 42, z0 + 20, z0 + 110, '');
      paint.color(0x2f7a3a).tube([cx, y0 + 42, z0 + 62], [cx, y0 + 60, z0 + 62], 32, 24, sides, { caps: true });
      paint.color(0x1e1e1e).cyl('y', y0 + 60, y0 + 64, cx, z0 + 62, 10, 6, { caps: true });
      for (const x of [x0 + 2, x1 - 10]) for (const z of [z0 + 30, z0 + 98]) tyre.color(0x1e1e1e).cyl('x', x, x + 8, y0 + 12, z, 12, sides, { caps: true });
      box(tyre, 0x262626, x0 + 25, x1 - 25, 18, 75, z0 + 110, z1 - 10, '');
      for (const x of [x0 + 22, x1 - 22]) tube(steel, 0x55585c, [x, 45, z0 + 108], [x, 140, z1 - 2], 2.2);
      tube(steel, 0x55585c, [x0 + 22, 140, z1 - 2], [x1 - 22, 140, z1 - 2], 2.2);
    } else if (kind === 'bike') {
      // Leaning on the wall: its two wheels, its blue frame, the saddle and the bars.
      const x = cx + 4;
      const [zr, zf] = [z0 + 55, z1 - 55];
      wheel(x, y0 + 48, zr, 44);
      wheel(x - 6, y0 + 48, zf, 44);
      const frame = (p, q) => tube(paint, 0x2a5aa8, p, q, 2.4);
      frame([x, 48, zr], [x - 2, 100, cz]);
      frame([x - 2, 100, cz], [x - 5, 106, zf - 30]);
      frame([x - 5, 106, zf - 30], [x - 6, 48, zf]);
      frame([x, 48, zr], [x - 2, 100, zr + 50]);
      frame([x - 2, 100, zr + 50], [x - 5, 106, zf - 30]);
      frame([x - 2, 100, cz], [x - 2, 112, cz - 20]);
      tyre.color(0x1a1a1a).box(x - 7, x + 3, y0 + 112, y0 + 118, cz - 40, cz - 8);
      tube(steel, 0x8a8c90, [x - 5, 106, zf - 30], [x - 5, 130, zf - 34], 1.8);
      tube(steel, 0x8a8c90, [x - 18, 130, zf - 34], [x + 8, 130, zf - 34], 1.8);
    } else {
      // A rake, a spade and a broom leaning in the corner.
      tube(paint, 0x9a7040, [x0 + 8, 30, z0 + 8], [x0 + 12, 178, z0 + 4], 1.8);
      box(steel, 0x6a6e72, x0 + 2, x0 + 22, 0, 6, z0 + 2, z0 + 14, '');
      for (let k = 0; k < 6; k++) box(steel, 0x6a6e72, x0 + 3 + k * 3.5, x0 + 4.5 + k * 3.5, 6, 30, z0 + 7, z0 + 9, '');
      tube(paint, 0x9a7040, [x0 + 10, 26, z1 - 8], [x0 + 14, 168, z1 - 12], 1.8);
      box(steel, 0x8a8c90, x0 + 4, x0 + 18, 0, 28, z1 - 12, z1 - 10, '');
      tube(paint, 0x9a7040, [x1 - 10, 32, cz], [x1 - 4, 172, cz + 4], 1.8);
      box(paint, 0xb03a2a, x1 - 18, x1 - 2, 6, 32, cz - 12, cz + 12, '');
      box(tyre, 0x3a3226, x1 - 17, x1 - 3, 0, 6, cz - 11, cz + 11, '');
    }
  });
  // The fluorescent tube under the slab: its housing and its glowing diffuser.
  const T = ROOM.tube;
  paint.color(0xf0f0ea).box(T.x0, T.x1, T.y + 3, G.under, T.z - 7, T.z + 7, { skip: 't' });
  drl.color(0xffffff).box(T.x0 + 5, T.x1 - 5, T.y, T.y + 3, T.z - 4.5, T.z + 4.5, { skip: 't' });
  // The room's light painted onto what it added (not the diffuser: it glows).
  geos.forEach((g, k) => {
    const end = g === drl ? g.count - 30 : g.count;
    for (let v = from[k]; v < end; v++) {
      const s = roomLight(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
      for (let c = 0; c < 3; c++) g.col[v * 3 + c] *= s;
    }
  });
}
