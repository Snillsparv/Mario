// Sculpted parts of Grisen, in the same vertex-colour material as the other characters.
import * as THREE from 'three';
import { smoothstep, TAU } from '../../core/math.js';

const color = hex => new THREE.Color(hex);
const skin = color(0xf4a0a0), peach = color(0xffccaf), blush = color(0xe77f8c);
const warm = color(0xffd0b6), shade = color(0xd58088);
const mix = new THREE.Color();

function geometry(vertices, colors, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Successive rings are counter-clockwise viewed from the front (+Z).
function joinRings(indices, a, b) {
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    if (a[i] !== a[j]) indices.push(a[i], a[j], b[i]);
    if (b[i] !== b[j]) indices.push(a[j], b[j], b[i]);
  }
}

// Each profile runs from back to front. Entries are [z, centre height, half-width, half-height].
const TORSO = [
  [-67,3,0,0], [-65,3,11,12], [-61,2,21,22], [-54,1,29,28], [-44,0,33.2,30.4],
  [-32,-0.5,34,30.7], [-20,-0.7,33.5,29.8], [-8,-0.2,32.6,28.6], [4,0.6,31.4,27.3],
  [15,2.4,29.8,26.2], [24,4.4,26.2,24], [31,6.5,20.5,19.5], [36,9,13,12], [39,10,0,0],
];
const HEAD = [
  [-26,4,0,0], [-24,4,12,11], [-21,4.5,20.5,18.5], [-15,4.9,28,24.6],
  [-8,5.2,32.6,28.6], [0,5.1,34.6,30.2], [8,4.5,35,30], [15,3.7,34.3,28.8],
  [22,2.6,31.7,26.5], [27,1.2,28.4,23.3], [31,-0.5,24,20.2], [34,-1.5,20,17],
  [37,-2.2,16.9,13.9], [40,-1.8,14.9,11.6], [42,-1.2,13,9.5], [43.6,-1.2,8.5,6.8], [44.4,-1,0,0],
];

function loft(profile, tint, sides) {
  const vertices = [], colors = [], indices = [];
  let previous;
  for (const [z, cy, rx, ry] of profile) {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      if (rx === 0 && i > 0) { ring.push(ring[0]); continue; }
      const a = i * TAU / sides, x = rx * Math.cos(a), y = cy + ry * Math.sin(a);
      ring.push(vertices.length / 3);
      vertices.push(x, y, z);
      tint(x, y, z).toArray(colors, colors.length);
    }
    if (previous) joinRings(indices, previous, ring);
    previous = ring;
  }
  return geometry(vertices, colors, indices);
}

export function pigTorso() {
  return loft(TORSO, (x, y, z) => {
    const belly = (1 - smoothstep(-25, -7, y)) * (1 - smoothstep(22, 34, Math.abs(x)));
    const neck = smoothstep(12, 38, z) * (1 - smoothstep(-6, 16, y));
    return mix.copy(skin).lerp(peach, 0.08 + 0.32 * smoothstep(-4, 32, y))
      .lerp(warm, 0.72 * belly).lerp(shade, neck * 0.32);
  }, 32);
}

export function pigHead() {
  return loft(HEAD, (x, y, z) => {
    const cheek = Math.exp(-(((Math.abs(x) - 24) / 10) ** 2 + ((y + 2) / 8) ** 2 + ((z - 25) / 12) ** 2));
    const muzzle = smoothstep(22, 39, z) * (1 - smoothstep(-5, 11, y));
    return mix.copy(skin).lerp(peach, 0.16 + 0.34 * smoothstep(-2, 33, y))
      .lerp(warm, 0.85 * muzzle).lerp(blush, 0.84 * cheek);
  }, 40);
}

// Front surface of the sculpted head. Painted features follow it even in profile.
export function faceDepth(x, y) {
  for (let i = HEAD.length - 1; i > 0; i--) {
    const [z, cy, rx, ry] = HEAD[i - 1];
    if (!rx || (x / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
    const [end, y1, rx1, ry1] = HEAD[i];
    let lo = 0, hi = 1;
    for (let j = 0; j < 9; j++) {
      const t = (lo + hi) * 0.5;
      const dx = x / (rx + (rx1 - rx) * t);
      const dy = (y - cy - (y1 - cy) * t) / (ry + (ry1 - ry) * t);
      if (dx * dx + dy * dy <= 1) lo = t;
      else hi = t;
    }
    return z + (end - z) * lo;
  }
  return 0;
}

// A tapered stroke laid against the head; the middle of the stroke is slightly raised.
export function faceStroke(points, ink, lift = 0.42) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const vertices = [], colors = [], indices = [];
  for (let i = 0; i <= 16; i++) {
    const p = path.getPoint(i / 16), dir = path.getTangent(i / 16);
    const n = Math.hypot(dir.x, dir.y) || 1;
    for (const across of [-1, 0, 1]) {
      const x = p.x - across * dir.y / n * p.z, y = p.y + across * dir.x / n * p.z;
      vertices.push(x, y, faceDepth(x, y) + 0.14 + (1 - Math.abs(across)) * lift);
      ink.toArray(colors, colors.length);
    }
    if (i === 0) continue;
    for (let j = i * 3 - 3; j < i * 3 - 1; j++) indices.push(j, j + 3, j + 1, j + 1, j + 3, j + 4);
  }
  return geometry(vertices, colors, indices);
}

// A rounded nose pad with two continuous recessed wells. Both halves share the
// bridge vertices, so the lighting stays smooth between the nostrils.
export function pigSnout() {
  const vertices = [], colors = [], indices = [], bridge = new Map();
  const dome = [];
  const dx = 17.4, dy = 10.6, cx = 7.0, cy = 0.65;
  const rose = color(0xf5939d), lit = color(0xffb2ab), recess = color(0x743f50);
  const rim = [];
  for (let i = 0; i <= 10; i++) {
    const t = Math.PI * i / 20;
    rim.push([i === 10 ? 0 : dx * Math.cos(t), dy * Math.sin(t)]);
  }
  for (let i = 1; i <= 12; i++) rim.push([0, dy * Math.cos(Math.PI * i / 12)]);
  for (let i = 1; i < 10; i++) {
    const t = -Math.PI / 2 + Math.PI * i / 20;
    rim.push([dx * Math.cos(t), dy * Math.sin(t)]);
  }
  // Scale around the nostril, fraction of the way to the outline, depth relative to the dome, pigmentation.
  const rings = [[0,0,-4.2,1], [.53,0,-4.0,.94], [.84,0,-2.7,.85], [1,0,-.32,.54],
    [1.19,0,.42,.12], [1.19,.36,.20,0], [1.19,.76,0,0], [1.19,1,0,0]];
  for (const side of [1, -1]) {
    let previous;
    const outward = side === 1 ? row => row : row => [...row].reverse();
    for (let k = 0; k < rings.length + 2; k++) {
      const [scale, spread, depth, darkness] = rings[Math.min(k, rings.length - 1)];
      const row = [];
      for (let i = 0; i < rim.length; i++) {
        const [ox, oy] = rim[i], a = Math.atan2(oy - cy, ox - cx);
        const hx = cx + 2.92 * scale * Math.cos(a) + 0.55 * scale * Math.sin(a);
        const hy = cy + 4.35 * scale * Math.sin(a);
        let x = spread === 1 ? ox : hx + (ox - hx) * spread;
        let y = spread === 1 ? oy : hy + (oy - hy) * spread;
        let z = 50.9 - 2.15 * ((x / dx) ** 2 + (y / dy) ** 2) + depth;
        if (k === rings.length) { x *= 1.026; y *= 1.025; z -= 1.9; }
        if (k === rings.length + 1) { x *= .85; y *= .87; z -= 8.1; }
        const bridgeKey = x === 0 ? k + '/' + i : null;
        if (bridgeKey && bridge.has(bridgeKey)) { row.push(bridge.get(bridgeKey)); continue; }
        if (k === 0 && i) { row.push(row[0]); continue; }
        const index = vertices.length / 3;
        if (bridgeKey) bridge.set(bridgeKey, index);
        row.push(index);
        vertices.push(side * x, y - 1.6, z);
        if (k >= 5 && k < rings.length) dome.push(index);
        mix.copy(rose).lerp(lit, .14 + .43 * smoothstep(-7, 10, y)).lerp(recess, darkness)
          .toArray(colors, colors.length);
      }
      // Work outwards from the wells, then around the rolled edge onto the muzzle.
      if (previous) {
        if (k < rings.length) joinRings(indices, outward(row), outward(previous));
        else {
          for (let i = 0; i < row.length; i++) {
            const j = (i + 1) % row.length;
            if (rim[i][0] === 0 && rim[j][0] === 0) continue;
            const q = side > 0 ? [i, j] : [j, i];
            indices.push(row[q[0]], row[q[1]], previous[q[0]], row[q[1]], previous[q[1]], previous[q[0]]);
          }
        }
      }
      previous = row;
    }
  }
  const g = geometry(vertices, colors, indices);
  const normal = new THREE.Vector3();
  for (const i of dome) {
    const x = vertices[i * 3] / dx, y = (vertices[i * 3 + 1] + 1.6) / dy;
    const roll = .54 * smoothstep(.68, 1, x*x + y*y);
    normal.set((4.3 / dx + roll) * x, (4.3 / dy + roll) * y, 1).normalize();
    g.attributes.normal.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return g;
}

export function pigEar() {
  const outline = [[-8,-4,0], [4,-4,1], [11,3,0], [12,12,-1], [10,20,0], [6,26,2.4],
    [2,28,5.1], [-1,27.1,6.9], [-7.6,21,6], [-11.7,11,2.8], [-11,2,0]];
  const curve = new THREE.CatmullRomCurve3(outline.map(p => new THREE.Vector3(...p)), true);
  const rim = curve.getSpacedPoints(32).slice(0, -1);
  const vertices = [], colors = [], indices = [];
  let previous;
  // Back, rounded rim, inner lip and the shallow bowl of the ear.
  for (const [size, depth, tone] of [[0,-5.2,0xe79396],[.64,-4.8,0xef9b9d],[.96,-1.3,0xf5a3a2],
    [1,1.5,0xfeb0a9],[.88,3.7,0xffbaaF],[.73,3.9,0xf29b9d],[.54,2,0xe98996],[.29,.9,0xd97e8e],[0,1.3,0xd78392]]) {
    const row = [], c = color(tone);
    for (const p of rim) {
      if (size === 0 && row.length) { row.push(row[0]); continue; }
      row.push(vertices.length / 3);
      vertices.push(p.x * size, 10 + (p.y - 10) * size, depth + size * p.z);
      c.toArray(colors, colors.length);
    }
    if (previous) joinRings(indices, previous, row);
    previous = row;
  }
  return geometry(vertices, colors, indices);
}

// Paint the iris and its glints on the curvature of a unit eyeball. The whole
// globe can turn under the lid without the highlights floating off its surface.
export function eyeDisc(cx, cy, rx, ry, stops, offset) {
  const vertices = [], colors = [], indices = [];
  let previous;
  for (const [radius, top, bottom = top] of stops) {
    const row = [], upper = color(top), lower = color(bottom);
    for (let i = 0; i < 32; i++) {
      if (radius === 0 && i) { row.push(row[0]); continue; }
      const a = i * TAU / 32, x = cx + rx * radius * Math.cos(a), y = cy + ry * radius * Math.sin(a);
      row.push(vertices.length / 3);
      vertices.push(x, y, Math.sqrt(1 - x * x - y * y) + offset);
      mix.copy(lower).lerp(upper, 0.5 + 0.5 * Math.sin(a) * radius).toArray(colors, colors.length);
    }
    if (previous) joinRings(indices, row, previous);
    previous = row;
  }
  return geometry(vertices, colors, indices);
}

export function eyelid(upper) {
  const g = new THREE.SphereGeometry(upper ? 1.08 : 1.066, 32, 14, 0, TAU, upper ? 0 : Math.PI / 2, Math.PI / 2);
  const pos = g.attributes.position, colors = [];
  const edge = color(upper ? 0x9d686e : 0xd28b8e);
  for (let i = 0; i < pos.count; i++) {
    mix.copy(edge).lerp(skin, smoothstep(0, 0.14, Math.abs(pos.getY(i)))).toArray(colors, colors.length);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

export function scarfBand() {
  const vertices = [], colors = [], indices = [];
  let previous;
  // A folded band with a raised hem and a narrow woven stripe near the upper edge.
  for (const [z, relief, tone] of [[-5.8,-2,0x176b73],[-5.7,.2,0x147b80],[-4.5,1.7,0x209397],
    [-2.3,1.3,0x239c9c],[-.6,.45,0x208b92],[1.4,1.3,0x48b9b0],[2.6,1.85,0x98dfc7],
    [3.5,1.9,0x98dfc7],[4.25,1.75,0x36aaa5],[5.5,1,0x53beb1],[6,-2.1,0x247f80]]) {
    const row = [], c = color(tone);
    for (let i = 0; i < 48; i++) {
      const a = i * TAU / 48, fold = Math.sin(2 * a + .4) + 0.5 * Math.sin(3 * a);
      row.push(vertices.length / 3);
      vertices.push((35.1 + relief) * Math.cos(a), (30.4 + relief) * Math.sin(a), z + 1.45 * fold);
      c.toArray(colors, colors.length);
    }
    if (previous) joinRings(indices, previous, row);
    previous = row;
  }
  return geometry(vertices, colors, indices).rotateX(-0.76);
}

export function neckerchief() {
  const vertices = [], colors = [], indices = [];
  const base = color(0x1f8e95), ridge = color(0x5bbeb0), seam = color(0x9ad6bd);
  let previous;
  for (const [w, y, z] of [[21,-16,22],[18,-20,25.2],[13,-24,26],[9,-27,25.6],
    [6.7,-28.7,25.1],[5.5,-29.6,24.7],[3.4,-31.2,24],[.48,-33,23.1]]) {
    const row = [];
    for (let i = -6; i <= 6; i++) {
      const s = i / 6, fold = Math.cos(s * Math.PI * 1.5);
      row.push(vertices.length / 3);
      vertices.push((21 - w) * .13 + w * s, y + 4 * s * s * w / 21,
        z - .26 * w * s * s + .7 * fold);
      mix.copy(base).lerp(ridge, .28 + .23 * fold);
      if (w === 6.7 || w === 5.5) mix.lerp(seam, .78);
      mix.toArray(colors, colors.length);
    }
    if (previous) for (let i = 0; i < row.length - 1; i++) {
      indices.push(previous[i], row[i], previous[i+1], previous[i+1], row[i], row[i+1]);
    }
    previous = row;
  }
  return geometry(vertices, colors, indices);
}
// A double-sided, creased cloth strip. The centre of the last cross-section is
// cut back to make a fishtail; the two pale rows form a stripe across the tip.
export function scarfEnd(length, drift, droop) {
  const vertices = [], colors = [], indices = [];
  const rail = [-1, -.78, 0, .78, 1];
  const stops = [[0,3.1],[.16,5.6],[.38,5.3],[.60,5.1],[.75,4.9],[.82,4.8],[.88,4.8],[1,4.6]];
  const base = color(0x278e92), ridge = color(0x64c5b5), stripe = color(0xaddfc1), underside = color(0x177782);
  for (const face of [1, -1]) {
    let prev;
    for (const [t, width] of stops) {
      const row = [];
      for (const s of rail) {
        const fold = 1 - Math.abs(s);
        row.push(vertices.length / 3);
        vertices.push(drift * t + s * width * 0.82,
          2.8 * Math.sin(t * Math.PI) + droop * t * t - s * width * .57 + fold * 1.3 + face * .32,
          -t * length + (t === 1 ? fold * 5 : 0));
        mix.copy(base).lerp(ridge, .15 + .53 * fold + .18 * (s + 1) / 2);
        if (t === .82 || t === .88) mix.lerp(stripe, .9);
        if (face < 0) mix.lerp(underside, .55);
        mix.toArray(colors, colors.length);
      }
      if (prev) for (let i = 0; i < row.length - 1; i++) {
        const a = prev[i], b = prev[i+1], c = row[i+1], d = row[i];
        if (face > 0) indices.push(a,b,d,b,c,d);
        else indices.push(a,d,b,b,d,c);
      }
      prev = row;
    }
  }
  return geometry(vertices, colors, indices);
}
