/**
 * Fixed time step accumulator.
 *
 * The simulation always advances by the same time step, whatever the rate of
 * the frames shown on screen. The stepper collects the real time elapsed
 * between frames and tells how many whole simulation steps to run for each
 * frame, so that the results do not depend on the frame rate.
 *
 * This module is pure logic: it never reads a clock, the caller passes the
 * duration of each frame.
 */

// Tolerance, in fractions of a step, for sums of frame durations that land
// exactly on a step boundary but are off by a rounding error.
const BOUNDARY_TOLERANCE = 1e-9;

/**
 * Creates a stepper.
 * @param {{dt: number, maxFrame?: number}} options `dt` is the simulation step
 *   in seconds. `maxFrame` caps the time taken into account for a single
 *   frame, so that a long pause (for example a hidden tab) does not trigger a
 *   burst of steps afterwards.
 */
export function createStepper({ dt, maxFrame = 0.25 }) {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${dt}`);
  }
  if (!Number.isFinite(maxFrame) || maxFrame < dt) {
    throw new RangeError(`maxFrame must be a finite number of at least dt, got ${maxFrame}`);
  }

  let accumulator = 0;

  return {
    dt,
    maxFrame,

    /**
     * Adds the duration of a frame.
     * @param {number} frameSeconds Real time elapsed since the previous frame.
     * @returns {{steps: number, alpha: number}} The number of simulation steps
     *   to run and the fraction of a step left over, from 0 to 1, which is
     *   useful to interpolate the drawing between two states.
     */
    advance(frameSeconds) {
      if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
        throw new RangeError(`frameSeconds must be a finite number, zero or more, got ${frameSeconds}`);
      }
      accumulator += Math.min(frameSeconds, maxFrame);
      const steps = Math.floor(accumulator / dt + BOUNDARY_TOLERANCE);
      accumulator = Math.max(0, accumulator - steps * dt);
      return { steps, alpha: Math.min(1, accumulator / dt) };
    },

    /** Forgets the time collected so far, for example after a pause. */
    reset() {
      accumulator = 0;
    },
  };
}
