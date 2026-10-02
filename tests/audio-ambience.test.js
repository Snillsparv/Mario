// The ambience's area profiles (audio/ambience.js setProfile) against a recording WebAudio
// stand-in, its clock advanced at 60 Hz: on the grounds the birds sing and the moat laps; in
// the Great Hall ('hall') the pastoral bed (air and leaves) fades out under a low room tone, no
// bird, distant chorus or lap is scheduled, and a fire crackles at the hearth (its def.audio
// spot, in world coordinates) several times a second; on Midsummer Skerries ('sea', with the
// Area.audio of the course built for real) the air bed carries the wind while the leaves fall
// quiet, waves lap at the sea's level on open water only (out on the Sound all round the
// listener, about one a second; from over Home Island or the islet off their shores, farther
// off and on the meadow fewer; none from dry land all round), and a gull calls every 4-10 s
// from a point on one of the gulls' circles, the nearer circle far more often (seeded draws;
// none out of range, then one at once on coming back); no birds, chorus, room tone or fire. In
// Sparrow Lane ('lane') the grounds' air, leaves and distant birds play on, with no waterfall,
// no laps, no fire, no gulls and no room tone.
// A profile set before anything plays is in force from the first update, the laps keep to the
// area's sea level, and the profile and spots already in force change nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Ambience, PROFILES } from '../src/audio/ambience.js';
import { SFX } from '../src/audio/sfx.js';
import { AREA_DEFS } from '../src/world/areas.js';
import { buildArea, worldAudio } from '../src/world/area.js';
import { makeRng } from '../src/core/math.js';
import * as hall from '../src/world/hall/layout.js';
import * as sk from '../src/world/skerries/layout.js';
import { SPAWN, LAWN_BASE } from '../src/world/layout.js';

class Param {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
}
for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) {
  Param.prototype[m] = function (...args) {
    this.events.push([m, ...args]);
    return this;
  };
}

class Node {
  constructor(ctx, kind, params = []) {
    this.kind = kind;
    this.outs = [];
    for (const p of params) this[p] = new Param();
    ctx.nodes.push(this);
  }

  connect(dest) {
    this.outs.push(dest);
    return dest;
  }

  disconnect() {}
  start(t) {
    this.startAt = t;
  }

  stop(t) {
    this.stopAt = t;
  }
}

// Just what the ambience builds: noise loops through filters, gains and panners.
class RecordingContext {
  constructor() {
    this.sampleRate = 4000; // small noise buffers keep it cheap
    this.currentTime = 0;
    this.nodes = [];
  }

  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (c) => data[c] };
  }

  createBufferSource() {
    return new Node(this, 'source', ['playbackRate']);
  }

  createGain() {
    const g = new Node(this, 'gain', ['gain']);
    g.gain.value = 1;
    return g;
  }

  createBiquadFilter() {
    return new Node(this, 'filter', ['frequency', 'Q', 'gain']);
  }

  createStereoPanner() {
    return new Node(this, 'panner', ['pan']);
  }
}

const lastRamp = (param) => param.events.findLast(([m]) => m === 'linearRampToValueAtTime');

// An ambience on the stand-in, recording what it plays: [{ recipe, pos, volume, t }].
function ambience() {
  const ctx = new RecordingContext();
  const out = ctx.createGain();
  const played = [];
  const amb = new Ambience(ctx, out, {
    playAt: (recipe, pos, volume) => played.push({ recipe, pos, volume, t: ctx.currentTime }),
    spatial: () => ({ gain: 1, pan: 0 }),
  });
  // Advance `seconds` of updates at 60 Hz with the listener at `listener`.
  const run = (seconds, listener) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      ctx.currentTime += 1 / 60;
      amb.update(1 / 60, listener);
    }
  };
  return { ctx, amb, played, run };
}

// An area's def.audio in world coordinates, as world/area.js hands it on ('areaChange').
const areaAudio = (name) => worldAudio(AREA_DEFS[name].audio, AREA_DEFS[name].origin);

// Midsummer Skerries built for real, once: its Area.audio carries the course's own water test.
let skerries = null;
const course = () => (skerries ??= buildArea(new THREE.Scene(), AREA_DEFS.skerries));
const SK = AREA_DEFS.skerries.origin;
// A listener at a spot in the course's local frame (world/areas.js places it at SK).
const at = (x, y, z, yaw = Math.PI) => ({ x: x + SK.x, y: y + SK.y, z: z + SK.z, yaw });

const isFire = (c) => c.recipe === SFX.fire_crackle;
const isGull = (c) => c.recipe === SFX.gull;
const isLap = (c) => c.recipe.name === 'slosh';

test('the grounds (control): birds sing all round and the moat laps; no fire, no gulls, no room tone', () => {
  const { amb, played, run } = ambience();
  assert.equal(amb.profile, PROFILES.grounds);
  run(20, { x: -6000, y: 200, z: -800, yaw: 0 }); // by the moat near the waterfall
  assert.ok(played.filter((c) => c.volume !== undefined).length > 10, 'bird calls (they carry their fade level)');
  assert.ok(played.some((c) => c.volume === undefined), 'laps at the water\'s edge');
  assert.ok(!played.some((c) => isFire(c) || isGull(c)));
  assert.equal(amb.room.gain.value, 0);
  assert.equal(amb.room.gain.events.length, 0, 'the room tone never comes up');
  assert.equal(amb.leaves.gain.value, 1);
  assert.equal(amb.leaves.gain.events.length, 0, 'the leaves rustle on');
});

test("the hall: the air and leaves fade out under a room tone; no birds, chorus or laps; the fire crackles at the hearth", () => {
  const { ctx, amb, played, run } = ambience();
  const audio = areaAudio('hall');
  const hearth = audio.fires[0];
  assert.deepEqual(hearth, { x: hall.HEARTH_FIRE.x, y: hall.HEARTH_FIRE.y, z: hall.HEARTH_FIRE.z + AREA_DEFS.hall.origin.z });
  ctx.currentTime = 10;
  amb.setProfile('hall', 1.2, audio);
  assert.equal(amb.profile, PROFILES.hall);
  assert.deepEqual(lastRamp(amb.pastoral.gain).slice(1), [0, 11.2], 'the air and leaves bed fades out');
  assert.deepEqual(lastRamp(amb.leaves.gain).slice(1), [0, 11.2], 'the leaves with it');
  const room = lastRamp(amb.room.gain);
  assert.ok(room[1] > 0.01 && room[1] < 0.1 && room[2] === 11.2, `the room tone fades in: ${room}`);
  // The room tone: a low-passed noise loop (a still room's murmur, nothing above a few hundred Hz).
  const roomFilter = ctx.nodes.find((n) => n.kind === 'filter' && n.outs.includes(amb.room));
  assert.equal(roomFilter.type, 'lowpass');
  assert.ok(roomFilter.frequency.value <= 400);
  assert.ok(ctx.nodes.some((n) => n.kind === 'source' && n.outs.includes(roomFilter) && n.loop));
  played.length = 0;
  // Standing in the hall (and even where the grounds' birds would be loudest: the profile, not
  // the distance, keeps them quiet).
  for (const listener of [{ x: 0, y: 400, z: -60000 + 2700, yaw: Math.PI }, { x: SPAWN.x, y: LAWN_BASE + 400, z: SPAWN.z, yaw: 0 }]) {
    run(20, listener);
  }
  assert.ok(played.length > 40, `the fire crackles on: ${played.length} in 40 s`);
  assert.deepEqual(played.filter((c) => !isFire(c)), [], 'nothing but the fire: no birds, no chorus, no laps');
  for (const c of played) assert.equal(c.pos, hearth, 'every crackle at the hearth');
  // A few a second, irregularly spaced.
  const gaps = played.slice(1).map((c, i) => c.t - played[i].t);
  assert.ok(Math.min(...gaps) >= 0.14 && Math.max(...gaps) <= 0.6, `crackle gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
  assert.ok(new Set(gaps.map((g) => g.toFixed(2))).size > 5, 'irregular');
  assert.ok(played.every((c) => c.volume > 0 && c.volume < 1), 'under full level');
  // The waterfall stays silent indoors.
  assert.equal(amb.fallGain.gain.events.findLast(([m]) => m === 'setTargetAtTime')[1], 0);
});

test('the sea: the wind blows, the leaves fall quiet; out on the Sound waves lap on the water all round, about one a second; gulls call every 4-10 s from their circles, the nearer far more often', (t) => {
  t.mock.method(Math, 'random', makeRng(11));
  const { ctx, amb, played, run } = ambience();
  const audio = course().audio;
  const [home, lighthouse] = audio.gulls;
  ctx.currentTime = 5;
  amb.setProfile('sea', 1.2, audio);
  assert.equal(amb.profile, PROFILES.sea);
  assert.deepEqual(lastRamp(amb.pastoral.gain).slice(1), [1, 6.2], 'the air bed carries the wind');
  assert.deepEqual(lastRamp(amb.leaves.gain).slice(1), [0, 6.2], 'the leaves fall quiet');
  assert.equal(lastRamp(amb.room.gain)[1], 0, 'no room tone');
  // The wind is the bed's low air layer, straight into the bed's fader; the two brighter leaves
  // layers go through the leaves' own fader into it.
  const into = (layer) => layer.gain.outs[0].outs[0]; // its gain, then its panner
  assert.deepEqual(amb.bed.map(into), [amb.pastoral, amb.leaves, amb.leaves]);
  assert.deepEqual(amb.leaves.outs, [amb.pastoral]);
  assert.ok(amb.bed[0].freq < 1000 && amb.bed[1].freq > 1500 && amb.bed[2].freq > 1500);
  // Swimming in the middle of the Sound (open water for 1000 all round), the camera above him.
  const sound = at(500, 400, -250);
  run(300, sound);
  const laps = played.filter(isLap);
  const gulls = played.filter(isGull);
  assert.equal(laps.length + gulls.length, played.length, 'no birds, no chorus, no fire');
  // Laps: about one a second (busier than the moat's), on the sea's surface within reach of the
  // listener, spread round him (so they come from both sides).
  assert.ok(laps.length > 230 && laps.length < 600, `${laps.length} laps in 300 s`);
  for (const c of laps) {
    assert.equal(c.pos.y, audio.seaLevel);
    assert.ok(Math.hypot(c.pos.x - sound.x, c.pos.z - sound.z) <= 900, 'near him');
    assert.ok(audio.isWater(c.pos.x, c.pos.z), 'on the water');
  }
  assert.ok(laps.some((c) => c.pos.x < sound.x - 300) && laps.some((c) => c.pos.x > sound.x + 300), 'on both sides');
  // Gulls: every 4-10 s, each from a point on one of the circles (at its height).
  assert.ok(gulls.length >= 300 / 10 - 2 && gulls.length <= 300 / 4 + 1, `${gulls.length} gull calls in 300 s`);
  const gaps = gulls.slice(1).map((c, i) => c.t - gulls[i].t);
  assert.ok(Math.min(...gaps) >= 4 - 1e-9 && Math.max(...gaps) <= 10 + 0.02, `gull gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
  const on = (c, circle) => Math.abs(Math.hypot(c.pos.x - circle.x, c.pos.z - circle.z) - circle.radius) < 1e-6 && c.pos.y === circle.y;
  for (const c of gulls) assert.ok(on(c, home) || on(c, lighthouse), `a call off the circles: ${JSON.stringify(c.pos)}`);
  for (const c of gulls) assert.ok(c.volume >= 0.6 && c.volume <= 1);
  // Behind the jetty at the arrival, under Home Island's gulls and far from the lighthouse's:
  // the nearer circle far more often, the other now and then.
  played.length = 0;
  run(600, at(sk.ENTRIES.arrival.x, 600, sk.ENTRIES.arrival.z + 1200));
  const calls = played.filter(isGull);
  const near = calls.filter((c) => on(c, home)).length;
  assert.ok(near > calls.length * 0.7 && near < calls.length, `over Home Island ${near} of ${calls.length}`);
  for (const c of calls) assert.ok(on(c, home) || on(c, lighthouse));
  // High over the sea (the lighthouse gallery's camera), out of the laps' reach: only gulls.
  played.length = 0;
  run(30, { x: lighthouse.x, y: 4200, z: lighthouse.z + 1200, yaw: Math.PI });
  assert.ok(played.length > 0 && played.every(isGull), 'no laps up there');
  // Out of every circle's range nothing calls; the first gull in range calls at once.
  run(20, { x: SK.x, y: 600, z: 30000, yaw: 0 });
  played.length = 0;
  run(30, { x: SK.x, y: 600, z: 30000, yaw: 0 });
  assert.ok(!played.some(isGull), 'no gull in range');
  run(1 / 60, sound);
  assert.ok(isGull(played.at(-1)), 'back in range: a call at once');
});

test("the sea's laps only on open water: over Home Island and the islet they come off the shore, farther off (and on the meadow fewer) than out on the Sound; from dry land all round, none", (t) => {
  t.mock.method(Math, 'random', makeRng(5));
  const { amb, played, run } = ambience();
  const { audio, groundAt } = course();
  amb.setProfile('sea', 0, audio);
  // The laps two minutes bring at `listener`, with their horizontal distance from him.
  const lapsAt = (listener) => {
    played.length = 0;
    run(120, listener);
    return played.filter(isLap).map((c) => ({ ...c, d: Math.hypot(c.pos.x - listener.x, c.pos.z - listener.z) }));
  };
  const mean = (laps) => laps.reduce((sum, c) => sum + c.d, 0) / laps.length;
  const sea = lapsAt(at(500, 400, -250));
  const spots = {
    'the arrival camera': at(-830, 744, 2938), // over the island behind the jetty's root
    'the meadow': at(-200, 470, 4200),
    'the meadow by the cliffs': at(300, 470, 5300),
    'the islet under the gallery': at(0, 3050, -2900),
  };
  for (const [name, listener] of Object.entries(spots)) {
    assert.ok(!audio.isWater(listener.x, listener.z), `${name}: over land`);
    const laps = lapsAt(listener);
    assert.ok(laps.length > 15, `${name}: the sea still heard (${laps.length})`);
    for (const c of laps) {
      const x = c.pos.x - SK.x;
      const z = c.pos.z - SK.z;
      assert.ok(x > sk.BAY.x0 && x < sk.BAY.x1 && z > sk.BAY.z0 && z < sk.BAY.z1, `${name}: in the bay`);
      assert.ok(groundAt(c.pos.x, c.pos.z) < c.pos.y, `${name}: a lap over dry land at ${JSON.stringify(c.pos)}`);
      assert.ok(c.d < 3500);
    }
    assert.ok(mean(laps) > mean(sea) + 400, `${name}: off the shore, ${mean(laps).toFixed(0)} away (out on the Sound ${mean(sea).toFixed(0)})`);
  }
  assert.ok(lapsAt(spots['the meadow']).length < sea.length * 0.7, 'thinner inland');
  // An area with no water anywhere near (its test never holds): no laps at all.
  amb.setProfile('sea', 0, { ...audio, isWater: () => false });
  assert.equal(lapsAt(at(500, 400, -250)).length, 0);
});

test("the lane: the grounds' breeze, leaves and distant birds; no waterfall, no laps, no fire, no gulls, no room tone", (t) => {
  t.mock.method(Math, 'random', makeRng(23));
  assert.deepEqual(PROFILES.lane, { pastoral: true, leaves: true, birds: true, chorus: true, waterfall: false, laps: null, room: false, fires: false, gulls: false });
  const { ctx, amb, played, run } = ambience();
  const audio = areaAudio('lane');
  assert.deepEqual([audio.music, audio.ambience, audio.reverb], ['skerries', 'lane', false]);
  ctx.currentTime = 3;
  amb.setProfile('lane', 1.2, audio);
  assert.equal(amb.profile, PROFILES.lane);
  assert.equal(lastRamp(amb.room.gain)?.[1] ?? 0, 0, 'no room tone');
  // In the street (the course's local origin, in world coordinates).
  const O = AREA_DEFS.lane.origin;
  run(30, { x: O.x, y: O.y + 300, z: O.z, yaw: 0 });
  assert.ok(played.filter((c) => c.volume !== undefined).length > 10, `distant birds: ${played.length}`);
  assert.ok(!played.some((c) => c.volume === undefined), 'no laps');
  assert.ok(!played.some((c) => isFire(c) || isGull(c)));
  assert.equal(amb.leaves.gain.value, 1);
  assert.equal(amb.fallGain.gain.events.findLast(([m]) => m === 'setTargetAtTime')[1], 0, 'no waterfall');
});

test('an area entered before anything plays is in force from the first update; unknown profiles and missing spots are the grounds\' and none; the laps keep to the sea level given; the same profile and spots again change nothing', () => {
  const { amb, played, run } = ambience();
  const audio = areaAudio('hall');
  amb.setProfile('hall', 0, audio);
  run(5, { x: 0, y: 400, z: -58000, yaw: 0 });
  assert.ok(played.length > 5 && played.every(isFire));
  // The same again (another 'areaChange' into the hall): no fade starts over.
  const automation = () => [amb.pastoral.gain, amb.leaves.gain, amb.room.gain].map((p) => p.events.length);
  const before = automation();
  amb.setProfile('hall', 1.2, audio);
  assert.deepEqual(automation(), before);
  // A profile without its spots plays nothing of its own (and no birds either); its laps are
  // anywhere round the listener (no water test) at sea level 0.
  played.length = 0;
  amb.setProfile('sea', 0);
  run(30, { x: 0, y: 400, z: 0, yaw: 0 });
  assert.ok(!played.some(isGull), 'no circles, no gulls');
  assert.ok(played.length > 20 && played.every((c) => isLap(c) && c.pos.y === 0), 'laps only, at sea level 0');
  // A sea level of its own (world/area.js raises it with the area's origin): every lap on it.
  played.length = 0;
  amb.setProfile('sea', 0, { seaLevel: 120, gulls: [] });
  run(30, { x: 0, y: 600, z: 0, yaw: 0 });
  assert.ok(played.length > 20 && played.every((c) => isLap(c) && c.pos.y === 120), 'laps at 120');
  amb.setProfile('nowhere', 0);
  assert.equal(amb.profile, PROFILES.grounds);
  assert.deepEqual(amb.spots, { fires: [], gulls: [], seaLevel: 0, isWater: null });
  // Back to the grounds' profile: the leaves rustle again.
  assert.equal(lastRamp(amb.leaves.gain)[1], 1);
});
