import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from '../src/core/circuits.js';
import { straight, curve } from '../src/core/geometry.js';
import { terminalSpeed, withParams, DEFAULT_PARAMS } from '../src/core/physics.js';
import {
  DEFAULT_RULES,
  SLIDE_SPIN,
  createContext,
  createWorld,
  stepWorld,
  carPose,
  interpolateWorld,
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

test('the drawn world is interpolated between two steps', () => {
  const context = contextFor('inner');
  const history = run(context, 1, () => 0.3);
  const previous = history[history.length - 2];
  const current = history[history.length - 1];

  assert.equal(interpolateWorld(previous, current, 0).car.distance, previous.car.distance);
  assert.equal(interpolateWorld(previous, current, 1).car.distance, current.car.distance);
  const middle = interpolateWorld(previous, current, 0.5).car.distance;
  assert.ok(Math.abs(middle - (previous.car.distance + current.car.distance) / 2) < 1e-12);

  // The other parts of the world are those of the current one.
  assert.equal(interpolateWorld(previous, current, 0.5).timer, current.timer);
  assert.equal(interpolateWorld(previous, current, 0.5).stepIndex, current.stepIndex);
  // The inputs are not modified.
  assert.equal(current.car.distance, history[history.length - 1].car.distance);
});

test('a sliding car is interpolated on its travel', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const previous = history[exitIndex + 10];
  const current = history[exitIndex + 11];
  const middle = interpolateWorld(previous, current, 0.5);
  assert.equal(middle.car.status, 'offTrack');
  assert.equal(middle.car.distance, current.car.distance);
  assert.ok(Math.abs(middle.car.travel - (previous.car.travel + current.car.travel) / 2) < 1e-12);
});

test('nothing is interpolated when the car changes status', () => {
  const context = contextFor('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  // From the last step on the track to the first one off it.
  assert.equal(interpolateWorld(history[exitIndex - 1], history[exitIndex], 0.5), history[exitIndex]);
  // From the last step off the track to the first one back on it.
  const back = exitIndex + context.recoverySteps;
  assert.equal(history[back - 1].car.status, 'offTrack');
  assert.equal(history[back].car.status, 'onTrack');
  assert.equal(interpolateWorld(history[back - 1], history[back], 0.5), history[back]);
});

test('an out-of-range interpolation fraction is rejected', () => {
  const context = contextFor('inner');
  const world = createWorld(context);
  assert.throws(() => interpolateWorld(world, world, -0.1), RangeError);
  assert.throws(() => interpolateWorld(world, world, 1.1), RangeError);
  assert.throws(() => interpolateWorld(world, world, Number.NaN), RangeError);
});

test('a lap time converges as the physics step gets smaller', () => {
  // The interpolation of the finish line crossing removes the rounding to a
  // whole step, but the accuracy of a lap still depends on the physics step:
  // the integration of the motion is only first-order accurate.
  const lane = circuit.lanes.inner;
  function firstLap(dt) {
    const stepContext = createContext({ lane, rules: { dt } });
    let world = createWorld(stepContext);
    for (let i = 0; i < 200000 && world.timer.laps.length === 0; i += 1) {
      world = stepWorld(world, { throttle: 0.3 }, stepContext);
    }
    return world.timer.laps[0].time;
  }

  const reference = firstLap(1 / 960);
  const errors = [30, 60, 120, 240].map((n) => Math.abs(firstLap(1 / n) - reference));
  // Each halving of the step shrinks the error.
  for (let i = 1; i < errors.length; i += 1) {
    assert.ok(errors[i] < errors[i - 1], `errors ${errors.join(', ')}`);
  }
  // At the step used by the game the error is a few milliseconds (measured:
  // 2.7 ms against the finest step); at 1/30 s it is more than ten.
  assert.ok(errors[2] < 0.005, `error at 1/120 s: ${errors[2]}`);
  assert.ok(errors[0] > 0.01, `error at 1/30 s: ${errors[0]}`);
});

// The tail rule: the pin follows the lane and the body may swing out.

function tailContext(laneName, rules = {}) {
  return contextFor(laneName, { tailSlide: true, ...rules });
}

/** The part of a world that the plain model also has, to compare. */
function plainPart(world) {
  const { status, distance, speed } = world.car;
  return { stepIndex: world.stepIndex, time: world.time, timer: world.timer, car: { status, distance, speed } };
}

test('the tail rule is off by default and then the car keeps its plain state', () => {
  assert.equal(DEFAULT_RULES.tailSlide, false);
  const context = contextFor('inner');
  assert.equal(context.tailSlide, false);
  const history = run(context, 5, () => 1);
  assert.ok(history.some((world) => world.car.status === 'offTrack'));
  for (const world of history) {
    const expected = world.car.status === 'onTrack'
      ? ['distance', 'speed', 'status']
      : ['distance', 'resumeStep', 'speed', 'status', 'travel'];
    assert.deepEqual(Object.keys(world.car).sort(), expected);
  }
});

test('the tail rule is validated, and a step too coarse for the tail is rejected', () => {
  assert.equal(tailContext('inner').tailSlide, true);
  assert.throws(() => contextFor('inner', { tailSlide: 1 }), RangeError);
  assert.throws(() => contextFor('inner', { tailSlide: 'yes' }), RangeError);
  // The car at its free speed must not cover the pin-to-axle distance in a step.
  const coarse = DEFAULT_PARAMS.pinToRearAxle / DEFAULT_PARAMS.freeSpeed;
  assert.throws(() => tailContext('inner', { dt: 1.01 * coarse }), RangeError);
  assert.doesNotThrow(() => tailContext('inner', { dt: 0.99 * coarse }));
  // The plain model has no such limit.
  assert.doesNotThrow(() => contextFor('inner', { dt: 1.01 * coarse }));
  const short = withParams({ pinToRearAxle: 0.01 });
  assert.throws(
    () => createContext({ lane: circuit.lanes.inner, params: short, rules: { tailSlide: true } }),
    RangeError,
  );
});

test('with the tail rule the car starts aligned, with no slide', () => {
  const world = createWorld(tailContext('inner'));
  assert.deepEqual(world.car, {
    status: 'onTrack', distance: -0.1, speed: 0, slip: 0, yawRate: 0, rearSlip: 0,
  });
});

test('where the tail never slides the motion is exactly the plain one', () => {
  for (const laneName of ['inner', 'outer']) {
    for (const throttle of [0.3, 0.45]) {
      const plain = run(contextFor(laneName), 60, () => throttle);
      const tail = run(tailContext(laneName), 60, () => throttle);
      for (let i = 0; i < plain.length; i += 1) {
        assert.deepStrictEqual(plainPart(tail[i]), plainPart(plain[i]), `${laneName} ${throttle} step ${i}`);
        assert.ok(tail[i].car.rearSlip === 0, `${laneName} ${throttle} step ${i}`);
      }
      assert.ok(tail.at(-1).timer.laps.length >= 8);
    }
  }
});

test('the tail rolls inside the curves and comes back in line on the straights', () => {
  const context = tailContext('inner');
  const history = run(context, 60, () => 0.3);
  const lane = context.lane;
  let inCurve = 0;
  let onStraight = 0;
  let largestStep = 0;
  for (let i = 1; i < history.length; i += 1) {
    const { car } = history[i];
    largestStep = Math.max(largestStep, Math.abs(car.slip - history[i - 1].car.slip));
    // Settled in a curve: the tail is inside, at -asin(l * curvature).
    if (lane.curvatureAt(car.distance) !== 0 && lane.curvatureAt(car.distance - 0.5) !== 0) {
      const expected = -Math.asin(DEFAULT_PARAMS.pinToRearAxle * lane.curvatureAt(car.distance));
      assert.ok(Math.abs(car.slip - expected) < 0.01, `step ${i}: slip ${car.slip}, expected ${expected}`);
      inCurve += 1;
    }
    // Settled on a straight: aligned.
    if (lane.curvatureAt(car.distance) === 0 && lane.curvatureAt(car.distance - 0.4) === 0) {
      assert.ok(Math.abs(car.slip) < 0.01, `step ${i}: slip ${car.slip}`);
      onStraight += 1;
    }
  }
  assert.ok(inCurve > 500 && onStraight > 500, `${inCurve} steps in curves, ${onStraight} on straights`);
  // The angle never jumps, not at the finish line either, where the heading of
  // the lane wraps around from 2 PI to 0.
  assert.ok(largestStep < 0.05, `largest step ${largestStep}`);
});

test('full throttle spins the car out of the first curve, later than the plain model', () => {
  const plain = run(contextFor('inner'), 3, () => 1).find((world) => world.car.status === 'offTrack');
  const context = tailContext('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  assert.ok(exit, 'the car never left the track');
  // The first curve of the inner lane starts after 1 m and is 0.35 PI long.
  assert.ok(exit.car.distance > plain.car.distance, `exit at ${exit.car.distance} m`);
  assert.ok(exit.car.distance < 1 + Math.PI * 0.35, `exit at ${exit.car.distance} m`);
  assert.ok(exit.car.slip > DEFAULT_PARAMS.maxSlipAngle, `slip ${exit.car.slip}`);
  assert.equal(exit.car.travel, 0);
  assert.equal(exit.timer.currentLapHadExit, true);
  // Before that the tail was sliding and the car was on the track.
  const before = history.slice(0, exitIndex);
  assert.ok(before.some((world) => world.car.rearSlip !== 0));
  assert.ok(before.every((world) => world.car.status === 'onTrack'));
  // While it slides off the track, the angle of the spin is kept.
  const slide = history.slice(exitIndex, exitIndex + context.recoverySteps);
  assert.ok(slide.every((world) => world.car.slip === exit.car.slip));
});

test('a throttle that the plain model cannot hold is held by a sliding tail', () => {
  const plain = run(contextFor('inner'), 60, () => 0.6);
  assert.ok(plain.some((world) => world.car.status === 'offTrack'));

  const history = run(tailContext('inner'), 60, () => 0.6);
  assert.ok(history.every((world) => world.car.status === 'onTrack'));
  assert.ok(history.some((world) => world.car.rearSlip !== 0), 'the tail never slid');
  const { timer } = history.at(-1);
  assert.ok(timer.laps.length >= 10, `laps: ${timer.laps.length}`);
  assert.ok(timer.laps.every((lap) => lap.valid));
  // The slide stays below the spin-out angle with some margin.
  const widest = Math.max(...history.map((world) => Math.abs(world.car.slip)));
  assert.ok(widest > 0.2 && widest < DEFAULT_PARAMS.maxSlipAngle, `widest slip ${widest}`);
});

test('after the recovery time the car is back at rest and aligned', () => {
  const context = tailContext('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  const before = history[exitIndex + context.recoverySteps - 1];
  const after = history[exitIndex + context.recoverySteps];
  assert.equal(before.car.status, 'offTrack');
  assert.deepEqual(after.car, {
    status: 'onTrack', distance: exit.car.distance, speed: 0, slip: 0, yawRate: 0, rearSlip: 0,
  });
  assert.equal(after.timer, exit.timer);
  // The car can start again and holds a moderate throttle as before.
  const again = run(context, 20, () => 0.3, after);
  assert.ok(again.every((world) => world.car.status === 'onTrack'));
  assert.ok(again.every((world) => Math.abs(world.car.slip) < 0.3));
});

test('the tail rule is deterministic and does not modify the world it receives', () => {
  const context = tailContext('inner');
  const pattern = [1, 1, 0.6, 0, 0.3, 0.3, 1, 0];
  const play = () => run(context, 30, (world, i) => pattern[Math.floor(i / 50) % pattern.length]);
  assert.deepStrictEqual(play(), play());

  let world = deepFreeze(createWorld(context));
  for (let i = 0; i < 1200; i += 1) {
    world = deepFreeze(stepWorld(world, { throttle: i < 300 ? 1 : 0.6 }, context));
  }
  assert.equal(world.stepIndex, 1200);
});

test('a lap with a sliding tail depends little on the physics step', () => {
  // Steps above 1/120 s are too coarse for the tail and are rejected.
  const lane = circuit.lanes.inner;
  function firstLap(dt) {
    const stepContext = createContext({ lane, rules: { dt, tailSlide: true } });
    let world = createWorld(stepContext);
    let sliding = 0;
    for (let i = 0; i < 400000 && world.timer.laps.length === 0; i += 1) {
      world = stepWorld(world, { throttle: 0.6 }, stepContext);
      if (world.car.rearSlip !== 0) sliding += 1;
    }
    assert.ok(world.timer.laps[0].valid);
    return { time: world.timer.laps[0].time, slidingTime: sliding * dt };
  }
  const steps = [120, 240, 480, 960];
  const reference = firstLap(1 / 1920);
  const laps = steps.map((n) => firstLap(1 / n));

  // The switch between holding and sliding makes the lap time wander by about
  // a millisecond, so it does not shrink in a regular order as the step does
  // (measured: 3.0827, 3.0816, 3.0815, 3.0826, 3.0831 s from 1/120 to 1/1920 s).
  // What is claimed is only that every step lands within 3 ms of the finest.
  for (const [i, lap] of laps.entries()) {
    assert.ok(Math.abs(lap.time - reference.time) < 0.003, `1/${steps[i]} s: ${lap.time} against ${reference.time}`);
  }
  // The time spent sliding does converge: it falls as the step shrinks.
  const slidingTimes = [...laps, reference].map((lap) => lap.slidingTime);
  for (let i = 1; i < slidingTimes.length; i += 1) {
    assert.ok(slidingTimes[i] < slidingTimes[i - 1], `sliding times ${slidingTimes.join(', ')}`);
  }
});

// The pose of the body, and the drawn world between two steps, with the tail rule.

const BACK = DEFAULT_PARAMS.pinToCenterOfMass;

/** The same oval driven clockwise: the curves turn to the right. */
const clockwise = buildCircuit({
  ...OVAL,
  id: 'oval-clockwise',
  pieces: [straight(1), curve(0.4, -Math.PI), straight(2), curve(0.4, -Math.PI), straight(1)],
  lanes: { inner: -0.05, outer: 0.05 },
});

function clockwiseContext(laneName) {
  return createContext({ lane: clockwise.lanes[laneName], rules: { tailSlide: true } });
}

/** Where the guide pin is: in front of the center of the body, by `BACK`. */
function pinOf(pose) {
  return { x: pose.x + BACK * Math.cos(pose.heading), y: pose.y + BACK * Math.sin(pose.heading) };
}

function gap(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('the mirrored oval has the same inner lane', () => {
  assert.equal(clockwise.lanes.inner.length, circuit.lanes.inner.length);
  assert.equal(clockwise.lanes.inner.curvatureAt(1.5), -circuit.lanes.inner.curvatureAt(1.5));
});

test('with the tail rule the pin is on the lane and the body trails behind it', () => {
  const context = tailContext('inner');
  const history = run(context, 20, () => 0.6);
  let widest = 0;
  for (const [i, world] of history.entries()) {
    const lanePose = context.lane.poseAt(world.car.distance);
    const pose = carPose(world, context);
    assert.ok(gap(pinOf(pose), lanePose) < 1e-12, `step ${i}`);
    assert.ok(Math.abs(gap(pose, lanePose) - BACK) < 1e-12, `step ${i}`);
    assert.ok(Math.abs(pose.heading - (lanePose.heading + world.car.slip)) < 1e-12, `step ${i}`);
    widest = Math.max(widest, Math.abs(world.car.slip));
  }
  // The body does turn: the heading is not that of the lane.
  assert.ok(widest > 0.2);
});

test('with the tail rule off the pose is still the point on the lane', () => {
  const context = contextFor('inner');
  const history = run(context, 5, () => 0.6);
  for (const world of history) {
    if (world.car.status === 'onTrack') {
      assert.deepEqual(carPose(world, context), context.lane.poseAt(world.car.distance));
    }
  }
});

test('on a straight the tail is in line, behind the pin', () => {
  const context = tailContext('inner');
  const world = createWorld(context);
  const pose = carPose(world, context);
  const lanePose = context.lane.poseAt(world.car.distance);
  assert.ok(Math.abs(pose.heading - lanePose.heading) < 1e-15);
  assert.ok(Math.abs(pose.x - (lanePose.x - BACK * Math.cos(lanePose.heading))) < 1e-12);
  assert.ok(Math.abs(pose.y - (lanePose.y - BACK * Math.sin(lanePose.heading))) < 1e-12);
});

test('a car that spins out slides along the tangent, from where its body was', () => {
  const context = tailContext('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  const lanePose = context.lane.poseAt(exit.car.distance);

  // At the exit the body is exactly where it was on the track at that angle.
  const onTrackPose = carPose({ ...exit, car: { ...exit.car, status: 'onTrack' } }, context);
  assert.deepEqual(carPose(exit, context), onTrackPose);

  // No jump when the car leaves the track. The center of the body cannot move
  // more than the pin does (at most speed * dt) plus what the turn of the body
  // moves it about the pin; off the track it moves by the distance slid.
  const before = carPose(history[exitIndex - 1], context);
  const first = carPose(exit, context);
  const turned = Math.abs(first.heading - before.heading);
  assert.ok(gap(first, before) <= exit.car.speed * context.dt + BACK * turned + 1e-12);
  for (let i = exitIndex + 1; i < exitIndex + 20; i += 1) {
    const jump = gap(carPose(history[i], context), carPose(history[i - 1], context));
    assert.ok(jump <= history[i - 1].car.speed * context.dt + 1e-12, `step ${i}: jump ${jump} m`);
  }

  // At the exit the body is at the angle where it spun out, and it slides
  // along the tangent of the lane at the exit point.
  const start = carPose(exit, context);
  assert.ok(Math.abs(start.heading - (lanePose.heading + exit.car.slip)) < 1e-12);
  const later = history[exitIndex + 30];
  const slid = carPose(later, context);
  const travel = later.car.travel;
  assert.ok(travel > 0);
  assert.ok(Math.abs((slid.x - start.x) - travel * Math.cos(lanePose.heading)) < 1e-9);
  assert.ok(Math.abs((slid.y - start.y) - travel * Math.sin(lanePose.heading)) < 1e-9);
  // It keeps turning the way it was turning: counterclockwise, the tail out
  // of a curve to the left.
  assert.ok(exit.car.slip > 0);
  assert.ok(Math.abs(slid.heading - (start.heading + SLIDE_SPIN * travel)) < 1e-9);
});

test('a car that spins out of a curve to the right keeps turning to the right', () => {
  const context = clockwiseContext('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const exit = history[exitIndex];
  assert.ok(exit, 'the car never left the track');
  assert.ok(exit.car.slip < -DEFAULT_PARAMS.maxSlipAngle, `slip ${exit.car.slip}`);

  const mirrored = run(tailContext('inner'), 3, () => 1);
  const mirroredExit = mirrored.find((world) => world.car.status === 'offTrack');
  assert.ok(Math.abs(exit.car.slip + mirroredExit.car.slip) < 1e-9);
  assert.ok(Math.abs(exit.car.distance - mirroredExit.car.distance) < 1e-9);

  const start = carPose(exit, context);
  const later = history[exitIndex + 30];
  const slid = carPose(later, context);
  assert.ok(Math.abs(slid.heading - (start.heading - SLIDE_SPIN * later.car.travel)) < 1e-9);
});

test('the slip is interpolated between two steps with the tail rule', () => {
  const context = tailContext('inner');
  const history = run(context, 2, () => 0.6);
  const previous = history[history.length - 2];
  const current = history[history.length - 1];
  assert.notEqual(previous.car.slip, current.car.slip);

  assert.equal(interpolateWorld(previous, current, 0).car.slip, previous.car.slip);
  assert.equal(interpolateWorld(previous, current, 1).car.slip, current.car.slip);
  const middle = interpolateWorld(previous, current, 0.5).car;
  assert.ok(Math.abs(middle.slip - (previous.car.slip + current.car.slip) / 2) < 1e-15);
  assert.ok(Math.abs(middle.distance - (previous.car.distance + current.car.distance) / 2) < 1e-12);
  // The other fields are those of the current world.
  assert.equal(middle.yawRate, current.car.yawRate);
  assert.equal(middle.rearSlip, current.car.rearSlip);
  // The drawn pose moves smoothly between the two steps.
  const before = carPose(interpolateWorld(previous, current, 0), context);
  const half = carPose(interpolateWorld(previous, current, 0.5), context);
  const after = carPose(interpolateWorld(previous, current, 1), context);
  assert.ok(Math.abs(gap(before, half) + gap(half, after) - gap(before, after)) < 1e-4);
});

test('without the tail rule the interpolated car has no slip', () => {
  const context = contextFor('inner');
  const history = run(context, 1, () => 0.3);
  const middle = interpolateWorld(history[history.length - 2], history[history.length - 1], 0.5);
  assert.equal('slip' in middle.car, false);
});

test('a car spinning off the track keeps its angle when it is interpolated', () => {
  const context = tailContext('inner');
  const history = run(context, 3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const middle = interpolateWorld(history[exitIndex + 10], history[exitIndex + 11], 0.5);
  assert.equal(middle.car.slip, history[exitIndex].car.slip);
  assert.equal(middle.car.status, 'offTrack');
});
