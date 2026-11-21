import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  withParams,
  netAcceleration,
  terminalSpeed,
  stepLongitudinal,
  lateralAcceleration,
  criticalSpeed,
  hasLostGrip,
  stepOffTrack,
  stepOffTrackRotation,
  stepYaw,
  hasSpunOut,
  scrubDeceleration,
} from '../src/core/physics.js';

const DT = 1 / 120;

function near(actual, expected, tolerance, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, got ${actual}`,
  );
}

function run(state, throttle, seconds, params = DEFAULT_PARAMS) {
  const history = [state];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    state = stepLongitudinal(state, throttle, DT, params);
    history.push(state);
  }
  return history;
}

test('the terminal speed at full throttle solves the balance of forces', () => {
  const v = terminalSpeed(1);
  const expected = (-1.6 + Math.sqrt(1.6 ** 2 + 4 * 0.02 * 7.5)) / (2 * 0.02);
  near(v, expected, 1e-12);
  near(v, 4.441, 1e-3);
  near(netAcceleration(v, 1), 0, 1e-9);
});

test('from rest at full throttle the speed grows monotonically to the terminal speed', () => {
  const history = run({ distance: 0, speed: 0 }, 1, 10);
  for (let i = 1; i < history.length; i += 1) {
    assert.ok(history[i].speed >= history[i - 1].speed, `step ${i}`);
    assert.ok(history[i].distance > history[i - 1].distance, `step ${i}`);
  }
  near(history[history.length - 1].speed, terminalSpeed(1), 1e-3);
});

test('a lower throttle gives a lower terminal speed', () => {
  assert.ok(terminalSpeed(0.5) < terminalSpeed(1));
  assert.ok(terminalSpeed(0.5) > 0);
  const history = run({ distance: 0, speed: 0 }, 0.5, 20);
  near(history[history.length - 1].speed, terminalSpeed(0.5), 1e-3);
});

test('releasing the throttle slows the car down to exactly zero', () => {
  const history = run({ distance: 0, speed: 4 }, 0, 5);
  let stopped = false;
  for (let i = 1; i < history.length; i += 1) {
    assert.ok(history[i].speed <= history[i - 1].speed, `step ${i}`);
    assert.ok(history[i].speed >= 0, `step ${i}`);
    if (history[i].speed === 0) stopped = true;
  }
  assert.ok(stopped, 'the car never stopped');
  assert.equal(history[history.length - 1].speed, 0);
  // Once stopped, the car does not move any more.
  const last = history[history.length - 1];
  assert.equal(stepLongitudinal(last, 0, DT).distance, last.distance);
});

test('a car at rest stays at rest when the drive cannot beat the friction', () => {
  const idle = stepLongitudinal({ distance: 3, speed: 0 }, 0, DT);
  assert.deepEqual(idle, { distance: 3, speed: 0 });

  // The threshold is A0 * u <= rollingFriction, that is u <= 0.0625.
  const weak = stepLongitudinal({ distance: 3, speed: 0 }, 0.06, DT);
  assert.deepEqual(weak, { distance: 3, speed: 0 });

  const enough = stepLongitudinal({ distance: 3, speed: 0 }, 0.07, DT);
  assert.ok(enough.speed > 0);
  assert.ok(enough.distance > 3);
});

test('one step from rest uses semi-implicit Euler', () => {
  const next = stepLongitudinal({ distance: 0, speed: 0 }, 1, DT);
  const speed = (8 - 0.5) * DT;
  near(next.speed, speed, 1e-15);
  near(next.distance, speed * DT, 1e-15);
});

test('above the speed the throttle can sustain, the motor slows the car', () => {
  // At throttle 0.2 the motor would hold 1 m/s, so 4 m/s must slow down.
  assert.ok(netAcceleration(4, 0.2) < 0);
  const history = run({ distance: 0, speed: 4 }, 0.2, 5);
  assert.ok(history[history.length - 1].speed < 4);
});

test('releasing the throttle brakes harder than a low throttle', () => {
  assert.ok(netAcceleration(3, 0) < netAcceleration(3, 0.01));
});

test('the throttle is clamped and invalid values are rejected', () => {
  assert.equal(netAcceleration(2, 5), netAcceleration(2, 1));
  assert.equal(netAcceleration(2, -3), netAcceleration(2, 0));
  assert.throws(() => netAcceleration(2, Number.NaN), RangeError);
  assert.throws(() => stepLongitudinal({ distance: 0, speed: 0 }, 1, 0), RangeError);
  assert.throws(() => stepLongitudinal({ distance: 0, speed: 0 }, 1, -DT), RangeError);
});

test('the simulation is deterministic', () => {
  const sequence = [1, 1, 0.5, 0, 0, 1, 0.3, 1];
  const play = () => {
    let state = { distance: 0, speed: 0 };
    const trace = [];
    for (let i = 0; i < 2000; i += 1) {
      state = stepLongitudinal(state, sequence[i % sequence.length], DT);
      trace.push(state);
    }
    return trace;
  };
  assert.deepStrictEqual(play(), play());
});

test('parameters can be overridden and are validated', () => {
  const strong = withParams({ spinUpAcceleration: 16 });
  assert.equal(strong.spinUpAcceleration, 16);
  assert.equal(strong.freeSpeed, DEFAULT_PARAMS.freeSpeed);
  assert.ok(Object.isFrozen(strong));
  assert.ok(terminalSpeed(1, strong) > terminalSpeed(1));

  assert.throws(() => withParams({ unknownName: 1 }), RangeError);
  assert.throws(() => withParams({ freeSpeed: 0 }), RangeError);
  assert.throws(() => withParams({ airDrag: Number.NaN }), RangeError);
  assert.ok(Object.isFrozen(DEFAULT_PARAMS));
});

// Lateral grip and leaving the track.

const INNER_CURVATURE = 1 / 0.35;
const OUTER_CURVATURE = 1 / 0.45;

test('lateral acceleration grows with the square of the speed and the curvature', () => {
  near(lateralAcceleration(2, 0.5), 2, 1e-12);
  near(lateralAcceleration(4, 0.5), 8, 1e-12);
  assert.equal(lateralAcceleration(3, -0.5), lateralAcceleration(3, 0.5));
  assert.equal(lateralAcceleration(3, 0), 0);
});

test('the critical speed matches the oval lanes', () => {
  near(criticalSpeed(INNER_CURVATURE), Math.sqrt(12 * 0.35), 1e-12);
  near(criticalSpeed(INNER_CURVATURE), 2.049, 1e-3);
  near(criticalSpeed(OUTER_CURVATURE), 2.324, 1e-3);
  assert.equal(criticalSpeed(-INNER_CURVATURE), criticalSpeed(INNER_CURVATURE));
  assert.equal(criticalSpeed(0), Infinity);
});

test('the car keeps its grip just below the critical speed and loses it just above', () => {
  for (const curvature of [INNER_CURVATURE, OUTER_CURVATURE, -INNER_CURVATURE]) {
    const limit = criticalSpeed(curvature);
    assert.equal(hasLostGrip(limit * (1 - 1e-6), curvature), false);
    assert.equal(hasLostGrip(limit * (1 + 1e-6), curvature), true);
  }
});

test('the car never loses grip on a straight', () => {
  for (const speed of [0, 1, 4.4, 100, 1e6]) {
    assert.equal(hasLostGrip(speed, 0), false);
  }
});

test('full throttle is too fast for the curves, while a moderate throttle holds', () => {
  assert.ok(terminalSpeed(1) > criticalSpeed(INNER_CURVATURE));
  assert.ok(terminalSpeed(1) > criticalSpeed(OUTER_CURVATURE));
  assert.ok(terminalSpeed(0.3) < criticalSpeed(INNER_CURVATURE));
  // Half throttle holds on the wide outer lane but not on the tight inner one.
  assert.ok(terminalSpeed(0.5) > criticalSpeed(INNER_CURVATURE));
  assert.ok(terminalSpeed(0.5) < criticalSpeed(OUTER_CURVATURE));
});

test('a car sliding off the track slows down at the table deceleration', () => {
  let state = { travel: 0, speed: 4 };
  let previous = state;
  let steps = 0;
  while (state.speed > 0) {
    state = stepOffTrack(state, DT);
    assert.ok(state.speed < previous.speed);
    assert.ok(state.travel >= previous.travel);
    previous = state;
    steps += 1;
    assert.ok(steps < 1000, 'the car never stopped');
  }
  // From 4 m/s it takes v / a seconds and covers v^2 / (2a) meters.
  const deceleration = DEFAULT_PARAMS.offTrackDeceleration;
  near(steps * DT, 4 / deceleration, 2 * DT);
  near(state.travel, 16 / (2 * deceleration), 0.02);
  assert.equal(state.speed, 0);
  assert.deepEqual(stepOffTrack(state, DT), state);
});

test('free rotation conserves angular momentum without torque', () => {
  const params = { ...DEFAULT_PARAMS, offTrackFrictionTorque: 0 };
  for (const yawRate of [-8, 0, 8]) {
    const state = { rotation: 1, yawRate, speed: 3 };
    const after = stepOffTrackRotation(state, 0.25, params);
    assert.equal(after.yawRate, yawRate);
    near(after.rotation, 1 + yawRate * 0.25, 1e-12);
  }
});

test('rotational friction dissipates energy and greater inertia slows the loss', () => {
  for (const sign of [-1, 1]) {
    const params = withParams({ offTrackFrictionTorque: 0.04, bodyRadiusOfGyration: 0.05 });
    const state = { rotation: 0, yawRate: sign * 4, speed: 1 };
    const after = stepOffTrackRotation(state, 0.25, params);
    near(after.yawRate, sign * 2, 1e-12);
    near(after.rotation, sign * 0.75, 1e-12);
    assert.ok(after.yawRate ** 2 < state.yawRate ** 2);
    const heavier = stepOffTrackRotation(state, 0.25, { ...params, bodyRadiusOfGyration: 0.1 });
    assert.ok(Math.abs(heavier.yawRate) > Math.abs(after.yawRate));
    const stopped = stepOffTrackRotation(state, 2, params);
    assert.equal(stopped.yawRate, 0);
    near(stopped.rotation, sign, 1e-12);
    assert.deepEqual(stepOffTrackRotation({ ...stopped, speed: 1 }, 1, params), stopped);
    let split = state;
    for (let i = 0; i < 200; i += 1) split = stepOffTrackRotation({ ...split, speed: 1 }, 0.01, params);
    near(split.rotation, stopped.rotation, 1e-12);
    assert.equal(split.yawRate, 0);
  }
});

test('off-track rotational damping increases as the car slows down', () => {
  for (const sign of [-1, 1]) {
    const atSpeed = (speed) => stepOffTrackRotation({ rotation: 0, yawRate: sign * 12, speed }, 0.05);
    const fast = atSpeed(3);
    const slow = atSpeed(1);
    const stationary = atSpeed(0);
    assert.ok(Math.abs(fast.yawRate) > Math.abs(slow.yawRate));
    assert.ok(Math.abs(slow.yawRate) > Math.abs(stationary.yawRate));
    assert.ok(Math.abs(fast.rotation) > Math.abs(slow.rotation));
    assert.ok(Math.abs(slow.rotation) > Math.abs(stationary.rotation));
  }
});

test('a car with no translational speed cannot keep spinning in place', () => {
  for (const yawRate of [-12, 12]) {
    assert.deepEqual(stepOffTrackRotation({ rotation: 1, yawRate, speed: 0 }, DT), {
      rotation: 1, yawRate: 0,
    });
  }
});

test('off-track rotation rejects invalid state and time steps', () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    assert.throws(() => stepOffTrackRotation({ rotation: 0, yawRate: 1 }, dt), RangeError);
  }
  assert.throws(() => stepOffTrackRotation({ rotation: NaN, yawRate: 1 }, DT), RangeError);
  assert.throws(() => stepOffTrackRotation({ rotation: 0, yawRate: Infinity }, DT), RangeError);
  for (const speed of [-1, NaN, Infinity]) {
    assert.throws(() => stepOffTrackRotation({ rotation: 0, yawRate: 1, speed }, DT), RangeError);
  }
});

test('grip functions reject invalid arguments', () => {
  assert.throws(() => lateralAcceleration(2, Number.NaN), RangeError);
  assert.throws(() => criticalSpeed(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => hasLostGrip(2, Number.NaN), RangeError);
  assert.throws(() => stepOffTrack({ travel: 0, speed: 1 }, 0), RangeError);
});

test('the grip parameters can be overridden', () => {
  const grippy = withParams({ maxLateralAcceleration: 24 });
  assert.ok(criticalSpeed(INNER_CURVATURE, grippy) > criticalSpeed(INNER_CURVATURE));
  assert.equal(hasLostGrip(2.2, INNER_CURVATURE), true);
  assert.equal(hasLostGrip(2.2, INNER_CURVATURE, grippy), false);
  const slippery = withParams({ offTrackDeceleration: 2 * DEFAULT_PARAMS.offTrackDeceleration });
  assert.ok(
    stepOffTrack({ travel: 0, speed: 4 }, DT, slippery).speed
      < stepOffTrack({ travel: 0, speed: 4 }, DT).speed,
  );
});

// The body pivots about the guide pin and the tail may slide out.

const REAR = DEFAULT_PARAMS.pinToRearAxle;
const GRIP = DEFAULT_PARAMS.maxLateralAcceleration;

/** Speed that needs the given lateral acceleration on the given curvature. */
function speedFor(lateral, curvature) {
  return Math.sqrt(lateral / Math.abs(curvature));
}

/** Angle of the body to the lane while the tail rolls on a constant curve. */
function rollingSlip(curvature, params = DEFAULT_PARAMS) {
  return -Math.asin(params.pinToRearAxle * curvature);
}

/** The state of a tail rolling steadily on a constant curve. */
function rollingState(speed, curvature, params = DEFAULT_PARAMS) {
  return { slip: rollingSlip(curvature, params), yawRate: speed * curvature, rearSlip: 0 };
}

/** Runs the yaw model on a constant curve at a constant speed. */
function circle(state, speed, curvature, seconds, { dt = DT, params = DEFAULT_PARAMS } = {}) {
  const turn = speed * curvature * dt;
  const steps = Math.round(seconds / dt);
  const history = [state];
  for (let i = 0; i < steps; i += 1) {
    state = stepYaw(state, { speed, curvature, turn }, dt, params);
    history.push(state);
  }
  return history;
}

function last(list) {
  return list[list.length - 1];
}

function deepFreeze(value) {
  for (const inner of Object.values(value)) {
    if (inner !== null && typeof inner === 'object') deepFreeze(inner);
  }
  return Object.freeze(value);
}

test('the yaw model leaves a car that drives straight exactly aligned', () => {
  const history = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 3, 0, 5);
  for (const state of history) {
    assert.ok(state.slip === 0, `slip ${state.slip}`);
    assert.ok(state.yawRate === 0, `yaw rate ${state.yawRate}`);
    assert.ok(state.rearSlip === 0, `rear slip ${state.rearSlip}`);
  }
  assert.deepEqual(Object.keys(last(history)).sort(), ['rearSlip', 'slip', 'yawRate']);
});

test('below the grip limit the tail rolls behind the pin, on the inside of the curve', () => {
  const start = { slip: 0, yawRate: 0, rearSlip: 0 };
  const history = circle(start, 1.5, INNER_CURVATURE, 2);
  near(rollingSlip(INNER_CURVATURE), -0.2306, 1e-4);
  near(last(history).slip, rollingSlip(INNER_CURVATURE), 1e-6);
  near(last(history).yawRate, 1.5 * INNER_CURVATURE, 1e-6);
  for (const state of history) assert.ok(state.rearSlip === 0, `rear slip ${state.rearSlip}`);
  // A curve to the right mirrors a curve to the left exactly.
  const mirrored = circle(start, 1.5, -INNER_CURVATURE, 2);
  // Zero is compared without its sign: -0 and 0 are the same value here.
  const unsigned = (x) => (x === 0 ? 0 : x);
  assert.deepStrictEqual(
    mirrored.map((s) => ({ slip: unsigned(s.slip), yawRate: unsigned(s.yawRate), rearSlip: unsigned(s.rearSlip) })),
    history.map((s) => ({ slip: unsigned(-s.slip), yawRate: unsigned(-s.yawRate), rearSlip: unsigned(-s.rearSlip) })),
  );
});

test('the slide starts just above the grip limit and not just below it', () => {
  // With the tail rolling inside, the limit is a little above the plain 12 m/s^2.
  const onset = GRIP / Math.sqrt(1 - (REAR * INNER_CURVATURE) ** 2);
  assert.ok(onset > GRIP);
  near(onset, 12.33, 0.01);

  const below = speedFor(0.99 * onset, INNER_CURVATURE);
  const holding = circle(rollingState(below, INNER_CURVATURE), below, INNER_CURVATURE, 3);
  for (const state of holding) {
    assert.ok(state.rearSlip === 0, `rear slip ${state.rearSlip}`);
    near(state.slip, rollingSlip(INNER_CURVATURE), 1e-9);
  }

  const above = speedFor(1.01 * onset, INNER_CURVATURE);
  const sliding = circle(rollingState(above, INNER_CURVATURE), above, INNER_CURVATURE, 3);
  assert.ok(sliding.some((state) => state.rearSlip !== 0));
  // The tail ends up outside the curve at acos(limit / lateral acceleration).
  const lateral = lateralAcceleration(above, INNER_CURVATURE);
  near(last(sliding).slip, Math.acos(GRIP / lateral), 0.01);
  assert.ok(last(sliding).slip > 0);
});

test('above the limit the tail opens gradually and settles outside the curve', () => {
  const calm = circle(
    { slip: 0, yawRate: 0, rearSlip: 0 },
    1.5,
    INNER_CURVATURE,
    2,
  );
  const history = circle(last(calm), 2.2, INNER_CURVATURE, 3);
  const target = Math.acos(GRIP / lateralAcceleration(2.2, INNER_CURVATURE));
  near(target, 0.5201, 1e-4);
  near(last(history).slip, target, 0.01);

  let largestStep = 0;
  let highest = -Infinity;
  for (let i = 1; i < history.length; i += 1) {
    largestStep = Math.max(largestStep, Math.abs(history[i].slip - history[i - 1].slip));
    highest = Math.max(highest, history[i].slip);
  }
  assert.ok(largestStep < 0.05, `largest step ${largestStep}`);
  assert.ok(highest < target + 0.01, `overshoot ${highest - target}`);

  // The rear axle slides toward the outside of the curve: to the right (negative)
  // in a curve to the left, to the left (positive) in a curve to the right. Its
  // sideways speed is the velocity of the axle across the body.
  assert.ok(last(history).rearSlip < 0, `rear slip ${last(history).rearSlip}`);
  const rightCalm = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 1.5, -INNER_CURVATURE, 2);
  const rightHistory = circle(last(rightCalm), 2.2, -INNER_CURVATURE, 3);
  assert.ok(last(rightHistory).rearSlip > 0, `rear slip ${last(rightHistory).rearSlip}`);
  for (let i = 1; i < history.length; i += 1) {
    if (history[i].rearSlip === 0) continue;
    const across = -2.2 * Math.sin(history[i - 1].slip) - REAR * history[i].yawRate;
    near(history[i].rearSlip, across, 1e-12, `step ${i}`);
  }

  // The opening takes time: halfway there is not reached in the first 0.2 s.
  const halfway = (rollingSlip(INNER_CURVATURE) + target) / 2;
  const reached = history.findIndex((state) => state.slip >= halfway);
  assert.ok(reached > 0.2 / DT, `halfway after ${reached} steps`);
  assert.ok(history.some((state) => state.rearSlip !== 0));
});

test('when the speed drops the tail grips again and comes back in line', () => {
  const calm = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 1.5, INNER_CURVATURE, 2);
  const open = circle(last(calm), 2.2, INNER_CURVATURE, 3);
  const back = circle(last(open), 1.5, INNER_CURVATURE, 1);
  near(last(back).slip, rollingSlip(INNER_CURVATURE), 1e-3);
  assert.ok(last(back).rearSlip === 0);
});

test('the slide dies out thanks to the damping and would not without it', () => {
  const start = rollingState(2.1, INNER_CURVATURE);
  const spread = (history) => {
    const slips = history.slice(-Math.round(1 / DT)).map((state) => state.slip);
    return Math.max(...slips) - Math.min(...slips);
  };
  const damped = circle(start, 2.1, INNER_CURVATURE, 8);
  assert.ok(spread(damped) < 1e-3, `spread ${spread(damped)}`);
  const free = withParams({ slideDamping: 1e-6 });
  const swinging = circle(start, 2.1, INNER_CURVATURE, 8, { params: free });
  assert.ok(spread(swinging) > 0.1, `spread ${spread(swinging)}`);
});

test('the car spins out only above the angle limit', () => {
  const calm = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 1.5, INNER_CURVATURE, 2);
  const firm = circle(last(calm), 2.2, INNER_CURVATURE, 4);
  assert.ok(firm.every((state) => !hasSpunOut(state.slip)));
  const fast = circle(last(calm), 2.4, INNER_CURVATURE, 4);
  assert.ok(fast.some((state) => hasSpunOut(state.slip)));
});

test('the yaw model converges as the time step shrinks', () => {
  const calm = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 1.5, INNER_CURVATURE, 2);
  const slipAfter = (dt) => last(circle(last(calm), 2.2, INNER_CURVATURE, 0.5, { dt })).slip;
  const reference = slipAfter(1 / 1920);
  const errors = [1 / 60, 1 / 120, 1 / 240, 1 / 480].map((dt) => Math.abs(slipAfter(dt) - reference));
  for (let i = 1; i < errors.length; i += 1) {
    assert.ok(errors[i] < errors[i - 1], `errors ${errors}`);
  }
  assert.ok(errors[1] < 0.05, `errors ${errors}`);
});

test('the yaw model rejects a step that is too coarse and invalid arguments', () => {
  const state = { slip: 0, yawRate: 0 };
  const motion = { speed: 2, curvature: 1, turn: 0.01 };
  assert.doesNotThrow(() => stepYaw(state, motion, DT));
  // The car must not cover the pin-to-axle distance in a single step.
  assert.throws(() => stepYaw(state, { ...motion, speed: 10 }, DT), RangeError);
  assert.throws(() => stepYaw(state, motion, 1), RangeError);
  assert.throws(() => stepYaw(state, motion, 0), RangeError);
  assert.throws(() => stepYaw(state, motion, -DT), RangeError);
  assert.throws(() => stepYaw(state, { ...motion, speed: -1 }, DT), RangeError);
  assert.throws(() => stepYaw(state, { ...motion, speed: Number.NaN }, DT), RangeError);
  assert.throws(() => stepYaw(state, { ...motion, curvature: Number.NaN }, DT), RangeError);
  assert.throws(() => stepYaw(state, { ...motion, turn: Number.POSITIVE_INFINITY }, DT), RangeError);
  assert.throws(() => stepYaw({ slip: Number.NaN, yawRate: 0 }, motion, DT), RangeError);
  assert.throws(() => stepYaw({ slip: 0, yawRate: Number.NaN }, motion, DT), RangeError);
});

test('the yaw model is pure, deterministic and does not touch its arguments', () => {
  const state = deepFreeze({ slip: 0.1, yawRate: 1, rearSlip: 0 });
  const motion = deepFreeze({ speed: 2.2, curvature: INNER_CURVATURE, turn: 2.2 * INNER_CURVATURE * DT });
  const first = stepYaw(state, motion, DT, DEFAULT_PARAMS);
  assert.deepStrictEqual(stepYaw(state, motion, DT, DEFAULT_PARAMS), first);
  assert.deepStrictEqual(stepYaw(state, motion, DT), first);
  assert.notEqual(first, state);
});

test('the tail parameters are positive, documented defaults that can be overridden', () => {
  for (const name of [
    'pinToCenterOfMass',
    'pinToRearAxle',
    'bodyRadiusOfGyration',
    'slideDamping',
    'maxSlipAngle',
  ]) {
    assert.ok(Number.isFinite(DEFAULT_PARAMS[name]) && DEFAULT_PARAMS[name] > 0, name);
    assert.throws(() => withParams({ [name]: 0 }), RangeError);
    assert.throws(() => withParams({ [name]: Number.NaN }), RangeError);
  }
  const short = withParams({ pinToRearAxle: 0.04 });
  assert.equal(short.pinToRearAxle, 0.04);
  near(rollingSlip(INNER_CURVATURE, short), -Math.asin(0.04 * INNER_CURVATURE), 1e-15);
  const settled = circle({ slip: 0, yawRate: 0, rearSlip: 0 }, 1.5, INNER_CURVATURE, 2, { params: short });
  near(last(settled).slip, rollingSlip(INNER_CURVATURE, short), 1e-6);
});

test('the spin-out test is strict, symmetric and uses the angle limit', () => {
  const limit = DEFAULT_PARAMS.maxSlipAngle;
  assert.equal(hasSpunOut(limit), false);
  assert.equal(hasSpunOut(limit * (1 + 1e-9)), true);
  assert.equal(hasSpunOut(-limit), false);
  assert.equal(hasSpunOut(-limit * (1 + 1e-9)), true);
  assert.equal(hasSpunOut(0), false);
  const strict = withParams({ maxSlipAngle: 0.3 });
  assert.equal(hasSpunOut(0.4, strict), true);
  assert.equal(hasSpunOut(0.4), false);
  assert.throws(() => hasSpunOut(Number.NaN), RangeError);
});

// A sliding tail costs speed.

const REAR_GRIP = (GRIP * DEFAULT_PARAMS.pinToCenterOfMass) / REAR;

test('a tail that holds, or a car at rest, costs no speed', () => {
  near(REAR_GRIP, 6, 1e-12);
  assert.equal(scrubDeceleration(2, 0), 0);
  assert.equal(scrubDeceleration(0, 3), 0);
  assert.equal(scrubDeceleration(0, 0), 0);
});

test('the scrub deceleration is the friction work of the sideways slide divided by the speed', () => {
  // Below the speed of the car: grip * u / v.
  near(scrubDeceleration(2, 0.5), (REAR_GRIP * 0.5) / 2, 1e-12);
  near(scrubDeceleration(4, 1), (REAR_GRIP * 1) / 4, 1e-12);
  // The power taken from the car is the grip force times the sliding speed.
  near(scrubDeceleration(3, 0.9) * 3, REAR_GRIP * 0.9, 1e-12);
  // It does not depend on which side the tail slides to.
  assert.equal(scrubDeceleration(2, -0.5), scrubDeceleration(2, 0.5));
});

test('the scrub deceleration never exceeds the grip of the rear wheels', () => {
  for (const speed of [0.01, 0.5, 1, 2, 4.4]) {
    let previous = 0;
    for (const sliding of [0.001, 0.1, 0.5, 1, 2, 4.4, 10, 1000]) {
      const value = scrubDeceleration(speed, sliding);
      assert.ok(value > 0, `speed ${speed} slide ${sliding}`);
      assert.ok(value <= REAR_GRIP, `speed ${speed} slide ${sliding}`);
      assert.ok(value >= previous, `speed ${speed} slide ${sliding}`);
      previous = value;
    }
  }
  // When the slide is as fast as the car or faster, the whole grip brakes it.
  assert.equal(scrubDeceleration(2, 2), REAR_GRIP);
  assert.equal(scrubDeceleration(2, 50), REAR_GRIP);
});

test('the scrub deceleration stays within the rear grip for any finite speeds, even huge ones', () => {
  // The product grip * slide would overflow here, though the ratio is one half.
  assert.equal(scrubDeceleration(1e308, 5e307), REAR_GRIP / 2);
  assert.equal(scrubDeceleration(1e308, -5e307), REAR_GRIP / 2);
  near(scrubDeceleration(1e308, 1e307), REAR_GRIP / 10, 1e-12);
  assert.equal(scrubDeceleration(1e308, 1e308), REAR_GRIP);
  assert.equal(scrubDeceleration(1, 1e308), REAR_GRIP);
  // The other end of the range. A ratio below the smallest number that can be
  // represented underflows to zero, and so does the deceleration (1e-300 / 1e300).
  assert.equal(scrubDeceleration(1e300, 1e-300), 0);
  // A tiny ratio that can be represented (1e-150 / 1e150 = 1e-300) stays in
  // proportion: the grip times the ratio, and not zero.
  const tiny = scrubDeceleration(1e150, 1e-150);
  assert.ok(tiny > 0 && Math.abs(tiny / (REAR_GRIP * 1e-300) - 1) < 1e-12, `got ${tiny}`);
  for (const speed of [1e-300, 1e-10, 1, 1e10, 1e300, Number.MAX_VALUE]) {
    for (const ratio of [1e-9, 0.25, 0.5, 0.999999, 1, 3]) {
      const value = scrubDeceleration(speed, Math.min(Number.MAX_VALUE, speed * ratio));
      assert.ok(Number.isFinite(value) && value >= 0 && value <= REAR_GRIP, `speed ${speed} ratio ${ratio}: ${value}`);
    }
  }
});

test('the scrub deceleration follows the parameters and rejects invalid arguments', () => {
  const grippy = withParams({ maxLateralAcceleration: 24 });
  near(scrubDeceleration(2, 0.5, grippy), 2 * scrubDeceleration(2, 0.5), 1e-12);
  const short = withParams({ pinToRearAxle: 0.04 });
  near(scrubDeceleration(2, 0.5, short), 2 * scrubDeceleration(2, 0.5), 1e-12);
  assert.throws(() => scrubDeceleration(-1, 0.5), RangeError);
  assert.throws(() => scrubDeceleration(Number.NaN, 0.5), RangeError);
  assert.throws(() => scrubDeceleration(2, Number.NaN), RangeError);
  assert.throws(() => scrubDeceleration(2, Number.POSITIVE_INFINITY), RangeError);
});

test('an extra resistance slows the car and, at zero, changes nothing at all', () => {
  const sequence = [1, 1, 0.5, 0, 0, 1, 0.3, 1];
  let plain = { distance: 0, speed: 0 };
  let zero = { distance: 0, speed: 0 };
  for (let i = 0; i < 2000; i += 1) {
    plain = stepLongitudinal(plain, sequence[i % sequence.length], DT);
    zero = stepLongitudinal(zero, sequence[i % sequence.length], DT, DEFAULT_PARAMS, 0);
    assert.deepStrictEqual(zero, plain, `step ${i}`);
  }

  const state = { distance: 1, speed: 2 };
  const free = stepLongitudinal(state, 0.5, DT);
  const slowed = stepLongitudinal(state, 0.5, DT, DEFAULT_PARAMS, 3);
  near(slowed.speed, free.speed - 3 * DT, 1e-12);
  // The new speed moves the car, as in the plain step.
  near(slowed.distance, state.distance + slowed.speed * DT, 1e-12);
  assert.ok(slowed.distance < free.distance);
});

test('an extra resistance never reverses the car or holds a moving car back from rest', () => {
  const stopped = stepLongitudinal({ distance: 5, speed: 0.01 }, 0, DT, DEFAULT_PARAMS, 50);
  assert.deepEqual(stopped, { distance: 5, speed: 0 });
  // At rest, a resistance above the push keeps the car at rest.
  const held = stepLongitudinal({ distance: 5, speed: 0 }, 1, DT, DEFAULT_PARAMS, 50);
  assert.deepEqual(held, { distance: 5, speed: 0 });
});

test('the extra resistance is validated', () => {
  const state = { distance: 0, speed: 1 };
  assert.throws(() => stepLongitudinal(state, 1, DT, DEFAULT_PARAMS, -1), RangeError);
  assert.throws(() => stepLongitudinal(state, 1, DT, DEFAULT_PARAMS, Number.NaN), RangeError);
  assert.throws(() => stepLongitudinal(state, 1, DT, DEFAULT_PARAMS, Number.POSITIVE_INFINITY), RangeError);
});

test('a car that slides its tail on a curve is slowed by the scrub, step after step', () => {
  // The same loop twice, on a constant curve at half throttle: the speed moves
  // the pin, the pin turns the body, and the slide of the tail may slow the car.
  const drive = (useScrub) => {
    let yaw = { slip: 0, yawRate: 0, rearSlip: 0 };
    let car = { distance: 0, speed: 2.2 };
    let scrubbed = 0;
    for (let i = 0; i < 360; i += 1) {
      const resistance = useScrub ? scrubDeceleration(car.speed, yaw.rearSlip) : 0;
      if (resistance > 0) scrubbed += 1;
      car = stepLongitudinal(car, 0.5, DT, DEFAULT_PARAMS, resistance);
      yaw = stepYaw(
        yaw,
        { speed: car.speed, curvature: INNER_CURVATURE, turn: car.speed * INNER_CURVATURE * DT },
        DT,
      );
    }
    return { car, scrubbed };
  };
  const plain = drive(false);
  const scrubbing = drive(true);
  assert.equal(plain.scrubbed, 0);
  assert.ok(scrubbing.scrubbed > 0, 'the tail never slid');
  assert.ok(scrubbing.car.speed < plain.car.speed, `${scrubbing.car.speed} against ${plain.car.speed}`);
  assert.ok(scrubbing.car.speed > 0);
});
