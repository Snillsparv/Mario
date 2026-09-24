// Phone features the pad page uses, each guarded (a browser without one just goes without):
// vibration, a screen wake lock, fullscreen, and no scrolling / zooming / selection / long-press
// menus. `nav` / `doc` are injectable for the node tests.

// Vibrate for `ms` where the browser allows it (Android Chrome after a first tap; iOS has no
// vibration API). Returns whether it was asked for.
export function vibrate(ms, nav = globalThis.navigator) {
  try {
    if (!nav || typeof nav.vibrate !== 'function') return false;
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return false; // would be blocked (and logged)
    return nav.vibrate(Math.max(0, Math.round(ms))) !== false;
  } catch {
    return false;
  }
}

// Keep the screen on while the page is visible (Screen Wake Lock API). The lock is lost when
// the page is hidden; it is asked for again when it shows, and on taps (some browsers grant it
// only after a user gesture). Returns { held(), release() }.
export function keepAwake({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let sentinel = null;
  let pending = false;
  let on = true;
  const request = async () => {
    if (!on || sentinel || pending || !nav?.wakeLock?.request || doc?.visibilityState === 'hidden') return;
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!on) {
        s.release?.().catch?.(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // not allowed now (no gesture yet, battery saver): the next tap or visibility change retries
    } finally {
      pending = false;
    }
  };
  const onVisible = () => {
    if (doc.visibilityState === 'visible') request();
  };
  doc?.addEventListener?.('visibilitychange', onVisible);
  doc?.addEventListener?.('touchend', request, { passive: true });
  doc?.addEventListener?.('click', request);
  request();
  return {
    held: () => !!sentinel,
    request,
    release() {
      on = false;
      doc?.removeEventListener?.('visibilitychange', onVisible);
      doc?.removeEventListener?.('touchend', request, { passive: true });
      doc?.removeEventListener?.('click', request);
      const s = sentinel;
      sentinel = null;
      s?.release?.().catch?.(() => {});
    },
  };
}

// Fullscreen: whether the page can go fullscreen (not on iPhone Safari), whether it is, and a
// toggle (to be called from a tap).
export function canFullscreen(doc = globalThis.document) {
  const el = doc?.documentElement;
  return !!(el && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (el.requestFullscreen || el.webkitRequestFullscreen));
}

export function isFullscreen(doc = globalThis.document) {
  return !!(doc?.fullscreenElement || doc?.webkitFullscreenElement);
}

export async function toggleFullscreen(doc = globalThis.document) {
  try {
    if (isFullscreen(doc)) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const el = doc.documentElement;
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    }
  } catch {
    // refused (no gesture, not supported): stay as is
  }
}

// No page gestures: pinch or double-tap zoom, scrolling / rubber-banding, text selection,
// long-press menus and drag images. Taps still click (buttons on the code screen).
export function lockGestures(doc = globalThis.document) {
  const stop = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  const active = { passive: false };
  doc.addEventListener('gesturestart', stop, active); // iOS pinch
  doc.addEventListener('gesturechange', stop, active);
  doc.addEventListener('contextmenu', stop);
  doc.addEventListener('selectstart', stop);
  doc.addEventListener('dragstart', stop);
  doc.addEventListener('dblclick', stop);
  // Two fingers anywhere, or a drag outside the controller: never a scroll or a zoom.
  doc.addEventListener('touchmove', stop, active);
}
