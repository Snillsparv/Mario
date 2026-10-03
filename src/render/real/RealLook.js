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
//   look.warmProbe(renderer)        // a blank probe of its size on them meanwhile (RealAreas:
//                                   // before their programs compile)
//   look.takeProbe(view)            // the probe, taken (else on the first frame drawn)
//   look.attach(view), look.detach(view)   // N64Renderer.setLook's, around its snapshot
//   look.draw(view, storm, flash, melt, graded)   // one frame (N64Renderer.draw's branch)
//   look.sceneTarget(renderer)      // the HDR target at the drawing buffer's size (null on the
//                                   // direct path)
//   look.describe(width, height) -> 'real 1600x900 msaa4 high'   // the F1 overlay's line (the
//                                   // level drawn, 'mid 85%'..., and 'auto' while governed)
//   look.levels, look.level         // tier.js ladder(tier) and the level drawn (its render
//                                   // size, MSAA, shadow, grass: setLevel(index, view))
//   look.governor                   // a tier.js Governor, or null (RealAreas sets one but under
//                                   // ?test=1 and with ?tier=): look.govern(view, now) per frame
//                                   // steps the level, cross-fading (view.crossfade), and keeps
//                                   // it for the next visit; below the ladder look.onSlow()
//   look.grass                      // (r) => the grass's reach (world/lane/real/look.js sets it)
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
// retro. The probe is taken once (RealAreas takes it as it readies the build, else the first
// frame drawn does; Jonas hidden; none on the low tier, whose glass reflects the sky's
// environment) and kept for every later visit; the HDR targets are freed on detach and made
// again on the next frame drawn.

import * as THREE from 'three';
import { OutputPass } from './OutputPass.js';
import { makeSky, skyEnvironment, skyUniforms } from './sky.js';
import { captureProbe, blankProbe } from './probe.js';
import { TIERS, lookPixelRatio, ladder, saveLevel } from './tier.js';

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
    this.probe = null; // the reflection probe's PMREM (a blank stand-in till taken: warmProbe)
    this.probeMaterials = [];
    this.probeTaken = false;
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
    this.levels = ladder(tier);
    this.index = 0;
    this.level = this.levels[0];
    this.governor = null;
    this.grass = null;
    this.onSlow = null;
    this.last = 0; // the last frame's time (govern)
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
    shadow.radius = preset.shadow.radius;
    shadow.bias = preset.shadow.bias;
    shadow.normalBias = preset.shadow.normalBias;
    shadow.camera.near = SHADOW_NEAR;
    shadow.camera.far = SHADOW_FAR;
    this.fitShadow(sun);
    this.probeDirty = !this.probeTaken; // (taken once: the street does not change)
    this.last = 0;
  }

  // The level's shadow map and box.
  fitShadow(sun) {
    const { shadow: size, box } = this.level;
    const shadow = sun.shadow;
    if (shadow.mapSize.x !== size) {
      shadow.map?.dispose();
      shadow.map = null;
      shadow.mapSize.set(size, size);
    }
    Object.assign(shadow.camera, { left: -box, right: box, top: box, bottom: -box });
    shadow.camera.updateProjectionMatrix();
  }

  // Draws at levels[index] from now (view: the renderer it is set on, if any).
  setLevel(index, view = null) {
    this.index = index;
    this.level = this.levels[index];
    if (this.hdr && this.hdr.samples !== this.level.samples) {
      this.hdr.dispose();
      this.hdr = null;
    }
    this.grass?.(this.level.grass);
    if (view?.look === this) {
      this.fitShadow(view.sun);
      view.refit();
    }
  }

  // Per frame drawn (N64Renderer.render): the governor's verdict on the time since the last.
  govern(view, now) {
    const ms = now - this.last;
    const first = this.last === 0;
    this.last = now;
    if (!this.governor || first) return;
    const index = this.governor.frame(ms);
    if (index === null) return;
    if (index >= this.levels.length) {
      this.onSlow?.();
      return;
    }
    view.crossfade(0.3);
    this.setLevel(index, view);
    saveLevel(this.tier, index);
  }

  detach(view) {
    view.scene.remove(this.sky);
    this.hdr?.dispose();
    this.retroHdr?.dispose();
    this.hdr = this.retroHdr = null;
  }

  // The pixel ratio a width x height CSS picture is drawn at (the tier's cap).
  pixelRatio(dpr, width, height) {
    return lookPixelRatio(this.level, dpr, width, height) * this.level.scale;
  }

  // The scene's HDR target at the drawing buffer's size (on the direct path null, unless
  // `always`: a graded frame there, without MSAA).
  sceneTarget(renderer, always = false) {
    if (this.tier.direct && !always) return null;
    renderer.getDrawingBufferSize(this.size);
    this.hdr = this.fitTarget(this.hdr, this.size.x, this.size.y, this.level.samples);
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
    const texel = (2 * this.level.box) / this.level.shadow;
    const { axisX, axisY, sunDir, snapped } = this;
    const x = Math.round(focus.dot(axisX) / texel) * texel;
    const y = Math.round(focus.dot(axisY) / texel) * texel;
    snapped.copy(sunDir).multiplyScalar(focus.dot(sunDir)).addScaledVector(axisX, x).addScaledVector(axisY, y);
    sun.target.position.copy(snapped);
    sun.target.updateMatrixWorld();
    sun.position.copy(snapped).addScaledVector(sunDir, SUN_DISTANCE);
  }

  // A blank probe of the real one's size on the probe's materials (their programs then compile
  // as they will draw, and the prefilter's are made), until takeProbe.
  warmProbe(renderer) {
    if (this.probe || !this.probeMaterials.length || !this.tier.probe) return;
    this.probe = blankProbe(renderer, this.tier.probe);
    for (const m of this.probeMaterials) {
      m.envMap = this.probe.texture;
      m.needsUpdate = true;
    }
  }

  // The reflection probe: the street from probeAt, Jonas hidden, the sun's box round it.
  takeProbe(view) {
    this.probeDirty = false;
    this.probeTaken = true;
    if (!this.probeAt || !this.probeMaterials.length || !this.tier.probe) return;
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
    const path = this.tier.direct ? 'direct' : `msaa${this.level.samples}`;
    return `real ${width}x${height} ${path} ${this.level.name}${this.governor ? ' auto' : ''}`;
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
