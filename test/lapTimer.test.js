import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLapTimer,
  crossings,
  crossingTime,
  recordCrossing,
  markExit,
  advanceTimer,
  currentLapTime,
  formatLapTime,
} from '../src/core/lapTimer.js';

const L = 6;

function near(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, got ${actual}`,
  );
}

/** Recursively freezes a value, to prove that functions do not mutate it. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('crossings finds the lines between two distances', () => {
  assert.deepEqual(crossings(-0.1, 0.05, L), [0]);
  assert.deepEqual(crossings(0.1, 0.2, L), []);
  assert.deepEqual(crossings(L - 0.01, L + 0.01, L), [1]);
  assert.deepEqual(crossings(0.1, 2.2 * L, L), [1, 2]);
  assert.deepEqual(crossings(3 * L + 0.1, 3 * L + 0.2, L), []);
});

test('a crossing that ends exactly on the line counts once', () => {
  assert.deepEqual(crossings(L - 1, L, L), [1]);
  assert.deepEqual(crossings(L, L + 1, L), []);
});

test('crossings ignores steps in which the car does not advance', () => {
  assert.deepEqual(crossings(2, 2, L), []);
  assert.deepEqual(crossings(2, 1, L), []);
});

test('the crossing instant is interpolated inside the step', () => {
  // Speed 10 m/s, step of 0.1 s, line at 5.3 m: 0.3 m past the step start.
  near(crossingTime(2, 0.1, 5, 6, 5.3), 2.03);
});

test('the first crossing starts the clock without recording a lap', () => {
  const timer = recordCrossing(createLapTimer(), 1.5);
  assert.equal(timer.lapStart, 1.5);
  assert.deepEqual(timer.laps, []);
  assert.equal(timer.best, null);
});

test('later crossings close laps and keep the best valid one', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  timer = recordCrossing(timer, 5);
  timer = recordCrossing(timer, 9);
  timer = recordCrossing(timer, 15);
  assert.deepEqual(timer.laps.map((lap) => lap.time), [5, 4, 6]);
  assert.deepEqual(timer.laps.map((lap) => lap.number), [1, 2, 3]);
  assert.deepEqual(timer.laps.map((lap) => lap.valid), [true, true, true]);
  assert.equal(timer.best.number, 2);
  assert.equal(timer.best.time, 4);
});

test('an equal time does not replace the best lap', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  timer = recordCrossing(timer, 4);
  timer = recordCrossing(timer, 8);
  assert.equal(timer.best.number, 1);
});

test('a lap with an exit is recorded but never counts as the best one', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  timer = markExit(timer);
  timer = recordCrossing(timer, 3);
  assert.equal(timer.laps[0].valid, false);
  assert.equal(timer.laps[0].time, 3);
  assert.equal(timer.best, null);

  // The next lap is clean again, although slower than the one with the exit.
  timer = recordCrossing(timer, 10);
  assert.equal(timer.laps[1].valid, true);
  assert.equal(timer.best.number, 2);
  assert.equal(timer.best.time, 7);
});

test('an exit before the clock starts is ignored', () => {
  let timer = markExit(createLapTimer());
  assert.equal(timer.currentLapHadExit, false);
  timer = recordCrossing(timer, 0);
  timer = recordCrossing(timer, 5);
  assert.equal(timer.laps[0].valid, true);
});

test('several exits in the same lap still invalidate only that lap', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  timer = markExit(markExit(timer));
  timer = recordCrossing(timer, 4);
  timer = recordCrossing(timer, 8);
  assert.deepEqual(timer.laps.map((lap) => lap.valid), [false, true]);
});

test('at constant speed the lap time is the lane length over the speed', () => {
  const speed = 2.5;
  const dt = 1 / 120;
  const lapSeconds = L / speed;
  let timer = createLapTimer();
  let distance = -0.1;
  for (let step = 0; step < 120 * 40; step += 1) {
    const next = distance + speed * dt;
    ({ timer } = advanceTimer(timer, {
      previousTime: step * dt,
      dt,
      previousDistance: distance,
      distance: next,
      laneLength: L,
    }));
    distance = next;
  }
  assert.ok(timer.laps.length >= 15);
  for (const lap of timer.laps) near(lap.time, lapSeconds, 1e-9, `lap ${lap.number}`);
  near(timer.best.time, lapSeconds, 1e-9);
});

test('several crossings in one step give one interpolated lap each', () => {
  // The car crossed the line 0.2 s before this step and runs at 15 m/s, so a
  // lap takes 0.4 s. In one big step of 1 s it crosses the line three times.
  const started = recordCrossing(createLapTimer(), -0.2);
  const { timer, completed } = advanceTimer(started, {
    previousTime: 0,
    dt: 1,
    previousDistance: 3,
    distance: 18,
    laneLength: L,
  });
  assert.equal(completed.length, 3);
  assert.deepEqual(timer.laps, completed);
  for (const lap of completed) near(lap.time, 0.4);
  near(timer.lapStart, 1.0);
});

test('a step without crossings leaves the timer unchanged', () => {
  const started = recordCrossing(createLapTimer(), 0);
  const { timer, completed } = advanceTimer(started, {
    previousTime: 1,
    dt: 0.1,
    previousDistance: 2,
    distance: 2.5,
    laneLength: L,
  });
  assert.equal(timer, started);
  assert.deepEqual(completed, []);
});

test('the running lap time is measured from the last crossing', () => {
  assert.equal(currentLapTime(createLapTimer(), 3), null);
  const timer = recordCrossing(createLapTimer(), 2);
  near(currentLapTime(timer, 5.5), 3.5);
});

test('functions do not modify their arguments', () => {
  const started = deepFreeze(recordCrossing(createLapTimer(), 0));
  const exited = deepFreeze(markExit(started));
  const closed = deepFreeze(recordCrossing(exited, 4));
  assert.equal(started.currentLapHadExit, false);
  assert.equal(exited.currentLapHadExit, true);
  assert.deepEqual(started.laps, []);
  assert.equal(closed.laps.length, 1);
  deepFreeze(advanceTimer(closed, {
    previousTime: 4,
    dt: 1,
    previousDistance: 0,
    distance: 7,
    laneLength: L,
  }));
});

test('a crossing earlier than the lap start is rejected', () => {
  const started = recordCrossing(createLapTimer(), 5);
  assert.throws(() => recordCrossing(started, 4), RangeError);
});

test('invalid arguments are rejected', () => {
  assert.throws(() => crossings(0, 1, 0), RangeError);
  assert.throws(() => crossings(Number.NaN, 1, L), RangeError);
  assert.throws(() => recordCrossing(createLapTimer(), Number.NaN), RangeError);
  assert.throws(() => advanceTimer(createLapTimer(), {
    previousTime: 0,
    dt: 0,
    previousDistance: 0,
    distance: 1,
    laneLength: L,
  }), RangeError);
  assert.throws(() => currentLapTime(createLapTimer(), Number.NaN), RangeError);
});

test('lap times are formatted with milliseconds', () => {
  assert.equal(formatLapTime(0), '0.000 s');
  assert.equal(formatLapTime(4.213), '4.213 s');
  assert.equal(formatLapTime(4.2), '4.200 s');
  assert.equal(formatLapTime(59.9), '59.900 s');
  assert.equal(formatLapTime(64.2134), '1:04.213');
  assert.equal(formatLapTime(125), '2:05.000');
});

test('rounding to milliseconds carries over into the next unit', () => {
  assert.equal(formatLapTime(59.9996), '1:00.000');
  assert.equal(formatLapTime(0.9996), '1.000 s');
});

test('invalid lap times cannot be formatted', () => {
  assert.throws(() => formatLapTime(-1), RangeError);
  assert.throws(() => formatLapTime(Number.NaN), RangeError);
  assert.throws(() => formatLapTime(Number.POSITIVE_INFINITY), RangeError);
});
