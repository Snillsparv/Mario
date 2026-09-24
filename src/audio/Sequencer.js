// Plays a compiled song (compile.js) on the AudioContext clock. A 25 ms timer schedules
// every note that starts within the next 100 ms, so timing is sample-accurate even when
// the main thread stutters. Offline renders call scheduleUntil() directly instead.
// A song loops forever, or plays once as a cue when started with an endBeat: notes from
// endBeat on are dropped, the last ones ring for CUE_RING and then everything fades out.

import { INSTRUMENTS, CHANNELS } from './instruments.js';

const LOOKAHEAD = 0.1;
const TICK_MS = 25;
const CUE_RING = 1.2; // seconds the final notes of a cue ring at full level...
const CUE_FADE = 2; // ...before fading to silence over this long

export class Sequencer {
  constructor(ctx, song, out) {
    this.ctx = ctx;
    this.song = song;
    this.spb = 60 / song.bpm;
    this.timer = null;
    this.endBeat = Infinity;
    this.endTime = Infinity; // context time a cue has faded out by
    // Song output (faded at the end of a cue), fed by one channel strip (level + pan) per
    // instrument in the song (the song's own mix trims the level).
    this.out = ctx.createGain();
    this.out.connect(out);
    this.channels = {};
    for (const { inst } of song.events) {
      if (this.channels[inst]) continue;
      const g = ctx.createGain();
      g.gain.value = CHANNELS[inst].gain * (song.mix?.[inst] ?? 1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = CHANNELS[inst].pan;
      g.connect(pan).connect(this.out);
      this.channels[inst] = g;
    }
  }

  // Start playing at context time `when`, from `fromBeat` into the song; with `endBeat`
  // (beats from the song's start) it plays once up to there instead of looping.
  start(when, { fromBeat = 0, realtime = true, endBeat = null } = {}) {
    const { events } = this.song;
    this.index = events.findIndex((e) => e.beat >= fromBeat);
    this.loop = 0;
    if (this.index < 0) {
      this.index = 0;
      this.loop = 1;
    }
    this.origin = when - fromBeat * this.spb;
    if (endBeat !== null) {
      const fadeFrom = this.origin + endBeat * this.spb + CUE_RING;
      this.out.gain.setValueAtTime(1, fadeFrom);
      this.out.gain.linearRampToValueAtTime(0, fadeFrom + CUE_FADE);
      this.endBeat = endBeat;
      this.endTime = fadeFrom + CUE_FADE;
    }
    if (realtime) {
      this.tick = () => this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD);
      this.tick();
      this.timer = setInterval(this.tick, TICK_MS);
    }
  }

  scheduleUntil(until) {
    const { events, loopBeats } = this.song;
    const late = this.ctx.currentTime - 0.01;
    for (;;) {
      const e = events[this.index];
      const beat = this.loop * loopBeats + e.beat;
      if (beat >= this.endBeat) {
        this.stop();
        break;
      }
      const t = this.origin + beat * this.spb;
      if (t >= until) break;
      // Notes whose time has already passed (e.g. after a hiccup) are skipped, not bunched.
      if (t >= late) INSTRUMENTS[e.inst](this.ctx, this.channels[e.inst], t, e.dur * this.spb, e.midi, e.vel);
      if (++this.index >= events.length) {
        this.index = 0;
        this.loop++;
      }
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
