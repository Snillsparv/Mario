// Pip's face for the face screen's big head: the in-game painting (player/model/faceTexture.js,
// the same design, strokes and colours) repainted at ART_SCALE canvas px per design px over the
// front of the head only (CROP, in the painting's 256 x 128 design space; the texture's edges
// are plain skin, so clamping carries the skin round the rest of the head), one texture per
// expression (stretch.js FACE_EXPRESSIONS).
//
// Expressions with open eyes are painted without irises: the head's fragment shader draws them
// (IRIS_GLSL, the same iris, pupil and catch lights as the painting) at a uniform offset, so
// Pip's eyes follow the pointer.

import * as THREE from 'three';
import { FACE_DESIGN, paintFace } from '../../player/model/faceTexture.js';
import { FACE_EXPRESSIONS } from './stretch.js';

// Design-space window painted (x, y, width, height): the face from brow to chin.
export const CROP = Object.freeze({ x: FACE_DESIGN.FRONT - 48, y: 26, w: 96, h: 84 });
export const ART_SCALE = 8; // canvas px per design px (768 x 672)

// The painting's open eye (faceTexture.js eyeOpen), in design px: the white's radii, its
// outline and lash line, the iris's centre offset (toward the nose, a little down), radii and
// gradient, the pupil and the two catch lights.
const EYE = Object.freeze({ rx: 6.4, ry: 10, outline: 1, lash: 2.2 });
const IRIS = Object.freeze({
  dx: -1.2, // times the side (+1: the eye on the viewer's right): toward the nose
  dy: 1.6,
  rx: 4.5,
  ry: 7,
  top: '#2b1709',
  bottom: '#8a5424',
  pupil: '#140a04',
  // How far the look moves the iris (design px at look 1): it stays inside the white.
  lookX: 2.3,
  lookY: 2.9,
});

// Paint the white of an open eye over its iris again: the white, its outline and lash line.
function clearIris(ctx) {
  const { FRONT, EYE_DX, EYE_Y, INK } = FACE_DESIGN;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  for (const s of [-1, 1]) {
    const cx = FRONT + s * EYE_DX;
    ctx.beginPath();
    ctx.ellipse(cx, EYE_Y, EYE.rx, EYE.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = EYE.outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, EYE_Y, EYE.rx, EYE.ry, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.lineWidth = EYE.lash;
    ctx.stroke();
  }
}

// One expression's canvas (a FACE_EXPRESSIONS key).
export function paintExpression(name) {
  const e = FACE_EXPRESSIONS[name] ?? FACE_EXPRESSIONS.open;
  const canvas = document.createElement('canvas');
  canvas.width = CROP.w * ART_SCALE;
  canvas.height = CROP.h * ART_SCALE;
  const ctx = canvas.getContext('2d');
  // paintFace scales by its own SCALE: undo it, then map the crop window onto the canvas.
  const k = ART_SCALE / FACE_DESIGN.SCALE;
  ctx.setTransform(k, 0, 0, k, -CROP.x * ART_SCALE, -CROP.y * ART_SCALE);
  paintFace(ctx, e.base);
  if (e.iris) clearIris(ctx); // (paintFace left the context in design px)
  return canvas;
}

// Every expression's texture, painted up front. get(name) -> THREE.Texture; dispose().
export class FaceArt {
  constructor() {
    this.textures = new Map();
    for (const name of Object.keys(FACE_EXPRESSIONS)) {
      const tex = new THREE.CanvasTexture(paintExpression(name));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter; // zoomed out in the small retro target
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      this.textures.set(name, tex);
    }
  }

  get(name) {
    return this.textures.get(name) ?? this.textures.get('open');
  }

  dispose() {
    for (const t of this.textures.values()) {
      t.image = null;
      t.dispose();
    }
    this.textures.clear();
  }
}

// Map a sphere's equirectangular uv (the in-game head's, u = longitude with the front at
// 0.25, v = 1 at the top) onto the CROP window.
export function cropUv(u, v) {
  const x = u * FACE_DESIGN.W;
  const y = (1 - v) * FACE_DESIGN.H;
  return [(x - CROP.x) / CROP.w, 1 - (y - CROP.y) / CROP.h];
}

const linear = (hex) => new THREE.Color(hex); // three.js stores colours linear

// Uniforms of the drawn irises: uPipIris (look x, y in -1..1, x toward the viewer's right,
// y down; z: 1 = draw them), the crop window and the colours (linear).
export function irisUniforms() {
  return {
    uPipIris: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPipCrop: { value: new THREE.Vector4(CROP.x, CROP.y, CROP.w, CROP.h) },
    uPipIrisTop: { value: linear(IRIS.top) },
    uPipIrisBottom: { value: linear(IRIS.bottom) },
    uPipPupil: { value: linear(IRIS.pupil) },
  };
}

const f = (v) => v.toFixed(3);
const { FRONT, EYE_DX, EYE_Y } = FACE_DESIGN;

// Fragment declarations and the code that runs after the map was applied (diffuseColor).
export const IRIS_PARS_GLSL = /* glsl */ `
uniform vec4 uPipIris;
uniform vec4 uPipCrop;
uniform vec3 uPipIrisTop;
uniform vec3 uPipIrisBottom;
uniform vec3 uPipPupil;
// About the signed distance (design px) of p from an ellipse's outline (negative inside).
float pipEllipse(vec2 p, vec2 c, vec2 r) {
  return (length((p - c) / r) - 1.0) * min(r.x, r.y);
}
float pipInside(float d, float aa) {
  return 1.0 - smoothstep(-aa, aa, d);
}
`;

export const IRIS_GLSL = /* glsl */ `
if (uPipIris.z > 0.5) {
  vec2 dp = uPipCrop.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * uPipCrop.zw; // design px
  float aa = max(fwidth(dp.x), fwidth(dp.y)) * 0.7 + 1e-4;
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? -1.0 : 1.0;
    vec2 eye = vec2(${f(FRONT)} + s * ${f(EYE_DX)}, ${f(EYE_Y)});
    // Inside the white, clear of its outline and the heavier lash line on top.
    float white = pipInside(pipEllipse(dp, eye, vec2(${f(EYE.rx - 0.9)}, ${f(EYE.ry - 1.25)})), aa);
    if (white <= 0.0) continue;
    vec2 ic = eye + vec2(s * ${f(IRIS.dx)}, ${f(IRIS.dy)}) + uPipIris.xy * vec2(${f(IRIS.lookX)}, ${f(IRIS.lookY)});
    float iris = pipInside(pipEllipse(dp, ic, vec2(${f(IRIS.rx)}, ${f(IRIS.ry)})), aa);
    vec3 col = mix(uPipIrisTop, uPipIrisBottom, clamp((dp.y - ic.y + ${f(IRIS.ry)}) / ${f(IRIS.ry * 2)}, 0.0, 1.0));
    col = mix(col, uPipPupil, pipInside(pipEllipse(dp, ic + vec2(0.0, 0.5), vec2(2.3, 3.8)), aa));
    float glint = max(pipInside(length(dp - ic - vec2(1.6, -3.2)) - 1.7, aa), pipInside(length(dp - ic - vec2(-1.4, 3.4)) - 0.8, aa));
    col = mix(col, vec3(1.0), glint);
    diffuseColor.rgb = mix(diffuseColor.rgb, col, iris * white);
  }
}
`;
