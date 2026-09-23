// Pause overlay: dimmed screen, course name with the collected coins/stars, a big PAUSE
// and a controls legend (gamepad bindings while a pad is connected, else keyboard). Drawn
// into the HUD canvas (logical coords × s).

import { BIG_FONT, SMALL_FONT, measureText } from './bitmapFont.js';
import { ICONS } from './icons.js';
import { drawText, drawIcon, textWidth } from './raster.js';
import { COURSE_NAME, KEY_CONTROLS, PAD_CONTROLS, pauseLayout } from './hudLogic.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// True when the browser reports a connected gamepad (it only does after a button press).
export function gamepadConnected() {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].some((p) => p && p.connected);
}

// Icon × number group, returns its width in device pixels (draws only when `draw`).
function counterGroup(ctx, cache, icon, name, value, x, y, s, draw = true) {
  const iconW = 14 * s;
  const gap = 2 * s;
  const text = `×${value}`;
  const w = iconW + gap + textWidth(BIG_FONT, text, s, true);
  if (draw) {
    drawIcon(ctx, cache, icon, name, x, y, s);
    drawText(ctx, cache, BIG_FONT, text, x + iconW + gap, y + 2 * s, { px: s, fixedDigits: true });
  }
  return w;
}

export function drawPauseScreen(ctx, cache, { W, H, s, coins, stars, gamepad = false }) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.fillStyle = 'rgba(0,0,12,0.5)';
  ctx.fillRect(0, 0, cw, ch);
  const cx = cw / 2;
  const lay = pauseLayout(W, H, (t) => measureText(SMALL_FONT, t), gamepad ? PAD_CONTROLS : KEY_CONTROLS);
  const { top, pauseY, panel, padX, padY, headerH, lineH, legend } = lay;

  drawText(ctx, cache, BIG_FONT, COURSE_NAME, cx, top * s, { px: s, align: 'center' });
  const gw1 = counterGroup(ctx, cache, ICONS.coin, 'coin', coins, 0, 0, s, false);
  const gw2 = counterGroup(ctx, cache, ICONS.star, 'star', stars, 0, 0, s, false);
  const spacing = 16 * s;
  let gx = cx - (gw1 + spacing + gw2) / 2;
  const gy = (top + 16) * s;
  counterGroup(ctx, cache, ICONS.coin, 'coin', coins, gx, gy, s);
  gx += gw1 + spacing;
  counterGroup(ctx, cache, ICONS.star, 'star', stars, gx, gy, s);

  // PAUSE at double size.
  drawText(ctx, cache, BIG_FONT, 'PAUSE', cx, pauseY * s, { px: s * 2, align: 'center' });

  // Controls legend on a dark rounded panel.
  roundRect(ctx, panel.x * s, panel.y * s, panel.w * s, panel.h * s, 4 * s);
  ctx.fillStyle = 'rgba(8,10,40,0.72)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeStyle = 'rgba(255,230,150,0.55)';
  ctx.stroke();

  if (lay.wide) drawText(ctx, cache, SMALL_FONT, 'CONTROLS', cx, (panel.y + padY) * s, { px: s, align: 'center', style: 'key' });
  let x = panel.x + padX;
  for (const col of legend.columns) {
    col.items.forEach(([key, action], row) => {
      const y = (panel.y + padY + headerH + row * lineH) * s;
      drawText(ctx, cache, SMALL_FONT, key, x * s, y, { px: s, style: 'key' });
      drawText(ctx, cache, SMALL_FONT, action, (x + col.keyWidth + legend.gap) * s, y, { px: s, style: 'white' });
    });
    x += col.width + legend.colGap;
  }
}
