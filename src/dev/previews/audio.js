// Audio preview: /preview.html?m=audio
//
// For people: buttons to audition every sound effect, both music loops and the ambience
// at a few listener positions.
// For automation (no speakers in CI): offline renders with analysis and pictures.
//   __renderMusic(name, seconds = 20, fromBeat = 0)  -> analysis; draws waveform + spectrogram
//   __renderSfx(names?, opts?)                      -> { name: analysis } for one-shots
//   __renderAmbience(spot, seconds = 30, music?)    -> analysis of the live ambience code
//   __stress(names?)                                -> peak of many sfx at once over music
//   __loopSeam(name)                                -> analysis around the loop point
//   __showRoll(name)                                -> draws the compiled score as a piano roll
// Renders mimic the live engine: music is scheduled in 0.1 s steps (like the lookahead
// timer) and every sound starts after PRE_ROLL seconds, once the master compressor has
// settled (it starts out in gain reduction). Analysis covers only the part after PRE_ROLL.
// Each call also stores its result in window.__audioResult (tools/shot.mjs's eval does not
// await promises, so poll that after a wait). &roll=<song> draws a piano roll on load.

import { AudioEngine } from '../../audio/AudioEngine.js';
import { Ambience } from '../../audio/ambience.js';
import { SONGS } from '../../audio/songs.js';
import { compileSong } from '../../audio/compile.js';
import { createMixer } from '../../audio/mixer.js';
import { Sequencer } from '../../audio/Sequencer.js';
import { SFX } from '../../audio/sfx.js';
import { WATERFALL, SPAWN, POND, LAWN_BASE } from '../../world/layout.js';

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
    const hook = (t) =>
      ctx.suspend(t).then(() => {
        onStep(t);
        if (t + STEP < total - 0.01) hook(Math.round((t + STEP) * 1000) / 1000);
        ctx.resume();
      });
    hook(STEP);
  }
  return ctx.startRendering();
}

// A song's sequencer on the music bus at its playback level, scheduled like the live
// lookahead timer. Returns the per-step callback.
function songPlayer(ctx, mix, t0, song, fromBeat = 0) {
  const level = ctx.createGain();
  level.gain.value = song.level;
  level.connect(mix.music);
  const seq = new Sequencer(ctx, song, level);
  seq.start(t0, { fromBeat, realtime: false });
  seq.scheduleUntil(STEP + 0.15);
  return (t) => seq.scheduleUntil(t + 0.15);
}

// Render a song, optionally only some instruments (stems).
function renderSong(name, seconds, fromBeat, only = null) {
  const song = compileSong(SONGS[name]);
  if (only) song.events = song.events.filter((e) => only.includes(e.inst));
  return renderOffline(seconds, (ctx, mix, t0) => songPlayer(ctx, mix, t0, song, fromBeat));
}

// An AudioEngine playing into an offline context, for the real voice/ambience code paths.
// (The engine only plays into a 'running' context, and an OfflineAudioContext reports
// 'suspended' inside suspend() callbacks, hence the state override.)
function offlineEngine(ctx, mix) {
  const engine = new AudioEngine(null);
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const ambience = new Ambience(ctx, mix.amb, {
    playAt: (recipe, pos) => engine.voice(recipe, { pos }, mix.amb),
    spatial: (pos) => engine.spatial(pos),
  });
  Object.assign(engine, { ctx, mix, ambience });
  engine.applyLevels();
  return engine;
}

const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;

// Peak, RMS, clipping, largest sample-to-sample jump (clicks), RMS per window, and the
// max / median / count above -60 dB of 50 ms short-term RMS.
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
    windowsDb,
  };
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

  const N = 2048;
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

// Camera positions for the ambience: behind the hero at the spawn point, at the pond, and
// near the waterfall.
const SPOTS = {
  spawn: [{ x: SPAWN.x, y: LAWN_BASE + 400, z: SPAWN.z + 1100 }, Math.PI],
  'pond edge': [{ x: POND.x + 2000, y: LAWN_BASE + 200, z: POND.z }, -Math.PI / 2],
  waterfall: [{ x: WATERFALL.x + 1500, y: 300, z: WATERFALL.z + 600 }, -Math.PI / 2],
};

// Sounds for the headroom stress test: the loudest ones, all at once.
const STRESS = ['star_get', 'star_appear', 'ground_pound_land', 'land_hard', 'triple_jump', 'hurt', 'coin', 'red_coin', 'one_up', 'bonk', 'splash', 'wallkick'];

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
  section(panel, 'Footsteps');
  for (const terrain of ['grass', 'stone', 'wood', 'sand', 'water']) {
    button(panel, terrain, withAudio(() => audio.play('footstep', { terrain })));
  }
  section(panel, 'Offline render');
  for (const name of Object.keys(SONGS)) button(panel, `render ${name}`, () => window.__renderMusic(name, 20));

  const publish = (r) => (window.__audioResult = r);

  window.__showRoll = (name) => drawRoll(g, name);

  window.__renderMusic = async (name, seconds = 20, fromBeat = 0) => {
    publish({ status: 'running' });
    const t0 = performance.now();
    const buf = await renderSong(name, seconds, fromBeat);
    drawRender(g, buf, `${name} from beat ${fromBeat}, ${seconds} s`);
    return publish({ status: 'done', renderMs: Math.round(performance.now() - t0), ...analyze(buf) });
  };

  window.__renderSfx = async (names = Object.keys(SFX), opts = {}) => {
    publish({ status: 'running' });
    const out = {};
    for (const name of names) {
      const buf = await renderOffline(3, (ctx, mix, t0) => {
        SFX[name](ctx, mix.sfx, t0, { p: 1, terrain: 'grass', big: true, index: 8, ...opts });
      });
      const { windowsDb, ...a } = analyze(buf);
      out[name] = a;
      if (names.length === 1) drawRender(g, buf, name);
    }
    return publish({ status: 'done', ...out });
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

  if (params.get('roll')) drawRoll(g, params.get('roll'));
  return {};
}
