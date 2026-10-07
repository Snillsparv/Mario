// src/core/chunks.js, the game's lazy chunks' loaders, in node (where import() is a plain module
// import): every loader gives its chunk's entry module, which names itself (`chunk`: a retry
// after a failed fetch finds the entry's namespace in the chunk's raw module by it), the lane's
// children through the lane's own loaders; a loader is memoised, and after a failure it tries
// again (under a fresh query at the URL the failure named, where it named one), finding the
// entry by its name; prefetch() loads one at a time and never rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, once, prefetch } from '../src/core/chunks.js';

// Each loader and the name of its chunk (the build's: tests/net-relay-build.test.js).
const NAMES = { hall: 'hall', skerries: 'skerries', lane: 'lane', aiRace: 'aiRace', face: 'FaceScreen', phone: 'PhonePanel', recorder: 'Recorder', touch: 'TouchController' };

test('every chunk loader gives its entry module, named for it; the lane loads its children', async () => {
  assert.deepEqual(Object.keys(CHUNKS).sort(), Object.keys(NAMES).sort());
  for (const [key, load] of Object.entries(CHUNKS)) {
    const m = await load();
    const name = NAMES[key];
    assert.equal(m.chunk, name);
    assert.equal(await load(), m, `${name}: memoised`);
  }
  const lane = await CHUNKS.lane();
  assert.equal((await lane.loadRealLook()).chunk, 'realLook');
  assert.equal((await lane.loadBoss()).chunk, 'laneBoss');
  assert.ok(Array.isArray((await CHUNKS.hall()).builders));
});

test('a failed load is not kept: the next call tries again, at the URL the failure named under a fresh query, and finds the entry by its name', async () => {
  let calls = 0;
  const here = new URL('./fixtures/chunk-entry.js', import.meta.url).href;
  const load = once(() => {
    calls++;
    return Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${here}`));
  }, 'fixture');
  await assert.rejects(load(), /Failed to fetch/);
  const m = await load();
  assert.equal(calls, 1, 'the retry asks for the URL itself');
  assert.equal(m.chunk, 'fixture', "the entry's namespace, found in the raw module");
  assert.equal(await load(), m, 'memoised once loaded');
  // A failure naming no URL: the loader itself is called again.
  let n = 0;
  const flaky = once(() => (++n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ chunk: 'x' })), 'x');
  await assert.rejects(flaky());
  assert.equal((await flaky()).chunk, 'x');
  assert.equal(n, 2);
});

test('prefetch() loads one at a time, in order, and never rejects', async () => {
  const order = [];
  const was = console.warn;
  console.warn = () => {};
  try {
    await prefetch(['a', 'b', 'c'], async (name) => {
      order.push(`${name}+`);
      if (name === 'b') throw new Error('offline');
      await new Promise((r) => setTimeout(r, 5));
      order.push(`${name}-`);
    });
  } finally {
    console.warn = was;
  }
  assert.deepEqual(order, ['a+', 'a-', 'b+', 'c+', 'c-']);
});
