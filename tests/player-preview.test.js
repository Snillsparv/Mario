// The physics preview's demo scripts must still perform their moves on the test course
// (they are tuned by tick counts, so movement tuning changes can silently break them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS } from '../src/dev/previews/physics.js';
import { Player } from '../src/player/Player.js';
import { buildTestCourse, ScriptedController } from '../src/player/physics/testCourse.js';

test('every preview demo reaches each of its `until` goals', () => {
  const { builder, signs } = buildTestCourse();
  const world = builder.build();
  for (const [name, demo] of Object.entries(DEMOS)) {
    const [x, y, z, yaw] = demo.spawn;
    const p = new Player({ collision: world, events: null, spawn: { x, y, z, yaw }, signs });
    const ctl = new ScriptedController();
    const reached = (until) => (until === 'grounded' ? p.grounded : until === 'airborne' ? !p.grounded && !p.inWater : p.action === until);
    for (const step of demo.script) {
      const max = step.until ? 300 : step.n;
      let i = 0;
      while (i < max && !(step.until && i > 0 && reached(step.until))) {
        p.update(ctl.next(step), yaw);
        i++;
      }
      if (step.until) assert.ok(reached(step.until), `${name}: never reached ${step.until}`);
    }
  }
});
