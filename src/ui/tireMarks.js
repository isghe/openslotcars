/**
 * Marks that the rear tires leave on the track while the tail slides.
 *
 * It is only a visual aid and does not touch the simulation. The page reports
 * to `record` the world after every simulation step, and the module keeps the
 * short line segments that the two rear wheels traced between two consecutive
 * steps while they were sliding sideways (`rearSlip` not zero). Each segment
 * fades out linearly over the lifetime and is then forgotten, so the memory
 * stays small. The marks are made of the steps and not of the frames that are
 * drawn, so they are the same whatever the frame rate: a slow frame brings
 * several steps at once.
 *
 * Each segment also has a strength, which follows how hard the tail slides at
 * that moment. The intensity of a slide is the share of the rear grip that
 * works against the car, `min(1, |rearSlip| / speed)`, the same ratio that
 * `scrubDeceleration` uses, so it is how much speed the slide takes from the
 * car relative to the most it can take. The strength is that intensity divided
 * by `fullIntensity`, up to 1: proportional below it, and as strong as it gets
 * above it.
 *
 * Each segment has a heat as well, which goes on where the strength stops: 0 up
 * to `fullIntensity` and then rising in proportion to 1 at `hotIntensity`. The
 * strength says how visible a mark is, the heat how close the slide was to
 * losing the car; the page uses it to tint the mark.
 *
 * Time is the time of the world, in seconds, so a pause (the same world again)
 * freezes the marks. A restart clears them: `reset` says so, and a world whose
 * time goes back does the same.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import { carPose } from '../core/simulation.js';

/**
 * Longest time between two recorded worlds for their marks to be joined, in
 * seconds. The worlds of consecutive steps are far closer than this; after a
 * longer gap there is no mark between them, because it would be a long line
 * across the track.
 */
const MAX_GAP = 0.1;

function checkPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** How hard the tail slides, from 0 (not at all) to 1 (the whole rear grip). */
function slideIntensity(car) {
  return Math.min(1, Math.abs(car.rearSlip) / car.speed);
}

/**
 * @param {{lifetime?: number, halfTrack?: number, fullIntensity?: number}}
 *   [options] `lifetime` is how long a mark lasts, in seconds; `halfTrack` is
 *   the distance of each rear wheel from the axis of the car, in meters;
 *   `fullIntensity` is the intensity of a slide from which a mark is as strong
 *   as it gets. The default, 0.4, is about the hardest slide of a fast lap
 *   (measured on the oval: lap of 2.28 s, intensities up to 0.41, and 95% of
 *   the sliding steps below 0.3); harder slides, up to the spin-out, saturate.
 *   `hotIntensity` is the intensity from which a mark is as hot as it gets. The
 *   default, 0.7, is a choice of the drawing: the hardest slides of a hand-driven
 *   lap, at the edge of the spin-out, were measured at 0.57 to 0.63 for a
 *   stretch, and a slide at full throttle from a standstill ends at 0.88 when
 *   the car spins out. If it is not above `fullIntensity` there is no range to
 *   go through: a mark is cool up to `fullIntensity` and hot above it.
 */
export function createTireMarks({
  lifetime = 2,
  halfTrack = 0.022,
  fullIntensity = 0.4,
  hotIntensity = 0.7,
} = {}) {
  checkPositive('lifetime', lifetime);
  checkPositive('halfTrack', halfTrack);
  checkPositive('fullIntensity', fullIntensity);
  checkPositive('hotIntensity', hotIntensity);

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
      intensity: slideIntensity(world.car),
      left: { x: axle.x + halfTrack * side.x, y: axle.y + halfTrack * side.y },
      right: { x: axle.x - halfTrack * side.x, y: axle.y - halfTrack * side.y },
    };
  }

  return {
    /** Forgets every mark and the world before: the race started again. */
    reset() {
      marks = [];
      previous = null;
      lastTime = -Infinity;
    },

    /**
     * Takes note of the world after a simulation step.
     * @param {object} world World after a step (see `createWorld`).
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
        // The same world again, for instance when the world is drawn again.
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
        // The mark is as strong as the slide was between the two worlds.
        const intensity = (previous.intensity + current.intensity) / 2;
        const strength = Math.min(1, intensity / fullIntensity);
        let heat = 0;
        if (intensity > fullIntensity) {
          heat = hotIntensity > fullIntensity
            ? Math.min(1, (intensity - fullIntensity) / (hotIntensity - fullIntensity))
            : 1;
        }
        for (const wheel of ['left', 'right']) {
          marks.push({
            x1: previous[wheel].x,
            y1: previous[wheel].y,
            x2: current[wheel].x,
            y2: current[wheel].y,
            time,
            strength,
            heat,
          });
        }
      }
      previous = current;
    },

    /**
     * The marks to draw at a given time, oldest first.
     * @param {number} time Time in seconds, normally that of the drawn world.
     * @returns {Array<{x1: number, y1: number, x2: number, y2: number, alpha: number, strength: number, heat: number}>}
     *   `alpha` is 1 for a mark just made and falls to 0 at the end of its
     *   lifetime; marks that are older than that are not returned. `strength`,
     *   above 0 and up to 1, follows how hard the tail slid; it does not change
     *   with time, so the mark to paint is as opaque as `alpha * strength`.
     *   `heat`, from 0 to 1, is how far the slide went beyond the full intensity
     *   (see the top of the file); it does not change with time either.
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
          strength: mark.strength,
          heat: mark.heat,
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
