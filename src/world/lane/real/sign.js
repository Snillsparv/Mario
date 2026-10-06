// The turning area's sign (lane/layout.js TURN_SIGN: the photos' sign at the dad's corner bed,
// a Swedish "Vändplats" plate): its face laid out once, flat, for both looks to draw (the
// classic one in lane/props.js, N64 style; the realistic one in garden.js turnSign).
//
//   SIGN_TEXT                       // ['Vänd-', 'plats']: its only words (a traffic sign's
//                                   // generic word, the only lettering in the street)
//   signFace(plate) -> [{ color, layer, poly }]   // plate: TURN_SIGN.plate ({ w, h }); each
//       piece a convex polygon [[u, v], ...] (u across from the plate's left edge as one faces
//       it, v up from its foot) in a colour (hex sRGB), in layers from the plate's face out (0
//       the red rim, 1 the yellow field, 2 the no-parking sign's red ring, 3 its blue field, 4
//       its red stripe and the black lettering)
//
// The lettering is a little stroke font of its own (no font, no canvas: nothing in the street
// letters anything else): GLYPHS holds only the letters these two words need, each a few
// polylines in units of a fifth of an x-height, drawn as quads of a road sign's heavy stroke.
// Under the words the round no-parking sign: a blue disc in a red ring, one red stripe from its
// upper left to its lower right.

export const SIGN_TEXT = ['Vänd-', 'plats'];

const RED = 0xc8302a;
const YELLOW = 0xf2c31c;
const BLUE = 0x1d4f9c;
const BLACK = 0x161616;

// An arc of an ellipse (centre cx, cy; radii rx, ry) from angle a0 to a1 (degrees), n steps, as
// a flat [u, v, u, v, ...] polyline.
const arc = (cx, cy, rx, ry, a0, a1, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
}).flat();
const B = arc(2, 2.5, 2, 2.5, 0, 360, 16); // (a bowl)
// Each letter: [its advance, its strokes (flat polylines), its dots ([u, v, half size])].
export const GLYPHS = {
  V: [4.6, [[0, 7, 2.3, 0, 4.6, 7]]],
  ä: [4, [B, [4, 5, 4, 0]], [[1.2, 6.5, 0.65], [2.8, 6.5, 0.65]]],
  n: [4, [[0, 0, 0, 5], [...arc(2, 3, 2, 2, 180, 0, 8), 4, 0]]],
  d: [4, [B, [4, 0, 4, 7]]],
  '-': [3.2, [[0.3, 2.6, 2.9, 2.6]]],
  p: [4, [B, [0, 5, 0, -2]]],
  l: [1, [[0.5, 0, 0.5, 7]]],
  a: [4, [B, [4, 5, 4, 0]]],
  t: [2.8, [[1.2, 6.6, 1.2, 0.9, 1.6, 0.2, 2.6, 0.1], [0, 5, 2.6, 5]]],
  s: [4, [[3.8, 4.2, 3.2, 4.85, 2, 5, 0.8, 4.8, 0.2, 4, 0.6, 3.1, 2, 2.6, 3.4, 2, 3.9, 1.1, 3.3, 0.2, 2, 0, 0.7, 0.2, 0, 0.9]]],
};
const GAP = 0.9; // between letters
const STROKE = 1.15; // a stroke's width

const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const disc = (cu, cv, r, n = 28) => {
  const ring = arc(cu, cv, r, r, 0, 360, n);
  return Array.from({ length: n }, (_, i) => [ring[2 * i], ring[2 * i + 1]]);
};

// A line of lettering, centred on u = mid, its baseline at v, `k` units an em unit.
function line(text, mid, v, k, out) {
  const width = [...text].reduce((s, c) => s + GLYPHS[c][0], 0) + GAP * (text.length - 1);
  let u = mid - (width * k) / 2;
  for (const c of text) {
    const [w, strokes, dots = []] = GLYPHS[c];
    const at = (x, y) => [u + x * k, v + y * k];
    for (const stroke of strokes) {
      for (let i = 0; i + 3 < stroke.length; i += 2) {
        const [a, b] = [at(stroke[i], stroke[i + 1]), at(stroke[i + 2], stroke[i + 3])];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // (Each segment a quad, a half stroke longer at both ends: the joints close.)
        const [tx, ty] = [((b[0] - a[0]) / l) * STROKE * k * 0.5, ((b[1] - a[1]) / l) * STROKE * k * 0.5];
        out.push({ color: BLACK, layer: 4, poly: [[a[0] - tx + ty, a[1] - ty - tx], [b[0] + tx + ty, b[1] + ty - tx], [b[0] + tx - ty, b[1] + ty + tx], [a[0] - tx - ty, a[1] - ty + tx]] });
      }
    }
    for (const [x, y, d] of dots) {
      const [cu, cv] = at(x, y);
      out.push({ color: BLACK, layer: 4, poly: rect(cu - d * k, cv - d * k, cu + d * k, cv + d * k) });
    }
    u += (w + GAP) * k;
  }
}

export function signFace({ w, h }) {
  const out = [];
  const rim = 0.042 * w;
  out.push({ color: RED, layer: 0, poly: rect(0, 0, w, h) });
  out.push({ color: YELLOW, layer: 1, poly: rect(rim, rim, w - rim, h - rim) });
  // The words over the upper half: "Vänd-" across the field, "plats" under it.
  const k = (0.78 * w) / 23.4;
  const top = h - rim - 0.07 * w - 7 * k;
  line(SIGN_TEXT[0], w / 2, top, k, out);
  line(SIGN_TEXT[1], w / 2, top - 10.2 * k, k, out);
  // The no-parking sign under them.
  const [cu, cv, r] = [w / 2, 0.26 * h, 0.34 * w];
  const ring = 0.21 * r;
  out.push({ color: RED, layer: 2, poly: disc(cu, cv, r) });
  out.push({ color: BLUE, layer: 3, poly: disc(cu, cv, r - ring) });
  const [d, sw] = [(r - ring) * Math.SQRT1_2, ring * 0.5 * Math.SQRT1_2];
  out.push({ color: RED, layer: 4, poly: [[cu - d - sw, cv + d - sw], [cu + d - sw, cv - d - sw], [cu + d + sw, cv - d + sw], [cu - d + sw, cv + d + sw]] });
  return out;
}
