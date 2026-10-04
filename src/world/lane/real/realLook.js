// The realistic look's lazily loaded chunk (vite builds it as `realLook`, imported by
// LANE_REAL_AREA.load in jobs.js: one dynamic import, started at boot): Sparrow Lane's build
// (look.js) and with it every module of the realistic look's main-thread code that the game's
// main chunk does not need first (render/real/RealLook.js, OutputPass.js, materials.js, sky.js,
// probe.js, farShadow.js, post/*). It imports only from the main chunk (three.js, the classic
// builders, the tiers): nothing is downloaded twice.

export { laneRealSteps } from './look.js';
