// The realistic look's materials (render/real/materials.js, the lane's catalogue): every one ends
// in the haze with the clamp to 32 before it (its patched shader really has it: three's chunks
// it replaces are where it expects them), the glass's premultiplied output, the haze uniforms
// shared by them all and the sky, stable program cache keys, and only a handful of programs for
// the whole lane; the sky and the output pass (Neutral tone mapping, dither) compile their GLSL
// from three's own chunks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as lane from '../src/world/lane/layout.js';
import { laneJobs, laneMaterials } from '../src/world/lane/real/look.js';
import { CLAMP_GLSL, hazeChunk, classicLook } from '../src/render/real/materials.js';
import { RealLook } from '../src/render/real/RealLook.js';
import { TextureStore } from '../src/render/real/textureStore.js';
import { generate } from '../src/render/real/texgen/sets.js';
import { jobKey } from '../src/render/real/texgen/jobs.js';
import { TIERS } from '../src/render/real/tier.js';
import { SKY_GLSL } from '../src/render/real/sky.js';

function lookAndMaterials(tier = TIERS.high) {
  const store = new TextureStore({ worker: { postMessage() {}, terminate() {} } });
  for (const job of laneJobs(tier)) store.sets.set(jobKey(job), generate({ ...job, size: 16 }));
  const look = new RealLook({ preset: lane.LANE_REAL, tier });
  return { look, M: laneMaterials(store, tier, look.haze, { exposure: lane.LANE_REAL.exposure }) };
}

// A material's shaders as three would compile them: its ShaderLib program through its
// onBeforeCompile.
function compiled(material) {
  const lib = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
}

test('every realistic material hazes, with the clamp to 32 before the haze, in place of three\'s fog; the glass\'s output is premultiplied', () => {
  const { look, M } = lookAndMaterials();
  const names = Object.keys(M).filter((n) => n !== 'signs');
  assert.deepEqual(names.sort(), ['asphalt', 'blocks', 'boards', 'brick', 'cloth', 'cobbles', 'glass', 'grass', 'leaves', 'paint', 'path', 'render', 'roof', 'wood']);
  for (const name of names) {
    const m = M[name];
    const s = compiled(m);
    assert.ok(s.fragmentShader.includes(CLAMP_GLSL), `${name}: the clamp`);
    assert.ok(s.fragmentShader.includes('min(gl_FragColor.rgb, vec3(32.0))'));
    assert.ok(!s.fragmentShader.includes('#include <fog_fragment>'), `${name}: the fog chunk replaced`);
    assert.ok(s.fragmentShader.includes('hazeColor(hazeDir / hazeDist)') && s.fragmentShader.includes(SKY_GLSL), `${name}: the sky's haze colour`);
    // The clamp and the haze come after the tone mapping and the colour space, as the fog did.
    const at = (chunk) => s.fragmentShader.indexOf(chunk);
    assert.ok(at('#include <colorspace_fragment>') < at(CLAMP_GLSL), `${name}: after the colour space`);
    assert.ok(s.vertexShader.includes('#include <project_vertex>\n  vec4 hazePosition') && s.vertexShader.includes('vHazeWorld = (modelMatrix * hazePosition).xyz;'), `${name}: the world position after projection`);
    for (const u of ['uSunDir', 'uZenith', 'uHorizonAway', 'uHorizonSun', 'uGround', 'uSkyIntensity', 'uHazeDensity']) assert.equal(s.uniforms[u], look.haze[u], `${name}: ${u} shared`);
    assert.equal(m.fog, false);
  }
  const glass = compiled(M.glass).fragmentShader;
  assert.ok(!glass.includes('#include <opaque_fragment>') && glass.includes('reflectedLight.indirectSpecular, diffuseColor.a);'), 'premultiplied: the reflection at full strength');
  assert.ok(!glass.includes('#include <premultiplied_alpha_fragment>'));
  assert.ok(M.glass.premultipliedAlpha && M.glass.transparent && !M.glass.depthWrite && M.glass.forceSinglePass);
  assert.ok(M.glass.userData.ior === 2.2 && M.glass.roughness === 0.02 && M.glass.metalness === 0);
  // Its F0 from the ior, as three's physical material computes it (double glazing's ~14 %).
  assert.ok(glass.includes('#include <lights_physical_fragment>\n        material.specularColor = vec3(0.14063);'), 'F0 = ((2.2 - 1) / (2.2 + 1))^2');
  assert.ok(THREE.ShaderChunk.lights_physical_fragment.includes('material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );'), 'three still blends F0 so');
  // One uniform for all: the haze thickens everywhere at once.
  look.haze.uHazeDensity.value = 5e-5;
  assert.equal(compiled(M.grass).uniforms.uHazeDensity.value, 5e-5);
  look.dispose();
});

test('stable program cache keys, and the lane\'s realistic materials need at most 20 programs', () => {
  const { M } = lookAndMaterials();
  const programs = new Set();
  for (const [name, m] of Object.entries(M)) {
    const key = m.customProgramCacheKey();
    assert.equal(m.customProgramCacheKey(), key, `${name}: stable`);
    // What three's program key depends on here (the rest is shared by the whole scene).
    programs.add([m.type, key, !!m.map, !!m.normalMap, !!m.roughnessMap, !!m.aoMap, m.vertexColors, m.side, m.transparent, m.premultipliedAlpha].join('|'));
  }
  assert.ok(programs.size <= 20, `${programs.size} programs`);
  // A material patched twice keeps one key per kind.
  const m = hazeChunk(new THREE.MeshStandardMaterial(), {}, 'real-test');
  assert.equal(m.customProgramCacheKey(), 'real-test');
});

test('the sky and the output pass: the sky\'s gradient and haze share the uniforms, sits on the far plane centred on the camera; the output pass tone maps with three\'s Neutral and dithers', () => {
  const look = new RealLook({ preset: lane.LANE_REAL, tier: TIERS.high });
  const sky = look.sky.material;
  assert.ok(sky.fragmentShader.includes('vec3 skyGradient(vec3 v)') && sky.fragmentShader.includes('#include <tonemapping_fragment>'));
  assert.ok(sky.vertexShader.includes('cameraPosition + position') && sky.vertexShader.includes('gl_Position.z = gl_Position.w'));
  assert.equal(sky.uniforms.uSunDir, look.haze.uSunDir);
  assert.equal(sky.depthWrite, false);
  assert.ok(look.sky.frustumCulled === false);
  const out = look.output.material;
  assert.ok(out.fragmentShader.includes('NeutralToneMapping(') && out.fragmentShader.includes('#include <tonemapping_pars_fragment>'));
  assert.ok(out.fragmentShader.includes('bayer('));
  assert.equal(out.toneMapped, false, 'it tone maps itself');
  assert.equal(look.preset.exposure, 1.3);
  look.dispose();
});

test('the signs\' boards through the look as the classic look draws them: their colour turned back through the exposure and Neutral tone mapping (exact below its shoulder); not tone mapped on the direct path', () => {
  const { M } = lookAndMaterials();
  const lib = THREE.ShaderLib.basic;
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  M.signs.onBeforeCompile(shader, null);
  assert.ok(shader.fragmentShader.includes('gl_FragColor.rgb = untoneNeutral(gl_FragColor.rgb);\n#include <tonemapping_fragment>'));
  assert.equal(shader.uniforms.uExposure.value, lane.LANE_REAL.exposure);
  assert.equal(M.signs.customProgramCacheKey(), 'real-classic');
  // The GLSL's arithmetic: three's NeutralToneMapping (r186) after untoneNeutral gives c back.
  const neutral = (c, e) => {
    c = c.map((v) => v * e);
    const x = Math.min(...c);
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c = c.map((v) => v - offset);
    const peak = Math.max(...c);
    if (peak < 0.76) return c;
    throw new Error('over the shoulder');
  };
  const untone = (c, e) => {
    const m = Math.min(...c);
    const x = m < 0.04 ? Math.sqrt(Math.max(m, 0) / 6.25) : m + 0.04;
    const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
    return c.map((v) => (v + off) / e);
  };
  for (const c of [[0.3, 0.13, 0.04], [0.5, 0.4, 0.2], [0.02, 0.01, 0.005], [0.7, 0.6, 0.5], [0.0, 0.2, 0.1]]) {
    const back = neutral(untone(c, 1.3), 1.3);
    c.forEach((v, i) => assert.ok(Math.abs(back[i] - v) < 1e-9, `${c} -> ${back}`));
  }
  const direct = classicLook(new THREE.MeshBasicMaterial(), { exposure: 1.3, direct: true });
  assert.equal(direct.toneMapped, false);
});
