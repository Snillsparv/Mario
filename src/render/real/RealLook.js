// A realistic look the renderer draws an area through (render/N64Renderer.js setLook): Sparrow
// Lane's (world/lane/real/look.js makes it from layout.LANE_REAL). It owns everything that makes
// the picture physically lit instead of baked: the HDR scene target (half float, MSAA per tier,
// with a depth texture for the post chain), the post chain (ambient occlusion, bloom, sun shafts:
// post/RealPost.js) and the output pass (their composite, exposure, Khronos PBR Neutral, the
// grade, the lens, dither: OutputPass.js), the analytic sky and its haze (sky.js), the sky's
// prefiltered environment (scene.environment), the reflection probe (probe.js), the sun's soft
// shadow near Jonas and its far map over the whole street (farShadow.js), and the light preset;
// and how Jonas is framed and drawn meanwhile (the camera's profile, his model's size).
//
//   const look = new RealLook({ preset, tier, probeAt, farBox, canRetro })
//       preset: { sky, sunDir, exposure, environment, haze, shadow: { radius, bias, normalBias },
//                 atmosphere, post, grade, camera, hero }   (layout.LANE_REAL: atmosphere is the
//                 view.setAtmosphere preset the look's sun and hemisphere come from; post and
//                 grade the post chain's and the output pass's settings; camera the camera's
//                 profile, hero Jonas's model's size)
//       tier: tier.js TIERS[name]; probeAt: the probe's place { x, y, z } (world); farBox: the
//       far shadow map's box { x0, x1, y0, y1, z0, z1 } (world; none: no far map, as on the low
//       tier); canRetro: half-float targets work (else F2 leaves the look as it is)
//   look.camera, look.heroScale     // the camera's profile (core/AreaSwitch.js sets it with the
//                                   // look) and Jonas's model's size (view.heroScale) meanwhile
//   look.grade                      // the output pass's grade uniforms (its bloom's share too,
//                                   // and uGradeScreen: the picture's size), for materials.js
//                                   // classicLook (the signs)
//   look.pixelRatio(dpr, width, height)   // the drawing buffer's pixel ratio (tier.js)
//   look.haze                       // the uniforms every realistic material's haze shares
//   look.addProbe(name, at, size)   // another reflection probe (world/lane/real/look.js: each
//                                   // cluster of parked cars', the villas' windows'), at { x, y,
//                                   // z } (world), its cube `size` px (0: none, the materials keep
//                                   // the sky's environment)
//   look.useProbe(materials, name?) // these take a probe as their envMap (the street's: the
//                                   // windows; or the one named)
//   look.probeNames()               // the probes to take (those with materials), the cars' first
//   look.warmProbe(renderer)        // a blank probe of each one's size on its materials
//                                   // meanwhile (RealAreas: before their programs compile)
//   look.takeProbe(view, name?)     // a probe (or every one not yet), taken (RealAreas, a task
//                                   // each; else on the first frame drawn): without the actors
//                                   // and look.probeSkip (the grass's blades), its shadows the
//                                   // far map's once that is taken (the near box put far away)
//   look.probeAt, look.probeMaterials   // the street's probe's place and materials
//   look.takeFar(view)              // the far shadow map, drawn (RealAreas, before the
//                                   // probes; else on the first frame drawn: Jonas hidden)
//   look.compilePost(renderer) -> Promise   // the post chain's and the output pass's programs
//                                   // (RealAreas' link step)
//   look.attach(view), look.detach(view)   // N64Renderer.setLook's, around its snapshot
//   look.draw(view, storm, flash, melt, graded)   // one frame (N64Renderer.draw's branch)
//   look.sceneTarget(renderer)      // the HDR target at the drawing buffer's size (null on the
//                                   // direct path)
//   look.describe(width, height) -> 'real 1600x900 msaa4 high'   // the F1 overlay's line (the
//                                   // level drawn, 'mid 85%'..., and 'auto' while governed)
//   look.gpuLine() -> 'gpu 8.4 ms' | null   // the F1 overlay's GPU line while it shows (high,
//                                   // mid: gpuTimer.js)
//   look.levels, look.level         // tier.js ladder(tier) and the level drawn (its render
//                                   // size, MSAA, near shadow, grass, post chain: setLevel(index,
//                                   // view))
//   look.post                       // the post chain (null on the direct path): post.drawn, the
//                                   // passes it drew last frame
//   look.governor                   // a tier.js Governor, or null (RealAreas sets one but under
//                                   // ?test=1 and with ?tier=): look.govern(view, now) per frame
//                                   // steps the level, cross-fading (view.crossfade), and keeps
//                                   // it for the next visit; below the ladder look.onSlow()
//   look.grass                      // (r) => the grass's reach (world/lane/real/look.js sets it)
//   look.dispose()
//
// A frame: the near shadow map (the sun's tight box round the view's focus, a little ahead of it
// along the view, snapped to whole shadow texels so the static shadows never shimmer as Jonas
// walks; the far map, static, beyond it), the scene into the HDR target (its depth resolved with
// it), the post chain from them at the level's settings, the output pass to the canvas (the depth
// resolve is checked once: where a driver refuses it, the occlusion and the shafts stay off and
// the F1 line says 'post: no depth'). With the storm's grade, a flash or the meltdown the output
// pass writes into the grade's target and post/GradePass.js finishes the frame as native mode
// does; with the
// retro filter (F2 in the area: "retro over realistic", the view's lookRetro) the scene is drawn
// at the retro filter's 240 lines, through the output pass into the view's retro target and
// post/N64Pass.js (a real street on a 1998 TV). The low tier draws straight to the canvas
// (`direct`: three tone maps per material; no HDR target, no output pass) unless graded or
// retro. The probe is taken once (RealAreas takes it as it readies the build, else the first
// frame drawn does; Jonas hidden; none on the low tier, whose glass reflects the sky's
// environment) and kept for every later visit, as is the far shadow map; the HDR targets and the
// post chain's are freed on detach and made again on the next frame drawn.

import * as THREE from 'three';
import { OutputPass } from './OutputPass.js';
import { RealPost } from './post/RealPost.js';
import { FarShadow } from './farShadow.js';
import { GpuTimer } from './gpuTimer.js';
import { makeSky, skyEnvironment, skyUniforms } from './sky.js';
import { captureProbe, blankProbe } from './probe.js';
import { TIERS, lookPixelRatio, ladder, saveLevel } from './tier.js';

const SUN_DISTANCE = 8000; // the shadow camera's distance from the focus, toward the sun
const SHADOW_NEAR = 10;
const SHADOW_FAR = 16000;
const AHEAD = 0.35; // the near shadow box's middle this share of its half size ahead of the focus
const AWAY = 1e5; // a probe's near shadow box this far off the street (its shadows the far map's)

export class RealLook {
  constructor({ preset, tier = TIERS.high, probeAt = null, farBox = null, canRetro = true }) {
    this.preset = preset;
    this.tier = tier;
    this.canRetro = canRetro; // (retro over realistic needs half-float targets)
    this.camera = preset.camera ?? null; // the camera's profile meanwhile (core/AreaSwitch.js)
    this.heroScale = preset.hero ?? 1; // Jonas's model's size meanwhile (view.heroScale)
    this.haze = { ...skyUniforms(preset.sky, preset.sunDir), uHazeDensity: { value: preset.haze } };
    this.far = farBox && tier.far ? new FarShadow({ size: tier.far, sunDir: preset.sunDir, box: farBox }) : null;
    if (this.far) Object.assign(this.haze, this.far.uniforms); // (every realistic material's)
    this.farDirty = !!this.far;
    this.sky = makeSky(this.haze, { clouds: preset.sky.clouds });
    this.output = new OutputPass({ grade: preset.grade });
    this.grade = { ...this.output.grade, uBloom: this.output.material.uniforms.uBloom, uGradeScreen: { value: new THREE.Vector2(1, 1) } };
    this.post = tier.direct ? null : new RealPost(preset.post);
    this.depthChecked = false; // (the depth's resolve, checked on the first frame with it)
    this.env = null; // the sky's PMREM (made on the first attach, kept)
    // The reflection probes: name -> { at, size, materials, target (its PMREM: a blank stand-in
    // till taken, warmProbe), taken }; the street's (the windows') first.
    this.probes = new Map();
    if (probeAt) this.addProbe('street', probeAt, tier.probe);
    this.probeTaken = false;
    this.probeDirty = true;
    this.probeSkip = []; // objects a probe leaves out (the grass's blades: finer than its texels)
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
    this.ahead = new THREE.Vector3();
    this.levels = ladder(tier);
    this.index = 0;
    this.level = this.levels[0];
    this.governor = null;
    this.grass = null;
    this.onSlow = null;
    this.last = 0; // the last frame's time (govern)
  }

  addProbe(name, at, size) {
    this.probes.set(name, { name, at, size, materials: [], target: null, taken: false });
  }

  useProbe(materials, name = 'street') {
    const probe = this.probes.get(name);
    if (!probe) return;
    for (const m of materials) if (!probe.materials.includes(m)) probe.materials.push(m);
  }

  get probeMaterials() {
    return this.probes.get('street')?.materials ?? [];
  }

  // The probes to take, the cars' first (the windows' then see the cars' lacquer reflecting
  // theirs).
  probeNames() {
    const names = [...this.probes.values()].filter((p) => p.materials.length && p.size > 0).map((p) => p.name);
    return [...names.filter((n) => n.startsWith('car')), ...names.filter((n) => !n.startsWith('car'))];
  }

  attach(view) {
    const { renderer, scene, sun } = view;
    const { preset, tier } = this;
    if (!this.env) this.env = skyEnvironment(renderer, this.haze, { tint: preset.sky.envTint });
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
    this.gpu?.reset(); // (the GPU's times are the new level's from now)
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
    const index = this.governor.frame(ms, this.gpu?.ms ?? null);
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
    this.post?.release();
  }

  // The level's post chain reads the scene's depth (the occlusion, the shafts).
  wantsDepth() {
    const post = this.level.post;
    return !!this.post && this.post.depthOk && (post.ao > 0 || post.shafts);
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

  // (Linear filtering: the output pass's colour fringing reads between texels; a depth texture
  // where the post chain reads it: made again when that changes.)
  fitTarget(target, width, height, samples) {
    if (target && !!target.depthTexture !== this.wantsDepth()) {
      target.dispose();
      target = null;
    }
    if (target && target.width === width && target.height === height) return target;
    if (target) {
      target.setSize(width, height);
      return target;
    }
    const made = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    if (this.wantsDepth()) made.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    return made;
  }

  // The sun (and its near shadow box) over `focus`, snapped to whole shadow texels across the
  // light.
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

  get probeAt() {
    return this.probes.get('street')?.at ?? null;
  }

  // A blank probe of each real one's size on its materials (their programs then compile as they
  // will draw, and the prefilter's are made), until takeProbe.
  warmProbe(renderer) {
    for (const p of this.probes.values()) {
      if (p.target || !p.materials.length || !p.size) continue;
      p.target = blankProbe(renderer, p.size);
      for (const m of p.materials) {
        m.envMap = p.target.texture;
        m.needsUpdate = true;
      }
    }
  }

  // A reflection probe (or every one not yet taken): the street from its place, Jonas hidden,
  // the sun's box round it.
  takeProbe(view, name = null) {
    const names = name ? [name] : this.probeNames().filter((n) => !this.probes.get(n).taken);
    for (const n of names) this.captureOne(view, this.probes.get(n));
    this.probeDirty = [...this.probes.values()].some((p) => !p.taken && p.materials.length && p.size > 0);
    this.probeTaken = !this.probeDirty;
  }

  captureOne(view, p) {
    p.taken = true;
    if (!p.materials.length || !p.size) return;
    const { renderer, scene, sun } = view;
    // With the far map taken, the sun's near box is put far off the street (its map drawn empty:
    // the probe's shadows all the far map's), else round the probe.
    this.snapped.set(p.at.x + (this.far?.taken ? AWAY : 0), p.at.y, p.at.z);
    this.placeSun(sun, this.snapped);
    const old = p.target;
    p.target = captureProbe(renderer, scene, { at: p.at, size: p.size, hide: [...view.realActors.map((a) => a.object3D), ...this.probeSkip] });
    for (const m of p.materials) {
      m.envMap = p.target.texture;
      if (!old) m.needsUpdate = true; // (from the sky's environment to its own: once)
    }
    old?.dispose();
  }

  // The far shadow map, from what the scene shows (RealAreas: the build alone), Jonas hidden.
  takeFar(view) {
    this.farDirty = false;
    if (!this.far) return;
    const hide = view.realActors.map((a) => a.object3D);
    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    try {
      this.far.take(view.renderer, view.scene, view.camera);
    } finally {
      hide.forEach((o, i) => (o.visible = shown[i]));
    }
  }

  // The post chain's and the output pass's programs, compiled as they will draw.
  compilePost(renderer) {
    const done = [this.post?.compile(renderer)];
    if (!this.tier.direct) done.push(renderer.compileAsync(this.output.scene, this.output.camera));
    return Promise.all(done);
  }

  // The near shadow box's focus: the view's, a little ahead of it along the camera's view (what
  // he looks at), across the ground.
  shadowFocus(view) {
    const a = this.ahead;
    view.camera.getWorldDirection(a);
    a.y = 0;
    const l = a.length();
    if (l > 1e-6) a.multiplyScalar((AHEAD * this.level.box) / l);
    return a.add(view.focus);
  }

  // One frame; while the F1 overlay shows or the governor runs (and the look draws through its
  // HDR target), its GPU time measured round it (gpuTimer.js: gpuLine(), the governor's
  // headroom before a step up).
  draw(view, storm, flash, melt, graded) {
    const timed = !this.tier.direct && (view.debug?.visible || !!this.governor);
    if (timed) (this.gpu ??= new GpuTimer(view.renderer.getContext())).begin();
    this.drawFrame(view, storm, flash, melt, graded);
    if (timed) this.gpu.end();
  }

  // The F1 overlay's GPU line ('gpu 8.4 ms'), or null (not measured: the direct path).
  gpuLine() {
    return this.gpu?.line() ?? null;
  }

  drawFrame(view, storm, flash, melt, graded) {
    const { renderer, scene, camera, sun } = view;
    if (this.farDirty) this.takeFar(view);
    if (this.probeDirty) this.takeProbe(view);
    this.placeSun(sun, this.shadowFocus(view));
    const retro = view.lookRetro;
    if (this.tier.direct && !retro && !graded) {
      view.underwater.warm(view.compileObject, 'realDirect');
      view.warmObjects('realDirect');
      renderer.render(scene, camera);
      this.releaseGrade(view);
      return;
    }
    const target = retro ? (this.retroHdr = this.fitTarget(this.retroHdr, view.internal.width, view.internal.height, 4)) : this.sceneTarget(renderer, true);
    this.grade.uGradeScreen.value.set(target.width, target.height);
    const check = target.depthTexture && !this.depthChecked;
    if (check) renderer.getContext().getError(); // (the flag cleared: the resolve's own below)
    renderer.setRenderTarget(target);
    view.underwater.warm(view.compileObject, 'real');
    view.warmObjects('real');
    renderer.render(scene, camera);
    if (check) this.checkDepth(renderer);
    const fx = this.post?.render(renderer, target, camera, this.sunDir, this.level.post) ?? null;
    const out = { fx, depth: this.post?.depthOk ? target.depthTexture : null, camera, ca: this.level.post.ca };
    if (retro) {
      renderer.setRenderTarget(view.target);
      this.output.render(renderer, target.texture, { ...out, encode: false });
      renderer.setRenderTarget(null);
      view.pass.setGrade(storm, flash);
      view.pass.setMeltdown(melt);
      view.pass.render(renderer, view.target.texture, view.internal.width, view.internal.height);
      return;
    }
    if (graded) {
      const grade = view.gradePass.targetFor(target.width, target.height);
      renderer.setRenderTarget(grade);
      this.output.render(renderer, target.texture, { ...out, encode: false });
      renderer.setRenderTarget(null);
      view.gradePass.render(renderer, grade.texture, storm, flash, melt);
      return;
    }
    renderer.setRenderTarget(null);
    this.output.render(renderer, target.texture, out);
    this.releaseGrade(view);
  }

  // Once: the multisampled depth's resolve into the depth texture worked (some drivers refuse
  // the blit: then the post chain runs without the depth, the bloom and the grade only).
  checkDepth(renderer) {
    this.depthChecked = true;
    const gl = renderer.getContext();
    if (gl.getError() === gl.NO_ERROR) return;
    console.warn('realistic look: the depth resolve failed, no ambient occlusion or sun shafts');
    this.post.depthOk = false; // (the targets are made again without it)
  }

  // The storm is over: free the grade's full-size target (as native mode does).
  releaseGrade(view) {
    if (view.gradePass.target && view.darkness === 0) view.gradePass.release();
  }

  describe(width, height) {
    const path = this.tier.direct ? 'direct' : `msaa${this.level.samples}`;
    const note = this.post && !this.post.depthOk ? ' post: no depth' : '';
    return `real ${width}x${height} ${path} ${this.level.name}${this.governor ? ' auto' : ''}${note}`;
  }

  dispose() {
    this.hdr?.dispose();
    this.retroHdr?.dispose();
    this.env?.dispose();
    for (const p of this.probes.values()) p.target?.dispose();
    this.far?.dispose();
    this.post?.dispose();
    this.gpu?.dispose();
    this.output.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
