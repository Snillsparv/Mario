// What both courses build with, in main (so neither course's chunk imports the other's: the
// chunk plan, tools/chunkPlan.js, pins it there, vite.config.js): Midsummer Skerries' dark firs
// (Sparrow Lane's forest is of them too) and the painted-plank and sailcloth textures (the
// lane's Falu red walls and awnings). Each texture returns an empty THREE.Texture in node
// (texgen.canvasTexture handles that).
//
//   fir(kit, x, z, base, h, r, { a0, solid })   // one dark fir into a course's kit
//   faluPlankTexture(), sailTexture()           // the painted planks (64 x 64), the sailcloth (32 x 32)

import { canvasTexture, paintPixels, tileableFbm } from '../render/texgen.js';
import { makeRng } from '../core/math.js';

const TINT = { fir: 0x3e5e3c, trunk: 0x5a4030 };
const FIR_FOOT = 0.85; // a fir's collider's radius at the ground, of its needles' widest
const FIR_LEAN = 0.09; // its sides' inward lean per unit up (a face's normal.y about 0.08)

const clamp255 = (c) => [Math.min(255, Math.max(0, c[0])), Math.min(255, Math.max(0, c[1])), Math.min(255, Math.max(0, c[2]))];

// A dark fir: a short trunk under two tiers of needles (kit.leaves); with `solid`, its collider an
// octagonal frustum round the trunk and the needles from the ground up to the tip, leaning in
// FIR_LEAN per unit up: its sides stay steeper than the steepest floor (CollisionWorld's
// FLOOR_MIN_NY), so they stop him like walls (a cone round the tiers would be a slope he walks
// straight up), and its small flat top at the tip is out of a jump's reach from the ground.
export function fir(kit, x, z, base, h, r, { a0 = 0, solid = true } = {}) {
  kit.wood.color(TINT.trunk);
  kit.wood.lathe(x, z, [[r * 0.16, base - 10], [r * 0.12, base + h * 0.2]], 6, { flat: true });
  kit.leaves.color(TINT.fir);
  kit.leaves.lathe(x, z, [[0, base + h * 0.12], [r, base + h * 0.12], [r * 0.5, base + h * 0.5], [r * 0.78, base + h * 0.45], [0, base + h]], 7, { flat: true, a0 });
  if (solid) kit.solids.solid(frustumPolys(x, z, r * FIR_FOOT, r * FIR_FOOT - h * FIR_LEAN, 8, base, base + h), 'wood');
}

// A closed regular frustum round (cx, cz): radius r0 at y0 up to r1 at y1, a flat top (no
// bottom).
function frustumPolys(cx, cz, r0, r1, sides, y0, y1) {
  const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
  const lo = ring(r0, y0);
  const hi = ring(r1, y1);
  return [hi, ...lo.map((p, i) => [p, lo[(i + 1) % sides], hi[(i + 1) % sides], hi[i]])];
}

// Painted planks (64 x 64): four boards running up the texture (v), light paint over a soft
// grain with dark seams between the boards and a few knots showing through. Nearly white, so
// the vertex colours give the paint its colour: the lighthouse's white and red, the boat's
// blue hull (and Falu red with white trim on the cottages).
export function faluPlankTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const grain = tileableFbm(w, h, 6, 3, 911);
    const wear = tileableFbm(w, h, 3, 2, 913);
    const rng = makeRng(917);
    const boards = 4;
    const bw = w / boards;
    const tones = Array.from({ length: boards }, () => 0.9 + rng() * 0.1);
    const knots = Array.from({ length: 5 }, () => ({ x: rng() * w, y: rng() * h, r: 1 + rng() * 1.4 }));
    paintPixels(ctx, w, h, (x, y) => {
      const b = Math.floor(x / bw);
      const lx = x - b * bw;
      if (lx < 1) return [88, 80, 76];
      const streak = 0.94 + 0.06 * Math.sin(lx * 1.3 + grain(x, y) * 10 + b);
      let k = tones[b] * streak * (0.92 + wear(x, y) * 0.1) * (lx === 1 || lx === bw - 1 ? 0.88 : 1);
      for (const kn of knots) {
        if (Math.hypot(x + 0.5 - kn.x, (y + 0.5 - kn.y) * 0.6) < kn.r) k *= 0.8;
      }
      return clamp255([236 * k, 232 * k, 226 * k]);
    });
  });
}

// Sailcloth (32 x 32): cream canvas with its seams running across every 8 px and a soft weave,
// tinted by the vertex colours (the red sail, the white jib, the pennants).
export function sailTexture() {
  return canvasTexture(32, 32, (ctx, w, h) => {
    const weave = tileableFbm(w, h, 4, 2, 931);
    paintPixels(ctx, w, h, (x, y) => {
      const k = (y % 8 === 0 ? 0.84 : 1) * (0.92 + weave(x, y) * 0.12);
      return clamp255([246 * k, 240 * k, 226 * k]);
    });
  });
}
