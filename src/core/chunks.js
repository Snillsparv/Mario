// Every lazy chunk the game's main chunk loads (vite.config.js, tools/chunkPlan.js: each
// import() target is a chunk of its own, holding what it reaches that main does not), in one
// place: its loader, memoised (a failure clears it, so a later call tries again), and prefetch(),
// which fetches some in the background. A child chunk is loaded through its parent's loader
// (world/lane/index.js: loadRealLook, loadBoss), so it may import what its parent holds.
//
//   CHUNKS.<name>() -> Promise<module>     // hall, skerries, lane: an area's code (its builders;
//                                          // world/areaDefs.js def.code); face, phone,
//                                          // recorder, touch: the opt-in UI (main: the face
//                                          // screen with ?face=1, the phone panel once a relay
//                                          // answers, the recorder on the first V or 9, the
//                                          // touch controller on a touch screen)
//   once(load, name) -> () => Promise      // a memoised loader that tries again after a failure
//                                          // (the children's too); the chunk's entry module
//                                          // exports `chunk = name`
//   prefetch(names, load?) -> Promise      // one at a time, each after an idle moment, so a
//                                          // phone's title keeps its frame rate; never rejects (a
//                                          // failure is logged and loads again when needed);
//                                          // load(name) (default CHUNKS[name]()): main's areas
//                                          // go through core/AreaSwitch.js load
//
// Under ?test=1 main awaits every chunk before window.__ready (tests stay synchronous); in play
// it prefetches the areas after the title's first frame. A new area or feature gets a loader
// here (its entry module exporting `chunk`, its name; tests/chunks.test.js) and a cap in
// tests/net-relay-build.test.js, rather than a static import from main.

// A failed module fetch stays failed for the page in Chromium (and its kin): import() of the same
// URL fails again without a request. So a retry asks for the chunk under a fresh query, at the
// URL the failure named (when it names one: Chromium's and Firefox's messages do). That is the
// chunk's raw module: the build exports its entry's namespace from it under a minified name
// (beside what its children import from it), found by the entry's own `chunk` export (its name:
// every chunk's entry module has one). A chunk fetched so is a module of its own: fine for the
// areas' chunks and the lane's children, which no chunk imports statically; the lane's children,
// importing the lane by its own URL, would then fail in turn (the lane stays classic and still,
// as without them), until a reload.
const FAILED_URL = /\b(?:https?|file):\/\/[^\s'"`]+?\.js\b/;
const entryOf = (m, name) => (m.chunk === name ? m : (Object.values(m).find((v) => v?.chunk === name) ?? m));

export function once(load, name) {
  let p = null;
  let url = null;
  let tries = 0;
  return () =>
    (p ??= (url ? import(/* @vite-ignore */ `${url}?retry=${++tries}`).then((m) => entryOf(m, name)) : load()).catch((e) => {
      url ??= String(e?.message ?? '').match(FAILED_URL)?.[0] ?? null;
      p = null;
      throw e;
    }));
}

export const CHUNKS = {
  hall: once(() => import('../world/hall/index.js'), 'hall'),
  skerries: once(() => import('../world/skerries/index.js'), 'skerries'),
  lane: once(() => import('../world/lane/index.js'), 'lane'),
  face: once(() => import('../ui/FaceScreen.js'), 'FaceScreen'),
  phone: once(() => import('../ui/PhonePanel.js'), 'PhonePanel'),
  recorder: once(() => import('../ui/Recorder.js'), 'Recorder'),
  touch: once(() => import('../ui/TouchController.js'), 'TouchController'),
};

const idle = () =>
  new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 1000 });
    else setTimeout(resolve, 50);
  });

export async function prefetch(names, load = (name) => CHUNKS[name]()) {
  for (const name of names) {
    await idle();
    try {
      await load(name);
    } catch (e) {
      console.warn(`[chunks] ${name} did not load (${e?.message ?? e}); it is tried again when needed`);
    }
  }
}
