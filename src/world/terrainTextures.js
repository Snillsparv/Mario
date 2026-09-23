// Procedural N64-style textures for the terrain and water: small (64 px wide), tileable,
// painted per pixel and softened by bilinear filtering. Each getter paints once and caches.

import { canvasTexture, tileableFbm, tileableNoise, paintPixels, mixRgb } from '../render/texgen.js';
import { makeRng, smoothstep } from '../core/math.js';

const cache = new Map();
function cached(name, make) {
  if (!cache.has(name)) cache.set(name, make());
  return cache.get(name);
}

// Float RGBA pixel buffer with wrap-around blending, flushed to a canvas at the end.
class Pixmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h * 4);
  }

  fill(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = fn(x, y);
        const i = (y * this.w + x) * 4;
        this.d[i] = c[0];
        this.d[i + 1] = c[1];
        this.d[i + 2] = c[2];
        this.d[i + 3] = c.length > 3 ? c[3] : 255;
      }
    }
  }

  blend(x, y, c, a) {
    const w = this.w;
    const h = this.h;
    const i = (((Math.round(y) % h) + h) % h * w + (((Math.round(x) % w) + w) % w)) * 4;
    for (let k = 0; k < 3; k++) this.d[i + k] += (c[k] - this.d[i + k]) * a;
  }

  // Round blob of radius r (pixels) with a lit top-left and a shaded bottom-right rim.
  pebble(cx, cy, r, color) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > r + 0.5) continue;
        const rim = (dx + dy) / (r + 0.01);
        const shade = rim < -0.6 ? 1.18 : rim > 0.6 ? 0.72 : 1;
        this.blend(x, y, color.map((v) => v * shade), d > r - 0.5 ? 0.6 : 0.95);
      }
    }
  }

  draw(ctx) {
    paintPixels(ctx, this.w, this.h, (x, y) => {
      const i = (y * this.w + x) * 4;
      return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
    });
  }
}

function painted(w, h, paint, opts) {
  return canvasTexture(
    w,
    h,
    (ctx) => {
      const px = new Pixmap(w, h);
      paint(px, w, h);
      px.draw(ctx);
    },
    opts,
  );
}

const jitter = (rng, amount) => (rng() - 0.5) * 2 * amount;

// Mid-green lawn with darker/lighter speckles and tiny blade strokes.
export function grassTexture() {
  return cached('grass', () =>
    painted(64, 64, (px, w, h) => {
      const rng = makeRng(101);
      const broad = tileableFbm(w, h, 4, 3, 102);
      px.fill((x, y) => {
        let c = mixRgb([74, 140, 42], [102, 170, 56], broad(x, y));
        const r = rng();
        if (r < 0.1) c = c.map((v) => v * 0.8);
        else if (r < 0.18) c = mixRgb(c, [150, 200, 90], 0.35);
        return c.map((v) => v + jitter(rng, 5));
      });
      for (let i = 0; i < 150; i++) {
        const x0 = rng() * w;
        const y0 = rng() * h;
        const len = 2 + Math.floor(rng() * 3);
        const lean = jitter(rng, 0.45);
        const color = rng() < 0.55 ? [50, 108, 30] : [146, 204, 84];
        for (let k = 0; k < len; k++) px.blend(x0 + lean * k, y0 - k, color, 0.7 - k * 0.12);
      }
    }),
  );
}

// Sandy, light-brown packed dirt with small pebbles.
export function pathTexture() {
  return cached('path', () =>
    painted(64, 64, (px, w, h) => {
      const rng = makeRng(201);
      const broad = tileableFbm(w, h, 4, 3, 202);
      px.fill((x, y) => {
        const c = mixRgb([176, 142, 94], [210, 180, 128], broad(x, y));
        const r = rng();
        const k = r < 0.08 ? 0.85 : r > 0.95 ? 1.08 : 1;
        return c.map((v) => v * k + jitter(rng, 6));
      });
      for (let i = 0; i < 22; i++) {
        const tone = 0.82 + rng() * 0.26;
        px.pebble(rng() * w, rng() * h, 0.7 + rng() * 1.1, [204 * tone, 184 * tone, 146 * tone]);
      }
    }),
  );
}

// Pale irregular flagstones (tileable Voronoi cells) with dark mortar joints.
export function flagstoneTexture() {
  return cached('flagstone', () =>
    painted(64, 64, (px, w, h) => {
      const rng = makeRng(301);
      const n = 4;
      const cells = [];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          cells.push({
            x: ((i + 0.5 + jitter(rng, 0.3)) * w) / n,
            y: ((j + 0.5 + jitter(rng, 0.3)) * h) / n,
            tone: rng(),
          });
        }
      }
      const grain = tileableFbm(w, h, 8, 2, 302);
      px.fill((x, y) => {
        let d1 = Infinity;
        let d2 = Infinity;
        let best = cells[0];
        for (const c of cells) {
          for (let oy = -h; oy <= h; oy += h) {
            for (let ox = -w; ox <= w; ox += w) {
              const d = Math.hypot(x + 0.5 - c.x - ox, y + 0.5 - c.y - oy);
              if (d < d1) {
                d2 = d1;
                d1 = d;
                best = c;
              } else if (d < d2) d2 = d;
            }
          }
        }
        const edge = d2 - d1;
        if (edge < 1.5) return [112, 104, 90].map((v) => v + jitter(rng, 6));
        let c = mixRgb([184, 176, 154], [216, 208, 186], best.tone);
        c = c.map((v) => v * (0.92 + 0.14 * grain(x, y)) + jitter(rng, 4));
        return edge < 3 ? c.map((v) => v * 0.88) : c;
      });
    }),
  );
}

// Grey-beige stone blocks in running bond (moat and island retaining walls).
export function masonryTexture() {
  return cached('masonry', () =>
    painted(64, 64, (px, w, h) => {
      const rng = makeRng(401);
      const tones = Array.from({ length: 8 }, () => 0.86 + rng() * 0.22);
      const grain = tileableFbm(w, h, 8, 2, 402);
      px.fill((x, y) => {
        const row = Math.floor(y / 16);
        const ly = y % 16;
        const sx = (x + (row % 2) * 16) % w;
        const lx = sx % 32;
        if (ly >= 14 || lx >= 30) return [88, 82, 72].map((v) => v + jitter(rng, 5));
        const tone = tones[row * 2 + Math.floor(sx / 32)];
        let k = tone * (0.9 + 0.16 * grain(x, y));
        if (ly === 0 || lx === 0) k *= 1.12;
        else if (ly === 13 || lx === 29) k *= 0.82;
        return [172, 164, 146].map((v) => v * k + jitter(rng, 4));
      });
    }),
  );
}

// Blocky crags for the perimeter cliffs and the pond's rocky banks (64 x 128): a tileable
// Voronoi of large angular slabs, each broken into two facets tilted toward and away from
// the light, in a few low-contrast tan-greys, with dark crevices along some of the joints.
export function rockTexture() {
  return cached('rock', () =>
    painted(64, 128, (px, w, h) => {
      const rng = makeRng(501);
      const tones = [
        [148, 128, 102],
        [138, 122, 100],
        [156, 136, 106],
      ];
      const cells = Array.from({ length: 13 }, () => {
        const a = rng() * Math.PI * 2;
        return {
          x: rng() * w,
          y: rng() * h,
          color: tones[Math.floor(rng() * tones.length)].map((v) => v * (0.95 + rng() * 0.1)),
          fx: Math.cos(a), // facet split direction
          fy: Math.sin(a),
          lit: 1.04 + rng() * 0.06, // brighter facet (the other is darker by as much)
        };
      });
      // Angular distance: a blend of Euclidean and Chebyshev, stretched so slabs are wide.
      const dist = (dx, dy) => 0.5 * Math.hypot(dx, dy * 1.4) + 0.5 * Math.max(Math.abs(dx), Math.abs(dy) * 1.4);
      const grain = tileableNoise(w, h, 16, 503);
      const mottle = tileableFbm(w, h, 4, 2, 502);
      px.fill((x, y) => {
        let d1 = Infinity;
        let d2 = Infinity;
        let best = 0;
        let second = 0;
        let bdx = 0;
        let bdy = 0;
        cells.forEach((c, k) => {
          for (let oy = -h; oy <= h; oy += h) {
            for (let ox = -w; ox <= w; ox += w) {
              const dx = x + 0.5 - c.x - ox;
              const dy = y + 0.5 - c.y - oy;
              const d = dist(dx, dy);
              if (d < d1) {
                d2 = d1;
                second = best;
                d1 = d;
                best = k;
                bdx = dx;
                bdy = dy;
              } else if (d < d2) {
                d2 = d;
                second = k;
              }
            }
          }
        });
        const c = cells[best];
        const facet = bdx * c.fx + bdy * c.fy > 0 ? c.lit : 2 - c.lit;
        const k = facet * (0.92 + 0.1 * grain(x, y)) * (0.93 + 0.12 * mottle(x, y));
        let rgb = c.color.map((v) => v * k);
        // Joints: a dark crevice (with a lit lip above it) on some of them; elsewhere the
        // slabs just meet with their own tones.
        const edge = d2 - d1;
        const crevice = (best * 7 + second * 13) % 5 < 2;
        if (crevice && edge < 1.3) rgb = [86, 74, 60];
        else if (crevice && edge < 2.6) rgb = rgb.map((v) => v * (bdy < 0 ? 1.08 : 0.86));
        return rgb.map((v) => v + jitter(rng, 4));
      });
      // A few short hairline cracks inside the slabs.
      for (let i = 0; i < 10; i++) {
        let x = rng() * w;
        const y0 = rng() * h;
        const len = 3 + Math.floor(rng() * 6);
        for (let k = 0; k < len; k++) {
          x += jitter(rng, 0.8);
          px.blend(x, y0 + k, [90, 78, 64], 0.45);
        }
      }
    }),
  );
}

// Dark sandy mud for the moat and pond bed.
export function sandTexture() {
  return cached('sand', () =>
    painted(64, 64, (px, w, h) => {
      const rng = makeRng(601);
      const broad = tileableFbm(w, h, 4, 3, 602);
      px.fill((x, y) => {
        const c = mixRgb([114, 100, 70], [152, 136, 96], broad(x, y));
        const r = rng();
        const k = r < 0.12 ? 0.82 : r > 0.93 ? 1.12 : 1;
        return c.map((v) => v * k + jitter(rng, 5));
      });
      for (let i = 0; i < 12; i++) {
        const tone = 0.8 + rng() * 0.3;
        px.pebble(rng() * w, rng() * h, 0.7 + rng(), [150 * tone, 140 * tone, 118 * tone]);
      }
    }),
  );
}

// Blue-green water with soft lighter ripple lines (base layer, drawn at ~70% opacity).
export function waterTexture() {
  return cached('water', () =>
    painted(64, 64, (px, w, h) => {
      const n = tileableFbm(w, h, 2, 4, 701);
      const tone = tileableFbm(w, h, 3, 2, 702);
      px.fill((x, y) => {
        const v = n(x, y);
        // Thin bright crests where the noise crosses a few iso-levels.
        const ripple = 1 - Math.abs(Math.sin(v * Math.PI * 7));
        const c = mixRgb([30, 98, 136], [54, 136, 164], tone(x, y));
        return mixRgb(c, [112, 186, 206], smoothstep(0.86, 0.99, ripple) * 0.3);
      });
    }),
  );
}

// Sparkly highlight lines on transparent (second water layer, scrolls the other way).
export function waterGlintTexture() {
  return cached('waterGlint', () =>
    painted(64, 64, (px, w, h) => {
      const n = tileableFbm(w, h, 3, 3, 801);
      px.fill((x, y) => {
        const ridge = 1 - Math.abs(2 * n(x, y) - 1);
        // Keep a little alpha everywhere so the colour survives canvas premultiplication.
        return [214, 244, 255, 8 + 120 * smoothstep(0.9, 0.99, ridge)];
      });
    }),
  );
}
