// The realistic look's procedural texture sets (render/real/texgen/*): pure, deterministic to
// the byte (each set's hash at 64 px pinned with TEXGEN_VERSION: a generator changed without a
// version bump fails here, since the IndexedDB cache would go on serving the old maps), tiling,
// in plausible ranges (linear albedo means per set, roughness, unit normals), the leaf cards'
// cut-outs keeping their coverage at every mip level (else distant foliage thins to nothing), and
// quick enough to make in the worker: Sparrow Lane's high-tier sets well inside 3x the 700 ms
// budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TEXGEN_VERSION, generate } from '../src/render/real/texgen/sets.js';
import { jobKey } from '../src/render/real/texgen/jobs.js';
import { makeFbm, makeCells, coverageMips } from '../src/render/real/texgen/noise.js';
import { TIERS } from '../src/render/real/tier.js';
import { laneJobs } from '../src/world/lane/real/look.js';

// Each lane job's maps at 64 px (sha1 of albedo, normal, orm), for TEXGEN_VERSION 1. Bump the
// version and these together whenever a generator's output changes.
const PINNED = {
  version: 1,
  hashes: {
    'asphalt:{}': '0c277766d269c7d9',
    'grass:{}': '5b13b3937acf55e3',
    'brick:{"cols":3,"jitter":0.12,"mortar":[0.32,0.32,0.31],"rows":7,"seed":23,"tone":[0.5,0.5,0.48]}': 'a4a33d02f9351c8c',
    'brick:{}': 'a4ed355d50ff7e64',
    'render:{}': 'a3c36907ad8ac19f',
    'boards:{}': '7e263730eff300d0',
    'tiles:{}': '0cd7c8bb18d84a8e',
    'pavers:{"cols":10,"seed":73}': '7af87ac8440e7746',
    'pavers:{}': '8c283e6c89994825',
    'tiles:{"relief":0}': '6c7004fd45c9e2a5',
    'granite:{}': '2e69c35083fd3dbd',
    'bark:{}': '98e8c8d71d224033',
    'bark:{"birch":1}': '2d7cafb7589aa3df',
    'leaves:{}': '5ec91de4f9973683',
    'fir:{}': 'f24e65bed631522d',
  },
};
// The cut-outs: alpha-tested leaf cards (their alpha the leaves' coverage), not opaque.
const CUTOUTS = new Set(['leaves', 'fir']);
// Plausible linear albedo means (r, g, b) per set, before the catalogue's colour and the tints.
const MEANS = {
  asphalt: [[0.05, 0.15], [0.05, 0.15], [0.05, 0.15]], // dark: the material brightens it
  grass: [[0.04, 0.15], [0.1, 0.3], [0.01, 0.06]],
  brick: [[0.35, 0.85], [0.35, 0.85], [0.35, 0.85]], // white sand-lime; the grey blocks lower
  render: [[0.7, 0.9], [0.7, 0.9], [0.7, 0.9]],
  boards: [[0.7, 0.95], [0.7, 0.95], [0.7, 0.95]], // light neutral: the tint gives Falu red
  tiles: [[0.4, 0.8], [0.4, 0.8], [0.4, 0.8]], // mid grey: the tint gives black or brown
  pavers: [[0.1, 0.35], [0.12, 0.35], [0.08, 0.3]],
  soil: [[0.05, 0.2], [0.02, 0.1], [0.01, 0.05]],
  granite: [[0.15, 0.45], [0.15, 0.45], [0.15, 0.45]],
  bark: [[0.08, 0.25], [0.06, 0.2], [0.04, 0.16]], // grey-brown: the tint darkens it
  birch: [[0.45, 0.75], [0.45, 0.75], [0.45, 0.75]], // a birch's chalky white, black patches
  leaves: [[0.03, 0.15], [0.06, 0.2], [0.01, 0.08]], // green leaves over a dark green ground
  fir: [[0.02, 0.1], [0.04, 0.12], [0.01, 0.06]],
};
const meansOf = (job) => MEANS[job.opts?.birch ? 'birch' : job.kind];

const hash = (s) => crypto.createHash('sha1').update(s.albedo).update(s.normal).update(s.orm).digest('hex').slice(0, 16);
const lin = (b) => {
  const v = b / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const pinKey = (job) => jobKey({ ...job, size: 0 }).replace(':0:', ':');

test('every lane set is pinned at 64 px with TEXGEN_VERSION, and the same bytes again on a second run at each tier\'s sizes', () => {
  assert.equal(TEXGEN_VERSION, PINNED.version, 'TEXGEN_VERSION bumped: re-pin the hashes below');
  const jobs = laneJobs(TIERS.high);
  assert.deepEqual(jobs.map(pinKey).sort(), Object.keys(PINNED.hashes).sort(), 'every lane set pinned');
  for (const job of jobs) assert.equal(hash(generate({ ...job, size: 64 })), PINNED.hashes[pinKey(job)], `${pinKey(job)} changed: bump TEXGEN_VERSION`);
  // The low tier's sets (all 256 a set) twice: the same bytes.
  for (const job of laneJobs(TIERS.low)) {
    assert.equal(job.size, job.kind === 'leaves' ? 512 : 256, 'all 256 (the leaf atlas: four 256 cells)');
    assert.equal(hash(generate(job)), hash(generate(job)), jobKey(job));
  }
  // Keys: the options in a fixed order.
  assert.equal(jobKey({ kind: 'brick', size: 512, opts: { rows: 7, cols: 3 } }), jobKey({ kind: 'brick', size: 512, opts: { cols: 3, rows: 7 } }));
  assert.throws(() => generate({ kind: 'nope', size: 64 }), /no generator/);
});

test('the noises are periodic over the texture (so every set tiles), and each set\'s seams look like any of its rows', () => {
  for (const [cells, octaves, cy] of [[6, 3, 6], [48, 3, 3], [3, 2, 24], [128, 2, 128]]) {
    const f = makeFbm(cells, octaves, 17, cy);
    for (let k = 0; k < 50; k++) {
      const u = k / 50;
      assert.ok(Math.abs(f(1 - 1e-9, u) - f(0, u)) < 1e-6, `fbm ${cells}: across s`);
      assert.ok(Math.abs(f(u, 1 - 1e-9) - f(u, 0)) < 1e-6, `fbm ${cells}: across t`);
    }
  }
  const cell = makeCells(24, 5);
  const a = { f1: 0, f2: 0, id: 0 };
  const b = { f1: 0, f2: 0, id: 0 };
  for (let k = 0; k < 50; k++) {
    cell(1 - 1e-9, k / 50, a);
    cell(0, k / 50, b);
    assert.ok(Math.abs(a.f1 - b.f1) < 1e-6 && a.id === b.id, 'cells across s');
  }
  // The seam (the last row against the first, the last column against the first) differs from
  // its neighbour by no more than 3x the mean difference of neighbouring rows inside, plus 6 %
  // of the set's luminance range (the brick's and pavers' joints make some rows far apart).
  const n = 128;
  for (const job of laneJobs(TIERS.high)) {
    const s = generate({ ...job, size: n });
    const L = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) L[i] = 0.2126 * lin(s.albedo[i * 4]) + 0.7152 * lin(s.albedo[i * 4 + 1]) + 0.0722 * lin(s.albedo[i * 4 + 2]);
    const range = Math.max(...L) - Math.min(...L);
    const rows = (p, q) => L.subarray(p * n, p * n + n).reduce((d, v, x) => d + Math.abs(v - L[q * n + x]), 0) / n;
    const cols = (p, q) => {
      let d = 0;
      for (let y = 0; y < n; y++) d += Math.abs(L[y * n + p] - L[y * n + q]);
      return d / n;
    };
    let inRows = 0;
    let inCols = 0;
    for (let k = 0; k + 1 < n; k++) {
      inRows += rows(k, k + 1) / (n - 1);
      inCols += cols(k, k + 1) / (n - 1);
    }
    assert.ok(rows(n - 1, 0) <= 3 * inRows + 0.06 * range, `${jobKey(job)}: the seam across rows ${rows(n - 1, 0).toFixed(3)} (inside ${inRows.toFixed(3)})`);
    assert.ok(cols(n - 1, 0) <= 3 * inCols + 0.06 * range, `${jobKey(job)}: the seam across columns ${cols(n - 1, 0).toFixed(3)} (inside ${inCols.toFixed(3)})`);
  }
});

test('albedo means in plausible linear ranges per set, roughness 0.3 .. 1, normals of unit length, opaque (but the cut-outs), no metal', () => {
  for (const job of laneJobs(TIERS.high)) {
    const s = generate({ ...job, size: 128 });
    const n = s.size * s.size;
    const mean = [0, 0, 0];
    let rough = [1, 0];
    let normal = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) mean[c] += lin(s.albedo[i * 4 + c]) / n;
      const r = s.orm[i * 4 + 1] / 255;
      rough = [Math.min(rough[0], r), Math.max(rough[1], r)];
      const [x, y, z] = [0, 1, 2].map((c) => s.normal[i * 4 + c] / 127.5 - 1);
      normal = Math.max(normal, Math.abs(Math.hypot(x, y, z) - 1));
      assert.equal(s.orm[i * 4 + 2], 0, 'no metal');
      if (!CUTOUTS.has(job.kind)) assert.equal(s.albedo[i * 4 + 3], 255, 'opaque');
    }
    const want = meansOf(job);
    mean.forEach((m, c) => assert.ok(m >= want[c][0] && m <= want[c][1], `${jobKey(job)}: mean ${'rgb'[c]} ${m.toFixed(3)}`));
    assert.ok(rough[0] >= 0.3 && rough[1] <= 1, `${jobKey(job)}: roughness ${rough}`);
    assert.ok(normal < 0.02, `${jobKey(job)}: normals ${normal}`);
  }
});

test('the cut-outs\' mips keep their coverage (as many texels pass the alpha test at every level of 16 px and more as at full size), all the way down to 1 x 1', () => {
  for (const job of laneJobs(TIERS.high).filter((j) => CUTOUTS.has(j.kind))) {
    const s = generate({ ...job, size: 256 });
    const passing = (a, n) => {
      let p = 0;
      for (let i = 0; i < n * n; i++) if (a[i * 4 + 3] > 127) p++;
      return p / (n * n);
    };
    const full = passing(s.albedo, 256);
    assert.ok(full > 0.05 && full < 0.6, `${jobKey(job)}: coverage ${full}`);
    assert.equal(s.mips.length, 8, '128 .. 1');
    s.mips.forEach((m, k) => {
      const n = 256 >> (k + 1);
      assert.equal(m.length, n * n * 4);
      if (n >= 16) assert.ok(Math.abs(passing(m, n) - full) <= 0.05 * full, `${jobKey(job)} level ${k + 1}: ${passing(m, n).toFixed(3)} vs ${full.toFixed(3)}`);
    });
    // A plain box filter thins it level by level (what the mips are for).
    const plain = coverageMips(s.albedo, 256, 2);
    assert.ok(passing(plain[3], 16) < 0.5 * full, 'a mean alone loses the leaves');
  }
});

test('Sparrow Lane\'s high-tier sets are made within 3x the 700 ms budget (node, one core)', (t) => {
  const jobs = laneJobs(TIERS.high);
  const t0 = performance.now();
  for (const job of jobs) generate(job);
  const ms = performance.now() - t0;
  t.diagnostic(`${jobs.length} sets (${jobs.map((j) => `${j.kind} ${j.size}`).join(', ')}) in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 3 * 700, `${ms.toFixed(0)} ms`);
});
