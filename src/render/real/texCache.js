// The realistic look's texture cache across sessions: generated sets (texgen/sets.js) kept in
// IndexedDB (database 'castle-real': store 'tex' the maps, store 'meta' each entry's size and
// when it was last used), so a second visit skips the generation. Used by the texture workers
// (render/real/laneRealWorker.js) only: the main thread never waits on it.
//
//   const cache = openTexCache({ limit? })   // never throws; without IndexedDB (node, a private
//                                            // window that refuses it) every call is a miss
//   await cache.get(key) -> { size, albedo, normal, orm, mips? } (Uint8Arrays) | null
//   cache.put(key, set) -> Promise           // copies the maps at once (the set's buffers may be
//                                            // transferred as soon as it returns), stores them,
//                                            // then trims the store to `limit` bytes (64 MB: the
//                                            // high tier's sets, ~50 MB, fit): other
//                                            // TEXGEN_VERSIONs' entries first, then the least
//                                            // recently used
//
// Keys are `${TEXGEN_VERSION}:${jobKey(job)}` (the caller's): a generator changed without a
// version bump would serve stale maps, which tests/real-texgen.test.js guards against. Any error
// (quota, a blocked upgrade, a corrupt entry) is a miss: the set is simply generated again. The
// sizes and dates live apart from the maps, so marking an entry used and trimming the store read
// and write a few bytes, never the maps (several workers share the database).

const DB = 'castle-real';
const VERSION = 2; // (1 kept the dates with the maps)
const STORE = 'tex';
const META = 'meta';
export const TEX_CACHE_LIMIT = 64 * 1024 * 1024;

const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function openTexCache({ limit = TEX_CACHE_LIMIT } = {}) {
  let db = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      const open = indexedDB.open(DB, VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        for (const name of [...d.objectStoreNames]) d.deleteObjectStore(name);
        d.createObjectStore(STORE, { keyPath: 'key' });
        d.createObjectStore(META, { keyPath: 'key' });
      };
      db = request(open).catch(() => null);
    } catch {
      db = null;
    }
  }
  const stores = async (mode) => {
    const d = await db;
    if (!d) return null;
    const t = d.transaction([STORE, META], mode);
    return [t.objectStore(STORE), t.objectStore(META), t];
  };
  const version = (key) => key.slice(0, key.indexOf(':'));
  // The keys stored when it opened (read once: a miss then costs no transaction, which would
  // queue behind the other workers' writes).
  const known = (async () => {
    const s = await stores('readonly');
    return new Set(s ? await request(s[1].getAllKeys()) : []);
  })().catch(() => new Set());

  // Other versions' entries go; then the least recently used until the store fits.
  async function trim(current) {
    const s = await stores('readwrite');
    if (!s) return;
    const [maps, meta] = s;
    const rows = (await request(meta.getAll())).sort((a, b) => a.lastUsed - b.lastUsed);
    let total = 0;
    const drop = (key) => {
      maps.delete(key);
      meta.delete(key);
    };
    for (const r of rows) {
      if (version(r.key) === current) total += r.bytes;
      else drop(r.key);
    }
    for (const r of rows) {
      if (total <= limit) break;
      if (version(r.key) !== current) continue;
      drop(r.key);
      total -= r.bytes;
    }
  }

  return {
    async get(key) {
      try {
        if (!(await known).has(key)) return null;
        const s = await stores('readwrite');
        if (!s) return null;
        const [maps, meta] = s;
        const row = await request(maps.get(key));
        if (!row) return null;
        meta.put({ key, bytes: row.bytes, lastUsed: Date.now() });
        const set = { size: row.size, albedo: new Uint8Array(row.albedo), normal: new Uint8Array(row.normal), orm: new Uint8Array(row.orm) };
        if (row.mips) set.mips = row.mips.map((m) => new Uint8Array(m));
        return set;
      } catch {
        return null;
      }
    },
    // (Copies the maps at once: the caller may hand the set's buffers on as soon as it returns.)
    put(key, set) {
      const copy = (a) => a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
      const mips = set.mips ?? [];
      const bytes = set.albedo.byteLength + set.normal.byteLength + set.orm.byteLength + mips.reduce((n, m) => n + m.byteLength, 0);
      const row = { key, size: set.size, albedo: copy(set.albedo), normal: copy(set.normal), orm: copy(set.orm), mips: set.mips?.map(copy), bytes };
      return this.store(row);
    },
    async store(row) {
      const { key, bytes } = row;
      try {
        const s = await stores('readwrite');
        if (!s) return;
        const [maps, meta, t] = s;
        maps.put(row);
        meta.put({ key, bytes, lastUsed: Date.now() });
        await new Promise((resolve, reject) => {
          t.oncomplete = resolve;
          t.onerror = t.onabort = () => reject(t.error);
        });
        await trim(version(key));
      } catch {
        // (a full disk or a closed database: the set just is not cached)
      }
    },
  };
}
