// The realistic look's sky (render/real/RealLook.js): an art-directed analytic gradient for a
// golden hour, not a physical model. A blue dome paling toward the horizon all round, the warm
// band hugging the horizon only in the sun's quarter (mixed into the blue above it, peach turns
// it grey-purple), a white-gold glow round the sun (three lobes) and its disc, warm-lit cirrus
// wisps. Linear HDR out (the output pass tone maps; on the direct path the renderer does).
//
//   SKY_GLSL                     // skyGradient(dir) and hazeColor(dir), on the sky uniforms:
//                                // every realistic material's haze (materials.js) uses the same
//                                // colour, so distant houses melt into the sky behind them
//   skyUniforms(sky, sunDir) -> uniforms   // sky: { zenith, horizonAway, horizonSun, ground
//                                // ([r, g, b] linear), intensity, clouds }; shared by the sky,
//                                // its environment capture and the materials' haze
//   makeSky(uniforms, { clouds, horizonFill, radius, tint }) -> THREE.Mesh 'realSky'   (its
//                                // uDrift: how far the cirrus has drifted, set as time goes)
//                                // the dome, centred on the camera in its vertex shader (no
//                                // per-frame work), on the far plane; horizonFill 1: below the
//                                // horizon the visible dome shows the horizon's haze (the
//                                // lane's ground ends short of it), 0: a dark ground (the
//                                // environment capture, for lighting)
//   skyEnvironment(renderer, uniforms, { clouds, tint }) -> THREE.WebGLRenderTarget   // the sky
//                                // prefiltered (PMREM) for scene.environment: diffuse and rough
//                                // reflections; tint: its light's colour beside the sky's
//                                // (LANE_REAL.sky.envTint: less blue in the shade, as a
//                                // camera's white balance leaves it)

import * as THREE from 'three';

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizonAway;
uniform vec3 uHorizonSun;
uniform vec3 uGround;
uniform float uSkyIntensity;

vec3 skyGradient(vec3 v) {
  float y = max(v.y, 0.0);
  float mu = dot(v, uSunDir);
  float az = clamp(dot(normalize(vec2(v.x, v.z) + 1e-5), normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uZenith, uHorizonAway, pow(1.0 - y, 2.6));
  c = mix(c, uHorizonSun, pow(1.0 - y, 10.0) * pow(az, 4.0) * 0.85);
  float m = max(mu, 0.0);
  return c + vec3(1.0, 0.86, 0.62) * (0.10 * pow(m, 6.0) + 0.35 * pow(m, 40.0) + 1.2 * pow(m, 400.0));
}

vec3 hazeColor(vec3 v) {
  return skyGradient(normalize(vec3(v.x, max(v.y, 0.02), v.z))) * uSkyIntensity;
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
  gl_Position.z = gl_Position.w; // on the far plane
}
`;

const SKY_FRAG = /* glsl */ `
${SKY_GLSL}
uniform float uClouds;
uniform float uHorizonFill;
uniform vec2 uDrift;
uniform vec3 uTint;
varying vec3 vDir;

float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), f.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float skyFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * skyNoise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 v = normalize(vDir);
  vec3 c = skyGradient(v);
  float mu = dot(v, uSunDir);
  // Cirrus on a high plane, stretched along the wind, lit warm toward the sun.
  if (v.y > 0.0 && uClouds > 0.0) {
    vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * (v.xz / (v.y + 0.12) * 1.1 - uDrift);
    q.y *= 4.0;
    float w = smoothstep(0.55, 0.85, skyFbm(q * 1.3)) * smoothstep(0.0, 0.25, v.y) * uClouds;
    float sunSide = pow(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 2.0);
    vec3 cloud = mix(vec3(0.82, 0.86, 0.92), vec3(1.6, 1.08, 0.72), sunSide) * (0.9 + 0.6 * pow(max(mu, 0.0), 8.0));
    c = mix(c, cloud, w * 0.75);
  }
  // The sun's disc (a little larger than the real one, so it reads), soft-edged.
  c += vec3(40.0, 30.0, 18.0) * smoothstep(0.99975, 0.99992, mu);
  // Under the horizon: the horizon's haze (the visible dome) or the dark ground (the capture).
  c = mix(c, mix(uGround, skyGradient(normalize(vec3(v.x, 0.0, v.z))), uHorizonFill), smoothstep(0.0, -0.04, v.y));
  gl_FragColor = vec4(c * uSkyIntensity * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function skyUniforms(sky, sunDir) {
  const v3 = (c) => new THREE.Vector3(c[0], c[1], c[2]);
  return {
    uSunDir: { value: new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize() },
    uZenith: { value: v3(sky.zenith) },
    uHorizonAway: { value: v3(sky.horizonAway) },
    uHorizonSun: { value: v3(sky.horizonSun) },
    uGround: { value: v3(sky.ground) },
    uSkyIntensity: { value: sky.intensity },
  };
}

export function makeSky(uniforms, { clouds = 0.55, horizonFill = 1, radius = 30000, tint = [1, 1, 1] } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uClouds: { value: clouds }, uHorizonFill: { value: horizonFill }, uDrift: { value: new THREE.Vector2() }, uTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.name = 'realSky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // after the opaque world (only the open sky's pixels are left to fill)
  return mesh;
}

// The sky's environment: the dome with fewer clouds over a dark ground, prefiltered once; tint:
// the light's colour beside the sky's (the sky.envTint: a camera's white balance for the shade).
export function skyEnvironment(renderer, uniforms, { clouds = 0.4, tint = [1, 1, 1] } = {}) {
  const scene = new THREE.Scene();
  const dome = makeSky(uniforms, { clouds, horizonFill: 0, radius: 100, tint });
  scene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 1, 1000);
  pmrem.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  return target;
}
