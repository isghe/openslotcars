import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  withParams,
  netAcceleration,
  terminalSpeed,
  stepLongitudinal,
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
