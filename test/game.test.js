import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from './helpers/circuits.js';
import { createContext } from '../src/core/simulation.js';
import { createControls } from '../src/core/controls.js';
import { createGame } from '../src/core/game.js';
import { timingSummary } from '../src/core/timing.js';
import { createLapTimer, recordCrossing, advanceTimer } from '../src/core/lapTimer.js';

const context = createContext({ lane: buildCircuit(OVAL).lanes.inner });
const FRAME_MS = 1000 / 60;

test('loading and restarting retain timing history while resetting the car and current attempt', () => {
  const initialTimer = advanceTimer(recordCrossing(createLapTimer(), 0), {
    previousTime: 0, dt: 8, previousDistance: 0, distance: 4, laneLength: 4,
  }).timer;
  const controls = createControls();
  const game = createGame({ context, controls, initialTimer });
  assert.equal(game.world.timer.lapStart, null);
  assert.equal(game.world.timer.best.time, 8);
  assert.equal(game.world.timer.laps.length, 1);
  game.frame(0);
  controls.keyDown('Space');
  for (let i = 1; i <= 60; i += 1) game.frame(i * FRAME_MS);
  assert.notEqual(game.world.timer.lapStart, null);
  const before = game.world.timer;
  controls.keyUp('Space');
  controls.keyDown('KeyR');
  const result = game.frame(61 * FRAME_MS);
  assert.equal(result.restarted, true);
  assert.equal(result.world.timer.lapStart, null);
  assert.equal(result.world.timer.laps, before.laps);
  assert.equal(result.world.timer.best, before.best);
  assert.equal(result.world.timer.bestSectors, before.bestSectors);
  assert.equal(result.world.timer.bestSplits, before.bestSplits);
  assert.equal(result.world.car.speed, 0);
  assert.equal(result.world.car.distance, context.startDistance);
});

function setup() {
  const controls = createControls();
  const game = createGame({ context, controls });
  let now = 0;
  /** Runs `count` frames of 1/60 s and returns the last result. */
  function frames(count) {
    let result;
    for (let i = 0; i < count; i += 1) {
      result = game.frame(now);
      now += FRAME_MS;
    }
    return result;
  }
  return { controls, game, frames, advanceClock: (ms) => { now += ms; } };
}

test('the first frame runs no step, because no time has elapsed yet', () => {
  const { game, frames } = setup();
  const result = frames(1);
  assert.equal(result.world.stepIndex, 0);
  assert.equal(result.paused, false);
  assert.equal(result.restarted, false);
  assert.equal(game.world.stepIndex, 0);
});

test('frames of 1/60 s give two steps of 1/120 s each', () => {
  const { game, frames } = setup();
  frames(1);
  const result = frames(60);
  assert.equal(result.world.stepIndex, 120);
  assert.equal(result.world.time, 120 * context.dt);
  assert.equal(game.world, result.world);
});

test('holding the throttle moves the car, and releasing it brakes', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  const running = frames(30);
  assert.ok(running.world.car.speed > 0);
  assert.ok(running.world.car.distance > context.startDistance);
  controls.keyUp('Space');
  const braking = frames(60);
  assert.ok(braking.world.car.speed < running.world.car.speed);
});

test('while paused nothing changes: not the world, not the time, not the lap clock', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  const before = frames(40);
  assert.ok(before.world.timer.lapStart !== null, 'the lap clock should be running');

  controls.keyDown('KeyP');
  const first = frames(1);
  assert.equal(first.paused, true);
  const lapAtPause = timingSummary(first.world).currentLap;

  for (let i = 0; i < 120; i += 1) {
    const result = frames(1);
    assert.equal(result.paused, true);
    assert.equal(result.world, first.world, `frame ${i}`);
    assert.equal(result.drawn, first.world, `frame ${i}`);
    assert.equal(result.world.time, first.world.time);
    assert.equal(timingSummary(result.world).currentLap, lapAtPause);
  }
  // The throttle fell to zero and does not rise while paused, even if the key
  // is still held.
  assert.equal(controls.demanding, true);
  assert.equal(controls.throttle, 0);
});

test('resuming does not make up for the time spent in pause', () => {
  const { controls, game, frames, advanceClock } = setup();
  frames(1);
  controls.keyDown('KeyP');
  frames(10);
  const pausedWorld = game.world;

  // A long pause on the wall clock.
  advanceClock(60_000);
  controls.keyDown('KeyP', { repeat: false });
  controls.keyUp('KeyP');
  assert.equal(controls.paused, false);

  const resumed = frames(1);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.world.stepIndex, pausedWorld.stepIndex, 'no catching up on the first frame');
  const next = frames(1);
  assert.equal(next.world.stepIndex, pausedWorld.stepIndex + 2);
});

test('after a pause the throttle ramp starts again from zero', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  frames(30);
  assert.ok(controls.throttle > 0.5);
  controls.keyDown('KeyP');
  frames(1);
  controls.keyDown('KeyP');
  controls.keyUp('KeyP');
  frames(1);
  assert.equal(controls.throttle, 0);
  frames(2);
  assert.ok(controls.throttle > 0 && controls.throttle < 0.2, `throttle ${controls.throttle}`);
});

test('a restart starts a new race and also ends the pause', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  frames(90);
  controls.keyUp('Space');
  controls.keyDown('KeyP');
  const paused = frames(1);
  assert.equal(paused.paused, true);
  assert.ok(paused.world.stepIndex > 100);

  controls.keyDown('KeyR');
  const restarted = frames(1);
  assert.equal(restarted.restarted, true);
  assert.equal(restarted.paused, false);
  assert.equal(controls.paused, false);
  assert.equal(controls.throttle, 0);
  assert.ok(restarted.world.stepIndex < 5, `step ${restarted.world.stepIndex}`);
  assert.equal(restarted.world.car.status, 'onTrack');
  assert.ok(Math.abs(restarted.world.car.distance - context.startDistance) < 1e-3);
  assert.equal(restarted.world.timer.lapStart, null);
  assert.equal(restarted.world.timer.laps.length, 0);

  // The request is taken once: the next frame is not a restart.
  assert.equal(frames(1).restarted, false);
});

test('a frame after a very long gap is capped, and resetClock forgets the gap', () => {
  const capped = setup();
  capped.frames(1);
  capped.advanceClock(10_000);
  const result = capped.frames(1);
  // The stepper takes at most 0.25 s of a frame: 30 steps of 1/120 s.
  assert.equal(result.world.stepIndex, 30);

  const reset = setup();
  reset.frames(1);
  reset.advanceClock(10_000);
  reset.game.resetClock();
  assert.equal(reset.frames(1).world.stepIndex, 0);
});

test('the same inputs at the same times give the same worlds', () => {
  const play = () => {
    const { controls, frames } = setup();
    const trace = [];
    frames(1);
    for (let second = 0; second < 6; second += 1) {
      if (second % 2 === 0) controls.keyDown('Space');
      else controls.keyUp('Space');
      for (let i = 0; i < 30; i += 1) trace.push(frames(1).world);
    }
    return trace;
  };
  assert.deepStrictEqual(play(), play());
});

test('the drawn world lies between the previous and the current step', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  for (let i = 0; i < 20; i += 1) {
    const { world, drawn } = frames(1);
    assert.ok(drawn.car.distance <= world.car.distance + 1e-12);
    assert.ok(drawn.car.distance >= context.startDistance);
  }
});

test('the frame reports every step it ran, oldest first, the last one being the world', () => {
  const { controls, game, frames } = setup();
  // The first frame runs no step.
  assert.deepStrictEqual(frames(1).steps, []);
  controls.keyDown('Space');
  let seen = 0;
  for (let i = 0; i < 30; i += 1) {
    const { world, steps } = frames(1);
    // Frames of 1/60 s are two steps of 1/120 s.
    assert.equal(steps.length, 2, `frame ${i}`);
    assert.equal(steps[0].stepIndex, seen + 1);
    assert.equal(steps[1].stepIndex, seen + 2);
    assert.equal(steps[1], world);
    seen += 2;
  }
  assert.equal(game.world.stepIndex, seen);

  // A long gap is capped at 0.25 s, so at most 30 steps, all of them reported.
  const gap = setup();
  gap.frames(1);
  gap.advanceClock(10_000);
  const capped = gap.frames(1);
  assert.equal(capped.steps.length, 30);
  assert.deepStrictEqual(capped.steps.map((w) => w.stepIndex), Array.from({ length: 30 }, (_, i) => i + 1));
});

test('a frame that runs no step, such as one in a pause, reports no step', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  frames(10);
  controls.keyDown('KeyP');
  for (let i = 0; i < 5; i += 1) assert.deepStrictEqual(frames(1).steps, []);
});

test('on a restart the steps are those of the new race', () => {
  const { controls, frames } = setup();
  frames(1);
  controls.keyDown('Space');
  frames(90);
  controls.keyDown('KeyR');
  const result = frames(1);
  assert.equal(result.restarted, true);
  assert.ok(result.steps.length > 0);
  assert.deepStrictEqual(result.steps.map((w) => w.stepIndex), result.steps.map((_, i) => i + 1));
  assert.equal(result.steps[result.steps.length - 1], result.world);
});

test('an invalid frame time is rejected', () => {
  const { game } = setup();
  assert.throws(() => game.frame(Number.NaN), RangeError);
  assert.throws(() => game.frame(Number.POSITIVE_INFINITY), RangeError);
});
