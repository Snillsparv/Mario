// Areas in the real game (Vite dev server, headless Chromium), opt-in: E2E=1. With ?test=1: walking
// up to the castle door starts the warp (AI RACE switched on while it closes is ignored); the iris
// (a canvas under the HUD) closes on Jonas, black at the corners and clear on him; 40 steps later
// he is in the Great Hall: the picture is the hall's warm fog and walls, not the sky, in fewer than
// 45 draw calls, and the pause screen names the course; setDark(true) in the hall is ignored; the
// inner door takes him back out onto the porch with the camera in front of him. The full walk: in
// through the castle door (its leaves swing in onto the dark passage), north up the hall into the
// bottle (Jonas shrinks into it), the course, out of it from the pause screen, south down the hall
// and out of the inner door onto the porch, the castle door standing open and shutting behind him.
// ?area=hall boots straight into the hall (its furnished picture, and the bottle's end from the
// landing, each in fewer than 45 draw calls; the hall's own textures at most 128 px), and a stick
// held forward through the inner door walks him on out across the porch instead of back in.
// ?area=skerries boots into Midsummer Skerries (its course card over the picture, the sky and the
// sea, fewer than 55 draw calls, its textures at most 128 px, its build time logged); paused while
// he drops in, the pause screen offers no way out and B does nothing; the star on the lighthouse
// gallery takes him back out of the bottle into the hall, one star up, the lighthouse and the
// little one in the bottle lit (out again after GAME OVER); paused while reading the welcome sign,
// the pause screen offers the way out (the touch B kept bright) and B closes the sign and leaves
// the course; and a life lost at x0 there ends in the GAME OVER card, then the title over the
// grounds. With sound (a real AudioContext, unlocked by a key press): the hall plays its waltz
// under its room tone and hearth with every sound in its reverb, the course its polska with the
// sea's laps and gulls, the grounds none of that again; the new sounds all play, and the audio
// never gives up on an error. No page errors anywhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = !process.env.E2E && 'browser test: set E2E=1 to run';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query = '', { sound = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?test=1${sound ? '' : '&mute=1'}${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  // Walk toward world yaw `yaw` (the stick worked out from the camera each tick) until a warp
  // starts, at most n ticks; returns the warp.
  await page.evaluate(() => {
    window.__walkTo = (yaw, n) => {
      const g = window.__game;
      for (let i = 0; i < n && !g.snapshot().warp; i++) {
        const a = Math.atan2(Math.sin(g.camera.getYaw() - yaw), Math.cos(g.camera.getYaw() - yaw));
        g.step(1, { stickX: Math.sin(a), stickY: Math.cos(a) });
      }
      return g.snapshot().warp;
    };
  });
  const step = (n, input = null) => page.evaluate(([k, i]) => window.__game.step(k, i), [n, input]);
  const snap = () => page.evaluate(() => window.__game.snapshot());
  return { page, errors, step, snap };
}

// The drawn picture: draw calls and a few pixels (read right after a draw, before the swap).
const frame = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    g.render();
    const gl = g.view.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const pixels = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.8], [0.2, 0.6], [0.8, 0.6]]) {
      gl.readPixels(Math.floor(fx * w), Math.floor(fy * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      pixels.push([px[0], px[1], px[2]]);
    }
    return { calls: g.view.renderer.info.render.calls, triangles: g.view.renderer.info.render.triangles, pixels };
  });

// The sky's blue (FOG_COLOR, the grounds' horizon) and anything like it.
const skyBlue = ([r, g, b]) => b > r + 40 && b > 150;

test('through the castle door into the Great Hall and back out onto the porch', { skip, timeout: 600000 }, async (t) => {
  const { page, errors, step, snap } = await open();
  try {
    await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(0, 300, -460, Math.PI); // on the porch, facing the door
      g.player.setAction('idle');
      g.camera.reset(g.player);
    });
    const warp = await page.evaluate(() => window.__walkTo(Math.PI, 30));
    assert.deepEqual(warp, { phase: 'close', to: 'hall', entry: 'front', kind: 'door' });
    // AI RACE cannot start while the door takes him in (the storm stays on the grounds).
    await page.evaluate(() => window.__game.setDark(true));
    // Half way through the close: the iris shows under the HUD, black at the corners, clear on Jonas.
    await step(7);
    const iris = await page.evaluate(() => {
      const g = window.__game;
      const c = document.querySelector('.cg-wipe');
      const ctx = c.getContext('2d');
      const hero = g.model.object3D.position.clone();
      hero.y += 100;
      hero.project(g.view.camera);
      const at = (x, y) => ctx.getImageData(Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y)), 1, 1).data[3];
      return {
        display: getComputedStyle(c).display,
        underHud: !!(c.compareDocumentPosition(g.hud.el) & Node.DOCUMENT_POSITION_FOLLOWING),
        corner: at(0, 0),
        hero: at(((hero.x + 1) / 2) * c.width, ((1 - hero.y) / 2) * c.height),
        amount: g.areas.wipe(1).amount,
      };
    });
    assert.equal(iris.display, 'block');
    assert.ok(iris.underHud, 'the HUD draws over it');
    assert.equal(iris.corner, 255);
    assert.equal(iris.hero, 0);
    assert.ok(iris.amount > 0.3 && iris.amount < 0.7, `${iris.amount}`);
    await step(40);
    let s = await snap();
    assert.equal(s.area, 'hall');
    assert.equal(s.warp, null);
    assert.equal(await page.evaluate(() => window.__game.state.dark), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cg-wipe')).display), 'none');
    const hall = await frame(page);
    t.diagnostic(`hall: ${hall.calls} draw calls, ${hall.triangles} triangles, built in ${(await page.evaluate(() => window.__game.areas.buildMs.hall)).toFixed(1)} ms`);
    assert.ok(hall.calls < 45, `${hall.calls} draw calls`);
    for (const p of hall.pixels) assert.ok(!skyBlue(p), `no sky in the hall: ${p}`);
    // The pause screen names the course.
    await step(1, { START: true });
    assert.equal(await page.evaluate(() => window.__game.hud.course), 'THE GREAT HALL');
    await step(1); // (START let go, so the next press is a fresh one)
    await step(1, { START: true });
    assert.equal((await snap()).mode, 'play');
    assert.equal(await page.evaluate(() => window.__game.state.paused), false);
    // AI RACE cannot start indoors.
    await page.evaluate(() => window.__game.setDark(true));
    await step(10);
    assert.equal(await page.evaluate(() => window.__game.state.dark), false);
    // South through the inner door: back on the porch, walking out, the camera in front of him.
    const out = await page.evaluate(() => window.__walkTo(0, 150));
    assert.deepEqual(out, { phase: 'close', to: 'grounds', entry: 'porch', kind: 'door' });
    await step(40);
    s = await snap();
    assert.equal(s.area, 'grounds');
    assert.ok(Math.abs(s.pos.x) < 5 && s.pos.z > -470 && s.pos.z < -250 && s.pos.y > 200, JSON.stringify(s.pos));
    assert.ok(s.cameraPos[2] > s.pos.z + 800, `camera in front of him: ${s.cameraPos.map(Math.round)}`);
    assert.equal(await page.evaluate(() => window.__game.hud.course), 'CASTLE GROUNDS');
    const grounds = await frame(page);
    assert.ok(grounds.calls > hall.calls, `the grounds are back: ${grounds.calls} calls`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the full walk: in through the castle door (its leaves swing in), up the hall into the bottle (he shrinks into it), the course, out from the pause screen, down the hall and out of the inner door (the castle door shutting behind him on the porch)', { skip, timeout: 600000 }, async () => {
  const { page, errors, step, snap } = await open();
  // How far the castle door's left leaf stands turned, whether its passage shows, Jonas's size.
  const looks = () =>
    page.evaluate(() => {
      const g = window.__game;
      const castle = g.level.parts.find((p) => p.name === 'castle').object3D;
      return { leaf: castle.getObjectByName('castle-door-left').rotation.y, passage: castle.getObjectByName('castle-doorway').visible, scale: g.model.object3D.scale.y };
    });
  try {
    await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(0, 300, -460, Math.PI); // on the porch, facing the door
      g.player.setAction('idle');
      g.camera.reset(g.player);
    });
    assert.deepEqual(await looks(), { leaf: 0, passage: false, scale: 1 });
    let warp = await page.evaluate(() => window.__walkTo(Math.PI, 30));
    assert.deepEqual(warp, { phase: 'close', to: 'hall', entry: 'front', kind: 'door' });
    await step(7);
    let l = await looks();
    assert.ok(l.leaf > 0.2 && l.leaf < 1.3 && l.passage && l.scale === 1, `the door swinging in: ${JSON.stringify(l)}`);
    // Near the end of the close he is drawn stepping on into its opening (where he stands, the
    // door's collider stops him).
    await step(6);
    const into = await page.evaluate(() => {
      const g = window.__game;
      return { drawn: g.model.object3D.position.z, stands: g.player.pos.z };
    });
    assert.ok(into.stands > -650 && into.drawn < into.stands - 80, `stepping in: ${JSON.stringify(into)}`);
    await step(34);
    assert.equal((await snap()).area, 'hall');
    assert.deepEqual(await looks(), { leaf: 0, passage: false, scale: 1 }, 'the castle door shut behind him');
    // North up the hall, up the stairs, into the bottle's neck: he shrinks as the iris closes.
    warp = await page.evaluate(() => window.__walkTo(Math.PI, 400));
    assert.deepEqual(warp, { phase: 'close', to: 'skerries', entry: 'arrival', kind: 'bottle' });
    await step(9);
    l = await looks();
    assert.ok(l.scale < 0.8 && l.scale > 0.35, `shrinking: ${l.scale}`);
    // The iris closes on his chest as it is now, lower with his size: the hole's middle (its
    // widest rows; it may run off the bottom of the screen) where his chest is drawn, not where
    // it stood at his full size.
    const hole = await page.evaluate(() => {
      const g = window.__game;
      const c = document.querySelector('.cg-wipe');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const onScreen = (k) => {
        const v = g.model.object3D.position.clone();
        v.y += 100 * k;
        v.project(g.view.camera);
        return { x: ((v.x + 1) / 2) * c.width, y: ((1 - v.y) / 2) * c.height };
      };
      const now = onScreen(g.model.object3D.scale.y);
      const full = onScreen(1);
      const widths = [];
      for (let y = 0; y < c.height; y++) {
        let n = 0;
        for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3] === 0) n++;
        widths.push(n);
      }
      const most = Math.max(...widths);
      const widest = widths.map((n, y) => (n === most ? y + 0.5 : -1)).filter((y) => y >= 0);
      return { middle: widest.reduce((a, b) => a + b, 0) / widest.length, width: most, now: now.y, full: full.y };
    });
    assert.ok(hole.width > 8 && Math.abs(hole.middle - hole.now) <= 2, `the hole at ${hole.middle}, his chest at ${hole.now}`);
    assert.ok(hole.now - hole.full > 3, `his chest ${hole.now - hole.full} px lower than at his full size`);
    await step(40);
    let s = await snap();
    assert.equal(s.area, 'skerries');
    assert.equal((await looks()).scale, 1, 'his own size again');
    await step(60); // dropped in onto the jetty
    // Paused, B: back out of the bottle onto the hall's landing.
    await step(1, { START: true });
    await step(1, { B: true });
    assert.equal((await snap()).warp?.kind, 'leave');
    await step(60);
    s = await snap();
    assert.deepEqual([s.area, s.warp], ['hall', null]);
    // South down the stairs and the hall to the inner door, and out onto the porch: the castle
    // door stands open as the picture opens and shuts behind him as he walks out.
    warp = await page.evaluate(() => window.__walkTo(0, 400));
    assert.deepEqual(warp, { phase: 'close', to: 'grounds', entry: 'porch', kind: 'door' });
    await step(18);
    l = await looks();
    assert.ok(l.leaf > 1.3 && l.passage, `standing open at the switch: ${JSON.stringify(l)}`);
    await step(30);
    s = await snap();
    assert.equal(s.area, 'grounds');
    assert.ok(Math.abs(s.pos.x) < 5 && s.pos.z > -470 && s.pos.y > 200, JSON.stringify(s.pos));
    assert.deepEqual(await looks(), { leaf: 0, passage: false, scale: 1 }, 'shut behind him');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?area=hall boots straight into the Great Hall; forward held through the inner door walks him on out', { skip, timeout: 300000 }, async () => {
  const { page, errors, snap } = await open('&area=hall');
  try {
    const s = await snap();
    assert.equal(s.area, 'hall');
    assert.deepEqual([s.pos.x, s.pos.y, s.pos.z], [0, 0, -60000 + 1550]);
    const f = await frame(page);
    assert.ok(f.calls < 45, `${f.calls} draw calls`);
    for (const p of f.pixels) assert.ok(!skyBlue(p), `no sky in the hall: ${p}`);
    // Out of the bottle onto the landing, looking past him at the bottle and its model.
    await page.evaluate(() => {
      window.__game.enterArea('hall', 'bottle');
      window.__game.step(20);
    });
    const end = await frame(page);
    assert.ok(end.calls < 45, `the bottle's end: ${end.calls} draw calls`);
    const sizes = await page.evaluate(async () => {
      const textures = await import('/src/world/hall/textures.js');
      return Object.entries(textures).map(([name, make]) => {
        const { image } = make();
        return [name, image.width, image.height];
      });
    });
    assert.ok(sizes.length > 0);
    for (const [name, w, h] of sizes) assert.ok(w <= 128 && h <= 128, `${name}: ${w} x ${h}`);
    // Facing the inner door with the camera behind him, forward held all the way: out onto the
    // porch (where the camera looks at the door) and on away from it, not back in.
    const run = await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(0, 0, -60000 + 2000, 0);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      const areas = [];
      g.events.on('areaChange', (e) => areas.push(e.to));
      for (let n = 0; n < 150 && !(areas.length && g.snapshot().warp === null); n++) g.step(1, { stickY: 1 });
      g.step(90, { stickY: 1 });
      return { areas, area: g.area, z: g.snapshot().pos.z };
    });
    assert.deepEqual(run.areas, ['grounds']);
    assert.equal(run.area, 'grounds');
    assert.ok(run.z > 0, `walked out across the courtyard: z ${Math.round(run.z)}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('?area=skerries: Midsummer Skerries, its card and sky; its star takes him back out of the bottle; pause and B leave it (not while he drops in, also while he reads); GAME OVER there returns to the grounds', { skip, timeout: 600000 }, async (t) => {
  const { page, errors, step, snap } = await open('&area=skerries');
  // The pause state: paused, the pause screen's leave line, the touch controller's bright B.
  const pause = () =>
    page.evaluate(() => ({
      paused: window.__game.state.paused,
      leave: window.__game.hud.leave,
      touchB: document.querySelector('.cg-touch').classList.contains('cg-leave'),
    }));
  try {
    let s = await snap();
    assert.equal(s.area, 'skerries');
    assert.equal(s.action, 'spawn', 'dropping in onto the jetty');
    // Paused while he drops in: no way out offered, and B does nothing.
    await step(1, { START: true });
    assert.deepEqual(await pause(), { paused: true, leave: false, touchB: false });
    await step(1, { B: true });
    assert.deepEqual(await pause(), { paused: true, leave: false, touchB: false });
    assert.equal((await snap()).warp, null);
    await step(1);
    await step(1, { START: true });
    assert.equal((await pause()).paused, false);
    await step(60);
    s = await snap();
    assert.ok(Math.abs(s.pos.x - 60000 + 830) < 1 && Math.abs(s.pos.y - 150) < 1 && Math.abs(s.pos.z - 1700) < 1, JSON.stringify(s.pos));
    assert.ok(s.cameraPos[2] > s.pos.z + 800, 'the camera behind him');
    assert.equal(await page.evaluate(() => window.__game.hud.card?.text), 'MIDSUMMER SKERRIES', 'the course card');
    const f = await frame(page);
    const built = await page.evaluate(() => window.__game.areas.buildMs.skerries);
    t.diagnostic(`skerries: ${f.calls} draw calls, ${f.triangles} triangles, built in ${built.toFixed(1)} ms`);
    assert.ok(f.calls < 55, `${f.calls} draw calls`);
    assert.ok(built < 450, `the first entry's hitch: built in ${built} ms`);
    assert.ok(skyBlue(f.pixels[0]) || f.pixels.some(skyBlue), `sky over the bay: ${JSON.stringify(f.pixels)}`);
    const sizes = await page.evaluate(async () => {
      const textures = await import('/src/world/skerries/textures.js');
      return Object.entries(textures).map(([name, make]) => {
        const { image } = make();
        return [name, image.width, image.height];
      });
    });
    assert.ok(sizes.length >= 3);
    for (const [name, w, h] of sizes) assert.ok(w <= 128 && h <= 128, `${name}: ${w} x ${h}`);

    // The star: on the gallery just south of it, walking north into it.
    const star = await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(60000 + 440, 2750, -4600 + 250, Math.PI);
      g.player.setAction('idle');
      g.camera.reset(g.player);
      let n = 0;
      for (; n < 300 && g.area !== 'hall'; n++) {
        const a = Math.atan2(Math.sin(g.camera.getYaw() - Math.PI), Math.cos(g.camera.getYaw() - Math.PI));
        g.step(1, n < 20 ? { stickX: Math.sin(a), stickY: Math.cos(a) } : null);
      }
      g.step(20);
      const course = g.areas.built.skerries.parts.find((p) => p.name === 'skerries');
      const lamp = g.areas.current.root.getObjectByName('hall-lamp');
      return { n, area: g.area, stars: g.player.stars, warp: g.snapshot().warp, lit: course.lit, lamp: lamp.visible };
    });
    assert.equal(star.area, 'hall', JSON.stringify(star));
    assert.ok(star.n < 300);
    assert.equal(star.stars, 1);
    assert.equal(star.warp, null);
    assert.deepEqual([star.lit, star.lamp], [true, true], 'the lighthouse and the one in the bottle lit');

    // Back in, then out from the pause screen, paused while reading the welcome sign (whose
    // last page says to): the way out is offered, and B closes the sign and leaves.
    await page.evaluate(() => window.__game.enterArea('skerries'));
    await step(60);
    await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport(60000 - 990, 150, 1330, Math.PI); // in front of the welcome sign
      g.player.setAction('idle');
      g.camera.reset(g.player);
    });
    await step(1, { B: true });
    assert.deepEqual(await page.evaluate(() => [window.__game.player.action, window.__game.dialog.isOpen]), ['reading', true]);
    await step(1, { START: true });
    assert.deepEqual(await pause(), { paused: true, leave: true, touchB: true });
    await step(1, { B: true });
    assert.equal((await pause()).paused, false, 'B unpaused...');
    assert.equal((await snap()).warp?.kind, 'leave', '...and leaves');
    assert.equal(await page.evaluate(() => window.__game.dialog.isOpen), false, 'the sign closed');
    await step(60);
    s = await snap();
    assert.equal(s.area, 'hall');
    assert.equal(s.warp, null);

    // GAME OVER in the course: the card, then the grounds behind the title.
    await page.evaluate(() => window.__game.enterArea('skerries'));
    await step(60);
    await page.evaluate(() => {
      const g = window.__game;
      g.state.lives = 0;
      g.player.loseLife();
      g.step(2);
    });
    assert.equal((await snap()).mode, 'gameover');
    await page.waitForTimeout(4500);
    s = await snap();
    assert.equal(s.area, 'grounds');
    assert.equal(s.mode, 'title');
    assert.equal(s.stars, 0, 'the star taken back');
    assert.equal(await page.evaluate(() => window.__game.areas.built.skerries.parts.find((p) => p.name === 'skerries').lit), false, 'the lamp out');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('with sound: the hall\'s waltz, room tone, hearth and reverb; the course\'s polska, laps and gulls; none of it back on the grounds; no audio error', { skip, timeout: 300000 }, async () => {
  const { page, errors, step } = await open('&area=hall', { sound: true });
  try {
    const warnings = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    await page.keyboard.press('Shift'); // a user gesture: audio unlocks
    await page.waitForFunction(() => window.__game.audio.ctx?.state === 'running', null, { timeout: 30000 });
    // The hall's loop, asked for before audio existed, starts a moment after the key is let go.
    await page.waitForFunction(() => window.__game.audio.track?.name === 'castle_hall', null, { timeout: 10000 });
    // What the ambience plays from now on, by recipe name.
    await page.evaluate(() => {
      const amb = window.__game.audio.ambience;
      const playAt = amb.playAt;
      window.__heard = [];
      amb.playAt = (recipe, pos, volume) => {
        window.__heard.push(recipe.name);
        playAt(recipe, pos, volume);
      };
    });
    const sound = () =>
      page.evaluate(() => {
        const a = window.__game.audio;
        return { area: window.__game.area, track: a.track?.name ?? null, profile: a.area, reverb: a.reverb, warned: a.warned };
      });
    // What it played since the last call; play(n): after n steps more, a step at a time (each
    // runs the audio's update once).
    const heard = () => page.evaluate(() => [...new Set(window.__heard.splice(0))].sort());
    const play = (n) => page.evaluate((k) => {
      for (let i = 0; i < k; i++) window.__game.step(1);
    }, n).then(heard);
    assert.deepEqual(await sound(), { area: 'hall', track: 'castle_hall', profile: 'hall', reverb: true, warned: false });
    await heard();
    assert.deepEqual(await play(120), ['fire_crackle'], 'the hearth, no birds');
    const played = await page.evaluate(() => {
      const a = window.__game.audio;
      return ['door_rattle', 'bottle_dive', 'bottle_pop', 'jump'].map((n) => a.play(n, { pos: { ...a.listener } }));
    });
    assert.deepEqual(played, [true, true, true, true]);
    assert.equal(await page.evaluate(() => !!window.__game.audio.room), true, 'the send into the hall reverb');
    await heard();
    // (The gulls' first call comes at once: their clock ran on in the hall; then every 4-10 s.)
    await page.evaluate(() => window.__game.enterArea('skerries', 'arrival'));
    assert.deepEqual(await sound(), { area: 'skerries', track: 'skerries', profile: 'sea', reverb: false, warned: false });
    assert.deepEqual(await play(150), ['gull', 'slosh'], 'the sea\'s laps and a gull');
    await page.evaluate(() => window.__game.enterArea('grounds', 'start'));
    assert.deepEqual(await sound(), { area: 'grounds', track: null, profile: 'grounds', reverb: false, warned: false });
    await heard();
    assert.ok(!(await play(120)).some((n) => n === 'fire_crackle' || n === 'gull'));
    assert.deepEqual(warnings.filter((w) => w.includes('audio')), []);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
