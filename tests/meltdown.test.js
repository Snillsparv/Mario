// AI RACE's 40-second doomsday clock (src/fx/Meltdown.js) in node: it starts with the mode,
// warns at 30 s, catches fire at 40 s (the point of no return), blooms the light at 46 s,
// is all white at 53 s and asks for GAME OVER once, a second later; the mode turning off before
// 40 s cancels it (the warning glow fades out), not after; only update() advances it (main
// calls it only while playing, so paused time does not count); a new race starts fresh; the
// look it hands the renderer, the sky, the effects, the audio and the camera shake over time;
// the klaxon, the burning trees and the shockwave's jolt; reset() turns everything off.
// The camera shake's rumble lives here too. The browser run: tests/meltdown-browser.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../src/core/events.js';
import { FRAME_DT } from '../src/core/constants.js';
import { Meltdown, MELTDOWN, levelsAt, meltdownLevels, lightAnchor, placeOrb } from '../src/fx/Meltdown.js';
import { CameraShake, SHAKE } from '../src/camera/shake.js';

const ticks = (s) => Math.round(s / FRAME_DT);

// A Meltdown with recording targets; `run(seconds)` ticks it with a camera at the spawn.
function setup({ trees = [] } = {}) {
  const events = new Events();
  const log = [];
  const sfx = [];
  events.on('meltdown', (e) => log.push(e));
  events.on('sfx', (e) => sfx.push(e));
  const calls = { view: [], level: [], fx: [], audio: [], rumble: [], kicks: [], ignite: [] };
  const rec = (name) => ({ setMeltdown: (L) => calls[name].push({ ...L }) });
  const targets = {
    view: rec('view'),
    level: rec('level'),
    fx: { ...rec('fx'), ignite: (x, y, z, o) => calls.ignite.push({ x, y, z, ...o }) },
    audio: rec('audio'),
    shake: { setRumble: (r) => calls.rumble.push(r), kick: (s) => calls.kicks.push(s) },
  };
  const m = new Meltdown({ events, targets, trees });
  const cam = { x: 0, y: 500, z: 7000 };
  const results = [];
  const run = (seconds, yaw = Math.PI) => {
    for (let i = 0; i < ticks(seconds); i++) {
      const r = m.update(cam, yaw);
      if (r) results.push({ r, t: m.seconds });
    }
  };
  const phases = () => log.map((e) => e.phase);
  return { m, events, log, sfx, calls, run, results, phases, cam };
}

test('the clock starts with AI RACE mode and runs through its phases at 30, 40, 46, 53 and 54 s', () => {
  const { m, events, run, log, phases, results } = setup();
  assert.equal(m.phase, 'idle');
  run(5);
  assert.equal(m.seconds, 0, 'nothing counts before the mode is on');
  events.emit('darkMode', { on: true });
  assert.equal(m.phase, 'race');
  assert.equal(m.running, true);
  run(29.9);
  assert.equal(m.phase, 'race');
  assert.deepEqual(phases(), []);
  run(0.2);
  assert.equal(m.phase, 'warning');
  assert.equal(m.doomed, false);
  assert.ok(Math.abs(log[0].seconds - MELTDOWN.WARN) < 1e-9, `warning at ${log[0].seconds}`);
  run(10);
  assert.equal(m.phase, 'fire');
  assert.equal(m.doomed, true, 'the point of no return');
  assert.ok(Math.abs(log[1].seconds - MELTDOWN.DOOM) < 1e-9);
  run(6);
  assert.equal(m.phase, 'light');
  assert.ok(Math.abs(log[2].seconds - MELTDOWN.LIGHT) < 1e-9);
  run(7);
  assert.equal(m.phase, 'white');
  assert.equal(m.levels.white, 1, 'all white');
  assert.ok(Math.abs(log.find((e) => e.phase === 'white').seconds - MELTDOWN.WHITE) < 1e-9);
  assert.equal(results.length, 0, 'no game over yet: the white holds a second');
  run(1.5);
  assert.equal(m.phase, 'over');
  assert.equal(results.length, 1, 'GAME OVER asked for once');
  assert.ok(Math.abs(results[0].t - (MELTDOWN.WHITE + MELTDOWN.HOLD)) < 1e-9, `at ${results[0].t}`);
  run(5);
  assert.equal(results.length, 1, 'and only once');
  assert.equal(m.running, false, 'the clock stops at the end');
  assert.deepEqual(phases(), ['warning', 'fire', 'light', 'shock', 'white', 'over']);
});

test('before 40 s the mode turning off cancels it (STOP, Rustmaw, a game over): the glow fades; a new race starts fresh', () => {
  const { m, events, run, log, calls } = setup();
  events.emit('darkMode', { on: true });
  run(35);
  const warn = m.levels.warn;
  assert.ok(warn > 0.3);
  events.emit('darkMode', { on: false }); // pounding STOP (or Rustmaw's defeat, or a game over)
  assert.equal(m.phase, 'idle');
  assert.equal(m.running, false);
  assert.deepEqual(log.at(-1), { phase: 'cancelled', seconds: 35, warned: true });
  // The glow fades out over CANCEL_FADE, then the targets get a look of all 0.
  run(MELTDOWN.CANCEL_FADE / 2);
  assert.ok(m.levels.warn > 0 && m.levels.warn < warn, 'fading');
  run(MELTDOWN.CANCEL_FADE);
  assert.equal(m.levels.warn, 0);
  assert.equal(calls.view.at(-1).warn, 0);
  assert.equal(calls.view.at(-1).fire, 0);
  const n = calls.view.length;
  run(3);
  assert.equal(calls.view.length, n, 'nothing more while it is all 0');
  // Before the warning a cancel is quiet.
  events.emit('darkMode', { on: true });
  assert.equal(m.seconds, 0, 'a fresh 40 s');
  run(10);
  events.emit('darkMode', { on: false });
  assert.deepEqual(log.at(-1), { phase: 'cancelled', seconds: 10, warned: false });
  // AI RACE again (after Rustmaw's defeat): a fresh 40 s, warned again at 30 s.
  events.emit('darkMode', { on: true });
  run(30.05);
  assert.equal(m.phase, 'warning');
  assert.equal(log.filter((e) => e.phase === 'warning').length, 2);
});

test('from 40 s nothing but a reset ends it: the mode turning off is ignored', () => {
  const { m, events, run, results } = setup();
  events.emit('darkMode', { on: true });
  run(40.1);
  assert.equal(m.doomed, true);
  events.emit('darkMode', { on: false });
  assert.equal(m.phase, 'fire');
  events.emit('darkMode', { on: true }); // (and on again does not restart it)
  run(1);
  assert.ok(m.seconds > 41);
  run(14);
  assert.equal(results.length, 1);
  assert.equal(m.phase, 'over');
});

test('only update() advances the clock: main calls it while playing, so paused time does not count', () => {
  const { m, events, run } = setup();
  events.emit('darkMode', { on: true });
  run(12);
  const s = m.seconds;
  // A paused game (or the title, or the game-over card) calls nothing: the clock stands.
  for (let i = 0; i < 100; i++) assert.equal(m.seconds, s);
  run(1);
  assert.ok(Math.abs(m.seconds - (s + 1)) < 1e-9);
  assert.equal(Object.getOwnPropertyNames(Meltdown.prototype).includes('tick'), false, 'no second clock');
});

test('levelsAt: the look over time (warning glow, fire, light, exponential white-out)', () => {
  const at = (s) => levelsAt(s);
  const zero = at(29.9);
  for (const k of ['warn', 'fire', 'light', 'white', 'glow', 'glare', 'shimmer', 'embers', 'rumble', 'ring']) assert.equal(zero[k], 0, k);
  // The warning glows at once and grows to 1 by 40 s; nothing else yet.
  assert.ok(at(30.5).warn > 0.1);
  let last = 0;
  for (let s = 30; s <= 40; s += 0.5) {
    const L = at(s);
    assert.ok(L.warn >= last, `warn grows at ${s}`);
    assert.equal(L.fire, 0);
    last = L.warn;
  }
  assert.equal(at(40).warn, 1);
  // The fire sweeps in over FIRE_SPREAD; embers with it; the light waits for 46 s.
  assert.equal(at(39.99).fire, 0);
  assert.ok(at(40.5).fire > 0 && at(40.5).fire < 1);
  assert.equal(at(40 + MELTDOWN.FIRE_SPREAD).fire, 1);
  assert.equal(at(42).embers, 1);
  assert.equal(at(45.9).light, 0);
  assert.equal(at(45.9).white, 0);
  // The light: the glow flares up, the glare flashes then settles, the white grows
  // exponentially to 1 at 53 s and stays.
  assert.equal(at(46 + MELTDOWN.GLARE_IN).glow, 1);
  assert.ok(at(46.5).glare > at(48).glare, 'the first flash settles');
  last = 0;
  for (let s = 46; s <= 53; s += 0.25) {
    const L = at(s);
    assert.ok(L.white >= last, `white grows at ${s}`);
    last = L.white;
  }
  assert.ok(at(49.5).white < 0.15, `slow at first: ${at(49.5).white}`);
  assert.ok(at(52).white > 0.4, `then fast: ${at(52).white}`);
  assert.equal(at(53).white, 1);
  assert.equal(at(60).white, 1);
  assert.ok(at(53).glare > 0.99, 'the glare grows back with the white');
  // The shockwave leaves the light's foot RING_DELAY after it and races out.
  assert.equal(at(46 + MELTDOWN.RING_DELAY - 0.01).ring, 0);
  assert.ok(Math.abs(at(48).ring - (2 - MELTDOWN.RING_DELAY) * MELTDOWN.RING_SPEED) < 1e-6);
  // The rumble and shimmer grow with the light.
  assert.ok(at(52).rumble > at(47).rumble && at(47).rumble > 0);
  assert.ok(at(52).shimmer > at(42).shimmer && at(42).shimmer > 0);
});

test('the light blooms in view, right of where the camera looks, far off, and rises as it swells', () => {
  const a = lightAnchor(0, 500, 7000, Math.PI); // looking toward -z (the castle)
  const d = Math.hypot(a.gx, a.gz - 7000);
  assert.ok(Math.abs(d - MELTDOWN.LIGHT_DIST) < 1e-6);
  assert.ok(a.gz < 7000 - MELTDOWN.LIGHT_DIST * 0.9, 'ahead');
  assert.ok(a.gx > 0, 'to the right (+x when looking toward -z)');
  const o = {};
  let lastY = -Infinity;
  let lastR = 0;
  for (let l = 0; l <= 1.0001; l += 0.1) {
    placeOrb(l, a, o);
    assert.ok(o.ly > lastY && o.lr > lastR, 'rises and swells');
    lastY = o.ly;
    lastR = o.lr;
  }
  placeOrb(0, a, o);
  assert.ok(Math.abs(Math.atan((o.ly - 500) / MELTDOWN.LIGHT_DIST) - MELTDOWN.ORB_ELEV[0]) < 1e-9);
  assert.equal(o.lr, MELTDOWN.ORB_RADIUS[0], 'a point of light at first');
  placeOrb(1, a, o);
  assert.ok(o.ly - o.lr > 500 + Math.tan(0.05) * MELTDOWN.LIGHT_DIST, 'it rises clear of the horizon');
});

test('targets get the look while it changes (nothing while it is all 0), the light where the camera looked', () => {
  const { m, events, run, calls } = setup();
  events.emit('darkMode', { on: true });
  run(29.9);
  assert.equal(calls.view.length, 0, 'nothing to draw before the warning');
  run(1);
  for (const k of ['view', 'level', 'fx', 'audio']) assert.ok(calls[k].length > 0 && calls[k].at(-1).warn > 0, k);
  assert.equal(calls.view.at(-1).fire, 0);
  run(11.5);
  const fire = calls.view.at(-1);
  assert.equal(fire.fire, 1);
  assert.equal(fire.embers, 1);
  assert.equal(fire.lit, false, 'no light yet');
  assert.ok(calls.rumble.at(-1) > 0, 'a low rumble');
  run(5);
  const light = calls.fx.at(-1);
  assert.equal(light.lit, true);
  assert.ok(light.glow > 0 && light.light > 0);
  assert.ok(light.lz < -9000, 'it bloomed ahead of the camera (looking toward -z)');
  assert.equal(calls.kicks[0], MELTDOWN.LIGHT_KICK, 'a jolt as it blooms');
  assert.deepEqual([light.lx, light.lz], [light.gx, light.gz], 'the fireball stands over its foot');
  // The camera turning afterwards does not move it.
  run(0.5, 0);
  assert.equal(calls.fx.at(-1).gx, light.gx);
  assert.equal(m.levels.lit, true);
});

test('the shockwave jolts the camera and emits shock once as it passes; the klaxon repeats from 30 s until the light', () => {
  const { events, run, log, sfx, calls } = setup();
  events.emit('darkMode', { on: true });
  run(46);
  const klaxons = sfx.filter((e) => e.name === 'meltdown_klaxon');
  const expected = Math.floor((MELTDOWN.LIGHT - MELTDOWN.WARN) / MELTDOWN.KLAXON_EVERY - 1e-9) + 1;
  assert.ok(Math.abs(klaxons.length - expected) <= 1, `${klaxons.length} klaxons, about ${expected}`);
  run(7);
  assert.equal(sfx.filter((e) => e.name === 'meltdown_klaxon').length, klaxons.length, 'none after the light');
  const shocks = log.filter((e) => e.phase === 'shock');
  assert.equal(shocks.length, 1);
  // It passes the camera (LIGHT_DIST away) about LIGHT_DIST / RING_SPEED after it leaves.
  const due = MELTDOWN.LIGHT + MELTDOWN.RING_DELAY + MELTDOWN.LIGHT_DIST / MELTDOWN.RING_SPEED;
  assert.ok(Math.abs(shocks[0].seconds - due) < 0.05, `shock at ${shocks[0].seconds}, due ${due}`);
  assert.ok(calls.kicks.includes(MELTDOWN.SHOCK_KICK));
});

test('trees near the hero catch fire from the burning sky, one every TREE_FIRE_EVERY, up to TREE_FIRES', () => {
  const trees = Array.from({ length: 30 }, (_, i) => ({ canopy: { x: (i % 6) * 900 - 2500, y: 700, z: 7000 - Math.floor(i / 6) * 2500, radius: 300 } }));
  const { events, run, calls, sfx } = setup({ trees });
  events.emit('darkMode', { on: true });
  run(40);
  assert.equal(calls.ignite.length, 0, 'not before the fire');
  run(2);
  const n = calls.ignite.length;
  assert.ok(n >= 3 && n <= 5, `${n} trees alight after 2 s`);
  for (const f of calls.ignite) {
    assert.ok(Math.hypot(f.x, f.z - 7000) <= MELTDOWN.TREE_REACH, 'near the camera first');
    assert.ok(f.duration >= 20 && f.radius > 200);
  }
  run(12);
  assert.equal(calls.ignite.length, MELTDOWN.TREE_FIRES);
  assert.equal(new Set(calls.ignite.map((f) => `${f.x},${f.z}`)).size, MELTDOWN.TREE_FIRES, 'each tree once');
  assert.equal(sfx.filter((e) => e.name === 'tree_ignite').length, MELTDOWN.TREE_FIRES);
});

test('reset(): everything off at once (targets get all 0), the clock stopped; the next race starts fresh', () => {
  const { m, events, run, calls, results } = setup({ trees: [{ canopy: { x: 0, y: 700, z: 6000, radius: 300 } }] });
  events.emit('darkMode', { on: true });
  run(55);
  assert.equal(results.length, 1);
  m.reset();
  assert.equal(m.phase, 'idle');
  assert.equal(m.seconds, 0);
  assert.deepEqual({ ...m.levels }, meltdownLevels());
  for (const k of ['view', 'level', 'fx', 'audio']) {
    const L = calls[k].at(-1);
    assert.ok(L.warn === 0 && L.fire === 0 && L.white === 0 && L.glow === 0 && L.lit === false, k);
  }
  assert.equal(calls.rumble.at(-1), 0);
  // main's game-over reset emits darkMode off after reset(): nothing to cancel then.
  events.emit('darkMode', { on: false });
  assert.equal(m.phase, 'idle');
  // A new game: a fresh race, the same tree can burn again.
  events.emit('darkMode', { on: true });
  run(42);
  assert.equal(m.phase, 'fire');
  assert.equal(calls.ignite.length, 2);
  run(13);
  assert.equal(results.length, 2);
});

test('skipTo() jumps the running clock ahead; the phases crossed happen on the next update, in order', () => {
  const { m, events, log, run } = setup();
  assert.equal(m.skipTo(45), false, 'not while idle');
  events.emit('darkMode', { on: true });
  assert.equal(m.skipTo(47), true);
  run(FRAME_DT);
  assert.deepEqual(log.map((e) => e.phase), ['warning', 'fire', 'light']);
  assert.ok(Math.abs(m.seconds - 47) < 1e-9);
  assert.equal(m.levels.lit, true, 'the light found its place');
  m.skipTo(10);
  assert.ok(m.seconds >= 47 - FRAME_DT, 'never backwards');
});

test('camera shake: a steady rumble under the kicks while the game runs, off at 0', () => {
  const shake = new CameraShake(null);
  const cam = { position: { x: 0, y: 0, z: 0 }, rotations: 0, rotateX() { this.rotations++; }, rotateY() {}, rotateZ() {} };
  shake.setRumble(0.5);
  shake.apply(cam, 1 / 60);
  assert.ok(shake.amount > 0.5 * SHAKE.RUMBLE * 0.8, `${shake.amount}`);
  for (let i = 0; i < 120; i++) shake.apply(cam, 1 / 60);
  assert.ok(shake.amount > 0.5 * SHAKE.RUMBLE * 0.8, 'held up while it lasts');
  assert.ok(cam.rotations > 100);
  shake.setRumble(0);
  for (let i = 0; i < 120; i++) shake.apply(cam, 1 / 60);
  assert.equal(shake.amount, 0, 'dies away');
});
