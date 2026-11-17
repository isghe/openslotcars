/**
 * Simulation of one car on one lane.
 *
 * The world is an immutable value: `stepWorld` takes the current world and the
 * input and returns the next world, always advancing by the same fixed time
 * step. Time is derived from an integer step counter, so it never drifts.
 *
 * Rules:
 * - On the track the car follows the longitudinal physics of `physics.js`.
 *   After every step, if the lateral acceleration needed by the curve is above
 *   the grip limit, the car leaves the track.
 * - Off the track the car slides straight along the tangent at the exit point
 *   and the throttle is ignored. After the recovery time a marshal puts it
 *   back on its lane at the exit point, at rest. The distance counted for the
 *   lap does not move while it is off the track, so leaving the track never
 *   shortens a lap.
 * - The lap timer runs on the distance covered on the track. A lap with an
 *   exit is marked as not valid.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import {
  DEFAULT_PARAMS,
  stepLongitudinal,
  hasLostGrip,
  stepOffTrack,
} from './physics.js';
import {
  createLapTimer,
  advanceTimer,
  markExit,
} from './lapTimer.js';

/** Default rules of the simulation. */
export const DEFAULT_RULES = Object.freeze({
  // Fixed simulation step, in seconds.
  dt: 1 / 120,
  // Time a car stays off the track before being put back, in seconds.
  recoveryTime: 1.5,
  // Initial distance, in meters. The car starts behind the finish line, so
  // that the first crossing starts the clock.
  startDistance: -0.1,
});

/** Visual spin of a sliding car, in radians per meter slid. Not physical. */
export const SLIDE_SPIN = 3;

/**
 * Creates the fixed data of a simulation.
 * @param {{lane: object, params?: object, rules?: Partial<typeof DEFAULT_RULES>}} options
 *   `lane` comes from `createLane` or `buildCircuit`.
 */
export function createContext({ lane, params = DEFAULT_PARAMS, rules = {} }) {
  const merged = { ...DEFAULT_RULES, ...rules };
  if (!Number.isFinite(merged.dt) || merged.dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${merged.dt}`);
  }
  if (!Number.isFinite(merged.recoveryTime) || merged.recoveryTime < 0) {
    throw new RangeError(`recoveryTime must be a finite number, zero or more, got ${merged.recoveryTime}`);
  }
  if (!Number.isFinite(merged.startDistance)) {
    throw new RangeError(`startDistance must be a finite number, got ${merged.startDistance}`);
  }
  return Object.freeze({
    lane,
    laneLength: lane.length,
    params,
    dt: merged.dt,
    startDistance: merged.startDistance,
    recoverySteps: Math.max(1, Math.round(merged.recoveryTime / merged.dt)),
  });
}

/**
 * Creates the initial world: the car at rest on the starting distance, with
 * the lap timer not started.
 *
 * The car is `{status: 'onTrack', distance, speed}` or, after leaving the
 * track, `{status: 'offTrack', distance, speed, travel, resumeStep}` where
 * `distance` is the exit point on the lane, `travel` the distance slid since
 * the exit and `resumeStep` the step at which the car is put back.
 */
export function createWorld(context) {
  return {
    stepIndex: 0,
    time: 0,
    car: { status: 'onTrack', distance: context.startDistance, speed: 0 },
    timer: createLapTimer(),
  };
}

/**
 * Advances the world by one fixed time step.
 * @param {object} world Current world.
 * @param {{throttle: number}} input Throttle from 0 to 1.
 * @param {object} context From `createContext`.
 * @returns {object} The next world; the arguments are not modified.
 */
export function stepWorld(world, input, context) {
  const { throttle } = input;
  if (!Number.isFinite(throttle)) {
    throw new RangeError(`throttle must be a finite number, got ${throttle}`);
  }
  const { dt, lane, params } = context;
  const stepIndex = world.stepIndex + 1;
  const time = stepIndex * dt;
  const previousTime = world.stepIndex * dt;
  const car = world.car;

  if (car.status === 'onTrack') {
    const next = stepLongitudinal(car, throttle, dt, params);
    const { timer } = advanceTimer(world.timer, {
      previousTime,
      dt,
      previousDistance: car.distance,
      distance: next.distance,
      laneLength: context.laneLength,
    });

    if (hasLostGrip(next.speed, lane.curvatureAt(next.distance), params)) {
      return {
        stepIndex,
        time,
        // The exit belongs to the lap running at the exit point, which is the
        // new lap if the line was crossed in this very step.
        timer: markExit(timer),
        car: {
          status: 'offTrack',
          distance: next.distance,
          speed: next.speed,
          travel: 0,
          resumeStep: stepIndex + context.recoverySteps,
        },
      };
    }
    return {
      stepIndex,
      time,
      timer,
      car: { status: 'onTrack', distance: next.distance, speed: next.speed },
    };
  }

  if (stepIndex >= car.resumeStep) {
    return {
      stepIndex,
      time,
      timer: world.timer,
      car: { status: 'onTrack', distance: car.distance, speed: 0 },
    };
  }
  const slid = stepOffTrack({ travel: car.travel, speed: car.speed }, dt, params);
  return {
    stepIndex,
    time,
    timer: world.timer,
    car: { ...car, travel: slid.travel, speed: slid.speed },
  };
}

/**
 * Pose of the car in the plane, for drawing. On the track it is the pose on
 * the lane; off the track the car continues along the tangent at the exit
 * point and spins visually.
 * @returns {{x: number, y: number, heading: number}}
 */
export function carPose(world, context) {
  const car = world.car;
  const pose = context.lane.poseAt(car.distance);
  if (car.status === 'onTrack') return pose;
  return {
    x: pose.x + car.travel * Math.cos(pose.heading),
    y: pose.y + car.travel * Math.sin(pose.heading),
    heading: pose.heading + SLIDE_SPIN * car.travel,
  };
}
