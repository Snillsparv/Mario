// Global simulation constants. World units are "SM64-style" units: roughly 1 unit = 1 cm.
// The hero is ~160 units tall. Y is up. All gameplay simulation runs at a fixed 30 Hz tick
// and velocities are expressed in units per tick (frame).

export const FPS = 30;
export const FRAME_DT = 1 / FPS;
export const MAX_STEPS_PER_FRAME = 5;

export const PLAYER_HEIGHT = 160;
export const PLAYER_RADIUS = 50;

// Floor queries accept floors up to this far above the query point (step-up tolerance).
export const FLOOR_TOLERANCE = 78;
// Returned by findFloor when there is no floor below the point.
export const FLOOR_LOWER_LIMIT = -11000;
// Returned by findCeil when there is no ceiling above the point.
export const CEIL_NONE = 20000;
// Returned by waterLevelAt when there is no water at a position.
export const NO_WATER = -11000;
