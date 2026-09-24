// Sign dialog logic without the DOM (DialogBox.js draws it): text clean-up, word wrap,
// pagination into box-sized screens, the box metrics, and the typing / paging state machine
// the box runs at 30 Hz.
//
// A sign's pages are wrapped to the box width; a page taller than BOX.maxLines lines is split
// into several screens (narrow phone screens), so the player always pages through screens.
//
//   const logic = new DialogLogic({ sfx: (name) => ..., onClose: () => ... });
//   logic.open(paginate(sign.pages, { wrap, maxLines }));   // sfx 'dialog_open'
//   logic.tick(pressed);   // 30 Hz: types TYPING.charsPerTick characters, or handles a press:
//                          // typing -> the screen completes; complete -> next screen
//                          // (sfx 'dialog_next') or, after the last one, closes
//                          // (sfx 'dialog_close', then onClose())
//   logic.relayout(screens) // new wrap after a resize: keeps the reading position

import { SMALL_FONT, glyphOf, measureText } from './bitmapFont.js';

export const DIALOG_FONT = SMALL_FONT;

// Typing speed and sound, in 30 Hz ticks. Spaces cost nothing; a sentence mark followed by a
// space pauses the typing briefly; a soft 'text_blip' plays on the first character and then
// at most every blipMinTicks ticks, once blipEvery more characters appeared.
export const TYPING = {
  charsPerTick: 2,
  openTicks: 3, // the box grows in before the first character
  blipEvery: 4,
  blipMinTicks: 3, // <= 10 blips per second
  pauses: { '.': 5, '!': 5, '?': 5, ',': 2, ':': 3, ';': 3 },
};

// Box geometry in HUD logical px (the HUD's 320x240 grid, see hudMetrics). The text is drawn
// TEXT_SCALE times the HUD's small-font size, snapped to whole device pixels (snapPx).
//
// Placement: the box sits in the upper part of the picture, like the late-90s games, because
// the follow camera frames the reader and the sign in the lower-middle (measured at 960x540:
// the board's top edge at 57-62% of the picture height, Pip below it, depending on the camera
// mode). Its top is BOX.top HUD px down (in the HUD's own scale: just under the counters row
// and the power meter, which reaches y 70 while it pulses); a box that would reach below
// BOX.clear of the picture height rises, but never over the counters row (BOX.topMin). See
// boxTop().
export const BOX = {
  width: 272, // preferred width
  minWidth: 196, // narrow screens: the box narrows down to this before the text shrinks
  maxFrac: 0.94, // at most this share of the picture width
  minScale: 1.6, // CSS px per logical px at least (phones), so the text stays readable
  padX: 12,
  padY: 9,
  top: 72, // HUD px: preferred box top, under the HUD row and the power meter
  topMin: 34, // HUD px: the box never rises over the counters row (as the pause stack)
  clear: 0.62, // share of the picture height: the box ends above it (hero and sign below)
  edge: 6, // gap to the picture's bottom edge on tiny pictures
  radius: 6,
  lineH: 12, // font rows per text line (9-row glyphs + 3)
  minLines: 2,
  maxLines: 4,
};
export const TEXT_SCALE = 1.2;

const REPLACE = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '`': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '…': '...',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  '\t': ' ',
  '\r': '',
};

// Text the dialog font can draw: typographic quotes, dashes and ellipses become their plain
// forms, accents are dropped (é -> e), other unknown characters are left out; spaces before
// a line break and around the page are trimmed.
export function normalizeText(text, font = DIALOG_FONT) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    let c = REPLACE[ch] ?? ch;
    if (c !== '\n' && c !== ' ' && c !== '' && !glyphOf(font, c)) {
      const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      c = base && [...base].every((x) => glyphOf(font, x)) ? base : '';
    }
    out += c;
  }
  return out.replace(/ +\n/g, '\n').trim();
}

const measureDefault = (t) => measureText(DIALOG_FONT, t);

// Greedy word wrap of `text` to `maxWidth` font px. '\n' breaks a line; a word wider than
// the line is broken between letters. Returns [{ text, start }] (start: offset in `text`).
export function wrapText(text, maxWidth, measure = measureDefault) {
  const lines = [];
  let pos = 0;
  for (const para of text.split('\n')) {
    let line = null; // { start, end } offsets into text
    const words = /[^ ]+/g;
    let m;
    while ((m = words.exec(para))) {
      let ws = pos + m.index;
      let word = m[0];
      if (line && measure(text.slice(line.start, ws + word.length)) <= maxWidth) {
        line.end = ws + word.length;
        continue;
      }
      if (line) lines.push(line);
      while (word.length > 1 && measure(word) > maxWidth) {
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n)) > maxWidth) n--;
        lines.push({ start: ws, end: ws + n });
        ws += n;
        word = word.slice(n);
      }
      line = { start: ws, end: ws + word.length };
    }
    lines.push(line ?? { start: pos, end: pos }); // an empty paragraph is a blank line
    pos += para.length + 1;
  }
  return lines.map(({ start, end }) => ({ text: text.slice(start, end), start }));
}

// A screen: { page, text, lines: [{ text, start }], flat, ends, length }. `flat` is the
// lines' characters in reading order (line breaks left out), `ends[i]` the flat length up
// to the end of line i.
function makeScreen(page, text, lines) {
  const ends = [];
  let n = 0;
  for (const l of lines) ends.push((n += l.text.length));
  return { page, text, lines, flat: lines.map((l) => l.text).join(''), ends, length: n };
}

// Wrap every page to `wrap` font px and cut pages taller than maxLines into several screens.
export function paginate(pages, { wrap, maxLines = BOX.maxLines, measure = measureDefault } = {}) {
  const screens = [];
  (pages ?? []).forEach((raw, page) => {
    const text = normalizeText(raw);
    const lines = wrapText(text, wrap, measure);
    for (let i = 0; i < lines.length; i += maxLines) screens.push(makeScreen(page, text, lines.slice(i, i + maxLines)));
  });
  return screens;
}

// Lines the box shows for a set of screens: the tallest screen, within BOX limits (the box
// keeps one height for a whole sign).
export function boxLines(screens) {
  const most = Math.max(0, ...screens.map((s) => s.lines.length));
  return Math.min(BOX.maxLines, Math.max(BOX.minLines, most));
}

// Device px per font pixel for a wanted (fractional) size: whole device pixels, so every font
// pixel is drawn the same size (at most half a device pixel off the wanted size).
export function snapPx(px) {
  return Math.max(1, Math.round(px));
}

// Box metrics for a picture of cssW x cssH CSS px at `dpr` device px per CSS px. The box
// scales with the picture like the HUD; on small screens (phones) the scale is raised to
// BOX.minScale and the box narrows instead, so the text stays readable. The wrap width is
// set in font pixels from the logical box width, so the lines break the same way at every
// resolution; the box then hugs the text at the snapped font size (a few % wider or
// narrower than BOX.width), never wider than BOX.maxFrac of the picture.
// Device px: w (box width), padX, padY, lineH, radius, fp (px per font pixel), H (picture
// height), top / topMin / clearY / edge (placement, see boxTop); wrap (text width in font
// px); s = CSS px and u = device px per logical px; hud = device px per HUD px.
export function dialogMetrics(cssW, cssH, dpr = 1) {
  const hud = Math.max(0.5, Math.min(cssH / 240, cssW / 320));
  const fitW = (cssW * BOX.maxFrac) / BOX.minWidth;
  const s = Math.max(hud, Math.min(BOX.minScale, fitW, cssH / 150));
  const u = s * dpr;
  const fp = snapPx(u * TEXT_SCALE);
  const maxW = (cssW * BOX.maxFrac) / s; // logical
  const boxW = Math.min(BOX.width, maxW);
  const padX = Math.round(BOX.padX * u);
  const padY = Math.round(BOX.padY * u);
  const gap = Math.round(u); // kept clear of the page marker
  const wrap = Math.floor(Math.min((boxW - 2 * BOX.padX - 1) / TEXT_SCALE, (maxW * u - 2 * padX - gap) / fp));
  return {
    s,
    u,
    dpr,
    fp,
    w: Math.round(wrap * fp) + 2 * padX + gap,
    padX,
    padY,
    lineH: Math.round(BOX.lineH * fp),
    radius: BOX.radius * u,
    wrap,
    hud: hud * dpr,
    H: cssH * dpr,
    top: Math.round(BOX.top * hud * dpr),
    topMin: Math.round(BOX.topMin * hud * dpr),
    clearY: Math.floor(BOX.clear * cssH * dpr),
    edge: Math.round(BOX.edge * u),
  };
}

// Top of an `h` device px tall box (device px from the picture top): under the HUD row and
// the power meter; a taller box rises so it ends above the hero's part of the picture
// (clearY), but never over the counters row; on a tiny picture it stays on screen.
export function boxTop(m, h) {
  let y = Math.min(m.top, m.clearY - h);
  y = Math.max(y, m.topMin);
  y = Math.min(y, m.H - m.edge - h);
  return Math.round(Math.max(0, y));
}

// Box height in device px for `lines` text lines.
export function boxHeight(m, lines) {
  return 2 * m.padY + (lines - 1) * m.lineH + Math.round(DIALOG_FONT.height * m.fp);
}

// Offset into the page text of the reading position `count` characters into `screen`.
function offsetIn(screen, count) {
  let n = count;
  for (const l of screen.lines) {
    if (n <= l.text.length) return l.start + n;
    n -= l.text.length;
  }
  const last = screen.lines[screen.lines.length - 1];
  return last.start + last.text.length;
}

// Characters of `screen` before page offset `offset`.
function countBefore(screen, offset) {
  let n = 0;
  for (const l of screen.lines) n += Math.max(0, Math.min(l.text.length, offset - l.start));
  return n;
}

const screenEnd = (s) => offsetIn(s, s.length);

const EMPTY_SCREEN = makeScreen(0, '', [{ text: '', start: 0 }]);

export class DialogLogic {
  constructor({ sfx = () => {}, onClose = () => {}, typing = TYPING } = {}) {
    this.sfx = sfx;
    this.onClose = onClose;
    this.typing = typing;
    this.isOpen = false;
    this.screens = [EMPTY_SCREEN];
    this.index = 0;
    this.count = 0; // characters shown on the current screen
    this.wait = 0; // ticks before typing (continues)
    this.blipChars = 0;
    this.blipTicks = Infinity;
  }

  get screen() {
    return this.screens[this.index];
  }

  get complete() {
    return this.count >= this.screen.length;
  }

  get isLast() {
    return this.index >= this.screens.length - 1;
  }

  open(screens) {
    this.screens = screens?.length ? screens : [EMPTY_SCREEN];
    this.index = 0;
    this.isOpen = true;
    this._begin(this.typing.openTicks);
    this.sfx('dialog_open');
  }

  // Closes at once, without a sound (the game took the screen away).
  close() {
    this.isOpen = false;
  }

  // One 30 Hz tick; `pressed`: A or B went down this tick. Returns what the press did
  // ('complete' | 'next' | 'close') or null.
  tick(pressed) {
    if (!this.isOpen) return null;
    this.blipTicks++;
    if (pressed) return this.press();
    this._type();
    return null;
  }

  press() {
    if (!this.isOpen) return null;
    if (!this.complete) {
      this.count = this.screen.length;
      this.wait = 0;
      return 'complete';
    }
    if (!this.isLast) {
      this.index++;
      this._begin(0);
      this.sfx('dialog_next');
      return 'next';
    }
    this.isOpen = false;
    this.sfx('dialog_close');
    this.onClose();
    return 'close';
  }

  // Swap in screens wrapped for a new box size, keeping the reading position: the text
  // already shown stays shown (a screen that grew may continue typing where it was).
  relayout(screens) {
    if (!screens?.length) return;
    const cur = this.screen;
    const at = offsetIn(cur, this.count);
    let i = screens.findIndex((s) => s.page === cur.page && screenEnd(s) >= at);
    if (i < 0) i = Math.max(0, screens.findLastIndex((s) => s.page <= cur.page));
    // A fresh screen whose start the old layout reached exactly: start that screen, not the end
    // of the one before it.
    if (this.count === 0 && screenEnd(screens[i]) === at && screens[i + 1]?.page === cur.page) i++;
    this.screens = screens;
    this.index = i;
    this.count = Math.min(screens[i].length, countBefore(screens[i], at));
  }

  _begin(wait) {
    this.count = 0;
    this.wait = wait;
    this.blipChars = 0;
    this.blipTicks = Infinity; // the first character always blips
  }

  _type() {
    if (this.complete) return;
    if (this.wait > 0) {
      this.wait--;
      return;
    }
    const { flat, ends } = this.screen;
    const { charsPerTick, pauses, blipEvery, blipMinTicks } = this.typing;
    let budget = charsPerTick;
    while (budget > 0 && this.count < flat.length) {
      const ch = flat[this.count++];
      if (ch === ' ') continue;
      budget--;
      this.blipChars++;
      const pause = pauses[ch];
      if (pause && this.count < flat.length && (flat[this.count] === ' ' || ends.includes(this.count))) {
        this.wait = pause;
        break;
      }
    }
    // Swallow the spaces after the last character typed, so a line never waits on them.
    while (this.count < flat.length && flat[this.count] === ' ') this.count++;
    const first = this.blipTicks === Infinity;
    if (this.blipChars > 0 && (first || (this.blipChars >= blipEvery && this.blipTicks >= blipMinTicks))) {
      this.blipChars = 0;
      this.blipTicks = 0;
      this.sfx('text_blip');
    }
  }
}
