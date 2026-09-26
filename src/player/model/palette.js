// Jonas's colours (sRGB hex) and the single Gouraud-style body material. Every body part
// carries its colour as a vertex colour, so the whole hero (apart from the painted face)
// shares one material and each bone can be merged into a single draw call.
import * as THREE from 'three';

export const COLORS = {
  skin: 0xf4c49c,
  glove: 0xf7f7f3, // white cartoon gloves
  nose: 0xf2ae8a,
  cheek: '#f28b82',
  // Brown, a bit rowdy: the hair mass and the lighter tips of its tufts and locks.
  hair: 0x70411f,
  hairTuft: 0x8a552b,
  // The plain light blue baseball cap: crown and button, its panels' seams, a slightly darker
  // bill, and the underside of the bill.
  cap: 0x86c8f0,
  capSeam: 0x5c9fd0,
  capBill: 0x5fa8dc,
  capUnder: 0x6aa2d2,
  glasses: 0x24242c, // thin dark round frames (clear lenses)
  shirt: 0xd8302a, // the red t-shirt
  shirtCollar: 0xb4221e,
  pi: 0xf8f6f0, // the white pi sign on its chest
  jeans: 0x2c2e36, // black jeans
  sockL: 0x2f62dc, // odd socks: blue on the left foot...
  sockR: 0xf4cc26, // ...yellow on the right
  shoe: 0xf2f1ec, // white sneakers
  shoeLace: 0xc4c8cf, // grey tongues and laces
  sole: 0xe23c2e, // red soles
  // Winged cap (wings.js): soft white feathers, cool grey undersides, a hint of the cap's
  // light blue where they sprout from the crown.
  wing: 0xf8f6ee,
  wingTip: 0xe2e9ee,
  wingUnder: 0xe4eaf2,
  wingUnderTip: 0xcdd6e2,
  wingRoot: 0x9fd4f2,
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
