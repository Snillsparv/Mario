// A batch of screen-aligned billboard sprites drawn in a single instanced draw call, the way
// the N64 drew coins and sparkles. Each sprite has a centre, size, in-plane rotation, an atlas
// UV rect and an RGBA tint; the CPU rewrites the (small) instance arrays whenever they change.

import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 iPos;
attribute vec2 iSizeRot;
attribute vec4 iUV;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y);
  float s = sin(iSizeRot.y);
  vec2 corner = position.xy * iSizeRot.x;
  mvPosition.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  gl_Position = projectionMatrix * mvPosition;
  vUv = iUV.xy + uv * iUV.zw;
  vColor = iColor;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D map;
uniform float uAlphaCut;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 color = texture2D(map, vUv) * vColor;
  if (color.a < uAlphaCut) discard;
  gl_FragColor = color;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class SpriteBatch {
  // alphaCut > 0 gives cut-out sprites that write depth (coins); blended sprites (sparkles)
  // pass transparent: true.
  constructor(capacity, { map, transparent = false, alphaCut = 0.5 }) {
    this.capacity = capacity;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs = [];
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.attrs.push(a);
      return a.array;
    };
    this.pos = attr('iPos', 3);
    this.sizeRot = attr('iSizeRot', 2);
    this.uv = attr('iUV', 4);
    this.color = attr('iColor', 4);
    geo.instanceCount = 0;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uAlphaCut: { value: 0 } }]);
    uniforms.map.value = map; // merge() clones textures, so assign after
    uniforms.uAlphaCut.value = alphaCut;
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      transparent,
      depthWrite: !transparent,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false; // instances span the whole level
    this.geometry = geo;
    // The sprite push() appends: callers set its fields, then call push(). push() takes no
    // numeric arguments because V8's mid tier (Maglev) does not inline it and would box every
    // number passed, i.e. allocate per sprite per frame.
    this.next = { x: 0, y: 0, z: 0, size: 0, rot: 0, uv: null, r: 1, g: 1, b: 1, a: 1 };
  }

  // Appends a copy of this.next (uv: an atlas rect [u, v, du, dv]; r, g, b, a: tint); returns
  // false when the batch is full.
  push() {
    const i = this.count;
    if (i >= this.capacity) return false;
    const s = this.next;
    const { pos, sizeRot, uv, color } = this;
    pos[i * 3] = s.x;
    pos[i * 3 + 1] = s.y;
    pos[i * 3 + 2] = s.z;
    sizeRot[i * 2] = s.size;
    sizeRot[i * 2 + 1] = s.rot;
    const rect = s.uv;
    uv[i * 4] = rect[0];
    uv[i * 4 + 1] = rect[1];
    uv[i * 4 + 2] = rect[2];
    uv[i * 4 + 3] = rect[3];
    color[i * 4] = s.r;
    color[i * 4 + 1] = s.g;
    color[i * 4 + 2] = s.b;
    color[i * 4 + 3] = s.a;
    this.count++;
    return true;
  }

  clear() {
    this.count = 0;
  }

  // Uploads this frame's sprites (whole arrays: they are small, and update ranges would
  // allocate every frame).
  commit() {
    this.geometry.instanceCount = this.count;
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true;
  }
}
