// AI RACE mode: thin glowing red "circuit" cables running up the castle's round towers, with
// right-angle jogs and square node pads like traces on a circuit board, and pulses of light
// travelling up them. One small mesh (one draw call) that is only drawn while the mode shows:
// setDarkness(t) fades it in (opacity) and hides it at t = 0.
//
// Each tower (the kit's `towers` list, registered by parts.roundTower) gets two cables on
// wall faces clear of its windows, turned away from the castle's middle (the sides seen from
// the grounds), from its plinth up to the corbel band under the roof. A cable lies flat on
// its face of the polygonal tower, CABLE_LIFT out from it; jogs stay on that face.

import * as THREE from 'three';
import { makeRng } from '../../core/math.js';

const CABLE_WIDTH = 16;
const PAD = 19; // node pad half size
const CABLE_LIFT = 3; // out from the wall face
const PAD_LIFT = 4;
const CABLES_PER_TOWER = 2;
const COLOR = new THREE.Color(0xff2a3c); // sRGB: hot red
export const CIRCUIT_PULSE_SPEED = 380; // units per second up the cables

// towers: [{ x, z, r, sides, base, top, plinth, windows: [{ angle }] }]; centre: [x, z] of the
// castle (cables face away from it).
export function buildCircuits(towers, centre) {
  const pos = [];
  const uv = [];
  const col = [];
  const rng = makeRng(7331);
  const c = [COLOR.r, COLOR.g, COLOR.b];

  for (const t of towers) {
    const step = (Math.PI * 2) / t.sides;
    const face = (k) => ({ a: k * step, dist: t.r * Math.cos(step / 2), half: t.r * Math.sin(step / 2) });
    const windowFaces = new Set(t.windows.map((w) => ((Math.round(w.angle / step) % t.sides) + t.sides) % t.sides));
    const clear = (k) => ![-1, 0, 1].some((d) => windowFaces.has((((k + d) % t.sides) + t.sides) % t.sides));
    // Outward yaw (away from the castle's middle); cables either side of it.
    const out = Math.atan2(t.x - centre[0], t.z - centre[1]);
    const picks = [];
    for (const off of [-0.7, 0.7, -1.4, 1.4, -2.1, 2.1, 0, Math.PI]) {
      const k = (((Math.round((out + off) / step) % t.sides) + t.sides) % t.sides);
      if (clear(k) && !picks.some((p) => Math.abs(p - k) <= 1 || Math.abs(p - k) >= t.sides - 1)) picks.push(k);
      if (picks.length === CABLES_PER_TOWER) break;
    }
    for (const k of picks) {
      const f = face(k);
      const nx = Math.sin(f.a);
      const nz = Math.cos(f.a);
      // Right along the face (seen from outside) and a point on it at (u across, y).
      const rx = nz;
      const rz = -nx;
      const at = (u, y, lift) => [t.x + nx * (f.dist + lift) + rx * u, y, t.z + nz * (f.dist + lift) + rz * u];
      const y0 = t.base + (t.plinth ? 170 : 40);
      const y1 = t.top - 150;
      const maxU = Math.max(0, f.half - CABLE_WIDTH - 8);
      // Path: up, with two or three sideways jogs.
      const pts = [[(rng() - 0.5) * maxU, y0]];
      const jogs = 2 + Math.floor(rng() * 2);
      for (let j = 1; j <= jogs; j++) {
        const y = y0 + ((y1 - y0) * (j - 0.3 + 0.6 * rng())) / (jogs + 1);
        const u0 = pts[pts.length - 1][0];
        let u1 = (rng() - 0.5) * 2 * maxU;
        if (Math.abs(u1 - u0) < maxU * 0.5) u1 = u0 > 0 ? -maxU * 0.7 : maxU * 0.7;
        pts.push([u0, y], [u1, y]);
      }
      pts.push([pts[pts.length - 1][0], y1]);
      // Strips along the path; v = distance from the foot (the pulses run along it).
      let dist = 0;
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ua, ya] = pts[s];
        const [ub, yb] = pts[s + 1];
        const len = Math.hypot(ub - ua, yb - ya);
        if (len < 1) continue;
        // Across the strip, in (u, y).
        const au = (-(yb - ya) / len) * (CABLE_WIDTH / 2);
        const ay = ((ub - ua) / len) * (CABLE_WIDTH / 2);
        // Run each strip on by half a width at both ends so the corners close.
        const eu = ((ub - ua) / len) * (CABLE_WIDTH / 2);
        const ey = ((yb - ya) / len) * (CABLE_WIDTH / 2);
        const A = at(ua - eu - au, ya - ey - ay, CABLE_LIFT);
        const B = at(ub + eu - au, yb + ey - ay, CABLE_LIFT);
        const C = at(ub + eu + au, yb + ey + ay, CABLE_LIFT);
        const D = at(ua - eu + au, ya - ey + ay, CABLE_LIFT);
        quad(pos, uv, col, A, B, C, D, [dist, dist + len], c, 1);
        dist += len;
        // A node pad at every corner.
        if (s + 2 < pts.length) {
          const P = [at(ub - PAD, yb - PAD, PAD_LIFT), at(ub + PAD, yb - PAD, PAD_LIFT), at(ub + PAD, yb + PAD, PAD_LIFT), at(ub - PAD, yb + PAD, PAD_LIFT)];
          quad(pos, uv, col, ...P, [dist, dist], c, 1.25);
        }
      }
      // Terminal pads at both ends.
      for (const [u, y, d] of [[pts[0][0], pts[0][1], 0], [pts[pts.length - 1][0], pts[pts.length - 1][1], dist]]) {
        const P = [at(u - PAD, y - PAD, PAD_LIFT), at(u + PAD, y - PAD, PAD_LIFT), at(u + PAD, y + PAD, PAD_LIFT), at(u - PAD, y + PAD, PAD_LIFT)];
        quad(pos, uv, col, ...P, [d, d], c, 1.25);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const uniforms = { circuitT: { value: 0 }, circuitTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true });
  mat.polygonOffset = true;
  mat.polygonOffsetUnits = -4;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCircuit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCircuit = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float circuitT;\nuniform float circuitTime;\nvarying vec2 vCircuit;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // Pulses of light running up the cable, over a steady glow.
  float p = fract(vCircuit.x / 900.0 - circuitTime * ${(CIRCUIT_PULSE_SPEED / 900).toFixed(4)});
  float pulse = pow(p, 10.0) + 0.6 * pow(fract(p + 0.47), 18.0);
  diffuseColor.rgb = diffuseColor.rgb * (0.62 + 0.08 * sin(circuitTime * 3.0)) + vec3(1.0, 0.45, 0.4) * pulse * 0.8;
  diffuseColor.a *= circuitT;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'castle-circuits';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'castle-circuits';
  mesh.renderOrder = 1;
  // Drawn (fully transparent) in the first frame the scene renders, so its shader compiles
  // with the level's instead of mid-crossfade; hidden from then on until the mode shows.
  let warmed = false;
  mesh.frustumCulled = false;
  mesh.onAfterRender = () => {
    delete mesh.onAfterRender;
    warmed = true;
    mesh.frustumCulled = true;
    mesh.visible = uniforms.circuitT.value > 0;
  };

  return {
    mesh,
    setDarkness(t) {
      // Fade in over the second half of the crossfade, once the walls have gone dark.
      const k = Math.min(1, Math.max(0, (t - 0.35) / 0.65));
      uniforms.circuitT.value = k * k * (3 - 2 * k);
      if (warmed) mesh.visible = uniforms.circuitT.value > 0;
    },
    update(time) {
      if (Number.isFinite(time)) uniforms.circuitTime.value = time;
    },
  };
}

// Quad A-B-C-D (counter-clockwise seen from outside) with uv.x = distance along the cable
// (d[0] at A/D, d[1] at B/C) and a brightness k on the colour.
function quad(pos, uv, col, A, B, C, D, d, c, k) {
  for (const [p, u] of [[A, d[0]], [B, d[1]], [C, d[1]], [A, d[0]], [C, d[1]], [D, d[0]]]) {
    pos.push(p[0], p[1], p[2]);
    uv.push(u, 0);
    col.push(c[0] * k, c[1] * k, c[2] * k);
  }
}
