import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from '../src/core/circuits.js';
import { createContext, createWorld, stepWorld } from '../src/core/simulation.js';
import {
  timingSummary,
  formatTiming,
  timingEvents,
  describeEvent,
} from '../src/core/timing.js';

const context = createContext({ lane: buildCircuit(OVAL).lanes.inner });

/** Worlds visited by a run, one per step, starting from the initial one. */
function run(seconds, throttleFor) {
  let world = createWorld(context);
  const history = [world];
  const steps = Math.round(seconds / context.dt);
  for (let i = 0; i < steps; i += 1) {
    world = stepWorld(world, { throttle: throttleFor(world, i) }, context);
    history.push(world);
  }
  return history;
}

/** Full throttle until the car leaves the track, then a moderate one. */
function exitThenModerate() {
  let left = false;
  return (world) => {
    if (world.car.status === 'offTrack') left = true;
    return left ? 0.3 : 1;
  };
}

/** Events found when the history is observed every `every` steps. */
function observe(history, every) {
  const events = [];
  let seen = history[0];
  for (let i = every; i < history.length; i += every) {
    events.push(...timingEvents(seen, history[i]));
    seen = history[i];
  }
  return events;
}

test('before the first crossing the clock has not started', () => {
  const summary = timingSummary(createWorld(context));
  assert.equal(summary.currentLap, null);
  assert.equal(summary.lastLap, null);
  assert.equal(summary.bestLap, null);
  assert.equal(summary.lapsCompleted, 0);
  assert.deepEqual(formatTiming(summary), {
    currentLap: 'not started',
    lastLap: 'none yet',
    bestLap: 'none yet',
    laps: '0',
  });
});

test('the running lap time is measured from the last crossing', () => {
  const history = run(1, () => 0.3);
  const world = history[history.length - 1];
  const summary = timingSummary(world);
  assert.ok(summary.currentLap > 0);
  assert.ok(Math.abs(summary.currentLap - (world.time - world.timer.lapStart)) < 1e-12);
  assert.match(formatTiming(summary).currentLap, /^\d\.\d s$/);
});

test('the running lap time does not move while the world stands still', () => {
  const history = run(1, () => 0.3);
  const world = history[history.length - 1];
  assert.equal(timingSummary(world).currentLap, timingSummary(world).currentLap);
});

test('closed laps are summarized with the best valid one', () => {
  const history = run(40, () => 0.3);
  const summary = timingSummary(history[history.length - 1]);
  assert.ok(summary.lapsCompleted >= 3);
  assert.equal(summary.lastLap.number, summary.lapsCompleted);
  const texts = formatTiming(summary);
  assert.match(texts.lastLap, /^\d\.\d{3} s$/);
  assert.match(texts.bestLap, /^\d\.\d{3} s$/);
  assert.equal(texts.laps, String(summary.lapsCompleted));
});

test('a lap with an exit is labeled and the running lap is labeled too', () => {
  const history = run(40, exitThenModerate());
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const afterExit = timingSummary(history[exitIndex]);
  assert.equal(afterExit.currentLapHadExit, true);
  assert.match(formatTiming(afterExit).currentLap, / \(off track\)$/);

  const last = timingSummary(history[history.length - 1]);
  assert.ok(last.lapsCompleted >= 2);
  const firstLap = formatTiming({ ...last, lastLap: history[history.length - 1].timer.laps[0] });
  assert.match(firstLap.lastLap, / \(off track\)$/);
});

test('minutes appear in a long running lap', () => {
  const summary = {
    currentLap: 75.34,
    currentLapHadExit: false,
    lastLap: null,
    bestLap: null,
    lapsCompleted: 0,
  };
  assert.equal(formatTiming(summary).currentLap, '1:15.3');
});

test('events are found whatever the observation interval', () => {
  const history = run(40, exitThenModerate());
  for (const every of [1, 2, 7, 60]) {
    const events = observe(history, every);
    const kinds = events.map((event) => event.type);
    assert.equal(kinds.filter((k) => k === 'exit').length, 1, `every ${every}`);
    assert.equal(kinds.filter((k) => k === 'recovered').length, 1, `every ${every}`);
    assert.ok(kinds.filter((k) => k === 'lap').length >= 2, `every ${every}`);
    assert.ok(kinds.indexOf('exit') < kinds.indexOf('recovered'), `every ${every}`);
  }
});

test('the lap with the exit is reported as not best and the next clean lap as the best one', () => {
  const events = observe(run(40, exitThenModerate()), 3).filter((event) => event.type === 'lap');
  assert.equal(events[0].lap.valid, false);
  assert.equal(events[0].isBest, false);
  assert.equal(events[1].lap.valid, true);
  assert.equal(events[1].isBest, true);
});

test('an exit before the clock starts does not count against a lap', () => {
  const history = run(3, () => 1);
  const exitIndex = history.findIndex((world) => world.car.status === 'offTrack');
  const [exit] = timingEvents(history[exitIndex - 1], history[exitIndex]);
  assert.equal(exit.type, 'exit');
  // The car crossed the line at the start of the run, so this exit counts.
  assert.equal(exit.countsAgainstLap, true);

  const fresh = createWorld(context);
  const offTrack = { ...fresh, stepIndex: 1, car: { ...fresh.car, status: 'offTrack' } };
  const [early] = timingEvents(fresh, offTrack);
  assert.equal(early.countsAgainstLap, false);
});

test('nothing is reported when nothing happened, or after a restart', () => {
  const history = run(2, () => 0.3);
  assert.deepEqual(timingEvents(history[10], history[11]), []);
  assert.deepEqual(timingEvents(history[10], history[10]), []);
  // After a restart the new world is older than the one shown before.
  assert.deepEqual(timingEvents(history[100], history[5]), []);
});

test('events are described in plain sentences', () => {
  const lap = { number: 2, time: 5.3416, valid: true };
  assert.equal(describeEvent({ type: 'lap', lap, isBest: false }), 'Lap 2: 5.342 s.');
  assert.equal(describeEvent({ type: 'lap', lap, isBest: true }), 'Lap 2: 5.342 s. New best lap.');
  assert.equal(
    describeEvent({ type: 'lap', lap: { ...lap, valid: false }, isBest: false }),
    'Lap 2: 5.342 s. Left the track in this lap, so it does not count.',
  );
  assert.equal(
    describeEvent({ type: 'exit', countsAgainstLap: true }),
    'Left the track. This lap will not count.',
  );
  assert.equal(describeEvent({ type: 'exit', countsAgainstLap: false }), 'Left the track.');
  assert.equal(describeEvent({ type: 'recovered' }), 'Back on the track.');
  assert.throws(() => describeEvent({ type: 'unknown' }), RangeError);
});

test('the summary does not modify the world', () => {
  const world = run(2, () => 0.3).pop();
  const copy = structuredClone(world);
  timingSummary(world);
  timingEvents(world, world);
  assert.deepEqual(world, copy);
});
