// The realistic look's tiers and how it gets its work done (render/real/tier.js,
// render/real/textureStore.js): the device guess and ?tier=, the render size's cap, the tiers'
// near and far shadows and post chains, the governor's ladder (the post chain's steps first) and
// its verdicts on synthetic frame-time series (stepping down while frames
// are late, back up after a while of keeping 60 fps, a failed step up waiting twice as long
// before the next, stalls and the second after a step not counted, below the ladder the classic
// look), the last good level kept per device; and the workers' pool: as many as the cores spare
// (1 to 3), jobs held until a worker runs, the area's geometry first and the sets shared out by
// their size so the pool finishes together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, guessTier, pickTier, lookPixelRatio, ladder, Governor, savedLevel, saveLevel } from '../src/render/real/tier.js';
import { TextureStore, poolSize } from '../src/render/real/textureStore.js';

test('the guess: phones low, Apple silicon and discrete GPUs high, other desktops mid; ?tier= overrides; the render size capped by pixels', () => {
  assert.equal(guessTier({ coarse: true, touchPoints: 5, shortSide: 390, gpu: 'Apple GPU' }), 'low');
  assert.equal(guessTier({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' }), 'high');
  assert.equal(guessTier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)' }), 'high');
  assert.equal(guessTier({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620)' }), 'mid');
  assert.equal(pickTier('?tier=low', { gpu: 'Apple M2' }), 'low');
  assert.equal(pickTier('?tier=nope', { gpu: 'Apple M2' }), 'high');
  assert.equal(lookPixelRatio(TIERS.high, 2, 1440, 900), Math.sqrt(2.4e6 / (1440 * 900)), 'a MacBook Air at 1.5 is capped to 2.4 MP');
  assert.equal(lookPixelRatio(TIERS.high, 1, 960, 540), 1);
  assert.equal(lookPixelRatio(TIERS.mid, 2, 960, 540), 1);
});

test('the ladder: the build\'s tier\'s post chain stepped down first (the shafts and the colour fringing off, the occlusion\'s 12 taps to 8, the bloom\'s 5 levels to 4, the occlusion off), then each tier\'s own render size, MSAA, near shadow and grass from the build\'s down, each then at 85 % of its render size, the post chain never more than it was stepped down to; a direct build stays without MSAA or post chain', () => {
  // The tiers: the near shadow's tight box, the far map's size, the post chain.
  assert.deepEqual(['high', 'mid', 'low'].map((n) => [TIERS[n].shadow, TIERS[n].box, TIERS[n].far]), [[2048, 1500, 4096], [1024, 1300, 2048], [1024, 1600, 0]]);
  assert.deepEqual(TIERS.high.post, { ao: 12, blur: 4, bloom: 5, shafts: true, ca: true });
  assert.deepEqual(TIERS.mid.post, { ao: 8, blur: 2, bloom: 4, shafts: false, ca: false });
  assert.ok(TIERS.low.post.ao === 0 && TIERS.low.post.bloom === 0 && !TIERS.low.post.shafts && !TIERS.low.post.ca, 'none on low');
  const high = ladder(TIERS.high);
  assert.deepEqual(high.map((l) => l.name), ['high', 'high -shafts', 'high ao8', 'high bloom4', 'high -ao', 'high 85%', 'mid', 'mid 85%', 'low', 'low 85%']);
  const H = [4, 2048, 1500];
  const M = [2, 1024, 1300];
  const L = [0, 1024, 1600];
  assert.deepEqual(high.map((l) => [l.samples, l.shadow, l.box]), [H, H, H, H, H, H, M, M, L, L]);
  assert.deepEqual(high.map((l) => l.scale), [1, 1, 1, 1, 1, 0.85, 1, 0.85, 1, 0.85]);
  assert.deepEqual(high.map((l) => [l.post.ao, l.post.bloom, l.post.shafts, l.post.ca]), [[12, 5, true, true], [12, 5, false, false], [8, 5, false, false], [8, 4, false, false], [0, 4, false, false], [0, 4, false, false], [0, 4, false, false], [0, 4, false, false], [0, 0, false, false], [0, 0, false, false]]);
  assert.deepEqual(high.map((l) => l.post.blur).slice(0, 3), [4, 4, 2], 'the 8 taps blurred less');
  for (const [i, l] of high.entries()) {
    const p = high[i - 1]?.post;
    if (p) assert.ok(l.post.ao <= p.ao && l.post.bloom <= p.bloom && (!l.post.shafts || p.shafts), `${l.name}: never more than the level before`);
  }
  assert.ok(high[0].grass === 1 && high[5].grass === 1 && high[6].grass > 0.5 && high[6].grass < 0.7 && high[8].grass === 0, 'the blades reach less, then none');
  const mid = ladder(TIERS.mid);
  assert.deepEqual(mid.map((l) => l.name), ['mid', 'mid -ao', 'mid 85%', 'low', 'low 85%']);
  assert.deepEqual(mid.map((l) => [l.post.ao, l.post.bloom]), [[8, 4], [0, 4], [0, 4], [0, 0], [0, 0]]);
  assert.deepEqual(ladder(TIERS.low).map((l) => [l.name, l.samples, l.post.ao, l.post.bloom]), [['low', 0, 0, 0], ['low 85%', 0, 0, 0]]);
});

// Feeds `series` ([ms, count] runs) to a governor; returns [frame index, level] of each verdict.
function run(gov, series) {
  const out = [];
  let i = 0;
  for (const [ms, count] of series) {
    for (let k = 0; k < count; k++, i++) {
      const level = gov.frame(ms);
      if (level !== null) out.push([i, level]);
    }
  }
  return out;
}

test('the governor steps down while frames are late (a window of 2 s, after a settling second), one level a verdict, to below the ladder (classic)', () => {
  const levels = ladder(TIERS.high);
  const gov = new Governor({ levels });
  // 30 ms frames (33 fps): a second settling (34 frames), then a verdict every 2 s (67 frames),
  // down to the low level, where 30 fps is enough (its budget 36 ms).
  const steps = run(gov, [[30, 1000]]);
  assert.deepEqual(steps.map(([, l]) => l), [1, 2, 3, 4, 5, 6, 7, 8], 'the post chain\'s steps first, then down to low');
  assert.equal(levels[8].name, 'low');
  assert.equal(steps[0][0], 100);
  assert.equal(steps[1][0] - steps[0][0], 101, 'each step settles a second before its next window');
  // 22 fps: off the ladder (10: the classic look).
  assert.deepEqual(run(new Governor({ levels }), [[45, 1000]]).map(([, l]) => l), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // On a low level 30 fps is fine (its budget 36 ms): a phone holds.
  const phone = new Governor({ levels: ladder(TIERS.low) });
  assert.deepEqual(run(phone, [[33.3, 600]]), [], 'a phone at 30 fps stays');
  assert.deepEqual(run(new Governor({ levels: ladder(TIERS.low) }), [[45, 300]]).map(([, l]) => l), [1, 2], 'at 22 fps it steps down, then to classic');
});

test('the governor holds at 50 fps and more, steps back up after 5 s of 60 fps, waits twice as long after a step up that failed; stalls are not counted', () => {
  const levels = ladder(TIERS.high);
  // 60 fps at the top: nothing to do.
  assert.deepEqual(run(new Governor({ levels }), [[16.7, 2000]]), []);
  // A 55 fps stretch (between 17.5 and 20 ms): neither down nor up.
  assert.deepEqual(run(new Governor({ levels, level: 2 }), [[18.5, 2000]]), []);
  // At level 2 with 60 fps: up after the settling second and 5 s (three 2 s windows), then up again.
  const gov = new Governor({ levels, level: 2 });
  const up = run(gov, [[16.7, 1000]]);
  assert.deepEqual(up.map(([, l]) => l), [1, 0]);
  assert.ok(up[0][0] > 6000 / 16.7 && up[0][0] < 8000 / 16.7, `the first step up after ~7 s (${up[0][0]} frames)`);
  // A step up that fails (late frames right after it) steps back down and doubles the wait.
  const flaky = new Governor({ levels, level: 2 });
  const steps = run(flaky, [[16.7, 420], [25, 120], [16.7, 2000]]);
  assert.deepEqual(steps.map(([, l]) => l).slice(0, 3), [1, 2, 1], 'up, back down, up again');
  const firstWait = steps[0][0];
  const secondWait = steps[2][0] - steps[1][0];
  assert.ok(secondWait > firstWait + 200, `waited 5 s longer the second time: ${secondWait} vs ${firstWait} frames`);
  // Stalls (a hidden tab, a build) and the frames around them do not count...
  assert.deepEqual(run(new Governor({ levels }), [[16.7, 100], [5000, 1], [16.7, 100], [400, 3], [16.7, 2000]]), []);
  // ...but a device that slow all the time steps down (the settling second, then a window).
  assert.deepEqual(run(new Governor({ levels }), [[300, 20]]).map(([, l]) => l), [1]);
});

test('the last good level is kept per device and per tier (local storage, a convenience: none, the top)', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    assert.equal(savedLevel(TIERS.high), 0);
    saveLevel(TIERS.high, 3);
    assert.equal(savedLevel(TIERS.high), 3);
    assert.equal(savedLevel(TIERS.mid), 0, 'another tier starts at its top');
    globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    assert.equal(savedLevel(TIERS.high), 0);
    saveLevel(TIERS.high, 2); // (no throw)
  } finally {
    delete globalThis.localStorage;
  }
});

test('the workers\' pool: the cores but one (1 to 3); jobs held until a worker runs; the geometry first, the sets shared out by size; answers resolve the loads', async () => {
  assert.deepEqual([1, 2, 4, 8, 16, undefined].map(poolSize), [1, 1, 3, 3, 3, 1]);
  const made = [];
  globalThis.Worker = class {
    constructor() {
      this.got = [];
      made.push(this);
    }
    postMessage(m) {
      this.got.push(m);
    }
    terminate() {}
  };
  try {
    const store = new TextureStore({ workers: 3 });
    const detail = store.detail({ area: 'lane', tier: 'high' });
    const jobs = [{ kind: 'render', size: 256 }, { kind: 'leaves', size: 1024 }, ...['asphalt', 'grass', 'brick', 'boards', 'tiles', 'pavers'].map((kind) => ({ kind, size: 512 })), { kind: 'bark', size: 256 }];
    const loaded = store.load(jobs);
    assert.equal(made.length, 3);
    assert.ok(made.every((w) => w.got.length === 0), 'held until each runs');
    let started = false;
    store.started().then(() => (started = true));
    for (const w of made) w.onmessage({ data: { ready: true } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(started, 'started() once every worker said so (a task later)');
    assert.ok(made[0].got[0].detail, 'the geometry first');
    assert.equal(made[1].got[0].jobs[0].kind, 'leaves', 'then the biggest set');
    const cost = (w) => w.got.reduce((n, m) => n + m.cost, 0);
    const costs = made.map(cost);
    assert.ok(Math.max(...costs) - Math.min(...costs) <= 1, `shared out: ${costs}`);
    assert.equal(made.reduce((n, w) => n + w.got.length, 0), jobs.length + 1, 'one job a message');
    // Each worker answers its jobs.
    for (const w of made) {
      for (const m of w.got) {
        if (m.detail) w.onmessage({ data: { id: m.id, key: 'lane:high', detail: { meshes: [] }, cost: m.cost, ms: 5 } });
        else {
          const [job] = m.jobs;
          const key = `${job.kind}:${job.size}:{}`;
          w.onmessage({ data: { id: m.id, index: 0, key, set: { size: job.size }, ms: 3 } });
          w.onmessage({ data: { id: m.id, done: true, cost: m.cost } });
        }
      }
    }
    assert.deepEqual(await detail, { meshes: [] });
    assert.equal((await loaded).size, jobs.length);
    assert.ok(made.every((w) => w.load === undefined) && store.workers.every((w) => Math.abs(w.load) < 1e-9), 'every job answered');
    assert.equal(store.ms['lane:high'], 5);
    assert.equal(store.ms['leaves:1024:{}'], 3);
    assert.ok(store.ready(jobs));
  } finally {
    delete globalThis.Worker;
  }
});
