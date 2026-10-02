// Sparrow Lane preview: /preview.html?m=lane (world/lane/*, in its own local frame, under the
// course's fog and the grounds' sky dome).
//   &col=1   overlay collider triangles (front faces only: floors green, walls blue, ceilings
//            red) to check winding (the boundary's invisible walls show from inside only)
//   &view=overview|arrival|home|roof|west|junction|turn|north|gap   camera presets (default:
//            overview, high over the turning area looking west down the lane; arrival: where the
//            camera starts, over the lawn looking at the dad's front door and the star over the
//            ridge; home: the dad's house front with the mailbox; roof: the climb (the bins, the
//            carport, the roof and the star); west: the bend, the north-west villa and the
//            motorhome; junction: the lamppost, the big trees and the corner house; turn: the
//            turning area, the double garage, the footpath; north: the villas' fronts and walls;
//            gap: up a side yard between two villas)
//   &door=0..1  the dad's front door that far open
//   &t=secs  freeze the clock
import * as layout from '../../world/lane/layout.js';
import { buildLane } from '../../world/lane/build.js';
import { buildSky, SKY_HORIZON_COLOR } from '../../world/sky.js';
import { LANE_ATMOSPHERE } from '../../world/areas.js';
import { colliderOverlay } from './castle.js';

const HOME = layout.ENTRIES.home;
const VIEWS = {
  overview: { pos: [7600, 2600, -900], look: [0, 0, 600] },
  arrival: { pos: [HOME.x, 420, HOME.z - 1250], look: [HOME.x, 260, HOME.z] },
  home: { pos: [600, 380, -700], look: [300, 300, 1400] },
  roof: { pos: [3300, 900, 300], look: [800, 450, 2000] },
  west: { pos: [-3200, 600, 900], look: [-6200, 300, -300] },
  junction: { pos: [-5600, 700, 1300], look: [-8200, 400, 1300] },
  turn: { pos: [1600, 700, 200], look: [4500, 300, -200] },
  north: { pos: [-1200, 450, 900], look: [-1200, 400, -2000] },
  gap: { pos: [-1125, 450, -700], look: [-1125, 400, -3200] },
};

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(SKY_HORIZON_COLOR);
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, LANE_ATMOSPHERE.near, LANE_ATMOSPHERE.far);
  const sky = buildSky();
  const lane = buildLane(layout);
  scene.add(sky.object3D, lane.object3D);
  if (params.get('col')) scene.add(colliderOverlay(THREE, lane.colliders));
  lane.setDoorOpen(Number(params.get('door') ?? 0));
  const frozen = params.get('t');
  return {
    camera: VIEWS[params.get('view')] ?? VIEWS.overview,
    update(dt, t) {
      const time = frozen !== null ? Number(frozen) : t;
      sky.update(time, window.__preview?.camera);
    },
  };
}
