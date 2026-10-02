// Noise and map helpers for the realistic look's procedural texture sets (texgen/sets.js). Pure
// functions on typed arrays: no DOM, no three.js, so the same code runs in the texture worker
// (render/real/laneRealWorker.js) and in node tests, and gives the same bytes every time (integer
// hash noise, no Math.random).
//
//   hash(ix, iy, seed) -> 0..1             // integer lattice hash
//   rng(seed) -> () => 0..1                // a seeded stream (mulberry32)
//   makeFbm(cells, octaves, seed, cy?) -> (s, t) => 0..1
//                                          // fractal value noise over texture coords in [0, 1),
//                                          // periodic over the texture: `cells` lattice cells
//                                          // across at the first octave (`cy` down, default
//                                          // cells), each octave twice as fine
//   makeCells(n, seed) -> (s, t, out) => out   // cellular noise on an n x n jittered grid
//                                          // (periodic): out.f1, out.f2 (distances in cell
//                                          // units to the nearest two points), out.id (the
//                                          // nearest cell's hash)
//   blur(field, n, r) -> Float32Array      // wrapping box blur, separable
//   normalsFrom(height, n, strength) -> Uint8Array RGBA   // tangent-space normals (OpenGL: +y
//                                          // is +v), from a height field in texel units
//   cavity(height, n, r, k) -> Float32Array   // occlusion: how far each texel lies under the
//                                          // blurred surface round it
//   pack(n, { col, alpha?, h, strength, ao?, rough, metal? }) -> { size, albedo, normal, orm }
//                                          // a set's three RGBA8 maps (see sets.js)
//   clamp01, smooth(a, b, v), field(n), rgbField(n), setRgb(col, i, r, g, b)
//
// The lattices are tables filled once per noise (a generator builds its noises before its pixel
// loop), so a pixel costs a few lookups, never a hash; inputs s, t lie in [0, 1), so no lattice
// index ever needs wrapping but the last cell's far corner.

// ------------------------------------------------------------------ hashes

export function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A px x py table of lattice hashes.
function lattice(px, py, seed) {
  const table = new Float64Array(px * py);
  for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) table[y * px + x] = hash(x, y, seed);
  return table;
}

// ------------------------------------------------------------------ noises

export function makeFbm(cells, octaves, seed, cy = cells) {
  const tables = [];
  const xs = [];
  const ys = [];
  const amps = [];
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const px = cells << o;
    const py = cy << o;
    xs.push(px);
    ys.push(py);
    tables.push(lattice(px, py, seed + o * 1013));
    amps.push(amp);
    norm += amp;
    amp *= 0.5;
  }
  const inv = 1 / norm;
  return (s, t) => {
    let sum = 0;
    for (let o = 0; o < octaves; o++) {
      const px = xs[o];
      const py = ys[o];
      const x = s * px;
      const y = t * py;
      const ix = x | 0;
      const iy = y | 0;
      const fx = x - ix;
      const fy = y - iy;
      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);
      const x1 = ix + 1 === px ? 0 : ix + 1;
      const r0 = iy * px;
      const r1 = (iy + 1 === py ? 0 : iy + 1) * px;
      const T = tables[o];
      const a = T[r0 + ix];
      const b = T[r0 + x1];
      const c = T[r1 + ix];
      const d = T[r1 + x1];
      sum += amps[o] * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
    }
    return sum * inv;
  };
}

export function makeCells(n, seed) {
  // Each cell's point (jitter in the cell) and id.
  const jx = lattice(n, n, seed);
  const jy = lattice(n, n, seed + 7);
  const ids = lattice(n, n, seed + 13);
  return (s, t, out) => {
    const x = s * n;
    const y = t * n;
    const ix = x | 0;
    const iy = y | 0;
    let f1 = 81;
    let f2 = 81;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
      let cyy = iy + j;
      if (cyy < 0) cyy += n;
      else if (cyy >= n) cyy -= n;
      for (let i = -1; i <= 1; i++) {
        let cx = ix + i;
        if (cx < 0) cx += n;
        else if (cx >= n) cx -= n;
        const k = cyy * n + cx;
        const dx = ix + i + jx[k] - x;
        const dy = iy + j + jy[k] - y;
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = ids[k];
        } else if (d < f2) f2 = d;
      }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
  };
}

// ------------------------------------------------------------------ fields and maps

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smooth(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const field = (n) => new Float32Array(n * n);
export const rgbField = (n) => new Float32Array(n * n * 3);
export function setRgb(col, i, r, g, b) {
  col[i * 3] = r;
  col[i * 3 + 1] = g;
  col[i * 3 + 2] = b;
}
const toByte = (v) => Math.round(clamp01(v) * 255);

// Linear 0..1 to an sRGB byte, through a 4096-step table (the albedo's encode).
const SRGB_STEPS = 4096;
const SRGB = new Uint8Array(SRGB_STEPS + 1);
for (let i = 0; i <= SRGB_STEPS; i++) {
  const v = i / SRGB_STEPS;
  SRGB[i] = toByte(v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}
const srgb = (v) => SRGB[Math.round(clamp01(v) * SRGB_STEPS)];

export function blur(src, n, r) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const k = 1 / (2 * r + 1);
  const w = (i) => ((i % n) + n) % n;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + w(i)];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + w(x + r + 1)] - src[row + w(x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[w(i) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = acc * k;
      acc += tmp[w(y + r + 1) * n + x] - tmp[w(y - r) * n + x];
    }
  }
  return out;
}

export function normalsFrom(h, n, strength) {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const up = (y + 1 === n ? 0 : y + 1) * n;
    const down = (y === 0 ? n - 1 : y - 1) * n;
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const right = x + 1 === n ? 0 : x + 1;
      const left = x === 0 ? n - 1 : x - 1;
      const dx = (h[row + right] - h[row + left]) * 0.5 * strength;
      const dy = (h[up + x] - h[down + x]) * 0.5 * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + x) * 4;
      out[i] = toByte((-dx / l) * 0.5 + 0.5);
      out[i + 1] = toByte((-dy / l) * 0.5 + 0.5);
      out[i + 2] = toByte((1 / l) * 0.5 + 0.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

export function cavity(h, n, r, k) {
  const b = blur(h, n, r);
  const ao = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const d = b[i] - h[i];
    ao[i] = clamp01(1 - (d > 0 ? d : 0) * k);
  }
  return ao;
}

// A set's maps: albedo (sRGB colour, alpha = coverage or 255), normal, ORM (R occlusion, G
// roughness, B metalness: three.js's aoMap / roughnessMap / metalnessMap channels).
export function pack(n, { col, alpha = null, h, strength, ao = null, rough, metal = 0 }) {
  const albedo = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  const roughNumber = typeof rough === 'number' ? toByte(rough) : -1;
  const metalNumber = typeof metal === 'number' ? toByte(metal) : -1;
  for (let i = 0; i < n * n; i++) {
    const j = i * 4;
    albedo[j] = srgb(col[i * 3]);
    albedo[j + 1] = srgb(col[i * 3 + 1]);
    albedo[j + 2] = srgb(col[i * 3 + 2]);
    albedo[j + 3] = alpha ? toByte(alpha[i]) : 255;
    orm[j] = ao ? toByte(ao[i]) : 255;
    orm[j + 1] = roughNumber >= 0 ? roughNumber : toByte(rough[i]);
    orm[j + 2] = metalNumber >= 0 ? metalNumber : toByte(metal[i]);
    orm[j + 3] = 255;
  }
  return { size: n, albedo, normal: normalsFrom(h, n, strength), orm };
}
