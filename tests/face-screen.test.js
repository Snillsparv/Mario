// The face screen (ui/FaceScreen.js, ui/face/*): the stretch toy's logic without a browser (the
// falloff, grab offsets and their soft limit, the springs: held ones follow, released ones
// wobble back and settle, the handle pool and its reuse, the shown-surface deformation and
// picking, head turn and zoom clamps, the expressions), the menu flow (title -> face -> play;
// none in test mode; ?face), its texts and its sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STRETCH, TURN, ZOOM, MOOD, FACE_EXPRESSIONS,
  falloff, softLimit, grabRadius, Stretch, HeadTurn, Zoom, FaceMood, raycast, pointOnTriangle, menuPlan,
} from '../src/ui/face/stretch.js';
import { FACE_STRINGS, hintKind, hintLines } from '../src/ui/face/faceText.js';
import { SMALL_FONT, missingGlyphs } from '../src/ui/bitmapFont.js';
import { SFX, SFX_INFO } from '../src/audio/sfx.js';
import { LEVELS } from '../src/audio/mixer.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const len = (h) => Math.hypot(h.ox, h.oy, h.oz);

// Step `s` for `seconds` at 60 fps.
function run(s, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += dt) s.update(dt);
}

test('falloff: 1 at the grab point, 0 from one radius on, smooth and decreasing in between', () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(1), 0);
  assert.equal(falloff(1.5), 0);
  assert.equal(falloff(NaN), 0);
  let prev = 1;
  for (let d = 0.01; d < 1; d += 0.01) {
    const f = falloff(d);
    assert.ok(f < prev && f > 0, `decreasing at ${d}`);
    prev = f;
  }
  // Flat at both ends (no crease at the grab point or at the rim).
  const h = 1e-4;
  assert.ok((falloff(0) - falloff(h)) / h < 1e-3);
  assert.ok(falloff(1 - h) / h < 1e-3);
});

test('softLimit: identity up to the knee, never past the maximum, monotonic', () => {
  assert.equal(softLimit(10, 72), 10);
  assert.equal(softLimit(0.65 * 72, 72), 0.65 * 72);
  let prev = 0;
  for (let x = 0; x < 500; x += 1) {
    const y = softLimit(x, 72);
    assert.ok(y >= prev && y < 72 + 1e-9);
    prev = y;
  }
  assert.ok(softLimit(1000, 72) > 71.9);
});

test('grab radius: the nose pulls out alone, the cap\'s bill broadly, elsewhere the default', () => {
  assert.equal(grabRadius(0, -5.5, 34.8), STRETCH.NOSE_RADIUS);
  assert.equal(grabRadius(0, 17.5, 43.5), STRETCH.BRIM_RADIUS); // the bill's front edge
  assert.equal(grabRadius(18, 15, 36), STRETCH.BRIM_RADIUS);
  assert.equal(grabRadius(9.3, 10.6, 30.4), STRETCH.RADIUS); // the glasses' frame
  assert.equal(grabRadius(33, 14, 0), STRETCH.RADIUS); // the cap's side
  assert.equal(grabRadius(13.8, -8.5, 25.6), STRETCH.RADIUS);
  assert.equal(grabRadius(32, -3, 2), STRETCH.RADIUS); // an ear
  assert.ok(STRETCH.NOSE_RADIUS < STRETCH.RADIUS && STRETCH.RADIUS < STRETCH.BRIM_RADIUS);
  // The eyes' inner corners stay (almost) put when the nose tip is pulled.
  assert.ok(falloff(Math.hypot(4.3, -1.4 + 5.5, 29.7 - 34.8) / STRETCH.NOSE_RADIUS) < 0.05);
});

test('a held handle follows its pull (soft-limited), moving the surface with the falloff', () => {
  const s = new Stretch();
  const h = s.grab(10, 0, 25);
  assert.ok(h && h.held && h.active);
  assert.equal(h.radius, STRETCH.RADIUS);
  assert.equal(s.pull(h, 30, 0, 0), 30);
  run(s, 1);
  assert.ok(near(h.ox, 30, 0.05) && near(h.oy, 0, 1e-6), `offset ${h.ox}`);
  // The grab point moves all the way, a point half a radius off by falloff(0.5), one a radius off not at all.
  assert.ok(near(s.displacement(10, 0, 25).x, h.ox, 1e-9));
  assert.ok(near(s.displacement(10, STRETCH.RADIUS / 2, 25).x, h.ox * falloff(0.5), 1e-9));
  assert.equal(s.displacement(10, STRETCH.RADIUS, 25).x, 0);
  // Pulls are soft-limited to STRETCH.MAX.
  const lim = s.pull(h, 0, 500, 0);
  assert.ok(lim < STRETCH.MAX && lim > STRETCH.MAX * 0.95);
  run(s, 1.5);
  assert.ok(len(h) <= STRETCH.MAX, `limited: ${len(h)}`);
  assert.ok(s.pullLevel() > 0.95 && s.pullLevel() <= 1);
  // A fast pull lags a little (a spring, not a teleport).
  const s2 = new Stretch();
  const h2 = s2.grab(0, 0, 30);
  s2.pull(h2, 40, 0, 0);
  s2.update(1 / 60);
  assert.ok(h2.ox > 0 && h2.ox < 40);
});

test('released, a handle wobbles back through rest (a jelly jiggle), settles and frees its slot', () => {
  const s = new Stretch();
  const h = s.grab(0, 0, 30);
  s.pull(h, 40, 0, 0);
  run(s, 1);
  const peak = s.release(h);
  assert.ok(peak > 39 && peak < 42, `peak ${peak} (the held spring overshoots a hair)`);
  assert.equal(h.held, false);
  assert.ok(s.wobbleLevel() > 0.4);
  // It overshoots to the other side, and each swing is smaller than the one before.
  let min = 0;
  let crossings = 0;
  let prev = h.ox;
  const swings = [];
  let extreme = 0;
  for (let i = 0; i < 180 && h.active; i++) {
    s.update(1 / 60);
    min = Math.min(min, h.ox);
    if (Math.sign(h.ox) !== Math.sign(prev) && prev !== 0) {
      crossings++;
      swings.push(extreme);
      extreme = 0;
    }
    extreme = Math.max(extreme, Math.abs(h.ox));
    prev = h.ox;
  }
  assert.ok(min < -15, `overshoot ${min}`);
  assert.ok(crossings >= 3, `wobbles ${crossings}`);
  for (let i = 2; i < swings.length; i++) assert.ok(swings[i] < swings[i - 1], `swing ${i} smaller`);
  // Settled within a few seconds: the slot is free and nothing is displaced.
  run(s, 3);
  assert.equal(h.active, false);
  assert.equal(s.activeCount, 0);
  assert.equal(s.displacement(0, 0, 30).x, 0);
  assert.equal(s.wobbleLevel(), 0);
});

test('the pool: eight handles, several wobble at once, the calmest released one is reused', () => {
  const s = new Stretch();
  assert.equal(s.handles.length, STRETCH.HANDLES);
  const hs = [];
  for (let i = 0; i < STRETCH.HANDLES; i++) {
    const h = s.grab(i * 3, 0, 28);
    s.pull(h, 20 + i * 2, 0, 0);
    hs.push(h);
  }
  assert.equal(new Set(hs.map((h) => h.id)).size, STRETCH.HANDLES);
  // Every slot held: no ninth grab.
  assert.equal(s.grab(0, 10, 28), null);
  run(s, 0.5);
  // Release them all: they wobble together.
  for (const h of hs) s.release(h);
  s.update(1 / 60);
  assert.equal(hs.filter((h) => h.active && !h.held).length, STRETCH.HANDLES);
  // Hold one still (pulled to 0): a new grab takes the released one with the least wobble.
  run(s, 0.1);
  const calmest = hs.reduce((a, b) => (Stretch.energy(a) <= Stretch.energy(b) ? a : b));
  const again = s.grab(5, 5, 28);
  assert.equal(again, calmest);
  assert.ok(again.held && len(again) === 0 && again.gx === 5, 'reused from scratch');
  // Once settled, grabs take free slots again (the lowest free id first).
  s.release(again);
  run(s, 5);
  assert.equal(s.activeCount, 0);
  assert.equal(s.grab(1, 1, 28).id, 0);
  s.reset();
  assert.equal(s.activeCount, 0);
});

test('two handles held at once add up where they overlap; releaseAll lets both go', () => {
  const s = new Stretch();
  const a = s.grab(-5, 0, 29);
  const b = s.grab(5, 0, 29);
  s.pull(a, -10, 0, 0);
  s.pull(b, 10, 0, 0);
  run(s, 1);
  const mid = s.displacement(0, 0, 29);
  assert.ok(near(mid.x, a.ox * falloff(5 / a.radius) + b.ox * falloff(5 / b.radius), 1e-9));
  assert.ok(Math.abs(mid.x) < 0.1, 'symmetric pulls cancel in the middle');
  s.releaseAll();
  assert.ok(!a.held && !b.held && !s.holding);
});

test('deform() matches displacement() on a vertex array; the uniforms carry every handle', () => {
  const s = new Stretch();
  const h = s.grab(0, 0, 30);
  s.pull(h, 0, 12, 4);
  run(s, 1);
  const rest = new Float32Array([0, 0, 30, 5, 5, 28, 40, 40, 40]);
  const out = s.deform(rest);
  for (let i = 0; i < 3; i++) {
    const d = s.displacement(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    assert.ok(near(out[i * 3], rest[i * 3] + d.x, 1e-4) && near(out[i * 3 + 1], rest[i * 3 + 1] + d.y, 1e-4) && near(out[i * 3 + 2], rest[i * 3 + 2] + d.z, 1e-4));
  }
  assert.deepEqual([...out.slice(6)], [40, 40, 40], 'far points stay');
  const grab = new Float32Array(STRETCH.HANDLES * 4);
  const off = new Float32Array(STRETCH.HANDLES * 3);
  s.writeUniforms(grab, off);
  assert.deepEqual([...grab.slice(0, 4)], [0, 0, 30, h.radius]);
  assert.ok(near(off[1], h.oy, 1e-6));
  assert.equal(grab[7], 0, 'unused handles have radius 0 (off in the shader)');
});

test('raycast finds the nearest triangle (either side) and its rest point', () => {
  // Two squares facing +z at z = 10 and z = 0, each two triangles.
  const positions = new Float32Array([-1, -1, 10, 1, -1, 10, 1, 1, 10, -1, 1, 10, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const index = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const hit = raycast(0.2, 0.3, 50, 0, 0, -1, positions, index);
  assert.ok(hit && near(hit.t, 40, 1e-6) && hit.tri < 2, 'the front square');
  const p = pointOnTriangle(positions, index, hit.tri, hit.u, hit.v);
  assert.ok(near(p.x, 0.2, 1e-6) && near(p.y, 0.3, 1e-6) && near(p.z, 10, 1e-6));
  const back = raycast(0.2, 0.3, 5, 0, 0, -1, positions, index);
  assert.ok(back && back.tri >= 2 && near(back.t, 5, 1e-6), 'from between: the back square');
  assert.ok(raycast(0.2, 0.3, -5, 0, 0, 1, positions, index), 'hits from behind too');
  assert.equal(raycast(3, 3, 50, 0, 0, -1, positions, index), null);
  // Picking the shown surface: deform, then pick; the rest point is the undeformed one.
  const s = new Stretch();
  const h = s.grab(0, 0, 10, 5);
  s.pull(h, 0, 0, 3);
  run(s, 1);
  const shown = s.deform(positions);
  const moved = raycast(0, 0, 50, 0, 0, -1, shown, index);
  assert.ok(near(moved.t, 40 - len(h) * falloff(Math.SQRT2 / 5), 1e-3), 'the pulled square is closer (its corners moved)');
  assert.ok(near(pointOnTriangle(positions, index, moved.tri, moved.u, moved.v).z, 10, 1e-6));
});

test('head turn: follows the drag, soft-clamped, swings back to facing the viewer', () => {
  const t = new HeadTurn();
  t.grab();
  t.drag(0.2, -0.05);
  run(t, 1);
  assert.ok(near(t.yaw, 0.2 * TURN.PER_HEIGHT, 0.01) && near(t.pitch, -0.05 * TURN.PER_HEIGHT, 0.01));
  t.drag(5, 5); // far past the limits
  run(t, 1);
  assert.ok(t.yaw <= TURN.MAX_YAW + 1e-9 && t.yaw > TURN.MAX_YAW * 0.95, `yaw ${t.yaw}`);
  assert.ok(t.pitch <= TURN.MAX_PITCH + 1e-9 && t.pitch > TURN.MAX_PITCH * 0.95);
  t.drag(-20, -20);
  run(t, 1);
  assert.ok(t.yaw >= -TURN.MAX_YAW - 1e-9 && t.pitch >= -TURN.MAX_PITCH - 1e-9);
  t.release();
  let over = false;
  const from = Math.sign(t.yaw);
  for (let i = 0; i < 240; i++) {
    t.update(1 / 60);
    if (Math.sign(t.yaw) === -from && Math.abs(t.yaw) > 0.01) over = true;
    assert.ok(Math.abs(t.yaw) <= TURN.MAX_YAW * 1.15 + 1e-9);
  }
  assert.ok(over, 'a little overshoot');
  assert.ok(Math.abs(t.yaw) < 0.01 && Math.abs(t.pitch) < 0.01, 'back to facing the viewer');
  // A pad's stick: turns while pushed, back when let go.
  t.setStick(1, 0);
  run(t, 1);
  assert.ok(t.yaw > TURN.MAX_YAW * 0.9);
  t.setStick(0, 0);
  run(t, 4);
  assert.ok(Math.abs(t.yaw) < 0.01);
});

test('zoom: wheel and pinch, clamped, eased', () => {
  const z = new Zoom();
  z.wheel(-100);
  assert.ok(z.target > 1);
  z.update(1 / 60);
  assert.ok(z.value > 1 && z.value < z.target, 'eases');
  z.wheel(-100000);
  assert.equal(z.target, ZOOM.MAX);
  z.wheel(100000);
  assert.equal(z.target, ZOOM.MIN);
  z.pinchStart();
  z.pinch(10);
  assert.equal(z.target, ZOOM.MAX);
  z.pinch(1);
  assert.equal(z.target, ZOOM.MIN, 'a pinch scales from where it started');
  run(z, 2);
  assert.ok(near(z.value, ZOOM.MIN, 1e-3));
});

test('expressions: blinks at rest, surprise / alarm / wince by the pull, a giggle while it wobbles, a dazed double blink after', () => {
  const m = new FaceMood(() => 0.5);
  const seen = [];
  for (let i = 0; i < 60 * 8; i++) seen.push(m.update(1 / 60));
  assert.ok(seen.includes('open') && seen.includes('blink'), 'blinks now and then');
  const blinks = seen.filter((f) => f === 'blink').length / 60;
  assert.ok(blinks < 1, 'blinks are short');
  const face = (o, n = 30) => {
    let f;
    for (let i = 0; i < n; i++) f = m.update(1 / 60, o);
    return f;
  };
  assert.notEqual(face({ holding: true, pull: 0.1 }), 'alarm');
  for (let i = 0; i < 60 * 10; i++) assert.equal(m.update(1 / 60, { holding: true, pull: 0.2 }), 'surprise', 'no blinks while pulled');
  assert.equal(face({ holding: true, pull: MOOD.ALARM + 0.05 }), 'alarm');
  assert.equal(face({ holding: true, pull: MOOD.WINCE + 0.05 }), 'wince');
  assert.equal(face({ wobble: 0.5 }), 'giggle');
  // Settled after a big wobble: two quick blinks.
  const after = [];
  for (let i = 0; i < 60; i++) after.push(m.update(1 / 60, { wobble: 0 }));
  let runs = 0;
  for (let i = 0; i < after.length; i++) if (after[i] === 'blink' && after[i - 1] !== 'blink') runs++;
  assert.equal(runs, 2, `dazed double blink: ${after.join(' ')}`);
  // Every face is a painted expression; the eyes-open ones have drawn irises.
  for (const [name, e] of Object.entries(FACE_EXPRESSIONS)) {
    assert.equal(typeof e.base, 'string', name);
    assert.equal(e.iris, e.base === 'open' || e.base === 'shout', name);
  }
});

test('menu plan: title then face; none with ?test / ?skipTitle; ?face=1 opens it alone; ?face=0 leaves it out', () => {
  assert.deepEqual(menuPlan(''), { title: true, face: false }, 'the face screen is opt-in');
  assert.deepEqual(menuPlan('?mute=1'), { title: true, face: false });
  assert.deepEqual(menuPlan('?test=1'), { title: false, face: false });
  assert.deepEqual(menuPlan('?skipTitle=1'), { title: false, face: false });
  assert.deepEqual(menuPlan('?test=1&face=1'), { title: false, face: false }, 'tests and tools start straight away');
  assert.deepEqual(menuPlan('?face=1'), { title: false, face: true });
  assert.deepEqual(menuPlan('?face'), { title: false, face: true });
  assert.deepEqual(menuPlan('?face=0'), { title: true, face: false });
});

// ---- main.js wiring (source-level, like tests/world-node.test.js) ----------------------

const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function fnBody(name) {
  const at = MAIN.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `main.js has ${name}()`);
  return MAIN.slice(at, MAIN.indexOf('\n  }\n', at));
}

test('main.js: title -> face -> play at start and after GAME OVER; menus pause the simulation', () => {
  const face = fnBody('runFace');
  assert.ok(face.includes("state.mode = 'face'") && face.includes('await face.show()'), 'runFace shows the FaceScreen in mode face');
  assert.ok(face.includes('hud.setVisible(false)'), 'no HUD over it');
  assert.ok(!face.includes('view.render(') && !face.includes('level.update('), 'the face screen draws itself; the world waits');
  const boot = MAIN.slice(MAIN.indexOf('cam.reset(player);\n  if ('));
  const [t, f, s] = ['await runTitle()', 'await runFace()', 'startGame(true)'].map((x) => boot.indexOf(x));
  assert.ok(t >= 0 && t < f && f < s, 'start: title, face, then play with the intro');
  assert.ok(/if \(!MENUS\.title && !MENUS\.face\) \{\s*startGame\(false\)/.test(boot), 'no menus: straight into play (test mode, skipTitle)');
  const over = fnBody('gameOver');
  const [ot, of, os] = ['await runTitle()', 'await runFace()', 'startGame(true)'].map((x) => over.indexOf(x));
  assert.ok(ot >= 0 && ot < of && of < os, 'after GAME OVER: title, face, play');
  assert.ok(over.includes('if (MENUS.face) await runFace()'), 'not in test mode');
  assert.ok(MAIN.includes("const inMenu = () => state.mode === 'title' || state.mode === 'face'"));
  assert.ok(/if \(inMenu\(\)\) \{\s*acc = 0/.test(MAIN), 'the real-time loop does not tick during the menus');
  assert.ok(fnBody('startGame').includes('input.flush()'), 'the Start press is no fresh press in play');
});

// ---- texts and sounds -----------------------------------------------------------------------

test('face screen texts: every glyph exists, touch / pad / keys wording, no borrowed names', () => {
  for (const s of FACE_STRINGS) {
    assert.deepEqual(missingGlyphs(SMALL_FONT, s), [], s);
    assert.ok(!/mario|nintendo|n64|luigi/i.test(s), s);
  }
  assert.equal(hintKind({ touch: true, pad: true }), 'touch');
  assert.equal(hintKind({ pad: true }), 'pad');
  assert.equal(hintKind({}), 'keys');
  assert.match(hintLines('keys')[0], /Enter/);
  assert.match(hintLines('pad')[0], /START/);
  assert.match(hintLines('touch')[0], /tap/);
  assert.match(hintLines('touch')[1], /pinch/);
  assert.match(hintLines('keys')[1], /wheel/);
});

// A tiny recording WebAudio stand-in (see tests/audio-sfx.test.js for the full one).
class P {
  constructor() {
    this.value = 0;
    this.events = [];
  }
}
for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) {
  P.prototype[m] = function (...a) {
    this.events.push([m, ...a]);
    return this;
  };
}
function fakeCtx() {
  const nodes = [];
  const node = (kind, params = []) => {
    const n = { kind, outs: [], connect(d) {
      this.outs.push(d);
      return d;
    }, disconnect() {}, start(t) {
      this.startAt = t;
    }, stop(t) {
      this.stopAt = t;
    }, setPeriodicWave() {} };
    for (const p of params) n[p] = new P();
    nodes.push(n);
    return n;
  };
  return {
    nodes,
    sampleRate: 44100,
    currentTime: 0,
    createOscillator: () => Object.assign(node('osc', ['frequency', 'detune']), { type: 'sine' }),
    createBiquadFilter: () => node('filter', ['frequency', 'Q', 'gain']),
    createGain: () => node('gain', ['gain']),
    createBufferSource: () => node('noise', ['playbackRate']),
    createBuffer: (c, l) => ({ length: l, getChannelData: () => new Float32Array(l) }),
    createPeriodicWave: () => ({}),
    createWaveShaper: () => node('shaper'),
  };
}

test('face sounds: exist with rate limits; creak rises with the stretch; the release boing drops and rings longer for a longer pull', () => {
  for (const n of ['face_grab', 'face_stretch', 'face_boing', 'face_boop']) {
    assert.equal(typeof SFX[n], 'function', n);
    assert.ok(SFX_INFO[n]?.gap > 0 && SFX_INFO[n].max >= 1, `${n} rate-limited`);
    const ctx = fakeCtx();
    const dur = SFX[n](ctx, ctx.createGain(), 1, { p: 1 });
    assert.ok(dur > 0.05 && dur <= 1, `${n} length ${dur}`);
    for (const o of ctx.nodes.filter((x) => x.kind === 'osc' || x.kind === 'noise')) assert.ok(o.startAt >= 1 && o.stopAt > o.startAt);
  }
  const firstOsc = (name, p) => {
    const ctx = fakeCtx();
    const dur = SFX[name](ctx, ctx.createGain(), 1, { p });
    const saw = ctx.nodes.find((x) => x.kind === 'osc' && x.frequency.events.length);
    return { f: saw.frequency.events[0][1], dur };
  };
  assert.ok(firstOsc('face_stretch', 1.5).f > firstOsc('face_stretch', 0.8).f);
  // FaceScreen pitches the boing 1.35 (a short pull) .. 0.75 (the longest).
  const short = firstOsc('face_boing', 1.35);
  const long = firstOsc('face_boing', 0.75);
  assert.ok(long.f < short.f && long.dur > short.dur, `boing ${JSON.stringify({ short, long })}`);
  // Within the sfx level budget (tests/audio-sfx.test.js checks every recipe's summed peak too).
  assert.ok(LEVELS.sfx > 0);
});
