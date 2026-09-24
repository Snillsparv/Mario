// Low-poly 3D foliage (tree canopies and round bushes): a cluster of overlapping lumpy
// ellipsoid "blobs" (jittered icospheres), lit by baked vertex colours the N64 way:
// - sun + a little sky light on a normal blended from the blob's own and the whole
//   canopy's, so each clump is round but the canopy still reads as one lit ball;
// - darker toward the bottom and a dark ring on the underside;
// - soft dark creases where one blob dips into another (fake ambient occlusion);
// - a per-tree tint.
// The leaf texture is mapped tri-planar in world space by the leaf material (props.js,
// foliageFade.js), blended by the same smooth normal, which the vertices carry: the leaves
// run on across faces and from blob to blob with no seams.
// Faces buried inside another blob are dropped (never seen, and cleaner when dithered).

import * as THREE from 'three';
import { SUN_DIR } from '../layout.js';
import { smoothstep } from '../../core/math.js';
import { lumpyDome } from './geom.js';

export const BLOB_JITTER = 0.1; // radial lumpiness (fraction of the radius)

// Blob: { x, y, z, rx, ry, rz, yaw, seed, detail? } (detail: icosphere subdivision, 1 = 80
// faces, 2 = 320 for the big blobs whose outline would look faceted). The canopy's overall
// ellipsoid (centre, radii) shapes the shading; bottom / top are its lowest and highest points.
export function addCanopy(builder, blobs, { centre, radii, bottom, top, tint = [1, 1, 1] }) {
  const placed = blobs.map((b) => {
    const turn = new THREE.Matrix4().makeRotationY(b.yaw ?? 0);
    const m = turn.clone().scale(new THREE.Vector3(b.rx, b.ry, b.rz)).setPosition(b.x, b.y, b.z);
    return { ...b, m, inv: m.clone().invert(), rot: new THREE.Matrix3().setFromMatrix4(turn) };
  });
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();

  // Normalised distance from blob j's centre (1 on its surface, ignoring the lumps).
  const inBlob = (j, x, y, z) => q.set(x, y, z).applyMatrix4(placed[j].inv).length();

  placed.forEach((b, i) => {
    const geo = lumpyDome({ detail: b.detail ?? 1, jitter: BLOB_JITTER, flatBottom: 1, seed: b.seed });
    const pos = geo.attributes.position;
    const verts = [];
    for (let k = 0; k < pos.count; k++) {
      p.fromBufferAttribute(pos, k);
      // Ellipsoid normal of the unit-sphere direction, turned with the blob.
      n.set(p.x / b.rx, p.y / b.ry, p.z / b.rz).normalize();
      const nb = n.clone().applyMatrix3(b.rot).normalize();
      p.applyMatrix4(b.m);
      const v = { x: p.x, y: p.y, z: p.z, u: 0, v: 0 };
      // Buried: inside another blob by a margin (its lumps can reach out a little).
      v.buried = placed.some((_, j) => j !== i && inBlob(j, v.x, v.y, v.z) < 1 - BLOB_JITTER);
      const ns = smoothNormal(v, nb, centre, radii);
      const [r, g, bl] = shade(v, ns, placed, i, inBlob, { centre, bottom, top, tint });
      Object.assign(v, { nx: ns[0], ny: ns[1], nz: ns[2], r, g, b: bl });
      verts.push(v);
    }
    const index = geo.index;
    for (let t = 0; t < index.count; t += 3) {
      const tri = [0, 1, 2].map((k) => verts[index.getX(t + k)]);
      if (tri.every((v) => v.buried)) continue;
      builder.tri(...tri);
    }
  });
}

// Normal of a canopy vertex v for lighting and texture: its blob's own normal nb blended with
// the whole canopy's (as if it were one ellipsoid), so neighbouring blobs agree where they
// meet. Returns [x, y, z, canopy normal's y].
function smoothNormal(v, nb, centre, radii) {
  const gx = (v.x - centre.x) / radii.x;
  const gy = (v.y - centre.y) / radii.y;
  const gz = (v.z - centre.z) / radii.z;
  const gl = Math.hypot(gx, gy, gz) || 1;
  const nx = 0.55 * nb.x + (0.45 * gx) / gl;
  const ny = 0.55 * nb.y + (0.45 * gy) / gl;
  const nz = 0.55 * nb.z + (0.45 * gz) / gl;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return [nx / nl, ny / nl, nz / nl, gy / gl];
}

// Baked colour of a canopy vertex v with smooth normal ns (smoothNormal).
function shade(v, ns, placed, self, inBlob, { bottom, top, tint }) {
  const [nx, ny, nz, ngy] = ns;
  const sun = Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z);
  let l = 0.5 + 0.62 * sun + 0.12 * Math.max(0, ny) + 0.12 * smoothstep(0.35, 0.9, ngy); // sunlit crown
  // Darker toward the bottom, and a dark ring all round the underside.
  const h = (v.y - bottom) / Math.max(1, top - bottom);
  l *= 0.6 + 0.4 * smoothstep(0.05, 0.6, h);
  l *= 1 - 0.32 * smoothstep(-0.25, -0.8, ngy);
  // Creases: close to (just outside) another blob's surface. Soft and shallow: one dark
  // vertex shades a whole triangle fan, which reads as hard dark facets if overdone.
  let ao = 1;
  for (let j = 0; j < placed.length; j++) {
    if (j === self) continue;
    const d = inBlob(j, v.x, v.y, v.z);
    if (d < 1.4) ao = Math.min(ao, 0.8 + 0.2 * smoothstep(0.95, 1.4, d));
  }
  l = Math.min(1.25, l * ao);
  return [l * tint[0], l * tint[1], l * tint[2]];
}

// Canopy blobs as the fade sees them (foliageFade.js): upright ellipsoids, lumps left out.
export const fadeBlobs = (blobs) => blobs.map((b) => ({ x: b.x, y: b.y, z: b.z, rh: Math.max(b.rx, b.rz), ry: b.ry }));

// Lowest point of an upright blob ({ x, y, z, rx, ry, rz, yaw }) over the horizontal disc of
// radius `rho` around (x, z), less its lumps (BLOB_JITTER), or Infinity if it does not
// reach over the disc.
export function blobUnderside(b, x, z, rho) {
  let low = Infinity;
  const c = Math.cos(b.yaw ?? 0);
  const s = Math.sin(b.yaw ?? 0);
  for (let k = 0; k <= 16; k++) {
    const r = k === 0 ? 0 : rho * (k <= 8 ? 0.5 : 1);
    const a = (k / 8) * Math.PI * 2;
    const dx = x + Math.cos(a) * r - b.x;
    const dz = z + Math.sin(a) * r - b.z;
    // Into the blob's frame (the inverse of rotation.y = yaw).
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const qh = (lx / b.rx) ** 2 + (lz / b.rz) ** 2;
    if (qh < 1) low = Math.min(low, b.y - b.ry * Math.sqrt(1 - qh));
  }
  return low === Infinity ? low : low - BLOB_JITTER * b.ry;
}
