// Pip's colours (sRGB hex) and the single Gouraud-style body material. Every body part
// carries its colour as a vertex colour, so the whole hero (apart from the painted face)
// shares one material and each bone can be merged into a single draw call.
import * as THREE from 'three';

export const COLORS = {
  skin: 0xf4c49c,
  nose: 0xf2ae8a,
  cheek: '#f28b82',
  hair: 0x6e3f1f,
  hat: 0x1d948c,
  hatBand: 0xe3a82b,
  leaf: 0x5cbf3a,
  leafDark: 0x3f9a2c,
  scarf: 0xeeb52f,
  tunic: 0xd4631f,
  belt: 0x6a3d1d,
  buckle: 0xf2cf57,
  glove: 0xf7eed6,
  trousers: 0x8a7a55,
  boot: 0x4d2e19,
  bootCuff: 0x7a4b2a,
  sole: 0x2b1b10,
  // Winged hat (wings.js): soft white feathers, cool grey undersides, a hint of the hat's
  // teal where they sprout from the crown.
  wing: 0xf8f6ee,
  wingTip: 0xe2e9ee,
  wingUnder: 0xe4eaf2,
  wingUnderTip: 0xcdd6e2,
  wingRoot: 0x8fd0c6,
};

// Lambert (per-vertex lighting) reads as the N64's smooth Gouraud shading on low-poly parts.
export function bodyMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

// Bakes one palette colour into a geometry (converted to the linear working space, like a
// material colour would be). Returns the geometry for chaining.
const tmpColor = new THREE.Color();
export function paint(geometry, name) {
  tmpColor.set(COLORS[name]);
  const n = geometry.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}
