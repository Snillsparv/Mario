// The realistic look's worker (a module worker, render/real/textureStore.js starts it): the pure
// code the realistic Sparrow Lane needs and the main bundle does not carry. It paints the
// procedural texture sets (texgen/sets.js), or takes them from the IndexedDB cache
// (texCache.js), and builds the lane's own realistic geometry (world/lane/real/detail.js: the
// dad's house in full, the tile courses, the leaf cards, the firs, the cars, the grass's clump
// and lawn mask), off the main thread; it imports no three.js and no other chunk (tests/
// net-relay-build.test.js checks the built file).
//
//   in:  { id, jobs: [{ kind, size, opts }], cost }   (cost: the sender's estimate, sent back)
//   out: { id, index, key, set: { size, albedo, normal, orm, mips? }, ms }   per job, in order,
//        its maps' buffers transferred (the cache keeps its own copies), ms: how long it took
//        { id, index, key, error }                                 a generator that threw
//        { id, done: true, cost }                                  after the last
//   in:  { id, detail: { area, tier }, cost }                      an area's geometry
//   out: { id, key, detail, cost, ms }                             its buffers transferred
//        { id, key, cost, error }
//   out: { ready: true }                                           once, as it starts
//
// render/real/textureStore.js runs a few of these side by side (one job a message each).

import { TEXGEN_VERSION, generate } from './texgen/sets.js';
import { jobKey, detailKey } from './texgen/jobs.js';
import { openTexCache } from './texCache.js';
import { buildLaneDetail, detailBuffers } from '../../world/lane/real/detail.js';
// The layout's exports the realistic builders read, picked by name (round 2): handing them the
// module's namespace kept every table of layout.js in this chunk, the play-only ones too (the
// coins, the star, the 1-up, the doors and entries, the respawn, the poles, the butterflies and
// birds, the probe's height: ~2 kB the worker never reads). tests/net-relay-build.test.js checks
// that every layout export the worker's modules read is in this pick.
import {
  ANTENNAS, APRON, BED, BEECH_ROW, BIN, BINS, BOUNDS, CABINET, CARPORT, CARS, CAR_KINDS, CLIMBER,
  COLUMN_TREES, DAD, DAD_DRIVE, DAD_PATH, EDGE_FOREST, ENCLOSURE, FENCES, FLAGPOLE, FLAGPOLES,
  FLOWER_BEDS, FOOTPATH, FOOTWAY, FORECOURT, FOREST, GARAGE, GARDEN_TREES, GROUND, HEDGES, HOOP,
  HOUSES, IVY, KERB, LAMP, LAMPS, LANDING, LANE_BOSS, LANE_REAL, LINK, LINK_BIN, LINK_BINS,
  LINK_DRIVE, MAILBOX, MAILBOXES, MOTORHOME, NORTH, NORTH_WEST, NORTH_WEST_DRIVE, PATH_SIGN, PATIO,
  PAVEMENT, PLOTS_N, POT, RED_TREE, RHODODENDRON, ROAD, ROAD_DRAWN, ROSE, S2_GARDEN, SIDE_ROAD,
  SIGNS, SOUTH_EDGE, STEPS, THUJA, THUJAS, TRAMPOLINE, TRAMPOLINES, TREES, TURN_SIGN, VILLA_BINS,
  WIND, bedOutline, footpathAt, groundHeight, inApron, inBed, inBounds, inPolygon, northWestDrive,
  offRoadHeight, roadDistance, villaOf, wallZAt
} from '../../world/lane/layout.js';

const LAYOUT = {
  ANTENNAS, APRON, BED, BEECH_ROW, BIN, BINS, BOUNDS, CABINET, CARPORT, CARS, CAR_KINDS, CLIMBER,
  COLUMN_TREES, DAD, DAD_DRIVE, DAD_PATH, EDGE_FOREST, ENCLOSURE, FENCES, FLAGPOLE, FLAGPOLES,
  FLOWER_BEDS, FOOTPATH, FOOTWAY, FORECOURT, FOREST, GARAGE, GARDEN_TREES, GROUND, HEDGES, HOOP,
  HOUSES, IVY, KERB, LAMP, LAMPS, LANDING, LANE_BOSS, LANE_REAL, LINK, LINK_BIN, LINK_BINS,
  LINK_DRIVE, MAILBOX, MAILBOXES, MOTORHOME, NORTH, NORTH_WEST, NORTH_WEST_DRIVE, PATH_SIGN, PATIO,
  PAVEMENT, PLOTS_N, POT, RED_TREE, RHODODENDRON, ROAD, ROAD_DRAWN, ROSE, S2_GARDEN, SIDE_ROAD,
  SIGNS, SOUTH_EDGE, STEPS, THUJA, THUJAS, TRAMPOLINE, TRAMPOLINES, TREES, TURN_SIGN, VILLA_BINS,
  WIND, bedOutline, footpathAt, groundHeight, inApron, inBed, inBounds, inPolygon, northWestDrive,
  offRoadHeight, roadDistance, villaOf, wallZAt
};
const cache = openTexCache();
const DETAILS = { lane: (tier) => buildLaneDetail(LAYOUT, tier) };

const transfers = (set) => [set.albedo.buffer, set.normal.buffer, set.orm.buffer, ...(set.mips ?? []).map((m) => m.buffer)];

async function run({ id, jobs, cost }) {
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const key = jobKey(job);
    try {
      const t0 = performance.now();
      const stored = `${TEXGEN_VERSION}:${key}`;
      let set = await cache.get(stored);
      if (!set) {
        set = generate(job);
        cache.put(stored, set); // (copied at once; stored while the set goes on)
      }
      self.postMessage({ id, index, key, set, ms: Math.round(performance.now() - t0) }, transfers(set));
    } catch (e) {
      self.postMessage({ id, index, key, error: String(e?.message ?? e) });
    }
  }
  self.postMessage({ id, done: true, cost });
}

function build({ id, detail: job, cost }) {
  const key = detailKey(job);
  try {
    const t0 = performance.now();
    const detail = DETAILS[job.area](job.tier);
    self.postMessage({ id, key, detail, cost, ms: Math.round(performance.now() - t0) }, detailBuffers(detail));
  } catch (e) {
    self.postMessage({ id, key, cost, error: String(e?.message ?? e) });
  }
}

// One request at a time, in the order they came.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => (data.detail ? build(data) : run(data)));
};
self.postMessage({ ready: true }); // (running: main.js waits for this before the rest of its boot)
