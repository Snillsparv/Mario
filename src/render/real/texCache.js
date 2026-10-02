// The realistic look's texture cache across sessions: generated sets (texgen/sets.js) kept in
// IndexedDB (database 'castle-real', store 'tex'), so a second visit skips the generation. Used
// by the texture worker (render/real/laneRealWorker.js) only: the main thread never waits on it.
//
//   const cache = openTexCache({ limit? })   // never throws; without IndexedDB (node, a private
//                                            // window that refuses it) every call is a miss
//   await cache.get(key) -> { size, albedo, normal, orm } (Uint8Arrays) | null
//   await cache.put(key, set)                // then trims the store to `limit` bytes (48 MB):
//                                            // other TEXGEN_VERSIONs' entries first, then the
//                                            // least recently used
//
// Keys are `${TEXGEN_VERSION}:${jobKey(job)}` (the caller's): a generator changed without a
// version bump would serve stale maps, which tests/real-texgen.test.js guards against. Any error
// (quota, a blocked upgrade, a corrupt entry) is a miss: the set is simply generated again.

const DB = 'castle-real';
const STORE = 'tex';
export const TEX_CACHE_LIMIT = 48 * 1024 * 1024;

const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function openTexCache({ limit = TEX_CACHE_LIMIT } = {}) {
  let db = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastUsed', 'lastUsed');
      };
      db = request(open).catch(() => null);
    } catch {
      db = null;
    }
  }
  const store = async (mode) => {
    const d = await db;
    return d ? d.transaction(STORE, mode).objectStore(STORE) : null;
  };
  const version = (key) => key.slice(0, key.indexOf(':'));

  // Other versions' entries go; then the least recently used (the index's order) until the
  // store fits.
  async function trim(current) {
    const s = await store('readwrite');
    if (!s) return;
    const rows = await request(s.index('lastUsed').getAll());
    let total = 0;
    for (const r of rows) {
      if (version(r.key) === current) total += r.bytes;
      else s.delete(r.key);
    }
    for (const r of rows) {
      if (total <= limit) break;
      if (version(r.key) !== current) continue;
      s.delete(r.key);
      total -= r.bytes;
    }
  }

  return {
    async get(key) {
      try {
        const s = await store('readwrite');
        if (!s) return null;
        const row = await request(s.get(key));
        if (!row) return null;
        row.lastUsed = Date.now();
        s.put(row);
        return { size: row.size, albedo: new Uint8Array(row.albedo), normal: new Uint8Array(row.normal), orm: new Uint8Array(row.orm) };
      } catch {
        return null;
      }
    },
    async put(key, set) {
      try {
        const s = await store('readwrite');
        if (!s) return;
        const copy = (a) => a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
        const bytes = set.albedo.byteLength + set.normal.byteLength + set.orm.byteLength;
        await request(s.put({ key, size: set.size, albedo: copy(set.albedo), normal: copy(set.normal), orm: copy(set.orm), bytes, lastUsed: Date.now() }));
        await trim(version(key));
      } catch {
        // (a full disk or a closed database: the set just is not cached)
      }
    },
  };
}
