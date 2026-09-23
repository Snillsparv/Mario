// UI preview: /preview.html?m=ui&state=full|damaged|lowhp|redcoin|paused|title|glyphs
// Optional overrides: &health=N &coins=N &stars=N &lives=N, &age=S (red-coin pop-up age),
// &world=1 to show the level behind (instead of the plain sky gradient), &pillar=1 to
// confine the UI to a centred 4:3 picture with black bars (like the renderer's F3 mode)
// via setViewport(), or &pillar=1&align=1 by moving the whole UI root over the picture the
// way N64Renderer.alignOverlay() does; &pad=1 fakes a connected gamepad (pause legend).
import { HUD } from '../../ui/HUD.js';
import { TitleScreen } from '../../ui/TitleScreen.js';
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
    // __sfx records emitted sfx names.
    window.__sfx = [];
    events.on('sfx', (e) => window.__sfx.push(e.name));
    const audio = { unlock: () => (window.__unlocked = true), playMusic: (n) => (window.__music = n) };
    const title = new TitleScreen(ui, { events, audio });
    window.__title = title;
    title.setViewport(vp);
    title.show().then(() => (window.__titleDone = true));
    return {};
  }

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
  if (state === 'paused') hud.setPaused(true);
  if (state === 'redcoin') events.emit('coin', { value: 2, red: true, index: 3 });
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
      }
      if (state === 'redcoin') hud.redPopup = frozenPopup;
    },
  };
}
