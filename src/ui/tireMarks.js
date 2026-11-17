/**
 * Marks that the rear tires leave on the track while the tail slides.
 *
 * It is only a visual aid and does not touch the simulation. The page reports
 * every world it draws to `record`, and the module keeps the short line
 * segments that the two rear wheels traced between two consecutive drawn
 * worlds while they were sliding sideways (`rearSlip` not zero). Each segment
 * fades out linearly over the lifetime and is then forgotten, so the memory
 * stays small. The marks are made of the worlds that are drawn, not of every
 * simulation step, so their shape depends a little on the frame rate.
 *
 * Time is the time of the world, in seconds, so a pause (the same world drawn
 * again) freezes the marks and a restart (the time goes back) clears them.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import { carPose } from '../core/simulation.js';

/**
 * Longest time between two drawn worlds for their marks to be joined, in
 * seconds. After a longer gap, such as a hidden page, there is no mark between
 * them: it would be a long line across the track.
 */
const MAX_GAP = 0.1;

function checkPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/**
 * @param {{lifetime?: number, halfTrack?: number}} [options] `lifetime` is how
 *   long a mark lasts, in seconds; `halfTrack` is the distance of each rear
 *   wheel from the axis of the car, in meters.
 */
export function createTireMarks({ lifetime = 2, halfTrack = 0.022 } = {}) {
  checkPositive('lifetime', lifetime);
  checkPositive('halfTrack', halfTrack);

  let marks = [];
  let lastTime = -Infinity;
  let previous = null;

  /** The two rear wheels of the car in the world, from the pose of the body. */
  function wheelsOf(world, context) {
    const pose = carPose(world, context);
    const { pinToCenterOfMass: front, pinToRearAxle: rear } = context.params;
    // The axle is `rear - front` behind the center of the body.
    const axle = {
      x: pose.x - (rear - front) * Math.cos(pose.heading),
      y: pose.y - (rear - front) * Math.sin(pose.heading),
    };
    const side = { x: -Math.sin(pose.heading), y: Math.cos(pose.heading) };
    return {
      time: world.time,
      left: { x: axle.x + halfTrack * side.x, y: axle.y + halfTrack * side.y },
      right: { x: axle.x - halfTrack * side.x, y: axle.y - halfTrack * side.y },
    };
  }

  return {
    /**
     * Takes note of a drawn world.
     * @param {object} world World to draw (see `createWorld`).
     * @param {object} context Simulation context; with the tail rule off the
     *   car has no sliding tail and nothing is recorded.
     */
    record(world, context) {
      if (!context.tailSlide) return;
      const { time } = world;
      if (time < lastTime) {
        // The race restarted.
        marks = [];
        previous = null;
      } else if (time === lastTime) {
        // The same world again, for instance while the game is paused.
        return;
      }
      lastTime = time;

      const cutoff = time - lifetime;
      let expired = 0;
      while (expired < marks.length && marks[expired].time <= cutoff) expired += 1;
      if (expired > 0) marks = marks.slice(expired);

      const car = world.car;
      if (car.status !== 'onTrack' || car.rearSlip === 0) {
        previous = null;
        return;
      }
      const current = wheelsOf(world, context);
      if (previous !== null && time - previous.time <= MAX_GAP) {
        for (const wheel of ['left', 'right']) {
          marks.push({
            x1: previous[wheel].x,
            y1: previous[wheel].y,
            x2: current[wheel].x,
            y2: current[wheel].y,
            time,
          });
        }
      }
      previous = current;
    },

    /**
     * The marks to draw at a given time, oldest first.
     * @param {number} time Time in seconds, normally that of the drawn world.
     * @returns {Array<{x1: number, y1: number, x2: number, y2: number, alpha: number}>}
     *   `alpha` is 1 for a mark just made and falls to 0 at the end of its
     *   lifetime; marks that are older than that are not returned.
     */
    segments(time) {
      const visible = [];
      for (const mark of marks) {
        const age = time - mark.time;
        if (age >= lifetime) continue;
        visible.push({
          x1: mark.x1,
          y1: mark.y1,
          x2: mark.x2,
          y2: mark.y2,
          alpha: Math.min(1, 1 - age / lifetime),
        });
      }
      return visible;
    },

    /** Number of marks kept in memory. */
    get size() {
      return marks.length;
    },
  };
}
