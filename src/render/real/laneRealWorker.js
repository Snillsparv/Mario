// The realistic look's worker (a module worker, render/real/textureStore.js starts it): the pure
// code the realistic Sparrow Lane needs and the main bundle does not carry. In R1 it paints the
// procedural texture sets (texgen/sets.js), or takes them from the IndexedDB cache
// (texCache.js), off the main thread; it imports no three.js and no other chunk (tests/
// net-relay-build.test.js checks the built file).
//
//   in:  { id, jobs: [{ kind, size, opts }] }
//   out: { id, index, key, set: { size, albedo, normal, orm } }   per job, in order, its three
//        maps' buffers transferred (the cache keeps its own copies)
//        { id, index, key, error }                                 a generator that threw
//        { id, done: true }                                        after the last

import { TEXGEN_VERSION, generate } from './texgen/sets.js';
import { jobKey } from './texgen/jobs.js';
import { openTexCache } from './texCache.js';

const cache = openTexCache();

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
      self.postMessage({ id, index, key, set }, [set.albedo.buffer, set.normal.buffer, set.orm.buffer]);
    } catch (e) {
      self.postMessage({ id, index, key, error: String(e?.message ?? e) });
    }
  }
  self.postMessage({ id, done: true });
}

// One request at a time, in the order they came.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => run(data));
};
