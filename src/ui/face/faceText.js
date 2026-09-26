// The face screen's lines (SMALL_FONT; tests check the glyphs). The bottom line names the
// Start input that fits (keyboard, gamepad, touch controller) and is itself a button that
// starts the game; the line above it tells how to turn and zoom.
export const FACE_HINT = "Drag Jonas's face!  ·  Enter to play";
export const FACE_HINT_PAD = "Drag Jonas's face!  ·  START to play";
export const FACE_HINT_TOUCH = "Drag Jonas's face!  ·  START or tap here to play";
export const FACE_SUBHINT = 'Drag the sky to turn him  ·  wheel to zoom';
export const FACE_SUBHINT_TOUCH = 'Drag the sky to turn him  ·  pinch to zoom';
export const FACE_STRINGS = [FACE_HINT, FACE_HINT_PAD, FACE_HINT_TOUCH, FACE_SUBHINT, FACE_SUBHINT_TOUCH];

// Which hint fits: 'touch' (the on-screen controller shows), 'pad' (a gamepad is connected)
// or 'keys'.
export function hintKind({ touch = false, pad = false } = {}) {
  return touch ? 'touch' : pad ? 'pad' : 'keys';
}

export function hintLines(kind) {
  if (kind === 'touch') return [FACE_HINT_TOUCH, FACE_SUBHINT_TOUCH];
  return [kind === 'pad' ? FACE_HINT_PAD : FACE_HINT, FACE_SUBHINT];
}
