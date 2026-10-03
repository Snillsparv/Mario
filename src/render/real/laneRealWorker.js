// The realistic look's worker (a module worker, render/real/textureStore.js starts it): the pure
// code the realistic Sparrow Lane needs and the main bundle does not carry. It paints the
// procedural texture sets (texgen/sets.js), or takes them from the IndexedDB cache
// (texCache.js), and builds the lane's own realistic geometry (world/lane/real/detail.js: the
// dad's house in full, the tile courses, the leaf cards, the firs, the cars, the grass's clump
// and lawn mask), off the main thread; it imports no three.js and no other chunk (tests/
// net-relay-build.test.js checks the built file).
//
//   in:  { id, jobs: [{ kind, size, opts }] }
//   out: { id, index, key, set: { size, albedo, normal, orm, mips? } }   per job, in order, its
//        maps' buffers transferred (the cache keeps its own copies)
//        { id, index, key, error }                                 a generator that threw
//        { id, done: true }                                        after the last
//   in:  { id, detail: { area, tier } }                            an area's geometry
//   out: { id, key, detail }                                       its buffers transferred
//        { id, key, error }

import { TEXGEN_VERSION, generate } from './texgen/sets.js';
import { jobKey, detailKey } from './texgen/jobs.js';
import { openTexCache } from './texCache.js';
import { buildLaneDetail, detailBuffers } from '../../world/lane/real/detail.js';
import * as laneLayout from '../../world/lane/layout.js';

const cache = openTexCache();
const DETAILS = { lane: (tier) => buildLaneDetail(laneLayout, tier) };

const transfers = (set) => [set.albedo.buffer, set.normal.buffer, set.orm.buffer, ...(set.mips ?? []).map((m) => m.buffer)];

async function run({ id, jobs }) {
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const key = jobKey(job);
    try {
      const stored = `${TEXGEN_VERSION}:${key}`;
      let set = await cache.get(stored);
      if (!set) {
        set = generate(job);
        await cache.put(stored, set);
      }
      self.postMessage({ id, index, key, set }, transfers(set));
    } catch (e) {
      self.postMessage({ id, index, key, error: String(e?.message ?? e) });
    }
  }
  self.postMessage({ id, done: true });
}

function build({ id, detail: job }) {
  const key = detailKey(job);
  try {
    const detail = DETAILS[job.area](job.tier);
    self.postMessage({ id, key, detail }, detailBuffers(detail));
  } catch (e) {
    self.postMessage({ id, key, error: String(e?.message ?? e) });
  }
}

// One request at a time, in the order they came.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => (data.detail ? build(data) : run(data)));
};
