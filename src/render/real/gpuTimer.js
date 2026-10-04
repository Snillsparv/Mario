// The realistic look's GPU time per frame (render/real/RealLook.js), for the F1 overlay's line
// 'gpu 8.4 ms' while it shows and for the governor's headroom before a step up while it runs
// (tier.js Governor; high and mid tiers: the look's frame, its shadow passes, the
// scene, the post chain and the output pass): a TIME_ELAPSED query round each frame where the
// browser has EXT_disjoint_timer_query_webgl2 (read a few frames later, never waited for; a
// frame the GPU was disturbed in is dropped), averaged over the last WINDOW frames. Where it
// has none the line says so: frame times then come from the overlay's fps alone.
//
//   const timer = new GpuTimer(gl)
//   timer.begin(), timer.end()   // round one frame's drawing (a frame while one is pending
//                                // too long is skipped)
//   timer.ms                     // the average (ms), or null before the first result
//   timer.reset()                // the times so far forgotten (a new level)
//   timer.line() -> 'gpu 8.4 ms' | 'gpu: no timer' | 'gpu ...'
//   timer.dispose()

const WINDOW = 30;
const PENDING = 6; // queries in flight at most

export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    this.active = null;
    this.pending = [];
    this.times = [];
    this.ms = null;
  }

  begin() {
    const { gl, ext } = this;
    if (!ext || this.active || this.pending.length >= PENDING) return;
    this.active = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    const { gl, ext } = this;
    if (!this.active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  poll() {
    const { gl, ext } = this;
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift();
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
      gl.deleteQuery(query);
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) continue;
      this.times.push(ns / 1e6);
      if (this.times.length > WINDOW) this.times.shift();
      this.ms = this.times.reduce((a, b) => a + b, 0) / this.times.length;
    }
  }

  // (The times so far forgotten: a new level of the look's.)
  reset() {
    this.times = [];
    this.ms = null;
  }

  line() {
    if (!this.ext) return 'gpu: no timer';
    return this.ms === null ? 'gpu ...' : `gpu ${this.ms.toFixed(1)} ms`;
  }

  dispose() {
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending = [];
  }
}
