// Power meter: the round 8-wedge health badge at the top of the screen.
// PowerMeterLogic is pure (driven by the 30 Hz HUD update) so its timing is unit-tested;
// drawPowerMeter paints the badge with canvas vector shapes.

export const MAX_HEALTH = 8;
export const METER_HIDE_DELAY = 2; // seconds at full health (out of water) before it slides away
const WEDGE_STEP = 2 / 30; // displayed wedges chase the real health one wedge per 2 ticks

export class PowerMeterLogic {
  constructor() {
    this.visible = false;
    this.fullTime = 0;
    this.lastHealth = null;
    this.displayHealth = MAX_HEALTH;
    this.stepTimer = 0;
  }

  // One simulation tick. `showPower` asks for the meter explicitly (e.g. swimming); any
  // health change or missing health also brings it down. Returns `visible`.
  tick({ health, showPower = false, breath }, dt) {
    const changed = this.lastHealth !== null && health !== this.lastHealth;
    if (this.lastHealth === null) this.displayHealth = health;
    this.lastHealth = health;
    const needed = showPower || health < MAX_HEALTH || (typeof breath === 'number' && breath < 1);
    if (changed || needed) {
      this.visible = true;
      this.fullTime = 0;
    } else if (this.visible) {
      this.fullTime += dt;
      if (this.fullTime >= METER_HIDE_DELAY) this.visible = false;
    }

    if (this.displayHealth === health) {
      this.stepTimer = 0;
    } else {
      this.stepTimer += dt;
      if (this.stepTimer >= WEDGE_STEP - 1e-9) {
        this.stepTimer = 0;
        this.displayHealth += Math.sign(health - this.displayHealth);
      }
    }
    return this.visible;
  }
}

// Wedge colours by health: cyan/blue when high, then green, yellow, red at 1-2.
const PALETTES = {
  blue: { light: '#c8fbff', base: '#34c8f4', dark: '#1458c8' },
  green: { light: '#e0ffc0', base: '#4cd83c', dark: '#12801c' },
  yellow: { light: '#fffcc8', base: '#ffd828', dark: '#d08400' },
  red: { light: '#ffd8c8', base: '#ff4a30', dark: '#a80c0c' },
};

export function meterPaletteName(health) {
  if (health >= 7) return 'blue';
  if (health >= 5) return 'green';
  if (health >= 3) return 'yellow';
  return 'red';
}

export function isLowHealth(health) {
  return health > 0 && health <= 2;
}

const TAU = Math.PI * 2;

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

// Pie slice covering the first `wedges` eighths, clockwise from the top.
function pie(ctx, x, y, r, wedges) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + (wedges * TAU) / 8);
  ctx.closePath();
}

// A small four-point compass star: the explorer's emblem at the centre of the badge.
function compassStar(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.34 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// Draw the badge centred at (cx, cy) with outer radius R (device pixels).
// wedges: number of filled wedges (0..8); flash: 0..1 brightening used for the low-health pulse.
export function drawPowerMeter(ctx, cx, cy, R, wedges, flash = 0) {
  const pal = PALETTES[meterPaletteName(wedges)];
  const line = Math.max(1, R * 0.07);

  // Drop shadow, dark outline and the gold rim with its top-left highlight.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  circle(ctx, cx + R * 0.06, cy + R * 0.08, R);
  ctx.fill();
  ctx.fillStyle = '#1a0c04';
  circle(ctx, cx, cy, R);
  ctx.fill();
  const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rim.addColorStop(0, '#fff3b0');
  rim.addColorStop(0.45, '#f0c040');
  rim.addColorStop(1, '#a86410');
  ctx.fillStyle = rim;
  circle(ctx, cx, cy, R - line);
  ctx.fill();

  // Eight rivets around the rim, one per wedge boundary.
  const rInner = R * 0.76;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 8;
    const rx = cx + Math.cos(a) * R * 0.875;
    const ry = cy + Math.sin(a) * R * 0.875;
    ctx.fillStyle = '#7a4a0c';
    circle(ctx, rx, ry, R * 0.06);
    ctx.fill();
    ctx.fillStyle = '#fff6c8';
    circle(ctx, rx - R * 0.015, ry - R * 0.015, R * 0.03);
    ctx.fill();
  }

  // Inner well, then the wedges (clockwise from the top).
  ctx.fillStyle = '#1a0c04';
  circle(ctx, cx, cy, rInner + line);
  ctx.fill();
  ctx.fillStyle = '#1c2248';
  circle(ctx, cx, cy, rInner);
  ctx.fill();
  const grad = ctx.createRadialGradient(cx - rInner * 0.3, cy - rInner * 0.35, rInner * 0.1, cx, cy, rInner);
  grad.addColorStop(0, pal.light);
  grad.addColorStop(0.45, pal.base);
  grad.addColorStop(1, pal.dark);
  if (wedges > 0) {
    pie(ctx, cx, cy, rInner, wedges);
    ctx.fillStyle = grad;
    ctx.fill();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${0.3 * flash})`;
      ctx.fill();
    }
  }

  // Glassy highlight over the upper-left of the well, under the spokes so they stay crisp:
  // bright on the filled wedges, faint over the empty well.
  const glare = (clip, alpha) => {
    ctx.save();
    clip();
    ctx.clip();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(cx - rInner * 0.28, cy - rInner * 0.5, rInner * 0.62, rInner * 0.34, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  glare(() => circle(ctx, cx, cy, rInner), 0.07);
  if (wedges > 0) glare(() => pie(ctx, cx, cy, rInner, wedges), 0.17);

  // Dark spokes between wedges.
  ctx.strokeStyle = '#1a0c04';
  ctx.lineWidth = line;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 8;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
  }
  ctx.stroke();

  // Centre badge with the compass emblem.
  const rb = R * 0.3;
  ctx.fillStyle = '#1a0c04';
  circle(ctx, cx, cy, rb + line);
  ctx.fill();
  const cream = ctx.createLinearGradient(cx, cy - rb, cx, cy + rb);
  cream.addColorStop(0, '#fffbe8');
  cream.addColorStop(1, '#e8c890');
  ctx.fillStyle = cream;
  circle(ctx, cx, cy, rb);
  ctx.fill();
  compassStar(ctx, cx, cy, rb * 0.82);
  ctx.fillStyle = '#1d948c';
  ctx.fill();
  ctx.lineWidth = Math.max(1, line * 0.6);
  ctx.strokeStyle = '#0f4f48';
  ctx.stroke();
  ctx.fillStyle = '#f0c040';
  circle(ctx, cx, cy, rb * 0.16);
  ctx.fill();
}
