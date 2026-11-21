import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INFINITE_LOOP, buildCircuit } from './helpers/circuits.js';
import { createContext, createWorld, stepWorld } from '../src/core/simulation.js';

test('the eight follows both lobes without lane jumps or extra laps at the crossing', () => {
  for (const lane of Object.values(buildCircuit(INFINITE_LOOP).lanes)) {
    const context = createContext({ lane });
    let world = createWorld(context);
    for (let i = 0; i < 12000 && world.timer.laps.length < 3; i++) {
      const previous = world;
      world = stepWorld(world, { throttle: 0.18 }, context);
      assert.equal(world.car.status, 'onTrack');
      const delta = world.car.distance - previous.car.distance;
      assert.ok(delta >= 0 && delta <= context.params.freeSpeed * context.dt);
      assert.equal(world.timer.laps.length, Math.max(0, Math.floor(world.car.distance / lane.length)));
    }
    assert.equal(world.timer.laps.length, 3);
    assert.ok(world.timer.laps.every(lap => lap.valid));
  }
});
