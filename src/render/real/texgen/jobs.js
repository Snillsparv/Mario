// A texture job's key (render/real/texgen/sets.js jobs: { kind, size, opts }), apart from the
// generators so the main thread can name sets without carrying the code that paints them (that
// lives in the texture worker's chunk).
//
//   jobKey({ kind, size, opts }) -> 'kind:size:{...}'   // the options in a fixed order (sorted
//                                   // keys), so equal jobs share a key: the in-session cache's
//                                   // and, after TEXGEN_VERSION, the IndexedDB cache's

export function jobKey({ kind, size, opts = {} }) {
  const keys = Object.keys(opts).sort();
  return `${kind}:${size}:${JSON.stringify(opts, keys)}`;
}
