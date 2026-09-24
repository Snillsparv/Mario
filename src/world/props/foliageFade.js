// Screen-door fade for the 3D trees and bushes (N64-style see-through): every canopy, bush
// and trunk is one fade group whose coverage (0 gone .. 1 solid) the materials turn into a
// 4x4 ordered-dither discard. No blending, no sorting, depth still works, no extra draw call.
//
// - Near fade: a canopy the camera is inside of or right up against dissolves away (distance
//   from the camera to the nearest canopy blob's surface), a trunk likewise. It is all or
//   nothing with a little hysteresis: gone within NEAR_FADE[0], back beyond NEAR_FADE[1], so
//   a canopy beside the camera is never left half faded as a see-through dot grid over the
//   screen (review: a canopy parked mid-fade covered half the frame). A canopy merely close
//   to the camera stays solid (it is 3D: from under a tree, e.g. in the first-person look, you
//   see its leafy underside).
// - Occlusion: a canopy or bush standing between the camera and the hero it frames drops to
//   OCCLUDER_ALPHA, so a tree the trailing camera passes behind never blots him out. The test
//   is exact in 3D: sight lines from the camera to a few points on the hero (ankles to hat,
//   and both sides of his chest) against the group's blobs.
// - Changes play out over FADE_TIME seconds of game time (a quick dissolve, not a pop), and
//   the shown fade snaps past the sparsest dither levels (FADE_SNAP).
//
// The per-group fades live in one small vec4 uniform array shared by the leaf and bark
// materials; each vertex carries its group in the 'fadeGroup' attribute (MeshBuilder
// { fadeGroups: true }). The per-frame work is one short allocation-free loop.
//
// The leaf material is also mapped tri-planar (patch(material, { triplanar })): the leaf
// texture is projected along the world axes and the three projections blended by the
// surface normal, so the leaves run on seamlessly across faces and from one blob into the
// next instead of breaking at every triangle edge (review: per-face box mapping looked like
// crumpled paper up close).

import * as THREE from 'three';
import { LOOK_HEIGHT, ORBIT_MODES } from '../../camera/cameraConfig.js';
import { smoothstep } from '../../core/math.js';

// Near fade of a canopy: gone once the camera comes within NEAR_FADE[0] of the surface of its
// nearest blob (or inside it); solid again beyond NEAR_FADE[1].
export const NEAR_FADE = [70, 110];
// Trunks: by the camera's distance from the bark.
export const TRUNK_NEAR_FADE = [25, 45];
// Screen-door coverage of a canopy that hides the hero.
export const OCCLUDER_ALPHA = 0.35;
// Fades below FADE_SNAP[0] are gone and above FADE_SNAP[1] solid, so only the 4/16 .. 12/16
// dither levels ever show: a group kept at 1..3 of 16 pixels (or missing 1..3) is a sparse,
// perfectly regular dot grid that reads as a screen overlay, not as foliage.
export const FADE_SNAP = [4 / 16, 12.5 / 16];
// Seconds (game time) a fade takes from solid to gone or back. update() with no time, the
// first update and time running backwards apply the new fades at once.
export const FADE_TIME = 0.2;
// Points on the hero the sight lines go to: heights above his feet (ankles to hat) on his
// centre line, and his chest HERO_HALF_WIDTH to either side.
const HERO_HEIGHTS = [30, 75, 120, 165];
const HERO_CHEST = 100;
const HERO_HALF_WIDTH = 45;
const SAMPLES = HERO_HEIGHTS.length + 2;
// A sight line passing within BLOB_EDGE[1] x a blob's radii of its centre is fully hidden,
// one passing BLOB_EDGE[0] x its radii off it not at all: the blobs' lumps reach 10 % in and
// out of their ellipsoids (canopy.js BLOB_JITTER).
const BLOB_EDGE = [1.07, 0.9];
// Fraction of the hero's sample points hidden where the fade starts / is full.
const HIDDEN = [0.08, 0.3];

const fwd = new THREE.Vector3();

export class FoliageFade {
  constructor() {
    this.groups = []; // { kind: 'canopy', blobs: [{ x, y, z, rh, ry }], x, y, z, r } | { kind: 'trunk', x, z, y0, y1, r }
    this.hero = { x: 0, y: 0, z: 0 };
    this.uniform = null;
    this.time = undefined; // game time of the last update
  }

  // A canopy or bush made of upright ellipsoid blobs [{ x, y, z, rh, ry }] (horizontal and
  // vertical radii), named e.g. 'tree:3'. Returns its fade group.
  addCanopy(blobs, name = '') {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const b of blobs) {
      x += b.x / blobs.length;
      y += b.y / blobs.length;
      z += b.z / blobs.length;
    }
    const r = Math.max(...blobs.map((b) => Math.hypot(b.x - x, b.y - y, b.z - z) + Math.max(b.rh, b.ry)));
    this.groups.push({ kind: 'canopy', name, blobs: blobs.map((b) => ({ ...b })), x, y, z, r });
    return this.groups.length - 1;
  }

  // A vertical trunk of radius r from y0 to y1, named e.g. 'trunk:3'. Returns its fade group.
  addTrunk({ x, z, y0, y1, r }, name = '') {
    this.groups.push({ kind: 'trunk', name, x, z, y0, y1, r });
    return this.groups.length - 1;
  }

  // Current fade of group i, or of the group named i (0 gone .. 1 solid).
  fade(i) {
    return this.fades[typeof i === 'number' ? i : this.groups.findIndex((g) => g.name === i)];
  }

  // Patches a world material so fragments of faded groups are discarded in a 4x4 Bayer
  // pattern. Call once every group is added; all patched materials share the fades.
  // triplanar: world units per repeat of the material's map, projected along the world axes
  // and blended by the vertex normals (the geometry keeps its 'normal' attribute), instead of
  // the mesh's UVs; 0 keeps the UVs.
  patch(material, { triplanar = 0 } = {}) {
    const vec4s = Math.max(1, Math.ceil(this.groups.length / 4));
    if (!this.fades) {
      this.fades = new Float32Array(vec4s * 4).fill(1); // shown (snapped)
      this.values = new Float32Array(vec4s * 4).fill(1); // current, before snapping
      this.near = new Uint8Array(this.groups.length); // 1: faded out by the near fade
      this.uniform = { value: this.fades };
    }
    const uniform = this.uniform;
    const tile = triplanar > 0 ? (1 / triplanar).toFixed(8) : null;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.propFade = uniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float fadeGroup;
uniform vec4 propFade[${vec4s}];
varying float vPropFade;${tile ? '\nvarying vec3 vLeafPos;\nvarying vec3 vLeafNormal;' : ''}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  int g = int(fadeGroup + 0.5);
  vec4 f4 = propFade[g / 4];
  int c = g - (g / 4) * 4;
  vPropFade = c == 0 ? f4.x : c == 1 ? f4.y : c == 2 ? f4.z : f4.w;${
    tile
      ? `
  vLeafPos = (modelMatrix * vec4(transformed, 1.0)).xyz * ${tile};
  vLeafNormal = mat3(modelMatrix) * normal;`
      : ''
  }
}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vPropFade;${tile ? '\nvarying vec3 vLeafPos;\nvarying vec3 vLeafNormal;' : ''}
const float BAYER4[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
if (vPropFade < 0.999) {
  ivec2 q = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  if (vPropFade * 16.0 <= BAYER4[q.y * 4 + q.x] + 0.5) discard;
}`,
        );
      if (tile) {
        // Side projections keep v up the world's y (the leaf clumps are lit from above).
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
{
  vec3 w = abs(normalize(vLeafNormal));
  w *= w;
  w *= w;
  w *= w; // ^8: short blends (less double exposure), still no seams
  w /= w.x + w.y + w.z;
  diffuseColor *= texture2D(map, vLeafPos.zy) * w.x + texture2D(map, vLeafPos.xz) * w.y + texture2D(map, vLeafPos.xy) * w.z;
}
#endif`,
        );
      }
    };
    material.customProgramCacheKey = () => `props-foliage-fade-${vec4s}${tile ? '-tri' + tile : ''}`;
    material.userData.foliageFade = this;
    return material;
  }

  // locateHero(camera, fx, fz, out) -> true with the hero's feet in `out` ({ x, y, z }), or
  // false when there is no hero to keep in view (see heroLocator). Only asked when a canopy
  // in front of the camera is not already faded out by the near fade. time: game time in
  // seconds (fades move toward their new value over FADE_TIME; none: at once).
  update(camera, locateHero = null, time = undefined) {
    if (!camera || !this.fades) return;
    const dt = time === undefined || this.time === undefined ? Infinity : time - this.time;
    this.time = time;
    const step = dt >= 0 ? dt / FADE_TIME : Infinity;
    camera.getWorldDirection(fwd); // also brings camera.matrixWorld up to date
    const e = camera.matrixWorld.elements;
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];
    const l = Math.hypot(fwd.x, fwd.z);
    const fx = l > 1e-3 ? fwd.x / l : 0;
    const fz = l > 1e-3 ? fwd.z / l : 1;
    const hero = this.hero;
    let located = 0; // 0 not asked yet, 1 found, -1 none
    const groups = this.groups;
    const near = this.near;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      let target;
      if (g.kind === 'trunk') {
        const dy = cy < g.y0 ? g.y0 - cy : cy > g.y1 ? cy - g.y1 : 0;
        const d = Math.hypot(Math.hypot(cx - g.x, cz - g.z) - g.r, dy);
        near[i] = d < TRUNK_NEAR_FADE[near[i]] ? 1 : 0;
        target = 1 - near[i];
      } else {
        let d = Infinity;
        for (const b of g.blobs) {
          // Distance to the ellipsoid's surface along the line to its centre.
          const dx = cx - b.x;
          const dy = cy - b.y;
          const dz = cz - b.z;
          const r = Math.hypot(dx, dy, dz);
          const q = Math.hypot(dx / b.rh, dy / b.ry, dz / b.rh);
          d = Math.min(d, q > 0 ? r * (1 - 1 / q) : -Math.min(b.rh, b.ry));
        }
        near[i] = d < NEAR_FADE[near[i]] ? 1 : 0;
        target = 1 - near[i];
        // In front of the camera (roughly), and not faded out: may hide the hero.
        const ahead = (g.x - cx) * fwd.x + (g.y - cy) * fwd.y + (g.z - cz) * fwd.z;
        if (target > 0 && ahead > -g.r) {
          if (located === 0) located = locateHero && locateHero(camera, fx, fz, hero) ? 1 : -1;
          if (located > 0) {
            const cover = this.cover(g, cx, cy, cz);
            target = 1 - (1 - OCCLUDER_ALPHA) * smoothstep(HIDDEN[0], HIDDEN[1], cover);
          }
        }
      }
      const v = this.values[i];
      const value = target > v ? Math.min(target, v + step) : Math.max(target, v - step);
      this.values[i] = value;
      this.fades[i] = value < FADE_SNAP[0] ? 0 : value > FADE_SNAP[1] ? 1 : value;
    }
  }

  // Fraction (0..1) of the hero's sample points that canopy g hides from a camera at
  // (cx, cy, cz): each sight line counts by how deep it passes through the group's blobs.
  cover(g, cx, cy, cz) {
    const h = this.hero;
    // Quick reject: the sight line to his middle passes well clear of the whole group.
    const mid = h.y + HERO_CHEST;
    if (segmentDistance(cx, cy, cz, h.x, mid, h.z, g.x, g.y, g.z) > g.r * BLOB_EDGE[0] + 120) return 0;
    let lx = -(h.z - cz);
    let lz = h.x - cx;
    const ll = Math.hypot(lx, lz) || 1;
    lx = (lx / ll) * HERO_HALF_WIDTH;
    lz = (lz / ll) * HERO_HALF_WIDTH;
    let hidden = 0;
    for (let k = 0; k < SAMPLES; k++) {
      let px = h.x;
      let pz = h.z;
      let py;
      if (k < HERO_HEIGHTS.length) py = h.y + HERO_HEIGHTS[k];
      else {
        const side = k === HERO_HEIGHTS.length ? 1 : -1;
        px += lx * side;
        pz += lz * side;
        py = mid;
      }
      let best = 0;
      for (const b of g.blobs) {
        // In the blob's unit-sphere space.
        const q = segmentDistance(cx / b.rh, cy / b.ry, cz / b.rh, px / b.rh, py / b.ry, pz / b.rh, b.x / b.rh, b.y / b.ry, b.z / b.rh);
        if (q < BLOB_EDGE[0]) best = Math.max(best, smoothstep(BLOB_EDGE[0], BLOB_EDGE[1], q));
      }
      hidden += best;
    }
    return hidden / SAMPLES;
  }
}

// Distance from point (qx, qy, qz) to the segment (ax, ay, az) - (bx, by, bz).
function segmentDistance(ax, ay, az, bx, by, bz, qx, qy, qz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((qx - ax) * dx + (qy - ay) * dy + (qz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - qx, ay + dy * t - qy, az + dz * t - qz);
}

// Where the hero is, for FoliageFade.update. The camera may publish the point it orbits
// as camera.userData.focus ({ x, y, z }, LOOK_HEIGHT above the hero's feet; null when there
// is no hero to keep in view, e.g. first person or the title); that is exact. Otherwise the
// hero is taken to stand on the ground on the view's horizontal centre line (the trailing
// camera keeps him there), where a line dropping from the camera at the default orbit pitch
// comes down to LOOK_HEIGHT above the ground (surfaceHeight(x, z)), kept within FOCUS_RANGE
// of the camera: on ground sloping away at about that pitch the crossing is ill-defined.
// LOOK_HEIGHT, the pitch and the distance are the camera's own (camera/cameraConfig.js), so
// retuning the camera moves the hero band with it.
const TRAILING = ORBIT_MODES.follow; // the default trailing camera, near zoom step
const ORBIT_SLOPE = Math.tan(TRAILING.pitch[0]);
const FOCUS_RANGE = [TRAILING.dist[0] - 250, TRAILING.dist[0] + 200]; // around the trailing distance
const FOCUS_STEP = 90;
const MAX_CAMERA_RISE = 1500; // higher above the ground: a fly-over, not a trailing camera
export function heroLocator(surfaceHeight) {
  return (camera, fx, fz, out) => {
    const e = camera.matrixWorld.elements;
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];
    const f = camera.userData?.focus;
    if (f !== undefined) {
      if (!f) return false;
      out.x = f.x;
      out.y = f.y - LOOK_HEIGHT;
      out.z = f.z;
      return true;
    }
    const rise = cy - LOOK_HEIGHT - surfaceHeight(cx, cz);
    if (rise <= 0 || rise > MAX_CAMERA_RISE) return false; // first person / fly-over
    // Nearer crossings end up at FOCUS_RANGE[0] anyway: march from there.
    let dist = FOCUS_RANGE[1];
    let prev = 0;
    for (let t = FOCUS_RANGE[0]; t <= FOCUS_RANGE[1]; t += FOCUS_STEP) {
      const h = cy - ORBIT_SLOPE * t - LOOK_HEIGHT - surfaceHeight(cx + fx * t, cz + fz * t);
      if (h <= 0) {
        // Linear root between this sample and the last one.
        dist = t === FOCUS_RANGE[0] ? t : t - (FOCUS_STEP * h) / (h - prev);
        break;
      }
      prev = h;
    }
    out.x = cx + fx * dist;
    out.z = cz + fz * dist;
    out.y = surfaceHeight(out.x, out.z);
    return true;
  };
}
