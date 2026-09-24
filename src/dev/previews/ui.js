// UI preview: /preview.html?m=ui&state=full|damaged|lowhp|redcoin|paused|gameover|title|glyphs|dialog|touch
// (state=touch: the touch controller (ui/TouchController.js) under or over the HUD: a window
// taller than wide shows the portrait body, a wider one the landscape overlay. &press=A,B,Z,R,
// START,CU,CD,CL,CR shows those buttons held, &stick=x,y the knob pushed (-1..1, y up; in
// landscape &at=x,y starts it floating there, px), &dpad=up|down|left|right|upleft|... a D-pad
// direction; &paused=1 the pause screen with the touch legend. Real touches work too.
// Hook: __touch (the TouchController), __touchLog (the input states it sent).)
// (state=dialog: the sign dialog box over the HUD. &sign=<layout.SIGNS id> (default welcome),
// &page=N (screen, 0-based; default 1) &progress=0..1 (typed share; default 0.55, 1 = complete
// with its page marker) freeze it; &live=1 types in real time instead (J/K/Space/click press,
// it reopens after the last page); &grid=1 shows four boxes in quarter-size pictures: first
// page typing, a complete page (arrow), a later page typing and the last page complete (end
// marker). Hooks: __dialog (the DialogBox), __sfx (sfx names), __closed (dialogClosed events).)
// (state=gameover: the GameOverCard over a HUD at x0 lives; &hud=0 hides the HUD via
// setVisible(false), in any HUD state)
// (&mute=1 with state=title: muted stand-in audio, so the card skips PRESS ANY KEY)
// Optional overrides: &health=N &coins=N &stars=N &lives=N, &age=S (red-coin pop-up age),
// &world=1 to show the level behind (instead of the plain sky gradient), &pillar=1 to
// confine the UI to a centred 4:3 picture with black bars (like the renderer's F3 mode)
// via setViewport(), or &pillar=1&align=1 by moving the whole UI root over the picture the
// way N64Renderer.alignOverlay() does; &pad=1 fakes a connected gamepad (pause legend).
import { HUD } from '../../ui/HUD.js';
import { TitleScreen } from '../../ui/TitleScreen.js';
import { GameOverCard } from '../../ui/GameOverCard.js';
import { DialogBox } from '../../ui/DialogBox.js';
import { TouchController } from '../../ui/TouchController.js';
import { STICK_DEADZONE, STICK_FULL } from '../../ui/touchLogic.js';
import { SIGNS } from '../../world/layout.js';
import { Events } from '../../core/events.js';
import { BIG_FONT, SMALL_FONT } from '../../ui/bitmapFont.js';
import { ICONS } from '../../ui/icons.js';
import { SpriteCache, drawText, drawIcon } from '../../ui/raster.js';

const STATES = {
  full: { lives: 4, coins: 0, stars: 0, health: 8 },
  damaged: { lives: 4, coins: 23, stars: 1, health: 5 },
  lowhp: { lives: 3, coins: 7, stars: 0, health: 2 },
  redcoin: { lives: 4, coins: 12, stars: 0, health: 8 },
  paused: { lives: 4, coins: 37, stars: 1, health: 6 },
  gameover: { lives: 0, coins: 14, stars: 0, health: 8 },
  dialog: { lives: 4, coins: 3, stars: 0, health: 8 },
  touch: { lives: 4, coins: 12, stars: 1, health: 6 },
};

function skyTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3a78e8');
  grad.addColorStop(0.6, '#8cc0ff');
  grad.addColorStop(0.61, '#5aa840');
  grad.addColorStop(1, '#3c7a2a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Every glyph and icon, enlarged, for checking the pixel art.
function glyphSheet(ui, iconPx) {
  const canvas = document.createElement('canvas');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  canvas.style.cssText = 'position:absolute;inset:0;background:#4a7fd8';
  ui.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const cache = new SpriteCache();
  const px = 4;
  let x = 10;
  let y = 10;
  for (const ch of Object.keys(BIG_FONT.glyphs)) {
    const w = BIG_FONT.glyphs[ch].w * px + 12;
    if (x + w > canvas.width) {
      x = 10;
      y += 52;
    }
    drawText(ctx, cache, BIG_FONT, ch, x, y, { px });
    x += w;
  }
  x = 10;
  y += 60;
  for (const ch of Object.keys(SMALL_FONT.glyphs)) {
    const w = SMALL_FONT.glyphs[ch].w * px + 10;
    if (x + w > canvas.width) {
      x = 10;
      y += 44;
    }
    drawText(ctx, cache, SMALL_FONT, ch, x, y, { px, style: 'white' });
    x += w;
  }
  x = 10;
  y += 56;
  for (const [name, icon] of Object.entries(ICONS)) {
    drawIcon(ctx, cache, icon, name, x, y, iconPx);
    x += iconPx * 18;
  }
}

export async function setup({ THREE, scene, ui, params }) {
  const state = params.get('state') || 'full';
  if (params.get('world')) {
    const { buildLevel } = await import('../../world/level.js');
    const level = buildLevel(scene);
    scene.fog = new THREE.Fog(0xa0c8ff, 9000, 30000);
    return {
      camera: { pos: [0, 900, 7200], look: [0, 600, -2000] },
      update(dt, t) {
        level.update(t, window.__preview?.camera);
      },
      ...runState(state, ui, params),
    };
  }
  scene.background = skyTexture(THREE);
  return runState(state, ui, params);
}

// Centred 4:3 rectangle with black bars around it (a huge outline covers the rest). With
// `align` the UI root itself is moved over the picture (the frame then sits at its origin)
// and null is returned: the UI modules must then simply fill their root.
function pillarbox(ui, align) {
  const width = Math.round((innerHeight * 4) / 3);
  const vp = { x: Math.floor((innerWidth - width) / 2), y: 0, width, height: innerHeight };
  if (align) {
    Object.assign(ui.style, { left: `${vp.x}px`, top: '0px', width: `${width}px`, height: `${vp.height}px`, right: 'auto', bottom: 'auto' });
  }
  const frame = document.createElement('div');
  const x = align ? 0 : vp.x;
  frame.style.cssText = `position:absolute;left:${x}px;top:0;width:${width}px;height:100%;outline:4000px solid #000`;
  ui.appendChild(frame);
  return align ? null : vp;
}

function runState(state, ui, params) {
  if (state === 'glyphs') {
    glyphSheet(ui, Number(params.get('iconPx') || 6));
    return {};
  }
  const vp = params.get('pillar') ? pillarbox(ui, params.get('align')) : null;
  const events = new Events();
  if (params.get('pad')) {
    navigator.getGamepads = () => [{ index: 0, connected: true, buttons: [], axes: [0, 0, 0, 0] }];
  }
  if (state === 'title') {
    // Test hooks: __title is the TitleScreen, __titleDone flips when show() resolves,
    // __sfx records emitted sfx names, __musicLog every playMusic() as [name, audioRunning].
    // The stand-in audio mimics AudioEngine: unlock() "creates" a running context (not
    // while muted: &mute=1), so the card first asks for any key (PRESS ANY KEY).
    window.__sfx = [];
    window.__musicLog = [];
    events.on('sfx', (e) => window.__sfx.push(e.name));
    const audio = {
      muted: params.has('mute'),
      ctx: null,
      unlock() {
        window.__unlocked = true;
        if (!this.muted) this.ctx ??= { state: 'running' };
        return Promise.resolve(!!this.ctx);
      },
      playMusic(name) {
        window.__music = name;
        window.__musicLog.push([name, !!this.ctx]);
      },
    };
    const title = new TitleScreen(ui, { events, audio });
    window.__title = title;
    title.setViewport(vp);
    title.show().then(() => (window.__titleDone = true));
    return {};
  }

  const touch = state === 'touch' ? touchPreview(ui, events, params) : null;
  const hud = new HUD(ui, { events });
  hud.setViewport(vp);
  window.__hud = hud;
  const s = { ...(STATES[state] || STATES.full) };
  for (const k of ['health', 'coins', 'stars', 'lives']) if (params.has(k)) s[k] = Number(params.get(k));
  // Start with counters settled and the meter already slid in, so screenshots are stable.
  hud.coinCounter.shown = s.coins;
  hud.update({ ...s, showPower: false });
  hud.meter.displayHealth = s.health;
  if (hud.meter.visible) hud.slide.t = 1;
  if (state === 'paused' || (touch && params.get('paused'))) hud.setPaused(true);
  if (state === 'redcoin') events.emit('coin', { value: 2, red: true, index: 3 });
  if (params.get('hud') === '0') hud.setVisible(false);
  if (state === 'gameover') {
    const card = new GameOverCard(ui);
    card.setViewport(vp);
    window.__gameOver = card.show();
  }
  const dialogTick = state === 'dialog' ? dialogPreview(ui, events, vp, params) : null;
  // Freeze the red-coin pop-up at a fixed age for screenshots (the HUD's aging is ignored).
  const popupAge = Number(params.get('age') || 0.5);
  const frozenPopup = {
    n: 3,
    get age() {
      return popupAge;
    },
    set age(_) {},
  };
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      while (acc >= 1 / 30) {
        acc -= 1 / 30;
        hud.update(s);
        dialogTick?.();
      }
      if (state === 'redcoin') hud.redPopup = frozenPopup;
    },
  };
}

// Put a box at screen `page` with `progress` of its text typed (frozen: no update() calls).
function freezeDialog(box, page, progress) {
  const lg = box.logic;
  lg.index = Math.max(0, Math.min(lg.screens.length - 1, page));
  lg.count = Math.round(Math.max(0, Math.min(1, progress)) * lg.screen.length);
  lg.wait = 0;
}

// state=dialog. Returns a 30 Hz tick for live mode (null when frozen).
function dialogPreview(ui, events, vp, params) {
  const sign = SIGNS.find((x) => x.id === params.get('sign')) || SIGNS[0];
  window.__sfx = [];
  window.__closed = [];
  events.on('sfx', (e) => window.__sfx.push(e.name));
  events.on('dialogClosed', (e) => window.__closed.push(e));
  if (params.get('grid')) {
    // Four quarter-size pictures (each box scales with its own viewport).
    const W = vp?.width ?? innerWidth;
    const H = vp?.height ?? innerHeight;
    const x0 = vp?.x ?? 0;
    const cells = [
      [0, 0.35],
      [1, 1],
      [1, 0.6],
      [99, 1],
    ];
    window.__dialogs = cells.map(([page, progress], i) => {
      const cell = { x: x0 + (i % 2) * Math.floor(W / 2), y: Math.floor(i / 2) * Math.floor(H / 2), width: Math.floor(W / 2), height: Math.floor(H / 2) };
      const frame = document.createElement('div');
      frame.style.cssText = `position:absolute;left:${cell.x}px;top:${cell.y}px;width:${cell.width}px;height:${cell.height}px;outline:1px solid #fff8;pointer-events:none`;
      ui.appendChild(frame);
      const box = new DialogBox(ui);
      box.setViewport(cell);
      box.open(sign);
      freezeDialog(box, page, progress);
      return box;
    });
    window.__dialog = window.__dialogs[0];
    return null;
  }
  const box = new DialogBox(ui, { events });
  box.setViewport(vp);
  window.__dialog = box;
  events.emit('signRead', { sign });
  if (!params.get('live')) {
    freezeDialog(box, Number(params.get('page') ?? 1), Number(params.get('progress') ?? 0.55));
    return null;
  }
  // Live: keys and clicks press A; the sign reopens a second after its last page.
  let press = false;
  addEventListener('keydown', (e) => {
    if (!e.repeat && ['KeyJ', 'KeyK', 'Space', 'Enter'].includes(e.code)) press = true;
  });
  let reopen = 0;
  events.on('dialogClosed', () => (reopen = 30));
  const up = { down: false, pressed: false, released: false };
  return () => {
    if (reopen > 0 && --reopen === 0) events.emit('signRead', { sign });
    const A = press ? { down: true, pressed: true, released: false } : up;
    press = false;
    box.update({ A, B: up });
  };
}

// state=touch: the controller (forced on) with a stand-in input; the UI root keeps to the
// picture above the portrait body, as the renderer's alignOverlay does in the game.
function touchPreview(ui, events, params) {
  window.__touchLog = [];
  const input = { setTouchState: (st) => window.__touchLog.push({ ...st }), addLookDelta() {} };
  const tc = new TouchController({ input, events, search: '?touch=1', container: document.getElementById('game') });
  window.__touch = tc;
  const L = tc.layout;
  ui.style.bottom = `${L.pictureBottom}px`;
  let id = 0;
  const hold = (x, y, to) => {
    const t = `p${id++}`;
    tc._pointer('start', t, x, y);
    if (to) tc._pointer('move', t, to[0], to[1]);
  };
  for (const b of (params.get('press') || '').split(',').filter((b) => L.buttons[b])) hold(L.buttons[b].x, L.buttons[b].y);
  if (params.get('stick')) {
    // The thumb offset that gives this push (inverse of touchLogic.stickVector).
    const [sx, sy] = params.get('stick').split(',').map(Number);
    const at = params.get('at')?.split(',').map(Number) ?? [L.stick.x, L.stick.y];
    const m = Math.min(1, Math.hypot(sx, sy));
    const d = m > 0 ? L.stick.travel * (STICK_DEADZONE + m * (STICK_FULL - STICK_DEADZONE)) : 0;
    const n = Math.hypot(sx, sy) || 1;
    hold(at[0], at[1], [at[0] + (sx / n) * d, at[1] - (sy / n) * d]);
  }
  const dir = params.get('dpad');
  if (dir) {
    const d = L.dpad;
    const ox = (dir.includes('left') ? -1 : 0) + (dir.includes('right') ? 1 : 0);
    const oy = (dir.includes('up') ? -1 : 0) + (dir.includes('down') ? 1 : 0);
    hold(d.x + ox * d.size * 0.35, d.y + oy * d.size * 0.35);
  }
  return tc;
}
