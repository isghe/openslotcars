import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from '../src/core/frameStats.js';

const WORK = { sim: 1, save: 0, draw: 0 };

function feed(stats, intervals, start = 0) {
  let now = start;
  stats.add(now, WORK);
  for (const interval of intervals) {
    now += interval;
    stats.add(now, WORK);
  }
  return now;
}

test('there are no figures before the second frame', () => {
  const stats = createFrameStats();
  assert.equal(stats.summary(), null);
  stats.add(100, WORK);
  assert.equal(stats.summary(), null);
});

test('rate, worst interval, long frames and parts of the slowest code', () => {
  const stats = createFrameStats();
  const now = feed(stats, [20, 20, 20, 30, 31, 79]);
  stats.add(now + 20, { sim: 1, save: 4, draw: 2 });
  stats.add(now + 40, { sim: 3, save: 0, draw: 3 });
  stats.add(now + 60, WORK);
  assert.deepEqual(stats.summary(), {
    fps: 9000 / 260, worstMs: 79, longFrames: 2,
    slowestWork: { total: 7, sim: 1, save: 4, draw: 2 },
  });
});

test('a steady slow screen has no long frames', () => {
  const stats = createFrameStats();
  feed(stats, [33, 33, 33, 33]);
  assert.equal(stats.summary().longFrames, 0);
});

test('only the frames inside the window are counted', () => {
  const stats = createFrameStats({ windowMs: 100 });
  const now = feed(stats, [90]);
  assert.equal(stats.summary().worstMs, 90);
  for (let i = 1; i <= 10; i += 1) stats.add(now + 10 * i, WORK);
  assert.equal(stats.summary().worstMs, 10);
});

test('the time across a gap is not a frame; reset forgets all', () => {
  const stats = createFrameStats();
  const now = feed(stats, [16, 16]);
  stats.gap();
  feed(stats, [16], now + 3000);
  assert.equal(stats.summary().worstMs, 16);
  stats.reset();
  assert.equal(stats.summary(), null);
});
