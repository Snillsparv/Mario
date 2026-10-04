// The realistic look's post chain and grade (render/real/post/*, render/real/OutputPass.js): which
// passes each tier's levels run (high: the occlusion at 12 taps, bloom over 5 levels, the sun
// shafts and the colour fringing; mid: 8 taps and 4 levels; low: none, the direct path) and the
// ladder's post steps in order; the grade's constants in their sane ranges (layout.LANE_REAL);
// the output pass's composite in the right order (the occlusion on the HDR colour before the
// tone mapping, never on the sky, fading on bright pixels; the bloom mixed in and the shafts
// added; the
// grade after the tone mapping, the lens last); each pass's GLSL declaring only uniforms it is
// given; and the uniform names unique across the sky's GLSL, the haze, the sun's shadow patch and
// each realistic material's own patch (a clash, as the GTA prototype's `uGround` had with the
// sky's, breaks every realistic program).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as lane from '../src/world/lane/layout.js';
import { laneJobs, laneMaterials, detailMaterials, wearUniforms } from '../src/world/lane/real/look.js';
import { RealLook } from '../src/render/real/RealLook.js';
import { RealPost } from '../src/render/real/post/RealPost.js';
import { TextureStore } from '../src/render/real/textureStore.js';
import { generate } from '../src/render/real/texgen/sets.js';
import { jobKey } from '../src/render/real/texgen/jobs.js';
import { TIERS, ladder } from '../src/render/real/tier.js';
import { SKY_GLSL } from '../src/render/real/sky.js';

const BOX = { x0: -9000, x1: 8000, y0: -100, y1: 3000, z0: -4000, z1: 3600 };

function lookAndMaterials(tier = TIERS.high) {
  const store = new TextureStore({ worker: { postMessage() {}, terminate() {} } });
  for (const job of laneJobs(tier)) store.sets.set(jobKey(job), generate({ ...job, size: 16 }));
  const look = new RealLook({ preset: lane.LANE_REAL, tier, farBox: BOX });
  // (The weathering's ground map, a stand-in; the houses' walls worn by their attribute.)
  Object.assign(look.haze, wearUniforms({ data: new Uint8Array(16), width: 2, height: 2, x0: -9200, x1: 8200, z0: -4200, z1: 3800 }, { x: 0, y: 0, z: 30000 }));
  const wind = { value: new THREE.Vector4(1, 0, 0, 0) };
  return { look, M: laneMaterials(store, tier, look.haze, { exposure: lane.LANE_REAL.exposure, grade: look.grade }), D: detailMaterials(store, tier, look.haze, { wind, worn: new Set(['boards', 'brick', 'render']) }) };
}

function compiled(material, lib = THREE.ShaderLib.standard) {
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
}

// The uniforms a GLSL source declares itself (not in its #includes): [name, ...].
const declared = (glsl) => [...glsl.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)].flatMap((m) => m[1].split(',').map((n) => n.trim().replace(/\[.*$/, '')));

test('the tiers\' post chains: high the occlusion at 12 taps, bloom over 5 levels, the sun shafts and the colour fringing; mid 8 taps and 4 levels; low none (the direct path: no chain at all); the ladder steps the chain down first', () => {
  const runs = (post) => [post.ao, post.bloom, post.shafts, post.ca];
  assert.deepEqual(runs(TIERS.high.post), [12, 5, true, true]);
  assert.deepEqual(runs(TIERS.mid.post), [8, 4, false, false]);
  assert.deepEqual(runs(TIERS.low.post), [0, 0, false, false]);
  for (const name of ['high', 'mid', 'low']) {
    const look = new RealLook({ preset: lane.LANE_REAL, tier: TIERS[name], farBox: BOX });
    assert.equal(!!look.post, name !== 'low', `${name}: ${look.post ? 'a' : 'no'} post chain`);
    assert.equal(!!look.far, name !== 'low', `${name}: ${look.far ? 'a' : 'no'} far shadow map`);
    if (look.far) assert.equal(look.far.light.shadow.mapSize.x, TIERS[name].far);
    look.dispose();
  }
  assert.deepEqual(ladder(TIERS.high).slice(0, 5).map((l) => l.name), ['high', 'high -shafts', 'high ao8', 'high bloom4', 'high -ao']);
  assert.deepEqual(ladder(TIERS.mid).slice(0, 2).map((l) => l.name), ['mid', 'mid -ao']);
});

test('the grade\'s constants in range: subtle lens touches (the dad: subtle), a filmic contrast and split toning short of turning the Falu red brown, the occlusion fading on bright pixels', () => {
  const g = lane.LANE_REAL.grade;
  const inRange = (k, lo, hi) => assert.ok(g[k] >= lo && g[k] <= hi, `${k} ${g[k]} in [${lo}, ${hi}]`);
  inRange('contrast', 0.1, 0.35);
  inRange('split', 0, 0.45);
  inRange('saturation', 1, 1.15);
  inRange('vignette', 0, 0.4);
  inRange('ca', 0, 0.002);
  inRange('grain', 0, 0.02);
  inRange('bloom', 0.02, 0.1);
  inRange('shafts', 0, 1);
  inRange('ao', 0.5, 1);
  inRange('aoLit', 0.1, 0.6);
  inRange('black', 0, 0.03);
  for (const k of ['shadowTint', 'highTint', 'shaftTint']) for (const c of g[k]) assert.ok(c > 0.5 && c <= 1.1, `${k} ${g[k]}`);
  assert.ok(g.shadowTint[2] > g.shadowTint[0] && g.highTint[0] > g.highTint[2], 'cool shadows, warm highlights');
  const p = lane.LANE_REAL.post;
  assert.ok(p.ao.radius > 50 && p.ao.radius < 200 && p.ao.bias > 0 && p.ao.intensity > 0, 'the occlusion\'s reach ~0.7 m');
  assert.ok(p.bloom.threshold >= 1 && p.bloom.knee > 0, 'only what is brighter than white blooms');
  assert.ok(p.shafts.decay < 1 && p.shafts.density <= 1);
  assert.ok(lane.LANE_REAL.haze > 2.2e-5 && lane.LANE_REAL.haze < 5e-5, 'the haze a little deeper than R3\'s');
});

test('the output pass: the occlusion on the HDR colour before the tone mapping (never on the sky, fading on bright pixels), the bloom mixed in and the shafts added, the grade after the tone mapping, the lens and the dither last; its uniforms from the look\'s grade', () => {
  const look = new RealLook({ preset: lane.LANE_REAL, tier: TIERS.high, farBox: BOX });
  const out = look.output.material;
  const fs = out.fragmentShader;
  const at = (s) => {
    const i = fs.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  assert.ok(at('if (depth < 0.99999)') < at('aoAt(uv, linZ(depth))'), 'never on the sky');
  assert.ok(fs.includes('uAOLit * smoothstep(0.6, 2.5, l)'), 'fading on bright pixels');
  assert.ok(at('aoAt(uv, linZ(depth))') < at('c = mix(c, texture2D(tBloom, uv).rgb, uBloom)') && at('c = mix(c, texture2D(tBloom, uv).rgb, uBloom)') < at('c += texture2D(tShafts, uv).rgb'));
  assert.ok(at('c += texture2D(tShafts, uv).rgb') < at('c = grade(NeutralToneMapping(c), d)'));
  assert.ok(at('c = grade(NeutralToneMapping(c), d)') < at('uGrain') + 1e6 && at('c = grade(NeutralToneMapping(c), d)') < at('sRGBTransferOETF') && at('sRGBTransferOETF') < at('bayer(p) / 255.0'));
  const g = lane.LANE_REAL.grade;
  const u = out.uniforms;
  assert.equal(u.uContrast.value, g.contrast);
  assert.equal(u.uSplit.value, g.split);
  assert.equal(u.uSaturation.value, g.saturation);
  assert.equal(u.uVignette.value, g.vignette);
  assert.deepEqual(u.uShadowTint.value.toArray(), g.shadowTint);
  assert.equal(u.uGrain.value, g.grain);
  assert.equal(look.grade.uContrast, u.uContrast, 'the signs share the grade\'s uniforms');
  // Every pass declares only uniforms it is given.
  const post = new RealPost(lane.LANE_REAL.post);
  for (const m of [out, ...post.materials()]) {
    for (const name of declared(m.fragmentShader)) assert.ok(name in m.uniforms, `${name} given`);
  }
  const defines = post.ssao.materials().map((m) => m.defines.SAMPLES ?? `blur ${m.defines.BLUR}`);
  assert.deepEqual(defines.sort(), [12, 8, 'blur 2', 'blur 4'], 'two programs each: 12 or 8 taps, 9 or 5 blurred');
  post.dispose();
  look.dispose();
});

test('uniform names unique in every realistic material\'s shaders: the sky\'s GLSL, the haze, the sun\'s near and far shadow patch, the weathering and the material\'s own patch never declare one twice', () => {
  const { look, M, D } = lookAndMaterials();
  const all = { ...M, ...Object.fromEntries(Object.entries(D).map(([k, m]) => [`detail ${k}`, m])) };
  let checked = 0;
  for (const [name, m] of Object.entries(all)) {
    if (name === 'detail shadow' || name === 'detail contact') continue;
    const s = compiled(m, name === 'signs' ? THREE.ShaderLib.basic : THREE.ShaderLib.standard);
    for (const [stage, glsl] of [['vertex', s.vertexShader], ['fragment', s.fragmentShader]]) {
      const names = declared(glsl);
      const twice = names.filter((n, i) => names.indexOf(n) !== i);
      assert.deepEqual(twice, [], `${name} (${stage}): declared twice: ${twice}`);
      for (const n of names.filter((n) => /^u[A-Z]/.test(n))) assert.ok(n in s.uniforms, `${name} (${stage}): ${n} has a value`);
    }
    if (name !== 'signs') {
      assert.ok(s.fragmentShader.includes('realSunShadow( getShadow( directionalShadowMap[ i ]'), `${name}: the far shadow where the near one ends`);
      assert.ok(s.vertexShader.includes('vFarShadowCoord = uFarMatrix *'), `${name}: the far shadow's coordinate`);
      assert.equal(s.uniforms.uFarShadow, look.haze.uFarShadow, `${name}: the look's far map`);
      assert.match(m.customProgramCacheKey(), /-far$/, `${name}: its own program key`);
    }
    checked++;
  }
  assert.ok(checked > 30, `${checked} materials`);
  // The sky's own GLSL declares its uniforms once, none of them a patch's.
  const sky = declared(SKY_GLSL);
  assert.equal(new Set(sky).size, sky.length);
  for (const n of ['uFarShadow', 'uFarMatrix', 'uFarShadowParams', 'uHazeDensity', 'uExposure']) assert.ok(!sky.includes(n), n);
  look.dispose();
});
