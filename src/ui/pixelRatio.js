// Device-pixel-ratio changes without a CSS size change (the window moved to a monitor with
// another scale) resize nothing in CSS px, so a ResizeObserver never reports them. Overlays
// drawn at device resolution (HUD, title card, GAME OVER card) re-layout on them: the HUD and
// the title compare the ratio every frame (they run a frame loop anyway); the GAME OVER card,
// which has no loop, uses watchPixelRatio().
//
//   const stop = watchPixelRatio((dpr) => relayout());   // after every change
//   stop();
//
// A `(resolution: <current>dppx)` media query stops matching when the ratio changes; the
// query is then re-armed at the new ratio. `win` is injectable for tests. Without matchMedia
// it does nothing.

export function pixelRatio(win = globalThis.window) {
  return win?.devicePixelRatio || 1;
}

export function watchPixelRatio(fn, win = globalThis.window) {
  if (typeof win?.matchMedia !== 'function') return () => {};
  let query = null;
  const onChange = () => {
    arm();
    fn(pixelRatio(win));
  };
  const disarm = () => {
    query?.removeEventListener?.('change', onChange);
    query = null;
  };
  const arm = () => {
    disarm();
    const dpr = pixelRatio(win);
    // The -webkit- form covers Safari before 16 (no `resolution` media feature).
    query = win.matchMedia(`(resolution: ${dpr}dppx), (-webkit-device-pixel-ratio: ${dpr})`);
    query?.addEventListener?.('change', onChange);
  };
  arm();
  return disarm;
}
