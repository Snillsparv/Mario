// A realistic look the renderer draws an area through (render/N64Renderer.js setLook): Sparrow
// Lane's (world/lane/real/look.js makes it from layout.LANE_REAL). It owns everything that makes
// the picture physically lit instead of baked: the HDR scene target (half float, MSAA per tier)
// and the output pass (exposure, Khronos PBR Neutral, dither: OutputPass.js), the analytic sky
// and its haze (sky.js), the sky's prefiltered environment (scene.environment), the reflection
// probe (probe.js), the sun's soft shadow following Jonas, and the light preset.
//
//   const look = new RealLook({ preset, tier, probeAt, canRetro })
//       preset: { sky, sunDir, exposure, environment, haze, shadow: { radius, bias, normalBias },
//                 atmosphere }   (layout.LANE_REAL: atmosphere is the view.setAtmosphere preset
//                 the look's sun and hemisphere come from)
//       tier: tier.js TIERS[name]; probeAt: the probe's place { x, y, z } (world); canRetro:
//       half-float targets work (else F2 leaves the look as it is)
//   look.pixelRatio(dpr, width, height)   // the drawing buffer's pixel ratio (tier.js)
//   look.haze                       // the uniforms every realistic material's haze shares
//   look.useProbe(materials)        // these take the probe as their envMap (the glass)
//   look.attach(view), look.detach(view)   // N64Renderer.setLook's, around its snapshot
//   look.draw(view, storm, flash, melt, graded)   // one frame (N64Renderer.draw's branch)
//   look.sceneTarget(renderer)      // the HDR target at the drawing buffer's size (null on the
//                                   // direct path)
//   look.describe(width, height) -> 'real 1600x900 msaa4 high'   // the F1 overlay's line
//   look.dispose()
//
// A frame: the shadow map (the sun's box round the view's focus, snapped to whole shadow texels
// so the static shadows never shimmer as Jonas walks), the scene into the HDR target, the output
// pass to the canvas. With the storm's grade, a flash or the meltdown the output pass writes
// into the grade's target and post/GradePass.js finishes the frame as native mode does; with the
// retro filter (F2 in the area: "retro over realistic", the view's lookRetro) the scene is drawn
// at the retro filter's 240 lines, through the output pass into the view's retro target and
// post/N64Pass.js (a real street on a 1998 TV). The low tier draws straight to the canvas
// (`direct`: three tone maps per material; no HDR target, no output pass) unless graded or
// retro. The probe is taken on the first frame after each attach (Jonas hidden); the HDR targets
// are freed on detach and made again on the next frame drawn.

import * as THREE from 'three';
import { OutputPass } from './OutputPass.js';
import { makeSky, skyEnvironment, skyUniforms } from './sky.js';
import { captureProbe } from './probe.js';
import { TIERS, lookPixelRatio } from './tier.js';

const SUN_DISTANCE = 8000; // the shadow camera's distance from the focus, toward the sun
const SHADOW_NEAR = 10;
const SHADOW_FAR = 16000;

export class RealLook {
  constructor({ preset, tier = TIERS.high, probeAt = null, canRetro = true }) {
    this.preset = preset;
    this.tier = tier;
    this.probeAt = probeAt;
    this.canRetro = canRetro; // (retro over realistic needs half-float targets)
    this.haze = { ...skyUniforms(preset.sky, preset.sunDir), uHazeDensity: { value: preset.haze } };
    this.sky = makeSky(this.haze, { clouds: preset.sky.clouds });
    this.output = new OutputPass();
    this.env = null; // the sky's PMREM (made on the first attach, kept)
    this.probe = null; // the reflection probe's PMREM (taken again on every attach)
    this.probeMaterials = [];
    this.probeDirty = true;
    this.hdr = null; // the scene's HDR target (drawing buffer size)
    this.retroHdr = null; // ...at the retro filter's 240 lines
    this.size = new THREE.Vector2();
    // The shadow camera's axes (it looks along -sunDir with up +y), for texel snapping.
    const d = preset.sunDir;
    this.sunDir = new THREE.Vector3(d.x, d.y, d.z).normalize();
    const basis = new THREE.Matrix4().lookAt(this.sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.axisX = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    this.axisY = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    this.snapped = new THREE.Vector3();
  }

  useProbe(materials) {
    for (const m of materials) if (!this.probeMaterials.includes(m)) this.probeMaterials.push(m);
  }

  attach(view) {
    const { renderer, scene, sun } = view;
    const { preset, tier } = this;
    if (!this.env) this.env = skyEnvironment(renderer, this.haze);
    scene.environment = this.env.texture;
    scene.environmentIntensity = preset.environment;
    scene.background = null; // (the sky draws)
    scene.add(this.sky);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.toneMapping = tier.direct ? THREE.NeutralToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = preset.exposure;
    sun.castShadow = true;
    const shadow = sun.shadow;
    shadow.mapSize.set(tier.shadow, tier.shadow);
    shadow.radius = preset.shadow.radius;
    shadow.bias = preset.shadow.bias;
    shadow.normalBias = preset.shadow.normalBias;
    Object.assign(shadow.camera, { left: -tier.box, right: tier.box, top: tier.box, bottom: -tier.box, near: SHADOW_NEAR, far: SHADOW_FAR });
    shadow.camera.updateProjectionMatrix();
    this.probeDirty = true;
  }

  detach(view) {
    view.scene.remove(this.sky);
    this.hdr?.dispose();
    this.retroHdr?.dispose();
    this.hdr = this.retroHdr = null;
  }

  // The pixel ratio a width x height CSS picture is drawn at (the tier's cap).
  pixelRatio(dpr, width, height) {
    return lookPixelRatio(this.tier, dpr, width, height);
  }

  // The scene's HDR target at the drawing buffer's size (on the direct path null, unless
  // `always`: a graded frame there, without MSAA).
  sceneTarget(renderer, always = false) {
    if (this.tier.direct && !always) return null;
    renderer.getDrawingBufferSize(this.size);
    this.hdr = this.fitTarget(this.hdr, this.size.x, this.size.y, this.tier.samples);
    return this.hdr;
  }

  fitTarget(target, width, height, samples) {
    if (target && target.width === width && target.height === height) return target;
    if (target) {
      target.setSize(width, height);
      return target;
    }
    return new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
  }

  // The sun (and its shadow box) over `focus`, snapped to whole shadow texels across the light.
  placeSun(sun, focus) {
    const texel = (2 * this.tier.box) / this.tier.shadow;
    const { axisX, axisY, sunDir, snapped } = this;
    const x = Math.round(focus.dot(axisX) / texel) * texel;
    const y = Math.round(focus.dot(axisY) / texel) * texel;
    snapped.copy(sunDir).multiplyScalar(focus.dot(sunDir)).addScaledVector(axisX, x).addScaledVector(axisY, y);
    sun.target.position.copy(snapped);
    sun.target.updateMatrixWorld();
    sun.position.copy(snapped).addScaledVector(sunDir, SUN_DISTANCE);
  }

  // The reflection probe: the street from probeAt, Jonas hidden, the sun's box round it.
  takeProbe(view) {
    this.probeDirty = false;
    if (!this.probeAt || !this.probeMaterials.length) return;
    const { renderer, scene, sun } = view;
    this.snapped.set(this.probeAt.x, this.probeAt.y, this.probeAt.z);
    this.placeSun(sun, this.snapped);
    const old = this.probe;
    this.probe = captureProbe(renderer, scene, { at: this.probeAt, size: this.tier.probe, hide: view.realActors.map((a) => a.object3D) });
    for (const m of this.probeMaterials) {
      m.envMap = this.probe.texture;
      if (!old) m.needsUpdate = true; // (from the sky's environment to its own: once)
    }
    old?.dispose();
  }

  draw(view, storm, flash, melt, graded) {
    const { renderer, scene, camera, sun } = view;
    if (this.probeDirty) this.takeProbe(view);
    this.placeSun(sun, view.focus);
    const retro = view.lookRetro;
    if (this.tier.direct && !retro && !graded) {
      view.underwater.warm(view.compileObject, 'realDirect');
      view.warmObjects('realDirect');
      renderer.render(scene, camera);
      this.releaseGrade(view);
      return;
    }
    const target = retro ? (this.retroHdr = this.fitTarget(this.retroHdr, view.internal.width, view.internal.height, 4)) : this.sceneTarget(renderer, true);
    renderer.setRenderTarget(target);
    view.underwater.warm(view.compileObject, 'real');
    view.warmObjects('real');
    renderer.render(scene, camera);
    if (retro) {
      renderer.setRenderTarget(view.target);
      this.output.render(renderer, target.texture, { encode: false });
      renderer.setRenderTarget(null);
      view.pass.setGrade(storm, flash);
      view.pass.setMeltdown(melt);
      view.pass.render(renderer, view.target.texture, view.internal.width, view.internal.height);
      return;
    }
    if (graded) {
      const grade = view.gradePass.targetFor(target.width, target.height);
      renderer.setRenderTarget(grade);
      this.output.render(renderer, target.texture, { encode: false });
      renderer.setRenderTarget(null);
      view.gradePass.render(renderer, grade.texture, storm, flash, melt);
      return;
    }
    renderer.setRenderTarget(null);
    this.output.render(renderer, target.texture);
    this.releaseGrade(view);
  }

  // The storm is over: free the grade's full-size target (as native mode does).
  releaseGrade(view) {
    if (view.gradePass.target && view.darkness === 0) view.gradePass.release();
  }

  describe(width, height) {
    const { tier } = this;
    const path = tier.direct ? 'direct' : `msaa${tier.samples}`;
    return `real ${width}x${height} ${path} ${tier.name}`;
  }

  dispose() {
    this.hdr?.dispose();
    this.retroHdr?.dispose();
    this.env?.dispose();
    this.probe?.dispose();
    this.output.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
