// Painted textures of the mystery box: a cut-crystal face (translucent blue, bevelled facets, a
// glint) in two cells, the side face carrying a glowing white-gold "?" and the plain face for
// the top and bottom. The glyph is drawn as strokes (no font), in an original hand-drawn shape.
//
//   makeCrystalTexture('full' | 'empty' | 'back')
//     full   the lit box, "?" on every side face
//     empty  after the hat was released: a dim grey-blue shell, no glyph
//     back   the inner (back) faces seen through the front: plain, deeper blue
// UV cells: [0, 0.5] = side face, [0.5, 1] = top/bottom face (CRYSTAL_CELLS).

import { canvasTexture } from '../render/texgen.js';

const S = 64;
export const CRYSTAL_CELLS = { side: [0, 0.5], cap: [0.5, 1] };

const TINTS = {
  full: { top: [168, 226, 255], bottom: [40, 108, 224], alpha: 0.6, rim: 'rgba(225,245,255,0.95)', glint: 0.38 },
  empty: { top: [120, 138, 160], bottom: [58, 70, 96], alpha: 0.5, rim: 'rgba(170,185,205,0.7)', glint: 0.16 },
  back: { top: [70, 140, 235], bottom: [20, 60, 170], alpha: 0.45, rim: 'rgba(150,200,255,0.5)', glint: 0 },
};

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// One crystal face in the cell starting at x0: gradient body, four bevel facets, a glint, a rim.
function face(ctx, x0, t, glyph) {
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, rgba(t.top, t.alpha));
  g.addColorStop(1, rgba(t.bottom, t.alpha));
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, S, S);
  // Bevels: a cut gem's sloping border, lit from the upper left.
  const b = 9;
  const bevel = (pts, light) => {
    ctx.beginPath();
    for (const [x, y] of pts) ctx.lineTo(x0 + x, y);
    ctx.closePath();
    ctx.fillStyle = light > 0 ? `rgba(255,255,255,${0.22 * light})` : `rgba(0,20,70,${-0.28 * light})`;
    ctx.fill();
  };
  bevel([[0, 0], [S, 0], [S - b, b], [b, b]], 1);
  bevel([[0, 0], [b, b], [b, S - b], [0, S]], 0.6);
  bevel([[S, 0], [S, S], [S - b, S - b], [S - b, b]], -0.6);
  bevel([[0, S], [b, S - b], [S - b, S - b], [S, S]], -1);
  // Glint: a soft diagonal streak across the upper left.
  if (t.glint > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, S, S);
    ctx.clip();
    ctx.fillStyle = `rgba(255,255,255,${t.glint})`;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, 30);
    ctx.lineTo(x0 + 30, 6);
    ctx.lineTo(x0 + 38, 6);
    ctx.lineTo(x0 + 6, 38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = t.rim;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, 1, S - 2, S - 2);
  if (glyph) question(ctx, x0 + S / 2, S / 2);
}

// The "?" glyph centred at (cx, cy): a round hook, a short stem and a dot, drawn as a glowing
// white-gold stroke over a dark halo so it reads through the translucent blue.
function question(ctx, cx, cy) {
  const path = () => {
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 10, Math.PI * 1.08, Math.PI * 2.28);
    ctx.quadraticCurveTo(cx, cy + 1, cx, cy + 8);
  };
  const dot = (r) => {
    ctx.beginPath();
    ctx.arc(cx, cy + 18, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Dark halo.
  ctx.strokeStyle = 'rgba(10,30,90,0.55)';
  ctx.fillStyle = 'rgba(10,30,90,0.55)';
  ctx.lineWidth = 12;
  path();
  ctx.stroke();
  dot(6.5);
  // Glowing body, then a bright core.
  ctx.shadowColor = 'rgba(255,214,110,1)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = '#ffe28a';
  ctx.fillStyle = '#ffe28a';
  ctx.lineWidth = 7.5;
  path();
  ctx.stroke();
  dot(4.6);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fffdf2';
  ctx.fillStyle = '#fffdf2';
  ctx.lineWidth = 3.5;
  path();
  ctx.stroke();
  dot(2.4);
}

export function makeCrystalTexture(kind = 'full') {
  const t = TINTS[kind] ?? TINTS.full;
  const tex = canvasTexture(
    S * 2,
    S,
    (ctx) => {
      face(ctx, 0, t, kind === 'full');
      face(ctx, S, t, false);
    },
    { repeat: false },
  );
  tex.userData.kind = kind;
  return tex;
}
