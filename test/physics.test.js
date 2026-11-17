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
  // 4 m/s at 5 m/s^2 takes 0.8 s and covers v^2 / (2a) = 1.6 m.
  near(steps * DT, 0.8, 2 * DT);
  near(state.travel, 1.6, 0.02);
  assert.equal(state.speed, 0);
  assert.deepEqual(stepOffTrack(state, DT), state);
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
  const slippery = withParams({ offTrackDeceleration: 20 });
  assert.ok(
    stepOffTrack({ travel: 0, speed: 4 }, DT, slippery).speed
      < stepOffTrack({ travel: 0, speed: 4 }, DT).speed,
  );
});
