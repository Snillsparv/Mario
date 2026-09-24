// Scorch marks (AI RACE mode): burnt circular decals on the ground where fireballs land. A
// small pool (MAX_SCORCHES) shares one mesh and one draw call; adding one past the pool reuses
// the oldest. Each decal is a GRID x GRID sheet draped over layout.groundHeight a little above
// the ground (plus a depth bias, like the path decal: constant units only), its vertices over
// water or across a wall faded out. The burn itself is drawn in the shader: a charred, ragged
// black-brown disc mottled with grey ash and streaks, a soft soot halo, and a broken ring of
// flickering orange embers (plus a few specks) that cool over time but never quite go out;
// it fades in over SCORCH_FADE_IN seconds of game time.

import * as THREE from 'three';
import { makeRng } from '../../core/math.js';

export const MAX_SCORCHES = 24;
export const SCORCH_FADE_IN = 0.3; // seconds
const GRID = 8; // cells per side
const LIFT = 6; // units above the ground (the faceted lawn's creases stay under it)
const VERTS = (GRID + 1) * (GRID + 1);
const TRIS = GRID * GRID * 2;

export function buildScorches(layout) {
  const positions = new Float32Array(MAX_SCORCHES * VERTS * 3);
  const uvs = new Float32Array(MAX_SCORCHES * VERTS * 2);
  const info = new Float32Array(MAX_SCORCHES * VERTS * 3); // born time, seed, mask
  const index = [];
  for (let s = 0; s < MAX_SCORCHES; s++) {
    const b = s * VERTS;
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const k = b + j * (GRID + 1) + i;
        uvs[k * 2] = -1 + (2 * i) / GRID;
        uvs[k * 2 + 1] = -1 + (2 * j) / GRID;
      }
    }
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = b + j * (GRID + 1) + i;
        const c = a + GRID + 1;
        // Counter-clockwise seen from above (+z rows, +x columns).
        index.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const infoAttr = new THREE.BufferAttribute(info, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  infoAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('scorch', infoAttr);
  geo.setIndex(index);
  geo.setDrawRange(0, 0);

  const time = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 0;
  mat.polygonOffsetUnits = -8; // over the path decal (-4)
  mat.onBeforeCompile = (shader) => patchShader(shader, time);
  mat.customProgramCacheKey = () => 'terrain-scorch';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'scorches';
  mesh.frustumCulled = false; // spread over the whole level; drawn only while there are any
  mesh.renderOrder = 0.5; // after the path decal, before the water

  const rng = makeRng(8086);
  let next = 0; // slot the next scorch goes into (the oldest once the pool is full)
  let count = 0;
  let now = 0;
  // Drawn (an empty draw range) in the first frame the scene renders, so its shader compiles
  // with the level's instead of at the first impact; hidden from then on while there are none.
  let warmed = false;
  mesh.onAfterRender = () => {
    delete mesh.onAfterRender;
    warmed = true;
    mesh.visible = count > 0;
  };

  return {
    mesh,
    get count() {
      return count;
    },
    // A burn mark of `radius` centred on (x, z), on the ground.
    add(x, z, radius = 200) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const r = Math.max(30, radius);
      const slot = next;
      next = (next + 1) % MAX_SCORCHES;
      count = Math.min(MAX_SCORCHES, count + 1);
      const h0 = layout.groundHeight(x, z);
      const turn = rng() * Math.PI * 2;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const seed = rng();
      const reach = 0.5 * r + 60; // height change beyond which the sheet is across a wall
      for (let k = 0; k < VERTS; k++) {
        const v = slot * VERTS + k;
        const lu = uvs[v * 2];
        const lv = uvs[v * 2 + 1];
        const px = x + (lu * c - lv * s) * r;
        const pz = z + (lu * s + lv * c) * r;
        const g = layout.groundHeight(px, pz);
        const wet = layout.waterLevelAt(px, pz) > g - 2;
        positions[v * 3] = px;
        positions[v * 3 + 1] = g + LIFT;
        positions[v * 3 + 2] = pz;
        info[v * 3] = now;
        info[v * 3 + 1] = seed;
        info[v * 3 + 2] = wet || Math.abs(g - h0) > reach ? 0 : 1;
      }
      posAttr.needsUpdate = true;
      infoAttr.needsUpdate = true;
      geo.setDrawRange(0, count * TRIS * 3);
      mesh.visible = true;
    },
    clear() {
      count = 0;
      next = 0;
      geo.setDrawRange(0, 0);
      if (warmed) mesh.visible = false;
    },
    update(t) {
      if (!Number.isFinite(t)) return;
      // The clock went back (a new game): keep every mark's age.
      if (t < now - 0.5) {
        for (let v = 0; v < info.length; v += 3) info[v] += t - now;
        infoAttr.needsUpdate = true;
      }
      now = t;
      time.value = t;
    },
  };
}

function patchShader(shader, time) {
  shader.uniforms.scorchTime = time;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 scorch;
varying vec2 vScorchUv;
varying vec3 vScorch;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vScorchUv = uv;
vScorch = scorch;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float scorchTime;
varying vec2 vScorchUv;
varying vec3 vScorch;
float scHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float scNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(scHash(i), scHash(i + vec2(1.0, 0.0)), f.x), mix(scHash(i + vec2(0.0, 1.0)), scHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
    )
    .replace(
      '#include <map_fragment>',
      `{
  vec2 q = vScorchUv;
  float seed = vScorch.y * 37.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float n = 0.6 * scNoise(q * 3.0 + seed) + 0.4 * scNoise(q * 7.0 - seed);
  float edge = 0.62 + 0.26 * n; // ragged outline
  float age = max(0.0, scorchTime - vScorch.x);
  float fadeIn = clamp(age / ${SCORCH_FADE_IN.toFixed(3)}, 0.0, 1.0);
  // Char: black-brown in the middle, mottled with grey ash and radial streaks, browner
  // toward the edge; a soft soot halo feathers out past it.
  float mottle = scNoise(q * 11.0 + seed * 2.0);
  float streak = scNoise(vec2(ang * 4.0 + seed, r * 3.0));
  float ash = smoothstep(0.55, 0.9, mottle) * 0.7 + smoothstep(0.6, 0.95, streak) * 0.5 * smoothstep(0.15, 0.6, r);
  vec3 col = mix(vec3(0.012, 0.01, 0.009), vec3(0.05, 0.036, 0.024), smoothstep(0.3, 1.0, r / edge));
  col = mix(col, vec3(0.1, 0.095, 0.09), clamp(ash, 0.0, 1.0) * 0.6);
  float body = 1.0 - smoothstep(edge - 0.14, edge + 0.02, r);
  float halo = (1.0 - smoothstep(edge, edge + 0.3, r)) * 0.45;
  float alpha = max(body * (0.9 + 0.1 * mottle), halo * (0.6 + 0.4 * n));
  // Embers: a broken glowing ring just inside the edge and a few specks inside, flickering,
  // cooling over time to a dull glow (never quite out).
  float spark = scNoise(q * 6.0 + vec2(seed, scorchTime * 0.6));
  float ring = smoothstep(edge - 0.26, edge - 0.12, r) * (1.0 - smoothstep(edge - 0.1, edge - 0.01, r));
  float specks = smoothstep(0.86, 0.96, scNoise(q * 9.0 - seed)) * (1.0 - smoothstep(0.3, 0.75, r / edge));
  float heat = (0.4 + 0.6 * exp(-age / 10.0)) * (0.8 + 0.2 * sin(scorchTime * 9.0 + seed * 5.0 + ang * 3.0));
  float glow = (ring * smoothstep(0.42, 0.78, spark) + specks * 0.6) * heat;
  col = mix(col, vec3(1.0, 0.3, 0.035), clamp(glow * 1.5, 0.0, 1.0));
  diffuseColor = vec4(col, max(alpha, clamp(glow * 2.0, 0.0, 1.0) * body) * fadeIn * vScorch.z);
}`,
    );
  return shader;
}
