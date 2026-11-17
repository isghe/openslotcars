import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepper } from '../src/core/stepper.js';

const DT = 1 / 120;

function totalSteps(stepper, frames, frameSeconds) {
  let steps = 0;
  for (let i = 0; i < frames; i += 1) steps += stepper.advance(frameSeconds).steps;
  return steps;
}

test('frames of 1/60 s with a step of 1/120 s give two steps each', () => {
  const stepper = createStepper({ dt: DT });
  for (let i = 0; i < 100; i += 1) {
    assert.equal(stepper.advance(1 / 60).steps, 2, `frame ${i}`);
  }
});

test('a frame shorter than a step is carried over to the next ones', () => {
  const stepper = createStepper({ dt: 0.01 });
  assert.equal(stepper.advance(0.004).steps, 0);
  assert.equal(stepper.advance(0.004).steps, 0);
  assert.equal(stepper.advance(0.004).steps, 1);
  assert.equal(stepper.advance(0.004).steps, 0);
});

test('the same total time gives the same number of steps whatever the frame rate', () => {
  for (const [frames, frameSeconds] of [[60, 1 / 60], [30, 1 / 30], [100, 0.01], [10, 0.1], [1, 1]]) {
    // A cap high enough not to interfere with this test.
    const stepper = createStepper({ dt: DT, maxFrame: 1 });
    assert.equal(totalSteps(stepper, frames, frameSeconds), 120, `${frames} frames`);
  }
});

test('irregular frame durations also add up', () => {
  const stepper = createStepper({ dt: DT });
  const durations = [0.016, 0.017, 0.033, 0.008, 0.02, 0.0166, 0.0171, 0.0123];
  let elapsed = 0;
  let steps = 0;
  for (const duration of durations) {
    elapsed += duration;
    steps += stepper.advance(duration).steps;
  }
  assert.equal(steps, Math.floor(elapsed / DT));
});

test('alpha is the fraction of a step left over', () => {
  const stepper = createStepper({ dt: 0.01 });
  const { steps, alpha } = stepper.advance(0.025);
  assert.equal(steps, 2);
  assert.ok(Math.abs(alpha - 0.5) < 1e-9);
  const next = stepper.advance(0.005);
  assert.equal(next.steps, 1);
  assert.ok(next.alpha < 1e-6);
});

test('a very long frame is capped', () => {
  const stepper = createStepper({ dt: DT, maxFrame: 0.25 });
  assert.equal(stepper.advance(10).steps, 30);
  // Nothing remains from the discarded time.
  assert.equal(stepper.advance(0).steps, 0);
});

test('reset forgets the time collected so far', () => {
  const stepper = createStepper({ dt: 0.01 });
  stepper.advance(0.009);
  stepper.reset();
  assert.equal(stepper.advance(0.009).steps, 0);
});

test('invalid options and frames are rejected', () => {
  assert.throws(() => createStepper({ dt: 0 }), RangeError);
  assert.throws(() => createStepper({ dt: Number.NaN }), RangeError);
  assert.throws(() => createStepper({ dt: 0.01, maxFrame: 0.001 }), RangeError);
  const stepper = createStepper({ dt: 0.01 });
  assert.throws(() => stepper.advance(-1), RangeError);
  assert.throws(() => stepper.advance(Number.NaN), RangeError);
});
