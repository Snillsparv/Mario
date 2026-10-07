// The game's chunk plan (vite.config.js, build only). Rolldown's automatic chunking carves the
// game's bundle into shared chunks as soon as lazy chunks share game modules with it, so the plan
// pins every module to one chunk and names the chunks:
//   * `main` (index.html's one script): every module the entry reaches through static imports;
//   * each lazily imported module (an import()'s target: an area's code, a feature) is a chunk of
//     its own, named after its file (index.js: its folder), holding what it reaches that its
//     parent does not hold: its parent is the chunk all its import() calls are in (main, or a
//     chunk: Sparrow Lane's realistic look and movers are loaded through the lane's chunk, so they
//     may import what it holds), and what its parent's ancestors hold is there already;
//   * a module two sibling chunks reach is hoisted into their parent, and one needed on two
//     branches into main (logged), so no chunk is shared and every chunk imports only its
//     ancestors (tests/net-relay-build.test.js);
//   * `main` names modules that belong to main though only lazy chunks import them (code two
//     chunks share by design: world/courseKit.js, ...; paths under src/): pinned there with what
//     they import, so they are no hoist. The build test requires no hoist at all: a new one is a
//     chunk reaching another's code, to be moved into a module of its own (and pinned, if two
//     chunks share it).
//
//   const plan = chunkPlan({ main: ['world/courseKit.js'] });   // the plugin
//   plan.hoists                 // the last build's hoists (the lines it logged)
//   output.codeSplitting.groups: [{ name: plan.chunkOf, test: plan.planned,
//                                   includeDependenciesRecursively: false, debugName: 'chunk-plan' }]
export default function chunkPlan({ log = console.log, main: pinned = [] } = {}) {
  let chunkOf = new Map(); // module id -> chunk name
  const hoists = [];
  const say = (line) => (hoists.push(line), log(line));
  const short = (s) => s.replace(/^.*?[\\/](src|node_modules)[\\/]/, '');
  const nameOf = (id) => {
    const parts = id.split(/[\\/]/);
    const file = parts.pop().replace(/\.[jt]s$/, '');
    return file === 'index' ? parts.pop() : file;
  };
  return {
    name: 'chunk-plan',
    apply: 'build',
    buildStart() {
      chunkOf = new Map();
      hoists.length = 0;
    },
    buildEnd(error) {
      if (error) return; // (the build failed: Rolldown reports why)
      const info = (id) => this.getModuleInfo(id);
      const ids = [...this.getModuleIds()];
      const closure = (roots, has) => {
        const seen = new Set();
        const todo = [...roots];
        while (todo.length) {
          const id = todo.pop();
          if (seen.has(id) || has(id)) continue;
          seen.add(id);
          for (const dep of info(id)?.importedIds ?? []) todo.push(dep);
        }
        return seen;
      };
      chunkOf = new Map();
      const chunks = new Map(); // name -> { name, parent, mods: Set }
      const isPinned = (id) => pinned.includes(short(id).replace(/\\/g, '/'));
      const unknown = pinned.filter((p) => !ids.some((id) => short(id) === p));
      if (unknown.length) throw new Error(`chunk-plan: no module ${unknown.join(', ')} to pin into main`);
      const main = { name: 'main', parent: null, mods: closure(ids.filter((id) => info(id)?.isEntry || isPinned(id)), () => false) };
      chunks.set('main', main);
      for (const id of main.mods) chunkOf.set(id, 'main');
      const holds = (chunk, id) => {
        for (let c = chunk; c; c = c.parent) if (c.mods.has(id)) return true;
        return false;
      };
      let pending = new Set(ids.flatMap((id) => info(id)?.dynamicallyImportedIds ?? []).filter((id) => !chunkOf.has(id)));
      while (pending.size) {
        const ready = [];
        for (const root of pending) {
          const homes = new Set((info(root)?.dynamicImporters ?? []).map((i) => chunkOf.get(i)));
          if (homes.has(undefined)) continue; // an importer not placed yet
          const lineage = (n) => { const out = []; for (let c = chunks.get(n); c; c = c.parent) out.push(c); return out; };
          const [first, ...rest] = [...homes].map(lineage);
          ready.push([root, first.find((c) => rest.every((l) => l.includes(c)))]); // deepest common ancestor
        }
        if (!ready.length) throw new Error(`chunk-plan: cannot place ${[...pending].map(short).join(', ')}`);
        const byParent = new Map();
        for (const [root, parent] of ready) (byParent.get(parent) ?? byParent.set(parent, []).get(parent)).push(root);
        for (const [parent, roots] of byParent) {
          for (;;) {
            const reach = new Map();
            for (const root of roots) for (const id of closure([root], (m) => holds(parent, m))) reach.set(id, [...(reach.get(id) ?? []), root]);
            // A module a chunk on another branch holds already (two branches need it): into main.
            const foreign = [...reach.keys()].filter((id) => chunkOf.has(id));
            for (const id of foreign) {
              if (chunkOf.get(id) === 'main') continue; // (moved with another)
              say(`chunk-plan: main also carries ${short(id)} (${chunkOf.get(id)}'s, needed under ${parent.name} too)`);
              for (const m of closure([id], (x) => main.mods.has(x))) {
                chunks.get(chunkOf.get(m))?.mods.delete(m);
                main.mods.add(m);
                chunkOf.set(m, 'main');
              }
            }
            if (foreign.length) continue;
            const shared = [...reach].filter(([, r]) => r.length > 1);
            if (!shared.length) {
              for (const root of roots) {
                let name = nameOf(root);
                while (chunks.has(name)) name += '_';
                const mods = new Set([...reach].filter(([, r]) => r[0] === root).map(([id]) => id));
                chunks.set(name, { name, parent, mods });
                for (const id of mods) chunkOf.set(id, name);
              }
              break;
            }
            for (const [id, r] of shared) {
              say(`chunk-plan: ${parent.name} also carries ${short(id)} (shared by ${r.map(short).join(', ')})`);
              for (const m of closure([id], (x) => holds(parent, x))) {
                parent.mods.add(m);
                chunkOf.set(m, parent.name);
              }
            }
          }
        }
        for (const [root] of ready) pending.delete(root);
        pending = new Set([...pending, ...ids.flatMap((id) => info(id)?.dynamicallyImportedIds ?? []).filter((id) => !chunkOf.has(id))]);
      }
    },
    hoists,
    planned: (id) => chunkOf.has(id),
    chunkOf: (id) => chunkOf.get(id) ?? null,
  };
}
