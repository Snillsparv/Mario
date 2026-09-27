// F toggles fullscreen: the whole screen, without the browser's bars (the Fullscreen API on
// the page, so it also works inside a frame that allows it, such as the published artifact
// page, where the browser's own F11 would still show the host page around the game).
//
//   const stop = fullscreenKey();   // listens for F itself; stop() removes the listener
//
// Never with Ctrl/Cmd/Alt, never on key repeat. Entering fullscreen also asks for the Escape key
// (Keyboard Lock, Chromium browsers only): Esc keeps pausing the game and the browser tells the
// player to hold Esc to leave fullscreen. Without it (other browsers, a frame) Esc leaves
// fullscreen as usual. The toggle and the checks are the phone pad page's (pad/device.js).

import { canFullscreen, isFullscreen, toggleFullscreen } from '../pad/device.js';

export function fullscreenKey(win = globalThis.window) {
  const doc = win?.document;
  if (!doc || typeof win.addEventListener !== 'function') return () => {};
  const onKey = (e) => {
    if (e.code !== 'KeyF' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!canFullscreen(doc)) return;
    toggleFullscreen(doc);
  };
  const onChange = () => {
    const kb = win.navigator?.keyboard;
    try {
      if (isFullscreen(doc)) kb?.lock?.(['Escape'])?.catch?.(() => {});
      else kb?.unlock?.();
    } catch {
      // no Keyboard Lock here: Esc leaves fullscreen
    }
  };
  win.addEventListener('keydown', onKey);
  doc.addEventListener('fullscreenchange', onChange);
  doc.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    win.removeEventListener('keydown', onKey);
    doc.removeEventListener('fullscreenchange', onChange);
    doc.removeEventListener('webkitfullscreenchange', onChange);
  };
}
