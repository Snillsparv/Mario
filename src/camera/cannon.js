// Cannon view (CameraController mode 'cannon', cameraConfig CANNON_*): while Pip sits in the
// cannon's barrel (player.cannon, actions/cannon.js: phases 'settle' and 'aim') the camera
// rides with the barrel, CANNON_CAM_BACK behind its pivot along the bore and CANNON_CAM_UP
// over it (square to the bore, so it tips back as the barrel rises), and looks exactly along
// the barrel: the middle of the picture (the HUD draws its reticle there) is where the barrel
// points, and the barrel itself shows below it, running out toward the reticle as it turns
// and tilts with the aim (and Pip, once fired, flies out along it). Where that would put the
// camera near the ground (a steep aim swings it down behind the breech) it is kept
// CANNON_CAM_CLEAR over the floor under it. The hero is not drawn while he is inside (settle,
// aim, and the unload before he climbs out). The controller blends into this pose when he has
// dropped in, and back out to the orbit (behind the barrel, or the flight camera behind the
// shot) when he fires or climbs out.

import * as K from './cameraConfig.js';

// He is in the barrel and the view is the cannon's (the aim can change).
export function cannonAiming(player) {
  const s = player?.cannon;
  return player?.action === 'cannon' && !!s && (s.phase === 'settle' || s.phase === 'aim');
}

// He is inside the barrel (hidden: settle, aim, unload).
export function cannonInside(player) {
  return player?.action === 'cannon' && !!player.cannon?.inside;
}

// Writes the cannon view for player.cannon ({ desc, yaw, pitch }) into pos / target
// (THREE.Vector3). `collision` (optional) keeps it over the floor.
export function cannonPose(cannon, pos, target, collision = null) {
  const d = cannon.desc;
  const yaw = cannon.yaw;
  const pitch = cannon.pitch;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Back along the bore, then up square to it (the bore's "up": (-sin p along yaw, cos p)).
  const along = -K.CANNON_CAM_BACK * cp - K.CANNON_CAM_UP * sp;
  pos.set(d.x + fx * along, d.y - K.CANNON_CAM_BACK * sp + K.CANNON_CAM_UP * cp, d.z + fz * along);
  if (collision) {
    const f = collision.findFloor(pos.x, pos.y + K.CANNON_CAM_CLEAR, pos.z);
    if (f.surface && pos.y < f.y + K.CANNON_CAM_CLEAR) pos.y = f.y + K.CANNON_CAM_CLEAR;
  }
  const L = K.CANNON_LOOK_DIST;
  target.set(pos.x + fx * cp * L, pos.y + sp * L, pos.z + fz * cp * L);
}
