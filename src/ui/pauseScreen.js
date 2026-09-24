// Pause overlay: dimmed screen, course name with the collected coins/stars, a big PAUSE
// and a controls legend (the touch controller's while it is shown, else gamepad bindings
// while a pad is connected, else keyboard). Drawn into the HUD canvas (logical coords × s).

import { BIG_FONT, SMALL_FONT, measureText } from './bitmapFont.js';
import { ICONS } from './icons.js';
import { drawText, drawIcon, textWidth } from './raster.js';
import { COURSE_NAME, KEY_CONTROLS, PAD_CONTROLS, TOUCH_CONTROLS, PHONE_CONTROL, phoneEntry, pauseLayout } from './hudLogic.js';

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

// The legend for the pause screen: 'touch' | 'pad' | 'keys'. While a phone can join as a
// controller (phoneEntry.enabled), the keys and pad legends end with PHONE_CONTROL.
const WITH_PHONE = new Map([KEY_CONTROLS, PAD_CONTROLS].map((c) => [c, [...c, PHONE_CONTROL]]));
export function controlsLegend(kind) {
  const base = kind === 'touch' ? TOUCH_CONTROLS : kind === 'pad' ? PAD_CONTROLS : KEY_CONTROLS;
  return phoneEntry.enabled && WITH_PHONE.has(base) ? WITH_PHONE.get(base) : base;
}

// Logical rect { x, y, w, h } of legend row `item` (an entry of the legend, e.g.
// PHONE_CONTROL) on the pause screen of a W x H logical screen, or null when not shown. It
// frames the row as drawPauseScreen draws it (ui/PhonePanel.js puts a click target there).
export function pauseItemRect(W, H, kind, item) {
  const lay = pauseLayout(W, H, (t) => measureText(SMALL_FONT, t), controlsLegend(kind));
  const { panel, padX, padY, headerH, lineH, legend } = lay;
  let x = panel.x + padX;
  for (const col of legend.columns) {
    const row = col.items.indexOf(item);
    if (row >= 0) {
      const y = panel.y + padY + headerH + row * lineH;
      const h = Math.min(lineH, 11);
      return { x: x - 3, y: y - (h - 7) / 2 - 1, w: col.width + 6, h: h + 1 };
    }
    x += col.width + legend.colGap;
  }
  return null;
}

export function drawPauseScreen(ctx, cache, { W, H, s, coins, stars, gamepad = false, controls = gamepad ? 'pad' : 'keys' }) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.fillStyle = 'rgba(0,0,12,0.5)';
  ctx.fillRect(0, 0, cw, ch);
  const cx = cw / 2;
  const lay = pauseLayout(W, H, (t) => measureText(SMALL_FONT, t), controlsLegend(controls));
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
  // The phone row reads as a button: a faint gold frame, its action in gold.
  const phone = pauseItemRect(W, H, controls, PHONE_CONTROL);
  if (phone) {
    roundRect(ctx, phone.x * s, phone.y * s, phone.w * s, phone.h * s, 2 * s);
    ctx.fillStyle = 'rgba(255,220,120,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,150,0.35)';
    ctx.stroke();
  }
  let x = panel.x + padX;
  for (const col of legend.columns) {
    col.items.forEach((item, row) => {
      const [key, action] = item;
      const y = (panel.y + padY + headerH + row * lineH) * s;
      drawText(ctx, cache, SMALL_FONT, key, x * s, y, { px: s, style: 'key' });
      drawText(ctx, cache, SMALL_FONT, action, (x + col.keyWidth + legend.gap) * s, y, { px: s, style: item === PHONE_CONTROL ? 'key' : 'white' });
    });
    x += col.width + legend.colGap;
  }
}
