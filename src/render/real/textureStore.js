// The realistic look's textures on the main thread: asks the realistic look's workers
// (render/real/laneRealWorker.js, a small pool: the sets and the geometry are made side by side
// on the cores the device spares) for procedural sets, keeps them for the session, and wraps
// them in three.js DataTextures; and asks them for an area's own realistic geometry (buffers the
// area's realistic build wraps). Nothing is painted or built here (a set is painted in a
// worker, or read from its IndexedDB cache there).
//
//   const store = new TextureStore({ worker?, workers? })   // worker: a stand-in for tests
//                                                 // ({ postMessage, onmessage, onerror,
//                                                 // terminate }: a pool of one); workers: the
//                                                 // pool's size (poolSize: the cores but one, 1
//                                                 // to 3); module workers, started as the jobs
//                                                 // come
//   store.load(jobs) -> Promise<Map<jobKey, set>> // jobs [{ kind, size, opts }] (texgen/sets.js);
//                                                 // a job asked for before is not asked again;
//                                                 // rejects when a worker cannot start or a job
//                                                 // fails (the area then stays classic)
//   store.maps(key, { anisotropy }) -> { albedo, normal, orm }   // the loaded set's textures,
//                                                 // made once (albedo sRGB; all repeating,
//                                                 // mipmapped: the albedo's own mips where the
//                                                 // set has them, the leaves' coverage-keeping
//                                                 // ones); clone() one for another repeat
//                                                 // (clones share the image and its upload)
//   store.detail(job) -> Promise<detail>          // job { area, tier }: the workers' geometry
//                                                 // for it (world/lane/real/detail.js), once a
//                                                 // session
//   store.ready(jobs) -> boolean                  // all of them loaded
//   store.started() -> Promise                    // every worker started so far is running
//   store.ms                                      // { [job's key]: ms } how long each took in
//                                                 // its worker
//   store.dispose()
//
// One job a message, each handed at once to the worker with the least work ahead of it (by an
// estimate: an area's geometry, its longest job, asked for first; then the sets, the biggest
// first), so the pool finishes together without the main thread handing out work as it goes
// (it may be busy: main.js asks for the lane's jobs at the start of its boot, so everything
// usually exists before Jonas reaches the lane's door).

import * as THREE from 'three';
import { jobKey, detailKey } from './texgen/jobs.js';

const POOL = 3; // workers at most
const DETAIL_COST = 6; // an area's geometry's work, in 512 px sets (as the pool shares it out)

export const poolSize = (cores = 2) => Math.max(1, Math.min(POOL, (cores || 2) - 1));

export class TextureStore {
  constructor({ worker = null, workers = poolSize(globalThis.navigator?.hardwareConcurrency) } = {}) {
    this.stub = worker;
    this.size = worker ? 1 : workers;
    this.workers = []; // { worker, load, waiting, ready }: load, the estimated work handed to it
    // and not answered yet; waiting, its jobs held until it runs
    this.failed = null; // why the workers cannot run (the F1 overlay and the console say it)
    this.sets = new Map(); // jobKey -> set, once loaded
    this.pending = new Map(); // jobKey or detailKey -> { promise, resolve, reject } until answered
    this.details = new Map(); // detailKey -> its promise (once a session)
    this.textures = new Map(); // jobKey -> { albedo, normal, orm }
    this.ms = {};
    this.nextId = 0;
  }

  // One more worker for the pool (false: none can start; the store has failed).
  spawn() {
    let worker = this.stub;
    try {
      if (!worker) {
        if (typeof Worker === 'undefined') throw new Error('no workers');
        worker = new Worker(new URL('./laneRealWorker.js', import.meta.url), { type: 'module' });
      }
    } catch (e) {
      this.fail(`texture worker: ${e?.message ?? e}`);
      return false;
    }
    // (A test's stand-in runs at once; a worker says so, and its jobs wait till then.)
    const w = { worker, load: 0, waiting: this.stub ? null : [] };
    w.ready = this.stub ? Promise.resolve() : new Promise((resolve) => (w.go = resolve));
    worker.onmessage = ({ data }) => this.receive(w, data);
    worker.onerror = (e) => {
      e?.preventDefault?.();
      this.fail(`texture worker: ${e?.message || 'failed'}`);
    };
    this.workers.push(w);
    return true;
  }

  // A job for the worker with the least work ahead (a new one while the pool is not full).
  assign(message, cost) {
    if (this.workers.length < this.size && !this.spawn()) return;
    let w = this.workers[0];
    for (const x of this.workers) if (x.load < w.load) w = x;
    w.load += cost;
    message.cost = cost;
    // (Held until it runs: a message posted before is handed over by a task of this thread's,
    // which waits behind whatever this thread is doing.)
    if (w.waiting) w.waiting.push(message);
    else w.worker.postMessage(message);
  }

  expect(key) {
    const p = {};
    p.promise = new Promise((resolve, reject) => {
      p.resolve = resolve;
      p.reject = reject;
    });
    p.promise.catch(() => {}); // (seen by the caller's Promise.all; never unhandled here)
    this.pending.set(key, p);
    return p;
  }

  load(jobs) {
    if (this.failed) return Promise.reject(new Error(this.failed));
    const keys = jobs.map(jobKey);
    const fresh = [];
    for (let i = 0; i < jobs.length; i++) {
      const key = keys[i];
      if (this.sets.has(key) || this.pending.has(key)) continue;
      this.expect(key);
      fresh.push({ key, job: jobs[i] });
    }
    // The biggest first (they take longest).
    fresh.sort((a, b) => b.job.size - a.job.size);
    for (const { job } of fresh) this.assign({ id: ++this.nextId, jobs: [job] }, (job.size / 512) ** 2);
    if (this.failed) return Promise.reject(new Error(this.failed));
    return Promise.all(keys.map((k) => this.sets.get(k) ?? this.pending.get(k).promise)).then(() => new Map(keys.map((k) => [k, this.sets.get(k)])));
  }

  ready(jobs) {
    return jobs.every((j) => this.sets.has(jobKey(j)));
  }

  detail(job) {
    const key = detailKey(job);
    const have = this.details.get(key);
    if (have) return have;
    if (this.failed) return Promise.reject(new Error(this.failed));
    const p = this.expect(key);
    this.details.set(key, p.promise);
    this.assign({ id: ++this.nextId, detail: job }, DETAIL_COST);
    return p.promise;
  }

  // Resolves once every worker started so far runs (its module loaded: from then on it works
  // whatever the main thread does), a task later (the jobs posted as the last one said so leave
  // only as that task ends).
  started() {
    return Promise.all(this.workers.map((w) => w.ready)).then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  receive(w, data) {
    if (data.ready) {
      for (const message of w.waiting) w.worker.postMessage(message);
      w.waiting = null;
      w.go();
      return;
    }
    const { key, set, error, done, detail, ms } = data;
    // A request's work is off the worker after its last word: a set request's `done`, a
    // geometry request's one answer (it has no index).
    const geometry = data.index === undefined && this.details.has(key);
    if (done || geometry) w.load -= data.cost;
    if (done) return;
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (ms !== undefined) this.ms[key] = ms;
    if (error) {
      if (geometry) this.details.delete(key);
      p?.reject(new Error(`${geometry ? 'detail' : 'texture set'} ${key}: ${error}`));
      return;
    }
    if (geometry) {
      p?.resolve(detail);
      return;
    }
    this.sets.set(key, set);
    p?.resolve(set);
  }

  fail(reason, quiet = false) {
    if (!this.failed && !quiet) console.warn(`realistic look unavailable: ${reason}`);
    this.failed = reason;
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
    for (const w of this.workers) w.worker.terminate();
    this.workers.length = 0;
  }

  maps(key, { anisotropy = 1 } = {}) {
    let t = this.textures.get(key);
    if (t) return t;
    const set = this.sets.get(key);
    if (!set) throw new Error(`texture set ${key} is not loaded`);
    const make = (data, srgb, mips = null) => {
      const tex = new THREE.DataTexture(data, set.size, set.size, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = !mips;
      if (mips) tex.mipmaps = [data, ...mips].map((m, i) => ({ data: m, width: set.size >> i, height: set.size >> i }));
      tex.anisotropy = anisotropy;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.name = key;
      tex.needsUpdate = true;
      return tex;
    };
    t = { albedo: make(set.albedo, true, set.mips), normal: make(set.normal, false), orm: make(set.orm, false) };
    this.textures.set(key, t);
    return t;
  }

  dispose() {
    for (const t of this.textures.values()) for (const tex of Object.values(t)) tex.dispose();
    this.textures.clear();
    this.fail('disposed', true);
  }
}
