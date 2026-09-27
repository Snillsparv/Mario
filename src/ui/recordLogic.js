// Pure helpers for the video recorder (ui/Recorder.js): no DOM, unit tested in node.
//
//   REC                                  // size, frame rate, bit rates, timeslice, safety limit
//   pickFormat(isTypeSupported, { audio }) -> { mimeType, container, ext, video, audio } | null
//   recordFileName(date, ext)            // 'castle-grounds-2026-09-27-1412.mp4' (local time)
//   inIframe(win), recordSupport(win)    // the recorder's guards: 'iframe' | 'unsupported' | null
//   mapRect(rect, picture, out)          // an on-screen rect -> the 1920x1080 recording's pixels
//   recClock(seconds)                    // 'mm:ss' for the REC indicator
//   parseRadialGradient(css), gradientRadii(g, w, h), parseDropShadow(css)   // CSS-only visuals
//   REC_TEXTS, REC_SMALL_STRINGS         // the recorder's messages (SMALL_FONT glyph coverage)

// The recording: always exactly Full HD, 16:9, whatever the window's size and shape.
export const REC = Object.freeze({
  width: 1920,
  height: 1080,
  aspect: 16 / 9,
  fps: 60,
  videoBitsPerSecond: 16_000_000, // plenty for 1080p60 game footage
  audioBitsPerSecond: 192_000,
  timesliceMs: 1000, // MediaRecorder hands over a chunk every second
  maxSeconds: 600, // safety limit: stop and save after 10 minutes
});

// Container + codecs, most phone-friendly first: MP4 with H.264 and AAC (High, Main, then
// Baseline profile at level 4.2, which covers 1080p60), MP4 with H.264 and Opus (Chrome on
// Linux: H.264 but no AAC encoder), then WebM with VP9 or VP8 and Opus, and last the plain
// container types (the browser's own codecs, e.g. an old Safari's H.264 + AAC).
export const REC_FORMATS = Object.freeze([
  { container: 'mp4', video: 'avc1.64002A', audio: 'mp4a.40.2' },
  { container: 'mp4', video: 'avc1.4D002A', audio: 'mp4a.40.2' },
  { container: 'mp4', video: 'avc1.42E02A', audio: 'mp4a.40.2' },
  { container: 'mp4', video: 'avc1', audio: 'mp4a.40.2' },
  { container: 'mp4', video: 'avc1.64002A', audio: 'opus' },
  { container: 'mp4', video: 'avc1', audio: 'opus' },
  { container: 'webm', video: 'vp9', audio: 'opus' },
  { container: 'webm', video: 'vp8', audio: 'opus' },
  { container: 'mp4', video: null, audio: null },
  { container: 'webm', video: null, audio: null },
]);

// The first format the browser can record. `isTypeSupported(mimeType)` is
// MediaRecorder.isTypeSupported; `audio`: whether the stream has a sound track (without one
// the audio codec is left out of the type).
export function pickFormat(isTypeSupported, { audio = true } = {}) {
  const tried = new Set();
  for (const f of REC_FORMATS) {
    const codecs = [f.video, audio ? f.audio : null].filter(Boolean).join(',');
    const mimeType = `video/${f.container}${codecs ? `;codecs=${codecs}` : ''}`;
    if (tried.has(mimeType)) continue;
    tried.add(mimeType);
    let ok = false;
    try {
      ok = !!isTypeSupported(mimeType);
    } catch {
      ok = false;
    }
    if (ok) return { mimeType, container: f.container, ext: f.container, video: f.video, audio: audio ? f.audio : null };
  }
  return null;
}

const pad2 = (n) => String(n).padStart(2, '0');

// 'castle-grounds-YYYY-MM-DD-HHMM.<ext>' in local time.
export function recordFileName(date = new Date(), ext = 'webm') {
  const d = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `castle-grounds-${d}-${pad2(date.getHours())}${pad2(date.getMinutes())}.${ext}`;
}

// True when the page runs inside a frame (e.g. the sandboxed claude.ai artifact page, where
// downloads are blocked). A window whose top cannot even be compared counts as framed.
export function inIframe(win = globalThis.window) {
  if (!win) return false;
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

// Why recording cannot start here: 'iframe' (downloads blocked: run the game locally),
// 'unsupported' (no MediaRecorder or canvas.captureStream), or null when it can.
export function recordSupport(win = globalThis.window) {
  if (!win) return 'unsupported';
  if (inIframe(win)) return 'iframe';
  const canvasProto = win.HTMLCanvasElement?.prototype;
  if (typeof win.MediaRecorder !== 'function' || typeof canvasProto?.captureStream !== 'function') return 'unsupported';
  if (typeof win.MediaRecorder.isTypeSupported !== 'function') return 'unsupported';
  return null;
}

// Map an element's on-screen rect (client px) into the recording: `picture` is the game
// picture's rect (the WebGL canvas, 16:9 while recording), which fills the whole
// width x height recording. Writes { x, y, w, h } into `out` (reused: no allocation).
export function mapRect(rect, picture, out = {}, width = REC.width, height = REC.height) {
  const sx = width / picture.width;
  const sy = height / picture.height;
  out.x = (rect.left - picture.left) * sx;
  out.y = (rect.top - picture.top) * sy;
  out.w = rect.width * sx;
  out.h = rect.height * sy;
  return out;
}

// 'mm:ss' (minutes keep counting past 59).
export function recClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

// Split at top-level commas (not inside parentheses).
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

const POSITION_WORDS = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
const COLOR_START = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|^#|^[a-z]+$/i;

// A computed CSS `radial-gradient(...)` (as getComputedStyle serialises it, e.g.
// 'radial-gradient(at 50% 45%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 24, 0.4) 100%)') ->
// { cx, cy (fractions of the box), circle, stops: [[offset 0..1, colour]] }, or null for
// anything else (other gradient kinds, explicit sizes, several layers).
export function parseRadialGradient(css) {
  const m = /^\s*radial-gradient\((.*)\)\s*$/i.exec(css ?? '');
  if (!m) return null;
  const parts = splitTop(m[1]);
  let cx = 0.5;
  let cy = 0.5;
  let circle = false;
  const head = parts[0];
  const first = head.split(/\s+/)[0];
  if (!COLOR_START.test(first) || /^(circle|ellipse|at|closest|farthest)/i.test(first)) {
    parts.shift();
    const words = head.toLowerCase().split(/\s+/);
    const at = words.indexOf('at');
    // Only the default size (farthest-corner) is drawn.
    const shape = at >= 0 ? words.slice(0, at) : words;
    if (shape.some((w) => w !== 'circle' && w !== 'ellipse' && w !== 'farthest-corner')) return null;
    circle = shape.includes('circle');
    if (at >= 0) {
      const pos = words.slice(at + 1);
      const val = (w) => (w in POSITION_WORDS ? POSITION_WORDS[w] : w.endsWith('%') ? parseFloat(w) / 100 : NaN);
      let [x, y] = pos;
      // One keyword that only makes sense vertically ('at top') sets y.
      if (pos.length === 1 && (x === 'top' || x === 'bottom')) [x, y] = ['center', x];
      if (pos.length >= 2 && (x === 'top' || x === 'bottom' || y === 'left' || y === 'right')) [x, y] = [y, x];
      cx = val(x ?? 'center');
      cy = val(y ?? 'center');
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    }
  }
  if (parts.length < 2) return null;
  const stops = [];
  for (const part of parts) {
    const pm = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(part);
    const color = pm[1].trim();
    if (!color || !COLOR_START.test(color)) return null;
    stops.push([pm[2] === undefined ? null : parseFloat(pm[2]) / 100, color]);
  }
  // Stops without a position spread evenly between their neighbours (first 0, last 1).
  if (stops[0][0] === null) stops[0][0] = 0;
  if (stops[stops.length - 1][0] === null) stops[stops.length - 1][0] = 1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i][0] !== null) {
      stops[i][0] = Math.max(stops[i][0], stops[i - 1][0]);
      continue;
    }
    let j = i;
    while (stops[j][0] === null) j++;
    const a = stops[i - 1][0];
    const b = stops[j][0];
    for (let k = i; k < j; k++) stops[k][0] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  for (const s of stops) s[0] = Math.min(1, Math.max(0, s[0]));
  return { cx, cy, circle, stops };
}

// The ending shape's radii of a `farthest-corner` radial gradient (CSS's default size) in a
// w x h box: an ellipse keeps the farthest-side proportions and passes through the corner.
export function gradientRadii(g, w, h) {
  const dx = Math.max(g.cx, 1 - g.cx) * w;
  const dy = Math.max(g.cy, 1 - g.cy) * h;
  if (g.circle) {
    const r = Math.hypot(dx, dy);
    return { rx: r, ry: r };
  }
  return { rx: dx * Math.SQRT2, ry: dy * Math.SQRT2 };
}

// A computed CSS `filter` holding one drop-shadow (e.g. the title logo's
// 'drop-shadow(rgba(0, 0, 30, 0.35) 0px 9px 6px)') -> { color, x, y, blur } in CSS px, or null.
export function parseDropShadow(css) {
  const m = /^\s*drop-shadow\((.*)\)\s*$/i.exec(css ?? '');
  if (!m) return null;
  const body = m[1];
  const color = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b)/i.exec(body)?.[1] ?? 'rgba(0, 0, 0, 1)';
  const lengths = body
    .replace(color, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (/^-?[\d.]+(px)?$/.test(w) ? parseFloat(w) : NaN))
    .filter(Number.isFinite);
  if (lengths.length < 2) return null;
  return { color, x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0 };
}

// What the recorder says (SMALL_FONT, see REC_SMALL_STRINGS).
export const REC_TEXTS = Object.freeze({
  iframe: Object.freeze([
    'Video recording is not available here',
    'It works when the game runs on your own computer',
    '(npm run dev or npm run preview)',
  ]),
  unsupported: Object.freeze(['Video recording is not supported in this browser']),
  failed: Object.freeze(['Recording failed: nothing was saved']),
  limit: 'Stopped at the 10 minute limit',
  saved: 'Saved',
  rec: 'REC',
});

// Every string the recorder draws, for the glyph-coverage test (a file name adds only
// lower-case letters, digits, '-' and '.').
export const REC_SMALL_STRINGS = [
  ...REC_TEXTS.iframe,
  ...REC_TEXTS.unsupported,
  ...REC_TEXTS.failed,
  REC_TEXTS.limit,
  `${REC_TEXTS.saved} castle-grounds-2026-09-27-1412.mp4 webm`,
  `${REC_TEXTS.rec} 0123456789:`,
];
