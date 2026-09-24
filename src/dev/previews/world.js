// Whole level (terrain + castle + props + sky), no player. Useful for world screenshots.
//   &dark=1       AI RACE mode (level.setDarkness(t), t = 0..1; 0.5 = mid-crossfade). The
//                 preview also eases its fog toward the storm sky's horizon (the game's
//                 renderer does its own storm fog).
//   &scorch=x,z,r;x,z,r   burn marks (level.addScorch)
//   &t=seconds    fixed world clock (repeatable shots; default: real time)
import { buildLevel } from '../../world/level.js';
import { SKY_HORIZON_COLOR, SKY_STORM_HORIZON_COLOR } from '../../world/sky.js';

export async function setup({ scene, THREE, params }) {
  const dark = Math.min(1, Math.max(0, Number(params.get('dark') ?? 0) || 0));
  const fog = new THREE.Fog(0xa0c8ff, 9000, 30000);
  const storm = new THREE.Color(SKY_STORM_HORIZON_COLOR ?? SKY_HORIZON_COLOR);
  fog.color.lerp(storm, dark);
  fog.near = 9000 - 3500 * dark;
  fog.far = 30000 - 8000 * dark;
  scene.fog = fog;
  const level = buildLevel(scene);
  if (dark > 0) level.setDarkness(dark);
  for (const s of (params.get('scorch') ?? '').split(';').filter(Boolean)) {
    const [x, z, r] = s.split(',').map(Number);
    level.addScorch(x, z, r || 200);
  }
  const fixed = params.has('t') ? Number(params.get('t')) : null;
  window.__level = level;
  return {
    camera: { pos: [0, 900, 7200], look: [0, 600, -2000] },
    update(dt, t) {
      level.update(fixed ?? t, window.__preview?.camera);
    },
  };
}
