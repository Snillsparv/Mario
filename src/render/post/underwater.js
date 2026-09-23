// Underwater look: while the camera is below the water surface the scene's distance fog is
// swapped for a short-range blue-green one. The fog starts *behind* the camera (negative
// near), so even close-up geometry and the hero pick up a slight water tint.

import * as THREE from 'three';
import { NO_WATER } from '../../core/constants.js';

export const UNDERWATER_FOG = Object.freeze({ color: 0x1b6878, near: -700, far: 4200 });

// True when point p is below the water surface at its xz. waterLevelFn(x, z) returns the
// surface height or NO_WATER where there is no water.
export function isBelowWater(p, waterLevelFn) {
  if (!waterLevelFn) return false;
  const level = waterLevelFn(p.x, p.z);
  return Number.isFinite(level) && level > NO_WATER && p.y < level;
}

export class UnderwaterFog {
  constructor(scene, { color = UNDERWATER_FOG.color, near = UNDERWATER_FOG.near, far = UNDERWATER_FOG.far } = {}) {
    this.scene = scene;
    this.color = new THREE.Color(color);
    this.near = near;
    this.far = far;
    this.active = false;
    this.saved = null; // above-water fog/background, restored on surfacing
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
    } else {
      const s = this.saved;
      if (fog && s.fogColor) {
        fog.color.copy(s.fogColor);
        fog.near = s.near;
        fog.far = s.far;
      }
      if (background?.isColor && s.background) background.copy(s.background);
      this.saved = null;
    }
    return true;
  }
}
