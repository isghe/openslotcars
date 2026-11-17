import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls, KEY_ACTIONS, THROTTLE_RAMP_TIME } from '../src/core/controls.js';

const DT = 1 / 120;

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

function run(controls, steps) {
  for (let i = 0; i < steps; i += 1) controls.step(DT);
}

test('the throttle starts released and stays so without input', () => {
  const controls = createControls();
  run(controls, 100);
  assert.equal(controls.throttle, 0);
  assert.equal(controls.demanding, false);
  assert.equal(controls.paused, false);
});

test('a held key raises the throttle linearly up to full', () => {
  const controls = createControls();
  assert.equal(controls.keyDown('Space'), true);
  run(controls, 24);
  near(controls.throttle, 24 * DT / THROTTLE_RAMP_TIME);
  near(controls.throttle, 0.5);
  run(controls, 100);
  assert.equal(controls.throttle, 1);
});

test('releasing the key drops the throttle to zero at once', () => {
  const controls = createControls();
  controls.keyDown('Space');
  run(controls, 30);
  assert.ok(controls.throttle > 0.5);
  controls.keyUp('Space');
  controls.step(DT);
  assert.equal(controls.throttle, 0);
});

test('a short tap gives a partial throttle', () => {
  const controls = createControls();
  controls.keyDown('ArrowUp');
  run(controls, 12);
  const peak = controls.throttle;
  controls.keyUp('ArrowUp');
  controls.step(DT);
  assert.ok(peak > 0.2 && peak < 0.3, `peak ${peak}`);
  assert.equal(controls.throttle, 0);
});

test('Space and the up arrow both work and release independently', () => {
  const controls = createControls();
  controls.keyDown('Space');
  controls.keyDown('ArrowUp');
  controls.keyUp('Space');
  run(controls, 5);
  assert.ok(controls.throttle > 0);
  assert.equal(controls.demanding, true);
  controls.keyUp('ArrowUp');
  assert.equal(controls.demanding, false);
});

test('key auto-repeat does not change the state', () => {
  const controls = createControls();
  controls.keyDown('Space');
  for (let i = 0; i < 10; i += 1) controls.keyDown('Space', { repeat: true });
  controls.keyUp('Space');
  assert.equal(controls.demanding, false);
});

test('a pointer on the throttle button works like a key', () => {
  const controls = createControls();
  controls.pointerDown(1);
  run(controls, 12);
  assert.ok(controls.throttle > 0);
  controls.pointerDown(2);
  controls.pointerUp(1);
  assert.equal(controls.demanding, true);
  controls.pointerUp(2);
  controls.step(DT);
  assert.equal(controls.throttle, 0);
});

test('releaseAll clears keys and pointers', () => {
  const controls = createControls();
  controls.keyDown('Space');
  controls.pointerDown(7);
  controls.releaseAll();
  controls.step(DT);
  assert.equal(controls.demanding, false);
  assert.equal(controls.throttle, 0);
});

test('P and Escape toggle the pause, but not while the key repeats', () => {
  const controls = createControls();
  controls.keyDown('KeyP');
  assert.equal(controls.paused, true);
  controls.keyDown('KeyP', { repeat: true });
  assert.equal(controls.paused, true);
  controls.keyUp('KeyP');
  controls.keyDown('Escape');
  assert.equal(controls.paused, false);
});

test('pausing drops the throttle and resuming starts the ramp again from zero', () => {
  const controls = createControls();
  controls.keyDown('Space');
  run(controls, 30);
  assert.ok(controls.throttle > 0.5);
  controls.setPaused(true);
  assert.equal(controls.throttle, 0);
  // The key is still held: it counts again after the pause.
  assert.equal(controls.demanding, true);
  controls.setPaused(false);
  assert.equal(controls.throttle, 0);
  controls.step(DT);
  near(controls.throttle, DT / THROTTLE_RAMP_TIME);
});

test('R requests one restart, which is taken once', () => {
  const controls = createControls();
  assert.equal(controls.takeRestart(), false);
  controls.keyDown('KeyR');
  controls.keyDown('KeyR', { repeat: true });
  assert.equal(controls.takeRestart(), true);
  assert.equal(controls.takeRestart(), false);
  controls.requestRestart();
  assert.equal(controls.takeRestart(), true);
});

test('resetThrottle sets the throttle back to zero', () => {
  const controls = createControls();
  controls.keyDown('Space');
  run(controls, 30);
  controls.resetThrottle();
  assert.equal(controls.throttle, 0);
});

test('keys of the game are recognized and other keys are left to the browser', () => {
  const controls = createControls();
  for (const code of Object.keys(KEY_ACTIONS)) {
    assert.equal(controls.keyDown(code), true, code);
    assert.equal(controls.keyUp(code), true, code);
  }
  assert.equal(controls.keyDown('KeyZ'), false);
  assert.equal(controls.keyUp('KeyZ'), false);
  assert.equal(controls.keyDown('Tab'), false);
});

test('the ramp follows a custom time and is deterministic', () => {
  const play = () => {
    const controls = createControls({ rampTime: 1 });
    controls.keyDown('Space');
    run(controls, 60);
    return controls.throttle;
  };
  near(play(), 0.5);
  assert.equal(play(), play());
});

test('invalid options and steps are rejected', () => {
  assert.throws(() => createControls({ rampTime: 0 }), RangeError);
  assert.throws(() => createControls({ rampTime: Number.NaN }), RangeError);
  const controls = createControls();
  assert.throws(() => controls.step(0), RangeError);
  assert.throws(() => controls.step(Number.NaN), RangeError);
});

test('isHeld tells which throttle keys are down', () => {
  const controls = createControls();
  assert.equal(controls.isHeld('Space'), false);
  controls.keyDown('Space');
  assert.equal(controls.isHeld('Space'), true);
  assert.equal(controls.isHeld('ArrowUp'), false);
  controls.keyUp('Space');
  assert.equal(controls.isHeld('Space'), false);
  // Keys that are not throttle keys are never held.
  controls.keyDown('KeyP');
  assert.equal(controls.isHeld('KeyP'), false);
  assert.equal(controls.isHeld('KeyZ'), false);
});
