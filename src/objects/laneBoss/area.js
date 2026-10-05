// Sparrow Lane's lazy chunk (`laneBoss`: objects/laneBoss/index.js), as the lane's def names it
// (world/areas.js lane: `boss`): the only place the game imports it, and only dynamically.
// core/AreaSwitch.js loads it when the lane is built (main prefetches it at boot) and attaches it
// to the lane's objects (ObjectManager.attachLane). Without it (offline, a 404) the lane is as it
// always was: the dad's car parked, the bins static.
//
//   LANE_BOSS_AREA = { load }   load() -> Promise<module> (loaded once)

let loading = null;
const load = () => (loading ??= import('./index.js'));

export const LANE_BOSS_AREA = Object.freeze({ load });
