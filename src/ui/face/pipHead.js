// Jonas's head for the face screen: the in-game head (player/model/head.js, used by rig.js
// buildHead: the same shapes, sizes, placement and palette) rebuilt at a much higher mesh
// density so it can be pulled about smoothly, plus the t-shirt's collar under his chin.
//
//   const head = new PipHead();        // head.object3D (origin at the head centre, front +Z)
//   head.setExpression('surprise');    // a stretch.js FACE_EXPRESSIONS key
//   head.setLook(x, y);                // drawn irises: -1..1, x to the viewer's right, y down
//   head.sync(stretch);                // the handles' grab points and offsets -> the shaders
//   head.pick(originLocal, dirLocal, stretch) -> { point (rest space), hit (shown, local) } | null
//   head.dispose();
//
// Two meshes (two draw calls): the skull, which carries the painted face (faceArt.js), and every
// other part merged into one vertex-coloured mesh. Both are authored in head space and both
// materials get the same deformation injected into their vertex shaders (onBeforeCompile):
// every vertex moves by sum_i pull_i * falloff(|position - grab_i| / radius_i), from the rest
// position in head space (stretch.js), so skin, hair, cap, glasses, ears, nose and collar
// always move together and never come apart. Normals follow the deformation (the inverse transpose of its
// Jacobian), so a pulled cheek is shaded as the new shape.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as D from '../../player/model/dims.js';
import { buildHeadParts } from '../../player/model/head.js';
import { paint } from '../../player/model/palette.js';
import { STRETCH, raycast, pointOnTriangle } from './stretch.js';
import { FaceArt, cropUv, irisUniforms, IRIS_PARS_GLSL, IRIS_GLSL } from './faceArt.js';

const N = STRETCH.HANDLES;

// Mesh density (segments) of the parts; the in-game head uses 6-18.
const SKULL_SEGS = [112, 84];

const STRETCH_PARS = /* glsl */ `
uniform vec4 uPipGrab[${N}]; // grab point (head space) and radius; radius 0 = unused
uniform vec3 uPipPull[${N}]; // its offset
`;

// Displacement and its Jacobian's columns (c0, c1, c2), from the rest position.
const STRETCH_NORMAL = /* glsl */ `
vec3 pipDisp = vec3(0.0);
vec3 pipC0 = vec3(1.0, 0.0, 0.0);
vec3 pipC1 = vec3(0.0, 1.0, 0.0);
vec3 pipC2 = vec3(0.0, 0.0, 1.0);
for (int i = 0; i < ${N}; i++) {
  vec4 g = uPipGrab[i];
  if (g.w <= 0.0) continue;
  vec3 d = position - g.xyz;
  float r2 = g.w * g.w;
  float q = dot(d, d) / r2;
  if (q >= 1.0) continue;
  float k = 1.0 - q;
  vec3 o = uPipPull[i];
  pipDisp += o * (k * k * k);
  vec3 grad = d * (-6.0 * k * k / r2); // d falloff / d position
  pipC0 += o * grad.x;
  pipC1 += o * grad.y;
  pipC2 += o * grad.z;
}
// Normals go through the inverse transpose of the Jacobian (its cofactor matrix, up to scale).
objectNormal = mat3(cross(pipC1, pipC2), cross(pipC2, pipC0), cross(pipC0, pipC1)) * objectNormal;
`;

// Inject the shared deformation (and, for the skull, the drawn irises) into a material.
function injectStretch(material, uniforms, iris) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STRETCH_PARS}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${STRETCH_NORMAL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += pipDisp;');
    if (iris) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${IRIS_PARS_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${IRIS_GLSL}`);
    }
  };
  material.customProgramCacheKey = () => (iris ? 'pip-face-skull' : 'pip-face-parts');
}

// ---- geometry --------------------------------------------------------------------------

// Subdivide each segment of a [radius, y] profile into `n` pieces.
function resample(profile, n) {
  const out = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    for (let k = 0; k < n; k++) out.push([r0 + ((r1 - r0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(profile.at(-1));
  return out;
}

const lathe = (profile, segs) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);

// Weld a surface's seam (the lathe's first and last columns) and smooth its normals.
function smooth(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const welded = mergeVertices(geo, 1e-4);
  geo.dispose();
  welded.computeVertexNormals();
  return welded;
}

// A mesh of one palette colour for the merge (geometry only; never drawn itself).
function part(parent, geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(paint(geo, color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Everything but the skull, in head-centre space: the in-game head's parts (player/model/
// head.js: nose, ears, hair, glasses, cap) at the face screen's density, plus the neck and the
// red t-shirt's crew neck under the chin (rig.js buildTorso), as one geometry.
function buildParts() {
  const root = new THREE.Group();
  const kit = { hi: true, mesh: (geo, color) => new THREE.Mesh(paint(geo, color)) };
  buildHeadParts(root, kit);
  const neckY = D.NECK_Y + D.HEAD_CY; // head centre above the torso joint
  part(root, new THREE.CylinderGeometry(7, 8, 8, 40, 2, true), 'skin', 0, 36 - neckY, -2);
  // The top of the shirt round the neck (its lathe's last profile points) and the collar.
  part(root, smooth(lathe(resample([[15.5, 28], [10, 33], [0.1, 35]], 6), 64)).scale(1, 1, 0.88), 'shirt', 0, -neckY, -2);
  part(root, new THREE.TorusGeometry(8.3, 1.4, 12, 48).rotateX(Math.PI / 2), 'shirtCollar', 0, 33.8 - neckY, -2);
  part(root, new THREE.CircleGeometry(15.5, 48).rotateX(Math.PI / 2), 'shirt', 0, 28 - neckY, -2); // closes it below

  root.updateMatrixWorld(true);
  const pieces = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry : mergeVertices(o.geometry);
    pieces.push(g.applyMatrix4(o.matrixWorld));
  });
  const merged = mergeGeometries(pieces);
  for (const g of pieces) g.dispose();
  return merged;
}

// The skull: a dense sphere whose uv is the in-game head's, mapped onto the painted window.
function buildSkull() {
  const geo = new THREE.SphereGeometry(D.HEAD_R, ...SKULL_SEGS).scale(1.07, 0.97, 1);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = cropUv(uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
  return geo;
}

// ---- the head ---------------------------------------------------------------------------

export class PipHead {
  constructor() {
    this.object3D = new THREE.Group();
    this.object3D.name = 'PipFace';
    // Shared by both materials: the stretch handles (stretch.js writeUniforms fills them).
    this.grab = new Float32Array(N * 4);
    this.pull = new Float32Array(N * 3);
    const stretch = { uPipGrab: { value: this.grab }, uPipPull: { value: this.pull } };
    this.iris = irisUniforms();

    this.art = new FaceArt();
    this.skinMaterial = new THREE.MeshLambertMaterial({ map: this.art.get('open') });
    injectStretch(this.skinMaterial, { ...stretch, ...this.iris }, true);
    this.partsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    injectStretch(this.partsMaterial, stretch, false);

    this.skull = new THREE.Mesh(buildSkull(), this.skinMaterial);
    this.parts = new THREE.Mesh(buildParts(), this.partsMaterial);
    for (const m of [this.skull, this.parts]) {
      m.frustumCulled = false; // the deformation can carry it anywhere
      this.object3D.add(m);
    }
    // Picking: the rest positions and triangles of both meshes, and scratch for the shown ones.
    this.pickables = [this.skull, this.parts].map((m) => ({
      rest: m.geometry.attributes.position.array,
      index: m.geometry.index.array,
      shown: new Float32Array(m.geometry.attributes.position.array.length),
    }));
    this.expression = 'open';
  }

  get triangles() {
    return this.pickables.reduce((n, p) => n + p.index.length / 3, 0);
  }

  // A stretch.js FACE_EXPRESSIONS key: swaps the painted face (and the drawn irises).
  setExpression(name, drawIris = true) {
    if (name === this.expression) return;
    this.expression = name;
    this.skinMaterial.map = this.art.get(name);
    this.iris.uPipIris.value.z = drawIris ? 1 : 0;
  }

  setLook(x, y) {
    this.iris.uPipIris.value.x = x;
    this.iris.uPipIris.value.y = y;
  }

  sync(stretch) {
    stretch.writeUniforms(this.grab, this.pull);
  }

  // The nearest point of the shown (deformed) head along a ray in head space. Returns
  // { point: rest-space point, hit: the shown point, t } or null.
  pick(o, d, stretch) {
    let best = null;
    for (const p of this.pickables) {
      const shown = stretch.activeCount ? stretch.deform(p.rest, p.shown) : p.rest;
      const h = raycast(o.x, o.y, o.z, d.x, d.y, d.z, shown, p.index);
      if (h && (!best || h.t < best.h.t)) best = { h, p, shown };
    }
    if (!best) return null;
    const { h, p, shown } = best;
    return {
      t: h.t,
      point: pointOnTriangle(p.rest, p.index, h.tri, h.u, h.v),
      hit: pointOnTriangle(shown, p.index, h.tri, h.u, h.v),
    };
  }

  dispose() {
    this.object3D.removeFromParent();
    this.skull.geometry.dispose();
    this.parts.geometry.dispose();
    this.skinMaterial.dispose();
    this.partsMaterial.dispose();
    this.art.dispose();
  }
}
