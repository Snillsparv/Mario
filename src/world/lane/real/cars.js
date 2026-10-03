// The realistic look's cars (lane/layout.js CARS, CAR_KINDS), built in the worker
// (world/lane/real/detail.js) in place of lane/props.js car()'s boxes (its colliders, the body's
// and the cabin's, stay): generic, plate-less, badge-less.
//
//   cars(kit, L)        // kit: detail.js's Geo per material (carPaint, carGlass, tyre, rim,
//                       // trim, lamp, tail, metal)
//
// A body lofted through rounded sections along the car (the bonnet sloping down to a rounded
// nose, a rounded tail, the sill rising over each axle so the tyres show), a greenhouse of
// slices from the belt to the roof (the screens raked, the sides falling in: tumblehome), glass
// on its straight runs, pillars in the body's colour at its corners and in the middle of each
// side, the roof panel; rounded tyres on dished alloy rims (five spokes) in dark arches;
// headlights and tail lights, door mirrors and handles. Each kind keeps its own
// proportions (layout.js: the van tall and short-nosed, the estate's long roof, the SUV's square
// tail). The paint is lacquered (look.js: a clearcoat over a metallic paint, both reflecting the
// street from the probe), the glass dark and reflective.

// A rounded rectangle (half sizes a, b, corner radius r) as `per` + 1 points a corner,
// counter-clockwise from its lower right; each [x, y, corner] (corner: inside a corner's arc).
function roundRect(a, b, r, per = 4) {
  const pts = [];
  const corners = [[a - r, -b + r, -Math.PI / 2], [a - r, b - r, 0], [-a + r, b - r, Math.PI / 2], [-a + r, -b + r, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const t = a0 + (i / per) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, i > 0 && i < per]);
    }
  }
  return pts;
}

const TYRE = [0.035, 0.035, 0.037];
const RIM = [0.55, 0.56, 0.58];

export function cars(kit, L) {
  for (const c of L.CARS) car(kit, L, c);
}

function car(kit, L, c) {
  const K = L.CAR_KINDS[c.kind];
  const y0 = L.groundHeight(c.x, c.z);
  const fw = [Math.sin(c.yaw), 0, Math.cos(c.yaw)];
  const ac = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
  // A point u across the car (+ its right), y up, w along it (+ toward the nose).
  const W = (u, y, w) => [c.x + ac[0] * u + fw[0] * w, y, c.z + ac[2] * u + fw[2] * w];
  const [hl, hw] = [K.l / 2, K.w / 2];
  const belt = y0 + K.belt;
  const roof = y0 + K.roof;
  const van = c.kind === 'van';
  const square = c.kind === 'suv' || van;
  const axles = [hl - K.l * 0.19, -hl + K.l * 0.2];
  const { carPaint, carGlass, tyre, rim, trim, lamp, tail, metal } = kit;
  carPaint.color(c.tint);
  // The body: stations along the car, each a rounded section.
  const rings = [];
  const S = kit.tier === 'low' ? 18 : 32;
  for (let k = 0; k <= S; k++) {
    const w = -hl + (2 * hl * k) / S;
    const end = hl - Math.abs(w);
    const rc = square ? 30 : 48;
    const taper = end < rc ? rc - Math.sqrt(Math.max(0, rc * rc - (rc - end) * (rc - end))) : 0;
    let top = belt;
    const hood0 = hl - K.hood;
    if (w > hood0) top = belt - 6 - (square ? 14 : 26) * Math.pow((w - hood0) / K.hood, 1.6);
    if (w < -hl + 70) top = belt - 4 - (square ? 8 : 16) * Math.pow((-hl + 70 - w) / 70, 1.5);
    top -= taper * 0.5;
    let bottom = y0 + 20 + taper * 0.35;
    // The wheel arches: the sill rises over each axle.
    for (const wc of axles) {
      const d = Math.abs(w - wc);
      const ra = K.wheel + 9;
      if (d < ra) bottom = Math.max(bottom, y0 + K.wheel + Math.sqrt(ra * ra - d * d) * 0.92);
    }
    const a = Math.max(8, hw - taper * 0.9);
    const b = (top - bottom) / 2;
    const mid = (top + bottom) / 2;
    rings.push(roundRect(a, b, Math.min(18, b * 0.9, a * 0.5), 4).map(([u, y]) => W(u * (1 + 0.03 * Math.cos((y / b) * 1.2)), mid + y, w)));
  }
  carPaint.loft(rings, { capStart: true, capEnd: true });
  // The greenhouse: horizontal slices from the belt (f 0) to the roof (f 1).
  const slice = (f) => {
    const y = belt + (roof - belt) * f;
    const front = hl - K.hood - K.screen * f;
    const rear = -hl + K.tail + (K.tailTop - K.tail) * f;
    const half = hw - 8 - (van ? 12 : 22) * Math.pow(f, 1.2) - (f > 0.9 ? 30 * (f - 0.9) : 0);
    const mid = (front + rear) / 2;
    const rr = roundRect((front - rear) / 2, half, Math.min(square ? 18 : 28, half * 0.5), 3);
    return { ring: rr.map(([w, u]) => W(u, y, mid + w)), corner: rr.map((p) => p[2]), mid, half, y };
  };
  const fs = [0, 0.3, 0.6, 0.84];
  const gs = fs.map(slice);
  const n = gs[0].ring.length;
  const corner = (i) => gs[0].corner[i] || gs[0].corner[(i + 1) % n];
  carGlass.rgb(0.004, 0.005, 0.006);
  carGlass.loft(gs.map((g) => g.ring), { segs: (i) => !corner(i) });
  carPaint.loft(gs.map((g) => g.ring), { segs: corner });
  carPaint.loft([0.84, 0.93, 1].map((f) => slice(f).ring), { capEnd: true });
  // The B pillars: body-colour strips over the side glass, mid cabin.
  for (const s of [-1, 1]) {
    const strip = gs.map((g) => [W(s * (g.half + 0.8), g.y, g.mid - 17), W(s * (g.half + 0.8), g.y, g.mid - 3)]);
    for (let k = 0; k + 1 < strip.length; k++) {
      const [[a, b], [d, e]] = [strip[k], strip[k + 1]];
      if (s > 0) carPaint.quad(b, a, d, e);
      else carPaint.quad(a, b, e, d);
    }
  }
  // The wheels: a rounded tyre, a dished alloy rim with a hub cap, in a dark arch.
  const R = K.wheel;
  const SIDES = kit.tier === 'low' ? 12 : 22;
  for (const w of axles) {
    for (const s of [-1, 1]) {
      const tw = 26;
      const uc = s * (hw - tw / 2 - 1);
      const disc = (r, du, flip = 1) => Array.from({ length: SIDES }, (_, i) => {
        const a = (flip * i * Math.PI * 2) / SIDES;
        return W(uc + du * s, y0 + R + Math.cos(a) * r, w + Math.sin(a) * r);
      });
      tyre.rgb(...TYRE);
      // (Round its section and back along the inside to where it began: a closed ring.)
      const prof = [[R * 0.6, -tw / 2], [R - 5, -tw / 2], [R, -tw / 2 + 6], [R, tw / 2 - 6], [R - 5, tw / 2], [R * 0.62, tw / 2], [R * 0.6, -tw / 2]];
      tyre.loft(prof.map(([r, du]) => disc(r, du, s)));
      rim.rgb(...RIM);
      rim.loft([[R * 0.6, 0], [R * 0.5, -3], [R * 0.18, -4], [R * 0.05, -2]].map(([r, du]) => disc(r, tw / 2 - 1 + du, s)), { capEnd: true });
      // Five spokes' shadows: dark wedges on the dish.
      trim.rgb(0.02, 0.02, 0.022);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        const at = (r, da) => W(uc + s * (tw / 2 - 2.6), y0 + R + Math.cos(a + da) * r, w + Math.sin(a + da) * r);
        const q = [at(R * 0.2, -0.18), at(R * 0.2, 0.18), at(R * 0.55, 0.3), at(R * 0.55, -0.3)];
        if (s > 0) trim.quad(q[1], q[0], q[3], q[2]);
        else trim.quad(q[0], q[1], q[2], q[3]);
      }
      // The arch: a dark half ring on the body's side round the wheel.
      const ua = s * (hw + 1);
      for (let i = 0; i < 12; i++) {
        const [a0, a1] = [-Math.PI / 2 + (i / 12) * Math.PI, -Math.PI / 2 + ((i + 1) / 12) * Math.PI];
        const P = (a, r) => W(ua, y0 + R + Math.cos(a) * r, w + Math.sin(a) * r);
        const q = [P(a0, R + 2), P(a1, R + 2), P(a1, R + 9), P(a0, R + 9)];
        if (s > 0) trim.quad(q[1], q[0], q[3], q[2]);
        else trim.quad(q[0], q[1], q[2], q[3]);
      }
    }
  }
  // Lamps on the nose's shoulders and the tail.
  const lights = (g, u0, u1, ya, yb, w, wBack) => {
    for (const s of [-1, 1]) {
      const q = [W(s * u0, ya, w), W(s * u1, ya, wBack), W(s * u1, yb, wBack), W(s * u0, yb, w)];
      if ((s > 0) !== (w > 0)) g.quad(q[1], q[0], q[3], q[2]);
      else g.quad(q[0], q[1], q[2], q[3]);
    }
  };
  lamp.rgb(0.75, 0.76, 0.78);
  lights(lamp, hw * 0.42, hw * 0.86, belt - 34, belt - 16, hl - (square ? 3 : 6), hl - (square ? 16 : 30));
  tail.rgb(0.5, 0.02, 0.02);
  lights(tail, hw * 0.5, hw * 0.92, belt - 36, belt - 14, -hl + 3, -hl + 14);
  // Door mirrors at the screen's foot, door handles.
  for (const s of [-1, 1]) {
    const m = hl - K.hood - 12;
    carPaint.tube(W(s * (hw - 10), belt + 14, m), W(s * (hw + 16), belt + 18, m - 4), 7, 5, 6, { caps: true });
    for (const w of [hl - K.hood - 70, -hl + K.tail + 70]) metal.tube(W(s * (hw + 4), belt - 14, w - 9), W(s * (hw + 4), belt - 14, w + 9), 2, 2, 5, { caps: true });
  }
}
