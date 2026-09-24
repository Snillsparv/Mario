// Underwater look: while the camera is below the water surface the scene's distance fog is
// swapped for a short-range blue-green one. The fog starts *behind* the camera (negative
// near), so even close-up geometry and the hero pick up a slight water tint.
//
// The sky dome (world/sky.js, mesh 'skyDome') is drawn without fog, so on its own it would
// stay bright blue with white clouds above the water surface. While submerged it is drawn
// with a tinted copy of its material that mixes UNDERWATER_SKY_TINT of the fog colour into
// every pixel: looking up gives a murky teal surface with faint cloud shapes and the
// silhouettes of fogged towers, instead of a clear sky. warm() builds that shader while dry
// so the first dive doesn't stall on a compile.

import * as THREE from 'three';
import { NO_WATER } from '../../core/constants.js';

export const UNDERWATER_FOG = Object.freeze({ color: 0x1b6878, near: -700, far: 4200 });
// Share of the fog colour mixed into the sky dome while submerged (0 = clear sky, 1 = flat fog).
export const UNDERWATER_SKY_TINT = 0.8;
// Name of the sky dome mesh built by world/sky.js.
export const SKY_DOME_NAME = 'skyDome';

// True when point p is below the water surface at its xz. waterLevelFn(x, z) returns the
// surface height or NO_WATER where there is no water.
export function isBelowWater(p, waterLevelFn) {
  if (!waterLevelFn) return false;
  const level = waterLevelFn(p.x, p.z);
  return Number.isFinite(level) && level > NO_WATER && p.y < level;
}

// A copy of the sky material that mixes `tint.value` of the scene's fog colour into its
// output (a constant fog factor instead of a distance-based one). The mix happens where the
// fog chunk would, in output colour space, exactly like fogged geometry. The tint is a
// uniform, so every tinted sky shares one program.
export function tintedSkyMaterial(source, tint) {
  const mat = source.clone();
  mat.name = `${source.name || 'sky'} (underwater)`;
  mat.fog = true; // provides fogColor; the distance-based fog factor is replaced below
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.underwaterSkyTint = tint;
    shader.fragmentShader = `uniform float underwaterSkyTint;\n${shader.fragmentShader}`.replace(
      '#include <fog_fragment>',
      '#ifdef USE_FOG\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, underwaterSkyTint );\n#endif',
    );
  };
  mat.customProgramCacheKey = () => 'underwaterSky';
  return mat;
}

export class UnderwaterFog {
  constructor(
    scene,
    { color = UNDERWATER_FOG.color, near = UNDERWATER_FOG.near, far = UNDERWATER_FOG.far, skyTint = UNDERWATER_SKY_TINT } = {},
  ) {
    this.scene = scene;
    this.color = new THREE.Color(color);
    this.near = near;
    this.far = far;
    this.skyTint = { value: skyTint }; // shader uniform: change .value to retune live
    this.active = false;
    this.saved = null; // above-water fog/background, restored on surfacing
    this.sky = null; // { mesh, material } while the tinted sky is swapped in
    this.tinted = null; // { source, material }: cached tinted copy of the sky material
    this.warmed = new Set(); // variants whose tinted-sky program is compiled
    this.skyMissingAt = -1; // scene.children.length when warm() last found no sky
  }

  // The sky dome mesh in the scene, or null.
  findSky() {
    const dome = this.scene.getObjectByName(SKY_DOME_NAME);
    return dome?.isMesh && dome.material?.isMaterial ? dome : null;
  }

  tintedFor(source) {
    if (this.tinted?.source !== source) {
      this.tinted?.material.dispose();
      this.warmed.clear();
      this.tinted = { source, material: tintedSkyMaterial(source, this.skyTint) };
    }
    return this.tinted.material;
  }

  // Pre-compiles the tinted sky while dry: compile(object3D) must compile that object's
  // current material against the scene (N64Renderer passes renderer.compile(obj, camera,
  // scene) with the render target of this frame bound, since the program depends on it;
  // `variant` names that setup). Cheap every frame: after one warm-up per variant it does
  // nothing, and until a sky dome turns up it only searches again when the scene's top
  // level changes.
  warm(compile, variant = '') {
    if (this.active || this.warmed.has(variant)) return false;
    const n = this.scene.children.length;
    if (n === this.skyMissingAt) return false;
    const dome = this.findSky();
    if (!dome) {
      this.skyMissingAt = n;
      return false;
    }
    this.skyMissingAt = -1;
    const material = dome.material;
    dome.material = this.tintedFor(material);
    try {
      compile(dome);
    } finally {
      dome.material = material;
    }
    this.warmed.add(variant);
    return true;
  }

  // The fog used above water (and the colour background with it): applied now while dry,
  // or kept for surfacing while submerged. `color` is a THREE.Color.
  setSurfaceFog(color, near, far) {
    const { fog, background } = this.scene;
    if (this.active) {
      const s = this.saved;
      s.fogColor?.copy(color);
      if (s.fogColor) {
        s.near = near;
        s.far = far;
      }
      s.background?.copy(color);
      return;
    }
    if (fog) {
      fog.color.copy(color);
      fog.near = near;
      fog.far = far;
    }
    if (background?.isColor) background.copy(color);
  }

  // The underwater fog itself (e.g. darker in the storm); applied at once while submerged.
  setWaterFog(color, near, far) {
    this.color.copy(color);
    this.near = near;
    this.far = far;
    if (!this.active) return;
    const { fog, background } = this.scene;
    if (fog) {
      fog.color.copy(color);
      fog.near = near;
      fog.far = far;
    }
    if (background?.isColor) background.copy(color);
  }

  // Switch to/from the underwater fog. Returns true when the state changed.
  update(submerged) {
    if (submerged === this.active) return false;
    this.active = submerged;
    const { fog, background } = this.scene;
    if (submerged) {
      this.saved = {
        fogColor: fog?.color.clone(),
        near: fog?.near,
        far: fog?.far,
        background: background?.isColor ? background.clone() : null,
      };
      if (fog) {
        fog.color.copy(this.color);
        fog.near = this.near;
        fog.far = this.far;
      }
      // A plain-colour sky would otherwise show through gaps as a bright wall.
      if (background?.isColor) background.copy(this.color);
      const dome = this.findSky();
      if (dome) {
        this.sky = { mesh: dome, material: dome.material };
        dome.material = this.tintedFor(dome.material);
      }
    } else {
      const s = this.saved;
      if (fog && s.fogColor) {
        fog.color.copy(s.fogColor);
        fog.near = s.near;
        fog.far = s.far;
      }
      if (background?.isColor && s.background) background.copy(s.background);
      this.saved = null;
      // Put the sky's own material back (unless its owner replaced it meanwhile).
      const sky = this.sky;
      if (sky && sky.mesh.material === this.tinted?.material) sky.mesh.material = sky.material;
      this.sky = null;
    }
    return true;
  }

  dispose() {
    if (this.active) this.update(false);
    this.tinted?.material.dispose();
    this.tinted = null;
  }
}
