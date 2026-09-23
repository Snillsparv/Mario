// Cloth flags: every banner and pennant shares one mesh. update(time) bends the cloth with
// a travelling sine wave that grows toward the free end, and shades the folds by the wave
// slope (vertex colours), so the whole thing is one cheap draw call.

import * as THREE from 'three';

const COLS = 10; // segments along the flag
const WIND = [1, 0, 0]; // flags stream toward +X
const SPEED = 5.2; // wave speed (rad/s)

// specs: [{ x, z, top, kind: 'banner'|'pennant', len, height }]
export function buildFlags(specs, material) {
  const pos = [];
  const uv = [];
  const index = [];
  const rest = []; // per vertex: rest x, y, z
  const flex = []; // per vertex: 0 at the pole .. 1 at the free end
  const phase = []; // per vertex: flag's phase offset (desynchronises flags)
  const size = []; // per vertex: flag length (wave amplitude scale)
  specs.forEach((f, fi) => {
    const base = pos.length / 3;
    const banner = f.kind === 'banner';
    for (let i = 0; i <= COLS; i++) {
      const u = i / COLS;
      // Pennants taper to a point at mid height; banners are rectangles.
      const half = banner ? f.height / 2 : (f.height / 2) * (1 - u * 0.94);
      for (let j = 0; j <= 2; j++) {
        const t = j / 2; // 0 top .. 1 bottom
        const x = f.x + WIND[0] * f.len * u;
        const y = f.top - f.height / 2 + half * (1 - 2 * t);
        const z = f.z + WIND[2] * f.len * u;
        pos.push(x, y, z);
        rest.push(x, y, z);
        flex.push(u);
        phase.push(fi * 1.7);
        size.push(f.len);
        uv.push(u, banner ? 1 - t * 0.5 : 0.5 - t * 0.5);
      }
    }
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < 2; j++) {
        const a = base + i * 3 + j;
        const b = a + 3;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(pos, 3);
  const colAttr = new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 200; // room for the wave
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'castle-flags';

  // Perpendicular to the flag plane (the direction the cloth ripples in).
  const across = [-WIND[2], 0, WIND[0]];
  function update(time) {
    const p = posAttr.array;
    const c = colAttr.array;
    for (let v = 0; v < flex.length; v++) {
      const u = flex[v];
      const a = u * 7.5 - time * SPEED + phase[v];
      const amp = size[v] * 0.085 * (0.25 + u);
      const off = Math.sin(a) * amp;
      const i = v * 3;
      // Slight shortening toward the tip keeps the cloth from looking stretched.
      p[i] = rest[i] + across[0] * off - WIND[0] * u * u * size[v] * 0.04;
      p[i + 1] = rest[i + 1] + Math.sin(a * 0.5 + 1.3) * amp * 0.12;
      p[i + 2] = rest[i + 2] + across[2] * off - WIND[2] * u * u * size[v] * 0.04;
      const k = 0.84 + 0.16 * Math.cos(a);
      c[i] = c[i + 1] = c[i + 2] = k;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
  update(0);
  return { mesh, update };
}
