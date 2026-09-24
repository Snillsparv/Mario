// Batched cylindrical billboards: many camera-facing textured quads (trees, flowers) in one
// mesh and one draw call. Like the N64 classics, every quad is kept parallel to the screen
// by rotating it about the vertical axis only; update(camera) rewrites the corner positions
// when the camera turns.
//
// With { fade: true } (the foliage batch) each sprite also gets a per-vertex fade that the
// material turns into a 4x4 ordered-dither screen door (N64-style see-through): sprites the
// camera is right up against thin out, and a canopy standing between the camera and the
// hero drops to OCCLUDER_ALPHA, so a tree the trailing camera passes behind never blots him
// out. Fades snap past the sparsest dither levels (FADE_SNAP). No extra draw call; the per-frame work is one small loop over the sprites, allocation
// free.

import * as THREE from 'three';
import { LOOK_HEIGHT, ORBIT_MODES } from '../../camera/cameraConfig.js';
import { smoothstep } from '../../core/math.js';

const fwd = new THREE.Vector3();

// Near fade: a sprite whose plane is closer than NEAR_FADE[0] x its width is gone, from
// NEAR_FADE[1] x its width on it is solid (an ~800-wide tree: ~250 .. ~700 units). A camera
// high above (or below) the quad counts that height too.
export const NEAR_FADE = [0.32, 0.88];
// Screen-door coverage of a canopy that hides the hero.
export const OCCLUDER_ALPHA = 0.35;
// Fades below FADE_SNAP[0] are gone and above FADE_SNAP[1] solid, so only the 4/16 .. 12/16
// dither levels ever show: a sprite kept at 1..3 of 16 pixels (or missing 1..3) is a
// sparse, perfectly regular dot grid that reads as a screen overlay, not as foliage.
export const FADE_SNAP = [4 / 16, 12.5 / 16];
// The hero's size for the occlusion test: half width, and the band from his ankles to the
// top of his hat (hiding just his shoes does not count).
const HERO_HALF_WIDTH = 60;
const HERO_BAND = [25, 170];
// A sprite counts as in front of the hero once its plane is this far nearer the camera.
const IN_FRONT = [60, 260];
// Default outline of a sprite for the fade: its whole quad, 0.45 of its width either side.
const DEFAULT_OCCLUDER = new Float32Array([0.45]);
// Fraction of the hero's height behind a sprite's outline where its fade starts / is full.
const HIDDEN = [0.08, 0.3];
// Sprites further than this sideways from the view's centre line never hide the hero
// (beyond their own half width): the hero stays near the middle of the screen.
const CENTRE_SLACK = 250;

export class BillboardBatch {
  // sprites: [{ x, y, z, w, h, uv: [u0, v0, u1, v1], tint?: [r, g, b], occluder? }],
  // y = bottom centre. `occluder` outlines the painted part that can hide the hero, for the
  // fade: half widths (fractions of w) of equal rows over the quad's height, bottom first
  // (see textures.js canopyProfile).
  constructor(name, sprites, material, { fade = false } = {}) {
    this.sprites = sprites;
    const n = sprites.length;
    this.positions = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const color = new Float32Array(n * 12);
    const index = [];
    sprites.forEach((s, i) => {
      const [u0, v0, u1, v1] = s.uv;
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const t = s.tint ?? [1, 1, 1];
      for (let k = 0; k < 4; k++) color.set(t, i * 12 + k * 3);
      const b = i * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setIndex(index);
    if (fade) {
      this.fades = new Float32Array(n).fill(1); // current per-sprite fade (0 gone .. 1 solid)
      this.occluders = sprites.map((s) => s.occluder ?? DEFAULT_OCCLUDER);
      this.reach = this.occluders.map((o, i) => Math.max(...o) * sprites[i].w); // widest half width
      this.hero = { x: 0, y: 0, z: 0 };
      const fadeAttr = new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 1);
      fadeAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('spriteFade', fadeAttr);
      addScreenDoor(material);
    }
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = name;
    this.rx = NaN;
    this.rz = NaN;
    this.orient(1, 0);
    // One bounding sphere valid for every orientation: centres grown by the widest sprite.
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += Math.max(0, ...sprites.map((s) => Math.max(s.w, s.h)));
  }

  // Quads span the horizontal unit vector (rx, 0, rz), the camera's right direction.
  orient(rx, rz) {
    if (Math.abs(rx - this.rx) < 1e-4 && Math.abs(rz - this.rz) < 1e-4) return;
    this.rx = rx;
    this.rz = rz;
    const p = this.positions;
    const sprites = this.sprites;
    for (let i = 0, o = 0; i < sprites.length; i++, o += 12) {
      const s = sprites[i];
      const hx = (rx * s.w) / 2;
      const hz = (rz * s.w) / 2;
      const top = s.y + s.h;
      p[o] = s.x - hx;
      p[o + 1] = s.y;
      p[o + 2] = s.z - hz;
      p[o + 3] = s.x + hx;
      p[o + 4] = s.y;
      p[o + 5] = s.z + hz;
      p[o + 6] = s.x + hx;
      p[o + 7] = top;
      p[o + 8] = s.z + hz;
      p[o + 9] = s.x - hx;
      p[o + 10] = top;
      p[o + 11] = s.z - hz;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  // locateHero(camera, fx, fz, out) -> true with the hero's feet in `out` ({ x, y, z }), or
  // false when there is no hero to keep in view (see heroLocator). Only asked when a sprite
  // could be in the way.
  update(camera, locateHero = null) {
    if (!camera) return;
    camera.getWorldDirection(fwd); // also brings camera.matrixWorld up to date
    const l = Math.hypot(fwd.x, fwd.z);
    if (l < 1e-3) return; // looking straight up/down: keep the last orientation
    this.orient(-fwd.z / l, fwd.x / l);
    if (this.fades) this.updateFade(camera, fwd.x / l, fwd.z / l, locateHero);
  }

  // Per-sprite fade for a camera looking along the horizontal unit vector (fx, fz) (the
  // quads' normal; their right vector is (-fz, fx)): near fade by the depth of the sprite's
  // plane, capped at OCCLUDER_ALPHA while its painted part covers some of the hero, i.e.
  // crosses the lines of sight from the camera to his feet .. head.
  updateFade(camera, fx, fz, locateHero) {
    const e = camera.matrixWorld.elements;
    const cx = e[12];
    const cy = e[13];
    const cz = e[14];
    const sprites = this.sprites;
    const hero = this.hero;
    let located = 0; // 0 not asked yet, 1 found, -1 none
    let heroDepth = 0;
    let heroLat = 0;
    let changed = false;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const depth = dx * fx + dz * fz;
      const above = Math.max(0, s.y - cy, cy - s.y - s.h); // camera above / below the quad
      let alpha = smoothstep(NEAR_FADE[0] * s.w, NEAR_FADE[1] * s.w, depth > 0 ? Math.sqrt(depth * depth + above * above) : depth);
      const lat = dz * fx - dx * fz; // sprite centre, sideways from the view's centre line
      if (alpha > OCCLUDER_ALPHA && depth > 0 && Math.abs(lat) < this.reach[i] + CENTRE_SLACK) {
        if (located === 0) {
          located = locateHero && locateHero(camera, fx, fz, hero) ? 1 : -1;
          heroDepth = (hero.x - cx) * fx + (hero.z - cz) * fz;
          heroLat = (hero.z - cz) * fx - (hero.x - cx) * fz;
        }
        if (located > 0 && depth < heroDepth - IN_FRONT[0]) {
          const cover = this.cover(i, depth / heroDepth, lat, heroLat, cy, hero.y);
          const ahead = 1 - smoothstep(heroDepth - IN_FRONT[1], heroDepth - IN_FRONT[0], depth);
          alpha = Math.min(alpha, 1 - (1 - OCCLUDER_ALPHA) * cover * ahead);
        }
      }
      if (alpha < FADE_SNAP[0]) alpha = 0;
      else if (alpha > FADE_SNAP[1]) alpha = 1;
      if (Math.abs(alpha - this.fades[i]) > 1 / 256 || (alpha !== this.fades[i] && (alpha === 0 || alpha === 1))) {
        this.fades[i] = alpha;
        changed = true;
      }
    }
    if (changed) {
      const attr = this.mesh.geometry.attributes.spriteFade;
      const a = attr.array;
      for (let i = 0; i < sprites.length; i++) {
        const f = this.fades[i];
        a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = a[i * 4 + 3] = f;
      }
      attr.needsUpdate = true;
    }
  }

  // How much sprite i's outline hides the hero (0..1). The sight lines from the camera
  // (height cy) to the hero cross the sprite's plane at fraction k of the way, where the hero
  // shows k times his size, k * heroLat sideways (sprite centre: lat), his feet at
  // cy + k * (heroY - cy). Rows covering at least half his width count fully, and the fade
  // is complete once HIDDEN[1] of his height is behind the outline.
  cover(i, k, lat, heroLat, cy, heroY) {
    const s = this.sprites[i];
    const outline = this.occluders[i];
    const rows = outline.length;
    const rowH = s.h / rows;
    const off = Math.abs(k * heroLat - lat); // his centre, sideways from the sprite's
    const hw = HERO_HALF_WIDTH * k;
    const feet = cy + k * (heroY + HERO_BAND[0] - cy);
    const head = cy + k * (heroY + HERO_BAND[1] - cy);
    const r0 = Math.max(0, Math.floor((feet - s.y) / rowH));
    const r1 = Math.min(rows - 1, Math.floor((head - s.y) / rowH));
    let hidden = 0;
    for (let r = r0; r <= r1; r++) {
      const y0 = s.y + r * rowH;
      const dy = Math.min(y0 + rowH, head) - Math.max(y0, feet);
      const half = outline[r] * s.w;
      const across = Math.min(off + hw, half) - Math.max(off - hw, -half);
      if (dy > 0 && across > 0) hidden += dy * Math.min(1, across / hw);
    }
    return smoothstep(HIDDEN[0], HIDDEN[1], hidden / (head - feet));
  }
}

// Where the hero is, for BillboardBatch.update. The camera may publish the point it orbits
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

// Patch a world material so fragments of faded sprites are discarded in a 4x4 Bayer
// pattern (the N64's screen-door transparency): no blending, no sorting, depth still works.
export function addScreenDoor(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float spriteFade;\nvarying float vSpriteFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpriteFade = spriteFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSpriteFade;
const float BAYER4[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
if (vSpriteFade < 0.999) {
  ivec2 q = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  if (vSpriteFade * 16.0 <= BAYER4[q.y * 4 + q.x] + 0.5) discard;
}`,
      );
  };
  material.customProgramCacheKey = () => 'props-screen-door';
  return material;
}
