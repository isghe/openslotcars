/**
 * What happens in one animation frame, independent of the browser.
 *
 * The page calls `frame(now)` once per animation frame, passing the time of the
 * frame in milliseconds, and draws what it returns. The rules live here so they
 * can be tested in Node:
 *
 * - the real time elapsed is turned into a whole number of fixed simulation
 *   steps, and the throttle ramp of the controls advances once per step;
 * - while the game is paused no time passes: the world does not change, and the
 *   time spent in pause is not made up for when the game resumes;
 * - a restart resets the car and current attempt, retains timing records and ends the pause.
 *
 * This module is pure logic: it never reads a clock, the caller passes the
 * time of each frame.
 */

import { createWorld, stepWorld, interpolateWorld } from './simulation.js';
import { createStepper } from './stepper.js';
import { createLapTimer, restartLapTimer } from './lapTimer.js';

/**
 * @param {{context: object, controls: object, initialTimer?: object}} options `context` comes from
 *   `createContext`; `controls` from `createControls`.
 */
export function createGame({ context, controls, initialTimer = createLapTimer() }) {
  const stepper = createStepper({ dt: context.dt });
  let world = { ...createWorld(context), timer: restartLapTimer(initialTimer) };
  let previous = world;
  let lastFrameTime = null;

  return {
    /**
     * Advances the game up to the frame time `now`.
     * @param {number} now Time of the frame in milliseconds, from any origin
     *   as long as it never goes back.
     * @returns {{world: object, drawn: object, steps: object[], paused: boolean, restarted: boolean}}
     *   `world` is the state of the simulation, `drawn` the world to draw
     *   (interpolated between two steps), `steps` the world after each step run
     *   in this frame, oldest first (empty when none ran, as in a pause; if any
     *   ran, the last one is `world`), `paused` whether the game is paused and
     *   `restarted` whether a new race started in this frame.
     */
    frame(now) {
      if (!Number.isFinite(now)) {
        throw new RangeError(`now must be a finite number, got ${now}`);
      }

      const restarted = controls.takeRestart();
      if (restarted) {
        world = { ...createWorld(context), timer: restartLapTimer(world.timer) };
        previous = world;
        stepper.reset();
        controls.resetThrottle();
        controls.setPaused(false);
      }

      if (controls.paused) {
        // No time passes while paused: the next frame starts from zero.
        lastFrameTime = null;
        stepper.reset();
        return { world, drawn: world, steps: [], paused: true, restarted };
      }

      const elapsed = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      const { steps: count, alpha } = stepper.advance(elapsed);
      const steps = [];
      for (let i = 0; i < count; i += 1) {
        controls.step(context.dt);
        previous = world;
        world = stepWorld(world, { throttle: controls.throttle }, context);
        steps.push(world);
      }
      return {
        world,
        drawn: interpolateWorld(previous, world, alpha),
        steps,
        paused: false,
        restarted,
      };
    },

    /**
     * Forgets the time of the last frame. Call it when the page was hidden or
     * shown again: the time elapsed in between is meaningless.
     */
    resetClock() {
      lastFrameTime = null;
      stepper.reset();
    },

    /** Current world. */
    get world() {
      return world;
    },
  };
}
