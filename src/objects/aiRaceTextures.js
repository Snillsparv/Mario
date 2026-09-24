// Procedural textures for the AI RACE mode objects: the floor button's cap (with "AI RACE" in
// chunky block letters), its hazard-striped base, and the fire sprite atlas used by the
// fireballs, the monster's vents and eyes, sparks and steam. Painted at runtime on a canvas; in
// node (no canvas) canvasTexture() returns an empty texture so the logic stays testable.

import { canvasTexture, HAS_CANVAS } from '../render/texgen.js';
import { TAU } from '../core/math.js';

// ---------------------------------------------------------------- button cap

// 5 x 7 block glyphs (original, drawn for this game). '#' = filled cell.
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};

export const CAP_TEXTURE_SIZE = 256;
// Radius of the painted disc in texels; the cap top maps its radius onto it.
export const CAP_DISC_RADIUS = 124;
// Where the cap's side and bevel sample their flat red-orange (u, v).
export const CAP_SIDE_UV = [0.5, 0.5 + 118 / 256];

// Cells of a text line: [{ x, y }] in glyph-cell units, and its width in cells.
function lineCells(text) {
  const cells = [];
  let cx = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '#') cells.push({ x: cx + c, y: r });
      cx += 6;
    } else cx += 3;
  }
  return { cells, width: cx - 1 };
}

// Paints one line of block letters centred on (cx, top) with cells sx wide and sy tall (taller
// than wide: the cap is mostly seen at a grazing angle, which squashes the letters' height):
// dark outline, drop shadow, cream-yellow face with a lighter top edge (a chunky enamel sign).
function paintLine(ctx, text, cx, top, sx, sy) {
  const { cells, width } = lineCells(text);
  const x0 = cx - (width * sx) / 2;
  const o = sx * 0.42; // outline thickness
  const each = (fn) => {
    for (const c of cells) fn(x0 + c.x * sx, top + c.y * sy);
  };
  ctx.fillStyle = 'rgba(40,6,0,0.55)'; // drop shadow
  each((x, y) => ctx.fillRect(x - o + sx * 0.35, y - o + sy * 0.45, sx + 2 * o, sy + 2 * o));
  ctx.fillStyle = '#240804'; // outline
  each((x, y) => ctx.fillRect(x - o, y - o, sx + 2 * o, sy + 2 * o));
  ctx.fillStyle = '#ffe27a'; // face
  each((x, y) => ctx.fillRect(x - 0.5, y - 0.5, sx + 1, sy + 1));
  ctx.fillStyle = '#fffbe6'; // highlight on each block's top
  each((x, y) => ctx.fillRect(x - 0.5, y - 0.5, sx + 1, sy * 0.3));
  ctx.fillStyle = '#e0a624'; // shade on each block's bottom
  each((x, y) => ctx.fillRect(x - 0.5, y + sy * 0.75, sx + 1, sy * 0.25 + 0.5));
}

// The cap's top: a red-orange disc with a darker bevel ring and "AI" over "RACE" in big block
// letters. Canvas top = the far (north) side, so the text reads upright from the south, where
// the hero approaches from the spawn.
export function makeButtonCapTexture() {
  const S = CAP_TEXTURE_SIZE;
  const tex = canvasTexture(
    S,
    S,
    (ctx) => {
      const c = S / 2;
      ctx.fillStyle = '#b8300f';
      ctx.fillRect(0, 0, S, S);
      const g = ctx.createRadialGradient(c - 30, c - 40, 10, c, c, CAP_DISC_RADIUS);
      g.addColorStop(0, '#ff7a3c');
      g.addColorStop(0.6, '#ec4a1a');
      g.addColorStop(0.86, '#cf3a12');
      g.addColorStop(0.9, '#8a200a');
      g.addColorStop(0.95, '#f06a34');
      g.addColorStop(1, '#b8300f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, CAP_DISC_RADIUS, 0, TAU);
      ctx.fill();
      // Faint speckle so the enamel is not perfectly flat (deterministic).
      let seed = 7;
      for (let i = 0; i < 260; i++) {
        seed = (seed * 16807) % 2147483647;
        const a = (seed / 2147483647) * TAU;
        seed = (seed * 16807) % 2147483647;
        const r = Math.sqrt(seed / 2147483647) * (CAP_DISC_RADIUS - 16);
        ctx.fillStyle = i % 2 ? 'rgba(255,190,140,0.10)' : 'rgba(90,10,0,0.10)';
        ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 3, 3);
      }
      paintLine(ctx, 'AI', c, 36, 12.5, 15);
      paintLine(ctx, 'RACE', c, 150, 6.9, 9.6);
    },
    { repeat: false },
  );
  tex.anisotropy = 4; // the cap is mostly seen at a grazing angle from the follow camera
  return tex;
}

// ---------------------------------------------------------------- button base

// 128 x 64: the upper half is a band of diagonal yellow/black hazard stripes (wrapped round the
// base's side), the lower half a riveted dark steel plate (the base's top ring).
export const BASE_STRIPES_V = [0.5, 1];
export const BASE_METAL_UV = [0.5, 0.25];

export function makeButtonBaseTexture() {
  return canvasTexture(
    128,
    64,
    (ctx) => {
      ctx.fillStyle = '#24272c';
      ctx.fillRect(0, 0, 128, 64);
      // Hazard stripes (canvas rows 0..31 = v 0.5..1). 8 stripe pairs across the width so
      // they tile seamlessly around the cylinder.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 3, 128, 26);
      ctx.clip();
      ctx.fillStyle = '#f2c21c';
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = '#16161a';
      for (let i = -2; i < 10; i++) {
        const x = i * 16;
        ctx.beginPath();
        ctx.moveTo(x, 32);
        ctx.lineTo(x + 8, 32);
        ctx.lineTo(x + 8 + 32, 0);
        ctx.lineTo(x + 32, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#5a5f68';
      ctx.fillRect(0, 0, 128, 3);
      ctx.fillRect(0, 29, 128, 3);
      // Steel plate with rivets (rows 32..63).
      const g = ctx.createLinearGradient(0, 32, 0, 64);
      g.addColorStop(0, '#6d737c');
      g.addColorStop(1, '#4b5058');
      ctx.fillStyle = g;
      ctx.fillRect(0, 32, 128, 32);
      for (let x = 6; x < 128; x += 16) {
        ctx.fillStyle = '#2c2f35';
        ctx.fillRect(x, 46, 4, 4);
        ctx.fillStyle = '#9aa0a8';
        ctx.fillRect(x, 46, 2, 2);
      }
    },
    { repeat: true },
  );
}

// ---------------------------------------------------------------- fire sprites

// Four 32 px cells, painted white so each sprite is tinted per instance (drawn additively).
export const FIRE = { GLOW: 0, FLAME: 1, SPARK: 2, PUFF: 3 };
const FIRE_CELLS = 4;

export function fireUV(cell) {
  return [cell / FIRE_CELLS, 0, 1 / FIRE_CELLS, 1];
}

export function makeFireAtlas() {
  const S = 32;
  return canvasTexture(
    S * FIRE_CELLS,
    S,
    (ctx) => {
      // Soft glow.
      radial(ctx, S * 0.5, S * 0.5, S * 0.5, [
        [0, 1],
        [0.25, 0.7],
        [0.6, 0.18],
        [1, 0],
      ]);
      // Flame puff: a bright core inside a lumpy ring of smaller blobs.
      const fx = S * 1.5;
      const blobs = [
        [0, -5, 9],
        [5, 2, 8],
        [-5, 3, 8],
        [0, 5, 7],
        [3, -2, 7],
        [-3, -3, 7],
      ];
      for (const [dx, dy, r] of blobs) radial(ctx, fx + dx, S * 0.5 + dy, r, [[0, 0.55], [0.6, 0.35], [1, 0]]);
      radial(ctx, fx, S * 0.5, 11, [[0, 1], [0.5, 0.8], [1, 0]]);
      // Spark: hard white dot with a small halo.
      radial(ctx, S * 2.5, S * 0.5, S * 0.35, [[0, 1], [0.25, 1], [0.4, 0.35], [1, 0]]);
      // Puff (smoke / steam): a soft cloudy blob.
      const px = S * 3.5;
      const puffs = [
        [0, 0, 13],
        [-6, 4, 9],
        [6, 3, 9],
        [2, -6, 9],
      ];
      for (const [dx, dy, r] of puffs) radial(ctx, px + dx, S * 0.5 + dy, r, [[0, 0.45], [0.7, 0.2], [1, 0]]);
    },
    { repeat: false },
  );
}

function radial(ctx, x, y, r, stops) {
  if (!HAS_CANVAS) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [t, a] of stops) g.addColorStop(t, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

// ---------------------------------------------------------------- landing marker

// A white target glow for the ground under a falling fireball (tinted and drawn additively):
// a soft centre inside a brighter ring.
export function makeMarkerTexture() {
  const S = 64;
  return canvasTexture(
    S,
    S,
    (ctx) => {
      const c = S / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.72, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.82, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    },
    { repeat: false },
  );
}
