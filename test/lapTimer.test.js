import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLapTimer,
  crossings,
  crossingTime,
  recordCrossing,
  markExit,
  restartLapTimer,
  advanceTimer,
  currentLapTime,
  formatLapTime,
  sectorFeedback,
  cumulativeFeedback,
} from '../src/core/lapTimer.js';

const L = 6;

test('sector feedback is white without a valid attempt, yellow when slower and green for records and ties', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  let time = 0;
  let distance = 0;
  const complete = (duration, exit = false) => {
    if (exit) timer = markExit(timer);
    ({ timer } = advanceTimer(deepFreeze(timer), {
      previousTime: time, dt: duration, previousDistance: distance,
      distance: distance + L / 4, laneLength: L,
    }));
    time += duration;
    distance += L / 4;
  };
  assert.deepEqual(sectorFeedback(timer), Array(4).fill('white'));
  complete(1, true);
  assert.deepEqual(sectorFeedback(timer), Array(4).fill('white'));
  for (let i = 0; i < 4; i += 1) complete(2);
  assert.deepEqual(sectorFeedback(timer), Array(4).fill('green'));
  for (const duration of [3, 2, 1, 3]) complete(duration);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'yellow', 'green', 'green']);
  // The tied third sector stays green without replacing the record object.
  assert.notEqual(timer.lastSectors[2], timer.bestSectors[2]);
  complete(1, true);
  assert.equal(sectorFeedback(timer)[1], 'white');
  assert.deepEqual(sectorFeedback(restartLapTimer(timer)), Array(4).fill('white'));
});

test('green sector records and purple cumulative records are independent', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  let time = 0;
  let distance = 0;
  const complete = (duration, exit = false) => {
    if (exit) timer = markExit(timer);
    ({ timer } = advanceTimer(deepFreeze(timer), {
      previousTime: time, dt: duration, previousDistance: distance,
      distance: distance + L / 4, laneLength: L,
    }));
    time += duration;
    distance += L / 4;
  };
  assert.deepEqual(cumulativeFeedback(timer), [false, false, false, false]);
  for (let i = 0; i < 4; i += 1) complete(4);
  assert.deepEqual(sectorFeedback(timer), ['green', 'green', 'green', 'green']);
  assert.deepEqual(cumulativeFeedback(timer), [true, true, true, true]);
  for (const duration of [6, 3, 2, 4]) complete(duration);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'green', 'green', 'green']);
  assert.deepEqual(cumulativeFeedback(timer), [false, false, true, true]);
  assert.deepEqual(timer.lastSplits.map(split => split.time), [6, 9, 11, 15]);
  assert.deepEqual(timer.bestSplits.map(split => split.time), [4, 8, 11, 15]);
  assert.equal(timer.bestSplits[3].time, timer.best.time);
  const bestSplits = timer.bestSplits;
  complete(1, true);
  complete(1);
  // A later clean sector can set a record after an exit; elapsed times cannot.
  assert.equal(sectorFeedback(timer)[1], 'green');
  assert.equal(cumulativeFeedback(timer)[0], false);
  assert.equal(cumulativeFeedback(timer)[1], false);
  assert.deepEqual(timer.bestSplits, bestSplits);
  assert.deepEqual(cumulativeFeedback(createLapTimer()), [false, false, false, false]);
});

test('sector feedback compares each attempt with its own session best and persists between crossings', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  assert.deepEqual(sectorFeedback(timer), ['white', 'white', 'white', 'white']);
  let time = 0;
  let distance = 0;
  const complete = (duration, exit = false) => {
    if (exit) timer = markExit(timer);
    ({ timer } = advanceTimer(deepFreeze(timer), {
      previousTime: time, dt: duration, previousDistance: distance,
      distance: distance + L / 4, laneLength: L,
    }));
    time += duration;
    distance += L / 4;
  };
  for (let i = 0; i < 4; i += 1) complete(2);
  assert.deepEqual(sectorFeedback(timer), ['green', 'green', 'green', 'green']);
  const bestLap = timer.best;
  complete(3);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'green', 'green', 'green']);
  complete(2);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'green', 'green', 'green']);
  complete(1, true);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'green', 'white', 'green']);
  complete(1);
  assert.deepEqual(sectorFeedback(timer), ['yellow', 'green', 'white', 'green']);
  assert.equal(timer.best, bestLap);
  assert.deepEqual(timer.bestSectors.map(sector => sector.time), [2, 2, 2, 1]);
  assert.equal(timer.laps[1].valid, false);
  const between = advanceTimer(timer, {
    previousTime: time, dt: 0.1, previousDistance: distance, distance: distance + 0.1, laneLength: L,
  }).timer;
  assert.equal(between, timer);
  assert.deepEqual(sectorFeedback(createLapTimer()), ['white', 'white', 'white', 'white']);
});

test('four equal-distance sectors retain individual durations and sum to the lap', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  let time = 0;
  for (let sector = 1; sector <= 4; sector += 1) {
    const before = deepFreeze(timer);
    ({ timer } = advanceTimer(before, {
      previousTime: time, dt: sector,
      previousDistance: (sector - 1) * L / 4, distance: sector * L / 4, laneLength: L,
    }));
    time += sector;
    assert.equal(timer.laps.length, sector === 4 ? 1 : 0);
    assert.equal(timer.currentSectors.length, sector % 4);
  }
  assert.deepEqual(timer.laps[0].sectors, [1, 2, 3, 4].map(number => ({
    number, time: number, valid: true, wasBest: true, lapNumber: 1,
  })));
  near(timer.laps[0].sectors.reduce((sum, sector) => sum + sector.time, 0), timer.laps[0].time);
});

test('one step can start timing and close all four sectors without counting the approach', () => {
  const { timer } = advanceTimer(createLapTimer(), {
    previousTime: 0, dt: 9, previousDistance: -1, distance: 8, laneLength: 8,
  });
  near(timer.laps[0].time, 8);
  assert.deepEqual(timer.laps[0].sectors.map(sector => sector.time), [2, 2, 2, 2]);
  assert.equal(timer.sectorStart, 9);
  assert.deepEqual(timer.currentSectors, []);
});

test('a sector boundary is timed once, even if the car then stops on it', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  ({ timer } = advanceTimer(timer, {
    previousTime: 0, dt: 1, previousDistance: 0, distance: L / 4, laneLength: L,
  }));
  const stopped = advanceTimer(timer, {
    previousTime: 1, dt: 5, previousDistance: L / 4, distance: L / 4, laneLength: L,
  });
  assert.equal(stopped.timer, timer);
  ({ timer } = advanceTimer(timer, {
    previousTime: 6, dt: 1, previousDistance: L / 4, distance: L / 2, laneLength: L,
  }));
  assert.deepEqual(timer.currentSectors.map(sector => sector.time), [1, 6]);
});

test('an exit invalidates its sector and lap, while the next sector is clean', () => {
  let timer = recordCrossing(createLapTimer(), 0);
  for (let sector = 1; sector <= 4; sector += 1) {
    if (sector === 2) timer = markExit(timer);
    ({ timer } = advanceTimer(timer, {
      previousTime: sector - 1, dt: 1,
      previousDistance: (sector - 1) * L / 4, distance: sector * L / 4, laneLength: L,
    }));
  }
  assert.equal(timer.laps[0].valid, false);
  assert.deepEqual(timer.laps[0].sectors.map(sector => sector.valid), [true, false, true, true]);
  assert.equal(timer.best, null);
  assert.equal(timer.currentSectorHadExit, false);
  assert.deepEqual(createLapTimer().currentSectors, []);
});

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

test('exit details belong to their lap and reset for the next attempt', () => {
  let timer = recordCrossing(createLapTimer(), 10);
  ({ timer } = advanceTimer(timer, {
    previousTime: 10, dt: 1, previousDistance: 0, distance: 1, laneLength: 4,
  }));
  timer = markExit(deepFreeze(timer), { time: 11.5, distance: 5.5, laneLength: 4 });
  ({ timer } = advanceTimer(timer, {
    previousTime: 11, dt: 1, previousDistance: 1, distance: 2, laneLength: 4,
  }));
  timer = markExit(deepFreeze(timer), { time: 12.5, distance: 6.5, laneLength: 4 });
  ({ timer } = advanceTimer(timer, {
    previousTime: 12, dt: 2, previousDistance: 2, distance: 4, laneLength: 4,
  }));
  assert.deepEqual(timer.laps[0].exits, [
    { time: 1.5, distance: 1.5, sector: 2 },
    { time: 2.5, distance: 2.5, sector: 3 },
  ]);
  assert.deepEqual(timer.currentExits, []);
  const exited = markExit(timer, { time: 14.25, distance: 8.25, laneLength: 4 });
  assert.deepEqual(exited.currentExits, [{ time: 0.25, distance: 0.25, sector: 1 }]);
  assert.deepEqual(restartLapTimer(exited).currentExits, []);
  assert.deepEqual(restartLapTimer(exited).laps, timer.laps);
  const completed = recordCrossing(exited, 18);
  assert.deepEqual(completed.laps[1].exits, [{ time: 0.25, distance: 0.25, sector: 1 }]);
  assert.equal(markExit(createLapTimer(), { time: 0, distance: -0.1, laneLength: 4 }).lapStart, null);
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

test('lap times can be formatted with fewer decimals', () => {
  assert.equal(formatLapTime(4.213, 1), '4.2 s');
  assert.equal(formatLapTime(4.26, 1), '4.3 s');
  assert.equal(formatLapTime(4.213, 2), '4.21 s');
  assert.equal(formatLapTime(64.26, 1), '1:04.3');
  assert.equal(formatLapTime(59.96, 1), '1:00.0');
  assert.equal(formatLapTime(0, 1), '0.0 s');
  assert.equal(formatLapTime(4.213, 3), formatLapTime(4.213));
});

test('the number of decimals is validated', () => {
  assert.throws(() => formatLapTime(4, 0), RangeError);
  assert.throws(() => formatLapTime(4, 4), RangeError);
  assert.throws(() => formatLapTime(4, 1.5), RangeError);
  assert.throws(() => formatLapTime(4, Number.NaN), RangeError);
});
