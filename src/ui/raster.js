// Canvas helpers that turn bitmap glyphs and icons into crisp sprites at any (fractional)
// scale. Every source pixel covers device pixels [round(i*px), round((i+1)*px)), so edges stay
// sharp while the whole thing scales smoothly with the viewport. DOM is touched only when a
// function is called, never at import time.

import { glyphOf, measureText, advanceOf, digitInset } from './bitmapFont.js';

// Text styles: vertical gradient stops for the fill, outline and drop-shadow colours.
export const TEXT_STYLES = {
  gold: {
    stops: [[0, '#ffffff'], [0.3, '#fff6b8'], [0.62, '#ffcf3a'], [1, '#f08c12']],
    outline: '#241004',
    shadow: 'rgba(20,8,0,0.55)',
  },
  red: {
    stops: [[0, '#ffffff'], [0.3, '#ffc8b8'], [0.62, '#ff5a3a'], [1, '#c81414']],
    outline: '#2a0404',
    shadow: 'rgba(30,0,0,0.55)',
  },
  white: {
    stops: [[0, '#ffffff'], [0.7, '#f4f4ff'], [1, '#c8d0f0']],
    outline: '#101024',
    shadow: 'rgba(0,0,20,0.5)',
  },
  key: {
    stops: [[0, '#fffbe0'], [0.5, '#ffe070'], [1, '#f0b020']],
    outline: '#241004',
    shadow: 'rgba(20,8,0,0.5)',
  },
};

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const edge = (i, px) => Math.round(i * px);

// Fill source pixel (x, y) of a grid drawn at `px` device pixels per source pixel.
function fillCell(ctx, x, y, px) {
  const x0 = edge(x, px);
  const y0 = edge(y, px);
  ctx.fillRect(x0, y0, edge(x + 1, px) - x0, edge(y + 1, px) - y0);
}

// Build { back, front, ox, oy } for a w×h bitmap. `filled(x, y)` says whether a pixel is set,
// `paint(ctx, x, y)` sets the fill style for it (palette icons), or `stops` gives a
// vertical gradient for the whole fill (text). The back layer holds the 1-pixel outline
// (8-neighbour dilation) and a drop shadow offset by one pixel; ox/oy is the offset of the
// sprite's origin relative to the bitmap's top-left, in device pixels (negative).
function buildSprite(w, h, filled, px, style, paint) {
  const pad = 1;
  const sh = style.shadow ? 1 : 0;
  const W = w + 2 * pad + sh;
  const H = h + 2 * pad + sh;
  const dilated = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx >= 0 && sy >= 0 && sx < w && sy < h && filled(sx, sy)) return true;
      }
    }
    return false;
  };

  const back = makeCanvas(edge(W, px), edge(H, px));
  const bctx = back.getContext('2d');
  const layers = sh ? [[style.shadow, sh], [style.outline, 0]] : [[style.outline, 0]];
  for (const [color, off] of layers) {
    bctx.fillStyle = color;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) if (dilated(x, y)) fillCell(bctx, x + pad + off, y + pad + off, px);
    }
  }

  const front = makeCanvas(edge(W, px), edge(H, px));
  const fctx = front.getContext('2d');
  fctx.fillStyle = '#fff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      if (paint) paint(fctx, x, y);
      fillCell(fctx, x + pad, y + pad, px);
    }
  }
  if (style.stops) {
    const g = fctx.createLinearGradient(0, edge(pad, px), 0, edge(pad + h, px));
    for (const [t, c] of style.stops) g.addColorStop(t, c);
    fctx.globalCompositeOperation = 'source-in';
    fctx.fillStyle = g;
    fctx.fillRect(0, 0, front.width, front.height);
    fctx.globalCompositeOperation = 'source-over';
  }
  return { back, front, ox: -edge(pad, px), oy: -edge(pad, px) };
}

// Sprites are cached per (font/icon, style, device pixel size).
export class SpriteCache {
  constructor() {
    this.map = new Map();
  }

  clear() {
    this.map.clear();
  }

  glyph(font, ch, styleName, px) {
    const key = `g|${font.name}|${ch}|${styleName}|${px}`;
    let s = this.map.get(key);
    if (!s) {
      const g = glyphOf(font, ch);
      if (!g) return null;
      s = buildSprite(g.w, g.h, (x, y) => g.bits[y * g.w + x] === 1, px, TEXT_STYLES[styleName]);
      this.map.set(key, s);
    }
    return s;
  }

  icon(icon, name, px, outline = '#1a0c04') {
    const key = `i|${name}|${px}|${outline}`;
    let s = this.map.get(key);
    if (!s) {
      const at = (x, y) => icon.rows[y][x];
      s = buildSprite(
        icon.w,
        icon.h,
        (x, y) => at(x, y) !== '.',
        px,
        { outline, shadow: 'rgba(0,0,0,0.4)' },
        (ctx, x, y) => {
          ctx.fillStyle = icon.palette[at(x, y)];
        },
      );
      this.map.set(key, s);
    }
    return s;
  }
}

// Width of `text` in device pixels (no outline) at `px` device pixels per font pixel.
export function textWidth(font, text, px, fixedDigits = false) {
  return Math.round(measureText(font, text, fixedDigits) * px);
}

// Draw `text` with its top-left glyph box at device (x, y). Back layers (shadow + outline)
// of every glyph are drawn before the fills so neighbouring outlines never cut into letters.
// opts: { style, px, align: 'left'|'center'|'right', fixedDigits }.
export function drawText(ctx, cache, font, text, x, y, opts) {
  const { style = 'gold', px, align = 'left', fixedDigits = false } = opts;
  const width = textWidth(font, text, px, fixedDigits);
  let x0 = x;
  if (align === 'center') x0 = x - width / 2;
  else if (align === 'right') x0 = x - width;
  x0 = Math.round(x0);
  y = Math.round(y);
  const placed = [];
  let pen = 0;
  for (const ch of text) {
    const g = glyphOf(font, ch);
    if (!g) continue;
    const inset = digitInset(font, ch, g, fixedDigits);
    if (ch !== ' ') placed.push([cache.glyph(font, ch, style, px), x0 + Math.round((pen + inset) * px)]);
    pen += advanceOf(font, ch, g, fixedDigits);
  }
  for (const [s, gx] of placed) ctx.drawImage(s.back, gx + s.ox, y + s.oy);
  for (const [s, gx] of placed) ctx.drawImage(s.front, gx + s.ox, y + s.oy);
}

// Draw an icon sprite with its top-left pixel at device (x, y).
export function drawIcon(ctx, cache, icon, name, x, y, px) {
  const s = cache.icon(icon, name, px);
  x = Math.round(x);
  y = Math.round(y);
  ctx.drawImage(s.back, x + s.ox, y + s.oy);
  ctx.drawImage(s.front, x + s.ox, y + s.oy);
}

// Render a whole string into its own canvas (title screen labels). Returns the canvas;
// its size includes the outline and shadow.
export function textCanvas(font, text, px, style) {
  const cache = new SpriteCache();
  const pad = Math.ceil(px * 2);
  const c = makeCanvas(textWidth(font, text, px) + pad * 2, Math.round(font.height * px) + pad * 2);
  drawText(c.getContext('2d'), cache, font, text, pad, pad, { style, px });
  return c;
}
