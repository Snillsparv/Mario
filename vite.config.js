import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defineConfig } from 'vite';
import padRelay from './tools/padRelay.js';
import glslMinify from './tools/glslMinify.js';

const BASE = './';
const TARGET = 'es2022';
// The game is one bundle by design: it needs all of it (three.js is much of it) before the
// first frame, so splitting would only add requests. ~1.68 MB minified (1,678,665 bytes), ~549
// kB gzipped, plus one lazily loaded chunk and two module workers of its own (new Worker(new
// URL(...)), not imports): the ~13 kB title-logo worker and the realistic look's
// (render/real/laneRealWorker.js, ~114 kB, a pool of up to three of them: the pure code the
// realistic Sparrow Lane needs, its texture generators and its geometry builders, kept out of
// main; it must import no three.js and stay under 160 kB). The chunk, `realLook` (~52 kB:
// world/lane/real/realLook.js, imported only dynamically, at boot beside the workers), is the
// realistic look's main-thread code the boot does not need (its materials, sky, probe, far
// shadow, post chain and output pass); it imports only from main (three.js and the classic
// builders are not downloaded twice) and stays under 90 kB; with no modulepreload (below) the
// game's index.html still loads main alone. The size warning was 1600 (1,584,238 bytes before
// it); raised to 1700 for the second course, Sparrow Lane (world/lane/*, about 60 kB with its
// details; its realistic look's renderer side about 47 kB more, until G1 moved most of it into
// the lazy chunk): the hard budget (1,700,000 bytes) is the limit. Growth goes into the worker
// or the lazy chunk first; raising the cap is the last resort, documented here and in
// docs/ARCHITECTURE.md.
const GAME_CHUNK_LIMIT_KB = 1700;

// The phone's controller page (pad.html) is built on its own, right after the game, into the
// same output folder. Built together, the two pages would share a chunk (the touch controller
// and the protocol), and the game would no longer be one file. Built apart, each page is a
// single self-contained script: the game (index.html + assets/main-*.js) exactly as without
// the pad, and the pad (pad.html + assets/pad-*.js, ~85 kB) with its own copy of the shared
// code, so a phone never downloads the game.
const PAD_PAGE = fileURLToPath(new URL('./pad.html', import.meta.url));

function padPageBuild() {
  let config;
  return {
    name: 'pad-page-build',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      if (!existsSync(PAD_PAGE)) this.warn('pad.html is missing: the phone controller page is not built');
    },
    async closeBundle(error) {
      if (error || !existsSync(PAD_PAGE)) return;
      const b = config.build;
      if (b.write === false || b.ssr || b.lib) return;
      await build({
        configFile: false,
        root: config.root,
        base: BASE,
        mode: config.mode,
        logLevel: config.logLevel,
        customLogger: config.logger,
        publicDir: false,
        clearScreen: false,
        build: {
          outDir: path.resolve(config.root, b.outDir),
          assetsDir: b.assetsDir,
          emptyOutDir: false, // the game is already there
          copyPublicDir: false,
          target: b.target,
          minify: b.minify,
          sourcemap: b.sourcemap,
          reportCompressedSize: b.reportCompressedSize,
          rolldownOptions: { input: { pad: PAD_PAGE } },
        },
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  // host: true listens on every interface, so a phone on the same Wi-Fi can reach the game
  // server and its phone-controller relay (tools/padRelay.js) in dev and in preview.
  server: { host: true },
  preview: { host: true },
  // (glslMinify: the build's shader text, /* glsl */ literals, without comments and spare
  // whitespace: tools/glslMinify.js.)
  plugins: [padRelay(), padPageBuild(), glslMinify()],
  build: {
    target: TARGET,
    rolldownOptions: { input: { main: 'index.html' } },
    chunkSizeWarningLimit: GAME_CHUNK_LIMIT_KB,
    // (The realLook chunk is imported at boot, beside the workers: no preload helper, no
    // modulepreload link in index.html.)
    modulePreload: false,
  },
});
