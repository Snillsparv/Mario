// Pip's face, painted on a small canvas that wraps the head sphere (equirectangular:
// x = longitude, y = latitude; the front of the head, +Z, sits at u = 0.25). Each facial
// expression is its own texture, painted on first use and cached, and the head material
// simply swaps maps (like the N64's texture-swapped eyes and blinks).
import { canvasTexture, HAS_CANVAS } from '../../render/texgen.js';
import { COLORS } from './palette.js';

// Painting happens in a 256 x 128 design space, rendered at 2x for crisp close-ups.
const W = 256;
const H = 128;
const SCALE = 2;
const FRONT = W * 0.25;
const EYE_DX = 11;
const EYE_Y = 61;
const INK = '#3a2210';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Which eyes and mouth (and brows, default 'plain') each expression uses.
const EXPRESSIONS = {
  open: ['open', 'smile'],
  half: ['half', 'smile'],
  blink: ['closed', 'smile'],
  sleep: ['closed', 'snore'],
  happy: ['happy', 'open'],
  shout: ['open', 'open'],
  hurt: ['hurt', 'o'],
  dizzy: ['dizzy', 'wavy'],
  panic: ['wide', 'yell', 'worried'],
};
export const FACES = Object.keys(EXPRESSIONS);

function line(ctx, width, color = INK) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function eyeOpen(ctx, cx, dir) {
  // White of the eye with an ink outline, a big warm-brown iris looking slightly inward.
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y, 6.4, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  line(ctx, 1);
  const ix = cx - dir * 1.2;
  const iy = EYE_Y + 1.6;
  const g = ctx.createLinearGradient(0, iy - 7, 0, iy + 7);
  g.addColorStop(0, '#2b1709');
  g.addColorStop(1, '#8a5424');
  ctx.beginPath();
  ctx.ellipse(ix, iy, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ix, iy + 0.5, 2.3, 3.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#140a04';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ix + 1.6, iy - 3.2, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix - 1.4, iy + 3.4, 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Heavier upper lash line.
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y, 6.4, 10, 0, Math.PI * 1.08, Math.PI * 1.92);
  line(ctx, 2.2);
}

function eyeHalf(ctx, cx, dir) {
  eyeOpen(ctx, cx, dir);
  ctx.fillStyle = hex(COLORS.skin);
  ctx.fillRect(cx - 8, EYE_Y - 12, 16, 11);
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y - 1, 6.6, 2.5, 0, Math.PI, 0, true);
  line(ctx, 2.2);
}

function eyeClosed(ctx, cx) {
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y + 1, 6, 4, 0, 0.15, Math.PI - 0.15);
  line(ctx, 2.2);
}

function eyeHappy(ctx, cx) {
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y + 4, 6, 6.5, 0, Math.PI + 0.2, -0.2);
  line(ctx, 2.6);
}

function eyeHurt(ctx, cx, dir) {
  // Squeezed shut: a chevron pointing toward the nose.
  ctx.beginPath();
  ctx.moveTo(cx + dir * 5, EYE_Y - 5);
  ctx.lineTo(cx - dir * 4, EYE_Y + 1);
  ctx.lineTo(cx + dir * 5, EYE_Y + 6);
  line(ctx, 2.4);
}

function eyeDizzy(ctx, cx) {
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.45;
    const r = 0.4 + i * 0.16;
    const x = cx + Math.cos(a) * r;
    const y = EYE_Y + Math.sin(a) * r * 1.3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  line(ctx, 1.4);
}

// Wide with alarm: bigger whites, tiny pupils.
function eyeWide(ctx, cx, dir) {
  ctx.beginPath();
  ctx.ellipse(cx, EYE_Y - 0.5, 7.2, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  line(ctx, 1.3);
  ctx.beginPath();
  ctx.ellipse(cx - dir * 0.8, EYE_Y + 0.5, 2.2, 2.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#140a04';
  ctx.fill();
}

const EYES = {
  open: eyeOpen, half: eyeHalf, closed: eyeClosed, happy: eyeHappy, hurt: eyeHurt, dizzy: eyeDizzy, wide: eyeWide,
};

// dir: +1 for the brow on the viewer's right.
const BROWS = {
  plain(ctx, cx, dir) {
    ctx.beginPath();
    ctx.ellipse(cx, 50, 5, 3, dir * 0.15, Math.PI * 1.15, Math.PI * 1.85);
    line(ctx, 1.8, hex(COLORS.hair));
  },
  // Inner ends raised in alarm.
  worried(ctx, cx, dir) {
    ctx.beginPath();
    ctx.moveTo(cx - dir * 5, 46.5);
    ctx.quadraticCurveTo(cx, 46.5, cx + dir * 5, 49.5);
    line(ctx, 1.9, hex(COLORS.hair));
  },
};

const MOUTH_Y = 84;
const MOUTHS = {
  smile(ctx) {
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y - 3, 5, 3.4, 0, 0.35, Math.PI - 0.35);
    line(ctx, 1.5);
  },
  open(ctx) {
    ctx.beginPath();
    ctx.moveTo(FRONT - 6, MOUTH_Y - 2);
    ctx.quadraticCurveTo(FRONT, MOUTH_Y - 0.5, FRONT + 6, MOUTH_Y - 2);
    ctx.quadraticCurveTo(FRONT + 5, MOUTH_Y + 7, FRONT, MOUTH_Y + 7.5);
    ctx.quadraticCurveTo(FRONT - 5, MOUTH_Y + 7, FRONT - 6, MOUTH_Y - 2);
    ctx.fillStyle = '#7a1f1a';
    ctx.fill();
    line(ctx, 1.1);
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y + 5.5, 3.2, 1.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e8716a';
    ctx.fill();
  },
  o(ctx) {
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y + 1, 2.8, 3.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1a';
    ctx.fill();
    line(ctx, 1.1);
  },
  // A big yelling oval with the tongue showing.
  yell(ctx) {
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y + 3, 5.6, 6.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1a';
    ctx.fill();
    line(ctx, 1.2);
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y + 7, 3.4, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e8716a';
    ctx.fill();
  },
  snore(ctx) {
    ctx.beginPath();
    ctx.ellipse(FRONT, MOUTH_Y, 1.8, 2.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1a';
    ctx.fill();
  },
  wavy(ctx) {
    ctx.beginPath();
    ctx.moveTo(FRONT - 6, MOUTH_Y);
    for (let i = 1; i <= 6; i++) ctx.lineTo(FRONT - 6 + i * 2, MOUTH_Y + (i % 2 ? -1.5 : 1.5));
    line(ctx, 1.3);
  },
};

function paintFace(ctx, name) {
  const [eyes, mouth, brows = 'plain'] = EXPRESSIONS[name];
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = hex(COLORS.skin);
  ctx.fillRect(0, 0, W, H);
  // Rosy cheeks: soft radial blush.
  for (const s of [-1, 1]) {
    const cx = FRONT + s * 19;
    const g = ctx.createRadialGradient(cx, 76, 0, cx, 76, 7);
    g.addColorStop(0, COLORS.cheek);
    g.addColorStop(1, 'rgba(242,139,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 8, 68, 16, 16);
  }
  // Eyebrows, just under the hat brim.
  for (const s of [-1, 1]) BROWS[brows](ctx, FRONT + s * (EYE_DX + 1), s);
  // dir: +1 for the eye on the viewer's right, so irises look slightly toward the nose.
  for (const s of [-1, 1]) EYES[eyes](ctx, FRONT + s * EYE_DX, s);
  MOUTHS[mouth](ctx);
}

// Returns get(name) -> THREE.Texture | null (null without a canvas, e.g. in node tests).
export function createFaceTextures() {
  const cache = new Map();
  return (name) => {
    if (!HAS_CANVAS) return null;
    const key = name in EXPRESSIONS ? name : 'open';
    if (!cache.has(key)) {
      cache.set(key, canvasTexture(W * SCALE, H * SCALE, (ctx) => paintFace(ctx, key), { repeat: false }));
    }
    return cache.get(key);
  };
}
