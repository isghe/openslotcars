/**
 * Statistics of the animation frames, to see whether the game stutters.
 *
 * The page passes the time of each frame and how long its own code took in it;
 * the figures cover the most recent frames only. This module is pure logic: it
 * never reads a clock.
 */

// A frame counts as long when it lasts more than this many typical (median)
// intervals, so the threshold follows the refresh rate of the screen.
const LONG_FRAME_RATIO = 1.5;

/**
 * @param {{windowMs?: number}} [options] How far back the figures look.
 */
export function createFrameStats({ windowMs = 5000 } = {}) {
  let samples = [];
  let lastTime = null;

  return {
    /**
     * Adds a frame.
     * @param {number} now Time of the frame in milliseconds.
     * @param {number} workMs Time spent by the game code in this frame.
     */
    add(now, workMs) {
      if (lastTime !== null) samples.push({ now, interval: now - lastTime, workMs });
      lastTime = now;
      while (samples.length > 0 && now - samples[0].now >= windowMs) samples.shift();
    },

    /**
     * Marks an interruption (pause, hidden page): the time until the next frame
     * is not a frame interval. The frames already collected are kept.
     */
    gap() {
      lastTime = null;
    },

    /** Forgets everything. */
    reset() {
      samples = [];
      lastTime = null;
    },

    /**
     * @returns {null|{fps: number, worstMs: number, longFrames: number, worstWorkMs: number}}
     *   `fps` is the average rate, `worstMs` the longest interval, `longFrames`
     *   how many intervals were long and `worstWorkMs` the longest time spent by
     *   the game code. `null` before the second frame.
     */
    summary() {
      if (samples.length === 0) return null;
      const intervals = samples.map((sample) => sample.interval).sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      const total = intervals.reduce((sum, interval) => sum + interval, 0);
      return {
        fps: (1000 * intervals.length) / total,
        worstMs: intervals[intervals.length - 1],
        longFrames: intervals.filter((interval) => interval > LONG_FRAME_RATIO * median).length,
        worstWorkMs: Math.max(...samples.map((sample) => sample.workMs)),
      };
    },
  };
}
