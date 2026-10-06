// The realistic look's lazily loaded chunk (vite builds it as `realLook`, a child of the lane's
// chunk: world/lane/index.js loadRealLook, which LANE_REAL_AREA.load in jobs.js calls, started at
// boot): Sparrow Lane's build (look.js) and with it every module of the realistic look's
// main-thread code that the game's main chunk does not need first (render/real/RealLook.js,
// OutputPass.js, materials.js, sky.js, probe.js, farShadow.js, post/*). It imports only from its
// ancestors, the lane's chunk (the classic builders) and main (three.js, the tiers): nothing is
// downloaded twice.

export const chunk = 'realLook'; // (src/core/chunks.js: its name)
export { laneRealSteps } from './look.js';
