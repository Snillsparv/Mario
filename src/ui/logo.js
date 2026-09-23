// Chunky, bevelled, extruded title lettering generated from the BIG_FONT bitmaps.
// Each glyph's pixels are blended into a smooth field (rounded corners), then shaded like
// a pillow-bevelled plastic letter lit from the top-left, outlined, and extruded downwards.
// Canvas-only: no web fonts, so the logo looks identical on every platform. Runs on the
// main thread and in logoWorker.js (full-resolution renders), so it never needs the DOM.

import { glyphOf, BIG_FONT } from './bitmapFont.js';
import { makeCanvas } from './raster.js';

// A DOM canvas on the main thread, an OffscreenCanvas in the worker.
function surface(w, h) {
  if (typeof document !== 'undefined') return makeCanvas(w, h);
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

const ROUND = 0.8; // half-width of the smoothing (rounds corners, melts pixel stair-steps)
const BEVEL = 1.5; // bevel steepness (1 = 45 degrees at the edge)
const LIGHT = normalize([-0.55, -0.75, 0.62]); // screen space, y down, z towards the viewer
const OUTLINE = [26, 12, 4];
// Extra blur of the coverage field (radius in font pixels of each of two box passes) and
// the specular exponent. Two passes make a tent kernel whose smooth slopes, with a soft
// highlight, keep the kernel's font-pixel kinks from showing as stripes on the faces.
const BLUR = 0.35;
const SPECULAR = 12;

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// One font pixel's box, blurred by a ROUND-wide uniform kernel, along one axis. Blurred
// boxes still sum to exactly 1 inside solid areas, so the 0.5 level is a smoothed outline.
function soft(d) {
  return Math.max(0, Math.min(0.5, d + ROUND) - Math.max(-0.5, d - ROUND)) / (2 * ROUND);
}
const REACH = Math.ceil(ROUND + 0.5); // neighbouring font pixels that can touch a sample
const TAPS = 2 * REACH + 1;

// soft() weights along one axis: for device pixel p, font pixel first[p] + k has weight
// w[p * TAPS + k]. The field kernel is separable, so rows and columns share these tables.
function axisWeights(n, cell, margin) {
  const first = new Int32Array(n);
  const w = new Float32Array(n * TAPS);
  for (let p = 0; p < n; p++) {
    const u = (p + 0.5) / cell - margin;
    first[p] = Math.floor(u) - REACH;
    for (let k = 0; k < TAPS; k++) w[p * TAPS + k] = soft(u - (first[p] + k + 0.5));
  }
  return { first, w };
}

// Smoothed coverage field (0..1) of a glyph at `cell` device px per font pixel.
function glyphField(glyph, W, H, cell, margin) {
  const xs = axisWeights(W, cell, margin);
  const ys = axisWeights(H, cell, margin);
  // Horizontal pass: each glyph row convolved along x.
  const rows = new Float32Array(glyph.h * W);
  for (let j = 0; j < glyph.h; j++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = 0; k < TAPS; k++) {
        const i = xs.first[x] + k;
        if (i >= 0 && i < glyph.w && glyph.bits[j * glyph.w + i]) sum += xs.w[x * TAPS + k];
      }
      rows[j * W + x] = sum;
    }
  }
  // Vertical pass.
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < TAPS; k++) {
      const j = ys.first[y] + k;
      const wy = ys.w[y * TAPS + k];
      if (j < 0 || j >= glyph.h || !wy) continue;
      for (let x = 0; x < W; x++) field[y * W + x] += rows[j * W + x] * wy;
    }
    for (let x = 0; x < W; x++) field[y * W + x] = Math.min(1, field[y * W + x]);
  }
  return field;
}

// Separable box blur (radius r px, running sums) that smooths the kinks the per-pixel
// kernel leaves at font-pixel boundaries, so the bevel shading has no visible facets.
function blurField(field, W, H, r) {
  if (r < 1) return;
  const tmp = new Float32Array(field.length);
  const norm = 1 / (2 * r + 1);
  const pass = (src, dst, len, count, stride, step) => {
    const at = (base, i) => src[base + Math.min(len - 1, Math.max(0, i)) * step];
    for (let k = 0; k < count; k++) {
      const base = k * stride;
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += at(base, d);
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = sum * norm;
        sum += at(base, i + r + 1) - at(base, i - r);
      }
    }
  };
  pass(field, tmp, W, H, W, 1); // rows
  pass(tmp, field, H, W, 1, W); // columns
}

// Build the three layers for one glyph at `cell` device px per font pixel:
// face (shaded letter + outline), side (letter silhouette in the extrusion colour),
// rim (outline silhouette used behind the extrusion). Returns { face, side, rim, w, h, m }.
function letterLayers(glyph, cell, color) {
  const m = 1; // margin in font pixels for the outline
  const W = Math.ceil((glyph.w + 2 * m) * cell);
  const H = Math.ceil((glyph.h + 2 * m) * cell);
  const field = glyphField(glyph, W, H, cell, m);
  const blur = Math.round(cell * BLUR);
  blurField(field, W, H, blur);
  blurField(field, W, H, blur);

  const ramp = 2 * ROUND * cell; // field units -> device pixels across the edge
  const outlineT = 0.5 - (0.35 * cell) / ramp; // field level of the outline's outer edge
  const base = hexToRgb(color);
  const top = mix(base, [255, 255, 255], 0.45);
  const bottom = mix(base, [0, 0, 0], 0.25);
  const sideRgb = mix(base, [20, 0, 10], 0.55);
  const [lx, ly, lz] = LIGHT;
  const slope = (ramp * BEVEL) / 2; // central difference -> surface slope

  const layers = ['face', 'side', 'rim'].map(() => surface(W, H));
  const data = layers.map((c) => c.getContext('2d').createImageData(W, H));
  const [face, side, rim] = data.map((d) => d.data);
  const F = (x, y) => field[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  for (let y = 0; y < H; y++) {
    const vy = clamp01(y / H);
    const grad = vy < 0.55 ? mix(top, base, vy / 0.55) : mix(base, bottom, (vy - 0.55) / 0.45);
    for (let x = 0; x < W; x++) {
      const f = field[y * W + x];
      const outer = clamp01((f - outlineT) * ramp + 0.5); // letter + outline coverage
      if (outer <= 0) continue;
      const inner = clamp01((f - 0.5) * ramp + 0.5); // letter coverage (anti-aliased)
      const i = (y * W + x) * 4;
      rim[i] = OUTLINE[0];
      rim[i + 1] = OUTLINE[1];
      rim[i + 2] = OUTLINE[2];
      rim[i + 3] = outer * 255;
      face[i + 3] = outer * 255;
      if (inner <= 0) {
        face[i] = OUTLINE[0];
        face[i + 1] = OUTLINE[1];
        face[i + 2] = OUTLINE[2];
        continue;
      }
      // Bevel: the field rises from the edge over `ramp` pixels; its slope tilts the normal
      // (-gx, -gy, 1), lit by LIGHT with a little specular.
      const gx = (F(x + 1, y) - F(x - 1, y)) * slope;
      const gy = (F(x, y + 1) - F(x, y - 1)) * slope;
      const diffuse = (lz - gx * lx - gy * ly) / Math.sqrt(gx * gx + gy * gy + 1);
      const light = 255 * Math.pow(clamp01(diffuse), SPECULAR) * 0.6;
      const shade = 0.42 + 0.72 * diffuse;
      for (let c = 0; c < 3; c++) {
        const lit = Math.min(255, grad[c] * shade + light);
        face[i + c] = OUTLINE[c] + (lit - OUTLINE[c]) * inner;
      }
      side[i] = sideRgb[0];
      side[i + 1] = sideRgb[1];
      side[i + 2] = sideRgb[2];
      side[i + 3] = inner * 255;
    }
  }
  layers.forEach((c, k) => c.getContext('2d').putImageData(data[k], 0, 0));
  return { face: layers[0], side: layers[1], rim: layers[2], w: W, h: H, m };
}

// Render a word as one extruded logo canvas.
// opts: { cell (device px per font pixel), colors: [hex...], arc (radians of bend across
// the word, + = arch up), depth (extrusion in font pixels), jitter (per-letter tilt) }.
export function renderLogoWord(text, { cell, colors, arc = 0, depth = 1.1, jitter = 0.05 }) {
  const font = BIG_FONT;
  const letters = [];
  let pen = 0;
  let ci = 0;
  for (const ch of text) {
    const g = glyphOf(font, ch);
    if (!g) continue;
    if (ch !== ' ') letters.push({ g, x: pen, color: colors[ci++ % colors.length] });
    pen += g.w + font.spacing * 0.6;
  }
  const total = pen - font.spacing * 0.6;
  const radius = arc ? total / arc : 0; // signed: > 0 arches up, < 0 sags
  const R = Math.abs(radius);

  // Place letters along an arc; each letter is rotated to follow the curve plus a little tilt.
  const ext = depth * cell;
  const pad = 2 * cell;
  const bend = R ? (total * total) / (8 * R) : 0;
  const W = Math.ceil(total * cell + pad * 2 + ext);
  const H = Math.ceil((font.height + bend) * cell + pad * 2 + ext);
  const canvas = surface(W, H);
  const ctx = canvas.getContext('2d');
  const placed = letters.map((L, k) => {
    const layers = letterLayers(L.g, cell, L.color);
    const cxFont = L.x + L.g.w / 2 - total / 2; // letter centre relative to the word centre
    const angle = radius ? cxFont / radius : 0;
    const drop = R ? R - Math.sqrt(Math.max(0, R * R - cxFont * cxFont)) : 0;
    const tilt = (k % 2 ? 1 : -1) * jitter;
    return {
      layers,
      x: W / 2 - ext / 2 + cxFont * cell,
      y: pad + (font.height / 2 + (radius > 0 ? drop : bend - drop)) * cell,
      rot: angle + tilt,
    };
  });

  const draw = (p, img, dx, dy) => {
    ctx.save();
    ctx.translate(p.x + dx, p.y + dy);
    ctx.rotate(p.rot);
    ctx.drawImage(img, -p.layers.w / 2, -p.layers.h / 2);
    ctx.restore();
  };
  // Extrusion goes down and slightly right. Rims first, then the side body, then faces.
  const steps = Math.max(1, Math.ceil(ext));
  const dir = normalize([0.3, 1]);
  for (const p of placed) for (let s = steps; s >= 0; s--) draw(p, p.layers.rim, dir[0] * s, dir[1] * s);
  for (const p of placed) for (let s = steps; s >= 1; s--) draw(p, p.layers.side, dir[0] * s, dir[1] * s);
  for (const p of placed) draw(p, p.layers.face, 0, 0);
  return canvas;
}
