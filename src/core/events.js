// Minimal event bus shared by all systems (see docs/ARCHITECTURE.md for event names).
export class Events {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name)?.delete(fn);
  }

  emit(name, data) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) fn(data);
  }
}
