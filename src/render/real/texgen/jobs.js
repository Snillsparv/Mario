// A texture job's key (render/real/texgen/sets.js jobs: { kind, size, opts }), and a geometry
// job's (world/lane/real/detail.js: { area, tier }), apart from the code that does the jobs so
// the main thread can name them without carrying it (that lives in the worker's chunk).
//
//   jobKey({ kind, size, opts }) -> 'kind:size:{...}'   // the options in a fixed order (sorted
//                                   // keys), so equal jobs share a key: the in-session cache's
//                                   // and, after TEXGEN_VERSION, the IndexedDB cache's
//   detailKey({ area, tier }) -> 'area:tier'

export function jobKey({ kind, size, opts = {} }) {
  const keys = Object.keys(opts).sort();
  return `${kind}:${size}:${JSON.stringify(opts, keys)}`;
}

export function detailKey({ area, tier }) {
  return `${area}:${tier}`;
}
