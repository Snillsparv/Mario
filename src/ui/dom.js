// Small DOM helpers the UI's screens share (the title card, the game choice, the face screen,
// the phone panel, the touch controller).
//
//   injectStyles(id, css)          // a <style id> with `css` in the head, once per page
//   hasBeenActive() -> bool | null // the page's sticky user activation (a key, click or tap
//                                  // happened, so browsers let audio start); null: unknown

export function injectStyles(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

export function hasBeenActive() {
  const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
  return ua ? !!ua.hasBeenActive : null;
}
