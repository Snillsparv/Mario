// The browser's storage, or null where there is none or it is blocked (its access throws:
// private modes, sandboxed frames, cookies off). Shared by what remembers things: the game
// choice (ui/raceChoice.js), the picture settings (render/post/settings.js), the phone's room
// (net/RemotePad.js, per tab).
//
//   browserStorage('localStorage' | 'sessionStorage' = 'localStorage') -> Storage | null

export function browserStorage(kind = 'localStorage') {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null; // blocked storage throws on access
  }
}
