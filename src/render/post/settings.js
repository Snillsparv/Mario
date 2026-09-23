// Persisted renderer display options (N64 mode, 4:3 pillarbox). Storage may be missing or
// throw (private browsing, sandboxed iframes, node), so every access is guarded and the
// defaults are used on any failure.

const STORAGE_KEY = 'castleGrounds.render.v1';

export const DEFAULT_SETTINGS = Object.freeze({ n64: true, pillarbox: false });

export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage = browserStorage()) {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof saved?.[key] === 'boolean') settings[key] = saved[key];
    }
  } catch {
    // Corrupt or inaccessible storage: keep the defaults.
  }
  return settings;
}

// Returns true when the settings were written.
export function saveSettings(settings, storage = browserStorage()) {
  if (!storage) return false;
  try {
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = !!settings[key];
    storage.setItem(STORAGE_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}
