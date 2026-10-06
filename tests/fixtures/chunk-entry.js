// A stand-in for a built lazy chunk's raw module (tests/chunks.test.js): the build exports the
// entry's namespace under a minified name, beside what its children import.
const entry = { chunk: 'fixture', builders: [] };
export { entry as t };
export const n = () => 1;
