// Plays a compiled song (compile.js) on the AudioContext clock. A 25 ms timer schedules
// every note that starts within the next 100 ms, so timing is sample-accurate even when
// the main thread stutters. Offline renders call scheduleUntil() directly instead.

import { INSTRUMENTS, CHANNELS } from './instruments.js';

const LOOKAHEAD = 0.1;
const TICK_MS = 25;

export class Sequencer {
  constructor(ctx, song, out) {
    this.ctx = ctx;
    this.song = song;
    this.spb = 60 / song.bpm;
    this.timer = null;
    // One channel strip (level + pan) per instrument in the song.
    this.channels = {};
    for (const { inst } of song.events) {
      if (this.channels[inst]) continue;
      const g = ctx.createGain();
      g.gain.value = CHANNELS[inst].gain;
      const pan = ctx.createStereoPanner();
      pan.pan.value = CHANNELS[inst].pan;
      g.connect(pan).connect(out);
      this.channels[inst] = g;
    }
  }

  // Start playing at context time `when`, from `fromBeat` into the song.
  start(when, { fromBeat = 0, realtime = true } = {}) {
    const { events } = this.song;
    this.index = events.findIndex((e) => e.beat >= fromBeat);
    this.loop = 0;
    if (this.index < 0) {
      this.index = 0;
      this.loop = 1;
    }
    this.origin = when - fromBeat * this.spb;
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
      const t = this.origin + (this.loop * loopBeats + e.beat) * this.spb;
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
