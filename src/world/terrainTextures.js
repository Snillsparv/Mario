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

  // Soft round dab about 2 px wide (a crack or scratch stroke), wrapping around the edges.
  dab(cx, cy, color, a) {
    for (let y = Math.floor(cy - 1.5); y <= cy + 1.5; y++) {
      for (let x = Math.floor(cx - 1.5); x <= cx + 1.5; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < 1.5) this.blend(x, y, color, a * (1 - smoothstep(0.4, 1.5, d)));
      }
    }
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

// Layered rock for the perimeter cliffs and the pond's rocky banks (128 px = 1280 units):
// uneven horizontal strata with wobbly, softly shadowed ledges (lit along the top of each
// band, darker toward its foot), broken into blocks by slanted joints, each block split
// into a lit and a shaded facet, in a few warm grey-browns. A few short soft cracks too.
export function rockTexture() {
  return cached('rock', () =>
    painted(128, 128, (px, w, h) => {
      const rng = makeRng(501);
      const tones = [
        [148, 136, 118],
        [136, 126, 112],
        [158, 144, 122],
      ];
      const heights = [27, 19, 31, 22, 29]; // sums to h, so the strata tile vertically
      const wobble = tileableNoise(w, h, 6, 504);
      let top = 0;
      const bands = heights.map((bh, b) => {
        // Joints: slanted lines at uneven spacing (wrapping around in x); only some are
        // open, dark cracks, the rest just separate blocks of different tone.
        const joints = [];
        for (let x = rng() * 24; x < w; x += 16 + rng() * 26) joints.push({ x, slant: jitter(rng, 0.35), open: rng() < 0.6 });
        const shade = () => {
          const k = 0.94 + rng() * 0.12; // one factor for all channels: blocks differ in value, not hue
          return tones[Math.floor(rng() * tones.length)].map((v) => v * k);
        };
        const band = { top, h: bh, joints, tones: joints.map(shade), facet: joints.map(() => jitter(rng, 1)) };
        top += bh;
        return { ...band, edge: (x) => band.top + (wobble(x, b * 25.6) - 0.5) * 9 };
      });
      const grain = tileableNoise(w, h, 32, 503);
      const mottle = tileableFbm(w, h, 4, 2, 502);
      const wrap = (d) => d - w * Math.round(d / w);
      px.fill((x, y) => {
        // Which band (strata edges wobble; the last band wraps into the first).
        let yy = y + 0.5;
        if (yy < bands[0].edge(x)) yy += h;
        let b = 0;
        while (b + 1 < bands.length && yy >= bands[b + 1].edge(x)) b++;
        const band = bands[b];
        const y0 = band.edge(x);
        const y1 = b + 1 < bands.length ? bands[b + 1].edge(x) : h + bands[0].edge(x);
        const t = (yy - y0) / (y1 - y0); // 0 at the band's top ledge, 1 at its foot
        // Block between the joints left and right of this pixel (joints lean by their slant).
        let block = 0;
        let jointDist = Infinity;
        let right = Infinity;
        band.joints.forEach((j, k) => {
          const d = wrap(x + 0.5 - (j.x + j.slant * (yy - y0)));
          if (j.open) jointDist = Math.min(jointDist, Math.abs(d));
          if (d < 0 && -d < right) {
            right = -d;
            block = (k + band.joints.length - 1) % band.joints.length;
          }
        });
        // Lit upper facet and shaded lower facet, split along a tilted line through the block.
        const facet = t - 0.45 + band.facet[block] * 0.2 * (right / 30 - 0.5) < 0 ? 1.06 : 0.92;
        const ledge = 1.12 - 0.26 * smoothstep(0, 1, t);
        const k = facet * ledge * (0.93 + 0.1 * grain(x, y)) * (0.92 + 0.14 * mottle(x, y));
        // Soft dark crevices under each ledge and along the open joints (about 2 px).
        const edgeDist = Math.min(yy - y0, y1 - yy);
        const crevice = Math.max(1 - smoothstep(0.2, 2.4, edgeDist), 0.8 * (1 - smoothstep(0.3, 2, jointDist)));
        return band.tones[block].map((v) => v * k * (1 - 0.45 * crevice) + jitter(rng, 3));
      });
      // Short soft cracks wandering down inside the blocks.
      for (let i = 0; i < 14; i++) {
        let x = rng() * w;
        const y0 = rng() * h;
        const len = 4 + Math.floor(rng() * 7);
        for (let k = 0; k < len; k++) {
          x += jitter(rng, 0.7);
          px.dab(x, y0 + k, [98, 86, 72], 0.35);
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
