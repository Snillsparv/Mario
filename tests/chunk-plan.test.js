// tools/chunkPlan.js, the build's chunk plan, on made-up module graphs: main is the entry's
// static closure; each import() target is a chunk named after its file (index.js: its folder)
// under the chunk its importers are in; a module two siblings reach goes to their parent, one
// reached on two branches to main (each hoist logged); a root no placed chunk imports throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import chunkPlan from '../tools/chunkPlan.js';

// graph: { id: { imports: [...], dynamic: [...] } }, the entry first. Returns the plan's chunk of
// every module and the hoists it logged.
function plan(graph) {
  const ids = Object.keys(graph);
  const info = (id) => {
    const m = graph[id];
    if (!m) return null;
    return {
      id,
      isEntry: id === ids[0],
      importedIds: m.imports ?? [],
      dynamicallyImportedIds: m.dynamic ?? [],
      dynamicImporters: ids.filter((i) => (graph[i].dynamic ?? []).includes(id)),
    };
  };
  const logs = [];
  const p = chunkPlan({ log: (s) => logs.push(s) });
  p.buildStart();
  p.buildEnd.call({ getModuleIds: () => ids.values(), getModuleInfo: info });
  const chunks = {};
  for (const id of ids) {
    assert.ok(p.planned(id), `${id} is planned`);
    chunks[id] = p.chunkOf(id);
  }
  return { chunks, logs };
}

test('main is the static closure of the entry; each import() target a chunk of its own, named after its file (index.js: its folder)', () => {
  const { chunks, logs } = plan({
    '/src/main.js': { imports: ['/src/a.js', '/src/core/chunks.js'] },
    '/src/a.js': { imports: ['/src/b.js'] },
    '/src/b.js': {},
    '/src/core/chunks.js': { dynamic: ['/src/world/hall/index.js', '/src/ui/Recorder.js'] },
    '/src/world/hall/index.js': { imports: ['/src/world/hall/hall.js', '/src/b.js'] },
    '/src/world/hall/hall.js': {},
    '/src/ui/Recorder.js': { imports: ['/src/a.js'] },
  });
  assert.deepEqual(chunks, {
    '/src/main.js': 'main',
    '/src/a.js': 'main',
    '/src/b.js': 'main',
    '/src/core/chunks.js': 'main',
    '/src/world/hall/index.js': 'hall',
    '/src/world/hall/hall.js': 'hall',
    '/src/ui/Recorder.js': 'Recorder',
  });
  assert.deepEqual(logs, []);
});

test('a module two sibling chunks reach is hoisted into their parent (logged)', () => {
  const { chunks, logs } = plan({
    '/src/main.js': { dynamic: ['/src/x/index.js', '/src/y/index.js'] },
    '/src/x/index.js': { imports: ['/src/shared.js'] },
    '/src/y/index.js': { imports: ['/src/shared.js', '/src/y/own.js'] },
    '/src/shared.js': { imports: ['/src/deep.js'] },
    '/src/deep.js': {},
    '/src/y/own.js': {},
  });
  assert.equal(chunks['/src/shared.js'], 'main');
  assert.equal(chunks['/src/deep.js'], 'main', 'with what it imports');
  assert.equal(chunks['/src/x/index.js'], 'x');
  assert.equal(chunks['/src/y/own.js'], 'y');
  assert.deepEqual(logs, ['chunk-plan: main also carries shared.js (shared by x/index.js, y/index.js)', 'chunk-plan: main also carries deep.js (shared by x/index.js, y/index.js)']);
});

test("a lazy chunk's children: under it, holding only what it does not; siblings under it share through it", () => {
  const { chunks, logs } = plan({
    '/src/main.js': { imports: ['/src/core/chunks.js', '/src/three.js'] },
    '/src/three.js': {},
    '/src/core/chunks.js': { dynamic: ['/src/world/lane/index.js'] },
    '/src/world/lane/index.js': { imports: ['/src/world/lane/build.js'], dynamic: ['/src/world/lane/real/realLook.js', '/src/objects/laneBoss/index.js'] },
    '/src/world/lane/build.js': { imports: ['/src/three.js'] },
    '/src/world/lane/real/realLook.js': { imports: ['/src/world/lane/build.js', '/src/three.js', '/src/geo.js'] },
    '/src/objects/laneBoss/index.js': { imports: ['/src/world/lane/build.js', '/src/geo.js', '/src/objects/laneBoss/rig.js'] },
    '/src/geo.js': {},
    '/src/objects/laneBoss/rig.js': {},
  });
  assert.equal(chunks['/src/world/lane/build.js'], 'lane');
  assert.equal(chunks['/src/world/lane/real/realLook.js'], 'realLook');
  assert.equal(chunks['/src/objects/laneBoss/index.js'], 'laneBoss');
  assert.equal(chunks['/src/objects/laneBoss/rig.js'], 'laneBoss');
  assert.equal(chunks['/src/geo.js'], 'lane', "shared by the lane's two children: into the lane's chunk");
  assert.equal(chunks['/src/three.js'], 'main');
  assert.deepEqual(logs, ['chunk-plan: lane also carries geo.js (shared by world/lane/real/realLook.js, objects/laneBoss/index.js)']);
});

test('a module needed on two branches (a chunk holds it, another branch reaches it) is hoisted into main', () => {
  const { chunks, logs } = plan({
    '/src/main.js': { dynamic: ['/src/a/index.js', '/src/e/index.js'] },
    '/src/a/index.js': { imports: ['/src/a/kit.js'] },
    '/src/a/kit.js': { imports: ['/src/a/model.js'] },
    '/src/a/model.js': {},
    '/src/e/index.js': { dynamic: ['/src/f/index.js'] },
    '/src/f/index.js': { imports: ['/src/a/kit.js'] },
  });
  assert.equal(chunks['/src/a/index.js'], 'a');
  assert.equal(chunks['/src/a/kit.js'], 'main');
  assert.equal(chunks['/src/a/model.js'], 'main', 'with what it imports');
  assert.equal(chunks['/src/f/index.js'], 'f');
  assert.deepEqual(logs, ["chunk-plan: main also carries a/kit.js (a's, needed under e too)"]);
});

test('a root no chunk imports (its importer never placed) cannot be placed: the build stops', () => {
  assert.throws(
    () =>
      plan({
        '/src/main.js': {},
        '/src/orphan.js': { dynamic: ['/src/lost/index.js'] },
        '/src/lost/index.js': {},
      }),
    /chunk-plan: cannot place lost\/index\.js/,
  );
});

test('a failed build is left to Rolldown to report', () => {
  const p = chunkPlan({ log: () => {} });
  p.buildEnd.call({ getModuleIds: () => [][Symbol.iterator](), getModuleInfo: () => null }, new Error('boom'));
  assert.equal(p.planned('/src/main.js'), false);
});
