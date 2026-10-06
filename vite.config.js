import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defineConfig } from 'vite';
import padRelay from './tools/padRelay.js';
import glslMinify from './tools/glslMinify.js';
import chunkPlan from './tools/chunkPlan.js';

const BASE = './';
const plan = chunkPlan();
const TARGET = 'es2022';
// The game is a tree of chunks (tools/chunkPlan.js pins every module to exactly one):
//   * `main`, index.html's one script: everything the first frame needs (three.js, the engine,
//     the player, camera, renderer and audio engine, the castle grounds and their objects, the
//     menus and HUD, every area's definition and layout, the realistic look's boot part);
//   * lazy chunks, each the target of import() calls in one parent chunk only (src/core/
//     chunks.js lists main's; a child's loader is in its parent): the areas `hall`, `skerries`
//     and `lane` (its children `realLook`, the realistic look's main-thread code, and `laneBoss`,
//     what moves in the dad's drive: the bins, STOMPWATT, the garage doors). A lazy chunk
//     imports only its ancestors (never a sibling, never a shared chunk), and holds no three.js;
//   * two module workers of their own (new Worker(new URL(...)), not imports): the title logo's
//     and the realistic look's (render/real/laneRealWorker.js: the pure code the realistic
//     Sparrow Lane needs, kept out of main; no three.js, under 160 kB).
// Without the plan Rolldown would carve main itself into shared chunks as soon as a third lazy
// chunk shares game modules with it. A module two siblings need is hoisted into their parent,
// one needed on two branches into main; the build prints each hoist ("chunk-plan: main also
// carries ..."). Every chunk has a hard byte cap, pinned in tests/net-relay-build.test.js; main's
// is MAIN_BUDGET (its warning limit, in kB, below). New areas and features go into a chunk of
// their own (an import() in src/core/chunks.js); main grows only for engine-level work. Raising a
// cap is the last resort, documented here, in the test and in docs/ARCHITECTURE.md ("Chunks").
// History: 900 kB (one bundle, 09-24), 1400 (the phone pad), 1500, 1600 (the round hall), 1700
// (Sparrow Lane; a hard budget since its realistic look), 1560 with the lazy areas (main
// 1,518,217 bytes).
// Never: treeshake.propertyWriteSideEffects false (it drops calls that only write their
// arguments' properties: Jonas's pose functions), dropping console (shader compile errors go
// through console.error), property mangling (chunks are minified apart), pruning three.js.
const MAIN_BUDGET = 1560000;
const GAME_CHUNK_LIMIT_KB = MAIN_BUDGET / 1000;

// The phone's controller page (pad.html) is built on its own, right after the game, into the
// same output folder. Built together, the two pages would share a chunk (the touch controller
// and the protocol). Built apart, the game (index.html + assets/main-*.js and its lazy chunks)
// is exactly as without the pad, and the pad (pad.html + assets/pad-*.js, ~66 kB) is a single
// self-contained script with its own copy of the shared code, so a phone never downloads the
// game. (It never sees the chunk plan: it is built with configFile false.)
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
  plugins: [padRelay(), padPageBuild(), glslMinify(), plan],
  build: {
    target: TARGET,
    rolldownOptions: {
      input: { main: 'index.html' },
      // (Each module in the chunk the plan gives it; see the top.)
      output: { codeSplitting: { groups: [{ name: plan.chunkOf, test: plan.planned, includeDependenciesRecursively: false, debugName: 'chunk-plan' }] } },
    },
    chunkSizeWarningLimit: GAME_CHUNK_LIMIT_KB,
    // (Lazy chunks load when the game asks for them: no modulepreload link in index.html, which
    // loads main alone.)
    modulePreload: false,
  },
});
