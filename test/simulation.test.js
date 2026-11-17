import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from '../src/core/circuits.js';
import { terminalSpeed } from '../src/core/physics.js';
import {
  createContext,
  createWorld,
  stepWorld,
  carPose,
} from '../src/core/simulation.js';

const circuit = buildCircuit(OVAL);

function contextFor(laneName, rules) {
  return createContext({ lane: circuit.lanes[laneName], rules });
}

/** Runs the simulation with a throttle given as a function of the world. */
function run(context, seconds, throttleFor, world = createWorld(context)) {
  const steps = Math.round(seconds / context.dt);
  const history = [world];
  for (let i = 0; i < steps; i += 1) {
    world = stepWorld(world, { throttle: throttleFor(world, i) }, context);
    history.push(world);
  }
  return history;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('the car starts at rest behind the finish line with the clock stopped', () => {
  const context = contextFor('inner');
  const world = createWorld(context);
  assert.equal(world.stepIndex, 0);
  assert.equal(world.time, 0);
  assert.deepEqual(world.car, { status: 'onTrack', distance: -0.1, speed: 0 });
  assert.equal(world.timer.lapStart, null);
});

test('the time is derived from the integer step counter', () => {
  const context = contextFor('inner');
  const history = run(context, 10, () => 0.3);
  const last = history[history.length - 1];
  assert.equal(last.stepIndex, 1200);
  assert.equal(last.time, 1200 * context.dt);
  for (const world of history) assert.equal(world.time, world.stepIndex * context.dt);
});

test('the simulation is deterministic', () => {
  const context = contextFor('inner');
  const pattern = [1, 1, 0.5, 0, 0.3, 0.3, 1, 0];
  const play = () => run(context, 30, (world, i) => pattern[Math.floor(i / 50) % pattern.length]);
  assert.deepStrictEqual(play(), play());
});

test('stepping does not modify the world it receives', () => {
  const context = contextFor('inner');
  let world = deepFreeze(createWorld(context));
  for (let i = 0; i < 600; i += 1) {
    world = deepFreeze(stepWorld(world, { throttle: i < 300 ? 1 : 0.3 }, context));
  }
  assert.equal(world.stepIndex, 600);
});

test('a moderate throttle completes many laps without leaving the track', () => {
  const context = contextFor('inner');
  const history = run(context, 60, () => 0.3);
  const last = history[history.length - 1];
  assert.ok(history.every((world) => world.car.status === 'onTrack'));
  assert.ok(last.timer.laps.length >= 8, `laps: ${last.timer.laps.length}`);
  assert.ok(last.timer.laps.every((lap) => lap.valid));

  // Once the speed has settled, a lap lasts the lane length over the speed.
  const expected = context.laneLength / terminalSpeed(0.3);
  for (const lap of last.timer.laps.filter((l) => l.number >= 3)) {
    assert.ok(Math.abs(lap.time - expected) < 0.01, `lap ${lap.number}: ${lap.time} s`);
  }
  assert.equal(last.timer.best.valid, true);
});

test('full throttle makes the car leave the track at the entrance of the first curve', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exit = history.find((world) => world.car.status === 'offTrack');
  assert.ok(exit, 'the car never left the track');
  // On the inner lane the first curve starts after 1 m of straight.
  assert.ok(exit.car.distance >= 1 && exit.car.distance < 1.05, `exit at ${exit.car.distance} m`);
  assert.equal(exit.car.travel, 0);
  assert.equal(exit.timer.currentLapHadExit, true);
});

test('the throttle is ignored while the car is off the track', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  const slide = history.slice(exitIndex, exitIndex + context.recoverySteps);

  for (let i = 1; i < slide.length; i += 1) {
    assert.equal(slide[i].car.status, 'offTrack', `step ${i}`);
    assert.equal(slide[i].car.distance, exit.car.distance);
    assert.ok(slide[i].car.speed <= slide[i - 1].car.speed);
    assert.ok(slide[i].car.travel >= slide[i - 1].car.travel);
  }
  // The same slide happens with the throttle released.
  const idle = run(context, 1, () => 0, exit);
  assert.equal(idle[60].car.travel, slide[60].car.travel);
  assert.equal(idle[60].car.speed, slide[60].car.speed);
});

test('after the recovery time the car is back on its lane at rest', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  assert.equal(context.recoverySteps, 180);

  const before = history[exitIndex + context.recoverySteps - 1];
  const after = history[exitIndex + context.recoverySteps];
  assert.equal(before.car.status, 'offTrack');
  assert.deepEqual(after.car, { status: 'onTrack', distance: exit.car.distance, speed: 0 });
  assert.equal(after.timer, exit.timer);
});

test('a lap with an exit is not valid and the next clean lap is the best one', () => {
  const context = contextFor('inner');
  // Full throttle until the car leaves the track, then a moderate throttle.
  let left = false;
  const history = run(context, 40, (world) => {
    if (world.car.status === 'offTrack') left = true;
    return left ? 0.3 : 1;
  });
  const { timer } = history[history.length - 1];
  assert.ok(timer.laps.length >= 3);
  assert.equal(timer.laps[0].valid, false);
  assert.equal(timer.laps[1].valid, true);
  // The lap with the exit never counts, whatever its time. The best lap is
  // the fastest of the valid ones: later laps are slightly faster because the
  // speed settles gradually after the restart from rest.
  assert.ok(timer.best.number >= 2);
  const validTimes = timer.laps.filter((lap) => lap.valid).map((lap) => lap.time);
  assert.equal(timer.best.time, Math.min(...validTimes));
  // The exit did not shorten the lap: the car still covers the full length
  // and also loses the time spent sliding and restarting.
  assert.ok(timer.laps[0].time > timer.laps[1].time + 1);
});

test('half throttle holds on the wide outer lane but not on the tight inner lane', () => {
  const inner = run(contextFor('inner'), 60, () => 0.5);
  const outer = run(contextFor('outer'), 60, () => 0.5);
  assert.ok(inner.some((world) => world.car.status === 'offTrack'), 'the inner lane held');
  assert.ok(outer.every((world) => world.car.status === 'onTrack'), 'the outer lane lost grip');
});

test('the pose follows the lane and leaves it along the tangent after an exit', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');

  const onTrack = history[exitIndex - 1];
  assert.deepEqual(carPose(onTrack, context), context.lane.poseAt(onTrack.car.distance));

  const exit = history[exitIndex];
  const start = carPose(exit, context);
  const slid = carPose(history[exitIndex + 30], context);
  const travel = history[exitIndex + 30].car.travel;
  assert.ok(travel > 0);
  assert.ok(Math.abs(Math.hypot(slid.x - start.x, slid.y - start.y) - travel) < 1e-9);
  // The direction of the slide is the heading of the lane at the exit.
  const heading = context.lane.poseAt(exit.car.distance).heading;
  assert.ok(Math.abs((slid.x - start.x) - travel * Math.cos(heading)) < 1e-9);
  assert.ok(Math.abs((slid.y - start.y) - travel * Math.sin(heading)) < 1e-9);
});

test('invalid input and rules are rejected', () => {
  const context = contextFor('inner');
  const world = createWorld(context);
  assert.throws(() => stepWorld(world, { throttle: Number.NaN }, context), RangeError);
  assert.throws(() => contextFor('inner', { dt: 0 }), RangeError);
  assert.throws(() => contextFor('inner', { recoveryTime: -1 }), RangeError);
  assert.throws(() => contextFor('inner', { startDistance: Number.NaN }), RangeError);
});

test('rules can be changed', () => {
  const context = contextFor('inner', { recoveryTime: 0.5, startDistance: -0.2 });
  assert.equal(context.recoverySteps, 60);
  assert.equal(createWorld(context).car.distance, -0.2);
});
