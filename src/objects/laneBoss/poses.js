// STOMPWATT's poses as flat arrays (LaneBoss.js, fight.js): each rig.js POSES entry as the
// frame bones' [x, y, z] turns in BONES order (bones left out at rest), and each bone's index.
//
//   N, INDEX[bone], POSE[name] (Float32Array N * 3)

import { BONES, POSES } from './rig.js';

export const N = BONES.length;
export const INDEX = Object.freeze(Object.fromEntries(BONES.map(([name], i) => [name, i])));
const poseArray = (name) => {
  const a = new Float32Array(N * 3);
  for (const [bone, t] of Object.entries(POSES[name])) a.set(t, INDEX[bone] * 3);
  return a;
};
export const POSE = Object.freeze(Object.fromEntries(Object.keys(POSES).map((name) => [name, poseArray(name)])));
