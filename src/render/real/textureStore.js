// The realistic look's textures on the main thread: asks the texture worker
// (render/real/laneRealWorker.js) for procedural sets, keeps them for the session, and wraps
// them in three.js DataTextures; and asks it for an area's own realistic geometry (buffers the
// area's realistic build wraps). Nothing is painted or built here (a set is painted in the
// worker, or read from its IndexedDB cache there).
//
//   const store = new TextureStore({ worker? })   // worker: a stand-in for tests ({ postMessage,
//                                                 // onmessage, onerror, terminate }); default the
//                                                 // module worker, started on the first load()
//   store.load(jobs) -> Promise<Map<jobKey, set>> // jobs [{ kind, size, opts }] (texgen/sets.js);
//                                                 // a job asked for before is not asked again;
//                                                 // rejects when the worker cannot start or a
//                                                 // job fails (the area then stays classic)
//   store.maps(key, { anisotropy }) -> { albedo, normal, orm }   // the loaded set's textures,
//                                                 // made once (albedo sRGB; all repeating,
//                                                 // mipmapped: the albedo's own mips where the
//                                                 // set has them, the leaves' coverage-keeping
//                                                 // ones); clone() one for another repeat
//                                                 // (clones share the image and its upload)
//   store.detail(job) -> Promise<detail>          // job { area, tier }: the worker's geometry
//                                                 // for it (world/lane/real/detail.js), once a
//                                                 // session
//   store.ready(jobs) -> boolean                  // all of them loaded
//   store.dispose()
//
// The worker starts lazily but early: main.js asks for the lane's jobs at boot, at idle
// priority, so the sets usually exist before Jonas reaches the lane's door.

import * as THREE from 'three';
import { jobKey, detailKey } from './texgen/jobs.js';

export class TextureStore {
  constructor({ worker = null } = {}) {
    this.worker = worker;
    this.failed = null; // why the worker cannot run (the F1 overlay and the console say it)
    this.sets = new Map(); // jobKey -> set, once loaded
    this.pending = new Map(); // jobKey -> { promise, resolve, reject }
    this.requests = new Map(); // request id -> [jobKey by index]
    this.textures = new Map(); // jobKey -> { albedo, normal, orm }
    this.details = new Map(); // detailKey -> { promise, resolve, reject }
    this.nextId = 0;
  }

  start() {
    if (this.worker || this.failed) return !this.failed;
    try {
      if (typeof Worker === 'undefined') throw new Error('no workers');
      this.worker = new Worker(new URL('./laneRealWorker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      this.fail(`texture worker: ${e?.message ?? e}`);
      return false;
    }
    this.worker.onmessage = ({ data }) => this.receive(data);
    this.worker.onerror = (e) => {
      e?.preventDefault?.();
      this.fail(`texture worker: ${e?.message || 'failed'}`);
    };
    return true;
  }

  load(jobs) {
    const keys = jobs.map(jobKey);
    const fresh = [];
    for (let i = 0; i < jobs.length; i++) {
      const key = keys[i];
      if (this.sets.has(key) || this.pending.has(key) || fresh.some((j) => j.key === key)) continue;
      fresh.push({ key, job: jobs[i] });
    }
    if (fresh.length && this.start()) {
      for (const { key } of fresh) {
        const p = {};
        p.promise = new Promise((resolve, reject) => {
          p.resolve = resolve;
          p.reject = reject;
        });
        p.promise.catch(() => {}); // (seen by the caller's Promise.all; never unhandled here)
        this.pending.set(key, p);
      }
      const id = ++this.nextId;
      this.requests.set(id, fresh.map((f) => f.key));
      this.worker.postMessage({ id, jobs: fresh.map((f) => f.job) });
    }
    if (keys.some((k) => !this.sets.has(k) && !this.pending.has(k))) return Promise.reject(new Error(this.failed ?? 'texture worker stopped'));
    return Promise.all(keys.map((k) => this.sets.get(k) ?? this.pending.get(k).promise)).then(() => new Map(keys.map((k) => [k, this.sets.get(k)])));
  }

  ready(jobs) {
    return jobs.every((j) => this.sets.has(jobKey(j)));
  }

  detail(job) {
    const key = detailKey(job);
    let p = this.details.get(key);
    if (p) return p.promise;
    if (!this.start()) return Promise.reject(new Error(this.failed));
    p = {};
    p.promise = new Promise((resolve, reject) => {
      p.resolve = resolve;
      p.reject = reject;
    });
    p.promise.catch(() => {});
    this.details.set(key, p);
    this.worker.postMessage({ id: ++this.nextId, detail: job });
    return p.promise;
  }

  receive({ id, index, key, set, error, done, detail }) {
    if (this.details.has(key)) {
      const p = this.details.get(key);
      if (error) {
        this.details.delete(key);
        p.reject(new Error(`detail ${key}: ${error}`));
      } else p.resolve(detail);
      return;
    }
    if (done) {
      this.requests.delete(id);
      return;
    }
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (error) {
      p?.reject(new Error(`texture set ${key}: ${error}`));
      return;
    }
    this.sets.set(key, set);
    p?.resolve(set);
  }

  fail(reason, quiet = false) {
    if (!this.failed && !quiet) console.warn(`realistic look unavailable: ${reason}`);
    this.failed = reason;
    for (const p of [...this.pending.values(), ...this.details.values()]) p.reject(new Error(reason));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
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
