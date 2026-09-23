// Procedural textures for the interactive objects: spinning-coin frames, sparkles, the blob
// shadow, butterfly wings and the star's reflection map. Everything is painted at runtime on a
// canvas; in node (no canvas) the helpers return empty textures / null so the object logic
// stays testable.

import * as THREE from 'three';
import { canvasTexture, HAS_CANVAS } from '../render/texgen.js';
import { TAU } from '../core/math.js';

// ---------------------------------------------------------------- coins

// Pre-painted rotation frames of a thick coin over half a turn (the face design is mirror
// symmetric, so the back half of the spin reuses them). Row 0 = yellow, row 1 = red.
export const COIN_FRAMES = 16;
const COIN_PX = 64;

const COIN_PALETTES = [
  { hi: '#fff8c8', mid: '#ffd23a', lo: '#d48c0c', rim: '#b8700a', rimDark: '#643404' },
  { hi: '#ffd6cc', mid: '#f03a2a', lo: '#a01218', rim: '#8a1010', rimDark: '#420404' },
];

// UV rect [u0, v0, du, dv] of a coin frame (canvas row 0 is the top, i.e. v in [0.5, 1]).
export function coinFrameUV(frame, red) {
  return [frame / COIN_FRAMES, red ? 0 : 0.5, 1 / COIN_FRAMES, 0.5];
}

export function makeCoinAtlas() {
  return canvasTexture(
    COIN_PX * COIN_FRAMES,
    COIN_PX * 2,
    (ctx) => {
      COIN_PALETTES.forEach((pal, row) => {
        for (let k = 0; k < COIN_FRAMES; k++) {
          const phi = -Math.PI / 2 + ((k + 0.5) / COIN_FRAMES) * Math.PI;
          paintCoinFrame(ctx, k * COIN_PX, row * COIN_PX, COIN_PX, phi, pal);
        }
      });
    },
    { repeat: false },
  );
}

// One frame of the coin turned by phi (0 = face-on, +-PI/2 = edge-on) about the vertical axis.
// The rim is the far face's outline swept across to the near face, so it widens as the coin
// turns edge-on; the face is the unrotated design squashed horizontally by cos(phi).
function paintCoinFrame(ctx, ox, oy, size, phi, pal) {
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  const R = size * 0.44;
  const T = size * 0.15; // visual thickness
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const rx = Math.max(R * c, 0.8);
  const faceX = cx + (T / 2) * s;
  const backX = cx - (T / 2) * s;

  const rim = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  rim.addColorStop(0, pal.lo);
  rim.addColorStop(0.3, pal.rim);
  rim.addColorStop(1, pal.rimDark);
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(backX, cy, rx, R, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(Math.min(backX, faceX), cy - R, Math.abs(faceX - backX), 2 * R);

  const shade = coinFaceShade(phi);
  ctx.save();
  ctx.translate(faceX, cy);
  ctx.scale(rx / R, 1);
  paintCoinFace(ctx, R, pal, shade);
  ctx.restore();
}

// Brightness of the coin face turned by phi. It dims only slightly as it turns edge-on
// (symmetric, never below 85 %): the coin must stay bright gold at a distance, and the
// widening rim carries the edge-on cue.
export function coinFaceShade(phi) {
  return 0.85 + 0.15 * Math.cos(phi);
}

// Face design in unsquashed local coordinates (centre 0,0, radius R): a raised border ring and
// an embossed four-facet diamond, lit from the upper left.
function paintCoinFace(ctx, R, pal, shade) {
  const disc = (r, dx = 0, dy = 0) => {
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, TAU);
  };
  const g = ctx.createRadialGradient(-0.35 * R, -0.4 * R, 0.05 * R, 0, 0, R);
  g.addColorStop(0, pal.hi);
  g.addColorStop(0.35, pal.mid);
  g.addColorStop(1, pal.lo);
  ctx.fillStyle = g;
  disc(R);
  ctx.fill();

  // Raised ring: dark edge on the lower right, light edge on the upper left.
  const o = R * 0.05;
  ctx.lineWidth = R * 0.12;
  for (const [col, d] of [[pal.lo, o], [pal.hi, -o], [pal.mid, 0]]) {
    ctx.strokeStyle = col;
    disc(R * 0.78, d, d);
    ctx.stroke();
  }

  // Embossed diamond: four facets meeting at a raised centre, the upper-left ones catching
  // the light, the lower-right ones in shade, with a thin dark edge to lift it off the face.
  const w = R * 0.3;
  const h = R * 0.5;
  const facets = [
    [[0, -h], [-w, 0], '#fffdf0'],
    [[0, -h], [w, 0], pal.hi],
    [[-w, 0], [0, h], pal.lo],
    [[w, 0], [0, h], pal.rim],
  ];
  for (const [a, b, col] of facets) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = pal.rim;
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(-w, 0);
  ctx.closePath();
  ctx.stroke();

  // Dim the whole face as it turns edge-on, then outline it.
  if (shade < 1) {
    ctx.fillStyle = `rgba(40,20,0,${(1 - shade).toFixed(3)})`;
    disc(R);
    ctx.fill();
  }
  ctx.strokeStyle = pal.rimDark;
  ctx.lineWidth = R * 0.07;
  disc(R * 0.97);
  ctx.stroke();
}

// ---------------------------------------------------------------- sparkles

// Three 32 px cells: a five-pointed sparkle, a four-pointed twinkle and a soft glow. Painted in
// white/cream so each sprite can be tinted per instance.
export const SPARKLE = { STAR: 0, TWINKLE: 1, GLOW: 2 };
const SPARKLE_CELLS = 3;

export function sparkleUV(cell) {
  return [cell / SPARKLE_CELLS, 0, 1 / SPARKLE_CELLS, 1];
}

export function makeSparkleAtlas() {
  const S = 32;
  return canvasTexture(
    S * SPARKLE_CELLS,
    S,
    (ctx) => {
      // Five-pointed star with a faint halo.
      halo(ctx, S * 0.5, S * 0.5, S * 0.5, 0.35);
      starPath(ctx, S * 0.5, S * 0.52, 5, S * 0.46, S * 0.2);
      fillCore(ctx, S * 0.5, S * 0.5, S * 0.46);
      // Four-pointed twinkle: thin spikes around a bright core.
      const x = S * 1.5;
      halo(ctx, x, S * 0.5, S * 0.42, 0.45);
      starPath(ctx, x, S * 0.5, 4, S * 0.48, S * 0.09);
      fillCore(ctx, x, S * 0.5, S * 0.48);
      // Soft glow.
      halo(ctx, S * 2.5, S * 0.5, S * 0.5, 0.9);
    },
    { repeat: false },
  );
}

function halo(ctx, x, y, r, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,250,220,${alpha})`);
  g.addColorStop(0.4, `rgba(255,236,160,${alpha * 0.45})`);
  g.addColorStop(1, 'rgba(255,230,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function fillCore(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#fffbe0');
  g.addColorStop(1, '#ffe27a');
  ctx.fillStyle = g;
  ctx.fill();
}

// Regular star polygon path with `points` tips, first tip pointing up.
function starPath(ctx, x, y, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- blob shadow

export function makeShadowTexture() {
  const S = 32;
  return canvasTexture(
    S,
    S,
    (ctx) => {
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    },
    { repeat: false },
  );
}

// ---------------------------------------------------------------- butterfly wings

// One wing per 32 px cell (u = hinge -> tip, canvas top = head), four pastel colourways.
export const WING_VARIANTS = 4;
const WING_COLOURS = [
  { base: '#fff4a8', edge: '#d8a632', spot: '#f0c860' },
  { base: '#fbf8ec', edge: '#8e8a84', spot: '#d8d2c4' },
  { base: '#ffc8dc', edge: '#c8648e', spot: '#ff9cc0' },
  { base: '#c4e6ff', edge: '#4e86c0', spot: '#8cc4f0' },
];

export function wingUV(variant) {
  return [variant / WING_VARIANTS, 0, 1 / WING_VARIANTS, 1];
}

export function makeWingAtlas() {
  const S = 32;
  return canvasTexture(
    S * WING_VARIANTS,
    S,
    (ctx) => {
      WING_COLOURS.forEach((col, i) => {
        const x0 = i * S;
        const lobe = (cx, cy, rx, ry, rot) => {
          ctx.beginPath();
          ctx.ellipse(x0 + cx, cy, rx, ry, rot, 0, TAU);
        };
        const lobes = [
          [S * 0.5, S * 0.3, S * 0.46, S * 0.24, -0.35], // forewing
          [S * 0.36, S * 0.7, S * 0.32, S * 0.2, 0.35], // hindwing
        ];
        // Dark edge first, then the pale fill inset from it.
        ctx.fillStyle = col.edge;
        for (const l of lobes) {
          lobe(...l);
          ctx.fill();
        }
        ctx.fillStyle = col.base;
        for (const [cx, cy, rx, ry, rot] of lobes) {
          lobe(cx - 1, cy, rx - 2.5, ry - 2.5, rot);
          ctx.fill();
        }
        ctx.fillStyle = col.spot;
        lobe(S * 0.66, S * 0.26, S * 0.1, S * 0.08, 0);
        ctx.fill();
        lobe(S * 0.4, S * 0.72, S * 0.08, S * 0.06, 0);
        ctx.fill();
        // Body along the hinge (shared by both wings).
        ctx.fillStyle = '#3a2a1c';
        ctx.fillRect(x0, S * 0.12, 2, S * 0.76);
      });
    },
    { repeat: false },
  );
}

// ---------------------------------------------------------------- star reflection map

// Tiny golden "environment" cube for the star's metallic sheen: bright sky above, a hot
// horizon band, dark amber below. Returns null without a canvas.
export function makeStarEnvMap() {
  if (!HAS_CANVAS) return null;
  const S = 16;
  const face = (paint) => canvasTexture(S, S, paint, { repeat: false, mipmaps: false }).image;
  const flat = (col) => face((ctx) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, S, S);
  });
  const side = face((ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#fff8d8');
    g.addColorStop(0.42, '#ffcc3c');
    g.addColorStop(0.5, '#fff2a0');
    g.addColorStop(0.58, '#e09a10');
    g.addColorStop(1, '#7a4a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  const cube = new THREE.CubeTexture([side, side, flat('#fffbe8'), flat('#6a3c00'), side, side]);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  return cube;
}
