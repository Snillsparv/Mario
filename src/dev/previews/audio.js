// Audio preview: /preview.html?m=audio
//
// For people: buttons to audition every sound effect, the music (the loops, and the cues as
// they play in game) and the ambience at a few listener positions.
// For automation (no speakers in CI): offline renders with analysis and pictures.
//   __renderMusic(name, seconds = 20, fromBeat = 0)  -> analysis; draws waveform + spectrogram
//   __renderCue(name, barsBefore = 3)               -> the in-game ending of a cue song
//   __renderSfx(names?, opts?, seconds = 3)         -> { name: analysis } for one-shots
//   __renderSequence(cues, seconds?, spot?)         -> analysis of timed sfx [[t, name, opts?]]
//                                                      through the real engine voices (and the
//                                                      ambience at a SPOTS listener, if given)
//   __renderCombo() / __renderDialog(spot?)         -> the punch combo / a sign being read
//   __renderAmbience(spot, seconds = 30, music?)    -> analysis of the live ambience code
//   __stress(names?)                                -> peak of many sfx at once over music
//   __loopSeam(name)                                -> analysis around the loop point
//   __showRoll(name)                                -> draws the compiled score as a piano roll
//   __renderDark(spot?, seconds?, opts?)            -> AI RACE mode in steady state: the storm
//                                                      beds and/or the dark track, lightning
//   __renderDarkSwitch(spot?)                       -> sunny -> darkMode on -> off through the
//                                                      engine (ambience, storm, music, alarm)
//   __renderSteps(speeds?, terrain?) / __renderLandings() -> footstep / landing levels through
//                                                      the engine's event handlers
// Renders mimic the live engine: music is scheduled in 0.1 s steps (like the lookahead
// timer) and every sound starts after PRE_ROLL seconds, once the master compressor has
// settled (it starts out in gain reduction). Analysis covers only the part after PRE_ROLL.
// Each call also stores its result in window.__audioResult (tools/shot.mjs's eval does not
// await promises, so poll that after a wait). &roll=<song> draws a piano roll on load.

import { AudioEngine } from '../../audio/AudioEngine.js';
import { Events } from '../../core/events.js';
import { SONGS } from '../../audio/songs.js';
import { compileSong } from '../../audio/compile.js';
import { createMixer } from '../../audio/mixer.js';
import { Sequencer } from '../../audio/Sequencer.js';
import { SFX, footstepLevel } from '../../audio/sfx.js';
import { WATERFALL, SPAWN, POND, LAWN_BASE, BRIDGE, ISLAND_TOP, EAST_HILL } from '../../world/layout.js';

const SAMPLE_RATE = 44100;
const INST_COLORS = {
  flute: '#ffe066',
  glock: '#ffffff',
  horn: '#ff9f43',
  strings: '#6c8cff',
  harp: '#4cd9a0',
  bass: '#ff5d73',
  timpani: '#c08bff',
  kick: '#888',
  shaker: '#555',
  darkpad: '#6c8cff',
  pulse: '#ff5d73',
  glass: '#ffe066',
  clang: '#c08bff',
  thump: '#888',
  tick: '#555',
};

const PRE_ROLL = 1.5;
const STEP = 0.1; // scheduling step of stepped renders, seconds

// Render PRE_ROLL + seconds; schedule(ctx, mix, t0) starts its sounds at t0 = PRE_ROLL and
// may return a function called every STEP seconds of render time with the current time.
async function renderOffline(seconds, schedule) {
  const total = PRE_ROLL + seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * total), SAMPLE_RATE);
  const onStep = schedule(ctx, createMixer(ctx), PRE_ROLL);
  if (onStep) {
    // Always resume, even if a step throws (the render would hang forever otherwise).
    const hook = (t) =>
      ctx.suspend(t).then(() => {
        try {
          onStep(t);
        } catch (err) {
          console.error('render step failed:', err);
        }
        if (t + STEP < total - 0.01) hook(Math.round((t + STEP) * 1000) / 1000);
        ctx.resume();
      });
    hook(STEP);
  }
  return ctx.startRendering();
}

// A song's sequencer on the music bus at its playback level, scheduled like the live
// lookahead timer (as a loop, or once up to endBeat). Returns the per-step callback.
function songPlayer(ctx, mix, t0, song, fromBeat = 0, endBeat = null) {
  const level = ctx.createGain();
  level.gain.value = song.level;
  level.connect(mix.music);
  const seq = new Sequencer(ctx, song, level);
  seq.start(t0, { fromBeat, realtime: false, endBeat });
  seq.scheduleUntil(STEP + 0.15);
  return (t) => seq.scheduleUntil(t + 0.15);
}

// Render a song, optionally only some instruments (stems).
function renderSong(name, seconds, fromBeat, only = null) {
  const song = compileSong(SONGS[name]);
  if (only) song.events = song.events.filter((e) => only.includes(e.inst));
  return renderOffline(seconds, (ctx, mix, t0) => songPlayer(ctx, mix, t0, song, fromBeat));
}

// An AudioEngine playing into an offline context, for the real voice/ambience/storm code
// paths (with `events`, its event handlers too). (The engine only plays into a 'running'
// context, and an OfflineAudioContext reports 'suspended' inside suspend() callbacks, hence
// the state override.)
function offlineEngine(ctx, mix, events = null) {
  const engine = new AudioEngine(events);
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  engine.attach(ctx, mix);
  return engine;
}

// The engine's music tracks run on a wall-clock lookahead timer, which an offline render
// outruns; this takes over each track the engine starts and schedules it on the render's
// steps instead (tracks it has faded out keep going for a few seconds, as live).
function trackDriver(engine) {
  const driven = [];
  return (t) => {
    const tr = engine.track;
    if (tr && !driven.some((d) => d.track === tr)) {
      tr.seq.stop();
      driven.push({ track: tr, until: Infinity });
    }
    for (const d of driven) {
      if (d.track !== engine.track && d.until === Infinity) d.until = t + 4;
      if (t < d.until) d.track.seq.scheduleUntil(t + 0.15);
    }
  };
}

const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;

// Peak, RMS, clipping, largest sample-to-sample jump (clicks), RMS per window, and the
// max / median / count above -60 dB of 50 ms short-term RMS, plus the share of short-term
// windows above -50 dB and the longest run below it (how continuous an ambience is).
function analyze(buf, windowSec = 0.5, from = Math.floor(PRE_ROLL * buf.sampleRate), to = buf.length) {
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const win = Math.floor(buf.sampleRate * windowSec);
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let maxJump = 0;
  let lastLoud = 0;
  let wsum = 0;
  let ssum = 0;
  const windowsDb = [];
  const shortDb = [];
  const shortWin = Math.floor(buf.sampleRate * 0.05);
  for (let i = from; i < to; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a > 0.95) clipped++;
    if (a > 0.001) lastLoud = i;
    const e = (L[i] * L[i] + R[i] * R[i]) / 2;
    sum += e;
    wsum += e;
    ssum += e;
    if ((i - from + 1) % shortWin === 0) {
      shortDb.push(db(Math.sqrt(ssum / shortWin)));
      ssum = 0;
    }
    if (i > from) maxJump = Math.max(maxJump, Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]));
    if ((i - from + 1) % win === 0) {
      windowsDb.push(db(Math.sqrt(wsum / win)));
      wsum = 0;
    }
  }
  return {
    peak: Math.round(peak * 1000) / 1000,
    rmsDb: db(Math.sqrt(sum / (to - from))),
    clipped,
    maxJump: Math.round(maxJump * 1000) / 1000,
    audibleSeconds: Math.round(((lastLoud - from) / buf.sampleRate) * 100) / 100,
    shortMaxDb: Math.max(...shortDb),
    shortMedianDb: [...shortDb].sort((a, b) => a - b)[Math.floor(shortDb.length / 2)],
    shortAbove60: shortDb.filter((v) => v > -60).length,
    above50Pct: Math.round((100 * shortDb.filter((v) => v > -50).length) / shortDb.length),
    longestGapSec: longestRun(shortDb, (v) => v <= -50) * 0.05,
    windowsDb,
  };
}

function longestRun(list, pred) {
  let best = 0;
  let run = 0;
  for (const v of list) {
    run = pred(v) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

// ---------------------------------------------------------------- drawing

function makeCanvas(ui) {
  const canvas = document.createElement('canvas');
  canvas.width = innerWidth - 230;
  canvas.height = innerHeight;
  canvas.style.cssText = 'position:absolute;right:0;top:0;background:#111';
  ui.appendChild(canvas);
  return canvas.getContext('2d');
}

function label(g, text, x, y, color = '#ddd') {
  g.fillStyle = color;
  g.font = '12px monospace';
  g.fillText(text, x, y);
}

// Piano roll of one loop of a compiled song: bars, chord symbols, one colour per instrument.
function drawRoll(g, name) {
  const song = compileSong(SONGS[name]);
  const { width: W, height: H } = g.canvas;
  g.clearRect(0, 0, W, H);
  const lo = 28;
  const hi = 104;
  const x = (beat) => 10 + (beat / song.loopBeats) * (W - 20);
  const y = (midi) => H - 40 - ((midi - lo) / (hi - lo)) * (H - 70);
  for (let b = 0; b <= song.loopBeats; b += song.beatsPerBar) {
    const bar = b / song.beatsPerBar;
    g.fillStyle = bar % 8 === 0 ? '#555' : '#2a2a2a';
    g.fillRect(x(b), 20, 1, H - 50);
  }
  for (const seg of song.timeline) label(g, seg.chord.symbol, x(seg.beat) + 2, H - 22, '#9ab');
  for (const e of song.events) {
    g.fillStyle = INST_COLORS[e.inst];
    const midi = e.midi ?? (e.inst === 'kick' ? 30 : 32);
    g.globalAlpha = 0.35 + 0.65 * e.vel;
    g.fillRect(x(e.beat), y(midi) - 2, Math.max(2, x(e.beat + e.dur) - x(e.beat) - 1), 4);
  }
  g.globalAlpha = 1;
  let lx = 10;
  for (const [inst, color] of Object.entries(INST_COLORS)) {
    label(g, inst, lx, 14, color);
    lx += inst.length * 8 + 16;
  }
  label(g, `${song.title} - ${song.bpm} bpm, ${((song.loopBeats * 60) / song.bpm).toFixed(1)} s loop`, W - 330, 14);
}

// In-place radix-2 FFT magnitude of a real frame (Hann windowed).
function fftMag(frame) {
  const n = frame.length;
  const re = Float32Array.from(frame, (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  return Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i], im[i]));
}

// Waveform envelope on top, log-frequency spectrogram below (pre-roll left out).
function drawRender(g, buf, title) {
  const { width: W, height: H } = g.canvas;
  g.clearRect(0, 0, W, H);
  const skip = Math.floor(PRE_ROLL * buf.sampleRate);
  const L = buf.getChannelData(0).subarray(skip);
  const R = buf.getChannelData(1).subarray(skip);
  const waveH = 120;
  const per = Math.max(1, Math.floor(L.length / W));
  g.fillStyle = '#4cd9a0';
  for (let px = 0; px < W; px++) {
    let mx = 0;
    for (let i = px * per; i < (px + 1) * per && i < L.length; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
    g.fillRect(px, 20 + waveH / 2 - (mx * waveH) / 2, 1, mx * waveH);
  }
  g.fillStyle = '#f55';
  g.fillRect(0, 20 + waveH / 2 - 0.95 * (waveH / 2), W, 1);
  label(g, title, 8, 14);

  // Short renders (single sound effects) use a short FFT, so their transients show.
  const N = L.length < buf.sampleRate * 1.2 ? 512 : 2048;
  const top = waveH + 40;
  const specH = H - top - 20;
  const fLo = 40;
  const fHi = 12000;
  const img = g.createImageData(W, specH);
  const hop = Math.max(1, Math.floor((L.length - N) / W));
  for (let px = 0; px < W; px++) {
    const start = px * hop;
    if (start + N > L.length) break;
    const frame = new Float32Array(N);
    for (let i = 0; i < N; i++) frame[i] = (L[start + i] + R[start + i]) / 2;
    const mag = fftMag(frame);
    for (let py = 0; py < specH; py++) {
      const f = fLo * (fHi / fLo) ** (1 - py / specH);
      // Normalized so a full-scale sine reads ~0 dB; colour spans -84..-12 dB.
      const v = (mag[Math.round((f / buf.sampleRate) * N)] || 0) / (N / 4);
      const lvl = Math.max(0, Math.min(1, (20 * Math.log10(v + 1e-9) + 84) / 72));
      const o = (py * W + px) * 4;
      img.data[o] = 255 * Math.min(1, lvl * 1.8);
      img.data[o + 1] = 255 * Math.max(0, lvl * 1.6 - 0.5);
      img.data[o + 2] = 255 * Math.max(0, 0.6 - Math.abs(lvl - 0.35)) * 1.2;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, top);
  for (const f of [100, 250, 500, 1000, 2000, 4000, 8000]) {
    const py = top + specH * (1 - Math.log(f / fLo) / Math.log(fHi / fLo));
    label(g, `${f}`, 4, py, '#8cf');
  }
}

// ---------------------------------------------------------------- page

function button(parent, text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'margin:2px;padding:3px 6px;font:12px monospace;cursor:pointer';
  b.onclick = onClick;
  parent.appendChild(b);
}

function section(panel, title) {
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'margin:8px 0 2px;color:#ffe066';
  panel.appendChild(h);
}

// Camera positions for the ambience: across the lawn from the spawn point to the castle,
// on the east hill, at the pond and near the waterfall.
const SPOTS = {
  spawn: [{ x: SPAWN.x, y: LAWN_BASE + 400, z: SPAWN.z + 1100 }, Math.PI],
  'mid lawn': [{ x: 0, y: LAWN_BASE + 400, z: 4000 }, Math.PI],
  bridge: [{ x: BRIDGE.x, y: LAWN_BASE + 400, z: BRIDGE.southZ + 1200 }, Math.PI],
  courtyard: [{ x: 0, y: ISLAND_TOP + 450, z: -500 }, Math.PI],
  'east hill': [{ x: EAST_HILL.x, y: LAWN_BASE + EAST_HILL.height + 450, z: EAST_HILL.z + 1100 }, Math.PI],
  'pond edge': [{ x: POND.x + 2000, y: LAWN_BASE + 200, z: POND.z }, -Math.PI / 2],
  waterfall: [{ x: WATERFALL.x + 1500, y: 300, z: WATERFALL.z + 600 }, -Math.PI / 2],
};

// Sounds for the headroom stress test: the loudest ones, all at once.
const STRESS = ['star_get', 'star_appear', 'ground_pound_land', 'land_hard', 'triple_jump', 'hurt', 'coin', 'red_coin', 'one_up', 'bonk', 'splash', 'wallkick', 'kick', 'jump_kick', 'jump'];
// ...and the AI RACE mode's, over the dark track (a blast, a roar and thunder at once).
const DARK_STRESS = ['fireball_explode', 'kaiju_roar', 'thunder', 'fireball_launch', 'burn', 'button_press', 'alarm', 'land_hard', 'hurt', 'steam', 'fire_crackle', 'jump'];

export async function setup({ scene, THREE, ui, params }) {
  scene.background = new THREE.Color(0x111111);
  const g = makeCanvas(ui);
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;left:0;top:0;bottom:0;width:230px;overflow:auto;padding:6px;box-sizing:border-box;' +
    'background:#1c1c24;color:#ddd;font:12px monospace;pointer-events:auto';
  ui.appendChild(panel);

  const audio = new AudioEngine(null);
  const withAudio = (fn) => () => audio.unlock().then(fn);

  section(panel, 'Music');
  for (const name of Object.keys(SONGS)) button(panel, name, withAudio(() => audio.playMusic(name)));
  button(panel, 'stop', () => audio.stopMusic());
  section(panel, 'Listener (ambience)');
  for (const [name, [pos, yaw]] of Object.entries(SPOTS)) {
    button(panel, name, withAudio(() => audio.setListener(pos, yaw)));
  }
  section(panel, 'Sound effects');
  for (const name of Object.keys(SFX)) button(panel, name, withAudio(() => audio.play(name, { index: 1 + Math.floor(Math.random() * 8) })));
  section(panel, 'Footsteps (tiptoe / walk / run)');
  for (const terrain of ['grass', 'stone', 'wood', 'sand', 'water']) {
    button(panel, terrain, withAudio(() => {
      [5, 12, 30].forEach((speed, i) => setTimeout(() => audio.play('footstep', { terrain, ...footstepLevel(speed) }), i * 450));
    }));
  }
  section(panel, 'AI RACE mode');
  button(panel, 'dark on', withAudio(() => audio.setDark(true)));
  button(panel, 'dark off', withAudio(() => audio.setDark(false)));
  for (const s of [0.2, 0.6, 1]) button(panel, `lightning ${s}`, withAudio(() => audio.thunder(s)));
  const tick = () => {
    audio.update(1 / 60);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  section(panel, 'Offline render');
  // A jingle (a song that is nothing but its cue) renders as heard in game, not looped.
  for (const [name, song] of Object.entries(SONGS)) {
    button(panel, `render ${name}`, () => (song.jingle ? window.__renderCue(name) : window.__renderMusic(name, 20)));
  }

  const publish = (r) => (window.__audioResult = r);

  window.__showRoll = (name) => drawRoll(g, name);

  window.__renderMusic = async (name, seconds = 20, fromBeat = 0) => {
    publish({ status: 'running' });
    const t0 = performance.now();
    const buf = await renderSong(name, seconds, fromBeat);
    drawRender(g, buf, `${name} from beat ${fromBeat}, ${seconds} s`);
    return publish({ status: 'done', renderMs: Math.round(performance.now() - t0), ...analyze(buf) });
  };

  // A cue song's in-game ending: the last bars before its finalBar, the ring and fade.
  window.__renderCue = async (name = 'castle_grounds', barsBefore = 3) => {
    publish({ status: 'running' });
    const song = compileSong(SONGS[name]);
    const spb = 60 / song.bpm;
    const fromBeat = Math.max(0, Math.floor(song.endBeat) - barsBefore * song.beatsPerBar);
    const endAt = (song.endBeat - fromBeat) * spb;
    const buf = await renderOffline(endAt + 5, (ctx, mix, t0) => songPlayer(ctx, mix, t0, song, fromBeat, song.endBeat));
    drawRender(g, buf, `${name}: cue ending (final downbeat at ${endAt.toFixed(2)} s)`);
    const at = (s) => Math.floor((PRE_ROLL + s) * SAMPLE_RATE);
    const { windowsDb, ...whole } = analyze(buf);
    // Level of the half second right after the fade has finished (should be silence).
    const after = analyze(buf, 0.5, at(endAt + 3.3), at(endAt + 3.8));
    return publish({ status: 'done', endAt, ...whole, windowsDb, afterFadeDb: after.rmsDb });
  };

  window.__renderSfx = async (names = Object.keys(SFX), opts = {}, seconds = 3) => {
    publish({ status: 'running' });
    const out = {};
    for (const name of names) {
      const buf = await renderOffline(seconds, (ctx, mix, t0) => {
        SFX[name](ctx, mix.sfx, t0, { p: 1, terrain: 'grass', big: true, index: 8, ...opts });
      });
      const { windowsDb, ...a } = analyze(buf);
      out[name] = a;
      if (names.length === 1) drawRender(g, buf, name);
    }
    return publish({ status: 'done', ...out });
  };

  // Timed sound effects through the engine's own voice path (pitch jitter, voice gain), with
  // the live ambience heard from a SPOTS listener if `spot` is given. cues: [[t, name, opts?]].
  window.__renderSequence = async (cues, seconds = null, spot = null) => {
    publish({ status: 'running' });
    const end = seconds ?? Math.max(...cues.map(([t]) => t)) + 1.5;
    const buf = await renderOffline(end, (ctx, mix, t0) => {
      const engine = offlineEngine(ctx, mix);
      if (spot) engine.setListener(...SPOTS[spot]);
      const pending = cues.map(([t, name, opts]) => ({ at: t0 + t, name, opts })).sort((a, b) => a.at - b.at);
      // Cues are started from the STEP callbacks, a little late at worst, like the live game's
      // frame-quantised events; the ambience (if any) updates on the same clock.
      return (t) => {
        while (pending.length && pending[0].at <= t + 1e-6) {
          const c = pending.shift();
          engine.voice(SFX[c.name], { terrain: 'grass', ...c.opts }, mix.sfx);
        }
        if (spot && t >= t0) engine.update(STEP);
      };
    });
    drawRender(g, buf, `sequence: ${cues.map(([t, n]) => `${n}@${t}`).join(' ').slice(0, 140)}`);
    const { windowsDb, ...a } = analyze(buf, 0.1);
    return publish({ status: 'done', ...a, windowsDb });
  };

  // The ground combo near its in-game rhythm (a hit every 7 ticks at 30 Hz, rounded to the
  // render's 0.1 s step), then a jump and a flying kick.
  window.__renderCombo = () =>
    window.__renderSequence([[0, 'punch1'], [0.2, 'punch2'], [0.4, 'kick'], [1.2, 'jump'], [1.5, 'jump_kick']], 2.4);

  // A sign read at the dialog box's pace: open, a blip every 3 characters of typing (at 30
  // characters a second), next page, more typing, close; over the spawn ambience by default.
  window.__renderDialog = (spot = 'spawn') => {
    const cues = [[0, 'dialog_open']];
    for (let i = 0; i < 14; i++) cues.push([0.3 + i * 0.1, 'text_blip']);
    cues.push([2.2, 'dialog_next']);
    for (let i = 0; i < 10; i++) cues.push([2.4 + i * 0.1, 'text_blip']);
    cues.push([4, 'dialog_close']);
    return window.__renderSequence(cues, 5, spot);
  };

  // The live ambience code (and optionally a music track) heard from one of SPOTS.
  window.__renderAmbience = async (spot = 'spawn', seconds = 30, music = null) => {
    publish({ status: 'running' });
    let calls = 0;
    const buf = await renderOffline(seconds, (ctx, mix, t0) => {
      const engine = offlineEngine(ctx, mix);
      engine.setListener(...SPOTS[spot]);
      const playAt = engine.ambience.playAt;
      engine.ambience.playAt = (recipe, pos) => {
        calls++;
        playAt(recipe, pos);
      };
      const song = music && songPlayer(ctx, mix, t0, compileSong(SONGS[music]));
      return (t) => {
        if (t >= t0) engine.update(STEP);
        song?.(t);
      };
    });
    drawRender(g, buf, `ambience at ${spot}${music ? ` with ${music}` : ''}, ${seconds} s`);
    const { windowsDb, ...a } = analyze(buf);
    return publish({ status: 'done', calls, ...a });
  };

  // Many loud sounds at once over the castle music: the mix must stay below full scale.
  window.__stress = async (names = STRESS, fromBeat = 108) => {
    publish({ status: 'running' });
    const buf = await renderOffline(5, (ctx, mix, t0) => {
      names.forEach((n, i) => SFX[n](ctx, mix.sfx, t0 + 0.5 + i * 0.012, { p: 1, big: true, index: 8, terrain: 'stone' }));
      return songPlayer(ctx, mix, t0, compileSong(SONGS.castle_grounds), fromBeat);
    });
    drawRender(g, buf, `stress: ${names.length} sounds over castle_grounds`);
    const { peak, clipped } = analyze(buf);
    return publish({ status: 'done', peak, clipped });
  };

  // Level of each instrument alone (for mix balance).
  window.__stemLevels = async (name, seconds = 16, fromBeat = 0) => {
    publish({ status: 'running' });
    const insts = [...new Set(compileSong(SONGS[name]).events.map((e) => e.inst))];
    const out = {};
    for (const inst of insts) {
      const buf = await renderSong(name, seconds, fromBeat, [inst]);
      const { peak, rmsDb } = analyze(buf);
      out[inst] = { peak, rmsDb };
    }
    return publish({ status: 'done', ...out });
  };

  // Render across the loop point and compare it with the loop's normal bar-to-bar flow.
  window.__loopSeam = async (name, barsBefore = 4, barsAfter = 4) => {
    publish({ status: 'running' });
    const song = compileSong(SONGS[name]);
    const spb = 60 / song.bpm;
    const fromBeat = song.loopBeats - barsBefore * song.beatsPerBar;
    const seam = barsBefore * song.beatsPerBar * spb;
    const seconds = seam + barsAfter * song.beatsPerBar * spb;
    const buf = await renderSong(name, seconds, fromBeat);
    drawRender(g, buf, `${name}: loop seam at ${seam.toFixed(2)} s`);
    const at = (s) => Math.floor((PRE_ROLL + s) * SAMPLE_RATE);
    const around = analyze(buf, 0.1, at(seam - 0.5), at(seam + 0.5));
    const whole = analyze(buf, 0.5);
    return publish({
      status: 'done',
      seamSeconds: seam,
      seamWindowsDb: around.windowsDb,
      seamMaxJump: around.maxJump,
      wholeMaxJump: whole.maxJump,
      peak: whole.peak,
      windowsDb: whole.windowsDb,
    });
  };

  // ---- AI RACE mode

  // Steady-state dark mode heard from a SPOTS listener: the storm beds (storm), the dark
  // track at its playback level (music), and thunder for lightning at [[t, strength]] (with
  // the engine's random delay). Returns the analysis (0.5 s windows).
  window.__renderDark = async (spot = 'spawn', seconds = 30, { storm = true, music = true, lightning = [], fromBeat = 0 } = {}) => {
    publish({ status: 'running' });
    const buf = await renderOffline(seconds, (ctx, mix, t0) => {
      const engine = offlineEngine(ctx, mix);
      engine.setListener(...SPOTS[spot]);
      engine.dark = true;
      engine.ambience.setDark(true, 0.01);
      engine.ambience.birds = 0;
      if (storm) engine.storm.set(true, 0.01);
      const song = music ? songPlayer(ctx, mix, t0, compileSong(SONGS.dark), fromBeat) : null;
      const flashes = lightning.map(([t, strength]) => ({ at: t0 + t, strength }));
      return (t) => {
        while (flashes.length && flashes[0].at <= t + 1e-6) engine.thunder(flashes.shift().strength);
        engine.update(STEP);
        song?.(t);
      };
    });
    drawRender(g, buf, `dark mode at ${spot}: ${[storm && 'storm', music && 'music', lightning.length && 'thunder'].filter(Boolean).join(' + ')}, ${seconds} s`);
    return publish({ status: 'done', ...analyze(buf) });
  };

  // The switch through the engine itself: sunny for 5 s, darkMode on (alarm, 3 s crossfade to
  // the storm and the dark track), on for `onSeconds`, then off (3 s back), 8 s more.
  window.__renderDarkSwitch = async (spot = 'spawn', onSeconds = 15) => {
    publish({ status: 'running' });
    const seconds = 5 + onSeconds + 8;
    let voicesMax = 0;
    const buf = await renderOffline(seconds, (ctx, mix, t0) => {
      const events = new Events();
      const engine = offlineEngine(ctx, mix, events);
      engine.setListener(...SPOTS[spot]);
      const drive = trackDriver(engine);
      return (t) => {
        if (Math.abs(t - (t0 + 5)) < 1e-6) events.emit('darkMode', { on: true });
        if (Math.abs(t - (t0 + 5 + onSeconds)) < 1e-6) events.emit('darkMode', { on: false });
        if (t >= t0) engine.update(STEP);
        drive(t);
        voicesMax = Math.max(voicesMax, engine.active.length);
      };
    });
    drawRender(g, buf, `darkMode at ${spot}: on at 5 s, off at ${5 + onSeconds} s`);
    const a = analyze(buf, 1);
    return publish({ status: 'done', voicesMax, ...a });
  };

  // Footsteps through the engine's 'footstep' handler at each speed (one step every 0.3 s):
  // the peak and short-term level of each step.
  window.__renderSteps = async (speeds = [3, 6, 10, 14, 18, 24, 32], terrain = 'grass') => {
    publish({ status: 'running' });
    const buf = await renderOffline(speeds.length * 0.3 + 0.5, (ctx, mix, t0) => {
      const events = new Events();
      const engine = offlineEngine(ctx, mix, events);
      engine.ambience.pastoral.gain.value = 0;
      engine.ambience.birds = 0;
      engine.ambience.dark = true; // no birds between the steps
      const pending = speeds.map((speed, i) => ({ at: t0 + i * 0.3, speed }));
      return (t) => {
        while (pending.length && pending[0].at <= t + 1e-6) events.emit('footstep', { terrain, speed: pending.shift().speed });
      };
    });
    drawRender(g, buf, `footsteps on ${terrain} at speeds ${speeds.join(', ')}`);
    const at = (x) => Math.floor((PRE_ROLL + x) * SAMPLE_RATE);
    const out = {};
    speeds.forEach((speed, i) => {
      const w = analyze(buf, 0.05, at(i * 0.3), at(i * 0.3 + 0.25));
      out[speed] = { peak: w.peak, shortMaxDb: w.shortMaxDb };
    });
    return publish({ status: 'done', terrain, ...out });
  };

  // Landings through the engine's 'land' handler: a tiny hop (0.3 s after a jump), a full
  // jump (0.8 s), a step down right after a footstep, an unknown (long) fall, a hard landing.
  window.__renderLandings = async (terrain = 'grass') => {
    publish({ status: 'running' });
    const cases = [['hop', 0.3], ['jump', 0.8], ['stepDown', 0.1], ['fall', null], ['hard', null]];
    const buf = await renderOffline(cases.length * 1.5, (ctx, mix, t0) => {
      const events = new Events();
      const engine = offlineEngine(ctx, mix, events);
      engine.ambience.pastoral.gain.value = 0;
      engine.ambience.dark = true;
      engine.ambience.birds = 0;
      const plan = [];
      cases.forEach(([name, air], i) => {
        const at = t0 + i * 1.5 + 0.5;
        if (name === 'stepDown') plan.push({ at: at - air, fn: () => (engine.groundedAt = ctx.currentTime) });
        else if (air) plan.push({ at: at - air, fn: () => (engine.groundedAt = ctx.currentTime) });
        else plan.push({ at: at - 0.05, fn: () => (engine.groundedAt = -Infinity) });
        plan.push({ at, fn: () => events.emit('land', { terrain, hard: name === 'hard' }) });
      });
      plan.sort((a, b) => a.at - b.at);
      return (t) => {
        while (plan.length && plan[0].at <= t + 1e-6) plan.shift().fn();
      };
    });
    drawRender(g, buf, `landings on ${terrain}: ${cases.map(([n]) => n).join(', ')}`);
    const at = (x) => Math.floor((PRE_ROLL + x) * SAMPLE_RATE);
    const out = {};
    cases.forEach(([name], i) => {
      const w = analyze(buf, 0.05, at(i * 1.5 + 0.45), at(i * 1.5 + 1.2));
      out[name] = { peak: w.peak, shortMaxDb: w.shortMaxDb };
    });
    return publish({ status: 'done', terrain, ...out });
  };

  // Headroom in dark mode: the loudest AI RACE sounds at once over the storm and dark track.
  window.__stressDark = async (names = DARK_STRESS) => {
    publish({ status: 'running' });
    const buf = await renderOffline(6, (ctx, mix, t0) => {
      const engine = offlineEngine(ctx, mix);
      engine.dark = true;
      engine.ambience.setDark(true, 0.01);
      engine.ambience.birds = 0;
      engine.storm.set(true, 0.01);
      names.forEach((n, i) => SFX[n](ctx, mix.sfx, t0 + 0.5 + i * 0.012, { p: 1, big: true, strength: 1, terrain: 'stone' }));
      const song = songPlayer(ctx, mix, t0, compileSong(SONGS.dark), 64);
      return (t) => {
        engine.update(STEP);
        song(t);
      };
    });
    drawRender(g, buf, `dark stress: ${names.length} sounds over storm + dark track`);
    const { peak, clipped } = analyze(buf);
    return publish({ status: 'done', peak, clipped });
  };

  if (params.get('roll')) drawRoll(g, params.get('roll'));
  return {};
}
