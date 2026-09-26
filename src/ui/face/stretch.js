// The face screen's stretch toy as plain numbers (no three.js, no DOM: node-testable).
//
//   falloff(d)       how much of a handle's pull a point gets at distance d (in radii) from
//                    the grab point: 1 there, 0 from one radius on, smooth at both ends
//                    ((1 - d^2)^3). pipHead.js's vertex shader evaluates the same field.
//   Stretch          a pool of STRETCH.HANDLES handles. grab(x, y, z) takes one at a rest-space
//                    point (a free one, else the released one with the least wobble left);
//                    pull(h, x, y, z) says where the grab point should go (an offset, soft-
//                    limited to STRETCH.MAX); a stiff spring follows it while held, so a fast
//                    pull lags a hair and carries momentum; release(h) lets it spring back to
//                    rest with a lightly damped wobble (the jelly jiggle) and frees the slot once
//                    it has settled. Every point of the head moves by
//                    displacement(p) = sum_i offset_i * falloff(|p - grab_i| / radius_i).
//   HeadTurn         yaw/pitch of the whole head from a drag on the background (or a pad's
//                    stick), soft-clamped, springing back to facing the viewer on release.
//   Zoom             mouse wheel / pinch, clamped to ZOOM.MIN..ZOOM.MAX and eased.
//   raycast()        a ray against an indexed triangle mesh (picking the shown, deformed head).
//   FaceMood         the expression to show: blinks, surprise while pulled (alarm when pulled
//                    far, a wince at the limit), a giggle while it wobbles, a dazed double blink
//                    after a big wobble.
//   menuPlan(search) which menus run before play (the title card, the face screen).

export const STRETCH = Object.freeze({
  HANDLES: 8,
  RADIUS: 19, // head units (the head's radius is 30): what a grab takes with it ...
  NOSE_RADIUS: 8.5, // ... on the nose (it pulls out on its own, the eyes beside it stay put)
  BRIM_RADIUS: 24, // ... on the hat's broad brim
  MAX: 72, // the longest pull (a soft limit), head units
  HOLD_HZ: 6, // held: a stiff, nearly critically damped spring after the pointer
  HOLD_ZETA: 0.72,
  WOBBLE_HZ: 3.1, // released: the jelly jiggle back to rest
  WOBBLE_ZETA: 0.12,
  SETTLE: 0.04, // a released handle whose offset (units) and speed (units per 10 s) are both
  //              under this is at rest: its slot is free again
  SUBSTEP: 1 / 240, // spring integration step (seconds)
});

export const TURN = Object.freeze({
  MAX_YAW: 1.0, // radians either way
  MAX_PITCH: 0.5,
  PER_HEIGHT: 2.6, // radians of turn per picture height dragged
  HOLD_HZ: 5,
  HOLD_ZETA: 0.8,
  BACK_HZ: 1.4, // released: back to facing the viewer with a small overshoot
  BACK_ZETA: 0.3,
});

export const ZOOM = Object.freeze({
  MIN: 0.8,
  MAX: 1.35,
  PER_WHEEL: 0.0012, // per wheel delta pixel (exponential)
  EASE: 10, // 1/s
});

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Pull share at d radii from the grab point.
export function falloff(d) {
  if (!(d < 1)) return 0;
  const k = 1 - d * d;
  return k * k * k;
}

// The grab radius for a rest-space point: the nose pulls out alone, the hat brim bends broadly.
const NOSE_CENTRE = [0, -5.5, 30.5]; // (player/model/rig.js buildHead)
export function grabRadius(x, y, z) {
  if (Math.hypot(x - NOSE_CENTRE[0], y - NOSE_CENTRE[1], z - NOSE_CENTRE[2]) < 6.5) return STRETCH.NOSE_RADIUS;
  if (y > 10 && Math.hypot(x, z) > 33) return STRETCH.BRIM_RADIUS;
  return STRETCH.RADIUS;
}

// len limited to `max`: unchanged up to 65 % of it, then easing into the limit.
export function softLimit(len, max) {
  const knee = 0.65 * max;
  if (len <= knee) return len;
  const room = max - knee;
  return knee + room * Math.tanh((len - knee) / room);
}

// One step of a damped spring pulling x toward `goal` (semi-implicit Euler, stable for the
// substeps used here). Returns the new [x, v] through `out`.
function springStep(x, v, goal, omega, zeta, dt, out) {
  const a = omega * omega * (goal - x) - 2 * zeta * omega * v;
  v += a * dt;
  x += v * dt;
  out[0] = x;
  out[1] = v;
}

const TWO_PI = Math.PI * 2;
const scratch = [0, 0];

function makeHandle(id) {
  return {
    id,
    active: false, // taking part in the deformation
    held: false, // a pointer holds it (else it springs back)
    gx: 0, gy: 0, gz: 0, // grab point (rest space)
    radius: STRETCH.RADIUS,
    ox: 0, oy: 0, oz: 0, // offset of the grab point
    vx: 0, vy: 0, vz: 0, // its velocity (units/s)
    tx: 0, ty: 0, tz: 0, // where a held one is pulled to (offset)
    peak: 0, // longest offset while held
    age: 0, // seconds since grabbed
  };
}

export class Stretch {
  constructor(count = STRETCH.HANDLES) {
    this.handles = Array.from({ length: count }, (_, i) => makeHandle(i));
  }

  get activeCount() {
    let n = 0;
    for (const h of this.handles) if (h.active) n++;
    return n;
  }

  // Wobble left in a released handle: its amplitude (offset plus speed over the spring rate).
  static energy(h) {
    const w = TWO_PI * STRETCH.WOBBLE_HZ;
    return Math.hypot(h.ox, h.oy, h.oz, h.vx / w, h.vy / w, h.vz / w);
  }

  // Take a handle at rest-space point (x, y, z). Returns it, or null when every one is held.
  grab(x, y, z, radius = grabRadius(x, y, z)) {
    let h = this.handles.find((c) => !c.active);
    if (!h) {
      let best = Infinity;
      for (const c of this.handles) {
        if (c.held) continue;
        const e = Stretch.energy(c);
        if (e < best) {
          best = e;
          h = c;
        }
      }
    }
    if (!h) return null;
    Object.assign(h, makeHandle(h.id), { active: true, held: true, gx: x, gy: y, gz: z, radius });
    return h;
  }

  // Where a held handle's grab point should be, as an offset from where it was grabbed (rest
  // space). The length is soft-limited to STRETCH.MAX; returns the limited length.
  pull(h, x, y, z) {
    if (!h?.held) return 0;
    const len = Math.hypot(x, y, z);
    const lim = softLimit(len, STRETCH.MAX);
    const k = len > 1e-9 ? lim / len : 0;
    h.tx = x * k;
    h.ty = y * k;
    h.tz = z * k;
    return lim;
  }

  // Let go: it springs back to rest. Returns the longest stretch it had while held.
  release(h) {
    if (!h?.held) return 0;
    h.held = false;
    h.tx = h.ty = h.tz = 0;
    return h.peak;
  }

  releaseAll() {
    for (const h of this.handles) this.release(h);
  }

  reset() {
    for (const h of this.handles) Object.assign(h, makeHandle(h.id));
  }

  update(dt) {
    if (!(dt > 0)) return;
    const steps = Math.min(64, Math.ceil(dt / STRETCH.SUBSTEP));
    const sdt = dt / steps;
    for (const h of this.handles) {
      if (!h.active) continue;
      h.age += dt;
      const omega = TWO_PI * (h.held ? STRETCH.HOLD_HZ : STRETCH.WOBBLE_HZ);
      const zeta = h.held ? STRETCH.HOLD_ZETA : STRETCH.WOBBLE_ZETA;
      for (let i = 0; i < steps; i++) {
        springStep(h.ox, h.vx, h.tx, omega, zeta, sdt, scratch);
        h.ox = scratch[0];
        h.vx = scratch[1];
        springStep(h.oy, h.vy, h.ty, omega, zeta, sdt, scratch);
        h.oy = scratch[0];
        h.vy = scratch[1];
        springStep(h.oz, h.vz, h.tz, omega, zeta, sdt, scratch);
        h.oz = scratch[0];
        h.vz = scratch[1];
      }
      if (h.held) h.peak = Math.max(h.peak, Math.hypot(h.ox, h.oy, h.oz));
      else if (Math.hypot(h.ox, h.oy, h.oz) < STRETCH.SETTLE && Math.hypot(h.vx, h.vy, h.vz) < STRETCH.SETTLE * 10) {
        Object.assign(h, makeHandle(h.id)); // settled: the slot is free
      }
    }
  }

  // Displacement of rest-space point (x, y, z): written to `out` ({ x, y, z }), returned.
  displacement(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    out.x = out.y = out.z = 0;
    for (const h of this.handles) {
      if (!h.active) continue;
      const f = falloff(Math.hypot(x - h.gx, y - h.gy, z - h.gz) / h.radius);
      if (f === 0) continue;
      out.x += h.ox * f;
      out.y += h.oy * f;
      out.z += h.oz * f;
    }
    return out;
  }

  // out = rest + displacement(rest) for a flat xyz array (the shown surface, for picking).
  deform(rest, out = new Float32Array(rest.length)) {
    out.set(rest);
    for (const h of this.handles) {
      if (!h.active || Math.hypot(h.ox, h.oy, h.oz) < 1e-6) continue;
      const r2 = h.radius * h.radius;
      for (let i = 0; i < rest.length; i += 3) {
        const dx = rest[i] - h.gx;
        const dy = rest[i + 1] - h.gy;
        const dz = rest[i + 2] - h.gz;
        const q = (dx * dx + dy * dy + dz * dz) / r2;
        if (q >= 1) continue;
        const k = 1 - q;
        const f = k * k * k;
        out[i] += h.ox * f;
        out[i + 1] += h.oy * f;
        out[i + 2] += h.oz * f;
      }
    }
    return out;
  }

  // The shader's uniform arrays: grab (x, y, z, radius; radius 0 = off) and offset per handle.
  writeUniforms(grab, offset) {
    this.handles.forEach((h, i) => {
      grab[i * 4] = h.gx;
      grab[i * 4 + 1] = h.gy;
      grab[i * 4 + 2] = h.gz;
      grab[i * 4 + 3] = h.active ? h.radius : 0;
      offset[i * 3] = h.ox;
      offset[i * 3 + 1] = h.oy;
      offset[i * 3 + 2] = h.oz;
    });
  }

  // How far the held handles are pulled (0..1 of STRETCH.MAX, the most pulled one).
  pullLevel() {
    let m = 0;
    for (const h of this.handles) if (h.held) m = Math.max(m, Math.hypot(h.ox, h.oy, h.oz));
    return m / STRETCH.MAX;
  }

  // How much the released handles still wobble (0..1 of STRETCH.MAX, the liveliest one).
  wobbleLevel() {
    let m = 0;
    for (const h of this.handles) if (h.active && !h.held) m = Math.max(m, Stretch.energy(h));
    return m / STRETCH.MAX;
  }

  get holding() {
    return this.handles.some((h) => h.held);
  }
}

// Turning the whole head by dragging the background.
export class HeadTurn {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
    this.vYaw = 0;
    this.vPitch = 0;
    this.held = false;
    this.goalYaw = 0; // unclamped drag sums
    this.goalPitch = 0;
    this.stick = false; // a pad's stick holds it
  }

  // A drag started (at the current turn, so it never jumps).
  grab() {
    this.held = true;
    this.goalYaw = this.yaw;
    this.goalPitch = this.pitch;
  }

  // Drag by (dx, dy) picture heights (right / down positive): right turns his face to the
  // viewer's right, down tips it down.
  drag(dx, dy) {
    if (!this.held) return;
    this.goalYaw += dx * TURN.PER_HEIGHT;
    this.goalPitch += dy * TURN.PER_HEIGHT;
  }

  release() {
    this.held = false;
    this.goalYaw = this.goalPitch = 0;
  }

  // A pad's stick (-1..1, y up): turns while pushed, springs back when let go.
  setStick(x, y) {
    const on = Math.hypot(x, y) > 0.2;
    if (on) {
      this.stick = true;
      this.goalYaw = x * TURN.MAX_YAW;
      this.goalPitch = -y * TURN.MAX_PITCH;
    } else if (this.stick) {
      this.stick = false;
      if (!this.held) this.goalYaw = this.goalPitch = 0;
    }
  }

  // Where it is being turned to (soft-clamped), 0 when let go.
  get target() {
    const soft = (v, max) => Math.sign(v) * softLimit(Math.abs(v), max);
    return { yaw: soft(this.goalYaw, TURN.MAX_YAW), pitch: soft(this.goalPitch, TURN.MAX_PITCH) };
  }

  update(dt) {
    if (!(dt > 0)) return;
    const { yaw, pitch } = this.target;
    const holding = this.held || this.stick;
    const omega = TWO_PI * (holding ? TURN.HOLD_HZ : TURN.BACK_HZ);
    const zeta = holding ? TURN.HOLD_ZETA : TURN.BACK_ZETA;
    const steps = Math.min(64, Math.ceil(dt / STRETCH.SUBSTEP));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      springStep(this.yaw, this.vYaw, yaw, omega, zeta, sdt, scratch);
      this.yaw = scratch[0];
      this.vYaw = scratch[1];
      springStep(this.pitch, this.vPitch, pitch, omega, zeta, sdt, scratch);
      this.pitch = scratch[0];
      this.vPitch = scratch[1];
    }
    // The springs never carry it far past the limits (a flick): hard stop a little beyond.
    this.yaw = clamp(this.yaw, -TURN.MAX_YAW * 1.15, TURN.MAX_YAW * 1.15);
    this.pitch = clamp(this.pitch, -TURN.MAX_PITCH * 1.15, TURN.MAX_PITCH * 1.15);
  }
}

// Zooming in and out a little (the camera moves; the head keeps its size).
export class Zoom {
  constructor() {
    this.value = 1;
    this.target = 1;
    this.pinchFrom = 1;
  }

  wheel(deltaY) {
    this.target = clamp(this.target * Math.exp(-deltaY * ZOOM.PER_WHEEL), ZOOM.MIN, ZOOM.MAX);
  }

  // A pinch started / changed: `ratio` = finger distance now / at its start.
  pinchStart() {
    this.pinchFrom = this.target;
  }

  pinch(ratio) {
    if (ratio > 0) this.target = clamp(this.pinchFrom * ratio, ZOOM.MIN, ZOOM.MAX);
  }

  update(dt) {
    if (dt > 0) this.value += (this.target - this.value) * (1 - Math.exp(-ZOOM.EASE * dt));
  }
}

// Nearest hit (t > tMin) of the ray origin + t * dir with an indexed triangle mesh, either
// side of the triangles. positions: flat xyz; index: flat vertex indices, three per triangle.
// Returns { t, tri, u, v } (u, v: barycentric weights of the triangle's 2nd and 3rd vertex)
// or null.
export function raycast(ox, oy, oz, dx, dy, dz, positions, index, tMin = 1e-6) {
  let best = null;
  let bestT = Infinity;
  const p = positions;
  for (let tri = 0, n = index.length / 3; tri < n; tri++) {
    const a = index[tri * 3] * 3;
    const b = index[tri * 3 + 1] * 3;
    const c = index[tri * 3 + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    // pvec = dir x e2
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - p[a];
    const sy = oy - p[a + 1];
    const sz = oz - p[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    // qvec = s x e1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > tMin && t < bestT) {
      bestT = t;
      best = { t, tri, u, v };
    }
  }
  return best;
}

// Rest-space point of a hit on triangle `tri` (barycentric u, v) of an indexed mesh.
export function pointOnTriangle(positions, index, tri, u, v, out = { x: 0, y: 0, z: 0 }) {
  const w = 1 - u - v;
  const a = index[tri * 3] * 3;
  const b = index[tri * 3 + 1] * 3;
  const c = index[tri * 3 + 2] * 3;
  out.x = positions[a] * w + positions[b] * u + positions[c] * v;
  out.y = positions[a + 1] * w + positions[b + 1] * u + positions[c + 1] * v;
  out.z = positions[a + 2] * w + positions[b + 2] * u + positions[c + 2] * v;
  return out;
}

export const MOOD = Object.freeze({
  BLINK_MIN: 2.2, // seconds between blinks
  BLINK_MAX: 5.2,
  BLINK: 0.13, // a blink's length
  DAZED_GAP: 0.2, // between the two blinks after a big wobble
  HOLD: 0.14, // a face shows at least this long (no flicker at the thresholds)
  ALARM: 0.42, // pulled this far (share of STRETCH.MAX): wide-eyed alarm ...
  WINCE: 0.86, // ... this far: a wince
  GIGGLE: 0.05, // released handles wobbling more than this: a giggle
  BIG: 0.3, // a wobble this big earns a dazed double blink once it has settled
});

// Expressions the face screen paints (ui/face/faceArt.js); `iris` ones have their pupils drawn
// by the head's shader, so they follow the pointer.
export const FACE_EXPRESSIONS = Object.freeze({
  open: { base: 'open', iris: true }, // at rest: smiling, eyes following the pointer
  blink: { base: 'blink', iris: false },
  surprise: { base: 'shout', iris: true }, // grabbed: an "oh!" mouth, still watching the hand
  alarm: { base: 'panic', iris: false }, // pulled far
  wince: { base: 'hurt', iris: false }, // pulled to the limit
  giggle: { base: 'happy', iris: false }, // let go: wobbling
});

export class FaceMood {
  constructor(random = Math.random) {
    this.random = random;
    this.face = 'open';
    this.age = 0; // seconds this face has shown
    this.blinkIn = this._gap();
    this.blinkLeft = 0; // seconds of the current blink left
    this.blinksDue = 0; // extra blinks queued (the dazed double blink)
    this.peak = 0; // biggest wobble since the last settle
  }

  _gap() {
    return MOOD.BLINK_MIN + (MOOD.BLINK_MAX - MOOD.BLINK_MIN) * this.random();
  }

  // pull: stretch.pullLevel() while a handle is held (else 0 / holding false); wobble:
  // stretch.wobbleLevel(). Returns the expression name (a FACE_EXPRESSIONS key).
  update(dt, { holding = false, pull = 0, wobble = 0 } = {}) {
    this.age += dt;
    this.blinkIn -= dt;
    let want;
    if (holding) {
      want = pull >= MOOD.WINCE ? 'wince' : pull >= MOOD.ALARM ? 'alarm' : 'surprise';
      this.peak = Math.max(this.peak, pull);
    } else if (wobble > MOOD.GIGGLE) {
      want = 'giggle';
      this.peak = Math.max(this.peak, wobble);
    } else {
      if (this.peak >= MOOD.BIG) {
        this.blinksDue = 2; // dazed: blink, blink
        this.blinkIn = 0.05;
      }
      this.peak = 0;
      want = 'open';
    }
    if (want === 'open') {
      // Blinks at rest only (the blink is painted with the resting smile).
      if (this.blinkLeft > 0) {
        this.blinkLeft -= dt;
        want = 'blink';
      } else if (this.blinkIn <= 0) {
        this.blinkLeft = MOOD.BLINK;
        want = 'blink';
        if (this.blinksDue > 0) this.blinksDue--;
        this.blinkIn = this.blinksDue > 0 ? MOOD.BLINK + MOOD.DAZED_GAP : this._gap();
      }
    } else {
      this.blinkLeft = 0;
    }
    // Hold a face a moment before switching to another (blinks come and go freely).
    if (want !== this.face && want !== 'blink' && this.face !== 'blink' && this.age < MOOD.HOLD) want = this.face;
    if (want !== this.face) {
      this.face = want;
      this.age = 0;
    }
    return this.face;
  }
}

// Which menus run before play, from the page's query string: the title card (the face screen
// is opt-in); ?test / ?skipTitle go straight into play (tests and tools rely on it); ?face (=1)
// opens the face screen at once, without the title card; ?face=0 is the default.
export function menuPlan(search = '') {
  const q = new URLSearchParams(search);
  if (q.has('test') || q.has('skipTitle')) return { title: false, face: false };
  const face = q.get('face');
  if (face === null || face === '0' || face === 'false') return { title: true, face: false };
  return { title: false, face: true };
}
