// The castle's geometry toolkit (world/castle/geom.js) as the Great Hall uses it: a lathe over
// part of a turn (and, without the option, exactly the full lathe every other builder draws),
// smooth along its profile, its tops textured from above; sweeps (smooth, facing out, closed
// at their ends); a path along a wall-frame contour; convex clipping; the soft-edged box
// (closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GeoBuilder, archContour, clipConvex, contourPath, polyArea, softBox, subtractConvex, sweep, wallFrame } from '../src/world/castle/geom.js';

const PROFILE = [[0, 0, 0.8], [120, 0], [120, 40, 0.9], [96, 120], [96, 300], [60, 340], [0, 360]];

// A builder's vertices: [{ p, n, uv, c }].
function vertices(b) {
  const out = [];
  for (let i = 0; i < b.pos.length / 3; i++) {
    out.push({ p: b.pos.slice(i * 3, i * 3 + 3), n: b.nrm.slice(i * 3, i * 3 + 3), uv: b.uv.slice(i * 2, i * 2 + 2), c: b.col.slice(i * 3, i * 3 + 3) });
  }
  return out;
}
const unit = (n) => Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-6;
const triNormal = (a, b, c) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};

test('lathe: a full turn by default, exactly as before the option (positions, normals, uvs, colours and glows)', () => {
  // Digests of the output for three profiles (one starting on the axis, one with a repeated
  // point) at 5 and 12 sides, shaded and glowing, worked out once with geom.js as it was before
  // the arc and smoothProfile options (f5e5e51): the default must not have moved a bit, nor the
  // same values passed explicitly.
  const before = { '{}': '5604a920e8f0681d', '{"flat":true}': '81fb4271b959cdcc', '{"a0":0.39269908169872414,"uRepeats":3}': '946c75087bb62288', '{"vMode":"len"}': 'eaf3b53776f2847f' };
  const digest = (opts) => {
    const h = createHash('sha256');
    for (const profile of [PROFILE, [[50, 0], [50, 10], [50, 10], [30, 50], [0, 60]], [[0, 10], [30, 0]]]) {
      for (const sides of [5, 12]) {
        const b = new GeoBuilder(256).color(0xc08040);
        b.shade = (x, y) => 0.6 + y / 900;
        b.glow = 0.25;
        b.lathe(100, -50, profile, sides, opts);
        for (const key of ['pos', 'nrm', 'uv', 'col', 'glows']) h.update(new Uint8Array(Float64Array.from(b[key]).buffer));
      }
    }
    return h.digest('hex').slice(0, 16);
  };
  for (const opts of [{}, { flat: true }, { a0: Math.PI / 8, uRepeats: 3 }, { vMode: 'len' }]) {
    const key = JSON.stringify(opts);
    assert.equal(digest(opts), before[key], `${key}: as before`);
    assert.equal(digest({ ...opts, arc: Math.PI * 2, smoothProfile: false }), before[key], `${key}: the defaults passed`);
  }
});

test("lathe vMode 'plan': its faces turned up projected from above, as a floor is (no streaks fanning in to the middle), the rest along the profile", () => {
  const profile = [[200, 0], [200, 40], [0, 40]]; // a drum: its side, then its top
  const plan = new GeoBuilder(100);
  plan.lathe(30, -20, profile, 8, { vMode: 'plan' });
  const len = new GeoBuilder(100);
  len.lathe(30, -20, profile, 8, { vMode: 'len' });
  const along = vertices(len);
  let top = 0;
  vertices(plan).forEach(({ p, n, uv }, i) => {
    if (n[1] > 0.9) {
      top++;
      assert.ok(Math.abs(uv[0] - p[0] / 100) < 1e-9 && Math.abs(uv[1] + p[2] / 100) < 1e-9, `top at ${p}: ${uv}`);
    } else assert.deepEqual(uv, along[i].uv, `side at ${p}`);
  });
  assert.ok(top >= 8 * 3, `${top} top vertices`);
});

test('lathe with an arc covers only its span', () => {
  const b = new GeoBuilder(256);
  const [a0, arc] = [Math.PI / 4, (Math.PI * 2) / 3];
  b.lathe(0, 0, PROFILE, 8, { a0, arc });
  const full = new GeoBuilder(256);
  full.lathe(0, 0, PROFILE, 8);
  assert.equal(b.pos.length, full.pos.length, 'as many faces, over the span');
  for (const { p } of vertices(b)) {
    if (Math.hypot(p[0], p[2]) < 1e-6) continue; // (the axis)
    const a = Math.atan2(p[0], p[2]);
    const off = ((a - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    assert.ok(off <= arc + 1e-9, `at ${((a * 180) / Math.PI).toFixed(1)} degrees`);
  }
});

test('lathe smoothProfile: unit normals, shared along the profile (but at a repeated point)', () => {
  const b = new GeoBuilder(256);
  const profile = [[100, 0], [100, 100], [80, 160], [80, 160], [40, 200], [0, 210]];
  b.lathe(0, 0, profile, 12, { smoothProfile: true });
  const verts = vertices(b);
  for (const { n } of verts) assert.ok(unit(n), `normal ${n}`);
  // At y 100 (between the wall and the slope) every vertex has the one smoothed normal for its
  // angle; at y 160 (the repeated point) the two faces meeting there keep their own.
  const at = (y) => verts.filter(({ p }) => Math.abs(p[1] - y) < 1e-6 && Math.abs(p[0]) < 1e-6 && p[2] > 0);
  const mid = at(100);
  assert.ok(mid.length >= 2 && mid.every(({ n }) => Math.abs(n[1] - mid[0].n[1]) < 1e-9), 'smooth at y 100');
  const crease = new Set(at(160).map(({ n }) => n[1].toFixed(6)));
  assert.equal(crease.size, 2, 'hard at the repeated point');
});

test('sweep: unit normals facing out from the path, every face wound to them; caps close an open sweep', () => {
  // A trim along a straight wall (n into the room, b up) and round a quarter circle.
  const path = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    path.push({ p: [Math.cos(a) * 1000, 0, Math.sin(a) * 1000], n: [-Math.cos(a), 0, -Math.sin(a)], b: [0, 1, 0] });
  }
  const profile = [[30, 0], [30, 100], [34, 118], [30, 136], [16, 152], [0, 160]];
  const b = new GeoBuilder(512);
  sweep(b, path, profile);
  const verts = vertices(b);
  for (const { n } of verts) assert.ok(unit(n), `normal ${n}`);
  for (let i = 0; i < verts.length; i += 3) {
    const fn = triNormal(verts[i].p, verts[i + 1].p, verts[i + 2].p);
    for (let k = 0; k < 3; k++) {
      const n = verts[i + k].n;
      assert.ok(fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] > 0, 'wound to its normals');
      // Into the room (toward the circle's centre) or up: never back into the wall.
      const p = verts[i + k].p;
      const inward = -(p[0] * n[0] + p[2] * n[2]) / Math.hypot(p[0], p[2]);
      assert.ok(inward > -1e-6 || n[1] > 0, `faces out: ${n}`);
    }
  }
  // Capped: every edge of the trim's surface is shared by two triangles (its open ends closed,
  // the wall side left open as it is against the wall).
  const capped = new GeoBuilder(512);
  sweep(capped, path, profile, { caps: true });
  const capFaces = (capped.pos.length - b.pos.length) / 9;
  assert.ok(capFaces >= 2 * (profile.length - 1), `${capFaces} cap triangles`);
  const open = openEdges(capped).filter(([a, c]) => !(Math.abs(a[1] - 0) < 1e-6 && Math.abs(c[1] - 0) < 1e-6) && !onWall(a, path) && !onWall(c, path));
  assert.deepEqual(open, [], 'closed at its ends');
});

// Whether a point lies on the wall the sweep stands against (w 0: on the path's circle).
const onWall = (p, path) => Math.abs(Math.hypot(p[0], p[2]) - Math.hypot(path[0].p[0], path[0].p[2])) < 1e-6;

// The edges of a builder's triangles used by only one of them (positions rounded).
function openEdges(b) {
  const key = (p) => p.map((v) => v.toFixed(4)).join(',');
  const count = new Map();
  const verts = vertices(b);
  for (let i = 0; i < verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const [a, c] = [verts[i + k].p, verts[i + ((k + 1) % 3)].p];
      const e = [key(a), key(c)].sort().join('|');
      const entry = count.get(e) ?? { n: 0, a, c };
      entry.n++;
      count.set(e, entry);
    }
  }
  return [...count.values()].filter(({ n }) => n === 1).map(({ a, c }) => [a, c]);
}

test('contourPath follows the frame: its points on the contour, n the wall\'s out, b away from the opening', () => {
  const frame = wallFrame([500, 0, 200], [1, 0, 0]);
  const arch = archContour(100, 200, 8);
  const path = contourPath(frame, arch);
  assert.equal(path.length, arch.length);
  path.forEach(({ p, n, b }, i) => {
    const q = frame.at(arch[i][0], arch[i][1], 0);
    assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9, `point ${i}`);
    assert.deepEqual(n, frame.out);
    assert.ok(Math.abs(b[0] * n[0] + b[1] * n[1] + b[2] * n[2]) < 1e-9 && unit(b), 'b in the wall');
    // Away from the opening: from the arch's middle (u 0, v 200) out through the point.
    const [u, v] = arch[i];
    const out = frame.dir(u, v - 200, 0);
    if (Math.hypot(u, v - 200) > 50) assert.ok(out[0] * b[0] + out[1] * b[1] + out[2] * b[2] > 0, `point ${i}: b points out`);
  });
});

test('clipConvex keeps what lies inside the clip polygon (areas as polyArea measures them), subtractConvex the rest', () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(polyArea(square), 10000);
  assert.equal(polyArea([...square].reverse()), -10000);
  // Half of it under a diagonal, a corner of it under a shifted square (either winding).
  assert.ok(Math.abs(Math.abs(polyArea(clipConvex(square, [[0, 0], [100, 0], [0, 100]]))) - 5000) < 1e-6);
  const shifted = [[50, 50], [150, 50], [150, 150], [50, 150]];
  assert.ok(Math.abs(Math.abs(polyArea(clipConvex(square, shifted))) - 2500) < 1e-6);
  assert.ok(Math.abs(Math.abs(polyArea(clipConvex(square, [...shifted].reverse()))) - 2500) < 1e-6);
  assert.ok(clipConvex(square, [[200, 200], [300, 200], [300, 300]]).length < 3, 'nothing inside');
  // A regular octagon clipped to a big square stays whole.
  const oct = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * 40 + 50, Math.sin((i * Math.PI) / 4) * 40 + 50]);
  assert.ok(Math.abs(polyArea(clipConvex(oct, square)) - polyArea(oct)) < 1e-6);
  // The square minus a hole in its middle: the pieces add up to the rest.
  const hole = [[40, 40], [60, 40], [60, 60], [40, 60]];
  const rest = subtractConvex(square, hole).reduce((a, p) => a + Math.abs(polyArea(p)), 0);
  assert.ok(Math.abs(rest - (10000 - 400)) < 1e-6, `${rest}`);
});

test('softBox is closed: every edge shared by two triangles, its normals unit and facing out', () => {
  const b = new GeoBuilder(256);
  softBox(b, -100, 300, 0, 380, -90, 90, 40, 10);
  softBox(b, 500, 700, 380, 420, -110, 110, 30, 20, 3);
  assert.deepEqual(openEdges(b), []);
  const verts = vertices(b);
  for (const { n } of verts) assert.ok(unit(n), `normal ${n}`);
  for (let i = 0; i < verts.length; i += 3) {
    const fn = triNormal(verts[i].p, verts[i + 1].p, verts[i + 2].p);
    const n = verts[i].n;
    assert.ok(fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] > 0, 'wound to its normals');
  }
});
