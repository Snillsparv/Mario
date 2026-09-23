// Hand-painted vertex tints for the terrain: large-scale colour variation, fake ambient
// occlusion near cliffs and walls, a baked soft sun shadow from the castle block (and a
// faint, very soft one from the perimeter cliffs), and the blue-green "underwater" tint. Lighting itself (sun · normal) is baked
// afterwards by materials.bakeLighting, which multiplies these tints.

import { clamp, lerp, smoothstep } from '../../core/math.js';
import { CASTLE, CLIFF_TOP, ISLAND, PERIMETER, SUN_DIR, WATER_LEVEL, sdRoundRect } from '../layout.js';

// ---------------------------------------------------------------- noise

function hash3(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth 3D value noise in 0..1 (lattice spacing 1).
export function noise3(x, y, z) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(x - i);
  const v = s(y - j);
  const w = s(z - k);
  const n = (a, b, c) => hash3(i + a, j + b, k + c);
  const x00 = lerp(n(0, 0, 0), n(1, 0, 0), u);
  const x10 = lerp(n(0, 1, 0), n(1, 1, 0), u);
  const x01 = lerp(n(0, 0, 1), n(1, 0, 1), u);
  const x11 = lerp(n(0, 1, 1), n(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

// ---------------------------------------------------------------- sun shadow

const SUN_H = Math.hypot(SUN_DIR.x, SUN_DIR.z);
const SUN_DX = SUN_DIR.x / SUN_H;
const SUN_DZ = SUN_DIR.z / SUN_H;
const SUN_SLOPE = SUN_DIR.y / SUN_H; // ray rise per horizontal unit
const CASTLE_BOX = {
  minX: CASTLE.x - CASTLE.halfWidth,
  maxX: CASTLE.x + CASTLE.halfWidth,
  minZ: CASTLE.backZ,
  maxZ: CASTLE.frontZ,
  top: CASTLE.baseY + CASTLE.mainHeight,
};

const CLIFF_RIM = CLIFF_TOP + 150; // mean rim height (layout.cliffHeight swells the rim)

// 0 (lit) .. 1 (in shadow) for a ray from (x, y, z) toward the sun passing under `top` at
// horizontal distance s, with a soft penumbra of +-soft.
const occluded = (y, s, top, soft) => smoothstep(-soft, soft, top - (y + SUN_SLOPE * s));

// Soft shadow cast by the castle's main block and, much fainter and softer, the perimeter
// cliffs onto a ground point (a strong cliff shadow would muddy the lawn around the spawn).
// Returns a brightness factor (1 = full sun).
export function sunShadow(x, y, z) {
  let shade = 0;
  // Cliffs: march along the sun direction to the perimeter wall (sphere tracing on its SDF).
  if (sdRoundRect(x, z, PERIMETER) < 0) {
    let s = 0;
    for (let it = 0; it < 40; it++) {
      if (y + SUN_SLOPE * s > CLIFF_RIM + 600) break; // ray already clears the cliffs
      const d = sdRoundRect(x + SUN_DX * s, z + SUN_DZ * s, PERIMETER);
      if (d > -2) {
        shade = 0.4 * occluded(y, s, CLIFF_RIM, 600);
        break;
      }
      s += Math.max(-d, 8);
    }
  }
  // Castle: slab test of the ray against the castle's footprint.
  const b = CASTLE_BOX;
  const t1 = (b.minX - x) / SUN_DX;
  const t2 = (b.maxX - x) / SUN_DX;
  const t3 = (b.minZ - z) / SUN_DZ;
  const t4 = (b.maxZ - z) / SUN_DZ;
  const tin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tout = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tout >= Math.max(tin, 0)) shade = Math.max(shade, occluded(y, Math.max(tin, 0), b.top, 160));
  return 1 - 0.36 * shade;
}

// ---------------------------------------------------------------- tints

// Brightness falloff near the foot of the perimeter cliffs and the castle walls.
function ambientOcclusion(x, z) {
  const cliff = 0.8 + 0.2 * smoothstep(0, 900, -sdRoundRect(x, z, PERIMETER));
  const castle = 0.8 + 0.2 * smoothstep(0, 450, sdRoundRect(x, z, { ...CASTLE_BOX, radius: 0 }));
  return cliff * castle;
}

// Grass: cool blue-green in hollows / shade, warm yellow-green on sunny slopes and open lawn,
// with broad low-frequency patches. The island's lawns are nearly flat, so they get stronger
// broad light/dark patches (+-15%) to keep them from reading as one even sheet.
export function grassTint(x, y, z, nx, ny, nz) {
  const sun = nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z; // ~0.8 on flat ground
  const broad = noise3(x / 2300, 0.5, z / 2300);
  const patch = noise3(x / 1000, 7.5, z / 1000);
  const island = smoothstep(0, 400, -sdRoundRect(x, z, ISLAND));
  const swath = 1 + 0.4 * island * (noise3(x / 1500, 11.5, z / 1500) - 0.5);
  const warm = clamp(0.45 + (sun - 0.8) * 3.5 + (broad - 0.5) * (1.4 + island), 0, 1);
  // Extra slope contrast on top of the baked lighting (which saturates on sunny slopes).
  const slope = 0.9 + 0.55 * clamp(sun - 0.75, -0.3, 0.25);
  const k = slope * swath * (0.9 + 0.2 * patch) * ambientOcclusion(x, z) * sunShadow(x, y, z);
  return [lerp(0.78, 1.12, warm) * k, lerp(0.9, 1.06, warm) * k, lerp(0.95, 0.7, warm) * k];
}

// Paved / bare ground (path, courtyard, sand): neutral, with the same occlusion and shadow.
export function groundTint(x, y, z) {
  const k = (0.94 + 0.12 * noise3(x / 500, 3.5, z / 500)) * ambientOcclusion(x, z) * sunShadow(x, y, z);
  return [k, k, k];
}

// Darken and shift toward blue-green below the water surface; a crisp step at the waterline
// makes submerged parts read as underwater.
export function applyUnderwater(rgb, y) {
  const depth = WATER_LEVEL - y;
  if (depth <= 0) return rgb;
  const t = 0.4 + 0.6 * smoothstep(0, 520, depth);
  return [rgb[0] * lerp(1, 0.46, t), rgb[1] * lerp(1, 0.7, t), rgb[2] * lerp(1, 0.84, t)];
}

// ---------------------------------------------------------------- contours

// Arc-length parameter of the point on a rounded rectangle's outline nearest (x, z).
// Returns { s, length }; used to run wall textures continuously around the outline.
export function roundRectParam(r, x, z) {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const hx = (r.maxX - r.minX) / 2 - r.radius;
  const hz = (r.maxZ - r.minZ) / 2 - r.radius;
  const px = x - cx;
  const pz = z - cz;
  const qx = clamp(px, -hx, hx);
  const qz = clamp(pz, -hz, hz);
  let a = Math.atan2(pz - qz, px - qx);
  if (a < 0) a += Math.PI * 2;
  // Straight-edge progress: +X edge (z rising), +Z edge (x falling), -X edge, -Z edge.
  const quadrant = Math.min(3, Math.floor(a / (Math.PI / 2)));
  const along = [qz + hz, 2 * hz + (hx - qx), 2 * hz + 2 * hx + (hz - qz), 4 * hz + 2 * hx + (qx + hx)][quadrant];
  return { s: along + r.radius * a, length: 4 * (hx + hz) + 2 * Math.PI * r.radius };
}

export function circleParam(c, x, z) {
  let a = Math.atan2(z - c.z, x - c.x);
  if (a < 0) a += Math.PI * 2;
  return { s: c.radius * a, length: 2 * Math.PI * c.radius };
}
