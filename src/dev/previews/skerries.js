// Midsummer Skerries preview: /preview.html?m=skerries (world/skerries/*, in its own local
// frame, under the course's fog and the grounds' sky dome).
//   &col=1   overlay collider triangles (front faces only: floors green, walls blue, ceilings
//            red) to check winding (the enclosure's walls show from inside the bay only)
//   &lit=1   the lighthouse's lamp and beams lit (dark until the course's star is won)
//   &view=overview|arrival|skerries|islet|gallery|bay   camera presets (default: overview, from
//            over the island up the bay to the lighthouse; arrival: where the camera starts)
//   &t=secs  freeze the clock (the sea's ripples, the beams' sweep)
import * as layout from '../../world/skerries/layout.js';
import { buildSkerries } from '../../world/skerries/build.js';
import { buildSea } from '../../world/skerries/sea.js';
import { buildSky, SKY_HORIZON_COLOR } from '../../world/sky.js';
import { SKERRIES_ATMOSPHERE } from '../../world/areas.js';
import { colliderOverlay } from './castle.js';

const ARRIVAL = layout.ENTRIES.arrival;
const VIEWS = {
  overview: { pos: [-900, 700, 3400], look: [-300, 900, -4600] },
  arrival: { pos: [ARRIVAL.x, 480, 2950], look: [ARRIVAL.x, 400, 0] },
  skerries: { pos: [-1500, 900, 1800], look: [-3200, 100, -1500] },
  islet: { pos: [600, 1300, -900], look: [0, 1200, -4300] },
  gallery: { pos: [900, 3200, -3300], look: [0, 2800, -4600] },
  bay: { pos: [0, 5200, 6500], look: [0, 0, -1500] },
};

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(SKY_HORIZON_COLOR);
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, SKERRIES_ATMOSPHERE.near, SKERRIES_ATMOSPHERE.far);
  const sky = buildSky();
  const land = buildSkerries(layout);
  const sea = buildSea(layout);
  scene.add(sky.object3D, land.object3D, sea.object3D);
  if (params.get('col')) scene.add(colliderOverlay(THREE, land.colliders));
  if (params.get('lit')) land.setLit(true);
  const frozen = params.get('t');
  return {
    camera: VIEWS[params.get('view')] ?? VIEWS.overview,
    update(dt, t) {
      const time = frozen !== null ? Number(frozen) : t;
      sky.update(time, window.__preview?.camera);
      land.update(time);
      sea.update(time);
    },
  };
}
