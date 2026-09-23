// Pure screen-geometry helpers for the N64 renderer. No DOM access, so they are unit
// testable in node.

// Aspect of the optional pillarboxed frame (a 4:3 CRT picture).
export const PILLARBOX_ASPECT = 4 / 3;

// Upper bound for the internal render width (ultra-wide windows).
const MAX_INTERNAL_WIDTH = 2048;

// Largest rectangle with the given aspect ratio centred in width x height (CSS pixels,
// integers). With no aspect the rectangle fills the whole area.
export function fitViewport(width, height, aspect = null) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (!aspect) return { x: 0, y: 0, width: w, height: h };
  let vw = w;
  let vh = h;
  if (w / h > aspect) vw = Math.max(1, Math.round(h * aspect));
  else vh = Math.max(1, Math.round(w / aspect));
  return { x: Math.floor((w - vw) / 2), y: Math.floor((h - vh) / 2), width: vw, height: vh };
}

// Inline style placing a fixed-position overlay exactly over viewport vp (CSS pixels,
// relative to a container that fills the window).
export function overlayStyle(vp) {
  return {
    left: `${vp.x}px`,
    top: `${vp.y}px`,
    width: `${vp.width}px`,
    height: `${vp.height}px`,
    right: 'auto',
    bottom: 'auto',
  };
}

// Low render resolution used in N64 mode: `targetHeight` scanlines (never more than the
// viewport itself has), width following the viewport's aspect ratio.
export function internalResolution(viewWidth, viewHeight, targetHeight) {
  const vw = Math.max(1, viewWidth);
  const vh = Math.max(1, viewHeight);
  const height = Math.max(1, Math.min(Math.round(targetHeight), Math.round(vh)));
  const width = Math.max(1, Math.min(Math.round((height * vw) / vh), MAX_INTERNAL_WIDTH));
  return { width, height };
}

// Normalised n x n ordered-dither (Bayer) matrix, row-major, thresholds centred on zero
// in [-0.5, 0.5). n must be a power of two.
export function bayerMatrix(n) {
  let m = [0];
  for (let size = 1; size < n; size *= 2) {
    const next = new Array(size * 2 * size * 2);
    for (let y = 0; y < size * 2; y++) {
      for (let x = 0; x < size * 2; x++) {
        // Each quadrant is the smaller matrix offset by the 2x2 base pattern [[0,2],[3,1]].
        const quadrant = [0, 2, 3, 1][(y >= size ? 2 : 0) + (x >= size ? 1 : 0)];
        next[y * size * 2 + x] = 4 * m[(y % size) * size + (x % size)] + quadrant;
      }
    }
    m = next;
  }
  const count = n * n;
  return m.map((v) => (v + 0.5) / count - 0.5);
}
