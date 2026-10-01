// The Great Hall preview: /preview.html?m=hall (world/hall/*, in its own local frame, under the
// hall's fog and background).
//   &col=1   overlay collider triangles (front faces only: floors green, walls blue, ceilings
//            red) to check winding: from inside the room every face of it shows.
//   &lamp=1  the lighthouse lamp in the bottle lit (hidden until that course's star is won)
//   &door=0..1  the front door's leaves standing that far open (shut by default)
//   &view=entry|bottle|fire|roof   camera presets (default: from over the front door)
//   &t=secs  freeze the flames' flicker at a given time
import * as layout from '../../world/hall/layout.js';
import { buildHall } from '../../world/hall/hall.js';
import { HALL_ATMOSPHERE } from '../../world/areas.js';
import { colliderOverlay } from './castle.js';

const VIEWS = {
  overview: { pos: [0, 2300, 2900], look: [0, 500, -2600] },
  entry: { pos: [0, 330, 2800], look: [0, 400, -1500] },
  bottle: { pos: [900, 900, -500], look: [0, 600, -2800] },
  fire: { pos: [-400, 500, -300], look: [-1900, 900, -1200] },
  roof: { pos: [0, 400, 1800], look: [0, 3200, -600] },
};

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(HALL_ATMOSPHERE.fog);
  scene.fog = new THREE.Fog(HALL_ATMOSPHERE.fog, HALL_ATMOSPHERE.near, HALL_ATMOSPHERE.far);
  const hall = buildHall(layout);
  scene.add(hall.object3D);
  if (params.get('col')) scene.add(colliderOverlay(THREE, hall.colliders));
  if (params.get('lamp')) hall.setLit(true);
  if (params.get('door')) hall.setDoorOpen(Number(params.get('door')));
  const frozen = params.get('t');
  return {
    camera: VIEWS[params.get('view')] ?? VIEWS.overview,
    update(dt, t) {
      hall.update(frozen !== null ? Number(frozen) : t);
    },
  };
}
